import express from "express";
import { getConfig } from "../config.js";
import { createRunTrace, logTrace } from "../observability/tracing.js";
import { prepareSse, safeErrorMessage, sendSse } from "../stream/sse.js";
import { runLaunchPlanner } from "../agent/launchAgent.js";

export const launchAgentRouter = express.Router();

launchAgentRouter.get("/status", (_req, res) => {
  const config = getConfig();
  res.json({
    provider: "openai",
    mode: "agents_sdk",
    configured: Boolean(config.openAiApiKey),
    model: config.model,
    traceEnabled: config.traceEnabled
  });
});

launchAgentRouter.post("/stream", async (req, res) => {
  const payload = sanitizePayload(req.body);
  const trace = createRunTrace(payload);
  prepareSse(res);

  sendSse(res, "progress", {
    traceId: trace.traceId,
    message: "Launch Desk received the brief."
  });
  logTrace(trace, "stream_started");

  try {
    sendSse(res, "progress", {
      traceId: trace.traceId,
      message: "Starting OpenAI Agents SDK run."
    });

    const result = await runLaunchPlanner(payload, trace);
    let sawTextDelta = false;
    let sawToolEvent = false;

    for await (const event of result) {
      if (event.type === "agent_updated_stream_event") {
        sendSse(res, "progress", {
          traceId: trace.traceId,
          message: `${event.agent?.name || "Agent"} is active.`
        });
        continue;
      }

      if (event.type === "run_item_stream_event") {
        const toolEvent = normalizeToolEvent(event);
        if (toolEvent) {
          sawToolEvent = true;
          sendSse(res, "tool_progress", {
            traceId: trace.traceId,
            ...toolEvent
          });
        }
        continue;
      }

      if (event.type === "raw_model_stream_event") {
        const delta = extractTextDelta(event.data);
        if (delta) {
          sawTextDelta = true;
          sendSse(res, "text_delta", {
            traceId: trace.traceId,
            delta
          });
        }
      }
    }

    await result.completed;
    sendSse(res, "final", {
      traceId: trace.traceId,
      output: result.finalOutput || "",
      sawToolEvent,
      sawTextDelta
    });
    logTrace(trace, "stream_completed", { sawToolEvent, sawTextDelta });
  } catch (error) {
    const publicMessage = safeErrorMessage(error);
    console.error("[launch-desk] agent stream failed", error);
    sendSse(res, "error", {
      traceId: trace.traceId,
      message: publicMessage,
      code: error?.code || "agent_stream_failed"
    });
    logTrace(trace, "stream_failed", { message: publicMessage });
  } finally {
    res.end();
  }
});

function sanitizePayload(body = {}) {
  return {
    brief: String(body.brief || "").trim(),
    audience: String(body.audience || "").trim(),
    launchDate: String(body.launchDate || "").trim(),
    constraints: String(body.constraints || "").trim(),
    assets: String(body.assets || "").trim(),
    channels: String(body.channels || "").trim(),
    owners: String(body.owners || "").trim()
  };
}

function normalizeToolEvent(event) {
  if (!event?.name?.includes("tool")) return null;
  const item = event.item || {};
  const rawItem = item.rawItem || {};
  const name = rawItem.name || item.toolName || item.name || item.type || "tool";
  const isOutput = event.name === "tool_output";

  return {
    name,
    status: isOutput ? "completed" : "started",
    message: isOutput
      ? `${humanizeToolName(name)} finished.`
      : `${humanizeToolName(name)} started.`
  };
}

function humanizeToolName(name) {
  return String(name)
    .replace(/^function_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function extractTextDelta(data) {
  if (!data || typeof data !== "object") return "";
  if (typeof data.delta === "string") return data.delta;
  if (typeof data.text === "string") return data.text;

  if (data.type === "response.output_text.delta" && typeof data.delta === "string") {
    return data.delta;
  }

  if (data.type?.includes("delta")) {
    const nested = data.item || data.content || data.output || {};
    if (typeof nested.text === "string") return nested.text;
    if (typeof nested.delta === "string") return nested.delta;
  }

  return "";
}

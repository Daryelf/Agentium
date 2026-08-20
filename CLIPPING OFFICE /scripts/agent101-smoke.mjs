import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function api(base, route, options = {}) {
  const response = await fetch(`${base}${route}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${route} failed: ${response.status} ${json.error || response.statusText}`);
  }
  return json;
}

const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "argentum-agent101-smoke-"));
process.env.CLIPPING_OFFICE_DATA_DIR = runtimeDir;
process.env.AGENT101_OUTPUT_DIR = "./outputs";
process.env.CLIPPER_OUTPUT_DIR = "./outputs";
process.env.CLIPPER_UPLOAD_DIR = "./uploads";
process.env.ANTHROPIC_API_KEY = "";
process.env.OPENAI_API_KEY = "";
process.env.BROWSER_ENABLED = "false";
process.env.AI_PROVIDER = "local_demo";
process.env.AI_MODE = "demo";

const { handleRequest, shutdownRuntime } = await import("../server.js");
const server = http.createServer(handleRequest);

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

try {
  console.log(`Agent 101 smoke target: ${base}`);

  const health = await api(base, "/api/health");
  assert(health.ok, "health endpoint did not return ok");

  const config = await api(base, "/api/config");
  assert(config.anthropicConfigured === false, "smoke should force local fallback with no Anthropic key");
  assert(config.agent101OutputDirConfigured === true, "Agent 101 output directory status should be exposed safely");
  assert(!("anthropicApiKey" in config), "config must not expose Anthropic API key");
  assert(!("openaiApiKey" in config), "config must not expose OpenAI API key");

  const sessionId = `agent101_smoke_${Date.now()}`;
  const build = await api(base, "/api/agent101/run", {
    method: "POST",
    body: JSON.stringify({
      agentMode: "studio",
      sessionId,
      message: "Build me a custom 3D printing shop website called Smoke Forge with Stripe checkout, deployment config, and an operator handoff."
    })
  });
  assert(build.status === "COMPLETED", `studio build should complete, got ${build.status}`);
  assert(build.provider === "local_tool_fallback", "studio smoke should use local tool fallback");
  assert(build.toolCallCount >= 3, "studio build should use multiple real tools");
  assert(build.outputFiles?.length >= 4, "studio build should produce output files");
  assert(build.run.toolCalls.some((tool) => tool.name === "create_business_blueprint" && tool.status === "completed"), "business build should create an operator blueprint");
  assert(build.outputFiles.some((file) => /BUSINESS_BLUEPRINT\.md$/.test(file.path || "")), "business blueprint output should be recorded");
  const verificationCall = build.run.toolCalls.find((tool) => tool.name === "verify_output_project");
  assert(verificationCall?.status === "completed", "studio build must run project verification before completion");
  assert(verificationCall?.output?.verified === true, "studio build project verification must pass");
  assert(verificationCall.output.checks.some((check) => check.check === "runtime-admin-auth" && check.status === "pass"), "generated admin API should reject unauthenticated access");

  const sessions = await api(base, "/api/agent101/sessions");
  assert(sessions.sessions.some((session) => session.sessionId === sessionId), "session list should include the new Studio run");

  const session = await api(base, `/api/agent101/sessions/${encodeURIComponent(sessionId)}`);
  assert(session.runs.length === 1, "session detail should include one run");
  assert(session.runs[0].toolCalls.length >= 3, "session run should persist tool call history");

  const indexFile = build.outputFiles.find((file) => /websites\/smoke-forge\/public\/index\.html$/.test(file.path || ""));
  assert(indexFile, "website index.html output was not recorded");
  const file = await api(base, `/api/agent101/files?path=${encodeURIComponent(indexFile.path)}`);
  assert(file.content.includes("Smoke Forge"), "generated website file should contain the business name");
  const rawFile = await fetch(`${base}/api/agent101/files?path=${encodeURIComponent(indexFile.path)}&raw=1`);
  assert(rawFile.ok, "generated output bytes should be downloadable");
  assert(/attachment/i.test(rawFile.headers.get("content-disposition") || ""), "raw output should use a safe download disposition");
  assert((await rawFile.text()).includes("Smoke Forge"), "raw output download should contain the original saved bytes");

  const approvalSessionId = `${sessionId}_approval`;
  const gated = await api(base, "/api/agent101/run", {
    method: "POST",
    body: JSON.stringify({
      agentMode: "studio",
      sessionId: approvalSessionId,
      message: "Run `npm run check` from the terminal."
    })
  });
  assert(gated.status === "NEEDS_APPROVAL", `shell command should need approval, got ${gated.status}`);
  assert(gated.outputFiles.length === 0, "gated shell request should not generate output files");
  assert(gated.run.toolCalls.some((tool) => tool.name === "run_shell" && tool.status === "needs_approval"), "run_shell tool should be marked needs_approval");

  const approvals = await api(base, "/api/human-gate/approvals");
  assert(approvals.approvals.some((approval) => approval.type === "agent101_shell" || approval.actionType === "agent101_shell"), "Human Gate should contain the exact shell approval request");

  console.log("Agent 101 smoke passed");
} finally {
  await shutdownRuntime();
  await closeServer(server);
  await rm(runtimeDir, { recursive: true, force: true });
}

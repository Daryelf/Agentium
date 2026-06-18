import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchAgentRouter } from "./src/server/routes/agentRoutes.js";
import { getConfig } from "./src/server/config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const config = getConfig();

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "src/client")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "Launch Desk",
    sdk: "@openai/agents",
    model: config.model,
    hasOpenAIKey: Boolean(config.openAiApiKey),
    traceEnabled: config.traceEnabled
  });
});

app.use("/api/launch", launchAgentRouter);

app.use((err, _req, res, _next) => {
  console.error("[launch-desk] unhandled route error", err);
  res.status(500).json({
    error: "Launch Desk hit a server error. Check the server logs for details."
  });
});

app.listen(config.port, config.host, () => {
  console.log(`[launch-desk] running at http://${config.host}:${config.port}`);
  console.log(`[launch-desk] model=${config.model} openai_key=${config.openAiApiKey ? "present" : "missing"}`);
});

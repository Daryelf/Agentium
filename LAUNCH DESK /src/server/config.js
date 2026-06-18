export function getConfig() {
  const port = Number.parseInt(process.env.LAUNCH_DESK_PORT || process.env.PORT || "4188", 10);

  return {
    host: process.env.LAUNCH_DESK_HOST || "127.0.0.1",
    port: Number.isFinite(port) ? port : 4188,
    model: process.env.LAUNCH_DESK_MODEL || "gpt-5.4-mini",
    openAiApiKey: process.env.OPENAI_API_KEY || "",
    traceEnabled: (process.env.LAUNCH_DESK_TRACE_ENABLED || "true") !== "false"
  };
}

export function assertOpenAiReady() {
  const config = getConfig();
  if (!config.openAiApiKey) {
    const error = new Error("OPENAI_API_KEY is not set for the Launch Desk server process.");
    error.code = "missing_openai_api_key";
    throw error;
  }
  return config;
}

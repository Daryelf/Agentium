export function prepareSse(res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

export function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function safeErrorMessage(error) {
  if (error?.code === "missing_openai_api_key") {
    return "OPENAI_API_KEY is missing from the Launch Desk server process.";
  }

  const message = String(error?.message || error || "Unknown error");
  if (/api key|authentication|unauthorized|401/i.test(message)) {
    return "OpenAI authentication failed. Check the server-side OPENAI_API_KEY.";
  }
  if (/quota|billing|credits|insufficient|429/i.test(message)) {
    return "OpenAI API is configured but not active. Check billing, credits, quota, or rate limits.";
  }
  if (/network|fetch|ECONN|ENOTFOUND|ETIMEDOUT/i.test(message)) {
    return "The server could not reach the OpenAI API. Check network access from the server process.";
  }
  return "Launch Desk could not complete the agent run. Check server logs for the technical error.";
}

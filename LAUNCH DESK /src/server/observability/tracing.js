import crypto from "node:crypto";

export function createRunTrace(payload) {
  const traceId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const briefPreview = String(payload?.brief || "").slice(0, 120);

  return {
    traceId,
    startedAt,
    metadata: {
      app: "launch-desk",
      audience: payload?.audience || "unknown",
      launchDate: payload?.launchDate || "unset",
      briefPreview
    }
  };
}

export function logTrace(trace, event, details = {}) {
  console.log(JSON.stringify({
    traceId: trace.traceId,
    event,
    at: new Date().toISOString(),
    ...details
  }));
}

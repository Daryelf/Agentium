const port = process.env.LAUNCH_DESK_PORT || process.env.PORT || "4188";
const url = process.env.LAUNCH_DESK_E2E_URL || `http://127.0.0.1:${port}/api/launch/stream`;

if (!process.env.OPENAI_API_KEY) {
  console.error("E2E blocked: OPENAI_API_KEY is not set in this verification process.");
  process.exit(2);
}

const response = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    brief: "Launch an AI release notes tool for engineering teams that turns merged work into approval-ready customer updates.",
    audience: "Series A SaaS engineering and product teams",
    launchDate: "2026-07-01",
    constraints: "No automatic publishing in v1, support privacy review, limited marketing bandwidth",
    assets: "Demo video, product screenshots, beta quotes, documentation draft",
    channels: "Email, blog, LinkedIn, in-app",
    owners: "Engineering, Product, Design, Marketing, Support"
  })
});

if (!response.ok || !response.body) {
  console.error(`E2E blocked: stream endpoint returned HTTP ${response.status}.`);
  process.exit(1);
}

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let sawToolProgress = false;
let sawTextDelta = false;
let sawError = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const chunks = buffer.split("\n\n");
  buffer = chunks.pop() || "";

  for (const chunk of chunks) {
    const event = chunk.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
    const dataLine = chunk.split("\n").find((line) => line.startsWith("data:"));
    const data = dataLine ? JSON.parse(dataLine.slice(5)) : {};

    if (event === "tool_progress") sawToolProgress = true;
    if (event === "text_delta" && data.delta) sawTextDelta = true;
    if (event === "error") sawError = data.message || "unknown stream error";

    if (sawToolProgress && sawTextDelta) {
      console.log("E2E stream verified: saw tool_progress and text_delta.");
      process.exit(0);
    }
  }
}

if (sawError) {
  console.error(`E2E blocked: ${sawError}`);
} else {
  console.error("E2E failed: stream ended before tool_progress and text_delta were both received.");
}
process.exit(1);

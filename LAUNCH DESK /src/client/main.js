const form = document.querySelector("#launchForm");
const runButton = document.querySelector("#runButton");
const clearButton = document.querySelector("#clearButton");
const sampleButton = document.querySelector("#loadSampleButton");
const eventList = document.querySelector("#eventList");
const streamText = document.querySelector("#streamText");
const runLight = document.querySelector("#runLight");
const providerStatus = document.querySelector("#providerStatus");
const modelName = document.querySelector("#modelName");
const traceStatus = document.querySelector("#traceStatus");

const sample = {
  brief: "Launch a hosted team changelog that automatically turns merged product work into customer-ready release notes with approval review before publishing.",
  audience: "B2B SaaS product teams with weekly release cycles",
  launchDate: nextWeek(),
  constraints: "No automatic publishing for v1, must support rollback messaging, privacy review required for customer names",
  assets: "Prototype screenshots, draft changelog template, demo recording, beta customer quote",
  channels: "Email, blog, LinkedIn, in-app announcement, sales enablement",
  owners: "Engineering, Product, Design, Marketing, Support"
};

init();

async function init() {
  await refreshStatus();
  sampleButton.addEventListener("click", loadSample);
  clearButton.addEventListener("click", clearRun);
  form.addEventListener("submit", onSubmit);
}

async function refreshStatus() {
  try {
    const response = await fetch("/api/launch/status");
    const status = await response.json();
    providerStatus.textContent = status.configured ? "OpenAI key configured" : "OpenAI key missing";
    providerStatus.classList.toggle("ready", status.configured);
    modelName.textContent = status.model;
    traceStatus.textContent = status.traceEnabled ? "Enabled" : "Off";
  } catch {
    providerStatus.textContent = "Status unavailable";
    modelName.textContent = "Unknown";
    traceStatus.textContent = "Unknown";
  }
}

async function onSubmit(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(form).entries());
  clearRun();
  setRunning(true);

  try {
    const response = await fetch("/api/launch/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok || !response.body) {
      throw new Error(`Request failed with ${response.status}`);
    }

    await readSse(response.body);
  } catch (error) {
    addEvent("error", error.message || "Launch run failed.");
  } finally {
    setRunning(false);
  }
}

async function readSse(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";

    for (const chunk of chunks) {
      handleSseChunk(chunk);
    }
  }
}

function handleSseChunk(chunk) {
  const lines = chunk.split("\n");
  const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
  const dataLine = lines.find((line) => line.startsWith("data:"));
  if (!dataLine) return;
  const data = JSON.parse(dataLine.slice(5));

  if (event === "text_delta") {
    if (streamText.textContent.startsWith("Submit a launch brief")) streamText.textContent = "";
    streamText.textContent += data.delta;
    streamText.scrollTop = streamText.scrollHeight;
    return;
  }

  if (event === "final") {
    addEvent("complete", data.sawToolEvent && data.sawTextDelta
      ? "Run completed with tool progress and streamed model text."
      : "Run completed, but expected stream markers were incomplete.");
    if (data.output && !streamText.textContent.trim()) {
      streamText.textContent = data.output;
    }
    return;
  }

  if (event === "error") {
    addEvent("error", data.message);
    streamText.textContent = data.message;
    return;
  }

  addEvent(event, data.message || data.name || "Update received");
}

function addEvent(type, message) {
  const item = document.createElement("li");
  item.className = `event-item ${type}`;
  item.innerHTML = `<span>${type.replace("_", " ")}</span><strong>${escapeHtml(message)}</strong>`;
  eventList.append(item);
  eventList.scrollTop = eventList.scrollHeight;
}

function clearRun() {
  eventList.textContent = "";
  streamText.textContent = "Submit a launch brief to see tool progress and streamed model text here.";
}

function setRunning(isRunning) {
  runButton.disabled = isRunning;
  runButton.textContent = isRunning ? "Planning..." : "Run Launch Desk";
  runLight.textContent = isRunning ? "Running" : "Idle";
  runLight.classList.toggle("active", isRunning);
}

function loadSample() {
  for (const [key, value] of Object.entries(sample)) {
    const field = form.elements[key];
    if (field) field.value = value;
  }
}

function nextWeek() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

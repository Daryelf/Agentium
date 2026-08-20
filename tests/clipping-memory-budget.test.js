const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Readable } = require("node:stream");
const test = require("node:test");

async function memoryHelpers() {
  const moduleUrl = pathToFileURL(path.join(process.cwd(), "CLIPPING OFFICE ", "services", "state-memory.js"));
  return import(moduleUrl.href);
}

function invoke(handler, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body || "";
    const req = new Readable({
      read() {
        if (body) this.push(body);
        this.push(null);
      }
    });
    req.method = options.method || "GET";
    req.url = options.url || "/api/config";
    req.headers = {
      host: "127.0.0.1:4177",
      ...(body ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) } : {})
    };
    const chunks = [];
    const res = {
      statusCode: 200,
      writeHead(statusCode) {
        this.statusCode = statusCode;
      },
      write(chunk) {
        if (chunk) chunks.push(Buffer.from(chunk));
      },
      end(chunk) {
        if (chunk) chunks.push(Buffer.from(chunk));
        resolve({ status: this.statusCode, body: Buffer.concat(chunks).toString("utf8") });
      }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test("offline state compaction keeps newest telemetry and only three persisted chat signals", async () => {
  const { compactStateForMemory } = await memoryHelpers();
  const state = {
    mediaSources: [{
      id: "source-1",
      watchWindowSignals: {
        chatSpikes: Array.from({ length: 8 }, (_, index) => ({ index })),
        chatKeywords: Array.from({ length: 9 }, (_, index) => ({ index }))
      }
    }],
    watchSessions: [{
      id: "session-1",
      recordingWindows: [2, 99, 1, 50].map((index) => ({ index })),
      deletedRecordingWindows: Array.from({ length: 8 }, (_, index) => ({ index })),
      trendingChatPhrases: Array.from({ length: 12 }, (_, index) => ({ phrase: `phrase-${index}` }))
    }]
  };

  const compacted = compactStateForMemory(state, { maxRecordingWindows: 2, watchSignalLimit: 3 });
  assert.equal(compacted, state);
  assert.deepEqual(state.mediaSources[0].watchWindowSignals.chatSpikes.map((entry) => entry.index), [5, 6, 7]);
  assert.deepEqual(state.mediaSources[0].watchWindowSignals.chatKeywords.map((entry) => entry.index), [6, 7, 8]);
  assert.deepEqual(state.watchSessions[0].recordingWindows.map((entry) => entry.index), [99, 50]);
  assert.deepEqual(state.watchSessions[0].deletedRecordingWindows.map((entry) => entry.index), [6, 7]);
  assert.equal(state.watchSessions[0].trendingChatPhrases.length, 8);
});

test("overview projection preserves dashboard shape while staying below one megabyte", async () => {
  const { createStateOverview } = await memoryHelpers();
  const oversizedText = "x".repeat(8000);
  const state = {
    automation: { enabled: true, maxAutoStreams: 2, status: "running" },
    streamers: Array.from({ length: 900 }, (_, index) => ({
      id: `streamer-${index}`,
      displayName: `${oversizedText}-${index}`,
      monitorEnabled: index < 2,
      permissionStatus: "approved",
      platform: "twitch",
      liveStatus: index < 2 ? "live" : "offline"
    })),
    watchSessions: Array.from({ length: 350 }, (_, index) => ({
      id: `session-${index}`,
      streamerId: `streamer-${index}`,
      status: index < 2 ? "watching" : "completed",
      currentStage: oversizedText
    })),
    clipCandidates: Array.from({ length: 600 }, (_, index) => ({
      id: `candidate-${index}`,
      title: oversizedText,
      status: "review",
      transcriptSummary: { text: oversizedText },
      builderDraft: { editorState: { captions: { enabled: true }, sticker: { enabled: false } } }
    })),
    clipPackages: [],
    postingDrafts: [],
    approvalRequests: [],
    mediaJobs: [],
    artifacts: [],
    watchEvents: Array.from({ length: 300 }, (_, index) => ({
      id: `event-${index}`,
      sessionId: `session-${index % 2}`,
      type: "chat_keyword_detected",
      payload: { message: oversizedText, messagesPerMinute: index },
      createdAt: new Date(index * 1000).toISOString()
    }))
  };

  const overview = createStateOverview(state, { sourceUpdatedAt: "2026-07-17T12:00:00.000Z" });
  assert.equal(overview.schemaVersion, 1);
  assert.equal(overview.sourceUpdatedAt, "2026-07-17T12:00:00.000Z");
  for (const key of [
    "streamers", "watchSessions", "clipCandidates", "clipPackages", "postingDrafts",
    "approvalRequests", "mediaJobs", "artifacts", "watchEvents"
  ]) assert.ok(Array.isArray(overview[key]), `${key} should be an array`);
  assert.ok(overview.watchEvents.length <= 100);
  assert.equal(overview.sourceCounts.clipCandidates, 600);
  assert.equal(Object.hasOwn(overview.clipCandidates[0] || {}, "transcriptSummary"), false);
  assert.ok(Buffer.byteLength(JSON.stringify(overview), "utf8") <= 1024 * 1024);
});

test("overview budget trimming retains active sessions and their monitored streamers", async () => {
  const { createStateOverview } = await memoryHelpers();
  const inactiveStreamers = Array.from({ length: 1200 }, (_, index) => ({
    id: `inactive-streamer-${index}`,
    displayName: `Inactive ${index} ${"x".repeat(500)}`,
    monitorEnabled: false,
    updatedAt: new Date(index * 1000).toISOString()
  }));
  const terminalSessions = Array.from({ length: 600 }, (_, index) => ({
    id: `terminal-session-${index}`,
    streamerId: `inactive-streamer-${index}`,
    status: "completed",
    currentStage: "Complete",
    updatedAt: new Date(index * 1000).toISOString()
  }));
  const overview = createStateOverview({
    streamers: [...inactiveStreamers, {
      id: "active-streamer",
      displayName: "Active Streamer",
      monitorEnabled: true,
      updatedAt: "2000-01-01T00:00:00.000Z"
    }],
    watchSessions: [...terminalSessions, {
      id: "active-session",
      streamerId: "active-streamer",
      status: "watching",
      currentStage: "Watching",
      updatedAt: "2000-01-01T00:00:00.000Z"
    }]
  }, { maxBytes: 64 * 1024 });

  assert.ok(Buffer.byteLength(JSON.stringify(overview), "utf8") <= 64 * 1024);
  assert.ok(overview.streamers.some((streamer) => streamer.id === "active-streamer"));
  assert.ok(overview.watchSessions.some((session) => session.id === "active-session"));
});

test("Clipping Office runtime wires low-memory defaults and deferred telemetry", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "CLIPPING OFFICE ", "server.js"), "utf8");
  assert.match(source, /STREAMCLIPPER_MAX_WATCHED_STREAMERS, 1, 1, 50/);
  assert.match(source, /STREAMCLIPPER_MAX_WATCHED_STREAMERS === undefined/);
  assert.match(source, /STREAMCLIPPER_MAX_CONCURRENT_MEDIA_JOBS, 1, 1, 4/);
  assert.match(source, /STREAMCLIPPER_MAX_RECORDING_WINDOWS, 60, 1, 2000/);
  assert.match(source, /128 \* 1024 \* 1024/);
  assert.match(source, /"watcher_heartbeat"[\s\S]*?persistence: "transient"/);
  assert.match(source, /"signal_detected"[\s\S]*?persistence: "deferred"/);
  assert.match(source, /"chat_keyword_detected"[\s\S]*?persistence: "deferred"/);
  assert.match(source, /return runHeavyMediaJob\(\(\) => captureLiveWindowForSessionImpl/);
  assert.match(source, /heavyMediaJobContext\.getStore\(\)\?\.active/);
  assert.match(source, /return runHeavyMediaJob\(\(\) => standardizeEditorExportImpl/);
  assert.match(source, /return runHeavyMediaJob\(\(\) => createRenderJobImpl/);
  assert.match(source, /enforceWatchCapacityAtBoot\(\)/);
});

test("startup recovery pauses excess pooled work without deleting clips", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-memory-capacity-"));
  const originalEnv = {
    CLIPPING_OFFICE_DATA_DIR: process.env.CLIPPING_OFFICE_DATA_DIR,
    STREAMCLIPPER_MAX_WATCHED_STREAMERS: process.env.STREAMCLIPPER_MAX_WATCHED_STREAMERS,
    STREAMCLIPPER_SINGLE_WATCH_MODE: process.env.STREAMCLIPPER_SINGLE_WATCH_MODE,
    STREAMCLIPPER_CAPTURE_ENABLED: process.env.STREAMCLIPPER_CAPTURE_ENABLED,
    STREAMCLIPPER_ROLLING_BUFFER_ENABLED: process.env.STREAMCLIPPER_ROLLING_BUFFER_ENABLED
  };
  process.env.CLIPPING_OFFICE_DATA_DIR = dataDir;
  process.env.STREAMCLIPPER_MAX_WATCHED_STREAMERS = "2";
  process.env.STREAMCLIPPER_SINGLE_WATCH_MODE = "false";
  process.env.STREAMCLIPPER_CAPTURE_ENABLED = "false";
  process.env.STREAMCLIPPER_ROLLING_BUFFER_ENABLED = "false";

  const stamp = new Date().toISOString();
  const seeded = {
    automation: { enabled: false, maxAutoStreams: 20 },
    streamers: Array.from({ length: 4 }, (_, index) => ({
      id: `streamer-${index}`,
      displayName: `Streamer ${index}`,
      platform: "custom",
      permissionStatus: "approved",
      allowedUse: ["clips"],
      monitorEnabled: true,
      updatedAt: new Date(Date.now() + index * 1000).toISOString()
    })),
    watchSessions: Array.from({ length: 4 }, (_, index) => ({
      id: `session-${index}`,
      streamerId: `streamer-${index}`,
      streamerName: `Streamer ${index}`,
      mode: "real",
      status: "watching",
      createdAt: stamp,
      updatedAt: new Date(Date.now() + index * 1000).toISOString()
    })),
    clipCandidates: Array.from({ length: 4 }, (_, index) => ({
      id: `candidate-${index}`,
      sourceType: "upload",
      status: "review",
      createdAt: stamp,
      updatedAt: stamp
    }))
  };
  fs.writeFileSync(path.join(dataDir, "state.json"), JSON.stringify(seeded));

  let shutdownRuntime;
  t.after(async () => {
    await shutdownRuntime?.();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const serverUrl = pathToFileURL(path.join(process.cwd(), "CLIPPING OFFICE ", "server.js"));
  serverUrl.search = `?memory-capacity-test=${Date.now()}`;
  const runtime = await import(serverUrl.href);
  shutdownRuntime = runtime.shutdownRuntime;
  const response = await invoke(runtime.handleRequest);
  assert.equal(response.status, 200);

  const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, "state.json"), "utf8"));
  const activeStatuses = new Set(["queued", "starting", "connecting", "watching", "degraded", "reconnecting"]);
  assert.equal(persisted.watchSessions.filter((session) => activeStatuses.has(session.status)).length, 2);
  assert.equal(persisted.watchSessions.filter((session) => session.status === "paused").length, 2);
  assert.equal(persisted.streamers.filter((streamer) => streamer.monitorEnabled).length, 2);
  assert.equal(persisted.clipCandidates.length, 4);
  assert.equal(persisted.automation.maxAutoStreams, 2);
  const overviewPath = path.join(dataDir, "overview.json");
  assert.ok(fs.existsSync(overviewPath));
  assert.ok(fs.statSync(overviewPath).size <= 1024 * 1024);

  const paused = persisted.watchSessions.find((session) => session.status === "paused");
  const resume = await invoke(runtime.handleRequest, {
    method: "POST",
    url: `/api/watch-sessions/${encodeURIComponent(paused.id)}/resume`,
    body: "{}"
  });
  assert.equal(resume.status, 409);
  const afterRejectedResume = JSON.parse(fs.readFileSync(path.join(dataDir, "state.json"), "utf8"));
  assert.equal(afterRejectedResume.watchSessions.find((session) => session.id === paused.id).status, "paused");

  const demoStart = await invoke(runtime.handleRequest, {
    method: "POST",
    url: "/api/watch-sessions",
    body: JSON.stringify({ mode: "demo", idempotencyKey: "capacity-full-demo" })
  });
  assert.equal(demoStart.status, 409);
  const afterRejectedStart = JSON.parse(fs.readFileSync(path.join(dataDir, "state.json"), "utf8"));
  assert.equal(afterRejectedStart.streamers.some((streamer) => streamer.id === "streamer_demo_media_source"), false);
  assert.equal(afterRejectedStart.clipCandidates.length, 4);
});

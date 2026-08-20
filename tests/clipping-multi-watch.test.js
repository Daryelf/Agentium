const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

function invoke(handler, options = {}) {
  return new Promise((resolve, reject) => {
    const req = new Readable({
      read() {
        this.push(options.body || "");
        this.push(null);
      }
    });
    req.method = options.method || "GET";
    req.url = options.url || "/";
    req.headers = { host: "127.0.0.1:4177", ...(options.headers || {}) };
    const chunks = [];
    const res = {
      statusCode: 200,
      headers: {},
      writeHead(statusCode, headers = {}) {
        this.statusCode = statusCode;
        this.headers = { ...this.headers, ...headers };
      },
      write(chunk) {
        if (chunk) chunks.push(Buffer.from(chunk));
      },
      end(chunk) {
        if (chunk) chunks.push(Buffer.from(chunk));
        resolve({
          status: this.statusCode,
          body: Buffer.concat(chunks).toString("utf8")
        });
      }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test("pooled watch mode keeps multiple live streamers active up to the configured limit", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-clipping-multi-watch-"));
  const environment = [
    "CLIPPING_OFFICE_DATA_DIR",
    "TWITCH_CLIENT_ID",
    "TWITCH_CLIENT_SECRET",
    "TWITCH_APP_ACCESS_TOKEN",
    "STREAMCLIPPER_CAPTURE_ENABLED",
    "STREAMCLIPPER_MAX_WATCHED_STREAMERS",
    "STREAMCLIPPER_SINGLE_WATCH_MODE",
    "STREAMCLIPPER_WATCH_MODE"
  ];
  const originalEnv = Object.fromEntries(environment.map((key) => [key, process.env[key]]));
  const originalFetch = global.fetch;

  process.env.CLIPPING_OFFICE_DATA_DIR = dataDir;
  process.env.TWITCH_CLIENT_ID = "mock-client-id";
  process.env.TWITCH_CLIENT_SECRET = "mock-client-secret";
  process.env.TWITCH_APP_ACCESS_TOKEN = "";
  process.env.STREAMCLIPPER_CAPTURE_ENABLED = "false";
  process.env.STREAMCLIPPER_MAX_WATCHED_STREAMERS = "2";
  process.env.STREAMCLIPPER_SINGLE_WATCH_MODE = "false";
  process.env.STREAMCLIPPER_WATCH_MODE = "pooled";

  const liveStreams = {
    firstpoolwatcher: { name: "First Pool Watcher", viewers: 9100 },
    secondpoolwatcher: { name: "Second Pool Watcher", viewers: 7400 }
  };
  global.fetch = async (url) => {
    const href = String(url);
    if (href.startsWith("https://id.twitch.tv/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "mock-app-token", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (href.startsWith("https://api.twitch.tv/helix/streams")) {
      const login = String(new URL(href).searchParams.get("user_login") || "").toLowerCase();
      const stream = liveStreams[login];
      return new Response(JSON.stringify({
        data: stream ? [{
          id: `stream-${login}`,
          user_id: `user-${login}`,
          user_login: login,
          user_name: stream.name,
          title: `${stream.name} live test`,
          game_name: "Just Chatting",
          viewer_count: stream.viewers,
          started_at: new Date(Date.now() - 60_000).toISOString(),
          thumbnail_url: ""
        }] : []
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const serverUrl = pathToFileURL(path.join(process.cwd(), "CLIPPING OFFICE ", "server.js"));
  serverUrl.search = `?multi-watch-test=${Date.now()}`;
  const { handleRequest, shutdownRuntime } = await import(serverUrl.href);
  const sessionIds = [];

  t.after(async () => {
    for (const sessionId of sessionIds) {
      await invoke(handleRequest, {
        method: "POST",
        url: `/api/watch-sessions/${encodeURIComponent(sessionId)}/stop`,
        body: "{}"
      }).catch(() => {});
    }
    await shutdownRuntime();
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const streamers = [];
  for (const [channelId, stream] of Object.entries(liveStreams)) {
    const response = await invoke(handleRequest, {
      method: "POST",
      url: "/api/twitch/streamers",
      body: JSON.stringify({
        platform: "twitch",
        displayName: stream.name,
        channelId,
        permissionStatus: "approved",
        allowedUse: ["clips"],
        monitorEnabled: true
      })
    });
    assert.equal(response.status, 201);
    streamers.push(JSON.parse(response.body).streamer);
  }

  for (const streamer of streamers) {
    const response = await invoke(handleRequest, {
      method: "POST",
      url: "/api/watch-sessions",
      body: JSON.stringify({
        mode: "real",
        streamerId: streamer.id,
        idempotencyKey: `multi-watch:${streamer.id}`
      })
    });
    assert.ok([200, 201].includes(response.status), `expected watch session start or reuse, got ${response.status}`);
    sessionIds.push(JSON.parse(response.body).session.id);
  }

  const activeResponse = await invoke(handleRequest, { url: "/api/watch-sessions/active" });
  assert.equal(activeResponse.status, 200);
  const active = JSON.parse(activeResponse.body).sessions;
  assert.equal(active.length, 2);
  assert.deepEqual(new Set(active.map((session) => session.streamerId)), new Set(streamers.map((streamer) => streamer.id)));

  const configResponse = await invoke(handleRequest, { url: "/api/config" });
  assert.equal(configResponse.status, 200);
  assert.equal(JSON.parse(configResponse.body).maxWatchedStreamers, 2);
});

test("focused automation uses official stream metadata and switches the active mission without invented matches", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-clipping-focus-"));
  const environment = [
    "CLIPPING_OFFICE_DATA_DIR",
    "TWITCH_CLIENT_ID",
    "TWITCH_CLIENT_SECRET",
    "TWITCH_APP_ACCESS_TOKEN",
    "KICK_CLIENT_ID",
    "KICK_CLIENT_SECRET",
    "KICK_OAUTH_TOKEN",
    "STREAMCLIPPER_CAPTURE_ENABLED",
    "STREAMCLIPPER_MAX_WATCHED_STREAMERS",
    "STREAMCLIPPER_SINGLE_WATCH_MODE",
    "STREAMCLIPPER_WATCH_MODE"
  ];
  const originalEnv = Object.fromEntries(environment.map((key) => [key, process.env[key]]));
  const originalFetch = global.fetch;
  process.env.CLIPPING_OFFICE_DATA_DIR = dataDir;
  process.env.TWITCH_CLIENT_ID = "mock-client-id";
  process.env.TWITCH_CLIENT_SECRET = "mock-client-secret";
  process.env.TWITCH_APP_ACCESS_TOKEN = "";
  process.env.KICK_CLIENT_ID = "";
  process.env.KICK_CLIENT_SECRET = "";
  process.env.KICK_OAUTH_TOKEN = "";
  process.env.STREAMCLIPPER_CAPTURE_ENABLED = "false";
  process.env.STREAMCLIPPER_MAX_WATCHED_STREAMERS = "4";
  process.env.STREAMCLIPPER_SINGLE_WATCH_MODE = "false";
  process.env.STREAMCLIPPER_WATCH_MODE = "pooled";

  const officialStreams = [
    {
      id: "stream-university",
      user_id: "user-university",
      user_login: "streameruniversity",
      user_name: "Streamer University",
      title: "Streamer University live class",
      game_name: "Just Chatting",
      viewer_count: 4200,
      started_at: new Date(Date.now() - 60_000).toISOString(),
      thumbnail_url: ""
    },
    {
      id: "stream-irl",
      user_id: "user-irl",
      user_login: "citywalklive",
      user_name: "City Walk Live",
      title: "Walking downtown live",
      game_name: "IRL",
      viewer_count: 3100,
      started_at: new Date(Date.now() - 60_000).toISOString(),
      thumbnail_url: ""
    },
    {
      id: "stream-game",
      user_id: "user-game",
      user_login: "rankedplayer",
      user_name: "Ranked Player",
      title: "Ranked grind",
      game_name: "VALORANT",
      viewer_count: 2800,
      started_at: new Date(Date.now() - 60_000).toISOString(),
      thumbnail_url: ""
    }
  ];
  global.fetch = async (url) => {
    const href = String(url);
    if (href.startsWith("https://id.twitch.tv/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "mock-app-token", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (href.startsWith("https://api.twitch.tv/helix/streams")) {
      const login = String(new URL(href).searchParams.get("user_login") || "").toLowerCase();
      const rows = login ? officialStreams.filter((stream) => stream.user_login === login) : officialStreams;
      return new Response(JSON.stringify({ data: rows, pagination: {} }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ data: [], pagination: {} }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const serverUrl = pathToFileURL(path.join(process.cwd(), "CLIPPING OFFICE ", "server.js"));
  serverUrl.search = `?focus-automation-test=${Date.now()}`;
  const { handleRequest, shutdownRuntime } = await import(serverUrl.href);

  t.after(async () => {
    const active = await invoke(handleRequest, { url: "/api/watch-sessions/active" }).catch(() => null);
    for (const session of active ? JSON.parse(active.body).sessions || [] : []) {
      await invoke(handleRequest, {
        method: "POST",
        url: `/api/watch-sessions/${encodeURIComponent(session.id)}/stop`,
        body: "{}"
      }).catch(() => {});
    }
    await shutdownRuntime();
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const defaultsResponse = await invoke(handleRequest, { url: "/api/automation/settings" });
  assert.equal(defaultsResponse.status, 200);
  assert.equal(JSON.parse(defaultsResponse.body).automation.focus, "streamer_university");
  assert.equal(JSON.parse(defaultsResponse.body).automation.pipelineStage, "library");

  const universityRun = await invoke(handleRequest, {
    method: "POST",
    url: "/api/automation/run",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  assert.equal(universityRun.status, 200);
  const universityAutomation = JSON.parse(universityRun.body).automation;
  assert.equal(universityAutomation.scannedStreams, 3);
  assert.equal(universityAutomation.matchedStreams, 1);
  assert.equal(universityAutomation.activeFocusedStreams, 1);
  assert.equal(universityAutomation.recordingFocusedStreams, 0);
  assert.equal(universityAutomation.metadataOnlyFocusedStreams, 0);
  assert.equal(universityAutomation.connectingFocusedStreams, 1);
  assert.deepEqual(universityAutomation.providerPages, { twitch: 1, kick: 0 });
  assert.deepEqual(universityAutomation.providerErrors, []);
  assert.equal(universityAutomation.scanTruncated, false);

  const switchResponse = await invoke(handleRequest, {
    method: "PATCH",
    url: "/api/automation/settings",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, focus: "irl", pipelineStage: "library", maxAutoStreams: 2 })
  });
  assert.equal(switchResponse.status, 200);
  assert.equal(JSON.parse(switchResponse.body).automation.focus, "irl");

  const irlRun = await invoke(handleRequest, {
    method: "POST",
    url: "/api/automation/run",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  assert.equal(irlRun.status, 200);
  const irlAutomation = JSON.parse(irlRun.body).automation;
  assert.equal(irlAutomation.scannedStreams, 3);
  assert.equal(irlAutomation.matchedStreams, 2);
  assert.equal(irlAutomation.activeFocusedStreams, 2);
  assert.equal(irlAutomation.recordingFocusedStreams, 0);
  assert.equal(irlAutomation.metadataOnlyFocusedStreams, 0);
  assert.equal(irlAutomation.connectingFocusedStreams, 2);
  assert.equal(irlAutomation.focusLabel, "IRL & Chatting");
  assert.equal(irlAutomation.postingAutomation, false);
  assert.equal(irlAutomation.postingGate, "Human Gate required");

  const stateJson = JSON.parse(fs.readFileSync(path.join(dataDir, "state.json"), "utf8"));
  const automationStreamers = stateJson.streamers.filter((streamer) => streamer.automationManaged);
  assert.equal(automationStreamers.length, 2);
  assert.equal(automationStreamers.every((streamer) => streamer.permissionBasis === "operator_authorized_full_automation"), true);
  assert.equal(automationStreamers.every((streamer) => streamer.officialLiveMetadata?.sourceType === "official_live"), true);
});

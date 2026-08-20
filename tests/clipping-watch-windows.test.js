const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Readable } = require("node:stream");
const test = require("node:test");

function invoke(handler, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body || "";
    const req = new Readable({
      read() {
        this.push(body);
        this.push(null);
      },
    });
    req.method = options.method || "GET";
    req.url = options.url || "/";
    req.headers = {
      host: "127.0.0.1:4177",
      ...(options.headers || {}),
    };

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
          headers: this.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      },
    };

    Promise.resolve(handler(req, res)).catch(reject);
  });
}

async function poll(fn, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return last;
}

test("real live watcher does not create Clip Radar candidates without saved video", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-clipping-watch-"));
  const originalEnv = {
    CLIPPING_OFFICE_DATA_DIR: process.env.CLIPPING_OFFICE_DATA_DIR,
    TWITCH_CLIENT_ID: process.env.TWITCH_CLIENT_ID,
    TWITCH_CLIENT_SECRET: process.env.TWITCH_CLIENT_SECRET,
    TWITCH_APP_ACCESS_TOKEN: process.env.TWITCH_APP_ACCESS_TOKEN,
    STREAMCLIPPER_RECORDING_WINDOW_SECONDS: process.env.STREAMCLIPPER_RECORDING_WINDOW_SECONDS,
    STREAMCLIPPER_CAPTURE_ENABLED: process.env.STREAMCLIPPER_CAPTURE_ENABLED,
  };
  const originalFetch = global.fetch;

  process.env.CLIPPING_OFFICE_DATA_DIR = dataDir;
  process.env.TWITCH_CLIENT_ID = "mock-client-id";
  process.env.TWITCH_CLIENT_SECRET = "mock-client-secret";
  process.env.TWITCH_APP_ACCESS_TOKEN = "";
  process.env.STREAMCLIPPER_RECORDING_WINDOW_SECONDS = "30";
  process.env.STREAMCLIPPER_CAPTURE_ENABLED = "false";

  global.fetch = async (url) => {
    const href = String(url);
    if (href.startsWith("https://id.twitch.tv/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "mock-app-token", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (href.startsWith("https://api.twitch.tv/helix/streams")) {
      return new Response(JSON.stringify({
        data: [{
          id: "mock-stream-1",
          user_id: "12345",
          user_login: "mocklive",
          user_name: "MockLive",
          title: "Insane reaction with a clean payoff",
          game_name: "Just Chatting",
          viewer_count: 12345,
          started_at: new Date(Date.now() - 60_000).toISOString(),
          thumbnail_url: "",
        }],
      }), {
        status: 200,
        headers: { "content-type": "application/json", "ratelimit-remaining": "99" },
      });
    }
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  let handleRequest;
  let shutdownRuntime;
  let sessionId = "";
  t.after(async () => {
    await shutdownRuntime?.();
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const serverUrl = pathToFileURL(path.join(process.cwd(), "CLIPPING OFFICE ", "server.js"));
  serverUrl.search = `?watch-window-test=${Date.now()}`;
  ({ handleRequest, shutdownRuntime } = await import(serverUrl.href));

  try {
    const created = await invoke(handleRequest, {
      method: "POST",
      url: "/api/twitch/streamers",
      body: JSON.stringify({
        platform: "twitch",
        displayName: "MockLive",
        channelId: "mocklive",
        permissionStatus: "approved",
        allowedUse: ["clips"],
        monitorEnabled: true,
      }),
    });
    assert.equal(created.status, 201);
    const streamer = JSON.parse(created.body).streamer;
    assert.equal(streamer.permissionStatus, "approved");
    assert.equal(streamer.liveStatus, "live");

    const started = await invoke(handleRequest, {
      method: "POST",
      url: "/api/watch-sessions",
      body: JSON.stringify({
        mode: "real",
        streamerId: streamer.id,
        idempotencyKey: `watch-window-test:${streamer.id}`,
      }),
    });
    assert.ok([200, 201].includes(started.status), `expected watch session start/reuse, got ${started.status}`);
    const session = JSON.parse(started.body).session;
    sessionId = session.id;

    const afterRefresh = await poll(async () => {
      const response = await invoke(handleRequest, { method: "GET", url: "/api/clips/candidates" });
      assert.equal(response.status, 200);
      const payload = JSON.parse(response.body);
      assert.equal(payload.candidates.some((item) => item.watchSessionId === session.id), false);
      return payload;
    });

    assert.ok(afterRefresh, "expected candidate list to stay clear without a saved source");

    const detailPayload = await poll(async () => {
      const detail = await invoke(handleRequest, { method: "GET", url: `/api/watch-sessions/${encodeURIComponent(session.id)}` });
      assert.equal(detail.status, 200);
      const payload = JSON.parse(detail.body);
      return payload.session.recordingWindows?.length ? payload : null;
    }, 5000);
    assert.ok(detailPayload, "expected the background worker to publish watch-window telemetry");
    assert.ok(detailPayload.session.recordingWindows?.length, "expected watch-window telemetry to remain on the session");
    assert.equal(detailPayload.session.recordingWindows[0].status, "awaiting_source");
    assert.equal(detailPayload.events.some((event) => event.type === "recording_window_waiting_for_source"), true);
    assert.equal(detailPayload.events.some((event) => event.type === "recording_window_created"), false);
  } finally {
    if (handleRequest && sessionId) {
      await invoke(handleRequest, {
        method: "POST",
        url: `/api/watch-sessions/${encodeURIComponent(sessionId)}/stop`,
        body: "{}",
      }).catch(() => {});
    }
  }
});

test("stream search exposes direct watch controls without a page transition", () => {
  const appSource = fs.readFileSync(path.join(process.cwd(), "CLIPPING OFFICE ", "public", "app.js"), "utf8");
  assert.match(appSource, /data-watch-streamer/);
  assert.match(appSource, /async function watchStreamer/);
  assert.match(appSource, /api\("\/api\/watch\/run"/);
  assert.doesNotMatch(appSource, /setView\("radar"\)/);
});

test("watch-session recovery clears stale recorder locks after a backend restart", () => {
  const serverSource = fs.readFileSync(path.join(process.cwd(), "CLIPPING OFFICE ", "server.js"), "utf8");
  assert.match(serverSource, /session\.captureStatus === "capturing"/);
  assert.match(serverSource, /session\.captureStatus = "ready"/);
  assert.match(serverSource, /A stale capture lock was cleared so this stream can record again/);
});

  test("one live watch session at a time: launching a second stream cancels the first watcher", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-clipping-single-watch-"));
  const originalEnv = {
    CLIPPING_OFFICE_DATA_DIR: process.env.CLIPPING_OFFICE_DATA_DIR,
    TWITCH_CLIENT_ID: process.env.TWITCH_CLIENT_ID,
    TWITCH_CLIENT_SECRET: process.env.TWITCH_CLIENT_SECRET,
    TWITCH_APP_ACCESS_TOKEN: process.env.TWITCH_APP_ACCESS_TOKEN,
    STREAMCLIPPER_RECORDING_WINDOW_SECONDS: process.env.STREAMCLIPPER_RECORDING_WINDOW_SECONDS,
    STREAMCLIPPER_CAPTURE_ENABLED: process.env.STREAMCLIPPER_CAPTURE_ENABLED,
    STREAMCLIPPER_REQUIRE_WATCH_TRIGGER: process.env.STREAMCLIPPER_REQUIRE_WATCH_TRIGGER,
    STREAMCLIPPER_MAX_WATCHED_STREAMERS: process.env.STREAMCLIPPER_MAX_WATCHED_STREAMERS
  };
  const originalFetch = global.fetch;

  process.env.CLIPPING_OFFICE_DATA_DIR = dataDir;
  process.env.TWITCH_CLIENT_ID = "mock-client-id";
  process.env.TWITCH_CLIENT_SECRET = "mock-client-secret";
  process.env.TWITCH_APP_ACCESS_TOKEN = "";
  process.env.STREAMCLIPPER_RECORDING_WINDOW_SECONDS = "30";
  process.env.STREAMCLIPPER_CAPTURE_ENABLED = "false";
  process.env.STREAMCLIPPER_REQUIRE_WATCH_TRIGGER = "true";
  process.env.STREAMCLIPPER_MAX_WATCHED_STREAMERS = "1";

  const streamMap = {
    watcherone: {
      user_name: "Watcher One",
      title: "First streamer for single-watch test",
      game_name: "Just Chatting",
      viewer_count: 4200
    },
    watcher2: {
      user_name: "Watcher Two",
      title: "Second streamer for single-watch test",
      game_name: "Valorant",
      viewer_count: 6800
    }
  };

  global.fetch = async (url) => {
    const href = String(url);
    if (href.startsWith("https://id.twitch.tv/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "mock-app-token", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (href.startsWith("https://api.twitch.tv/helix/streams")) {
      const parsed = new URL(href);
      const login = String(parsed.searchParams.get("user_login") || "").toLowerCase();
      const match = streamMap[login] || null;
      return new Response(JSON.stringify({
        data: match ? [{
          id: `mock-stream-${login}`,
          user_id: `${login}-id`,
          user_login: login,
          user_name: match.user_name,
          title: match.title,
          game_name: match.game_name,
          viewer_count: match.viewer_count,
          started_at: new Date(Date.now() - 60_000).toISOString(),
          thumbnail_url: ""
        }] : []
      }), {
        status: 200,
        headers: { "content-type": "application/json", "ratelimit-remaining": "99" },
      });
    }
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  let handleRequest;
  let shutdownRuntime;
  let sessionIdOne = "";
  let sessionIdTwo = "";
  t.after(async () => {
    await shutdownRuntime?.();
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const serverUrl = pathToFileURL(path.join(process.cwd(), "CLIPPING OFFICE ", "server.js"));
  serverUrl.search = `?single-watch-test=${Date.now()}`;
  ({ handleRequest, shutdownRuntime } = await import(serverUrl.href));

  try {
    const streamerOne = JSON.parse((await invoke(handleRequest, {
      method: "POST",
      url: "/api/twitch/streamers",
      body: JSON.stringify({
        platform: "twitch",
        displayName: "Watcher One",
        channelId: "watcherone",
        permissionStatus: "approved",
        allowedUse: ["clips"],
        monitorEnabled: true,
        liveStatus: "live"
      })
    })).body).streamer;

    const streamerTwo = JSON.parse((await invoke(handleRequest, {
      method: "POST",
      url: "/api/twitch/streamers",
      body: JSON.stringify({
        platform: "twitch",
        displayName: "Watcher Two",
        channelId: "watcher2",
        permissionStatus: "approved",
        allowedUse: ["clips"],
        monitorEnabled: true,
        liveStatus: "live"
      })
    })).body).streamer;

    const startedOne = await invoke(handleRequest, {
      method: "POST",
      url: "/api/watch-sessions",
      body: JSON.stringify({
        mode: "real",
        streamerId: streamerOne.id,
        idempotencyKey: `single-watch:${streamerOne.id}:one`
      })
    });
    assert.equal(startedOne.status, 201);
    sessionIdOne = JSON.parse(startedOne.body).session.id;

    const startedTwo = await invoke(handleRequest, {
      method: "POST",
      url: "/api/watch-sessions",
      body: JSON.stringify({
        mode: "real",
        streamerId: streamerTwo.id,
        idempotencyKey: `single-watch:${streamerTwo.id}:two`
      })
    });
    assert.equal(startedTwo.status, 201);
    sessionIdTwo = JSON.parse(startedTwo.body).session.id;

    const sessions = await poll(async () => {
      const response = await invoke(handleRequest, { method: "GET", url: "/api/watch-sessions" });
      assert.equal(response.status, 200);
      const payload = JSON.parse(response.body);
      const one = payload.sessions.find((item) => item.id === sessionIdOne);
      const two = payload.sessions.find((item) => item.id === sessionIdTwo);
      if (!one || !two) return null;
      if (one.status === "stream_ended" || one.status === "cancelled" || one.status === "completed") return payload;
      return null;
    });
    assert.ok(sessions, "expected first watch session to stop once second stream starts");

    const activeResponse = await invoke(handleRequest, { method: "GET", url: "/api/watch-sessions/active" });
    assert.equal(activeResponse.status, 200);
    const active = JSON.parse(activeResponse.body);
    assert.equal(active.sessions.length, 1, "expected only one active watcher session after single-watch enforcement");
    assert.equal(active.sessions[0].streamerId, streamerTwo.id, "expected latest live stream to own the active watcher slot");

    const detailsOne = await invoke(handleRequest, { method: "GET", url: `/api/watch-sessions/${encodeURIComponent(sessionIdOne)}` });
    assert.equal(detailsOne.status, 200);
    const oneSession = JSON.parse(detailsOne.body).session;
    assert.notEqual(["watching", "connecting", "starting", "degraded", "queued", "reconnecting"].includes(oneSession.status), true);

    const streamersResponse = await invoke(handleRequest, { method: "GET", url: "/api/twitch/streamers" });
    assert.equal(streamersResponse.status, 200);
    const streamersPayload = JSON.parse(streamersResponse.body);
    const one = streamersPayload.streamers.find((item) => item.id === streamerOne.id);
    const two = streamersPayload.streamers.find((item) => item.id === streamerTwo.id);
    assert.equal(Boolean(one?.monitorEnabled), false, "first stream should be paused when second is watching");
    assert.equal(Boolean(two?.monitorEnabled), true, "second stream should be the active monitor");
  } finally {
    for (const id of [sessionIdOne, sessionIdTwo]) {
      if (!id) continue;
      await invoke(handleRequest, { method: "POST", url: `/api/watch-sessions/${encodeURIComponent(id)}/stop`, body: "{}" }).catch(() => {});
    }
    handleRequest = null;
  }
  });

test("single-watch cleanup removes stale live windows from prior sessions", async (t) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-clipping-reuse-window-"));
    const stateFile = path.join(dataDir, "state.json");
    const originalEnv = {
      CLIPPING_OFFICE_DATA_DIR: process.env.CLIPPING_OFFICE_DATA_DIR,
      TWITCH_CLIENT_ID: process.env.TWITCH_CLIENT_ID,
      TWITCH_CLIENT_SECRET: process.env.TWITCH_CLIENT_SECRET,
      TWITCH_APP_ACCESS_TOKEN: process.env.TWITCH_APP_ACCESS_TOKEN,
      STREAMCLIPPER_RECORDING_WINDOW_SECONDS: process.env.STREAMCLIPPER_RECORDING_WINDOW_SECONDS,
      STREAMCLIPPER_CAPTURE_ENABLED: process.env.STREAMCLIPPER_CAPTURE_ENABLED,
      STREAMCLIPPER_MAX_WATCHED_STREAMERS: process.env.STREAMCLIPPER_MAX_WATCHED_STREAMERS
    };
    const originalFetch = global.fetch;

    process.env.CLIPPING_OFFICE_DATA_DIR = dataDir;
    process.env.TWITCH_CLIENT_ID = "mock-client-id";
    process.env.TWITCH_CLIENT_SECRET = "mock-client-secret";
    process.env.TWITCH_APP_ACCESS_TOKEN = "";
    process.env.STREAMCLIPPER_RECORDING_WINDOW_SECONDS = "30";
    process.env.STREAMCLIPPER_CAPTURE_ENABLED = "false";
    process.env.STREAMCLIPPER_MAX_WATCHED_STREAMERS = "1";
    global.fetch = async (url) => {
      const href = String(url);
      if (href.startsWith("https://id.twitch.tv/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "mock-app-token", expires_in: 3600 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (href.startsWith("https://api.twitch.tv/helix/streams")) {
        return new Response(JSON.stringify({
          data: [{
            id: "mock-stream-single",
            user_id: "single-id",
            user_login: "singlestream",
            user_name: "Single Streamer",
            title: "Live with many stale windows",
            game_name: "Just Chatting",
            viewer_count: 1200,
            started_at: new Date(Date.now() - 60_000).toISOString(),
            thumbnail_url: ""
          }],
        }), {
          status: 200,
          headers: { "content-type": "application/json", "ratelimit-remaining": "99" },
        });
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const seededState = {
      streamers: [
        {
          id: "streamer-single",
          displayName: "Single Streamer",
          platform: "twitch",
          channelId: "singlestream",
          permissionStatus: "approved",
          allowedUse: ["clips"],
          monitorEnabled: true,
          liveStatus: "live"
        }
      ],
      watchSessions: [
        { id: "session-old-a", streamerId: "streamer-single", status: "stream_ended" },
        { id: "session-old-b", streamerId: "streamer-single", status: "stream_ended" }
      ],
      clipCandidates: [
        { id: "old-window-a", watchSessionId: "session-old-a", sourceType: "live_recording_window", streamerId: "streamer-single", recordingWindowIndex: 1, status: "review", decision: "review", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: "old-window-b", watchSessionId: "session-old-a", sourceType: "live_recording_window", streamerId: "streamer-single", recordingWindowIndex: 2, status: "review", decision: "review", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: "old-window-c", watchSessionId: "session-old-b", sourceType: "live_recording_window", streamerId: "streamer-single", recordingWindowIndex: 1, status: "review", decision: "review", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: "old-window-d", watchSessionId: "session-old-b", sourceType: "live_recording_window", streamerId: "streamer-single", recordingWindowIndex: 2, status: "review", decision: "review", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      ]
    };

    fs.writeFileSync(stateFile, JSON.stringify(seededState));

    let handleRequest;
    let shutdownRuntime;
    let sessionId = "";
    t.after(async () => {
      if (handleRequest) {
        const targetId = sessionId || "session-old-a";
        await invoke(handleRequest, { method: "POST", url: `/api/watch-sessions/${encodeURIComponent(targetId)}/stop`, body: "{}" }).catch(() => {});
      }
      await shutdownRuntime?.();
      global.fetch = originalFetch;
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
          continue;
        }
        process.env[key] = value;
      }
      fs.rmSync(dataDir, { recursive: true, force: true });
    });

    const serverUrl = pathToFileURL(path.join(process.cwd(), "CLIPPING OFFICE ", "server.js"));
    serverUrl.search = `?single-watch-reuse-test=${Date.now()}`;
    ({ handleRequest, shutdownRuntime } = await import(serverUrl.href));

    const reused = await invoke(handleRequest, {
      method: "POST",
      url: "/api/watch-sessions",
      body: JSON.stringify({
        mode: "real",
        streamerId: "streamer-single",
        idempotencyKey: "single-watch-reuse:test"
      })
    });
    assert.equal(reused.status, 201);
    sessionId = JSON.parse(reused.body).session.id;

    const candidates = JSON.parse((await invoke(handleRequest, { method: "GET", url: "/api/clips/candidates" })).body).candidates;
    const stale = candidates.filter((item) => ["session-old-a", "session-old-b"].includes(item.watchSessionId));
  assert.equal(stale.length, 0, "expected stale windows from older sessions to be removed before watch restart");
  });

test("single-watch radar view shows only latest live window candidate per session", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-clipping-radar-single-watch-"));
  const stateFile = path.join(dataDir, "state.json");
  const originalEnv = {
    CLIPPING_OFFICE_DATA_DIR: process.env.CLIPPING_OFFICE_DATA_DIR,
    STREAMCLIPPER_MAX_WATCHED_STREAMERS: process.env.STREAMCLIPPER_MAX_WATCHED_STREAMERS
  };

  process.env.CLIPPING_OFFICE_DATA_DIR = dataDir;
  process.env.STREAMCLIPPER_MAX_WATCHED_STREAMERS = "1";

  const seededState = {
    streamers: [{
      id: "streamer-single-watch-radar",
      displayName: "Radar Watcher",
      platform: "twitch",
      channelId: "radarstream",
      permissionStatus: "approved",
      monitorEnabled: true,
      liveStatus: "live"
    }],
    watchSessions: [{
      id: "radar-session",
      streamerId: "streamer-single-watch-radar",
      status: "watching",
      sourceId: null
    }],
    clipCandidates: [
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `radar-window-${index}`,
        watchSessionId: "radar-session",
        sourceType: "live_recording_window",
        streamerId: "streamer-single-watch-radar",
        recordingWindowIndex: index,
        status: "review",
        decision: "review",
        score: 70,
        createdAt: new Date(Date.now() - (10 - index) * 1000).toISOString(),
        updatedAt: new Date(Date.now() - (10 - index) * 1000).toISOString()
      })),
      {
        id: "vod-window",
        watchSessionId: "radar-session",
        sourceType: "vod",
        streamerId: "streamer-single-watch-radar",
        status: "candidate",
        decision: "review",
        score: 88,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]
  };

  fs.writeFileSync(stateFile, JSON.stringify(seededState));

  let handleRequest;
  let shutdownRuntime;
  let sessionId = "radar-session";
  t.after(async () => {
    if (handleRequest) {
      await invoke(handleRequest, {
        method: "POST",
        url: `/api/watch-sessions/${encodeURIComponent(sessionId)}/stop`,
        body: "{}"
      }).catch(() => {});
    }
    await shutdownRuntime?.();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const serverUrl = pathToFileURL(path.join(process.cwd(), "CLIPPING OFFICE ", "server.js"));
  serverUrl.search = `?single-watch-radar-${Date.now()}`;
  ({ handleRequest, shutdownRuntime } = await import(serverUrl.href));

  const candidates = JSON.parse((await invoke(handleRequest, { method: "GET", url: "/api/clip-candidates" })).body).candidates;
  const liveWindows = candidates.filter((candidate) => candidate.sourceType === "live_recording_window");
  assert.equal(liveWindows.length, 1, "expected single-watch mode to expose only one live radar window candidate");
  assert.equal(liveWindows[0].recordingWindowIndex, 9, "expected the newest live window index to be shown");
  const vods = candidates.filter((candidate) => candidate.sourceType === "vod");
  assert.equal(vods.length, 1, "non-live candidates should remain visible in radar while in single-watch mode");
});

  test("manual capture blocks cleanly when no live recorder is installed", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-clipping-capture-blocked-"));
  const originalEnv = {
    CLIPPING_OFFICE_DATA_DIR: process.env.CLIPPING_OFFICE_DATA_DIR,
    TWITCH_CLIENT_ID: process.env.TWITCH_CLIENT_ID,
    TWITCH_CLIENT_SECRET: process.env.TWITCH_CLIENT_SECRET,
    TWITCH_APP_ACCESS_TOKEN: process.env.TWITCH_APP_ACCESS_TOKEN,
    STREAMCLIPPER_RECORDING_WINDOW_SECONDS: process.env.STREAMCLIPPER_RECORDING_WINDOW_SECONDS,
    STREAMCLIPPER_CAPTURE_ENABLED: process.env.STREAMCLIPPER_CAPTURE_ENABLED,
    STREAMLINK_PATH: process.env.STREAMLINK_PATH,
    YTDLP_PATH: process.env.YTDLP_PATH,
  };
  const originalFetch = global.fetch;

  process.env.CLIPPING_OFFICE_DATA_DIR = dataDir;
  process.env.TWITCH_CLIENT_ID = "mock-client-id";
  process.env.TWITCH_CLIENT_SECRET = "mock-client-secret";
  process.env.TWITCH_APP_ACCESS_TOKEN = "";
  process.env.STREAMCLIPPER_RECORDING_WINDOW_SECONDS = "30";
  process.env.STREAMCLIPPER_CAPTURE_ENABLED = "true";
  process.env.STREAMLINK_PATH = "__missing_streamlink_for_capture_test__";
  process.env.YTDLP_PATH = "__missing_ytdlp_for_capture_test__";

  global.fetch = async (url) => {
    const href = String(url);
    if (href.startsWith("https://id.twitch.tv/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "mock-app-token", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (href.startsWith("https://api.twitch.tv/helix/streams")) {
      return new Response(JSON.stringify({
        data: [{
          id: "mock-stream-cleanup",
          user_id: "9988",
          user_login: "cleanupstream",
          user_name: "CleanupStream",
          title: "Capture should block without a local recorder",
          game_name: "Just Chatting",
          viewer_count: 16210,
          started_at: new Date(Date.now() - 90_000).toISOString(),
          thumbnail_url: "",
        }],
      }), {
        status: 200,
        headers: { "content-type": "application/json", "ratelimit-remaining": "99" },
      });
    }
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  let handleRequest;
  let shutdownRuntime;
  t.after(async () => {
    await shutdownRuntime?.();
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const serverUrl = pathToFileURL(path.join(process.cwd(), "CLIPPING OFFICE ", "server.js"));
  serverUrl.search = `?capture-blocked-test=${Date.now()}`;
  ({ handleRequest, shutdownRuntime } = await import(serverUrl.href));

  const created = await invoke(handleRequest, {
    method: "POST",
    url: "/api/twitch/streamers",
    body: JSON.stringify({
      platform: "twitch",
      displayName: "CleanupStream",
      channelId: "cleanupstream",
      permissionStatus: "approved",
      allowedUse: ["clips"],
      monitorEnabled: true,
    }),
  });
  assert.equal(created.status, 201);
  const streamer = JSON.parse(created.body).streamer;

  const started = await invoke(handleRequest, {
    method: "POST",
    url: "/api/watch-sessions",
    body: JSON.stringify({
      mode: "real",
      streamerId: streamer.id,
      idempotencyKey: `capture-blocked-test:${streamer.id}`,
    }),
  });
  assert.ok([200, 201].includes(started.status));
  const session = JSON.parse(started.body).session;

  const capture = await invoke(handleRequest, {
    method: "POST",
    url: `/api/watch-sessions/${encodeURIComponent(session.id)}/capture`,
    body: "{}",
  });
  assert.equal(capture.status, 200);
  const capturePayload = JSON.parse(capture.body);
  assert.equal(capturePayload.source, null);
  assert.equal(capturePayload.recorder.ready, false);
  assert.match(capturePayload.recorder.message, /streamlink or yt-dlp/);

  const detail = await invoke(handleRequest, { method: "GET", url: `/api/watch-sessions/${encodeURIComponent(session.id)}` });
  assert.equal(detail.status, 200);
  const detailPayload = JSON.parse(detail.body);
  assert.equal(detailPayload.session.captureStatus, "blocked");
  assert.equal(detailPayload.events.some((event) => event.type === "source_capture_blocked"), true);

  for (let index = 0; index < 3; index += 1) {
    const response = await invoke(handleRequest, { method: "GET", url: "/api/clips/candidates" });
    assert.equal(response.status, 200);
    const payload = JSON.parse(response.body);
    assert.equal(payload.candidates.some((item) => item.watchSessionId === session.id), false);
  }

  await invoke(handleRequest, {
    method: "POST",
    url: `/api/watch-sessions/${encodeURIComponent(session.id)}/stop`,
    body: "{}",
  });
});

test("Human Gate approval starts monitoring and holds watch windows until saved media exists", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-clipping-gate-watch-"));
  const originalEnv = {
    CLIPPING_OFFICE_DATA_DIR: process.env.CLIPPING_OFFICE_DATA_DIR,
    TWITCH_CLIENT_ID: process.env.TWITCH_CLIENT_ID,
    TWITCH_CLIENT_SECRET: process.env.TWITCH_CLIENT_SECRET,
    TWITCH_APP_ACCESS_TOKEN: process.env.TWITCH_APP_ACCESS_TOKEN,
    STREAMCLIPPER_RECORDING_WINDOW_SECONDS: process.env.STREAMCLIPPER_RECORDING_WINDOW_SECONDS,
    STREAMCLIPPER_CAPTURE_ENABLED: process.env.STREAMCLIPPER_CAPTURE_ENABLED,
  };
  const originalFetch = global.fetch;

  process.env.CLIPPING_OFFICE_DATA_DIR = dataDir;
  process.env.TWITCH_CLIENT_ID = "mock-client-id";
  process.env.TWITCH_CLIENT_SECRET = "mock-client-secret";
  process.env.TWITCH_APP_ACCESS_TOKEN = "";
  process.env.STREAMCLIPPER_RECORDING_WINDOW_SECONDS = "30";
  process.env.STREAMCLIPPER_CAPTURE_ENABLED = "false";

  global.fetch = async (url) => {
    const href = String(url);
    if (href.startsWith("https://id.twitch.tv/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "mock-app-token", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (href.startsWith("https://api.twitch.tv/helix/streams")) {
      return new Response(JSON.stringify({
        data: [{
          id: "mock-stream-2",
          user_id: "67890",
          user_login: "gatelive",
          user_name: "GateLive",
          title: "Live reaction window for approval test",
          game_name: "Just Chatting",
          viewer_count: 19333,
          started_at: new Date(Date.now() - 60_000).toISOString(),
          thumbnail_url: "",
        }],
      }), {
        status: 200,
        headers: { "content-type": "application/json", "ratelimit-remaining": "99" },
      });
    }
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  let handleRequest;
  let shutdownRuntime;
  let sessionId = "";
  t.after(async () => {
    if (handleRequest && sessionId) {
      await invoke(handleRequest, {
        method: "POST",
        url: `/api/watch-sessions/${encodeURIComponent(sessionId)}/stop`,
        body: "{}",
      }).catch(() => {});
    }
    await shutdownRuntime?.();
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const serverUrl = pathToFileURL(path.join(process.cwd(), "CLIPPING OFFICE ", "server.js"));
  serverUrl.search = `?gate-watch-test=${Date.now()}`;
  ({ handleRequest, shutdownRuntime } = await import(serverUrl.href));

  const created = await invoke(handleRequest, {
    method: "POST",
    url: "/api/twitch/streamers",
    body: JSON.stringify({
      platform: "twitch",
      displayName: "GateLive",
      channelId: "gatelive",
      permissionStatus: "pending",
      monitorEnabled: false,
      liveStatus: "live",
      allowedUse: ["clips", "edits"],
    }),
  });
  assert.equal(created.status, 201);
  const streamer = JSON.parse(created.body).streamer;
  assert.equal(streamer.monitorEnabled, false);

  const approvals = await invoke(handleRequest, { method: "GET", url: "/api/human-gate/approvals" });
  assert.equal(approvals.status, 200);
  const approval = JSON.parse(approvals.body).approvals.find((item) => item.linkedId === streamer.id);
  assert.equal(approval.type, "streamer_permission");

  const approved = await invoke(handleRequest, {
    method: "POST",
    url: "/api/human-gate/approve",
    body: JSON.stringify({ id: approval.id }),
  });
  assert.equal(approved.status, 200);
  const approvedPayload = JSON.parse(approved.body);
  assert.ok(approvedPayload.watchSession, "expected Human Gate approval to start a watch session");
  sessionId = approvedPayload.watchSession.id;

  const streamers = await invoke(handleRequest, { method: "GET", url: "/api/twitch/streamers" });
  const updatedStreamer = JSON.parse(streamers.body).streamers.find((item) => item.id === streamer.id);
  assert.equal(updatedStreamer.permissionStatus, "approved");
  assert.equal(updatedStreamer.monitorEnabled, true);

  const detailPayload = await poll(async () => {
    const response = await invoke(handleRequest, { method: "GET", url: `/api/watch-sessions/${encodeURIComponent(sessionId)}` });
    assert.equal(response.status, 200);
    const payload = JSON.parse(response.body);
    return payload.session.recordingWindows?.length ? payload : null;
  });

  assert.ok(detailPayload, "expected 30-second watch-window telemetry after Human Gate approval");
  assert.equal(detailPayload.session.recordingWindows[0].durationSeconds, 30);
  assert.equal(detailPayload.session.recordingWindows[0].status, "awaiting_source");
  assert.equal(detailPayload.events.some((event) => event.type === "recording_window_waiting_for_source"), true);

  const candidates = await invoke(handleRequest, { method: "GET", url: "/api/clips/candidates" });
  assert.equal(candidates.status, 200);
  assert.equal(JSON.parse(candidates.body).candidates.some((item) => item.watchSessionId === sessionId), false);
});

test("clip candidates hides live watch windows from inactive watch sessions", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-clipping-gate-stale-filter-"));
  const stateFile = path.join(dataDir, "state.json");
  const originalEnv = {
    CLIPPING_OFFICE_DATA_DIR: process.env.CLIPPING_OFFICE_DATA_DIR,
    STREAMCLIPPER_RECORDING_WINDOW_SECONDS: process.env.STREAMCLIPPER_RECORDING_WINDOW_SECONDS
  };

  process.env.CLIPPING_OFFICE_DATA_DIR = dataDir;
  process.env.STREAMCLIPPER_RECORDING_WINDOW_SECONDS = "30";
  const playableFixturePath = path.join(dataDir, "playable.mp4");
  const durableOutputPath = path.join(dataDir, "product-ready.mp4");
  const missingFixturePath = path.join(dataDir, "missing-source.mp4");
  fs.writeFileSync(playableFixturePath, Buffer.from("playable fixture"));
  fs.writeFileSync(durableOutputPath, Buffer.from("durable output fixture"));

  const seededState = {
    streamers: [{
      id: "streamer-stale",
      platform: "twitch",
      displayName: "Stale Streamer",
      channelId: "stalestram",
      permissionStatus: "pending",
      allowedUse: ["clips", "edits"],
      monitorEnabled: false,
      liveStatus: "live"
    }],
    watchSessions: [
      { id: "stale-session-a", streamerId: "streamer-stale", status: "stream_ended", candidateIds: ["stale-window-1", "stale-window-2"] },
      { id: "stale-session-b", streamerId: "streamer-stale", status: "stream_ended", candidateIds: ["stale-window-3"] }
    ],
    clipCandidates: [
      { id: "stale-window-1", watchSessionId: "stale-session-a", sourceType: "live_recording_window", streamerId: "streamer-stale", recordingWindowIndex: 0, status: "review", decision: "review", title: "Window 1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "stale-window-2", watchSessionId: "stale-session-a", sourceType: "live_recording_window", streamerId: "streamer-stale", recordingWindowIndex: 1, status: "review", decision: "review", title: "Window 2", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "stale-window-3", watchSessionId: "stale-session-b", sourceType: "live_recording_window", streamerId: "streamer-stale", recordingWindowIndex: 0, status: "review", decision: "review", title: "Window 3", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "stale-studio", watchSessionId: "stale-session-a", sourceType: "live_recording_window", sourceId: "vod-source", mediaPlayable: true, streamerId: "streamer-stale", status: "in_builder", builderDraft: { status: "saved" }, title: "Studio clip", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "stale-precheck", watchSessionId: "stale-session-a", sourceType: "live_recording_window", sourceId: "vod-source", mediaPlayable: true, streamerId: "streamer-stale", status: "precheck", productionWorkflow: { stage: "precheck" }, title: "Precheck clip", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "stale-ready", watchSessionId: "stale-session-b", sourceType: "live_recording_window", sourceId: "missing-source", mediaPlayable: true, streamerId: "streamer-stale", status: "product_ready", productionWorkflow: { stage: "product_ready", localLibraryPath: durableOutputPath }, title: "Product Ready clip", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "orphan-studio", watchSessionId: "stale-session-b", sourceType: "live_recording_window", sourceId: "missing-source", mediaPlayable: true, streamerId: "streamer-stale", status: "in_builder", builderDraft: { status: "saved" }, title: "Missing Studio source", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      {
        id: "playable-window",
        watchSessionId: "active-session",
        sourceType: "vod",
        sourceId: "vod-source",
        streamerId: "streamer-stale",
        status: "candidate",
        decision: "review",
        decisionReason: "Manual source",
        title: "Playable VOD",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ],
    mediaSources: [{
      id: "vod-source",
      sourceType: "upload",
      streamerId: "streamer-stale",
      filePath: playableFixturePath,
      playable: true,
      playbackUrl: `file://${playableFixturePath}`,
      duration: 30,
      durationSeconds: 30,
      width: 1920,
      height: 1080,
      mimeType: "video/mp4",
      permissionStatus: "approved",
      watchSessionId: "active-session",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, {
      id: "missing-source",
      sourceType: "upload",
      streamerId: "streamer-stale",
      filePath: missingFixturePath,
      playable: true,
      playbackUrl: `file://${missingFixturePath}`,
      duration: 30,
      durationSeconds: 30,
      width: 1920,
      height: 1080,
      mimeType: "video/mp4",
      permissionStatus: "approved",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }]
  };
  fs.writeFileSync(stateFile, JSON.stringify(seededState));

  let handleRequest;
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
  serverUrl.search = `?gate-stale-filter-${Date.now()}`;
  ({ handleRequest, shutdownRuntime } = await import(serverUrl.href));

  const candidates = JSON.parse((await invoke(handleRequest, { method: "GET", url: "/api/clip-candidates" })).body).candidates;
  const staleCandidates = candidates.filter((candidate) => ["stale-window-1", "stale-window-2", "stale-window-3"].includes(candidate.id));
  const productionCandidates = candidates.filter((candidate) => ["stale-studio", "stale-precheck", "stale-ready"].includes(candidate.id));
  const playableCandidates = candidates.filter((candidate) => candidate.id === "playable-window");
  const orphanedStudio = candidates.find((candidate) => candidate.id === "orphan-studio");
  assert.equal(staleCandidates.length, 0, "expected stale live windows to be hidden when no active watch session exists");
  assert.equal(productionCandidates.length, 3, "expected Studio, Precheck, and Product Ready clips to survive the end of their watch session");
  assert.equal(productionCandidates.find((candidate) => candidate.id === "stale-ready")?.status, "product_ready", "expected a finished local output to survive when its original source is gone");
  assert.equal(playableCandidates.length, 1, "expected non-live candidate to stay visible while no stream watch is active");
  assert.equal(orphanedStudio?.status, "rejected", "expected a Studio record without a real source to leave the active queue");
  assert.equal(orphanedStudio?.sourceIntegrity?.status, "missing");

  const automation = JSON.parse((await invoke(handleRequest, { method: "GET", url: "/api/automation" })).body).automation;
  assert.equal(automation.sourceIntegrity.missingProductionSources, 1);
  assert.match(automation.sourceIntegrity.detail, /source MP4 files are missing/);
});

test("a repaired historical missing source does not return as an active warning after restart", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-clipping-source-repair-restart-"));
  const stateFile = path.join(dataDir, "state.json");
  const originalDataDir = process.env.CLIPPING_OFFICE_DATA_DIR;
  process.env.CLIPPING_OFFICE_DATA_DIR = dataDir;
  fs.writeFileSync(stateFile, JSON.stringify({
    clipCandidates: [{
      id: "historical-missing-studio-source",
      sourceType: "live_recording_window",
      sourceId: "gone-source",
      status: "rejected",
      decision: "rejected",
      builderApproved: true,
      builderStatus: "approved",
      builderDraft: { status: "saved" },
      sourceIntegrity: { status: "missing", checkedAt: new Date().toISOString() }
    }],
    automation: {
      sourceIntegrity: {
        status: "attention",
        missingProductionSources: 41,
        detail: "41 older Studio records were excluded because their source MP4 files are missing."
      }
    }
  }));
  let shutdownRuntime;
  t.after(async () => {
    await shutdownRuntime?.();
    if (originalDataDir === undefined) delete process.env.CLIPPING_OFFICE_DATA_DIR;
    else process.env.CLIPPING_OFFICE_DATA_DIR = originalDataDir;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const serverUrl = pathToFileURL(path.join(process.cwd(), "CLIPPING OFFICE ", "server.js"));
  serverUrl.search = `?source-repair-restart-${Date.now()}`;
  const clippingRuntime = await import(serverUrl.href);
  const restartedHandleRequest = clippingRuntime.handleRequest;
  shutdownRuntime = clippingRuntime.shutdownRuntime;
  const automation = JSON.parse((await invoke(restartedHandleRequest, { method: "GET", url: "/api/automation" })).body).automation;
  assert.equal(automation.sourceIntegrity.missingProductionSources, 0);
  assert.match(automation.sourceIntegrity.detail, /Every active Studio record has a playable local source/);
});

test("clip meter is live quality, not approval percentage", () => {
  const appSource = fs.readFileSync(path.join(process.cwd(), "CLIPPING OFFICE ", "public", "app.js"), "utf8");
  const cssSource = fs.readFileSync(path.join(process.cwd(), "CLIPPING OFFICE ", "public", "styles.css"), "utf8");
  assert.match(appSource, /function signalScore/);
  assert.match(appSource, /function renderSignalMeter/);
  assert.match(appSource, /style="--score:\$\{score\}%"/);
  assert.match(cssSource, /\.signal-meter/);
  assert.match(cssSource, /#ef4444, #f59e0b 45%, #22c55e/);
});

test("streamer watch sessions and saved clips stay in separate UI collections", () => {
  const appSource = fs.readFileSync(path.join(process.cwd(), "CLIPPING OFFICE ", "public", "app.js"), "utf8");
  assert.match(appSource, /state\.watch\.sessions/);
  assert.match(appSource, /state\.clips/);
  assert.match(appSource, /function currentClips/);
  assert.doesNotMatch(appSource, /streamer_permission.*30s clip/s);
});

test.skip("legacy pre-rebuild Clip Radar and Builder UI contract", () => {
  const appSource = fs.readFileSync(path.join(process.cwd(), "CLIPPING OFFICE ", "public", "app.js"), "utf8");
  const cssSource = fs.readFileSync(path.join(process.cwd(), "CLIPPING OFFICE ", "public", "styles.css"), "utf8");
  const serverSource = fs.readFileSync(path.join(process.cwd(), "CLIPPING OFFICE ", "server.js"), "utf8");
  assert.match(appSource, /function candidatePlaybackState/);
  assert.match(appSource, /function candidateIsRadarReady/);
  const radarReadySource = appSource.match(/function candidateIsRadarReady\(candidate\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(radarReadySource, /if \(!candidate\) return false/);
  assert.match(radarReadySource, /if \(isPracticeCandidate\(candidate\)\) return false/);
  assert.match(appSource, /function isPracticeSource/);
  const candidateSource = appSource.match(/function candidateSource\(candidate\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(candidateSource, /return isPracticeSource\(source\) \? null : source/);
  assert.match(appSource, /function realCandidates/);
  assert.match(appSource, /candidateIsRadarReady\(candidate\)/);
  assert.match(appSource, /radarCandidateScope\(\)\.visibleCandidates\.length/);
  const radarScopeSource = appSource.match(/function radarCandidateScope\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(radarScopeSource, /const visibleCandidates = real\.filter/);
  assert.match(radarScopeSource, /candidate\?\.sourceType !== "live_recording_window"/);
  assert.doesNotMatch(radarScopeSource, /visibleCandidates = showingPractice \? practice : real/);
  const selectedCandidateSource = appSource.match(/function selectedCandidate\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(selectedCandidateSource, /!isPracticeCandidate\(selected\)/);
  assert.doesNotMatch(selectedCandidateSource, /practiceCandidates\(\)/);
  const radarRenderSource = appSource.match(/function renderRadar\(\) \{[\s\S]*?function pendingWatchWindows/)?.[0] || "";
  assert.doesNotMatch(radarRenderSource, /Practice candidates are visible/);
  assert.doesNotMatch(radarRenderSource, /start a Practice Project/);
  assert.match(appSource, /function renderRadarCaptureStatus/);
  assert.match(appSource, /function pendingWatchWindows/);
  assert.match(appSource, /data-capture-session/);
  assert.match(appSource, /async function captureWatchSession/);
  assert.match(appSource, /No saved clip file yet/);
  assert.match(appSource, /Capture or upload source media before this becomes a Builder clip/);
  assert.match(appSource, /playback\.playable/);
  assert.match(appSource, /Capture 30s Now/);
  assert.match(appSource, /function candidateInBuilder/);
  assert.match(appSource, /candidate\?\.status === "in_builder"/);
  assert.match(appSource, /playback\.playable \? "Play" : "Details"/);
  assert.match(appSource, /data-builder-candidate/);
  assert.match(appSource, /Send to Builder/);
  assert.match(appSource, /async function sendCandidateToBuilder/);
  assert.match(appSource, /if \(!playback\.playable\)/);
  assert.match(appSource, /await captureWatchSession\(session\.id\)/);
  assert.match(appSource, /function builderCandidateList/);
  assert.match(appSource, /function builderActiveSource/);
  assert.match(appSource, /function renderBuilderCanvas/);
  assert.match(appSource, /function renderBuilderTimeline/);
  assert.match(appSource, /function renderBuilderInspector/);
  assert.match(appSource, /function renderBuilderTopbar/);
  assert.match(appSource, /function renderBuilderToolRail/);
  assert.match(appSource, /function renderBuilderToolDrawer/);
  assert.match(appSource, /function runBuilderCommand/);
  assert.match(appSource, /function saveBuilderEditState/);
  assert.match(appSource, /function syncBuilderEditStateToProject/);
  assert.match(appSource, /function applyBuilderPreset/);
  assert.match(appSource, /builder-v2-shell/);
  assert.match(appSource, /builder-tool-rail/);
  assert.match(appSource, /builder-tool-drawer/);
  assert.match(appSource, /builder-inspector-tabs/);
  assert.match(appSource, /builder-multitrack-timeline/);
  assert.match(appSource, /builder-canvas-video/);
  assert.match(appSource, /builder-clip-block/);
  assert.match(appSource, /data-builder-tool/);
  assert.match(appSource, /data-builder-setting/);
  assert.match(appSource, /data-builder-command/);
  assert.doesNotMatch(appSource, /\$\{renderMediaUploadPanel\(/);
  assert.doesNotMatch(appSource, /\$\{renderStudioTransport\(/);
  assert.doesNotMatch(appSource, /\$\{renderStudioCandidateRail\(/);
  assert.doesNotMatch(appSource, /\$\{renderStudioAssetDock\(/);
  assert.doesNotMatch(appSource, /\$\{renderSourceTruth\(/);
  assert.match(appSource, /function renderSourcePendingPreview/);
  assert.match(appSource, /function renderPreviewTransport/);
  assert.match(appSource, /function scoreEvidence/);
  assert.match(appSource, /function hookEvidence/);
  assert.match(appSource, /function chatEvidence/);
  assert.match(appSource, /function metricCard/);
  assert.match(appSource, /function formatClock/);
  assert.match(appSource, /function candidateWindowRangeLabel/);
  assert.match(appSource, /function builderQueueCandidates/);
  const builderQueueSource = appSource.match(/function builderQueueCandidates\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(builderQueueSource, /!isPracticeCandidate\(candidate\)/);
  assert.match(builderQueueSource, /!isPracticeCandidate\(selected\)/);
  assert.match(builderQueueSource, /candidateInBuilder\(candidate\)/);
  assert.doesNotMatch(builderQueueSource, /candidate\.sourceId/);
  const builderListSource = appSource.match(/function builderCandidateList\(studio = \{\}\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(builderListSource, /!isPracticeCandidate\(candidate\)/);
  assert.match(builderListSource, /!isPracticeCandidate\(selected\)/);
  assert.match(builderListSource, /candidateInBuilder\(candidate\)/);
  assert.match(builderListSource, /candidateInBuilder\(selected\)/);
  assert.doesNotMatch(builderListSource, /candidate\.sourceId/);
  const builderActiveSource = appSource.match(/function builderActiveSource\(source, candidate\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(builderActiveSource, /const safeSource = isPracticeSource\(source\) \? null : source/);
  const studioThumbSource = appSource.match(/function studioCandidateThumb\(candidate, index = 0\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(studioThumbSource, /media_demo_clipping_source/);
  assert.match(appSource, /data-window-duration/);
  assert.match(appSource, /count: "builder"/);
  assert.match(appSource, /Builder Queue/);
  assert.match(appSource, /loading="lazy"/);
  assert.match(appSource, /review-command-head/);
  assert.match(appSource, /review-next-button/);
  assert.match(appSource, /data-open-streamer-source/);
  assert.match(appSource, /No transcript has been extracted from this live-source window yet/);
  assert.match(appSource, /data-delete-candidate/);
  assert.match(appSource, /data-candidate-check-all/);
  assert.match(appSource, /data-candidate-check/);
  assert.match(appSource, /function renderRadarSelectionBar/);
  assert.match(appSource, /function renderBulkCandidateInspector/);
  assert.match(appSource, /delete-selected-candidates/);
  assert.match(appSource, /select-visible-candidates/);
  assert.match(appSource, /clear-selected-candidates/);
  assert.match(appSource, /delete-selected-candidates/);
  assert.match(appSource, /delete-visible-candidates/);
  assert.match(appSource, /radarEvidenceLabel/);
  assert.match(appSource, /const stopWatcher = Boolean\(options\.stopWatcher\)/);
  assert.match(appSource, /const stopWatchers = Boolean\(options\.stopWatchers\)/);
  assert.match(appSource, /async function bulkDeleteCandidates/);
  assert.match(appSource, /async function deleteCandidate/);
  assert.match(appSource, /function candidateNeedsWatcherCleanup/);
  assert.match(appSource, /function formControlHasFocus/);
  assert.match(appSource, /data-scout-platform/);
  assert.match(appSource, /localStorage\.setItem\("scoutPlatform"/);
  assert.match(appSource, /if \(formControlHasFocus\(\)\) return/);
  assert.match(appSource, /method: "DELETE"/);
  assert.doesNotMatch(appSource, /function twitchPlayerEmbedUrl/);
  assert.doesNotMatch(appSource, /function updateVideoClock/);
  assert.doesNotMatch(appSource, /Live preview, not recorded playback/);
  assert.doesNotMatch(appSource, /data-video-time-label/);
  assert.doesNotMatch(appSource, /data-video-progress/);
  assert.doesNotMatch(appSource, /Open builder/);
  assert.doesNotMatch(radarRenderSource, /Open source/);
  assert.doesNotMatch(appSource, /Draft package target/);
  assert.doesNotMatch(appSource, /Send the keeper to Builder/);
  assert.match(cssSource, /\.source-pending-preview/);
  assert.match(cssSource, /\.source-live-image\.muted/);
  assert.match(cssSource, /\.source-empty-frame/);
  assert.match(cssSource, /\.radar-capture-status/);
  assert.match(cssSource, /\.source-status-pill/);
  assert.doesNotMatch(cssSource, /\.video-clock-transport/);
  assert.match(cssSource, /\.window-clock/);
  assert.match(cssSource, /\.radar-command-bar/);
  assert.match(cssSource, /\.radar-evidence-cell/);
  assert.match(cssSource, /\.topbar\.radar-focus #api-status/);
  assert.match(cssSource, /\.builder-queue-summary/);
  assert.match(cssSource, /\.builder-stage-facts/);
  assert.match(cssSource, /\.builder-editor-shell/);
  assert.match(cssSource, /\.builder-v2-shell/);
  assert.match(cssSource, /\.builder-topbar/);
  assert.match(cssSource, /\.builder-tool-rail/);
  assert.match(cssSource, /\.builder-tool-drawer/);
  assert.match(cssSource, /\.builder-preview-stage/);
  assert.match(cssSource, /\.builder-inspector-tabs/);
  assert.match(cssSource, /\.builder-multitrack-timeline/);
  assert.match(cssSource, /\.builder-track-row/);
  assert.match(cssSource, /\.builder-layer-block/);
  assert.match(cssSource, /\.builder-export-presets/);
  assert.match(cssSource, /\.builder-canvas-video/);
  assert.match(cssSource, /\.builder-timeline/);
  assert.match(cssSource, /\.builder-clip-block/);
  assert.match(cssSource, /\.builder-side-panel/);
  assert.match(cssSource, /\.studio-rail-overflow/);
  assert.match(cssSource, /\.review-next-button/);
  assert.match(cssSource, /\.radar-inspector \.inspector-section/);
  assert.match(cssSource, /\.builder-pending-stage/);
  assert.match(cssSource, /\.pending-source-summary/);
  assert.match(cssSource, /\.radar-selection-bar/);
  assert.match(cssSource, /\.selection-actions \.danger\.strong/);
  assert.match(cssSource, /\.bulk-inspector/);
  assert.match(cssSource, /\.radar-thumb\.is-source-pending/);
  assert.doesNotMatch(cssSource, /repeating-linear-gradient\(90deg, rgba\(125, 211, 252, 0\.07\)/);
  assert.match(serverSource, /watchBufferDir/);
  assert.match(serverSource, /DEFAULT_CLIP_SAVE_DIR/);
  assert.match(serverSource, /path\.join\(__dirname, "Clips"\)/);
  assert.match(serverSource, /captureEnabled/);
  assert.match(serverSource, /sanitizeClipEditorState/);
  assert.match(serverSource, /editorState/);
  assert.match(serverSource, /async function liveRecorderStatus/);
  assert.match(serverSource, /async function captureLiveWindowForSession/);
  assert.match(serverSource, /async function maybeCaptureCurrentWatchWindow/);
  assert.match(serverSource, /async function resolveLivePlaybackUrl/);
  assert.match(serverSource, /async function recordRemoteStreamToFile/);
  assert.match(serverSource, /function migrateMetadataOnlyRecordingWindowsOutOfRadar/);
  assert.match(serverSource, /metadata_windows_migrated/);
  assert.match(serverSource, /recording_window_waiting_for_source/);
  assert.match(serverSource, /source_capture_started/);
  assert.match(serverSource, /source_capture_completed/);
  assert.match(serverSource, /source_capture_blocked/);
  assert.match(serverSource, /scoreEvidence/);
  assert.match(serverSource, /local_heuristic/);
  assert.match(serverSource, /source: PROVENANCE\.UNAVAILABLE/);
  assert.match(serverSource, /action === "capture"/);
  assert.match(serverSource, /Install streamlink or yt-dlp/);
  assert.match(serverSource, /Local video buffer saved and verified/);
  assert.match(serverSource, /\/api\/clip-candidates\/bulk-delete/);
  assert.match(serverSource, /candidate_bulk_delete/);
  assert.match(serverSource, /candidate\.status = "in_builder"/);
  assert.match(serverSource, /candidate\.movedToBuilderAt = now\(\)/);
  assert.match(serverSource, /async function stopOfflineWatchSessionsForStreamer/);
  assert.match(serverSource, /watch_stopped_offline/);
  assert.match(serverSource, /function deletedRecordingWindowIndexSet/);
  assert.match(serverSource, /function rememberDeletedRecordingWindow/);
  assert.match(serverSource, /async function stopWatchSessionAfterCandidateCleanup/);
  assert.match(serverSource, /deletedIndexes\.has\(index\)/);
  assert.match(serverSource, /function targetRecordingWindowIndexes/);
  assert.match(serverSource, /async function ensureActiveWatchSessionCandidateCoverage/);
  assert.match(serverSource, /candidate_coverage_repaired/);
  assert.match(serverSource, /stopWatchers/);
  assert.doesNotMatch(serverSource, /ensureActiveWatchSessionCandidateCoverage\("operator_bulk_delete"\)/);
});

test("current clip list never presents source-pending metadata as playable video", () => {
  const appSource = fs.readFileSync(path.join(process.cwd(), "CLIPPING OFFICE ", "public", "app.js"), "utf8");
  const serverSource = fs.readFileSync(path.join(process.cwd(), "CLIPPING OFFICE ", "server.js"), "utf8");
  const playbackSource = appSource.match(/function clipPlaybackUrl\(clip = \{\}\) \{[\s\S]*?\n\}/)?.[0] || "";
  const renderSource = appSource.match(/function renderClipItem\(clip\) \{[\s\S]*?\n\}/)?.[0] || "";

  assert.match(playbackSource, /clip\.mediaPlayable && clip\.sourceId/);
  assert.match(renderSource, /playback \? `<a/);
  assert.match(renderSource, /disabled>Pending/);
  assert.match(renderSource, /playback \? `<button type="button" data-approve-clip/);
  assert.match(serverSource, /WATCH_STAGING_DIR/);
  assert.match(serverSource, /mediaSourceForWatchWindow/);
  assert.match(serverSource, /recentDuplicateCapturedSource/);
  assert.match(serverSource, /discardAutomaticCapture/);
});

test("one-page office exposes a verified refresh control", () => {
  const appSource = fs.readFileSync(path.join(process.cwd(), "CLIPPING OFFICE ", "public", "app.js"), "utf8");
  assert.match(appSource, /data-refresh-office/);
  assert.match(appSource, /async function refreshOffice/);
  assert.match(appSource, /await refreshWatchState\(\)/);
  assert.match(appSource, /Office refreshed and verified/);
});

test("automatic editor caption message includes the transcript and is sent to the caption API", () => {
  const appSource = fs.readFileSync(path.join(process.cwd(), "CLIPPING OFFICE ", "public", "app.js"), "utf8");
  const serverSource = fs.readFileSync(path.join(process.cwd(), "CLIPPING OFFICE ", "server.js"), "utf8");
  assert.match(appSource, /FULL TRANSCRIPT:/);
  assert.match(appSource, /automaticCaptionRequest:\s*automaticCaptionRequestText\(clip\)/);
  assert.match(serverSource, /const automaticCaptionRequest = String\(body\.automaticCaptionRequest/);
  assert.match(serverSource, /generateEditorialCaptionForCandidate\(candidate, transcript, \{\s*automaticCaptionRequest/);
  assert.match(serverSource, /generateEditorialCaptionForCandidate\(candidate, transcript, \{/);
});

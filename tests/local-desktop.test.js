const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const test = require("node:test");

const localDatabase = require("../services/local-database");
const localRuntime = require("../services/local-runtime");
const { REQUIRED_EQUITY_TOOLS, ROBINHOOD_MCP_URL } = require("../services/stock-broker-control");
const { isVerifiedClipPlaybackUrl } = require("../desktop/clip-output");
const { isSafeExternalWebUrl, isTrustedRobinhoodOAuthUrl } = require("../desktop/external-navigation");
const { resolveLocalRouteUrl } = require("../desktop/local-navigation");

test("Electron opens only a fully bound Robinhood OAuth request through the desktop bridge", () => {
  const oauth = new URL("https://robinhood.com/oauth");
  oauth.searchParams.set("response_type", "code");
  oauth.searchParams.set("client_id", "argentum-client");
  oauth.searchParams.set("redirect_uri", "http://127.0.0.1:5173/api/stock-office/robinhood/oauth/callback");
  oauth.searchParams.set("scope", "internal");
  oauth.searchParams.set("resource", ROBINHOOD_MCP_URL);
  oauth.searchParams.set("state", "random-state");
  oauth.searchParams.set("code_challenge", "pkce-challenge");
  oauth.searchParams.set("code_challenge_method", "S256");

  assert.equal(isTrustedRobinhoodOAuthUrl(oauth.toString()), true);
  oauth.searchParams.set("redirect_uri", "https://evil.example/callback");
  assert.equal(isTrustedRobinhoodOAuthUrl(oauth.toString()), false);
  assert.equal(isTrustedRobinhoodOAuthUrl("https://robinhood.com.evil.example/oauth"), false);
  assert.equal(isSafeExternalWebUrl("https://robinhood.com/login"), true);
  assert.equal(isSafeExternalWebUrl("file:///tmp/credential"), false);

  const mainSource = fs.readFileSync(path.join(__dirname, "..", "desktop", "main.js"), "utf8");
  const preloadSource = fs.readFileSync(path.join(__dirname, "..", "desktop", "preload.js"), "utf8");
  assert.match(mainSource, /will-navigate/);
  assert.match(mainSource, /setWindowOpenHandler/);
  assert.match(mainSource, /argentum:open-robinhood-oauth/);
  assert.match(preloadSource, /openRobinhoodOAuth/);
});

test("Electron recovery preserves the current Clipping Office route", () => {
  assert.equal(
    resolveLocalRouteUrl("http://127.0.0.1:5173", "http://127.0.0.1:5173/apps/clipping-office/?clip=123#editor"),
    "http://127.0.0.1:5173/apps/clipping-office/?clip=123#editor"
  );
  assert.equal(
    resolveLocalRouteUrl("http://127.0.0.1:5180", "http://127.0.0.1:5173/apps/clipping-office/"),
    "http://127.0.0.1:5180/apps/clipping-office/"
  );
  assert.equal(
    resolveLocalRouteUrl("http://127.0.0.1:5173", "https://example.com/apps/clipping-office/"),
    "http://127.0.0.1:5173/"
  );
});

test("Argentum OS app launches into the main agent office", () => {
  const mainSource = fs.readFileSync(path.join(__dirname, "..", "desktop", "main.js"), "utf8");
  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const clippingIndexSource = fs.readFileSync(path.join(__dirname, "..", "CLIPPING OFFICE ", "public", "index.html"), "utf8");

  assert.match(mainSource, /loadMainWindow\(0, appUrl\(\)\)/);
  assert.match(mainSource, /app\.on\("second-instance", \(_event, argv = \[\]\) => \{[\s\S]*?loadMainWindow\(0, appUrl\(\)\)/);
  assert.match(mainSource, /app\.on\("activate", \(\) => \{[\s\S]*?loadMainWindow\(0, appUrl\(\)\)/);
  assert.match(indexSource, /class="clips-office-view-app" href="\/apps\/clipping-office\/"/);
  assert.match(clippingIndexSource, /class="product-main-office" href="\/" data-main-office-link/);
});

test("packaged Clipping Office writes runtime clips outside the app bundle", () => {
  const clippingServerSource = fs.readFileSync(path.join(__dirname, "..", "CLIPPING OFFICE ", "server.js"), "utf8");

  assert.match(clippingServerSource, /const DEFAULT_CLIP_SAVE_DIR = path\.join\(RUNTIME_DIR, "Clips"\)/);
  assert.doesNotMatch(clippingServerSource, /path\.join\(__dirname, "Clips"\)/);
});

test("packaged Clipping Office runs native media tools from asar.unpacked", () => {
  const clippingServerSource = fs.readFileSync(path.join(__dirname, "..", "CLIPPING OFFICE ", "server.js"), "utf8");

  assert.match(clippingServerSource, /function nativeExecutablePath/);
  assert.match(clippingServerSource, /requested\.replace\("\.asar\/", "\.asar\.unpacked\/"\)/);
  assert.match(clippingServerSource, /existsSync\(unpacked\) \? unpacked : requested/);
  assert.match(clippingServerSource, /nativeExecutablePath\(process\.env\.FFMPEG_PATH \|\| ffmpegStatic \|\| "ffmpeg"\)/);
  assert.match(clippingServerSource, /configuredFfprobeExecutable = process\.env\.FFPROBE_PATH/);
  assert.match(clippingServerSource, /requireNativeMacArm64: true/);
});

test("bundled FFmpeg executes as native Apple Silicon", {
  skip: process.platform !== "darwin" || process.arch !== "arm64"
}, () => {
  const ffmpegPath = require("ffmpeg-static");
  const version = execFileSync("/usr/bin/arch", ["-arm64", ffmpegPath, "-version"], { encoding: "utf8" });
  const architecture = execFileSync("/usr/bin/file", ["-b", ffmpegPath], { encoding: "utf8" });

  assert.match(version, /^ffmpeg version /);
  assert.match(architecture, /arm64/);
});

test("Clipping Office status reads do not run media capture inline", () => {
  const clippingServerSource = fs.readFileSync(path.join(__dirname, "..", "CLIPPING OFFICE ", "server.js"), "utf8");
  const activeRoute = clippingServerSource.match(/pathname === "\/api\/watch-sessions\/active"[\s\S]*?\n  \}/)?.[0] || "";
  const radarRoute = clippingServerSource.match(/pathname === "\/api\/clips\/candidates"[\s\S]*?\n  \}/)?.[0] || "";

  assert.doesNotMatch(activeRoute, /ensureActiveWatchSessionCandidateCoverage/);
  assert.doesNotMatch(radarRoute, /ensureActiveWatchSessionCandidateCoverage/);
  assert.match(clippingServerSource, /startWatchWorker\(session\.id\);\s*\}\s*if \(stateChanged\) await saveState\(\)/);
});

test("Clipping Office shutdown drains in-flight recorder work before process cleanup", () => {
  const clippingServerSource = fs.readFileSync(path.join(__dirname, "..", "CLIPPING OFFICE ", "server.js"), "utf8");
  const desktopSource = fs.readFileSync(path.join(__dirname, "..", "desktop", "main.js"), "utf8");

  assert.match(clippingServerSource, /const watchWorkerRuns = new Map\(\)/);
  assert.match(clippingServerSource, /if \(runtimeShuttingDown \|\| watchWorkerBusy\.has\(sessionId\)\) return/);
  assert.match(clippingServerSource, /if \(runtimeShuttingDown\) \{\s*await buffer\.stop\(\{ removeSegments: false \}\)/);
  assert.match(clippingServerSource, /const RUNTIME_SHUTDOWN_DRAIN_TIMEOUT_MS = 3000/);
  assert.match(clippingServerSource, /function closeRuntimeEventClients\(\)/);
  assert.match(clippingServerSource, /const inFlightAutomation = automationCoordinatorPromise/);
  assert.match(clippingServerSource, /const inFlightWatchRuns = \[\.\.\.watchWorkerRuns\.values\(\)\]/);
  assert.match(clippingServerSource, /await Promise\.allSettled\(buffers\.map\(\(buffer\) => buffer\.stop/);
  assert.match(clippingServerSource, /await settleRuntimeShutdownWork\(\[inFlightAutomation, \.\.\.inFlightWatchRuns\]\)/);
  assert.ok(clippingServerSource.indexOf("await Promise.allSettled(buffers.map") < clippingServerSource.indexOf("await settleRuntimeShutdownWork"));
  assert.ok(clippingServerSource.indexOf("await settleRuntimeShutdownWork") < clippingServerSource.indexOf('terminateOrphanedRollingRecorders("runtime_shutdown_final")'));
  assert.match(desktopSource, /activeBackend\.send\?\.\(\{ type: "argentum:shutdown" \}\)/);
  assert.match(desktopSource, /activeBackend\.kill\("SIGKILL"\)/);
  assert.match(desktopSource, /if \(quitInFlight\) return/);
});

test("Clipping Office live providers cannot hold startup open indefinitely", () => {
  const clippingServerSource = fs.readFileSync(path.join(__dirname, "..", "CLIPPING OFFICE ", "server.js"), "utf8");

  assert.match(clippingServerSource, /const PROVIDER_REQUEST_TIMEOUT_MS = 8000/);
  assert.match(clippingServerSource, /async function providerFetch/);
  assert.match(clippingServerSource, /AbortSignal\.timeout\(PROVIDER_REQUEST_TIMEOUT_MS\)/);
  assert.match(clippingServerSource, /providerFetch\(`https:\/\/api\.kick\.com\$\{endpoint\}`/);
  assert.match(clippingServerSource, /providerFetch\(`https:\/\/api\.twitch\.tv\/helix\$\{endpoint\}`/);
});

test("Clipping Office coalesces watcher state writes and keeps Discovery reads off the write queue", () => {
  const clippingServerSource = fs.readFileSync(path.join(__dirname, "..", "CLIPPING OFFICE ", "server.js"), "utf8");
  const twitchStatusRoute = clippingServerSource.match(/pathname === "\/api\/twitch\/status"[\s\S]*?\n  \}/)?.[0] || "";
  const discoveryRoute = clippingServerSource.match(/pathname === "\/api\/streams\/discovery"[\s\S]*?\n  \}/)?.[0] || "";
  const workerStatusRoute = clippingServerSource.match(/pathname === "\/api\/automation\/worker-status"[\s\S]*?return sendJson\(res, 200, \{ automation: publicAutomationState\(\) \}\);/)?.[0] || "";

  assert.match(clippingServerSource, /let saveStateInFlight = null/);
  assert.match(clippingServerSource, /let saveStateRequestedVersion = 0/);
  assert.match(clippingServerSource, /while \(saveStateCommittedVersion < saveStateRequestedVersion\)/);
  assert.match(clippingServerSource, /waiter\.version <= saveStateCommittedVersion/);
  assert.doesNotMatch(clippingServerSource, /let saveStateQueue = Promise\.resolve/);
  assert.doesNotMatch(twitchStatusRoute, /await saveState\(\)/);
  assert.match(discoveryRoute, /addStateLog\("stream_discovery_page"/);
  assert.doesNotMatch(discoveryRoute, /await logEvent\("stream_discovery_page"/);
  assert.match(workerStatusRoute, /scheduleStateSave\(5000\)/);
  assert.doesNotMatch(workerStatusRoute, /await saveState\(\)/);
});

test("a running rolling buffer promotes the watcher to live media status", () => {
  const clippingServerSource = fs.readFileSync(path.join(__dirname, "..", "CLIPPING OFFICE ", "server.js"), "utf8");
  const appSource = fs.readFileSync(path.join(__dirname, "..", "CLIPPING OFFICE ", "public", "app.js"), "utf8");
  const rollingSource = clippingServerSource.match(/async function ensureRollingBufferForSession[\s\S]*?\n\}/)?.[0] || "";
  const memoryLabelSource = appSource.match(/function watchMemoryStatus[\s\S]*?\n\}/)?.[0] || "";

  assert.match(rollingSource, /await buffer\.cleanup\(\)/);
  assert.match(rollingSource, /session\.status = "watching"/);
  assert.match(rollingSource, /session\.currentStage = "Listening to and viewing live media"/);
  assert.match(memoryLabelSource, /memory\.bufferedSeconds/);
  assert.match(memoryLabelSource, /first segment starting/);
});

test("Electron dev reload ignores duplicate filesystem events with unchanged source signatures", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "desktop", "main.js"), "utf8");
  assert.match(source, /const sourceWatchSignatures = new Map\(\)/);
  assert.match(source, /\[\.\.\.watchedDirs, \.\.\.watchedFiles\]\.forEach\(primeSourceWatchSignatures\)/);
  assert.match(source, /sourceWatchSignatures\.get\(resolved\) === nextSignature\) return/);
});

test("Electron exposes a persisted, approved folder for finished clip saves", () => {
  const mainSource = fs.readFileSync(path.join(__dirname, "..", "desktop", "main.js"), "utf8");
  const preloadSource = fs.readFileSync(path.join(__dirname, "..", "desktop", "preload.js"), "utf8");

  assert.match(mainSource, /argentum:get-clip-output-folder/);
  assert.match(mainSource, /argentum:choose-clip-output-folder/);
  assert.match(mainSource, /argentum:save-clip-to-output-folder/);
  assert.match(mainSource, /persistClipOutputFolder/);
  assert.match(mainSource, /isVerifiedClipPlaybackUrl/);
  assert.match(mainSource, /video\\\/mp4/);
  assert.match(mainSource, /\.part/);
  assert.match(preloadSource, /getClipOutputFolder/);
  assert.match(preloadSource, /chooseClipOutputFolder/);
  assert.match(preloadSource, /saveClipToOutputFolder/);
});

test("finished clip saver accepts only local Clipping Office playback routes", () => {
  assert.equal(isVerifiedClipPlaybackUrl("http://127.0.0.1:5173/apps/clipping-office/outputs/final-clip.mp4"), true);
  assert.equal(isVerifiedClipPlaybackUrl("http://localhost:5173/api/clips/candidates/clip_1/playback"), true);
  assert.equal(isVerifiedClipPlaybackUrl("https://example.com/apps/clipping-office/outputs/final-clip.mp4"), false);
  assert.equal(isVerifiedClipPlaybackUrl("http://127.0.0.1:5173/private/final-clip.mp4"), false);
  assert.equal(isVerifiedClipPlaybackUrl("http://127.0.0.1:5173/apps/clipping-office/outputs/..%2Fprivate.mp4"), false);
});

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
      host: "127.0.0.1:5173",
      ...(options.headers || {}),
    };
    req.socket = { remoteAddress: "127.0.0.1", encrypted: false };

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

async function loginLocalServer(t, options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-local-desktop-"));
  const originalHome = process.env.HOME;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalStockGuruPath = process.env.STOCK_GURU_PATH;
  const originalTrustedBrokerFixture = process.env.ARGENTUM_TEST_TRUST_BROKER_FIXTURE;
  const originalStockExecutionMode = process.env.STOCK_GURU_EXECUTION_MODE;
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-local-home-"));
  process.env.HOME = homeDir;
  process.env.NODE_ENV = "test";
  if (options.localEnvContent) {
    const envDir = path.join(homeDir, "Library", "Application Support", "Argentum OS");
    fs.mkdirSync(envDir, { recursive: true });
    fs.writeFileSync(path.join(envDir, ".env"), options.localEnvContent);
  }
  process.env.APP_MODE = "local";
  process.env.HOST = "127.0.0.1";
  process.env.LOCAL_BACKEND_PORT = "5173";
  process.env.ARGENTUM_DATA_DIR = dataDir;
  process.env.SESSION_SECRET = "local-desktop-session-secret-local-desktop-session-secret-local-desktop";
  process.env.OPENAI_API_KEY = "test-secret-openai-key-that-must-not-leak";
  process.env.TWITCH_CLIENT_ID = "";
  process.env.TWITCH_CLIENT_SECRET = "";
  process.env.TWITCH_OAUTH_TOKEN = "";
  process.env.TWITCH_USER_ACCESS_TOKEN = "";
  process.env.TWITCH_APP_ACCESS_TOKEN = "";
  process.env.KICK_CLIENT_ID = "";
  process.env.KICK_CLIENT_SECRET = "";
  process.env.KICK_OAUTH_TOKEN = "";
  process.env.ADMIN_USERNAME = "";
  process.env.ADMIN_PASSWORD = "";
  process.env.ARGENTUM_DISABLE_KEYCHAIN = "true";
  process.env.ARGENTUM_SKIP_PROJECT_ENV = "true";
  if (options.trustBrokerFixture) process.env.ARGENTUM_TEST_TRUST_BROKER_FIXTURE = "1";
  else delete process.env.ARGENTUM_TEST_TRUST_BROKER_FIXTURE;
  if (options.executionMode) process.env.STOCK_GURU_EXECUTION_MODE = options.executionMode;
  else delete process.env.STOCK_GURU_EXECUTION_MODE;
  if (options.stockGuruPath) process.env.STOCK_GURU_PATH = options.stockGuruPath;
  else delete process.env.STOCK_GURU_PATH;

  delete require.cache[require.resolve("../server")];
  const { handleArgentumRequest } = require("../server");
  t.after(() => {
    process.env.HOME = originalHome;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalStockGuruPath === undefined) delete process.env.STOCK_GURU_PATH;
    else process.env.STOCK_GURU_PATH = originalStockGuruPath;
    if (originalTrustedBrokerFixture === undefined) delete process.env.ARGENTUM_TEST_TRUST_BROKER_FIXTURE;
    else process.env.ARGENTUM_TEST_TRUST_BROKER_FIXTURE = originalTrustedBrokerFixture;
    if (originalStockExecutionMode === undefined) delete process.env.STOCK_GURU_EXECUTION_MODE;
    else process.env.STOCK_GURU_EXECUTION_MODE = originalStockExecutionMode;
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const setup = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username: "localadmin",
      password: "LocalAdmin12345",
      confirmPassword: "LocalAdmin12345",
      savePassword: "on",
    }).toString(),
  });
  assert.equal(setup.status, 302);
  const cookie = String(setup.headers["set-cookie"] || "").split(";")[0];
  assert.match(cookie, /^argentum_session=/);
  return { handleArgentumRequest, cookie, dataDir };
}

test("local mode resolves to a localhost-only backend", () => {
  const env = { APP_MODE: "local", LOCAL_BACKEND_PORT: "6123" };
  assert.equal(localRuntime.resolveAppMode(env), "local");
  assert.equal(localRuntime.resolveHost(env), "127.0.0.1");
  assert.equal(localRuntime.resolvePort(env), 6123);
  assert.equal(localRuntime.assertLocalModeHost("local", "127.0.0.1"), undefined);
  assert.throws(() => localRuntime.assertLocalModeHost("local", "0.0.0.0"), /127\.0\.0\.1|localhost/);
});

test("local SQLite database initializes required tables", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-local-db-"));
  const result = localDatabase.initializeLocalDatabase({ dataDir });
  localDatabase.insertAuditLog(dataDir, { title: "Local database test", body: "Initialized." });
  const audit = localDatabase.listLocalAudit(dataDir, 5);
  assert.equal(fs.existsSync(result.dbPath), true);
  assert.equal(result.engine, "sqlite");
  assert.equal(result.migrations.length > 0, true);
  assert.equal(audit.some((entry) => entry.action === "Local database test"), true);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("authenticated local API exposes localhost status without leaking secrets", async (t) => {
  const { handleArgentumRequest, cookie } = await loginLocalServer(t);

  const status = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/api/local/status",
    headers: { cookie },
  });
  assert.equal(status.status, 200);
  const statusPayload = JSON.parse(status.body);
  assert.equal(statusPayload.localOnly, true);
  assert.equal(statusPayload.database.available, true);

  const provider = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/api/settings/ai-provider",
    headers: { cookie },
  });
  assert.equal(provider.status, 200);
  assert.equal(provider.body.includes("test-secret-openai-key-that-must-not-leak"), false);
});

test("Robinhood OAuth callback reaches one-use state validation without an Argentum session cookie", async (t) => {
  const { handleArgentumRequest } = await loginLocalServer(t);
  const callback = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/api/stock-office/robinhood/oauth/callback?code=test-code&state=test-state",
  });
  assert.equal(callback.status, 400);
  assert.match(callback.headers["content-type"], /text\/html/);
  assert.match(callback.body, /Robinhood did not connect/);
  assert.match(callback.body, /No trade or money movement occurred/);
  assert.doesNotMatch(callback.body, /Authentication required/);
  assert.doesNotMatch(callback.body, /test-code|test-state/);

  const remoteHost = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/api/stock-office/robinhood/oauth/callback?code=test-code&state=test-state",
    headers: { host: "example.com" },
  });
  assert.equal(remoteHost.status, 401);

  const wrongMethod = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/api/stock-office/robinhood/oauth/callback?code=test-code&state=test-state",
  });
  assert.equal(wrongMethod.status, 401);
});

test("frontend API path can reach local backend state after auth", async (t) => {
  const { handleArgentumRequest, cookie } = await loginLocalServer(t);
  const state = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/api/state",
    headers: { cookie },
  });
  assert.equal(state.status, 200);
  assert.equal(JSON.parse(state.body).agent.name, "Agent 101");
});

test("Monitor 3 display route and hardware API share one Hub-owned display state", async (t) => {
  const { handleArgentumRequest, cookie, dataDir } = await loginLocalServer(t);

  const unauthenticated = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/display",
  });
  assert.equal(unauthenticated.status, 302);
  assert.equal(unauthenticated.headers.location, "/login");

  const page = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/display",
    headers: { cookie },
  });
  assert.equal(page.status, 200);
  assert.match(page.headers["content-type"], /text\/html/);
  assert.equal(page.headers["x-argentum-display"], "monitor-3");
  assert.match(page.body, /Argentum Monitor 3/);

  const initial = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/api/display/state",
    headers: { cookie },
  });
  assert.equal(initial.status, 200);
  assert.equal(initial.body.includes("test-secret-openai-key-that-must-not-leak"), false);
  const initialPayload = JSON.parse(initial.body);
  assert.equal(initialPayload.display.view, "home");
  assert.equal(initialPayload.snapshot.header.brand, "ARGENTUM");
  assert.equal(initialPayload.snapshot.agents.agents[0].id, "agent-1010");

  const clipping = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/api/display/navigate",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ view: "clipping" }),
  });
  assert.equal(clipping.status, 200);
  assert.equal(JSON.parse(clipping.body).display.view, "clipping");

  const hardwareStatus = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/api/hardware/display?deviceId=argentum-controller-01",
  });
  assert.equal(hardwareStatus.status, 200);
  assert.equal(JSON.parse(hardwareStatus.body).pairingRequired, true);

  const blockedNavigate = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/api/hardware/display/command",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deviceId: "argentum-controller-01",
      action: "navigate",
      target: "trading",
    }),
  });
  assert.equal(blockedNavigate.status, 403);

  const pairing = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/api/hardware/display/pairing/request",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deviceId: "argentum-controller-01",
      label: "ESP32 Touchscreen",
    }),
  });
  assert.equal(pairing.status, 200);
  const pairingPayload = JSON.parse(pairing.body);
  assert.match(pairingPayload.display.pairing.code, /^\d{6}$/);

  const accepted = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/api/hardware/display/pairing/accept",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deviceId: "argentum-controller-01",
      pairingCode: pairingPayload.display.pairing.code,
    }),
  });
  assert.equal(accepted.status, 200);
  const deviceToken = JSON.parse(accepted.body).deviceToken;
  assert.match(deviceToken, /^[A-Za-z0-9_-]+$/);

  const trading = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/api/hardware/display/command",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deviceId: "argentum-controller-01",
      deviceToken,
      action: "navigate",
      target: "trading",
    }),
  });
  assert.equal(trading.status, 200);
  const tradingPayload = JSON.parse(trading.body);
  assert.equal(tradingPayload.display.view, "trading");
  assert.equal(tradingPayload.display.controllerConnected, true);

  const invalidAction = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/api/hardware/display/command",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId: "argentum-controller-01", deviceToken, action: "approve", target: "approval-1" }),
  });
  assert.equal(invalidAction.status, 400);
  assert.match(JSON.parse(invalidAction.body).error, /Unsupported display hardware action/);

  const invalidTarget = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/api/hardware/display/command",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId: "argentum-controller-01", deviceToken, action: "navigate", target: "../../private" }),
  });
  assert.equal(invalidTarget.status, 400);

  const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, "argentum-state.json"), "utf8"));
  assert.equal(persisted.display.view, "trading");
  assert.equal(persisted.display.controllerDeviceId, "argentum-controller-01");
  assert.equal(persisted.display.trustedControllers[0].tokenHash.length, 64);
  assert.equal(JSON.stringify(persisted).includes(deviceToken), false);
});

test("Electron exposes a separate Monitor 3 display launcher", () => {
  const mainSource = fs.readFileSync(path.join(__dirname, "..", "desktop", "main.js"), "utf8");
  const packageSource = fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8");

  assert.match(mainSource, /let displayWindow = null/);
  assert.match(mainSource, /monitor-display-config\.json/);
  assert.match(mainSource, /function createDisplayWindow/);
  assert.match(mainSource, /function enforceDisplayWindowMode/);
  assert.match(mainSource, /Open Monitor 3 Display/);
  assert.match(mainSource, /loadURL\(`\$\{appUrl\(\)\}\/display`\)/);
  assert.match(mainSource, /ARGENTUM_DISPLAY_AUTO_OPEN/);
  assert.match(mainSource, /argv\.includes\("--display"\)/);
  assert.match(mainSource, /kiosk: true/);
  assert.match(mainSource, /alwaysOnTop: true/);
  assert.match(mainSource, /preventClose: true/);
  assert.match(mainSource, /setKiosk\(true\)/);
  assert.match(mainSource, /setAlwaysOnTop\(true, "screen-saver"\)/);
  assert.match(mainSource, /setVisibleOnAllWorkspaces\(true, \{ visibleOnFullScreen: true \}\)/);
  assert.match(mainSource, /setResizable\(false\)/);
  assert.match(mainSource, /displayWindow\.on\("close"/);
  assert.match(mainSource, /displayWindow\.on\("leave-full-screen"/);
  assert.match(mainSource, /if \(displayWindow && !displayWindow\.isDestroyed\(\)\) displayWindow\.destroy\(\)/);
  assert.match(packageSource, /apps\/display\/display\.js/);
});

test("mounted Clipping Office chat persists a real Agent 101 thread", async (t) => {
  const { handleArgentumRequest } = await loginLocalServer(t);
  const headers = {
    "content-type": "application/json",
    origin: "http://127.0.0.1:5173",
  };
  const created = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/apps/clipping-office/api/argentum/agent101/chats",
    headers,
    body: JSON.stringify({ title: "Clipping Office Command", roomId: "clips-office" }),
  });
  assert.equal(created.status, 201);
  const thread = JSON.parse(created.body).thread;
  assert.equal(thread.roomId, "clips-office");

  const replied = await invoke(handleArgentumRequest, {
    method: "POST",
    url: `/apps/clipping-office/api/argentum/agent101/chats/${encodeURIComponent(thread.id)}/messages`,
    headers,
    body: JSON.stringify({
      content: "What is the safe next step in Clipping Office?",
      roomId: "clips-office",
      clientMessageId: "clipping-office-test-message",
      mode: "demo",
    }),
  });
  assert.equal(replied.status, 200);
  const payload = JSON.parse(replied.body);
  assert.equal(payload.thread.id, thread.id);
  const operatorMessage = payload.thread.messages.find((message) => message.role === "user" && /safe next step/i.test(message.content));
  const agentReply = payload.thread.messages.find((message) => message.role === "agent" && message.content === payload.response?.message);
  assert.ok(operatorMessage);
  assert.ok(agentReply);
  assert.equal(agentReply.metadata.clientMessageId, undefined);
  assert.equal(agentReply.metadata.replyToClientMessageId, operatorMessage.metadata.clientMessageId);
  assert.equal(Boolean(payload.response?.message), true);
});

test("Clipping Office dashboard renders live operations and RAM telemetry", () => {
  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const appSource = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
  const styleSource = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

  assert.match(indexSource, /id="controlFloorDashboard"/);
  assert.match(indexSource, /id="controlFloorDashboard"[^>]*hidden[^>]*aria-hidden="true"/);
  assert.match(indexSource, /id="controlFloorLiveRegion"/);
  assert.match(indexSource, /class="office-floor-runtime"/);
  assert.match(indexSource, /id="officeAgentTransit"/);
  assert.match(serverSource, /\/api\/clipping-office\/overview/);
  assert.match(serverSource, /function readArgentumProcessMemorySnapshot/);
  assert.match(serverSource, /execFileSync\("ps"/);
  assert.match(serverSource, /img-src 'self' data: https:\/\/static-cdn\.jtvnw\.net https:\/\/images\.kick\.com/);
  assert.doesNotMatch(serverSource, /const workloadPercent = Math\.min/);
  assert.match(appSource, /function renderControlFloorDashboard/);
  assert.match(appSource, /function controlFloorStreamMarkup/);
  assert.match(appSource, /function animateOfficeAgentTransit/);
  assert.doesNotMatch(appSource, /const seededEntries =/);
  assert.match(appSource, /function clippingOfficeMarkup/);
  assert.match(appSource, /Clips moving through the office/);
  assert.match(appSource, /Argentum memory/);
  assert.match(appSource, /loadClippingOfficeOverview\(\{ force: true \}\)/);
  assert.match(styleSource, /\.clipping-operations-panel/);
  assert.match(styleSource, /\.clipops-memory-gauge/);
  assert.match(styleSource, /\.control-floor-stream-media/);
  assert.match(styleSource, /\.control-floor-office-directory/);
  assert.match(styleSource, /\.office-floor-runtime/);
  assert.match(styleSource, /argentum-office-floor\.png/);
  assert.match(styleSource, /\.office-agent-transit/);
});

test("Control Floor shell puts useful navigation and full labels ahead of repeated branding", () => {
  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const styleSource = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  const topbarSource = indexSource.match(/<header class="topbar control-floor-topbar"[\s\S]*?<\/header>/)?.[0] || "";
  const sidebarLead = indexSource.match(/<aside class="sidebar"[\s\S]*?<section class="agent-roster"/)?.[0] || "";
  const controlBarSource = indexSource.match(/<div class="agent-control-bar"[\s\S]*?<\/div>\s*<\/section>/)?.[0] || "";
  const premiumStyles = styleSource.slice(styleSource.lastIndexOf("/* Control Floor: premium command shell */"));
  const topbarIndex = indexSource.indexOf('class="topbar control-floor-topbar"');
  const navigationIndex = indexSource.indexOf('class="workspace-nav bottom-nav"');
  const floorIndex = indexSource.indexOf('id="view-floor"');

  assert.ok(topbarIndex >= 0 && navigationIndex > topbarIndex && floorIndex > navigationIndex);
  assert.match(topbarSource, /id="workspaceViewTitle">Control Floor</);
  assert.match(topbarSource, /id="workspaceViewDescription"/);
  assert.doesNotMatch(topbarSource, /Argentum OS|topbar-product-mark/);
  assert.match(sidebarLead, /Private workspace/);
  assert.match(sidebarLead, /Local command/);
  assert.doesNotMatch(sidebarLead, /<h1>Argentum<\/h1>|brand-block/);
  assert.match(indexSource, /class="system-facts"/);
  assert.doesNotMatch(indexSource, /id="sidebarStatusBar[A-D]"/);
  assert.match(controlBarSource, /id="taskStage"/);
  assert.match(controlBarSource, /id="taskStageDetail"/);
  assert.match(controlBarSource, /id="riskLevel"/);
  assert.match(controlBarSource, /id="openSupervisorFromFloorBtn"/);
  assert.match(controlBarSource, /id="pauseBtn"/);
  assert.doesNotMatch(controlBarSource, /Mission progress|missionProgress|Run cycle/);
  assert.match(premiumStyles, /\.office-floor-runtime \.station-label \.module-copy strong,[\s\S]*?overflow: visible;[\s\S]*?text-overflow: clip;[\s\S]*?white-space: normal;/);
  assert.match(premiumStyles, /#sidebarAgentChatTitle[\s\S]*?overflow: visible;[\s\S]*?text-overflow: clip;[\s\S]*?white-space: normal;/);
});

test("Control Floor workflow map renders measured work state instead of radar decoration", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
  const styleSource = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  const snapshotSource = appSource.slice(
    appSource.indexOf("function controlFloorWorkflowSnapshot"),
    appSource.indexOf("function controlFloorWorkflowStepMarkup"),
  );
  const workflowMapSource = appSource.slice(
    appSource.indexOf("function controlFloorWorkflowStepMarkup"),
    appSource.indexOf("function moduleDisplayName"),
  );

  assert.match(snapshotSource, /officeRuntimeSnapshot\(\)/);
  assert.match(snapshotSource, /runtime\.tasks/);
  assert.match(snapshotSource, /runtime\.artifacts/);
  assert.match(snapshotSource, /runtime\.pending/);
  assert.match(snapshotSource, /evidenceCount/);
  assert.match(workflowMapSource, /data-workflow-stage=/);
  assert.match(workflowMapSource, /aria-current="step"/);
  assert.match(workflowMapSource, /Current work route/);
  assert.match(workflowMapSource, /External actions locked/);
  assert.match(workflowMapSource, /miniMapNodes\.querySelectorAll\("\[data-workflow-view\], \[data-workflow-room\]"\)/);
  assert.match(workflowMapSource, /button\.addEventListener\("click", activateWorkflowRouteFromEvent\)/);
  assert.match(appSource, /function activateWorkflowRouteFromEvent[\s\S]*?activateView\(target\.dataset\.workflowView\)/);
  assert.doesNotMatch(workflowMapSource, /mini-map-radar|mini-starfield|mini-orbit|mini-crosshair/);
  assert.doesNotMatch(appSource, /function depoStageProgress/);
  assert.match(styleSource, /\.workflow-map-step\.is-current/);
  assert.match(styleSource, /\.workflow-map-step\.is-attention/);
  assert.match(styleSource, /\.workflow-map-footer/);
});

test("Project Workflow exposes an accessible focus-managed read-only infrastructure dialog", () => {
  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const appSource = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
  const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const sidebarSource = indexSource.match(/<aside class="sidebar"[\s\S]*?<\/aside>/)?.[0] || "";
  const dialogSource = indexSource.match(/<section class="project-infrastructure-overlay"[\s\S]*?<\/section>\s*<script/)?.[0] || "";
  const loaderSource = appSource.slice(
    appSource.indexOf("async function loadProjectInfrastructure"),
    appSource.indexOf("function projectInfrastructureFocusableElements"),
  );
  const openSource = appSource.slice(
    appSource.indexOf("function setProjectInfrastructureOpen"),
    appSource.indexOf("function handleProjectInfrastructureKeydown"),
  );
  const keydownSource = appSource.slice(
    appSource.indexOf("function handleProjectInfrastructureKeydown"),
    appSource.indexOf("function moduleDisplayName"),
  );
  const routeSource = serverSource.slice(
    serverSource.indexOf('if (req.method === "GET" && url.pathname === "/api/control-floor/infrastructure")'),
    serverSource.indexOf("const officeMatch", serverSource.indexOf('url.pathname === "/api/control-floor/infrastructure"')),
  );

  assert.match(sidebarSource, /<button class="sidebar-workflow-launcher" id="projectInfrastructureOpenBtn"[^>]*aria-haspopup="dialog"[^>]*aria-controls="projectInfrastructureOverlay"[^>]*aria-expanded="false"/);
  assert.match(sidebarSource, /<strong>Workflow<\/strong>/);
  assert.match(sidebarSource, /id="sidebarWorkflowStatus"/);
  assert.match(dialogSource, /id="projectInfrastructureOverlay" hidden aria-hidden="true"/);
  assert.match(dialogSource, /id="projectInfrastructureDialog" role="dialog" aria-modal="true" aria-labelledby="projectInfrastructureTitle" aria-describedby="projectInfrastructureSummary" tabindex="-1"/);
  assert.match(dialogSource, /id="projectInfrastructureStatus" role="status" aria-live="polite"/);
  assert.match(dialogSource, /id="projectInfrastructureCloseBtn"[^>]*aria-label="Close project infrastructure"/);
  assert.match(indexSource, /id="projectInfrastructureTopBtn"[^>]*aria-haspopup="dialog"[^>]*aria-controls="projectInfrastructureOverlay"[^>]*aria-expanded="false"/);

  assert.equal((appSource.match(/api\("\/api\/control-floor\/infrastructure"/g) || []).length, 1);
  assert.match(loaderSource, /if \(projectInfrastructureLoading\) return projectInfrastructurePayload/);
  assert.match(loaderSource, /api\("\/api\/control-floor\/infrastructure", \{ cache: options\.force \? "no-store" : "default" \}\)/);
  assert.match(loaderSource, /payload\.schemaVersion !== 1 \|\| !Array\.isArray\(payload\.nodes\) \|\| !Array\.isArray\(payload\.edges\)/);
  assert.doesNotMatch(loaderSource, /postJson\(|method:\s*"(?:POST|PUT|PATCH|DELETE)"|mutate\(/);
  assert.match(appSource, /function projectInfrastructureMeasuredSum\([\s\S]*?values\.some\([\s\S]*?\)\) return null;[\s\S]*?return values\.reduce\(/);
  assert.match(appSource, /pendingProposals: null,[\s\S]*?recentProposals: null,/);
  assert.doesNotMatch(appSource, /Number\(counts\.(?:outputs|officeOutputs|approvalsPending|activeTasks) \|\| 0\)/);
  assert.match(routeSource, /^if \(req\.method === "GET"/);
  assert.match(routeSource, /controlFloorInfrastructureSnapshot\(readState\(\)/);
  assert.doesNotMatch(routeSource, /writeState\(|audit\(|createHumanGateRequest\(|req\.method === "(?:POST|PUT|PATCH|DELETE)"/);

  assert.match(openSource, /projectInfrastructureReturnFocus = document\.activeElement instanceof HTMLElement \? document\.activeElement : projectInfrastructureOpenBtn/);
  assert.match(openSource, /projectInfrastructureOverlay\.hidden = !shouldOpen/);
  assert.match(openSource, /projectInfrastructureOverlay\.setAttribute\("aria-hidden", shouldOpen \? "false" : "true"\)/);
  assert.match(openSource, /appShell\.inert = shouldOpen/);
  assert.match(openSource, /setAttribute\("aria-expanded", shouldOpen \? "true" : "false"\)/);
  assert.match(openSource, /projectInfrastructureCloseBtn \|\| projectInfrastructureDialog\)\.focus\(\{ preventScroll: true \}\)/);
  assert.match(openSource, /loadProjectInfrastructure\(\{ force: options\.force !== false \}\)/);
  assert.match(openSource, /returnFocus\?\.isConnected[\s\S]*?returnFocus\.focus\(\{ preventScroll: true \}\)/);
  assert.match(keydownSource, /event\.key === "Escape"[\s\S]*?setProjectInfrastructureOpen\(false\)/);
  assert.match(keydownSource, /event\.key !== "Tab"/);
  assert.match(keydownSource, /document\.activeElement === first[\s\S]*?last\.focus\(\)/);
  assert.match(keydownSource, /document\.activeElement === last[\s\S]*?first\.focus\(\)/);
  assert.match(appSource, /document\.addEventListener\("keydown", \(event\) => \{\s*if \(handleProjectInfrastructureKeydown\(event\)\) return/);
  assert.match(appSource, /\[projectInfrastructureOpenBtn, projectInfrastructureTopBtn\][\s\S]*?setProjectInfrastructureOpen\(true, \{ force: true \}\)/);
  assert.match(appSource, /projectInfrastructureCloseBtn\?\.addEventListener\("click", \(\) => setProjectInfrastructureOpen\(false\)\)/);
});

test("Project Workflow keeps its premium graph legible across desktop and narrow screens", () => {
  const styleSource = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  const projectStyles = styleSource.slice(styleSource.indexOf("/* Project workflow infrastructure */"));

  assert.match(projectStyles, /\.sidebar-workflow-launcher:focus-visible,\s*\.project-infrastructure-card button:focus-visible\s*\{[\s\S]*?outline:/);
  assert.match(projectStyles, /\.project-infrastructure-overlay\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;[\s\S]*?backdrop-filter:\s*blur\(/);
  assert.match(projectStyles, /\.project-infrastructure-card\s*\{[\s\S]*?width:\s*min\(1320px, calc\(100vw - 32px\)\);[\s\S]*?height:\s*min\(836px, calc\(100dvh - 32px\)\);[\s\S]*?grid-template-rows:\s*auto auto minmax\(0, 1fr\) auto;[\s\S]*?overflow:\s*hidden;/);
  assert.match(projectStyles, /\.project-infrastructure-body\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*auto;/);
  assert.match(projectStyles, /\.project-infrastructure-office > header strong,\s*\.project-infrastructure-office > header small\s*\{[\s\S]*?overflow:\s*visible;[\s\S]*?text-overflow:\s*clip;[\s\S]*?white-space:\s*normal;[\s\S]*?overflow-wrap:\s*anywhere;/);
  assert.match(projectStyles, /\.project-infrastructure-workspace > code\s*\{[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?white-space:\s*normal;/);
  assert.match(projectStyles, /@media \(max-width: 1100px\)[\s\S]*?\.project-infrastructure-layout\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/);
  assert.match(projectStyles, /@media \(max-width: 760px\)[\s\S]*?\.project-infrastructure-card\s*\{[\s\S]*?width:\s*calc\(100vw - 16px\);[\s\S]*?height:\s*calc\(100dvh - 16px\);/);
  assert.match(projectStyles, /@media \(max-width: 760px\)[\s\S]*?\.project-infrastructure-office-grid\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/);
  assert.match(projectStyles, /@media \(max-width: 760px\)[\s\S]*?\.project-infrastructure-downstream\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/);
  assert.match(projectStyles, /@media \(max-width: 760px\)[\s\S]*?\.project-infrastructure-refresh\s*\{[\s\S]*?color:\s*#b9c2cb;[\s\S]*?font-size:\s*0;/);
  assert.doesNotMatch(projectStyles, /\.project-infrastructure-refresh\s*\{[\s\S]{0,180}?color:\s*transparent;/);
});

test("Project Workflow opens measured office stages and never replaces an API failure with a declared graph", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
  const styleSource = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  const snapshotSource = appSource.slice(
    appSource.indexOf("function projectInfrastructureSnapshot"),
    appSource.indexOf("function projectInfrastructureMeasuredValue"),
  );
  const drilldownSource = appSource.slice(
    appSource.indexOf("function projectWorkflowOfficeNodes"),
    appSource.indexOf("function projectInfrastructureFocusableElements"),
  );

  assert.match(snapshotSource, /return null/);
  assert.doesNotMatch(snapshotSource, /projectInfrastructureFallbackPayload\(\)/);
  assert.match(drilldownSource, /function projectInfrastructureUnavailableMarkup/);
  assert.match(drilldownSource, /function projectInfrastructureOfficeWorkflowMarkup/);
  assert.match(drilldownSource, /data-infrastructure-office-focus=/);
  assert.match(drilldownSource, /data-infrastructure-stage=/);
  assert.match(drilldownSource, /role="tablist"/);
  assert.match(drilldownSource, /role="tabpanel"/);
  assert.match(drilldownSource, /data-infrastructure-open-office=/);
  assert.match(drilldownSource, /No recorded items in this stage\./);
  assert.match(styleSource, /\.project-workflow-stage-rail/);
  assert.match(styleSource, /\.project-workflow-focus-grid\.has-aside/);
  assert.match(styleSource, /@media \(max-width: 820px\)[\s\S]*?\.project-workflow-focus-grid\.has-aside\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/);
});

test("authenticated Project Workflow infrastructure is evidence-backed and conservative", async (t) => {
  const twitchClientId = "workflow-test-twitch-client-id";
  const twitchClientSecret = "workflow-test-twitch-client-secret-that-must-not-leak";
  const seededOpenAiSecret = "test-secret-openai-key-that-must-not-leak";
  const { handleArgentumRequest, cookie } = await loginLocalServer(t, {
    localEnvContent: [
      `TWITCH_CLIENT_ID=${twitchClientId}`,
      `TWITCH_CLIENT_SECRET=${twitchClientSecret}`,
      "",
    ].join("\n"),
  });
  const response = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/api/control-floor/infrastructure",
    headers: { cookie },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.includes(twitchClientId), false);
  assert.equal(response.body.includes(twitchClientSecret), false);
  assert.equal(response.body.includes(seededOpenAiSecret), false);

  const payload = JSON.parse(response.body);
  assert.equal(payload.schemaVersion, 1);
  assert.match(payload.snapshotId, /^infra-/);
  assert.equal(Number.isNaN(Date.parse(payload.generatedAt)), false);
  assert.equal(typeof payload.partial, "boolean");
  assert.ok(Array.isArray(payload.sources) && payload.sources.length > 0);
  assert.ok(Array.isArray(payload.nodes) && payload.nodes.length > 0);
  assert.ok(Array.isArray(payload.edges) && payload.edges.length > 0);
  assert.ok(Array.isArray(payload.warnings));
  assert.equal(payload.workspace.root, path.resolve(__dirname, ".."));
  assert.equal(payload.workspace.mode, "supervised_project_workspace");
  assert.equal(payload.workspace.safety, "supervised_human_gate");
  assert.match(payload.workspace.readPolicy, /secrets|credentials/i);
  assert.match(payload.workspace.writePolicy, /Human Gate|approval/i);
  assert.ok(Array.isArray(payload.workspace.pendingProposals));
  assert.ok(Array.isArray(payload.workspace.recentProposals));
  assert.equal(Number.isInteger(payload.workspace.workerCount), true);

  assert.deepEqual(Object.keys(payload.approvalDomains).sort(), ["central", "clippingOffice", "printShop"]);
  const approvalDomains = Object.values(payload.approvalDomains);
  approvalDomains.forEach((domain) => {
    assert.equal(typeof domain.label, "string");
    assert.equal(domain.pending === null || Number.isInteger(domain.pending), true);
    if (domain.pending !== null) assert.equal(domain.pending >= 0, true);
    assert.ok(["measured", "recorded", "unavailable"].includes(domain.evidenceLevel));
    if (domain.evidenceLevel === "unavailable") assert.equal(domain.pending, null);
  });
  const approvalTotal = approvalDomains.some((domain) => domain.pending === null)
    ? null
    : approvalDomains.reduce((sum, domain) => sum + domain.pending, 0);
  assert.equal(payload.summary.approvalsPending, approvalTotal);
  const humanGate = payload.nodes.find((node) => node.id === "gate:human");
  assert.ok(humanGate);
  assert.deepEqual(
    { central: humanGate.counts.central, clippingOffice: humanGate.counts.clippingOffice, printShop: humanGate.counts.printShop },
    {
      central: payload.approvalDomains.central.pending,
      clippingOffice: payload.approvalDomains.clippingOffice.pending,
      printShop: payload.approvalDomains.printShop.pending,
    },
  );
  assert.equal(humanGate.counts.pending, approvalTotal);

  const outputNode = payload.nodes.find((node) => node.id === "output:local");
  assert.ok(outputNode);
  const outputDomains = [outputNode.counts.central, outputNode.counts.clippingOffice, outputNode.counts.printShop];
  const outputTotal = outputDomains.some((count) => count === null)
    ? null
    : outputDomains.reduce((sum, count) => sum + count, 0);
  assert.equal(outputNode.counts.total, outputTotal);
  assert.equal(payload.summary.outputsReady, outputTotal);
  if (outputTotal === null) assert.match(outputNode.warning, /could not be measured|unknown/i);

  const unavailableClips = payload.nodes.find((node) => node.id === "office:clips-office");
  assert.ok(unavailableClips);
  assert.equal(unavailableClips.workflow.measured, false);
  assert.equal(unavailableClips.counts.candidates, null);
  unavailableClips.workflow.stages.forEach((stage) => {
    assert.equal(stage.count, null);
    assert.deepEqual(stage.items, []);
  });

  const nodeIds = new Set(payload.nodes.map((node) => node.id));
  assert.equal(nodeIds.size, payload.nodes.length);
  payload.nodes.forEach((node) => {
    assert.equal(typeof node.id, "string");
    assert.equal(typeof node.kind, "string");
    assert.equal(typeof node.label, "string");
    assert.equal(typeof node.lifecycle, "string");
    assert.equal(typeof node.availability, "string");
    assert.equal(typeof node.authority, "string");
    assert.equal(typeof node.evidenceLevel, "string");
    assert.equal(typeof node.source?.system, "string");
    assert.notEqual(node.source?.recordId, undefined);
  });
  payload.edges.forEach((edge) => {
    assert.equal(nodeIds.has(edge.from), true, `${edge.id} has an unknown source node`);
    assert.equal(nodeIds.has(edge.to), true, `${edge.id} has an unknown destination node`);
    assert.equal(typeof edge.relation, "string");
    assert.equal(typeof edge.basis, "string");
    assert.ok(Array.isArray(edge.evidence) && edge.evidence.length > 0, `${edge.id} must carry evidence`);
    edge.evidence.forEach((evidence) => {
      assert.equal(typeof evidence.source, "string", `${edge.id} evidence source`);
      assert.notEqual(evidence.recordId, undefined, `${edge.id} evidence record`);
      assert.equal(typeof evidence.field, "string", `${edge.id} evidence field`);
      assert.equal(Number.isNaN(Date.parse(evidence.observedAt)), false, `${edge.id} evidence timestamp`);
    });
  });

  const directAgentBridge = payload.edges.filter((edge) => (
    edge.from === "agent:agent-101" && edge.to === "agent:agent-202"
  ) || (
    edge.from === "agent:agent-202" && edge.to === "agent:agent-101"
  ));
  assert.deepEqual(directAgentBridge, []);
  assert.equal(payload.nodes.some((node) => node.id === "agent:agent-202"), false);
  const printShopAgentEdge = payload.edges.find((edge) => edge.from === "agent:agent-101" && edge.to === "office:print-shop-office");
  assert.ok(printShopAgentEdge);
  assert.equal(printShopAgentEdge.relation, "routes_to");
  assert.ok(["explicit_record", "declared_contract"].includes(printShopAgentEdge.basis));
  assert.ok(printShopAgentEdge.evidence.length > 0);
  const printShopNode = payload.nodes.find((node) => node.id === "office:print-shop-office");
  assert.ok(printShopNode);
  assert.equal(printShopNode.route, "/apps/print-shop-office/");
  assert.deepEqual(
    printShopNode.workflow.stages.map((stage) => stage.label),
    ["Concepts", "A1 Mini fit", "Design files", "Slice check", "Human Gate", "Prototype"],
  );

  const connectorNodes = payload.nodes.filter((node) => node.kind === "connector");
  assert.ok(connectorNodes.length > 0);
  const capcut = connectorNodes.find((node) => node.id === "connector:capcut");
  assert.ok(capcut);
  assert.equal(capcut.connectorState, "manual_handoff");
  assert.equal(capcut.connected, false);
  connectorNodes
    .filter((node) => ["manual_handoff", "approval_required", "not_connected", "local_demo", "configured_unverified", "unknown", "error"].includes(node.connectorState))
    .forEach((node) => assert.equal(node.connected, false, `${node.id} must not be presented as connected`));
  connectorNodes.filter((node) => node.connected).forEach((node) => {
    assert.equal(node.connectorState, "connected");
    const edge = payload.edges.find((candidate) => candidate.to === node.id && candidate.relation === "uses_connector");
    assert.equal(edge?.basis, "verified_test");
    assert.equal(edge?.evidence?.some((evidence) => evidence.field === "lastTest.success"), true);
  });
  assert.equal(payload.summary.connectorsVerified, connectorNodes.filter((node) => node.connected === true).length);
});

test("Clips Project Workflow uses the recorded production rail and preserves sparse data", async (t) => {
  const { handleArgentumRequest, cookie, dataDir } = await loginLocalServer(t);
  const clippingDir = path.join(dataDir, "clipping-office");
  fs.mkdirSync(clippingDir, { recursive: true });
  const observedAt = new Date().toISOString();
  const clipCandidates = [
    { id: "clip-studio", streamerName: "Jynxzi", title: "Studio cut", builderApproved: true, updatedAt: observedAt },
    { id: "clip-sparse", builderApproved: true, updatedAt: observedAt },
    { id: "clip-review", streamerName: "Jynxzi", title: "Worker cut", builderApproved: true, updatedAt: observedAt },
    { id: "clip-precheck", streamerName: "Jynxzi", title: "Precheck cut", productionWorkflow: { stage: "precheck", status: "awaiting_approval", updatedAt: observedAt } },
    { id: "clip-ready", streamerName: "Jynxzi", title: "Ready cut", productionWorkflow: { stage: "product_ready", status: "approved", updatedAt: observedAt } },
    { id: "clip-library", streamerName: "Jynxzi", title: "Saved cut", productionWorkflow: { stage: "product_ready", status: "approved", localLibraryPath: "/tmp/saved-cut.mp4", updatedAt: observedAt } },
    { id: "clip-rejected", title: "Rejected cut", status: "rejected", updatedAt: observedAt },
    { id: "clip-practice", title: "Practice cut", builderApproved: true, sourceProvenance: "DEMO_SOURCE", updatedAt: observedAt },
  ];
  fs.writeFileSync(path.join(clippingDir, "overview.json"), JSON.stringify({
    schemaVersion: 1,
    sourceUpdatedAt: observedAt,
    sourceCounts: { clipCandidates: clipCandidates.length },
    automation: {
      enabled: true,
      status: "running",
      workerStatus: "processing",
      workerClipId: "clip-review",
      workerProgress: 42,
      workerStage: "Preparing clip",
      workerDetail: "Loading the selected clip into the local editor.",
      pipelineStage: "library",
    },
    streamers: [],
    watchSessions: [],
    clipCandidates,
    clipPackages: [],
    postingDrafts: [],
    approvalRequests: [],
    mediaJobs: [],
    artifacts: [],
    watchEvents: [],
  }));

  const response = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/api/control-floor/infrastructure",
    headers: { cookie },
  });
  assert.equal(response.status, 200);
  const payload = JSON.parse(response.body);
  const clips = payload.nodes.find((node) => node.id === "office:clips-office");
  assert.ok(clips?.workflow?.measured);
  assert.equal(clips.workflow.complete, true);
  assert.equal(clips.workflow.source, "clipping-office");
  assert.equal(clips.workflow.observedAt, observedAt);
  assert.deepEqual(
    Object.fromEntries(clips.workflow.stages.map((stage) => [stage.id, stage.count])),
    { studio: 2, review: 1, precheck: 1, ready: 1, library: 1 },
  );
  assert.equal(clips.counts.candidates, 6);
  assert.equal(clips.workflow.activeStageId, "review");
  assert.equal(clips.workflow.current.id, "clip-review");
  assert.equal(clips.workflow.operation.recordId, "clip-review");
  assert.equal(clips.workflow.operation.progress, 42);
  const workflowItems = clips.workflow.stages.flatMap((stage) => stage.items);
  assert.equal(workflowItems.some((item) => item.id === "clip-practice"), false);
  assert.equal(workflowItems.some((item) => item.id === "clip-rejected"), false);
  const sparse = workflowItems.find((item) => item.id === "clip-sparse");
  assert.equal(sparse.title, null);
  assert.equal(sparse.meta, null);
  assert.equal(sparse.metrics.quality, null);
  assert.equal(sparse.metrics.durationSeconds, null);
  assert.equal(JSON.stringify(clips.workflow).includes("Creator"), false);
  assert.notEqual(clips.workflow.activeStageId, "library", "configured pipeline depth must not be presented as current work");
});

test("Agent 101 supervisor centers the assigned task, current work, and linked decisions", () => {
  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const appSource = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
  const styleSource = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  const sideSource = indexSource.match(/<aside class="agent-chat-side"[\s\S]*?<\/aside>/)?.[0] || "";
  const railSource = appSource.slice(
    appSource.indexOf("function agentMissionRailMarkup"),
    appSource.indexOf("function captureAgent101MissionRailState"),
  );
  const officeSource = appSource.slice(
    appSource.indexOf("function agent101SupervisorOfficeMarkup"),
    appSource.indexOf("function businessOfficeMarkup"),
  );
  const threadMissionSource = appSource.slice(
    appSource.indexOf("function missionsForThread"),
    appSource.indexOf("function activeAgent101Mission"),
  );

  assert.match(sideSource, /aria-label="Agent 101 supervisor"/);
  assert.match(sideSource, /id="agentMissionCockpit"/);
  assert.match(sideSource, /id="agentMissionConnection"/);
  assert.match(sideSource, /id="agentMissionSelect"/);
  assert.match(sideSource, /id="agentMissionRail"/);
  assert.doesNotMatch(sideSource, /agent-chat-side-card|Thread Rules|Human Gate<\/p>/);

  assert.match(railSource, /data-agent-supervisor="task"/);
  assert.match(railSource, /data-agent-supervisor="updates"/);
  assert.match(railSource, /data-agent-supervisor="validation"/);
  assert.match(railSource, /aria-live="polite" aria-atomic="true"/);
  assert.match(railSource, /agent101SupervisorPosition\(mission\)/);
  assert.match(railSource, /linkedAgent101MissionApprovals\(mission\)/);
  assert.doesNotMatch(railSource, /missionCheckpointMarkup|missionProgressValue|agent-mission-stats|Live timeline|Decision context|toolCallCount|iteration/);
  assert.doesNotMatch(appSource, /function missionProgressValue/);

  assert.match(officeSource, /data-agent-supervisor="task"/);
  assert.match(officeSource, /data-agent-supervisor="position"/);
  assert.match(officeSource, /data-agent-supervisor="validation"/);
  assert.match(officeSource, /data-supervisor-conversation/);
  assert.match(officeSource, /data-supervisor-composer/);
  assert.match(officeSource, /The task you gave me/);
  assert.doesNotMatch(officeSource, /Office Goal|Task Pipeline Overview|Workflow Steps|Quick Actions|What This Office Will Do/);
  assert.match(appSource, /roomKey\) === "depo-habitat"\) return agent101SupervisorOfficeMarkup\(card\)/);
  assert.match(appSource, /submitDepoChat\(mainAgentChatRoomId, message\)/);

  assert.match(threadMissionSource, /mission\.threadId && mission\.threadId === thread\.id/);
  assert.doesNotMatch(threadMissionSource, /agent101Missions\.find\(\(mission\) => mission\.id === activeAgent101MissionId\)/);
  assert.match(appSource, /function linkedAgent101MissionApprovals/);
  assert.match(appSource, /approval\.missionId === mission\.id \|\| approvalIds\.has\(approval\.id\)/);
  assert.match(appSource, /data-chat-approval-action="approve"/);
  assert.match(appSource, /data-chat-approval-action="revise"/);
  assert.match(appSource, /data-chat-approval-action="block"/);
  assert.match(appSource, /\["approval_required", "mission_waiting_approval", "run_waiting_approval"\][\s\S]*?loadState\(\)/);
  assert.match(appSource, /event\?\.details\?\.output\?\.\[key\]/);

  assert.match(styleSource, /\.agent-supervisor-feed/);
  assert.match(styleSource, /\.agent-supervisor-message/);
  assert.match(styleSource, /\.agent-supervisor-validation/);
  assert.match(styleSource, /\.agent-supervisor-office/);
  assert.match(styleSource, /\.supervisor-office-conversation/);
  assert.match(styleSource, /\.supervisor-office-composer/);
});

test("Clipping Office overview reports each production stage and measured memory", async (t) => {
  const { handleArgentumRequest, cookie, dataDir } = await loginLocalServer(t);
  const clippingDir = path.join(dataDir, "clipping-office");
  fs.mkdirSync(clippingDir, { recursive: true });
  fs.writeFileSync(path.join(clippingDir, "state.json"), JSON.stringify({
    streamers: [
      {
        id: "streamer-live",
        displayName: "Jynxzi",
        platform: "twitch",
        officialLiveMetadata: {
          title: "Streamer University live",
          category: "IRL",
          viewerCount: 52390,
          thumbnail: "https://example.com/jynxzi-{width}x{height}.jpg",
          source: "Official Twitch API",
          verifiedAt: "2026-07-16T12:00:00.000Z",
        },
      },
    ],
    watchSessions: [
      {
        id: "session-live",
        streamerId: "streamer-live",
        status: "watching",
        currentStage: "Listening to and viewing live media",
        heartbeatAt: "2020-01-01T00:00:00.000Z",
        lastMediaAt: new Date().toISOString(),
        rollingBuffer: { running: true, bufferedSeconds: 142, retentionSeconds: 180 },
        updatedAt: "2026-07-16T12:00:00.000Z",
      },
      {
        id: "session-history",
        streamerId: "streamer-live",
        streamerName: "Jynxzi",
        platform: "twitch",
        status: "completed",
        updatedAt: "2026-07-16T10:00:00.000Z",
      },
    ],
    watchEvents: [
      {
        id: "event-live",
        sessionId: "session-live",
        type: "chat_keyword_detected",
        payload: { messagesPerMinute: 96, message: "Audience reaction is accelerating." },
        createdAt: "2026-07-16T12:00:01.000Z",
      },
    ],
    clipCandidates: [
      { id: "clip-discovery", streamerName: "Jynxzi", score: 74, status: "ready", createdAt: "2026-07-16T11:56:00.000Z" },
      { id: "clip-studio", streamerName: "Jynxzi", score: 82, builderApproved: true, updatedAt: "2026-07-16T11:57:00.000Z" },
      { id: "clip-precheck", streamerName: "Jynxzi", score: 91, productionWorkflow: { stage: "precheck" }, updatedAt: "2026-07-16T11:58:00.000Z" },
      { id: "clip-ready", streamerName: "Jynxzi", score: 96, productionWorkflow: { stage: "product_ready", localLibraryPath: "/tmp/jynxzi-ready.mp4" }, updatedAt: "2026-07-16T11:59:00.000Z" },
      { id: "clip-active-in-builder", streamerName: "Jynxzi", score: 79, status: "in_builder", sourceType: "live_recording_window", watchSessionId: "session-live", updatedAt: "2026-07-16T11:59:30.000Z" },
      { id: "clip-historical-in-builder", streamerName: "Jynxzi", score: 80, status: "in_builder", sourceType: "live_recording_window", watchSessionId: "session-history", updatedAt: "2026-07-16T10:00:00.000Z" },
      { id: "clip-historical-discovery", streamerName: "Jynxzi", score: 61, status: "candidate", sourceType: "live_recording_window", watchSessionId: "session-history", updatedAt: "2026-07-16T09:59:00.000Z" },
      { id: "clip-practice", streamerName: "Practice Media Source", score: 99, status: "candidate", sourceType: "watcher_buffer", sourceProvenance: "DEMO_SOURCE", updatedAt: "2026-07-16T09:58:30.000Z" },
      { id: "clip-missing-source", streamerName: "Jynxzi", score: 77, status: "rejected", sourceType: "live_recording_window", watchSessionId: "session-history", sourceIntegrity: { status: "missing" }, updatedAt: "2026-07-16T09:58:00.000Z" },
    ],
    automation: { enabled: true, focus: "streamer_university", focusLabel: "Streamer University", status: "running", matchedStreams: 3, workerStatus: "processing", workerProgress: 65, workerLastFailure: { clipId: "clip-prior", error: "Prior verified retry", at: "2026-07-16T11:59:00.000Z" }, sourceIntegrity: { status: "attention", missingProductionSources: 1, checkedAt: "2026-07-16T12:00:02.000Z", detail: "1 older Studio record was excluded because its source MP4 file is missing." } },
  }, null, 2));

  const response = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/api/clipping-office/overview",
    headers: { cookie },
  });
  assert.equal(response.status, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.status, "live");
  assert.equal(payload.metrics.activeStreams, 1);
  assert.equal(payload.metrics.recordingStreams, 1);
  assert.equal(payload.metrics.metadataOnlyStreams, 0);
  assert.equal(payload.metrics.connectingStreams, 0);
  assert.equal(payload.metrics.discovery, 1);
  assert.equal(payload.metrics.studio, 3);
  assert.equal(payload.metrics.precheck, 1);
  assert.equal(payload.metrics.ready, 1);
  assert.equal(payload.metrics.localLibrary, 1);
  assert.equal(payload.watchers[0].bufferedSeconds, 142);
  assert.equal(payload.watchers[0].messagesPerMinute, 96);
  assert.equal(payload.watchers[0].thumbnailUrl, "https://example.com/jynxzi-640x360.jpg");
  assert.equal(payload.watchers[0].streamTitle, "Streamer University live");
  assert.equal(payload.watchers[0].category, "IRL");
  assert.equal(payload.watchers[0].viewerCount, 52390);
  assert.equal(payload.recentClips.length, 6);
  assert.equal(payload.dataQuality.mode, "measured");
  assert.deepEqual(payload.dataQuality.estimatedFields, []);
  assert.equal(payload.dataQuality.excludedHistoricalCandidates, 2);
  assert.equal(payload.dataQuality.excludedPracticeCandidates, 1);
  assert.equal(payload.dataQuality.missingSourceCandidates, 1);
  assert.equal(payload.dataQuality.staleActiveSessions, 0);
  assert.equal(payload.automation.focus, "streamer_university");
  assert.equal(payload.automation.matchedStreams, 3);
  assert.equal(payload.automation.workerProgress, 65);
  assert.equal(payload.automation.workerLastFailure.error, "Prior verified retry");
  assert.equal(payload.automation.sourceIntegrity.missingProductionSources, 1);
  assert.ok(payload.updatedAt);
  assert.ok(payload.sampledAt);
  assert.equal(payload.memory.totalBytes > 0, true);
  assert.equal(payload.memory.processCount >= 1, true);
  assert.equal(payload.memory.breakdown.length >= 1, true);

  const systemStatus = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/api/system/status",
    headers: { cookie },
  });
  assert.equal(systemStatus.status, 200);
  const systemPayload = JSON.parse(systemStatus.body);
  assert.equal(systemPayload.dataQuality.mode, "measured");
  assert.deepEqual(systemPayload.dataQuality.estimatedFields, []);
  assert.equal(systemPayload.metrics.find((metric) => metric.label === "Argentum RAM").measured, true);
});

test("local mode lets Clipping Office API requests work without root session cookie", async (t) => {
  const { handleArgentumRequest } = await loginLocalServer(t);
  const config = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/apps/clipping-office/api/config",
  });
  assert.equal(config.status, 200);
  const payload = JSON.parse(config.body);
  assert.equal(typeof payload.twitchConfigured, "boolean");
});

test("mounted Clips Office uses local app data instead of the packaged app bundle", async (t) => {
  const { handleArgentumRequest, cookie, dataDir } = await loginLocalServer(t);
  const health = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/apps/clipping-office/api/health",
    headers: { cookie },
  });
  assert.equal(health.status, 200);
  const payload = JSON.parse(health.body);
  assert.match(payload.app || "", /StreamClipper/i);
  assert.equal(fs.existsSync(path.join(dataDir, "clipping-office", "state.json")), true);
});

test("Twitch-only streamer scout does not render fake live cards when Twitch API is unavailable", async (t) => {
  const { handleArgentumRequest, cookie } = await loginLocalServer(t);
  const response = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/apps/clipping-office/api/streamers/recommendations?platform=twitch&limit=5",
    headers: { cookie },
  });
  assert.equal(response.status, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.fallbackUsed, true);
  assert.equal(payload.providerBlocked, true);
  assert.equal(payload.providers.twitchConfigured, false);
  assert.equal(payload.recommendations.length, 0);
  assert.equal(payload.manualReviewRecommendations.length > 0, true);
  assert.equal(payload.manualReviewRecommendations.every((item) => item.platform === "twitch"), true);
  assert.match(payload.message, /Live scout needs provider API access|Connect Twitch/i);
});

test("fallback streamer recommendations are review-only and cannot auto-monitor without Twitch API", async (t) => {
  const { handleArgentumRequest, cookie } = await loginLocalServer(t);
  const recommendations = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/apps/clipping-office/api/streamers/recommendations?platform=twitch&limit=1",
    headers: { cookie },
  });
  assert.equal(recommendations.status, 200);
  const item = JSON.parse(recommendations.body).manualReviewRecommendations[0];
  assert.equal(item.platform, "twitch");
  assert.equal(item.liveVerified, false);
  assert.equal(item.canAutoMonitor, false);

  const created = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/apps/clipping-office/api/twitch/streamers",
    headers: { cookie, "content-type": "application/json", origin: "http://127.0.0.1:5173" },
    body: JSON.stringify({
      platform: item.platform,
      displayName: item.displayName,
      channelId: item.channelId,
      channelUrl: item.channelUrl,
      permissionStatus: "approved",
      monitorEnabled: true,
      liveStatus: item.liveStatus,
      notes: "Regression test: fallback scout add should not watch automatically.",
    }),
  });
  assert.equal(created.status, 201);
  const streamer = JSON.parse(created.body).streamer;
  assert.equal(streamer.permissionStatus, "pending");
  assert.equal(streamer.monitorEnabled, false);
  assert.equal(streamer.liveStatus, "api_not_configured");
  assert.match(streamer.liveStatusReason, /API is not configured/i);
});

test("local Twitch secrets feed Clips Office config without exposing raw values", async (t) => {
  const { handleArgentumRequest, cookie } = await loginLocalServer(t);
  const clientId = "local-test-twitch-client-id";
  const clientSecret = "local-test-twitch-client-secret";
  for (const [provider, value] of [["twitch_client_id", clientId], ["twitch_client_secret", clientSecret]]) {
    const saved = await invoke(handleArgentumRequest, {
      method: "POST",
      url: "/api/local/secrets",
      headers: { cookie, "content-type": "application/json", origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({ provider, value }),
    });
    assert.equal(saved.status, 200);
    const payload = JSON.parse(saved.body);
    assert.equal(payload.configured, true);
    assert.equal(payload.clippingOfficeReloaded, true);
    assert.equal(saved.body.includes(value), false);
  }

  const config = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/apps/clipping-office/api/config",
    headers: { cookie },
  });
  assert.equal(config.status, 200);
  const payload = JSON.parse(config.body);
  assert.equal(payload.twitchConfigured, true);
  assert.equal(config.body.includes(clientId), false);
  assert.equal(config.body.includes(clientSecret), false);
});

test("local Mac app-data env file feeds Clips Office provider config", async (t) => {
  const clientId = "env-file-twitch-client-id";
  const clientSecret = "env-file-twitch-client-secret";
  const { handleArgentumRequest, cookie } = await loginLocalServer(t, {
    localEnvContent: [
      `TWITCH_CLIENT_ID=${clientId}`,
      `TWITCH_CLIENT_SECRET=${clientSecret}`,
      "KICK_CLIENT_ID=env-file-kick-client-id",
      "KICK_CLIENT_SECRET=env-file-kick-client-secret",
      "",
    ].join("\n"),
  });
  const config = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/apps/clipping-office/api/config",
    headers: { cookie },
  });
  assert.equal(config.status, 200);
  const payload = JSON.parse(config.body);
  assert.equal(payload.twitchConfigured, true);
  assert.equal(payload.kickConfigured, true);
  assert.equal(config.body.includes(clientId), false);
  assert.equal(config.body.includes(clientSecret), false);
});

test("authenticated local desktop exposes root and mounted office pages", async (t) => {
  const { handleArgentumRequest, cookie } = await loginLocalServer(t);
  const server = http.createServer(handleArgentumRequest);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const routes = [
    ["/", /Argentum/i],
    ["/apps/clipping-office/", /StreamClipper|Clipping Office/i],
    ["/apps/stock-office/", /Stock Office/i],
    ["/apps/etsy-office/", /Argentum Business Office/i],
    ["/apps/essentrx-office/", /Argentum Business Office/i],
  ];
  for (const [url, pattern] of routes) {
    const response = await fetch(`${baseUrl}${url}`, { headers: { cookie } });
    const body = await response.text();
    assert.equal(response.status, 200, url);
    assert.match(body, pattern, url);
  }

  const stockOverview = await fetch(`${baseUrl}/api/stock-office/overview`, { headers: { cookie } });
  assert.equal(stockOverview.status, 200);
  const stockPayload = await stockOverview.json();
  assert.equal(stockPayload.workspace.mode, "broker_onboarding_guarded");
  assert.equal(stockPayload.permissions.canTrade, false);
  assert.equal(stockPayload.permissions.canDraftBrokerOrder, true);
  assert.equal(stockPayload.mirror.summary.liveOrdersPlaced, 0);

  const brokerControlResponse = await fetch(`${baseUrl}/api/stock-office/broker-control`, { headers: { cookie } });
  assert.equal(brokerControlResponse.status, 200);
  const brokerControlPayload = await brokerControlResponse.json();
  assert.equal(brokerControlPayload.brokerControl.provider, "Robinhood Agentic Trading");
  assert.equal(brokerControlPayload.brokerControl.accountScope, "dedicated_agentic_account_only");
  assert.equal(brokerControlPayload.brokerControl.liveOrdersPlacedThisSession, 0);

  const essentrxOffice = await fetch(`${baseUrl}/api/offices/essentrx-office`, { headers: { cookie } });
  assert.equal(essentrxOffice.status, 200);
  assert.equal((await essentrxOffice.json()).office.id, "essentrx-office");
});

test("Stock Office sends a fresh paper mirror to Human Gate without broker execution", async (t) => {
  const stockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-stock-mirror-route-"));
  t.after(() => fs.rmSync(stockRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(stockRoot, "reports"), { recursive: true });
  fs.mkdirSync(path.join(stockRoot, "config"), { recursive: true });
  fs.writeFileSync(path.join(stockRoot, "config", "copy_trader.json"), JSON.stringify({ execution_mode: "paper_and_human_gate_only" }));
  fs.writeFileSync(path.join(stockRoot, "reports", "copy_trader_plan.json"), JSON.stringify({
    version: 1,
    generated_at: new Date().toISOString(),
    mode: "paper_and_human_gate_only",
    policy: { total_budget_dollars: 25, max_trade_dollars: 5, max_daily_notional_dollars: 10 },
    sources: [{ id: "sec_form4", name: "SEC Form 4", enabled: true, mirror_eligible: true, source_type: "official_disclosure", max_disclosure_lag_hours: 96 }],
    summary: { signals_received: 1, paper_ready: 1, research_only: 0, rejected: 0, duplicate: 0, planned_paper_notional_dollars: 5, live_orders_placed: 0, human_gate_required_for_live: true },
    candidates: [{
      id: "mirror-route-test",
      fingerprint: "b".repeat(64),
      source_id: "sec_form4",
      source_name: "SEC Form 4",
      trader_name: "Example reporting person",
      asset_type: "equity",
      symbol: "BAC",
      side: "BUY",
      transaction_code: "P",
      transaction_at: "2026-08-08T14:00:00Z",
      disclosed_at: "2026-08-09T14:00:00Z",
      observed_at: "2026-08-09T14:01:00Z",
      source_url: "https://www.sec.gov/Archives/edgar/data/example",
      disclosure_lag_hours: 24,
      signal_age_hours: 24,
      signal_price: 40,
      current_price: 40.4,
      price_drift_pct: 0.01,
      confidence: 0.95,
      status: "paper_ready",
      mirror_notional_dollars: 5,
      mirror_shares: 0.12376238,
      human_gate_eligible: true,
      reasons: ["Passed public-source and bankroll checks."],
    }],
    warnings: ["No live order is available."],
  }));

  const { handleArgentumRequest, cookie } = await loginLocalServer(t, { stockGuruPath: stockRoot });
  const response = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/api/stock-office/mirror/mirror-route-test/human-gate",
    headers: { cookie, "content-type": "application/json", origin: "http://127.0.0.1:5173" },
    body: "{}",
  });
  assert.equal(response.status, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.liveOrderPlaced, false);
  assert.equal(payload.approval.actionType, "review_trade_plan");
  assert.equal(payload.approval.status, "pending");
  assert.equal(payload.approval.details.executionAvailable, false);
  assert.match(payload.approval.exactScope, /No order placement/i);

  const duplicate = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/api/stock-office/mirror/mirror-route-test/human-gate",
    headers: { cookie, "content-type": "application/json", origin: "http://127.0.0.1:5173" },
    body: "{}",
  });
  assert.equal(duplicate.status, 200);
  assert.equal(JSON.parse(duplicate.body).approval.id, payload.approval.id);
});

test("Stock Office order approval produces one claim and consumes it on broker-review rejection", async (t) => {
  const stockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-stock-dispatch-route-"));
  t.after(() => fs.rmSync(stockRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(stockRoot, "reports"), { recursive: true });
  fs.mkdirSync(path.join(stockRoot, "config"), { recursive: true });
  fs.mkdirSync(path.join(stockRoot, "data"), { recursive: true });
  const timestamp = new Date().toISOString();
  fs.writeFileSync(path.join(stockRoot, "reports", "evaluations.json"), JSON.stringify([{
    ticker: "NET",
    decision: "VALID_BUY_SETUP",
    score: 90,
    current_price: 100,
    stop_loss: 95,
    target_1: 110,
    data_fresh: true,
    setup_type: "Trend Continuation",
    main_risk: "Use a hard stop.",
  }]));
  fs.writeFileSync(path.join(stockRoot, "config", "settings.json"), JSON.stringify({
    live_principal_dollars: 100,
    live_max_total_dollars: 100,
    live_max_order_dollars: 20,
    live_min_order_dollars: 1,
    live_cash_reserve_dollars: 10,
    daily_loss_limit_pct: 0.02,
    risk_per_trade_pct: 0.01,
    intraday_min_entry_score: 85,
    max_positions: 5,
    max_trades_per_day: 3,
  }));
  fs.writeFileSync(path.join(stockRoot, "data", "broker_status.json"), JSON.stringify({
    account_number: "agentic-route-test",
    account_identity_hash: "c".repeat(64),
    account_value: 100,
    cash: 100,
    buying_power: 100,
    day_pnl_dollars: 0,
    positions: [],
    open_orders: [],
    orders: [],
    updated_at: timestamp,
    connector: {
      registered: true,
      oauth_authenticated: true,
      endpoint: ROBINHOOD_MCP_URL,
      tools: REQUIRED_EQUITY_TOOLS,
      observed_at: timestamp,
    },
  }));
  fs.writeFileSync(path.join(stockRoot, "data", "live_auto_arm_plan.json"), JSON.stringify({
    generated_at: timestamp,
    action: "READY_FOR_EXACT_APPROVAL",
    readiness: { ready_for_live_auto: true, checks: [] },
    blockers: [],
  }));
  fs.writeFileSync(path.join(stockRoot, "data", "live_auto_launch_checklist.json"), JSON.stringify({
    generated_at: timestamp,
    ready_for_live_auto: true,
    readiness: { checks: [] },
  }));
  fs.writeFileSync(path.join(stockRoot, "data", "live_auto_kill_switch.json"), JSON.stringify({
    enabled: false,
    reason: "Test operator cleared entries.",
    updated_at: timestamp,
  }));

  const { handleArgentumRequest, cookie } = await loginLocalServer(t, { stockGuruPath: stockRoot, trustBrokerFixture: true, executionMode: "live" });
  const headers = { cookie, "content-type": "application/json", origin: "http://127.0.0.1:5173" };
  const draftResponse = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/api/stock-office/orders/draft",
    headers,
    body: JSON.stringify({ symbol: "NET", side: "BUY", requestedDollars: 10 }),
  });
  assert.equal(draftResponse.status, 200);
  const draft = JSON.parse(draftResponse.body).draft;
  assert.equal(draft.status, "ready_for_broker_review", JSON.stringify(draft.blockers));
  assert.equal(draft.liveOrderPlaced, false);

  const gateResponse = await invoke(handleArgentumRequest, {
    method: "POST",
    url: `/api/stock-office/orders/${encodeURIComponent(draft.id)}/human-gate`,
    headers,
    body: "{}",
  });
  assert.equal(gateResponse.status, 200);
  const gated = JSON.parse(gateResponse.body);
  assert.equal(gated.draft.status, "awaiting_human_gate");
  assert.equal(gated.liveOrderPlaced, false);

  const approvalResponse = await invoke(handleArgentumRequest, {
    method: "POST",
    url: `/api/approvals/${encodeURIComponent(gated.approval.id)}/approve`,
    headers,
    body: "{}",
  });
  assert.equal(approvalResponse.status, 200);
  const approvedState = JSON.parse(approvalResponse.body);
  const consumedApproval = approvedState.approvals.find((item) => item.id === gated.approval.id);
  assert.equal(consumedApproval.executionOutcome, "broker_execution_stopped");
  assert.ok(consumedApproval.consumedAt, JSON.stringify(consumedApproval));
  assert.equal(consumedApproval.useCount, 1);
  assert.doesNotMatch(consumedApproval.executionError || "", /settled|before initialization/i);
  const stoppedDraft = approvedState.stockOffice.tradeDrafts.find((item) => item.id === draft.id);
  assert.notEqual(stoppedDraft.status, "awaiting_human_gate");
  assert.notEqual(stoppedDraft.status, "dispatch_claimed");

  const claimResponse = await invoke(handleArgentumRequest, {
    method: "POST",
    url: `/api/stock-office/orders/${encodeURIComponent(draft.id)}/dispatch/claim`,
    headers,
    body: "{}",
  });
  assert.equal(claimResponse.status, 409);
  assert.match(JSON.parse(claimResponse.body).error, /cannot be reused|not approved for dispatch/i);
});

test("Human Gate blocks dangerous Agent 101 actions locally", async (t) => {
  const { handleArgentumRequest, cookie } = await loginLocalServer(t);
  const response = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/api/agent101/chat",
    headers: { cookie, "content-type": "application/json", origin: "http://127.0.0.1:5173" },
    body: JSON.stringify({ message: "Post this video to TikTok right now." }),
  });
  assert.equal(response.status, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.requiresApproval, true);
  assert.equal(payload.approval.status, "pending");
  assert.match(payload.message, /Human Gate/i);
});

test("Agent 101 reports Clip Office as executive operating intelligence", async (t) => {
  const { handleArgentumRequest, cookie, dataDir } = await loginLocalServer(t);
  const clippingDir = path.join(dataDir, "clipping-office");
  fs.mkdirSync(clippingDir, { recursive: true });
  fs.writeFileSync(path.join(clippingDir, "state.json"), JSON.stringify({
    streamers: [
      { id: "streamer-1", displayName: "LiveOne", monitorEnabled: true, liveStatus: "live" },
      { id: "streamer-2", displayName: "OfflineTwo", monitorEnabled: true, liveStatus: "offline" },
    ],
    watchSessions: [
      { id: "session-1", streamerId: "streamer-1", status: "watching" },
    ],
    clipCandidates: [
      { id: "candidate-1", streamerId: "streamer-1", status: "recording", decision: "review", score: 64 },
      { id: "candidate-2", streamerId: "streamer-1", status: "ready", decision: "accepted", score: 88 },
      { id: "candidate-3", streamerId: "streamer-1", status: "dismissed", decision: "dismissed", score: 20 },
    ],
    clipPackages: [{ id: "package-1", candidateId: "candidate-2" }],
    postingDrafts: [{ id: "draft-1", status: "pending" }],
    approvalRequests: [{ id: "approval-1", status: "pending", actionType: "publish_video" }],
    mediaJobs: [
      { id: "job-1", status: "completed" },
      { id: "job-2", status: "failed" },
    ],
    artifacts: [{ id: "artifact-1", type: "rendered_clip" }],
  }, null, 2));

  const response = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/api/agent101/chat",
    headers: { cookie, "content-type": "application/json", origin: "http://127.0.0.1:5173" },
    body: JSON.stringify({
      message: "How is Clip Office doing?",
      roomId: "clips-office",
      chatHistory: [{ role: "user", content: "Prior decision: prioritize Twitch evening stream monitoring." }],
    }),
  });
  assert.equal(response.status, 200);
  const payload = JSON.parse(response.body);
  assert.match(payload.message, /CLIP OFFICE STATUS/);
  assert.match(payload.message, /CURRENT STATUS/);
  assert.match(payload.message, /KEY FINDINGS/);
  assert.match(payload.message, /RISKS/);
  assert.match(payload.message, /RECOMMENDATIONS/);
  assert.match(payload.message, /NEXT ACTIONS/);
  assert.match(payload.message, /Active streams: 1/);
  assert.match(payload.message, /Streamers monitored: 2\/2/);
  assert.match(payload.message, /Candidate clips: 3/);
  assert.match(payload.message, /Clips approved: 1/);
  assert.match(payload.message, /Clips pending: 1/);
  assert.match(payload.message, /Posting queue: 1 pending draft/);
  assert.match(payload.message, /Failures: 1/);
  assert.match(payload.message, /Success rate: 33%/);
  assert.match(payload.message, /Thread memory retained/);
  assert.doesNotMatch(payload.message, /User asked|System detected|I attempted|I was unable|I need clarification|Would you like|Based on your request|Here's what I found|I can help with that/i);
  assert.equal(payload.taskType, "clips");
  assert.equal(payload.requiresApproval, false);
});

test("Agent 101 operating-system payload exposes intelligence identity", async (t) => {
  const { handleArgentumRequest, cookie } = await loginLocalServer(t);
  const response = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/api/agent101/operating-system",
    headers: { cookie },
  });
  assert.equal(response.status, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.agent.promptVersion, "agent101-founder-operator-v3");
  assert.match(payload.agent.instructions, /Chief Operations Intelligence Agent/);
  assert.match(payload.agent.instructions, /CURRENT STATUS/);
  assert.match(payload.operatingPack.sections.constitution, /Chief Operations Intelligence Agent/);
});

test("Human Gate limited decisions preserve original scope and reject unknown authority", async (t) => {
  const { handleArgentumRequest, cookie } = await loginLocalServer(t);
  const createdResponse = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/api/human-gate/requests",
    headers: { cookie, "content-type": "application/json", origin: "http://127.0.0.1:5173" },
    body: JSON.stringify({
      actionType: "customer_email",
      title: "Review one customer email draft",
      details: { recipient: "buyer@example.test", templateId: "order-ready" },
      exactScope: "One email to the recorded recipient using the recorded template.",
      riskLevel: "high",
    }),
  });
  assert.equal(createdResponse.status, 200);
  const created = JSON.parse(createdResponse.body).approval;
  assert(created?.id);

  const invalidResponse = await invoke(handleArgentumRequest, {
    method: "POST",
    url: `/api/human-gate/requests/${encodeURIComponent(created.id)}/decision`,
    headers: { cookie, "content-type": "application/json", origin: "http://127.0.0.1:5173" },
    body: JSON.stringify({
      decision: "approve_limited",
      grantedDetails: { recipient: "buyer@example.test", publishWebsite: true },
    }),
  });
  assert.equal(invalidResponse.status, 400);

  const limitedResponse = await invoke(handleArgentumRequest, {
    method: "POST",
    url: `/api/human-gate/requests/${encodeURIComponent(created.id)}/decision`,
    headers: { cookie, "content-type": "application/json", origin: "http://127.0.0.1:5173" },
    body: JSON.stringify({
      decision: "approve_limited",
      grantedDetails: { recipient: "buyer@example.test", templateId: "order-ready" },
      note: "Only this recorded recipient and template.",
    }),
  });
  assert.equal(limitedResponse.status, 200);
  const decided = JSON.parse(limitedResponse.body).request;
  assert.equal(decided.status, "approved");
  assert.deepEqual(decided.originalDetails, { recipient: "buyer@example.test", templateId: "order-ready" });
  assert.deepEqual(decided.grantedDetails, { recipient: "buyer@example.test", templateId: "order-ready" });
  assert.equal(decided.originalExactScope, "One email to the recorded recipient using the recorded template.");
  assert.equal(decided.useCount, 0);
  assert.equal(decided.consumedAt, null);
});

test("local job runner queues safe work and blocks dangerous file actions", async (t) => {
  const { handleArgentumRequest, cookie } = await loginLocalServer(t);

  const safe = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/api/local/jobs",
    headers: { cookie, "content-type": "application/json", origin: "http://127.0.0.1:5173" },
    body: JSON.stringify({ goal: "Draft a local Clips Office checklist." }),
  });
  assert.equal(safe.status, 201);
  assert.equal(JSON.parse(safe.body).job.status, "queued");

  const blocked = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/api/local/jobs",
    headers: { cookie, "content-type": "application/json", origin: "http://127.0.0.1:5173" },
    body: JSON.stringify({ goal: "Delete files from my Desktop folder." }),
  });
  assert.equal(blocked.status, 201);
  const payload = JSON.parse(blocked.body);
  assert.equal(payload.requiresApproval, true);
  assert.equal(payload.job.status, "waiting_approval");
  assert.equal(payload.approval.status, "pending");
  assert.equal(payload.approval.actionType, "delete_file");
});

test("Electron Mac app entrypoint is configured", () => {
  const pkg = require("../package.json");
  const mainSource = fs.readFileSync(path.join(__dirname, "..", "desktop", "main.js"), "utf8");
  const preloadSource = fs.readFileSync(path.join(__dirname, "..", "desktop", "preload.js"), "utf8");
  assert.equal(pkg.main, "desktop/main.js");
  assert.equal(pkg.build.productName, "Argentum OS");
  assert.equal(fs.existsSync(path.join(__dirname, "..", "desktop", "main.js")), true);
  assert.equal(fs.existsSync(path.join(__dirname, "..", "desktop", "preload.js")), true);
  assert.match(mainSource, /titleBarStyle:\s*"default"/);
  assert.match(mainSource, /argentum:choose-file/);
  assert.match(mainSource, /createClippingAutomationWindow/);
  assert.match(mainSource, /automation-worker=1/);
  assert.match(mainSource, /backgroundThrottling:\s*false/);
  assert.match(mainSource, /offscreen:\s*true/);
  assert.match(mainSource, /fork\(entryPath/);
  assert.match(mainSource, /ELECTRON_RUN_AS_NODE: "1"/);
  assert.doesNotMatch(mainSource, /require\("\.\.\/server"\)/);
  assert.match(preloadSource, /chooseFile/);
  assert.equal(mainSource.includes("trafficLightPosition"), false);
});

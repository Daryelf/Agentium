const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const PORT = 5792;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let server;
let userDataPath;

async function waitForServer() {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${ORIGIN}/`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error("Argentum callback test server did not start");
}

function requestStatus({ method = "GET", requestPath, host = "127.0.0.1" }) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port: PORT,
      method,
      path: requestPath,
      headers: { host },
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", reject);
    request.end();
  });
}

test.before(async () => {
  userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-robinhood-callback-"));
  server = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      ARGENTUM_STOCK_GURU_DATA_DIR: userDataPath,
      SESSION_SECRET: "callback-test-session-secret-callback-test-session-secret",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer();
});

test.after(() => {
  server?.kill("SIGTERM");
  fs.rmSync(userDataPath, { recursive: true, force: true });
});

test("loopback Robinhood callback reaches one-use state validation without an Argentum session", async () => {
  const response = await fetch(`${ORIGIN}/api/stock-office/robinhood/oauth/callback?code=test-code&state=test-state`);
  const body = await response.text();

  assert.equal(response.status, 400);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(body, /Robinhood did not connect/);
  assert.match(body, /No trade or money movement occurred/);
  assert.doesNotMatch(body, /Authentication required/);
  assert.doesNotMatch(body, /test-code|test-state/);
});

test("remote-host and wrong-method callback requests do not bypass Argentum authentication", async () => {
  const remoteHostStatus = await requestStatus({
    requestPath: "/api/stock-office/robinhood/oauth/callback?code=test-code&state=test-state",
    host: "example.com",
  });
  assert.equal(remoteHostStatus, 401);

  const wrongMethod = await fetch(`${ORIGIN}/api/stock-office/robinhood/oauth/callback?code=test-code&state=test-state`, {
    method: "POST",
  });
  assert.equal(wrongMethod.status, 401);
});

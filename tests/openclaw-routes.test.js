const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
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
      host: "127.0.0.1",
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

test("OpenClaw runtime routes require admin session and expose safe status only", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-openclaw-route-"));
  process.env.ARGENTUM_DATA_DIR = dataDir;
  process.env.SESSION_SECRET = "route-test-session-secret-route-test-session-secret-route-test-session-secret";
  process.env.ADMIN_USERNAME = "routeadmin";
  process.env.ADMIN_PASSWORD = "RouteAdmin12345";
  process.env.OPENCLAW_ENABLED = "false";
  process.env.OPENCLAW_GATEWAY_TOKEN = "route-secret-token";

  delete require.cache[require.resolve("../server")];
  const { handleArgentumRequest } = require("../server");
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  const unauthenticated = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/api/agent-runtime/openclaw/status",
  });
  assert.equal(unauthenticated.status, 401);

  const publicConnectors = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/api/connectors/status",
  });
  if (publicConnectors.status === 200) {
    assert.equal(JSON.parse(publicConnectors.body).connectors.some((connector) => connector.id === "openclaw"), false);
  } else {
    assert.equal(publicConnectors.status, 401);
  }

  const publicGenericTest = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/api/connectors/openclaw/test",
  });
  assert.equal(publicGenericTest.status, 401);

  const login = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/login",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username: "routeadmin",
      password: "RouteAdmin12345",
    }).toString(),
  });
  assert.equal(login.status, 302);
  const setCookie = login.headers["set-cookie"] || "";
  const cookie = setCookie.split(";")[0];
  assert.match(cookie, /^argentum_session=/);

  const status = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/api/agent-runtime/openclaw/status",
    headers: { cookie },
  });
  assert.equal(status.status, 200);
  const payload = JSON.parse(status.body);
  const serialized = JSON.stringify(payload);

  assert.equal(payload.status.provider || payload.status.id, "openclaw");
  assert.equal(payload.status.tokenConfigured, true);
  assert.equal(serialized.includes("route-secret-token"), false);
  assert.equal(serialized.includes("OPENCLAW_GATEWAY_TOKEN"), false);
  assert.equal(payload.status.secretEnv.includes("Gateway token"), true);

  const adminConnectors = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/api/connectors/status",
    headers: { cookie },
  });
  assert.equal(adminConnectors.status, 200);
  assert.equal(JSON.parse(adminConnectors.body).connectors.some((connector) => connector.id === "openclaw"), true);
});

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const test = require("node:test");

function invoke(handler, options = {}) {
  return new Promise((resolve, reject) => {
    const req = new Readable({
      read() {
        this.push(options.body || "");
        this.push(null);
      },
    });
    req.method = options.method || "GET";
    req.url = options.url || "/";
    req.headers = {
      host: "argentum.example",
      "x-forwarded-proto": "https",
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

async function cloudServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-public-site-"));
  const originalEnv = { ...process.env };
  Object.assign(process.env, {
    APP_MODE: "cloud",
    HOST: "0.0.0.0",
    PORT: "5173",
    ARGENTUM_DATA_DIR: dataDir,
    SESSION_SECRET: "public-website-test-session-secret-public-website-test-session-secret",
    ADMIN_USERNAME: "",
    ADMIN_PASSWORD: "",
    ARGENTUM_SKIP_PROJECT_ENV: "true",
  });

  delete require.cache[require.resolve("../server")];
  const { handleArgentumRequest } = require("../server");
  t.after(() => {
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) delete process.env[key];
    });
    Object.assign(process.env, originalEnv);
    fs.rmSync(dataDir, { recursive: true, force: true });
    delete require.cache[require.resolve("../server")];
  });
  return handleArgentumRequest;
}

test("cloud root serves the public Argentum website before admin setup", async (t) => {
  const handler = await cloudServer(t);
  const response = await invoke(handler, { url: "/" });

  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /text\/html/);
  assert.match(response.body, /Supervised content operations/);
  assert.match(response.body, /href="\/terms"/);
  assert.match(response.body, /href="\/privacy"/);
  assert.match(response.body, /content="https:\/\/argentum\.example\/og\.png"/);
  assert.doesNotMatch(response.body, /Create Admin Login/);
});

test("Terms, Privacy, Support, and public assets work without authentication", async (t) => {
  const handler = await cloudServer(t);
  const routes = [
    ["/terms", /Terms of Service/],
    ["/privacy", /Privacy Policy/],
    ["/support", /Support, privacy, and data requests/],
    ["/website.css", /--acid:/],
    ["/robots.txt", /Disallow: \/api\//],
  ];

  for (const [url, expected] of routes) {
    const response = await invoke(handler, { url });
    assert.equal(response.status, 200, url);
    assert.match(response.body, expected, url);
  }
});

test("cloud operator console remains private and first-run setup lives at /setup", async (t) => {
  const handler = await cloudServer(t);

  const app = await invoke(handler, { url: "/app" });
  assert.equal(app.status, 302);
  assert.equal(app.headers.location, "/login");

  const login = await invoke(handler, { url: "/login" });
  assert.equal(login.status, 302);
  assert.equal(login.headers.location, "/setup");

  const setup = await invoke(handler, { url: "/setup" });
  assert.equal(setup.status, 200);
  assert.match(setup.body, /Create Admin Login/);
  assert.match(setup.body, /action="\/setup"/);
});

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const PORT = 5791;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let server;

async function waitForServer() {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${ORIGIN}/`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error("Argentum test server did not start");
}

test.before(async () => {
  server = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      SESSION_SECRET: "public-website-test-session-secret-public-website-test-session-secret",
      ADMIN_USERNAME: "",
      ADMIN_PASSWORD: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer();
});

test.after(() => {
  server?.kill("SIGTERM");
});

test("public homepage and legal routes work while signed out", async () => {
  const routes = [
    ["/", /Supervised content operations/],
    ["/terms", /Terms of Service/],
    ["/privacy", /Privacy Policy/],
    ["/support", /Support, privacy, and data requests/],
  ];

  for (const [route, expected] of routes) {
    const response = await fetch(`${ORIGIN}${route}`);
    assert.equal(response.status, 200, route);
    assert.equal(response.headers.get("x-argentum-site"), "public", route);
    assert.match(await response.text(), expected, route);
  }
});

test("admin login and setup routes are removed from the public website", async () => {
  for (const route of ["/app", "/app/", "/login", "/setup"]) {
    const response = await fetch(`${ORIGIN}${route}`, { redirect: "manual" });
    assert.equal(response.status, 302, route);
    assert.equal(response.headers.get("location"), "/", route);
  }
});

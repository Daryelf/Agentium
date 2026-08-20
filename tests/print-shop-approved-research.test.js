"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const test = require("node:test");

function invoke(handler, options = {}) {
  return new Promise((resolve, reject) => {
    const request = new Readable({
      read() {
        this.push(options.body || "");
        this.push(null);
      },
    });
    request.method = options.method || "GET";
    request.url = options.url || "/";
    request.headers = {
      host: "127.0.0.1:5173",
      origin: "http://127.0.0.1:5173",
      ...(options.headers || {}),
    };
    request.socket = { remoteAddress: "127.0.0.1", encrypted: false };

    const chunks = [];
    const response = {
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
      on() {},
      once() {},
      removeListener() {},
      emit() {},
      destroy(error) {
        if (error) reject(error);
      },
    };

    Promise.resolve(handler(request, response)).catch(reject);
  });
}

async function authenticatedServer(t, options = {}) {
  const originalEnvironment = { ...process.env };
  const originalFetch = globalThis.fetch;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-print-research-route-"));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-print-research-home-"));
  const fetchCalls = [];

  globalThis.fetch = async (...args) => {
    fetchCalls.push(args);
    if (typeof options.fetchImpl === "function") return options.fetchImpl(...args);
    throw new Error("Unexpected external fetch in Print Shop research test.");
  };

  Object.assign(process.env, {
    APP_MODE: "local",
    HOST: "127.0.0.1",
    PORT: "5173",
    LOCAL_BACKEND_PORT: "5173",
    HOME: homeDir,
    ARGENTUM_DATA_DIR: dataDir,
    ARGENTUM_PRINT_SHOP_DATA_DIR: dataDir,
    ARGENTUM_SKIP_PROJECT_ENV: "true",
    ARGENTUM_DISABLE_KEYCHAIN: "true",
    SESSION_SECRET: "print-shop-research-session-secret-print-shop-research-session-secret-123",
    ADMIN_USERNAME: "",
    ADMIN_PASSWORD: "",
    OPENAI_API_KEY: "",
    BRAVE_API_KEY: options.braveApiKey || "",
    SERP_API_KEY: options.serpApiKey || "",
  });

  delete require.cache[require.resolve("../server")];
  const { handleArgentumRequest } = require("../server");
  const setup = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username: "printresearchadmin",
      password: "secure-print-research-1234",
      confirmPassword: "secure-print-research-1234",
      savePassword: "on",
    }).toString(),
  });
  assert.equal(setup.status, 302);
  const cookie = String(setup.headers["set-cookie"] || "").split(";")[0];
  assert.match(cookie, /^argentum_session=/);

  t.after(() => {
    globalThis.fetch = originalFetch;
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnvironment)) delete process.env[key];
    });
    Object.assign(process.env, originalEnvironment);
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    delete require.cache[require.resolve("../server")];
  });

  return { handler: handleArgentumRequest, cookie, dataDir, fetchCalls };
}

function jsonRequest(handler, cookie, method, url, body = {}) {
  return invoke(handler, {
    method,
    url,
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createResearchRequest(runtime, query, geography = "United States") {
  const response = await jsonRequest(
    runtime.handler,
    runtime.cookie,
    "POST",
    "/api/print-shop/research-requests",
    { query, geography },
  );
  return { response, payload: JSON.parse(response.body) };
}

async function decideApproval(runtime, approvalId, decision) {
  const response = await jsonRequest(
    runtime.handler,
    runtime.cookie,
    "POST",
    `/api/human-gate/requests/${encodeURIComponent(approvalId)}/decision`,
    { decision },
  );
  return { response, payload: JSON.parse(response.body) };
}

async function runResearch(runtime, requestId, approvalId) {
  const response = await jsonRequest(
    runtime.handler,
    runtime.cookie,
    "POST",
    `/api/print-shop/research-requests/${encodeURIComponent(requestId)}/run`,
    { approvalId },
  );
  return { response, payload: JSON.parse(response.body) };
}

function rewriteApproval(dataDir, approvalId, update) {
  const statePath = path.join(dataDir, "argentum-state.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const approval = state.approvals.find((item) => item.id === approvalId);
  assert(approval, `Missing approval ${approvalId}`);
  Object.assign(approval, update);
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

test("Print Shop research without a configured provider creates no approval and performs no fetch", async (t) => {
  const runtime = await authenticatedServer(t);
  const { response, payload } = await createResearchRequest(runtime, "compact one-color desk organizer");

  assert.equal(response.status, 409);
  assert.match(payload.error, /research|Brave|SERP|provider|configured/i);
  assert.equal(runtime.fetchCalls.length, 0);

  const approvalsResponse = await invoke(runtime.handler, {
    url: "/api/human-gate/requests",
    headers: { cookie: runtime.cookie },
  });
  const approvals = JSON.parse(approvalsResponse.body).requests;
  assert.equal(approvals.some((approval) => approval.officeId === "print-shop-office"), false);

  const workspaceResponse = await invoke(runtime.handler, {
    url: "/api/print-shop/workspace",
    headers: { cookie: runtime.cookie },
  });
  const workspace = JSON.parse(workspaceResponse.body);
  assert.equal(workspace.truth.researchSearchConfigured, false);
  assert.equal(workspace.truth.researchSearchProvider, null);
  assert.equal(workspace.truth.externalMarketEvidenceCollected, false);
  assert.equal(workspace.truth.marketDemandMeasured, false);
  assert.deepEqual(workspace.researchRequests, []);
});

test("configured Brave research records an exact unused approval without fetching", async (t) => {
  const runtime = await authenticatedServer(t, {
    braveApiKey: "brave-print-research-test-key",
    serpApiKey: "serp-must-not-win-when-brave-is-configured",
  });
  const query = "modular cable organizer for a Bambu A1 Mini";
  const { response, payload } = await createResearchRequest(runtime, query);

  assert.equal(response.status, 202);
  assert.equal(payload.requiresApproval, true);
  assert.equal(payload.request.status, "pending_approval");
  assert.equal(payload.request.provider, "brave");
  assert.deepEqual(payload.request.sources, []);
  assert.deepEqual(payload.request.claims, []);
  assert.equal(runtime.fetchCalls.length, 0, "creating a research request must not contact Brave");

  const { approval } = payload;
  assert.equal(approval.actionType, "agent101_web_search");
  assert.equal(approval.officeId, "print-shop-office");
  assert.equal(approval.linkedId, `print-shop-research:${payload.request.queryHash}`);
  assert.equal(approval.status, "pending");
  assert.equal(approval.useCount, 0);
  assert.equal(approval.consumedAt, null);
  assert.deepEqual(approval.details, {
    officeId: "print-shop-office",
    provider: "brave",
    queryHash: payload.request.queryHash,
    geography: "United States",
    maximumCalls: 1,
    maximumResults: 8,
  });
  assert.deepEqual(approval.originalDetails, approval.details);
  assert.match(approval.exactScope, /one.*research|one.*Brave/i);
  assert.match(approval.exactScope, /at most 8/i);
  assert.equal(JSON.stringify(payload).includes("brave-print-research-test-key"), false);

  const workspaceResponse = await invoke(runtime.handler, {
    url: "/api/print-shop/workspace",
    headers: { cookie: runtime.cookie },
  });
  const workspace = JSON.parse(workspaceResponse.body);
  assert.equal(workspace.truth.researchSearchConfigured, true);
  assert.equal(workspace.truth.researchSearchProvider, "brave");
  assert.equal(workspace.truth.externalMarketEvidenceCollected, false);
  assert.equal(workspace.truth.marketDemandMeasured, false);
});

test("wrong, blocked, and expired Print Shop approvals cannot contact the provider", async (t) => {
  const runtime = await authenticatedServer(t, { braveApiKey: "brave-print-research-test-key" });

  const first = await createResearchRequest(runtime, "small printable cable guide");
  const second = await createResearchRequest(runtime, "small printable drawer label");
  assert.equal(first.response.status, 202);
  assert.equal(second.response.status, 202);
  await decideApproval(runtime, second.payload.approval.id, "approve");

  const wrong = await runResearch(runtime, first.payload.request.id, second.payload.approval.id);
  assert.ok([403, 409].includes(wrong.response.status), wrong.response.body);
  assert.equal(runtime.fetchCalls.length, 0, "approval for another exact query must not authorize fetch");

  const blockedRequest = await createResearchRequest(runtime, "single-color desktop token tray");
  await decideApproval(runtime, blockedRequest.payload.approval.id, "block");
  const blocked = await runResearch(runtime, blockedRequest.payload.request.id, blockedRequest.payload.approval.id);
  assert.ok([403, 409].includes(blocked.response.status), blocked.response.body);
  assert.equal(runtime.fetchCalls.length, 0, "a blocked approval must not authorize fetch");

  const expiredRequest = await createResearchRequest(runtime, "single-color headphone cable clip");
  await decideApproval(runtime, expiredRequest.payload.approval.id, "approve");
  rewriteApproval(runtime.dataDir, expiredRequest.payload.approval.id, {
    expiresAt: "2000-01-01T00:00:00.000Z",
  });
  const expired = await runResearch(runtime, expiredRequest.payload.request.id, expiredRequest.payload.approval.id);
  assert.ok([403, 409].includes(expired.response.status), expired.response.body);
  assert.equal(runtime.fetchCalls.length, 0, "an expired approval must not authorize fetch");
});

test("one exact approved Brave request fetches once, saves cited snippets, and cannot be replayed", async (t) => {
  const sourceResults = [
    {
      title: "A recorded marketplace listing",
      url: "https://example.test/marketplace/cable-organizer",
      description: "A cited listing observation with an asking price, not proof of sales demand.",
    },
    {
      title: "A recorded model source",
      url: "https://example.test/models/cable-organizer",
      description: "A cited design-source observation whose commercial license remains unknown.",
    },
  ];
  const runtime = await authenticatedServer(t, {
    braveApiKey: "brave-print-research-test-key",
    fetchImpl: async () => new Response(JSON.stringify({ web: { results: sourceResults } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  const created = await createResearchRequest(runtime, "one-color cable organizer product opportunity");
  assert.equal(created.response.status, 202);
  const approved = await decideApproval(runtime, created.payload.approval.id, "approve");
  assert.equal(approved.response.status, 200);
  assert.equal(approved.payload.request.status, "approved");

  const completed = await runResearch(runtime, created.payload.request.id, created.payload.approval.id);
  assert.equal(completed.response.status, 200, completed.response.body);
  assert.equal(runtime.fetchCalls.length, 1);
  assert.match(String(runtime.fetchCalls[0][0]), /api\.search\.brave\.com/);
  assert.equal(completed.payload.request.status, "complete");
  assert.deepEqual(
    completed.payload.request.sources.map((source) => ({ url: source.url, snippet: source.snippet })),
    sourceResults.map((source) => ({ url: source.url, snippet: source.description })),
  );
  assert.equal(completed.payload.request.sources.every((source) => /^https:\/\//.test(source.url)), true);
  assert.equal(completed.payload.request.claims.some((claim) => /demand/i.test(String(claim.field || claim.type || ""))), false);

  const replay = await runResearch(runtime, created.payload.request.id, created.payload.approval.id);
  assert.equal(replay.response.status, 409, replay.response.body);
  assert.equal(runtime.fetchCalls.length, 1, "a consumed approval must never produce a second provider call");

  const approvalsResponse = await invoke(runtime.handler, {
    url: "/api/human-gate/requests",
    headers: { cookie: runtime.cookie },
  });
  const consumedApproval = JSON.parse(approvalsResponse.body).requests.find(
    (approval) => approval.id === created.payload.approval.id,
  );
  assert.equal(consumedApproval.useCount, 1);
  assert.match(consumedApproval.consumedAt, /^\d{4}-\d{2}-\d{2}T/);

  const workspaceResponse = await invoke(runtime.handler, {
    url: "/api/print-shop/workspace",
    headers: { cookie: runtime.cookie },
  });
  assert.equal(workspaceResponse.status, 200);
  assert.equal(workspaceResponse.body.includes("brave-print-research-test-key"), false);
  const workspace = JSON.parse(workspaceResponse.body);
  const saved = workspace.researchRequests.find((request) => request.id === created.payload.request.id);
  assert.equal(saved.status, "complete");
  assert.equal(saved.sources.length, 2);
  assert.equal(workspace.truth.researchSearchConfigured, true);
  assert.equal(workspace.truth.researchSearchProvider, "brave");
  assert.equal(workspace.truth.externalMarketEvidenceCollected, true);
  assert.equal(workspace.truth.marketDemandMeasured, false);
  assert.match(workspace.truth.note, /unknown/i);
  assert.equal(/high demand|proven demand|sales volume measured/i.test(workspaceResponse.body), false);
});

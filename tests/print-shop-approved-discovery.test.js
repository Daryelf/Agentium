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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-print-discovery-route-"));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-print-discovery-home-"));
  const fetchCalls = [];

  globalThis.fetch = async (...args) => {
    fetchCalls.push(args);
    if (typeof options.fetchImpl === "function") return options.fetchImpl(...args);
    throw new Error("Unexpected external fetch in Print Shop discovery test.");
  };

  const openAi = Boolean(options.openAiApiKey);
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
    SESSION_SECRET: "print-shop-discovery-session-secret-print-shop-discovery-session-secret-123",
    ADMIN_USERNAME: "",
    ADMIN_PASSWORD: "",
    AI_PROVIDER: openAi ? "openai" : "local_demo",
    AI_MODE: openAi ? "live" : "demo",
    AI_MODEL: options.openAiModel || "gpt-5.4-nano",
    OPENAI_MODEL: options.openAiModel || "gpt-5.4-nano",
    OPENAI_API_KEY: options.openAiApiKey || "",
    ANTHROPIC_API_KEY: "",
    AI_MONTHLY_LIMIT_USD: "100",
    OPENAI_TEST_BUDGET_USD: "100",
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
      username: "printdiscoveryadmin",
      password: "secure-print-discovery-1234",
      confirmPassword: "secure-print-discovery-1234",
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

async function createDiscovery(runtime, laneId = "workspace", geography = "United States") {
  const response = await jsonRequest(
    runtime.handler,
    runtime.cookie,
    "POST",
    "/api/print-shop/discovery-runs",
    { laneId, geography },
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

async function runDiscovery(runtime, runId, approvalId) {
  const response = await jsonRequest(
    runtime.handler,
    runtime.cookie,
    "POST",
    `/api/print-shop/discovery-runs/${encodeURIComponent(runId)}/run`,
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

async function workspace(runtime) {
  const response = await invoke(runtime.handler, {
    url: "/api/print-shop/workspace",
    headers: { cookie: runtime.cookie },
  });
  assert.equal(response.status, 200, response.body);
  return { response, payload: JSON.parse(response.body) };
}

test("discovery without a configured provider creates no run, approval, or external call", async (t) => {
  const runtime = await authenticatedServer(t);
  const { response, payload } = await createDiscovery(runtime);

  assert.equal(response.status, 409);
  assert.match(payload.error, /discovery|OpenAI|Brave|SERP|connected|configure/i);
  assert.equal(runtime.fetchCalls.length, 0);

  const approvalsResponse = await invoke(runtime.handler, {
    url: "/api/human-gate/requests",
    headers: { cookie: runtime.cookie },
  });
  const approvals = JSON.parse(approvalsResponse.body).requests;
  assert.equal(approvals.some((approval) => approval.actionType === "agent101_product_discovery"), false);

  const current = await workspace(runtime);
  assert.deepEqual(current.payload.discoveryRuns, []);
  assert.deepEqual(current.payload.sourceObservations, []);
  assert.deepEqual(current.payload.opportunities, []);
  assert.equal(current.payload.truth.researchSearchConfigured, false);
  assert.equal(current.payload.truth.externalMarketEvidenceCollected, false);
  assert.equal(current.payload.truth.marketDemandMeasured, false);
});

test("Brave discovery creation records an exact bounded unused approval without fetching", async (t) => {
  const runtime = await authenticatedServer(t, {
    braveApiKey: "brave-print-discovery-test-key",
    serpApiKey: "serp-must-not-win-when-brave-is-configured",
  });
  const { response, payload } = await createDiscovery(runtime);

  assert.equal(response.status, 202, response.body);
  assert.equal(payload.requiresApproval, true);
  assert.equal(payload.run.status, "pending_approval");
  assert.equal(payload.run.provider, "brave");
  assert.equal(payload.run.plan.brief.laneId, "workspace");
  assert.equal(payload.run.plan.queries.length, 3);
  assert.equal(payload.run.plan.maximumCalls, 3);
  assert.equal(payload.run.plan.maximumResultsPerCall, 6);
  assert.deepEqual(payload.run.sourceObservationIds, []);
  assert.deepEqual(payload.run.opportunityIds, []);
  assert.equal(runtime.fetchCalls.length, 0, "creating discovery must not contact Brave");

  const expectedScope = {
    officeId: "print-shop-office",
    runId: payload.run.id,
    provider: "brave",
    model: null,
    planHash: payload.run.plan.planHash,
    geography: "United States",
    queryHashes: payload.run.plan.queries.map((query) => query.queryHash),
    maximumProviderRequests: 3,
    maximumToolCalls: 3,
    maximumResultsPerCall: 6,
    maximumOpportunities: 8,
    maximumOutputTokens: 0,
    externalWebAccess: true,
  };
  const { approval } = payload;
  assert.equal(approval.actionType, "agent101_product_discovery");
  assert.equal(approval.officeId, "print-shop-office");
  assert.equal(approval.linkedId, `print-shop-discovery:brave:direct:${payload.run.plan.planHash}`);
  assert.equal(approval.status, "pending");
  assert.equal(approval.useCount, 0);
  assert.equal(approval.consumedAt, null);
  assert.deepEqual(approval.details, expectedScope);
  assert.deepEqual(approval.originalDetails, expectedScope);
  assert.deepEqual(payload.run.scope, expectedScope);
  assert.match(approval.exactScope, /3 exact brave search calls/i);
  assert.match(approval.exactScope, /at most 6 observations per call/i);
  assert.equal(JSON.stringify(payload).includes("brave-print-discovery-test-key"), false);

  const current = await workspace(runtime);
  assert.equal(current.payload.discoveryRuns.length, 1);
  assert.equal(current.payload.truth.researchSearchConfigured, true);
  assert.equal(current.payload.truth.researchSearchProvider, "brave");
  assert.equal(current.payload.truth.marketDemandMeasured, false);
});

test("wrong, blocked, and expired discovery approvals cannot contact the provider", async (t) => {
  const runtime = await authenticatedServer(t, {
    braveApiKey: "brave-print-discovery-test-key",
    fetchImpl: async () => {
      throw new Error("A rejected discovery scope must not reach Brave.");
    },
  });

  const workspaceRun = await createDiscovery(runtime, "workspace");
  const homeRun = await createDiscovery(runtime, "home");
  assert.equal(workspaceRun.response.status, 202);
  assert.equal(homeRun.response.status, 202);
  await decideApproval(runtime, homeRun.payload.approval.id, "approve");
  const wrong = await runDiscovery(runtime, workspaceRun.payload.run.id, homeRun.payload.approval.id);
  assert.ok([403, 409].includes(wrong.response.status), wrong.response.body);
  assert.equal(runtime.fetchCalls.length, 0);

  const blockedRun = await createDiscovery(runtime, "maker");
  await decideApproval(runtime, blockedRun.payload.approval.id, "block");
  const blocked = await runDiscovery(runtime, blockedRun.payload.run.id, blockedRun.payload.approval.id);
  assert.ok([403, 409].includes(blocked.response.status), blocked.response.body);
  assert.equal(runtime.fetchCalls.length, 0);

  const expiredRun = await createDiscovery(runtime, "replacement");
  await decideApproval(runtime, expiredRun.payload.approval.id, "approve");
  rewriteApproval(runtime.dataDir, expiredRun.payload.approval.id, {
    expiresAt: "2000-01-01T00:00:00.000Z",
  });
  const expired = await runDiscovery(runtime, expiredRun.payload.run.id, expiredRun.payload.approval.id);
  assert.ok([403, 409].includes(expired.response.status), expired.response.body);
  assert.equal(runtime.fetchCalls.length, 0);

  const current = await workspace(runtime);
  assert.deepEqual(current.payload.sourceObservations, []);
  assert.deepEqual(current.payload.opportunities, []);
  assert.equal(current.payload.truth.marketDemandMeasured, false);
});

test("one approved Brave plan makes exactly three calls and saves source-linked opportunities without demand claims", async (t) => {
  let requestNumber = 0;
  const runtime = await authenticatedServer(t, {
    braveApiKey: "brave-print-discovery-test-key",
    fetchImpl: async (input) => {
      requestNumber += 1;
      const query = new URL(String(input)).searchParams.get("q");
      const slug = `research-angle-${requestNumber}`;
      return new Response(JSON.stringify({
        web: {
          results: [
            {
              title: `Cable organizer observation ${requestNumber}`,
              url: `https://market.example.com/${slug}/cable-organizer`,
              description: `A current source observation about charging cable organization for research angle: ${query}.`,
            },
            {
              title: `Desk cable complaint ${requestNumber}`,
              url: `https://community.example.org/${slug}/desk-cable-problem`,
              description: "Desk owners describe loose charging cables as a recurring workspace problem.",
            },
          ],
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const created = await createDiscovery(runtime, "workspace");
  assert.equal(created.response.status, 202);
  const approved = await decideApproval(runtime, created.payload.approval.id, "approve");
  assert.equal(approved.response.status, 200);
  assert.equal(approved.payload.request.status, "approved");

  const completed = await runDiscovery(runtime, created.payload.run.id, created.payload.approval.id);
  assert.equal(completed.response.status, 200, completed.response.body);
  assert.equal(runtime.fetchCalls.length, 3);
  assert.equal(completed.payload.run.status, "complete");
  assert.equal(completed.payload.run.execution.callsCompleted, 3);
  assert.equal(completed.payload.sourceCount, 6);
  assert.ok(completed.payload.opportunityCount > 0);

  const expectedQueries = created.payload.run.plan.queries.map((query) => query.query);
  const actualQueries = runtime.fetchCalls.map(([input]) => {
    const endpoint = new URL(String(input));
    assert.equal(endpoint.hostname, "api.search.brave.com");
    return endpoint.searchParams.get("q");
  });
  assert.deepEqual(actualQueries, expectedQueries);

  const current = await workspace(runtime);
  const savedRun = current.payload.discoveryRuns.find((run) => run.id === created.payload.run.id);
  assert.equal(savedRun.status, "complete");
  assert.equal(savedRun.sourceObservationIds.length, 6);
  assert.ok(savedRun.opportunityIds.length > 0);
  const sourceMap = new Map(current.payload.sourceObservations.map((source) => [source.id, source]));
  savedRun.opportunityIds.forEach((opportunityId) => {
    const opportunity = current.payload.opportunities.find((item) => item.id === opportunityId);
    assert(opportunity);
    assert.ok(opportunity.sourceObservationIds.length > 0);
    opportunity.sourceObservationIds.forEach((sourceId) => {
      const source = sourceMap.get(sourceId);
      assert(source, `Missing source ${sourceId}`);
      assert.equal(source.discoveryRunId, savedRun.id);
      assert.match(source.contentHash, /^[a-f0-9]{64}$/);
    });
    assert.equal(opportunity.truth.marketDemandMeasured, false);
    assert.equal(opportunity.truth.demand, null);
    assert.equal(opportunity.truth.sellingPrice, null);
    assert.equal(opportunity.truth.unitEconomics, null);
    assert.equal(opportunity.manufacturing.printerFit, "needs_measurement");
  });
  assert.equal(current.payload.truth.marketDemandMeasured, false);
  assert.equal(current.response.body.includes("brave-print-discovery-test-key"), false);

  const replay = await runDiscovery(runtime, created.payload.run.id, created.payload.approval.id);
  assert.equal(replay.response.status, 409, replay.response.body);
  assert.equal(runtime.fetchCalls.length, 3, "a terminal run and consumed approval cannot trigger more provider calls");

  const approvalsResponse = await invoke(runtime.handler, {
    url: "/api/human-gate/requests",
    headers: { cookie: runtime.cookie },
  });
  const consumed = JSON.parse(approvalsResponse.body).requests.find(
    (approval) => approval.id === created.payload.approval.id,
  );
  assert.equal(consumed.useCount, 1);
  assert.match(consumed.consumedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("approved OpenAI discovery makes one bounded Responses web-search request and accepts only cited opportunities", async (t) => {
  let capturedRequestBody = null;
  const citedUrls = [
    "https://market.example.com/current/modular-cable-routing",
    "https://community.example.org/workspaces/charging-cable-friction",
  ];
  const runtime = await authenticatedServer(t, {
    openAiApiKey: "openai-print-discovery-test-key",
    openAiModel: "gpt-5.4-nano",
    fetchImpl: async (input, init = {}) => {
      assert.equal(String(input), "https://api.openai.com/v1/responses");
      capturedRequestBody = JSON.parse(String(init.body || "{}"));
      const queryIds = capturedRequestBody.text.format.schema
        .properties.observations.items.properties.queryIds.items.enum;
      const structured = {
        observations: [
          {
            title: "Current modular cable-routing observation",
            url: citedUrls[0],
            summary: "A current product-page observation for a modular cable-routing system.",
            queryIds,
          },
          {
            title: "Workspace charging-cable friction discussion",
            url: citedUrls[1],
            summary: "Workspace owners describe reachable charging-cable storage as a recurring fit problem.",
            queryIds,
          },
        ],
        opportunities: [{
          title: "Measured modular cable routing kit",
          problem: "Keep charging cables separated and reachable for a specifically measured desk edge.",
          targetBuyer: "Desk owners with nonstandard furniture and cable dimensions",
          suggestedTemplateId: "custom",
          sourceUrls: citedUrls,
        }],
      };
      return new Response(JSON.stringify({
        id: "resp_print_discovery_test",
        output: [
          {
            id: "ws_print_discovery_test",
            type: "web_search_call",
            action: {
              sources: citedUrls.map((url, index) => ({
                type: "url",
                url,
                title: structured.observations[index].title,
              })),
            },
          },
          {
            id: "msg_print_discovery_test",
            type: "message",
            role: "assistant",
            content: [{
              type: "output_text",
              text: JSON.stringify(structured),
              annotations: citedUrls.map((url, index) => ({
                type: "url_citation",
                url,
                title: structured.observations[index].title,
              })),
            }],
          },
        ],
        usage: { input_tokens: 500, output_tokens: 240, total_tokens: 740 },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const created = await createDiscovery(runtime, "workspace");
  assert.equal(created.response.status, 202, created.response.body);
  assert.equal(created.payload.run.provider, "openai_web_search");
  assert.equal(created.payload.run.providerModel, "gpt-5.4-nano");
  assert.equal(created.payload.approval.details.maximumProviderRequests, 1);
  assert.equal(created.payload.approval.details.maximumToolCalls, 3);
  assert.equal(created.payload.approval.details.maximumOutputTokens, 3200);
  assert.equal(runtime.fetchCalls.length, 0);

  await decideApproval(runtime, created.payload.approval.id, "approve");
  const completed = await runDiscovery(runtime, created.payload.run.id, created.payload.approval.id);
  assert.equal(completed.response.status, 200, completed.response.body);
  assert.equal(runtime.fetchCalls.length, 1);
  assert(capturedRequestBody);
  assert.equal(capturedRequestBody.model, "gpt-5.4-nano");
  assert.deepEqual(capturedRequestBody.tools.map((tool) => tool.type), ["web_search"]);
  assert.equal(capturedRequestBody.tools[0].external_web_access, true);
  assert.equal(capturedRequestBody.tool_choice, "required");
  assert.equal(capturedRequestBody.max_tool_calls, 3);
  assert.deepEqual(capturedRequestBody.include, ["web_search_call.action.sources"]);
  assert.equal(capturedRequestBody.max_output_tokens, 3200);
  assert.equal(capturedRequestBody.text.format.type, "json_schema");
  assert.equal(capturedRequestBody.text.format.strict, true);
  assert.match(capturedRequestBody.input[0].content, /Every opportunity must cite at least one/i);
  assert.match(capturedRequestBody.input[0].content, /Do not claim or estimate demand/i);

  const current = await workspace(runtime);
  const savedRun = current.payload.discoveryRuns.find((run) => run.id === created.payload.run.id);
  assert.equal(savedRun.status, "complete");
  assert.equal(savedRun.execution.providerResponseId, "resp_print_discovery_test");
  assert.equal(savedRun.execution.callsCompleted, 1);
  assert.equal(savedRun.execution.toolCallsUsed, 1);
  assert.equal(savedRun.sourceObservationIds.length, 2);
  assert.equal(savedRun.opportunityIds.length, 1);
  const opportunity = current.payload.opportunities.find((item) => item.id === savedRun.opportunityIds[0]);
  assert.equal(opportunity.title, "Measured modular cable routing kit");
  assert.equal(opportunity.sourceObservationIds.length, 2);
  assert.equal(opportunity.truth.marketDemandMeasured, false);
  assert.equal(opportunity.truth.demand, null);
  assert.equal(opportunity.truth.sellingPrice, null);
  assert.equal(opportunity.manufacturing.printerFit, "needs_measurement");
  assert.equal(current.response.body.includes("openai-print-discovery-test-key"), false);
});

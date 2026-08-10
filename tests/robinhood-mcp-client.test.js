const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  AUTHORIZATION_ENDPOINT,
  MCP_ENDPOINT,
  REGISTRATION_ENDPOINT,
  TOKEN_ENDPOINT,
  createRobinhoodMcpClient,
  identifyAgenticAccount,
  parseMcpPayload,
} = require("../services/robinhood-mcp-client");

function jsonResponse(value, options = {}) {
  return new Response(JSON.stringify(value), {
    status: options.status || 200,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
}

function mcpResult(id, result, headers = {}) {
  return jsonResponse({ jsonrpc: "2.0", id, result }, { headers });
}

function toolResult(value) {
  return { structuredContent: value, content: [] };
}

function fakeRobinhood(options = {}) {
  let placed = false;
  const calls = [];
  const toolNames = [
    "get_accounts",
    "get_portfolio",
    "get_equity_positions",
    "get_equity_orders",
    "get_equity_quotes",
    "get_equity_tradability",
    "review_equity_order",
    "place_equity_order",
    "cancel_equity_order",
  ];
  const schemas = Object.fromEntries(toolNames.map((name) => [name, { type: "object", properties: {} }]));
  schemas.get_portfolio = { type: "object", properties: { account_number: { type: "string" } }, required: ["account_number"] };
  schemas.get_equity_positions = schemas.get_portfolio;
  schemas.get_equity_orders = schemas.get_portfolio;
  schemas.get_equity_quotes = options.scalarQuotes
    ? { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] }
    : { type: "object", properties: { symbols: { type: "array" } }, required: ["symbols"] };
  schemas.get_equity_tradability = { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] };

  async function fetchImpl(url, init = {}) {
    calls.push({ url: String(url), init });
    if (String(url) === REGISTRATION_ENDPOINT) return jsonResponse({ client_id: "argentum-client" });
    if (String(url) === TOKEN_ENDPOINT) return jsonResponse({ access_token: "access-secret", refresh_token: "refresh-secret", expires_in: 3600, token_type: "Bearer" });
    assert.equal(String(url), MCP_ENDPOINT);
    const body = JSON.parse(init.body);
    assert.equal(init.headers.authorization, "Bearer access-secret");
    if (body.method === "initialize") return mcpResult(body.id, { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "robinhood" } }, { "mcp-session-id": "session-1" });
    if (body.method === "notifications/initialized") return new Response("", { status: 202 });
    if (body.method === "tools/list") return mcpResult(body.id, { tools: toolNames.map((name) => ({ name, inputSchema: schemas[name] })) });
    assert.equal(body.method, "tools/call");
    const name = body.params.name;
    const args = body.params.arguments;
    if (name === "get_accounts") return mcpResult(body.id, toolResult({ accounts: [{ account_number: "12345678", account_type: "Agentic Trading" }, { account_number: "87654321", account_type: "Individual" }] }));
    if (name === "get_portfolio") {
      assert.equal(args.account_number, "12345678");
      return mcpResult(body.id, toolResult({ portfolio_value: "100.00", buying_power: "50.00", cash: "50.00", day_pnl: "1.25", day_pnl_pct: "0.0125" }));
    }
    if (name === "get_equity_positions") return mcpResult(body.id, toolResult({ positions: options.positions || [{ symbol: "AAPL", quantity: "1", shares_available_for_sells: "1", current_price: "100" }] }));
    if (name === "get_equity_orders") return mcpResult(body.id, toolResult({ orders: placed ? [{ order_id: "rh-order-1", ref_id: "one-use-ref", symbol: "AAPL", side: "buy", state: "queued", dollar_amount: "5.00" }] : [] }));
    if (name === "get_equity_quotes") {
      if (options.scalarQuotes) {
        assert.ok(args.symbol);
        return mcpResult(body.id, toolResult({ symbol: args.symbol, price: String(options.quotePrices?.[args.symbol] ?? options.quotePrice ?? 100.5) }));
      }
      assert.deepEqual(args.symbols, (options.positions || [{ symbol: "AAPL" }]).map((item) => item.symbol));
      return mcpResult(body.id, toolResult({ quotes: args.symbols.map((symbol) => ({ symbol, price: String(options.quotePrices?.[symbol] ?? options.quotePrice ?? 100.5) })) }));
    }
    if (name === "get_equity_tradability") {
      assert.equal(args.symbol, "AAPL");
      return mcpResult(body.id, toolResult({ symbol: "AAPL", tradable: options.tradable ?? true, fractional_tradable: options.fractional ?? true }));
    }
    if (name === "review_equity_order") return mcpResult(body.id, toolResult({ warnings: options.reviewWarnings || [] }));
    if (name === "place_equity_order") {
      placed = true;
      assert.equal(args.ref_id, "one-use-ref");
      return mcpResult(body.id, toolResult({ order_id: "rh-order-1", ref_id: "one-use-ref", symbol: "AAPL", side: "buy", state: "queued" }));
    }
    throw new Error(`Unexpected tool ${name}`);
  }

  return { fetchImpl, calls };
}

test("Robinhood PKCE OAuth, Agentic account reads, and exact order reconciliation work without exposing tokens", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-robinhood-test-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let stored = null;
  const tokenStore = {
    ready: () => true,
    load: () => stored,
    save: (value) => { stored = structuredClone(value); },
    clear: () => { stored = null; },
  };
  const fake = fakeRobinhood();
  const client = createRobinhoodMcpClient({ dataDir, tokenStore, fetchImpl: fake.fetchImpl, now: () => new Date("2026-08-10T17:00:00.000Z") });
  const started = await client.beginAuthorization({
    redirectUri: "http://127.0.0.1:5173/api/stock-office/robinhood/oauth/callback",
    approvalId: "approval-connect",
  });
  const authorization = new URL(started.authorizationUrl);
  assert.equal(authorization.origin + authorization.pathname, AUTHORIZATION_ENDPOINT);
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorization.searchParams.get("client_id"), "argentum-client");
  assert.equal(started.approvalId, "approval-connect");

  const completed = await client.completeAuthorization({ state: authorization.searchParams.get("state"), code: "oauth-code" });
  assert.equal(completed.oauthAuthenticated, true);
  assert.equal(completed.toolContractVerified, true);
  assert.equal(completed.approvalId, "approval-connect");
  assert.equal(JSON.stringify(completed).includes("access-secret"), false);
  assert.equal(JSON.stringify(completed).includes("refresh-secret"), false);

  const snapshot = await client.refreshBrokerSnapshot();
  assert.equal(snapshot.account, "Agentic ••••5678");
  assert.equal(snapshot.accountIdentityHash.length, 64);
  assert.equal(snapshot.buyingPower, "$50.00");
  assert.equal(snapshot.dayPnlDollars, 1.25);
  assert.equal(snapshot.dayPnlPct, 0.0125);
  assert.deepEqual(snapshot.orders, []);
  assert.equal(snapshot.positions[0].symbol, "AAPL");
  assert.equal(snapshot.provenance, "official_robinhood_mcp_live_read");

  const result = await client.executeApprovedEnvelope({
    reviewTool: "review_equity_order",
    placementTool: "place_equity_order",
    reviewArgs: { symbol: "AAPL", side: "buy", type: "market", dollar_amount: "5.00", time_in_force: "gfd", market_hours: "regular_hours" },
    placementArgs: { symbol: "AAPL", side: "buy", type: "market", dollar_amount: "5.00", time_in_force: "gfd", market_hours: "regular_hours", ref_id: "one-use-ref" },
    referencePrice: 100,
    maxPriceDriftPct: 0.02,
  });
  assert.equal(result.reviewPassed, true);
  assert.equal(result.placementAttempted, true);
  assert.equal(result.brokerOrderId, "rh-order-1");
  assert.equal(result.reconciliation.matched, true);
  assert.equal(result.reconciliation.clientRefId, "one-use-ref");
  assert.equal(result.reconciliation.accountIdentityHash, snapshot.accountIdentityHash);
  assert.equal(fake.calls.filter((call) => {
    if (call.url !== MCP_ENDPOINT) return false;
    return JSON.parse(call.init.body || "{}").params?.name === "place_equity_order";
  }).length, 1);

  const callsBeforeCachedRefresh = fake.calls.length;
  const cached = await client.refreshIfStale(60_000);
  assert.equal(cached.updatedAt, snapshot.updatedAt);
  assert.equal(fake.calls.length, callsBeforeCachedRefresh);
});

test("Agentic account selection fails closed on ambiguity and never selects the primary account", () => {
  assert.throws(() => identifyAgenticAccount({ accounts: [
    { account_number: "1", account_type: "Agentic Trading" },
    { account_number: "2", nickname: "Agentic" },
  ] }), /more than one Agentic account/i);
  assert.throws(() => identifyAgenticAccount({ accounts: [{ account_number: "1", account_type: "Individual" }] }), /not found/i);
});

test("scalar quote schemas refresh every owned position instead of silently pricing only the first", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-robinhood-scalar-quotes-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let stored = null;
  const tokenStore = { ready: () => true, load: () => stored, save: (value) => { stored = structuredClone(value); }, clear: () => { stored = null; } };
  const fake = fakeRobinhood({
    scalarQuotes: true,
    positions: [
      { symbol: "AAPL", quantity: "1", shares_available_for_sells: "1" },
      { symbol: "MSFT", quantity: "2", shares_available_for_sells: "2" },
    ],
    quotePrices: { AAPL: 101, MSFT: 202 },
  });
  const client = createRobinhoodMcpClient({ dataDir, tokenStore, fetchImpl: fake.fetchImpl, now: () => new Date("2026-08-10T17:00:00.000Z") });
  const started = await client.beginAuthorization({ redirectUri: "http://127.0.0.1:5173/api/stock-office/robinhood/oauth/callback", approvalId: "approval-connect" });
  await client.completeAuthorization({ state: new URL(started.authorizationUrl).searchParams.get("state"), code: "oauth-code" });
  const snapshot = await client.refreshBrokerSnapshot();

  assert.deepEqual(snapshot.positions.map((item) => [item.symbol, item.currentPrice]), [["AAPL", 101], ["MSFT", 202]]);
  const quoteCalls = fake.calls.filter((call) => {
    if (call.url !== MCP_ENDPOINT) return false;
    return JSON.parse(call.init.body || "{}").params?.name === "get_equity_quotes";
  });
  assert.equal(quoteCalls.length, 2);
});

test("live quote drift stops before Robinhood review or placement", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-robinhood-drift-test-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let stored = null;
  const tokenStore = { ready: () => true, load: () => stored, save: (value) => { stored = structuredClone(value); }, clear: () => { stored = null; } };
  const fake = fakeRobinhood({ quotePrice: 110 });
  const client = createRobinhoodMcpClient({ dataDir, tokenStore, fetchImpl: fake.fetchImpl, now: () => new Date("2026-08-10T17:00:00.000Z") });
  const started = await client.beginAuthorization({ redirectUri: "http://127.0.0.1:5173/api/stock-office/robinhood/oauth/callback", approvalId: "approval-connect" });
  await client.completeAuthorization({ state: new URL(started.authorizationUrl).searchParams.get("state"), code: "oauth-code" });
  const result = await client.executeApprovedEnvelope({
    reviewTool: "review_equity_order",
    placementTool: "place_equity_order",
    reviewArgs: { symbol: "AAPL", side: "buy", dollar_amount: "5.00" },
    placementArgs: { symbol: "AAPL", side: "buy", dollar_amount: "5.00", ref_id: "one-use-ref" },
    referencePrice: 100,
    maxPriceDriftPct: 0.02,
  });
  assert.equal(result.reviewPassed, false);
  assert.match(result.warnings.join(" "), /quote drift exceeded/i);
  const calledTools = fake.calls.filter((call) => call.url === MCP_ENDPOINT).map((call) => JSON.parse(call.init.body || "{}").params?.name).filter(Boolean);
  assert.equal(calledTools.includes("review_equity_order"), false);
  assert.equal(calledTools.includes("place_equity_order"), false);
});

test("streamable HTTP SSE responses are parsed as JSON-RPC payloads", () => {
  const payload = parseMcpPayload("event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"ok\":true}}\n\n", "text/event-stream");
  assert.equal(payload.result.ok, true);
});

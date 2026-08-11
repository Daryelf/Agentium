const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const secureSecrets = require("./secure-secrets");

const MCP_ENDPOINT = "https://agent.robinhood.com/mcp/trading";
const AUTHORIZATION_ENDPOINT = "https://robinhood.com/oauth";
const REGISTRATION_ENDPOINT = "https://agent.robinhood.com/oauth/trading/register";
const TOKEN_ENDPOINT = "https://api.robinhood.com/oauth2/token/";
const TOKEN_PROVIDER = "robinhood_mcp_oauth";
const OAUTH_TTL_MS = 10 * 60 * 1000;
const REQUIRED_READ_TOOLS = [
  "get_accounts",
  "get_portfolio",
  "get_equity_positions",
  "get_equity_orders",
  "get_equity_quotes",
  "get_equity_tradability",
];
const REQUIRED_EXECUTION_TOOLS = ["review_equity_order", "place_equity_order", "cancel_equity_order"];

function detectCodexRobinhoodRegistration(configFile = "") {
  const result = { registered: false, connectorId: "", endpoint: "", configReadable: false };
  if (!configFile) return result;
  try {
    const stat = fs.statSync(configFile);
    if (!stat.isFile() || stat.size > 1_000_000) return result;
    const lines = fs.readFileSync(configFile, "utf8").split(/\r?\n/);
    let section = "";
    let endpoint = "";
    let enabled = true;
    const commitSection = () => {
      if (!section || !enabled || String(endpoint).replace(/\/$/, "") !== MCP_ENDPOINT) return;
      result.registered = true;
      result.connectorId = section;
      result.endpoint = MCP_ENDPOINT;
    };
    for (const rawLine of [...lines, "[end]"]) {
      const line = rawLine.trim();
      const sectionMatch = line.match(/^\[mcp_servers\.([A-Za-z0-9_-]+)\]$/);
      if (line.startsWith("[")) {
        commitSection();
        section = sectionMatch?.[1] || "";
        endpoint = "";
        enabled = true;
        continue;
      }
      if (!section || !line || line.startsWith("#")) continue;
      const urlMatch = line.match(/^url\s*=\s*["']([^"']+)["']/);
      if (urlMatch) endpoint = urlMatch[1];
      if (/^enabled\s*=\s*false\b/i.test(line)) enabled = false;
    }
    result.configReadable = true;
    return result;
  } catch {
    return result;
  }
}

function nowIso(now = () => new Date()) {
  return now().toISOString();
}

function safeJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function loopbackRedirect(value) {
  const parsed = new URL(String(value || ""));
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw new Error("Robinhood OAuth redirect must use this app's loopback HTTP origin.");
  }
  return parsed.toString();
}

function parseMcpPayload(text, contentType = "") {
  if (/text\/event-stream/i.test(contentType) || /^\s*(event|data):/m.test(text)) {
    const events = String(text || "").split(/\r?\n\r?\n/).map((chunk) => (
      chunk.split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n")
    )).filter(Boolean);
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const parsed = safeJson(events[index]);
      if (parsed) return parsed;
    }
  }
  return safeJson(text);
}

function toolResultValue(result = {}) {
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const text = (Array.isArray(result.content) ? result.content : [])
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();
  return safeJson(text, text || result);
}

function walkObjects(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (!Array.isArray(value)) output.push(value);
  for (const nested of Array.isArray(value) ? value : Object.values(value)) walkObjects(nested, output);
  return output;
}

function lowerKeyRecord(object = {}) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [String(key).toLowerCase(), value]));
}

function firstValue(objects, keys) {
  const wanted = keys.map((key) => String(key).toLowerCase());
  for (const object of objects) {
    const record = lowerKeyRecord(object);
    for (const key of wanted) {
      if (record[key] !== undefined && record[key] !== null && record[key] !== "") return record[key];
    }
  }
  return null;
}

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return fallback;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function moneyValue(objects, keys) {
  return finiteNumber(firstValue(objects, keys), null);
}

function stringValue(objects, keys) {
  const value = firstValue(objects, keys);
  return value === null ? "" : String(value).trim();
}

function explicitBoolean(objects, keys) {
  const value = firstValue(objects, keys);
  if (value === true || String(value).toLowerCase() === "true") return true;
  if (value === false || String(value).toLowerCase() === "false") return false;
  return null;
}

function maskAccount(value) {
  const raw = String(value || "").replace(/\s+/g, "");
  if (!raw) return "";
  return `Agentic ••••${raw.slice(-4)}`;
}

function identifyAgenticAccount(payload) {
  const candidates = walkObjects(payload).filter((object) => {
    const record = lowerKeyRecord(object);
    const text = Object.values(object)
      .filter((value) => ["string", "number", "boolean"].includes(typeof value))
      .join(" ")
      .toLowerCase();
    const hasIdentity = ["account_number", "accountnumber", "account_id", "accountid", "id"].some((key) => record[key]);
    return hasIdentity && text.includes("agentic");
  });
  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const objects = [candidate];
    const accountNumber = stringValue(objects, ["account_number", "accountNumber"]);
    const accountId = stringValue(objects, ["account_id", "accountId", "id"]);
    const identity = accountNumber || accountId;
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    unique.push({ raw: candidate, accountNumber, accountId, identity, identityHash: sha256(identity) });
  }
  if (unique.length !== 1) {
    throw new Error(unique.length ? "More than one Agentic account was returned; refusing ambiguous account selection." : "A dedicated Robinhood Agentic account was not found.");
  }
  return unique[0];
}

function normalizePositions(payload, quotesBySymbol = {}) {
  const positions = [];
  const seen = new Set();
  for (const object of walkObjects(payload)) {
    const objects = [object];
    const symbol = stringValue(objects, ["symbol", "ticker", "instrument_symbol"]).toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
    const quantity = finiteNumber(firstValue(objects, ["quantity", "shares", "total_quantity"]), null);
    if (!symbol || quantity === null || quantity <= 0 || seen.has(symbol)) continue;
    seen.add(symbol);
    const currentPrice = finiteNumber(firstValue(objects, ["current_price", "price", "mark_price", "last_trade_price"]), quotesBySymbol[symbol] ?? null);
    positions.push({
      symbol,
      quantity,
      sharesAvailableForSells: finiteNumber(firstValue(objects, ["shares_available_for_sells", "quantity_available", "available_quantity"]), quantity),
      averageBuyPrice: finiteNumber(firstValue(objects, ["average_buy_price", "average_price", "cost_basis_price"]), null),
      currentPrice,
      unrealizedPnl: finiteNumber(firstValue(objects, ["unrealized_pnl", "unrealized_gain_loss"]), null),
      unrealizedPnlPct: finiteNumber(firstValue(objects, ["unrealized_pnl_pct", "unrealized_gain_loss_percent"]), null),
    });
  }
  return positions.slice(0, 100);
}

function normalizeOrders(payload) {
  const orders = [];
  const seen = new Set();
  for (const object of walkObjects(payload)) {
    const objects = [object];
    const orderId = stringValue(objects, ["order_id", "orderId", "id"]);
    const symbol = stringValue(objects, ["symbol", "ticker"]).toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
    const state = stringValue(objects, ["state", "status", "order_state"]).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 60);
    if (!orderId || !symbol || !state || seen.has(orderId)) continue;
    seen.add(orderId);
    orders.push({
      orderId: orderId.slice(0, 160),
      clientRefId: stringValue(objects, ["ref_id", "client_ref_id", "client_order_id"]).slice(0, 160),
      symbol,
      side: stringValue(objects, ["side"]).toUpperCase() === "SELL" ? "SELL" : "BUY",
      state,
      dollarAmount: finiteNumber(firstValue(objects, ["dollar_amount", "notional", "amount"]), null),
      quantity: finiteNumber(firstValue(objects, ["quantity", "shares"]), null),
      createdAt: stringValue(objects, ["created_at", "createdAt", "submitted_at"]).slice(0, 80),
    });
  }
  return orders.slice(0, 200);
}

function blockingWarnings(payload) {
  const warnings = [];
  for (const object of walkObjects(payload)) {
    const record = lowerKeyRecord(object);
    for (const key of ["warnings", "warning", "alerts", "alert", "errors", "error"]) {
      if (record[key] === undefined || record[key] === null || record[key] === "") continue;
      const values = Array.isArray(record[key]) ? record[key] : [record[key]];
      for (const item of values) {
        const message = typeof item === "string" ? item : JSON.stringify(item);
        if (message && !warnings.includes(message)) warnings.push(message.slice(0, 500));
      }
    }
  }
  return warnings.slice(0, 20);
}

function defaultTokenStore(dataDir) {
  return {
    ready: () => secureSecrets.canUseKeychain(),
    load() {
      if (!secureSecrets.canUseKeychain()) return null;
      return safeJson(secureSecrets.getSecret({ dataDir, provider: TOKEN_PROVIDER, storage: "mac_keychain" }));
    },
    save(value) {
      if (!secureSecrets.canUseKeychain()) throw new Error("Mac Keychain is required for Robinhood OAuth tokens.");
      secureSecrets.setSecret({ dataDir, provider: TOKEN_PROVIDER, value: JSON.stringify(value), preferKeychain: true });
    },
    clear() {
      secureSecrets.deleteSecret({ dataDir, provider: TOKEN_PROVIDER, storage: "mac_keychain" });
    },
  };
}

function createRobinhoodMcpClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || (() => new Date());
  const dataDir = path.resolve(options.dataDir || path.join(process.cwd(), "data"));
  const registrationFile = path.join(dataDir, "robinhood-mcp-registration.json");
  const codexConfigFile = options.codexConfigFile ? path.resolve(options.codexConfigFile) : "";
  const tokenStore = options.tokenStore || defaultTokenStore(dataDir);
  const pending = new Map();
  let registration = null;
  let tokensLoaded = false;
  let tokens = null;
  let mcpSessionId = "";
  let tools = [];
  let observedAt = null;
  let brokerSnapshot = null;
  let activeAccount = null;
  let lastError = "";
  let rpcId = 0;
  let refreshPromise = null;

  function loadRegistration() {
    if (registration) return registration;
    registration = safeJson(fs.existsSync(registrationFile) ? fs.readFileSync(registrationFile, "utf8") : "") || null;
    return registration;
  }

  function loadTokens() {
    if (!tokensLoaded) {
      tokens = tokenStore.load() || null;
      tokensLoaded = true;
    }
    return tokens;
  }

  function registrationStatus() {
    const appRegistered = Boolean(loadRegistration()?.client_id);
    const codex = detectCodexRobinhoodRegistration(codexConfigFile);
    return {
      registered: appRegistered || codex.registered,
      appRegistered,
      codexRegistered: codex.registered,
      codexConnectorId: codex.connectorId,
      registrationSource: appRegistered ? "argentum_app" : codex.registered ? "codex_config" : "none",
    };
  }

  function saveTokens(next) {
    tokens = next;
    tokensLoaded = true;
    tokenStore.save(next);
  }

  async function fetchJson(url, init, label) {
    const response = await fetchImpl(url, init);
    const text = await response.text();
    const parsed = safeJson(text);
    if (!response.ok || !parsed) {
      const detail = parsed?.error_description || parsed?.error || text || `HTTP ${response.status}`;
      throw new Error(`${label} failed: ${String(detail).slice(0, 500)}`);
    }
    return parsed;
  }

  async function ensureRegistration(redirectUri) {
    const existing = loadRegistration();
    if (existing?.client_id && Array.isArray(existing.redirect_uris) && existing.redirect_uris.includes(redirectUri)) return existing;
    const created = await fetchJson(REGISTRATION_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_name: "Argentum Stock Office",
        client_uri: "https://github.com/Daryelf/Agentium",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    }, "Robinhood OAuth client registration");
    if (!created.client_id) throw new Error("Robinhood OAuth registration did not return a client ID.");
    registration = { client_id: String(created.client_id), redirect_uris: [redirectUri], registered_at: nowIso(now) };
    atomicWriteJson(registrationFile, registration);
    return registration;
  }

  async function beginAuthorization({ redirectUri, approvalId = "" }) {
    if (!tokenStore.ready()) throw new Error("Mac Keychain must be available before Robinhood can be connected.");
    const verifiedRedirect = loopbackRedirect(redirectUri);
    const client = await ensureRegistration(verifiedRedirect);
    const state = base64Url(crypto.randomBytes(32));
    const verifier = base64Url(crypto.randomBytes(64));
    const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
    const createdAt = now().getTime();
    pending.set(state, { state, verifier, redirectUri: verifiedRedirect, createdAt, approvalId: String(approvalId || "") });
    for (const [key, value] of pending) if (createdAt - value.createdAt > OAUTH_TTL_MS) pending.delete(key);
    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", client.client_id);
    url.searchParams.set("redirect_uri", verifiedRedirect);
    url.searchParams.set("scope", "internal");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return { authorizationUrl: url.toString(), stateExpiresAt: new Date(createdAt + OAUTH_TTL_MS).toISOString(), approvalId: String(approvalId || "") };
  }

  async function completeAuthorization({ state, code }) {
    const request = pending.get(String(state || ""));
    pending.delete(String(state || ""));
    if (!request || now().getTime() - request.createdAt > OAUTH_TTL_MS) throw new Error("Robinhood OAuth state is missing or expired. Start the connection again.");
    if (!code) throw new Error("Robinhood did not return an authorization code.");
    const client = loadRegistration();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.client_id,
      code: String(code),
      redirect_uri: request.redirectUri,
      code_verifier: request.verifier,
    });
    const result = await fetchJson(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: body.toString(),
    }, "Robinhood OAuth token exchange");
    saveTokens({
      accessToken: String(result.access_token || ""),
      refreshToken: String(result.refresh_token || ""),
      tokenType: String(result.token_type || "Bearer"),
      scope: String(result.scope || "internal"),
      expiresAt: new Date(now().getTime() + Math.max(60, Number(result.expires_in || 3600)) * 1000).toISOString(),
      accountIdentityHash: "",
      connectedAt: nowIso(now),
    });
    mcpSessionId = "";
    await discoverTools();
    return { ...publicStatus(), approvalId: request.approvalId };
  }

  async function accessToken() {
    const current = loadTokens();
    if (!current?.accessToken) throw new Error("Robinhood OAuth is not connected.");
    if (new Date(current.expiresAt || 0).getTime() - now().getTime() > 60_000) return current.accessToken;
    if (!current.refreshToken) throw new Error("Robinhood OAuth expired and no refresh token is available.");
    const client = loadRegistration();
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: client.client_id,
      refresh_token: current.refreshToken,
    });
    const result = await fetchJson(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: body.toString(),
    }, "Robinhood OAuth refresh");
    saveTokens({
      ...current,
      accessToken: String(result.access_token || ""),
      refreshToken: String(result.refresh_token || current.refreshToken),
      expiresAt: new Date(now().getTime() + Math.max(60, Number(result.expires_in || 3600)) * 1000).toISOString(),
    });
    mcpSessionId = "";
    return tokens.accessToken;
  }

  async function rpc(method, params = {}, allowEmpty = false, notification = false) {
    const token = await accessToken();
    if (!notification) rpcId += 1;
    const response = await fetchImpl(MCP_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(mcpSessionId ? { "mcp-session-id": mcpSessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id: rpcId }), method, params }),
    });
    const text = await response.text();
    const payload = parseMcpPayload(text, response.headers.get("content-type") || "");
    const nextSession = response.headers.get("mcp-session-id");
    if (nextSession) mcpSessionId = nextSession;
    if (!response.ok || payload?.error || (!payload && !allowEmpty)) {
      const detail = payload?.error?.message || text || `HTTP ${response.status}`;
      throw new Error(`Robinhood MCP ${method} failed: ${String(detail).slice(0, 500)}`);
    }
    return payload?.result ?? null;
  }

  async function ensureSession() {
    if (mcpSessionId) return;
    await rpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "Argentum Stock Office", version: "1.0.0" },
    });
    await rpc("notifications/initialized", {}, true, true);
  }

  async function discoverTools() {
    await ensureSession();
    const result = await rpc("tools/list", {});
    tools = (Array.isArray(result?.tools) ? result.tools : []).map((tool) => ({
      name: String(tool?.name || "").trim().toLowerCase(),
      inputSchema: tool?.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : { type: "object", properties: {} },
    })).filter((tool) => tool.name);
    observedAt = nowIso(now);
    const names = tools.map((tool) => tool.name);
    const missing = [...REQUIRED_READ_TOOLS, ...REQUIRED_EXECUTION_TOOLS].filter((name) => !names.includes(name));
    if (missing.length) throw new Error(`Robinhood MCP is missing required tools: ${missing.join(", ")}.`);
    lastError = "";
    return tools;
  }

  function toolDefinition(name) {
    return tools.find((tool) => tool.name === name) || null;
  }

  function accountArgs(name, account, extra = {}) {
    const definition = toolDefinition(name);
    if (!definition) throw new Error(`Robinhood MCP tool is unavailable: ${name}.`);
    const properties = definition.inputSchema?.properties || {};
    const required = Array.isArray(definition.inputSchema?.required) ? definition.inputSchema.required : [];
    const args = { ...extra };
    if (properties.account_number && account.accountNumber) args.account_number = account.accountNumber;
    if (properties.account_id && account.accountId) args.account_id = account.accountId;
    if (properties.accountId && account.accountId) args.accountId = account.accountId;
    const missing = required.filter((key) => args[key] === undefined);
    if (missing.length) throw new Error(`${name} requires unsupported argument(s): ${missing.join(", ")}.`);
    return args;
  }

  async function callTool(name, args = {}) {
    if (!tools.length) await discoverTools();
    const result = await rpc("tools/call", { name, arguments: args });
    if (result?.isError) throw new Error(`Robinhood ${name} returned an error: ${JSON.stringify(toolResultValue(result)).slice(0, 500)}`);
    return toolResultValue(result);
  }

  async function readBrokerSnapshot() {
    try {
      await discoverTools();
      const accountsPayload = await callTool("get_accounts", {});
      const account = identifyAgenticAccount(accountsPayload);
      activeAccount = account;
      const currentTokens = loadTokens();
      if (currentTokens.accountIdentityHash && currentTokens.accountIdentityHash !== account.identityHash) {
        throw new Error("The Agentic account identity changed; disconnect and explicitly reconnect before continuing.");
      }
      if (!currentTokens.accountIdentityHash) saveTokens({ ...currentTokens, accountIdentityHash: account.identityHash });
      const [portfolioPayload, positionsPayload, ordersPayload] = await Promise.all([
        callTool("get_portfolio", accountArgs("get_portfolio", account)),
        callTool("get_equity_positions", accountArgs("get_equity_positions", account)),
        callTool("get_equity_orders", accountArgs("get_equity_orders", account)),
      ]);
      const positionsWithoutQuotes = normalizePositions(positionsPayload);
      const symbols = positionsWithoutQuotes.map((position) => position.symbol);
      let quotesPayload = {};
      if (symbols.length) {
        const definition = toolDefinition("get_equity_quotes");
        const properties = definition?.inputSchema?.properties || {};
        if (properties.symbols) {
          quotesPayload = await callTool("get_equity_quotes", accountArgs("get_equity_quotes", account, { symbols }));
        } else if (properties.symbol) {
          quotesPayload = await Promise.all(symbols.map((symbol) => callTool(
            "get_equity_quotes",
            accountArgs("get_equity_quotes", account, { symbol }),
          )));
        } else {
          throw new Error("Robinhood get_equity_quotes does not expose a supported symbol or symbols argument.");
        }
      }
      const quotesBySymbol = {};
      for (const object of walkObjects(quotesPayload)) {
        const symbol = stringValue([object], ["symbol", "ticker"]).toUpperCase();
        const price = finiteNumber(firstValue([object], ["price", "mark_price", "last_trade_price", "last_price"]), null);
        if (symbol && price !== null) quotesBySymbol[symbol] = price;
      }
      const positions = normalizePositions(positionsPayload, quotesBySymbol);
      const orders = normalizeOrders(ordersPayload);
      const portfolioObjects = walkObjects(portfolioPayload);
      const accountObjects = walkObjects(account.raw);
      const accountValue = moneyValue(portfolioObjects, ["portfolio_value", "account_value", "equity", "total_value"]);
      const buyingPower = moneyValue(portfolioObjects, ["buying_power", "real_time_buying_power", "available_buying_power"]);
      const cash = moneyValue(portfolioObjects, ["cash", "cash_available", "withdrawable_cash"]);
      const dayPnlDollars = moneyValue(portfolioObjects, ["day_pnl", "today_pnl", "day_gain_loss", "today_gain_loss", "todays_profit_loss", "today_profit_loss", "todays_return"]);
      const dayPnlPct = finiteNumber(firstValue(portfolioObjects, ["day_pnl_pct", "today_pnl_pct", "day_gain_loss_percent", "today_gain_loss_percent", "todays_return_percent"]), null);
      brokerSnapshot = {
        configured: true,
        account: maskAccount(account.accountNumber || account.accountId),
        accountIdentityHash: account.identityHash,
        accountValue: accountValue === null ? null : `$${accountValue.toFixed(2)}`,
        cash: cash === null ? null : `$${cash.toFixed(2)}`,
        buyingPower: buyingPower === null ? null : `$${buyingPower.toFixed(2)}`,
        dayPnlDollars,
        dayPnlPct,
        positions,
        openOrders: orders.filter((order) => !["filled", "cancelled", "canceled", "rejected", "failed", "expired"].includes(order.state)),
        orders,
        connector: {
          ...registrationStatus(),
          oauthAuthenticated: true,
          endpoint: MCP_ENDPOINT,
          tools: tools.map((tool) => tool.name),
          observedAt,
        },
        updatedAt: nowIso(now),
        provenance: "official_robinhood_mcp_live_read",
        accountType: stringValue(accountObjects, ["account_type", "type", "nickname", "name"]).slice(0, 80),
      };
      lastError = "";
      return brokerSnapshot;
    } catch (error) {
      lastError = error.message;
      brokerSnapshot = null;
      throw error;
    }
  }

  async function refreshBrokerSnapshot() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = readBrokerSnapshot();
    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  async function refreshIfStale(maxAgeMs = 60_000) {
    const current = loadTokens();
    if (!current?.accessToken) return currentBrokerSnapshot();
    const ageMs = brokerSnapshot?.updatedAt ? now().getTime() - new Date(brokerSnapshot.updatedAt).getTime() : Number.POSITIVE_INFINITY;
    if (brokerSnapshot && Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= Math.max(5_000, finiteNumber(maxAgeMs, 60_000))) return brokerSnapshot;
    return refreshBrokerSnapshot();
  }

  function currentBrokerSnapshot() {
    if (brokerSnapshot) return brokerSnapshot;
    const current = loadTokens();
    return {
      configured: false,
      account: "",
      accountValue: null,
      cash: null,
      buyingPower: null,
      positions: [],
      openOrders: [],
      orders: [],
      dayPnlDollars: null,
      dayPnlPct: null,
      connector: {
        ...registrationStatus(),
        oauthAuthenticated: Boolean(current?.accessToken),
        endpoint: MCP_ENDPOINT,
        tools: tools.map((tool) => tool.name),
        observedAt,
      },
      updatedAt: null,
      provenance: "official_robinhood_mcp_session_unverified",
    };
  }

  async function executeApprovedEnvelope(envelope = {}) {
    const before = await refreshBrokerSnapshot();
    const account = activeAccount;
    if (!account || account.identityHash !== before.accountIdentityHash) throw new Error("The verified Agentic account context is unavailable.");
    const reviewArgs = { ...(envelope.reviewArgs || {}) };
    const placementArgs = { ...(envelope.placementArgs || {}) };
    const symbol = String(reviewArgs.symbol || "").toUpperCase();
    if (!symbol || symbol !== String(placementArgs.symbol || "").toUpperCase()) throw new Error("Review and placement symbols do not match.");
    const quoteDefinition = toolDefinition("get_equity_quotes");
    const quoteProperties = quoteDefinition?.inputSchema?.properties || {};
    const quoteExtra = quoteProperties.symbols ? { symbols: [symbol] } : quoteProperties.symbol ? { symbol } : {};
    const tradabilityDefinition = toolDefinition("get_equity_tradability");
    const tradabilityProperties = tradabilityDefinition?.inputSchema?.properties || {};
    const tradabilityExtra = tradabilityProperties.symbols ? { symbols: [symbol] } : tradabilityProperties.symbol ? { symbol } : {};
    const [quotePayload, tradabilityPayload] = await Promise.all([
      callTool("get_equity_quotes", accountArgs("get_equity_quotes", account, quoteExtra)),
      callTool("get_equity_tradability", accountArgs("get_equity_tradability", account, tradabilityExtra)),
    ]);
    const preflightWarnings = [...blockingWarnings(quotePayload), ...blockingWarnings(tradabilityPayload)];
    const tradabilityObjects = walkObjects(tradabilityPayload);
    const tradable = explicitBoolean(tradabilityObjects, ["tradable", "is_tradable", "equity_tradable"]);
    const fractional = explicitBoolean(tradabilityObjects, ["fractional_tradable", "is_fractional_tradable", "fractional"]);
    if (tradable !== true) preflightWarnings.push("Robinhood did not explicitly confirm that the equity is tradable.");
    if (reviewArgs.dollar_amount !== undefined && fractional !== true) preflightWarnings.push("Robinhood did not explicitly confirm fractional-dollar tradability.");
    const quoteObjects = walkObjects(quotePayload);
    const quotePrice = moneyValue(quoteObjects, ["price", "mark_price", "last_trade_price", "last_price", "ask_price"]);
    const referencePrice = finiteNumber(envelope.referencePrice, null);
    const maxDrift = finiteNumber(envelope.maxPriceDriftPct, 0.02);
    if (quotePrice === null || referencePrice === null || referencePrice <= 0) {
      preflightWarnings.push("A fresh Robinhood quote could not be compared with the approved reference price.");
    } else if (Math.abs(quotePrice - referencePrice) / referencePrice > maxDrift) {
      preflightWarnings.push(`Robinhood quote drift exceeded the approved ${(maxDrift * 100).toFixed(2)}% limit.`);
    }
    if (preflightWarnings.length) {
      return { reviewPassed: false, warnings: [...new Set(preflightWarnings)].slice(0, 20), placementAttempted: false, brokerOrderId: "", brokerState: "", reconciliation: { matched: false }, error: "Live quote or tradability preflight failed." };
    }
    const review = await callTool(envelope.reviewTool, accountArgs(envelope.reviewTool, account, reviewArgs));
    const warnings = blockingWarnings(review);
    if (warnings.length) {
      return { reviewPassed: false, warnings, placementAttempted: false, brokerOrderId: "", brokerState: "", reconciliation: { matched: false }, error: "Robinhood review returned blocking warnings." };
    }
    let placement;
    try {
      placement = await callTool(envelope.placementTool, accountArgs(envelope.placementTool, account, placementArgs));
    } catch (error) {
      return { reviewPassed: true, warnings: [], placementAttempted: true, brokerOrderId: "", brokerState: "unknown", reconciliation: { matched: false }, error: `Placement outcome is ambiguous and must be reconciled without retry: ${error.message}` };
    }
    const placedOrders = normalizeOrders(placement);
    const reported = placedOrders[0] || {};
    let refreshed;
    try {
      refreshed = await refreshBrokerSnapshot();
    } catch (error) {
      return { reviewPassed: true, warnings: [], placementAttempted: true, brokerOrderId: reported.orderId || "", brokerState: reported.state || "unknown", reconciliation: { matched: false }, error: `Order placement returned but reconciliation failed: ${error.message}` };
    }
    const match = (refreshed.orders || []).find((order) => (
      (reported.orderId && order.orderId === reported.orderId)
      || (placementArgs.ref_id && order.clientRefId === placementArgs.ref_id)
    ));
    return {
      reviewPassed: true,
      warnings: [],
      placementAttempted: true,
      brokerOrderId: match?.orderId || reported.orderId || "",
      brokerState: match?.state || reported.state || "unknown",
      reconciliation: {
        matched: Boolean(match),
        clientRefId: match?.clientRefId || "",
        accountIdentityHash: refreshed.accountIdentityHash,
        observedAt: refreshed.updatedAt,
      },
      error: match ? "" : "Robinhood returned a placement response, but the exact order was not found during immediate reconciliation. Do not retry placement.",
    };
  }

  function publicStatus() {
    const current = loadTokens();
    const connectorRegistration = registrationStatus();
    return {
      endpoint: MCP_ENDPOINT,
      clientRegistered: connectorRegistration.registered,
      appRegistered: connectorRegistration.appRegistered,
      codexRegistered: connectorRegistration.codexRegistered,
      codexConnectorId: connectorRegistration.codexConnectorId,
      registrationSource: connectorRegistration.registrationSource,
      oauthAuthenticated: Boolean(current?.accessToken),
      keychainAvailable: Boolean(tokenStore.ready()),
      toolContractVerified: [...REQUIRED_READ_TOOLS, ...REQUIRED_EXECUTION_TOOLS].every((name) => tools.some((tool) => tool.name === name)),
      tools: tools.map((tool) => tool.name),
      observedAt,
      snapshotVerified: brokerSnapshot?.provenance === "official_robinhood_mcp_live_read",
      snapshotUpdatedAt: brokerSnapshot?.updatedAt || null,
      accountLabel: brokerSnapshot?.account || "Not verified",
      lastError,
    };
  }

  function disconnect() {
    tokenStore.clear();
    tokens = null;
    tokensLoaded = true;
    mcpSessionId = "";
    tools = [];
    observedAt = null;
    brokerSnapshot = null;
    activeAccount = null;
    lastError = "";
    return publicStatus();
  }

  return {
    beginAuthorization,
    completeAuthorization,
    currentBrokerSnapshot,
    disconnect,
    discoverTools,
    executeApprovedEnvelope,
    publicStatus,
    refreshBrokerSnapshot,
    refreshIfStale,
  };
}

module.exports = {
  AUTHORIZATION_ENDPOINT,
  MCP_ENDPOINT,
  REGISTRATION_ENDPOINT,
  REQUIRED_EXECUTION_TOOLS,
  REQUIRED_READ_TOOLS,
  TOKEN_ENDPOINT,
  createRobinhoodMcpClient,
  detectCodexRobinhoodRegistration,
  identifyAgenticAccount,
  normalizeOrders,
  normalizePositions,
  parseMcpPayload,
  toolResultValue,
};

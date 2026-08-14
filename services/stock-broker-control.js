const crypto = require("node:crypto");

const ROBINHOOD_MCP_URL = "https://agent.robinhood.com/mcp/trading";
const BROKER_SNAPSHOT_FRESH_MINUTES = 5;
const ORDER_DRAFT_TTL_MINUTES = 15;
const DISPATCH_CLAIM_TTL_MINUTES = 2;
const MAX_ORDER_DRAFTS = 80;
const FINAL_NON_TRADE_STATES = new Set(["cancelled", "canceled", "rejected", "failed", "expired"]);
const FINAL_ORDER_STATES = new Set([...FINAL_NON_TRADE_STATES, "filled", "complete", "completed"]);
const REQUIRED_EQUITY_TOOLS = [
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

function safeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function moneyNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  return finiteNumber(String(value || "").replace(/[^0-9.-]/g, ""), 0);
}

function clamp(value, min, max, fallback = min) {
  const parsed = finiteNumber(value, fallback);
  return Math.max(min, Math.min(max, parsed));
}

function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
}

function ageMinutes(value, at = new Date()) {
  const timestamp = safeDate(value);
  if (!timestamp) return null;
  return Math.max(0, (at.getTime() - new Date(timestamp).getTime()) / 60_000);
}

function verifyRobinhoodToolContract(connector = {}, options = {}) {
  const at = options.now ? new Date(options.now) : new Date();
  const availableTools = [...new Set((Array.isArray(connector.tools) ? connector.tools : [])
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean))].sort();
  const missingTools = REQUIRED_EQUITY_TOOLS.filter((tool) => !availableTools.includes(tool));
  const observedAgeMinutes = ageMinutes(connector.observedAt, at);
  const discoveryObserved = observedAgeMinutes !== null;
  const observedFresh = observedAgeMinutes !== null && observedAgeMinutes <= BROKER_SNAPSHOT_FRESH_MINUTES;
  const registered = connector.registered === true;
  const oauthAuthenticated = connector.oauthAuthenticated === true;
  const endpointMatches = String(connector.endpoint || "").replace(/\/$/, "") === ROBINHOOD_MCP_URL;
  return {
    registered,
    registrationSource: String(connector.registrationSource || (registered ? "observed" : "none")),
    codexRegistered: connector.codexRegistered === true,
    appRegistered: connector.appRegistered === true,
    oauthAuthenticated,
    discoveryObserved,
    endpointMatches,
    observedAt: safeDate(connector.observedAt),
    observedAgeMinutes: observedAgeMinutes === null ? null : Math.round(observedAgeMinutes * 10) / 10,
    availableTools,
    missingTools,
    verified: registered && oauthAuthenticated && endpointMatches && observedFresh && missingTools.length === 0,
  };
}

function stableFingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeGuardrails(value = {}) {
  const principal = clamp(value.principalDollars ?? value.live_principal_dollars, 0, 1_000_000, 0);
  const maxTotal = clamp(value.maxTotalDollars ?? value.live_max_total_dollars, 0, 1_000_000, principal);
  const maxOrder = clamp(value.maxOrderDollars ?? value.live_max_order_dollars, 0, 1_000_000, Math.min(maxTotal, principal));
  return {
    principalDollars: principal,
    maxTotalDollars: maxTotal,
    maxOrderDollars: maxOrder,
    minOrderDollars: clamp(value.minOrderDollars ?? value.live_min_order_dollars, 0.01, 1_000_000, 1),
    cashReserveDollars: clamp(value.cashReserveDollars ?? value.live_cash_reserve_dollars, 0, 1_000_000, 0),
    dailyLossLimitPct: clamp(value.dailyLossLimitPct ?? value.daily_loss_limit_pct, 0.001, 0.25, 0.02),
    riskPerTradePct: clamp(value.riskPerTradePct ?? value.risk_per_trade_pct, 0.001, 0.1, 0.01),
    maxPositions: Math.round(clamp(value.maxPositions ?? value.max_positions, 1, 100, 5)),
    maxTradesPerDay: Math.round(clamp(value.maxTradesPerDay ?? value.max_trades_per_day, 1, 100, 3)),
    minEntryScore: Math.round(clamp(value.minEntryScore ?? value.intraday_min_entry_score, 1, 100, 85)),
    autoOrderScore: Math.round(clamp(value.autoOrderScore ?? value.intraday_auto_order_score, 1, 100, 90)),
    tradeDirection: String(value.tradeDirection ?? value.trade_direction ?? "long_only").slice(0, 40),
    lockProfits: (value.lockProfits ?? value.live_lock_profits) !== false,
  };
}

function normalizeTradeDraft(draft = {}) {
  const side = String(draft.side || "").toUpperCase();
  const status = ["blocked", "ready_for_broker_review", "awaiting_human_gate", "approved", "dispatch_claimed", "review_rejected", "reconciliation_required", "expired", "cancelled", "dispatched", "filled", "rejected"].includes(draft.status)
    ? draft.status
    : "blocked";
  return {
    id: String(draft.id || `stock-order-${crypto.randomUUID()}`).slice(0, 100),
    clientRefId: String(draft.clientRefId || crypto.randomUUID()).slice(0, 100),
    fingerprint: String(draft.fingerprint || "").replace(/[^a-f0-9]/gi, "").slice(0, 64),
    symbol: normalizeSymbol(draft.symbol),
    side: side === "SELL" ? "SELL" : "BUY",
    assetType: "equity",
    requestedDollars: clamp(draft.requestedDollars, 0, 1_000_000, 0),
    cappedDollars: clamp(draft.cappedDollars, 0, 1_000_000, 0),
    estimatedQuantity: clamp(draft.estimatedQuantity, 0, 1_000_000, 0),
    referencePrice: clamp(draft.referencePrice, 0, 10_000_000, 0),
    deployedBeforeDollars: clamp(draft.deployedBeforeDollars, 0, 1_000_000_000, 0),
    capitalAfterDollars: clamp(draft.capitalAfterDollars, 0, 1_000_000_000, 0),
    positionAfterDollars: clamp(draft.positionAfterDollars, 0, 1_000_000_000, 0),
    riskBudgetDollars: clamp(draft.riskBudgetDollars, 0, 1_000_000_000, 0),
    riskSizedMaxDollars: clamp(draft.riskSizedMaxDollars, 0, 1_000_000_000, 0),
    orderType: draft.orderType === "limit" ? "limit" : "market",
    timeInForce: "gfd",
    marketHours: "regular_hours",
    sourceType: String(draft.sourceType || "evaluator").slice(0, 40),
    sourceId: String(draft.sourceId || "").slice(0, 180),
    accountIdentityHash: String(draft.accountIdentityHash || "").replace(/[^a-f0-9]/gi, "").slice(0, 64),
    thesis: String(draft.thesis || "").slice(0, 500),
    blockers: (Array.isArray(draft.blockers) ? draft.blockers : []).map((item) => String(item).slice(0, 260)).slice(0, 16),
    checks: (Array.isArray(draft.checks) ? draft.checks : []).map((item) => ({
      name: String(item?.name || "check").slice(0, 100),
      passed: Boolean(item?.passed),
      detail: String(item?.detail || "").slice(0, 260),
    })).slice(0, 20),
    status,
    approvalId: String(draft.approvalId || "").slice(0, 120),
    dispatchClaimId: String(draft.dispatchClaimId || "").slice(0, 120),
    dispatchClaimHash: String(draft.dispatchClaimHash || "").replace(/[^a-f0-9]/gi, "").slice(0, 64),
    dispatchClaimedAt: safeDate(draft.dispatchClaimedAt),
    dispatchExpiresAt: safeDate(draft.dispatchExpiresAt),
    dispatchAttempts: Math.round(clamp(draft.dispatchAttempts, 0, 1, 0)),
    brokerReviewPassed: typeof draft.brokerReviewPassed === "boolean" ? draft.brokerReviewPassed : null,
    brokerWarnings: (Array.isArray(draft.brokerWarnings) ? draft.brokerWarnings : []).map((item) => String(item).slice(0, 260)).slice(0, 12),
    brokerOrderId: String(draft.brokerOrderId || "").slice(0, 160),
    brokerState: String(draft.brokerState || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 60),
    brokerReconciled: draft.brokerReconciled === true,
    brokerEvidenceSource: String(draft.brokerEvidenceSource || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 80),
    reconciliationObservedAt: safeDate(draft.reconciliationObservedAt),
    lastDispatchError: String(draft.lastDispatchError || "").slice(0, 500),
    liveOrderPlaced: Boolean(draft.liveOrderPlaced),
    createdAt: safeDate(draft.createdAt) || new Date().toISOString(),
    expiresAt: safeDate(draft.expiresAt) || new Date(Date.now() + ORDER_DRAFT_TTL_MINUTES * 60_000).toISOString(),
    updatedAt: safeDate(draft.updatedAt) || safeDate(draft.createdAt) || new Date().toISOString(),
  };
}

function roundedMoney(value) {
  return Math.round(finiteNumber(value, 0) * 100) / 100;
}

function marketDayKey(value, timeZone = "America/New_York") {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

function orderIsActive(order = {}) {
  const state = String(order.state || order.status || "").toLowerCase();
  return Boolean(state) && !FINAL_ORDER_STATES.has(state);
}

function orderNotional(order = {}, positionPrices = {}) {
  const direct = finiteNumber(order.dollarAmount ?? order.dollar_amount ?? order.notional ?? order.amount, null);
  if (direct !== null && direct >= 0) return direct;
  const quantity = finiteNumber(order.quantity ?? order.shares, null);
  const symbol = normalizeSymbol(order.symbol);
  const price = finiteNumber(order.price ?? order.limitPrice ?? order.limit_price ?? positionPrices[symbol], null);
  return quantity !== null && quantity >= 0 && price !== null && price > 0 ? quantity * price : null;
}

function portfolioCapitalState(snapshot = {}, options = {}) {
  const at = options.now ? new Date(options.now) : new Date();
  const broker = snapshot.broker || {};
  const guardrails = normalizeGuardrails(snapshot.guardrails || {});
  const positions = Array.isArray(broker.positions) ? broker.positions : [];
  const positionPrices = {};
  const positionValues = [];
  const unknownPositionPrices = [];
  for (const position of positions) {
    const symbol = normalizeSymbol(position?.symbol);
    const quantity = finiteNumber(position?.quantity, 0);
    const currentPrice = finiteNumber(position?.currentPrice ?? position?.current_price, null);
    if (!symbol || quantity <= 0) continue;
    if (currentPrice === null || currentPrice <= 0) {
      unknownPositionPrices.push(symbol);
      positionValues.push({ symbol, quantity, currentPrice: null, marketValue: null });
      continue;
    }
    positionPrices[symbol] = currentPrice;
    positionValues.push({ symbol, quantity, currentPrice, marketValue: roundedMoney(quantity * currentPrice) });
  }
  const deployedDollars = roundedMoney(positionValues.reduce((sum, item) => sum + finiteNumber(item.marketValue, 0), 0));
  const orders = Array.isArray(broker.orders)
    ? broker.orders
    : (Array.isArray(broker.openOrders) ? broker.openOrders.filter((item) => item && typeof item === "object") : []);
  const openOrders = (Array.isArray(broker.openOrders) ? broker.openOrders : orders.filter(orderIsActive))
    .filter((item) => item && typeof item === "object");
  let pendingBuyDollars = 0;
  const unknownPendingBuyOrders = [];
  for (const order of openOrders) {
    if (String(order.side || "").toUpperCase() !== "BUY" || !orderIsActive(order)) continue;
    const notional = orderNotional(order, positionPrices);
    if (notional === null) unknownPendingBuyOrders.push(String(order.orderId || order.clientRefId || order.symbol || "unknown").slice(0, 160));
    else pendingBuyDollars += notional;
  }
  pendingBuyDollars = roundedMoney(pendingBuyDollars);
  const currentDay = marketDayKey(at);
  const tradeOrdersToday = orders.filter((order) => {
    if (order?.planned === true || FINAL_NON_TRADE_STATES.has(String(order?.state || order?.status || "").toLowerCase())) return false;
    return marketDayKey(order?.createdAt || order?.created_at) === currentDay;
  });
  const tradeCountEvidenceAvailable = Array.isArray(broker.orders);
  const tradesToday = tradeCountEvidenceAvailable ? tradeOrdersToday.length : null;
  const principalLimit = Math.min(guardrails.principalDollars, guardrails.maxTotalDollars);
  const committedDollars = roundedMoney(deployedDollars + pendingBuyDollars);
  const buyingPowerDollars = moneyNumber(broker.buyingPower);
  const availableByPolicy = Math.max(0, principalLimit - committedDollars);
  const availableByCash = Math.max(0, buyingPowerDollars - guardrails.cashReserveDollars - pendingBuyDollars);
  const availableForNewBuys = roundedMoney(Math.min(availableByPolicy, availableByCash));
  const rawDayPnl = finiteNumber(broker.dayPnlDollars ?? broker.day_pnl_dollars, null);
  const dayPnlDollars = rawDayPnl === null ? null : roundedMoney(rawDayPnl);
  const dailyLossEvidenceAvailable = dayPnlDollars !== null;
  const dailyLossLimitDollars = roundedMoney(guardrails.principalDollars * guardrails.dailyLossLimitPct);
  const dailyLossLocked = dailyLossEvidenceAvailable && dayPnlDollars <= -dailyLossLimitDollars;
  const tradeLimitReached = tradesToday !== null && tradesToday >= guardrails.maxTradesPerDay;
  const positionPricesVerified = unknownPositionPrices.length === 0;
  const pendingOrdersVerified = unknownPendingBuyOrders.length === 0;
  const verified = positionPricesVerified && pendingOrdersVerified && dailyLossEvidenceAvailable && tradeCountEvidenceAvailable;
  return {
    verified,
    principalDollars: guardrails.principalDollars,
    maxDeployedDollars: guardrails.maxTotalDollars,
    deployedDollars,
    pendingBuyDollars,
    committedDollars,
    availableForNewBuys,
    cashReserveDollars: guardrails.cashReserveDollars,
    buyingPowerDollars,
    positionValues,
    unknownPositionPrices,
    unknownPendingBuyOrders,
    positionPricesVerified,
    pendingOrdersVerified,
    dayPnlDollars,
    dailyLossEvidenceAvailable,
    dailyLossLimitDollars,
    dailyLossLocked,
    tradesToday,
    maxTradesPerDay: guardrails.maxTradesPerDay,
    tradeCountEvidenceAvailable,
    tradeLimitReached,
    maxPositionDollars: roundedMoney(guardrails.maxTotalDollars / Math.max(1, guardrails.maxPositions)),
  };
}

function normalizeTradeDrafts(drafts = []) {
  return (Array.isArray(drafts) ? drafts : [])
    .map(normalizeTradeDraft)
    .filter((draft) => draft.symbol)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_ORDER_DRAFTS);
}

function brokerControlOverview(snapshot = {}, options = {}) {
  const at = options.now ? new Date(options.now) : new Date();
  const broker = snapshot.broker || {};
  const guardrails = normalizeGuardrails(snapshot.guardrails || {});
  const snapshotAgeMinutes = ageMinutes(broker.updatedAt, at);
  const snapshotFresh = Boolean(broker.configured) && snapshotAgeMinutes !== null && snapshotAgeMinutes <= BROKER_SNAPSHOT_FRESH_MINUTES;
  const toolContract = verifyRobinhoodToolContract(broker.connector || {}, { now: at });
  const authenticationVerified = snapshotFresh && toolContract.verified;
  const buyingPowerAvailable = broker.buyingPower !== null && broker.buyingPower !== undefined && broker.buyingPower !== "";
  const cashAvailable = broker.cash !== null && broker.cash !== undefined && broker.cash !== "";
  const accountValueAvailable = broker.accountValue !== null && broker.accountValue !== undefined && broker.accountValue !== "";
  const buyingPower = buyingPowerAvailable ? moneyNumber(broker.buyingPower) : 0;
  const cash = cashAvailable ? moneyNumber(broker.cash) : 0;
  const accountValue = accountValueAvailable ? moneyNumber(broker.accountValue) : 0;
  const capital = portfolioCapitalState(snapshot, { now: at });
  const killSwitchActive = snapshot.killSwitch?.active !== false;
  const executionMode = snapshot.executionMode === "paper" ? "paper" : "live";
  const connectorStatus = !toolContract.registered
    ? "setup_required"
    : !toolContract.oauthAuthenticated
      ? "stock_office_link_required"
    : !toolContract.verified
      ? "tool_contract_pending"
      : snapshotFresh
        ? "live_snapshot_verified"
        : "stale_snapshot";
  const blockers = [];
  if (executionMode !== "live") blockers.push("Stock Office is in PAPER mode. Set STOCK_GURU_EXECUTION_MODE=live and restart before any broker order can be authorized.");
  if (!toolContract.registered) blockers.push("The official Robinhood Trading MCP registration has not been observed.");
  if (toolContract.registered && !toolContract.oauthAuthenticated) blockers.push("Robinhood is registered, but this Stock Office app session is not linked to the dedicated Agentic account.");
  if (toolContract.oauthAuthenticated && !toolContract.endpointMatches) blockers.push("The observed connector endpoint does not match the official Robinhood Trading MCP endpoint.");
  if (toolContract.oauthAuthenticated && toolContract.discoveryObserved && toolContract.missingTools.length) blockers.push(`Required Robinhood equity tools are missing: ${toolContract.missingTools.join(", ")}.`);
  if (toolContract.oauthAuthenticated && (!toolContract.discoveryObserved || toolContract.observedAgeMinutes > BROKER_SNAPSHOT_FRESH_MINUTES)) blockers.push("Robinhood connector/tool discovery is missing or stale; re-verify the tool contract.");
  if (!snapshotFresh) blockers.push(broker.configured ? "Broker snapshot is stale; reconnect Robinhood and refresh live account data." : "A live Robinhood account snapshot has not been verified.");
  if (!broker.account) blockers.push("A dedicated Robinhood Agentic account has not been verified.");
  if (!broker.accountIdentityHash) blockers.push("The live snapshot is not cryptographically bound to one dedicated Agentic account.");
  if (buyingPower <= 0) blockers.push("Verified buying power is unavailable or zero.");
  if (!capital.positionPricesVerified) blockers.push(`Live market value is unavailable for owned position(s): ${capital.unknownPositionPrices.join(", ")}.`);
  if (!capital.pendingOrdersVerified) blockers.push("One or more pending BUY orders has no verifiable notional; deployed capital cannot be calculated safely.");
  if (!capital.dailyLossEvidenceAvailable) blockers.push("Today's account P&L is unavailable; the daily-loss lock cannot be verified.");
  if (capital.dailyLossLocked) blockers.push(`Today's P&L reached the $${capital.dailyLossLimitDollars.toFixed(2)} daily-loss lock.`);
  if (!capital.tradeCountEvidenceAvailable) blockers.push("Today's official Robinhood order history is unavailable; the daily trade limit cannot be verified.");
  if (capital.tradeLimitReached) blockers.push(`The ${capital.maxTradesPerDay}-trade daily limit has been reached.`);
  if (capital.availableForNewBuys <= 0) blockers.push("No deployable capital remains after current positions, pending buys, and the cash reserve.");
  if (killSwitchActive) blockers.push("The live-order kill switch is active or has not been explicitly cleared.");
  return {
    provider: "Robinhood Agentic Trading",
    transport: "official_streamable_http_mcp",
    endpoint: ROBINHOOD_MCP_URL,
    connectorStatus,
    registrationStatus: toolContract.registrationSource === "codex_config"
      ? "registered_in_codex"
      : toolContract.registered
        ? "registered_in_argentum"
        : "setup_required",
    authenticationVerified,
    toolContract,
    accountScope: "dedicated_agentic_account_only",
    accountLabel: broker.account || "Not verified",
    accountIdentityHash: broker.accountIdentityHash || "",
    snapshotUpdatedAt: broker.updatedAt || null,
    snapshotAgeMinutes: snapshotAgeMinutes === null ? null : Math.round(snapshotAgeMinutes * 10) / 10,
    accountValueDollars: accountValueAvailable ? accountValue : null,
    cashDollars: cashAvailable ? cash : null,
    buyingPowerDollars: buyingPowerAvailable ? buyingPower : null,
    equityValueDollars: broker.equityValue === null || broker.equityValue === undefined ? null : moneyNumber(broker.equityValue),
    optionsValueDollars: broker.optionsValue === null || broker.optionsValue === undefined ? null : moneyNumber(broker.optionsValue),
    cryptoValueDollars: broker.cryptoValue === null || broker.cryptoValue === undefined ? null : moneyNumber(broker.cryptoValue),
    unsettledFundsDollars: broker.unsettledFunds === null || broker.unsettledFunds === undefined ? null : moneyNumber(broker.unsettledFunds),
    pendingDepositsDollars: broker.pendingDeposits === null || broker.pendingDeposits === undefined ? null : moneyNumber(broker.pendingDeposits),
    dayPnlDollars: broker.dayPnlDollars === null || broker.dayPnlDollars === undefined ? null : moneyNumber(broker.dayPnlDollars),
    dayPnlPct: finiteNumber(broker.dayPnlPct, null),
    realizedPnlDollars: broker.realizedPnlDollars === null || broker.realizedPnlDollars === undefined ? null : moneyNumber(broker.realizedPnlDollars),
    unrealizedPnlDollars: broker.unrealizedPnlDollars === null || broker.unrealizedPnlDollars === undefined ? null : moneyNumber(broker.unrealizedPnlDollars),
    positions: Array.isArray(broker.positions) ? broker.positions : [],
    openOrderCount: Array.isArray(broker.openOrders) ? broker.openOrders.length : 0,
    killSwitchActive,
    executionMode: executionMode.toUpperCase(),
    guardrails,
    capital,
    liveReady: blockers.length === 0,
    buyReady: blockers.length === 0,
    exitReady: executionMode === "live" && authenticationVerified && Boolean(broker.account) && controlHasOwnedPositions(broker),
    blockers: [...new Set(blockers)].slice(0, 10),
    requiredTools: REQUIRED_EQUITY_TOOLS,
    assets: {
      equities: { available: true, executionPath: "Robinhood Trading MCP" },
      options: { available: true, executionPath: "Robinhood Trading MCP", enabledInArgentum: false },
      crypto: { available: false, executionPath: "Robinhood Crypto API / future Agentic rollout", enabledInArgentum: false },
      eventContracts: { available: false, executionPath: "Robinhood app only", enabledInArgentum: false },
    },
    orderPolicy: "exact_order_human_gate",
    liveOrdersPlacedThisSession: 0,
  };
}

function controlHasOwnedPositions(broker = {}) {
  return (Array.isArray(broker.positions) ? broker.positions : []).some((position) => finiteNumber(position?.sharesAvailableForSells ?? position?.quantity, 0) > 0);
}

function addCheck(checks, blockers, name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail });
  if (!passed) blockers.push(detail);
}

function buildTradeDraft(input = {}, snapshot = {}, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const approvalTtlMinutes = clamp(options.approvalTtlMinutes, 1, 30, ORDER_DRAFT_TTL_MINUTES);
  const control = brokerControlOverview(snapshot, { now, registrationStatus: options.registrationStatus });
  const guardrails = control.guardrails;
  const symbol = normalizeSymbol(input.symbol);
  const side = String(input.side || "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY";
  const requestedDollars = clamp(input.requestedDollars, 0, 1_000_000, 0);
  const record = (snapshot.records || []).find((item) => item.ticker === symbol) || null;
  const mirror = input.candidateId
    ? (snapshot.mirror?.candidates || []).find((item) => item.id === input.candidateId) || null
    : null;
  const position = (snapshot.positions || []).find((item) => item.symbol === symbol) || null;
  const referencePrice = finiteNumber(mirror?.currentPrice ?? record?.currentPrice ?? position?.currentPrice, 0);
  const estimatedQuantity = referencePrice > 0 ? Math.floor((requestedDollars / referencePrice) * 1_000_000) / 1_000_000 : 0;
  const capital = control.capital;
  const symbolPositionValue = capital.positionValues.find((item) => item.symbol === symbol)?.marketValue || 0;
  const pendingSymbolBuyDollars = (Array.isArray(snapshot.broker?.openOrders) ? snapshot.broker.openOrders : [])
    .filter((order) => order && typeof order === "object" && orderIsActive(order) && String(order.side || "").toUpperCase() === "BUY" && normalizeSymbol(order.symbol) === symbol)
    .reduce((sum, order) => sum + finiteNumber(orderNotional(order, Object.fromEntries(capital.positionValues.map((item) => [item.symbol, item.currentPrice]))), 0), 0);
  const conflictingOpenOrder = (Array.isArray(snapshot.broker?.openOrders) ? snapshot.broker.openOrders : [])
    .some((order) => order && typeof order === "object" && orderIsActive(order) && normalizeSymbol(order.symbol) === symbol);
  const blockers = [];
  const checks = [];

  addCheck(checks, blockers, "symbol", Boolean(symbol), "A valid equity symbol is required.");
  addCheck(checks, blockers, "official_connector", control.authenticationVerified, "Robinhood MCP must be authenticated and refreshed before order review.");
  addCheck(checks, blockers, "agentic_account_identity", Boolean(snapshot.broker?.accountIdentityHash), "A cryptographically bound Agentic-account identity is required.");
  if (side === "BUY") {
    addCheck(checks, blockers, "kill_switch", !control.killSwitchActive, "The live-order kill switch must be explicitly cleared for a new BUY.");
    addCheck(checks, blockers, "fresh_price", Boolean(record?.dataFresh) && referencePrice > 0, "Fresh evaluator and quote data are required for a BUY.");
  } else {
    addCheck(checks, blockers, "risk_reducing_exit", Boolean(position) && referencePrice > 0, "A SELL must reduce a verified owned position.");
  }
  addCheck(checks, blockers, "order_minimum", requestedDollars >= guardrails.minOrderDollars, `Order must be at least $${guardrails.minOrderDollars.toFixed(2)}.`);
  addCheck(checks, blockers, "order_cap", requestedDollars <= guardrails.maxOrderDollars, `Order exceeds the $${guardrails.maxOrderDollars.toFixed(2)} per-order cap.`);
  addCheck(checks, blockers, "open_orders", !conflictingOpenOrder, `An active broker order already exists for ${symbol || "this symbol"}; reconcile it first.`);

  if (side === "BUY") {
    addCheck(checks, blockers, "valid_setup", record?.status === "valid_setup", "BUY requires a current valid evaluator setup.");
    addCheck(checks, blockers, "entry_score", finiteNumber(record?.score, 0) >= guardrails.minEntryScore, `BUY score must be at least ${guardrails.minEntryScore}.`);
    addCheck(checks, blockers, "buying_power", control.buyingPowerDollars - guardrails.cashReserveDollars >= requestedDollars, "Verified buying power after the cash reserve is insufficient.");
    addCheck(checks, blockers, "position_count", control.positions.length < guardrails.maxPositions || Boolean(position), `Maximum ${guardrails.maxPositions} positions reached.`);
    addCheck(checks, blockers, "capital_evidence", capital.verified, "Official position values, pending-order notionals, today's P&L, and today's order history must all be verified.");
    addCheck(checks, blockers, "maximum_deployed", requestedDollars <= capital.availableForNewBuys, `Order exceeds the $${capital.availableForNewBuys.toFixed(2)} remaining deployable capital.`);
    addCheck(checks, blockers, "daily_loss_lock", !capital.dailyLossLocked, `Today's P&L reached the $${capital.dailyLossLimitDollars.toFixed(2)} daily-loss lock.`);
    addCheck(checks, blockers, "daily_trade_limit", !capital.tradeLimitReached, `The ${guardrails.maxTradesPerDay}-trade daily limit has been reached.`);
    addCheck(checks, blockers, "position_concentration", symbolPositionValue + pendingSymbolBuyDollars + requestedDollars <= capital.maxPositionDollars + 0.01, `Position would exceed the $${capital.maxPositionDollars.toFixed(2)} per-symbol allocation implied by maximum deployed capital and maximum positions.`);
    const stopLoss = finiteNumber(record?.stopLoss, null);
    const stopDistancePct = stopLoss !== null && stopLoss > 0 && stopLoss < referencePrice ? (referencePrice - stopLoss) / referencePrice : null;
    const riskBudgetDollars = guardrails.principalDollars * guardrails.riskPerTradePct;
    const riskSizedMaxDollars = stopDistancePct ? riskBudgetDollars / stopDistancePct : 0;
    addCheck(checks, blockers, "defined_downside", stopDistancePct !== null, "BUY requires a positive stop below the fresh reference price.");
    addCheck(checks, blockers, "risk_per_trade", stopDistancePct !== null && requestedDollars <= riskSizedMaxDollars + 0.01, `Order exceeds risk-per-trade sizing; maximum is $${riskSizedMaxDollars.toFixed(2)} at the current stop.`);
  } else {
    const availableShares = finiteNumber(position?.sharesAvailableForSells ?? position?.quantity, 0);
    const holdingValue = availableShares * referencePrice;
    addCheck(checks, blockers, "owned_position", availableShares > 0, "SELL requires a verified owned long position; short selling is blocked.");
    addCheck(checks, blockers, "sell_size", holdingValue + 0.01 >= requestedDollars, "SELL notional exceeds verified shares available.");
    addCheck(checks, blockers, "sell_quantity", estimatedQuantity > 0 && estimatedQuantity <= availableShares, "SELL must resolve to a positive exact quantity within verified shares available.");
  }

  if (mirror) {
    const ownedPositionExit = side === "SELL" && mirror.brokerPositionRequired === true && Boolean(position);
    addCheck(checks, blockers, "mirror_source", ((mirror.humanGateEligible && mirror.status === "paper_ready") || ownedPositionExit) && !snapshot.mirror?.stale, "Copy signal must be fresh, attributable, and eligible for either paper mirroring or an owned-position exit review.");
    addCheck(checks, blockers, "mirror_side", mirror.side === side && mirror.symbol === symbol, "Copy signal does not match the proposed order.");
    if (!ownedPositionExit) addCheck(checks, blockers, "mirror_cap", requestedDollars <= finiteNumber(mirror.mirrorNotionalDollars, 0), "Order exceeds the source-specific copy cap.");
  }

  const cappedDollars = blockers.length
    ? 0
    : side === "BUY"
      ? Math.min(requestedDollars, guardrails.maxOrderDollars, Math.max(0, control.buyingPowerDollars - guardrails.cashReserveDollars))
      : Math.min(requestedDollars, guardrails.maxOrderDollars);
  const sourceType = mirror ? "copy_signal" : "evaluator";
  const sourceId = mirror?.fingerprint || record?.id || "";
  const core = {
    symbol,
    side,
    requestedDollars: Math.round(requestedDollars * 100) / 100,
    referencePrice,
    sourceType,
    sourceId,
    recordUpdatedAt: record?.lastUpdated || null,
    accountIdentityHash: snapshot.broker?.accountIdentityHash || "",
    guardrailFingerprint: stableFingerprint(guardrails),
  };
  const createdAt = now.toISOString();
  return normalizeTradeDraft({
    id: `stock-order-${crypto.randomUUID()}`,
    clientRefId: crypto.randomUUID(),
    fingerprint: stableFingerprint(core),
    symbol,
    side,
    requestedDollars,
    cappedDollars,
    estimatedQuantity,
    referencePrice,
    deployedBeforeDollars: capital.deployedDollars,
    capitalAfterDollars: side === "BUY" ? capital.committedDollars + requestedDollars : Math.max(0, capital.committedDollars - requestedDollars),
    positionAfterDollars: side === "BUY" ? symbolPositionValue + pendingSymbolBuyDollars + requestedDollars : Math.max(0, symbolPositionValue - requestedDollars),
    riskBudgetDollars: side === "BUY" ? guardrails.principalDollars * guardrails.riskPerTradePct : 0,
    riskSizedMaxDollars: side === "BUY" && finiteNumber(record?.stopLoss, null) > 0 && finiteNumber(record?.stopLoss, null) < referencePrice
      ? (guardrails.principalDollars * guardrails.riskPerTradePct) / ((referencePrice - finiteNumber(record.stopLoss, 0)) / referencePrice)
      : 0,
    orderType: "market",
    sourceType,
    sourceId,
    accountIdentityHash: snapshot.broker?.accountIdentityHash || "",
    thesis: mirror
      ? `${mirror.traderName} ${side} disclosure passed current copy-source checks; broker review must reprice it.`
      : `${record?.decision || "Evaluator review"}; score ${record?.score ?? "unknown"}; ${record?.mainRisk || "risk note unavailable"}`,
    blockers: [...new Set(blockers)],
    checks,
    status: blockers.length ? "blocked" : "ready_for_broker_review",
    liveOrderPlaced: false,
    createdAt,
    expiresAt: new Date(now.getTime() + approvalTtlMinutes * 60_000).toISOString(),
    updatedAt: createdAt,
  });
}

function buildCopyPortfolioPlan(snapshot = {}, options = {}) {
  const at = options.now ? new Date(options.now) : new Date();
  const control = brokerControlOverview(snapshot, { now: at });
  const guardrails = control.guardrails;
  const proposals = [];
  const seen = new Set();
  const recordBySymbol = Object.fromEntries((snapshot.records || []).map((record) => [normalizeSymbol(record.ticker), record]));
  const positionBySymbol = Object.fromEntries((control.positions || []).map((position) => [normalizeSymbol(position.symbol), position]));
  const opportunityBySymbol = Object.fromEntries((snapshot.intelligence?.opportunities || []).map((opportunity) => [normalizeSymbol(opportunity.symbol), opportunity]));
  const mirrorSourcePolicy = Object.fromEntries((snapshot.intelligence?.mirror?.sources || []).map((source) => [String(source.id || ""), source]));
  const pushProposal = ({ kind, symbol, side, requestedDollars, candidate = null, reasons = [] }) => {
    const key = `${side}:${symbol}`;
    if (!symbol || requestedDollars <= 0 || seen.has(key) || proposals.length >= 12) return;
    seen.add(key);
    const draft = buildTradeDraft({
      symbol,
      side,
      requestedDollars,
      candidateId: candidate?.id,
    }, snapshot, { now: at });
    const record = recordBySymbol[symbol] || null;
    const opportunity = opportunityBySymbol[symbol] || null;
    const proposalCore = {
      accountIdentityHash: snapshot.broker?.accountIdentityHash || "",
      kind,
      symbol,
      side,
      requestedDollars: roundedMoney(requestedDollars),
      sourceId: candidate?.fingerprint || draft.sourceId,
      draftFingerprint: draft.fingerprint,
    };
    const targetPrice = finiteNumber(record?.target1, null);
    const stopPrice = finiteNumber(record?.stopLoss, null);
    const targetReturnPct = side === "BUY" && targetPrice !== null && draft.referencePrice > 0
      ? (targetPrice - draft.referencePrice) / draft.referencePrice
      : null;
    const downsidePct = side === "BUY" && stopPrice !== null && draft.referencePrice > 0
      ? (draft.referencePrice - stopPrice) / draft.referencePrice
      : null;
    const horizonLabel = kind === "copy_entry"
      ? "Monitor over the source's measured post-disclosure windows"
      : kind.endsWith("exit") || kind === "strategy_exit_review"
        ? "Review now while the exit condition remains valid"
        : "Re-evaluate on each 5-minute market cycle";
    proposals.push({
      id: `portfolio-proposal-${stableFingerprint(proposalCore).slice(0, 20)}`,
      fingerprint: stableFingerprint(proposalCore),
      draftFingerprint: draft.fingerprint,
      kind,
      symbol,
      side,
      requestedDollars: roundedMoney(requestedDollars),
      candidateId: candidate?.id || "",
      traderName: candidate?.traderName || "",
      rankingScore: finiteNumber(candidate?.rankingScore, finiteNumber((snapshot.records || []).find((item) => item.ticker === symbol)?.score, 0) / 100),
      scores: opportunity ? {
        ai: finiteNumber(opportunity.aiScore, null),
        technical: finiteNumber(opportunity.technicalScore, null),
        mirror: finiteNumber(opportunity.mirrorScore, null),
        catalyst: finiteNumber(opportunity.catalystScore, null),
        risk: finiteNumber(opportunity.riskScore, null),
        formula: opportunity.scoreFormula || null,
      } : null,
      opportunityId: opportunity?.id || "",
      opportunityStatus: opportunity?.status || "",
      opportunityTrend: opportunity?.change?.trend || "",
      evidence: Array.isArray(opportunity?.evidence) ? opportunity.evidence : [],
      draftEligible: draft.status === "ready_for_broker_review" && draft.blockers.length === 0,
      blockers: draft.blockers,
      reasons: [...new Set(reasons)].slice(0, 6),
      research: {
        setupType: String(record?.setupType || (candidate ? "Attributable public signal" : "Evaluator review")).slice(0, 100),
        score: finiteNumber(record?.score, null),
        confidence: String(record?.confidence || (candidate?.rankingScore ? "evidence weighted" : "unknown")).slice(0, 60),
        mainReason: String(record?.mainReason || reasons[0] || "Proposal passed the currently available evidence checks.").slice(0, 260),
        mainRisk: String(record?.mainRisk || candidate?.delayReason || "Market price and thesis can change before execution.").slice(0, 260),
        marketCondition: String(record?.marketCondition || "").slice(0, 120),
        entryZone: String(record?.entryZone || "").slice(0, 80),
        invalidationRule: String(record?.invalidationRule || "Rebuild the proposal if price, source, account, or risk evidence changes.").slice(0, 260),
        sourceLabel: String(candidate?.sourceName || record?.source || "Stock Guru evaluator").slice(0, 140),
        sourceUrl: String(candidate?.sourceUrl || "").slice(0, 500),
        dataFresh: record ? record.dataFresh === true : snapshot.mirror?.stale === false,
        checksPassed: draft.checks.filter((check) => check.passed).length,
        checksTotal: draft.checks.length,
        firstSeenAt: opportunity?.firstSeenAt || null,
        lastResearchedAt: opportunity?.lastResearchedAt || record?.lastUpdated || null,
        nextReviewAt: opportunity?.nextReviewAt || null,
        scoreTrend: opportunity?.change || null,
      },
      outlook: {
        horizonLabel,
        targetPrice,
        targetReturnPct: targetReturnPct === null ? null : Math.round(targetReturnPct * 10_000) / 10_000,
        stopPrice,
        downsidePct: downsidePct === null ? null : Math.round(downsidePct * 10_000) / 10_000,
        targetScenarioDollars: targetReturnPct === null ? null : roundedMoney(requestedDollars * targetReturnPct),
        stopScenarioDollars: downsidePct === null ? null : roundedMoney(requestedDollars * downsidePct),
        profitTimingKnown: false,
        timingNote: "No profit date can be estimated reliably; monitor the target, stop, and invalidation evidence instead.",
      },
      referencePrice: draft.referencePrice,
      riskSizedMaxDollars: draft.riskSizedMaxDollars,
      capitalAfterDollars: draft.capitalAfterDollars,
    });
  };
  const pushHoldReview = ({ symbol, position, record = null }) => {
    const key = `HOLD:${symbol}`;
    const currentPrice = finiteNumber(position?.currentPrice, 0);
    const quantity = finiteNumber(position?.sharesAvailableForSells ?? position?.quantity, 0);
    if (!symbol || currentPrice <= 0 || quantity <= 0 || seen.has(key) || proposals.length >= 12) return;
    seen.add(key);
    const positionValue = roundedMoney(currentPrice * quantity);
    const targetPrice = finiteNumber(position?.target1 ?? record?.target1, null);
    const stopPrice = finiteNumber(position?.stopLoss ?? record?.stopLoss, null);
    const proposalCore = {
      accountIdentityHash: snapshot.broker?.accountIdentityHash || "",
      kind: "position_hold",
      symbol,
      side: "HOLD",
      positionValue,
    };
    proposals.push({
      id: `portfolio-proposal-${stableFingerprint(proposalCore).slice(0, 20)}`,
      fingerprint: stableFingerprint(proposalCore),
      kind: "position_hold",
      symbol,
      side: "HOLD",
      requestedDollars: positionValue,
      candidateId: "",
      traderName: "",
      rankingScore: finiteNumber(record?.score, 0) / 100,
      draftEligible: false,
      actionable: false,
      monitoring: true,
      blockers: [],
      reasons: ["No current stop, target, copy-sale, or evaluator exit condition is triggered."],
      research: {
        setupType: String(record?.setupType || "Live position review").slice(0, 100),
        score: finiteNumber(record?.score, null),
        confidence: String(record?.confidence || "live position").slice(0, 60),
        mainReason: "Hold and keep monitoring; no verified exit condition is active in this cycle.",
        mainRisk: String(record?.mainRisk || "Price can cross a risk or exit threshold before the next cycle.").slice(0, 260),
        marketCondition: String(record?.marketCondition || "").slice(0, 120),
        entryZone: String(record?.entryZone || "").slice(0, 80),
        invalidationRule: String(record?.invalidationRule || "Change to SELL review when a verified stop, target, copy-sale, or evaluator exit signal triggers.").slice(0, 260),
        sourceLabel: String(record?.source || "Live Robinhood position + Stock Guru evaluator").slice(0, 140),
        sourceUrl: "",
        dataFresh: currentPrice > 0,
        checksPassed: 4,
        checksTotal: 4,
      },
      outlook: {
        horizonLabel: "Re-evaluate on each 5-minute market cycle",
        targetPrice,
        targetReturnPct: null,
        stopPrice,
        downsidePct: null,
        targetScenarioDollars: null,
        stopScenarioDollars: null,
        profitTimingKnown: false,
        timingNote: "No profit date is claimed; the next cycle checks live price, exits, and new public signals again.",
      },
      referencePrice: currentPrice,
      riskSizedMaxDollars: 0,
      capitalAfterDollars: control.capital.committedDollars,
    });
  };

  const mirrorCandidates = [...(snapshot.mirror?.candidates || [])].sort((a, b) => {
    const exitDelta = (b.side === "SELL" ? 1 : 0) - (a.side === "SELL" ? 1 : 0);
    return exitDelta || finiteNumber(b.rankingScore, 0) - finiteNumber(a.rankingScore, 0);
  });
  for (const candidate of mirrorCandidates) {
    if (candidate.assetType !== "equity" || !["BUY", "SELL"].includes(candidate.side)) continue;
    const position = positionBySymbol[candidate.symbol];
    if (candidate.side === "SELL") {
      const signalEligible = candidate.status === "paper_ready" || candidate.brokerPositionRequired === true;
      if (!signalEligible || !position) continue;
      const holdingValue = finiteNumber(position.sharesAvailableForSells ?? position.quantity, 0) * finiteNumber(position.currentPrice, 0);
      pushProposal({
        kind: "copy_exit",
        symbol: candidate.symbol,
        side: "SELL",
        requestedDollars: Math.min(holdingValue, guardrails.maxOrderDollars),
        candidate,
        reasons: [`${candidate.traderName} disclosed a sale.`, "This can only reduce verified owned shares."],
      });
      continue;
    }
    if (candidate.status !== "paper_ready" || !candidate.humanGateEligible) continue;
    const sourcePolicy = mirrorSourcePolicy[candidate.sourceId];
    if (!sourcePolicy || !sourcePolicy.following || !sourcePolicy.mirrorEnabled) continue;
    pushProposal({
      kind: "copy_entry",
      symbol: candidate.symbol,
      side: "BUY",
      requestedDollars: Math.min(candidate.mirrorNotionalDollars, guardrails.maxOrderDollars),
      candidate,
      reasons: [`${candidate.traderName} disclosed a purchase.`, `Evidence-weighted rank ${(finiteNumber(candidate.rankingScore, 0) * 100).toFixed(1)}%.`],
    });
  }

  for (const position of control.positions || []) {
    const symbol = normalizeSymbol(position.symbol);
    if (!symbol || seen.has(`SELL:${symbol}`)) continue;
    const record = (snapshot.records || []).find((item) => item.ticker === symbol);
    const currentPrice = finiteNumber(position.currentPrice, 0);
    const stopLoss = finiteNumber(position.stopLoss ?? record?.stopLoss, null);
    const target1 = finiteNumber(position.target1 ?? record?.target1, null);
    const decision = String(record?.decision || "").toUpperCase();
    const reasons = [];
    let kind = "";
    if (stopLoss !== null && currentPrice > 0 && currentPrice <= stopLoss) {
      kind = "risk_exit";
      reasons.push(`Current price is at or below the ${formatMoneyForReason(stopLoss)} stop.`);
    } else if (guardrails.lockProfits && target1 !== null && currentPrice >= target1) {
      kind = "profit_exit";
      reasons.push(`Current price reached the ${formatMoneyForReason(target1)} first target.`);
    } else if (/SELL|EXIT|AVOID|REJECT/.test(decision)) {
      kind = "strategy_exit_review";
      reasons.push(`Current evaluator decision is ${record?.decision || "risk review"}.`);
    }
    if (!kind) continue;
    const holdingValue = finiteNumber(position.sharesAvailableForSells ?? position.quantity, 0) * currentPrice;
    pushProposal({ kind, symbol, side: "SELL", requestedDollars: Math.min(holdingValue, guardrails.maxOrderDollars), reasons });
  }

  for (const position of control.positions || []) {
    const symbol = normalizeSymbol(position.symbol);
    if (!symbol || seen.has(`SELL:${symbol}`)) continue;
    pushHoldReview({ symbol, position, record: recordBySymbol[symbol] || null });
  }

  for (const record of snapshot.records || []) {
    if (proposals.length >= 12) break;
    if (record.status !== "valid_setup" || !record.dataFresh || seen.has(`BUY:${record.ticker}`)) continue;
    // Keep a risk-sized research proposal visible even when the account has no
    // deployable cash. buildTradeDraft() will then surface the buying-power
    // blocker instead of making the idea disappear from Overview.
    const requested = Math.min(
      guardrails.maxOrderDollars,
      finiteNumber(control.capital.maxPositionDollars, 0) > 0
        ? finiteNumber(control.capital.maxPositionDollars, guardrails.maxOrderDollars)
        : guardrails.maxOrderDollars,
    );
    pushProposal({
      kind: "native_entry",
      symbol: record.ticker,
      side: "BUY",
      requestedDollars: requested,
      reasons: [`Evaluator score ${record.score ?? "unknown"}.`, record.mainRisk || "Fresh risk review required."],
    });
  }

  proposals.sort((a, b) => {
    const priority = { SELL: 0, HOLD: 1, BUY: 2 };
    return (priority[a.side] ?? 3) - (priority[b.side] ?? 3) || finiteNumber(b.rankingScore, 0) - finiteNumber(a.rankingScore, 0);
  });
  const actionable = proposals.filter((proposal) => proposal.side !== "HOLD");
  const ready = actionable.filter((proposal) => proposal.draftEligible).length;
  const mirrorSummary = snapshot.mirror?.summary || {};
  const mirrorImporter = snapshot.mirror?.importer || {};
  const mirrorImporter13f = snapshot.mirror?.importer13f || {};
  return {
    version: 1,
    generatedAt: at.toISOString(),
    accountIdentityHash: snapshot.broker?.accountIdentityHash || "",
    mode: "continuous_research_exact_order_human_gate",
    capital: control.capital,
    summary: {
      proposals: proposals.length,
      readyForExactDraft: ready,
      blocked: actionable.length - ready,
      buys: proposals.filter((item) => item.side === "BUY").length,
      holds: proposals.filter((item) => item.side === "HOLD").length,
      sells: proposals.filter((item) => item.side === "SELL").length,
      copyEntries: proposals.filter((item) => item.kind === "copy_entry").length,
      copyExits: proposals.filter((item) => item.kind === "copy_exit").length,
      riskExits: proposals.filter((item) => ["risk_exit", "profit_exit", "strategy_exit_review"].includes(item.kind)).length,
      copySignalsObserved: finiteNumber(mirrorSummary.signalsReceived, 0),
      copyWatchers: finiteNumber(mirrorImporter.enabledEntries, 0) + finiteNumber(mirrorImporter13f.enabledEntries, 0),
    },
    proposals,
    warnings: [
      "This planner continuously ranks and sizes proposals, but every live order is a separate exact Human Gate decision.",
      "Public disclosures can be delayed and incomplete; no proposal promises profit.",
      "Deposits and transfers are never performed by Stock Office.",
    ],
  };
}

function formatMoneyForReason(value) {
  return `$${roundedMoney(value).toFixed(2)}`;
}

function executionEnvelope(draft) {
  const normalized = normalizeTradeDraft(draft);
  const reviewArgs = {
    symbol: normalized.symbol,
    side: normalized.side.toLowerCase(),
    type: normalized.orderType,
    time_in_force: normalized.timeInForce,
    market_hours: normalized.marketHours,
  };
  if (normalized.side === "SELL") reviewArgs.quantity = normalized.estimatedQuantity.toFixed(6).replace(/\.?0+$/, "");
  else reviewArgs.dollar_amount = normalized.cappedDollars.toFixed(2);
  const placementArgs = { ...reviewArgs, ref_id: normalized.clientRefId };
  return {
    provider: "robinhood_agentic_mcp",
    accountScope: "dedicated_agentic_account_only",
    accountIdentityHash: normalized.accountIdentityHash,
    reviewTool: "review_equity_order",
    placementTool: "place_equity_order",
    reviewArgs,
    placementArgs,
    args: placementArgs,
    referencePrice: normalized.referencePrice,
    maxPriceDriftPct: 0.02,
    fingerprint: normalized.fingerprint,
    expiresAt: normalized.expiresAt,
  };
}

function approvalDetails(approval = {}) {
  if (approval.grantedDetails && typeof approval.grantedDetails === "object" && !Array.isArray(approval.grantedDetails)) return approval.grantedDetails;
  if (approval.originalDetails && typeof approval.originalDetails === "object" && !Array.isArray(approval.originalDetails)) return approval.originalDetails;
  return approval.details && typeof approval.details === "object" && !Array.isArray(approval.details) ? approval.details : {};
}

function approvalMatchesDraft(approval = {}, draft = {}, options = {}) {
  const at = options.now ? new Date(options.now) : new Date();
  const normalized = normalizeTradeDraft(draft);
  const details = approvalDetails(approval);
  const approvedEnvelope = details.executionEnvelope && typeof details.executionEnvelope === "object" ? details.executionEnvelope : {};
  const approvedArgs = approvedEnvelope.args && typeof approvedEnvelope.args === "object" ? approvedEnvelope.args : {};
  const expectedEnvelope = executionEnvelope(normalized);
  const expiresAt = safeDate(approval.expiresAt);
  const reasons = [];
  if (approval.actionType !== "place_robinhood_equity_order") reasons.push("Human Gate action type does not authorize an equity order.");
  if (approval.status !== "approved") reasons.push("The exact Human Gate order request is not approved.");
  if (approval.consumedAt || finiteNumber(approval.useCount, 0) > 0) reasons.push("The one-use Human Gate approval has already been consumed.");
  if (expiresAt && new Date(expiresAt).getTime() <= at.getTime()) reasons.push("The Human Gate order approval expired.");
  if (String(details.draftId || "") !== normalized.id) reasons.push("Human Gate draft ID does not match.");
  if (String(details.fingerprint || "") !== normalized.fingerprint) reasons.push("Human Gate order fingerprint does not match.");
  if (String(approvedEnvelope.fingerprint || "") !== normalized.fingerprint) reasons.push("Approved broker envelope fingerprint does not match.");
  if (stableFingerprint(approvedEnvelope) !== stableFingerprint(expectedEnvelope)) reasons.push("Approved broker review/placement contract does not match the current exact envelope.");
  if (String(approvedArgs.ref_id || "") !== normalized.clientRefId) reasons.push("Approved one-use broker reference ID does not match.");
  if (normalizeSymbol(approvedArgs.symbol) !== normalized.symbol || String(approvedArgs.side || "").toUpperCase() !== normalized.side) reasons.push("Approved broker envelope symbol or side does not match.");
  if (normalized.side === "SELL") {
    if (Math.abs(finiteNumber(approvedArgs.quantity, -1) - normalized.estimatedQuantity) > 0.0000001) reasons.push("Approved broker envelope sell quantity does not match.");
  } else if (Math.abs(moneyNumber(approvedArgs.dollar_amount) - normalized.cappedDollars) > 0.001) {
    reasons.push("Approved broker envelope notional does not match.");
  }
  if (Math.abs(finiteNumber(details.maxNotionalDollars, -1) - normalized.cappedDollars) > 0.001) reasons.push("Human Gate maximum notional does not match.");
  if (String(details.accountScope || "") !== "dedicated_agentic_account_only") reasons.push("Human Gate account scope is not the dedicated Agentic account.");
  if (!normalized.accountIdentityHash || String(approvedEnvelope.accountIdentityHash || "") !== normalized.accountIdentityHash) reasons.push("Approved Agentic-account identity does not match the live broker account.");
  if (details.recurringAuthorization !== false) reasons.push("Recurring order authority is forbidden.");
  if (details.moneyMovementAuthorized !== false) reasons.push("The approval scope must not include money movement.");
  return { passed: reasons.length === 0, reasons, approval, details };
}

function tradeDraftWithApprovalState(draft = {}, approvals = [], options = {}) {
  const at = options.now ? new Date(options.now) : new Date();
  const normalized = normalizeTradeDraft(draft);
  if (normalized.status === "dispatch_claimed") {
    if (!normalized.dispatchExpiresAt || new Date(normalized.dispatchExpiresAt).getTime() <= at.getTime()) {
      return normalizeTradeDraft({
        ...normalized,
        status: "expired",
        lastDispatchError: "The one-use Robinhood handoff expired before a broker result was recorded. Build and approve a fresh draft.",
        updatedAt: at.toISOString(),
      });
    }
    return normalized;
  }
  if (["review_rejected", "reconciliation_required", "dispatched", "filled", "rejected", "cancelled"].includes(normalized.status)) return normalized;
  if (new Date(normalized.expiresAt).getTime() <= at.getTime()) return normalizeTradeDraft({ ...normalized, status: "expired", updatedAt: at.toISOString() });
  const approval = (Array.isArray(approvals) ? approvals : []).find((item) => item?.id === normalized.approvalId)
    || (Array.isArray(approvals) ? approvals : []).find((item) => item?.linkedId === `stock-office:order:${normalized.fingerprint}`);
  if (!approval) return normalized;
  if (approval.status === "approved" && !approval.consumedAt) return normalizeTradeDraft({ ...normalized, approvalId: approval.id, status: "approved", updatedAt: approval.decidedAt || at.toISOString() });
  if (approval.status === "pending") return normalizeTradeDraft({ ...normalized, approvalId: approval.id, status: "awaiting_human_gate", updatedAt: normalized.updatedAt });
  if (["blocked", "rejected", "needs_revision"].includes(approval.status)) return normalizeTradeDraft({ ...normalized, approvalId: approval.id, status: "cancelled", updatedAt: approval.decidedAt || approval.resolvedAt || at.toISOString() });
  return normalized;
}

function claimApprovedDispatch(draft = {}, approval = {}, snapshot = {}, options = {}) {
  const at = options.now ? new Date(options.now) : new Date();
  const normalized = tradeDraftWithApprovalState(draft, [approval], { now: at });
  const match = approvalMatchesDraft(approval, normalized, { now: at });
  const reasons = [...match.reasons];
  if (normalized.status !== "approved") reasons.push(`Order draft is not approved for dispatch: ${normalized.status}.`);
  if (normalized.dispatchClaimHash || normalized.dispatchAttempts > 0) reasons.push("This order draft already has a dispatch claim or attempt.");
  if (new Date(normalized.expiresAt).getTime() <= at.getTime()) reasons.push("Order draft expired before dispatch.");

  const mirrorCandidate = normalized.sourceType === "copy_signal"
    ? (snapshot.mirror?.candidates || []).find((candidate) => candidate.fingerprint === normalized.sourceId)
    : null;
  const refreshed = buildTradeDraft({
    symbol: normalized.symbol,
    side: normalized.side,
    requestedDollars: normalized.requestedDollars,
    candidateId: mirrorCandidate?.id,
  }, snapshot, { now: at, registrationStatus: options.registrationStatus });
  if (refreshed.status !== "ready_for_broker_review" || refreshed.blockers.length) reasons.push(...refreshed.blockers);
  if (refreshed.fingerprint !== normalized.fingerprint) reasons.push("Market, evaluator, or source evidence changed; rebuild and reapprove the order.");
  if (reasons.length) {
    const error = new Error([...new Set(reasons)].join(" "));
    error.status = 409;
    throw error;
  }

  const token = crypto.randomBytes(32).toString("hex");
  const claimId = `stock-dispatch-${crypto.randomUUID()}`;
  const dispatchExpiresAt = new Date(Math.min(
    new Date(normalized.expiresAt).getTime(),
    at.getTime() + DISPATCH_CLAIM_TTL_MINUTES * 60_000,
  )).toISOString();
  const nextDraft = normalizeTradeDraft({
    ...normalized,
    status: "dispatch_claimed",
    dispatchClaimId: claimId,
    dispatchClaimHash: stableFingerprint(token),
    dispatchClaimedAt: at.toISOString(),
    dispatchExpiresAt,
    updatedAt: at.toISOString(),
  });
  return {
    draft: nextDraft,
    claim: {
      id: claimId,
      token,
      expiresAt: dispatchExpiresAt,
      envelope: executionEnvelope(nextDraft),
      policy: "Call review_equity_order first. Do not call place_equity_order on any warning, mismatch, or scope change.",
    },
  };
}

function settleApprovedDispatch(draft = {}, approval = {}, result = {}, claimToken = "", options = {}) {
  const at = options.now ? new Date(options.now) : new Date();
  const normalized = normalizeTradeDraft(draft);
  const match = approvalMatchesDraft(approval, normalized, { now: at });
  const reasons = [...match.reasons];
  if (normalized.status !== "dispatch_claimed") reasons.push("Order draft has no active dispatch claim.");
  if (!normalized.dispatchClaimHash || stableFingerprint(String(claimToken || "")) !== normalized.dispatchClaimHash) reasons.push("Dispatch claim token does not match.");
  if (!normalized.dispatchExpiresAt || new Date(normalized.dispatchExpiresAt).getTime() <= at.getTime()) reasons.push("Dispatch claim expired.");
  if (normalized.dispatchAttempts > 0) reasons.push("Dispatch result has already been recorded.");
  if (reasons.length) {
    const error = new Error(reasons.join(" "));
    error.status = 409;
    throw error;
  }

  const warnings = (Array.isArray(result.warnings) ? result.warnings : []).map((item) => String(item).slice(0, 260)).filter(Boolean).slice(0, 12);
  const reviewPassed = result.reviewPassed === true && warnings.length === 0;
  const placementAttempted = result.placementAttempted === true;
  const brokerOrderId = String(result.brokerOrderId || "").trim().slice(0, 160);
  const brokerState = String(result.brokerState || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 60);
  const reconciliation = result.reconciliation && typeof result.reconciliation === "object" ? result.reconciliation : {};
  const trustedReconciliation = options.trustedBrokerResult === true
    && reconciliation.matched === true
    && String(reconciliation.clientRefId || "") === normalized.clientRefId
    && String(reconciliation.accountIdentityHash || "") === normalized.accountIdentityHash;
  const placementReported = reviewPassed && placementAttempted;
  const placementVerified = placementReported && trustedReconciliation && Boolean(brokerOrderId) && Boolean(brokerState);
  const finalStatus = placementVerified
    ? (brokerState === "filled" ? "filled" : "dispatched")
    : placementReported
      ? "reconciliation_required"
      : reviewPassed
        ? "rejected"
        : "review_rejected";
  const lastDispatchError = placementVerified
    ? ""
    : String(result.error || (placementReported
      ? "Placement was reported but not independently reconciled to the exact official Robinhood order. Do not retry; refresh order history."
      : reviewPassed
        ? "Broker placement result was incomplete; approval consumed without recording a verified live order."
        : "Broker review failed or returned warnings; no order was placed.")).slice(0, 500);
  const nextDraft = normalizeTradeDraft({
    ...normalized,
    status: finalStatus,
    dispatchAttempts: 1,
    brokerReviewPassed: reviewPassed,
    brokerWarnings: warnings,
    brokerOrderId: placementReported ? brokerOrderId : "",
    brokerState: placementReported ? (brokerState || "unknown") : "",
    brokerReconciled: placementVerified,
    brokerEvidenceSource: options.trustedBrokerResult === true ? "official_robinhood_mcp" : "operator_report",
    reconciliationObservedAt: placementVerified ? reconciliation.observedAt : null,
    lastDispatchError,
    liveOrderPlaced: placementVerified,
    updatedAt: at.toISOString(),
  });
  const nextApproval = {
    ...approval,
    useCount: finiteNumber(approval.useCount, 0) + 1,
    consumedAt: at.toISOString(),
    executionOutcome: placementVerified ? "broker_order_verified" : placementReported ? "placement_outcome_unverified" : reviewPassed ? "placement_not_recorded" : "broker_review_rejected",
    executionDraftId: normalized.id,
    executionBrokerOrderId: placementReported && brokerOrderId ? brokerOrderId : null,
  };
  return { draft: nextDraft, approval: nextApproval, liveOrderPlaced: placementVerified, reconciliationRequired: placementReported && !placementVerified };
}

module.exports = {
  BROKER_SNAPSHOT_FRESH_MINUTES,
  DISPATCH_CLAIM_TTL_MINUTES,
  MAX_ORDER_DRAFTS,
  ORDER_DRAFT_TTL_MINUTES,
  REQUIRED_EQUITY_TOOLS,
  ROBINHOOD_MCP_URL,
  brokerControlOverview,
  buildCopyPortfolioPlan,
  buildTradeDraft,
  claimApprovedDispatch,
  executionEnvelope,
  moneyNumber,
  normalizeGuardrails,
  portfolioCapitalState,
  normalizeTradeDraft,
  normalizeTradeDrafts,
  approvalMatchesDraft,
  settleApprovedDispatch,
  tradeDraftWithApprovalState,
  verifyRobinhoodToolContract,
};

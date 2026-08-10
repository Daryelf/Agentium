const crypto = require("node:crypto");

const ROBINHOOD_MCP_URL = "https://agent.robinhood.com/mcp/trading";
const BROKER_SNAPSHOT_FRESH_MINUTES = 5;
const ORDER_DRAFT_TTL_MINUTES = 5;
const DISPATCH_CLAIM_TTL_MINUTES = 2;
const MAX_ORDER_DRAFTS = 80;
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
  const status = ["blocked", "ready_for_broker_review", "awaiting_human_gate", "approved", "dispatch_claimed", "review_rejected", "expired", "cancelled", "dispatched", "filled", "rejected"].includes(draft.status)
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
    orderType: draft.orderType === "limit" ? "limit" : "market",
    timeInForce: "gfd",
    marketHours: "regular_hours",
    sourceType: String(draft.sourceType || "evaluator").slice(0, 40),
    sourceId: String(draft.sourceId || "").slice(0, 180),
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
    lastDispatchError: String(draft.lastDispatchError || "").slice(0, 500),
    liveOrderPlaced: Boolean(draft.liveOrderPlaced),
    createdAt: safeDate(draft.createdAt) || new Date().toISOString(),
    expiresAt: safeDate(draft.expiresAt) || new Date(Date.now() + ORDER_DRAFT_TTL_MINUTES * 60_000).toISOString(),
    updatedAt: safeDate(draft.updatedAt) || safeDate(draft.createdAt) || new Date().toISOString(),
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
  const buyingPower = moneyNumber(broker.buyingPower);
  const killSwitchActive = snapshot.killSwitch?.active !== false;
  const connectorStatus = snapshotFresh ? "live_snapshot_verified" : broker.configured ? "stale_snapshot" : "oauth_required";
  const blockers = [];
  if (!snapshotFresh) blockers.push(broker.configured ? "Broker snapshot is stale; reconnect Robinhood and refresh live account data." : "Robinhood OAuth and Agentic-account setup are not verified.");
  if (!broker.account) blockers.push("A dedicated Robinhood Agentic account has not been verified.");
  if (buyingPower <= 0) blockers.push("Verified buying power is unavailable or zero.");
  if (killSwitchActive) blockers.push("The live-order kill switch is active or has not been explicitly cleared.");
  if (!snapshot.readiness?.readyForLiveAuto) blockers.push(...(snapshot.readiness?.blockers || ["Strict live-readiness evidence has not passed."]).slice(0, 4));
  return {
    provider: "Robinhood Agentic Trading",
    transport: "official_streamable_http_mcp",
    endpoint: ROBINHOOD_MCP_URL,
    connectorStatus,
    registrationStatus: options.registrationStatus || "registered_in_codex",
    authenticationVerified: snapshotFresh,
    accountScope: "dedicated_agentic_account_only",
    accountLabel: broker.account || "Not verified",
    snapshotUpdatedAt: broker.updatedAt || null,
    snapshotAgeMinutes: snapshotAgeMinutes === null ? null : Math.round(snapshotAgeMinutes * 10) / 10,
    buyingPowerDollars: buyingPower,
    positions: Array.isArray(broker.positions) ? broker.positions : [],
    openOrderCount: Array.isArray(broker.openOrders) ? broker.openOrders.length : 0,
    killSwitchActive,
    guardrails,
    liveReady: blockers.length === 0,
    buyReady: blockers.length === 0,
    exitReady: snapshotFresh && Boolean(broker.account) && controlHasOwnedPositions(broker),
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
  const blockers = [];
  const checks = [];

  addCheck(checks, blockers, "symbol", Boolean(symbol), "A valid equity symbol is required.");
  addCheck(checks, blockers, "official_connector", control.authenticationVerified, "Robinhood MCP must be authenticated and refreshed before order review.");
  if (side === "BUY") {
    addCheck(checks, blockers, "kill_switch", !control.killSwitchActive, "The live-order kill switch must be explicitly cleared for a new BUY.");
    addCheck(checks, blockers, "live_readiness", Boolean(snapshot.readiness?.readyForLiveAuto), "Strict live-readiness evidence must pass before a new BUY.");
    addCheck(checks, blockers, "fresh_price", Boolean(record?.dataFresh) && referencePrice > 0, "Fresh evaluator and quote data are required for a BUY.");
  } else {
    addCheck(checks, blockers, "risk_reducing_exit", Boolean(position) && referencePrice > 0, "A SELL must reduce a verified owned position.");
  }
  addCheck(checks, blockers, "order_minimum", requestedDollars >= guardrails.minOrderDollars, `Order must be at least $${guardrails.minOrderDollars.toFixed(2)}.`);
  addCheck(checks, blockers, "order_cap", requestedDollars <= guardrails.maxOrderDollars, `Order exceeds the $${guardrails.maxOrderDollars.toFixed(2)} per-order cap.`);
  addCheck(checks, blockers, "open_orders", control.openOrderCount === 0, "Existing open broker orders must be reconciled first.");

  if (side === "BUY") {
    addCheck(checks, blockers, "valid_setup", record?.status === "valid_setup", "BUY requires a current valid evaluator setup.");
    addCheck(checks, blockers, "entry_score", finiteNumber(record?.score, 0) >= guardrails.minEntryScore, `BUY score must be at least ${guardrails.minEntryScore}.`);
    addCheck(checks, blockers, "buying_power", control.buyingPowerDollars - guardrails.cashReserveDollars >= requestedDollars, "Verified buying power after the cash reserve is insufficient.");
    addCheck(checks, blockers, "position_count", control.positions.length < guardrails.maxPositions || Boolean(position), `Maximum ${guardrails.maxPositions} positions reached.`);
  } else {
    const availableShares = finiteNumber(position?.sharesAvailableForSells ?? position?.quantity, 0);
    const holdingValue = availableShares * referencePrice;
    addCheck(checks, blockers, "owned_position", availableShares > 0, "SELL requires a verified owned long position; short selling is blocked.");
    addCheck(checks, blockers, "sell_size", holdingValue + 0.01 >= requestedDollars, "SELL notional exceeds verified shares available.");
  }

  if (mirror) {
    addCheck(checks, blockers, "mirror_source", mirror.humanGateEligible && mirror.status === "paper_ready" && !snapshot.mirror?.stale, "Copy signal must be fresh, attributable, and paper-ready.");
    addCheck(checks, blockers, "mirror_side", mirror.side === side && mirror.symbol === symbol, "Copy signal does not match the proposed order.");
    addCheck(checks, blockers, "mirror_cap", requestedDollars <= finiteNumber(mirror.mirrorNotionalDollars, 0), "Order exceeds the source-specific copy cap.");
  }

  const cappedDollars = blockers.length
    ? 0
    : side === "BUY"
      ? Math.min(requestedDollars, guardrails.maxOrderDollars, Math.max(0, control.buyingPowerDollars - guardrails.cashReserveDollars))
      : Math.min(requestedDollars, guardrails.maxOrderDollars);
  const estimatedQuantity = referencePrice > 0 ? Math.floor((requestedDollars / referencePrice) * 1_000_000) / 1_000_000 : 0;
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
    orderType: "market",
    sourceType,
    sourceId,
    thesis: mirror
      ? `${mirror.traderName} ${side} disclosure passed current copy-source checks; broker review must reprice it.`
      : `${record?.decision || "Evaluator review"}; score ${record?.score ?? "unknown"}; ${record?.mainRisk || "risk note unavailable"}`,
    blockers: [...new Set(blockers)],
    checks,
    status: blockers.length ? "blocked" : "ready_for_broker_review",
    liveOrderPlaced: false,
    createdAt,
    expiresAt: new Date(now.getTime() + ORDER_DRAFT_TTL_MINUTES * 60_000).toISOString(),
    updatedAt: createdAt,
  });
}

function executionEnvelope(draft) {
  const normalized = normalizeTradeDraft(draft);
  return {
    provider: "robinhood_agentic_mcp",
    accountScope: "dedicated_agentic_account_only",
    reviewTool: "review_equity_order",
    placementTool: "place_equity_order",
    args: {
      symbol: normalized.symbol,
      side: normalized.side.toLowerCase(),
      type: normalized.orderType,
      dollar_amount: normalized.cappedDollars.toFixed(2),
      time_in_force: normalized.timeInForce,
      market_hours: normalized.marketHours,
      ref_id: normalized.clientRefId,
    },
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
  const expiresAt = safeDate(approval.expiresAt);
  const reasons = [];
  if (approval.actionType !== "place_robinhood_equity_order") reasons.push("Human Gate action type does not authorize an equity order.");
  if (approval.status !== "approved") reasons.push("The exact Human Gate order request is not approved.");
  if (approval.consumedAt || finiteNumber(approval.useCount, 0) > 0) reasons.push("The one-use Human Gate approval has already been consumed.");
  if (expiresAt && new Date(expiresAt).getTime() <= at.getTime()) reasons.push("The Human Gate order approval expired.");
  if (String(details.draftId || "") !== normalized.id) reasons.push("Human Gate draft ID does not match.");
  if (String(details.fingerprint || "") !== normalized.fingerprint) reasons.push("Human Gate order fingerprint does not match.");
  if (String(approvedEnvelope.fingerprint || "") !== normalized.fingerprint) reasons.push("Approved broker envelope fingerprint does not match.");
  if (String(approvedArgs.ref_id || "") !== normalized.clientRefId) reasons.push("Approved one-use broker reference ID does not match.");
  if (normalizeSymbol(approvedArgs.symbol) !== normalized.symbol || String(approvedArgs.side || "").toUpperCase() !== normalized.side) reasons.push("Approved broker envelope symbol or side does not match.");
  if (Math.abs(moneyNumber(approvedArgs.dollar_amount) - normalized.cappedDollars) > 0.001) reasons.push("Approved broker envelope notional does not match.");
  if (Math.abs(finiteNumber(details.maxNotionalDollars, -1) - normalized.cappedDollars) > 0.001) reasons.push("Human Gate maximum notional does not match.");
  if (String(details.accountScope || "") !== "dedicated_agentic_account_only") reasons.push("Human Gate account scope is not the dedicated Agentic account.");
  if (details.recurringAuthorization !== false) reasons.push("Recurring order authority is forbidden.");
  if (details.moneyMovementAuthorized !== false) reasons.push("The approval scope must not include money movement.");
  return { passed: reasons.length === 0, reasons, approval, details };
}

function tradeDraftWithApprovalState(draft = {}, approvals = [], options = {}) {
  const at = options.now ? new Date(options.now) : new Date();
  const normalized = normalizeTradeDraft(draft);
  if (["dispatch_claimed", "review_rejected", "dispatched", "filled", "rejected", "cancelled"].includes(normalized.status)) return normalized;
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
  const placementRecorded = reviewPassed && placementAttempted && Boolean(brokerOrderId) && Boolean(brokerState);
  const finalStatus = placementRecorded ? (brokerState === "filled" ? "filled" : "dispatched") : reviewPassed ? "rejected" : "review_rejected";
  const lastDispatchError = placementRecorded
    ? ""
    : String(result.error || (reviewPassed ? "Broker placement result was incomplete; approval consumed without recording a live order." : "Broker review failed or returned warnings; no order was placed.")).slice(0, 500);
  const nextDraft = normalizeTradeDraft({
    ...normalized,
    status: finalStatus,
    dispatchAttempts: 1,
    brokerReviewPassed: reviewPassed,
    brokerWarnings: warnings,
    brokerOrderId: placementRecorded ? brokerOrderId : "",
    brokerState: placementRecorded ? brokerState : "",
    lastDispatchError,
    liveOrderPlaced: placementRecorded,
    updatedAt: at.toISOString(),
  });
  const nextApproval = {
    ...approval,
    useCount: finiteNumber(approval.useCount, 0) + 1,
    consumedAt: at.toISOString(),
    executionOutcome: placementRecorded ? "broker_order_recorded" : reviewPassed ? "placement_not_recorded" : "broker_review_rejected",
    executionDraftId: normalized.id,
    executionBrokerOrderId: placementRecorded ? brokerOrderId : null,
  };
  return { draft: nextDraft, approval: nextApproval, liveOrderPlaced: placementRecorded };
}

module.exports = {
  BROKER_SNAPSHOT_FRESH_MINUTES,
  DISPATCH_CLAIM_TTL_MINUTES,
  MAX_ORDER_DRAFTS,
  ORDER_DRAFT_TTL_MINUTES,
  REQUIRED_EQUITY_TOOLS,
  ROBINHOOD_MCP_URL,
  brokerControlOverview,
  buildTradeDraft,
  claimApprovedDispatch,
  executionEnvelope,
  moneyNumber,
  normalizeGuardrails,
  normalizeTradeDraft,
  normalizeTradeDrafts,
  approvalMatchesDraft,
  settleApprovedDispatch,
  tradeDraftWithApprovalState,
};

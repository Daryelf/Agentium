const TRADING_HALT_VERSION = "argentum-trading-halt-v1";

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeDate(value) {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function evaluateTradingHalt(snapshot = {}, state = {}, options = {}) {
  const at = options.now ? new Date(options.now) : new Date();
  const reasons = [];
  const sourceKillSwitch = snapshot.killSwitch || {};
  const manual = state.stockOffice?.manualTradingHalt || {};
  if (state.governance?.killSwitch === true) reasons.push({ code: "GLOBAL_OPERATOR_HALT", source: "governance", reason: "The operator enabled Argentum's global emergency stop." });
  if (manual.active === true) reasons.push({ code: "STOCK_OPERATOR_HALT", source: "stock_office", reason: String(manual.reason || "The operator paused new Stock Office entries.").slice(0, 260) });
  if (sourceKillSwitch.active === true) reasons.push({ code: "STRATEGY_KILL_SWITCH", source: "stock_guru", reason: String(sourceKillSwitch.reason || "The Stock Guru live-order kill switch is active.").slice(0, 260) });

  const providerStatus = String(snapshot.providerHealth?.status || "UNKNOWN").toUpperCase();
  if (["OFFLINE", "STALE"].includes(providerStatus)) reasons.push({ code: "MARKET_DATA_UNAVAILABLE", source: "provider_health", reason: `Market-data provider health is ${providerStatus.toLowerCase()}.` });

  const broker = snapshot.broker || {};
  const brokerUpdatedAt = safeDate(broker.updatedAt);
  const brokerAgeMinutes = brokerUpdatedAt ? Math.max(0, (at.getTime() - brokerUpdatedAt.getTime()) / 60_000) : null;
  if (snapshot.executionMode === "live" && broker.connector?.oauthAuthenticated !== true) reasons.push({ code: "BROKER_DISCONNECTED", source: "robinhood", reason: "The dedicated Robinhood Agentic session is not authenticated." });
  if (snapshot.executionMode === "live" && (brokerAgeMinutes === null || brokerAgeMinutes > 5)) reasons.push({ code: "BROKER_STATE_STALE", source: "robinhood", reason: "The Robinhood account snapshot is missing or older than five minutes." });

  const guardrails = snapshot.guardrails || {};
  const principal = Math.max(0, finite(guardrails.principalDollars, 0));
  const lossLimitPct = Math.max(0, finite(guardrails.dailyLossLimitPct, 0));
  const dayPnl = finite(broker.dayPnlDollars, null);
  if (principal > 0 && lossLimitPct > 0 && dayPnl !== null && dayPnl <= -(principal * lossLimitPct)) reasons.push({ code: "DAILY_LOSS_LIMIT", source: "risk_engine", reason: "The configured daily-loss limit has been reached." });

  const uncertainDraft = (snapshot.tradeDrafts || []).find((draft) => ["reconciliation_required", "unknown_reconciling"].includes(draft.status));
  if (uncertainDraft) reasons.push({ code: "ACCOUNT_RECONCILIATION_REQUIRED", source: "order_lifecycle", reason: `${uncertainDraft.side} ${uncertainDraft.symbol} has an uncertain broker outcome that must be reconciled before a new entry.` });

  const unique = [...new Map(reasons.map((item) => [`${item.code}:${item.reason}`, item])).values()];
  return {
    version: TRADING_HALT_VERSION,
    active: unique.length > 0,
    status: unique.length ? "HALTED" : "READY",
    reason: unique[0]?.reason || "No emergency trading halt is active.",
    reasons: unique,
    evaluatedAt: at.toISOString(),
    scope: "new_entries_only",
    monitoringContinues: true,
    researchContinues: true,
    riskReducingExitReviewContinues: true,
  };
}

module.exports = {
  TRADING_HALT_VERSION,
  evaluateTradingHalt,
};

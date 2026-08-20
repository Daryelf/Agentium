const assert = require("node:assert/strict");
const test = require("node:test");

const { evaluateTradingHalt } = require("../services/stock-trading-halt");

function snapshot(overrides = {}) {
  return {
    executionMode: "live",
    killSwitch: { active: false },
    providerHealth: { available: true, status: "HEALTHY" },
    broker: {
      updatedAt: "2026-08-14T16:59:00.000Z",
      dayPnlDollars: 0,
      connector: { oauthAuthenticated: true },
    },
    guardrails: { principalDollars: 10_000, dailyLossLimitPct: 0.02 },
    tradeDrafts: [],
    ...overrides,
  };
}

test("healthy trading inputs leave new entries ready while research remains continuous", () => {
  const halt = evaluateTradingHalt(snapshot(), {}, { now: "2026-08-14T17:00:00.000Z" });
  assert.equal(halt.active, false);
  assert.equal(halt.status, "READY");
  assert.equal(halt.monitoringContinues, true);
  assert.equal(halt.researchContinues, true);
});

test("operator, provider, broker, daily-loss, and reconciliation failures halt new entries", () => {
  const halt = evaluateTradingHalt(snapshot({
    providerHealth: { available: true, status: "OFFLINE" },
    broker: { updatedAt: "2026-08-14T16:40:00.000Z", dayPnlDollars: -250, connector: { oauthAuthenticated: false } },
    tradeDrafts: [{ side: "BUY", symbol: "AMD", status: "reconciliation_required" }],
  }), { governance: { killSwitch: true } }, { now: "2026-08-14T17:00:00.000Z" });
  const codes = halt.reasons.map((item) => item.code);
  assert.equal(halt.active, true);
  assert.equal(halt.status, "HALTED");
  for (const code of ["GLOBAL_OPERATOR_HALT", "MARKET_DATA_UNAVAILABLE", "BROKER_DISCONNECTED", "BROKER_STATE_STALE", "DAILY_LOSS_LIMIT", "ACCOUNT_RECONCILIATION_REQUIRED"]) {
    assert.ok(codes.includes(code), `${code} should halt new entries`);
  }
  assert.equal(halt.riskReducingExitReviewContinues, true);
});

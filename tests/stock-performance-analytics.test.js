const assert = require("node:assert/strict");
const test = require("node:test");

const { calculatePerformance, maximumDrawdown } = require("../services/stock-performance-analytics");

function signal(overrides = {}) {
  return {
    id: "signal-one",
    strategyVersion: "argentum-opportunity-v2",
    symbol: "NET",
    state: "ACTIONABLE",
    referencePrice: 100,
    stopPrice: 95,
    observedAt: "2026-08-10T14:00:00.000Z",
    marketRegime: "RISK_ON_BULLISH",
    sectorState: "LEADING",
    data: {
      company: { sector: "Technology" },
      componentScores: [{ name: "technical_structure", score: 90, available: true }],
    },
    outcomes: [{ horizon: "1d", returnPct: 0.1 }],
    ...overrides,
  };
}

test("performance analytics calculates real persisted signal outcomes and attribution", () => {
  const result = calculatePerformance({
    generatedAt: "2026-08-14T14:00:00.000Z",
    signals: [
      signal(),
      signal({ id: "signal-two", symbol: "XOM", observedAt: "2026-08-11T14:00:00.000Z", data: { company: { sector: "Energy" }, componentScores: [{ name: "liquidity", score: 85, available: true }] }, outcomes: [{ horizon: "1d", returnPct: -0.05 }] }),
      signal({ id: "signal-three", symbol: "MSFT", outcomes: [] }),
    ],
    trades: [{ id: "broker-trade-one", realizedPnl: 2.5, unrealizedPnl: -0.25 }],
    approvals: [{ status: "approved" }, { status: "rejected" }],
  });
  assert.equal(result.summary.totalSignals, 3);
  assert.equal(result.summary.measuredSignals, 2);
  assert.equal(result.summary.pendingSignals, 1);
  assert.equal(result.summary.wins, 1);
  assert.equal(result.summary.losses, 1);
  assert.equal(result.summary.winRate, 0.5);
  assert.equal(result.summary.expectancyPct, 0.025);
  assert.equal(result.summary.brokerTrades, 1);
  assert.equal(result.summary.realizedBrokerPnl, 2.5);
  assert.equal(result.summary.unrealizedBrokerPnl, -0.25);
  assert.equal(result.summary.approvedTrades, 1);
  assert.equal(result.summary.rejectedTrades, 1);
  assert.equal(result.attribution.bySector.find((item) => item.key === "Technology").averageReturnPct, 0.1);
  assert.equal(result.boundaries.autoParameterChangesAllowed, false);
  assert.equal(result.boundaries.liveBrokerFillsMixedIntoSignalReturns, false);
});

test("maximum drawdown compounds the measured return sequence", () => {
  assert.equal(maximumDrawdown([0.1, -0.2, 0.05]), -0.2);
});

test("performance analytics builds the goal curve and allocation only from persisted broker snapshots", () => {
  const result = calculatePerformance({
    portfolioSnapshots: [
      { observedAt: "2026-08-21T14:00:00.000Z", accountValue: 65, cashValue: 50, investedValue: 15, buyingPower: 50, goalValue: 150, positions: [{ symbol: "SPCX", quantity: 1, currentPrice: 15, averageBuyPrice: 16, marketValue: 15, unrealizedPnl: -1 }] },
      { observedAt: "2026-08-21T15:00:00.000Z", accountValue: 67, cashValue: 45, investedValue: 22, buyingPower: 45, dayPnl: 1, goalValue: 150, positions: [{ symbol: "SPCX", quantity: 1, currentPrice: 22, averageBuyPrice: 16, marketValue: 22, unrealizedPnl: 6 }] },
    ],
    trades: [{ symbol: "SPCX", side: "BUY", status: "filled", openedAt: "2026-08-21T14:10:00.000Z" }],
  });

  assert.equal(result.summary.currentPortfolioValue, 67);
  assert.equal(result.summary.portfolioChangeDollars, 2);
  assert.equal(result.summary.capitalGoal, 150);
  assert.equal(result.summary.goalGapDollars, 83);
  assert.equal(result.series.portfolioEquityCurve.length, 2);
  assert.deepEqual(result.series.allocation.map((item) => item.symbol), ["CASH", "SPCX"]);
  assert.equal(result.series.holdings[0].returnPct, 0.375);
  assert.equal(result.series.activityMarkers[0].symbol, "SPCX");
});

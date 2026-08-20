const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildTradePlan,
  portfolioRiskState,
  sizePosition,
} = require("../services/stock-portfolio-risk");

function portfolio(overrides = {}) {
  return portfolioRiskState({
    accountEquity: 10_000,
    buyingPower: 4_000,
    principal: 10_000,
    positions: [{ symbol: "MSFT", marketValue: 1_000, sector: "Technology" }],
    pendingOrders: [{ symbol: "NVDA", side: "BUY", notional: 500, sector: "Technology" }],
    limits: {
      riskPerTradePct: 0.01,
      maxPortfolioExposurePct: 0.8,
      maxSinglePositionPct: 0.2,
      maxSectorExposurePct: 0.3,
      maxPositions: 5,
      maxOrderDollars: 5_000,
      maxTotalDollars: 8_000,
      cashReserveDollars: 500,
    },
    ...overrides,
  });
}

test("portfolio risk state reconciles positions, pending buys, buying power, and sector exposure", () => {
  const state = portfolio();
  assert.equal(state.verified, true);
  assert.equal(state.totalExposureDollars, 1500);
  assert.equal(state.sectorExposure.Technology, 1500);
  assert.equal(state.availableForNewBuys, 3000);
  assert.equal(state.exposurePct, 0.15);
});

test("position sizing uses stop risk and respects account concentration caps", () => {
  const sizing = sizePosition({
    portfolio: portfolio(),
    symbol: "AMD",
    sector: "Semiconductors",
    entry: 100,
    stop: 95,
    requestedDollars: 5_000,
  });
  assert.equal(sizing.eligible, true);
  assert.equal(sizing.riskBudgetDollars, 80);
  assert.equal(sizing.permittedDollars, 1600);
  assert.equal(sizing.quantity, 16);
  assert.equal(sizing.estimatedRiskDollars, 80);
  assert.ok(sizing.bindingCaps.includes("risk"));
});

test("trade plans expose exact sizing, targets, evidence, and risk without inventing timing", () => {
  const sizing = sizePosition({
    portfolio: portfolio(),
    symbol: "AMD",
    sector: "Semiconductors",
    entry: 100,
    stop: 95,
    requestedDollars: 1_000,
  });
  const plan = buildTradePlan({
    symbol: "AMD",
    entry: 100,
    stop: 95,
    target1: 110,
    target2: 115,
    sizing,
    opportunityScore: 90,
    confidenceScore: 82,
    reasons: ["Breakout retest confirmed."],
    risks: ["Market regime can change."],
  });
  assert.equal(plan.position.dollars, 1000);
  assert.equal(plan.position.estimatedRiskDollars, 50);
  assert.equal(plan.targets[0].rewardRisk, 2);
  assert.equal(plan.targets[1].rewardRisk, 3);
  assert.equal(plan.opportunityScore, 90);
  assert.equal(plan.confidenceScore, 82);
});

test("missing account evidence or invalid stop fails closed", () => {
  const state = portfolioRiskState({ accountEquity: null, buyingPower: null, principal: 1000, limits: { maxTotalDollars: 1000 } });
  const sizing = sizePosition({ portfolio: state, symbol: "AMD", entry: 100, stop: 101, requestedDollars: 100 });
  assert.equal(sizing.eligible, false);
  assert.match(sizing.blockers.join(" "), /stop below|verified/i);
});

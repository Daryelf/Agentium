const assert = require("node:assert/strict");
const test = require("node:test");

const { scoreOpportunity } = require("../services/stock-opportunity-scoring");

function completeInput(overrides = {}) {
  return {
    technicalStructure: 92,
    momentumVolume: 90,
    researchCatalyst: 86,
    marketSector: 88,
    relativeStrength: 91,
    fundamentals: 82,
    smartMoney: 75,
    liquidity: 98,
    riskReward: 88,
    rewardRiskRatio: 2.4,
    dataQuality: 94,
    providerState: "HEALTHY",
    dataFresh: true,
    validSetup: true,
    hardRejection: false,
    currentPrice: 120,
    liquidityPassed: true,
    spreadPassed: true,
    intradayUsable: true,
    riskState: "RISK_ON",
    conflicts: [],
    ...overrides,
  };
}

test("versioned opportunity scoring stores nine components and separates confidence", () => {
  const result = scoreOpportunity(completeInput());
  assert.equal(result.version, "argentum-opportunity-v2");
  assert.equal(result.components.length, 9);
  assert.equal(result.eligible, true);
  assert.equal(result.state, "ACTIONABLE");
  assert.ok(result.opportunityScore >= 85);
  assert.ok(result.confidence.score >= 80);
  assert.notEqual(result.opportunityScore, undefined);
  assert.notEqual(result.confidence.score, undefined);
  assert.equal(result.components.reduce((sum, item) => sum + item.weight, 0), 100);
});

test("stale low-quality data hard-blocks a high numerical score", () => {
  const result = scoreOpportunity(completeInput({ dataFresh: false, dataQuality: 25, providerState: "STALE" }));
  assert.ok(result.opportunityScore >= 80);
  assert.equal(result.eligible, false);
  assert.equal(result.state, "BLOCKED");
  assert.ok(result.blockers.some((item) => item.code === "data_health"));
});

test("sparse evidence can have a strong setup score but low analytical confidence", () => {
  const result = scoreOpportunity({
    technicalStructure: 100,
    rewardRiskRatio: 2,
    dataQuality: 55,
    providerState: "PARTIAL",
    dataFresh: true,
    validSetup: true,
    currentPrice: 50,
    liquidityPassed: false,
    spreadPassed: false,
    conflicts: ["a", "b", "c", "d", "e"],
  });
  assert.ok(result.opportunityScore >= 85);
  assert.equal(result.confidence.label, "low");
  assert.ok(result.confidence.completeness < 0.5);
});

test("risk-off context blocks a new long regardless of component score", () => {
  const result = scoreOpportunity(completeInput({ riskState: "RISK_OFF" }));
  assert.equal(result.eligible, false);
  assert.ok(result.blockers.some((item) => item.code === "market_regime"));
});

const STOCK_STRATEGY_CONFIG = Object.freeze({
  version: "argentum-opportunity-v2",
  direction: "LONG",
  weights: Object.freeze({
    technical_structure: 20,
    momentum_volume: 20,
    research_catalyst: 15,
    market_sector: 10,
    relative_strength: 10,
    fundamentals: 10,
    smart_money: 5,
    liquidity: 5,
    risk_reward: 5,
  }),
  thresholds: Object.freeze({
    highPriorityScore: 85,
    candidateScore: 75,
    minimumDataQuality: 55,
    minimumRewardRisk: 1.5,
    maximumSevereNegativeCatalystScore: 15,
    minimumHighConfidence: 80,
    minimumMediumConfidence: 60,
  }),
});

function strategyConfig(overrides = {}) {
  return {
    ...STOCK_STRATEGY_CONFIG,
    ...overrides,
    weights: { ...STOCK_STRATEGY_CONFIG.weights, ...(overrides.weights || {}) },
    thresholds: { ...STOCK_STRATEGY_CONFIG.thresholds, ...(overrides.thresholds || {}) },
  };
}

module.exports = {
  STOCK_STRATEGY_CONFIG,
  strategyConfig,
};

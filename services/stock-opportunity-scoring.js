const { strategyConfig } = require("./stock-strategy-config");

function clamp(value, minimum = 0, maximum = 100) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : null;
}

function finite(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function component(name, value, weight, evidence = []) {
  const score = finite(value) ? clamp(value) : null;
  return {
    name,
    score,
    weight,
    available: score !== null,
    evidence: (Array.isArray(evidence) ? evidence : [evidence]).filter(Boolean).map(String).slice(0, 8),
  };
}

function gate(name, passed, reason, required = true) {
  return {
    name,
    passed: passed === null || passed === undefined ? null : Boolean(passed),
    required,
    reason: String(reason || ""),
  };
}

function confidenceFor({ components, dataQuality, conflicts = [], providerState, configuration }) {
  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  const observedWeight = components.filter((item) => item.available).reduce((sum, item) => sum + item.weight, 0);
  const completeness = totalWeight ? observedWeight / totalWeight : 0;
  const quality = finite(dataQuality) ? clamp(dataQuality) : 35;
  const agreement = clamp(100 - Math.min(60, conflicts.length * 12));
  const healthState = String(providerState || "UNKNOWN").toUpperCase();
  const health = healthState === "HEALTHY" ? 100
    : healthState === "DEGRADED" || healthState === "PARTIAL" ? 65
      : healthState === "DELAYED" ? 45
        : healthState === "STALE" || healthState === "OFFLINE" ? 10
          : 50;
  const value = Math.round(completeness * 35 + quality * 0.35 + agreement * 0.15 + health * 0.15);
  const label = value >= configuration.thresholds.minimumHighConfidence ? "high"
    : value >= configuration.thresholds.minimumMediumConfidence ? "medium" : "low";
  return {
    score: clamp(value),
    label,
    completeness: Number(completeness.toFixed(3)),
    observedWeight,
    totalWeight,
    dataQuality: quality,
    agreement,
    providerHealth: health,
  };
}

function scoreOpportunity(input = {}, overrides = {}) {
  const configuration = strategyConfig(overrides);
  const weights = configuration.weights;
  const components = [
    component("technical_structure", input.technicalStructure, weights.technical_structure, input.technicalEvidence),
    component("momentum_volume", input.momentumVolume, weights.momentum_volume, input.momentumEvidence),
    component("research_catalyst", input.researchCatalyst, weights.research_catalyst, input.catalystEvidence),
    component("market_sector", input.marketSector, weights.market_sector, input.marketEvidence),
    component("relative_strength", input.relativeStrength, weights.relative_strength, input.relativeStrengthEvidence),
    component("fundamentals", input.fundamentals, weights.fundamentals, input.fundamentalEvidence),
    component("smart_money", input.smartMoney, weights.smart_money, input.smartMoneyEvidence),
    component("liquidity", input.liquidity, weights.liquidity, input.liquidityEvidence),
    component("risk_reward", input.riskReward, weights.risk_reward, input.riskEvidence),
  ];
  const available = components.filter((item) => item.available);
  const availableWeight = available.reduce((sum, item) => sum + item.weight, 0);
  const rawScore = availableWeight
    ? available.reduce((sum, item) => sum + item.score * item.weight, 0) / availableWeight
    : 0;
  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  const completeness = totalWeight ? availableWeight / totalWeight : 0;
  const completenessMultiplier = 0.85 + completeness * 0.15;
  const opportunityScore = Math.round(rawScore * completenessMultiplier);
  for (const item of components) {
    item.weightedContribution = item.available
      ? Number(((item.score * item.weight / Math.max(availableWeight, 1)) * completenessMultiplier).toFixed(2))
      : 0;
  }

  const rewardRisk = finite(input.rewardRiskRatio) ? Number(input.rewardRiskRatio) : null;
  const providerState = String(input.providerState || "UNKNOWN").toUpperCase();
  const dataHealthy = input.dataFresh !== false
    && finite(input.dataQuality)
    && Number(input.dataQuality) >= configuration.thresholds.minimumDataQuality
    && !["STALE", "OFFLINE"].includes(providerState);
  const gates = [
    gate("valid_setup", input.validSetup === true, input.validSetup === true ? "Evaluator setup is valid." : "Evaluator has not produced a valid setup."),
    gate("data_health", dataHealthy, dataHealthy ? "Market data is fresh enough and meets the quality floor." : "Market data is stale, offline, missing, or below the quality floor."),
    gate("hard_rejection", input.hardRejection !== true, input.hardRejection === true ? "Evaluator hard rejection is active." : "No evaluator hard rejection."),
    gate("current_price", finite(input.currentPrice) && Number(input.currentPrice) > 0, finite(input.currentPrice) && Number(input.currentPrice) > 0 ? "Current price is available." : "Current price is unavailable."),
    gate("liquidity", input.liquidityPassed === true, input.liquidityPassed === true ? "Liquidity gate passed." : "Liquidity gate has not passed."),
    gate("spread", input.spreadPassed === true, input.spreadPassed === true ? "Spread gate passed." : "Spread gate has not passed."),
    gate("risk_plan", finite(input.riskReward) && rewardRisk !== null && rewardRisk >= configuration.thresholds.minimumRewardRisk, rewardRisk === null ? "Reward/risk is unavailable." : `Reward/risk is ${rewardRisk.toFixed(2)}; minimum is ${configuration.thresholds.minimumRewardRisk.toFixed(2)}.`),
    gate("intraday_context", input.intradayUsable !== false, input.intradayUsable === false ? "Intraday context is stale or unusable." : "Intraday context is usable or not required for this research cycle."),
    gate("market_regime", input.riskState !== "RISK_OFF", input.riskState === "RISK_OFF" ? "Risk-off market regime blocks a new long entry." : "Market regime does not block a new long entry."),
    gate("severe_news", !finite(input.researchCatalyst) || Number(input.researchCatalyst) > configuration.thresholds.maximumSevereNegativeCatalystScore, finite(input.researchCatalyst) && Number(input.researchCatalyst) <= configuration.thresholds.maximumSevereNegativeCatalystScore ? "Severe negative catalyst evidence blocks a new long entry." : "No severe negative catalyst block."),
    gate("buying_power", input.buyingPowerPassed, "Broker buying power is evaluated when an exact order draft is built.", false),
    gate("market_hours", input.marketHoursPassed, "Market-session eligibility is evaluated immediately before live order review.", false),
    gate("duplicate_order", input.duplicateOrderPassed, "Duplicate and conflicting-order checks run immediately before live order review.", false),
  ];
  const blockers = gates.filter((item) => item.required && item.passed !== true).map((item) => ({ code: item.name, reason: item.reason }));
  const confidence = confidenceFor({
    components,
    dataQuality: input.dataQuality,
    conflicts: input.conflicts,
    providerState,
    configuration,
  });
  const state = blockers.length ? "BLOCKED"
    : opportunityScore >= configuration.thresholds.highPriorityScore ? "ACTIONABLE"
      : opportunityScore >= configuration.thresholds.candidateScore ? "WATCH"
        : "RESEARCH";

  return {
    version: configuration.version,
    direction: input.direction || configuration.direction,
    opportunityScore,
    rawScore: Number(rawScore.toFixed(2)),
    confidence,
    state,
    eligible: blockers.length === 0,
    components,
    gates,
    blockers,
    configuration: {
      weights: { ...weights },
      thresholds: { ...configuration.thresholds },
    },
  };
}

module.exports = {
  scoreOpportunity,
};

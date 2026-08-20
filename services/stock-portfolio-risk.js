const RISK_ENGINE_VERSION = "argentum-portfolio-risk-v2";

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum, fallback = minimum) {
  const number = finite(value, fallback);
  return Math.max(minimum, Math.min(maximum, number));
}

function money(value) {
  return Math.round(finite(value, 0) * 100) / 100;
}

function normalizeRiskLimits(value = {}) {
  const maxPositions = Math.round(clamp(value.maxPositions, 1, 100, 5));
  return {
    riskPerTradePct: clamp(value.riskPerTradePct, 0.001, 0.1, 0.01),
    dailyLossLimitPct: clamp(value.dailyLossLimitPct, 0.001, 0.25, 0.02),
    maxPortfolioExposurePct: clamp(value.maxPortfolioExposurePct, 0.01, 1, 1),
    maxSinglePositionPct: clamp(value.maxSinglePositionPct, 0.01, 1, 1 / maxPositions),
    maxSectorExposurePct: clamp(value.maxSectorExposurePct, 0.01, 1, 0.4),
    maxCorrelatedExposurePct: clamp(value.maxCorrelatedExposurePct, 0.01, 1, 0.5),
    maxPositions,
    minimumRewardRisk: clamp(value.minimumRewardRisk, 0.25, 20, 1.5),
    maxOrderDollars: clamp(value.maxOrderDollars, 0.01, 1_000_000, 25),
    maxTotalDollars: clamp(value.maxTotalDollars, 0, 1_000_000, 0),
    cashReserveDollars: clamp(value.cashReserveDollars, 0, 1_000_000, 0),
  };
}

function portfolioRiskState(input = {}) {
  const limits = normalizeRiskLimits(input.limits);
  const accountEquity = finite(input.accountEquity, null);
  const buyingPower = finite(input.buyingPower, null);
  const principal = finite(input.principal, null);
  const capitalCandidates = [accountEquity, principal, limits.maxTotalDollars].filter((item) => item !== null && item > 0);
  const riskCapital = capitalCandidates.length ? Math.max(0, Math.min(...capitalCandidates)) : 0;
  const positions = (Array.isArray(input.positions) ? input.positions : []).map((position) => ({
    symbol: String(position.symbol || "").toUpperCase(),
    marketValue: Math.max(0, finite(position.marketValue, 0)),
    sector: String(position.sector || "UNKNOWN"),
  })).filter((position) => position.symbol && position.marketValue > 0);
  const pendingOrders = (Array.isArray(input.pendingOrders) ? input.pendingOrders : []).map((order) => ({
    symbol: String(order.symbol || "").toUpperCase(),
    notional: Math.max(0, finite(order.notional, 0)),
    sector: String(order.sector || "UNKNOWN"),
    side: String(order.side || "").toUpperCase(),
  })).filter((order) => order.symbol && order.notional > 0 && order.side === "BUY");
  const deployed = positions.reduce((sum, item) => sum + item.marketValue, 0);
  const pending = pendingOrders.reduce((sum, item) => sum + item.notional, 0);
  const exposure = deployed + pending;
  const sectorExposure = {};
  for (const item of [...positions.map((position) => ({ ...position, notional: position.marketValue })), ...pendingOrders]) {
    sectorExposure[item.sector] = money((sectorExposure[item.sector] || 0) + item.notional);
  }
  const policyExposureCap = Math.min(
    limits.maxTotalDollars > 0 ? limits.maxTotalDollars : Number.POSITIVE_INFINITY,
    riskCapital > 0 ? riskCapital * limits.maxPortfolioExposurePct : Number.POSITIVE_INFINITY,
  );
  const buyingPowerAvailable = buyingPower === null ? null : Math.max(0, buyingPower - limits.cashReserveDollars - pending);
  const availableForNewBuys = money(Math.max(0, Math.min(
    Number.isFinite(policyExposureCap) ? policyExposureCap - exposure : 0,
    buyingPowerAvailable === null ? 0 : buyingPowerAvailable,
  )));
  return {
    version: RISK_ENGINE_VERSION,
    verified: accountEquity !== null && accountEquity > 0 && buyingPower !== null,
    accountEquity: accountEquity === null ? null : money(accountEquity),
    riskCapital: money(riskCapital),
    buyingPower: buyingPower === null ? null : money(buyingPower),
    deployedDollars: money(deployed),
    pendingBuyDollars: money(pending),
    totalExposureDollars: money(exposure),
    exposurePct: accountEquity && accountEquity > 0 ? Number((exposure / accountEquity).toFixed(4)) : null,
    availableForNewBuys,
    sectorExposure,
    unknownSectorExposureDollars: money(sectorExposure.UNKNOWN || 0),
    limits,
  };
}

function sizePosition(input = {}) {
  const portfolio = input.portfolio || portfolioRiskState(input);
  const limits = portfolio.limits || normalizeRiskLimits(input.limits);
  const entry = finite(input.entry, null);
  const stop = finite(input.stop, null);
  const symbol = String(input.symbol || "").toUpperCase();
  const sector = String(input.sector || "UNKNOWN");
  const currentPositionDollars = Math.max(0, finite(input.currentPositionDollars, 0));
  const requestedDollars = Math.max(0, finite(input.requestedDollars, limits.maxOrderDollars));
  const reasons = [];
  if (entry === null || entry <= 0) reasons.push("A positive current entry price is required.");
  if (stop === null || stop <= 0 || (entry !== null && stop >= entry)) reasons.push("A defined stop below the entry is required for a long position.");
  if (!portfolio.verified) reasons.push("Account equity and buying power must be verified.");
  const perShareRisk = entry !== null && stop !== null && entry > stop ? entry - stop : null;
  const riskBudgetDollars = money(portfolio.riskCapital * limits.riskPerTradePct);
  const riskCapDollars = perShareRisk && entry ? riskBudgetDollars / perShareRisk * entry : 0;
  const positionCapDollars = portfolio.accountEquity ? portfolio.accountEquity * limits.maxSinglePositionPct : 0;
  const sectorCurrent = finite(portfolio.sectorExposure?.[sector], 0);
  const sectorCapDollars = portfolio.accountEquity && sector !== "UNKNOWN"
    ? Math.max(0, portfolio.accountEquity * limits.maxSectorExposurePct - sectorCurrent)
    : Number.POSITIVE_INFINITY;
  const caps = {
    requested: requestedDollars,
    risk: riskCapDollars,
    buyingPower: portfolio.availableForNewBuys,
    maxOrder: limits.maxOrderDollars,
    position: Math.max(0, positionCapDollars - currentPositionDollars),
    sector: sectorCapDollars,
  };
  const permittedDollars = money(Math.max(0, Math.min(...Object.values(caps))));
  const quantity = entry && entry > 0 ? Math.floor((permittedDollars / entry) * 1_000_000) / 1_000_000 : 0;
  const actualNotional = money(quantity * (entry || 0));
  const estimatedRiskDollars = perShareRisk ? money(quantity * perShareRisk) : 0;
  if (permittedDollars <= 0) reasons.push("No capital remains after the configured account, position, sector, buying-power, and risk caps.");
  const bindingCaps = Object.entries(caps)
    .filter(([, value]) => Number.isFinite(value) && Math.abs(value - permittedDollars) < 0.02)
    .map(([name]) => name);
  return {
    version: RISK_ENGINE_VERSION,
    symbol,
    sector,
    eligible: reasons.length === 0 && quantity > 0,
    blockers: [...new Set(reasons)],
    entry,
    stop,
    stopDistancePct: entry && stop && entry > stop ? Number(((entry - stop) / entry).toFixed(6)) : null,
    riskBudgetDollars,
    requestedDollars: money(requestedDollars),
    permittedDollars: actualNotional,
    quantity,
    estimatedRiskDollars,
    accountRiskPct: portfolio.accountEquity && portfolio.accountEquity > 0 ? Number((estimatedRiskDollars / portfolio.accountEquity).toFixed(6)) : null,
    caps: Object.fromEntries(Object.entries(caps).map(([name, value]) => [name, Number.isFinite(value) ? money(value) : null])),
    bindingCaps,
    portfolio,
  };
}

function rewardRisk(entry, stop, target) {
  const entryValue = finite(entry, null);
  const stopValue = finite(stop, null);
  const targetValue = finite(target, null);
  if (entryValue === null || stopValue === null || targetValue === null || entryValue <= stopValue || targetValue <= entryValue) return null;
  return Number(((targetValue - entryValue) / (entryValue - stopValue)).toFixed(3));
}

function buildTradePlan(input = {}) {
  const sizing = input.sizing || sizePosition(input);
  const entry = finite(input.entry, null);
  const stop = finite(input.stop, null);
  const target1 = finite(input.target1, null);
  const target2 = finite(input.target2, null);
  const target1RewardRisk = rewardRisk(entry, stop, target1);
  const target2RewardRisk = rewardRisk(entry, stop, target2);
  return {
    version: RISK_ENGINE_VERSION,
    symbol: String(input.symbol || "").toUpperCase(),
    direction: String(input.direction || "LONG").toUpperCase(),
    preferredEntry: entry,
    entryZone: String(input.entryZone || ""),
    invalidation: String(input.invalidation || ""),
    stop,
    targets: [
      target1 === null ? null : { label: "target_1", price: target1, rewardRisk: target1RewardRisk },
      target2 === null ? null : { label: "target_2", price: target2, rewardRisk: target2RewardRisk },
    ].filter(Boolean),
    position: {
      dollars: sizing.permittedDollars,
      quantity: sizing.quantity,
      estimatedRiskDollars: sizing.estimatedRiskDollars,
      accountRiskPct: sizing.accountRiskPct,
      bindingCaps: sizing.bindingCaps,
    },
    opportunityScore: finite(input.opportunityScore, null),
    confidenceScore: finite(input.confidenceScore, null),
    catalyst: input.catalyst || null,
    reasons: (Array.isArray(input.reasons) ? input.reasons : []).filter(Boolean).map(String).slice(0, 8),
    risks: (Array.isArray(input.risks) ? input.risks : []).filter(Boolean).map(String).slice(0, 8),
    blockers: sizing.blockers,
  };
}

module.exports = {
  RISK_ENGINE_VERSION,
  buildTradePlan,
  normalizeRiskLimits,
  portfolioRiskState,
  rewardRisk,
  sizePosition,
};

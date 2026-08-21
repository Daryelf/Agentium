const PERFORMANCE_VERSION = "argentum-performance-v1";

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function average(values) {
  const usable = values.map(finite).filter((value) => value !== null);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function rounded(value, digits = 4) {
  const number = finite(value);
  return number === null ? null : Number(number.toFixed(digits));
}

function maximumDrawdown(returns) {
  let equity = 1;
  let peak = 1;
  let drawdown = 0;
  for (const value of returns) {
    equity *= 1 + value;
    peak = Math.max(peak, equity);
    drawdown = Math.min(drawdown, peak > 0 ? equity / peak - 1 : 0);
  }
  return rounded(drawdown);
}

function preferredOutcome(signal = {}) {
  const outcomes = Array.isArray(signal.outcomes) ? signal.outcomes : [];
  const order = ["1d", "end_of_day", "1h", "30m", "15m", "5m", "5d"];
  for (const horizon of order) {
    const item = outcomes.find((outcome) => outcome.horizon === horizon);
    if (item && finite(item.returnPct) !== null) return item;
  }
  return null;
}

function groupPerformance(samples, keyFn) {
  const groups = new Map();
  for (const sample of samples) {
    const key = String(keyFn(sample) || "UNKNOWN");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sample.returnPct);
  }
  return [...groups.entries()].map(([key, values]) => ({
    key,
    samples: values.length,
    averageReturnPct: rounded(average(values)),
    winRate: rounded(values.filter((value) => value > 0).length / values.length),
  })).sort((a, b) => (b.averageReturnPct ?? -Infinity) - (a.averageReturnPct ?? -Infinity));
}

function featureKey(signal) {
  const components = signal.data?.componentScores || signal.data?.scoreFormula?.components || [];
  const strong = components.filter((item) => item.available !== false && finite(item.score) !== null && Number(item.score) >= 70).map((item) => item.name).sort();
  return strong.length ? strong.slice(0, 4).join("+") : "NO_STRONG_COMPONENT_SET";
}

function normalizePortfolioSnapshots(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const accountValue = finite(item.accountValue);
    const observedTimestamp = Date.parse(item.observedAt || "");
    const observedAt = Number.isFinite(observedTimestamp) ? new Date(observedTimestamp).toISOString() : null;
    if (accountValue === null || accountValue <= 0 || !observedAt) return null;
    return {
      id: item.id || null,
      observedAt,
      accountValue: rounded(accountValue, 2),
      cashValue: rounded(item.cashValue, 2),
      investedValue: rounded(item.investedValue, 2),
      buyingPower: rounded(item.buyingPower, 2),
      dayPnl: rounded(item.dayPnl, 2),
      realizedPnl: rounded(item.realizedPnl, 2),
      unrealizedPnl: rounded(item.unrealizedPnl, 2),
      goalValue: rounded(item.goalValue, 2) || 150,
      positions: Array.isArray(item.positions) ? item.positions : [],
    };
  }).filter(Boolean).sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt)).slice(-1000);
}

function portfolioAnalytics(snapshots, trades) {
  const latest = snapshots[snapshots.length - 1] || null;
  const first = snapshots[0] || null;
  const goal = latest?.goalValue || 150;
  const accountValue = latest?.accountValue ?? null;
  const changeDollars = latest && first ? rounded(latest.accountValue - first.accountValue, 2) : null;
  const changePct = latest && first && first.accountValue > 0 ? rounded(changeDollars / first.accountValue) : null;
  const latestPositions = Array.isArray(latest?.positions) ? latest.positions : [];
  const allocation = [
    ...(finite(latest?.cashValue) !== null && Number(latest.cashValue) > 0 ? [{ key: "Cash", symbol: "CASH", value: rounded(latest.cashValue, 2) }] : []),
    ...latestPositions.map((position) => ({
      key: String(position.symbol || "UNKNOWN").toUpperCase(),
      symbol: String(position.symbol || "").toUpperCase(),
      value: rounded(position.marketValue, 2),
    })).filter((item) => item.symbol && item.value !== null && item.value > 0),
  ];
  const holdings = latestPositions.map((position) => {
    const quantity = finite(position.quantity);
    const currentPrice = finite(position.currentPrice);
    const averageBuyPrice = finite(position.averageBuyPrice);
    const marketValue = finite(position.marketValue);
    const unrealizedPnl = finite(position.unrealizedPnl) ?? (
      quantity !== null && currentPrice !== null && averageBuyPrice !== null
        ? quantity * (currentPrice - averageBuyPrice)
        : null
    );
    const cost = quantity !== null && averageBuyPrice !== null ? quantity * averageBuyPrice : null;
    return {
      symbol: String(position.symbol || "").toUpperCase(),
      quantity: rounded(quantity, 6),
      currentPrice: rounded(currentPrice, 2),
      marketValue: rounded(marketValue, 2),
      unrealizedPnl: rounded(unrealizedPnl, 2),
      returnPct: cost && unrealizedPnl !== null ? rounded(unrealizedPnl / cost) : null,
    };
  }).filter((item) => item.symbol);
  const tradeMarkers = trades.flatMap((trade) => {
    const symbol = String(trade.symbol || "").toUpperCase();
    if (!symbol) return [];
    const markers = [];
    if (trade.openedAt || trade.createdAt) markers.push({ symbol, side: String(trade.side || "BUY").toUpperCase(), at: trade.openedAt || trade.createdAt, status: trade.status || "recorded" });
    if (trade.closedAt) markers.push({ symbol, side: "SELL", at: trade.closedAt, status: trade.status || "closed" });
    return markers;
  }).filter((item) => Number.isFinite(Date.parse(item.at))).slice(-50);
  const heldSymbols = new Set(tradeMarkers.map((item) => item.symbol));
  for (const position of latestPositions) {
    const symbol = String(position.symbol || "").toUpperCase();
    if (symbol && !heldSymbols.has(symbol) && latest) tradeMarkers.push({ symbol, side: "HOLD", at: latest.observedAt, status: "owned" });
  }
  return {
    summary: {
      portfolioSnapshots: snapshots.length,
      currentPortfolioValue: accountValue,
      startPortfolioValue: first?.accountValue ?? null,
      portfolioChangeDollars: changeDollars,
      portfolioChangePct: changePct,
      capitalGoal: goal,
      goalGapDollars: accountValue === null ? null : rounded(Math.max(0, goal - accountValue), 2),
      goalProgressPct: accountValue === null || goal <= 0 ? null : rounded(Math.min(1, accountValue / goal)),
      cashValue: latest?.cashValue ?? null,
      investedValue: latest?.investedValue ?? null,
      buyingPower: latest?.buyingPower ?? null,
      dayPnl: latest?.dayPnl ?? null,
      realizedPnl: latest?.realizedPnl ?? null,
      unrealizedPnl: latest?.unrealizedPnl ?? null,
      lastPortfolioObservedAt: latest?.observedAt ?? null,
    },
    series: {
      portfolioEquityCurve: snapshots,
      allocation,
      holdings,
      activityMarkers: tradeMarkers.slice(-50),
    },
  };
}

function calculatePerformance(input = {}) {
  const signals = Array.isArray(input.signals) ? input.signals : [];
  const trades = Array.isArray(input.trades) ? input.trades : [];
  const approvals = Array.isArray(input.approvals) ? input.approvals : [];
  const portfolioSnapshots = normalizePortfolioSnapshots(input.portfolioSnapshots);
  const portfolio = portfolioAnalytics(portfolioSnapshots, trades);
  const samples = signals.map((signal) => {
    const outcome = preferredOutcome(signal);
    if (!outcome) return null;
    const reference = finite(signal.referencePrice);
    const stop = finite(signal.stopPrice);
    const returnPct = finite(outcome.returnPct);
    const initialRiskPct = reference !== null && stop !== null && reference > stop ? (reference - stop) / reference : null;
    return {
      signal,
      horizon: outcome.horizon,
      returnPct,
      rMultiple: initialRiskPct && initialRiskPct > 0 ? returnPct / initialRiskPct : null,
    };
  }).filter(Boolean).sort((a, b) => Date.parse(a.signal.observedAt) - Date.parse(b.signal.observedAt));
  const returns = samples.map((sample) => sample.returnPct);
  const winners = returns.filter((value) => value > 0);
  const losers = returns.filter((value) => value < 0);
  const grossProfit = winners.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losers.reduce((sum, value) => sum + value, 0));
  const realizedPnl = trades.map((trade) => finite(trade.realizedPnl)).filter((value) => value !== null);
  const unrealizedPnl = trades.map((trade) => finite(trade.unrealizedPnl)).filter((value) => value !== null);
  let signalEquity = 1;
  const signalEquityCurve = samples.map((sample) => {
    signalEquity *= 1 + sample.returnPct;
    return {
      at: sample.signal.observedAt,
      symbol: sample.signal.symbol,
      horizon: sample.horizon,
      returnPct: rounded(sample.returnPct),
      equity: rounded(signalEquity),
    };
  }).slice(-250);
  const distributionRanges = [
    ["≤ -5%", -Infinity, -0.05],
    ["-5% to -2%", -0.05, -0.02],
    ["-2% to 0%", -0.02, 0],
    ["0% to 2%", 0, 0.02],
    ["2% to 5%", 0.02, 0.05],
    ["≥ 5%", 0.05, Infinity],
  ];
  const returnDistribution = distributionRanges.map(([label, minimum, maximum], index) => ({
    label,
    count: returns.filter((value) => value >= minimum && (index === distributionRanges.length - 1 ? value <= maximum : value < maximum)).length,
  }));
  const byStrategy = groupPerformance(samples, (sample) => sample.signal.strategyVersion);
  const byRegime = groupPerformance(samples, (sample) => sample.signal.marketRegime);
  const bySector = groupPerformance(samples, (sample) => sample.signal.data?.company?.sector || sample.signal.sectorState);
  const byFeatureSet = groupPerformance(samples, (sample) => featureKey(sample.signal));
  return {
    version: PERFORMANCE_VERSION,
    generatedAt: input.generatedAt || new Date().toISOString(),
    scope: "persisted_live_research_signals",
    summary: {
      ...portfolio.summary,
      totalSignals: signals.length,
      actionableSignals: signals.filter((signal) => signal.state === "ACTIONABLE").length,
      measuredSignals: samples.length,
      pendingSignals: signals.length - samples.length,
      approvedTrades: approvals.filter((approval) => approval.status === "approved").length,
      rejectedTrades: approvals.filter((approval) => ["blocked", "rejected", "needs_revision"].includes(approval.status)).length,
      brokerTrades: trades.length,
      realizedBrokerPnl: rounded(realizedPnl.reduce((sum, value) => sum + value, 0)),
      unrealizedBrokerPnl: rounded(unrealizedPnl.reduce((sum, value) => sum + value, 0)),
      wins: winners.length,
      losses: losers.length,
      winRate: samples.length ? rounded(winners.length / samples.length) : null,
      lossRate: samples.length ? rounded(losers.length / samples.length) : null,
      averageWinnerPct: rounded(average(winners)),
      averageLoserPct: rounded(average(losers)),
      expectancyPct: rounded(average(returns)),
      averageRMultiple: rounded(average(samples.map((sample) => sample.rMultiple))),
      profitFactor: grossLoss > 0 ? rounded(grossProfit / grossLoss) : grossProfit > 0 ? null : null,
      maximumDrawdownPct: samples.length ? maximumDrawdown(returns) : null,
    },
    attribution: {
      byStrategy,
      byRegime,
      bySector,
      byFeatureSet,
      bestStrategy: byStrategy[0] || null,
      worstStrategy: byStrategy.length ? byStrategy[byStrategy.length - 1] : null,
      bestRegime: byRegime[0] || null,
      worstRegime: byRegime.length ? byRegime[byRegime.length - 1] : null,
      bestSector: bySector[0] || null,
      worstSector: bySector.length ? bySector[bySector.length - 1] : null,
    },
    series: {
      ...portfolio.series,
      signalEquityCurve,
      returnDistribution,
    },
    boundaries: {
      historicalBacktestMixedIn: false,
      paperTradingMixedIn: false,
      liveBrokerFillsMixedIntoSignalReturns: false,
      autoParameterChangesAllowed: false,
      note: "Signal outcomes, paper/backtest results, and live broker trades remain separate datasets.",
    },
  };
}

module.exports = {
  PERFORMANCE_VERSION,
  calculatePerformance,
  maximumDrawdown,
  preferredOutcome,
};

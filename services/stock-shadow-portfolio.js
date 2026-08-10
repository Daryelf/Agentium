const crypto = require("node:crypto");
const { normalizeGuardrails } = require("./stock-broker-control");

const MODE = "paper_shadow_only";
const MAX_POSITIONS = 100;
const MAX_FILLS = 240;
const MAX_DECISIONS = 320;
const MAX_PROCESSED_SOURCES = 500;

function safeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max, fallback = min) {
  return Math.max(min, Math.min(max, finiteNumber(value, fallback)));
}

function money(value) {
  return Math.round(finiteNumber(value, 0) * 100) / 100;
}

function quantity(value) {
  return Math.floor(Math.max(0, finiteNumber(value, 0)) * 1_000_000) / 1_000_000;
}

function symbol(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
}

function shortText(value, length = 240) {
  return String(value || "").trim().slice(0, length);
}

function stableFingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function marketDay(value, timeZone = "America/New_York") {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

function initialCash(snapshot = {}, requested = null) {
  const requestedNumber = requested === null || requested === undefined || requested === "" ? null : Number(requested);
  if (requestedNumber !== null && Number.isFinite(requestedNumber)) return money(clamp(requestedNumber, 0, 1_000_000, 0));
  const guardrailCash = Number(snapshot.guardrails?.principalDollars);
  if (Number.isFinite(guardrailCash) && guardrailCash > 0) return money(clamp(guardrailCash, 0, 1_000_000, 0));
  return money(clamp(snapshot.mirror?.policy?.totalBudgetDollars, 0, 1_000_000, 0));
}

function normalizePosition(value = {}) {
  const normalizedSymbol = symbol(value.symbol);
  const normalizedQuantity = quantity(value.quantity);
  const entryPrice = money(clamp(value.avgEntryPrice, 0, 10_000_000, 0));
  const currentPrice = money(clamp(value.currentPrice, 0, 10_000_000, entryPrice));
  if (!normalizedSymbol || normalizedQuantity <= 0 || entryPrice <= 0) return null;
  const costBasis = money(normalizedQuantity * entryPrice);
  const marketValue = money(normalizedQuantity * currentPrice);
  return {
    id: shortText(value.id || `paper-position-${crypto.randomUUID()}`, 100),
    symbol: normalizedSymbol,
    quantity: normalizedQuantity,
    avgEntryPrice: entryPrice,
    currentPrice,
    costBasisDollars: costBasis,
    marketValueDollars: marketValue,
    unrealizedPnlDollars: money(marketValue - costBasis),
    sourceType: shortText(value.sourceType || "evaluator", 40),
    sourceId: shortText(value.sourceId, 180),
    sourceFingerprint: String(value.sourceFingerprint || "").replace(/[^a-f0-9]/gi, "").slice(0, 64),
    traderName: shortText(value.traderName, 160),
    entryKind: shortText(value.entryKind || "native_entry", 60),
    stopLoss: money(clamp(value.stopLoss, 0, 10_000_000, 0)),
    target1: money(clamp(value.target1, 0, 10_000_000, 0)),
    openedAt: safeDate(value.openedAt) || new Date().toISOString(),
    lastMarkedAt: safeDate(value.lastMarkedAt) || safeDate(value.openedAt) || new Date().toISOString(),
  };
}

function normalizeFill(value = {}) {
  const side = String(value.side || "").toUpperCase() === "SELL" ? "SELL" : "BUY";
  const normalizedSymbol = symbol(value.symbol);
  if (!normalizedSymbol) return null;
  return {
    id: shortText(value.id || `paper-fill-${crypto.randomUUID()}`, 100),
    fingerprint: String(value.fingerprint || "").replace(/[^a-f0-9]/gi, "").slice(0, 64),
    side,
    symbol: normalizedSymbol,
    quantity: quantity(value.quantity),
    price: money(clamp(value.price, 0, 10_000_000, 0)),
    notionalDollars: money(clamp(value.notionalDollars, 0, 1_000_000_000, 0)),
    realizedPnlDollars: side === "SELL" ? money(clamp(value.realizedPnlDollars, -1_000_000_000, 1_000_000_000, 0)) : 0,
    returnPct: side === "SELL" ? clamp(value.returnPct, -1, 1000, 0) : 0,
    reason: shortText(value.reason, 400),
    sourceType: shortText(value.sourceType || "evaluator", 40),
    sourceId: shortText(value.sourceId, 180),
    traderName: shortText(value.traderName, 160),
    strategy: shortText(value.strategy || "native_entry", 60),
    filledAt: safeDate(value.filledAt) || new Date().toISOString(),
    liveOrderPlaced: false,
    brokerCalled: false,
  };
}

function normalizeDecision(value = {}) {
  const normalizedSymbol = symbol(value.symbol);
  if (!normalizedSymbol) return null;
  const allowedOutcomes = new Set(["filled", "blocked", "already_open", "no_position", "invalid_price"]);
  return {
    id: shortText(value.id || `paper-decision-${crypto.randomUUID()}`, 100),
    fingerprint: String(value.fingerprint || "").replace(/[^a-f0-9]/gi, "").slice(0, 64),
    action: String(value.action || "HOLD").toUpperCase() === "SELL" ? "SELL" : "BUY",
    symbol: normalizedSymbol,
    outcome: allowedOutcomes.has(value.outcome) ? value.outcome : "blocked",
    reason: shortText(value.reason, 400),
    requestedDollars: money(clamp(value.requestedDollars, 0, 1_000_000_000, 0)),
    sourceType: shortText(value.sourceType || "evaluator", 40),
    sourceId: shortText(value.sourceId, 180),
    traderName: shortText(value.traderName, 160),
    strategy: shortText(value.strategy || "native_entry", 60),
    observedAt: safeDate(value.observedAt) || new Date().toISOString(),
    liveOrderPlaced: false,
    brokerCalled: false,
  };
}

function learningFromFills(fills = []) {
  const exits = fills.filter((fill) => fill.side === "SELL");
  const summarize = (items, key, label) => {
    const wins = items.filter((item) => item.realizedPnlDollars > 0).length;
    const losses = items.filter((item) => item.realizedPnlDollars < 0).length;
    const total = money(items.reduce((sum, item) => sum + item.realizedPnlDollars, 0));
    return {
      key,
      label,
      trades: items.length,
      wins,
      losses,
      breakeven: items.length - wins - losses,
      hitRate: wins + losses ? wins / (wins + losses) : null,
      totalPnlDollars: total,
      expectancyDollars: items.length ? money(total / items.length) : null,
      averageReturnPct: items.length ? items.reduce((sum, item) => sum + finiteNumber(item.returnPct, 0), 0) / items.length : null,
    };
  };
  const groups = new Map();
  for (const fill of exits) {
    const key = `${fill.sourceType}:${fill.traderName || fill.sourceId || fill.strategy}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(fill);
  }
  const overall = summarize(exits, "all", "All closed paper trades");
  return {
    methodology: "closed_paper_trades_only_no_profit_guarantee",
    closedTrades: overall.trades,
    wins: overall.wins,
    losses: overall.losses,
    breakeven: overall.breakeven,
    hitRate: overall.hitRate,
    totalRealizedPnlDollars: overall.totalPnlDollars,
    expectancyDollars: overall.expectancyDollars,
    averageReturnPct: overall.averageReturnPct,
    profiles: [...groups.entries()]
      .map(([key, items]) => summarize(items, key, items[0]?.traderName || items[0]?.strategy || items[0]?.sourceId || key))
      .sort((a, b) => b.trades - a.trades || b.totalPnlDollars - a.totalPnlDollars)
      .slice(0, 40),
  };
}

function summarizePortfolio(portfolio) {
  const deployed = money(portfolio.positions.reduce((sum, item) => sum + item.marketValueDollars, 0));
  const equity = money(portfolio.cashDollars + deployed);
  const unrealized = money(portfolio.positions.reduce((sum, item) => sum + item.unrealizedPnlDollars, 0));
  const realized = money(portfolio.fills.reduce((sum, fill) => sum + fill.realizedPnlDollars, 0));
  const peak = Math.max(finiteNumber(portfolio.highWaterEquityDollars, equity), equity);
  const drawdown = peak > 0 ? Math.max(0, (peak - equity) / peak) : 0;
  return {
    ...portfolio,
    cashDollars: money(portfolio.cashDollars),
    deployedDollars: deployed,
    equityDollars: equity,
    realizedPnlDollars: realized,
    unrealizedPnlDollars: unrealized,
    totalPnlDollars: money(equity - portfolio.initialCashDollars),
    totalReturnPct: portfolio.initialCashDollars > 0 ? (equity - portfolio.initialCashDollars) / portfolio.initialCashDollars : 0,
    highWaterEquityDollars: money(peak),
    currentDrawdownPct: drawdown,
    maxDrawdownPct: Math.max(finiteNumber(portfolio.maxDrawdownPct, 0), drawdown),
    learning: learningFromFills(portfolio.fills),
    liveOrderPlaced: false,
    brokerCalled: false,
  };
}

function applyRiskMetadata(portfolio, snapshot = {}) {
  const guardrails = normalizeGuardrails(snapshot.guardrails || {});
  const summarized = summarizePortfolio(portfolio);
  summarized.dayPnlDollars = money(summarized.equityDollars - summarized.day.startingEquityDollars);
  summarized.dailyLossLimitDollars = money(summarized.initialCashDollars * guardrails.dailyLossLimitPct);
  summarized.dailyLossLocked = summarized.dayPnlDollars <= -summarized.dailyLossLimitDollars && summarized.dailyLossLimitDollars > 0;
  summarized.guardrails = {
    principalDollars: guardrails.principalDollars,
    maxTotalDollars: guardrails.maxTotalDollars,
    maxOrderDollars: guardrails.maxOrderDollars,
    cashReserveDollars: guardrails.cashReserveDollars,
    dailyLossLimitPct: guardrails.dailyLossLimitPct,
    riskPerTradePct: guardrails.riskPerTradePct,
    maxPositions: guardrails.maxPositions,
    maxTradesPerDay: guardrails.maxTradesPerDay,
    minEntryScore: guardrails.minEntryScore,
  };
  summarized.safety = {
    simulationOnly: true,
    liveOrderAuthority: false,
    brokerToolsAvailableToEngine: false,
    humanGateRequiredForEveryLiveOrder: true,
    profitGuaranteed: false,
  };
  return summarized;
}

function normalizeShadowPortfolio(input = {}, options = {}) {
  const value = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const at = options.now ? new Date(options.now) : new Date();
  const startingCash = initialCash(options.snapshot || {}, value.initialCashDollars ?? options.startingCashDollars);
  const positions = (Array.isArray(value.positions) ? value.positions : []).map(normalizePosition).filter(Boolean).slice(0, MAX_POSITIONS);
  const fills = (Array.isArray(value.fills) ? value.fills : []).map(normalizeFill).filter(Boolean).slice(-MAX_FILLS);
  const decisions = (Array.isArray(value.decisions) ? value.decisions : []).map(normalizeDecision).filter(Boolean).slice(-MAX_DECISIONS);
  const currentEquity = money(clamp(value.equityDollars, 0, 1_000_000_000, startingCash));
  const dayKey = marketDay(at);
  const storedDay = value.day && typeof value.day === "object" ? value.day : {};
  const normalized = {
    version: 1,
    mode: MODE,
    status: startingCash > 0 ? "running" : "waiting_for_paper_capital",
    initialCashDollars: startingCash,
    cashDollars: money(clamp(value.cashDollars, 0, 1_000_000_000, startingCash)),
    positions,
    fills,
    decisions,
    processedSourceFingerprints: [...new Set((Array.isArray(value.processedSourceFingerprints) ? value.processedSourceFingerprints : [])
      .map((item) => String(item || "").replace(/[^a-f0-9]/gi, "").slice(0, 64))
      .filter(Boolean))].slice(-MAX_PROCESSED_SOURCES),
    day: {
      key: shortText(storedDay.key || dayKey, 20),
      startingEquityDollars: money(clamp(storedDay.startingEquityDollars, 0, 1_000_000_000, currentEquity || startingCash)),
      fills: Math.round(clamp(storedDay.fills, 0, 100_000, 0)),
    },
    initializedAt: safeDate(value.initializedAt) || at.toISOString(),
    lastCycleAt: safeDate(value.lastCycleAt),
    updatedAt: safeDate(value.updatedAt) || at.toISOString(),
    highWaterEquityDollars: money(clamp(value.highWaterEquityDollars, 0, 1_000_000_000, currentEquity || startingCash)),
    maxDrawdownPct: clamp(value.maxDrawdownPct, 0, 1, 0),
    cycleCount: Math.round(clamp(value.cycleCount, 0, 100_000_000, 0)),
    liveOrderPlaced: false,
    brokerCalled: false,
  };
  return applyRiskMetadata(normalized, options.snapshot || {});
}

function priceMap(snapshot = {}, portfolio = {}) {
  const prices = new Map();
  for (const position of portfolio.positions || []) {
    if (position.currentPrice > 0) prices.set(position.symbol, position.currentPrice);
  }
  for (const record of snapshot.records || []) {
    const normalizedSymbol = symbol(record.ticker || record.symbol);
    const price = finiteNumber(record.currentPrice, 0);
    if (normalizedSymbol && price > 0) prices.set(normalizedSymbol, price);
  }
  for (const candidate of snapshot.mirror?.candidates || []) {
    const normalizedSymbol = symbol(candidate.symbol);
    const price = finiteNumber(candidate.currentPrice, 0);
    if (normalizedSymbol && price > 0) prices.set(normalizedSymbol, price);
  }
  return prices;
}

function recordDecision(portfolio, core, at) {
  const fingerprint = stableFingerprint({
    action: core.action,
    symbol: core.symbol,
    outcome: core.outcome,
    sourceId: core.sourceId,
    reason: core.reason,
    observedVersion: core.observedVersion,
    day: marketDay(at),
  });
  if (portfolio.decisions.some((item) => item.fingerprint === fingerprint)) return;
  portfolio.decisions.push(normalizeDecision({
    ...core,
    id: `paper-decision-${fingerprint.slice(0, 24)}`,
    fingerprint,
    observedAt: at.toISOString(),
  }));
  portfolio.decisions = portfolio.decisions.filter(Boolean).slice(-MAX_DECISIONS);
}

function makeFill(portfolio, core, at) {
  const fingerprint = stableFingerprint({
    side: core.side,
    symbol: core.symbol,
    sourceFingerprint: core.sourceFingerprint,
    positionId: core.positionId,
    price: core.price,
    quantity: core.quantity,
    at: at.toISOString(),
  });
  const fill = normalizeFill({
    ...core,
    id: `paper-fill-${fingerprint.slice(0, 24)}`,
    fingerprint,
    filledAt: at.toISOString(),
  });
  portfolio.fills.push(fill);
  portfolio.fills = portfolio.fills.filter(Boolean).slice(-MAX_FILLS);
  portfolio.day.fills += 1;
  return fill;
}

function resetShadowPortfolio(snapshot = {}, options = {}) {
  const at = options.now ? new Date(options.now) : new Date();
  return normalizeShadowPortfolio({
    initialCashDollars: initialCash(snapshot, options.startingCashDollars),
    initializedAt: at.toISOString(),
    updatedAt: at.toISOString(),
  }, { snapshot, now: at });
}

function runShadowPortfolioCycle(input = {}, snapshot = {}, options = {}) {
  const at = options.now ? new Date(options.now) : new Date();
  let portfolio = normalizeShadowPortfolio(input, { snapshot, now: at });
  const guardrails = normalizeGuardrails(snapshot.guardrails || {});
  const currentDay = marketDay(at);
  if (portfolio.day.key !== currentDay) {
    portfolio.day = { key: currentDay, startingEquityDollars: portfolio.equityDollars, fills: 0 };
  }
  const prices = priceMap(snapshot, portfolio);
  const records = new Map((snapshot.records || []).map((record) => [symbol(record.ticker || record.symbol), record]));
  portfolio.positions = portfolio.positions.map((position) => normalizePosition({
    ...position,
    currentPrice: prices.get(position.symbol) || position.currentPrice,
    lastMarkedAt: prices.has(position.symbol) ? at.toISOString() : position.lastMarkedAt,
  })).filter(Boolean);
  portfolio = summarizePortfolio(portfolio);

  const mirrorCandidates = Array.isArray(snapshot.mirror?.candidates) ? snapshot.mirror.candidates : [];
  const exitCandidates = mirrorCandidates.filter((candidate) => candidate.assetType === "equity" && candidate.side === "SELL" && (candidate.status === "paper_ready" || candidate.brokerPositionRequired === true));

  for (const position of [...portfolio.positions]) {
    const record = records.get(position.symbol);
    const currentPrice = prices.get(position.symbol) || position.currentPrice;
    const copyExit = exitCandidates
      .filter((candidate) => symbol(candidate.symbol) === position.symbol)
      .sort((a, b) => finiteNumber(b.rankingScore, 0) - finiteNumber(a.rankingScore, 0))[0];
    const stop = finiteNumber(position.stopLoss || record?.stopLoss, 0);
    const target = finiteNumber(position.target1 || record?.target1, 0);
    const decision = String(record?.decision || "").toUpperCase();
    let exitKind = "";
    let reason = "";
    let sourceId = position.sourceId;
    let traderName = position.traderName;
    let sourceFingerprint = position.sourceFingerprint;
    if (copyExit) {
      exitKind = "copy_exit";
      reason = `${copyExit.traderName || "Public source"} published an eligible sale signal.`;
      sourceId = copyExit.id || copyExit.fingerprint || sourceId;
      traderName = copyExit.traderName || traderName;
      sourceFingerprint = copyExit.fingerprint || stableFingerprint({ type: "copy_exit", id: copyExit.id });
    } else if (stop > 0 && currentPrice > 0 && currentPrice <= stop) {
      exitKind = "risk_exit";
      reason = `Paper mark ${money(currentPrice).toFixed(2)} reached the ${money(stop).toFixed(2)} stop.`;
    } else if (guardrails.lockProfits && target > 0 && currentPrice >= target) {
      exitKind = "profit_exit";
      reason = `Paper mark ${money(currentPrice).toFixed(2)} reached the ${money(target).toFixed(2)} target.`;
    } else if (/SELL|EXIT|AVOID|REJECT/.test(decision)) {
      exitKind = "strategy_exit";
      reason = `Evaluator changed to ${record?.decision || "risk exit"}.`;
    }
    if (!exitKind) continue;
    if (!(currentPrice > 0)) {
      recordDecision(portfolio, { action: "SELL", symbol: position.symbol, outcome: "invalid_price", reason: "No valid paper exit price is available.", sourceType: position.sourceType, sourceId, traderName, strategy: exitKind, observedVersion: record?.lastUpdated || copyExit?.currentPriceObservedAt }, at);
      continue;
    }
    const proceeds = money(position.quantity * currentPrice);
    const realized = money(proceeds - position.costBasisDollars);
    makeFill(portfolio, {
      side: "SELL",
      symbol: position.symbol,
      quantity: position.quantity,
      price: currentPrice,
      notionalDollars: proceeds,
      realizedPnlDollars: realized,
      returnPct: position.costBasisDollars > 0 ? realized / position.costBasisDollars : 0,
      reason,
      sourceType: position.sourceType,
      sourceId,
      traderName,
      strategy: position.entryKind,
      sourceFingerprint,
      positionId: position.id,
    }, at);
    portfolio.cashDollars = money(portfolio.cashDollars + proceeds);
    portfolio.positions = portfolio.positions.filter((item) => item.id !== position.id);
    recordDecision(portfolio, { action: "SELL", symbol: position.symbol, outcome: "filled", reason, requestedDollars: proceeds, sourceType: position.sourceType, sourceId, traderName, strategy: exitKind, observedVersion: record?.lastUpdated || copyExit?.currentPriceObservedAt || sourceFingerprint }, at);
  }

  portfolio = summarizePortfolio(portfolio);
  const dayPnl = money(portfolio.equityDollars - portfolio.day.startingEquityDollars);
  const lossLimit = money(portfolio.initialCashDollars * guardrails.dailyLossLimitPct);
  const dailyLossLocked = dayPnl <= -lossLimit && lossLimit > 0;
  const sourceSeen = new Set(portfolio.processedSourceFingerprints);
  const entries = [];
  if (!snapshot.mirror?.stale) {
    for (const candidate of mirrorCandidates) {
      if (candidate.assetType !== "equity" || candidate.side !== "BUY" || candidate.status !== "paper_ready") continue;
      const normalizedSymbol = symbol(candidate.symbol);
      const sourceFingerprint = candidate.fingerprint || stableFingerprint({ type: "copy", id: candidate.id, disclosedAt: candidate.disclosedAt });
      entries.push({
        kind: "copy_entry",
        symbol: normalizedSymbol,
        price: finiteNumber(candidate.currentPrice, prices.get(normalizedSymbol) || 0),
        requestedDollars: finiteNumber(candidate.mirrorNotionalDollars, 0),
        sourceType: "copy_signal",
        sourceId: candidate.id || sourceFingerprint,
        sourceFingerprint,
        traderName: candidate.traderName || "Public source",
        score: finiteNumber(candidate.rankingScore, 0) * 100,
        observedVersion: candidate.currentPriceObservedAt || snapshot.mirror?.generatedAt || candidate.fingerprint,
      });
    }
  }
  for (const record of snapshot.records || []) {
    if (record.status !== "valid_setup" || !record.dataFresh || finiteNumber(record.score, 0) < guardrails.minEntryScore) continue;
    const normalizedSymbol = symbol(record.ticker || record.symbol);
    const sourceFingerprint = stableFingerprint({ type: "evaluator", id: record.id || normalizedSymbol, updatedAt: record.lastUpdated, decision: record.decision });
    entries.push({
      kind: "native_entry",
      symbol: normalizedSymbol,
      price: finiteNumber(record.currentPrice, prices.get(normalizedSymbol) || 0),
      requestedDollars: guardrails.maxOrderDollars,
      sourceType: "evaluator",
      sourceId: record.id || normalizedSymbol,
      sourceFingerprint,
      traderName: "",
      score: finiteNumber(record.score, 0),
      stopLoss: finiteNumber(record.stopLoss, 0),
      target1: finiteNumber(record.target1, 0),
      observedVersion: record.lastUpdated || record.decision,
    });
  }
  entries.sort((a, b) => (a.kind === "copy_entry" ? -1 : 1) - (b.kind === "copy_entry" ? -1 : 1) || b.score - a.score);

  for (const entry of entries) {
    let outcome = "";
    let reason = "";
    const existing = portfolio.positions.find((item) => item.symbol === entry.symbol);
    if (!entry.symbol || !(entry.price > 0)) {
      outcome = "invalid_price";
      reason = "No valid post-signal paper price is available.";
    } else if (existing) {
      outcome = "already_open";
      reason = "A paper position is already open; pyramiding is disabled.";
    } else if (sourceSeen.has(entry.sourceFingerprint)) {
      outcome = "blocked";
      reason = "This exact source signal was already used by the paper portfolio.";
    } else if (dailyLossLocked) {
      outcome = "blocked";
      reason = `Paper daily-loss lock reached ${money(lossLimit).toFixed(2)}.`;
    } else if (portfolio.day.fills >= guardrails.maxTradesPerDay) {
      outcome = "blocked";
      reason = `Paper daily trade limit of ${guardrails.maxTradesPerDay} is reached.`;
    } else if (portfolio.positions.length >= guardrails.maxPositions) {
      outcome = "blocked";
      reason = `Paper maximum of ${guardrails.maxPositions} positions is reached.`;
    }

    const deployed = money(portfolio.positions.reduce((sum, item) => sum + item.marketValueDollars, 0));
    const perSymbolCap = money(guardrails.maxTotalDollars / Math.max(1, guardrails.maxPositions));
    let requested = Math.min(entry.requestedDollars, guardrails.maxOrderDollars, perSymbolCap);
    if (entry.stopLoss > 0 && entry.stopLoss < entry.price) {
      const stopDistancePct = (entry.price - entry.stopLoss) / entry.price;
      requested = Math.min(requested, (portfolio.initialCashDollars * guardrails.riskPerTradePct) / stopDistancePct);
    }
    const availableByCash = Math.max(0, portfolio.cashDollars - guardrails.cashReserveDollars);
    const availableByDeployment = Math.max(0, guardrails.maxTotalDollars - deployed);
    requested = money(Math.min(requested, availableByCash, availableByDeployment));
    if (!outcome && requested < guardrails.minOrderDollars) {
      outcome = "blocked";
      reason = `Only ${requested.toFixed(2)} paper dollars remain after limits; minimum is ${guardrails.minOrderDollars.toFixed(2)}.`;
    }

    if (outcome) {
      recordDecision(portfolio, { action: "BUY", symbol: entry.symbol, outcome, reason, requestedDollars: requested, sourceType: entry.sourceType, sourceId: entry.sourceId, traderName: entry.traderName, strategy: entry.kind, observedVersion: entry.observedVersion }, at);
      continue;
    }

    const shares = quantity(requested / entry.price);
    const actualNotional = money(shares * entry.price);
    if (shares <= 0 || actualNotional <= 0 || actualNotional > portfolio.cashDollars) {
      recordDecision(portfolio, { action: "BUY", symbol: entry.symbol, outcome: "blocked", reason: "Paper share rounding could not produce a cash-covered order.", requestedDollars: requested, sourceType: entry.sourceType, sourceId: entry.sourceId, traderName: entry.traderName, strategy: entry.kind, observedVersion: entry.observedVersion }, at);
      continue;
    }
    const positionId = `paper-position-${stableFingerprint({ symbol: entry.symbol, sourceFingerprint: entry.sourceFingerprint, at: at.toISOString() }).slice(0, 24)}`;
    portfolio.cashDollars = money(portfolio.cashDollars - actualNotional);
    portfolio.positions.push(normalizePosition({
      id: positionId,
      symbol: entry.symbol,
      quantity: shares,
      avgEntryPrice: entry.price,
      currentPrice: entry.price,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      sourceFingerprint: entry.sourceFingerprint,
      traderName: entry.traderName,
      entryKind: entry.kind,
      stopLoss: entry.stopLoss,
      target1: entry.target1,
      openedAt: at.toISOString(),
      lastMarkedAt: at.toISOString(),
    }));
    makeFill(portfolio, {
      side: "BUY",
      symbol: entry.symbol,
      quantity: shares,
      price: entry.price,
      notionalDollars: actualNotional,
      realizedPnlDollars: 0,
      reason: entry.kind === "copy_entry" ? `${entry.traderName} paper-ready copy signal.` : `Evaluator score ${entry.score.toFixed(1)} passed paper entry rules.`,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      traderName: entry.traderName,
      strategy: entry.kind,
      sourceFingerprint: entry.sourceFingerprint,
      positionId,
    }, at);
    sourceSeen.add(entry.sourceFingerprint);
    portfolio.processedSourceFingerprints.push(entry.sourceFingerprint);
    recordDecision(portfolio, { action: "BUY", symbol: entry.symbol, outcome: "filled", reason: "Simulated fill only; no broker call was made.", requestedDollars: actualNotional, sourceType: entry.sourceType, sourceId: entry.sourceId, traderName: entry.traderName, strategy: entry.kind, observedVersion: entry.observedVersion }, at);
  }

  portfolio.processedSourceFingerprints = [...new Set(portfolio.processedSourceFingerprints)].slice(-MAX_PROCESSED_SOURCES);
  portfolio.lastCycleAt = at.toISOString();
  portfolio.updatedAt = at.toISOString();
  portfolio.cycleCount += 1;
  return applyRiskMetadata(portfolio, snapshot);
}

module.exports = {
  MODE,
  learningFromFills,
  normalizeShadowPortfolio,
  resetShadowPortfolio,
  runShadowPortfolioCycle,
};

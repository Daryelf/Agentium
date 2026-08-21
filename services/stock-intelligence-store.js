const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { databasePath, initializeLocalDatabase } = require("./local-database");
const { marketSession } = require("./stock-market-workers");
const { scoreOpportunity } = require("./stock-opportunity-scoring");
const { calculatePerformance } = require("./stock-performance-analytics");
const { STOCK_STRATEGY_CONFIG } = require("./stock-strategy-config");

const OPPORTUNITY_LIMIT = 120;
const EVENT_LIMIT = 200;
const SIGNAL_JOURNAL_MIN_INTERVAL_MS = 5 * 60_000;
const RESEARCH_SNAPSHOT_BUCKET_MS = 30 * 60_000;
const RESEARCH_SNAPSHOT_HISTORY_PER_SYMBOL = 6;
const BLOCKED_SIGNAL_HISTORY_PER_SYMBOL = 6;
const RESEARCH_HISTORY_RETENTION_INTERVAL_MS = 6 * 60 * 60_000;
const SIGNAL_OUTCOME_LOOKBACK_MS = 6 * 24 * 60 * 60_000;
const SIGNAL_OUTCOME_BATCH_PER_HORIZON = 500;
const PORTFOLIO_SNAPSHOT_BUCKET_MS = 60_000;
const SIGNAL_OUTCOME_HORIZONS = Object.freeze([
  ["5m", 5 * 60_000],
  ["15m", 15 * 60_000],
  ["30m", 30 * 60_000],
  ["1h", 60 * 60_000],
  ["end_of_day", 390 * 60_000],
  ["1d", 24 * 60 * 60_000],
  ["5d", 5 * 24 * 60 * 60_000],
]);

function clamp(value, minimum = 0, maximum = 100) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : null;
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function money(value, fallback = null) {
  const number = finiteNumber(value, fallback);
  return number === null ? null : Math.round(number * 100) / 100;
}

function safeDate(value, fallback = null) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function shortText(value, maximum = 500) {
  return String(value || "").trim().slice(0, maximum);
}

function parseJson(value, fallback = {}) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function timeBucket(value, durationMs = RESEARCH_SNAPSHOT_BUCKET_MS) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return "unknown";
  return new Date(Math.floor(timestamp / durationMs) * durationMs).toISOString();
}

function mirrorTimeliness(source = {}, candidate = {}, receivedAt = new Date().toISOString()) {
  const sourceType = String(source.sourceType || source.type || candidate.sourceType || "public_signal").toLowerCase();
  const sourceId = String(source.id || candidate.sourceId || "").toLowerCase();
  const structurallyDelayed = /13f|congress|periodic/.test(`${sourceId} ${sourceType}`);
  const disclosedAt = safeDate(candidate.disclosedAt);
  const transactionAt = safeDate(candidate.transactionAt);
  const disclosureDelaySeconds = Number.isFinite(Number(candidate.disclosureLagHours))
    ? Math.max(0, Math.round(Number(candidate.disclosureLagHours) * 3600))
    : disclosedAt && transactionAt ? Math.max(0, Math.round((Date.parse(disclosedAt) - Date.parse(transactionAt)) / 1000)) : null;
  const ageSeconds = disclosedAt ? Math.max(0, Math.round((Date.parse(receivedAt) - Date.parse(disclosedAt)) / 1000)) : null;
  let state = "UNKNOWN";
  if (structurallyDelayed) state = "DELAYED_DISCLOSURE";
  else if (ageSeconds !== null && ageSeconds > 96 * 3600) state = "STALE";
  else if (disclosedAt) state = "CURRENT_DISCLOSURE";
  const executionEligible = !structurallyDelayed && state === "CURRENT_DISCLOSURE" && candidate.status === "paper_ready" && candidate.humanGateEligible === true;
  return {
    state,
    structurallyDelayed,
    disclosureDelaySeconds,
    ageSeconds,
    executionEligible,
    legalUse: structurallyDelayed ? "research_context_only" : "public_disclosure_research_and_guarded_proposal_input",
    limitation: structurallyDelayed
      ? "The disclosure can arrive weeks after the transaction and cannot represent a current entry."
      : "The public disclosure does not reveal the trader's complete portfolio, hedges, exits, taxes, or exact executable price.",
  };
}

function easternDay(value = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value).filter((item) => item.type !== "literal").map((item) => [item.type, item.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function reportWindow(value = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value).filter((item) => item.type !== "literal").map((item) => [item.type, item.value]));
  const minutes = Number(parts.hour || 0) * 60 + Number(parts.minute || 0);
  const session = marketSession(value);
  const weekday = !["Sat", "Sun"].includes(parts.weekday);
  return {
    overnight: minutes >= 60 && minutes < 4 * 60,
    morning: weekday && minutes >= 8 * 60 && minutes < 9 * 60 + 30,
    marketClose: Number.isFinite(Number(session.regularCloseMinute)) && minutes >= Number(session.regularCloseMinute),
  };
}

function parseRiskReward(value) {
  const match = String(value || "").match(/(?:1\s*:\s*)?([0-9]+(?:\.[0-9]+)?)/);
  return match ? clamp(Number(match[1]), 0, 10) : null;
}

function dataQualityScore(record = {}) {
  if (Number.isFinite(Number(record.dataQualityScore))) return clamp(Number(record.dataQualityScore));
  const confidence = String(record.confidence || "").toLowerCase();
  let score = confidence === "high" ? 90 : confidence === "medium" ? 72 : confidence === "low" ? 48 : 55;
  if (record.dataFresh === true) score += 10;
  if (record.dataFresh === false) score -= 35;
  if (record.spreadPassed === true) score += 5;
  if (record.liquidityPassed === true) score += 5;
  return clamp(score);
}

function riskQualityScore(record = {}) {
  const current = Number(record.currentPrice);
  const stop = Number(record.stopLoss);
  const reward = parseRiskReward(record.riskReward);
  if (!Number.isFinite(current) || current <= 0 || !Number.isFinite(stop) || stop <= 0 || reward === null) return null;
  const downsidePct = Math.abs(current - stop) / current;
  return clamp(48 + reward * 18 - downsidePct * 180);
}

function matchingMirrorCandidate(record = {}, mirror = {}) {
  const symbol = String(record.ticker || "").toUpperCase();
  return (Array.isArray(mirror.candidates) ? mirror.candidates : [])
    .filter((candidate) => String(candidate.symbol || "").toUpperCase() === symbol)
    .sort((a, b) => Number(b.evidenceScore || 0) - Number(a.evidenceScore || 0))[0] || null;
}

function momentumVolumeScore(record = {}) {
  if (Number.isFinite(Number(record.momentumVolumeScore))) return clamp(record.momentumVolumeScore);
  const hasTrend = typeof record.trendConfirmation === "boolean";
  const hasVolume = typeof record.volumeConfirmation === "boolean";
  if (!hasTrend && !hasVolume) return null;
  let score = 40;
  if (record.trendConfirmation === true) score += 30;
  if (record.volumeConfirmation === true) score += 30;
  return clamp(score);
}

function liquidityExecutionScore(record = {}, marketContext = null) {
  if (Number.isFinite(Number(record.liquidityScore))) return clamp(record.liquidityScore);
  if (typeof record.liquidityPassed !== "boolean" && typeof record.spreadPassed !== "boolean") return null;
  let score = 30;
  if (record.liquidityPassed === true) score += 35;
  if (record.spreadPassed === true) score += 35;
  if (Number.isFinite(Number(marketContext?.spreadPct)) && Number(marketContext.spreadPct) > 0.01) score -= 20;
  return clamp(score);
}

function weightedScore(inputs) {
  const definitions = [
    ["technical", inputs.technical, 0.4],
    ["risk", inputs.risk, 0.2],
    ["data_quality", inputs.dataQuality, 0.15],
    ["mirror", inputs.mirror, 0.1],
    ["catalyst", inputs.catalyst, 0.05],
    ["market_context", inputs.marketContext, 0.1],
  ];
  const available = definitions.filter(([, value]) => value !== null && value !== undefined && Number.isFinite(Number(value)));
  const totalWeight = available.reduce((sum, [, , weight]) => sum + weight, 0);
  if (!totalWeight) return { score: 0, components: [] };
  return {
    score: Math.round(available.reduce((sum, [, value, weight]) => sum + Number(value) * weight, 0) / totalWeight),
    components: available.map(([name, value, weight]) => ({ name, value: Math.round(Number(value)), weight: weight / totalWeight })),
  };
}

function opportunityFromRecord(record = {}, mirror = {}, at = new Date(), research = {}, intraday = {}, market = {}) {
  const symbol = String(record.ticker || "").toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
  if (!symbol) return null;
  const mirrorCandidate = matchingMirrorCandidate(record, mirror);
  const researchItem = (Array.isArray(research.tickers) ? research.tickers : []).find((item) => String(item.ticker || "").toUpperCase() === symbol) || null;
  const marketContext = intraday?.bySymbol?.[symbol] || (Array.isArray(intraday?.symbols) ? intraday.symbols.find((item) => String(item.symbol || "").toUpperCase() === symbol) : null) || null;
  const relativeStrength = market?.symbols?.[symbol] || null;
  const technical = clamp(record.score);
  const risk = riskQualityScore(record);
  const dataQuality = dataQualityScore(record);
  const mirrorScore = mirrorCandidate && Number.isFinite(Number(mirrorCandidate.evidenceScore))
    ? clamp(Number(mirrorCandidate.evidenceScore) <= 1 ? Number(mirrorCandidate.evidenceScore) * 100 : Number(mirrorCandidate.evidenceScore))
    : null;
  const catalyst = research.directionalNewsScoring === true && Number.isFinite(Number(researchItem?.catalystScore))
    ? clamp(Number(researchItem.catalystScore))
    : null;
  const riskStateScore = market?.riskState === "RISK_ON" ? 85 : market?.riskState === "RISK_OFF" ? 20 : market?.riskState === "NEUTRAL" ? 55 : null;
  const relativeScore = Number.isFinite(Number(relativeStrength?.score)) ? clamp(Number(relativeStrength.score)) : null;
  const sectorEtf = relativeStrength?.sectorEtf || relativeStrength?.sector_etf || null;
  const sectorContext = (Array.isArray(market?.sectors) ? market.sectors : []).find((item) => String(item.symbol || "") === String(sectorEtf || "")) || null;
  const sectorScore = Number.isFinite(Number(sectorContext?.score)) ? clamp(Number(sectorContext.score)) : null;
  const marketContextScore = riskStateScore !== null && sectorScore !== null ? Math.round((riskStateScore + sectorScore) / 2) : riskStateScore ?? sectorScore;
  const contextUsable = !marketContext || (marketContext.usable === true && marketContext.stale !== true);
  const regimeEligible = !market?.available || market.stale === true || market.riskState !== "RISK_OFF";
  const liquidity = liquidityExecutionScore(record, marketContext);
  const momentum = momentumVolumeScore(record);
  const fundamentals = Number.isFinite(Number(researchItem?.fundamentalScore)) ? clamp(Number(researchItem.fundamentalScore)) : null;
  const conflicts = [
    ...(Array.isArray(marketContext?.conflicts) ? marketContext.conflicts : []),
    ...(researchItem?.catalystSummary?.conflicts ? ["Catalyst evidence conflicts."] : []),
  ];
  const scoring = scoreOpportunity({
    direction: "LONG",
    technicalStructure: technical,
    momentumVolume: momentum,
    researchCatalyst: catalyst,
    marketSector: marketContextScore,
    relativeStrength: relativeScore,
    fundamentals,
    smartMoney: mirrorScore,
    liquidity,
    riskReward: risk,
    rewardRiskRatio: parseRiskReward(record.riskReward),
    dataQuality,
    providerState: record.dataHealthState || marketContext?.dataHealthState || "UNKNOWN",
    dataFresh: record.dataFresh,
    validSetup: record.status === "valid_setup",
    hardRejection: record.hardRejectionTriggered === true,
    currentPrice: record.currentPrice,
    liquidityPassed: record.liquidityPassed,
    spreadPassed: record.spreadPassed,
    intradayUsable: contextUsable,
    riskState: market?.available && market.stale !== true ? market.riskState : null,
    conflicts,
    technicalEvidence: [record.setupType, record.mainReasonValid],
    momentumEvidence: [record.trendConfirmation === true ? "Trend confirmed" : "Trend not confirmed", record.volumeConfirmation === true ? "Volume confirmed" : "Volume not confirmed"],
    catalystEvidence: researchItem?.catalystSummary?.topFactors || [],
    marketEvidence: [market?.regime, sectorContext?.state],
    relativeStrengthEvidence: [relativeStrength?.state],
    fundamentalEvidence: researchItem?.fundamentalEvidence || [],
    smartMoneyEvidence: mirrorCandidate ? [`${mirrorCandidate.sourceName || mirrorCandidate.traderName || mirrorCandidate.sourceId} ${mirrorCandidate.side || "signal"}`] : [],
    liquidityEvidence: [record.liquidityPassed === true ? "Liquidity check passed" : "Liquidity check failed", record.spreadPassed === true ? "Spread check passed" : "Spread check failed"],
    riskEvidence: [record.riskReward, record.invalidationRule],
  });
  const status = !scoring.eligible
    ? record.status === "rejected" ? "rejected" : "monitoring"
    : scoring.state === "ACTIONABLE" ? "high_priority" : scoring.state === "WATCH" ? "candidate" : "monitoring";
  const confidence = scoring.confidence.label;
  const observedAt = safeDate(record.sourceUpdatedAt || record.observedAt, at.toISOString());
  const nextReviewAt = new Date(at.getTime() + (marketSession(at).regular ? 5 : 60) * 60_000).toISOString();
  const thesis = {
    setup: shortText(record.setupType || record.decision, 120),
    reason: shortText(record.mainReasonValid || record.mainReason || "", 400),
    risk: shortText(record.mainRisk || record.rejectionReason || "", 400),
    invalidation: shortText(record.invalidationRule || "", 400),
    entryZone: shortText(record.entryZone || "", 120),
    currentPrice: Number.isFinite(Number(record.currentPrice)) ? Number(record.currentPrice) : null,
    stopLoss: Number.isFinite(Number(record.stopLoss)) ? Number(record.stopLoss) : null,
    target1: Number.isFinite(Number(record.target1)) ? Number(record.target1) : null,
    target2: Number.isFinite(Number(record.target2)) ? Number(record.target2) : null,
  };
  return {
    id: `stock-opportunity-${symbol}`,
    symbol,
    status,
    direction: scoring.direction,
    state: scoring.state,
    overallScore: scoring.opportunityScore,
    aiScore: scoring.opportunityScore,
    technicalScore: technical,
    mirrorScore,
    catalystScore: catalyst,
    riskScore: risk,
    dataQualityScore: dataQuality,
    confidence,
    confidenceScore: scoring.confidence.score,
    evidenceCompleteness: scoring.confidence.completeness,
    hardGates: scoring.gates,
    blockers: scoring.blockers,
    source: "stock_guru_evaluator",
    observedAt,
    nextReviewAt,
    thesis,
    thesisHash: fingerprint(thesis),
    scoreFormula: {
      version: scoring.version,
      description: "Versioned modular opportunity score. Missing inputs remain unavailable, lower evidence completeness, and are never fabricated. Confidence is calculated separately.",
      rawScore: scoring.rawScore,
      opportunityScore: scoring.opportunityScore,
      confidence: scoring.confidence,
      components: scoring.components,
      gates: scoring.gates,
      configuration: scoring.configuration,
    },
    mirror: mirrorCandidate ? {
      sourceId: shortText(mirrorCandidate.sourceId, 120),
      sourceName: shortText(mirrorCandidate.sourceName, 160),
      traderName: shortText(mirrorCandidate.traderName, 160),
      side: shortText(mirrorCandidate.side, 8),
      disclosedAt: safeDate(mirrorCandidate.disclosedAt),
      sourceUrl: shortText(mirrorCandidate.sourceUrl, 1000),
      delaySeconds: Number.isFinite(Number(mirrorCandidate.disclosureLagHours)) ? Math.round(Number(mirrorCandidate.disclosureLagHours) * 3600) : null,
    } : null,
    company: researchItem ? {
      name: shortText(researchItem.companyName, 180),
      sector: shortText(researchItem.sector, 100),
      marketCap: Number.isFinite(Number(researchItem.marketCap)) ? Number(researchItem.marketCap) : null,
      recommendation: shortText(researchItem.recommendation, 60),
      source: shortText(research.source, 180),
      generatedAt: safeDate(research.generatedAt),
      catalystScore: catalyst,
      catalystConfidence: Number.isFinite(Number(researchItem.catalystConfidence)) ? clamp(Number(researchItem.catalystConfidence), 0, 1) : 0,
      catalystSummary: researchItem.catalystSummary || null,
    } : null,
    marketContext: marketContext ? {
      generatedAt: safeDate(marketContext.generatedAt),
      sourceProvider: shortText(marketContext.sourceProvider, 80),
      sourceTimestamp: safeDate(marketContext.sourceTimestamp),
      dataHealthState: shortText(marketContext.dataHealthState, 40),
      dataQualityScore: Number.isFinite(Number(marketContext.dataQualityScore)) ? clamp(Number(marketContext.dataQualityScore)) : null,
      usable: marketContext.usable === true,
      lastPrice: Number.isFinite(Number(marketContext.lastPrice)) ? Number(marketContext.lastPrice) : null,
      spreadPct: Number.isFinite(Number(marketContext.spreadPct)) ? Number(marketContext.spreadPct) : null,
      sessionVwap: Number.isFinite(Number(marketContext.sessionVwap)) ? Number(marketContext.sessionVwap) : null,
      relativeVolume: Number.isFinite(Number(marketContext.relativeVolume)) ? Number(marketContext.relativeVolume) : null,
      alignment: shortText(marketContext.alignment, 24),
      conflicts: (Array.isArray(marketContext.conflicts) ? marketContext.conflicts : []).map((item) => shortText(item, 220)).filter(Boolean).slice(0, 10),
      timeframes: marketContext.timeframes || {},
    } : null,
    regimeContext: market?.available ? {
      generatedAt: safeDate(market.generatedAt),
      sourceProvider: shortText(market.sourceProvider, 80),
      sourceTimestamp: safeDate(market.sourceTimestamp),
      dataHealthState: shortText(market.dataHealthState, 40),
      dataQualityScore: Number.isFinite(Number(market.dataQualityScore)) ? clamp(Number(market.dataQualityScore)) : null,
      regime: shortText(market.regime, 80),
      trendRegime: shortText(market.trendRegime, 24),
      volatilityRegime: shortText(market.volatilityRegime, 24),
      breadthState: shortText(market.breadthState, 24),
      riskState: shortText(market.riskState, 24),
      score: marketContextScore,
      relativeStrength,
      blockers: (Array.isArray(market.blockers) ? market.blockers : []).map((item) => shortText(item, 220)).filter(Boolean).slice(0, 10),
    } : null,
    news: researchItem ? (Array.isArray(researchItem.news) ? researchItem.news : []).slice(0, 8).map((item) => ({
      title: shortText(item.title, 300),
      publisher: shortText(item.publisher, 120),
      publishedAt: safeDate(item.publishedAt),
      url: shortText(item.url, 1000),
      direction: String(item.catalyst?.direction || "NEUTRAL").toLowerCase() === "positive" ? "supporting" : String(item.catalyst?.direction || "NEUTRAL").toLowerCase() === "negative" ? "conflicting" : "context",
      catalyst: item.catalyst || null,
    })).filter((item) => item.title) : [],
    raw: record,
  };
}

function rowOpportunity(row) {
  const data = parseJson(row.dataJson, {});
  return {
    ...data,
    id: row.id,
    symbol: row.symbol,
    status: row.status,
    overallScore: row.overallScore,
    aiScore: row.aiScore,
    technicalScore: row.technicalScore,
    mirrorScore: row.mirrorScore,
    catalystScore: row.catalystScore,
    riskScore: row.riskScore,
    confidence: row.confidence,
    rank: row.rank,
    firstSeenAt: row.firstSeenAt,
    lastUpdatedAt: row.lastUpdatedAt,
    lastResearchedAt: row.lastResearchedAt,
    nextReviewAt: row.nextReviewAt,
    proposalId: row.proposalId || null,
  };
}

function createStockIntelligenceStore(options = {}) {
  const dataDir = options.dataDir;
  if (!dataDir) throw new Error("Stock intelligence store requires dataDir.");
  const nowFn = options.now || (() => new Date());
  let lastResearchHistoryRetentionAt = 0;
  initializeLocalDatabase(dataDir);

  function open() {
    const db = new DatabaseSync(databasePath(dataDir));
    db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
    return db;
  }

  function recordSystemEvent(event = {}) {
    const db = open();
    try {
      const createdAt = safeDate(event.createdAt, nowFn().toISOString());
      const id = shortText(event.id || `stock-event-${crypto.randomUUID()}`, 160);
      db.prepare(`INSERT OR IGNORE INTO stock_system_events
        (id, correlation_id, event_type, actor_type, actor_id, symbol, proposal_id, order_id, old_state, new_state, decision, reason, error, created_at, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id,
        shortText(event.correlationId || id, 160),
        shortText(event.type || "system.event", 120),
        shortText(event.actorType || "SYSTEM", 20).toUpperCase(),
        shortText(event.actorId, 160) || null,
        shortText(event.symbol, 12) || null,
        shortText(event.proposalId, 160) || null,
        shortText(event.orderId, 160) || null,
        shortText(event.oldState, 120) || null,
        shortText(event.newState, 120) || null,
        shortText(event.decision, 120) || null,
        shortText(event.reason, 1000) || null,
        shortText(event.error, 1000) || null,
        createdAt,
        JSON.stringify(event.data || {}),
      );
      return { id, createdAt };
    } finally {
      db.close();
    }
  }

  function captureDueSignalOutcomes(records = [], observedAt = nowFn().toISOString()) {
    const at = safeDate(observedAt, nowFn().toISOString());
    const current = new Map((Array.isArray(records) ? records : []).map((record) => [
      String(record.ticker || record.symbol || "").toUpperCase(),
      {
        price: Number(record.currentPrice),
        provider: shortText(record.dataProvider || "UNKNOWN", 80),
        sourceTimestamp: safeDate(record.dataSourceTimestamp || record.sourceUpdatedAt),
        health: shortText(record.dataHealthState || "UNKNOWN", 40),
      },
    ]).filter(([symbol, item]) => symbol && Number.isFinite(item.price) && item.price > 0));
    if (!current.size) return { observations: 0, outcomes: 0 };
    const db = open();
    let observations = 0;
    let outcomes = 0;
    try {
      const symbols = [...current.keys()];
      const symbolPlaceholders = symbols.map(() => "?").join(", ");
      const cutoff = new Date(Date.parse(at) - SIGNAL_OUTCOME_LOOKBACK_MS).toISOString();
      const dueSignals = new Map();
      for (const [horizon, durationMs] of SIGNAL_OUTCOME_HORIZONS) {
        const dueBefore = new Date(Date.parse(at) - durationMs).toISOString();
        const candidates = db.prepare(`SELECT signals.id, signals.symbol, signals.direction,
          signals.reference_price AS referencePrice, signals.stop_price AS stopPrice,
          signals.target_1 AS target1, signals.target_2 AS target2, signals.observed_at AS observedAt
          FROM stock_signal_journal AS signals
          WHERE signals.observed_at >= ? AND signals.observed_at <= ?
            AND signals.symbol IN (${symbolPlaceholders})
            AND NOT EXISTS (
              SELECT 1 FROM stock_signal_outcomes AS outcomes
              WHERE outcomes.signal_id = signals.id AND outcomes.horizon = ?
            )
          ORDER BY signals.observed_at ASC
          LIMIT ?`).all(cutoff, dueBefore, ...symbols, horizon, SIGNAL_OUTCOME_BATCH_PER_HORIZON);
        candidates.forEach((signal) => {
          const queued = dueSignals.get(signal.id) || { ...signal, dueHorizons: [] };
          queued.dueHorizons.push([horizon, durationMs]);
          dueSignals.set(signal.id, queued);
        });
      }
      if (!dueSignals.size) return { observations: 0, outcomes: 0 };

      db.exec("BEGIN IMMEDIATE");
      const insertObservation = db.prepare(`INSERT OR IGNORE INTO stock_signal_price_observations
        (id, signal_id, symbol, observed_at, price, provider, source_timestamp, provenance, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const observationsForSignal = db.prepare("SELECT price, observed_at AS observedAt FROM stock_signal_price_observations WHERE signal_id = ? ORDER BY observed_at ASC");
      const insertOutcome = db.prepare(`INSERT OR IGNORE INTO stock_signal_outcomes
        (id, signal_id, horizon, due_at, observed_at, reference_price, outcome_price, return_pct,
         maximum_favorable_excursion_pct, maximum_adverse_excursion_pct, entry_triggered, stop_triggered,
         target_1_triggered, target_2_triggered, provenance, locked_at, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const signal of dueSignals.values()) {
        const quote = current.get(signal.symbol);
        if (!quote) continue;
        const observationId = `stock-signal-observation-${fingerprint(`${signal.id}:${at}:market_snapshot`).slice(0, 32)}`;
        const observationResult = insertObservation.run(
          observationId, signal.id, signal.symbol, at, quote.price, quote.provider,
          quote.sourceTimestamp, "market_snapshot", JSON.stringify({ dataHealthState: quote.health }),
        );
        observations += Number(observationResult.changes || 0);
        const history = observationsForSignal.all(signal.id).map((item) => Number(item.price)).filter((price) => Number.isFinite(price) && price > 0);
        if (!history.length || !Number.isFinite(Number(signal.referencePrice)) || Number(signal.referencePrice) <= 0) continue;
        const reference = Number(signal.referencePrice);
        const returns = history.map((price) => (price - reference) / reference);
        const favorable = signal.direction === "SHORT" ? -Math.min(...returns) : Math.max(...returns);
        const adverse = signal.direction === "SHORT" ? -Math.max(...returns) : Math.min(...returns);
        for (const [horizon, durationMs] of signal.dueHorizons) {
          const dueAt = new Date(Date.parse(signal.observedAt) + durationMs).toISOString();
          const returnPct = signal.direction === "SHORT" ? (reference - quote.price) / reference : (quote.price - reference) / reference;
          const low = Math.min(reference, ...history);
          const high = Math.max(reference, ...history);
          const outcomeResult = insertOutcome.run(
            `stock-signal-outcome-${fingerprint(`${signal.id}:${horizon}`).slice(0, 32)}`,
            signal.id, horizon, dueAt, at, reference, quote.price, returnPct, favorable, adverse,
            1,
            Number.isFinite(Number(signal.stopPrice)) ? (signal.direction === "SHORT" ? high >= Number(signal.stopPrice) : low <= Number(signal.stopPrice)) ? 1 : 0 : null,
            Number.isFinite(Number(signal.target1)) ? (signal.direction === "SHORT" ? low <= Number(signal.target1) : high >= Number(signal.target1)) ? 1 : 0 : null,
            Number.isFinite(Number(signal.target2)) ? (signal.direction === "SHORT" ? low <= Number(signal.target2) : high >= Number(signal.target2)) ? 1 : 0 : null,
            "market_snapshot", at, JSON.stringify({ provider: quote.provider, sourceTimestamp: quote.sourceTimestamp, dataHealthState: quote.health, immutable: true }),
          );
          outcomes += Number(outcomeResult.changes || 0);
        }
      }
      db.exec("COMMIT");
      return { observations, outcomes };
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    } finally {
      db.close();
    }
  }

  function signalJournal(limit = 100) {
    const db = open();
    try {
      const boundedLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
      const rows = db.prepare(`SELECT id, run_id AS runId, opportunity_id AS opportunityId, strategy_version AS strategyVersion,
        symbol, direction, state, opportunity_score AS opportunityScore, confidence_score AS confidenceScore,
        market_regime AS marketRegime, sector_state AS sectorState, reference_price AS referencePrice,
        stop_price AS stopPrice, target_1 AS target1, target_2 AS target2, observed_at AS observedAt,
        created_at AS createdAt, snapshot_hash AS snapshotHash, data_json AS dataJson
        FROM stock_signal_journal ORDER BY observed_at DESC LIMIT ?`).all(boundedLimit);
      if (!rows.length) return [];
      const outcomeRows = db.prepare(`SELECT outcomes.signal_id AS signalId, outcomes.horizon,
        outcomes.due_at AS dueAt, outcomes.observed_at AS observedAt, outcomes.outcome_price AS outcomePrice,
        return_pct AS returnPct, maximum_favorable_excursion_pct AS maximumFavorableExcursionPct,
        maximum_adverse_excursion_pct AS maximumAdverseExcursionPct, entry_triggered AS entryTriggered,
        stop_triggered AS stopTriggered, target_1_triggered AS target1Triggered, target_2_triggered AS target2Triggered,
        provenance, locked_at AS lockedAt
        FROM stock_signal_outcomes AS outcomes
        INNER JOIN (
          SELECT id FROM stock_signal_journal ORDER BY observed_at DESC LIMIT ?
        ) AS selected_signals ON selected_signals.id = outcomes.signal_id
        ORDER BY outcomes.signal_id, outcomes.due_at ASC`).all(boundedLimit);
      const outcomesBySignal = new Map();
      outcomeRows.forEach((item) => {
        const { signalId, ...outcome } = item;
        const normalized = {
          ...outcome,
          entryTriggered: item.entryTriggered === null ? null : Boolean(item.entryTriggered),
          stopTriggered: item.stopTriggered === null ? null : Boolean(item.stopTriggered),
          target1Triggered: item.target1Triggered === null ? null : Boolean(item.target1Triggered),
          target2Triggered: item.target2Triggered === null ? null : Boolean(item.target2Triggered),
        };
        if (!outcomesBySignal.has(signalId)) outcomesBySignal.set(signalId, []);
        outcomesBySignal.get(signalId).push(normalized);
      });
      return rows.map((row) => ({
        ...row,
        data: parseJson(row.dataJson, {}),
        dataJson: undefined,
        outcomes: outcomesBySignal.get(row.id) || [],
      }));
    } finally {
      db.close();
    }
  }

  function latestSignalForSymbol(symbol) {
    const normalized = shortText(symbol, 12).toUpperCase();
    if (!normalized) return null;
    const db = open();
    try {
      const row = db.prepare(`SELECT id, run_id AS runId, opportunity_id AS opportunityId, strategy_version AS strategyVersion,
        symbol, direction, state, opportunity_score AS opportunityScore, confidence_score AS confidenceScore,
        reference_price AS referencePrice, stop_price AS stopPrice, target_1 AS target1, target_2 AS target2,
        observed_at AS observedAt, snapshot_hash AS snapshotHash, data_json AS dataJson
        FROM stock_signal_journal WHERE symbol = ? ORDER BY observed_at DESC, created_at DESC LIMIT 1`).get(normalized);
      return row ? { ...row, data: parseJson(row.dataJson, {}), dataJson: undefined } : null;
    } finally {
      db.close();
    }
  }

  function recordTradeJournal(entry = {}) {
    if (!entry.brokerOrderId || !entry.symbol) return null;
    const at = safeDate(entry.updatedAt, nowFn().toISOString());
    const id = shortText(entry.id || `stock-trade-${fingerprint(entry.brokerOrderId).slice(0, 32)}`, 160);
    const db = open();
    try {
      db.prepare(`INSERT INTO stock_trade_journal
        (id, signal_id, proposal_id, approval_id, broker_order_id, strategy_version, symbol, side, status,
         quantity, entry_price, exit_price, fees, realized_pnl, unrealized_pnl, exit_reason, human_intervention,
         opened_at, closed_at, created_at, updated_at, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(broker_order_id) DO UPDATE SET status=excluded.status, quantity=COALESCE(excluded.quantity, stock_trade_journal.quantity),
        entry_price=COALESCE(excluded.entry_price, stock_trade_journal.entry_price), exit_price=COALESCE(excluded.exit_price, stock_trade_journal.exit_price),
        fees=COALESCE(excluded.fees, stock_trade_journal.fees), realized_pnl=COALESCE(excluded.realized_pnl, stock_trade_journal.realized_pnl),
        unrealized_pnl=COALESCE(excluded.unrealized_pnl, stock_trade_journal.unrealized_pnl), exit_reason=COALESCE(excluded.exit_reason, stock_trade_journal.exit_reason),
        human_intervention=COALESCE(excluded.human_intervention, stock_trade_journal.human_intervention), closed_at=COALESCE(excluded.closed_at, stock_trade_journal.closed_at),
        updated_at=excluded.updated_at, data_json=excluded.data_json`).run(
        id, shortText(entry.signalId, 160) || null, shortText(entry.proposalId, 160) || null, shortText(entry.approvalId, 160) || null,
        shortText(entry.brokerOrderId, 160), shortText(entry.strategyVersion || "unknown", 120), shortText(entry.symbol, 12), shortText(entry.side, 8),
        shortText(entry.status || "submitted", 40), Number.isFinite(Number(entry.quantity)) ? Number(entry.quantity) : null,
        Number.isFinite(Number(entry.entryPrice)) ? Number(entry.entryPrice) : null, Number.isFinite(Number(entry.exitPrice)) ? Number(entry.exitPrice) : null,
        Number.isFinite(Number(entry.fees)) ? Number(entry.fees) : null, Number.isFinite(Number(entry.realizedPnl)) ? Number(entry.realizedPnl) : null,
        Number.isFinite(Number(entry.unrealizedPnl)) ? Number(entry.unrealizedPnl) : null, shortText(entry.exitReason, 300) || null,
        shortText(entry.humanIntervention, 300) || null, safeDate(entry.openedAt), safeDate(entry.closedAt), safeDate(entry.createdAt, at), at, JSON.stringify(entry.data || {}),
      );
      return { id, brokerOrderId: entry.brokerOrderId, updatedAt: at };
    } finally {
      db.close();
    }
  }

  function registerActiveStrategy(db, activatedAt) {
    const configuration = {
      version: STOCK_STRATEGY_CONFIG.version,
      direction: STOCK_STRATEGY_CONFIG.direction,
      weights: { ...STOCK_STRATEGY_CONFIG.weights },
      thresholds: { ...STOCK_STRATEGY_CONFIG.thresholds },
    };
    const configurationHash = fingerprint(configuration);
    db.prepare(`INSERT OR IGNORE INTO stock_strategy_versions
      (version, status, configuration_hash, configuration_json, created_at, activated_at, notes)
      VALUES (?, 'active', ?, ?, ?, ?, ?)`).run(
      configuration.version,
      configurationHash,
      JSON.stringify(configuration),
      activatedAt,
      activatedAt,
      "Code-deployed baseline. Automatic parameter activation is disabled.",
    );
    return { version: configuration.version, configurationHash, configuration };
  }

  function strategyGovernance() {
    const db = open();
    try {
      const versions = db.prepare(`SELECT version, status, configuration_hash AS configurationHash,
        created_at AS createdAt, activated_at AS activatedAt, retired_at AS retiredAt,
        approval_id AS approvalId, notes, configuration_json AS configurationJson
        FROM stock_strategy_versions ORDER BY COALESCE(activated_at, created_at) DESC`).all();
      const proposals = db.prepare(`SELECT id, from_version AS fromVersion, proposed_version AS proposedVersion,
        status, rationale, created_at AS createdAt, decided_at AS decidedAt, approval_id AS approvalId,
        evidence_json AS evidenceJson, configuration_json AS configurationJson
        FROM stock_strategy_change_proposals ORDER BY created_at DESC LIMIT 50`).all();
      return {
        autoActivationAllowed: false,
        versions: versions.map((item) => ({ ...item, configuration: parseJson(item.configurationJson, {}), configurationJson: undefined })),
        proposals: proposals.map((item) => ({ ...item, evidence: parseJson(item.evidenceJson, {}), configuration: parseJson(item.configurationJson, {}), evidenceJson: undefined, configurationJson: undefined })),
      };
    } finally {
      db.close();
    }
  }

  function proposeStrategyChange(input = {}) {
    const proposedVersion = shortText(input.proposedVersion, 120);
    const rationale = shortText(input.rationale, 2000);
    const configuration = input.configuration && typeof input.configuration === "object" ? input.configuration : null;
    if (!proposedVersion || !rationale || !configuration) throw new Error("Strategy change proposals require a version, rationale, and configuration.");
    const at = nowFn().toISOString();
    const id = shortText(input.id || `stock-strategy-proposal-${crypto.randomUUID()}`, 160);
    const db = open();
    try {
      const active = db.prepare("SELECT version FROM stock_strategy_versions WHERE status = 'active' ORDER BY activated_at DESC LIMIT 1").get();
      if (!active?.version) throw new Error("No active strategy version is registered.");
      db.prepare(`INSERT INTO stock_strategy_change_proposals
        (id, from_version, proposed_version, status, rationale, evidence_json, configuration_json, created_at)
        VALUES (?, ?, ?, 'pending_review', ?, ?, ?, ?)`).run(
        id,
        active.version,
        proposedVersion,
        rationale,
        JSON.stringify(input.evidence || {}),
        JSON.stringify(configuration),
        at,
      );
      recordSystemEvent({
        id: `strategy.change_proposed:${id}`,
        type: "strategy.change_proposed",
        actorType: shortText(input.actorType || "SYSTEM", 20),
        actorId: shortText(input.actorId, 160),
        oldState: active.version,
        newState: proposedVersion,
        reason: rationale,
        data: { proposalId: id, autoActivationAllowed: false },
      });
      return { id, fromVersion: active.version, proposedVersion, status: "pending_review", autoActivated: false, createdAt: at };
    } finally {
      db.close();
    }
  }

  function portfolioSnapshotHistory(limit = 500) {
    const db = open();
    try {
      const rows = db.prepare(`SELECT id, observed_at AS observedAt, account_value AS accountValue,
        cash_value AS cashValue, invested_value AS investedValue, buying_power AS buyingPower,
        day_pnl AS dayPnl, realized_pnl AS realizedPnl, unrealized_pnl AS unrealizedPnl,
        goal_value AS goalValue, positions_json AS positionsJson
        FROM stock_portfolio_snapshots ORDER BY observed_at DESC LIMIT ?`).all(Math.max(1, Math.min(2000, Number(limit) || 500)));
      return rows.reverse().map((row) => ({
        ...row,
        positions: parseJson(row.positionsJson, []),
        positionsJson: undefined,
      }));
    } finally {
      db.close();
    }
  }

  function recordPortfolioSnapshot(input = {}) {
    const observedAt = safeDate(input.observedAt, nowFn().toISOString());
    const accountValue = money(input.accountValue);
    if (accountValue === null || accountValue <= 0) return null;
    const positions = (Array.isArray(input.positions) ? input.positions : []).map((position) => {
      const symbol = shortText(position?.symbol, 12).toUpperCase().replace(/[^A-Z0-9.^-]/g, "");
      const quantity = finiteNumber(position?.quantity ?? position?.sharesAvailableForSells, 0);
      const currentPrice = money(position?.currentPrice ?? position?.current_price);
      const averageBuyPrice = money(position?.averageBuyPrice ?? position?.average_buy_price);
      const marketValue = money(position?.marketValue ?? position?.market_value, currentPrice === null ? null : quantity * currentPrice);
      if (!symbol || quantity <= 0 || currentPrice === null) return null;
      return {
        symbol,
        quantity,
        currentPrice,
        averageBuyPrice,
        marketValue,
        unrealizedPnl: money(position?.unrealizedPnl ?? position?.unrealized_pnl, averageBuyPrice === null ? null : quantity * (currentPrice - averageBuyPrice)),
      };
    }).filter(Boolean);
    const investedValue = money(input.investedValue, positions.reduce((sum, position) => sum + (position.marketValue || 0), 0));
    const snapshot = {
      id: `stock-portfolio-${fingerprint(timeBucket(observedAt, PORTFOLIO_SNAPSHOT_BUCKET_MS)).slice(0, 32)}`,
      observedAt,
      accountValue,
      cashValue: money(input.cashValue),
      investedValue,
      buyingPower: money(input.buyingPower),
      dayPnl: money(input.dayPnl),
      realizedPnl: money(input.realizedPnl),
      unrealizedPnl: money(input.unrealizedPnl),
      goalValue: money(input.goalValue, 150),
      positions,
    };
    const db = open();
    try {
      db.prepare(`INSERT INTO stock_portfolio_snapshots
        (id, observed_at, account_value, cash_value, invested_value, buying_power, day_pnl, realized_pnl, unrealized_pnl, goal_value, positions_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET observed_at=excluded.observed_at, account_value=excluded.account_value,
          cash_value=excluded.cash_value, invested_value=excluded.invested_value, buying_power=excluded.buying_power,
          day_pnl=excluded.day_pnl, realized_pnl=excluded.realized_pnl, unrealized_pnl=excluded.unrealized_pnl,
          goal_value=excluded.goal_value, positions_json=excluded.positions_json`).run(
        snapshot.id, snapshot.observedAt, snapshot.accountValue, snapshot.cashValue, snapshot.investedValue,
        snapshot.buyingPower, snapshot.dayPnl, snapshot.realizedPnl, snapshot.unrealizedPnl,
        snapshot.goalValue, JSON.stringify(snapshot.positions),
      );
      return snapshot;
    } finally {
      db.close();
    }
  }

  function performanceReport() {
    const db = open();
    try {
      const trades = db.prepare(`SELECT id, signal_id AS signalId, proposal_id AS proposalId,
        approval_id AS approvalId, broker_order_id AS brokerOrderId, strategy_version AS strategyVersion,
        symbol, side, status, quantity, entry_price AS entryPrice, exit_price AS exitPrice,
        fees, realized_pnl AS realizedPnl, unrealized_pnl AS unrealizedPnl, exit_reason AS exitReason,
        human_intervention AS humanIntervention, opened_at AS openedAt, closed_at AS closedAt,
        created_at AS createdAt, updated_at AS updatedAt FROM stock_trade_journal ORDER BY updated_at DESC LIMIT 1000`).all();
      const approvals = db.prepare(`SELECT id, proposal_id AS proposalId, actor_type AS actorType,
        actor_id AS actorId, status, decided_at AS decidedAt, created_at AS createdAt
        FROM stock_trade_approvals ORDER BY created_at DESC LIMIT 1000`).all();
      return {
        ...calculatePerformance({ signals: signalJournal(1000), trades, approvals, portfolioSnapshots: portfolioSnapshotHistory(1000), generatedAt: nowFn().toISOString() }),
        strategyGovernance: strategyGovernance(),
      };
    } finally {
      db.close();
    }
  }

  function compactResearchHistory(input = {}) {
    const force = input.force === true;
    const currentTimestamp = Date.parse(input.at || nowFn().toISOString());
    const retentionAt = Number.isFinite(currentTimestamp) ? currentTimestamp : Date.now();
    if (!force && retentionAt - lastResearchHistoryRetentionAt < RESEARCH_HISTORY_RETENTION_INTERVAL_MS) {
      return { skipped: true, blockedSignalsRemoved: 0, snapshotsRemoved: 0 };
    }
    const db = open();
    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec(`CREATE TEMP TABLE IF NOT EXISTS argentum_prunable_blocked_signals (id TEXT PRIMARY KEY);
        DELETE FROM argentum_prunable_blocked_signals;`);
      db.prepare(`INSERT OR IGNORE INTO argentum_prunable_blocked_signals (id)
        SELECT id FROM (
          SELECT journal.id,
            ROW_NUMBER() OVER (PARTITION BY journal.symbol ORDER BY journal.observed_at DESC, journal.created_at DESC) AS history_rank
          FROM stock_signal_journal AS journal
          WHERE journal.state = 'BLOCKED'
            AND NOT EXISTS (SELECT 1 FROM stock_trade_journal AS trades WHERE trades.signal_id = journal.id)
        ) WHERE history_rank > ?`).run(BLOCKED_SIGNAL_HISTORY_PER_SYMBOL);
      db.prepare("DELETE FROM stock_signal_outcomes WHERE signal_id IN (SELECT id FROM argentum_prunable_blocked_signals)").run();
      db.prepare("DELETE FROM stock_signal_price_observations WHERE signal_id IN (SELECT id FROM argentum_prunable_blocked_signals)").run();
      const blockedSignalsRemoved = Number(db.prepare("DELETE FROM stock_signal_journal WHERE id IN (SELECT id FROM argentum_prunable_blocked_signals)").run().changes || 0);

      db.exec(`CREATE TEMP TABLE IF NOT EXISTS argentum_prunable_research_snapshots (id TEXT PRIMARY KEY);
        DELETE FROM argentum_prunable_research_snapshots;`);
      db.prepare(`INSERT OR IGNORE INTO argentum_prunable_research_snapshots (id)
        SELECT id FROM (
          SELECT snapshots.id,
            ROW_NUMBER() OVER (PARTITION BY snapshots.symbol ORDER BY snapshots.observed_at DESC, snapshots.id DESC) AS history_rank
          FROM stock_research_snapshots AS snapshots
        ) WHERE history_rank > ?`).run(RESEARCH_SNAPSHOT_HISTORY_PER_SYMBOL);
      const snapshotsRemoved = Number(db.prepare("DELETE FROM stock_research_snapshots WHERE id IN (SELECT id FROM argentum_prunable_research_snapshots)").run().changes || 0);
      db.exec("COMMIT");
      lastResearchHistoryRetentionAt = retentionAt;
      return { skipped: false, blockedSignalsRemoved, snapshotsRemoved };
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    } finally {
      db.close();
    }
  }

  function ingestSnapshot(snapshot = {}, input = {}) {
    const at = input.completedAt ? new Date(input.completedAt) : nowFn();
    const completedAt = at.toISOString();
    const startedAt = safeDate(input.startedAt, completedAt);
    const session = input.session || marketSession(at);
    const correlationId = shortText(input.correlationId || `stock-research-${crypto.randomUUID()}`, 160);
    const runId = shortText(input.runId || `stock-run-${crypto.randomUUID()}`, 160);
    const records = Array.isArray(snapshot.records) ? snapshot.records : [];
    const opportunities = records.map((record) => opportunityFromRecord(record, snapshot.mirror, at, snapshot.research, snapshot.intraday, snapshot.marketContext)).filter(Boolean);
    const db = open();
    let providerHealthTransition = null;
    try {
      db.exec("BEGIN IMMEDIATE");
      const previousRun = db.prepare("SELECT metadata_json AS metadataJson FROM stock_research_runs ORDER BY completed_at DESC LIMIT 1").get();
      const previousProviderStatus = String(parseJson(previousRun?.metadataJson, {}).providerHealth?.status || "UNKNOWN").toUpperCase();
      const currentProviderStatus = String(snapshot.providerHealth?.status || "UNKNOWN").toUpperCase();
      if (previousRun && previousProviderStatus !== currentProviderStatus) {
        providerHealthTransition = { from: previousProviderStatus, to: currentProviderStatus, observedAt: completedAt };
      }
      registerActiveStrategy(db, completedAt);
      db.prepare(`INSERT INTO stock_research_runs
        (id, correlation_id, cycle_type, market_session, status, started_at, completed_at, duration_ms, symbols_scanned, signals_found, error, next_scheduled_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        runId,
        correlationId,
        shortText(input.cycleType || session.status || "scheduled", 60),
        shortText(session.status || "unknown", 40),
        shortText(input.status || "success", 30),
        startedAt,
        completedAt,
        Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
        records.length,
        opportunities.filter((item) => ["high_priority", "candidate"].includes(item.status)).length,
        shortText(input.error, 1000) || null,
        safeDate(input.nextScheduledAt),
        JSON.stringify({ sourceHealth: snapshot.sourceHealth || {}, providerHealth: snapshot.providerHealth || {}, intradaySummary: snapshot.intraday?.summary || {}, marketContext: snapshot.marketContext || {}, trigger: input.trigger || "scheduled" }),
      );

      const insertSnapshot = db.prepare(`INSERT INTO stock_research_snapshots
        (id, run_id, symbol, source, observed_at, expires_at, freshness, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id, source=excluded.source,
          observed_at=excluded.observed_at, expires_at=excluded.expires_at,
          freshness=excluded.freshness, data_json=excluded.data_json`);
      const upsertOpportunity = db.prepare(`INSERT INTO stock_opportunities
        (id, symbol, status, overall_score, ai_score, technical_score, mirror_score, catalyst_score, risk_score, confidence, rank, source, thesis_hash, first_seen_at, last_updated_at, last_researched_at, next_review_at, proposal_id, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(symbol) DO UPDATE SET
          status=excluded.status, overall_score=excluded.overall_score, ai_score=excluded.ai_score,
          technical_score=excluded.technical_score, mirror_score=excluded.mirror_score,
          catalyst_score=excluded.catalyst_score, risk_score=excluded.risk_score,
          confidence=excluded.confidence, rank=excluded.rank, source=excluded.source,
          thesis_hash=excluded.thesis_hash, last_updated_at=excluded.last_updated_at,
          last_researched_at=excluded.last_researched_at, next_review_at=excluded.next_review_at,
          data_json=excluded.data_json`);
      const priorStatement = db.prepare("SELECT first_seen_at AS firstSeenAt, overall_score AS overallScore, thesis_hash AS thesisHash, data_json AS dataJson FROM stock_opportunities WHERE symbol = ?");
      const latestSignalStatement = db.prepare(`SELECT id, direction, state, opportunity_score AS opportunityScore,
        created_at AS createdAt FROM stock_signal_journal WHERE symbol = ? ORDER BY created_at DESC LIMIT 1`);
      const deleteEvidence = db.prepare("DELETE FROM stock_opportunity_evidence WHERE opportunity_id = ?");
      const insertEvidence = db.prepare(`INSERT INTO stock_opportunity_evidence
        (id, opportunity_id, evidence_type, direction, label, source, source_url, observed_at, expires_at, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const insertSignalJournal = db.prepare(`INSERT OR IGNORE INTO stock_signal_journal
        (id, run_id, opportunity_id, strategy_version, symbol, direction, state, opportunity_score, confidence_score,
         market_regime, sector_state, reference_price, stop_price, target_1, target_2, observed_at, created_at, snapshot_hash, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      opportunities.sort((a, b) => b.overallScore - a.overallScore).forEach((opportunity, index) => {
        const prior = priorStatement.get(opportunity.symbol);
        const priorData = parseJson(prior?.dataJson, {});
        const scoreDelta = prior ? opportunity.overallScore - Number(prior.overallScore || 0) : null;
        const trend = scoreDelta === null ? "new" : scoreDelta >= 4 ? "rising" : scoreDelta <= -4 ? "falling" : "stable";
        const latestSignal = latestSignalStatement.get(opportunity.symbol);
        const lastSignalAt = Date.parse(latestSignal?.createdAt || "");
        const signalStateChanged = Boolean(latestSignal) && (
          latestSignal.direction !== shortText(opportunity.direction || "LONG", 12)
          || latestSignal.state !== shortText(opportunity.state || "RESEARCH", 40)
        );
        const actionableSignal = ["high_priority", "candidate"].includes(opportunity.status)
          || ["ACTIONABLE", "WATCH"].includes(String(opportunity.state || "").toUpperCase());
        const scoreChanged = Math.abs(Number(latestSignal?.opportunityScore || 0) - Number(opportunity.overallScore || 0)) >= 5;
        const shouldJournalSignal = !latestSignal
          || !Number.isFinite(lastSignalAt)
          || signalStateChanged
          || (actionableSignal && (scoreChanged || Date.parse(completedAt) - lastSignalAt >= SIGNAL_JOURNAL_MIN_INTERVAL_MS));
        const signalId = shouldJournalSignal
          ? `stock-signal-${fingerprint(`${runId}:${opportunity.id}`).slice(0, 32)}`
          : latestSignal.id;
        const data = {
          ...opportunity,
          signalId,
          rank: index + 1,
          change: {
            trend,
            scoreDelta,
            thesisChanged: Boolean(prior && prior.thesisHash !== opportunity.thesisHash),
            previousStatus: priorData.status || null,
          },
        };
        insertSnapshot.run(
          `stock-snapshot-${fingerprint(`${opportunity.symbol}:${timeBucket(completedAt)}`).slice(0, 32)}`,
          runId,
          opportunity.symbol,
          opportunity.source,
          opportunity.observedAt,
          opportunity.nextReviewAt,
          opportunity.raw.dataFresh === false ? "stale" : "fresh",
          JSON.stringify({ evaluation: opportunity.raw, marketContext: opportunity.marketContext }),
        );
        upsertOpportunity.run(
          opportunity.id,
          opportunity.symbol,
          opportunity.status,
          opportunity.overallScore,
          opportunity.aiScore,
          opportunity.technicalScore,
          opportunity.mirrorScore,
          opportunity.catalystScore,
          opportunity.riskScore,
          opportunity.confidence,
          index + 1,
          opportunity.source,
          opportunity.thesisHash,
          prior?.firstSeenAt || completedAt,
          completedAt,
          completedAt,
          opportunity.nextReviewAt,
          null,
          JSON.stringify(data),
        );
        const signalSnapshot = {
          signalId,
          runId,
          opportunityId: opportunity.id,
          strategyVersion: opportunity.scoreFormula.version,
          symbol: opportunity.symbol,
          direction: opportunity.direction,
          state: opportunity.state,
          score: opportunity.overallScore,
          confidenceScore: opportunity.confidenceScore,
          componentScores: opportunity.scoreFormula.components,
          gates: opportunity.hardGates,
          blockers: opportunity.blockers,
          thesis: opportunity.thesis,
          marketContext: opportunity.marketContext,
          regimeContext: opportunity.regimeContext,
          company: opportunity.company,
          mirror: opportunity.mirror,
          news: opportunity.news,
          providerProvenance: {
            provider: opportunity.raw.dataProvider || opportunity.marketContext?.sourceProvider || "UNKNOWN",
            feedType: opportunity.raw.dataFeedType || "UNKNOWN",
            sourceTimestamp: opportunity.raw.dataSourceTimestamp || opportunity.marketContext?.sourceTimestamp || null,
            receivedAt: opportunity.raw.dataReceivedAt || completedAt,
            healthState: opportunity.raw.dataHealthState || opportunity.marketContext?.dataHealthState || "UNKNOWN",
            qualityScore: opportunity.dataQualityScore,
            fallbackFrom: opportunity.raw.dataFallbackFrom || [],
          },
          rawEvaluation: opportunity.raw,
        };
        if (shouldJournalSignal) {
          insertSignalJournal.run(
            signalId, runId, opportunity.id, shortText(opportunity.scoreFormula.version, 120), opportunity.symbol,
            shortText(opportunity.direction || "LONG", 12), shortText(opportunity.state || "RESEARCH", 40), opportunity.overallScore,
            opportunity.confidenceScore, shortText(opportunity.regimeContext?.regime, 80) || null,
            shortText(opportunity.regimeContext?.relativeStrength?.state, 40) || null,
            opportunity.thesis.currentPrice, opportunity.thesis.stopLoss, opportunity.thesis.target1, opportunity.thesis.target2,
            opportunity.observedAt, completedAt, fingerprint(signalSnapshot), JSON.stringify(signalSnapshot),
          );
        }
        deleteEvidence.run(opportunity.id);
        const evidence = [
          ["technical", opportunity.raw.trendConfirmation === true ? "supporting" : "conflicting", opportunity.raw.trendConfirmation === true ? "Trend confirmed" : "Trend not confirmed"],
          ["volume", opportunity.raw.volumeConfirmation === true ? "supporting" : "conflicting", opportunity.raw.volumeConfirmation === true ? "Volume confirmed" : "Volume not confirmed"],
          ["risk", opportunity.riskScore !== null && opportunity.riskScore >= 65 ? "supporting" : "conflicting", `Risk quality ${opportunity.riskScore === null ? "unavailable" : Math.round(opportunity.riskScore)}`],
        ];
        if (opportunity.mirror) evidence.push(["mirror", "supporting", `${opportunity.mirror.traderName || opportunity.mirror.sourceName} disclosure matched`]);
        if (opportunity.marketContext) evidence.push([
          "market_context",
          opportunity.marketContext.usable && opportunity.marketContext.alignment !== "CONFLICT" ? "supporting" : "conflicting",
          `${opportunity.marketContext.alignment || "UNKNOWN"} multi-timeframe context; ${opportunity.marketContext.conflicts.length} conflict(s)`,
        ]);
        if (opportunity.regimeContext) evidence.push([
          "regime",
          opportunity.regimeContext.riskState === "RISK_ON" && opportunity.regimeContext.relativeStrength?.state !== "LAGGING" ? "supporting" : "conflicting",
          `${opportunity.regimeContext.riskState || "UNKNOWN"} regime; relative strength ${opportunity.regimeContext.relativeStrength?.state || "UNKNOWN"}`,
        ]);
        evidence.forEach(([type, direction, label]) => insertEvidence.run(
          `stock-evidence-${crypto.randomUUID()}`,
          opportunity.id,
          type,
          direction,
          shortText(label, 300),
          type === "mirror" ? opportunity.mirror.sourceId || "public_disclosure" : opportunity.source,
          type === "mirror" ? opportunity.mirror.sourceUrl || null : null,
          opportunity.observedAt,
          opportunity.nextReviewAt,
          JSON.stringify(type === "mirror" ? opportunity.mirror : type === "market_context" ? opportunity.marketContext : type === "regime" ? opportunity.regimeContext : {}),
        ));
        opportunity.news.forEach((item) => insertEvidence.run(
          `stock-evidence-${crypto.randomUUID()}`,
          opportunity.id,
          "news",
          item.direction || "context",
          shortText(item.title, 300),
          shortText(item.publisher || opportunity.company?.source || "structured_news", 160),
          item.url || null,
          item.publishedAt || completedAt,
          opportunity.nextReviewAt,
          JSON.stringify({ directionalScoring: opportunity.catalystScore !== null, publisher: item.publisher || "", catalyst: item.catalyst || null }),
        ));
      });
      persistMirrorSnapshot(db, snapshot.mirror || {}, completedAt);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    } finally {
      db.close();
    }
    const historyRetention = compactResearchHistory({ at: completedAt });
    recordSystemEvent({ id: `research.completed:${runId}`, correlationId, type: "research.completed", actorType: "SYSTEM", newState: input.status || "success", reason: `${records.length} symbols persisted; ${opportunities.length} opportunities updated.`, data: { runId, symbolsScanned: records.length } });
    const outcomeCapture = captureDueSignalOutcomes(records, completedAt);
    const reports = createDueReports(at, session);
    return { runId, correlationId, opportunities: listOpportunities(), reports, outcomeCapture, historyRetention, providerHealthTransition };
  }

  function persistMirrorSnapshot(db, mirror, completedAt) {
    const sourceStatement = db.prepare(`INSERT INTO stock_mirror_sources
      (id, name, source_type, source_url, delay_class, active, health, last_checked_at, last_event_at, data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, source_type=excluded.source_type,
      source_url=excluded.source_url, delay_class=excluded.delay_class, active=excluded.active,
      health=excluded.health, last_checked_at=excluded.last_checked_at, data_json=excluded.data_json`);
    const sources = Array.isArray(mirror.sources) ? mirror.sources : [];
    sources.forEach((source) => {
      const sourceType = shortText(source.sourceType || source.type || "public_signal", 80);
      const delayClass = /13f|congress|delayed/i.test(`${source.id} ${sourceType}`) ? "filing_delay" : /form.?4|official_disclosure/i.test(`${source.id} ${sourceType}`) ? "disclosure_delay" : "source_reported";
      sourceStatement.run(
        shortText(source.id, 120), shortText(source.name || source.id, 200), sourceType,
        shortText(source.sourceUrl || source.url, 1000) || null, delayClass, source.enabled === false ? 0 : 1,
        source.enabled === false ? "disabled" : "watching", completedAt, null, JSON.stringify(source),
      );
    });
    const candidates = Array.isArray(mirror.candidates) ? mirror.candidates : [];
    const eventStatement = db.prepare(`INSERT OR IGNORE INTO stock_mirror_events
      (id, source_id, source_event_id, symbol, side, event_time, disclosed_at, received_at, delay_seconds, source_url, status, data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    candidates.forEach((candidate) => {
      const sourceId = shortText(candidate.sourceId, 120);
      const source = sources.find((item) => String(item.id) === sourceId);
      if (!sourceId || !source) return;
      const eventId = shortText(candidate.fingerprint || candidate.id, 180);
      const timeliness = mirrorTimeliness(source, candidate, completedAt);
      eventStatement.run(
        `stock-mirror-event-${fingerprint(`${sourceId}:${eventId}`).slice(0, 32)}`,
        sourceId, eventId, shortText(candidate.symbol, 12), shortText(candidate.side, 8),
        safeDate(candidate.transactionAt), safeDate(candidate.disclosedAt, completedAt), completedAt,
        timeliness.disclosureDelaySeconds,
        shortText(candidate.sourceUrl, 1000) || null, shortText(candidate.status || "observed", 40), JSON.stringify({ ...candidate, timeliness }),
      );
      db.prepare("UPDATE stock_mirror_sources SET last_event_at = ? WHERE id = ?").run(completedAt, sourceId);
    });
    const groups = new Map();
    candidates.filter((item) => item.symbol && ["BUY", "SELL"].includes(String(item.side || "").toUpperCase())).forEach((item) => {
      const key = `${String(item.symbol).toUpperCase()}:${String(item.side).toUpperCase()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    const consensusStatement = db.prepare(`INSERT INTO stock_mirror_consensus
      (id, symbol, side, score, source_count, first_seen_at, last_updated_at, expires_at, data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol, side) DO UPDATE SET score=excluded.score, source_count=excluded.source_count,
      last_updated_at=excluded.last_updated_at, expires_at=excluded.expires_at, data_json=excluded.data_json`);
    for (const [key, items] of groups) {
      const uniqueSources = new Set(items.map((item) => item.sourceId).filter(Boolean));
      if (uniqueSources.size < 2) continue;
      const [symbol, side] = key.split(":");
      const score = Math.round(items.reduce((sum, item) => sum + Number(item.evidenceScore || 0) * (Number(item.evidenceScore || 0) <= 1 ? 100 : 1), 0) / items.length);
      const id = `stock-consensus-${symbol}-${side}`;
      const prior = db.prepare("SELECT first_seen_at AS firstSeenAt FROM stock_mirror_consensus WHERE id = ?").get(id);
      consensusStatement.run(id, symbol, side, clamp(score), uniqueSources.size, prior?.firstSeenAt || completedAt, completedAt, new Date(Date.parse(completedAt) + 24 * 60 * 60_000).toISOString(), JSON.stringify({ sourceIds: [...uniqueSources], eventIds: items.map((item) => item.fingerprint || item.id) }));
    }
  }

  function listOpportunities(limit = OPPORTUNITY_LIMIT) {
    const db = open();
    try {
      const rows = db.prepare(`SELECT id, symbol, status, overall_score AS overallScore, ai_score AS aiScore,
        technical_score AS technicalScore, mirror_score AS mirrorScore, catalyst_score AS catalystScore,
        risk_score AS riskScore, confidence, rank, first_seen_at AS firstSeenAt, last_updated_at AS lastUpdatedAt,
        last_researched_at AS lastResearchedAt, next_review_at AS nextReviewAt, proposal_id AS proposalId,
        data_json AS dataJson FROM stock_opportunities ORDER BY overall_score DESC, last_updated_at DESC LIMIT ?`).all(Math.max(1, Math.min(250, Number(limit) || OPPORTUNITY_LIMIT)));
      const evidenceStatement = db.prepare(`SELECT id, evidence_type AS type, direction, label, source, source_url AS sourceUrl,
        observed_at AS observedAt, expires_at AS expiresAt, data_json AS dataJson
        FROM stock_opportunity_evidence WHERE opportunity_id = ? ORDER BY observed_at DESC`);
      return rows.map((row) => ({ ...rowOpportunity(row), evidence: evidenceStatement.all(row.id).map((item) => ({ ...item, data: parseJson(item.dataJson, {}), dataJson: undefined })) }));
    } finally {
      db.close();
    }
  }

  function reportSessionMetrics(reportType, at = nowFn()) {
    const day = easternDay(at);
    const db = open();
    try {
      const runs = db.prepare(`SELECT id, market_session AS marketSession, status,
        completed_at AS completedAt, symbols_scanned AS symbolsScanned, signals_found AS signalsFound
        FROM stock_research_runs ORDER BY completed_at DESC LIMIT 2500`).all()
        .filter((run) => run.completedAt && easternDay(new Date(run.completedAt)) === day);
      const sessionNames = reportType === "market_close"
        ? new Set(["regular"])
        : reportType === "morning"
          ? new Set(["premarket"])
          : new Set(["closed", "weekend"]);
      const sessionRuns = runs.filter((run) => sessionNames.has(String(run.marketSession || "").toLowerCase()));
      const runIds = new Set(sessionRuns.map((run) => run.id));
      const uniqueSymbols = new Set(db.prepare(`SELECT run_id AS runId, symbol
        FROM stock_research_snapshots ORDER BY observed_at DESC LIMIT 20000`).all()
        .filter((row) => runIds.has(row.runId))
        .map((row) => shortText(row.symbol, 12).toUpperCase())
        .filter(Boolean));
      const reportsChecked = sessionRuns.filter((run) => ["success", "partial"].includes(run.status)).length;
      const stocksChecked = sessionRuns.reduce((sum, run) => sum + Math.max(0, Number(run.symbolsScanned) || 0), 0);
      const signalsFound = sessionRuns.reduce((sum, run) => sum + Math.max(0, Number(run.signalsFound) || 0), 0);
      return {
        reportDay: day,
        reportsChecked,
        researchRuns: sessionRuns.length,
        successfulRuns: sessionRuns.filter((run) => run.status === "success").length,
        partialRuns: sessionRuns.filter((run) => run.status === "partial").length,
        failedRuns: sessionRuns.filter((run) => run.status === "failed").length,
        stocksChecked,
        uniqueStocks: uniqueSymbols.size,
        signalsFound,
        latestCompletedAt: sessionRuns[0]?.completedAt || null,
      };
    } finally {
      db.close();
    }
  }

  function marketCloseAudit(at = nowFn()) {
    const day = easternDay(at);
    const closeMinute = Number(marketSession(at).regularCloseMinute) || 16 * 60;
    const db = open();
    try {
      const trades = db.prepare(`SELECT broker_order_id AS brokerOrderId, symbol, side, status, quantity,
        entry_price AS entryPrice, exit_price AS exitPrice, fees, realized_pnl AS realizedPnl,
        opened_at AS openedAt, closed_at AS closedAt, created_at AS createdAt, updated_at AS updatedAt
        FROM stock_trade_journal ORDER BY updated_at DESC LIMIT 1000`).all()
        .filter((trade) => {
          const observedAt = trade.openedAt || trade.closedAt || trade.updatedAt || trade.createdAt;
          return observedAt && easternDay(new Date(observedAt)) === day;
        });
      const verifiedFills = trades.filter((trade) => ["filled", "partially_filled", "partial"].includes(String(trade.status || "").toLowerCase()));
      const buyFills = verifiedFills.filter((trade) => String(trade.side || "").toUpperCase() === "BUY");
      const hasRealizedPnl = verifiedFills.some((trade) => trade.realizedPnl !== null && trade.realizedPnl !== undefined && Number.isFinite(Number(trade.realizedPnl)));
      const moneySpent = buyFills.reduce((sum, trade) => {
        const quantity = finiteNumber(trade.quantity, 0);
        const price = finiteNumber(trade.entryPrice, 0);
        const fees = finiteNumber(trade.fees, 0);
        return sum + Math.max(0, quantity * price) + Math.max(0, fees);
      }, 0);
      const realizedPnl = verifiedFills.reduce((sum, trade) => sum + finiteNumber(trade.realizedPnl, 0), 0);
      const snapshots = db.prepare(`SELECT observed_at AS observedAt, account_value AS accountValue,
        day_pnl AS dayPnl, realized_pnl AS realizedPnl, unrealized_pnl AS unrealizedPnl
        FROM stock_portfolio_snapshots ORDER BY observed_at ASC LIMIT 2000`).all()
        .filter((snapshot) => {
          if (!snapshot.observedAt || easternDay(new Date(snapshot.observedAt)) !== day) return false;
          const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
          }).formatToParts(new Date(snapshot.observedAt)).filter((item) => item.type !== "literal").map((item) => [item.type, item.value]));
          const minutes = Number(parts.hour || 0) * 60 + Number(parts.minute || 0);
          return minutes >= 9 * 60 + 30 && minutes <= closeMinute + 60;
        });
      const firstSnapshot = snapshots[0] || null;
      const closingSnapshot = snapshots[snapshots.length - 1] || null;
      const accountChange = firstSnapshot && closingSnapshot
        ? money(Number(closingSnapshot.accountValue) - Number(firstSnapshot.accountValue), null)
        : null;
      return {
        source: "Official broker snapshots and independently reconciled fills",
        verifiedFills: verifiedFills.length,
        verifiedBuyFills: buyFills.length,
        moneySpent: money(moneySpent, 0),
        dayPnl: money(closingSnapshot?.dayPnl, null),
        realizedPnl: closingSnapshot?.realizedPnl === null || closingSnapshot?.realizedPnl === undefined
          ? money(realizedPnl, hasRealizedPnl ? 0 : null)
          : money(closingSnapshot.realizedPnl, null),
        unrealizedPnl: money(closingSnapshot?.unrealizedPnl, null),
        openingAccountValue: money(firstSnapshot?.accountValue, null),
        closingAccountValue: money(closingSnapshot?.accountValue, null),
        accountChange,
        latestBrokerSnapshotAt: closingSnapshot?.observedAt || null,
        trades: verifiedFills.slice(0, 20).map((trade) => ({
          brokerOrderId: shortText(trade.brokerOrderId, 160),
          symbol: shortText(trade.symbol, 12).toUpperCase(),
          side: shortText(trade.side, 8).toUpperCase(),
          status: shortText(trade.status, 40),
          quantity: finiteNumber(trade.quantity, null),
          price: money(String(trade.side || "").toUpperCase() === "SELL" ? trade.exitPrice : trade.entryPrice, null),
          realizedPnl: money(trade.realizedPnl, null),
          observedAt: safeDate(trade.closedAt || trade.openedAt || trade.updatedAt || trade.createdAt),
        })),
      };
    } finally {
      db.close();
    }
  }

  function buildReport(reportType, at = nowFn(), session = marketSession(at)) {
    const opportunities = listOpportunities(25);
    const actionable = opportunities.filter((item) => ["high_priority", "candidate"].includes(item.status)).slice(0, 10);
    const changed = opportunities.filter((item) => item.change?.trend !== "stable" || item.change?.thesisChanged).slice(0, 10);
    const latestPortfolio = portfolioSnapshotHistory(1).at(-1) || null;
    const heldSymbols = new Set((latestPortfolio?.positions || []).map((position) => String(position.symbol || "").toUpperCase()).filter(Boolean));
    const suggestions = opportunities
      .filter((item) => !heldSymbols.has(String(item.symbol || "").toUpperCase()))
      .slice(0, 8)
      .map((item) => ({
        symbol: item.symbol,
        status: item.status,
        overallScore: item.overallScore,
        aiScore: item.aiScore,
        confidenceScore: item.confidenceScore,
        setup: item.thesis?.setup || null,
        reason: item.thesis?.reason || null,
        risk: item.thesis?.risk || null,
        invalidation: item.thesis?.invalidation || null,
        blockers: (Array.isArray(item.blockers) ? item.blockers : []).slice(0, 3).map((blocker) => blocker.reason || blocker.code || String(blocker)),
        lastResearchedAt: item.lastResearchedAt,
        nextReviewAt: item.nextReviewAt,
        readiness: ["high_priority", "candidate"].includes(item.status) ? "revalidate_at_open" : "research_more",
        researchOnly: true,
        executionEligible: false,
      }));
    const sessionMetrics = reportSessionMetrics(reportType, at);
    const db = open();
    let latestRunContext = {};
    try {
      const latest = db.prepare("SELECT metadata_json AS metadataJson FROM stock_research_runs ORDER BY completed_at DESC LIMIT 1").get();
      latestRunContext = parseJson(latest?.metadataJson, {});
    } finally {
      db.close();
    }
    const market = latestRunContext.marketContext || {};
    const providerHealth = latestRunContext.providerHealth || {};
    const performance = performanceReport();
    const closeAudit = reportType === "market_close" ? marketCloseAudit(at) : null;
    return {
      version: 2,
      type: reportType,
      generatedAt: at.toISOString(),
      marketSession: session,
      topOpportunities: actionable,
      suggestions,
      thesisChanges: changed,
      sessionMetrics,
      closeAudit,
      summary: {
        researched: opportunities.length,
        highPriority: opportunities.filter((item) => item.status === "high_priority").length,
        candidates: opportunities.filter((item) => item.status === "candidate").length,
        mirrorMatched: opportunities.filter((item) => item.mirror).length,
        newsItems: opportunities.reduce((sum, item) => sum + (Array.isArray(item.news) ? item.news.length : 0), 0),
        suggestions: suggestions.length,
      },
      importantNews: opportunities.flatMap((item) => (item.news || []).map((news) => ({ symbol: item.symbol, ...news }))).slice(0, 20),
      marketState: {
        regime: market.regime || null,
        riskState: market.riskState || market.risk_state || null,
        trendRegime: market.trendRegime || market.trend_regime || null,
        volatilityRegime: market.volatilityRegime || market.volatility_regime || null,
        breadthState: market.breadthState || market.breadth_state || null,
        generatedAt: market.generatedAt || market.generated_at || null,
      },
      providerHealth: {
        status: providerHealth.status || "UNKNOWN",
        updatedAt: providerHealth.updatedAt || providerHealth.updated_at || null,
        healthy: Number(providerHealth.healthy || 0),
        degraded: Number(providerHealth.degraded || 0),
        total: Number(providerHealth.total || 0),
      },
      performance: performance.summary,
      limitations: [
        "Catalyst scores remain unavailable when no structured timestamped news observation was persisted.",
        reportType === "market_close"
          ? "Spend and trade counts include only independently reconciled broker fills; day P&L comes from the latest official broker snapshot."
          : reportType === "morning"
            ? "Every overnight thesis must be revalidated against current pre-market price, spread, liquidity, volume, and risk before execution."
            : "Suggestions are a research-only watchlist. Day agents must revalidate current price, spread, liquidity, volume, risk, buying power, and duplicates before Human Gate.",
      ],
    };
  }

  function saveReport(reportType, at = nowFn(), session = marketSession(at)) {
    const report = buildReport(reportType, at, session);
    const day = easternDay(at);
    const id = `stock-report-${reportType}-${day}`;
    const db = open();
    try {
      db.prepare(`INSERT INTO stock_research_reports
        (id, report_type, report_day, generated_at, market_session, status, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(report_type, report_day) DO UPDATE SET generated_at=excluded.generated_at,
        market_session=excluded.market_session, status=excluded.status, data_json=excluded.data_json`).run(
        id, reportType, day, report.generatedAt, session.status, "ready", JSON.stringify(report),
      );
    } finally {
      db.close();
    }
    const eventType = reportType === "overnight" ? "overnight.completed" : reportType === "morning" ? "morning.report_ready" : "market_close.report_ready";
    recordSystemEvent({ id: `${reportType}.report_ready:${day}`, type: eventType, reason: `${reportType} intelligence report persisted.`, data: { reportId: id, reportDay: day } });
    return report;
  }

  function createDueReports(at = nowFn(), session = marketSession(at)) {
    const window = reportWindow(at);
    const reports = {};
    const day = easternDay(at);
    const db = open();
    let existing;
    try {
      existing = new Set(db.prepare("SELECT report_type AS reportType FROM stock_research_reports WHERE report_day = ?").all(day).map((item) => item.reportType));
    } finally {
      db.close();
    }
    if (window.overnight) {
      const report = saveReport("overnight", at, session);
      if (!existing.has("overnight")) reports.overnight = report;
    }
    if (window.morning) {
      const report = saveReport("morning", at, session);
      if (!existing.has("morning")) reports.morning = report;
    }
    if (window.marketClose) {
      const report = saveReport("market_close", at, session);
      if (!existing.has("market_close")) reports.marketClose = report;
    }
    return reports;
  }

  function latestReport(reportType) {
    const db = open();
    try {
      const row = db.prepare("SELECT data_json AS dataJson FROM stock_research_reports WHERE report_type = ? ORDER BY generated_at DESC LIMIT 1").get(reportType);
      return row ? parseJson(row.dataJson, null) : null;
    } finally {
      db.close();
    }
  }

  function dailySummary(at = nowFn()) {
    const day = easternDay(at);
    const db = open();
    try {
      const runs = db.prepare(`SELECT status, completed_at AS completedAt, symbols_scanned AS symbolsScanned,
        signals_found AS signalsFound FROM stock_research_runs ORDER BY completed_at DESC LIMIT 2000`).all()
        .filter((run) => run.completedAt && easternDay(new Date(run.completedAt)) === day);
      const reports = db.prepare(`SELECT report_type AS reportType, generated_at AS generatedAt, status
        FROM stock_research_reports WHERE report_day = ? ORDER BY generated_at DESC`).all(day);
      return {
        day,
        research: {
          runs: runs.length,
          successfulRuns: runs.filter((run) => run.status === "success").length,
          partialRuns: runs.filter((run) => run.status === "partial").length,
          failedRuns: runs.filter((run) => run.status === "failed").length,
          symbolsScanned: runs.reduce((sum, run) => sum + Math.max(0, Number(run.symbolsScanned) || 0), 0),
          signalsFound: runs.reduce((sum, run) => sum + Math.max(0, Number(run.signalsFound) || 0), 0),
          latestCompletedAt: runs[0]?.completedAt || null,
        },
        reports: reports.map((report) => ({
          type: report.reportType,
          generatedAt: report.generatedAt,
          status: report.status,
        })),
      };
    } finally {
      db.close();
    }
  }

  function upsertProposal(proposal = {}, input = {}) {
    if (!proposal.id || !proposal.symbol || !proposal.fingerprint) return null;
    const at = safeDate(input.updatedAt, nowFn().toISOString());
    const db = open();
    try {
      db.prepare(`INSERT INTO stock_trade_proposals
        (id, opportunity_id, symbol, side, status, fingerprint, expires_at, created_at, updated_at, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(fingerprint) DO UPDATE SET status=excluded.status, expires_at=excluded.expires_at,
        updated_at=excluded.updated_at, data_json=excluded.data_json`).run(
        shortText(proposal.id, 160), shortText(input.opportunityId, 160) || null, shortText(proposal.symbol, 12),
        shortText(proposal.side, 8), shortText(proposal.status || proposal.reviewState || "observed", 40),
        shortText(proposal.fingerprint, 160), safeDate(proposal.expiresAt), safeDate(proposal.createdAt, at), at, JSON.stringify(proposal),
      );
      return proposal;
    } finally {
      db.close();
    }
  }

  function recordApproval(approval = {}, input = {}) {
    const id = shortText(approval.id || `stock-approval-${crypto.randomUUID()}`, 160);
    const db = open();
    try {
      const result = db.prepare(`INSERT INTO stock_trade_approvals
        (id, proposal_id, actor_type, actor_id, status, idempotency_key, telegram_message_id, decided_at, created_at, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET proposal_id=excluded.proposal_id, actor_type=excluded.actor_type,
        actor_id=excluded.actor_id, status=excluded.status, idempotency_key=COALESCE(excluded.idempotency_key, stock_trade_approvals.idempotency_key),
        telegram_message_id=COALESCE(excluded.telegram_message_id, stock_trade_approvals.telegram_message_id),
        decided_at=excluded.decided_at, data_json=excluded.data_json`).run(
        id, shortText(input.proposalId, 160) || null, shortText(input.actorType || "WEB", 20).toUpperCase(),
        shortText(input.actorId, 160) || null, shortText(approval.status || "pending", 40),
        shortText(input.idempotencyKey, 200) || null, shortText(input.telegramMessageId, 160) || null,
        safeDate(approval.decidedAt || approval.resolvedAt), safeDate(approval.createdAt, nowFn().toISOString()), JSON.stringify(approval),
      );
      return { id, duplicate: Number(result.changes || 0) === 0 };
    } finally {
      db.close();
    }
  }

  function reserveTelegramEvent(event = {}) {
    const id = shortText(event.id || `stock-telegram-${crypto.randomUUID()}`, 160);
    const at = nowFn().toISOString();
    const db = open();
    try {
      const result = db.prepare(`INSERT OR IGNORE INTO stock_telegram_events
        (id, update_id, idempotency_key, event_type, actor_id, chat_id, message_id, proposal_id, approval_id, status, error, created_at, processed_at, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, shortText(event.updateId, 160) || null, shortText(event.idempotencyKey, 200) || null,
        shortText(event.eventType || "telegram.update", 80), shortText(event.actorId, 160) || null,
        shortText(event.chatId, 160) || null, shortText(event.messageId, 160) || null,
        shortText(event.proposalId, 160) || null, shortText(event.approvalId, 160) || null,
        "processing", null, at, null, JSON.stringify(event.data || {}),
      );
      return { id, duplicate: Number(result.changes || 0) === 0 };
    } finally {
      db.close();
    }
  }

  function completeTelegramEvent(id, result = {}) {
    const db = open();
    try {
      db.prepare("UPDATE stock_telegram_events SET status = ?, error = ?, processed_at = ?, data_json = ? WHERE id = ?").run(
        shortText(result.status || "processed", 40), shortText(result.error, 1000) || null,
        nowFn().toISOString(), JSON.stringify(result.data || {}), id,
      );
    } finally {
      db.close();
    }
  }

  function recordOrderAudit(entry = {}) {
    const db = open();
    const id = shortText(entry.id || `stock-order-audit-${crypto.randomUUID()}`, 160);
    try {
      db.prepare(`INSERT INTO stock_order_audit
        (id, correlation_id, actor_type, actor_id, proposal_id, approval_id, order_id, symbol, side, action, old_state, new_state, reason, broker_response_json, error, telegram_message_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, shortText(entry.correlationId || id, 160), shortText(entry.actorType || "SYSTEM", 20).toUpperCase(),
        shortText(entry.actorId, 160) || null, shortText(entry.proposalId, 160) || null,
        shortText(entry.approvalId, 160) || null, shortText(entry.orderId, 160) || null,
        shortText(entry.symbol, 12) || null, shortText(entry.side, 8) || null,
        shortText(entry.action || "observed", 80), shortText(entry.oldState, 80) || null,
        shortText(entry.newState, 80) || null, shortText(entry.reason, 1000) || null,
        entry.brokerResponse ? JSON.stringify(entry.brokerResponse) : null, shortText(entry.error, 1000) || null,
        shortText(entry.telegramMessageId, 160) || null, safeDate(entry.createdAt, nowFn().toISOString()),
      );
      return { id };
    } finally {
      db.close();
    }
  }

  function recordRiskDecision(entry = {}) {
    const db = open();
    const id = shortText(entry.id || `stock-risk-${crypto.randomUUID()}`, 160);
    try {
      db.prepare(`INSERT INTO stock_risk_decisions
        (id, correlation_id, proposal_id, symbol, decision, reasons_json, observed_at, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, shortText(entry.correlationId || id, 160), shortText(entry.proposalId, 160) || null,
        shortText(entry.symbol, 12) || null, shortText(entry.decision || "blocked", 40),
        JSON.stringify(Array.isArray(entry.reasons) ? entry.reasons.slice(0, 20) : []),
        safeDate(entry.observedAt, nowFn().toISOString()), JSON.stringify(entry.data || {}),
      );
      return { id };
    } finally {
      db.close();
    }
  }

  function updateWorkerHeartbeat(worker = {}, input = {}) {
    if (!worker.id) return;
    const db = open();
    try {
      db.prepare(`INSERT INTO stock_worker_heartbeats
        (worker_id, status, cycle_type, started_at, completed_at, duration_ms, items_seen, items_created, errors, rate_limits, next_run_at, correlation_id, detail_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(worker_id) DO UPDATE SET status=excluded.status, cycle_type=excluded.cycle_type,
        started_at=excluded.started_at, completed_at=excluded.completed_at, duration_ms=excluded.duration_ms,
        items_seen=excluded.items_seen, items_created=excluded.items_created, errors=excluded.errors,
        rate_limits=excluded.rate_limits, next_run_at=excluded.next_run_at,
        correlation_id=excluded.correlation_id, detail_json=excluded.detail_json`).run(
        shortText(worker.id, 120), shortText(worker.status || "scheduled", 40), shortText(input.cycleType || "scheduled", 60),
        safeDate(input.startedAt || worker.lastStartedAt), safeDate(input.completedAt || worker.lastRunAt),
        Number.isFinite(Number(input.durationMs)) ? Math.max(0, Number(input.durationMs)) : null,
        Number(input.itemsSeen || 0), Number(input.itemsCreated || 0), Number(input.errors || 0), Number(input.rateLimits || 0),
        safeDate(worker.nextRunAt), shortText(input.correlationId, 160) || null, JSON.stringify(worker),
      );
    } finally {
      db.close();
    }
  }

  function recentEvents(limit = EVENT_LIMIT) {
    const db = open();
    try {
      return db.prepare(`SELECT id, correlation_id AS correlationId, event_type AS type, actor_type AS actorType,
        actor_id AS actorId, symbol, proposal_id AS proposalId, order_id AS orderId, old_state AS oldState,
        new_state AS newState, decision, reason, error, created_at AS createdAt, data_json AS dataJson
        FROM stock_system_events ORDER BY created_at DESC LIMIT ?`).all(Math.max(1, Math.min(500, Number(limit) || EVENT_LIMIT)))
        .map((row) => {
          const data = parseJson(row.dataJson, {});
          return { ...row, timeliness: data.timeliness || null, data, dataJson: undefined };
        });
    } finally {
      db.close();
    }
  }

  function mirrorState() {
    const db = open();
    try {
      const sources = db.prepare(`SELECT id, name, source_type AS sourceType, source_url AS sourceUrl,
        delay_class AS delayClass, active, following, mirror_enabled AS mirrorEnabled, health, last_checked_at AS lastCheckedAt,
        last_event_at AS lastEventAt, data_json AS dataJson FROM stock_mirror_sources ORDER BY name`).all()
        .map((row) => ({ ...row, active: Boolean(row.active), following: Boolean(row.following), mirrorEnabled: Boolean(row.mirrorEnabled), data: parseJson(row.dataJson, {}), dataJson: undefined }));
      const events = db.prepare(`SELECT id, source_id AS sourceId, source_event_id AS sourceEventId, symbol, side,
        event_time AS eventTime, disclosed_at AS disclosedAt, received_at AS receivedAt,
        delay_seconds AS delaySeconds, source_url AS sourceUrl, status, data_json AS dataJson
        FROM stock_mirror_events ORDER BY received_at DESC LIMIT 100`).all()
        .map((row) => ({ ...row, data: parseJson(row.dataJson, {}), dataJson: undefined }));
      const consensus = db.prepare(`SELECT id, symbol, side, score, source_count AS sourceCount,
        first_seen_at AS firstSeenAt, last_updated_at AS lastUpdatedAt, expires_at AS expiresAt,
        data_json AS dataJson FROM stock_mirror_consensus ORDER BY score DESC`).all()
        .map((row) => ({ ...row, data: parseJson(row.dataJson, {}), dataJson: undefined }));
      return { sources, events, consensus };
    } finally {
      db.close();
    }
  }

  function setMirrorSourceState(sourceId, updates = {}) {
    const id = shortText(sourceId, 120);
    if (!id) throw new Error("Mirror source ID is required.");
    const db = open();
    try {
      const current = db.prepare("SELECT id, following, mirror_enabled AS mirrorEnabled FROM stock_mirror_sources WHERE id = ?").get(id);
      if (!current) return null;
      const following = updates.following === undefined ? Boolean(current.following) : updates.following === true;
      const mirrorEnabled = updates.mirrorEnabled === undefined ? Boolean(current.mirrorEnabled) : updates.mirrorEnabled === true;
      db.prepare("UPDATE stock_mirror_sources SET following = ?, mirror_enabled = ? WHERE id = ?").run(following ? 1 : 0, mirrorEnabled && following ? 1 : 0, id);
      recordSystemEvent({
        id: `mirror.source_control:${id}:${nowFn().getTime()}`,
        type: "mirror.source_control_changed",
        actorType: shortText(updates.actorType || "WEB", 20),
        actorId: shortText(updates.actorId, 160),
        oldState: `following=${Boolean(current.following)},mirror=${Boolean(current.mirrorEnabled)}`,
        newState: `following=${following},mirror=${mirrorEnabled && following}`,
        reason: "Mirror source control changed. This only changes research/proposal eligibility; it never grants broker authority.",
        data: { sourceId: id, following, mirrorEnabled: mirrorEnabled && following },
      });
      return mirrorState().sources.find((source) => source.id === id) || null;
    } finally {
      db.close();
    }
  }

  function health(input = {}) {
    const db = open();
    try {
      const latestRun = db.prepare("SELECT status, completed_at AS completedAt FROM stock_research_runs ORDER BY completed_at DESC LIMIT 1").get() || null;
      const latestHeartbeat = db.prepare("SELECT MAX(COALESCE(completed_at, started_at)) AS observedAt FROM stock_worker_heartbeats").get()?.observedAt || null;
      const sourceCount = db.prepare("SELECT COUNT(*) AS count, SUM(CASE WHEN active = 1 AND health IN ('watching','healthy') THEN 1 ELSE 0 END) AS healthy FROM stock_mirror_sources").get();
      return {
        generatedAt: nowFn().toISOString(),
        mode: String(input.executionMode || "paper").toLowerCase() === "live" ? "LIVE" : "PAPER",
        database: { status: "healthy", migration: "005_stock_strategy_governance" },
        marketData: {
          status: input.providerHealth?.status
            ? String(input.providerHealth.status).toLowerCase()
            : input.sourceHealth?.error ? "error" : input.sourceHealth?.stale ? "stale" : input.sourceHealth?.ready ? "healthy" : "waiting",
          updatedAt: input.providerHealth?.updatedAt || latestRun?.completedAt || null,
          providers: (Array.isArray(input.providerHealth?.providers) ? input.providerHealth.providers : []).slice(0, 20),
        },
        broker: { status: input.broker?.authenticationVerified ? "connected" : "blocked", updatedAt: input.broker?.updatedAt || null },
        telegram: { status: input.telegram?.enabled ? "connected" : input.telegram?.configured ? "approval_required" : "not_configured", updatedAt: input.telegram?.lastSentAt || null },
        research: { status: latestRun?.status || "waiting", updatedAt: latestRun?.completedAt || null },
        mirror: { status: Number(sourceCount?.count || 0) ? "watching" : "waiting", healthy: Number(sourceCount?.healthy || 0), total: Number(sourceCount?.count || 0) },
        lastWorkerHeartbeat: latestHeartbeat,
        execution: { status: input.executionBlocked ? "blocked" : "eligible_for_human_gate", researchContinues: true },
      };
    } finally {
      db.close();
    }
  }

  return {
    buildReport,
    captureDueSignalOutcomes,
    compactResearchHistory,
    completeTelegramEvent,
    createDueReports,
    dailySummary,
    health,
    ingestSnapshot,
    latestReport,
    latestSignalForSymbol,
    listOpportunities,
    mirrorState,
    performanceReport,
    portfolioSnapshotHistory,
    proposeStrategyChange,
    recentEvents,
    recordApproval,
    recordOrderAudit,
    recordPortfolioSnapshot,
    recordRiskDecision,
    recordTradeJournal,
    recordSystemEvent,
    reserveTelegramEvent,
    saveReport,
    signalJournal,
    setMirrorSourceState,
    strategyGovernance,
    updateWorkerHeartbeat,
    upsertProposal,
  };
}

module.exports = {
  SIGNAL_OUTCOME_HORIZONS,
  createStockIntelligenceStore,
  dataQualityScore,
  easternDay,
  mirrorTimeliness,
  opportunityFromRecord,
  reportWindow,
  riskQualityScore,
  weightedScore,
};

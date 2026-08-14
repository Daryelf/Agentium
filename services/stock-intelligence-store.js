const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { databasePath, initializeLocalDatabase } = require("./local-database");
const { marketSession } = require("./stock-market-workers");

const OPPORTUNITY_LIMIT = 120;
const EVENT_LIMIT = 200;

function clamp(value, minimum = 0, maximum = 100) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : null;
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
  const weekday = !["Sat", "Sun"].includes(parts.weekday);
  return {
    overnight: minutes >= 60 && minutes < 4 * 60,
    morning: weekday && minutes >= 8 * 60 && minutes < 9 * 60 + 30,
  };
}

function parseRiskReward(value) {
  const match = String(value || "").match(/(?:1\s*:\s*)?([0-9]+(?:\.[0-9]+)?)/);
  return match ? clamp(Number(match[1]), 0, 10) : null;
}

function dataQualityScore(record = {}) {
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

function weightedScore(inputs) {
  const definitions = [
    ["technical", inputs.technical, 0.5],
    ["risk", inputs.risk, 0.2],
    ["data_quality", inputs.dataQuality, 0.15],
    ["mirror", inputs.mirror, 0.1],
    ["catalyst", inputs.catalyst, 0.05],
  ];
  const available = definitions.filter(([, value]) => value !== null && value !== undefined && Number.isFinite(Number(value)));
  const totalWeight = available.reduce((sum, [, , weight]) => sum + weight, 0);
  if (!totalWeight) return { score: 0, components: [] };
  return {
    score: Math.round(available.reduce((sum, [, value, weight]) => sum + Number(value) * weight, 0) / totalWeight),
    components: available.map(([name, value, weight]) => ({ name, value: Math.round(Number(value)), weight: weight / totalWeight })),
  };
}

function opportunityFromRecord(record = {}, mirror = {}, at = new Date(), research = {}) {
  const symbol = String(record.ticker || "").toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
  if (!symbol) return null;
  const mirrorCandidate = matchingMirrorCandidate(record, mirror);
  const researchItem = (Array.isArray(research.tickers) ? research.tickers : []).find((item) => String(item.ticker || "").toUpperCase() === symbol) || null;
  const technical = clamp(record.score);
  const risk = riskQualityScore(record);
  const dataQuality = dataQualityScore(record);
  const mirrorScore = mirrorCandidate && Number.isFinite(Number(mirrorCandidate.evidenceScore))
    ? clamp(Number(mirrorCandidate.evidenceScore) <= 1 ? Number(mirrorCandidate.evidenceScore) * 100 : Number(mirrorCandidate.evidenceScore))
    : null;
  // Catalyst remains null until a structured, timestamped news/filing observation exists.
  const catalyst = null;
  const weighted = weightedScore({ technical, risk, dataQuality, mirror: mirrorScore, catalyst });
  const validSetup = record.status === "valid_setup" && record.dataFresh !== false && record.hardRejectionTriggered !== true;
  const status = !validSetup
    ? record.status === "rejected" ? "rejected" : "monitoring"
    : weighted.score >= 80 ? "high_priority" : weighted.score >= 70 ? "candidate" : "monitoring";
  const confidence = weighted.score >= 85 && dataQuality >= 80 ? "high" : weighted.score >= 70 ? "medium" : "low";
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
    overallScore: weighted.score,
    aiScore: weighted.score,
    technicalScore: technical,
    mirrorScore,
    catalystScore: catalyst,
    riskScore: risk,
    dataQualityScore: dataQuality,
    confidence,
    source: "stock_guru_evaluator",
    observedAt,
    nextReviewAt,
    thesis,
    thesisHash: fingerprint(thesis),
    scoreFormula: {
      version: 1,
      description: "Weighted mean of available real inputs; missing catalyst or mirror inputs are excluded rather than invented.",
      components: weighted.components,
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
    } : null,
    news: researchItem ? (Array.isArray(researchItem.news) ? researchItem.news : []).slice(0, 8).map((item) => ({
      title: shortText(item.title, 300),
      publisher: shortText(item.publisher, 120),
      publishedAt: safeDate(item.publishedAt),
      url: shortText(item.url, 1000),
      direction: "context",
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

  function ingestSnapshot(snapshot = {}, input = {}) {
    const at = input.completedAt ? new Date(input.completedAt) : nowFn();
    const completedAt = at.toISOString();
    const startedAt = safeDate(input.startedAt, completedAt);
    const session = input.session || marketSession(at);
    const correlationId = shortText(input.correlationId || `stock-research-${crypto.randomUUID()}`, 160);
    const runId = shortText(input.runId || `stock-run-${crypto.randomUUID()}`, 160);
    const records = Array.isArray(snapshot.records) ? snapshot.records : [];
    const opportunities = records.map((record) => opportunityFromRecord(record, snapshot.mirror, at, snapshot.research)).filter(Boolean);
    const db = open();
    try {
      db.exec("BEGIN IMMEDIATE");
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
        JSON.stringify({ sourceHealth: snapshot.sourceHealth || {}, trigger: input.trigger || "scheduled" }),
      );

      const insertSnapshot = db.prepare(`INSERT INTO stock_research_snapshots
        (id, run_id, symbol, source, observed_at, expires_at, freshness, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
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
      const deleteEvidence = db.prepare("DELETE FROM stock_opportunity_evidence WHERE opportunity_id = ?");
      const insertEvidence = db.prepare(`INSERT INTO stock_opportunity_evidence
        (id, opportunity_id, evidence_type, direction, label, source, source_url, observed_at, expires_at, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      opportunities.sort((a, b) => b.overallScore - a.overallScore).forEach((opportunity, index) => {
        const prior = priorStatement.get(opportunity.symbol);
        const priorData = parseJson(prior?.dataJson, {});
        const scoreDelta = prior ? opportunity.overallScore - Number(prior.overallScore || 0) : null;
        const trend = scoreDelta === null ? "new" : scoreDelta >= 4 ? "rising" : scoreDelta <= -4 ? "falling" : "stable";
        const data = {
          ...opportunity,
          rank: index + 1,
          change: {
            trend,
            scoreDelta,
            thesisChanged: Boolean(prior && prior.thesisHash !== opportunity.thesisHash),
            previousStatus: priorData.status || null,
          },
        };
        insertSnapshot.run(
          `stock-snapshot-${crypto.randomUUID()}`,
          runId,
          opportunity.symbol,
          opportunity.source,
          opportunity.observedAt,
          opportunity.nextReviewAt,
          opportunity.raw.dataFresh === false ? "stale" : "fresh",
          JSON.stringify(opportunity.raw),
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
        deleteEvidence.run(opportunity.id);
        const evidence = [
          ["technical", opportunity.raw.trendConfirmation === true ? "supporting" : "conflicting", opportunity.raw.trendConfirmation === true ? "Trend confirmed" : "Trend not confirmed"],
          ["volume", opportunity.raw.volumeConfirmation === true ? "supporting" : "conflicting", opportunity.raw.volumeConfirmation === true ? "Volume confirmed" : "Volume not confirmed"],
          ["risk", opportunity.riskScore !== null && opportunity.riskScore >= 65 ? "supporting" : "conflicting", `Risk quality ${opportunity.riskScore === null ? "unavailable" : Math.round(opportunity.riskScore)}`],
        ];
        if (opportunity.mirror) evidence.push(["mirror", "supporting", `${opportunity.mirror.traderName || opportunity.mirror.sourceName} disclosure matched`]);
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
          JSON.stringify(type === "mirror" ? opportunity.mirror : {}),
        ));
        opportunity.news.forEach((item) => insertEvidence.run(
          `stock-evidence-${crypto.randomUUID()}`,
          opportunity.id,
          "news",
          "context",
          shortText(item.title, 300),
          shortText(item.publisher || opportunity.company?.source || "structured_news", 160),
          item.url || null,
          item.publishedAt || completedAt,
          opportunity.nextReviewAt,
          JSON.stringify({ directionalScoring: false, publisher: item.publisher || "" }),
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
    recordSystemEvent({ id: `research.completed:${runId}`, correlationId, type: "research.completed", actorType: "SYSTEM", newState: input.status || "success", reason: `${records.length} symbols persisted; ${opportunities.length} opportunities updated.`, data: { runId, symbolsScanned: records.length } });
    const reports = createDueReports(at, session);
    return { runId, correlationId, opportunities: listOpportunities(), reports };
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
      if (!sourceId || !sources.some((source) => String(source.id) === sourceId)) return;
      const eventId = shortText(candidate.fingerprint || candidate.id, 180);
      eventStatement.run(
        `stock-mirror-event-${fingerprint(`${sourceId}:${eventId}`).slice(0, 32)}`,
        sourceId, eventId, shortText(candidate.symbol, 12), shortText(candidate.side, 8),
        safeDate(candidate.transactionAt), safeDate(candidate.disclosedAt, completedAt), completedAt,
        Number.isFinite(Number(candidate.disclosureLagHours)) ? Math.round(Number(candidate.disclosureLagHours) * 3600) : null,
        shortText(candidate.sourceUrl, 1000) || null, shortText(candidate.status || "observed", 40), JSON.stringify(candidate),
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

  function buildReport(reportType, at = nowFn(), session = marketSession(at)) {
    const opportunities = listOpportunities(25);
    const actionable = opportunities.filter((item) => ["high_priority", "candidate"].includes(item.status)).slice(0, 10);
    const changed = opportunities.filter((item) => item.change?.trend !== "stable" || item.change?.thesisChanged).slice(0, 10);
    return {
      version: 1,
      type: reportType,
      generatedAt: at.toISOString(),
      marketSession: session,
      topOpportunities: actionable,
      thesisChanges: changed,
      summary: {
        researched: opportunities.length,
        highPriority: opportunities.filter((item) => item.status === "high_priority").length,
        candidates: opportunities.filter((item) => item.status === "candidate").length,
        mirrorMatched: opportunities.filter((item) => item.mirror).length,
        newsItems: opportunities.reduce((sum, item) => sum + (Array.isArray(item.news) ? item.news.length : 0), 0),
      },
      importantNews: opportunities.flatMap((item) => (item.news || []).map((news) => ({ symbol: item.symbol, ...news }))).slice(0, 20),
      limitations: [
        "Catalyst scores remain unavailable when no structured timestamped news observation was persisted.",
        reportType === "morning" ? "Every overnight thesis must be revalidated against current pre-market price, spread, liquidity, volume, and risk before execution." : "This report is research memory, not an order instruction.",
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
    recordSystemEvent({ id: `${reportType}.report_ready:${day}`, type: reportType === "overnight" ? "overnight.completed" : "morning.report_ready", reason: `${reportType} intelligence report persisted.`, data: { reportId: id, reportDay: day } });
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
    if (window.overnight && !existing.has("overnight")) reports.overnight = saveReport("overnight", at, session);
    if (window.morning && !existing.has("morning")) reports.morning = saveReport("morning", at, session);
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
        .map((row) => ({ ...row, data: parseJson(row.dataJson, {}), dataJson: undefined }));
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
        database: { status: "healthy", migration: "003_stock_mirror_source_controls" },
        marketData: { status: input.sourceHealth?.error ? "error" : input.sourceHealth?.stale ? "stale" : input.sourceHealth?.ready ? "healthy" : "waiting", updatedAt: latestRun?.completedAt || null },
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
    completeTelegramEvent,
    createDueReports,
    health,
    ingestSnapshot,
    latestReport,
    listOpportunities,
    mirrorState,
    recentEvents,
    recordApproval,
    recordOrderAudit,
    recordRiskDecision,
    recordSystemEvent,
    reserveTelegramEvent,
    saveReport,
    setMirrorSourceState,
    updateWorkerHeartbeat,
    upsertProposal,
  };
}

module.exports = {
  createStockIntelligenceStore,
  dataQualityScore,
  easternDay,
  opportunityFromRecord,
  reportWindow,
  riskQualityScore,
  weightedScore,
};

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DatabaseSync } = require("node:sqlite");
const { databasePath } = require("../services/local-database");
const {
  createStockIntelligenceStore,
  mirrorTimeliness,
  opportunityFromRecord,
  reportWindow,
} = require("../services/stock-intelligence-store");

test("Smart Money timeliness keeps delayed 13F disclosures research-only", () => {
  const delayed = mirrorTimeliness(
    { id: "sec_13f", sourceType: "manager_holdings" },
    { status: "paper_ready", humanGateEligible: true, transactionAt: "2026-03-31T20:00:00.000Z", disclosedAt: "2026-05-15T20:00:00.000Z" },
    "2026-05-15T20:01:00.000Z",
  );
  const current = mirrorTimeliness(
    { id: "sec_form4", sourceType: "official_disclosure" },
    { status: "paper_ready", humanGateEligible: true, transactionAt: "2026-08-13T05:00:00.000Z", disclosedAt: "2026-08-13T06:00:00.000Z" },
    "2026-08-13T06:01:00.000Z",
  );

  assert.equal(delayed.state, "DELAYED_DISCLOSURE");
  assert.equal(delayed.executionEligible, false);
  assert.equal(delayed.legalUse, "research_context_only");
  assert.equal(current.state, "CURRENT_DISCLOSURE");
  assert.equal(current.executionEligible, true);
});

function tempStore(at = "2026-08-13T06:00:00.000Z") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-stock-intelligence-"));
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return {
    root,
    dataDir,
    store: createStockIntelligenceStore({ dataDir, now: () => new Date(at) }),
  };
}

function record(overrides = {}) {
  return {
    ticker: "NET",
    status: "valid_setup",
    score: 91,
    confidence: "high",
    dataFresh: true,
    trendConfirmation: true,
    volumeConfirmation: true,
    spreadPassed: true,
    liquidityPassed: true,
    currentPrice: 180,
    stopLoss: 172,
    target1: 195,
    target2: 210,
    riskReward: "1:2.4",
    setupType: "Breakout retest",
    mainReasonValid: "Trend, price structure, and volume are aligned.",
    mainRisk: "Break below 172 invalidates the setup.",
    sourceUpdatedAt: "2026-08-13T05:58:00.000Z",
    ...overrides,
  };
}

test("stock intelligence migration creates durable command-center tables", (t) => {
  const fixture = tempStore();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const db = new DatabaseSync(databasePath(fixture.dataDir));
  t.after(() => db.close());
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
  for (const name of [
    "stock_research_runs", "stock_research_snapshots", "stock_opportunities", "stock_opportunity_evidence",
    "stock_research_reports", "stock_trade_proposals", "stock_trade_approvals", "stock_mirror_sources",
    "stock_mirror_events", "stock_mirror_consensus", "stock_telegram_events", "stock_system_events",
    "stock_risk_decisions", "stock_order_audit", "stock_worker_heartbeats",
    "stock_signal_journal", "stock_signal_price_observations", "stock_signal_outcomes", "stock_trade_journal",
    "stock_strategy_versions", "stock_strategy_change_proposals",
  ]) assert.equal(tables.has(name), true, `${name} should exist`);
});

test("market-closed research persists and continuing a thesis keeps first-seen history", (t) => {
  const fixture = tempStore("2026-08-13T06:00:00.000Z");
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const first = fixture.store.ingestSnapshot({ records: [record({ score: 65 })], sourceHealth: { ready: 1, total: 1 }, mirror: {} }, {
    completedAt: "2026-08-13T06:00:00.000Z",
    startedAt: "2026-08-13T05:59:00.000Z",
    cycleType: "night_research",
    session: { status: "closed", label: "Overnight research", regular: false },
  });
  assert.equal(first.opportunities.length, 1);
  assert.equal(first.opportunities[0].symbol, "NET");
  assert.equal(first.opportunities[0].catalystScore, null);
  assert.equal(first.opportunities[0].mirrorScore, null);
  const firstSeen = first.opportunities[0].firstSeenAt;

  const second = fixture.store.ingestSnapshot({ records: [record({ score: 100 })], sourceHealth: { ready: 1, total: 1 }, mirror: {} }, {
    completedAt: "2026-08-13T07:00:00.000Z",
    startedAt: "2026-08-13T06:59:00.000Z",
    cycleType: "night_research",
    session: { status: "closed", label: "Overnight research", regular: false },
  });
  assert.equal(second.opportunities[0].firstSeenAt, firstSeen);
  assert.equal(second.opportunities[0].change.trend, "rising");
  assert.equal(fixture.store.recentEvents().filter((event) => event.type === "research.completed").length, 2);
});

test("provider health transitions are returned only when persisted state changes", (t) => {
  const fixture = tempStore();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const first = fixture.store.ingestSnapshot({ records: [record()], mirror: {}, providerHealth: { status: "HEALTHY" } }, { completedAt: "2026-08-13T06:00:00.000Z", session: { status: "closed", regular: false } });
  const unchanged = fixture.store.ingestSnapshot({ records: [record()], mirror: {}, providerHealth: { status: "HEALTHY" } }, { completedAt: "2026-08-13T06:01:00.000Z", session: { status: "closed", regular: false } });
  const changed = fixture.store.ingestSnapshot({ records: [record()], mirror: {}, providerHealth: { status: "DEGRADED" } }, { completedAt: "2026-08-13T06:02:00.000Z", session: { status: "closed", regular: false } });
  assert.equal(first.providerHealthTransition, null);
  assert.equal(unchanged.providerHealthTransition, null);
  assert.deepEqual(changed.providerHealthTransition, { from: "HEALTHY", to: "DEGRADED", observedAt: "2026-08-13T06:02:00.000Z" });
});

test("opportunity scoring excludes unavailable mirror and catalyst inputs instead of fabricating them", () => {
  const opportunity = opportunityFromRecord(record(), {}, new Date("2026-08-13T06:00:00.000Z"));
  assert.equal(opportunity.mirrorScore, null);
  assert.equal(opportunity.catalystScore, null);
  assert.equal(opportunity.scoreFormula.version, "argentum-opportunity-v2");
  assert.equal(opportunity.scoreFormula.components.find((item) => item.name === "research_catalyst").available, false);
  assert.equal(opportunity.scoreFormula.components.find((item) => item.name === "smart_money").available, false);
  assert.equal(opportunity.scoreFormula.confidence.dataQuality, opportunity.dataQualityScore);
  assert.ok(opportunity.aiScore >= 0 && opportunity.aiScore <= 100);
});

test("fresh structured catalyst evidence changes the persisted opportunity score", () => {
  const at = new Date("2026-08-13T06:00:00.000Z");
  const withoutCatalyst = opportunityFromRecord(record(), {}, at, { directionalNewsScoring: true, tickers: [] });
  const withCatalyst = opportunityFromRecord(record(), {}, at, {
    directionalNewsScoring: true,
    tickers: [{
      ticker: "NET",
      catalystScore: 10,
      catalystConfidence: 0.8,
      catalystSummary: { positive: 0, negative: 1, neutral: 0, conflicts: false },
      news: [{
        title: "NET cuts guidance after earnings miss",
        publisher: "Reuters",
        publishedAt: "2026-08-13T05:30:00.000Z",
        url: "https://example.com/net",
        catalyst: { direction: "NEGATIVE", type: "EARNINGS", confidence: 0.8, freshness: "FRESH" },
      }],
    }],
  });

  assert.equal(withCatalyst.catalystScore, 10);
  assert.ok(withCatalyst.aiScore < withoutCatalyst.aiScore);
  assert.equal(withCatalyst.news[0].direction, "conflicting");
  assert.equal(withCatalyst.scoreFormula.components.find((item) => item.name === "research_catalyst").available, true);
  assert.ok(withCatalyst.blockers.some((item) => item.code === "severe_news"));
});

test("risk-off regime prevents a buy setup from becoming actionable", () => {
  const opportunity = opportunityFromRecord(record(), {}, new Date("2026-08-13T06:00:00.000Z"), {}, {}, {
    available: true,
    stale: false,
    riskState: "RISK_OFF",
    regime: "RISK_OFF_BEARISH_HIGH_VOL",
    trendRegime: "BEARISH",
    volatilityRegime: "HIGH",
    breadthState: "WEAK",
    symbols: { NET: { symbol: "NET", score: 75, state: "LEADING" } },
  });

  assert.equal(opportunity.status, "monitoring");
  assert.equal(opportunity.regimeContext.riskState, "RISK_OFF");
  assert.equal(opportunity.scoreFormula.components.find((item) => item.name === "market_sector").available, true);
  assert.ok(opportunity.blockers.some((item) => item.code === "market_regime"));
});

test("mirror events persist with honest delay and consensus requires distinct sources", (t) => {
  const fixture = tempStore();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const mirror = {
    sources: [
      { id: "sec_form4_a", name: "Official Form 4 A", type: "official_disclosure", enabled: true },
      { id: "sec_form4_b", name: "Official Form 4 B", type: "official_disclosure", enabled: true },
    ],
    candidates: [
      { id: "event-a", fingerprint: "event-a", sourceId: "sec_form4_a", symbol: "NET", side: "BUY", evidenceScore: 0.9, disclosedAt: "2026-08-13T05:00:00.000Z", disclosureLagHours: 1, sourceUrl: "https://www.sec.gov/a" },
      { id: "event-b", fingerprint: "event-b", sourceId: "sec_form4_b", symbol: "NET", side: "BUY", evidenceScore: 0.8, disclosedAt: "2026-08-12T22:00:00.000Z", disclosureLagHours: 8, sourceUrl: "https://www.sec.gov/b" },
    ],
  };
  fixture.store.ingestSnapshot({ records: [record()], mirror }, { completedAt: "2026-08-13T06:00:00.000Z", session: { status: "closed", regular: false } });
  const state = fixture.store.mirrorState();
  assert.equal(state.events.length, 2);
  assert.deepEqual(state.events.map((event) => event.delaySeconds).sort((a, b) => a - b), [3600, 28800]);
  assert.equal(state.consensus.length, 1);
  assert.equal(state.consensus[0].sourceCount, 2);
  assert.equal(state.sources.every((source) => source.following && !source.mirrorEnabled), true);
  const enabled = fixture.store.setMirrorSourceState("sec_form4_a", { mirrorEnabled: true, actorType: "WEB", actorId: "test-owner" });
  assert.equal(enabled.following, true);
  assert.equal(enabled.mirrorEnabled, true);
  const unfollowed = fixture.store.setMirrorSourceState("sec_form4_a", { following: false });
  assert.equal(unfollowed.following, false);
  assert.equal(unfollowed.mirrorEnabled, false);
});

test("overnight and morning reports are generated only in their session windows and persist", (t) => {
  const fixture = tempStore("2026-08-13T06:00:00.000Z");
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  fixture.store.ingestSnapshot({ records: [record()], mirror: {} }, { completedAt: "2026-08-13T06:00:00.000Z", session: { status: "closed", regular: false } });
  assert.equal(reportWindow(new Date("2026-08-13T06:00:00.000Z")).overnight, true);
  assert.equal(fixture.store.latestReport("overnight").type, "overnight");
  const morning = fixture.store.createDueReports(new Date("2026-08-13T12:15:00.000Z"), { status: "premarket", regular: false });
  assert.equal(morning.morning.type, "morning");
  assert.equal(fixture.store.latestReport("morning").summary.researched, 1);
  const daily = fixture.store.dailySummary(new Date("2026-08-13T12:16:00.000Z"));
  assert.equal(daily.day, "2026-08-13");
  assert.equal(daily.research.runs, 1);
  assert.equal(daily.research.symbolsScanned, 1);
  assert.equal(daily.reports.length, 2);
  assert.deepEqual(fixture.store.createDueReports(new Date("2026-08-13T12:16:00.000Z"), { status: "premarket", regular: false }), {});
});

test("Telegram and order audit idempotency persist in SQLite", (t) => {
  const fixture = tempStore();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const first = fixture.store.reserveTelegramEvent({ id: "telegram-one", idempotencyKey: "callback:immutable" });
  const duplicate = fixture.store.reserveTelegramEvent({ id: "telegram-two", idempotencyKey: "callback:immutable" });
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  fixture.store.completeTelegramEvent(first.id, { status: "processed" });
  fixture.store.recordOrderAudit({ id: "audit-one", correlationId: "research-proposal-approval-order", proposalId: "proposal-one", symbol: "NET", side: "BUY", action: "revalidated", oldState: "approved", newState: "blocked", reason: "Paper mode" });
  const db = new DatabaseSync(databasePath(fixture.dataDir));
  t.after(() => db.close());
  assert.equal(db.prepare("SELECT status FROM stock_telegram_events WHERE id = ?").get("telegram-one").status, "processed");
  assert.equal(db.prepare("SELECT new_state AS state FROM stock_order_audit WHERE id = ?").get("audit-one").state, "blocked");
});

test("signal journal preserves the original scored snapshot and locks matured outcomes", (t) => {
  const fixture = tempStore("2026-08-13T06:00:00.000Z");
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  fixture.store.ingestSnapshot({
    records: [record({ currentPrice: 180, sourceUpdatedAt: "2026-08-13T06:00:00.000Z", dataProvider: "TWELVE_DATA", dataHealthState: "HEALTHY" })],
    mirror: {},
  }, { completedAt: "2026-08-13T06:00:00.000Z", session: { status: "closed", regular: false } });

  const journal = fixture.store.signalJournal();
  assert.equal(journal.length, 1);
  assert.equal(journal[0].strategyVersion, "argentum-opportunity-v2");
  assert.equal(journal[0].referencePrice, 180);
  assert.equal(journal[0].data.providerProvenance.provider, "TWELVE_DATA");
  const originalHash = journal[0].snapshotHash;
  const db = new DatabaseSync(databasePath(fixture.dataDir));
  t.after(() => db.close());
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM stock_signal_price_observations").get().count, 0);

  fixture.store.captureDueSignalOutcomes([{ ticker: "NET", currentPrice: 189, dataProvider: "TWELVE_DATA", dataHealthState: "HEALTHY", dataSourceTimestamp: "2026-08-13T06:06:00.000Z" }], "2026-08-13T06:06:00.000Z");
  let measured = fixture.store.signalJournal()[0];
  assert.equal(measured.snapshotHash, originalHash);
  assert.equal(measured.outcomes.find((item) => item.horizon === "5m").outcomePrice, 189);
  assert.equal(measured.outcomes.find((item) => item.horizon === "5m").returnPct, 0.05);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM stock_signal_price_observations").get().count, 1);

  fixture.store.captureDueSignalOutcomes([{ ticker: "NET", currentPrice: 198, dataProvider: "TWELVE_DATA", dataHealthState: "HEALTHY" }], "2026-08-13T06:07:00.000Z");
  measured = fixture.store.signalJournal()[0];
  assert.equal(measured.outcomes.find((item) => item.horizon === "5m").outcomePrice, 189);
  assert.equal(measured.outcomes.find((item) => item.horizon === "5m").lockedAt, "2026-08-13T06:06:00.000Z");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM stock_signal_price_observations").get().count, 1);

  fixture.store.captureDueSignalOutcomes([{ ticker: "NET", currentPrice: 207, dataProvider: "TWELVE_DATA", dataHealthState: "HEALTHY" }], "2026-08-13T06:16:00.000Z");
  measured = fixture.store.signalJournal()[0];
  assert.equal(measured.outcomes.find((item) => item.horizon === "15m").outcomePrice, 207);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM stock_signal_price_observations").get().count, 2);
});

test("signal journal samples unchanged research no more than once per five minutes", (t) => {
  const fixture = tempStore("2026-08-13T06:00:00.000Z");
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const snapshot = { records: [record()], mirror: {} };
  fixture.store.ingestSnapshot(snapshot, { completedAt: "2026-08-13T06:00:00.000Z", session: { status: "closed", regular: false } });
  fixture.store.ingestSnapshot(snapshot, { completedAt: "2026-08-13T06:01:00.000Z", session: { status: "closed", regular: false } });
  assert.equal(fixture.store.signalJournal().length, 1);
  fixture.store.ingestSnapshot(snapshot, { completedAt: "2026-08-13T06:05:00.000Z", session: { status: "closed", regular: false } });
  assert.equal(fixture.store.signalJournal().length, 2);
});

test("blocked research is journaled once while actionable signals retain timed samples", (t) => {
  const fixture = tempStore("2026-08-13T06:00:00.000Z");
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const blocked = { records: [record({ status: "rejected", hardRejectionTriggered: true, score: 20 })], mirror: {} };
  fixture.store.ingestSnapshot(blocked, { completedAt: "2026-08-13T06:00:00.000Z", session: { status: "closed", regular: false } });
  fixture.store.ingestSnapshot(blocked, { completedAt: "2026-08-13T07:00:00.000Z", session: { status: "closed", regular: false } });
  assert.equal(fixture.store.signalJournal().length, 1);
});

test("research snapshots update one row per symbol in each thirty-minute bucket", (t) => {
  const fixture = tempStore("2026-08-13T06:00:00.000Z");
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const snapshot = { records: [record()], mirror: {} };
  fixture.store.ingestSnapshot(snapshot, { completedAt: "2026-08-13T06:00:00.000Z", session: { status: "closed", regular: false } });
  fixture.store.ingestSnapshot(snapshot, { completedAt: "2026-08-13T06:10:00.000Z", session: { status: "closed", regular: false } });
  fixture.store.ingestSnapshot(snapshot, { completedAt: "2026-08-13T06:31:00.000Z", session: { status: "closed", regular: false } });
  const db = new DatabaseSync(databasePath(fixture.dataDir));
  t.after(() => db.close());
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM stock_research_snapshots").get().count, 2);
});

test("research history compaction keeps recent blocked samples and never removes trade-linked signals", (t) => {
  const fixture = tempStore("2026-08-13T06:00:00.000Z");
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const db = new DatabaseSync(databasePath(fixture.dataDir));
  t.after(() => db.close());
  db.prepare(`INSERT INTO stock_research_runs
    (id, correlation_id, cycle_type, market_session, status, started_at, completed_at, symbols_scanned, signals_found, metadata_json)
    VALUES ('retention-run', 'retention-test', 'test', 'closed', 'success', ?, ?, 30, 0, '{}')`).run("2026-08-12T00:00:00.000Z", "2026-08-12T01:00:00.000Z");
  const insertSignal = db.prepare(`INSERT INTO stock_signal_journal
    (id, run_id, opportunity_id, strategy_version, symbol, direction, state, opportunity_score, observed_at, created_at, snapshot_hash, data_json)
    VALUES (?, 'retention-run', ?, 'test', 'NET', 'LONG', 'BLOCKED', 10, ?, ?, ?, '{}')`);
  for (let index = 0; index < 30; index += 1) {
    const observedAt = new Date(Date.parse("2026-08-12T00:00:00.000Z") + index * 60_000).toISOString();
    insertSignal.run(`blocked-${index}`, `stock-opportunity-NET-${index}`, observedAt, observedAt, `hash-${index}`);
  }
  db.prepare(`INSERT INTO stock_trade_journal
    (id, signal_id, broker_order_id, strategy_version, symbol, side, status, created_at, updated_at, data_json)
    VALUES ('trade-linked', 'blocked-0', 'broker-linked', 'test', 'NET', 'BUY', 'filled', ?, ?, '{}')`).run("2026-08-12T00:00:00.000Z", "2026-08-12T00:00:00.000Z");
  const compacted = fixture.store.compactResearchHistory({ force: true, at: "2026-08-13T06:00:00.000Z" });
  assert.equal(compacted.blockedSignalsRemoved, 23);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM stock_signal_journal WHERE state = 'BLOCKED'").get().count, 7);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM stock_signal_journal WHERE id = 'blocked-0'").get().count, 1);
});

test("verified broker transactions upsert a durable trade journal by broker order ID", (t) => {
  const fixture = tempStore();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  fixture.store.recordTradeJournal({ brokerOrderId: "rh-verified-one", strategyVersion: "argentum-opportunity-v2", symbol: "NET", side: "BUY", status: "submitted", quantity: 0.1, entryPrice: 180, openedAt: "2026-08-13T06:00:00.000Z" });
  fixture.store.recordTradeJournal({ brokerOrderId: "rh-verified-one", strategyVersion: "argentum-opportunity-v2", symbol: "NET", side: "BUY", status: "filled", quantity: 0.1, entryPrice: 180, updatedAt: "2026-08-13T06:01:00.000Z" });
  const db = new DatabaseSync(databasePath(fixture.dataDir));
  t.after(() => db.close());
  const rows = db.prepare("SELECT broker_order_id AS brokerOrderId, status, quantity, entry_price AS entryPrice FROM stock_trade_journal").all();
  assert.deepEqual(rows.map((row) => ({ ...row })), [{ brokerOrderId: "rh-verified-one", status: "filled", quantity: 0.1, entryPrice: 180 }]);
});

test("strategy governance registers the deployed version and never auto-activates proposals", (t) => {
  const fixture = tempStore();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  fixture.store.ingestSnapshot({ records: [record()], mirror: {} }, {
    completedAt: "2026-08-13T06:00:00.000Z",
    session: { status: "closed", regular: false },
  });
  const before = fixture.store.strategyGovernance();
  assert.equal(before.versions[0].version, "argentum-opportunity-v2");
  assert.equal(before.versions[0].status, "active");
  assert.equal(before.autoActivationAllowed, false);
  const proposal = fixture.store.proposeStrategyChange({
    proposedVersion: "argentum-opportunity-v2.1-review",
    rationale: "Measured 1d outcomes suggest a candidate threshold review.",
    configuration: { thresholds: { candidateScore: 78 } },
    evidence: { measuredSignals: 100 },
    actorType: "SYSTEM",
  });
  assert.equal(proposal.status, "pending_review");
  assert.equal(proposal.autoActivated, false);
  const after = fixture.store.strategyGovernance();
  assert.equal(after.versions.filter((item) => item.status === "active").length, 1);
  assert.equal(after.proposals[0].status, "pending_review");
});

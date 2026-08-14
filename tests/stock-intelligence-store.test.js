const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DatabaseSync } = require("node:sqlite");
const { databasePath } = require("../services/local-database");
const {
  createStockIntelligenceStore,
  opportunityFromRecord,
  reportWindow,
} = require("../services/stock-intelligence-store");

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
  ]) assert.equal(tables.has(name), true, `${name} should exist`);
});

test("market-closed research persists and continuing a thesis keeps first-seen history", (t) => {
  const fixture = tempStore("2026-08-13T06:00:00.000Z");
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const first = fixture.store.ingestSnapshot({ records: [record()], sourceHealth: { ready: 1, total: 1 }, mirror: {} }, {
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

test("opportunity scoring excludes unavailable mirror and catalyst inputs instead of fabricating them", () => {
  const opportunity = opportunityFromRecord(record(), {}, new Date("2026-08-13T06:00:00.000Z"));
  assert.equal(opportunity.mirrorScore, null);
  assert.equal(opportunity.catalystScore, null);
  assert.deepEqual(opportunity.scoreFormula.components.map((item) => item.name), ["technical", "risk", "data_quality"]);
  assert.ok(opportunity.aiScore >= 0 && opportunity.aiScore <= 100);
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

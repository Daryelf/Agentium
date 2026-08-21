const assert = require("node:assert/strict");
const test = require("node:test");

const { buildStockMarketWorkers, marketSession } = require("../services/stock-market-workers");

test("market session reports the actual regular New York trading window", () => {
  assert.equal(marketSession(new Date("2026-08-12T14:00:00.000Z")).regular, true);
  assert.equal(marketSession(new Date("2026-08-12T12:00:00.000Z")).status, "premarket");
  assert.equal(marketSession(new Date("2026-08-15T14:00:00.000Z")).status, "weekend");
});

test("market workers reflect real scheduler, source, mirror, news, reports, and broker evidence", () => {
  const output = buildStockMarketWorkers({
    snapshot: {
      records: [
        { ticker: "DBX", status: "valid_setup", score: 84, setupType: "Trend continuation" },
        { ticker: "AAPL", status: "watch", score: 72 },
      ],
      sourceHealth: { total: 9, ready: 7 },
      mirror: {
        available: true,
        generatedAt: "2026-08-12T13:55:00.000Z",
        summary: { signalsReceived: 5, paperReady: 1, researchOnly: 4 },
        importer: { enabledEntries: 3, signalsImported: 2 },
        importer13f: { enabledEntries: 2, signalsImported: 1 },
      },
    },
    brokerControl: {
      authenticationVerified: true,
      snapshotUpdatedAt: "2026-08-12T13:59:00.000Z",
      positions: [{ symbol: "DBX", quantity: 0.5 }],
      openOrderCount: 0,
      blockers: ["Verified buying power is unavailable or zero."],
    },
    portfolioPlan: { proposals: [{ symbol: "DBX", draftEligible: false }] },
    intelligenceScheduler: {
      enabled: true,
      running: true,
      currentStage: "evaluate",
      currentMessage: "Refreshing market evaluator records...",
      activeCadenceMinutes: 15,
      quietCadenceMinutes: 240,
      secIdentityConfigured: true,
      lastCompletedAt: "2026-08-12T13:45:00.000Z",
      nextRunAt: null,
    },
  }, { now: "2026-08-12T14:00:00.000Z" });

  assert.equal(output.workers.length, 8);
  assert.deepEqual(output.workers.map((worker) => worker.id), [
    "market-scanner", "signal-analyst", "mirror-watch", "filing-watch", "news-watch", "risk-sentinel", "overnight-research", "morning-intelligence",
  ]);
  assert.equal(output.workers[0].status, "working");
  assert.equal(output.workers[0].task, "Researching");
  assert.equal(output.workers.find((worker) => worker.id === "filing-watch").metrics[0].value, 2);
  assert.equal(output.workers.find((worker) => worker.id === "signal-analyst").metrics[0].value, 5);
  assert.equal(output.workers.find((worker) => worker.id === "news-watch").status, "blocked");
  assert.equal(output.workers.find((worker) => worker.id === "risk-sentinel").status, "watching");
  assert.match(output.workers.find((worker) => worker.id === "risk-sentinel").finding, /buying power/i);
  assert.equal(output.safety.canPlaceOrders, false);
  assert.ok(output.workers.every((worker) => worker.brokerAuthority === false));
});

test("workers expose blockers instead of pretending unavailable online inputs are active", () => {
  const output = buildStockMarketWorkers({
    snapshot: { records: [], sourceHealth: {}, mirror: {} },
    brokerControl: { authenticationVerified: false, positions: [], blockers: [] },
    portfolioPlan: {},
    intelligenceScheduler: { enabled: true, secIdentityConfigured: false },
  }, { now: "2026-08-12T14:00:00.000Z" });

  assert.equal(output.workers.find((worker) => worker.id === "filing-watch").status, "blocked");
  assert.match(output.workers.find((worker) => worker.id === "filing-watch").finding, /SEC identity/i);
  assert.equal(output.workers.find((worker) => worker.id === "risk-sentinel").status, "blocked");
});

test("overnight workers continue research while execution is closed", () => {
  const output = buildStockMarketWorkers({
    snapshot: { records: [{ ticker: "NET", status: "watch", score: 74 }], sourceHealth: { total: 1, ready: 1 }, mirror: {} },
    brokerControl: { authenticationVerified: true, positions: [], blockers: ["Market is closed."] },
    portfolioPlan: { proposals: [] },
    intelligenceScheduler: { enabled: true, running: true, currentStage: "evaluate", overnightCadenceMinutes: 60 },
    intelligence: { opportunities: [{ symbol: "NET", status: "candidate" }], reports: {} },
  }, { now: "2026-08-13T06:00:00.000Z" });

  assert.equal(output.market.status, "closed");
  assert.equal(output.workers.find((worker) => worker.id === "overnight-research").status, "working");
  assert.equal(output.scheduler.cadenceMinutes, 60);
  assert.equal(output.safety.canPlaceOrders, false);
});

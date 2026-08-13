const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createStockIntelligenceScheduler,
  marketWindow,
} = require("../services/stock-intelligence-scheduler");

function createClock(initial = "2026-08-10T14:00:00.000Z") {
  let current = new Date(initial);
  return {
    advance(milliseconds) {
      current = new Date(current.getTime() + milliseconds);
    },
    now() {
      return new Date(current);
    },
  };
}

function createTimers() {
  const scheduled = [];
  return {
    clearTimeoutImpl(timer) {
      timer.cleared = true;
    },
    scheduled,
    setTimeoutImpl(callback, delay) {
      const timer = { callback, delay, cleared: false, unrefCalled: false };
      timer.unref = () => { timer.unrefCalled = true; };
      scheduled.push(timer);
      return timer;
    },
  };
}

function successResult(message = "Intelligence refreshed.") {
  return {
    status: "success",
    message,
    completedAt: "2026-08-10T14:00:01.000Z",
    recordsMayHaveChanged: true,
    warnings: [],
    errors: [],
    liveOrdersPlaced: 0,
  };
}

test("market cadence distinguishes active weekday hours from quiet hours in New York", () => {
  assert.equal(marketWindow(new Date("2026-08-10T14:00:00.000Z")).active, true);
  assert.equal(marketWindow(new Date("2026-08-10T23:00:00.000Z")).active, false);
  assert.equal(marketWindow(new Date("2026-08-09T14:00:00.000Z")).active, false);
});

test("market-hours research defaults to a five-minute cadence", () => {
  const scheduler = createStockIntelligenceScheduler({
    refreshManager: { refresh: async () => successResult(), getStatus: () => ({}) },
    environment: {},
    now: createClock().now,
    setTimeoutImpl: createTimers().setTimeoutImpl,
    clearTimeoutImpl: () => {},
    allowInTests: true,
  });
  assert.equal(scheduler.start().activeCadenceMinutes, 5);
});

test("automatic refresh persists restart-safe status and has no broker authority", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-intelligence-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statusFile = path.join(directory, "scheduler.json");
  const clock = createClock();
  const timers = createTimers();
  const calls = [];
  const completions = [];
  const manager = {
    getStatus: () => ({ stage: "complete", message: "Done" }),
    refresh: async (options) => {
      calls.push(options);
      clock.advance(1_000);
      return successResult();
    },
  };
  const scheduler = createStockIntelligenceScheduler({
    refreshManager: manager,
    stockRoot: directory,
    statusFile,
    environment: {
      STOCK_GURU_AUTO_REFRESH_ACTIVE_MINUTES: "15",
      STOCK_GURU_AUTO_REFRESH_QUIET_MINUTES: "240",
      STOCK_GURU_AUTO_REFRESH_STARTUP_DELAY_MS: "1000",
    },
    now: clock.now,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
    onCompleted: (result) => completions.push(result.status),
    allowInTests: true,
  });

  const started = scheduler.start();
  scheduler.start();
  assert.equal(started.enabled, true);
  assert.equal(started.mode, "continuous_market_intelligence_no_broker");
  assert.equal(timers.scheduled[0].delay, 1_000);
  assert.equal(timers.scheduled.length, 1, "repeated startup must not create a second timer");
  assert.equal(timers.scheduled[0].unrefCalled, true);

  const completed = await scheduler.runNow({ trigger: "test" });
  assert.equal(completed.running, false);
  assert.equal(completed.lastResult.status, "success");
  assert.equal(completed.liveOrdersPlaced, 0);
  assert.equal(completed.brokerCalled, false);
  assert.equal(completed.safety.brokerToolsAvailable, false);
  assert.deepEqual(completions, ["success"]);
  assert.deepEqual(calls, [{ stockRoot: directory, includeSecForm4: false, includeSec13f: false }]);
  assert.match(completed.blockers[0], /SEC intake needs STOCK_GURU_SEC_USER_AGENT/i);
  assert.equal(completed.history.at(-1).trigger, "test");
  assert.equal(completed.history.at(-1).brokerCalled, false);
  assert.equal(fs.statSync(statusFile).mode & 0o777, 0o600);
  assert.equal(JSON.parse(fs.readFileSync(statusFile, "utf8")).brokerCalled, false);

  const restartedTimers = createTimers();
  const restarted = createStockIntelligenceScheduler({
    refreshManager: manager,
    stockRoot: directory,
    statusFile,
    environment: { STOCK_GURU_AUTO_REFRESH_ACTIVE_MINUTES: "15" },
    now: clock.now,
    setTimeoutImpl: restartedTimers.setTimeoutImpl,
    clearTimeoutImpl: restartedTimers.clearTimeoutImpl,
    allowInTests: true,
  });
  const restartStatus = restarted.start();
  assert.equal(restartStatus.history.length, 1);
  assert.equal(restartStatus.lastResult.status, "success");
  assert.equal(restartedTimers.scheduled[0].delay, 15 * 60_000);
});

test("SEC jobs use independent bounded cadences and concurrent runs share one promise", async () => {
  const clock = createClock();
  const timers = createTimers();
  const calls = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const manager = {
    getStatus: () => ({ stage: "evaluate", message: "Evaluating" }),
    refresh: async (options) => {
      calls.push(options);
      await gate;
      return successResult();
    },
  };
  const scheduler = createStockIntelligenceScheduler({
    refreshManager: manager,
    stockRoot: "/tmp/stock-intelligence-test",
    environment: {
      STOCK_GURU_SEC_USER_AGENT: "Argentum tests ops@example.com",
      STOCK_GURU_AUTO_FORM4_MINUTES: "60",
      STOCK_GURU_AUTO_13F_MINUTES: "1440",
    },
    now: clock.now,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
    allowInTests: true,
  });

  const first = scheduler.runNow({ trigger: "test" });
  const second = scheduler.runNow({ trigger: "scheduled" });
  assert.equal(first, second);
  assert.equal(scheduler.getStatus().running, true);
  release();
  const completed = await first;
  assert.equal(completed.running, false);
  assert.deepEqual(calls[0], {
    stockRoot: "/tmp/stock-intelligence-test",
    includeSecForm4: true,
    includeSec13f: true,
  });

  clock.advance(15 * 60_000);
  await scheduler.runNow({ trigger: "test" });
  assert.equal(calls[1].includeSecForm4, false);
  assert.equal(calls[1].includeSec13f, false);
});

test("refresh exceptions and synchronous completion callbacks fail safely", async () => {
  const clock = createClock();
  const timers = createTimers();
  const scheduler = createStockIntelligenceScheduler({
    refreshManager: {
      getStatus: () => ({ stage: "evaluate" }),
      refresh: async () => { throw new Error("network unavailable token=secret"); },
    },
    stockRoot: "/tmp/stock-intelligence-test",
    environment: {},
    now: clock.now,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
    onCompleted: () => undefined,
    allowInTests: true,
  });

  const completed = await scheduler.runNow({ trigger: "test" });
  assert.equal(completed.running, false);
  assert.equal(completed.lastResult.status, "failed");
  assert.equal(completed.liveOrdersPlaced, 0);
  assert.equal(completed.brokerCalled, false);
  assert.equal(timers.scheduled.length, 1);
});

test("manual refresh records SEC attempts and resets the automatic timer", () => {
  const clock = createClock();
  const timers = createTimers();
  const scheduler = createStockIntelligenceScheduler({
    refreshManager: { refresh: async () => successResult(), getStatus: () => ({}) },
    environment: { STOCK_GURU_SEC_USER_AGENT: "Argentum tests ops@example.com" },
    now: clock.now,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
    allowInTests: true,
  });
  scheduler.start();
  const recorded = scheduler.recordManualRefresh({
    ...successResult("Manual refresh completed."),
    startedAt: "2026-08-10T13:59:00.000Z",
    commands: [
      { name: "copy_refresh_sec", status: "success" },
      { name: "copy_refresh_13f", status: "failed" },
    ],
  });

  assert.equal(recorded.history.at(-1).trigger, "manual");
  assert.equal(recorded.history.at(-1).includeSecForm4, true);
  assert.equal(recorded.history.at(-1).includeSec13f, true);
  assert.equal(recorded.liveOrdersPlaced, 0);
  assert.equal(timers.scheduled[0].cleared, true);
  assert.equal(timers.scheduled.length, 2);
});

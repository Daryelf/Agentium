const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const test = require("node:test");

const {
  createStockGuruRefreshManager,
  enabledSecWatchlistEntries,
  readResearchProgress,
  researchTickers,
  validateWorkspace,
} = require("../services/stock-guru-refresh");

function createRunnableWorkspace(t, watchlist = { sec_form4: [], sec_13f: [] }) {
  const stockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-stock-runner-"));
  t.after(() => fs.rmSync(stockRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(stockRoot, ".venv", "bin"), { recursive: true });
  fs.mkdirSync(path.join(stockRoot, "src", "stock_guru"), { recursive: true });
  fs.mkdirSync(path.join(stockRoot, "config"), { recursive: true });
  fs.writeFileSync(path.join(stockRoot, ".venv", "bin", "python"), "python placeholder");
  fs.writeFileSync(path.join(stockRoot, "config", "copy_trader_watchlist.json"), JSON.stringify(watchlist));
  return stockRoot;
}

function successfulSpawn(calls) {
  return (executable, args, options) => {
    calls.push({ executable, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    process.nextTick(() => {
      child.stdout.end(`completed ${args[2]}\n`);
      child.emit("close", 0, null);
    });
    return child;
  };
}

test("refresh runs evaluator and guarded mirror plan without shell or broker commands", async (t) => {
  const stockRoot = createRunnableWorkspace(t);
  const calls = [];
  const manager = createStockGuruRefreshManager({ spawnImpl: successfulSpawn(calls), env: {}, timeoutMs: 2_000 });

  const first = manager.refresh({ stockRoot });
  const second = manager.refresh({ stockRoot });
  assert.equal(first, second, "concurrent refreshes must share one in-flight run");
  const result = await first;

  assert.equal(result.status, "success");
  assert.equal(result.liveOrdersPlaced, 0);
  assert.deepEqual(calls.map((call) => call.args[2]), ["evaluate", "copy-plan"]);
  const evaluateCall = calls.find((call) => call.args[2] === "evaluate");
  assert.deepEqual(evaluateCall.args.slice(evaluateCall.args.indexOf("--max-symbols"), evaluateCall.args.indexOf("--max-symbols") + 4), ["--max-symbols", "200", "--rotate-count", "200"]);
  assert.equal(calls.every((call) => call.options.shell === false), true);
  assert.equal(calls.every((call) => call.options.cwd === stockRoot), true);
  assert.equal(evaluateCall.options.env.STOCK_GURU_PROGRESS_FILE, path.join(stockRoot, "data", "argentum-research-progress.json"));
  assert.match(evaluateCall.options.env.STOCK_GURU_PROGRESS_RUN_ID, /^stock-refresh-/);
  assert.equal(evaluateCall.options.env.STOCK_GURU_PROGRESS_HOLD_MS, "500");
  assert.equal(JSON.stringify(calls).match(/order|broker|transfer|robinhood/gi), null);
  assert.equal(result.commands.find((command) => command.name === "copy_refresh_sec").status, "skipped");
  assert.equal(result.commands.find((command) => command.name === "copy_refresh_13f").status, "skipped");
});

test("stopping the refresh manager terminates the active evaluator and starts no follow-up command", async (t) => {
  const stockRoot = createRunnableWorkspace(t);
  const calls = [];
  const signals = [];
  const manager = createStockGuruRefreshManager({
    env: {},
    timeoutMs: 2_000,
    spawnImpl(executable, args, options) {
      calls.push({ executable, args, options });
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = (signal) => {
        signals.push(signal);
        process.nextTick(() => child.emit("close", null, signal));
        return true;
      };
      return child;
    },
  });

  const running = manager.refresh({ stockRoot });
  await new Promise((resolve) => setImmediate(resolve));
  const stopped = await manager.stop();
  const result = await running;

  assert.deepEqual(signals, ["SIGTERM"]);
  assert.deepEqual(calls.map((call) => call.args[2]), ["evaluate"]);
  assert.equal(result.status, "skipped");
  assert.equal(stopped.stage, "stopped");
  assert.match(stopped.message, /stopped cleanly/i);
});

test("refresh progress exposes only the current evaluator ticker and bounded batch progress", (t) => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-stock-progress-"));
  t.after(() => fs.rmSync(runtimeRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(runtimeRoot, "data"), { recursive: true });
  fs.writeFileSync(path.join(runtimeRoot, "data", "argentum-research-progress.json"), JSON.stringify({
    run_id: "stock-refresh-123",
    phase: "evaluate",
    symbols: ["AAPL", "MSFT", "BAD$"],
    current_ticker: "MSFT",
    completed: 1,
    total: 2,
    message: "Evaluating MSFT · 2 of 2.",
    universe_total: 5180,
    sweep_completed: 3020,
    sweep_number: 1,
    batch_number: 16,
    batch_count: 26,
    updated_at: "2026-08-18T21:00:00-04:00",
  }));

  assert.deepEqual(readResearchProgress(runtimeRoot, "stock-refresh-123"), {
    progressPhase: "evaluate",
    progressSymbols: ["AAPL", "MSFT"],
    currentTicker: "MSFT",
    progressCompleted: 1,
    progressTotal: 2,
    progressPct: 50,
    progressMessage: "Evaluating MSFT · 2 of 2.",
    progressUpdatedAt: "2026-08-19T01:00:00.000Z",
    universeTotal: 5180,
    sweepCompleted: 3020,
    sweepNumber: 1,
    batchNumber: 16,
    batchCount: 26,
  });
  assert.equal(readResearchProgress(runtimeRoot, "another-run"), null);
});

test("structured news research runs on a bounded shortlist from evaluator output", async (t) => {
  const stockRoot = createRunnableWorkspace(t);
  fs.mkdirSync(path.join(stockRoot, "reports"), { recursive: true });
  fs.writeFileSync(path.join(stockRoot, "reports", "evaluations.json"), JSON.stringify([
    { ticker: "NET", decision: "VALID_BUY_SETUP", score: 92 },
    { ticker: "AAPL", status: "watch", score: 78 },
    { ticker: "BAD$", status: "rejected", score: 99 },
  ]));
  const calls = [];
  const manager = createStockGuruRefreshManager({ spawnImpl: successfulSpawn(calls), env: {}, timeoutMs: 2_000 });
  const result = await manager.refresh({ stockRoot, includeResearch: true });
  assert.equal(result.status, "success");
  assert.deepEqual(researchTickers(stockRoot), ["NET", "AAPL"]);
  assert.deepEqual(calls.map((call) => call.args[2]), ["evaluate", "intraday-context", "research", "copy-plan"]);
  const contextCall = calls.find((call) => call.args[2] === "intraday-context");
  assert.equal(contextCall.args.includes("NET,AAPL"), true);
  const researchCall = calls.find((call) => call.args[2] === "research");
  assert.equal(researchCall.args.includes("NET,AAPL"), true);
  assert.equal(JSON.stringify(calls).match(/order|broker|transfer|robinhood/gi), null);
});

test("refresh writes through a separate runtime root when the source workspace is read-only", async (t) => {
  const stockRoot = createRunnableWorkspace(t);
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-stock-runtime-"));
  t.after(() => fs.rmSync(runtimeRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(stockRoot, "reports"), { recursive: true });
  fs.writeFileSync(path.join(stockRoot, "reports", "evaluations.json"), JSON.stringify([
    { ticker: "NET", status: "valid_setup", score: 92 },
  ]));
  const calls = [];
  const manager = createStockGuruRefreshManager({
    spawnImpl: successfulSpawn(calls),
    env: {},
    runtimeRoot,
    timeoutMs: 2_000,
  });

  const result = await manager.refresh({ stockRoot, includeResearch: true });

  assert.equal(result.status, "success");
  assert.equal(fs.existsSync(path.join(runtimeRoot, "reports", "evaluations.json")), true);
  assert.equal(calls.every((call) => call.options.cwd === stockRoot), true);
  assert.equal(calls.every((call) => call.options.env.STOCK_GURU_RUNTIME_DIR === runtimeRoot), true);
  assert.equal(calls.some((call) => call.args[2] === "research" && call.args.includes("NET")), true);
});

test("official SEC refresh runs only with enabled named CIKs and contact identity", async (t) => {
  const stockRoot = createRunnableWorkspace(t, {
    sec_form4: [{ label: "Named reporting person", cik: "0000123456", enabled: true }],
  });
  const calls = [];
  const manager = createStockGuruRefreshManager({
    spawnImpl: successfulSpawn(calls),
    env: { STOCK_GURU_SEC_USER_AGENT: "Argentum test contact@example.com" },
    timeoutMs: 2_000,
  });
  const result = await manager.refresh({ stockRoot });

  assert.equal(enabledSecWatchlistEntries(stockRoot), 1);
  assert.equal(result.status, "success");
  assert.deepEqual(calls.map((call) => call.args[2]), ["evaluate", "copy-refresh-sec", "copy-plan"]);
});

test("official SEC 13F manager comparison runs as a separate research-only intake", async (t) => {
  const stockRoot = createRunnableWorkspace(t, {
    sec_form4: [],
    sec_13f: [{ label: "Named manager", cik: "0001067983", enabled: true }],
  });
  const calls = [];
  const manager = createStockGuruRefreshManager({
    spawnImpl: successfulSpawn(calls),
    env: { STOCK_GURU_SEC_USER_AGENT: "Argentum test contact@example.com" },
    timeoutMs: 2_000,
  });
  const result = await manager.refresh({ stockRoot });

  assert.equal(enabledSecWatchlistEntries(stockRoot, fs, "sec_13f"), 1);
  assert.equal(result.liveOrdersPlaced, 0);
  assert.deepEqual(calls.map((call) => call.args[2]), ["evaluate", "copy-refresh-13f", "copy-plan"]);
});

test("automatic cadence can defer Form 4 and 13F independently without skipping evaluator work", async (t) => {
  const stockRoot = createRunnableWorkspace(t, {
    sec_form4: [{ label: "Named reporting person", cik: "0000123456", enabled: true }],
    sec_13f: [{ label: "Named manager", cik: "0001067983", enabled: true }],
  });
  const calls = [];
  const manager = createStockGuruRefreshManager({
    spawnImpl: successfulSpawn(calls),
    env: { STOCK_GURU_SEC_USER_AGENT: "Argentum test contact@example.com" },
    timeoutMs: 2_000,
  });
  const result = await manager.refresh({ stockRoot, includeSecForm4: false, includeSec13f: true });

  assert.equal(result.status, "success");
  assert.equal(result.liveOrdersPlaced, 0);
  assert.deepEqual(calls.map((call) => call.args[2]), ["evaluate", "copy-refresh-13f", "copy-plan"]);
  assert.match(result.commands.find((command) => command.name === "copy_refresh_sec").detail, /deferred/i);
});

test("missing workspace fails closed and preserves zero live orders", async () => {
  const manager = createStockGuruRefreshManager({ env: {}, timeoutMs: 1_000 });
  const result = await manager.refresh({ stockRoot: "/missing/stock-guru-workspace" });
  assert.equal(result.status, "failed");
  assert.equal(result.liveOrdersPlaced, 0);
  assert.match(result.errors[0], /not connected/i);
  assert.throws(() => validateWorkspace("/missing/stock-guru-workspace"), /not connected/i);
});

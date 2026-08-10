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
  validateWorkspace,
} = require("../services/stock-guru-refresh");

function createRunnableWorkspace(t, watchlist = { sec_form4: [] }) {
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
  assert.equal(calls.every((call) => call.options.shell === false), true);
  assert.equal(calls.every((call) => call.options.cwd === stockRoot), true);
  assert.equal(JSON.stringify(calls).match(/order|broker|transfer|robinhood/gi), null);
  assert.equal(result.commands.find((command) => command.name === "copy_refresh_sec").status, "skipped");
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

test("missing workspace fails closed and preserves zero live orders", async () => {
  const manager = createStockGuruRefreshManager({ env: {}, timeoutMs: 1_000 });
  const result = await manager.refresh({ stockRoot: "/missing/stock-guru-workspace" });
  assert.equal(result.status, "failed");
  assert.equal(result.liveOrdersPlaced, 0);
  assert.match(result.errors[0], /not connected/i);
  assert.throws(() => validateWorkspace("/missing/stock-guru-workspace"), /not connected/i);
});

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  answerStockQuestion,
  getStockRecord,
  listStockRecords,
  loadStockOfficeSnapshot,
  safeJoin,
  stockOverview,
} = require("../services/stock-office");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-stock-office-"));
  const stockRoot = path.join(root, "stocks");
  writeJson(path.join(stockRoot, "reports/evaluations.json"), [
    {
      ticker: "BAC",
      decision: "VALID_BUY_SETUP",
      score: 75,
      current_price: 40.12,
      setup_type: "Breakout pullback",
      entry_zone: "39.80-40.20",
      stop_loss: 38.9,
      target_1: 42,
      target_2: 44,
      main_risk: "Needs operator review because market data can stale quickly.",
      data_fresh: true,
      liquidity_passed: true,
      spread_passed: true,
      trend_confirmation: true,
      volume_confirmation: true,
    },
    {
      ticker: "XYZ",
      decision: "REJECT",
      score: 12,
      rejection_reason: "Liquidity failed.",
      data_fresh: false,
    },
  ]);
  writeText(path.join(stockRoot, "config/universe.txt"), "BAC\nMSFT\nNVDA\n");
  writeJson(path.join(stockRoot, "config/settings.json"), { mode: "paper" });
  writeJson(path.join(stockRoot, "data/broker_status.json"), {
    account_number: "123456789012",
    account_value: 24.99,
    cash: 0,
    buying_power: 0,
    positions: [{ symbol: "BAC", quantity: 1, average_buy_price: 39.5, current_price: 40.12 }],
    open_orders: [],
  });
  writeJson(path.join(stockRoot, "data/live_auto_arm_plan.json"), {
    action: "NOT_ARMABLE",
    ready_for_live_auto: false,
    blockers: ["buying_power is zero"],
    warnings: ["market data needs refresh"],
  });
  writeJson(path.join(stockRoot, "data/live_auto_launch_checklist.json"), {
    ready_for_live_auto: false,
    readiness: {
      checks: [{ name: "Broker buying power", passed: false, severity: "blocker", detail: "buying_power is zero" }],
    },
  });
  writeJson(path.join(stockRoot, "data/provider_keys.json"), {
    polygon_api_key: "super-secret-provider-key-1234567890",
  });
  writeText(path.join(stockRoot, "reports/latest_ticket.md"), "- Action: PAPER_REVIEW\n- Ticker: BAC\n- Reason: Valid setup only\n");
  writeText(path.join(stockRoot, "reports/mission.md"), "Local Stock Guru mission.");
  return { root, stockRoot };
}

test("Stock Office loads local records without exposing secrets", () => {
  const { root } = makeWorkspace();
  const snapshot = loadStockOfficeSnapshot({ rootDir: root, now: "2026-06-19T12:00:00.000Z" });
  const serialized = JSON.stringify(snapshot);

  assert.equal(snapshot.available, true);
  assert.equal(snapshot.records.length, 2);
  assert.equal(snapshot.sources.find((source) => source.id === "provider_keys").status, "configured");
  assert.match(snapshot.broker.account, /\*{4,}\d{4}$/);
  assert.equal(serialized.includes("super-secret-provider-key"), false);
  assert.equal(serialized.includes("123456789012"), false);
  assert.equal(snapshot.metrics.readyForLiveAuto, false);
});

test("Stock Office record APIs filter and retrieve sanitized records", () => {
  const { root } = makeWorkspace();
  const snapshot = loadStockOfficeSnapshot({ rootDir: root, now: "2026-06-19T12:00:00.000Z" });
  const listed = listStockRecords(snapshot, { status: "valid_setup", q: "bac", pageSize: 10 });
  const record = getStockRecord(snapshot, "BAC");
  const overview = stockOverview(snapshot);

  assert.equal(listed.total, 1);
  assert.equal(listed.records[0].ticker, "BAC");
  assert.equal(record.status, "valid_setup");
  assert.equal(overview.broker.buyingPower, "$0.00");
  assert.equal(overview.readiness.blockers.length > 0, true);
});

test("Stock Office assistant answers from local data with citations", () => {
  const { root } = makeWorkspace();
  const snapshot = loadStockOfficeSnapshot({ rootDir: root, now: "2026-06-19T12:00:00.000Z" });
  const answer = answerStockQuestion(snapshot, "What are the top setups and blockers?");

  assert.match(answer.answer, /research support only|Live auto is not armable/i);
  assert.equal(answer.citations.length > 0, true);
  assert.equal(answer.safeMode, "read_only");
});

test("safeJoin blocks path traversal outside Stock Guru workspace", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-stock-safejoin-"));
  assert.throws(() => safeJoin(root, "../outside.json"), /escaped/);
  assert.equal(safeJoin(root, "reports/evaluations.json").startsWith(root), true);
});

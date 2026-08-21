const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const test = require("node:test");

const {
  companyMatchScore,
  createStockTraderResearchAgent,
  resolveSymbolWithYahoo,
} = require("../services/stock-trader-research-agent");

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-trader-agent-"));
  const stockRoot = path.join(root, "stocks");
  const dataDir = path.join(root, "data");
  fs.mkdirSync(path.join(stockRoot, ".venv", "bin"), { recursive: true });
  fs.mkdirSync(path.join(stockRoot, "src", "stock_guru"), { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(stockRoot, ".venv", "bin", "python"), "placeholder");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, stockRoot, dataDir };
}

function artifactSpawn(calls) {
  return (executable, args, options) => {
    calls.push({ executable, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    process.nextTick(() => {
      const command = args[2];
      const runtimeRoot = options.env.STOCK_GURU_RUNTIME_DIR;
      fs.mkdirSync(path.join(runtimeRoot, "reports"), { recursive: true });
      fs.mkdirSync(path.join(runtimeRoot, "data"), { recursive: true });
      if (command === "evaluate") {
        fs.writeFileSync(path.join(runtimeRoot, "reports", "evaluations.json"), JSON.stringify([{
          ticker: "ACME", decision: "WATCH_ONLY", score: 81, confidence: "medium", current_price: 42,
          data_provider: "YAHOO_CHART", data_health_state: "HEALTHY", data_quality_score: 93,
        }]));
        fs.writeFileSync(path.join(runtimeRoot, "data", "market_context.json"), JSON.stringify({ regime: "NEUTRAL", risk_state: "NORMAL" }));
      }
      if (command === "intraday-context") {
        fs.writeFileSync(path.join(runtimeRoot, "data", "intraday_context.json"), JSON.stringify({ symbols: { ACME: { alignment: "MIXED", data_health_state: "HEALTHY", source_provider: "YAHOO_CHART", last_price: 42 } } }));
      }
      if (command === "research") {
        fs.writeFileSync(path.join(runtimeRoot, "reports", "research.json"), JSON.stringify({ tickers: [{ ticker: "ACME", company_name: "Acme Corporation", sector: "Industrials", recommendation: "hold", news: [] }] }));
      }
      child.stdout.end(`${command} complete\n`);
      child.emit("close", 0, null);
    });
    return child;
  };
}

async function waitForJob(agent, expectedStatuses) {
  for (let index = 0; index < 100; index += 1) {
    const job = agent.getState().jobs[0];
    if (job && expectedStatuses.includes(job.status)) return job;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Trader research job did not reach a terminal state.");
}

test("Yahoo symbol resolution requires a strong US equity company-name match", async () => {
  assert.ok(companyMatchScore("Acme Corporation", "Acme Corp") > 0.9);
  assert.ok(companyMatchScore("Acme Corporation", "Unrelated Systems") < 0.2);
  const resolution = await resolveSymbolWithYahoo({ issuerName: "Acme Corporation" }, {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ quotes: [
        { symbol: "ACME", quoteType: "EQUITY", exchange: "NMS", longname: "Acme Corporation" },
        { symbol: "ACMEX", quoteType: "MUTUALFUND", exchange: "NAS", longname: "Acme Fund" },
      ] }),
    }),
  });
  assert.equal(resolution.symbol, "ACME");
  assert.equal(resolution.provider, "Yahoo Finance search");
  await assert.rejects(
    resolveSymbolWithYahoo({ issuerName: "Acme Corporation" }, {
      fetchImpl: async () => ({ ok: true, json: async () => ({ quotes: [{ symbol: "WRONG", quoteType: "EQUITY", exchange: "NMS", longname: "Unrelated Systems" }] }) }),
    }),
    /no sufficiently confident/i,
  );
});

test("a trader signal deploys an isolated measured research job with no broker authority", async (t) => {
  const fixture = workspace(t);
  const calls = [];
  const agent = createStockTraderResearchAgent({
    dataDir: fixture.dataDir,
    stockRoot: fixture.stockRoot,
    runtimeRoot: fixture.stockRoot,
    spawnImpl: artifactSpawn(calls),
    env: { MASSIVE_API_KEY: "railway-injected-test-key" },
    timeoutMs: 2_000,
  });
  t.after(() => agent.stop());

  const queued = agent.enqueueSignals([{
    id: "sec13f-acme-2026q1",
    sourceId: "sec_13f",
    traderName: "Example Manager",
    issuerName: "Acme Corporation",
    securityIdentifier: "000000001",
    symbol: "ACME",
    tickerResolved: true,
    side: "BUY",
    disclosedAt: "2026-05-15T20:00:00Z",
    sourceUrl: "https://www.sec.gov/example",
  }]);
  assert.equal(queued.added, 1);
  const job = await waitForJob(agent, ["success", "partial", "failed"]);

  assert.equal(job.status, "success");
  assert.equal(job.symbol, "ACME");
  assert.deepEqual(calls.map((call) => call.args[2]), ["evaluate", "intraday-context", "research"]);
  assert.equal(calls.every((call) => call.options.shell === false), true);
  assert.equal(calls.every((call) => call.options.env.STOCK_GURU_RUNTIME_DIR.includes(job.id)), true);
  assert.equal(calls.every((call) => call.options.env.STOCK_GURU_MASSIVE_API_KEY === "railway-injected-test-key"), true);
  assert.equal(JSON.stringify(calls).match(/robinhood|broker|place.?order|transfer/gi), null);
  assert.equal(job.brokerCalled, false);
  assert.equal(job.liveOrdersPlaced, 0);
  assert.equal(job.result.evaluation.dataProvider, "YAHOO_CHART");
  assert.equal(job.result.artifactCount, 4);
  assert.equal(job.stages.every((stage) => stage.status === "success"), true);
  assert.ok(fs.existsSync(path.join(fixture.dataDir, "stock-trader-research-agents.json")));
});

test("an unresolved 13F holding is blocked before market research when ticker confidence fails", async (t) => {
  const fixture = workspace(t);
  const calls = [];
  const agent = createStockTraderResearchAgent({
    dataDir: fixture.dataDir,
    stockRoot: fixture.stockRoot,
    spawnImpl: artifactSpawn(calls),
    resolveSymbolImpl: async () => { throw new Error("No verified ticker match."); },
    env: {},
  });
  t.after(() => agent.stop());
  agent.enqueueSignals([{
    id: "sec13f-unresolved",
    sourceId: "sec_13f",
    traderName: "Example Manager",
    issuerName: "Unknown Issuer",
    securityIdentifier: "999999999",
    tickerResolved: false,
    side: "BUY",
  }]);

  const job = await waitForJob(agent, ["blocked"]);
  assert.equal(job.currentStage, "ticker_resolution");
  assert.match(job.message, /No verified ticker match/);
  assert.deepEqual(calls, []);
  assert.equal(job.liveOrdersPlaced, 0);
});

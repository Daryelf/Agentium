const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MODE,
  runAutonomousSimulationCycle,
  simulateCandidate,
} = require("../services/stock-simulation-engine");

function proposal(overrides = {}) {
  return {
    id: "portfolio-proposal-net",
    fingerprint: "a".repeat(64),
    kind: "native_entry",
    symbol: "NET",
    side: "BUY",
    requestedDollars: 5,
    referencePrice: 100,
    rankingScore: 0.82,
    research: { score: 82 },
    scores: { risk: 68 },
    outlook: { targetReturnPct: 0.1, downsidePct: 0.04 },
    ...overrides,
  };
}

test("autonomous simulation evaluates every current BUY candidate without broker authority", () => {
  const result = runAutonomousSimulationCycle({
    generatedAt: "2026-08-14T14:00:00.000Z",
    proposals: [proposal(), proposal({ id: "portfolio-proposal-aapl", fingerprint: "b".repeat(64), symbol: "AAPL" })],
  }, {}, {
    now: "2026-08-14T14:00:05.000Z",
    intervalMs: 2_000,
    configurationsPerCandidate: 16,
    pathsPerConfiguration: 8,
  });

  assert.equal(result.mode, MODE);
  assert.equal(result.status, "running");
  assert.equal(result.candidatesTested, 2);
  assert.equal(result.strategyConfigurations, 32);
  assert.equal(result.scenarioPaths, 256);
  assert.equal(result.results.length, 2);
  assert.ok(result.strategyConfigurationsPerSecond > 0);
  assert.ok(result.scenarioPathsPerSecond > 0);
  assert.equal(result.safety.liveOrderAuthority, false);
  assert.equal(result.safety.brokerToolsAvailableToEngine, false);
  assert.equal(result.liveOrderPlaced, false);
  assert.equal(result.brokerCalled, false);
  assert.equal(result.assumptions.marketHistoryUsed, false);
  assert.equal(result.assumptions.modeledPaths, true);
});

test("scenario outputs are deterministic for the same research snapshot and cycle bucket", () => {
  const options = {
    now: "2026-08-14T14:00:05.000Z",
    configurationsPerCandidate: 12,
    pathsPerConfiguration: 6,
  };
  const plan = { generatedAt: "2026-08-14T14:00:00.000Z", proposals: [proposal()] };
  const first = runAutonomousSimulationCycle(plan, {}, options);
  const second = runAutonomousSimulationCycle(plan, {}, options);

  assert.deepEqual(first.results, second.results);
  assert.equal(first.results[0].pathsTested, 72);
  assert.ok(first.results[0].bestConfiguration);
  assert.ok(["promising_scenario", "mixed_scenario", "high_scenario_risk"].includes(first.results[0].classification));
});

test("the engine ignores HOLD, missing-price, and malformed proposals instead of inventing results", () => {
  const result = runAutonomousSimulationCycle({
    proposals: [
      proposal({ side: "HOLD" }),
      proposal({ id: "missing", symbol: "BAD", referencePrice: 0 }),
      null,
    ],
  }, {}, { now: "2026-08-14T14:00:05.000Z" });

  assert.equal(result.candidatesTested, 0);
  assert.equal(result.strategyConfigurations, 0);
  assert.equal(result.scenarioPaths, 0);
  assert.deepEqual(result.results, []);
});

test("candidate work is bounded even when configuration options are excessive", () => {
  const result = simulateCandidate(proposal(), {
    cycleSeed: "bounded",
    configurationsPerCandidate: 10_000,
    pathsPerConfiguration: 10_000,
  });

  assert.equal(result.configurationsTested, 256);
  assert.equal(result.pathsPerConfiguration, 128);
  assert.equal(result.pathsTested, 32_768);
  assert.ok(result.finishPositiveRate >= 0 && result.finishPositiveRate <= 1);
  assert.ok(result.stopHitRate >= 0 && result.stopHitRate <= 1);
  assert.ok(result.targetHitRate >= 0 && result.targetHitRate <= 1);
});

test("cycle history is persisted but remains bounded", () => {
  let state = {};
  const plan = { generatedAt: "2026-08-14T14:00:00.000Z", proposals: [proposal()] };
  for (let index = 0; index < 30; index += 1) {
    state = runAutonomousSimulationCycle(plan, state, {
      now: new Date(Date.parse("2026-08-14T14:00:00.000Z") + index * 2_000).toISOString(),
      configurationsPerCandidate: 2,
      pathsPerConfiguration: 2,
    });
  }
  assert.equal(state.cycleCount, 30);
  assert.equal(state.recentCycles.length, 20);
  assert.equal(state.recentCycles.at(-1).cycle, 30);
});

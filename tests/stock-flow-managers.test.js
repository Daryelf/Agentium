const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createStockFlowManagerSupervisor,
  proposalFlow,
  validateResearchFlow,
  validateSimulationFlow,
} = require("../services/stock-flow-managers");

const VALIDATED_AT = "2026-08-21T14:00:00.000Z";

function currentPlan() {
  return {
    cycle: { session: { regular: true } },
    summary: { buys: 2 },
    decisions: [],
    proposals: [
      { id: "qualified-buy", symbol: "AAPL", side: "BUY", draftEligible: true, reviewState: "qualified", referencePrice: 220 },
      { id: "research-buy", symbol: "MSFT", side: "BUY", draftEligible: false, reviewState: "blocked", referencePrice: 510 },
    ],
  };
}

test("research manager validates qualified proposal handoff without exposing rejected research", () => {
  const plan = currentPlan();
  const flow = proposalFlow(plan);
  const report = validateResearchFlow({
    portfolioPlan: plan,
    intelligenceScheduler: { enabled: true, lastCompletedAt: VALIDATED_AT, lastResult: { status: "success" } },
    recordCount: 5200,
    opportunityCount: 17,
  }, VALIDATED_AT);

  assert.deepEqual(flow.qualified.map((proposal) => proposal.id), ["qualified-buy"]);
  assert.deepEqual(flow.boardEligible.map((proposal) => proposal.id), ["qualified-buy"]);
  assert.equal(report.status, "healthy");
  assert.equal(report.metrics.qualified, 1);
  assert.equal(report.metrics.boardEligible, 1);
  assert.match(report.checks.find((item) => item.id === "human-gate-boundary").detail, /cannot approve, dispatch, or place an order/);
});

test("research manager reports a decision-to-proposal propagation gap", () => {
  const plan = currentPlan();
  plan.summary.buys = 3;
  const report = validateResearchFlow({
    portfolioPlan: plan,
    intelligenceScheduler: { enabled: true, lastCompletedAt: VALIDATED_AT, lastResult: { status: "success" } },
    recordCount: 5200,
  }, VALIDATED_AT);

  assert.equal(report.status, "attention");
  assert.equal(report.checks.find((item) => item.id === "proposal-derivation").status, "fail");
});

test("simulation manager verifies candidate coverage and preserves its paper-only boundary", () => {
  const plan = currentPlan();
  const report = validateSimulationFlow({
    portfolioPlan: plan,
    simulationLab: {
      mode: "autonomous_local_stress_test",
      status: "running",
      cycleCount: 41,
      lastCycleAt: "2026-08-21T13:59:50.000Z",
      strategyConfigurations: 128,
      scenarioPaths: 4096,
      results: [
        { proposalId: "qualified-buy" },
        { proposalId: "research-buy" },
      ],
    },
    shadowPortfolio: { equityDollars: 75, cashDollars: 50, positions: [] },
  }, VALIDATED_AT);

  assert.equal(report.status, "healthy");
  assert.equal(report.metrics.covered, 2);
  assert.equal(report.metrics.missing, 0);
  assert.match(report.checks.find((item) => item.id === "simulation-boundary").detail, /no broker authority/);
});

test("manager activation persists and validation continues independently of the selected view", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-flow-managers-"));
  const collect = () => ({
    portfolioPlan: currentPlan(),
    intelligenceScheduler: { enabled: true, lastCompletedAt: VALIDATED_AT, lastResult: { status: "success" } },
    recordCount: 5200,
    opportunityCount: 17,
    simulationLab: {
      mode: "autonomous_local_stress_test",
      status: "running",
      lastCycleAt: VALIDATED_AT,
      results: [{ proposalId: "qualified-buy" }, { proposalId: "research-buy" }],
    },
    shadowPortfolio: { equityDollars: 75, cashDollars: 75, positions: [] },
  });
  try {
    const supervisor = createStockFlowManagerSupervisor({ dataDir, collect, now: () => VALIDATED_AT });
    const active = supervisor.setEnabled("research", true);
    assert.equal(active.activeCount, 1);
    assert.equal(active.managers[0].status, "healthy");
    assert.equal(active.managers[0].independentOfView, true);
    assert.equal(active.managers[0].authority, "validation_only");

    const restored = createStockFlowManagerSupervisor({ dataDir, collect, now: () => VALIDATED_AT });
    const restoredStatus = restored.runNow();
    assert.equal(restoredStatus.managers.find((manager) => manager.id === "research").enabled, true);
    assert.equal(restoredStatus.managers.find((manager) => manager.id === "simulation").enabled, false);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

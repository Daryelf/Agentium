const fs = require("node:fs");
const path = require("node:path");

const MANAGER_IDS = new Set(["research", "simulation"]);
const REAL_ORDER_STATES = new Set([
  "awaiting_human_gate",
  "approved",
  "dispatch_claimed",
  "submitting",
  "submitted",
  "partially_filled",
  "cancel_requested",
  "unknown_reconciling",
  "reconciliation_required",
  "dispatched",
  "filled",
]);

function safeDate(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function managerSettings(input = {}) {
  const managers = input?.managers && typeof input.managers === "object" ? input.managers : {};
  return {
    version: 1,
    managers: {
      research: {
        enabled: managers.research?.enabled === true,
        activatedAt: safeDate(managers.research?.activatedAt),
      },
      simulation: {
        enabled: managers.simulation?.enabled === true,
        activatedAt: safeDate(managers.simulation?.activatedAt),
      },
    },
  };
}

function proposalFlow(plan = {}) {
  const proposals = Array.isArray(plan.proposals) ? plan.proposals : [];
  const declined = new Set((Array.isArray(plan.decisions) ? plan.decisions : [])
    .filter((item) => item?.decision === "declined")
    .map((item) => item.proposalId));
  const current = proposals.filter((proposal) => proposal?.id && !declined.has(proposal.id));
  const actionCandidates = current.filter((proposal) => ["BUY", "SELL"].includes(proposal.side));
  const qualified = actionCandidates.filter((proposal) => proposal.draftEligible === true || REAL_ORDER_STATES.has(proposal.reviewState));
  const regularSession = plan.cycle?.session?.regular === true;
  const boardEligible = regularSession
    ? qualified
    : qualified.filter((proposal) => REAL_ORDER_STATES.has(proposal.reviewState));
  return { proposals, current, actionCandidates, qualified, boardEligible, regularSession };
}

function check(id, label, status, detail) {
  return { id, label, status, detail };
}

function statusFromChecks(checks, emptyState = "watching") {
  if (checks.some((item) => item.status === "fail")) return "attention";
  if (checks.some((item) => item.status === "warn")) return emptyState;
  return "healthy";
}

function validateResearchFlow(input = {}, validatedAt = new Date().toISOString()) {
  const plan = input.portfolioPlan || {};
  const scheduler = input.intelligenceScheduler || {};
  const flow = proposalFlow(plan);
  const recordCount = Number(input.recordCount || 0);
  const opportunityCount = Number(input.opportunityCount || 0);
  const advertisedBuys = Number(plan.summary?.buys || 0);
  const buyProposals = flow.actionCandidates.filter((proposal) => proposal.side === "BUY").length;
  const sellProposals = flow.actionCandidates.filter((proposal) => proposal.side === "SELL").length;
  const qualifiedBuys = flow.qualified.filter((proposal) => proposal.side === "BUY").length;
  const riskReviews = flow.actionCandidates.filter((proposal) => proposal.side === "BUY" && proposal.riskReviewEligible === true);
  const blockerCounts = new Map();
  flow.actionCandidates.filter((proposal) => proposal.draftEligible !== true).forEach((proposal) => {
    const blocker = String(proposal.blockers?.[0] || "Awaiting deeper evidence.").trim();
    blockerCounts.set(blocker, (blockerCounts.get(blocker) || 0) + 1);
  });
  const [topBlocker = "", topBlockerCount = 0] = [...blockerCounts.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  const buyDiscoveryActive = qualifiedBuys === 0 && sellProposals === 0;
  const lastResultStatus = String(scheduler.lastResult?.status || "idle").toLowerCase();
  const schedulerFailed = lastResultStatus === "failed";
  const schedulerActive = scheduler.enabled === true
    && Boolean(scheduler.running || scheduler.nextRunAt || scheduler.lastCompletedAt);
  const propagationGap = advertisedBuys > buyProposals;
  const unqualifiedOnBoard = flow.boardEligible.some((proposal) => !flow.qualified.includes(proposal));
  const checks = [
    check(
      "research-worker",
      "Research worker",
      schedulerFailed ? "fail" : schedulerActive ? "pass" : "warn",
      schedulerFailed
        ? "The latest persisted research cycle failed safely."
        : scheduler.running
          ? `Running ${String(scheduler.currentStage || "research").replaceAll("_", " ")} now.`
          : scheduler.lastCompletedAt
            ? `Last completed ${scheduler.lastCompletedAt}.`
            : "Waiting for the first scheduled cycle.",
    ),
    check(
      "research-persistence",
      "Persisted research",
      recordCount > 0 || opportunityCount > 0 ? "pass" : "warn",
      `${recordCount} evaluator records and ${opportunityCount} ranked opportunities are available.`,
    ),
    check(
      "proposal-derivation",
      "Proposal derivation",
      propagationGap ? "fail" : "pass",
      propagationGap
        ? `${advertisedBuys} BUY decisions were reported but only ${buyProposals} current BUY proposals were derived.`
        : `${flow.actionCandidates.length} current BUY/SELL candidate records were derived from the current cycle.`,
    ),
    check(
      "buy-discovery-focus",
      "BUY discovery focus",
      buyProposals > 0 ? "pass" : "warn",
      buyProposals > 0
        ? `${buyProposals} BUY idea${buyProposals === 1 ? " is" : "s are"} in the current plan; ${qualifiedBuys} passed every live-order gate.${topBlocker ? ` Most common first blocker (${topBlockerCount}): ${topBlocker}` : ""}`
        : "The evaluator is running, but this cycle has not derived a current BUY idea yet.",
    ),
    check(
      "trade-proposal-handoff",
      "Trade Proposals handoff",
      unqualifiedOnBoard ? "fail" : flow.qualified.length ? "pass" : "warn",
      flow.qualified.length
        ? `${flow.qualified.length} qualified; ${flow.boardEligible.length} currently eligible for the Trade Proposals board${flow.regularSession ? "." : " while the regular session is closed."}`
        : "No current BUY or SELL proposal has passed every qualification gate.",
    ),
    check(
      "human-gate-boundary",
      "Human Gate boundary",
      unqualifiedOnBoard ? "fail" : "pass",
      "Research validation cannot approve, dispatch, or place an order.",
    ),
  ];
  const status = statusFromChecks(checks);
  return {
    id: "research",
    name: "Research Manager",
    status,
    summary: status === "attention"
      ? "A research-to-proposal flow gap needs attention."
      : flow.qualified.length
        ? `${flow.qualified.length} qualified trade${flow.qualified.length === 1 ? "" : "s"} validated for the proposal flow.`
        : buyDiscoveryActive
          ? `BUY discovery active: ${buyProposals} idea${buyProposals === 1 ? "" : "s"} under review; no trade is qualified right now.`
          : "Research is being watched; no trade is qualified right now.",
    lastValidatedAt: validatedAt,
    metrics: {
      records: recordCount,
      opportunities: opportunityCount,
      actionable: flow.actionCandidates.length,
      buyIdeas: buyProposals,
      sellIdeas: sellProposals,
      qualifiedBuys,
      qualified: flow.qualified.length,
      boardEligible: flow.boardEligible.length,
      riskReviews: riskReviews.length,
      topBlocker,
      topBlockerCount,
      focus: buyDiscoveryActive ? "qualified_buy_discovery" : "portfolio_review",
    },
    checks,
  };
}

function validateSimulationFlow(input = {}, validatedAt = new Date().toISOString()) {
  const plan = input.portfolioPlan || {};
  const simulation = input.simulationLab || {};
  const shadow = input.shadowPortfolio || {};
  const candidates = (Array.isArray(plan.proposals) ? plan.proposals : [])
    .filter((proposal) => proposal.side === "BUY" && Number(proposal.referencePrice) > 0)
    .slice(0, 12);
  const results = Array.isArray(simulation.results) ? simulation.results : [];
  const resultIds = new Set(results.map((result) => result?.proposalId).filter(Boolean));
  const matched = candidates.filter((proposal) => resultIds.has(proposal.id));
  const missing = candidates.filter((proposal) => !resultIds.has(proposal.id));
  const running = simulation.mode === "autonomous_local_stress_test" && simulation.status === "running";
  const lastCycleAt = safeDate(simulation.lastCycleAt);
  const validatedTimestamp = Date.parse(validatedAt);
  const cycleAgeMs = lastCycleAt && Number.isFinite(validatedTimestamp)
    ? validatedTimestamp - Date.parse(lastCycleAt)
    : Number.POSITIVE_INFINITY;
  const stale = !lastCycleAt || cycleAgeMs > 90_000;
  const ledgerReady = Number.isFinite(Number(shadow.equityDollars)) && Number.isFinite(Number(shadow.cashDollars));
  const checks = [
    check(
      "simulation-engine",
      "Autonomous test engine",
      running && !stale ? "pass" : running ? "warn" : "fail",
      running
        ? `Cycle ${Number(simulation.cycleCount || 0)} completed ${lastCycleAt || "without a timestamp"}.`
        : "The autonomous local stress-test engine is not reporting a running state.",
    ),
    check(
      "candidate-coverage",
      "Candidate test coverage",
      candidates.length === 0 ? "warn" : missing.length === 0 ? "pass" : stale ? "fail" : "warn",
      candidates.length === 0
        ? "No priced BUY proposal is available for the current simulation cycle."
        : `${matched.length}/${candidates.length} priced BUY candidates have persisted simulation results${missing.length ? `; ${missing.length} remain queued.` : "."}`,
    ),
    check(
      "paper-ledger",
      "Paper ledger",
      ledgerReady ? "pass" : "warn",
      ledgerReady
        ? `Paper equity ${Number(shadow.equityDollars).toFixed(2)} with ${Array.isArray(shadow.positions) ? shadow.positions.length : 0} simulated positions.`
        : "The paper ledger is waiting for its first persisted snapshot.",
    ),
    check(
      "simulation-boundary",
      "Broker authority",
      "pass",
      "Simulation has no broker authority and cannot create a Human Gate approval.",
    ),
  ];
  const status = statusFromChecks(checks);
  return {
    id: "simulation",
    name: "Simulation Manager",
    status,
    summary: status === "attention"
      ? "The simulation engine or candidate coverage needs attention."
      : candidates.length
        ? `${matched.length}/${candidates.length} current candidates have measured test output.`
        : "Simulation is healthy and waiting for the next priced BUY candidate.",
    lastValidatedAt: validatedAt,
    metrics: {
      candidates: candidates.length,
      covered: matched.length,
      missing: missing.length,
      configurations: Number(simulation.strategyConfigurations || 0),
      paths: Number(simulation.scenarioPaths || 0),
    },
    checks,
  };
}

function createStockFlowManagerSupervisor(options = {}) {
  const dataDir = options.dataDir || path.join(process.cwd(), "data");
  const stateFile = options.stateFile || path.join(dataDir, "stock-flow-managers.json");
  const collect = typeof options.collect === "function" ? options.collect : () => ({});
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const intervalMs = Math.max(5_000, Math.min(60_000, Number(options.intervalMs) || 15_000));
  let settings = managerSettings();
  let reports = {};
  let timer = null;
  let running = false;

  try {
    settings = managerSettings(JSON.parse(fs.readFileSync(stateFile, "utf8")));
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn("Stock flow manager settings read failed safely:", error.message);
  }

  function persist() {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    const temporary = `${stateFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, stateFile);
  }

  function pausedReport(id) {
    const name = id === "research" ? "Research Manager" : "Simulation Manager";
    return {
      id,
      name,
      enabled: false,
      status: "paused",
      summary: "Paused by the operator.",
      lastValidatedAt: reports[id]?.lastValidatedAt || null,
      independentOfView: true,
      authority: "validation_only",
      metrics: reports[id]?.metrics || {},
      checks: reports[id]?.checks || [],
    };
  }

  function publicReport(id) {
    const config = settings.managers[id];
    if (!config.enabled) return pausedReport(id);
    const report = reports[id] || {
      id,
      name: id === "research" ? "Research Manager" : "Simulation Manager",
      status: "starting",
      summary: "Starting the first independent validation cycle.",
      lastValidatedAt: null,
      metrics: {},
      checks: [],
    };
    return {
      ...report,
      enabled: true,
      activatedAt: config.activatedAt,
      independentOfView: true,
      authority: "validation_only",
    };
  }

  function runNow() {
    if (running || !Object.values(settings.managers).some((manager) => manager.enabled)) return getStatus();
    running = true;
    const validatedAt = now();
    try {
      const input = collect() || {};
      if (settings.managers.research.enabled) reports.research = validateResearchFlow(input, validatedAt);
      if (settings.managers.simulation.enabled) reports.simulation = validateSimulationFlow(input, validatedAt);
    } catch (error) {
      for (const id of MANAGER_IDS) {
        if (!settings.managers[id].enabled) continue;
        reports[id] = {
          id,
          name: id === "research" ? "Research Manager" : "Simulation Manager",
          status: "attention",
          summary: "The manager could not read the latest persisted flow safely.",
          lastValidatedAt: validatedAt,
          metrics: {},
          checks: [check("manager-read", "Manager data read", "fail", String(error.message || "Validation failed safely.").slice(0, 300))],
        };
      }
    } finally {
      running = false;
    }
    return getStatus();
  }

  function getStatus() {
    const managers = [publicReport("research"), publicReport("simulation")];
    return {
      status: managers.some((manager) => manager.status === "attention")
        ? "attention"
        : managers.some((manager) => manager.enabled)
          ? "active"
          : "paused",
      activeCount: managers.filter((manager) => manager.enabled).length,
      attentionCount: managers.filter((manager) => manager.enabled && manager.status === "attention").length,
      independentOfView: true,
      authority: "validation_only",
      managers,
    };
  }

  function setEnabled(id, enabled) {
    if (!MANAGER_IDS.has(id)) throw new Error("Unknown Stock Office manager.");
    settings.managers[id] = {
      enabled: enabled === true,
      activatedAt: enabled === true ? settings.managers[id].activatedAt || now() : null,
    };
    persist();
    if (enabled === true) runNow();
    return getStatus();
  }

  function start() {
    if (timer) return timer;
    runNow();
    timer = setInterval(runNow, intervalMs);
    timer.unref?.();
    return timer;
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { getStatus, runNow, setEnabled, start, stop };
}

module.exports = {
  REAL_ORDER_STATES,
  createStockFlowManagerSupervisor,
  proposalFlow,
  validateResearchFlow,
  validateSimulationFlow,
};

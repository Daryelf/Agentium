const crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");

const MODE = "autonomous_local_stress_test";
const DEFAULT_CONFIGURATIONS_PER_CANDIDATE = 64;
const DEFAULT_PATHS_PER_CONFIGURATION = 32;
const MAX_CANDIDATES = 12;
const MAX_CONFIGURATIONS_PER_CANDIDATE = 256;
const MAX_PATHS_PER_CONFIGURATION = 128;
const MAX_RECENT_CYCLES = 20;

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max, fallback = min) {
  return Math.max(min, Math.min(max, finiteNumber(value, fallback)));
}

function rounded(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(finiteNumber(value, 0) * scale) / scale;
}

function safeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function safeSymbol(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
}

function seedFrom(value) {
  const digest = crypto.createHash("sha256").update(String(value || "")).digest();
  return digest.readUInt32LE(0) || 0x9e3779b9;
}

function randomGenerator(initialSeed) {
  let state = initialSeed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

function normalSample(random) {
  // Irwin-Hall is faster than Box-Muller and sufficient for bounded local
  // scenario stress tests. It is not presented as historical market data.
  let sum = 0;
  for (let index = 0; index < 6; index += 1) sum += random();
  return (sum - 3) * Math.SQRT2;
}

function percentile(sortedValues, fraction) {
  if (!sortedValues.length) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.floor((sortedValues.length - 1) * fraction)));
  return sortedValues[index];
}

function normalizePreviousState(input = {}) {
  const value = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    cycleCount: Math.max(0, Math.floor(finiteNumber(value.cycleCount, 0))),
    recentCycles: (Array.isArray(value.recentCycles) ? value.recentCycles : [])
      .filter((item) => item && typeof item === "object")
      .slice(-MAX_RECENT_CYCLES),
  };
}

function candidateInputs(proposal = {}) {
  const referencePrice = clamp(proposal.referencePrice, 0, 10_000_000, 0);
  const targetReturn = finiteNumber(proposal.outlook?.targetReturnPct, null);
  const downside = finiteNumber(proposal.outlook?.downsidePct, null);
  const score = clamp(
    finiteNumber(proposal.research?.score, null) !== null
      ? finiteNumber(proposal.research?.score, 50) / 100
      : finiteNumber(proposal.rankingScore, 0.5),
    0,
    1,
    0.5,
  );
  const riskScore = finiteNumber(proposal.scores?.risk, null);
  return {
    referencePrice,
    score,
    riskScore: riskScore === null ? null : clamp(riskScore / 100, 0, 1, 0.5),
    baseTargetPct: targetReturn === null ? 0.06 : clamp(targetReturn, 0.01, 0.5, 0.06),
    baseStopPct: downside === null ? 0.035 : clamp(downside, 0.005, 0.25, 0.035),
  };
}

function configurationAt(index, inputs) {
  const stopMultiplier = 0.7 + (index % 8) * 0.1;
  const targetMultiplier = 0.7 + (Math.floor(index / 8) % 8) * 0.12;
  const horizonSteps = 8 + (Math.floor(index / 16) % 4) * 4;
  const driftMultiplier = 0.55 + (Math.floor(index / 32) % 4) * 0.3;
  return {
    stopPct: clamp(inputs.baseStopPct * stopMultiplier, 0.004, 0.3, inputs.baseStopPct),
    targetPct: clamp(inputs.baseTargetPct * targetMultiplier, 0.008, 0.6, inputs.baseTargetPct),
    horizonSteps,
    driftMultiplier,
  };
}

function classifyResult(result) {
  if (result.finishPositiveRate >= 0.58 && result.expectedReturnPct > 0 && result.stopHitRate < 0.4) return "promising_scenario";
  if (result.finishPositiveRate < 0.45 || result.expectedReturnPct < -0.005 || result.stopHitRate > 0.55) return "high_scenario_risk";
  return "mixed_scenario";
}

function simulateCandidate(proposal, options = {}) {
  const configurations = Math.floor(clamp(
    options.configurationsPerCandidate,
    1,
    MAX_CONFIGURATIONS_PER_CANDIDATE,
    DEFAULT_CONFIGURATIONS_PER_CANDIDATE,
  ));
  const pathsPerConfiguration = Math.floor(clamp(
    options.pathsPerConfiguration,
    1,
    MAX_PATHS_PER_CONFIGURATION,
    DEFAULT_PATHS_PER_CONFIGURATION,
  ));
  const inputs = candidateInputs(proposal);
  const cycleSeed = String(options.cycleSeed || "stable-cycle");
  const random = randomGenerator(seedFrom(`${proposal.fingerprint || proposal.id}:${cycleSeed}`));
  const returns = [];
  let finishPositive = 0;
  let targetHits = 0;
  let stopHits = 0;
  let totalReturn = 0;
  let bestConfiguration = null;

  for (let configurationIndex = 0; configurationIndex < configurations; configurationIndex += 1) {
    const configuration = configurationAt(configurationIndex, inputs);
    const scoreEdge = (inputs.score - 0.5) * 0.0016;
    const riskPenalty = inputs.riskScore === null ? 0 : (0.5 - inputs.riskScore) * 0.0005;
    const stepDrift = (scoreEdge + riskPenalty) * configuration.driftMultiplier;
    const totalRange = inputs.baseTargetPct + inputs.baseStopPct;
    const stepVolatility = clamp(totalRange / Math.sqrt(configuration.horizonSteps) * 0.7, 0.0025, 0.045, 0.012);
    let configurationReturn = 0;
    let configurationWins = 0;
    let configurationDownside = 0;

    for (let pathIndex = 0; pathIndex < pathsPerConfiguration; pathIndex += 1) {
      let pathReturn = 0;
      let hit = "horizon";
      for (let step = 0; step < configuration.horizonSteps; step += 1) {
        pathReturn += stepDrift + stepVolatility * normalSample(random);
        if (pathReturn >= configuration.targetPct) {
          pathReturn = configuration.targetPct;
          hit = "target";
          break;
        }
        if (pathReturn <= -configuration.stopPct) {
          pathReturn = -configuration.stopPct;
          hit = "stop";
          break;
        }
      }
      if (pathReturn > 0) {
        finishPositive += 1;
        configurationWins += 1;
      }
      if (hit === "target") targetHits += 1;
      if (hit === "stop") stopHits += 1;
      if (pathReturn < 0) configurationDownside += Math.abs(pathReturn);
      configurationReturn += pathReturn;
      totalReturn += pathReturn;
      returns.push(pathReturn);
    }

    const expectancy = configurationReturn / pathsPerConfiguration;
    const downsidePenalty = configurationDownside / pathsPerConfiguration;
    const quality = expectancy - downsidePenalty * 0.35 + (configurationWins / pathsPerConfiguration - 0.5) * 0.01;
    if (!bestConfiguration || quality > bestConfiguration.quality) {
      bestConfiguration = {
        id: `cfg-${String(configurationIndex + 1).padStart(3, "0")}`,
        quality,
        expectedReturnPct: expectancy,
        finishPositiveRate: configurationWins / pathsPerConfiguration,
        stopPct: configuration.stopPct,
        targetPct: configuration.targetPct,
        horizonSteps: configuration.horizonSteps,
      };
    }
  }

  returns.sort((a, b) => a - b);
  const pathsTested = returns.length;
  const result = {
    proposalId: String(proposal.id || "").slice(0, 120),
    proposalFingerprint: String(proposal.fingerprint || "").slice(0, 64),
    symbol: safeSymbol(proposal.symbol),
    side: String(proposal.side || "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY",
    kind: String(proposal.kind || "research_candidate").slice(0, 60),
    referencePrice: rounded(inputs.referencePrice, 4),
    researchScore: rounded(inputs.score * 100, 2),
    configurationsTested: configurations,
    pathsPerConfiguration,
    pathsTested,
    finishPositiveRate: rounded(finishPositive / Math.max(1, pathsTested)),
    targetHitRate: rounded(targetHits / Math.max(1, pathsTested)),
    stopHitRate: rounded(stopHits / Math.max(1, pathsTested)),
    expectedReturnPct: rounded(totalReturn / Math.max(1, pathsTested)),
    medianReturnPct: rounded(percentile(returns, 0.5)),
    downsideP10Pct: rounded(percentile(returns, 0.1)),
    upsideP90Pct: rounded(percentile(returns, 0.9)),
    bestConfiguration: bestConfiguration ? {
      id: bestConfiguration.id,
      expectedReturnPct: rounded(bestConfiguration.expectedReturnPct),
      finishPositiveRate: rounded(bestConfiguration.finishPositiveRate),
      stopPct: rounded(bestConfiguration.stopPct),
      targetPct: rounded(bestConfiguration.targetPct),
      horizonSteps: bestConfiguration.horizonSteps,
    } : null,
  };
  result.classification = classifyResult(result);
  return result;
}

function runAutonomousSimulationCycle(plan = {}, previous = {}, options = {}) {
  const at = options.now ? new Date(options.now) : new Date();
  const intervalMs = Math.floor(clamp(options.intervalMs, 1_000, 60_000, 3_000));
  const normalizedPrevious = normalizePreviousState(previous);
  const proposals = (Array.isArray(plan.proposals) ? plan.proposals : [])
    .filter((proposal) => proposal && proposal.side === "BUY" && safeSymbol(proposal.symbol) && finiteNumber(proposal.referencePrice, 0) > 0)
    .slice(0, MAX_CANDIDATES);
  const sourceVersion = crypto.createHash("sha256")
    .update(proposals.map((proposal) => proposal.fingerprint || proposal.id).join(":"))
    .digest("hex");
  // A minute bucket gives repeatable results for the same research snapshot
  // while still exercising a fresh deterministic scenario set over time.
  const cycleSeed = `${sourceVersion}:${Math.floor(at.getTime() / 60_000)}`;
  const started = performance.now();
  const results = proposals.map((proposal) => simulateCandidate(proposal, {
    configurationsPerCandidate: options.configurationsPerCandidate,
    pathsPerConfiguration: options.pathsPerConfiguration,
    cycleSeed,
  }));
  const durationMs = Math.max(0.001, performance.now() - started);
  const strategyConfigurations = results.reduce((sum, item) => sum + item.configurationsTested, 0);
  const scenarioPaths = results.reduce((sum, item) => sum + item.pathsTested, 0);
  const cycle = {
    cycle: normalizedPrevious.cycleCount + 1,
    completedAt: at.toISOString(),
    durationMs: rounded(durationMs, 3),
    candidatesTested: results.length,
    strategyConfigurations,
    scenarioPaths,
    strategyConfigurationsPerSecond: Math.round(strategyConfigurations / (durationMs / 1_000)),
    scenarioPathsPerSecond: Math.round(scenarioPaths / (durationMs / 1_000)),
  };
  return {
    version: 1,
    mode: MODE,
    status: "running",
    methodology: "forward_scenario_stress_test_not_historical_backtest",
    cycleCount: cycle.cycle,
    intervalMs,
    lastCycleAt: cycle.completedAt,
    nextCycleAt: new Date(at.getTime() + intervalMs).toISOString(),
    sourceGeneratedAt: safeDate(plan.generatedAt),
    sourceFingerprint: sourceVersion,
    durationMs: cycle.durationMs,
    candidatesTested: cycle.candidatesTested,
    strategyConfigurations,
    scenarioPaths,
    strategyConfigurationsPerSecond: cycle.strategyConfigurationsPerSecond,
    scenarioPathsPerSecond: cycle.scenarioPathsPerSecond,
    results,
    recentCycles: [...normalizedPrevious.recentCycles, cycle].slice(-MAX_RECENT_CYCLES),
    assumptions: {
      source: "current_persisted_research_and_proposal_risk_levels",
      marketHistoryUsed: false,
      modeledPaths: true,
      profitProbabilityClaimed: false,
    },
    safety: {
      simulationOnly: true,
      liveOrderAuthority: false,
      brokerToolsAvailableToEngine: false,
      humanGateRequiredForEveryLiveOrder: true,
    },
    liveOrderPlaced: false,
    brokerCalled: false,
  };
}

module.exports = {
  DEFAULT_CONFIGURATIONS_PER_CANDIDATE,
  DEFAULT_PATHS_PER_CONFIGURATION,
  MODE,
  runAutonomousSimulationCycle,
  simulateCandidate,
};

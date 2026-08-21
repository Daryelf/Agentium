const { marketSession } = require("./stock-market-calendar");

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function shortText(value, maximum = 180) {
  return String(value || "").trim().slice(0, maximum);
}

function latestCommand(scheduler = {}, name) {
  const commands = Array.isArray(scheduler.currentCommands) ? scheduler.currentCommands : [];
  return commands.find((command) => command?.name === name) || null;
}

function workerState({ enabled = true, running = false, blocked = false, observing = false } = {}) {
  if (!enabled) return "paused";
  if (blocked) return "blocked";
  if (running) return "working";
  return observing ? "watching" : "scheduled";
}

function buildStockMarketWorkers(input = {}, options = {}) {
  const at = options.now ? new Date(options.now) : new Date();
  const snapshot = input.snapshot || {};
  const control = input.brokerControl || {};
  const portfolio = input.portfolioPlan || {};
  const scheduler = input.intelligenceScheduler || {};
  const mirror = snapshot.mirror || {};
  const records = Array.isArray(snapshot.records) ? snapshot.records : [];
  const positions = Array.isArray(control.positions) ? control.positions : [];
  const sourceHealth = snapshot.sourceHealth || {};
  const summary = mirror.summary || {};
  const form4 = mirror.importer || {};
  const form13f = mirror.importer13f || {};
  const schedulerRunning = scheduler.running === true;
  const stage = String(scheduler.currentStage || "");
  const enabled = scheduler.enabled !== false;
  const session = marketSession(at);
  const validSetups = records.filter((record) => record?.status === "valid_setup");
  const topSetup = validSetups[0] || records[0] || null;
  const proposals = Array.isArray(portfolio.proposals) ? portfolio.proposals : [];
  const readyProposals = proposals.filter((proposal) => proposal?.draftEligible);
  const riskBlockers = Array.isArray(control.blockers) ? control.blockers : [];
  const scannerRunning = schedulerRunning && ["preflight", "evaluate"].includes(stage);
  const filingRunning = schedulerRunning && ["copy_refresh_sec", "copy_refresh_13f"].includes(stage);
  const mirrorRunning = schedulerRunning && stage === "copy_plan";
  const secConfigured = scheduler.secIdentityConfigured === true;
  const sourceTotal = finiteNumber(sourceHealth.total);
  const sourceReady = finiteNumber(sourceHealth.ready);
  const sourceRows = Array.isArray(snapshot.sources) ? snapshot.sources : [];
  const newsSource = sourceRows.find((source) => /research|news/i.test(`${source.id || ""} ${source.label || ""}`));
  const opportunityState = input.intelligence || {};
  const opportunities = Array.isArray(opportunityState.opportunities) ? opportunityState.opportunities : [];
  const reports = opportunityState.reports || {};
  const sessionCadence = session.status === "regular"
    ? scheduler.activeCadenceMinutes || 5
    : session.status === "premarket"
      ? scheduler.premarketCadenceMinutes || 10
      : session.status === "afterhours"
        ? scheduler.afterHoursCadenceMinutes || 15
        : session.status === "weekend"
          ? scheduler.weekendCadenceMinutes || 240
          : scheduler.overnightCadenceMinutes || 60;

  function compactWorker(value) {
    return {
      brokerAuthority: false,
      lastRunAt: safeDate(value.lastRunAt),
      nextRunAt: safeDate(value.nextRunAt),
      details: (Array.isArray(value.details) ? value.details : []).filter(Boolean).slice(0, 8),
      ...value,
      brokerAuthority: false,
    };
  }

  const workers = [
    compactWorker({
      id: "market-scanner",
      initials: "MS",
      name: "Market Scanner",
      role: "Prices + setups",
      status: workerState({ enabled, running: scannerRunning, observing: true }),
      task: scannerRunning ? "Researching" : enabled ? "Watching" : "Paused",
      metrics: [
        { label: "Universe", value: records.length },
        { label: "Candidates", value: opportunities.filter((item) => ["candidate", "high_priority"].includes(item.status)).length || validSetups.length },
        { label: "High", value: opportunities.filter((item) => item.status === "high_priority").length },
      ],
      finding: topSetup ? `${topSetup.ticker} · ${topSetup.score ?? "—"}` : "No fresh setup",
      lastRunAt: safeDate(scheduler.lastCompletedAt),
      nextRunAt: safeDate(scheduler.nextRunAt),
      evidence: `${sourceReady}/${sourceTotal || 0} sources`,
      details: [scheduler.currentMessage, topSetup?.setupType, topSetup?.mainRisk],
    }),
    compactWorker({
      id: "signal-analyst",
      initials: "SA",
      name: "Signal Analyst",
      role: "Evidence correlation",
      status: workerState({ enabled, running: mirrorRunning, observing: true }),
      task: mirrorRunning ? "Correlating" : "Watching",
      metrics: [
        { label: "Signals", value: finiteNumber(summary.signalsReceived) },
        { label: "Confirmed", value: opportunities.filter((item) => item.confidence === "high").length },
        { label: "Conflicts", value: opportunities.filter((item) => item.evidence?.some?.((evidence) => evidence.direction === "conflicting")).length },
      ],
      finding: readyProposals.length ? `${readyProposals.length} qualified` : "No qualified action",
      lastRunAt: safeDate(mirror.generatedAt || scheduler.lastCompletedAt),
      nextRunAt: safeDate(scheduler.nextRunAt),
      evidence: "Evaluator + public evidence",
      details: ["Missing inputs remain unavailable and are excluded from the score.", `${finiteNumber(summary.researchOnly)} mirror signals remain research-only.`],
    }),
    compactWorker({
      id: "mirror-watch",
      initials: "MW",
      name: "Mirror Watch",
      role: "People + funds",
      status: workerState({ enabled, running: mirrorRunning, observing: Boolean(mirror.available) }),
      task: mirrorRunning ? "Refreshing" : "Watching",
      metrics: [
        { label: "Traders", value: finiteNumber(form4.enabledEntries) + finiteNumber(form13f.enabledEntries) },
        { label: "New", value: finiteNumber(summary.signalsReceived) },
        { label: "Consensus", value: Array.isArray(opportunityState.mirror?.consensus) ? opportunityState.mirror.consensus.length : 0 },
      ],
      finding: finiteNumber(summary.paperReady) ? `${finiteNumber(summary.paperReady)} current signal${finiteNumber(summary.paperReady) === 1 ? "" : "s"}` : "No current mirror signal",
      lastRunAt: safeDate(mirror.generatedAt || scheduler.lastCompletedAt),
      nextRunAt: safeDate(scheduler.nextRunAt),
      evidence: "Attributable public sources",
      details: ["Form 13F and congressional disclosures remain delayed research only.", "Mirror evidence informs independent research; it never bypasses Human Gate."],
    }),
    compactWorker({
      id: "filing-watch",
      initials: "FW",
      name: "SEC Watch",
      role: "SEC Form 4 + 13F",
      status: workerState({ enabled, running: filingRunning, blocked: !secConfigured }),
      task: filingRunning ? "Researching" : secConfigured ? "Watching" : "Blocked",
      metrics: [
        { label: "Form 4", value: finiteNumber(form4.signalsImported) },
        { label: "13F", value: finiteNumber(form13f.signalsImported) },
        { label: "Relevant", value: finiteNumber(summary.paperReady) },
      ],
      finding: secConfigured ? `${finiteNumber(form4.enabledEntries) + finiteNumber(form13f.enabledEntries)} sources` : "SEC identity required",
      lastRunAt: safeDate(scheduler.lastForm4AttemptAt || scheduler.last13fAttemptAt),
      nextRunAt: safeDate(scheduler.nextRunAt),
      evidence: "Official SEC",
      details: [secConfigured ? "SEC requests are bounded and rate limited." : "Set STOCK_GURU_SEC_USER_AGENT to an organization and monitored contact email.", "13F holdings do not reveal an exact trade time or price."],
    }),
    compactWorker({
      id: "news-watch",
      initials: "NW",
      name: "News Watch",
      role: "Catalysts + earnings",
      status: workerState({ enabled, blocked: !newsSource, observing: Boolean(newsSource) }),
      task: newsSource ? "Watching" : "No structured feed",
      metrics: [
        { label: "Items", value: Number(snapshot.research?.newsCount || 0) },
        { label: "Tickers", value: Array.isArray(snapshot.research?.tickers) ? snapshot.research.tickers.length : 0 },
      ],
      finding: newsSource ? `${Number(snapshot.research?.newsCount || 0)} structured items` : "Catalyst score unavailable",
      lastRunAt: safeDate(snapshot.research?.generatedAt || scheduler.lastCompletedAt),
      nextRunAt: safeDate(scheduler.nextRunAt),
      evidence: newsSource ? newsSource.label || "Research source" : "Not scored",
      details: [newsSource?.summary, "Headlines retain source/time/URL context but are not treated as directional sentiment or an execution score."],
    }),
    compactWorker({
      id: "risk-sentinel",
      initials: "RS",
      name: "Risk Sentinel",
      role: "Robinhood account",
      status: workerState({ enabled: true, observing: control.authenticationVerified === true, blocked: control.authenticationVerified !== true }),
      task: control.authenticationVerified ? "Watching" : "Blocked",
      metrics: [
        { label: "Positions", value: positions.length },
        { label: "Warnings", value: Math.max(0, riskBlockers.length - 1) },
        { label: "Blocks", value: riskBlockers.length },
      ],
      finding: riskBlockers[0] || "Checks clear",
      lastRunAt: safeDate(control.snapshotUpdatedAt),
      nextRunAt: null,
      evidence: control.authenticationVerified ? "Official Robinhood snapshot" : "Broker evidence unavailable",
      details: riskBlockers.length ? riskBlockers : ["Positions, open orders, account freshness, buying power, P&L, and limits are checked."],
    }),
    compactWorker({
      id: "overnight-research",
      initials: "NR",
      name: "Night Research",
      role: "Next-session preparation",
      status: workerState({ enabled, running: schedulerRunning && session.status === "closed", observing: session.status !== "regular" }),
      task: session.status === "closed" ? (schedulerRunning ? "Researching" : "Watching") : "Scheduled",
      metrics: [
        { label: "Candidates", value: reports.overnight?.summary?.candidates ?? 0 },
        { label: "High", value: reports.overnight?.summary?.highPriority ?? 0 },
      ],
      finding: reports.overnight?.generatedAt ? `Report ${safeDate(reports.overnight.generatedAt)?.slice(11, 16)}Z` : "Next report pending",
      lastRunAt: safeDate(reports.overnight?.generatedAt),
      nextRunAt: safeDate(scheduler.nextRunAt),
      evidence: "Persistent research memory",
      details: ["Overnight output is research only and must be revalidated in premarket."],
    }),
    compactWorker({
      id: "morning-intelligence",
      initials: "MI",
      name: "Morning Intelligence",
      role: "Premarket revalidation",
      status: workerState({ enabled, running: schedulerRunning && session.status === "premarket", observing: session.status === "premarket" }),
      task: session.status === "premarket" ? (schedulerRunning ? "Revalidating" : "Watching") : "Scheduled",
      metrics: [
        { label: "Candidates", value: reports.morning?.summary?.candidates ?? 0 },
        { label: "Changes", value: reports.morning?.thesisChanges?.length ?? 0 },
      ],
      finding: reports.morning?.generatedAt ? "Report ready" : "Next report pending",
      lastRunAt: safeDate(reports.morning?.generatedAt),
      nextRunAt: safeDate(scheduler.nextRunAt),
      evidence: "Overnight vs premarket",
      details: ["Price, spread, liquidity, volume, structure, risk, and mirror status are checked again before any order."],
    }),
  ];

  return {
    generatedAt: at.toISOString(),
    market: session,
    scheduler: {
      enabled,
      running: schedulerRunning,
      lastCompletedAt: safeDate(scheduler.lastCompletedAt),
      nextRunAt: safeDate(scheduler.nextRunAt),
      cadenceMinutes: sessionCadence,
    },
    workingCount: workers.filter((worker) => worker.status === "working").length,
    watchingCount: workers.filter((worker) => ["working", "watching"].includes(worker.status)).length,
    workers,
    safety: {
      brokerAuthority: false,
      canPlaceOrders: false,
      liveOrdersRequireHumanGate: true,
    },
  };
}

module.exports = {
  buildStockMarketWorkers,
  marketSession,
};

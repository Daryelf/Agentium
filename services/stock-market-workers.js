function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function marketSession(at = new Date(), timeZone = "America/New_York") {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at).filter((item) => item.type !== "literal").map((item) => [item.type, item.value]));
  if (["Sat", "Sun"].includes(parts.weekday)) return { status: "closed", label: "Market closed", regular: false };
  const minutes = Number(parts.hour || 0) * 60 + Number(parts.minute || 0);
  if (minutes >= 570 && minutes < 960) return { status: "regular", label: "Regular market open", regular: true };
  if (minutes >= 240 && minutes < 570) return { status: "premarket", label: "Premarket research", regular: false };
  if (minutes >= 960 && minutes < 1200) return { status: "afterhours", label: "After-hours research", regular: false };
  return { status: "closed", label: "Market closed", regular: false };
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

  const workers = [
    {
      id: "market-scanner",
      initials: "MS",
      name: "Market Scanner",
      role: "Prices + setups",
      status: workerState({ enabled, running: scannerRunning, observing: session.regular }),
      task: scannerRunning
        ? scheduler.currentMessage || "Evaluating the bounded symbol universe."
        : enabled
          ? `Watching ${records.length} evaluated symbols on the ${scheduler.activeCadenceMinutes || 5}-minute market cadence.`
          : "Automatic evaluator cycles are paused by configuration.",
      metrics: [
        { label: "Scanned", value: records.length },
        { label: "Setups", value: validSetups.length },
      ],
      finding: topSetup
        ? `${topSetup.ticker} leads at ${topSetup.score ?? "—"}; ${topSetup.setupType || topSetup.decision || "review pending"}.`
        : "No evaluator record is loaded yet.",
      lastRunAt: safeDate(scheduler.lastCompletedAt),
      nextRunAt: safeDate(scheduler.nextRunAt),
      evidence: `${sourceReady}/${sourceTotal || 0} local market sources ready`,
      brokerAuthority: false,
    },
    {
      id: "filing-watch",
      initials: "FW",
      name: "Filing Watch",
      role: "SEC Form 4 + 13F",
      status: workerState({ enabled, running: filingRunning, blocked: !secConfigured }),
      task: filingRunning
        ? scheduler.currentMessage || "Reading official SEC disclosures."
        : secConfigured
          ? "Waiting for the next bounded official filing intake."
          : "Needs a monitored SEC contact identity before online filing intake can run.",
      metrics: [
        { label: "Form 4", value: finiteNumber(form4.signalsImported) },
        { label: "13F", value: finiteNumber(form13f.signalsImported) },
      ],
      finding: secConfigured
        ? `${finiteNumber(form4.enabledEntries)} insiders and ${finiteNumber(form13f.enabledEntries)} managers enabled.`
        : "Local disclosure reports remain readable; new SEC requests are blocked.",
      lastRunAt: safeDate(scheduler.lastForm4AttemptAt || scheduler.last13fAttemptAt),
      nextRunAt: safeDate(scheduler.nextRunAt),
      evidence: "Official SEC disclosure intake",
      brokerAuthority: false,
    },
    {
      id: "signal-analyst",
      initials: "SA",
      name: "Signal Analyst",
      role: "Mirror evidence",
      status: workerState({ enabled, running: mirrorRunning, observing: Boolean(mirror.available) }),
      task: mirrorRunning
        ? scheduler.currentMessage || "Rebuilding the guarded mirror plan."
        : "Ranking attributable public signals and measuring disclosure lag and price drift.",
      metrics: [
        { label: "Signals", value: finiteNumber(summary.signalsReceived) },
        { label: "Ready", value: finiteNumber(summary.paperReady) },
      ],
      finding: readyProposals.length
        ? `${readyProposals.length} proposal${readyProposals.length === 1 ? "" : "s"} currently pass local draft checks.`
        : `${finiteNumber(summary.researchOnly)} signal${finiteNumber(summary.researchOnly) === 1 ? " is" : "s are"} research-only or blocked.`,
      lastRunAt: safeDate(mirror.generatedAt || scheduler.lastCompletedAt),
      nextRunAt: safeDate(scheduler.nextRunAt),
      evidence: "No-look-ahead disclosure ledger",
      brokerAuthority: false,
    },
    {
      id: "risk-sentinel",
      initials: "RS",
      name: "Risk Sentinel",
      role: "Robinhood account",
      status: workerState({ enabled: true, observing: control.authenticationVerified === true, blocked: control.authenticationVerified !== true }),
      task: control.authenticationVerified
        ? `Watching ${positions.length} live position${positions.length === 1 ? "" : "s"}, ${control.openOrderCount || 0} open order${control.openOrderCount === 1 ? "" : "s"}, and account limits.`
        : "Waiting for a fresh verified Robinhood account snapshot.",
      metrics: [
        { label: "Positions", value: positions.length },
        { label: "Blocks", value: riskBlockers.length },
      ],
      finding: riskBlockers[0] || "Account evidence passes the currently loaded local checks.",
      lastRunAt: safeDate(control.snapshotUpdatedAt),
      nextRunAt: null,
      evidence: control.authenticationVerified ? "Official Robinhood snapshot" : "Broker evidence unavailable",
      brokerAuthority: false,
    },
  ];

  return {
    generatedAt: at.toISOString(),
    market: session,
    scheduler: {
      enabled,
      running: schedulerRunning,
      lastCompletedAt: safeDate(scheduler.lastCompletedAt),
      nextRunAt: safeDate(scheduler.nextRunAt),
      cadenceMinutes: session.regular ? scheduler.activeCadenceMinutes || 5 : scheduler.quietCadenceMinutes || 240,
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

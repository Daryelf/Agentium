const fs = require("node:fs");
const path = require("node:path");

const VERSION = 1;
const MAX_HISTORY = 40;
const DEFAULT_ACTIVE_MINUTES = 1;
const DEFAULT_QUIET_MINUTES = 1;
const DEFAULT_FORM4_MINUTES = 60;
const DEFAULT_13F_MINUTES = 24 * 60;
const DEFAULT_NEWS_MINUTES = 30;
const DEFAULT_PREMARKET_MINUTES = 1;
const DEFAULT_AFTER_HOURS_MINUTES = 1;
const DEFAULT_OVERNIGHT_MINUTES = 1;
const DEFAULT_WEEKEND_MINUTES = 1;
const DEFAULT_STARTUP_DELAY_MS = 250;
const CONTINUOUS_HANDOFF_MS = 100;
const FAILED_RETRY_MS = 5_000;

function safeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function boundedNumber(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function shortText(value, length = 300) {
  return String(value || "").trim().slice(0, length);
}

function normalizeResult(value = {}) {
  const allowed = new Set(["idle", "running", "success", "partial", "failed", "skipped"]);
  const status = allowed.has(value.status) ? value.status : "idle";
  return {
    status,
    message: shortText(value.message, 500),
    recordsMayHaveChanged: value.recordsMayHaveChanged === true,
    warnings: (Array.isArray(value.warnings) ? value.warnings : []).map((item) => shortText(item, 300)).filter(Boolean).slice(0, 8),
    errors: (Array.isArray(value.errors) ? value.errors : []).map((item) => shortText(item, 300)).filter(Boolean).slice(0, 8),
    completedAt: safeDate(value.completedAt),
  };
}

function normalizeHistory(entries = []) {
  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    id: shortText(entry?.id || `intelligence-${Date.now()}`, 100),
    trigger: ["startup", "scheduled", "manual", "test"].includes(entry?.trigger) ? entry.trigger : "scheduled",
    status: ["success", "partial", "failed", "skipped"].includes(entry?.status) ? entry.status : "failed",
    includeSecForm4: entry?.includeSecForm4 === true,
    includeSec13f: entry?.includeSec13f === true,
    includeResearch: entry?.includeResearch === true,
    recordsMayHaveChanged: entry?.recordsMayHaveChanged === true,
    message: shortText(entry?.message, 500),
    startedAt: safeDate(entry?.startedAt),
    completedAt: safeDate(entry?.completedAt),
    liveOrdersPlaced: 0,
    brokerCalled: false,
  })).slice(-MAX_HISTORY);
}

function marketWindow(at = new Date(), timeZone = "America/New_York") {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at).filter((item) => item.type !== "literal").map((item) => [item.type, item.value]));
  const weekday = !["Sat", "Sun"].includes(parts.weekday);
  const minutes = Number(parts.hour || 0) * 60 + Number(parts.minute || 0);
  const active = weekday && minutes >= 8 * 60 && minutes < 18 * 60;
  if (!weekday) return { active: false, label: "weekend_research", session: "weekend" };
  if (minutes >= 570 && minutes < 960) return { active, label: "market_open", session: "regular" };
  if (minutes >= 240 && minutes < 570) return { active, label: "premarket_research", session: "premarket" };
  if (minutes >= 960 && minutes < 1200) return { active, label: "after_hours_research", session: "afterhours" };
  return { active, label: "night_research", session: "overnight" };
}

function cadenceConfig(environment = {}) {
  return {
    activeMinutes: boundedNumber(environment.STOCK_GURU_AUTO_REFRESH_ACTIVE_MINUTES, 1, 120, DEFAULT_ACTIVE_MINUTES),
    quietMinutes: boundedNumber(environment.STOCK_GURU_AUTO_REFRESH_QUIET_MINUTES, 1, 24 * 60, DEFAULT_QUIET_MINUTES),
    premarketMinutes: boundedNumber(environment.STOCK_GURU_AUTO_REFRESH_PREMARKET_MINUTES, 1, 120, DEFAULT_PREMARKET_MINUTES),
    afterHoursMinutes: boundedNumber(environment.STOCK_GURU_AUTO_REFRESH_AFTER_HOURS_MINUTES, 1, 240, DEFAULT_AFTER_HOURS_MINUTES),
    overnightMinutes: boundedNumber(environment.STOCK_GURU_AUTO_REFRESH_OVERNIGHT_MINUTES, 1, 240, DEFAULT_OVERNIGHT_MINUTES),
    weekendMinutes: boundedNumber(environment.STOCK_GURU_AUTO_REFRESH_WEEKEND_MINUTES, 1, 24 * 60, DEFAULT_WEEKEND_MINUTES),
    form4Minutes: boundedNumber(environment.STOCK_GURU_AUTO_FORM4_MINUTES, 30, 24 * 60, DEFAULT_FORM4_MINUTES),
    form13Minutes: boundedNumber(environment.STOCK_GURU_AUTO_13F_MINUTES, 6 * 60, 7 * 24 * 60, DEFAULT_13F_MINUTES),
    newsMinutes: boundedNumber(environment.STOCK_GURU_AUTO_NEWS_MINUTES, 15, 6 * 60, DEFAULT_NEWS_MINUTES),
    startupDelayMs: boundedNumber(environment.STOCK_GURU_AUTO_REFRESH_STARTUP_DELAY_MS, 100, 5 * 60_000, DEFAULT_STARTUP_DELAY_MS),
  };
}

function normalizeStatus(input = {}, options = {}) {
  const value = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const environment = options.environment || {};
  const cadence = cadenceConfig(environment);
  const identityConfigured = Boolean(String(environment.STOCK_GURU_SEC_USER_AGENT || "").trim());
  const explicitlyDisabled = environment.STOCK_GURU_AUTO_REFRESH_DISABLED === "1";
  return {
    version: VERSION,
    enabled: !explicitlyDisabled,
    running: false,
    mode: "continuous_market_intelligence_no_broker",
    marketWindow: shortText(value.marketWindow || "unknown", 40),
    activeCadenceMinutes: cadence.activeMinutes,
    quietCadenceMinutes: cadence.quietMinutes,
    premarketCadenceMinutes: cadence.premarketMinutes,
    afterHoursCadenceMinutes: cadence.afterHoursMinutes,
    overnightCadenceMinutes: cadence.overnightMinutes,
    weekendCadenceMinutes: cadence.weekendMinutes,
    form4CadenceMinutes: cadence.form4Minutes,
    form13fCadenceMinutes: cadence.form13Minutes,
    newsCadenceMinutes: cadence.newsMinutes,
    secIdentityConfigured: identityConfigured,
    blockers: identityConfigured ? [] : ["Automatic SEC intake needs STOCK_GURU_SEC_USER_AGENT with a monitored contact identity."],
    lastStartedAt: safeDate(value.lastStartedAt),
    lastCompletedAt: safeDate(value.lastCompletedAt),
    nextRunAt: safeDate(value.nextRunAt),
    lastForm4AttemptAt: safeDate(value.lastForm4AttemptAt),
    last13fAttemptAt: safeDate(value.last13fAttemptAt),
    lastNewsAttemptAt: safeDate(value.lastNewsAttemptAt),
    lastResult: normalizeResult(value.lastResult || {}),
    history: normalizeHistory(value.history || []),
    liveOrdersPlaced: 0,
    brokerCalled: false,
    safety: {
      brokerToolsAvailable: false,
      liveOrderAuthority: false,
      externalPublishing: false,
      secIdentityRequired: true,
      humanGateRequiredForEveryLiveOrder: true,
    },
  };
}

function readStatusFile(statusFile, options = {}) {
  const fsImpl = options.fsImpl || fs;
  if (!statusFile) return normalizeStatus({}, options);
  try {
    const stat = fsImpl.statSync(statusFile);
    if (!stat.isFile() || stat.size > 1_000_000) return normalizeStatus({}, options);
    return normalizeStatus(JSON.parse(fsImpl.readFileSync(statusFile, "utf8")), options);
  } catch (_error) {
    return normalizeStatus({}, options);
  }
}

function createStockIntelligenceScheduler(options = {}) {
  if (!options.refreshManager || typeof options.refreshManager.refresh !== "function") {
    throw new Error("Stock intelligence scheduler requires a bounded refresh manager.");
  }
  const refreshManager = options.refreshManager;
  const stockRoot = path.resolve(String(options.stockRoot || process.cwd()));
  const statusFile = options.statusFile ? path.resolve(String(options.statusFile)) : "";
  const environment = options.environment || process.env;
  const fsImpl = options.fsImpl || fs;
  const nowFn = options.now || (() => new Date());
  const setTimeoutImpl = options.setTimeoutImpl || setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl || clearTimeout;
  const onCompleted = typeof options.onCompleted === "function" ? options.onCompleted : async () => {};
  const allowInTests = options.allowInTests === true;
  const testRuntime = Boolean(environment.NODE_TEST_CONTEXT || environment.NODE_ENV === "test");
  const config = cadenceConfig(environment);
  let status = readStatusFile(statusFile, { environment, fsImpl });
  let timer = null;
  let activePromise = null;
  let stopped = false;
  let persistenceError = "";

  function persist() {
    if (!statusFile) return;
    try {
      fsImpl.mkdirSync(path.dirname(statusFile), { recursive: true });
      const temporary = `${statusFile}.${process.pid}.tmp`;
      fsImpl.writeFileSync(temporary, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
      fsImpl.renameSync(temporary, statusFile);
      fsImpl.chmodSync?.(statusFile, 0o600);
      persistenceError = "";
    } catch (error) {
      persistenceError = shortText(error?.message || error, 240);
    }
  }

  function publicStatus(running = Boolean(activePromise)) {
    const managerStatus = typeof refreshManager.getStatus === "function" ? refreshManager.getStatus() : {};
    const blockers = [...status.blockers];
    const handoffPending = !running && Boolean(timer) && status.enabled;
    if (persistenceError) blockers.push(`Scheduler state could not be saved: ${persistenceError}`);
    return JSON.parse(JSON.stringify({
      ...status,
      blockers: [...new Set(blockers)].slice(0, 8),
      running,
      continuousResearch: status.enabled,
      handoffPending,
      currentStage: running ? shortText(managerStatus.stage || "refreshing", 80) : handoffPending ? "handoff" : "idle",
      currentMessage: running
        ? shortText(managerStatus.message || "Refreshing market intelligence...", 500)
        : handoffPending
          ? status.lastResult.status === "failed"
            ? "Retrying the next safe research batch..."
            : "Loading the next exchange-wide research batch..."
          : "",
      currentTicker: running ? shortText(managerStatus.currentTicker, 12) : "",
      progressPhase: running ? shortText(managerStatus.progressPhase, 40) : "",
      progressCompleted: running ? Number(managerStatus.progressCompleted || 0) : 0,
      progressTotal: running ? Number(managerStatus.progressTotal || 0) : 0,
      progressPct: running ? Number(managerStatus.progressPct || 0) : 0,
      progressMessage: running ? shortText(managerStatus.progressMessage, 240) : "",
      progressUpdatedAt: running ? safeDate(managerStatus.progressUpdatedAt) : null,
      progressSymbols: running && Array.isArray(managerStatus.progressSymbols)
        ? managerStatus.progressSymbols.map((symbol) => shortText(symbol, 12)).filter(Boolean).slice(0, 240)
        : [],
      universeTotal: Number(managerStatus.universeTotal || 0),
      sweepCompleted: Number(managerStatus.sweepCompleted || 0),
      sweepNumber: Number(managerStatus.sweepNumber || 0),
      batchNumber: Number(managerStatus.batchNumber || 0),
      batchCount: Number(managerStatus.batchCount || 0),
      currentCommands: running && Array.isArray(managerStatus.commands)
        ? managerStatus.commands.map((command) => ({
            name: shortText(command?.name, 80),
            status: shortText(command?.status, 40),
            startedAt: safeDate(command?.startedAt),
            completedAt: safeDate(command?.completedAt),
          })).slice(0, 8)
        : [],
      liveOrdersPlaced: 0,
      brokerCalled: false,
    }));
  }

  function cadenceMs(at) {
    const window = marketWindow(at);
    const minutes = window.session === "regular"
      ? config.activeMinutes
      : window.session === "premarket"
        ? config.premarketMinutes
        : window.session === "afterhours"
          ? config.afterHoursMinutes
          : window.session === "overnight"
            ? config.overnightMinutes
            : config.weekendMinutes;
    return minutes * 60_000;
  }

  function due(lastAt, intervalMinutes, at) {
    const timestamp = safeDate(lastAt);
    return !timestamp || at.getTime() - new Date(timestamp).getTime() >= intervalMinutes * 60_000;
  }

  function schedule(delayMs = null) {
    if (stopped || !status.enabled || (testRuntime && !allowInTests)) return;
    if (timer) clearTimeoutImpl(timer);
    const at = nowFn();
    const delay = Math.max(CONTINUOUS_HANDOFF_MS, delayMs === null ? cadenceMs(at) : delayMs);
    status.marketWindow = marketWindow(at).label;
    status.nextRunAt = new Date(at.getTime() + delay).toISOString();
    persist();
    timer = setTimeoutImpl(() => {
      timer = null;
      runNow({ trigger: "scheduled" }).catch(() => {});
    }, delay);
    timer?.unref?.();
  }

  function runNow(runOptions = {}) {
    if (activePromise) return activePromise;
    if (!status.enabled) return Promise.resolve(publicStatus());
    const trigger = ["startup", "scheduled", "manual", "test"].includes(runOptions.trigger) ? runOptions.trigger : "scheduled";
    const cadenceStartedAt = nowFn();
    activePromise = (async () => {
      const started = cadenceStartedAt;
      const identityConfigured = Boolean(String(environment.STOCK_GURU_SEC_USER_AGENT || "").trim());
      const includeSecForm4 = identityConfigured && due(status.lastForm4AttemptAt, config.form4Minutes, started);
      const includeSec13f = identityConfigured && due(status.last13fAttemptAt, config.form13Minutes, started);
      const includeResearch = due(status.lastNewsAttemptAt, config.newsMinutes, started);
      status.running = true;
      status.marketWindow = marketWindow(started).label;
      status.lastStartedAt = started.toISOString();
      status.nextRunAt = null;
      if (includeSecForm4) status.lastForm4AttemptAt = started.toISOString();
      if (includeSec13f) status.last13fAttemptAt = started.toISOString();
      if (includeResearch) status.lastNewsAttemptAt = started.toISOString();
      persist();
      let result;
      try {
        result = await refreshManager.refresh({ stockRoot, includeSecForm4, includeSec13f, includeResearch });
      } catch (error) {
        result = { status: "failed", message: "Automatic intelligence refresh failed safely.", errors: [shortText(error?.message || error)], recordsMayHaveChanged: false };
      }
      const completed = nowFn();
      const normalizedResult = normalizeResult({ ...result, completedAt: result?.completedAt || completed.toISOString() });
      status.lastCompletedAt = completed.toISOString();
      status.lastResult = normalizedResult;
      status.history = normalizeHistory([...status.history, {
        id: `intelligence-${completed.getTime()}`,
        trigger,
        status: normalizedResult.status,
        includeSecForm4,
        includeSec13f,
        includeResearch,
        recordsMayHaveChanged: normalizedResult.recordsMayHaveChanged,
        message: normalizedResult.message,
        startedAt: started.toISOString(),
        completedAt: completed.toISOString(),
      }]);
      status.running = false;
      status.blockers = identityConfigured ? [] : ["Automatic SEC intake needs STOCK_GURU_SEC_USER_AGENT with a monitored contact identity."];
      persist();
      await Promise.resolve(onCompleted(normalizedResult)).catch(() => {});
      return publicStatus(false);
    })().finally(() => {
      activePromise = null;
      schedule(status.lastResult.status === "failed" ? FAILED_RETRY_MS : CONTINUOUS_HANDOFF_MS);
    });
    return activePromise;
  }

  function recordManualRefresh(refresh = {}) {
    const at = nowFn();
    const result = normalizeResult({ ...refresh, completedAt: refresh.completedAt || at.toISOString() });
    const commands = Array.isArray(refresh.commands) ? refresh.commands : [];
    if (commands.some((item) => item?.name === "copy_refresh_sec" && item?.status !== "skipped")) status.lastForm4AttemptAt = at.toISOString();
    if (commands.some((item) => item?.name === "copy_refresh_13f" && item?.status !== "skipped")) status.last13fAttemptAt = at.toISOString();
    if (commands.some((item) => item?.name === "research" && item?.status !== "skipped")) status.lastNewsAttemptAt = at.toISOString();
    status.lastStartedAt = safeDate(refresh.startedAt) || at.toISOString();
    status.lastCompletedAt = at.toISOString();
    status.lastResult = result;
    status.history = normalizeHistory([...status.history, {
      id: `intelligence-${at.getTime()}`,
      trigger: "manual",
      status: result.status,
      includeSecForm4: commands.some((item) => item?.name === "copy_refresh_sec" && item?.status !== "skipped"),
      includeSec13f: commands.some((item) => item?.name === "copy_refresh_13f" && item?.status !== "skipped"),
      includeResearch: commands.some((item) => item?.name === "research" && item?.status !== "skipped"),
      recordsMayHaveChanged: result.recordsMayHaveChanged,
      message: result.message,
      startedAt: status.lastStartedAt,
      completedAt: at.toISOString(),
    }]);
    persist();
    schedule(CONTINUOUS_HANDOFF_MS);
    return publicStatus();
  }

  function refreshConfiguration() {
    const identityConfigured = Boolean(String(environment.STOCK_GURU_SEC_USER_AGENT || "").trim());
    status.secIdentityConfigured = identityConfigured;
    status.blockers = identityConfigured
      ? []
      : ["Automatic SEC intake needs STOCK_GURU_SEC_USER_AGENT with a monitored contact identity."];
    persist();
    return publicStatus();
  }

  function start() {
    stopped = false;
    if (!status.enabled || (testRuntime && !allowInTests)) return publicStatus();
    if (timer || activePromise) return publicStatus();
    schedule(config.startupDelayMs);
    return publicStatus();
  }

  async function stop() {
    stopped = true;
    if (timer) clearTimeoutImpl(timer);
    timer = null;
    status.nextRunAt = null;
    status.running = false;
    persist();
    const running = activePromise;
    if (typeof refreshManager.stop === "function") await refreshManager.stop();
    if (running) await running.catch(() => undefined);
    return publicStatus();
  }

  return {
    getStatus: publicStatus,
    recordManualRefresh,
    refreshConfiguration,
    runNow,
    start,
    stop,
  };
}

module.exports = {
  cadenceConfig,
  createStockIntelligenceScheduler,
  marketWindow,
  normalizeStatus,
};

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const MAX_OUTPUT_CHARS = 4_000;
const DEFAULT_TIMEOUT_MS = 300_000;
const RESEARCH_PROGRESS_FILE = "argentum-research-progress.json";

function nowIso() {
  return new Date().toISOString();
}

function cleanOutput(value) {
  return String(value || "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\b(api[_-]?key|secret|token|password|authorization|bearer)\b\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .trim()
    .slice(-MAX_OUTPUT_CHARS);
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function shortText(value, length = 240) {
  return String(value || "").trim().slice(0, length);
}

function cleanTicker(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!/^[A-Z^][A-Z0-9.^-]{0,11}$/.test(raw)) return "";
  const ticker = raw.slice(0, 12);
  return ticker === "^VIX" || /^[A-Z][A-Z0-9.-]{0,11}$/.test(ticker) ? ticker : "";
}

function readResearchProgress(runtimeRoot, runId, fsImpl = fs) {
  if (!runtimeRoot || !runId) return null;
  try {
    const progressPath = path.join(runtimeRoot, "data", RESEARCH_PROGRESS_FILE);
    const stat = fsImpl.statSync(progressPath);
    if (!stat.isFile() || stat.size > 1_000_000) return null;
    const value = JSON.parse(fsImpl.readFileSync(progressPath, "utf8"));
    if (String(value?.run_id || "") !== String(runId)) return null;
    const symbols = (Array.isArray(value?.symbols) ? value.symbols : []).map(cleanTicker).filter(Boolean).slice(0, 240);
    const total = boundedInteger(value?.total, symbols.length, 0, 240);
    const completed = boundedInteger(value?.completed, 0, 0, total || 240);
    return {
      progressPhase: shortText(value?.phase, 40),
      progressSymbols: symbols,
      currentTicker: cleanTicker(value?.current_ticker),
      progressCompleted: completed,
      progressTotal: total,
      progressPct: total ? Math.round((completed / total) * 1_000) / 10 : 0,
      progressMessage: shortText(value?.message, 240),
      progressUpdatedAt: safeProgressDate(value?.updated_at),
      universeTotal: boundedInteger(value?.universe_total, 0, 0, 20_000),
      sweepCompleted: boundedInteger(value?.sweep_completed, 0, 0, 20_000),
      sweepNumber: boundedInteger(value?.sweep_number, 0, 0, 100_000),
      batchNumber: boundedInteger(value?.batch_number, 0, 0, 100_000),
      batchCount: boundedInteger(value?.batch_count, 0, 0, 10_000),
    };
  } catch (_error) {
    return null;
  }
}

function safeProgressDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function publicStatus(status) {
  return JSON.parse(JSON.stringify(status));
}

function enabledSecWatchlistEntries(stockRoot, fsImpl = fs, section = "sec_form4") {
  try {
    if (!["sec_form4", "sec_13f"].includes(section)) return 0;
    const raw = JSON.parse(fsImpl.readFileSync(path.join(stockRoot, "config", "copy_trader_watchlist.json"), "utf8"));
    const entries = Array.isArray(raw?.[section]) ? raw[section] : [];
    return entries.filter((entry) => entry && entry.enabled !== false && String(entry.cik || "").trim()).length;
  } catch (_error) {
    return 0;
  }
}

function researchTickers(stockRoot, fsImpl = fs, limit = 12) {
  try {
    const payload = JSON.parse(fsImpl.readFileSync(path.join(stockRoot, "reports", "evaluations.json"), "utf8"));
    const records = Array.isArray(payload) ? payload : Array.isArray(payload?.evaluations) ? payload.evaluations : [];
    const eligibleStatuses = new Set(["valid_setup", "valid_buy_setup", "watch", "watchlist", "review"]);
    return [...new Set(records
      .filter((item) => item && eligibleStatuses.has(String(item.status || item.decision || "").trim().toLowerCase().replace(/[\s-]+/g, "_")))
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .map((item) => String(item.ticker || item.symbol || "").toUpperCase().replace(/[^A-Z0-9.-]/g, ""))
      .filter(Boolean))].slice(0, Math.max(1, Math.min(25, Number(limit) || 12)));
  } catch (_error) {
    return [];
  }
}

function validateWorkspace(stockRoot, fsImpl = fs, sourcePath = "") {
  const resolved = path.resolve(String(stockRoot || ""));
  const packageRoot = path.join(resolved, "src", "stock_guru");
  if (!fsImpl.existsSync(resolved) || !fsImpl.existsSync(packageRoot)) {
    throw new Error("Stock Guru workspace is not connected.");
  }
  const executable = [resolved, sourcePath]
    .filter(Boolean)
    .map((candidate) => path.join(path.resolve(String(candidate)), ".venv", "bin", "python"))
    .find((candidate) => fsImpl.existsSync(candidate));
  if (!executable) throw new Error("The market scanner runtime is not ready. Reconnect the Stock Guru workspace, then try again.");
  return { stockRoot: resolved, executable };
}

function createStockGuruRefreshManager(options = {}) {
  const spawnImpl = options.spawnImpl || spawn;
  const fsImpl = options.fsImpl || fs;
  const environment = options.env || process.env;
  const configuredRuntimeRoot = options.runtimeRoot ? path.resolve(String(options.runtimeRoot)) : "";
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs || environment.STOCK_GURU_REFRESH_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  const scanMaxSymbols = boundedInteger(environment.STOCK_GURU_SCAN_MAX_SYMBOLS, 200, 60, 5_000);
  const scanRotateCount = boundedInteger(environment.STOCK_GURU_SCAN_ROTATE_COUNT, 200, 0, scanMaxSymbols);
  const progressHoldMs = boundedInteger(environment.STOCK_GURU_PROGRESS_HOLD_MS, 500, 0, 2_000);
  const stopGraceMs = boundedInteger(options.stopGraceMs, 750, 50, 5_000);
  const stopTimeoutMs = boundedInteger(options.stopTimeoutMs, 1_500, stopGraceMs, 10_000);
  const onCommandCompleted = typeof options.onCommandCompleted === "function" ? options.onCommandCompleted : null;
  let activePromise = null;
  let stopping = false;
  const activeChildren = new Map();
  let status = {
    id: null,
    status: "idle",
    stage: "idle",
    message: "Ready to refresh evaluator records, the guarded mirror plan, and its evidence ledger.",
    startedAt: null,
    completedAt: null,
    recordsMayHaveChanged: false,
    liveOrdersPlaced: 0,
    commands: [],
    warnings: [],
    errors: [],
  };

  function update(patch = {}) {
    status = { ...status, ...patch };
    return publicStatus(status);
  }

  function notifyCommandCompleted(command, metadata = {}) {
    const callback = typeof metadata.onCommandCompleted === "function" ? metadata.onCommandCompleted : onCommandCompleted;
    if (!callback || !command) return;
    Promise.resolve(callback({
      runId: status.id,
      stage: command.name,
      command,
      ...metadata,
    })).catch(() => {});
  }

  function prepareRuntimeRoot(stockRoot) {
    if (!configuredRuntimeRoot || configuredRuntimeRoot === stockRoot) return stockRoot;
    for (const directory of ["data", "reports"]) {
      const source = path.join(stockRoot, directory);
      const target = path.join(configuredRuntimeRoot, directory);
      fsImpl.mkdirSync(target, { recursive: true });
      if (!fsImpl.existsSync(source) || typeof fsImpl.cpSync !== "function") continue;
      fsImpl.cpSync(source, target, {
        recursive: true,
        force: false,
        errorOnExist: false,
        filter: (candidate) => !/(?:provider[_-]?keys|password|credential|oauth|token|secret|auth)/i.test(path.basename(candidate)),
      });
    }
    return configuredRuntimeRoot;
  }

  function runCommand(executable, args, commandLabel, stockRoot, runtimeRoot) {
    const commandState = {
      name: commandLabel,
      status: "running",
      startedAt: nowIso(),
      completedAt: null,
      detail: "",
    };
    status.commands.push(commandState);
    update({
      stage: commandLabel,
      message: commandLabel === "evaluate"
        ? "Refreshing market evaluator records..."
        : commandLabel === "intraday_context"
          ? "Building multi-timeframe price, VWAP, volume, and liquidity context..."
        : commandLabel === "research"
          ? "Refreshing structured company and news context for top candidates..."
        : commandLabel === "copy_refresh_sec"
          ? "Refreshing official SEC Form 4 signals and price observations..."
          : commandLabel === "copy_refresh_13f"
            ? "Comparing official SEC Form 13F manager holdings as delayed research..."
            : "Rebuilding the guarded mirror plan and evidence ledger...",
    });

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timer = null;
      let forceTimer = null;
      let giveUpTimer = null;
      let timedOut = false;
      const childEnvironment = {
        ...environment,
        PYTHONPATH: [path.join(stockRoot, "src"), environment.PYTHONPATH].filter(Boolean).join(path.delimiter),
        PYTHONPYCACHEPREFIX: environment.PYTHONPYCACHEPREFIX || path.join(os.tmpdir(), "argentum-stock-guru-pycache"),
        STOCK_GURU_RUNTIME_DIR: runtimeRoot,
        STOCK_GURU_PROGRESS_FILE: path.join(runtimeRoot, "data", RESEARCH_PROGRESS_FILE),
        STOCK_GURU_PROGRESS_RUN_ID: String(status.id || ""),
        STOCK_GURU_PROGRESS_HOLD_MS: String(progressHoldMs),
      };
      const child = spawnImpl(executable, ["-m", "stock_guru", ...args], {
        cwd: stockRoot,
        env: childEnvironment,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (forceTimer) clearTimeout(forceTimer);
        if (giveUpTimer) clearTimeout(giveUpTimer);
        activeChildren.delete(child);
        Object.assign(commandState, {
          status: result.cancelled ? "stopped" : result.ok ? "success" : "failed",
          completedAt: nowIso(),
          detail: cleanOutput(result.detail || stderr || stdout),
        });
        resolve({ ...result, command: commandState });
      };
      activeChildren.set(child, { finish });
      timer = setTimeout(() => {
        timedOut = true;
        try { child.kill?.("SIGTERM"); } catch (_error) { /* process already closed */ }
        forceTimer = setTimeout(() => {
          try { child.kill?.("SIGKILL"); } catch (_error) { /* process already closed */ }
        }, stopGraceMs);
        giveUpTimer = setTimeout(() => finish({
          ok: false,
          detail: `${commandLabel} exceeded the ${Math.round(timeoutMs / 1000)} second safety timeout and was terminated.`,
        }), stopTimeoutMs);
      }, timeoutMs);
      child.stdout?.on("data", (chunk) => {
        stdout = `${stdout}${chunk}`.slice(-MAX_OUTPUT_CHARS * 2);
      });
      child.stderr?.on("data", (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-MAX_OUTPUT_CHARS * 2);
      });
      child.once("error", (error) => finish({ ok: false, detail: error.message }));
      child.once("close", (code, signal) => finish(stopping
        ? { ok: false, cancelled: true, detail: "Market research stopped cleanly with Argentum." }
        : timedOut
          ? { ok: false, detail: `${commandLabel} exceeded the ${Math.round(timeoutMs / 1000)} second safety timeout and was terminated.` }
        : {
          ok: code === 0,
          detail: code === 0 ? stdout : `${stderr || stdout}\nExit ${code ?? "unknown"}${signal ? ` (${signal})` : ""}`,
        }));
    });
  }

  async function runStep(...args) {
    const result = await runCommand(...args);
    if (stopping || result.cancelled) {
      const error = new Error("Market research stopped cleanly with Argentum.");
      error.code = "ARGENTUM_REFRESH_STOPPED";
      throw error;
    }
    return result;
  }

  async function execute(stockRoot, runOptions = {}) {
    const includeSecForm4 = runOptions.includeSecForm4 !== false;
    const includeSec13f = runOptions.includeSec13f !== false;
    const includeResearch = runOptions.includeResearch !== false;
    const runId = `stock-refresh-${Date.now()}`;
    status = {
      id: runId,
      status: "running",
      stage: "preflight",
      message: "Checking the Stock Guru workspace...",
      startedAt: nowIso(),
      completedAt: null,
      recordsMayHaveChanged: false,
      liveOrdersPlaced: 0,
      commands: [],
      warnings: [],
      errors: [],
    };

    try {
      const workspace = validateWorkspace(stockRoot, fsImpl, environment.STOCK_GURU_SOURCE_PATH);
      if (environment.STOCK_GURU_REFRESH_DISABLED === "1") {
        return update({
          status: "skipped",
          stage: "complete",
          message: "Refresh runner is disabled in this environment; local reports were rescanned.",
          completedAt: nowIso(),
          warnings: ["Runner disabled by STOCK_GURU_REFRESH_DISABLED."],
        });
      }
      const runtimeRoot = prepareRuntimeRoot(workspace.stockRoot);

      const results = [];
      const evaluateResult = await runStep(workspace.executable, [
        "evaluate",
        "--cache-first-history",
        "--history-cache-hours", "36",
        "--max-symbols", String(scanMaxSymbols),
        "--rotate-count", String(scanRotateCount),
      ], "evaluate", workspace.stockRoot, runtimeRoot);
      results.push(evaluateResult);
      if (evaluateResult.ok) notifyCommandCompleted(evaluateResult.command, {
        runId: runId,
        stockRoot,
        runtimeRoot,
        includeResearch,
        includeSecForm4,
        includeSec13f,
        startedAt: status.startedAt,
        completedAt: nowIso(),
        onCommandCompleted: evaluateResult.command?.name === "evaluate"
          ? (runOptions.onCommandCompleted || onCommandCompleted)
          : null,
      });

      const researchSymbols = includeResearch ? researchTickers(runtimeRoot, fsImpl) : [];
      if (includeResearch && researchSymbols.length) {
        results.push(await runStep(workspace.executable, ["intraday-context", "--tickers", researchSymbols.join(",")], "intraday_context", workspace.stockRoot, runtimeRoot));
        results.push(await runStep(workspace.executable, ["research", "--tickers", researchSymbols.join(","), "--news-limit", "3"], "research", workspace.stockRoot, runtimeRoot));
      } else {
        const reason = includeResearch
          ? "Structured company/news research deferred because the evaluator produced no eligible candidate symbols."
          : "Structured company/news research deferred until its independent bounded cadence.";
        status.commands.push({ name: "research", status: "skipped", startedAt: nowIso(), completedAt: nowIso(), detail: reason });
      }

      const secIdentityConfigured = Boolean(String(environment.STOCK_GURU_SEC_USER_AGENT || "").trim());
      const secEntries = enabledSecWatchlistEntries(workspace.stockRoot, fsImpl, "sec_form4");
      if (includeSecForm4 && secEntries > 0 && secIdentityConfigured) {
        results.push(await runStep(workspace.executable, ["copy-refresh-sec", "--max-filings", "10"], "copy_refresh_sec", workspace.stockRoot, runtimeRoot));
      } else {
        const reason = !includeSecForm4
          ? "SEC Form 4 refresh deferred until its bounded automatic cadence."
          : secEntries > 0
            ? "SEC refresh skipped until STOCK_GURU_SEC_USER_AGENT is configured."
            : "SEC refresh skipped because no named CIK watchlist entries are enabled.";
        status.commands.push({ name: "copy_refresh_sec", status: "skipped", startedAt: nowIso(), completedAt: nowIso(), detail: reason });
        status.warnings.push(reason);
      }

      const sec13fEntries = enabledSecWatchlistEntries(workspace.stockRoot, fsImpl, "sec_13f");
      if (includeSec13f && sec13fEntries > 0 && secIdentityConfigured) {
        results.push(await runStep(workspace.executable, ["copy-refresh-13f", "--max-filings", "3"], "copy_refresh_13f", workspace.stockRoot, runtimeRoot));
      } else {
        const reason = !includeSec13f
          ? "SEC Form 13F refresh deferred until its bounded automatic cadence."
          : sec13fEntries > 0
            ? "SEC 13F research refresh skipped until STOCK_GURU_SEC_USER_AGENT is configured."
            : "SEC 13F research refresh skipped because no named manager CIK entries are enabled.";
        status.commands.push({ name: "copy_refresh_13f", status: "skipped", startedAt: nowIso(), completedAt: nowIso(), detail: reason });
        status.warnings.push(reason);
      }

      results.push(await runStep(workspace.executable, ["copy-plan"], "copy_plan", workspace.stockRoot, runtimeRoot));
      const failures = results.filter((result) => !result.ok);
      const warnings = [...status.warnings];
      for (const result of failures) warnings.push(`${result.command.name}: ${result.command.detail || "command failed"}`);
      return update({
        status: failures.length ? "partial" : "success",
        stage: "complete",
        message: failures.length
          ? "Refresh completed with warnings; the last safe local reports remain available."
          : "Evaluator records, the guarded mirror plan, and the evidence ledger are refreshed.",
        completedAt: nowIso(),
        recordsMayHaveChanged: results.some((result) => result.ok),
        warnings: warnings.slice(0, 8),
      });
    } catch (error) {
      if (error?.code === "ARGENTUM_REFRESH_STOPPED") {
        return update({
          status: "skipped",
          stage: "stopped",
          message: "Market research stopped cleanly with Argentum.",
          completedAt: nowIso(),
        });
      }
      return update({
        status: "failed",
        stage: "complete",
        message: "The refresh could not start; the last safe local reports remain available.",
        completedAt: nowIso(),
        errors: [cleanOutput(error.message || error)],
      });
    }
  }

  function refresh({ stockRoot, includeSecForm4 = true, includeSec13f = true, includeResearch = true } = {}) {
    if (activePromise) return activePromise;
    stopping = false;
    activePromise = execute(stockRoot, { includeSecForm4, includeSec13f, includeResearch, onCommandCompleted: arguments[0]?.onCommandCompleted }).finally(() => {
      activePromise = null;
    });
    return activePromise;
  }

  async function stop() {
    stopping = true;
    const children = [...activeChildren.entries()];
    if (children.length) {
      update({ stage: "stopping", message: "Stopping active market research cleanly..." });
      await Promise.all(children.map(([child, command]) => new Promise((resolve) => {
        let settled = false;
        let forceTimer = null;
        let giveUpTimer = null;
        const done = () => {
          if (settled) return;
          settled = true;
          if (forceTimer) clearTimeout(forceTimer);
          if (giveUpTimer) clearTimeout(giveUpTimer);
          resolve();
        };
        child.once("close", done);
        forceTimer = setTimeout(() => {
          try { child.kill?.("SIGKILL"); } catch (_error) { /* already closed */ }
        }, stopGraceMs);
        giveUpTimer = setTimeout(() => {
          command.finish({ ok: false, cancelled: true, detail: "Market research stopped during Argentum shutdown." });
          done();
        }, stopTimeoutMs);
        try {
          child.kill?.("SIGTERM");
        } catch (_error) {
          command.finish({ ok: false, cancelled: true, detail: "Market research stopped during Argentum shutdown." });
          done();
        }
      })));
    }
    if (activePromise) await activePromise.catch(() => undefined);
    return publicStatus(status);
  }

  return {
    getStatus: () => {
      const snapshot = publicStatus(status);
      const progress = readResearchProgress(configuredRuntimeRoot || options.stockRoot || "", snapshot.id, fsImpl);
      if (!progress) return snapshot;
      const coverage = {
        universeTotal: progress.universeTotal,
        sweepCompleted: progress.sweepCompleted,
        sweepNumber: progress.sweepNumber,
        batchNumber: progress.batchNumber,
        batchCount: progress.batchCount,
      };
      return snapshot.status === "running" && snapshot.stage === "evaluate"
        ? { ...snapshot, ...progress }
        : { ...snapshot, ...coverage };
    },
    refresh,
    stop,
  };
}

module.exports = {
  cleanOutput,
  createStockGuruRefreshManager,
  enabledSecWatchlistEntries,
  readResearchProgress,
  researchTickers,
  validateWorkspace,
};

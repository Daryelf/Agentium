const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const MAX_OUTPUT_CHARS = 4_000;
const DEFAULT_TIMEOUT_MS = 180_000;

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
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs || environment.STOCK_GURU_REFRESH_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  let activePromise = null;
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

  function runCommand(executable, args, commandLabel, stockRoot) {
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
      const childEnvironment = {
        ...environment,
        PYTHONPATH: [path.join(stockRoot, "src"), environment.PYTHONPATH].filter(Boolean).join(path.delimiter),
        PYTHONPYCACHEPREFIX: environment.PYTHONPYCACHEPREFIX || path.join(os.tmpdir(), "argentum-stock-guru-pycache"),
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
        clearTimeout(timer);
        Object.assign(commandState, {
          status: result.ok ? "success" : "failed",
          completedAt: nowIso(),
          detail: cleanOutput(result.detail || stderr || stdout),
        });
        resolve({ ...result, command: commandState });
      };
      const timer = setTimeout(() => {
        child.kill?.("SIGTERM");
        finish({ ok: false, detail: `${commandLabel} exceeded the ${Math.round(timeoutMs / 1000)} second safety timeout.` });
      }, timeoutMs);
      child.stdout?.on("data", (chunk) => {
        stdout = `${stdout}${chunk}`.slice(-MAX_OUTPUT_CHARS * 2);
      });
      child.stderr?.on("data", (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-MAX_OUTPUT_CHARS * 2);
      });
      child.once("error", (error) => finish({ ok: false, detail: error.message }));
      child.once("close", (code, signal) => finish({
        ok: code === 0,
        detail: code === 0 ? stdout : `${stderr || stdout}\nExit ${code ?? "unknown"}${signal ? ` (${signal})` : ""}`,
      }));
    });
  }

  async function execute(stockRoot, runOptions = {}) {
    const includeSecForm4 = runOptions.includeSecForm4 !== false;
    const includeSec13f = runOptions.includeSec13f !== false;
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

      const results = [];
      results.push(await runCommand(workspace.executable, [
        "evaluate",
        "--cache-first-history",
        "--history-cache-hours", "36",
        "--max-symbols", "80",
        "--rotate-count", "40",
      ], "evaluate", workspace.stockRoot));

      const secIdentityConfigured = Boolean(String(environment.STOCK_GURU_SEC_USER_AGENT || "").trim());
      const secEntries = enabledSecWatchlistEntries(workspace.stockRoot, fsImpl, "sec_form4");
      if (includeSecForm4 && secEntries > 0 && secIdentityConfigured) {
        results.push(await runCommand(workspace.executable, ["copy-refresh-sec", "--max-filings", "10"], "copy_refresh_sec", workspace.stockRoot));
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
        results.push(await runCommand(workspace.executable, ["copy-refresh-13f", "--max-filings", "3"], "copy_refresh_13f", workspace.stockRoot));
      } else {
        const reason = !includeSec13f
          ? "SEC Form 13F refresh deferred until its bounded automatic cadence."
          : sec13fEntries > 0
            ? "SEC 13F research refresh skipped until STOCK_GURU_SEC_USER_AGENT is configured."
            : "SEC 13F research refresh skipped because no named manager CIK entries are enabled.";
        status.commands.push({ name: "copy_refresh_13f", status: "skipped", startedAt: nowIso(), completedAt: nowIso(), detail: reason });
        status.warnings.push(reason);
      }

      results.push(await runCommand(workspace.executable, ["copy-plan"], "copy_plan", workspace.stockRoot));
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
      return update({
        status: "failed",
        stage: "complete",
        message: "The refresh could not start; the last safe local reports remain available.",
        completedAt: nowIso(),
        errors: [cleanOutput(error.message || error)],
      });
    }
  }

  function refresh({ stockRoot, includeSecForm4 = true, includeSec13f = true } = {}) {
    if (activePromise) return activePromise;
    activePromise = execute(stockRoot, { includeSecForm4, includeSec13f }).finally(() => {
      activePromise = null;
    });
    return activePromise;
  }

  return {
    getStatus: () => publicStatus(status),
    refresh,
  };
}

module.exports = {
  cleanOutput,
  createStockGuruRefreshManager,
  enabledSecWatchlistEntries,
  validateWorkspace,
};

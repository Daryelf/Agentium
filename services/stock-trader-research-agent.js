const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const VERSION = 1;
const MAX_JOBS = 80;
const MAX_QUEUE = 24;
const MAX_ENQUEUE_PER_SNAPSHOT = 12;
const MAX_OUTPUT_CHARS = 3_000;
const MAX_ARTIFACT_BYTES = 2_000_000;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_TIMEOUT_MS = 180_000;
const EQUITY_EXCHANGES = new Set(["NMS", "NGM", "NCM", "NYQ", "ASE", "PCX", "BTS", "BATS", "NASDAQ", "NYSE"]);
const COMPANY_STOP_WORDS = new Set([
  "and", "class", "co", "company", "corp", "corporation", "group", "holdings", "inc", "incorporated",
  "limited", "llc", "lp", "ltd", "new", "ordinary", "plc", "shares", "the",
]);

function nowIso() {
  return new Date().toISOString();
}

function shortText(value, length = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, length);
}

function cleanOutput(value) {
  return String(value || "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\b(api[_-]?key|secret|token|password|authorization|bearer)\b\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .trim()
    .slice(-MAX_OUTPUT_CHARS);
}

function cleanSymbol(value) {
  const symbol = String(value || "").trim().toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,11}$/.test(symbol) ? symbol : "";
}

function safeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !url.username && !url.password ? url.toString().slice(0, 1_000) : "";
  } catch (_error) {
    return "";
  }
}

function boundedNumber(value, min, max, fallback = min) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function readJson(filePath, fsImpl = fs, fallback = null) {
  try {
    const stat = fsImpl.statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_ARTIFACT_BYTES) return fallback;
    return JSON.parse(fsImpl.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return fallback;
  }
}

function companyTokens(value) {
  return [...new Set(String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !COMPANY_STOP_WORDS.has(token)))];
}

function companyMatchScore(issuerName, quoteName) {
  const expected = companyTokens(issuerName);
  const actual = new Set(companyTokens(quoteName));
  if (!expected.length || !actual.size) return 0;
  const overlap = expected.filter((token) => actual.has(token)).length;
  const coverage = overlap / expected.length;
  const precision = overlap / actual.size;
  return Math.round(((coverage * 0.75) + (precision * 0.25)) * 1_000) / 1_000;
}

async function resolveSymbolWithYahoo(input = {}, options = {}) {
  const issuerName = shortText(input.issuerName, 200);
  if (!issuerName) throw new Error("The institutional filing did not include an issuer name to resolve.");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("Yahoo symbol lookup is unavailable in this runtime.");
  const endpoint = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(issuerName)}&quotesCount=8&newsCount=0`;
  const response = await fetchImpl(endpoint, {
    headers: { accept: "application/json", "user-agent": "Argentum-Stock-Research/1.0" },
    signal: options.signal,
  });
  if (!response?.ok) throw new Error(`Yahoo symbol lookup returned HTTP ${response?.status || "error"}.`);
  const payload = await response.json();
  const candidates = (Array.isArray(payload?.quotes) ? payload.quotes : [])
    .map((quote) => {
      const symbol = cleanSymbol(quote?.symbol);
      const quoteType = String(quote?.quoteType || quote?.typeDisp || "").toUpperCase();
      const exchange = String(quote?.exchange || quote?.exchangeDisp || "").toUpperCase();
      const matchedName = shortText(quote?.longname || quote?.shortname || quote?.name, 200);
      return {
        symbol,
        matchedName,
        exchange,
        quoteType,
        matchScore: companyMatchScore(issuerName, matchedName),
      };
    })
    .filter((item) => item.symbol && item.quoteType.includes("EQUITY") && (!item.exchange || EQUITY_EXCHANGES.has(item.exchange)))
    .sort((a, b) => b.matchScore - a.matchScore || a.symbol.localeCompare(b.symbol));
  const best = candidates[0];
  if (!best || best.matchScore < 0.6) {
    throw new Error("Yahoo returned no sufficiently confident US equity match; the filing stays unresolved.");
  }
  return {
    ...best,
    provider: "Yahoo Finance search",
    observedAt: nowIso(),
  };
}

function normalizedStage(stage = {}) {
  return {
    id: shortText(stage.id, 60),
    label: shortText(stage.label, 100),
    status: ["pending", "running", "success", "partial", "failed", "skipped"].includes(stage.status) ? stage.status : "pending",
    startedAt: safeDate(stage.startedAt),
    completedAt: safeDate(stage.completedAt),
    durationMs: boundedNumber(stage.durationMs, 0, 24 * 60 * 60 * 1_000, 0),
    detail: shortText(stage.detail, 400),
    evidenceCount: boundedNumber(stage.evidenceCount, 0, 10_000, 0),
  };
}

function normalizedJob(job = {}) {
  const status = ["queued", "running", "success", "partial", "failed", "blocked", "stopped"].includes(job.status) ? job.status : "queued";
  return {
    id: shortText(job.id, 120),
    dedupeKey: shortText(job.dedupeKey, 240),
    triggerType: ["institutional_holding", "current_public_signal"].includes(job.triggerType) ? job.triggerType : "institutional_holding",
    traderName: shortText(job.traderName || "Unknown institutional manager", 180),
    issuerName: shortText(job.issuerName, 200),
    securityIdentifier: String(job.securityIdentifier || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12),
    inputSymbol: cleanSymbol(job.inputSymbol),
    symbol: cleanSymbol(job.symbol),
    side: ["BUY", "SELL", "OBSERVE"].includes(String(job.side || "").toUpperCase()) ? String(job.side).toUpperCase() : "OBSERVE",
    sourceId: shortText(job.sourceId || "public_signal", 80),
    sourceUrl: safeUrl(job.sourceUrl),
    disclosedAt: safeDate(job.disclosedAt),
    observedAt: safeDate(job.observedAt),
    asFiledValue: boundedNumber(job.asFiledValue, 0, Number.MAX_SAFE_INTEGER, 0),
    shareDelta: boundedNumber(job.shareDelta, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0),
    status,
    currentStage: shortText(job.currentStage || "signal_capture", 60),
    message: shortText(job.message || "Queued for independent stock research.", 400),
    queuedAt: safeDate(job.queuedAt) || nowIso(),
    startedAt: safeDate(job.startedAt),
    completedAt: safeDate(job.completedAt),
    durationMs: boundedNumber(job.durationMs, 0, 24 * 60 * 60 * 1_000, 0),
    attempt: boundedNumber(job.attempt, 1, 20, 1),
    stages: (Array.isArray(job.stages) ? job.stages : []).map(normalizedStage).slice(0, 10),
    resolution: job.resolution && typeof job.resolution === "object" ? {
      provider: shortText(job.resolution.provider, 80),
      matchedName: shortText(job.resolution.matchedName, 200),
      exchange: shortText(job.resolution.exchange, 30),
      matchScore: boundedNumber(job.resolution.matchScore, 0, 1, 0),
      observedAt: safeDate(job.resolution.observedAt),
    } : null,
    result: job.result && typeof job.result === "object" ? job.result : null,
    warnings: (Array.isArray(job.warnings) ? job.warnings : []).map((item) => shortText(item, 300)).filter(Boolean).slice(0, 8),
    brokerCalled: false,
    liveOrdersPlaced: 0,
  };
}

function createStockTraderResearchAgent(options = {}) {
  const fsImpl = options.fsImpl || fs;
  const spawnImpl = options.spawnImpl || spawn;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const environment = options.env || process.env;
  const dataDir = path.resolve(String(options.dataDir || process.cwd()));
  const stockRoot = path.resolve(String(options.stockRoot || process.cwd()));
  const mainRuntimeRoot = path.resolve(String(options.runtimeRoot || stockRoot));
  const stateFile = path.resolve(String(options.stateFile || path.join(dataDir, "stock-trader-research-agents.json")));
  const jobRoot = path.resolve(String(options.jobRoot || path.join(dataDir, "stock-trader-research-agents")));
  const concurrency = Math.max(1, Math.min(4, Number(options.concurrency || DEFAULT_CONCURRENCY)));
  const timeoutMs = Math.max(5_000, Number(options.timeoutMs || environment.STOCK_TRADER_RESEARCH_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  const resolveSymbolImpl = options.resolveSymbolImpl || ((input) => resolveSymbolWithYahoo(input, { fetchImpl }));
  const onChange = typeof options.onChange === "function" ? options.onChange : () => {};
  const activeChildren = new Set();
  const activeJobs = new Set();
  let drainScheduled = false;
  let stopping = false;
  let state = readJson(stateFile, fsImpl, { version: VERSION, jobs: [] });
  state = {
    version: VERSION,
    jobs: (Array.isArray(state?.jobs) ? state.jobs : []).map((job) => normalizedJob({
      ...job,
      status: job?.status === "running" ? "queued" : job?.status,
      message: job?.status === "running" ? "Recovered after restart; queued to rerun from isolated artifacts." : job?.message,
    })).filter((job) => job.id).slice(0, MAX_JOBS),
  };

  function persist() {
    fsImpl.mkdirSync(path.dirname(stateFile), { recursive: true });
    const temporary = `${stateFile}.${process.pid}.tmp`;
    fsImpl.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fsImpl.renameSync(temporary, stateFile);
    fsImpl.chmodSync?.(stateFile, 0o600);
    onChange(publicState());
  }

  function publicState() {
    const jobs = state.jobs.map(normalizedJob);
    const counts = jobs.reduce((acc, job) => {
      acc[job.status] = (acc[job.status] || 0) + 1;
      return acc;
    }, {});
    return JSON.parse(JSON.stringify({
      version: VERSION,
      mode: "isolated_trader_signal_research_no_broker",
      running: activeJobs.size,
      queued: jobs.filter((job) => job.status === "queued").length,
      completed: (counts.success || 0) + (counts.partial || 0),
      blocked: counts.blocked || 0,
      failed: counts.failed || 0,
      jobs,
      safety: {
        brokerToolsAvailable: false,
        liveOrderAuthority: false,
        delayed13fOrderEligible: false,
        everyLiveOrderRequiresHumanGate: true,
      },
    }));
  }

  function providerEnvironment() {
    const payload = readJson(path.join(mainRuntimeRoot, "data", "provider_keys.json"), fsImpl, {}) || {};
    const mapping = {
      twelve_data_api_key: "STOCK_GURU_TWELVE_DATA_API_KEY",
      fmp_api_key: "STOCK_GURU_FMP_API_KEY",
      alpha_vantage_api_key: "STOCK_GURU_ALPHA_VANTAGE_API_KEY",
      fred_api_key: "STOCK_GURU_FRED_API_KEY",
    };
    return Object.fromEntries(Object.entries(mapping)
      .map(([key, envName]) => [envName, String(environment[envName] || payload[key] || "").trim()])
      .filter(([, value]) => value));
  }

  function pythonExecutable() {
    const candidates = [
      path.join(stockRoot, ".venv", "bin", "python"),
      path.join(path.resolve(String(environment.STOCK_GURU_SOURCE_PATH || stockRoot)), ".venv", "bin", "python"),
    ];
    const executable = candidates.find((candidate) => fsImpl.existsSync(candidate));
    if (!executable || !fsImpl.existsSync(path.join(stockRoot, "src", "stock_guru"))) {
      throw new Error("The Stock Guru Python research runtime is not connected.");
    }
    return executable;
  }

  function jobDirectory(job) {
    const resolved = path.join(jobRoot, job.id);
    fsImpl.mkdirSync(path.join(resolved, "data"), { recursive: true });
    fsImpl.mkdirSync(path.join(resolved, "reports"), { recursive: true });
    return resolved;
  }

  function setStage(job, stageId, patch = {}) {
    const index = job.stages.findIndex((stage) => stage.id === stageId);
    if (index < 0) return;
    job.stages[index] = normalizedStage({ ...job.stages[index], ...patch });
    job.currentStage = stageId;
    persist();
  }

  async function runInternalStage(job, stageId, operation) {
    const startedAt = nowIso();
    setStage(job, stageId, { status: "running", startedAt, completedAt: null, detail: "Working now" });
    try {
      const value = await operation();
      const completedAt = nowIso();
      setStage(job, stageId, {
        status: value?.status || "success",
        completedAt,
        durationMs: Date.parse(completedAt) - Date.parse(startedAt),
        detail: value?.detail || "Stage completed with persisted evidence.",
        evidenceCount: value?.evidenceCount || 0,
      });
      return value;
    } catch (error) {
      const completedAt = nowIso();
      setStage(job, stageId, {
        status: "failed",
        completedAt,
        durationMs: Date.parse(completedAt) - Date.parse(startedAt),
        detail: shortText(error?.message || error, 400),
      });
      throw error;
    }
  }

  function runPython(job, stageId, args) {
    const runtimeRoot = jobDirectory(job);
    return runInternalStage(job, stageId, () => new Promise((resolve, reject) => {
      const executable = pythonExecutable();
      let stdout = "";
      let stderr = "";
      let settled = false;
      const child = spawnImpl(executable, ["-m", "stock_guru", ...args], {
        cwd: stockRoot,
        env: {
          ...environment,
          ...providerEnvironment(),
          PYTHONPATH: [path.join(stockRoot, "src"), environment.PYTHONPATH].filter(Boolean).join(path.delimiter),
          PYTHONPYCACHEPREFIX: environment.PYTHONPYCACHEPREFIX || path.join(os.tmpdir(), "argentum-stock-guru-pycache"),
          STOCK_GURU_RUNTIME_DIR: runtimeRoot,
          STOCK_GURU_PROGRESS_FILE: path.join(runtimeRoot, "data", "argentum-research-progress.json"),
          STOCK_GURU_PROGRESS_RUN_ID: job.id,
          STOCK_GURU_PROGRESS_HOLD_MS: "0",
        },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      activeChildren.add(child);
      const timer = setTimeout(() => {
        try { child.kill?.("SIGTERM"); } catch (_error) { /* already stopped */ }
      }, timeoutMs);
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        activeChildren.delete(child);
        if (error) reject(error);
        else resolve(value);
      };
      child.stdout?.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-MAX_OUTPUT_CHARS * 2); });
      child.stderr?.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-MAX_OUTPUT_CHARS * 2); });
      child.once("error", (error) => finish(error));
      child.once("close", (code, signal) => {
        if (stopping) return finish(new Error("Trader research stopped cleanly with Argentum."));
        if (code !== 0) return finish(new Error(cleanOutput(stderr || stdout || `Research process exited ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`)));
        return finish(null, { detail: cleanOutput(stdout) || "Research command completed." });
      });
    }));
  }

  function buildResult(job) {
    const runtimeRoot = jobDirectory(job);
    const evaluationsPayload = readJson(path.join(runtimeRoot, "reports", "evaluations.json"), fsImpl, []);
    const evaluations = Array.isArray(evaluationsPayload) ? evaluationsPayload : Array.isArray(evaluationsPayload?.evaluations) ? evaluationsPayload.evaluations : [];
    const evaluation = evaluations.find((item) => cleanSymbol(item?.ticker || item?.symbol) === job.symbol) || evaluations[0] || {};
    const researchPayload = readJson(path.join(runtimeRoot, "reports", "research.json"), fsImpl, {});
    const research = (Array.isArray(researchPayload?.tickers) ? researchPayload.tickers : []).find((item) => cleanSymbol(item?.ticker) === job.symbol) || {};
    const intradayPayload = readJson(path.join(runtimeRoot, "data", "intraday_context.json"), fsImpl, {});
    const intraday = intradayPayload?.symbols?.[job.symbol] || intradayPayload?.[job.symbol] || {};
    const market = readJson(path.join(runtimeRoot, "data", "market_context.json"), fsImpl, {}) || {};
    const news = (Array.isArray(research.news) ? research.news : []).slice(0, 5).map((item) => ({
      title: shortText(item?.title, 240),
      publisher: shortText(item?.publisher, 100),
      publishedAt: safeDate(item?.published_at),
      url: safeUrl(item?.url),
    })).filter((item) => item.title);
    const evidence = [
      job.sourceUrl ? { type: "institutional_filing", label: "Official public disclosure", url: job.sourceUrl } : null,
      job.resolution ? { type: "symbol_resolution", label: `${job.resolution.provider} match ${Math.round(job.resolution.matchScore * 100)}%`, url: "" } : null,
      evaluation.data_provider ? { type: "market_data", label: `${shortText(evaluation.data_provider, 80)} · ${shortText(evaluation.data_health_state || "health unknown", 60)}`, url: "" } : null,
      ...news.map((item) => ({ type: "news", label: item.title, url: item.url })),
    ].filter(Boolean).slice(0, 10);
    return {
      symbol: job.symbol,
      evaluation: {
        decision: shortText(evaluation.decision || "NO_RESULT", 60),
        score: boundedNumber(evaluation.score, 0, 100, 0),
        confidence: shortText(evaluation.confidence, 40),
        currentPrice: Number.isFinite(Number(evaluation.current_price)) ? Number(evaluation.current_price) : null,
        setupType: shortText(evaluation.setup_type, 100),
        mainReason: shortText(evaluation.main_reason_valid, 400),
        mainRisk: shortText(evaluation.main_risk || evaluation.rejection_reason, 400),
        dataProvider: shortText(evaluation.data_provider, 80),
        dataHealth: shortText(evaluation.data_health_state, 60),
        dataQualityScore: Number.isFinite(Number(evaluation.data_quality_score)) ? Number(evaluation.data_quality_score) : null,
      },
      company: {
        name: shortText(research.company_name || job.issuerName, 200),
        sector: shortText(research.sector, 100),
        recommendation: shortText(research.recommendation, 100),
        marketCap: Number.isFinite(Number(research.market_cap)) ? Number(research.market_cap) : null,
        nextEarningsAt: safeDate(research.next_earnings_at),
        catalystScore: Number.isFinite(Number(research.catalyst_score)) ? Number(research.catalyst_score) : null,
      },
      intraday: {
        alignment: shortText(intraday.alignment, 80),
        dataHealth: shortText(intraday.data_health_state, 60),
        sourceProvider: shortText(intraday.source_provider, 80),
        lastPrice: Number.isFinite(Number(intraday.last_price)) ? Number(intraday.last_price) : null,
        relativeVolume: Number.isFinite(Number(intraday.relative_volume)) ? Number(intraday.relative_volume) : null,
        spreadPct: Number.isFinite(Number(intraday.spread_pct)) ? Number(intraday.spread_pct) : null,
      },
      market: {
        regime: shortText(market.regime || market.market_regime, 100),
        riskState: shortText(market.risk_state, 60),
        rateState: shortText(market.rate_state || market.rates?.rate_state, 60),
      },
      news,
      evidence,
      artifactCount: [evaluations.length > 0, Object.keys(research).length > 0, Object.keys(intraday).length > 0, Object.keys(market).length > 0].filter(Boolean).length,
      generatedAt: nowIso(),
      brokerCalled: false,
      liveOrdersPlaced: 0,
    };
  }

  async function executeJob(job) {
    activeJobs.add(job.id);
    job.status = "running";
    job.startedAt = nowIso();
    job.completedAt = null;
    job.message = "Independent trader-signal research is running.";
    persist();
    try {
      if (!job.symbol) {
        const resolved = await runInternalStage(job, "ticker_resolution", async () => {
          const resolution = await resolveSymbolImpl({ issuerName: job.issuerName, securityIdentifier: job.securityIdentifier });
          const symbol = cleanSymbol(resolution?.symbol);
          if (!symbol) throw new Error("The symbol resolver did not return a valid US equity ticker.");
          job.symbol = symbol;
          job.resolution = resolution;
          return { detail: `${symbol} matched to ${shortText(resolution.matchedName || job.issuerName, 120)} with ${Math.round(Number(resolution.matchScore || 0) * 100)}% name confidence.`, evidenceCount: 1 };
        });
        if (!resolved) throw new Error("Ticker resolution failed.");
      } else {
        setStage(job, "ticker_resolution", { status: "success", startedAt: job.startedAt, completedAt: job.startedAt, durationMs: 0, detail: `${job.symbol} came from a configured or previously validated filing map.`, evidenceCount: 1 });
      }
      await runPython(job, "market_data_quant", ["evaluate", "--tickers", job.symbol, "--cache-first-history", "--history-cache-hours", "6", "--limit", "1"]);
      await runPython(job, "multi_timeframe", ["intraday-context", "--tickers", job.symbol]);
      await runPython(job, "company_news", ["research", "--tickers", job.symbol, "--news-limit", "5"]);
      job.result = buildResult(job);
      const stageFailures = job.stages.filter((stage) => stage.status === "failed");
      job.status = stageFailures.length ? "partial" : "success";
      job.message = stageFailures.length
        ? `${job.symbol} research completed with ${stageFailures.length} failed evidence stage.`
        : `${job.symbol} research completed with ${job.result.artifactCount} persisted evidence artifacts.`;
    } catch (error) {
      const failedStage = job.stages.find((stage) => stage.status === "failed")?.id;
      job.status = failedStage === "ticker_resolution" ? "blocked" : stopping ? "stopped" : "failed";
      job.message = shortText(error?.message || error, 400);
      job.warnings = [...new Set([...(job.warnings || []), job.message])].slice(0, 8);
    } finally {
      job.completedAt = nowIso();
      job.durationMs = Math.max(0, Date.parse(job.completedAt) - Date.parse(job.startedAt));
      activeJobs.delete(job.id);
      persist();
      scheduleDrain();
    }
  }

  function scheduleDrain() {
    if (stopping || drainScheduled) return;
    drainScheduled = true;
    setImmediate(() => {
      drainScheduled = false;
      while (!stopping && activeJobs.size < concurrency) {
        const next = state.jobs.find((job) => job.status === "queued" && !activeJobs.has(job.id));
        if (!next) break;
        executeJob(next).catch(() => {});
      }
    });
  }

  function signalToJob(signal = {}) {
    const sourceId = shortText(signal.sourceId || "public_signal", 80);
    const traderName = shortText(signal.traderName || signal.sourceName || "Unknown institutional manager", 180);
    const issuerName = shortText(signal.issuerName || signal.symbol || "", 200);
    const inputSymbol = signal.tickerResolved === false ? "" : cleanSymbol(signal.symbol);
    const securityIdentifier = String(signal.securityIdentifier || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    if (!issuerName || (!inputSymbol && !securityIdentifier)) return null;
    const dedupeKey = shortText(signal.id || signal.fingerprint || [sourceId, traderName, issuerName, securityIdentifier, signal.disclosedAt, signal.side].join("|"), 240);
    const digest = crypto.createHash("sha256").update(dedupeKey).digest("hex").slice(0, 20);
    return normalizedJob({
      id: `trader-research-${digest}`,
      dedupeKey,
      triggerType: sourceId === "sec_13f" ? "institutional_holding" : "current_public_signal",
      traderName,
      issuerName,
      securityIdentifier,
      inputSymbol,
      symbol: inputSymbol,
      side: signal.side,
      sourceId,
      sourceUrl: signal.sourceUrl,
      disclosedAt: signal.disclosedAt,
      observedAt: signal.observedAt,
      asFiledValue: signal.asFiledValue,
      shareDelta: signal.shareDelta,
      status: "queued",
      currentStage: "signal_capture",
      message: "Signal captured; isolated research agent queued.",
      queuedAt: nowIso(),
      stages: [
        { id: "signal_capture", label: "Signal capture", status: "success", startedAt: nowIso(), completedAt: nowIso(), detail: "Attributable public signal persisted outside the main evaluator report.", evidenceCount: signal.sourceUrl ? 1 : 0 },
        { id: "ticker_resolution", label: "Ticker resolution", status: "pending" },
        { id: "market_data_quant", label: "Market data + quant", status: "pending" },
        { id: "multi_timeframe", label: "Multi-timeframe context", status: "pending" },
        { id: "company_news", label: "Company + news", status: "pending" },
      ],
    });
  }

  function enqueueSignals(signals = []) {
    const queuedCount = state.jobs.filter((job) => ["queued", "running"].includes(job.status)).length;
    let remaining = Math.max(0, MAX_QUEUE - queuedCount);
    let added = 0;
    for (const signal of signals) {
      if (remaining <= 0 || added >= MAX_ENQUEUE_PER_SNAPSHOT) break;
      const job = signalToJob(signal);
      if (!job || state.jobs.some((item) => item.id === job.id)) continue;
      state.jobs.unshift(job);
      added += 1;
      remaining -= 1;
    }
    state.jobs = state.jobs.slice(0, MAX_JOBS);
    if (added) persist();
    scheduleDrain();
    return { added, state: publicState() };
  }

  function enqueueFromSnapshot(snapshot = {}) {
    const institutional = Array.isArray(snapshot?.mirror?.importer13f?.researchSignals)
      ? snapshot.mirror.importer13f.researchSignals
      : [];
    const currentSignals = (Array.isArray(snapshot?.mirror?.candidates) ? snapshot.mirror.candidates : [])
      .filter((item) => item?.tickerResolved !== false && cleanSymbol(item?.symbol))
      .map((item) => ({ ...item, issuerName: item.symbol, securityIdentifier: "" }));
    const ordered = [...institutional]
      .sort((a, b) => Number(b.asFiledValue || 0) - Number(a.asFiledValue || 0))
      .concat(currentSignals);
    return enqueueSignals(ordered);
  }

  function retry(jobId) {
    const job = state.jobs.find((item) => item.id === String(jobId || ""));
    if (!job) return null;
    if (["queued", "running"].includes(job.status)) return normalizedJob(job);
    job.status = "queued";
    job.attempt += 1;
    job.message = "Retry queued from the last attributable signal.";
    job.startedAt = null;
    job.completedAt = null;
    job.durationMs = 0;
    job.result = null;
    job.warnings = [];
    job.stages = job.stages.map((stage) => stage.id === "signal_capture"
      ? { ...stage, status: "success" }
      : { ...stage, status: "pending", startedAt: null, completedAt: null, durationMs: 0, detail: "", evidenceCount: 0 });
    persist();
    scheduleDrain();
    return normalizedJob(job);
  }

  function start() {
    stopping = false;
    scheduleDrain();
    return publicState();
  }

  async function stop() {
    stopping = true;
    for (const child of activeChildren) {
      try { child.kill?.("SIGTERM"); } catch (_error) { /* already stopped */ }
    }
    const deadline = Date.now() + 2_000;
    while (activeJobs.size && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return publicState();
  }

  return {
    enqueueFromSnapshot,
    enqueueSignals,
    getState: publicState,
    retry,
    start,
    stop,
  };
}

module.exports = {
  companyMatchScore,
  createStockTraderResearchAgent,
  resolveSymbolWithYahoo,
};

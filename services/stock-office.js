const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const STOCK_WORKSPACE_ID = "stock-guru-local";
const STOCK_OFFICE_ID = "stock-office";
const MAX_JSON_BYTES = 2_000_000;
const MAX_TEXT_BYTES = 80_000;
const MAX_CHAT_MESSAGES = 160;
const MAX_SYNC_RUNS = 80;
const MAX_ASSISTANT_RUNS = 80;
const MARKET_STALE_HOURS = 18;
const COPY_PLAN_STALE_HOURS = 96;

const SOURCE_DEFINITIONS = [
  {
    id: "evaluations",
    label: "Evaluator report",
    relPath: "reports/evaluations.json",
    type: "json",
    category: "records",
    staleAfterHours: MARKET_STALE_HOURS,
  },
  {
    id: "universe",
    label: "Tracked universe",
    relPath: "config/universe.txt",
    type: "lines",
    category: "configuration",
  },
  {
    id: "settings",
    label: "Guardrail settings",
    relPath: "config/settings.json",
    type: "json",
    category: "configuration",
  },
  {
    id: "copy_trader_config",
    label: "Copy Trader policy",
    relPath: "config/copy_trader.json",
    type: "json",
    category: "configuration",
  },
  {
    id: "copy_trader_watchlist",
    label: "Copy Trader SEC watchlist",
    relPath: "config/copy_trader_watchlist.json",
    type: "json",
    category: "configuration",
  },
  {
    id: "copy_import_status",
    label: "Official SEC import status",
    relPath: "data/copy_import_status.json",
    type: "json",
    category: "copy_signals",
    staleAfterHours: 24,
  },
  {
    id: "copy_trader_plan",
    label: "Copy Trader mirror plan",
    relPath: "reports/copy_trader_plan.json",
    type: "json",
    category: "copy_signals",
    staleAfterHours: COPY_PLAN_STALE_HOURS,
  },
  {
    id: "broker_status",
    label: "Broker status snapshot",
    relPath: "data/broker_status.json",
    type: "json",
    category: "broker_snapshot",
    staleAfterHours: MARKET_STALE_HOURS,
  },
  {
    id: "live_auto_arm_plan",
    label: "Live auto arm plan",
    relPath: "data/live_auto_arm_plan.json",
    type: "json",
    category: "readiness",
    staleAfterHours: 72,
  },
  {
    id: "live_auto_launch_checklist",
    label: "Live launch checklist",
    relPath: "data/live_auto_launch_checklist.json",
    type: "json",
    category: "readiness",
    staleAfterHours: 72,
  },
  {
    id: "performance_audit",
    label: "Performance audit",
    relPath: "data/performance_audit.json",
    type: "json",
    category: "risk",
    staleAfterHours: 72,
  },
  {
    id: "strategy_health",
    label: "Strategy health",
    relPath: "data/strategy_health.json",
    type: "json",
    category: "risk",
    staleAfterHours: 72,
  },
  {
    id: "capital_policy",
    label: "Capital policy",
    relPath: "data/capital_policy.json",
    type: "json",
    category: "risk",
    staleAfterHours: 72,
  },
  {
    id: "latest_ticket",
    label: "Latest paper ticket",
    relPath: "reports/latest_ticket.md",
    type: "text",
    category: "report",
    staleAfterHours: MARKET_STALE_HOURS,
  },
  {
    id: "mission",
    label: "Growth mission",
    relPath: "reports/mission.md",
    type: "text",
    category: "report",
    staleAfterHours: 72,
  },
  {
    id: "provider_keys",
    label: "Provider credential file",
    relPath: "data/provider_keys.json",
    type: "secret",
    category: "credentials",
  },
];

function nowIso() {
  return new Date().toISOString();
}

function sourceId() {
  return crypto.randomUUID();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clampNumber(value, min, max, fallback = min) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function safeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatUsd(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return `$${parsed.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function maskAccountNumber(value) {
  const raw = String(value || "").replace(/\D/g, "");
  if (!raw) return "";
  if (raw.length <= 4) return `acct-${raw}`;
  return `acct-${"*".repeat(Math.max(0, raw.length - 4))}${raw.slice(-4)}`;
}

function redactSensitiveText(value) {
  return String(value || "")
    .replace(/("(?:account_number|account|acct)"\s*:\s*")([^"]+)(")/gi, (_, left, raw, right) => `${left}${maskAccountNumber(raw)}${right}`)
    .replace(/\b(account\s*:?\s*)(\d{5,})\b/gi, (_, left, raw) => `${left}${maskAccountNumber(raw)}`)
    .replace(/\b(api[_-]?key|secret|token|password|authorization|bearer)\b\s*[:=]\s*["']?[^"',}\s]+/gi, "$1: [REDACTED]")
    .replace(/\b[A-Za-z0-9_-]{28,}\b/g, "[REDACTED]");
}

function safeJoin(rootDir, relativePath) {
  const root = path.resolve(rootDir);
  const absolutePath = path.resolve(root, relativePath);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error("Stock source path escaped the workspace.");
  }
  return absolutePath;
}

function resolveStockRoot(rootDir, configuredPath = process.env.STOCK_GURU_PATH || "") {
  return path.resolve(configuredPath || path.join(rootDir, "stocks"));
}

function sourceAgeHours(source, at = new Date()) {
  const timestamp = source.generatedAt || source.lastModified;
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, (at.getTime() - date.getTime()) / 3_600_000);
}

function readSource(stockRoot, definition, at = new Date()) {
  const source = {
    id: definition.id,
    label: definition.label,
    category: definition.category,
    relPath: definition.relPath,
    type: definition.type,
    status: "missing",
    exists: false,
    lastModified: null,
    generatedAt: null,
    stale: false,
    recordCount: 0,
    summary: "Source file is not present.",
    safeError: "",
  };

  let absolutePath;
  try {
    absolutePath = safeJoin(stockRoot, definition.relPath);
  } catch (error) {
    source.status = "error";
    source.safeError = "Unsafe source path blocked.";
    source.summary = source.safeError;
    return { source, data: null };
  }

  try {
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      source.status = "error";
      source.safeError = "Source exists but is not a regular file.";
      source.summary = source.safeError;
      return { source, data: null };
    }
    source.exists = true;
    source.lastModified = stat.mtime.toISOString();

    if (definition.type === "secret") {
      source.status = "configured";
      source.summary = "Credential source exists. Values are intentionally not read or returned.";
      source.recordCount = 0;
      return { source, data: null };
    }

    const maxBytes = definition.type === "text" || definition.type === "lines" ? MAX_TEXT_BYTES : MAX_JSON_BYTES;
    if (stat.size > maxBytes) {
      source.status = "error";
      source.safeError = "Source is larger than the safe local read limit.";
      source.summary = source.safeError;
      return { source, data: null };
    }

    const raw = fs.readFileSync(absolutePath, "utf8");
    let data;
    if (definition.type === "json") {
      data = JSON.parse(raw);
      source.recordCount = Array.isArray(data) ? data.length : Object.keys(data || {}).length;
      source.generatedAt = safeDate(data?.generated_at || data?.updated_at || data?.readiness?.generated_at);
    } else if (definition.type === "lines") {
      data = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      source.recordCount = data.length;
    } else {
      data = redactSensitiveText(raw.slice(0, MAX_TEXT_BYTES));
      source.recordCount = data ? 1 : 0;
      source.generatedAt = safeDate((data.match(/Generated:\s*([^\n]+)/i) || [])[1]);
    }

    const ageHours = sourceAgeHours(source, at);
    source.stale = Boolean(definition.staleAfterHours && ageHours !== null && ageHours > definition.staleAfterHours);
    source.status = source.stale ? "stale" : "ready";
    source.summary = source.stale
      ? `Loaded, but older than ${definition.staleAfterHours} hours.`
      : "Loaded from local Stock Guru workspace.";
    return { source, data };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { source, data: null };
    }
    source.status = "error";
    source.safeError = definition.type === "json" ? "Source could not be parsed safely." : "Source could not be read safely.";
    source.summary = source.safeError;
    return { source, data: null };
  }
}

function normalizeStockOfficeState(input = {}) {
  const value = isPlainObject(input) ? input : {};
  return {
    workspaceId: STOCK_WORKSPACE_ID,
    lastLocalSyncAt: safeDate(value.lastLocalSyncAt),
    selectedTicker: String(value.selectedTicker || "").toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12),
    chatMessages: normalizeStockChatMessages(value.chatMessages || []),
    syncRuns: normalizeSyncRuns(value.syncRuns || []),
    assistantRuns: normalizeAssistantRuns(value.assistantRuns || []),
  };
}

function normalizeStockChatMessages(messages = []) {
  const allowed = new Set(["operator", "assistant", "system"]);
  return (Array.isArray(messages) ? messages : [])
    .map((message) => {
      const text = redactSensitiveText(String(message?.text || "").trim()).slice(0, 4000);
      if (!text) return null;
      return {
        id: String(message?.id || `stock-chat-${sourceId()}`),
        workspaceId: STOCK_WORKSPACE_ID,
        sender: allowed.has(message?.sender) ? message.sender : "assistant",
        text,
        citations: Array.isArray(message?.citations) ? message.citations.slice(0, 8).map(normalizeCitation).filter(Boolean) : [],
        createdAt: safeDate(message?.createdAt) || nowIso(),
      };
    })
    .filter(Boolean)
    .slice(-MAX_CHAT_MESSAGES);
}

function normalizeSyncRuns(runs = []) {
  return (Array.isArray(runs) ? runs : [])
    .map((run) => ({
      id: String(run?.id || `stock-sync-${sourceId()}`),
      mode: String(run?.mode || "local_file_rescan").slice(0, 48),
      status: ["success", "partial", "failed"].includes(run?.status) ? run.status : "success",
      recordsImported: clampNumber(run?.recordsImported, 0, 1_000_000, 0),
      changedRecords: clampNumber(run?.changedRecords, 0, 1_000_000, 0),
      warnings: Array.isArray(run?.warnings) ? run.warnings.map((item) => redactSensitiveText(item).slice(0, 180)).slice(0, 8) : [],
      errors: Array.isArray(run?.errors) ? run.errors.map((item) => redactSensitiveText(item).slice(0, 180)).slice(0, 8) : [],
      startedAt: safeDate(run?.startedAt) || nowIso(),
      completedAt: safeDate(run?.completedAt) || safeDate(run?.startedAt) || nowIso(),
    }))
    .slice(0, MAX_SYNC_RUNS);
}

function normalizeAssistantRuns(runs = []) {
  return (Array.isArray(runs) ? runs : [])
    .map((run) => ({
      id: String(run?.id || `stock-assistant-${sourceId()}`),
      question: redactSensitiveText(String(run?.question || "").trim()).slice(0, 500),
      answerPreview: redactSensitiveText(String(run?.answerPreview || "").trim()).slice(0, 500),
      citationCount: clampNumber(run?.citationCount, 0, 100, 0),
      createdAt: safeDate(run?.createdAt) || nowIso(),
    }))
    .slice(0, MAX_ASSISTANT_RUNS);
}

function normalizeCitation(citation = {}) {
  if (!isPlainObject(citation)) return null;
  const type = String(citation.type || "source").slice(0, 32);
  const label = redactSensitiveText(String(citation.label || citation.id || "Stock source").trim()).slice(0, 120);
  const id = redactSensitiveText(String(citation.id || label).trim()).slice(0, 80);
  if (!label) return null;
  return { type, id, label };
}

function stockRecordStatus(record) {
  const decision = String(record.decision || "").toUpperCase();
  if (decision.includes("VALID")) return "valid_setup";
  if (record.hard_rejection_triggered || decision.includes("REJECT") || decision.includes("AVOID")) return "rejected";
  if (decision.includes("HOLD") || decision.includes("WATCH")) return "watch";
  return "review";
}

function normalizeEvaluationRecord(record, source) {
  if (!isPlainObject(record)) return null;
  const ticker = String(record.ticker || record.symbol || "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
  if (!ticker) return null;
  const score = Number(record.score);
  const status = stockRecordStatus(record);
  return {
    id: `ticker-${ticker}`,
    workspaceId: STOCK_WORKSPACE_ID,
    ticker,
    name: ticker,
    status,
    decision: String(record.decision || status).slice(0, 80),
    score: Number.isFinite(score) ? score : null,
    confidence: String(record.confidence || "unknown").slice(0, 40),
    currentPrice: Number.isFinite(Number(record.current_price)) ? Number(record.current_price) : null,
    setupType: String(record.setup_type || "Unclassified").slice(0, 80),
    marketCondition: String(record.market_condition || "").slice(0, 120),
    entryZone: String(record.entry_zone || "").slice(0, 80),
    stopLoss: Number.isFinite(Number(record.stop_loss)) ? Number(record.stop_loss) : null,
    target1: Number.isFinite(Number(record.target_1)) ? Number(record.target_1) : null,
    target2: Number.isFinite(Number(record.target_2)) ? Number(record.target_2) : null,
    riskReward: String(record.risk_reward || "").slice(0, 60),
    mainRisk: String(record.main_risk || record.rejection_reason || "No risk note recorded.").slice(0, 260),
    rejectionReason: String(record.rejection_reason || "").slice(0, 180),
    liquidityPassed: Boolean(record.liquidity_passed),
    spreadPassed: Boolean(record.spread_passed),
    trendConfirmation: Boolean(record.trend_confirmation),
    volumeConfirmation: Boolean(record.volume_confirmation),
    dataFresh: Boolean(record.data_fresh),
    source: source.label,
    sourceId: source.id,
    provenance: definitionProvenance(source),
    lastUpdated: source.generatedAt || source.lastModified || null,
  };
}

function definitionProvenance(source) {
  return {
    sourceId: source.id,
    sourceLabel: source.label,
    relPath: source.relPath,
    status: source.status,
    generatedAt: source.generatedAt,
    lastModified: source.lastModified,
  };
}

function normalizeBrokerStatus(data, source) {
  if (!isPlainObject(data)) {
    return {
      configured: false,
      account: "",
      accountValue: null,
      cash: null,
      buyingPower: null,
      positions: [],
      openOrders: [],
      updatedAt: source?.lastModified || null,
    };
  }
  return {
    configured: true,
    account: maskAccountNumber(data.account_number),
    accountValue: formatUsd(data.account_value),
    cash: formatUsd(data.cash),
    buyingPower: formatUsd(data.buying_power),
    deployedPrincipal: formatUsd(data.deployed_principal),
    lockedProfit: formatUsd(data.locked_profit),
    updatedAt: safeDate(data.updated_at) || source?.generatedAt || source?.lastModified || null,
    positions: (Array.isArray(data.positions) ? data.positions : []).slice(0, 20).map((position) => ({
      symbol: String(position.symbol || "").toUpperCase().slice(0, 12),
      quantity: Number.isFinite(Number(position.quantity)) ? Number(position.quantity) : null,
      averageBuyPrice: Number.isFinite(Number(position.average_buy_price)) ? Number(position.average_buy_price) : null,
      currentPrice: Number.isFinite(Number(position.current_price)) ? Number(position.current_price) : null,
      unrealizedPnl: Number.isFinite(Number(position.unrealized_pnl)) ? Number(position.unrealized_pnl) : null,
      unrealizedPnlPct: Number.isFinite(Number(position.unrealized_pnl_pct)) ? Number(position.unrealized_pnl_pct) : null,
      sharesAvailableForSells: Number.isFinite(Number(position.shares_available_for_sells)) ? Number(position.shares_available_for_sells) : null,
      stopLoss: Number.isFinite(Number(position.stop_loss)) ? Number(position.stop_loss) : null,
      target1: Number.isFinite(Number(position.target_1)) ? Number(position.target_1) : null,
      target2: Number.isFinite(Number(position.target_2)) ? Number(position.target_2) : null,
    })),
    openOrders: (Array.isArray(data.open_orders) ? data.open_orders : []).slice(0, 20).map((order) => redactSensitiveText(JSON.stringify(order)).slice(0, 280)),
  };
}

function safePublicUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password) return "";
    return url.toString().slice(0, 1000);
  } catch {
    return "";
  }
}

function normalizeMirrorPlan(data, source) {
  const empty = {
    available: false,
    mode: "paper_and_human_gate_only",
    generatedAt: source?.generatedAt || source?.lastModified || null,
    stale: Boolean(source?.stale),
    summary: {
      signalsReceived: 0,
      paperReady: 0,
      researchOnly: 0,
      rejected: 0,
      duplicate: 0,
      plannedPaperNotional: "$0.00",
      liveOrdersPlaced: 0,
      humanGateRequiredForLive: true,
    },
    policy: {},
    sources: [],
    candidates: [],
    warnings: ["No Copy Trader plan is loaded. Run the local copy-plan command after importing attributable public signals."],
  };
  if (!isPlainObject(data)) return empty;
  const allowedStatuses = new Set(["paper_ready", "research_only", "rejected", "duplicate"]);
  const candidates = (Array.isArray(data.candidates) ? data.candidates : [])
    .slice(0, 250)
    .map((candidate, index) => {
      if (!isPlainObject(candidate)) return null;
      const assetType = String(candidate.asset_type || "equity").toLowerCase().slice(0, 40);
      const side = String(candidate.side || "").toUpperCase().slice(0, 12);
      const symbol = String(candidate.symbol || "").toUpperCase().replace(/[^A-Z0-9.\-_:\s]/g, "").slice(0, 80);
      if (!symbol || !side) return null;
      const status = allowedStatuses.has(candidate.status) ? candidate.status : "rejected";
      const notional = Number(candidate.mirror_notional_dollars);
      const shares = Number(candidate.mirror_shares);
      const drift = Number(candidate.price_drift_pct);
      return {
        id: String(candidate.id || `mirror-${index + 1}`).slice(0, 160),
        fingerprint: String(candidate.fingerprint || "").replace(/[^a-f0-9]/gi, "").slice(0, 64),
        sourceId: String(candidate.source_id || "").slice(0, 80),
        sourceName: redactSensitiveText(String(candidate.source_name || "Unknown public source")).slice(0, 160),
        traderName: redactSensitiveText(String(candidate.trader_name || "Unknown public source")).slice(0, 160),
        assetType,
        symbol,
        side,
        transactionCode: String(candidate.transaction_code || "").slice(0, 12),
        transactionAt: safeDate(candidate.transaction_at),
        disclosedAt: safeDate(candidate.disclosed_at),
        observedAt: safeDate(candidate.observed_at),
        sourceUrl: safePublicUrl(candidate.source_url),
        disclosureLagHours: clampNumber(candidate.disclosure_lag_hours, 0, 24 * 365, 0),
        signalAgeHours: clampNumber(candidate.signal_age_hours, 0, 24 * 365, 0),
        signalPrice: Number.isFinite(Number(candidate.signal_price)) ? Number(candidate.signal_price) : null,
        currentPrice: Number.isFinite(Number(candidate.current_price)) ? Number(candidate.current_price) : null,
        priceDriftPct: Number.isFinite(drift) ? drift : null,
        confidence: clampNumber(candidate.confidence, 0, 1, 0),
        status,
        mirrorNotionalDollars: Number.isFinite(notional) ? Math.max(0, notional) : 0,
        mirrorShares: Number.isFinite(shares) ? Math.max(0, shares) : 0,
        humanGateEligible: status === "paper_ready" && Boolean(candidate.human_gate_eligible),
        reasons: (Array.isArray(candidate.reasons) ? candidate.reasons : []).map((item) => redactSensitiveText(item).slice(0, 300)).filter(Boolean).slice(0, 8),
        notes: redactSensitiveText(String(candidate.notes || "")).slice(0, 500),
      };
    })
    .filter(Boolean);
  const inputSummary = isPlainObject(data.summary) ? data.summary : {};
  const count = (key, status) => clampNumber(inputSummary[key], 0, 1_000_000, candidates.filter((candidate) => candidate.status === status).length);
  const liveOrdersPlaced = clampNumber(inputSummary.live_orders_placed, 0, 1_000_000, 0);
  return {
    available: true,
    mode: String(data.mode || "paper_and_human_gate_only").slice(0, 80),
    generatedAt: safeDate(data.generated_at) || source?.generatedAt || source?.lastModified || null,
    stale: Boolean(source?.stale),
    summary: {
      signalsReceived: clampNumber(inputSummary.signals_received, 0, 1_000_000, candidates.length),
      paperReady: count("paper_ready", "paper_ready"),
      researchOnly: count("research_only", "research_only"),
      rejected: count("rejected", "rejected"),
      duplicate: count("duplicate", "duplicate"),
      plannedPaperNotional: formatUsd(inputSummary.planned_paper_notional_dollars) || "$0.00",
      liveOrdersPlaced,
      humanGateRequiredForLive: inputSummary.human_gate_required_for_live !== false,
    },
    policy: {
      totalBudgetDollars: clampNumber(data.policy?.total_budget_dollars, 0, 1_000_000, 0),
      maxTradeDollars: clampNumber(data.policy?.max_trade_dollars, 0, 1_000_000, 0),
      maxDailyNotionalDollars: clampNumber(data.policy?.max_daily_notional_dollars, 0, 1_000_000, 0),
      maxSourceAllocationPct: clampNumber(data.policy?.max_source_allocation_pct, 0, 1, 0),
      minimumConfidence: clampNumber(data.policy?.minimum_confidence, 0, 1, 0),
      maxPriceDriftPct: clampNumber(data.policy?.max_price_drift_pct, 0, 1, 0),
      maxSignalAgeHours: clampNumber(data.policy?.max_signal_age_hours, 0, 24 * 365, 0),
      allowedAssetTypes: (Array.isArray(data.policy?.allowed_asset_types) ? data.policy.allowed_asset_types : []).map((item) => String(item).slice(0, 40)).slice(0, 12),
      researchOnlyAssetTypes: (Array.isArray(data.policy?.research_only_asset_types) ? data.policy.research_only_asset_types : []).map((item) => String(item).slice(0, 40)).slice(0, 12),
    },
    sources: (Array.isArray(data.sources) ? data.sources : []).slice(0, 30).map((item) => ({
      id: String(item?.id || "").slice(0, 80),
      name: redactSensitiveText(String(item?.name || item?.id || "Public source")).slice(0, 160),
      sourceType: String(item?.source_type || "public_signal").slice(0, 80),
      enabled: Boolean(item?.enabled),
      mirrorEligible: Boolean(item?.mirror_eligible),
      maxDisclosureLagHours: clampNumber(item?.max_disclosure_lag_hours, 0, 24 * 365, 0),
      notes: redactSensitiveText(String(item?.notes || "")).slice(0, 600),
    })),
    candidates,
    warnings: (Array.isArray(data.warnings) ? data.warnings : []).map((item) => redactSensitiveText(item).slice(0, 400)).filter(Boolean).slice(0, 12),
  };
}

function normalizeCopyImportStatus(data, source) {
  const empty = {
    available: false,
    generatedAt: source?.generatedAt || source?.lastModified || null,
    stale: Boolean(source?.stale),
    source: "Official SEC EDGAR",
    watchlistEntries: 0,
    enabledEntries: 0,
    filingsScanned: 0,
    signalsImported: 0,
    signalsRetained: 0,
    liveOrdersPlaced: 0,
    warnings: [],
  };
  if (!isPlainObject(data)) return empty;
  return {
    available: true,
    generatedAt: safeDate(data.generated_at) || source?.generatedAt || source?.lastModified || null,
    stale: Boolean(source?.stale),
    source: redactSensitiveText(String(data.source || "Official SEC EDGAR")).slice(0, 160),
    watchlistEntries: clampNumber(data.watchlist_entries, 0, 10_000, 0),
    enabledEntries: clampNumber(data.enabled_entries, 0, 10_000, 0),
    filingsScanned: clampNumber(data.filings_scanned, 0, 100_000, 0),
    signalsImported: clampNumber(data.signals_imported, 0, 100_000, 0),
    signalsRetained: clampNumber(data.signals_retained, 0, 100_000, 0),
    liveOrdersPlaced: clampNumber(data.live_orders_placed, 0, 1_000_000, 0),
    warnings: (Array.isArray(data.warnings) ? data.warnings : []).map((item) => redactSensitiveText(item).slice(0, 400)).filter(Boolean).slice(0, 12),
  };
}

function summarizeSourceHealth(sources) {
  const counts = sources.reduce(
    (acc, source) => {
      acc.total += 1;
      acc[source.status] = (acc[source.status] || 0) + 1;
      return acc;
    },
    { total: 0, ready: 0, stale: 0, error: 0, missing: 0, configured: 0 },
  );
  let status = "healthy";
  if (counts.error) status = "error";
  else if (counts.stale) status = "stale";
  else if (counts.missing > counts.ready) status = "partial";
  return { ...counts, status };
}

function metricCounts(records, watchlist, broker, readiness, sourceHealth, mirror) {
  const validSetups = records.filter((record) => record.status === "valid_setup").length;
  const rejected = records.filter((record) => record.status === "rejected").length;
  const staleRecords = records.filter((record) => !record.dataFresh).length;
  const openOrders = Array.isArray(broker.openOrders) ? broker.openOrders.length : 0;
  return {
    trackedRecords: records.length,
    watchlistCount: watchlist.length,
    validSetups,
    rejectedRecords: rejected,
    reviewRecords: records.length - validSetups - rejected,
    staleRecords,
    brokerPositions: Array.isArray(broker.positions) ? broker.positions.length : 0,
    openOrders,
    accountValue: broker.accountValue,
    buyingPower: broker.buyingPower,
    readyForLiveAuto: Boolean(readiness.readyForLiveAuto),
    sourceStatus: sourceHealth.status,
    sourceErrors: sourceHealth.error,
    staleSources: sourceHealth.stale,
    mirrorSignals: mirror?.summary?.signalsReceived || 0,
    mirrorPaperReady: mirror?.summary?.paperReady || 0,
    mirrorResearchOnly: mirror?.summary?.researchOnly || 0,
    mirrorLiveOrdersPlaced: mirror?.summary?.liveOrdersPlaced || 0,
  };
}

function normalizeReadiness(armPlan, checklist, sourcesById) {
  const checks = [
    ...(Array.isArray(armPlan?.readiness?.checks) ? armPlan.readiness.checks : []),
    ...(Array.isArray(checklist?.readiness?.checks) ? checklist.readiness.checks : []),
  ];
  const blockers = [
    ...(Array.isArray(armPlan?.blockers) ? armPlan.blockers : []),
    ...checks.filter((check) => check?.passed === false && check?.severity === "blocker").map((check) => `${check.name}: ${check.detail || "not passed"}`),
  ];
  const warnings = [
    ...(Array.isArray(armPlan?.warnings) ? armPlan.warnings : []),
    ...(Array.isArray(checklist?.warnings) ? checklist.warnings : []),
    ...checks.filter((check) => check?.passed === false && check?.severity !== "blocker").map((check) => `${check.name}: ${check.detail || "not passed"}`),
  ];
  return {
    readyForLiveAuto: Boolean(armPlan?.readiness?.ready_for_live_auto || armPlan?.ready_for_live_auto || checklist?.ready_for_live_auto),
    action: String(armPlan?.action || "READ_ONLY").slice(0, 80),
    generatedAt: safeDate(armPlan?.generated_at || armPlan?.readiness?.generated_at || checklist?.generated_at || checklist?.readiness?.generated_at),
    checks: checks.slice(0, 24).map((check) => ({
      name: String(check?.name || "check").slice(0, 80),
      passed: Boolean(check?.passed),
      severity: String(check?.severity || "info").slice(0, 40),
      detail: redactSensitiveText(String(check?.detail || "")).slice(0, 220),
    })),
    blockers: Array.from(new Set(blockers.map((item) => redactSensitiveText(item).slice(0, 220)))).slice(0, 16),
    warnings: Array.from(new Set(warnings.map((item) => redactSensitiveText(item).slice(0, 220)))).slice(0, 16),
    sources: {
      armPlan: sourcesById.live_auto_arm_plan?.status || "missing",
      launchChecklist: sourcesById.live_auto_launch_checklist?.status || "missing",
    },
  };
}

function parseTicketReport(text) {
  const body = String(text || "");
  const get = (label) => {
    const match = body.match(new RegExp(`- ${label}:\\s*([^\\n]+)`, "i"));
    return match ? redactSensitiveText(match[1].trim()).slice(0, 160) : "";
  };
  return {
    action: get("Action") || "Unknown",
    ticker: get("Ticker"),
    reason: get("Reason"),
    generated: get("Generated"),
    manualBrokerActionRequired: /Manual broker action required:\s*yes/i.test(body),
  };
}

function buildAlerts({ available, sources, records, readiness, broker, sourceHealth, mirror }) {
  const alerts = [];
  if (!available) {
    alerts.push({ level: "error", title: "Stock workspace unavailable", body: "Set STOCK_GURU_PATH or keep the local stocks folder mounted." });
    return alerts;
  }
  if (sourceHealth.error) {
    alerts.push({ level: "error", title: "Source read error", body: `${sourceHealth.error} Stock Guru source(s) could not be read safely.` });
  }
  if (sourceHealth.stale) {
    alerts.push({ level: "warning", title: "Market data may be stale", body: `${sourceHealth.stale} source(s) are older than their freshness window.` });
  }
  if (!readiness.readyForLiveAuto) {
    alerts.push({ level: "warning", title: "Live auto is not armable", body: "Readiness checks block autonomous live-broker behavior. Paper mirroring and Human Gate review remain available." });
  }
  if (broker.configured && broker.buyingPower === "$0.00") {
    alerts.push({ level: "info", title: "No buying power", body: "The latest broker snapshot shows zero buying power. This office will not place orders." });
  }
  if (sources.some((source) => source.id === "provider_keys" && source.status === "configured")) {
    alerts.push({ level: "info", title: "Provider keys detected locally", body: "Credential values are not read by Argentum and are never returned to the browser." });
  }
  if (records.some((record) => record.status === "valid_setup")) {
    alerts.push({ level: "info", title: "Valid setups need review", body: "Evaluator records can be summarized for research, not treated as automatic trade instructions." });
  }
  if (!mirror?.available) {
    alerts.push({ level: "info", title: "Mirror Lab is waiting for signals", body: "Import attributable public disclosures, then run copy-plan to build paper/Human Gate candidates." });
  } else if (mirror.summary.liveOrdersPlaced > 0) {
    alerts.push({ level: "error", title: "Copy plan safety mismatch", body: "The mirror report claims a live order. Treat the plan as blocked and inspect its provenance." });
  } else if (mirror.summary.paperReady > 0) {
    alerts.push({ level: "info", title: "Paper mirror candidates ready", body: `${mirror.summary.paperReady} public signal(s) passed delay, drift, provenance, and bankroll checks. Live execution is still unavailable.` });
  }
  return alerts.slice(0, 8);
}

function buildActivity({ state, records, readiness, broker, ticket, sources, mirror }) {
  const syncRuns = normalizeSyncRuns(state?.stockOffice?.syncRuns || []);
  const entries = syncRuns.slice(0, 8).map((run) => ({
    id: run.id,
    type: "sync",
    title: `Local Stock sync ${run.status}`,
    body: `${run.recordsImported} records scanned. ${run.warnings.length} warnings, ${run.errors.length} errors.`,
    createdAt: run.completedAt,
  }));

  if (ticket?.ticker || (ticket?.action && ticket.action !== "Unknown")) {
    entries.push({
      id: "latest-ticket-activity",
      type: "paper_ticket",
      title: `Latest paper ticket: ${ticket.action || "Unknown"}`,
      body: [ticket.ticker, ticket.reason].filter(Boolean).join(" - ") || "Paper-ticket report was read from Stock Guru.",
      createdAt: safeDate(ticket.generated) || null,
    });
  }
  if (broker.positions?.length) {
    entries.push({
      id: "broker-position-activity",
      type: "broker_snapshot",
      title: `${broker.positions.length} broker position snapshot`,
      body: `Latest masked account ${broker.account || "unknown"}; no broker actions are performed by Argentum.`,
      createdAt: broker.updatedAt,
    });
  }
  if (readiness.blockers.length) {
    entries.push({
      id: "readiness-blockers-activity",
      type: "readiness",
      title: `${readiness.blockers.length} readiness blocker(s)`,
      body: readiness.blockers[0],
      createdAt: readiness.generatedAt,
    });
  }
  if (mirror?.available) {
    entries.push({
      id: "copy-trader-plan-activity",
      type: "copy_trader_plan",
      title: `${mirror.summary.signalsReceived} public copy signal(s) evaluated`,
      body: `${mirror.summary.paperReady} paper-ready; ${mirror.summary.researchOnly} research-only; 0 live orders placed.`,
      createdAt: mirror.generatedAt,
    });
  }
  const best = records[0];
  if (best) {
    entries.push({
      id: `top-record-${best.ticker}`,
      type: "record",
      title: `Top evaluator record: ${best.ticker}`,
      body: `${best.decision} score ${best.score ?? "n/a"} - ${best.mainRisk}`,
      createdAt: best.lastUpdated,
    });
  }
  const staleSource = sources.find((source) => source.status === "stale");
  if (staleSource) {
    entries.push({
      id: `stale-${staleSource.id}`,
      type: "freshness",
      title: `${staleSource.label} is stale`,
      body: staleSource.summary,
      createdAt: staleSource.lastModified,
    });
  }
  return entries
    .filter((entry) => entry.title)
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 16);
}

function loadStockOfficeSnapshot(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const state = options.state || {};
  const at = options.now ? new Date(options.now) : new Date();
  const stockRoot = resolveStockRoot(rootDir, options.stockRoot);
  const workspaceState = normalizeStockOfficeState(state.stockOffice || {});

  if (!fs.existsSync(stockRoot)) {
    const sourceHealth = summarizeSourceHealth([]);
    const snapshot = {
      workspace: baseWorkspace(stockRoot, false),
      available: false,
      generatedAt: at.toISOString(),
      sourceHealth,
      sources: [],
      records: [],
      positions: [],
      broker: normalizeBrokerStatus(null, null),
      readiness: normalizeReadiness(null, null, {}),
      mirror: { ...normalizeMirrorPlan(null, null), importer: normalizeCopyImportStatus(null, null) },
      watchlist: [],
      ticket: parseTicketReport(""),
      metrics: metricCounts([], [], normalizeBrokerStatus(null, null), normalizeReadiness(null, null, {}), sourceHealth, normalizeMirrorPlan(null, null)),
      alerts: [],
      activity: [],
      chatMessages: workspaceState.chatMessages,
      syncRuns: workspaceState.syncRuns,
      assistantRuns: workspaceState.assistantRuns,
      permissions: stockPermissions(),
      threatModel: stockThreatModel(),
    };
    snapshot.alerts = buildAlerts({ available: false, sources: [], records: [], readiness: snapshot.readiness, broker: snapshot.broker, sourceHealth, mirror: snapshot.mirror });
    return snapshot;
  }

  const readResults = SOURCE_DEFINITIONS.map((definition) => readSource(stockRoot, definition, at));
  const sources = readResults.map((result) => result.source);
  const byId = Object.fromEntries(readResults.map((result) => [result.source.id, result]));
  const sourceHealth = summarizeSourceHealth(sources);
  const evaluations = Array.isArray(byId.evaluations?.data) ? byId.evaluations.data : [];
  const evaluationSource = byId.evaluations?.source || SOURCE_DEFINITIONS[0];
  const records = evaluations
    .map((record) => normalizeEvaluationRecord(record, evaluationSource))
    .filter(Boolean)
    .sort((a, b) => {
      const statusDelta = (b.status === "valid_setup" ? 1 : 0) - (a.status === "valid_setup" ? 1 : 0);
      if (statusDelta) return statusDelta;
      return Number(b.score || 0) - Number(a.score || 0);
    });
  const watchlist = Array.isArray(byId.universe?.data) ? byId.universe.data.slice(0, 500) : [];
  const broker = normalizeBrokerStatus(byId.broker_status?.data, byId.broker_status?.source);
  const readiness = normalizeReadiness(byId.live_auto_arm_plan?.data, byId.live_auto_launch_checklist?.data, Object.fromEntries(sources.map((source) => [source.id, source])));
  const mirror = {
    ...normalizeMirrorPlan(byId.copy_trader_plan?.data, byId.copy_trader_plan?.source),
    importer: normalizeCopyImportStatus(byId.copy_import_status?.data, byId.copy_import_status?.source),
  };
  const ticket = parseTicketReport(byId.latest_ticket?.data || "");
  const metrics = metricCounts(records, watchlist, broker, readiness, sourceHealth, mirror);
  const snapshot = {
    workspace: baseWorkspace(stockRoot, true),
    available: true,
    generatedAt: at.toISOString(),
    sourceHealth,
    sources,
    records,
    positions: broker.positions,
    broker,
    readiness,
    mirror,
    watchlist,
    ticket,
    metrics,
    alerts: [],
    activity: [],
    chatMessages: workspaceState.chatMessages,
    syncRuns: workspaceState.syncRuns,
    assistantRuns: workspaceState.assistantRuns,
    permissions: stockPermissions(),
    threatModel: stockThreatModel(),
    reports: {
      latestTicket: byId.latest_ticket?.data ? redactSensitiveText(byId.latest_ticket.data).slice(0, 4000) : "",
      mission: byId.mission?.data ? redactSensitiveText(byId.mission.data).slice(0, 4000) : "",
    },
  };
  snapshot.alerts = buildAlerts({ available: true, sources, records, readiness, broker, sourceHealth, mirror });
  snapshot.activity = buildActivity({ state, records, readiness, broker, ticket, sources, mirror });
  return snapshot;
}

function baseWorkspace(stockRoot, available) {
  return {
    id: STOCK_WORKSPACE_ID,
    officeId: STOCK_OFFICE_ID,
    name: "Stock Guru",
    title: "Stock Office",
    domain: "financial_market_decision_support",
    mode: "read_only_guarded",
    description: "Financial-market scanner, guarded public-signal Mirror Lab, paper-trading journal, and broker decision-support workspace.",
    rootConfigured: Boolean(process.env.STOCK_GURU_PATH),
    rootAvailable: Boolean(available),
    rootLabel: redactSensitiveText(stockRoot),
    externalActions: "Blocked by design",
    safetyRule: "Research, paper mirroring, and Human Gate review only. Argentum never places trades, moves money, changes broker settings, or promises returns.",
  };
}

function stockPermissions(role = "admin") {
  const admin = role === "admin" || role === "owner";
  return {
    role: admin ? "admin" : "viewer",
    canViewWorkspace: true,
    canViewRecords: true,
    canViewSources: true,
    canViewChat: true,
    canPostChat: admin,
    canUseAssistant: admin,
    canTriggerSync: admin,
    canRequestMirrorApproval: admin,
    canExport: false,
    canTrade: false,
    canMoveMoney: false,
    canManageBroker: false,
  };
}

function stockThreatModel() {
  return [
    "Broker and provider credentials stay server-side and are not read by this connector.",
    "All Stock Office APIs require the existing Argentum session before data is returned.",
    "The connector can create internal paper plans and Human Gate review records, but no live broker, order, transfer, or account-changing calls are available.",
    "Imported report text is treated as untrusted content and redacted before display or assistant use.",
    "Refresh runs only the evaluator, optional official SEC intake, and guarded mirror-plan builder. It never invokes broker, order, transfer, or account commands.",
  ];
}

function listStockRecords(snapshot, options = {}) {
  const page = clampNumber(options.page, 1, 10_000, 1);
  const pageSize = clampNumber(options.pageSize, 1, 50, 20);
  const query = String(options.q || "").trim().toUpperCase();
  const status = String(options.status || "all");
  const sort = String(options.sort || "score_desc");
  let records = Array.isArray(snapshot?.records) ? [...snapshot.records] : [];
  if (query) {
    records = records.filter((record) => `${record.ticker} ${record.decision} ${record.setupType} ${record.mainRisk}`.toUpperCase().includes(query));
  }
  if (status !== "all") {
    records = records.filter((record) => record.status === status);
  }
  records.sort((a, b) => {
    if (sort === "ticker_asc") return a.ticker.localeCompare(b.ticker);
    if (sort === "updated_desc") return new Date(b.lastUpdated || 0).getTime() - new Date(a.lastUpdated || 0).getTime();
    if (sort === "risk_desc") return Number(b.stopLoss || 0) - Number(a.stopLoss || 0);
    return Number(b.score || 0) - Number(a.score || 0);
  });
  const total = records.length;
  const start = (page - 1) * pageSize;
  return {
    records: records.slice(start, start + pageSize),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function getStockRecord(snapshot, ticker) {
  const normalizedTicker = String(ticker || "").trim().toUpperCase();
  return (snapshot.records || []).find((record) => record.ticker === normalizedTicker) || null;
}

function getMirrorCandidate(snapshot, candidateId) {
  const id = String(candidateId || "").trim();
  return (snapshot.mirror?.candidates || []).find((candidate) => candidate.id === id) || null;
}

function stockOverview(snapshot) {
  return {
    workspace: snapshot.workspace,
    available: snapshot.available,
    generatedAt: snapshot.generatedAt,
    metrics: snapshot.metrics,
    sourceHealth: snapshot.sourceHealth,
    alerts: snapshot.alerts,
    activity: snapshot.activity.slice(0, 8),
    topRecords: snapshot.records.slice(0, 8),
    readiness: {
      readyForLiveAuto: snapshot.readiness.readyForLiveAuto,
      action: snapshot.readiness.action,
      blockers: snapshot.readiness.blockers.slice(0, 5),
      warnings: snapshot.readiness.warnings.slice(0, 5),
      generatedAt: snapshot.readiness.generatedAt,
    },
    mirror: snapshot.mirror,
    broker: {
      account: snapshot.broker.account,
      accountValue: snapshot.broker.accountValue,
      cash: snapshot.broker.cash,
      buyingPower: snapshot.broker.buyingPower,
      positions: snapshot.positions.slice(0, 6),
      updatedAt: snapshot.broker.updatedAt,
    },
    sources: snapshot.sources,
    chatMessages: snapshot.chatMessages,
    syncRuns: snapshot.syncRuns,
    assistantRuns: snapshot.assistantRuns,
    permissions: snapshot.permissions,
    threatModel: snapshot.threatModel,
  };
}

function answerStockQuestion(snapshot, rawQuestion) {
  const question = redactSensitiveText(String(rawQuestion || "").trim()).slice(0, 700);
  if (!question) {
    return {
      answer: "Ask a Stock Office question about tracked records, readiness blockers, source freshness, or the masked broker snapshot.",
      citations: [],
      confidence: "no_question",
      safeMode: "read_only",
    };
  }
  const lower = question.toLowerCase();
  const citations = [];
  const cite = (type, id, label) => citations.push(normalizeCitation({ type, id, label }));
  let answer;

  if (/(copy|mirror|famous|infamous|trader|disclosure|13f|form 4|congress|event contract|prediction)/.test(lower)) {
    cite("source", "copy_trader_plan", "Copy Trader mirror plan");
    const mirror = snapshot.mirror;
    const ready = mirror.candidates.filter((candidate) => candidate.status === "paper_ready").slice(0, 5);
    answer = mirror.available
      ? `Mirror Lab evaluated ${mirror.summary.signalsReceived} attributable public signal(s): ${mirror.summary.paperReady} paper-ready, ${mirror.summary.researchOnly} research-only, and ${mirror.summary.rejected} rejected. ${ready.length ? `Paper-ready examples: ${ready.map((candidate) => `${candidate.side} ${candidate.symbol} from ${candidate.traderName}, capped at ${formatUsd(candidate.mirrorNotionalDollars)}`).join("; ")}.` : "No signal currently passes every delay, provenance, price-drift, and bankroll check."} ${mirror.importer?.available ? `The official SEC importer has ${mirror.importer.enabledEntries} enabled watchlist entr${mirror.importer.enabledEntries === 1 ? "y" : "ies"} and imported ${mirror.importer.signalsImported} signal(s) on its latest run. ` : "The official SEC importer has not run yet. "}The plan placed 0 live orders; event contracts and delayed 13F/congressional disclosures stay research-only.`
      : "Mirror Lab is configured but has no generated plan. Add named CIKs to the SEC watchlist and run copy-refresh-sec or copy-watch-sec. Anonymous posts, stale 13F/congressional disclosures, and event contracts cannot become automatic Robinhood orders.";
  } else if (/(top|best|setup|ticker|watch|valid)/.test(lower)) {
    const top = snapshot.records.slice(0, 5);
    top.forEach((record) => cite("record", record.ticker, `${record.ticker} evaluator record`));
    answer = top.length
      ? `Top Stock Guru records right now are ${top
          .map((record) => `${record.ticker} (${record.decision}, score ${record.score ?? "n/a"})`)
          .join(", ")}. This is research support only; it is not a trade instruction. Main repeated risk: ${top[0]?.mainRisk || "not recorded"}.`
      : "No evaluator records are loaded yet. Use Refresh Stock Office to run the local evaluator and rescan its guarded reports.";
  } else if (/(block|ready|arm|live|trade|broker)/.test(lower)) {
    cite("source", "live_auto_arm_plan", "Live auto arm plan");
    cite("source", "live_auto_launch_checklist", "Live launch checklist");
    const blockers = snapshot.readiness.blockers.slice(0, 4);
    answer = snapshot.readiness.readyForLiveAuto
      ? "The latest readiness data says live auto is ready, but Stock Office still exposes only research, paper mirroring, and Human Gate review. No broker order endpoint is available here."
      : `Live auto is not armable. Blockers: ${blockers.length ? blockers.join("; ") : "readiness data does not mark it ready"}. Argentum will not place trades, move money, or change broker settings.`;
  } else if (/(position|cash|buying|account|pnl|broker)/.test(lower)) {
    cite("source", "broker_status", "Masked broker status snapshot");
    const positions = snapshot.broker.positions || [];
    answer = `Latest masked broker snapshot: account ${snapshot.broker.account || "not available"}, account value ${snapshot.broker.accountValue || "unknown"}, cash ${snapshot.broker.cash || "unknown"}, buying power ${snapshot.broker.buyingPower || "unknown"}, positions ${positions.length}. Argentum shows this for review only and does not submit broker orders.`;
  } else if (/(source|sync|fresh|stale|error|data)/.test(lower)) {
    snapshot.sources.slice(0, 5).forEach((source) => cite("source", source.id, source.label));
    answer = `Source health is ${snapshot.sourceHealth.status}: ${snapshot.sourceHealth.ready} ready/configured, ${snapshot.sourceHealth.stale} stale, ${snapshot.sourceHealth.error} error, ${snapshot.sourceHealth.missing || 0} missing. Refresh Stock Office can run the local evaluator and guarded public-signal plan builder; it has no broker-order or money-movement capability.`;
  } else if (/(risk|reject|avoid|liquidity|volume)/.test(lower)) {
    const rejected = snapshot.records.filter((record) => record.status === "rejected").slice(0, 5);
    rejected.forEach((record) => cite("record", record.ticker, `${record.ticker} rejected evaluator record`));
    answer = rejected.length
      ? `Rejected or avoided records include ${rejected.map((record) => `${record.ticker}: ${record.rejectionReason || record.mainRisk}`).join("; ")}. Common issues include liquidity, no clean setup, or unconfirmed volume.`
      : "No rejected evaluator records are loaded in the current snapshot.";
  } else {
    const metrics = snapshot.metrics;
    cite("source", "evaluations", "Evaluator report");
    cite("source", "broker_status", "Masked broker status snapshot");
    answer = `Stock Office is in read-only guarded mode with ${metrics.trackedRecords} evaluator records, ${metrics.validSetups} valid setups, ${metrics.rejectedRecords} rejected records, ${metrics.watchlistCount} watchlist tickers, and source health ${metrics.sourceStatus}. Ask for top setups, blockers, source freshness, or the masked broker snapshot for more detail.`;
  }

  return {
    answer: redactSensitiveText(answer),
    citations: citations.filter(Boolean).slice(0, 8),
    confidence: "data_backed",
    safeMode: "read_only",
  };
}

module.exports = {
  STOCK_WORKSPACE_ID,
  STOCK_OFFICE_ID,
  normalizeStockOfficeState,
  normalizeStockChatMessages,
  loadStockOfficeSnapshot,
  stockOverview,
  listStockRecords,
  getStockRecord,
  getMirrorCandidate,
  answerStockQuestion,
  redactSensitiveText,
  maskAccountNumber,
  safeJoin,
  resolveStockRoot,
  stockPermissions,
};

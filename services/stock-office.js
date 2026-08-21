const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeGuardrails, normalizeTradeDrafts } = require("./stock-broker-control");

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
    id: "research_context",
    label: "Structured company and news research",
    relPath: "reports/research.json",
    type: "json",
    category: "research_news",
    staleAfterHours: 6,
  },
  {
    id: "intraday_context",
    label: "Multi-timeframe intraday context",
    relPath: "data/intraday_context.json",
    type: "json",
    category: "market_context",
    staleAfterHours: 1,
  },
  {
    id: "market_context",
    label: "Market regime and relative strength",
    relPath: "data/market_context.json",
    type: "json",
    category: "market_context",
    staleAfterHours: 8,
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
    label: "Official SEC Form 4 import status",
    relPath: "data/copy_import_status.json",
    type: "json",
    category: "copy_signals",
    staleAfterHours: 24,
  },
  {
    id: "sec_13f_import_status",
    label: "Official SEC Form 13F research status",
    relPath: "data/sec_13f_import_status.json",
    type: "json",
    category: "copy_signals",
    staleAfterHours: 24 * 120,
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
    id: "copy_knowledge",
    label: "Copy Trader knowledge ledger",
    relPath: "data/copy_knowledge.json",
    type: "json",
    category: "copy_signals",
    staleAfterHours: 72,
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
    id: "live_auto_kill_switch",
    label: "Live-order kill switch",
    relPath: "data/live_auto_kill_switch.json",
    type: "json",
    category: "readiness",
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
    id: "provider_health",
    label: "Market-data provider health",
    relPath: "data/provider_health.json",
    type: "json",
    category: "market_data_health",
    staleAfterHours: 1,
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

function readSource(stockRoot, definition, at = new Date(), runtimeRoot = "") {
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
    const sourcePath = safeJoin(stockRoot, definition.relPath);
    const canUseRuntime = Boolean(runtimeRoot)
      && definition.type !== "secret"
      && /^(?:data|reports)\//.test(definition.relPath);
    const runtimePath = canUseRuntime ? safeJoin(runtimeRoot, definition.relPath) : "";
    if (runtimePath && fs.existsSync(runtimePath)) {
      const runtimeStat = fs.statSync(runtimePath);
      const sourceStat = fs.existsSync(sourcePath) ? fs.statSync(sourcePath) : null;
      absolutePath = runtimeStat.isFile() && (!sourceStat?.isFile() || runtimeStat.mtimeMs >= sourceStat.mtimeMs)
        ? runtimePath
        : sourcePath;
    } else {
      absolutePath = sourcePath;
    }
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
  const activeGuardrails = isPlainObject(value.activeGuardrails) ? normalizeGuardrails(value.activeGuardrails) : null;
  return {
    workspaceId: STOCK_WORKSPACE_ID,
    lastLocalSyncAt: safeDate(value.lastLocalSyncAt),
    selectedTicker: String(value.selectedTicker || "").toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12),
    chatMessages: normalizeStockChatMessages(value.chatMessages || []),
    syncRuns: normalizeSyncRuns(value.syncRuns || []),
    assistantRuns: normalizeAssistantRuns(value.assistantRuns || []),
    tradeDrafts: normalizeTradeDrafts(value.tradeDrafts || []),
    proposalDecisions: normalizeProposalDecisions(value.proposalDecisions || []),
    continuousReview: normalizeContinuousReview(value.continuousReview || {}),
    activeGuardrails,
    guardrailsAppliedAt: safeDate(value.guardrailsAppliedAt),
    guardrailsApprovalId: String(value.guardrailsApprovalId || "").slice(0, 120),
    manualTradingHalt: {
      active: value.manualTradingHalt?.active === true,
      reason: redactSensitiveText(String(value.manualTradingHalt?.reason || "")).slice(0, 260),
      updatedAt: safeDate(value.manualTradingHalt?.updatedAt),
      actorId: String(value.manualTradingHalt?.actorId || "").slice(0, 120),
    },
  };
}

function normalizeContinuousReview(input = {}) {
  const value = isPlainObject(input) ? input : {};
  const outcomes = new Set(["idle", "market_closed", "research_running", "no_qualified_proposal", "waiting_for_human_gate", "proposal_staged", "notification_delivered", "notification_unavailable", "failed_safe"]);
  return {
    lastCycleCompletedAt: safeDate(value.lastCycleCompletedAt),
    lastEvaluatedAt: safeDate(value.lastEvaluatedAt),
    reviewTrigger: ["market_research", "live_readiness"].includes(value.reviewTrigger) ? value.reviewTrigger : "market_research",
    decisionCadenceSeconds: Number.isFinite(Number(value.decisionCadenceSeconds))
      ? Math.max(1, Math.min(60, Math.round(Number(value.decisionCadenceSeconds))))
      : 1,
    lastOutcome: outcomes.has(value.lastOutcome) ? value.lastOutcome : "idle",
    lastMessage: String(value.lastMessage || "").slice(0, 500),
    activeProposalFingerprint: String(value.activeProposalFingerprint || "").replace(/[^a-f0-9]/gi, "").slice(0, 64),
    activeDraftId: String(value.activeDraftId || "").slice(0, 100),
    activeApprovalId: String(value.activeApprovalId || "").slice(0, 120),
    notificationState: String(value.notificationState || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 80),
    notificationSentAt: safeDate(value.notificationSentAt),
    stagedProposalFingerprints: (Array.isArray(value.stagedProposalFingerprints) ? value.stagedProposalFingerprints : [])
      .map((item) => String(item || "").replace(/[^a-f0-9]/gi, "").slice(0, 64))
      .filter((item) => item.length === 64)
      .slice(-40),
  };
}

function normalizeProposalDecisions(decisions = []) {
  return (Array.isArray(decisions) ? decisions : [])
    .map((decision) => {
      const proposalId = String(decision?.proposalId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
      const symbol = String(decision?.symbol || "").toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
      if (!proposalId || !symbol) return null;
      return {
        proposalId,
        fingerprint: String(decision?.fingerprint || "").replace(/[^a-f0-9]/gi, "").slice(0, 64),
        symbol,
        side: String(decision?.side || "").toUpperCase() === "SELL" ? "SELL" : "BUY",
        decision: decision?.decision === "declined" ? "declined" : "reviewed",
        decidedAt: safeDate(decision?.decidedAt) || nowIso(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.decidedAt).getTime() - new Date(a.decidedAt).getTime())
    .slice(0, 200);
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
    mainReason: String(record.main_reason_valid || "").slice(0, 260),
    mainRisk: String(record.main_risk || record.rejection_reason || "No risk note recorded.").slice(0, 260),
    invalidationRule: String(record.invalidation_rule || "").slice(0, 260),
    rejectionReason: String(record.rejection_reason || "").slice(0, 180),
    liquidityPassed: Boolean(record.liquidity_passed),
    spreadPassed: Boolean(record.spread_passed),
    trendConfirmation: Boolean(record.trend_confirmation),
    volumeConfirmation: Boolean(record.volume_confirmation),
    dataFresh: Boolean(record.data_fresh),
    dataProvider: String(record.data_provider || "UNKNOWN").replace(/[^A-Z0-9_.-]/gi, "").slice(0, 80),
    dataFeedType: String(record.data_feed_type || "UNKNOWN").replace(/[^A-Z0-9_.-]/gi, "").slice(0, 40),
    dataSourceTimestamp: safeDate(record.data_source_timestamp),
    dataReceivedAt: safeDate(record.data_received_at),
    dataHealthState: String(record.data_health_state || (record.data_fresh ? "HEALTHY" : "UNKNOWN")).toUpperCase().replace(/[^A-Z_]/g, "").slice(0, 40),
    dataQualityScore: Number.isFinite(Number(record.data_quality_score)) ? clampNumber(record.data_quality_score, 0, 100, 0) : null,
    dataFallbackFrom: (Array.isArray(record.data_fallback_from) ? record.data_fallback_from : []).map((item) => String(item).replace(/[^A-Z0-9_.-]/gi, "").slice(0, 80)).filter(Boolean).slice(0, 8),
    source: source.label,
    sourceId: source.id,
    provenance: definitionProvenance(source),
    lastUpdated: source.generatedAt || source.lastModified || null,
  };
}

function normalizeResearchContext(data, source) {
  const empty = {
    available: false,
    generatedAt: source?.generatedAt || source?.lastModified || null,
    stale: Boolean(source?.stale),
    source: "No structured company/news feed",
    directionalNewsScoring: false,
    tickers: [],
    newsCount: 0,
  };
  if (!isPlainObject(data)) return empty;
  const tickers = (Array.isArray(data.tickers) ? data.tickers : []).slice(0, 50).map((item) => {
    if (!isPlainObject(item)) return null;
    const ticker = String(item.ticker || "").toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
    if (!ticker) return null;
    return {
      ticker,
      companyName: redactSensitiveText(String(item.company_name || "")).slice(0, 180),
      sector: redactSensitiveText(String(item.sector || "")).slice(0, 100),
      marketCap: Number.isFinite(Number(item.market_cap)) ? Number(item.market_cap) : null,
      trailingPe: Number.isFinite(Number(item.trailing_pe)) ? Number(item.trailing_pe) : null,
      forwardPe: Number.isFinite(Number(item.forward_pe)) ? Number(item.forward_pe) : null,
      revenueGrowth: Number.isFinite(Number(item.revenue_growth)) ? Number(item.revenue_growth) : null,
      recommendation: String(item.recommendation || "").replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 60),
      sourceNote: redactSensitiveText(String(item.source_note || "")).slice(0, 240),
      catalystScore: Number.isFinite(Number(item.catalyst_score)) ? clampNumber(item.catalyst_score, 0, 100, 50) : null,
      catalystConfidence: Number.isFinite(Number(item.catalyst_confidence)) ? clampNumber(item.catalyst_confidence, 0, 1, 0) : 0,
      catalystSummary: isPlainObject(item.catalyst_summary) ? {
        positive: clampNumber(item.catalyst_summary.positive, 0, 1_000, 0),
        negative: clampNumber(item.catalyst_summary.negative, 0, 1_000, 0),
        neutral: clampNumber(item.catalyst_summary.neutral, 0, 1_000, 0),
        conflicts: item.catalyst_summary.conflicts === true,
        newestAt: safeDate(item.catalyst_summary.newest_at),
        methodology: redactSensitiveText(String(item.catalyst_summary.methodology || "")).slice(0, 240),
      } : null,
      news: (Array.isArray(item.news) ? item.news : []).slice(0, 8).map((news) => ({
        title: redactSensitiveText(String(news?.title || "")).slice(0, 300),
        publisher: redactSensitiveText(String(news?.publisher || "")).slice(0, 120),
        publishedAt: safeDate(news?.published_at),
        url: safePublicUrl(news?.url),
        catalyst: isPlainObject(news?.catalyst) ? {
          id: String(news.catalyst.id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100),
          type: String(news.catalyst.catalyst_type || "OTHER").toUpperCase().replace(/[^A-Z_]/g, "").slice(0, 40),
          direction: String(news.catalyst.direction || "NEUTRAL").toUpperCase().replace(/[^A-Z_]/g, "").slice(0, 20),
          confidence: Number.isFinite(Number(news.catalyst.confidence)) ? clampNumber(news.catalyst.confidence, 0, 1, 0) : 0,
          freshness: String(news.catalyst.freshness || "UNKNOWN").toUpperCase().replace(/[^A-Z_]/g, "").slice(0, 20),
          ageMinutes: Number.isFinite(Number(news.catalyst.age_minutes)) ? Math.max(0, Number(news.catalyst.age_minutes)) : null,
          duplicateGroup: String(news.catalyst.duplicate_group || "").replace(/[^a-f0-9]/gi, "").slice(0, 64),
          scheduled: news.catalyst.scheduled === true,
          method: String(news.catalyst.scoring_method || "").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80),
        } : null,
      })).filter((news) => news.title),
    };
  }).filter(Boolean);
  return {
    available: true,
    generatedAt: safeDate(data.generated_at) || source?.generatedAt || source?.lastModified || null,
    stale: Boolean(source?.stale),
    source: redactSensitiveText(String(data.source || "Structured company/news research")).slice(0, 180),
    directionalNewsScoring: data.directional_news_scoring === true,
    tickers,
    newsCount: tickers.reduce((sum, item) => sum + item.news.length, 0),
  };
}

function normalizeIntradayContext(data, source) {
  const rawSymbols = isPlainObject(data?.symbols) ? data.symbols : {};
  const symbols = Object.entries(rawSymbols).slice(0, 100).map(([rawSymbol, item]) => {
    if (!isPlainObject(item)) return null;
    const symbol = String(item.symbol || rawSymbol).toUpperCase().replace(/[^A-Z0-9.^-]/g, "").slice(0, 12);
    if (!symbol) return null;
    const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
    const timeframes = isPlainObject(item.timeframes) ? Object.fromEntries(Object.entries(item.timeframes).slice(0, 8).map(([name, value]) => [
      String(name).slice(0, 12),
      isPlainObject(value) ? {
        timeframe: String(value.timeframe || name).slice(0, 12),
        bars: clampNumber(value.bars, 0, 1_000_000, 0),
        asOf: safeDate(value.as_of),
        close: numeric(value.close),
        vwap: numeric(value.vwap),
        volume: numeric(value.volume),
        atr14: numeric(value.atr14),
        realizedVolatility: numeric(value.realized_volatility),
        direction: String(value.direction || "UNKNOWN").toUpperCase().replace(/[^A-Z_]/g, "").slice(0, 24),
        aboveVwap: typeof value.above_vwap === "boolean" ? value.above_vwap : null,
      } : {},
    ])) : {};
    return {
      symbol,
      generatedAt: safeDate(item.generated_at) || safeDate(data?.generated_at),
      sourceProvider: String(item.source_provider || "UNKNOWN").replace(/[^A-Z0-9_.-]/gi, "").slice(0, 80),
      sourceTimestamp: safeDate(item.source_timestamp),
      dataHealthState: String(item.data_health_state || "UNKNOWN").toUpperCase().replace(/[^A-Z_]/g, "").slice(0, 40),
      dataQualityScore: numeric(item.data_quality_score),
      usable: item.usable === true && !source?.stale,
      lastPrice: numeric(item.last_price),
      bid: numeric(item.bid),
      ask: numeric(item.ask),
      spreadPct: numeric(item.spread_pct),
      sessionOpen: numeric(item.session_open),
      sessionHigh: numeric(item.session_high),
      sessionLow: numeric(item.session_low),
      sessionVolume: numeric(item.session_volume),
      sessionPhase: String(item.session_phase || "UNKNOWN").toUpperCase().replace(/[^A-Z_]/g, "").slice(0, 24),
      premarketHigh: numeric(item.premarket_high),
      premarketLow: numeric(item.premarket_low),
      premarketVolume: numeric(item.premarket_volume),
      regularHigh: numeric(item.regular_high),
      regularLow: numeric(item.regular_low),
      regularVolume: numeric(item.regular_volume),
      afterHoursHigh: numeric(item.after_hours_high),
      afterHoursLow: numeric(item.after_hours_low),
      afterHoursVolume: numeric(item.after_hours_volume),
      openingRangeHigh: numeric(item.opening_range_high),
      openingRangeLow: numeric(item.opening_range_low),
      previousClose: numeric(item.previous_close),
      gapPct: numeric(item.gap_pct),
      sessionVwap: numeric(item.session_vwap),
      vwapDistancePct: numeric(item.vwap_distance_pct),
      expectedVolume: numeric(item.expected_volume),
      relativeVolume: numeric(item.relative_volume),
      dollarVolume: numeric(item.dollar_volume),
      alignment: String(item.alignment || "UNKNOWN").toUpperCase().replace(/[^A-Z_]/g, "").slice(0, 24),
      conflicts: (Array.isArray(item.conflicts) ? item.conflicts : []).map((value) => redactSensitiveText(value).slice(0, 220)).filter(Boolean).slice(0, 10),
      timeframes,
    };
  }).filter(Boolean);
  return {
    available: Boolean(source?.exists && symbols.length),
    stale: Boolean(source?.stale),
    generatedAt: safeDate(data?.generated_at) || source?.generatedAt || source?.lastModified || null,
    summary: {
      symbols: clampNumber(data?.summary?.symbols, 0, 10_000, symbols.length),
      usable: clampNumber(data?.summary?.usable, 0, 10_000, symbols.filter((item) => item.usable).length),
      bullish: clampNumber(data?.summary?.bullish, 0, 10_000, symbols.filter((item) => item.alignment === "BULLISH").length),
      conflicts: clampNumber(data?.summary?.conflicts, 0, 10_000, symbols.filter((item) => item.conflicts.length).length),
    },
    symbols,
    bySymbol: Object.fromEntries(symbols.map((item) => [item.symbol, item])),
  };
}

function normalizeMarketContext(data, source) {
  const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
  const normalizeBenchmark = (item, symbol = "") => isPlainObject(item) ? {
    symbol: String(item.symbol || symbol).toUpperCase().replace(/[^A-Z0-9.^-]/g, "").slice(0, 12),
    last: numeric(item.last),
    return5d: numeric(item.return_5d),
    return20d: numeric(item.return_20d),
    return60d: numeric(item.return_60d),
    aboveEma20: typeof item.above_ema20 === "boolean" ? item.above_ema20 : null,
    aboveSma50: typeof item.above_sma50 === "boolean" ? item.above_sma50 : null,
    aboveSma200: typeof item.above_sma200 === "boolean" ? item.above_sma200 : null,
    trend: String(item.trend || "UNKNOWN").toUpperCase().replace(/[^A-Z_]/g, "").slice(0, 24),
  } : null;
  const normalizeStrength = (item) => isPlainObject(item) ? {
    symbol: String(item.symbol || "").toUpperCase().replace(/[^A-Z0-9.^-]/g, "").slice(0, 12),
    return5d: numeric(item.return_5d),
    return20d: numeric(item.return_20d),
    return60d: numeric(item.return_60d),
    versusSpy5d: numeric(item.versus_spy_5d),
    versusSpy20d: numeric(item.versus_spy_20d),
    versusSpy60d: numeric(item.versus_spy_60d),
    sectorEtf: String(item.sector_etf || "").toUpperCase().replace(/[^A-Z0-9.^-]/g, "").slice(0, 12) || null,
    versusSector20d: numeric(item.versus_sector_20d),
    score: numeric(item.score),
    state: String(item.state || "UNKNOWN").toUpperCase().replace(/[^A-Z_]/g, "").slice(0, 24),
  } : null;
  const rawSymbols = isPlainObject(data?.symbols) ? data.symbols : {};
  const symbols = Object.fromEntries(Object.entries(rawSymbols).slice(0, 200).map(([symbol, item]) => [
    String(symbol).toUpperCase().replace(/[^A-Z0-9.^-]/g, "").slice(0, 12),
    normalizeStrength(item),
  ]).filter(([symbol, item]) => symbol && item));
  const sectors = (Array.isArray(data?.sectors) ? data.sectors : []).map(normalizeStrength).filter(Boolean).slice(0, 20);
  const rawBenchmarks = isPlainObject(data?.benchmarks) ? data.benchmarks : {};
  const benchmarks = Object.fromEntries(Object.entries(rawBenchmarks).slice(0, 10).map(([symbol, item]) => [
    String(symbol).toUpperCase().replace(/[^A-Z0-9.^-]/g, "").slice(0, 12),
    normalizeBenchmark(item, symbol),
  ]).filter(([symbol, item]) => symbol && item));
  return {
    available: Boolean(source?.exists && isPlainObject(data)),
    stale: Boolean(source?.stale),
    generatedAt: safeDate(data?.generated_at) || source?.generatedAt || source?.lastModified || null,
    sourceProvider: String(data?.source_provider || "UNKNOWN").replace(/[^A-Z0-9_.-]/gi, "").slice(0, 80),
    sourceTimestamp: safeDate(data?.source_timestamp),
    dataHealthState: String(data?.data_health_state || "UNKNOWN").toUpperCase().replace(/[^A-Z_]/g, "").slice(0, 40),
    dataQualityScore: numeric(data?.data_quality_score),
    regime: String(data?.regime || "UNKNOWN").toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 80),
    trendRegime: String(data?.trend_regime || "UNKNOWN").toUpperCase().replace(/[^A-Z_]/g, "").slice(0, 24),
    volatilityRegime: String(data?.volatility_regime || "UNKNOWN").toUpperCase().replace(/[^A-Z_]/g, "").slice(0, 24),
    breadthState: String(data?.breadth_state || "UNKNOWN").toUpperCase().replace(/[^A-Z_]/g, "").slice(0, 24),
    breadthAboveEma20Pct: numeric(data?.breadth_above_ema20_pct),
    breadthAboveSma50Pct: numeric(data?.breadth_above_sma50_pct),
    riskState: String(data?.risk_state || "UNKNOWN").toUpperCase().replace(/[^A-Z_]/g, "").slice(0, 24),
    benchmarks,
    sectors,
    symbols,
    blockers: (Array.isArray(data?.blockers) ? data.blockers : []).map((item) => redactSensitiveText(item).slice(0, 220)).filter(Boolean).slice(0, 10),
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
      accountIdentityHash: "",
      accountValue: null,
      cash: null,
      buyingPower: null,
      dayPnlDollars: null,
      dayPnlPct: null,
      positions: [],
      openOrders: [],
      orders: [],
      connector: {
        registered: false,
        oauthAuthenticated: false,
        endpoint: "",
        tools: [],
        observedAt: null,
      },
      updatedAt: source?.lastModified || null,
    };
  }
  const normalizeOrder = (order) => {
    if (!isPlainObject(order)) return null;
    const symbol = String(order.symbol || order.ticker || "").toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
    const state = String(order.state || order.status || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 60);
    if (!symbol || !state) return null;
    return {
      orderId: String(order.order_id || order.orderId || order.id || "").slice(0, 160),
      clientRefId: String(order.ref_id || order.client_ref_id || order.clientRefId || "").slice(0, 160),
      symbol,
      side: String(order.side || "").toUpperCase() === "SELL" ? "SELL" : "BUY",
      state,
      dollarAmount: Number.isFinite(Number(order.dollar_amount ?? order.dollarAmount ?? order.notional)) ? Number(order.dollar_amount ?? order.dollarAmount ?? order.notional) : null,
      quantity: Number.isFinite(Number(order.quantity ?? order.shares)) ? Number(order.quantity ?? order.shares) : null,
      createdAt: safeDate(order.created_at || order.createdAt || order.submitted_at),
    };
  };
  const orders = (Array.isArray(data.orders) ? data.orders : []).map(normalizeOrder).filter(Boolean).slice(0, 200);
  const openOrders = (Array.isArray(data.open_orders) ? data.open_orders : [])
    .map(normalizeOrder)
    .filter(Boolean)
    .slice(0, 100);
  return {
    configured: true,
    account: maskAccountNumber(data.account_number),
    accountIdentityHash: String(data.account_identity_hash || "").replace(/[^a-f0-9]/gi, "").slice(0, 64),
    accountValue: formatUsd(data.account_value),
    cash: formatUsd(data.cash),
    buyingPower: formatUsd(data.buying_power),
    dayPnlDollars: Number.isFinite(Number(data.day_pnl_dollars ?? data.day_pnl)) ? Number(data.day_pnl_dollars ?? data.day_pnl) : null,
    dayPnlPct: Number.isFinite(Number(data.day_pnl_pct)) ? Number(data.day_pnl_pct) : null,
    deployedPrincipal: formatUsd(data.deployed_principal),
    lockedProfit: formatUsd(data.locked_profit),
    updatedAt: safeDate(data.updated_at) || source?.generatedAt || source?.lastModified || null,
    connector: {
      registered: data.connector?.registered === true,
      oauthAuthenticated: data.connector?.oauth_authenticated === true,
      endpoint: safePublicUrl(data.connector?.endpoint),
      tools: (Array.isArray(data.connector?.tools) ? data.connector.tools : [])
        .map((item) => String(item || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 80))
        .filter(Boolean)
        .slice(0, 80),
      observedAt: safeDate(data.connector?.observed_at),
    },
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
    openOrders,
    orders,
  };
}

function normalizeKillSwitch(data, source) {
  if (!isPlainObject(data)) {
    return {
      active: true,
      reason: "No explicit kill-switch state is available; live orders fail closed.",
      updatedAt: source?.lastModified || null,
    };
  }
  return {
    active: data.enabled !== false,
    reason: redactSensitiveText(String(data.reason || (data.enabled === false ? "Operator explicitly cleared the switch." : "Live-order kill switch is active."))).slice(0, 260),
    updatedAt: safeDate(data.updated_at || data.updatedAt) || source?.generatedAt || source?.lastModified || null,
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
      actionableSignals: 0,
      referenceOnlySignals: 0,
      unresolvedSymbols: 0,
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
  const rawCandidates = Array.isArray(data.candidates) ? data.candidates : [];
  const candidates = rawCandidates
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
      const tickerResolved = candidate.ticker_resolved === true
        || (/^[A-Z][A-Z0-9.-]{0,11}$/.test(symbol) && !symbol.startsWith("CUSIP"));
      const referenceOnly = String(candidate.source_id || "").toLowerCase() === "sec_13f"
        || String(candidate.transaction_code || "").toUpperCase() === "13F_CHANGE"
        || !tickerResolved;
      return {
        id: String(candidate.id || `mirror-${index + 1}`).slice(0, 160),
        fingerprint: String(candidate.fingerprint || "").replace(/[^a-f0-9]/gi, "").slice(0, 64),
        sourceId: String(candidate.source_id || "").slice(0, 80),
        sourceName: redactSensitiveText(String(candidate.source_name || "Unknown public source")).slice(0, 160),
        traderName: redactSensitiveText(String(candidate.trader_name || "Unknown public source")).slice(0, 160),
        assetType,
        symbol,
        tickerResolved,
        referenceOnly,
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
        currentPriceObservedAt: safeDate(candidate.current_price_observed_at),
        currentPriceAgeHours: clampNumber(candidate.current_price_age_hours, 0, 24 * 30, 0),
        priceDriftPct: Number.isFinite(drift) ? drift : null,
        confidence: clampNumber(candidate.confidence, 0, 1, 0),
        evidenceScore: clampNumber(candidate.evidence_score, 0, 1, 0.5),
        evidenceStatus: ["unproven", "small_sample", "measured"].includes(candidate.evidence_status) ? candidate.evidence_status : "unproven",
        sourceEvidenceSamples: clampNumber(candidate.source_evidence_samples, 0, 1_000_000, 0),
        traderEvidenceSamples: clampNumber(candidate.trader_evidence_samples, 0, 1_000_000, 0),
        rankingScore: clampNumber(candidate.ranking_score, 0, 1, 0),
        status,
        mirrorNotionalDollars: Number.isFinite(notional) ? Math.max(0, notional) : 0,
        mirrorShares: Number.isFinite(shares) ? Math.max(0, shares) : 0,
        humanGateEligible: status === "paper_ready" && Boolean(candidate.human_gate_eligible),
        brokerPositionRequired: candidate.broker_position_required === true,
        reasons: (Array.isArray(candidate.reasons) ? candidate.reasons : []).map((item) => redactSensitiveText(item).slice(0, 300)).filter(Boolean).slice(0, 8),
        notes: redactSensitiveText(String(candidate.notes || "")).slice(0, 500),
      };
    })
    .filter(Boolean);
  const inputSummary = isPlainObject(data.summary) ? data.summary : {};
  const count = (key, status) => clampNumber(inputSummary[key], 0, 1_000_000, candidates.filter((candidate) => candidate.status === status).length);
  const liveOrdersPlaced = clampNumber(inputSummary.live_orders_placed, 0, 1_000_000, 0);
  const rawReferenceOnly = rawCandidates.filter((candidate) => {
    const symbol = String(candidate?.symbol || "").toUpperCase();
    return String(candidate?.source_id || "").toLowerCase() === "sec_13f"
      || String(candidate?.transaction_code || "").toUpperCase() === "13F_CHANGE"
      || symbol.startsWith("CUSIP:");
  });
  const unresolvedSymbols = rawCandidates.filter((candidate) => String(candidate?.symbol || "").toUpperCase().startsWith("CUSIP:")).length;
  const actionableSignals = rawCandidates.filter((candidate) => {
    const symbol = String(candidate?.symbol || "").toUpperCase();
    return candidate?.status === "paper_ready"
      && candidate?.human_gate_eligible === true
      && /^[A-Z][A-Z0-9.-]{0,11}$/.test(symbol)
      && Number(candidate?.current_price) > 0;
  }).length;
  return {
    available: true,
    mode: String(data.mode || "paper_and_human_gate_only").slice(0, 80),
    generatedAt: safeDate(data.generated_at) || source?.generatedAt || source?.lastModified || null,
    stale: Boolean(source?.stale),
    summary: {
      signalsReceived: clampNumber(inputSummary.signals_received, 0, 1_000_000, candidates.length),
      actionableSignals,
      referenceOnlySignals: rawReferenceOnly.length,
      unresolvedSymbols,
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
      maxCurrentPriceAgeHours: clampNumber(data.policy?.max_current_price_age_hours, 0, 24 * 30, 24),
      allowedAssetTypes: (Array.isArray(data.policy?.allowed_asset_types) ? data.policy.allowed_asset_types : []).map((item) => String(item).slice(0, 40)).slice(0, 12),
      researchOnlyAssetTypes: (Array.isArray(data.policy?.research_only_asset_types) ? data.policy.research_only_asset_types : []).map((item) => String(item).slice(0, 40)).slice(0, 12),
      knowledge: {
        priorStrength: clampNumber(data.policy?.knowledge?.prior_strength, 1, 10_000, 20),
        minimumSamplesForGate: clampNumber(data.policy?.knowledge?.minimum_samples_for_gate, 1, 10_000, 8),
        minimumEvidenceScore: clampNumber(data.policy?.knowledge?.minimum_evidence_score, 0, 1, 0.4),
      },
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

function normalizeCopyKnowledge(data, source) {
  const empty = {
    available: false,
    generatedAt: source?.generatedAt || source?.lastModified || null,
    stale: Boolean(source?.stale),
    summary: {
      signalsSeen: 0,
      observationsSeen: 0,
      measuredOutcomes: 0,
      pendingOutcomes: 0,
      missingBaselines: 0,
      liveOrdersPlaced: 0,
    },
    methodology: {
      lookAheadAllowed: false,
      profitGuarantee: false,
      scoreNeutral: 0.5,
    },
    sourceProfiles: [],
    traderProfiles: [],
    warnings: ["No post-disclosure knowledge ledger is loaded yet. Evidence scores remain neutral."],
  };
  if (!isPlainObject(data)) return empty;
  const normalizeRegimeBreakdown = (value) => isPlainObject(value)
    ? Object.fromEntries(Object.entries(value).slice(0, 8).map(([key, item]) => {
      const metrics = isPlainObject(item) ? item : {};
      return [String(key).slice(0, 40), {
        sampleSize: clampNumber(metrics.sample_size, 0, 1_000_000, 0),
        hitRate: clampNumber(metrics.hit_rate, 0, 1, 0.5),
        meanDirectionalReturn: clampNumber(metrics.mean_directional_return, -10, 10, 0),
      }];
    }))
    : {};
  const profile = (item) => {
    if (!isPlainObject(item)) return null;
    return {
      id: String(item.profile_id || "").slice(0, 240),
      sourceId: String(item.source_id || "").slice(0, 80),
      traderName: item.trader_name ? redactSensitiveText(String(item.trader_name)).slice(0, 160) : null,
      sourceType: String(item.source_type || "unknown").slice(0, 80),
      mirrorEligible: Boolean(item.mirror_eligible),
      sampleSize: clampNumber(item.sample_size, 0, 1_000_000, 0),
      wins: clampNumber(item.wins, 0, 1_000_000, 0),
      losses: clampNumber(item.losses, 0, 1_000_000, 0),
      hitRate: clampNumber(item.hit_rate, 0, 1, 0.5),
      meanDirectionalReturn: clampNumber(item.mean_directional_return, -10, 10, 0),
      returnVolatility: clampNumber(item.return_volatility, 0, 10, 0),
      averageMaximumAdverseExcursion: clampNumber(item.average_maximum_adverse_excursion, -10, 0, 0),
      riskAdjustedReturn: clampNumber(item.risk_adjusted_return, -100, 100, 0),
      posteriorQualityScore: clampNumber(item.posterior_quality_score, 0, 1, 0.5),
      delayReliability: clampNumber(item.delay_reliability, 0, 1, 1),
      executionScoreCap: clampNumber(item.execution_score_cap, 0, 1, 0.45),
      evidenceScore: clampNumber(item.evidence_score, 0, 1, 0.5),
      evidenceStatus: ["unproven", "small_sample", "measured"].includes(item.evidence_status) ? item.evidence_status : "unproven",
      provenanceCounts: isPlainObject(item.provenance_counts)
        ? Object.fromEntries(Object.entries(item.provenance_counts).slice(0, 8).map(([key, value]) => [String(key).slice(0, 40), clampNumber(value, 0, 1_000_000, 0)]))
        : {},
      regimeBreakdown: normalizeRegimeBreakdown(item.regime_breakdown),
    };
  };
  const summary = isPlainObject(data.summary) ? data.summary : {};
  const methodology = isPlainObject(data.methodology) ? data.methodology : {};
  return {
    available: true,
    generatedAt: safeDate(data.generated_at) || source?.generatedAt || source?.lastModified || null,
    stale: Boolean(source?.stale),
    summary: {
      signalsSeen: clampNumber(summary.signals_seen, 0, 1_000_000, 0),
      observationsSeen: clampNumber(summary.observations_seen, 0, 10_000_000, 0),
      measuredOutcomes: clampNumber(summary.measured_outcomes, 0, 1_000_000, 0),
      pendingOutcomes: clampNumber(summary.pending_outcomes, 0, 1_000_000, 0),
      missingBaselines: clampNumber(summary.missing_baselines, 0, 1_000_000, 0),
      liveOrdersPlaced: clampNumber(summary.live_orders_placed, 0, 1_000_000, 0),
    },
    methodology: {
      lookAheadAllowed: methodology.look_ahead_allowed === true,
      profitGuarantee: methodology.profit_guarantee === true,
      scoreNeutral: clampNumber(methodology.score_neutral, 0, 1, 0.5),
      priorStrength: clampNumber(methodology.sample_prior_strength, 1, 10_000, 20),
      minimumSamplesForGate: clampNumber(methodology.minimum_samples_for_gate, 1, 10_000, 8),
      outcomeClock: redactSensitiveText(String(methodology.outcome_clock || "post-disclosure observations only")).slice(0, 220),
    },
    sourceProfiles: (Array.isArray(data.source_profiles) ? data.source_profiles : []).map(profile).filter(Boolean).slice(0, 50),
    traderProfiles: (Array.isArray(data.trader_profiles) ? data.trader_profiles : []).map(profile).filter(Boolean).slice(0, 250),
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
    holdingChangesFound: 0,
    unmappedChanges: 0,
    resolvedSignalsImported: 0,
    researchSignals: [],
    liveOrdersPlaced: 0,
    warnings: [],
  };
  if (!isPlainObject(data)) return empty;
  const researchSignals = (Array.isArray(data.research_signals) ? data.research_signals : [])
    .slice(0, 120)
    .map((item, index) => {
      if (!isPlainObject(item)) return null;
      const rawSymbol = String(item.symbol || "").toUpperCase().slice(0, 80);
      const tickerResolved = item.ticker_resolved === true && /^[A-Z][A-Z0-9.-]{0,11}$/.test(rawSymbol);
      const identifier = String(item.security_identifier || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
      const issuerName = redactSensitiveText(String(item.issuer_name || "")).slice(0, 200);
      const traderName = redactSensitiveText(String(item.trader_name || "Unknown institutional manager")).slice(0, 180);
      if (!issuerName || !identifier) return null;
      return {
        id: String(item.id || `sec13f-research-${index + 1}`).slice(0, 180),
        sourceId: "sec_13f",
        traderName,
        issuerName,
        titleOfClass: redactSensitiveText(String(item.title_of_class || "")).slice(0, 120),
        symbol: tickerResolved ? rawSymbol : "",
        tickerResolved,
        securityIdentifier: identifier,
        side: String(item.side || "OBSERVE").toUpperCase().slice(0, 12),
        previousShares: clampNumber(item.previous_shares, 0, Number.MAX_SAFE_INTEGER, 0),
        currentShares: clampNumber(item.current_shares, 0, Number.MAX_SAFE_INTEGER, 0),
        shareDelta: clampNumber(item.share_delta, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0),
        asFiledValue: clampNumber(item.as_filed_value, 0, Number.MAX_SAFE_INTEGER, 0),
        disclosedAt: safeDate(item.disclosed_at),
        observedAt: safeDate(item.observed_at),
        sourceUrl: safePublicUrl(item.source_url),
        notes: redactSensitiveText(String(item.notes || "")).slice(0, 1000),
      };
    })
    .filter(Boolean);
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
    holdingChangesFound: clampNumber(data.holding_changes_found, 0, 1_000_000, 0),
    unmappedChanges: clampNumber(data.unmapped_changes, 0, 1_000_000, 0),
    resolvedSignalsImported: clampNumber(data.resolved_signals_imported, 0, 100_000, data.signals_imported || 0),
    researchSignals,
    liveOrdersPlaced: clampNumber(data.live_orders_placed, 0, 1_000_000, 0),
    warnings: (Array.isArray(data.warnings) ? data.warnings : []).map((item) => redactSensitiveText(item).slice(0, 400)).filter(Boolean).slice(0, 12),
  };
}

function normalizeCopyTraderWatchers(data) {
  if (!isPlainObject(data)) return [];
  const normalizeEntries = (entries, filingType) => (Array.isArray(entries) ? entries : [])
    .slice(0, 100)
    .map((entry, index) => {
      if (!isPlainObject(entry)) return null;
      const cik = String(entry.cik || "").replace(/[^0-9]/g, "").slice(0, 10);
      const name = redactSensitiveText(String(entry.label || entry.name || `${filingType} watcher ${index + 1}`)).slice(0, 180);
      if (!name || !cik) return null;
      return {
        id: `${filingType.toLowerCase().replaceAll(" ", "-")}:${cik}`,
        name,
        traderName: redactSensitiveText(String(entry.trader_name || name)).slice(0, 120),
        firmName: redactSensitiveText(String(entry.firm_name || name)).slice(0, 180),
        strategy: redactSensitiveText(String(entry.strategy || (filingType === "13F" ? "Quarterly institutional holdings" : "Insider transactions"))).slice(0, 180),
        cik: cik.padStart(10, "0"),
        filingType,
        enabled: entry.enabled !== false,
        copyEligible: filingType === "Form 4",
        researchOnly: filingType === "13F",
        researchAgentEnabled: entry.research_agent_enabled !== false,
        identityUrl: safePublicUrl(entry.identity_url),
      };
    })
    .filter(Boolean);
  return [
    ...normalizeEntries(data.sec_form4, "Form 4"),
    ...normalizeEntries(data.sec_13f, "13F"),
  ];
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

function normalizeProviderHealth(data, source) {
  const rawProviders = isPlainObject(data?.providers) ? Object.values(data.providers) : [];
  const providers = rawProviders.map((item) => {
    if (!isPlainObject(item)) return null;
    const status = ["HEALTHY", "DEGRADED", "DELAYED", "STALE", "PARTIAL", "OFFLINE"].includes(String(item.status || "").toUpperCase())
      ? String(item.status).toUpperCase()
      : "UNKNOWN";
    return {
      provider: redactSensitiveText(String(item.provider || "UNKNOWN")).slice(0, 80),
      status,
      lastStatus: redactSensitiveText(String(item.last_status || "unknown")).slice(0, 40),
      lastCheckedAt: safeDate(item.last_checked_at),
      lastSuccessAt: safeDate(item.last_success_at),
      lastFailureAt: safeDate(item.last_failure_at),
      latencyMs: Number.isFinite(Number(item.last_latency_ms)) ? Math.max(0, Math.round(Number(item.last_latency_ms))) : null,
      successRate: Number.isFinite(Number(item.success_rate)) ? clampNumber(Number(item.success_rate), 0, 1, 0) : null,
      lastError: redactSensitiveText(String(item.last_error || "")).slice(0, 220),
      dataType: redactSensitiveText(String(item.data_type || "")).slice(0, 80),
      interval: redactSensitiveText(String(item.interval || "")).slice(0, 20),
      requestedSymbols: (Array.isArray(item.requested_symbols) ? item.requested_symbols : []).map((value) => String(value).toUpperCase().replace(/[^A-Z0-9.^-]/g, "").slice(0, 12)).filter(Boolean).slice(0, 100),
      returnedSymbols: (Array.isArray(item.returned_symbols) ? item.returned_symbols : []).map((value) => String(value).toUpperCase().replace(/[^A-Z0-9.^-]/g, "").slice(0, 12)).filter(Boolean).slice(0, 100),
    };
  }).filter(Boolean).sort((a, b) => a.provider.localeCompare(b.provider));
  const healthy = providers.filter((item) => item.status === "HEALTHY").length;
  const degraded = providers.filter((item) => item.status !== "HEALTHY").length;
  const status = source?.stale ? "STALE" : !providers.length ? "UNKNOWN" : healthy === providers.length ? "HEALTHY" : healthy ? "DEGRADED" : "OFFLINE";
  return {
    available: Boolean(source?.exists && providers.length),
    status,
    updatedAt: safeDate(data?.updated_at) || source?.generatedAt || source?.lastModified || null,
    healthy,
    degraded,
    total: providers.length,
    providers,
  };
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
    alerts.push({ level: "warning", title: "Autonomous planning is not armed", body: "Legacy automatic-planning checks remain separate. Real orders still require every current per-order check and exact Human Gate approval." });
  }
  if (broker.configured && broker.buyingPower === "$0.00") {
    alerts.push({ level: "info", title: "No buying power", body: "The latest broker snapshot blocks BUY orders. A risk-reducing SELL would still require fresh verified holdings, exact Human Gate approval, and Robinhood review." });
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
    alerts.push({ level: "info", title: "Paper mirror candidates ready", body: `${mirror.summary.paperReady} public signal(s) passed delay, drift, provenance, and bankroll checks. Live execution still requires a separate fresh broker draft and exact Human Gate approval.` });
  }
  if (mirror?.knowledge?.summary?.liveOrdersPlaced > 0) {
    alerts.push({ level: "error", title: "Knowledge ledger safety mismatch", body: "The evidence report claims a live order. Ignore its scores and inspect the generating process." });
  } else if (mirror?.knowledge?.available && mirror.knowledge.summary.measuredOutcomes > 0) {
    alerts.push({ level: "info", title: "Copy evidence matured", body: `${mirror.knowledge.summary.measuredOutcomes} post-disclosure outcome(s) now inform source/trader rankings with small-sample shrinkage.` });
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
  if (mirror?.knowledge?.available) {
    entries.push({
      id: "copy-knowledge-activity",
      type: "copy_knowledge",
      title: `${mirror.knowledge.summary.measuredOutcomes} measured copy outcome(s)`,
      body: `${mirror.knowledge.summary.observationsSeen} real observation(s); ${mirror.knowledge.summary.pendingOutcomes} outcome(s) pending; no look-ahead allowed.`,
      createdAt: mirror.knowledge.generatedAt,
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
  const runtimeRoot = options.runtimeRoot ? path.resolve(String(options.runtimeRoot)) : "";
  const workspaceState = normalizeStockOfficeState(state.stockOffice || {});

  if (!fs.existsSync(stockRoot)) {
    const sourceHealth = summarizeSourceHealth([]);
    const snapshot = {
      workspace: baseWorkspace(stockRoot, false),
      available: false,
      generatedAt: at.toISOString(),
      sourceHealth,
      providerHealth: normalizeProviderHealth(null, null),
      sources: [],
      records: [],
      positions: [],
      broker: normalizeBrokerStatus(null, null),
      readiness: normalizeReadiness(null, null, {}),
      mirror: {
        ...normalizeMirrorPlan(null, null),
        importer: normalizeCopyImportStatus(null, null),
        importer13f: normalizeCopyImportStatus(null, null),
        knowledge: normalizeCopyKnowledge(null, null),
      },
      research: normalizeResearchContext(null, null),
      intraday: normalizeIntradayContext(null, null),
      marketContext: normalizeMarketContext(null, null),
      guardrails: workspaceState.activeGuardrails || normalizeGuardrails({}),
      guardrailsSource: workspaceState.activeGuardrails ? {
        type: "human_gate_override",
        appliedAt: workspaceState.guardrailsAppliedAt,
        approvalId: workspaceState.guardrailsApprovalId,
      } : { type: "default", appliedAt: null, approvalId: "" },
      killSwitch: normalizeKillSwitch(null, null),
      tradeDrafts: workspaceState.tradeDrafts,
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

  const readResults = SOURCE_DEFINITIONS.map((definition) => readSource(stockRoot, definition, at, runtimeRoot));
  const sources = readResults.map((result) => result.source);
  const byId = Object.fromEntries(readResults.map((result) => [result.source.id, result]));
  const sourceHealth = summarizeSourceHealth(sources);
  const providerHealth = normalizeProviderHealth(byId.provider_health?.data, byId.provider_health?.source);
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
    importer13f: normalizeCopyImportStatus(byId.sec_13f_import_status?.data, byId.sec_13f_import_status?.source),
    knowledge: normalizeCopyKnowledge(byId.copy_knowledge?.data, byId.copy_knowledge?.source),
    watchers: normalizeCopyTraderWatchers(byId.copy_trader_watchlist?.data),
  };
  const research = normalizeResearchContext(byId.research_context?.data, byId.research_context?.source);
  const intraday = normalizeIntradayContext(byId.intraday_context?.data, byId.intraday_context?.source);
  const marketContext = normalizeMarketContext(byId.market_context?.data, byId.market_context?.source);
  const guardrails = workspaceState.activeGuardrails || normalizeGuardrails(byId.settings?.data || {});
  const guardrailsSource = workspaceState.activeGuardrails ? {
    type: "human_gate_override",
    appliedAt: workspaceState.guardrailsAppliedAt,
    approvalId: workspaceState.guardrailsApprovalId,
  } : {
    type: "stock_guru_settings",
    appliedAt: byId.settings?.source?.generatedAt || byId.settings?.source?.lastModified || null,
    approvalId: "",
  };
  const killSwitch = normalizeKillSwitch(byId.live_auto_kill_switch?.data, byId.live_auto_kill_switch?.source);
  const ticket = parseTicketReport(byId.latest_ticket?.data || "");
  const metrics = metricCounts(records, watchlist, broker, readiness, sourceHealth, mirror);
  const snapshot = {
    workspace: baseWorkspace(stockRoot, true),
    available: true,
    generatedAt: at.toISOString(),
    sourceHealth,
    providerHealth,
    sources,
    records,
    positions: broker.positions,
    broker,
    readiness,
    mirror,
    research,
    intraday,
    marketContext,
    guardrails,
    guardrailsSource,
    killSwitch,
    tradeDrafts: workspaceState.tradeDrafts,
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
      researchGeneratedAt: research.generatedAt,
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
    mode: "broker_onboarding_guarded",
    description: "Financial-market scanner, guarded public-signal Mirror Lab, paper journal, and official Robinhood Agentic Trading onboarding workspace.",
    rootConfigured: Boolean(process.env.STOCK_GURU_PATH),
    rootAvailable: Boolean(available),
    rootLabel: redactSensitiveText(stockRoot),
    externalActions: "Exact broker actions require a fresh official connector review and one-use Human Gate approval",
    safetyRule: "Argentum can prepare exact buy/sell drafts and Robinhood MCP execution envelopes. Live placement remains blocked until the official connector, strict risk checks, broker review, and one-use Human Gate approval all pass.",
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
    canDraftBrokerOrder: admin,
    canRequestBrokerConnection: admin,
    canRequestGuardrailChange: admin,
    canRequestOrderApproval: admin,
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
    "The paper-plan connector cannot trade. Live equity orders require the separate guarded Robinhood dispatch flow; transfers and account-changing calls are not available.",
    "Imported report text is treated as untrusted content and redacted before display or assistant use.",
    "Refresh runs only the evaluator, optional official SEC intake, and guarded mirror-plan builder. It never invokes broker, order, transfer, or account commands.",
    "Robinhood credentials and account authentication remain in Robinhood OAuth/Codex MCP; Stock Office never asks for or stores the Robinhood login password.",
    "Every live equity order requires fresh broker data, deterministic order scope, broker preflight review, and a one-use Human Gate decision.",
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
    providerHealth: snapshot.providerHealth,
    intraday: snapshot.intraday,
    marketContext: snapshot.marketContext,
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
    guardrails: snapshot.guardrails,
    guardrailsSource: snapshot.guardrailsSource,
    killSwitch: snapshot.killSwitch,
    tradeDrafts: snapshot.tradeDrafts.slice(0, 12),
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
    cite("source", "copy_knowledge", "Copy Trader knowledge ledger");
    cite("source", "copy_import_status", "Official SEC Form 4 import status");
    cite("source", "sec_13f_import_status", "Official SEC Form 13F research status");
    const mirror = snapshot.mirror;
    const knowledge = mirror.knowledge;
    const thirteenF = mirror.importer13f;
    const ready = mirror.candidates.filter((candidate) => candidate.status === "paper_ready").slice(0, 5);
    answer = mirror.available
      ? `Mirror Lab evaluated ${mirror.summary.signalsReceived} attributable public signal(s): ${mirror.summary.paperReady} paper-ready, ${mirror.summary.researchOnly} research-only, and ${mirror.summary.rejected} rejected. ${ready.length ? `Paper-ready examples: ${ready.map((candidate) => `${candidate.side} ${candidate.symbol} from ${candidate.traderName}, evidence ${candidate.evidenceScore.toFixed(3)}, capped at ${formatUsd(candidate.mirrorNotionalDollars)}`).join("; ")}.` : "No signal currently passes every delay, provenance, price-drift, and bankroll check."} ${knowledge?.available ? `The knowledge ledger has ${knowledge.summary.measuredOutcomes} measured post-disclosure outcome(s), ${knowledge.summary.pendingOutcomes} pending, and ${knowledge.summary.observationsSeen} real price/fill observation(s); small samples are shrunk toward neutral and look-ahead is disabled. ` : "No outcome ledger is loaded, so evidence scores remain neutral. "}${mirror.importer?.available ? `The official Form 4 importer has ${mirror.importer.enabledEntries} enabled watchlist entr${mirror.importer.enabledEntries === 1 ? "y" : "ies"} and imported ${mirror.importer.signalsImported} signal(s) on its latest run. ` : "The official Form 4 importer has not run yet. "}${thirteenF?.available ? `The official Form 13F research intake tracks ${thirteenF.enabledEntries} manager(s) and produced ${thirteenF.signalsImported} delayed holding-change reference(s). ` : "The official Form 13F research intake has not run yet. "}The plan itself placed 0 live orders; event contracts and delayed 13F/congressional disclosures stay research-only regardless of score.`
      : "Mirror Lab is configured but has no generated plan. Add named CIKs to the SEC watchlist and run the Stock Office refresh, copy-refresh-sec, or copy-refresh-13f. Anonymous posts, delayed 13F/congressional disclosures, and event contracts cannot become automatic Robinhood orders.";
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
      ? "The latest readiness data says strategy checks are ready. Stock Office can build an exact order and route it through Human Gate, one-use dispatch, Robinhood review, and result reconciliation; it cannot bypass any of those controls."
      : `Live entry is not armable. Blockers: ${blockers.length ? blockers.join("; ") : "readiness data does not mark it ready"}. Risk-reducing sells may still be drafted, but no trade can bypass Human Gate and Robinhood review.`;
  } else if (/(position|cash|buying|account|pnl|broker)/.test(lower)) {
    cite("source", "broker_status", "Masked broker status snapshot");
    const positions = snapshot.broker.positions || [];
    answer = `Latest masked broker snapshot: account ${snapshot.broker.account || "not available"}, account value ${snapshot.broker.accountValue || "unknown"}, cash ${snapshot.broker.cash || "unknown"}, buying power ${snapshot.broker.buyingPower || "unknown"}, positions ${positions.length}. Argentum uses this snapshot for review and deterministic checks; any submitted order still requires fresh Robinhood evidence, exact Human Gate approval, a one-use dispatch claim, and Robinhood preflight review.`;
  } else if (/(source|sync|fresh|stale|error|data)/.test(lower)) {
    snapshot.sources.slice(0, 5).forEach((source) => cite("source", source.id, source.label));
    answer = `Source health is ${snapshot.sourceHealth.status}: ${snapshot.sourceHealth.ready} ready/configured, ${snapshot.sourceHealth.stale} stale, ${snapshot.sourceHealth.error} error, ${snapshot.sourceHealth.missing || 0} missing. Refresh Stock Office runs the evaluator and guarded public-signal/knowledge builders. Broker orders require a separate exact Human Gate approval and one-use Robinhood dispatch; deposits and money movement are not implemented.`;
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
    answer = `Stock Office is in guarded broker-onboarding mode with ${metrics.trackedRecords} evaluator records, ${metrics.validSetups} valid setups, ${metrics.rejectedRecords} rejected records, ${metrics.watchlistCount} watchlist tickers, and source health ${metrics.sourceStatus}. Research and drafts are local; every live order still requires fresh broker evidence, Human Gate, and Robinhood review.`;
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

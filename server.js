const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { URL, pathToFileURL } = require("node:url");
const {
  STOCK_WORKSPACE_ID,
  normalizeStockOfficeState,
  loadStockOfficeSnapshot,
  stockOverview,
  listStockRecords,
  getStockRecord,
  getMirrorCandidate,
  answerStockQuestion,
  redactSensitiveText,
  stockPermissions,
  resolveStockRoot,
} = require("./services/stock-office");
const { createStockGuruRefreshManager } = require("./services/stock-guru-refresh");
const { createStockIntelligenceScheduler } = require("./services/stock-intelligence-scheduler");
const { createStockIntelligenceStore, easternDay } = require("./services/stock-intelligence-store");
const { createStockEventBus } = require("./services/stock-event-bus");
const { createStockTraderResearchAgent } = require("./services/stock-trader-research-agent");
const { reconcileOrderDrafts } = require("./services/stock-order-lifecycle");
const { evaluateTradingHalt } = require("./services/stock-trading-halt");
const { buildStockMarketWorkers, marketSession } = require("./services/stock-market-workers");
const { buildContinuousReviewView, selectNextQualifiedProposal } = require("./services/stock-continuous-review");
const {
  ALLOWED_EVENT_TYPES: STOCK_TELEGRAM_EVENT_TYPES,
  APPROVAL_ACTION: STOCK_TELEGRAM_APPROVAL_ACTION,
  createStockTelegramNotifier,
} = require("./services/stock-telegram-notifier");
const { createRobinhoodMcpClient } = require("./services/robinhood-mcp-client");
const {
  applyPaperProposal,
  normalizeShadowPortfolio,
  paperProposalEligibility,
  resetShadowPortfolio,
  runShadowPortfolioCycle,
} = require("./services/stock-shadow-portfolio");
const { runAutonomousSimulationCycle } = require("./services/stock-simulation-engine");
const { createStockFlowManagerSupervisor } = require("./services/stock-flow-managers");
const {
  brokerControlOverview,
  buildCopyPortfolioPlan,
  buildTradeDraft,
  claimApprovedDispatch,
  executionEnvelope,
  normalizeGuardrails,
  settleApprovedDispatch,
  tradeDraftWithApprovalState,
} = require("./services/stock-broker-control");
const agent101Os = require("./services/agent101-operating-system");
const openclawRuntime = require("./services/openclaw-runtime");
const localRuntime = require("./services/local-runtime");
const localDatabase = require("./services/local-database");
const obsidianVault = require("./services/obsidian-vault");
const secureSecrets = require("./services/secure-secrets");
const brainBackup = require("./services/brain-backup");
const brainVerification = require("./services/brain-verification");
const agentContextBuilder = require("./services/agent-context-builder");
const gatewayAdapter = require("./services/gateway-adapter");
const agent101MissionManager = require("./services/agent101-mission-manager");
const agent101ProjectWorkspace = require("./services/agent101-project-workspace");
const printShopWorkspace = require("./services/print-shop-workspace");

const ROOT = __dirname;
loadLocalEnvFiles(ROOT);
const APP_MODE = localRuntime.resolveAppMode(process.env);
const PORT = localRuntime.resolvePort(process.env);
const HOST = localRuntime.resolveHost(process.env);
localRuntime.assertLocalModeHost(APP_MODE, HOST);
const DATA_DIR = localRuntime.resolveDataDir(ROOT, process.env);
const STOCK_SHADOW_FILE = path.join(DATA_DIR, "stock-shadow-portfolio.json");
const STOCK_SIMULATION_FILE = path.join(DATA_DIR, "stock-simulation-lab.json");
const STOCK_INTELLIGENCE_STATUS_FILE = path.join(DATA_DIR, "stock-intelligence-scheduler.json");
const STOCK_TRADER_RESEARCH_STATE_FILE = path.join(DATA_DIR, "stock-trader-research-agents.json");
const STOCK_GURU_RUNTIME_ROOT = path.resolve(process.env.STOCK_GURU_RUNTIME_DIR || path.join(DATA_DIR, "stock-guru-runtime"));
const STOCK_LOGO_CACHE_DIR = path.join(DATA_DIR, "company-logos");
const STOCK_LOGO_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
if (APP_MODE === "local") {
  process.env.CLIPPING_OFFICE_DATA_DIR = process.env.ARGENTUM_CLIPPING_OFFICE_DATA_DIR || path.join(DATA_DIR, "clipping-office");
}
const CLIPPING_OFFICE_DATA_DIR = path.resolve(process.env.CLIPPING_OFFICE_DATA_DIR || path.join(ROOT, "CLIPPING OFFICE ", "data"));
const AGENT101_OUTPUT_ROOT = path.resolve(CLIPPING_OFFICE_DATA_DIR, process.env.AGENT101_OUTPUT_DIR || "./outputs");
const CLIPPING_OFFICE_MOUNT = "/apps/clipping-office";
const CLIPPING_OFFICE_AGENT101_BRIDGE = `${CLIPPING_OFFICE_MOUNT}/api/argentum/agent101`;
const CLIPPING_OFFICE_SERVER = path.join(ROOT, "CLIPPING OFFICE ", "server.js");
const PUBLIC_SITE_DIR = path.join(ROOT, "website");
const STOCK_OFFICE_MOUNT = "/apps/stock-office";
const STOCK_OFFICE_APP_DIR = path.join(ROOT, "apps", "stock-office");
const PRINT_SHOP_OFFICE_MOUNT = "/apps/print-shop-office";
const PRINT_SHOP_OFFICE_APP_DIR = path.join(ROOT, "apps", "print-shop-office");
const DISPLAY_APP_MOUNT = "/display";
const DISPLAY_APP_DIR = path.join(ROOT, "apps", "display");
const BUSINESS_OFFICE_APP_DIR = path.join(ROOT, "apps", "business-office");
const BUSINESS_OFFICE_APP_MOUNTS = {
  "/apps/etsy-office": "etsy-office",
  "/apps/essentrx-office": "essentrx-office",
};
const LOCAL_OFFICE_BYPASS = process.env.ARGENTUM_LOCAL_OFFICE_BYPASS === "1";
const PRINT_SHOP_DATA_ROOT = path.resolve(process.env.ARGENTUM_PRINT_SHOP_DATA_DIR || DATA_DIR);
const STATE_FILE = path.join(DATA_DIR, "argentum-state.json");
const AUTH_FILE = path.join(DATA_DIR, "argentum-auth.json");
const SESSION_SECRET_FILE = path.join(DATA_DIR, "argentum-session-secret.json");
const AI_PROVIDER_FILE = path.join(DATA_DIR, "argentum-ai-provider.json");
const DISPLAY_VIEW_ORDER = ["home", "agents", "agent-1010", "clipping", "trading", "human-gate", "activity"];
const DISPLAY_VIEWS = new Set(DISPLAY_VIEW_ORDER);
const DISPLAY_CONTROLLER_STALE_MS = 45_000;
const DISPLAY_SSE_HEARTBEAT_MS = 15_000;
const DISPLAY_PAIRING_TTL_MS = 5 * 60 * 1000;
const displayEventClients = new Set();
let displayEventSequence = 0;
const ENV_ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ENV_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ENV_OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const ENV_AI_MODEL = process.env.AI_MODEL || "";
const ENV_OPENAI_MODEL = process.env.OPENAI_MODEL || "";
const ENV_ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ENV_ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "";
const ENV_AI_PROVIDER = process.env.AI_PROVIDER || "";
const ENV_AI_MODE = process.env.AI_MODE || "";
const ENV_AI_MONTHLY_LIMIT_USD = process.env.AI_MONTHLY_LIMIT_USD || "";
const ENV_OPENAI_TEST_BUDGET_USD = process.env.OPENAI_TEST_BUDGET_USD || "";
const ENV_BRAVE_API_KEY = process.env.BRAVE_API_KEY || "";
const ENV_SERP_API_KEY = process.env.SERP_API_KEY || "";
let localDatabaseStatus = null;
const SESSION_SECRET = process.env.SESSION_SECRET || readPersistentSessionSecret();
hydrateStockSecIdentity();
const DAY_MS = 1000 * 60 * 60 * 24;
const SESSION_TTL_MS = boundedDurationMs(process.env.SESSION_TTL_MS, 1000 * 60 * 60 * 8, 30 * DAY_MS);
const REMEMBER_SESSION_TTL_MS = boundedDurationMs(process.env.REMEMBER_SESSION_TTL_MS, 30 * DAY_MS, 30 * DAY_MS);
const LOGIN_WINDOW_MS = 1000 * 60 * 15;
const LOGIN_MAX_ATTEMPTS = 5;
const PASSWORD_ITERATIONS = 210_000;
const LEGACY_DEFAULT_USERNAME = "admin";
const LEGACY_DEFAULT_PASSWORD = "password";
const loginAttempts = new Map();
const stockOfficeRateBuckets = new Map();
const stockGuruRefreshManager = createStockGuruRefreshManager({
  runtimeRoot: STOCK_GURU_RUNTIME_ROOT,
  // Evaluator output is useful before the slower news and filing stages
  // finish. Publish a research-only checkpoint for the Research view; only
  // fully qualified proposals can enter the approval and Telegram path.
  onCommandCompleted: ({ command, runId }) => command?.name === "evaluate"
    ? publishStockResearchCheckpoint({ runId, phase: "evaluator_complete" })
    : null,
});
const stockIntelligenceStore = createStockIntelligenceStore({ dataDir: DATA_DIR });
const stockEventBus = createStockEventBus({
  persist: (event) => {
    stockIntelligenceStore.recordSystemEvent(event);
    invalidateStockIntelligenceStateCache();
  },
});
const stockTraderResearchAgent = createStockTraderResearchAgent({
  dataDir: DATA_DIR,
  stockRoot: resolveStockRoot(ROOT),
  runtimeRoot: STOCK_GURU_RUNTIME_ROOT,
  stateFile: STOCK_TRADER_RESEARCH_STATE_FILE,
  onChange: () => invalidateStockIntelligenceStateCache(),
});
const stockIntelligenceScheduler = createStockIntelligenceScheduler({
  refreshManager: stockGuruRefreshManager,
  stockRoot: resolveStockRoot(ROOT),
  statusFile: STOCK_INTELLIGENCE_STATUS_FILE,
  onCompleted: async (result) => {
    if (process.env.NODE_ENV === "test") return;
    const schedulerStatus = stockIntelligenceScheduler.getStatus();
    if (["success", "partial"].includes(result.status)) {
      try {
        const intelligenceSnapshot = stockOfficeSnapshot(readState());
        stockTraderResearchAgent.enqueueFromSnapshot(intelligenceSnapshot);
        const persisted = stockIntelligenceStore.ingestSnapshot(intelligenceSnapshot, {
          status: result.status,
          startedAt: schedulerStatus.lastStartedAt,
          completedAt: result.completedAt || schedulerStatus.lastCompletedAt,
          nextScheduledAt: schedulerStatus.nextRunAt,
          cycleType: marketSession(new Date(result.completedAt || Date.now())).status,
          trigger: "scheduler",
        });
        invalidateStockIntelligenceStateCache();
        stockEventBus.publish("research.completed", {
          runId: persisted.runId,
          status: result.status,
          symbolsScanned: persisted.opportunities.length,
          reportTypes: Object.keys(persisted.reports || {}),
        }, { correlationId: persisted.correlationId });
        persisted.opportunities.filter((opportunity) => opportunity.status === "high_priority" && (opportunity.change?.previousStatus !== "high_priority" || opportunity.change?.thesisChanged)).slice(0, 12).forEach((opportunity) => {
          stockEventBus.publish("opportunity.updated", {
            opportunityId: opportunity.id,
            symbol: opportunity.symbol,
            status: opportunity.status,
            score: opportunity.overallScore,
            confidence: opportunity.confidenceScore,
            reason: opportunity.change?.previousStatus ? `Opportunity crossed from ${opportunity.change.previousStatus} to high priority.` : "New high-priority opportunity persisted.",
          }, { id: `opportunity.updated:${persisted.runId}:${opportunity.symbol}`, correlationId: persisted.correlationId });
        });
        if (persisted.providerHealthTransition) {
          stockEventBus.publish("provider.health_changed", persisted.providerHealthTransition, {
            id: `provider.health_changed:${persisted.runId}`,
            correlationId: persisted.correlationId,
          });
        }
        if (persisted.reports?.overnight) stockEventBus.publish("overnight.completed", { reportId: `stock-report-overnight-${persisted.reports.overnight.generatedAt?.slice(0, 10) || "current"}`, status: "ready" }, { correlationId: persisted.correlationId });
        if (persisted.reports?.morning) stockEventBus.publish("morning.report_ready", { reportId: `stock-report-morning-${persisted.reports.morning.generatedAt?.slice(0, 10) || "current"}`, status: "ready" }, { correlationId: persisted.correlationId });
        const persistedSnapshot = stockOfficeSnapshot(readState());
        const portfolioPlan = buildCopyPortfolioPlan(persistedSnapshot);
        portfolioPlan.proposals.forEach((proposal) => {
          stockIntelligenceStore.upsertProposal(proposal, { opportunityId: proposal.opportunityId });
          stockIntelligenceStore.recordRiskDecision({
            correlationId: persisted.correlationId,
            proposalId: proposal.id,
            symbol: proposal.symbol,
            decision: proposal.draftEligible ? "passed" : proposal.side === "HOLD" ? "monitoring" : "blocked",
            reasons: proposal.blockers || [],
            data: { side: proposal.side, scores: proposal.scores || null },
          });
          if (!proposal.draftEligible && proposal.side !== "HOLD" && proposal.blockers?.length) {
            stockEventBus.publish("risk.blocked", {
              proposalId: proposal.id,
              symbol: proposal.symbol,
              side: proposal.side,
              status: "blocked",
              reason: proposal.blockers[0],
              blockers: proposal.blockers.slice(0, 8),
            }, { id: `risk.blocked:${proposal.fingerprint}`, correlationId: persisted.correlationId });
          }
        });
        const brokerControl = brokerControlOverview(persistedSnapshot);
        const workers = buildStockMarketWorkers({
          snapshot: persistedSnapshot,
          brokerControl,
          portfolioPlan,
          intelligenceScheduler: schedulerStatus,
          intelligence: persistedSnapshot.intelligence,
        });
        workers.workers.forEach((worker) => stockIntelligenceStore.updateWorkerHeartbeat(worker, {
          correlationId: persisted.correlationId,
          cycleType: workers.market.status,
          startedAt: schedulerStatus.lastStartedAt,
          completedAt: result.completedAt || schedulerStatus.lastCompletedAt,
          itemsSeen: worker.metrics?.[0]?.value || 0,
          itemsCreated: worker.metrics?.[1]?.value || 0,
          errors: worker.status === "blocked" ? 1 : 0,
        }));
      } catch (error) {
        console.warn("Stock research persistence failed safely:", error.message);
        stockEventBus.publish("source.failed", { source: "stock_intelligence_database", error: error.message, status: "failed" });
      }
    } else {
      stockEventBus.publish("research.failed", { status: result.status, error: result.errors?.[0] || result.message || "Research cycle failed safely." });
      stockEventBus.publish("source.failed", { source: "stock_guru_refresh", status: result.status, error: result.errors?.[0] || result.message || "Research cycle failed safely." });
    }
    (result.warnings || []).filter((warning) => /failed|error|timeout|exceeded/i.test(warning)).forEach((warning) => {
      const warningFingerprint = crypto.createHash("sha256").update(String(warning)).digest("hex").slice(0, 20);
      stockEventBus.publish("source.failed", { source: "stock_guru_provider", status: "partial", error: warning }, { id: `source.failed:stock_guru_provider:${warningFingerprint}` });
    });
    if (result.recordsMayHaveChanged) {
      try {
        refreshStockShadowPortfolio({ force: true });
        refreshStockSimulationLab({ force: true });
      } catch (error) {
        console.warn("Stock simulation follow-up cycle failed safely:", error.message);
      }
    }
    if (robinhoodMcpClient.publicStatus().oauthAuthenticated) {
      await robinhoodMcpClient.refreshIfStale(5_000).catch((error) => {
        stockEventBus.publish("broker.disconnected", { status: "unavailable", error: error.message, reason: "Official Robinhood refresh failed; execution remains closed." });
        return null;
      });
      await reconcileStockBrokerOrderLifecycle().catch((error) => console.warn("Stock order lifecycle reconciliation failed safely:", error.message));
    }
    await runStockContinuousReview(result).catch((error) => console.warn("Stock continuous proposal review failed safely:", error.message));
  },
});
const robinhoodMcpClient = createRobinhoodMcpClient({
  dataDir: path.join(DATA_DIR, "broker-auth"),
  codexConfigFile: process.env.ARGENTUM_CODEX_CONFIG_PATH || path.join(os.homedir(), ".codex", "config.toml"),
});
const stockTelegramSecretCache = new Map();
const stockTelegramNotifier = createStockTelegramNotifier({
  environment: process.env,
  controlTransport: APP_MODE === "local" ? "local_polling" : "webhook",
  getSetting: (key, fallback) => localDatabase.getLocalSetting(DATA_DIR, key, fallback),
  setSetting: (key, value) => localDatabase.setLocalSetting(DATA_DIR, key, value),
  getSecret: (provider) => {
    const cached = stockTelegramSecretCache.get(provider);
    if (cached) return cached;
    const value = secureSecrets.getSecret({ dataDir: DATA_DIR, provider });
    if (value) stockTelegramSecretCache.set(provider, value);
    else stockTelegramSecretCache.delete(provider);
    return value;
  },
  setSecret: (provider, value) => {
    const saved = secureSecrets.setSecret({ dataDir: DATA_DIR, provider, value, preferKeychain: true });
    stockTelegramSecretCache.set(provider, value);
    localDatabase.upsertSecretMetadata(DATA_DIR, provider, saved.storage, true);
    return saved;
  },
  deleteSecret: (provider) => {
    const removed = secureSecrets.deleteSecret({ dataDir: DATA_DIR, provider });
    stockTelegramSecretCache.delete(provider);
    localDatabase.upsertSecretMetadata(DATA_DIR, provider, removed.storage, false);
    return removed;
  },
  reserveEvent: (event) => stockIntelligenceStore.reserveTelegramEvent(event),
  completeEvent: (id, result) => stockIntelligenceStore.completeTelegramEvent(id, result),
  commandContext: (input) => stockTelegramCommandContext(input),
  approvalAction: (input) => stockTelegramApprovalAction(input),
  watchAction: (input) => stockTelegramWatchAction(input),
});
stockEventBus.subscribe("overnight.completed", (event) => {
  const report = stockIntelligenceStore.latestReport("overnight");
  return stockTelegramNotifier.notifySystemEvent({ eventId: event.id, kind: "overnight_report", text: stockTelegramReportText("ARGENTUM NIGHT RESEARCH", report) }, readState().approvals || []).catch(() => null);
});
stockEventBus.subscribe("morning.report_ready", (event) => {
  const report = stockIntelligenceStore.latestReport("morning");
  return stockTelegramNotifier.notifySystemEvent({ eventId: event.id, kind: "morning_report", text: stockTelegramReportText("ARGENTUM MORNING INTELLIGENCE", report) }, readState().approvals || []).catch(() => null);
});
stockEventBus.subscribe("source.failed", (event) => stockTelegramNotifier.notifySystemEvent({
  eventId: event.id,
  kind: "source_failure",
  text: `ARGENTUM SOURCE FAILURE\n${event.payload?.source || "Market intelligence source"}\n${redactSensitiveText(event.payload?.error || "Source failed safely.").slice(0, 800)}\nResearch continues with available evidence; execution cannot use missing or stale data.`,
}, readState().approvals || []).catch(() => null));
stockEventBus.subscribe("provider.health_changed", (event) => stockTelegramNotifier.notifySystemEvent({
  eventId: event.id,
  kind: "system_health",
  text: `ARGENTUM PROVIDER HEALTH\n${event.payload?.from || "UNKNOWN"} → ${event.payload?.to || "UNKNOWN"}\n${["HEALTHY", "DEGRADED"].includes(event.payload?.to) ? "Research continues with the recorded provider state." : "New entries are blocked when required market data is stale or offline; research continues where safe."}`,
}, readState().approvals || []).catch(() => null));
stockEventBus.subscribe("broker.disconnected", (event) => stockTelegramNotifier.notifySystemEvent({
  eventId: event.id,
  kind: "broker_failure",
  text: `ARGENTUM BROKER FAILURE\n${redactSensitiveText(event.payload?.reason || event.payload?.error || "Official Robinhood state is unavailable.").slice(0, 800)}\nExecution is closed. Research continues.`,
}, readState().approvals || []).catch(() => null));
stockEventBus.subscribe("order.rejected", (event) => stockTelegramNotifier.notifySystemEvent({
  eventId: event.id,
  kind: "order_rejected",
  text: `ARGENTUM ORDER STOPPED\n${event.payload?.side || ""} ${event.payload?.symbol || ""}\n${redactSensitiveText(event.payload?.reason || "Broker review or reconciliation did not pass.").slice(0, 800)}\nNo automatic retry.`,
}, readState().approvals || []).catch(() => null));
stockEventBus.subscribe("order.cancelled", (event) => stockTelegramNotifier.notifySystemEvent({
  eventId: event.id,
  kind: "order_cancelled",
  text: `ARGENTUM ORDER CANCELLED\n${event.payload?.side || ""} ${event.payload?.symbol || ""}\n${redactSensitiveText(event.payload?.reason || "Official broker state reports this order as cancelled.").slice(0, 800)}`,
}, readState().approvals || []).catch(() => null));
stockEventBus.subscribe("order.filled", (event) => {
  const draft = event.payload?.draft;
  if (!draft) return null;
  return stockTelegramNotifier.notifyVerifiedTrade(draft, readState().approvals || []).catch(() => null);
});
const agent101MissionWorkers = new Map();
const agent101MissionStreamClients = new Map();
const aiBudgetReservations = new Map();
const MAX_ACTIVE_AGENT101_MISSIONS = Math.max(1, Math.min(50, Number(process.env.AGENT101_MAX_ACTIVE_MISSIONS || 12)));
const AI_BUDGET_INPUT_USD_PER_MILLION = Math.max(1, Number(process.env.AI_BUDGET_INPUT_USD_PER_MILLION || 30));
const AI_BUDGET_OUTPUT_USD_PER_MILLION = Math.max(1, Number(process.env.AI_BUDGET_OUTPUT_USD_PER_MILLION || 120));
const AI_PROVIDER_OPTIONS = new Set(["local_demo", "local", "openai", "anthropic"]);
const AI_MODE_OPTIONS = new Set(["demo", "live"]);
const LOCAL_CONNECTOR_SECRET_ENV = [
  { provider: "twitch_client_id", env: "TWITCH_CLIENT_ID" },
  { provider: "twitch_client_secret", env: "TWITCH_CLIENT_SECRET" },
  { provider: "twitch_oauth_token", env: "TWITCH_OAUTH_TOKEN" },
  { provider: "twitch_app_access_token", env: "TWITCH_APP_ACCESS_TOKEN" },
  { provider: "twitch_user_access_token", env: "TWITCH_USER_ACCESS_TOKEN" },
  { provider: "kick_client_id", env: "KICK_CLIENT_ID" },
  { provider: "kick_client_secret", env: "KICK_CLIENT_SECRET" },
  { provider: "kick_oauth_token", env: "KICK_OAUTH_TOKEN" },
];
const LOCAL_CONNECTOR_ENV_ORIGINALS = Object.fromEntries(
  LOCAL_CONNECTOR_SECRET_ENV.map(({ env }) => [env, process.env[env] || ""]),
);
const localConnectorEnvApplied = new Set();
const AI_RISKY_ACTION_TYPES = new Set([
  "publish",
  "publish_video",
  "upload_to_tiktok",
  "direct_post",
  "spend_money",
  "move_money",
  "access_payment_methods",
  "contact_customer",
  "modify_account",
  "change_account_settings",
  "create_live_agent",
  "modify_permissions",
  "change_permissions",
  "change_api_key",
  "deploy_campaign",
  "external_api_action",
  "browser_login",
  "payment_action",
  "delete_file",
  "write_file",
  "send_email",
  "change_system_settings",
]);
const DEPO_SYSTEM_RULES = [
  "Agent 101 is the Chief Operations Intelligence Agent inside Argentum OS.",
  "Agent 101 investigates, analyzes, infers, plans, executes safe internal work, reports operational truth, and optimizes workflows.",
  "Agent 101 communicates in executive operating format: CURRENT STATUS, KEY FINDINGS, RISKS, RECOMMENDATIONS, NEXT ACTIONS.",
  "Agent 101 cannot publish, spend money, move money, contact customers, modify accounts, create live agents, change permissions, change API keys, deploy campaigns, or call external APIs without Human Gate approval.",
  "Any risky action must be returned as pending approval, not executed.",
].join(" ");

const CONNECTOR_STATUS_VALUES = new Set(["not_configured", "manual_handoff", "ready", "error", "approval_required"]);

const CONNECTOR_DEFINITIONS = {
  openai: {
    label: "OpenAI",
    category: "ai_provider",
    status: "not_configured",
    requiredEnv: ["OPENAI_API_KEY", "AI_PROVIDER", "AI_MODEL", "AI_MONTHLY_LIMIT_USD"],
    approvalRequired: false,
    blockedActions: ["frontend key exposure", "unlimited spend"],
    checklist: ["Set Railway environment variables", "Run backend test", "Confirm monthly limit", "Keep key server-side"],
  },
  openclaw: {
    label: "OpenClaw Gateway",
    category: "agent_runtime",
    status: "not_configured",
    requiredEnv: ["OPENCLAW_ENABLED", "OPENCLAW_BASE_URL", "OPENCLAW_GATEWAY_TOKEN", "OPENCLAW_DEFAULT_MODEL"],
    approvalRequired: false,
    blockedActions: ["browser-side gateway calls", "raw tool invocation", "public gateway exposure"],
    checklist: ["Run OpenClaw as a private service", "Set server env vars", "Test /v1/models", "Keep Gateway token server-side"],
  },
  browser: {
    label: "Browser",
    category: "manual_operator",
    status: "approval_required",
    requiredEnv: [],
    approvalRequired: true,
    blockedActions: ["raw credential login", "payment settings", "account changes"],
    checklist: ["Operator opens account manually", "Agent 101 prepares checklist", "Human Gate approves any risky step"],
  },
  capcut: {
    label: "CapCut",
    category: "content_tool",
    status: "manual_handoff",
    requiredEnv: ["CAPCUT_HANDOFF_URL"],
    approvalRequired: true,
    blockedActions: ["account login", "publishing", "payment changes"],
    checklist: ["Install or open CapCut manually", "Create project manually", "Use Agent 101 edit notes", "Export locally before approval"],
  },
  tiktok: {
    label: "TikTok",
    category: "social_platform",
    status: "manual_handoff",
    requiredEnv: ["TIKTOK_CLIENT_ID", "TIKTOK_CLIENT_SECRET", "TIKTOK_REDIRECT_URI"],
    approvalRequired: true,
    blockedActions: ["direct posting", "profile changes", "ad spend", "credential login"],
    checklist: ["Operator controls login", "Agent 101 drafts captions", "Human Gate approves posting package"],
  },
  twitch: {
    label: "Twitch",
    category: "social_platform",
    status: "manual_handoff",
    requiredEnv: ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "TWITCH_REDIRECT_URI"],
    approvalRequired: true,
    blockedActions: ["credential login", "API key creation", "account changes", "paid actions"],
    checklist: ["Operator creates/owns developer app", "Add env vars in Railway", "Test connector status", "Keep stream/account actions manual"],
  },
  youtube: {
    label: "YouTube",
    category: "social_platform",
    status: "manual_handoff",
    requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "YOUTUBE_CHANNEL_ID"],
    approvalRequired: true,
    blockedActions: ["direct upload", "channel changes", "credential login", "monetization changes"],
    checklist: ["Operator owns OAuth app", "Agent 101 drafts metadata", "Posting remains manual until approved"],
  },
  google_drive: {
    label: "Google Drive",
    category: "storage",
    status: "manual_handoff",
    requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_DRIVE_FOLDER_ID"],
    approvalRequired: true,
    blockedActions: ["credential login", "sharing permission changes", "deleting files"],
    checklist: ["Operator chooses folder", "Store folder id in Railway only", "Agent 101 can reference file metadata after approval"],
  },
};

openclawRuntime.assertValidOpenClawStartupConfig(openclawRuntime.readOpenClawConfig(process.env));

const BUSINESS_OFFICES = {
  "depo-habitat": {
    id: "depo-habitat",
    name: "Agent Office",
    title: "Agent Office: Agent 101",
    workflowId: "workflow-agent-factory",
    intent: "agent_operations",
    risk: "medium",
    allowedWork: ["review offices", "plan bounded work", "draft outputs", "prepare approvals"],
    requiredInputs: ["operator goal", "office context", "memory notes", "approval state"],
    outputs: ["task plan", "workflow plan", "approval package", "audit note"],
    blockedWork: ["create live agents", "grant permissions", "external execution"],
  },
  "clips-office": {
    id: "clips-office",
    name: "Clips Office",
    title: "Business Office: Clips & Video",
    workflowId: "workflow-clips-office",
    intent: "content_creation",
    risk: "medium",
    allowedWork: ["clip plans", "script drafts", "caption drafts", "CapCut handoff notes", "posting packages"],
    requiredInputs: ["raw footage notes", "brand notes", "target platform", "approval decision"],
    outputs: ["clips plan", "account setup checklist", "caption package", "posting approval package"],
    blockedWork: ["log in", "create API keys", "post videos", "spend ad money", "change account settings"],
  },
  "stock-office": {
    id: "stock-office",
    name: "Stock Office",
    title: "Business Office: Stock Guru",
    workflowId: "workflow-stock-watch",
    intent: "financial_market_decision_support",
    risk: "high",
    allowedWork: ["read evaluator reports", "summarize risk labels", "review source freshness", "draft operator review packets"],
    requiredInputs: ["Stock Guru reports", "watchlist", "readiness checks", "operator decision"],
    outputs: ["market research summary", "risk memo", "readiness report", "approval package"],
    blockedWork: ["place trades", "move money", "promise returns", "broker account changes", "read credential values"],
  },
  "etsy-office": {
    id: "etsy-office",
    name: "Etsy Office",
    title: "Business Office: Etsy Store",
    workflowId: "workflow-pod-lab",
    intent: "print_on_demand",
    risk: "low",
    allowedWork: ["POD ideas", "listing drafts", "SEO notes", "mockup requirements", "store-change packages"],
    requiredInputs: ["niche goal", "product constraints", "evidence", "approval queue"],
    outputs: ["POD brief", "listing outline", "store-change approval package"],
    blockedWork: ["publish listings", "change prices", "spend money", "message customers"],
  },
  "essentrx-office": {
    id: "essentrx-office",
    name: "Essentrx Office",
    title: "Business Office: Essentrx",
    workflowId: "workflow-pod-lab",
    intent: "brand_operations",
    risk: "medium",
    allowedWork: ["brand notes", "product admin plans", "customer-safe copy drafts", "review bundles"],
    requiredInputs: ["brand context", "product notes", "admin notes", "approval queue"],
    outputs: ["brand plan", "admin checklist", "customer-safe draft", "approval package"],
    blockedWork: ["contact customers", "change checkout", "publish campaigns", "modify accounts"],
  },
  "print-shop-office": {
    id: "print-shop-office",
    name: "Print Shop Office",
    title: "Business Office: 3D Print Shop",
    workflowId: "workflow-print-shop",
    intent: "ecommerce_fulfillment",
    risk: "medium",
    appUrl: "/apps/print-shop-office/",
    allowedWork: ["approval-gated opportunity discovery", "source-backed product hypotheses", "A1 Mini feasibility checks", "single-color part planning", "deterministic template geometry", "STL validation"],
    requiredInputs: ["saved A1 Mini profile", "Human Gate approval for external research", "measured dimensions and material before geometry", "use environment", "color process"],
    outputs: ["cited opportunity shortlist", "feasibility assessment", "multipart proposal", "versioned STL artifact", "validation record", "research approval package"],
    blockedWork: ["start a printer without approval", "invent market demand or cost", "publish products", "charge customers", "send customer emails", "buy supplies"],
  },
  "human-gate": {
    id: "human-gate",
    name: "Human Gate",
    title: "Human Gate",
    workflowId: "workflow-agent-factory",
    intent: "approval_review",
    risk: "high",
    allowedWork: ["review packages", "approve drafts", "send back", "block", "mark manually completed"],
    requiredInputs: ["evidence", "risk label", "operator decision"],
    outputs: ["approval decision", "audit entry", "memory note"],
    blockedWork: ["auto-approve risky actions", "execute external actions"],
  },
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function now() {
  return new Date().toISOString();
}

function safeIso(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function normalizeDisplayView(value, fallback = "home") {
  const raw = String(value || "").trim().toLowerCase().replace(/_/g, "-");
  const aliases = {
    "1010": "agent-1010",
    agent101: "agent-1010",
    "agent101": "agent-1010",
    "agent-101": "agent-1010",
    "agent-1010": "agent-1010",
    humangate: "human-gate",
    "human-gate": "human-gate",
    human: "human-gate",
    gate: "human-gate",
    clips: "clipping",
    clip: "clipping",
    stock: "trading",
    stocks: "trading",
    trade: "trading",
  };
  const normalized = aliases[raw] || raw;
  if (DISPLAY_VIEWS.has(normalized)) return normalized;
  if (fallback === null) return "";
  return DISPLAY_VIEWS.has(fallback) ? fallback : "home";
}

function displayDeviceId(value = "") {
  return String(value || "").trim().replace(/[^a-z0-9_.:-]/gi, "").slice(0, 120);
}

function displayDeviceLabel(value = "") {
  return safeDisplayText(value || "ESP32 controller", 120);
}

function displayTokenHash(token = "") {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function defaultDisplayConfig() {
  return {
    enabled: true,
    displayMode: "external",
    preferredDisplay: 3,
    fullscreen: true,
    defaultView: "home",
    selectedDisplay: null,
    updatedAt: now(),
  };
}

function normalizeDisplayBounds(value = {}) {
  const bounds = value && typeof value === "object" ? value : {};
  const normalized = {};
  for (const key of ["x", "y", "width", "height"]) {
    const parsed = Number(bounds[key]);
    normalized[key] = Number.isFinite(parsed) ? Math.round(parsed) : 0;
  }
  return normalized;
}

function normalizeDisplayConfig(value = {}) {
  const fresh = defaultDisplayConfig();
  const config = value && typeof value === "object" ? value : {};
  const preferredDisplay = Number(config.preferredDisplay);
  const selected = config.selectedDisplay && typeof config.selectedDisplay === "object"
    ? {
      id: String(config.selectedDisplay.id || "").slice(0, 120),
      label: String(config.selectedDisplay.label || "").slice(0, 160),
      bounds: normalizeDisplayBounds(config.selectedDisplay.bounds || {}),
      scaleFactor: Number.isFinite(Number(config.selectedDisplay.scaleFactor)) ? Number(config.selectedDisplay.scaleFactor) : null,
      updatedAt: safeIso(config.selectedDisplay.updatedAt) || now(),
    }
    : null;
  return {
    ...fresh,
    enabled: config.enabled !== false,
    displayMode: ["external", "selected", "primary"].includes(config.displayMode) ? config.displayMode : fresh.displayMode,
    preferredDisplay: Number.isFinite(preferredDisplay) ? Math.max(1, Math.min(12, Math.round(preferredDisplay))) : fresh.preferredDisplay,
    fullscreen: config.fullscreen !== false,
    defaultView: normalizeDisplayView(config.defaultView, fresh.defaultView),
    selectedDisplay: selected,
    updatedAt: safeIso(config.updatedAt) || fresh.updatedAt,
  };
}

function normalizeTrustedDisplayControllers(value = []) {
  return listFrom(value).map((controller) => {
    const deviceId = displayDeviceId(controller.deviceId);
    if (!deviceId) return null;
    return {
      deviceId,
      label: displayDeviceLabel(controller.label || deviceId),
      pairedAt: safeIso(controller.pairedAt) || now(),
      lastSeenAt: safeIso(controller.lastSeenAt),
      status: String(controller.status || "paired").replace(/[^a-z0-9_.:-]/gi, "").slice(0, 80) || "paired",
      tokenHash: String(controller.tokenHash || "").replace(/[^a-f0-9]/gi, "").slice(0, 64),
    };
  }).filter(Boolean).slice(0, 8);
}

function normalizeDisplayPairing(value = null) {
  if (!value || typeof value !== "object") return null;
  const deviceId = displayDeviceId(value.deviceId);
  if (!deviceId) return null;
  const status = ["pending", "accepted", "expired"].includes(value.status) ? value.status : "pending";
  return {
    deviceId,
    label: displayDeviceLabel(value.label || deviceId),
    code: String(value.code || "").replace(/\D/g, "").slice(0, 8),
    status,
    requestedAt: safeIso(value.requestedAt) || now(),
    expiresAt: safeIso(value.expiresAt) || new Date(Date.now() + DISPLAY_PAIRING_TTL_MS).toISOString(),
    acceptedAt: safeIso(value.acceptedAt),
  };
}

function defaultDisplayState() {
  return {
    view: "home",
    connected: true,
    lastCommandAt: null,
    lastCommandSource: "system",
    controllerConnected: false,
    controllerLastSeenAt: null,
    controllerDeviceId: "",
    controllerStatus: "unknown",
    commandVersion: 0,
    config: defaultDisplayConfig(),
    pairing: null,
    trustedControllers: [],
    updatedAt: now(),
  };
}

function normalizeDisplayState(value = {}) {
  const fresh = defaultDisplayState();
  const display = value && typeof value === "object" ? value : {};
  const config = normalizeDisplayConfig(display.config || fresh.config);
  const commandVersion = Number(display.commandVersion);
  return {
    ...fresh,
    view: normalizeDisplayView(display.view, config.defaultView),
    connected: display.connected !== false,
    lastCommandAt: safeIso(display.lastCommandAt),
    lastCommandSource: String(display.lastCommandSource || fresh.lastCommandSource).replace(/[^a-z0-9_.:-]/gi, "").slice(0, 80) || fresh.lastCommandSource,
    controllerConnected: display.controllerConnected === true,
    controllerLastSeenAt: safeIso(display.controllerLastSeenAt),
    controllerDeviceId: String(display.controllerDeviceId || "").replace(/[^a-z0-9_.:-]/gi, "").slice(0, 120),
    controllerStatus: String(display.controllerStatus || fresh.controllerStatus).replace(/[^a-z0-9_.:-]/gi, "").slice(0, 80) || fresh.controllerStatus,
    commandVersion: Number.isFinite(commandVersion) ? Math.max(0, Math.floor(commandVersion)) : fresh.commandVersion,
    config,
    pairing: normalizeDisplayPairing(display.pairing),
    trustedControllers: normalizeTrustedDisplayControllers(display.trustedControllers),
    updatedAt: safeIso(display.updatedAt) || fresh.updatedAt,
  };
}

function displayControllerConnected(display) {
  const seenAt = Date.parse(display.controllerLastSeenAt || "");
  return Boolean(display.controllerConnected && Number.isFinite(seenAt) && Date.now() - seenAt <= DISPLAY_CONTROLLER_STALE_MS);
}

function publicDisplayPairing(display = {}) {
  const pairing = normalizeDisplayPairing(display.pairing);
  if (!pairing) return null;
  const expiresAt = Date.parse(pairing.expiresAt || "");
  if (pairing.status !== "pending" || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return {
    deviceId: pairing.deviceId,
    label: pairing.label,
    code: pairing.code,
    status: pairing.status,
    requestedAt: pairing.requestedAt,
    expiresAt: pairing.expiresAt,
  };
}

function displayControllerTrust(display = {}, payload = {}) {
  const deviceId = displayDeviceId(payload.deviceId);
  const token = String(payload.deviceToken || payload.token || "").trim();
  if (!deviceId || !token) return { trusted: false, deviceId, controller: null };
  const tokenHash = displayTokenHash(token);
  const controller = listFrom(display.trustedControllers).find((item) => item.deviceId === deviceId && item.tokenHash === tokenHash) || null;
  return { trusted: Boolean(controller), deviceId, controller };
}

function displayPairingCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function publicDisplayState(state = {}) {
  const display = normalizeDisplayState(state.display || {});
  const activePairing = publicDisplayPairing(display);
  return {
    view: display.view,
    connected: true,
    lastCommandAt: display.lastCommandAt,
    lastCommandSource: display.lastCommandSource,
    controllerConnected: displayControllerConnected(display),
    controllerLastSeenAt: display.controllerLastSeenAt,
    controllerDeviceId: display.controllerDeviceId,
    controllerStatus: display.controllerStatus,
    controllerStaleAfterMs: DISPLAY_CONTROLLER_STALE_MS,
    commandVersion: display.commandVersion,
    config: display.config,
    pairing: activePairing,
    trustedControllerCount: display.trustedControllers.length,
    allowedViews: DISPLAY_VIEW_ORDER,
    updatedAt: display.updatedAt,
    hub: {
      status: "online",
      appMode: APP_MODE,
      host: HOST,
      port: PORT,
      updatedAt: state.meta?.updatedAt || null,
      serverTime: now(),
    },
  };
}

function loadLocalEnvFiles(rootDir) {
  const appDataEnv = path.join(process.env.HOME || "", "Library", "Application Support", "Argentum OS", ".env");
  const projectEnvFiles = process.env.ARGENTUM_SKIP_PROJECT_ENV === "true"
    ? []
    : [path.join(rootDir, ".env"), path.join(rootDir, ".env.local")];
  const candidates = [
    ...projectEnvFiles,
    appDataEnv,
  ];
  for (const filePath of candidates) {
    if (!filePath || !fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = parseEnvValue(rawValue);
    }
  }
}

function parseEnvValue(value) {
  let text = String(value || "").trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1);
  }
  return text.replaceAll("\\n", "\n");
}

function boundedDurationMs(value, fallback, max) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (APP_MODE === "local" && !localDatabaseStatus) {
    localDatabaseStatus = localDatabase.initializeLocalDatabase(DATA_DIR);
  }
}

function readPersistentSessionSecret() {
  ensureDataDir();
  try {
    if (fs.existsSync(SESSION_SECRET_FILE)) {
      const stored = JSON.parse(fs.readFileSync(SESSION_SECRET_FILE, "utf8"));
      if (typeof stored.secret === "string" && stored.secret.length >= 64) {
        return stored.secret;
      }
    }
  } catch {
    // Replace unreadable local session secrets so the server can keep running.
  }

  const secret = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(
    SESSION_SECRET_FILE,
    JSON.stringify(
      {
        version: 1,
        createdAt: now(),
        secret,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  try {
    fs.chmodSync(SESSION_SECRET_FILE, 0o600);
  } catch {
    // Best effort on filesystems that do not support POSIX modes.
  }
  return secret;
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function userId() {
  return `user-${crypto.randomUUID()}`;
}

function hashPassword(password, salt = crypto.randomBytes(18).toString("base64url")) {
  const passwordHash = crypto.pbkdf2Sync(String(password), salt, PASSWORD_ITERATIONS, 32, "sha256").toString("base64url");
  return {
    algorithm: "pbkdf2-sha256",
    iterations: PASSWORD_ITERATIONS,
    salt,
    passwordHash,
  };
}

function createUserRecord(username, password, options = {}) {
  const normalizedUsername = normalizeUsername(username);
  return {
    id: userId(),
    username: normalizedUsername,
    role: "admin",
    disabled: false,
    temporary: Boolean(options.temporary),
    createdAt: now(),
    updatedAt: now(),
    lastLoginAt: null,
    ...hashPassword(password),
  };
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    disabled: Boolean(user.disabled),
    temporary: Boolean(user.temporary),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
  };
}

function emptyAuthStore() {
  return {
    version: 1,
    createdAt: now(),
    updatedAt: now(),
    users: [],
  };
}

function seededAuthStoreFromEnv() {
  if (!ENV_ADMIN_USERNAME && !ENV_ADMIN_PASSWORD) return null;
  if (!ENV_ADMIN_USERNAME || !ENV_ADMIN_PASSWORD) {
    throw new Error("Set both ADMIN_USERNAME and ADMIN_PASSWORD, or unset both and use first-run setup.");
  }
  const username = validateUsername(ENV_ADMIN_USERNAME);
  const password = validateNewPassword(ENV_ADMIN_PASSWORD);
  if (username === LEGACY_DEFAULT_USERNAME && password === LEGACY_DEFAULT_PASSWORD) {
    throw new Error("Refusing to seed the legacy admin/password account. Choose a unique admin login.");
  }
  return {
    ...emptyAuthStore(),
    users: [createUserRecord(username, password, { temporary: false })],
  };
}

function matchesStoredPassword(password, user) {
  if (!user?.salt || !user?.passwordHash) return false;
  const computed = hashPassword(password, user.salt);
  return constantTimeEqual(computed.passwordHash, user.passwordHash);
}

function isLegacyDefaultUser(user) {
  return (
    normalizeUsername(user?.username) === LEGACY_DEFAULT_USERNAME &&
    Boolean(user?.temporary) &&
    matchesStoredPassword(LEGACY_DEFAULT_PASSWORD, user)
  );
}

function migrateAuthStore(store) {
  let changed = false;
  const users = Array.isArray(store.users) ? store.users : [];
  const filteredUsers = users.filter((user) => {
    if (!isLegacyDefaultUser(user)) return true;
    changed = true;
    return false;
  });
  const migratedStore = {
    version: store.version || 1,
    createdAt: store.createdAt || now(),
    updatedAt: store.updatedAt || now(),
    users: filteredUsers,
  };
  return { store: migratedStore, changed };
}

function readAuthStore() {
  ensureDataDir();
  if (!fs.existsSync(AUTH_FILE)) {
    const seeded = seededAuthStoreFromEnv();
    const store = seeded || emptyAuthStore();
    writeAuthStore(store);
    return store;
  }

  try {
    const { store, changed } = migrateAuthStore(JSON.parse(fs.readFileSync(AUTH_FILE, "utf8")));
    if (changed) {
      writeAuthStore(store);
    }
    return store;
  } catch (error) {
    throw new Error(`Unable to read auth store securely: ${error.message}`);
  }
}

function writeAuthStore(store) {
  ensureDataDir();
  store.updatedAt = now();
  fs.writeFileSync(AUTH_FILE, JSON.stringify(store, null, 2));
}

function findAuthUser(store, username) {
  const normalizedUsername = normalizeUsername(username);
  return store.users.find((user) => normalizeUsername(user.username) === normalizedUsername);
}

function findAuthUserById(store, id) {
  return store.users.find((user) => user.id === id);
}

function verifyPassword(password, user) {
  if (!user || user.disabled) return false;
  return matchesStoredPassword(password, user);
}

function validateUsername(username) {
  const normalizedUsername = normalizeUsername(username);
  if (!/^[a-z0-9._-]{3,32}$/.test(normalizedUsername)) {
    throw guardedError("Use 3-32 characters: letters, numbers, dots, underscores, or hyphens.", 400);
  }
  return normalizedUsername;
}

function validateNewPassword(password) {
  const value = String(password || "");
  if (value.length < 12) {
    throw guardedError("Use a password with at least 12 characters.", 400);
  }
  if (!/[a-z]/i.test(value) || !/[0-9]/.test(value)) {
    throw guardedError("Use a password with letters and numbers.", 400);
  }
  return value;
}

function sanitizedAccessState(currentUser) {
  const store = readAuthStore();
  return {
    currentUser: publicUser(currentUser),
    users: store.users.map(publicUser),
    temporaryAdminPresent: store.users.some((user) => user.temporary && !user.disabled),
  };
}

function constantTimeEqual(left, right) {
  const leftValue = String(left);
  const rightValue = String(right);
  const leftHash = crypto.createHash("sha256").update(leftValue).digest();
  const rightHash = crypto.createHash("sha256").update(rightValue).digest();
  return crypto.timingSafeEqual(leftHash, rightHash) && leftValue.length === rightValue.length;
}

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(valueParts.join("="));
    } catch {
      cookies[key] = "";
    }
  }
  return cookies;
}

function isSecureRequest(req) {
  return req.socket.encrypted || req.headers["x-forwarded-proto"] === "https";
}

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifySession(token) {
  if (!token || !token.includes(".")) return null;
  const [body, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  if (!constantTimeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.exp < Date.now()) return null;
    const store = readAuthStore();
    const user = payload.uid ? findAuthUserById(store, payload.uid) : findAuthUser(store, payload.user);
    if (!user || user.disabled) return null;
    return {
      ...payload,
      user: user.username,
      uid: user.id,
      role: user.role,
    };
  } catch {
    return null;
  }
}

function currentSession(req) {
  return verifySession(parseCookies(req).argentum_session);
}

function sessionCookie(req, token, maxAgeMs = SESSION_TTL_MS) {
  const parts = [
    `argentum_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (isSecureRequest(req)) parts.push("Secure");
  return parts.join("; ");
}

function clearSessionCookie(req) {
  const parts = [
    "argentum_session=",
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
  ];
  if (isSecureRequest(req)) parts.push("Secure");
  return parts.join("; ");
}

function clientKey(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "local").split(",")[0].trim();
}

function getLoginBucket(req) {
  const key = clientKey(req);
  const bucket = loginAttempts.get(key);
  if (bucket && bucket.resetAt > Date.now()) return bucket;
  const nextBucket = { count: 0, resetAt: Date.now() + LOGIN_WINDOW_MS };
  loginAttempts.set(key, nextBucket);
  return nextBucket;
}

function isLoginLimited(req) {
  return getLoginBucket(req).count >= LOGIN_MAX_ATTEMPTS;
}

function recordLoginFailure(req) {
  const bucket = getLoginBucket(req);
  bucket.count += 1;
  bucket.resetAt = Date.now() + LOGIN_WINDOW_MS;
}

function clearLoginFailures(req) {
  loginAttempts.delete(clientKey(req));
}

function securityHeaders(req) {
  const connectSrc = isSecureRequest(req) ? "https:" : "'self'";
  const headers = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "cross-origin-opener-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "referrer-policy": "same-origin",
    "content-security-policy": `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://static-cdn.jtvnw.net https://images.kick.com; connect-src ${connectSrc}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
  };
  if (isSecureRequest(req)) {
    headers["strict-transport-security"] = "max-age=15552000; includeSubDomains";
  }
  return headers;
}

function redirect(res, location, req) {
  res.writeHead(302, {
    ...securityHeaders(req),
    location,
    "cache-control": "no-store",
  });
  res.end();
}

function assertTrustedOrigin(req) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return;
  const origin = req.headers.origin;
  if (!origin) return;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (!host) {
    throw guardedError("Request origin could not be verified.", 403);
  }
  const protocol = isSecureRequest(req) ? "https" : "http";
  if (origin !== `${protocol}://${host}`) {
    throw guardedError("Cross-origin request blocked.", 403);
  }
}

function credentialPage({ title, eyebrow, copy, action, fields, buttonLabel, note, errorMessage = "" }) {
  const message = errorMessage ? `<p class="error">${escapeHtml(errorMessage)}</p>` : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Argentum Admin Access</title>
    <style>
      :root {
        color-scheme: dark;
        --ink: #f5f7fa;
        --muted: #9ca3af;
        --line: rgba(255,255,255,.12);
        --panel: rgba(255,255,255,.06);
        --blue: #7dd3fc;
        --violet: #a78bfa;
        --red: #fca5a5;
      }
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: 28px;
        color: var(--ink);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at 72% 18%, rgba(167,139,250,.18), transparent 34%),
          radial-gradient(circle at 24% 28%, rgba(125,211,252,.12), transparent 34%),
          linear-gradient(135deg, #030507 0%, #070a0f 48%, #0b0f17 100%);
      }
      body::before {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        background:
          radial-gradient(circle at 14% 18%, rgba(255,255,255,.26) 0 1px, transparent 1.5px),
          radial-gradient(circle at 72% 30%, rgba(199,210,254,.22) 0 1px, transparent 1.5px),
          radial-gradient(circle at 46% 76%, rgba(125,211,252,.18) 0 1px, transparent 1.5px);
        background-size: 260px 220px, 340px 280px, 430px 360px;
      }
      .login-panel {
        position: relative;
        z-index: 1;
        width: min(440px, 100%);
        padding: 28px;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: linear-gradient(180deg, rgba(255,255,255,.075), rgba(255,255,255,.035));
        box-shadow: 0 28px 90px rgba(0,0,0,.58), inset 0 1px 0 rgba(255,255,255,.08);
        backdrop-filter: blur(18px);
      }
      .mark {
        display: grid;
        place-items: center;
        width: 48px;
        height: 48px;
        margin-bottom: 18px;
        border: 1px solid rgba(125,211,252,.32);
        border-radius: 8px;
        color: var(--blue);
        font-weight: 900;
        background: rgba(255,255,255,.05);
      }
      .eyebrow {
        margin: 0 0 8px;
        color: var(--muted);
        font-size: .72rem;
        font-weight: 850;
        text-transform: uppercase;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 1.6rem;
      }
      .copy {
        margin: 0 0 22px;
        color: var(--muted);
        line-height: 1.5;
      }
      label {
        display: grid;
        gap: 8px;
        margin-top: 14px;
        color: #cbd5e1;
        font-size: .86rem;
        font-weight: 700;
      }
      input {
        width: 100%;
        min-height: 46px;
        padding: 0 13px;
        border: 1px solid var(--line);
        border-radius: 8px;
        color: var(--ink);
        background: rgba(3,5,7,.74);
        outline: none;
      }
      input:focus {
        border-color: rgba(125,211,252,.46);
        box-shadow: 0 0 0 4px rgba(125,211,252,.08);
      }
      button {
        width: 100%;
        min-height: 48px;
        margin-top: 20px;
        border: 1px solid rgba(125,211,252,.3);
        border-radius: 8px;
        color: #071018;
        font-weight: 850;
        background: linear-gradient(135deg, var(--blue), #c7d2fe);
        cursor: pointer;
      }
      .error {
        padding: 10px 12px;
        border: 1px solid rgba(252,165,165,.3);
        border-radius: 8px;
        color: var(--red);
        background: rgba(127,29,29,.22);
      }
      .remember-row {
        display: grid;
        grid-template-columns: 18px minmax(0, 1fr);
        align-items: center;
        gap: 10px;
        margin-top: 16px;
        color: #dbeafe;
        font-size: .82rem;
        font-weight: 750;
      }
      .remember-row input {
        width: 18px;
        min-height: 18px;
        padding: 0;
        accent-color: #7dd3fc;
      }
      .remember-row span {
        color: var(--muted);
        font-size: .76rem;
        font-weight: 650;
      }
      .note {
        margin: 16px 0 0;
        color: var(--muted);
        font-size: .78rem;
        line-height: 1.45;
      }
    </style>
  </head>
  <body>
    <form class="login-panel" method="post" action="${action}" autocomplete="on">
      <div class="mark">Ag</div>
      <p class="eyebrow">${escapeHtml(eyebrow)}</p>
      <h1>${escapeHtml(title)}</h1>
      <p class="copy">${escapeHtml(copy)}</p>
      ${message}
      ${fields}
      <button type="submit">${escapeHtml(buttonLabel)}</button>
      <p class="note">${escapeHtml(note)}</p>
    </form>
  </body>
</html>`;
}

function loginPage(errorMessage = "") {
  return credentialPage({
    title: "Admin Access",
    eyebrow: "Argentum OS secure entry",
    copy: "Authenticate before opening the command habitat.",
    action: "/login",
    fields: `
      <label>
        Username
        <input name="username" autocomplete="username" required autofocus />
      </label>
      <label>
        Password
        <input name="password" type="password" autocomplete="current-password" required />
      </label>
      <label class="remember-row">
        <input name="remember" type="checkbox" value="on" autocomplete="off" />
        <span>Remember this device for ${rememberSessionLabel()}</span>
      </label>
    `,
    buttonLabel: "Enter Argentum",
    note: "Argentum does not store your password. Use the checkbox only on a device you control.",
    errorMessage,
  });
}

function setupPage(errorMessage = "") {
  return credentialPage({
    title: "Create Admin Login",
    eyebrow: "Argentum OS first-run setup",
    copy: "Create the owner login before Argentum opens the console.",
    action: APP_MODE === "cloud" ? "/setup" : "/",
    fields: `
      <label>
        Username
        <input name="username" autocomplete="username" pattern="[A-Za-z0-9._-]{3,32}" required autofocus />
      </label>
      <label>
        Password
        <input name="password" type="password" autocomplete="new-password" minlength="12" required />
      </label>
      <label class="remember-row">
        <input name="savePassword" type="checkbox" value="on" autocomplete="off" />
        <span>Save this login on this device</span>
      </label>
    `,
    buttonLabel: "Create Admin",
    note: "Your browser can save/autofill the password; Argentum only keeps a signed device session.",
    errorMessage,
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function defaultState() {
  return {
    meta: {
      name: "Argentum",
      version: "0.1.0",
      mode: "local_supervised",
      updatedAt: now(),
    },
    agent: {
      id: "agent-001-depo",
      name: "Agent 101",
      role: "Supervised Founder Operator",
      state: "active_supervised",
      spendLimit: "$5/day sandbox",
      externalActions: "Draft only",
      memoryAccess: "Working + verified shared",
    },
    agent101: {
      id: "agent-101",
      name: "Agent 101",
      role: "Master Agent",
      mode: "Autonomous internal work / Human Gate external actions",
      status: "Active supervised",
      currentOffice: "Clips Office",
      approvalRequired: true,
      externalActions: "Locked",
    },
    display: defaultDisplayState(),
    stockOffice: {
      workspaceId: STOCK_WORKSPACE_ID,
      lastLocalSyncAt: null,
      selectedTicker: "",
      chatMessages: [],
      syncRuns: [],
      assistantRuns: [],
      tradeDrafts: [],
      proposalDecisions: [],
    },
    toolConnections: {
      openai: { status: "local_demo", mode: "Local Demo", model: ENV_AI_MODEL || ENV_OPENAI_MODEL || "gpt-5.4-nano", lastTest: null },
      browser: {
        status: "restricted",
        allowedDomains: ["capcut.com", "tiktok.com", "instagram.com", "youtube.com", "drive.google.com"],
        blockedDomains: ["payment settings", "ad spend", "account credentials"],
        approvalRequired: true,
      },
      capcut: { status: "manual_handoff", mode: "manual_handoff", handoffUrl: process.env.CAPCUT_HANDOFF_URL || "" },
      tiktok: { status: "not_connected", mode: "draft_package", accountHandle: "", lastSync: null },
      instagram: { status: "not_connected" },
      youtube: { status: "not_connected" },
      storage: {
        status: "ready",
        localProjectFiles: true,
        googleDrive: "not_connected",
        fileTypes: ["raw_footage", "audio", "scripts", "exports", "thumbnails", "captions", "posting_package"],
      },
    },
    governance: {
      killSwitch: false,
      cycleCount: 0,
      cycleLimit: 12,
      taskRunCount: 0,
      functionRunCount: 0,
      estimatedSpendUsd: 0,
      dailySpendLimitUsd: 5,
      highRiskActionsRequireApproval: true,
      blockedActions: [
        "move money",
        "place trades",
        "publish external claims",
        "create external accounts",
        "contact customers",
        "deploy new agents",
        "modify core systems"
      ],
    },
    mission: {
      activeWorkflowId: "workflow-clips-office",
      currentStep: 0,
      paused: false,
      steps: [
        {
          station: "Research",
          x: "18%",
          y: "44%",
          progress: 28,
          confidence: 72,
          title: "Set up the Clips Office workflow",
          copy: "Agent 101 is preparing clipping account setup checklists, manual handoff steps, and safe content-package flow.",
          risk: "Low",
        },
        {
          station: "Verify",
          x: "78%",
          y: "44%",
          progress: 51,
          confidence: 82,
          title: "Check platform and account risk",
          copy: "Agent 101 is separating safe draft work from login, posting, account, API key, and payment actions that require Human Gate.",
          risk: "Medium",
        },
        {
          station: "Draft",
          x: "21%",
          y: "70%",
          progress: 74,
          confidence: 88,
          title: "Draft the first clips package",
          copy: "Agent 101 is drafting hooks, captions, CapCut handoff notes, file checklist, and posting-package structure.",
          risk: "Low",
        },
        {
          station: "Approval",
          x: "77%",
          y: "70%",
          progress: 92,
          confidence: 91,
          title: "Package risky steps for the operator",
          copy: "Agent 101 is bundling any login, posting, connector, or account setup decision for Human Gate review.",
          risk: "Approval required",
        }
      ],
    },
    capabilities: [
      {
        id: "cap-clips-package-builder",
        name: "Clips package builder",
        status: "Draft ready",
        description: "Creates hooks, clip structures, captions, CapCut handoff notes, and posting packages for approval.",
      },
      {
        id: "cap-connector-setup-planner",
        name: "Connector setup planner",
        status: "Manual handoff",
        description: "Prepares Twitch, TikTok, YouTube, CapCut, and Drive setup checklists without logging in or creating keys.",
      },
      {
        id: "cap-agent-manifest-drafter",
        name: "Agent manifest drafter",
        status: "Proposal only",
        description: "Drafts future agent prompts, permissions, evals, and budgets for human review.",
      },
      {
        id: "cap-memory-curator",
        name: "Memory curator",
        status: "Active",
        description: "Turns useful observations into structured memory after provenance and freshness checks.",
      }
    ],
    functions: [
      {
        id: "func-clips-package-v1",
        name: "Clips package v1",
        workflowId: "workflow-clips-office",
        status: "seeded",
        risk: "medium",
        ownerAgentId: "agent-001-depo",
        description: "Reusable draft-only process for turning one raw video idea into a clipping package for Human Gate review.",
        inputs: ["raw video notes", "platform target", "brand context"],
        outputs: ["clip plan", "CapCut handoff", "caption package", "approval package"],
        blockedActions: ["publish video", "log into accounts", "create API keys", "change account settings", "spend money"],
        createdAt: now(),
      }
    ],
    workflows: [
      {
        id: "workflow-clips-office",
        name: "Clips Office",
        type: "content_lane",
        status: "active_draft",
        risk: "medium",
        description: "Plan short-form clips, prepare CapCut handoff instructions, draft posting packages, and route publishing through Human Gate.",
        nextFunction: "Create a clip brief, CapCut edit plan, captions, and approval package without posting.",
      },
      {
        id: "workflow-pod-lab",
        name: "Print-on-demand lab",
        type: "business_lane",
        status: "active_draft",
        risk: "low",
        description: "Find niches, draft listings, estimate demand, and send publishing actions to approval.",
        nextFunction: "Generate a reusable listing research brief from evidence and assumptions.",
      },
      {
        id: "workflow-stock-watch",
        name: "Stock algorithm watch",
        type: "monitoring_lane",
        status: "read_only",
        risk: "high",
        description: "Monitor signals and produce notes only. Trading remains blocked without approval.",
        nextFunction: "Create paper-trading notes without broker access or live execution.",
      },
      {
        id: "workflow-agent-factory",
        name: "Agent factory",
        type: "governance_lane",
        status: "proposal_only",
        risk: "medium",
        description: "Draft new agent manifests, tests, budgets, and permissions as proposals.",
        nextFunction: "Propose a second agent only after Agent 101's first workflow is approved.",
      }
    ],
    taskTemplates: [
      {
        id: "tpl-clips-video-package",
        name: "Clips video package",
        workflowId: "workflow-clips-office",
        risk: "medium",
        prompt: "Create 3 short clips from raw footage, prepare edits in CapCut, write captions, prepare TikTok posting drafts, and package everything for Human Gate approval. Do not post or change accounts.",
        outcome: "Clip brief + CapCut handoff + posting package",
      },
      {
        id: "tpl-clips-setup-checklist",
        name: "Clipping setup checklist",
        workflowId: "workflow-clips-office",
        risk: "medium",
        prompt: "Prepare the manual setup checklist for Twitch, TikTok, YouTube, CapCut, and file handoff. Do not log in, create API keys, connect accounts, or publish.",
        outcome: "Connector setup checklist",
      },
      {
        id: "tpl-capcut-handoff",
        name: "CapCut handoff",
        workflowId: "workflow-clips-office",
        risk: "medium",
        prompt: "Draft a CapCut edit handoff for one short-form video: hook, cut list, caption beats, audio notes, export settings, and Human Gate posting approval.",
        outcome: "CapCut handoff artifact",
      },
      {
        id: "tpl-agent-function-proposal",
        name: "Function proposal",
        workflowId: "workflow-agent-factory",
        risk: "medium",
        prompt: "Draft a proposal for a future Argentum function with manifest, permissions, budget, evals, and approval gates. Do not deploy it.",
        outcome: "Future-function proposal",
      }
    ],
    tasks: [],
    artifacts: [],
    executions: [],
    approvals: [],
    memory: {
      working: [
        {
          id: "mem-working-current-task",
          title: "Current task",
          body: "Build Clips Office v1 so Agent 101 can prepare clip plans, CapCut handoffs, captions, and approval packages in draft-only mode.",
          provenance: "operator_goal",
          updatedAt: now(),
        },
        {
          id: "mem-working-clips-inputs",
          title: "Open question",
          body: "Operator still needs to choose the first raw video or stream highlight for the initial Clips Office package.",
          provenance: "operator_goal",
          updatedAt: now(),
        }
      ],
      shared: [
        {
          id: "mem-shared-operating-rule",
          title: "Operating rule",
          body: "External publishing, trades, account creation, customer contact, and new agent deployment require human approval.",
          provenance: "safety_policy",
          updatedAt: now(),
        },
        {
          id: "mem-shared-mvp-architecture",
          title: "MVP architecture",
          body: "Start with one visible agent, a small task loop, memory layers, approval queue, and audit trail.",
          provenance: "architecture_prompt",
          updatedAt: now(),
        }
      ],
      agent: [
        {
          id: "mem-agent-depo-identity",
          title: "Agent 101 identity",
          body: "Agent 101 is the draft-only operator: gather, verify, draft, and package work for approval.",
          provenance: "agent_manifest",
          updatedAt: now(),
        },
        {
          id: "mem-agent-failure-habit",
          title: "Failure habit",
          body: "When evidence is stale, contradictory, or missing, Agent 101 must ask for review instead of inventing certainty.",
          provenance: "safety_policy",
          updatedAt: now(),
        }
      ],
    },
    chatMessages: [],
    agent101ChatThreads: [],
    agent101Missions: [],
    agent101EditProposals: [],
    agent101StudioLayout: {
      panels: ["mission", "knowledge", "tools", "files", "approvals", "conversation"],
      density: "comfortable",
      accent: "blue",
      updatedBy: "system",
      updatedAt: now(),
    },
    audit: [
      {
        id: "audit-system-created",
        title: "Argentum local state created",
        body: "Agent 101 was initialized as the first supervised agent with approval-gated business workflows.",
        createdAt: now(),
      }
    ],
  };
}

function ensureState() {
  ensureDataDir();
  if (!fs.existsSync(STATE_FILE)) {
    writeState(defaultState());
  }
}

function normalizeState(state) {
  const fresh = defaultState();
  state.meta = { ...fresh.meta, ...state.meta };
  state.agent = { ...fresh.agent, ...state.agent };
  state.agent101 = { ...fresh.agent101, ...state.agent101 };
  state.display = normalizeDisplayState(state.display || fresh.display);
  state.stockOffice = normalizeStockOfficeState(state.stockOffice || fresh.stockOffice);
  state.toolConnections = {
    ...fresh.toolConnections,
    ...(state.toolConnections || {}),
  };
  if (state.agent?.id === "agent-001-depo") {
    state.agent.name = "Agent 101";
    state.agent.role = "Supervised Founder Operator";
  }
  state.governance = { ...fresh.governance, ...state.governance };
  state.mission = { ...fresh.mission, ...state.mission };
  const retiredCapabilityIds = new Set(["cap-pod-niche-scout", "cap-market-signal-notebook"]);
  const retiredFunctionIds = new Set(["func-pod-research-brief"]);
  const retiredTemplateIds = new Set(["tpl-pod-niche-scan", "tpl-pod-listing-outline", "tpl-stock-watch-note"]);
  state.capabilities = mergeById(Array.isArray(state.capabilities) ? state.capabilities : [], fresh.capabilities)
    .filter((capability) => !retiredCapabilityIds.has(capability?.id));
  state.functions = mergeById(Array.isArray(state.functions) ? state.functions : [], fresh.functions)
    .filter((fn) => !retiredFunctionIds.has(fn?.id));
  state.workflows = mergeById(Array.isArray(state.workflows) ? state.workflows : [], fresh.workflows);
  state.taskTemplates = mergeById(Array.isArray(state.taskTemplates) ? state.taskTemplates : [], fresh.taskTemplates)
    .filter((template) => !retiredTemplateIds.has(template?.id));
  state.tasks = Array.isArray(state.tasks) ? state.tasks : fresh.tasks;
  state.tasks = state.tasks.filter((task) => task?.id !== "task-seed-pod-niche-brief");
  state.artifacts = Array.isArray(state.artifacts) ? state.artifacts : fresh.artifacts;
  state.executions = Array.isArray(state.executions) ? state.executions : fresh.executions;
  state.approvals = Array.isArray(state.approvals) ? state.approvals : fresh.approvals;
  const approvalReadAt = Date.now();
  state.approvals = state.approvals
    .filter((approval) => !["approval-pod-lane-v0", "approval-stock-readonly-v0"].includes(approval?.id))
    .map((approval) => {
      const expiresAt = Date.parse(approval?.expiresAt || "");
      if (approval?.status !== "pending" || !Number.isFinite(expiresAt) || expiresAt > approvalReadAt) return approval;
      return {
        ...approval,
        status: "expired",
        expiredAt: approval.expiresAt,
        resolvedAt: approval.resolvedAt || approval.expiresAt,
      };
    });
  state.chatMessages = normalizeChatMessages(Array.isArray(state.chatMessages) ? state.chatMessages : fresh.chatMessages);
  state.agent101ChatThreads = normalizeAgent101ChatThreads(state.agent101ChatThreads, state.chatMessages);
  agent101MissionManager.normalizeMissionState(state);
  agent101ProjectWorkspace.normalizeProposalState(state);
  state.agent101StudioLayout = {
    ...fresh.agent101StudioLayout,
    ...(state.agent101StudioLayout || {}),
  };
  state.memory = {
    working: mergeById(normalizeMemoryEntries(state.memory?.working || []), fresh.memory.working),
    shared: mergeById(normalizeMemoryEntries(state.memory?.shared || []), fresh.memory.shared),
    agent: mergeById(normalizeMemoryEntries(state.memory?.agent || []), fresh.memory.agent),
  };
  state.audit = Array.isArray(state.audit) ? state.audit : fresh.audit;
  return agent101Os.normalizeAgent101OperatingState(state);
}

function normalizeMemoryEntries(entries = []) {
  const legacyPhrases = ["etsy print-on-demand", "pod research lane", "stock algorithm monitoring"];
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => {
      const searchable = `${entry?.title || ""} ${entry?.body || ""}`.toLowerCase();
      return !legacyPhrases.some((phrase) => searchable.includes(phrase));
    });
}

function normalizeChatMessages(messages = []) {
  const validSpeakers = new Set(["operator", "depo", "agent"]);
  const validRooms = new Set(Object.keys(BUSINESS_OFFICES));
  const legacyDemoPhrases = [
    "approve pod research lane v0",
    "review stock algorithm monitor",
    "pod research lane",
    "pod workflow",
    "etsy store",
    "returned this to etsy",
    "returned this to stock",
    "stock algorithm",
    "stock.",
  ];
  const seen = new Set();
  return messages
    .map((message) => {
      const text = String(message?.text || "").trim().slice(0, 2000);
      if (!text) return null;
      if (legacyDemoPhrases.some((phrase) => text.toLowerCase().includes(phrase))) return null;
      const rawRoom = String(message?.roomId || "depo-habitat").trim();
      const roomId = validRooms.has(rawRoom) ? rawRoom : "depo-habitat";
      const speaker = validSpeakers.has(message?.speaker) ? message.speaker : "depo";
      const createdAt = message?.createdAt && !Number.isNaN(Date.parse(message.createdAt)) ? message.createdAt : now();
      const id = String(message?.id || `chat-${createdAt}-${roomId}-${speaker}-${crypto.randomBytes(4).toString("hex")}`);
      if (seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        roomId,
        speaker,
        text,
        prompt: message?.prompt ? String(message.prompt).slice(0, 120) : undefined,
        source: message?.source ? String(message.source).slice(0, 120) : undefined,
        createdAt,
      };
    })
    .filter(Boolean)
    .slice(-240);
}

function appendChatMessages(payload = {}) {
  const state = readState();
  const incoming = normalizeChatMessages(Array.isArray(payload.messages) ? payload.messages : [payload]);
  if (!incoming.length) throw guardedError("Chat message text is required.", 400);
  const combined = normalizeChatMessages([...(state.chatMessages || []), ...incoming]);
  state.chatMessages = combined.slice(-240);
  state.agent101ChatThreads = normalizeAgent101ChatThreads(state.agent101ChatThreads, state.chatMessages);
  writeState(state);
  return { messages: state.chatMessages };
}

function agentChatId(prefix = "agent_chat") {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function chatTitleFromMessage(content = "") {
  const text = String(content || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Agent 101 Session";
  const lower = text.toLowerCase();
  if (lower.includes("practice") || lower.includes("demo") || lower.includes("clip candidates")) return "Find 5 practice streams";
  if (lower.includes("capcut")) return "CapCut handoff setup";
  if (lower.includes("posting") || lower.includes("human gate")) return "Posting draft review";
  if (lower.includes("what can you do") || lower.includes("blocked")) return "Agent permissions question";
  const words = text.split(" ").slice(0, 5).join(" ");
  return words.length > 42 ? `${words.slice(0, 39).trim()}...` : words;
}

function chatPreview(content = "") {
  const text = String(content || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 94 ? `${text.slice(0, 91).trim()}...` : text;
}

function normalizeAgent101ChatMessage(message = {}, threadId = "", fallbackRoom = "depo-habitat") {
  const rawContent = message.content ?? message.text ?? "";
  const content = String(rawContent || "").trim().slice(0, 6000);
  if (!content) return null;
  const validRoles = new Set(["user", "agent", "system", "tool", "approval", "artifact"]);
  const roleFromSpeaker = message.speaker === "operator" ? "user" : message.speaker === "depo" || message.speaker === "agent" ? "agent" : "";
  const role = validRoles.has(message.role) ? message.role : roleFromSpeaker || "agent";
  const validStatuses = new Set(["queued", "sending", "sent", "thinking", "running", "verifying", "recovering", "paused", "waiting_approval", "complete", "failed", "cancelled", "blocked", "needs_revision", "error"]);
  const rawRoom = String(message.roomId || message.metadata?.roomId || fallbackRoom || "depo-habitat").trim();
  const roomId = BUSINESS_OFFICES[rawRoom] ? rawRoom : "depo-habitat";
  const createdAt = message.createdAt && !Number.isNaN(Date.parse(message.createdAt)) ? message.createdAt : now();
  const updatedAt = message.updatedAt && !Number.isNaN(Date.parse(message.updatedAt)) ? message.updatedAt : createdAt;
  const sequence = Number.isFinite(Number(message.sequence)) ? Number(message.sequence) : 0;
  return {
    id: String(message.id || agentChatId("msg")),
    threadId: String(message.threadId || threadId || ""),
    sequence,
    role,
    content,
    createdAt,
    updatedAt,
    status: validStatuses.has(message.status) ? message.status : role === "tool" ? "complete" : "sent",
    metadata: {
      ...(message.metadata && typeof message.metadata === "object" ? message.metadata : {}),
      roomId,
    },
  };
}

function seedThreadFromFlatMessages(roomId, flatMessages = []) {
  const messages = normalizeChatMessages(flatMessages)
    .filter((message) => message.roomId === roomId)
    .map((message) =>
      normalizeAgent101ChatMessage(
        {
          id: message.id,
          role: message.speaker === "operator" ? "user" : "agent",
          content: message.text,
          createdAt: message.createdAt,
          metadata: { roomId: message.roomId, source: message.source },
        },
        "",
        roomId,
      ),
    )
    .filter(Boolean);
  return {
    id: agentChatId("thread"),
    title: messages.find((message) => message.role === "user") ? chatTitleFromMessage(messages.find((message) => message.role === "user").content) : "Agent 101 Session",
    agentId: "agent-101",
    roomId,
    createdAt: messages[0]?.createdAt || now(),
    updatedAt: messages.at(-1)?.createdAt || now(),
    lastMessage: chatPreview(messages.at(-1)?.content || "Ready for supervised work."),
    archived: false,
    threadSummary: {
      threadId: "",
      summary: "Agent 101 supervised office chat.",
      updatedAt: now(),
    },
    messages: messages.map((message) => ({ ...message, threadId: "" })),
  };
}

function defaultAgentThread(roomId = "depo-habitat", flatMessages = []) {
  const thread = seedThreadFromFlatMessages(roomId, flatMessages);
  thread.title = roomId === "depo-habitat" ? "Main command thread" : thread.title;
  if (!thread.messages.length) {
    thread.messages.push(
      normalizeAgent101ChatMessage(
        {
          role: "agent",
          content: "AGENT 101 ONLINE\n\nCURRENT STATUS\n• Main command thread is ready.\n• Thread memory, tool steps, approvals, saved outputs, and final reports stay attached here.\n\nKEY FINDINGS\n• Safe internal work can begin immediately.\n• External actions remain Human Gate-gated.\n\nRISKS\n• Vague goals create low-quality execution unless converted into a task contract.\n\nRECOMMENDATIONS\n• Send one operating objective with the target office or outcome.\n\nNEXT ACTIONS\n• Convert the objective into a bounded plan, run, approval package, or operating report.",
          status: "complete",
          metadata: { roomId },
        },
        thread.id,
        roomId,
      ),
    );
  }
  thread.messages = thread.messages.map((message, index) => ({ ...message, threadId: thread.id, sequence: index + 1 }));
  thread.threadSummary.threadId = thread.id;
  thread.updatedAt = thread.messages.at(-1)?.createdAt || thread.updatedAt;
  thread.lastMessage = chatPreview(thread.messages.at(-1)?.content || "");
  thread.lastMessagePreview = thread.lastMessage;
  thread.lastOpenedAt = thread.updatedAt;
  thread.messageCount = thread.messages.length;
  thread.status = "idle";
  thread.version = 1;
  return thread;
}

function normalizeAgent101ChatThread(thread = {}, fallbackRoom = "depo-habitat") {
  const id = String(thread.id || agentChatId("thread"));
  const rawRoom = String(thread.roomId || fallbackRoom || "depo-habitat").trim();
  const roomId = BUSINESS_OFFICES[rawRoom] ? rawRoom : "depo-habitat";
  const seenMessageIds = new Set();
  const seenClientIds = new Set();
  const messages = (Array.isArray(thread.messages) ? thread.messages : [])
    .map((message) => normalizeAgent101ChatMessage(message, id, roomId))
    .filter(Boolean)
    .filter((message) => {
      const clientMessageId = message.metadata?.clientMessageId;
      if (seenMessageIds.has(message.id)) return false;
      if (clientMessageId && seenClientIds.has(clientMessageId)) return false;
      seenMessageIds.add(message.id);
      if (clientMessageId) seenClientIds.add(clientMessageId);
      return true;
    })
    .map((message, index) => ({ ...message, sequence: message.sequence || index + 1 }))
    .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
    .slice(-220)
    .map((message, index) => ({ ...message, sequence: index + 1 }));
  const createdAt = thread.createdAt && !Number.isNaN(Date.parse(thread.createdAt)) ? thread.createdAt : messages[0]?.createdAt || now();
  const updatedAt = thread.updatedAt && !Number.isNaN(Date.parse(thread.updatedAt)) ? thread.updatedAt : messages.at(-1)?.createdAt || createdAt;
  const lastMessage = chatPreview(thread.lastMessagePreview || thread.lastMessage || messages.at(-1)?.content || "Ready for supervised work.");
  const validStatuses = new Set(["idle", "thinking", "running", "verifying", "recovering", "paused", "waiting_approval", "complete", "blocked", "cancelled", "error"]);
  return {
    id,
    title: String(thread.title || chatTitleFromMessage(messages.find((message) => message.role === "user")?.content || "")).slice(0, 80),
    agentId: "agent-101",
    roomId,
    createdAt,
    updatedAt,
    lastOpenedAt: thread.lastOpenedAt && !Number.isNaN(Date.parse(thread.lastOpenedAt)) ? thread.lastOpenedAt : updatedAt,
    lastMessage,
    lastMessagePreview: lastMessage,
    messageCount: Number.isFinite(Number(thread.messageCount)) ? Number(thread.messageCount) : messages.length,
    archived: Boolean(thread.archived),
    activeTaskId: thread.activeTaskId || null,
    activeRunId: thread.activeRunId || null,
    activeApprovalId: thread.activeApprovalId || null,
    status: validStatuses.has(thread.status) ? thread.status : "idle",
    version: Number.isFinite(Number(thread.version)) ? Number(thread.version) : 1,
    threadSummary: {
      threadId: id,
      summary: String(thread.threadSummary?.summary || thread.summary || "Agent 101 supervised office chat.").slice(0, 600),
      updatedAt: thread.threadSummary?.updatedAt || updatedAt,
    },
    messages: messages.map((message) => ({ ...message, threadId: id })),
  };
}

function normalizeAgent101ChatThreads(threads = [], flatMessages = []) {
  const normalized = (Array.isArray(threads) ? threads : [])
    .map((thread) => normalizeAgent101ChatThread(thread))
    .filter(Boolean);
  // Chat threads are the single source of truth. Legacy flat chatMessages are
  // intentionally not re-seeded into threads because that was the source of
  // messages disappearing, then coming back duplicated after reload/approval.
  if (!normalized.length) normalized.push(defaultAgentThread("depo-habitat", []));
  return normalized
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 50);
}

function publicAgent101ChatThreads(state) {
  return (state.agent101ChatThreads || []).map((thread) => ({
    id: thread.id,
    title: thread.title,
    agentId: thread.agentId,
    roomId: thread.roomId,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    lastOpenedAt: thread.lastOpenedAt,
    lastMessage: thread.lastMessagePreview || thread.lastMessage,
    lastMessagePreview: thread.lastMessagePreview || thread.lastMessage,
    archived: Boolean(thread.archived),
    status: thread.status || "idle",
    activeTaskId: thread.activeTaskId || null,
    activeRunId: thread.activeRunId || null,
    activeApprovalId: thread.activeApprovalId || null,
    messageCount: thread.messages?.length || 0,
  }));
}

function findAgent101Thread(state, threadId) {
  return (state.agent101ChatThreads || []).find((thread) => thread.id === threadId);
}

function refreshThreadPreview(thread) {
  const lastMessage = thread.messages?.at(-1);
  thread.updatedAt = lastMessage?.updatedAt || lastMessage?.createdAt || now();
  thread.lastMessage = chatPreview(lastMessage?.content || thread.lastMessage || "");
  thread.lastMessagePreview = thread.lastMessage;
  thread.messageCount = thread.messages?.length || 0;
  thread.version = Number(thread.version || 0) + 1;
  if ((!thread.title || thread.title === "Agent 101 Session") && thread.messages?.some((message) => message.role === "user")) {
    thread.title = chatTitleFromMessage(thread.messages.find((message) => message.role === "user").content);
  }
  const active = (thread.messages || []).slice().reverse().find((message) => ["thinking", "running", "verifying", "recovering", "paused", "waiting_approval"].includes(message.status));
  thread.status = active?.status || (["error", "blocked", "cancelled"].includes(thread.status) ? thread.status : "idle");
  thread.threadSummary = {
    threadId: thread.id,
    summary: `Recent Agent 101 context: ${thread.messages
      .slice(-6)
      .map((message) => `${message.role}: ${chatPreview(message.content)}`)
      .join(" | ")
      .slice(0, 560)}`,
    updatedAt: now(),
  };
  return thread;
}

function appendAgent101ThreadMessages(thread, messages = []) {
  const incoming = (Array.isArray(messages) ? messages : [messages])
    .map((message) => normalizeAgent101ChatMessage(message, thread.id, thread.roomId))
    .filter(Boolean);
  if (!incoming.length) return [];
  const seenIds = new Set();
  const seenClientIds = new Set();
  let nextSequence = Math.max(0, ...(thread.messages || []).map((message) => Number(message.sequence || 0)));
  thread.messages = [...(thread.messages || []), ...incoming]
    .filter((message) => {
      const clientMessageId = message.metadata?.clientMessageId;
      if (seenIds.has(message.id)) return false;
      if (clientMessageId && seenClientIds.has(clientMessageId)) return false;
      seenIds.add(message.id);
      if (clientMessageId) seenClientIds.add(clientMessageId);
      return true;
    })
    .map((message) => {
      if (message.sequence) return message;
      nextSequence += 1;
      return { ...message, sequence: nextSequence, updatedAt: message.updatedAt || now() };
    })
    .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0))
    .slice(-220);
  refreshThreadPreview(thread);
  return incoming;
}

function createAgent101ChatThread(payload = {}) {
  const state = readState();
  const roomId = BUSINESS_OFFICES[payload.roomId] ? payload.roomId : "depo-habitat";
  const thread = normalizeAgent101ChatThread({
    id: agentChatId("thread"),
    title: payload.title || "New Agent 101 chat",
    roomId,
    createdAt: now(),
    updatedAt: now(),
    lastOpenedAt: now(),
    status: "idle",
    messages: [
      {
        role: "agent",
        content: "NEW OPERATING THREAD\n\nCURRENT STATUS\n• Thread opened for Agent 101 operations.\n• Prior decisions and outputs will remain attached to this conversation.\n\nKEY FINDINGS\n• No objective has been assigned in this thread yet.\n\nRISKS\n• External actions remain locked until Human Gate approves exact scope.\n\nRECOMMENDATIONS\n• Start with the business outcome, office, or workflow that needs movement.\n\nNEXT ACTIONS\n• Convert the objective into a task contract, run plan, approval package, or operating report.",
        status: "complete",
        metadata: { roomId },
      },
    ],
  });
  state.agent101ChatThreads.unshift(thread);
  writeState(state);
  return { thread, threads: publicAgent101ChatThreads(state) };
}

function updateAgent101ChatThread(threadId, payload = {}) {
  const state = readState();
  const thread = findAgent101Thread(state, threadId);
  if (!thread) throw guardedError("Chat thread not found.", 404);
  if (payload.title !== undefined) thread.title = String(payload.title || "Agent 101 Session").trim().slice(0, 80);
  if (payload.archived !== undefined) thread.archived = Boolean(payload.archived);
  if (payload.lastOpenedAt !== undefined) thread.lastOpenedAt = payload.lastOpenedAt && !Number.isNaN(Date.parse(payload.lastOpenedAt)) ? payload.lastOpenedAt : now();
  if (payload.status !== undefined && ["idle", "thinking", "running", "verifying", "recovering", "paused", "waiting_approval", "complete", "blocked", "cancelled", "error"].includes(payload.status)) thread.status = payload.status;
  thread.updatedAt = now();
  refreshThreadPreview(thread);
  writeState(state);
  return { thread, threads: publicAgent101ChatThreads(state) };
}

function deleteAgent101ChatThread(threadId) {
  const state = readState();
  const before = state.agent101ChatThreads?.length || 0;
  state.agent101ChatThreads = (state.agent101ChatThreads || []).filter((thread) => thread.id !== threadId);
  if ((state.agent101ChatThreads?.length || 0) === before) throw guardedError("Chat thread not found.", 404);
  writeState(state);
  return { deleted: true, threads: publicAgent101ChatThreads(state) };
}

function appendAgent101ChatThreadMessagesDirect(threadId, payload = {}) {
  const state = readState();
  const thread = findAgent101Thread(state, threadId);
  if (!thread || thread.archived) throw guardedError("Chat thread not found.", 404);
  const messages = Array.isArray(payload.messages) ? payload.messages : [payload.message || payload];
  messages.forEach((message) => {
    const approvalId = message?.metadata?.approvalId;
    if (!approvalId || message?.metadata?.taskType !== "human_gate_decision") return;
    const approvalMessage = (thread.messages || []).find((item) => item.role === "approval" && item.metadata?.approvalId === approvalId);
    if (!approvalMessage) return;
    const content = String(message.content || "").toLowerCase();
    approvalMessage.status = content.includes("blocked") || content.includes("rejected") ? "failed" : "complete";
    approvalMessage.updatedAt = now();
  });
  appendAgent101ThreadMessages(thread, messages);
  writeState(state);
  return { thread, threads: publicAgent101ChatThreads(state) };
}

function shouldTriggerAgentRunner(message = "") {
  const text = String(message || "").toLowerCase();
  const workflowPhrases = [
    "find 5 practice streams",
    "find practice streams",
    "practice streams",
    "safe internal demo workflow",
    "run the safe internal",
    "demo clipping workflow",
    "run the demo",
    "run clipping workflow",
    "make clips",
    "make clip candidates",
    "create candidates",
    "clip candidates",
    "capcut briefs",
    "draft posting packages",
    "package top clips",
    "package the top",
    "go ahead",
    "run it",
    "test the agent",
    "fully automate internally",
  ];
  return workflowPhrases.some((phrase) => text.includes(phrase));
}

function runnerStepTitle(step = {}) {
  const label = String(step.tool || step.name || "tool").replace(/_/g, " ");
  return label.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, (char) => char.toUpperCase());
}

function runToolSummary(step = {}) {
  const details = step.details || {};
  if (Number.isFinite(details.added) || Number.isFinite(details.updated)) {
    return `${details.added || 0} added, ${details.updated || 0} updated.`;
  }
  if (Number.isFinite(details.sessions)) return `${details.sessions} sessions created.`;
  if (Number.isFinite(details.candidates)) return `${details.candidates} clip candidates created.`;
  if (Number.isFinite(details.packages)) return `${details.packages} packages created.`;
  if (Number.isFinite(details.briefs)) return `${details.briefs} CapCut briefs generated.`;
  if (Number.isFinite(details.drafts)) return `${details.drafts} posting drafts created.`;
  if (Number.isFinite(details.approvals)) return `${details.approvals} approval requests sent to Human Gate.`;
  if (Number.isFinite(details.artifacts)) return `${details.artifacts} artifacts saved.`;
  return step.message || `${runnerStepTitle(step)} complete.`;
}

function appendRunMessagesToThread(thread, result = {}) {
  const normalizedSteps = Array.isArray(result.toolResults) && result.toolResults.length
    ? result.toolResults.map((tool) => ({
        tool: tool.toolName,
        status: tool.status,
        message: tool.summary,
        details: {
          artifactIds: tool.artifactIds || [],
          recordIds: tool.recordIds || [],
          approvalIds: tool.approvalIds || [],
        },
      }))
    : (result.steps || []);
  const toolMessages = normalizedSteps
    .filter((step) => step.tool !== "planner")
    .map((step) => ({
      role: "tool",
      content: runToolSummary(step),
      status: step.status === "error" ? "error" : "complete",
      metadata: {
        taskType: "agent_run_step",
        runId: result.runId,
        tool: step.tool,
        stepTitle: runnerStepTitle(step),
        riskLevel: "low",
        roomId: thread.roomId,
      },
    }));
  appendAgent101ThreadMessages(thread, toolMessages);
  const approvalIds = Array.from(
    new Set(
      [
        ...normalizedSteps.flatMap((step) => step.details?.approvalIds || (step.details?.approvalId ? [step.details.approvalId] : [])),
        ...(result.approvals || []).map((approval) => approval.id || approval),
      ]
        .filter(Boolean)
        .flatMap((item) => Array.isArray(item) ? item : [item])
        .filter(Boolean),
    ),
  );
  const approvalActionTypes = new Map(
    (result.approvals || [])
      .filter((approval) => approval?.id)
      .map((approval) => [approval.id, approval.actionType || "external_api_action"]),
  );
  /*
   * Legacy StreamClipper results put approval IDs inside step.details. The
   * operating harness returns first-class approval objects. Support both so old
   * run records still render correctly after reload.
   */
  const legacyApprovalIds = Array.from(
    new Set(
      normalizedSteps
        .flatMap((step) => step.details?.approvalIds || (step.details?.approvalId ? [step.details.approvalId] : []))
        .filter(Boolean),
    ),
  );
  legacyApprovalIds.forEach((approvalId) => {
    if (!approvalIds.includes(approvalId)) approvalIds.push(approvalId);
  });
  approvalIds.forEach((approvalId, index) => {
    appendAgent101ThreadMessages(thread, {
      id: `approval-message-${approvalId}`,
      role: "approval",
      content: "Human Gate review is waiting for this draft-only external step. Agent 101 will not publish or upload anything unless you approve it.",
      status: "waiting_approval",
      metadata: {
        taskType: "human_gate_request",
        runId: result.runId,
        approvalId,
        actionType: approvalActionTypes.get(approvalId) || "publish_video",
        riskLevel: "medium",
        requiresApproval: true,
        roomId: "human-gate",
        approvalIndex: index + 1,
      },
    });
  });
  appendAgent101ThreadMessages(thread, {
    role: "agent",
    content:
      result.status === "completed"
        ? result.summary || formatAgent101ExecutiveReport({
          title: "RUN STATUS",
          currentStatus: ["Run status: complete.", "External posting and account actions remain Human Gate-gated."],
          keyFindings: ["Safe internal workflow returned records to this thread."],
          risks: ["External execution remains blocked without approval."],
          recommendations: ["Review saved outputs and advance only verified winners."],
          nextActions: ["Open the related office output and clear any Human Gate decision."],
        })
        : result.summary || blockedDepoResponse("external_api_action").message,
    status: result.status === "error" ? "error" : "complete",
    metadata: {
      taskType: "agent_run_summary",
      runId: result.runId,
      artifacts: result.artifacts || [],
      requiresApproval: result.status === "needs_approval",
      riskLevel: result.status === "needs_approval" ? "high" : "low",
      roomId: thread.roomId,
    },
  });
  thread.activeRunId = result.runId || thread.activeRunId || null;
  thread.activeApprovalId = approvalIds[0] || null;
  thread.status = approvalIds.length ? "waiting_approval" : result.status === "error" ? "error" : "complete";
}

async function clippingOfficeModule() {
  applyLocalConnectorSecretsToEnv();
  const runtimeKey = `${process.env.CLIPPING_OFFICE_DATA_DIR || path.join(DATA_DIR, "clipping-office")}:${localConnectorEnvSignature()}`;
  if (!clippingOfficeModulePromise || clippingOfficeRuntimeKey !== runtimeKey) {
    clippingOfficeRuntimeKey = runtimeKey;
    const moduleUrl = `${pathToFileURL(CLIPPING_OFFICE_SERVER).href}?runtime=${encodeURIComponent(runtimeKey)}`;
    clippingOfficeModulePromise = import(moduleUrl);
  }
  return clippingOfficeModulePromise;
}

function applyLocalConnectorSecretsToEnv() {
  if (APP_MODE !== "local") return;
  for (const { env } of LOCAL_CONNECTOR_SECRET_ENV) {
    const original = LOCAL_CONNECTOR_ENV_ORIGINALS[env];
    if (original) process.env[env] = original;
    else if (localConnectorEnvApplied.has(env)) delete process.env[env];
    localConnectorEnvApplied.delete(env);
  }
  for (const { provider, env } of LOCAL_CONNECTOR_SECRET_ENV) {
    if (LOCAL_CONNECTOR_ENV_ORIGINALS[env]) continue;
    const value = secureSecrets.getSecret({ dataDir: DATA_DIR, provider });
    if (!value) continue;
    process.env[env] = value;
    localConnectorEnvApplied.add(env);
  }
}

function localConnectorEnvSignature() {
  return crypto
    .createHash("sha256")
    .update(LOCAL_CONNECTOR_SECRET_ENV.map(({ env }) => `${env}:${Boolean(process.env[env])}`).join("|"))
    .digest("hex")
    .slice(0, 16);
}

function reloadClippingOfficeModuleFromLocalSecrets() {
  applyLocalConnectorSecretsToEnv();
  clippingOfficeModulePromise = null;
  clippingOfficeRuntimeKey = "";
}

function isLocalConnectorSecretProvider(provider) {
  return LOCAL_CONNECTOR_SECRET_ENV.some((item) => item.provider === provider);
}

async function runClippingOfficeAgent101(payload = {}, runtimeBridge = {}) {
  const clippingOffice = await clippingOfficeModule();
  if (typeof clippingOffice.runAgent101Workflow !== "function") {
    throw guardedError("StreamClipper Agent runner is not available.", 503);
  }
  return clippingOffice.runAgent101Workflow(payload, runtimeBridge);
}

function findAgent101Mission(state, missionId) {
  return (state.agent101Missions || []).find((mission) => mission.id === missionId) || null;
}

function publicAgent101Mission(mission, options = {}) {
  if (!mission) return null;
  const approvals = options.approvals || readState().approvals || [];
  return agent101MissionManager.publicMission(mission, { ...options, approvals });
}

function writeAgent101MissionSse(res, event, payload, id = "") {
  if (id) res.write(`id: ${id}\n`);
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function emitAgent101MissionEvent(mission, event) {
  const clients = agent101MissionStreamClients.get(mission.id);
  if (!clients?.size) return;
  const payload = { missionId: mission.id, event, mission: publicAgent101Mission(mission, { includeEvents: false }) };
  for (const res of clients) writeAgent101MissionSse(res, event.type || "mission_event", payload, event.id);
}

function subscribeAgent101Mission(missionId, req, res) {
  const state = readState();
  const mission = findAgent101Mission(state, missionId);
  if (!mission) throw guardedError("Agent 101 mission not found.", 404);
  res.writeHead(200, {
    ...securityHeaders(req),
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const clients = agent101MissionStreamClients.get(mission.id) || new Set();
  clients.add(res);
  agent101MissionStreamClients.set(mission.id, clients);
  writeAgent101MissionSse(res, "connected", { missionId: mission.id, mission: publicAgent101Mission(mission) });
  for (const event of (mission.events || []).slice(-150)) {
    writeAgent101MissionSse(res, event.type || "mission_event", { missionId: mission.id, event }, event.id);
  }
  const timer = setInterval(() => writeAgent101MissionSse(res, "heartbeat", {
    missionId: mission.id,
    timestamp: now(),
  }), 15_000);
  res.on("close", () => {
    clearInterval(timer);
    clients.delete(res);
    if (!clients.size) agent101MissionStreamClients.delete(mission.id);
  });
}

function agent101MissionIntent(message = "") {
  const text = String(message || "").trim();
  if (!text) return false;
  const startsAsQuestion = /^(?:what|why|how|when|where|who|which|can you explain|tell me about|do you know)\b/i.test(text);
  const explicitBuild = /\b(?:build|create|make|start|launch|design|implement|edit|update|upgrade|fix|redesign|wire|scaffold|set up|generate|research and write|prepare|draft|configure|move|reorganize|refactor|launch prep|business blueprint|business plan)\b/i.test(text);
  const target = /\b(?:business|brand|website|site|shop|store|checkout|email flow|product|project|argentum|agent 101|agent101|ui|interface|dashboard|file|code|backend|frontend|office|blueprint|landing page|saas|portfolio|3d print|3d printing)\b/i.test(text);
  return explicitBuild && target && (!startsAsQuestion || /\b(?:build|create|make|implement|edit|upgrade|fix|redesign)\b/i.test(text));
}

function agent101MissionGrounding(state, mission) {
  const thread = mission.threadId ? findAgent101Thread(state, mission.threadId) : null;
  let vaultContext = null;
  try {
    const status = obsidianStatusPayload();
    if (status.initialized || status.connected) {
      vaultContext = agentContextBuilder.buildAgentContext({
        vaultPath: status.vaultPath,
        state,
        agentId: "agent.1010",
        threadId: mission.threadId,
        officeId: thread?.roomId || "depo-habitat",
        includeTrace: false,
      });
    }
  } catch {
    vaultContext = null;
  }
  return {
    mission: {
      id: mission.id,
      title: mission.title,
      goal: mission.goal,
      attempt: Number(mission.attempts || 0) + 1,
      maxIterations: mission.maxIterations,
    },
    operatingContext: agent101Os.buildAgent101Context(state, {
      goal: mission.goal,
      threadId: mission.threadId,
      obsidianContext: vaultContext,
    }),
    knowledgeContext: vaultContext,
    conversation: (thread?.messages || []).slice(-24).map((message) => ({
      role: message.role,
      content: String(message.content || "").slice(0, 6000),
      status: message.status,
      createdAt: message.createdAt,
    })),
    approvals: (state.approvals || [])
      .filter((approval) => approval.missionId === mission.id || mission.approvalIds.includes(approval.id))
      .map((approval) => ({
        id: approval.id,
        status: approval.status,
        actionType: approval.actionType,
        title: approval.title,
        exactScope: approval.exactScope,
        details: approval.details,
        decidedAt: approval.decidedAt || null,
      })),
    projectWorkspace: agent101ProjectWorkspace.inspectWorkspace({ state, rootDir: ROOT }),
  };
}

function attachApprovalToMission(missionId, approvalId) {
  const state = readState();
  const mission = findAgent101Mission(state, missionId);
  const approval = (state.approvals || []).find((item) => item.id === approvalId);
  if (!mission || !approval) return approval || null;
  if (agent101MissionManager.TERMINAL_STATUSES.has(mission.status)) {
    approval.status = "cancelled";
    approval.decisionNote = "The linked mission finished before this approval could be attached.";
    approval.decidedAt = now();
    writeState(state);
    return approval;
  }
  approval.missionId = mission.id;
  approval.runId = approval.runId || mission.runId;
  mission.approvalIds = [...new Set([...(mission.approvalIds || []), approval.id])];
  mission.status = "waiting_approval";
  mission.stage = "human_gate";
  mission.updatedAt = now();
  writeState(state);
  return approval;
}

function createMissionHumanGateRequest(missionId, payload = {}) {
  const details = payload.details || payload.evidence?.details || {};
  const result = createHumanGateRequest({
    actionType: payload.actionType || payload.type || "agent101_tool",
    title: payload.title,
    action: payload.action || payload.title,
    evidence: payload.evidence,
    exactScope: payload.exactScope || `Only this exact tool input is authorized: ${JSON.stringify(details).slice(0, 2500)}`,
    riskLevel: payload.riskLevel || "high",
    details,
    linkedId: payload.linkedId,
    missionId,
    runId: payload.evidence?.runId || null,
    reversible: payload.reversible,
    expectedPostcondition: payload.expectedPostcondition,
    rollbackPlan: payload.rollbackPlan,
  });
  return attachApprovalToMission(missionId, result.approval.id);
}

function agent101MissionRuntimeBridge(mission, providerConfig) {
  const approvalState = {};
  Object.defineProperty(approvalState, "approvalRequests", {
    enumerable: true,
    get() {
      return readState().approvals || [];
    },
  });
  const configuredProvider = sanitizeProvider(providerConfig.provider);
  const mode = isLocalProvider(configuredProvider) ? "demo" : sanitizeAiMode(providerConfig.mode);
  const providerKey = mode === "live" ? keyFromConfig(providerConfig, configuredProvider) : "";
  const provider = providerKey ? configuredProvider : "local_tool_fallback";
  if (providerKey) assertAiUsageBudget(providerConfig);

  const projectWorkspace = {
    inspect() {
      return agent101ProjectWorkspace.inspectWorkspace({ state: readState(), rootDir: ROOT });
    },
    propose(input) {
      const proposalState = readState();
      const result = agent101ProjectWorkspace.createEditProposal({
        state: proposalState,
        rootDir: ROOT,
        outputRoot: AGENT101_OUTPUT_ROOT,
        input,
        createApprovalRequest: (payload) => createMissionHumanGateRequest(mission.id, payload),
      });
      const latestState = readState();
      latestState.agent101EditProposals = proposalState.agent101EditProposals;
      writeState(latestState);
      return result;
    },
    apply(input) {
      const projectState = readState();
      try {
        return agent101ProjectWorkspace.applyEditProposal({
          state: projectState,
          rootDir: ROOT,
          outputRoot: AGENT101_OUTPUT_ROOT,
          proposalId: input.proposal_id,
          approvalId: input.approval_id,
        });
      } finally {
        // Conflict, rollback, applying, and approval-consumption state are all
        // durable even when the source operation throws.
        writeState(projectState);
      }
    },
  };

  const approvedApprovals = (readState().approvals || []).filter((approval) => mission.approvalIds.includes(approval.id) && approval.status === "approved" && !approval.consumedAt);
  return {
    missionId: mission.id,
    preferredProvider: provider,
    projectRoot: ROOT,
    outputRoot: AGENT101_OUTPUT_ROOT,
    state: approvalState,
    openaiApiKey: provider === "openai" ? providerKey : "",
    openaiModel: providerConfig.providers.openai.model,
    anthropicApiKey: provider === "anthropic" ? providerKey : "",
    anthropicModel: providerConfig.providers.anthropic.model,
    maxOutputTokens: Math.max(2000, Number(provider === "anthropic"
      ? providerConfig.providers.anthropic.maxOutputTokens
      : providerConfig.providers.openai.maxOutputTokens) || 2000),
    maxIterations: mission.maxIterations,
    approvedApprovalIds: approvedApprovals.map((approval) => approval.id),
    approvedApprovals: approvedApprovals.map((approval) => ({ id: approval.id, actionType: approval.actionType, details: approval.grantedDetails || approval.details })),
    isCancelled() {
      return findAgent101Mission(readState(), mission.id)?.status === "cancelled";
    },
    systemContext: agent101MissionGrounding(readState(), mission),
    projectWorkspace,
    configureStudioLayout(input) {
      const layoutState = readState();
      const result = agent101ProjectWorkspace.configureStudioLayout({ state: layoutState, input });
      writeState(layoutState);
      return result;
    },
    createApprovalRequest: (payload) => createMissionHumanGateRequest(mission.id, payload),
    consumeApproval({ approvalId, actionType, details = {} }) {
      const state = readState();
      const currentMission = findAgent101Mission(state, mission.id);
      if (!currentMission || agent101MissionManager.TERMINAL_STATUSES.has(currentMission.status)) {
        throw guardedError("The linked mission is no longer active.", 409);
      }
      const approval = (state.approvals || []).find((item) => item.id === approvalId);
      if (!approval || approval.status !== "approved" || approval.missionId !== mission.id || approval.actionType !== actionType) {
        throw guardedError("Human Gate approval does not match this mission and tool capability.", 403);
      }
      if (approval.expiresAt && Date.parse(approval.expiresAt) <= Date.now()) throw guardedError("Human Gate approval expired.", 409);
      if (approval.consumedAt || Number(approval.useCount || 0) >= 1) throw guardedError("Human Gate approval has already been used.", 409);
      const granted = approval.grantedDetails || approval.details || {};
      const exact = Object.entries(details).every(([key, value]) => String(granted[key] ?? "") === String(value ?? ""));
      if (!exact) throw guardedError("Human Gate approval scope does not match the exact tool input.", 403);
      approval.useCount = Number(approval.useCount || 0) + 1;
      approval.consumedAt = now();
      approval.consumedByRunId = currentMission.runId || null;
      writeState(state);
      return approval;
    },
    saveState: async () => {},
    logEvent: async () => {},
    recordUsage(providerName, usage, providerEstimate, reservationId) {
      if (["openai", "anthropic"].includes(providerName)) {
        recordAiUsage(providerConfig, usage, {
          reservationId,
          estimatedCostUsd: Number(providerEstimate?.estimatedCostUsd || 0),
        });
      }
    },
    beforeModelCall(call = {}) {
      const callProvider = ["openai", "anthropic"].includes(call.provider) ? call.provider : provider;
      if (!["openai", "anthropic"].includes(callProvider)) return "";
      return reserveAiUsage({
        provider: callProvider,
        model: call.model || (callProvider === "anthropic" ? providerConfig.providers.anthropic.model : providerConfig.providers.openai.model),
        estimatedInputTokens: Math.max(1000, Number(call.estimatedInputTokens || 16_000)),
        maxOutputTokens: Math.max(64, Number(call.maxOutputTokens || 2_000)),
        estimatedCostUsd: Math.max(0, Number(call.estimatedCostUsd || 0)),
      });
    },
    providerCallFailed(reservationId, error) {
      recordAiProviderFailure(providerConfig, redactSensitiveText(error?.message || error), reservationId);
    },
    onEvent(event, run) {
      const state = readState();
      const current = findAgent101Mission(state, mission.id);
      if (!current || current.status === "cancelled") return;
      current.runId = run.runId;
      current.provider = run.provider;
      current.model = run.model;
      current.toolCallCount = run.toolCalls?.length || 0;
      current.outputFiles = run.outputFiles || [];
      if (event.type === "approval_required" || event.type === "run_waiting_approval") current.status = "waiting_approval";
      else if (event.type === "model_call") current.status = "running";
      else if (event.type === "run_completed") current.status = "verifying";
      const missionEvent = agent101MissionManager.appendEvent(current, event.type, event.message, event.details || {});
      if (["tool_result", "tool_error", "approval_required", "run_completed", "run_failed", "run_blocked"].includes(event.type)) {
        agent101MissionManager.checkpoint(current, {
          stage: event.type,
          toolCallCount: current.toolCallCount,
          outputFileCount: current.outputFiles.length,
          summary: event.message,
        });
      }
      writeState(state);
      emitAgent101MissionEvent(current, missionEvent);
    },
    onRunUpdate(run) {
      const state = readState();
      const current = findAgent101Mission(state, mission.id);
      if (!current || current.status === "cancelled") return;
      current.runId = run.runId;
      current.provider = run.provider;
      current.model = run.model;
      current.toolCallCount = run.toolCalls?.length || 0;
      current.outputFiles = run.outputFiles || [];
      current.costEstimateUsd = Number(run.costEstimateUsd || 0);
      current.updatedAt = now();
      writeState(state);
    },
  };
}

function appendMissionResultToThread(state, mission, result) {
  if (!mission.threadId) return;
  const thread = findAgent101Thread(state, mission.threadId);
  if (!thread) return;
  const runningNotice = (thread.messages || []).slice().reverse().find((message) => message.status === "running" && message.metadata?.missionId === mission.id);
  if (runningNotice) {
    runningNotice.status = mission.status === "completed" ? "complete" : mission.status;
    runningNotice.updatedAt = now();
  }
  for (const call of result.run?.toolCalls || []) {
    const detail = JSON.stringify(call.output ?? {}, null, 2).slice(0, 10_000);
    appendAgent101ThreadMessages(thread, {
      role: "tool",
      content: `${runnerStepTitle({ tool: call.name })}\n${detail}`,
      status: call.status === "completed" ? "complete" : call.status,
      metadata: {
        taskType: "agent101_mission_tool",
        missionId: mission.id,
        sessionId: mission.sessionId,
        runId: result.runId,
        tool: call.name,
        input: call.input,
        output: call.output,
        durationMs: call.durationMs,
        outputFiles: result.outputFiles || [],
        roomId: thread.roomId,
      },
    });
  }
  const approvals = (state.approvals || []).filter((approval) => mission.approvalIds.includes(approval.id));
  for (const approval of approvals) {
    if ((thread.messages || []).some((message) => message.metadata?.approvalId === approval.id)) continue;
    appendAgent101ThreadMessages(thread, {
      role: "approval",
      content: `${approval.title}\n\nExact scope: ${approval.exactScope}\n\n${approval.evidence}`,
      status: approval.status === "pending" ? "waiting_approval" : approval.status,
      metadata: {
        taskType: "human_gate_request",
        missionId: mission.id,
        sessionId: mission.sessionId,
        runId: result.runId,
        approvalId: approval.id,
        actionType: approval.actionType,
        details: approval.details,
        exactScope: approval.exactScope,
        requiresApproval: approval.status === "pending",
        riskLevel: approval.riskLevel,
        roomId: "human-gate",
      },
    });
  }
  appendAgent101ThreadMessages(thread, {
    role: "agent",
    content: mission.response || result.response || "Agent 101 mission stopped without a final response.",
    status: mission.status === "completed" ? "complete" : mission.status,
    metadata: {
      taskType: "agent101_mission_summary",
      missionId: mission.id,
      sessionId: mission.sessionId,
      runId: result.runId,
      provider: mission.provider,
      model: mission.model,
      outputFiles: mission.outputFiles,
      artifacts: mission.outputFiles,
      toolCallCount: mission.toolCallCount,
      costEstimateUsd: mission.costEstimateUsd,
      approvalIds: mission.approvalIds,
      requiresApproval: mission.status === "waiting_approval",
      riskLevel: mission.status === "waiting_approval" ? "high" : "low",
      roomId: thread.roomId,
    },
  });
  thread.activeRunId = mission.runId;
  thread.activeMissionId = mission.id;
  thread.activeApprovalId = mission.approvalIds.find((id) => (state.approvals || []).find((approval) => approval.id === id)?.status === "pending") || null;
  thread.status = mission.status === "waiting_approval" ? "waiting_approval" : mission.status === "completed" ? "complete" : mission.status === "failed" ? "error" : mission.status;
}

function applyApprovedMissionProjectEdits(missionId) {
  const state = readState();
  const mission = findAgent101Mission(state, missionId);
  if (!mission) return [];
  const approvals = new Map((state.approvals || []).map((approval) => [approval.id, approval]));
  const proposals = (state.agent101EditProposals || []).filter((proposal) => (
    proposal.status === "waiting_approval"
    && mission.approvalIds.includes(proposal.approvalId)
    && approvals.get(proposal.approvalId)?.status === "approved"
  ));
  const applied = [];
  for (const proposal of proposals) {
    try {
      const result = agent101ProjectWorkspace.applyEditProposal({
        state,
        rootDir: ROOT,
        outputRoot: AGENT101_OUTPUT_ROOT,
        proposalId: proposal.id,
        approvalId: proposal.approvalId,
      });
      applied.push(result);
      const validationLabel = result.validation?.status === "passed"
        ? `${result.validation.check} passed`
        : `${result.validation?.check || "hash verification"} completed`;
      const event = agent101MissionManager.appendEvent(mission, "project_edit_applied", `Applied approved source edit: ${result.path}. ${validationLabel}.`, {
        stage: "project_edit_applied",
        proposalId: proposal.id,
        approvalId: proposal.approvalId,
        path: result.path,
        validation: result.validation,
      });
      agent101MissionManager.checkpoint(mission, {
        stage: "project_edit_applied",
        summary: `${result.path} now matches the exact approved SHA-256; validation scope: ${result.validation?.check || "hash verification"}.`,
      });
      writeState(state);
      emitAgent101MissionEvent(mission, event);
    } catch (error) {
      const event = agent101MissionManager.appendEvent(mission, "project_edit_failed", `Approved source edit did not remain active: ${redactSensitiveText(error.message)}.`, {
        stage: "project_edit_failed",
        proposalId: proposal.id,
        approvalId: proposal.approvalId,
        path: proposal.path,
      });
      agent101MissionManager.checkpoint(mission, {
        stage: "project_edit_failed",
        summary: `Source edit stopped safely: ${redactSensitiveText(error.message)}.`,
      });
      writeState(state);
      emitAgent101MissionEvent(mission, event);
      throw error;
    }
  }
  return applied;
}

async function executeAgent101Mission(missionId) {
  if (agent101MissionWorkers.has(missionId)) return agent101MissionWorkers.get(missionId);
  const worker = (async () => {
    let state = readState();
    let mission = findAgent101Mission(state, missionId);
    if (!mission || ["completed", "failed", "cancelled", "blocked"].includes(mission.status)) return mission;
    agent101MissionManager.transition(mission, "running", { stage: "starting", message: "Agent 101 Studio worker started." });
    writeState(state);
    emitAgent101MissionEvent(mission, mission.events.at(-1));
    try {
      const appliedProjectEdits = applyApprovedMissionProjectEdits(mission.id);
      state = readState();
      mission = findAgent101Mission(state, missionId);
      const providerConfig = readAiProviderConfig();
      const runtimeBridge = agent101MissionRuntimeBridge(mission, providerConfig);
      const resume = mission.attempts > 1;
      const message = resume
        ? `Resume this checkpointed mission without duplicating verified work. ${appliedProjectEdits.length ? `The runtime already applied and syntax-validated ${appliedProjectEdits.length} exact approved source edit(s); inspect their current state and continue with remaining verification.` : "Use the approved Human Gate scopes in context and continue only the exact paused steps."} Original goal: ${mission.goal}`
        : mission.goal;
      const result = await runClippingOfficeAgent101({
        studio: true,
        agentMode: "studio",
        missionId: mission.id,
        sessionId: mission.sessionId,
        message,
        maxIterations: mission.maxIterations,
        provider: runtimeBridge.preferredProvider,
      }, runtimeBridge);
      state = readState();
      mission = findAgent101Mission(state, missionId);
      if (!mission || mission.status === "cancelled") return mission;
      mission.runId = result.runId;
      mission.provider = result.provider;
      mission.model = result.model;
      mission.outputFiles = result.outputFiles || [];
      mission.toolCallCount = Number(result.toolCallCount || 0);
      mission.costEstimateUsd = Number(result.costEstimateUsd || 0);
      mission.response = result.response || "";
      const pendingIds = (state.approvals || []).filter((approval) => approval.missionId === mission.id && approval.status === "pending").map((approval) => approval.id);
      mission.approvalIds = [...new Set([...(mission.approvalIds || []), ...pendingIds])];
      const nextStatus = result.status === "COMPLETED"
        ? "completed"
        : result.status === "NEEDS_APPROVAL"
          ? "waiting_approval"
          : result.status === "BLOCKED"
            ? "blocked"
            : "failed";
      agent101MissionManager.transition(mission, nextStatus, {
        stage: nextStatus === "waiting_approval" ? "human_gate" : "final",
        message: nextStatus === "completed"
          ? "Agent 101 mission completed with recorded verification."
          : nextStatus === "waiting_approval"
            ? "Mission checkpointed at Human Gate."
            : "Mission stopped without a completion claim.",
        response: mission.response,
        error: nextStatus === "failed" ? mission.response : null,
      });
      appendMissionResultToThread(state, mission, result);
      writeState(state);
      emitAgent101MissionEvent(mission, mission.events.at(-1));
      return mission;
    } catch (error) {
      state = readState();
      mission = findAgent101Mission(state, missionId);
      if (!mission || mission.status === "cancelled") return mission;
      agent101MissionManager.transition(mission, "failed", {
        stage: "runtime_error",
        message: "Agent 101 mission runtime failed without executing external actions.",
        error: redactSensitiveText(error.message),
        response: redactSensitiveText(error.message),
      });
      appendMissionResultToThread(state, mission, { response: mission.response, outputFiles: [], run: { toolCalls: [] } });
      writeState(state);
      emitAgent101MissionEvent(mission, mission.events.at(-1));
      return mission;
    }
  })().finally(() => agent101MissionWorkers.delete(missionId));
  agent101MissionWorkers.set(missionId, worker);
  return worker;
}

function queueAgent101Mission(missionId) {
  setImmediate(() => executeAgent101Mission(missionId).catch((error) => console.error(`[agent101-mission] ${error.message}`)));
}

function createAgent101Mission(payload = {}) {
  const state = readState();
  const activeCount = (state.agent101Missions || []).filter((mission) => !agent101MissionManager.TERMINAL_STATUSES.has(mission.status)).length;
  if (activeCount >= MAX_ACTIVE_AGENT101_MISSIONS) {
    throw guardedError(`Agent 101 already has ${activeCount} active missions. Finish, cancel, or unblock one before creating another.`, 429);
  }
  const mission = agent101MissionManager.createMission(state, payload);
  if (mission.threadId) {
    const thread = findAgent101Thread(state, mission.threadId);
    if (thread) {
      thread.activeMissionId = mission.id;
      thread.status = "running";
      appendAgent101ThreadMessages(thread, {
        role: "agent",
        content: "Mission accepted. Agent 101 is grounding the request in your business knowledge, thread decisions, project scope, and Human Gate policy before it starts tools.",
        status: "running",
        metadata: {
          taskType: "agent101_mission",
          missionId: mission.id,
          sessionId: mission.sessionId,
          roomId: thread.roomId,
          riskLevel: "low",
        },
      });
    }
  }
  writeState(state);
  queueAgent101Mission(mission.id);
  return publicAgent101Mission(mission);
}

function resumeAgent101Mission(missionId) {
  const state = readState();
  const mission = findAgent101Mission(state, missionId);
  if (!mission) throw guardedError("Agent 101 mission not found.", 404);
  if (!agent101MissionManager.resumable(mission, state.approvals || [])) throw guardedError("Mission cannot resume until every exact Human Gate request is approved.", 409);
  agent101MissionManager.transition(mission, "recovering", { stage: "resume", message: "Mission queued from its durable checkpoint." });
  writeState(state);
  emitAgent101MissionEvent(mission, mission.events.at(-1));
  queueAgent101Mission(mission.id);
  return publicAgent101Mission(mission);
}

function cancelAgent101Mission(missionId) {
  const state = readState();
  const mission = findAgent101Mission(state, missionId);
  if (!mission) throw guardedError("Agent 101 mission not found.", 404);
  if (["completed", "failed", "cancelled", "blocked"].includes(mission.status)) throw guardedError("Mission is already finished.", 409);
  agent101MissionManager.transition(mission, "cancelled", { stage: "cancelled", message: "Operator cancelled the mission. No new tool steps will be accepted." });
  const cancelledApprovalIds = new Set();
  for (const approval of state.approvals || []) {
    if (approval.missionId !== mission.id || approval.consumedAt || !["pending", "approved", "needs_revision"].includes(approval.status)) continue;
    approval.status = "cancelled";
    approval.decision = "mission_cancelled";
    approval.decisionNote = "The operator cancelled the linked mission before this approval was used.";
    approval.decidedAt = now();
    cancelledApprovalIds.add(approval.id);
  }
  for (const proposal of state.agent101EditProposals || []) {
    if (!cancelledApprovalIds.has(proposal.approvalId) || !["waiting_approval", "approved"].includes(proposal.status)) continue;
    proposal.status = "cancelled";
    proposal.updatedAt = now();
  }
  if (mission.threadId) {
    const thread = findAgent101Thread(state, mission.threadId);
    if (thread) {
      const runningNotice = (thread.messages || []).slice().reverse().find((message) => message.metadata?.missionId === mission.id && ["thinking", "running", "verifying", "recovering", "waiting_approval"].includes(message.status));
      if (runningNotice) {
        runningNotice.status = "cancelled";
        runningNotice.updatedAt = now();
      }
      for (const message of thread.messages || []) {
        if (message.metadata?.approvalId && cancelledApprovalIds.has(message.metadata.approvalId)) {
          message.status = "cancelled";
          message.updatedAt = now();
        }
      }
      appendAgent101ThreadMessages(thread, {
        role: "system",
        content: "Mission cancelled by the operator. Agent 101 will reject any later tool result or completion from this run.",
        status: "cancelled",
        metadata: {
          taskType: "agent101_mission_cancelled",
          missionId: mission.id,
          sessionId: mission.sessionId,
          runId: mission.runId,
          roomId: thread.roomId,
        },
      });
      thread.activeApprovalId = null;
      thread.status = "cancelled";
    }
  }
  writeState(state);
  emitAgent101MissionEvent(mission, mission.events.at(-1));
  return publicAgent101Mission(mission);
}

function recoverAgent101Missions() {
  const state = readState();
  const recoverable = (state.agent101Missions || []).filter((mission) => ["queued", "running", "verifying", "recovering"].includes(mission.status));
  for (const mission of recoverable) {
    mission.status = "recovering";
    mission.stage = "startup_recovery";
    mission.updatedAt = now();
  }
  if (recoverable.length) writeState(state);
  recoverable.forEach((mission) => queueAgent101Mission(mission.id));
  return recoverable.length;
}

async function runAgent101FromRoot(payload = {}) {
  const state = readState();
  let obsidianContext = null;
  try {
    const status = obsidianStatusPayload();
    if (status.connected) {
      obsidianContext = obsidianVault.agentContext(status.vaultPath, {
        business: payload.business || payload.project || "Argentum",
        workflow: payload.workflow,
        skills: payload.skills,
        depth: payload.depth ?? 2,
      });
    }
  } catch {
    obsidianContext = null;
  }
  const result = await agent101Os.runAgent101OperatingTask({
    state,
    goal: payload.goal || payload.message,
    mode: payload.mode || "demo",
    maxSteps: payload.maxSteps || 10,
    threadId: payload.threadId || null,
    obsidianContext,
    providerStatus: currentAiProviderStatus(),
    officeRunner: runClippingOfficeAgent101,
  });
  writeState(result.state);
  if (payload.threadId && payload.appendToThread !== false) {
    const refreshedState = readState();
    const thread = findAgent101Thread(refreshedState, payload.threadId);
    if (thread) {
      appendRunMessagesToThread(thread, result);
      writeState(refreshedState);
      return { ...result, thread, threads: publicAgent101ChatThreads(refreshedState) };
    }
  }
  return result;
}

async function addAgent101ChatMessage(threadId, payload = {}) {
  const state = readState();
  const thread = findAgent101Thread(state, threadId);
  if (!thread || thread.archived) throw guardedError("Chat thread not found.", 404);
  const content = String(payload.content || payload.message || "").trim();
  if (!content) throw guardedError("Message is required.", 400);
  const clientMessageId = payload.clientMessageId || payload.idempotencyKey || payload.idempotency || "";
  if (clientMessageId && (thread.messages || []).some((message) => message.metadata?.clientMessageId === clientMessageId)) {
    return { thread, threads: publicAgent101ChatThreads(state), duplicate: true };
  }
  appendAgent101ThreadMessages(thread, {
    role: "user",
    content,
    status: "sent",
    metadata: { roomId: payload.roomId || thread.roomId, clientMessageId },
  });
  if (!thread.title || thread.title === "Agent 101 Session") thread.title = chatTitleFromMessage(content);

  const recentMessages = thread.messages.slice(-20);
  if (agent101MissionIntent(content)) {
    writeState(state);
    const mission = createAgent101Mission({
      goal: content,
      title: chatTitleFromMessage(content),
      threadId,
      maxIterations: payload.maxIterations || 25,
      autoResume: payload.autoResume !== false,
    });
    const refreshedState = readState();
    const refreshedThread = findAgent101Thread(refreshedState, threadId);
    return {
      mission,
      thread: refreshedThread,
      threads: publicAgent101ChatThreads(refreshedState),
    };
  }
  if (shouldTriggerAgentRunner(content)) {
    appendAgent101ThreadMessages(thread, {
      role: "agent",
      content: "SAFE INTERNAL RUN\n\nCURRENT STATUS\n• Workflow classified as internal draft execution.\n• Posting, uploads, account actions, spending, and external APIs remain locked by Human Gate.\n\nKEY FINDINGS\n• Existing thread context will be attached to the run.\n\nRISKS\n• Downstream external steps require a separate approval package.\n\nRECOMMENDATIONS\n• Run the internal workflow now and route any risky output to Human Gate.\n\nNEXT ACTIONS\n• Start the safe internal run and record every tool result in this thread.",
      status: "running",
      metadata: { taskType: "agent_run", roomId: thread.roomId, riskLevel: "low", replyToClientMessageId: clientMessageId },
    });
    thread.status = "running";
    writeState(state);
    try {
      const result = await runAgent101FromRoot({
        goal: content,
        mode: payload.mode || "demo",
        maxSteps: payload.maxSteps || 10,
        threadId,
        appendToThread: false,
      });
      const refreshedState = readState();
      const refreshedThread = findAgent101Thread(refreshedState, threadId) || thread;
      const runningNotice = refreshedThread.messages
        ?.slice()
        .reverse()
        .find((message) => message.status === "running" && message.metadata?.taskType === "agent_run");
      if (runningNotice) {
        runningNotice.status = "complete";
        runningNotice.updatedAt = now();
      }
      appendRunMessagesToThread(refreshedThread, result);
      writeState(refreshedState);
      return { thread: refreshedThread, threads: publicAgent101ChatThreads(refreshedState), run: result };
    } catch (error) {
      const erroredState = readState();
      const erroredThread = findAgent101Thread(erroredState, threadId) || thread;
      appendAgent101ThreadMessages(erroredThread, {
        role: "agent",
        content: formatAgent101ExecutiveReport({
          title: "RUN STATUS",
          currentStatus: [
            "Run status: failed.",
            "External actions: none executed.",
            "Thread state: request preserved.",
          ],
          keyFindings: [
            `Failure reason: ${error.message}.`,
          ],
          risks: [
            "Completion is not claimed until the failed stage is repaired.",
          ],
          recommendations: [
            "Inspect the failing run path and rerun only the blocked internal step.",
          ],
          nextActions: [
            "Repair the failing tool path, then rerun verification.",
          ],
        }),
        status: "failed",
        metadata: { taskType: "agent_run_error", roomId: thread.roomId, replyToClientMessageId: clientMessageId, riskLevel: "medium" },
      });
      erroredThread.status = "error";
      writeState(erroredState);
      return { thread: erroredThread, threads: publicAgent101ChatThreads(erroredState), error: error.message };
    }
  }

  const response = await handleAgent101Chat({
    message: content,
    threadId,
    office: payload.roomId || thread.roomId,
    officeId: payload.roomId || thread.roomId,
    roomId: payload.roomId || thread.roomId,
    chatHistory: recentMessages.map((message) => ({
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      metadata: message.metadata,
    })),
    threadSummary: thread.threadSummary,
  });
  let structuredResponse = null;
  try {
    const status = obsidianStatusPayload();
    if (status.initialized || status.connected) {
      const context = agentContextBuilder.buildAgentContext({
        vaultPath: status.vaultPath,
        state,
        agentId: "agent.1010",
        threadId,
        officeId: payload.officeId || "office.clipping",
        projectId: payload.projectId || "",
        includeTrace: false,
      });
      structuredResponse = agentContextBuilder.structureAgentResponse(response.message || "", context, {
        artifacts: response.artifacts || [],
        approvals: response.approval ? [response.approval] : [],
      });
      response.message = appendAgent101CitationsToMessage(response.message, structuredResponse);
      response.evidence = structuredResponse.evidence;
      response.claims = structuredResponse.claims;
      response.unknowns = structuredResponse.unknowns;
      response.conflicts = structuredResponse.conflicts;
    }
  } catch {
    structuredResponse = null;
  }
  appendAgent101ThreadMessages(thread, {
    role: response.approval ? "system" : "agent",
    content:
      response.message ||
      (response.approval
        ? blockedDepoResponse(response.blockedAction || "external_api_action").message
        : buildGeneralExecutiveResponse(content, payload).message),
    status: "complete",
    metadata: {
      taskType: response.taskType,
      artifacts: response.artifacts || [],
      requiresApproval: Boolean(response.requiresApproval || response.approval),
      riskLevel: response.riskLevel || "low",
      approvalId: response.approval?.id,
      evidence: response.evidence || [],
      claims: response.claims || [],
      unknowns: response.unknowns || [],
      conflicts: response.conflicts || [],
      roomId: payload.roomId || thread.roomId,
      replyToClientMessageId: clientMessageId,
    },
  });
  (response.logs || []).slice(0, 4).forEach((log) => {
    appendAgent101ThreadMessages(thread, {
      role: "tool",
      content: String(log),
      status: "complete",
      metadata: { taskType: "agent_log", roomId: payload.roomId || thread.roomId },
    });
  });
  writeState(state);
  return { thread, threads: publicAgent101ChatThreads(state), response };
}

function mergeById(existing, seeded) {
  const next = [...existing];
  const ids = new Set(next.map((item) => item?.id).filter(Boolean));
  seeded.forEach((item) => {
    if (item?.id && !ids.has(item.id)) {
      next.push(item);
      ids.add(item.id);
    }
  });
  return next;
}

function readState() {
  ensureState();
  return normalizeState(JSON.parse(fs.readFileSync(STATE_FILE, "utf8")));
}

function writeState(state) {
  state.meta.updatedAt = now();
  ensureDataDir();
  const temporary = `${STATE_FILE}.${process.pid}.${crypto.randomBytes(5).toString("hex")}.tmp`;
  const descriptor = fs.openSync(temporary, "w", 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(state, null, 2)}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, STATE_FILE);
  queueDisplayStateChanged(state, "state.write");
}

function audit(state, title, body) {
  const entry = {
    id: `audit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title,
    body,
    createdAt: now(),
  };
  state.audit.unshift(entry);
  state.audit = state.audit.slice(0, 50);
  if (APP_MODE === "local" && localDatabaseStatus?.dbPath) {
    try {
      localDatabase.insertAuditLog(localDatabaseStatus.dbPath, entry);
    } catch {
      // Audit must not leak sensitive details or break the supervised task path.
    }
  }
}

function addMemory(state, layer, title, body, provenance) {
  const entries = state.memory[layer];
  if (!entries) return;
  entries.unshift({
    id: `mem-${layer}-${Date.now()}`,
    title,
    body,
    provenance,
    updatedAt: now(),
  });
  state.memory[layer] = entries.slice(0, 20);
}

function parseMonthlyLimit(value, fallback = 10) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.round(parsed * 100) / 100;
}

function aiUsagePeriod() {
  return new Date().toISOString().slice(0, 7);
}

function defaultAiUsage() {
  return {
    period: aiUsagePeriod(),
    estimatedMonthlyUsd: 0,
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    blockedByLimit: false,
    warnedAt: null,
    lastCallAt: null,
    lastError: null,
  };
}

function defaultAiProviderConfig() {
  const provider = sanitizeProvider(ENV_AI_PROVIDER || "local_demo");
  return {
    version: 1,
    provider,
    mode: ["openai", "anthropic"].includes(provider) ? sanitizeAiMode(ENV_AI_MODE || "live") : "demo",
    monthlyLimitUsd: parseMonthlyLimit(ENV_OPENAI_TEST_BUDGET_USD || ENV_AI_MONTHLY_LIMIT_USD, 10),
    usage: defaultAiUsage(),
    providers: {
      openai: {
        model: ENV_AI_MODEL || ENV_OPENAI_MODEL || "gpt-5.4-nano",
        temperature: 0.4,
        maxOutputTokens: 700,
      },
      anthropic: {
        model: ENV_ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
        temperature: 0.4,
        maxOutputTokens: 700,
      },
    },
    keys: {},
    lastTest: null,
    createdAt: now(),
    updatedAt: now(),
  };
}

function sanitizeProvider(provider) {
  const normalized = String(provider || "").trim().toLowerCase();
  if (["local", "local-demo", "local_demo", "demo"].includes(normalized)) return "local_demo";
  return AI_PROVIDER_OPTIONS.has(normalized) ? normalized : "local_demo";
}

function sanitizeAiMode(mode) {
  const normalized = String(mode || "").trim().toLowerCase();
  return AI_MODE_OPTIONS.has(normalized) ? normalized : "demo";
}

function isLocalProvider(provider) {
  return sanitizeProvider(provider) === "local_demo";
}

function normalizeAiUsage(usage) {
  const currentPeriod = aiUsagePeriod();
  if (!usage || usage.period !== currentPeriod) return defaultAiUsage();
  return {
    ...defaultAiUsage(),
    ...usage,
    period: currentPeriod,
    estimatedMonthlyUsd: Number.isFinite(Number(usage.estimatedMonthlyUsd)) ? Number(usage.estimatedMonthlyUsd) : 0,
    requestCount: Number.isFinite(Number(usage.requestCount)) ? Number(usage.requestCount) : 0,
    inputTokens: Number.isFinite(Number(usage.inputTokens)) ? Number(usage.inputTokens) : 0,
    outputTokens: Number.isFinite(Number(usage.outputTokens)) ? Number(usage.outputTokens) : 0,
    blockedByLimit: Boolean(usage.blockedByLimit),
    warnedAt: usage.warnedAt || null,
    lastCallAt: usage.lastCallAt || null,
    lastError: usage.lastError ? String(usage.lastError).slice(0, 240) : null,
  };
}

function readAiProviderConfig() {
  ensureDataDir();
  const fresh = defaultAiProviderConfig();
  if (!fs.existsSync(AI_PROVIDER_FILE)) return fresh;
  try {
    const stored = JSON.parse(fs.readFileSync(AI_PROVIDER_FILE, "utf8"));
    return {
      ...fresh,
      ...stored,
      provider: sanitizeProvider(stored.provider || fresh.provider),
      mode: sanitizeAiMode(stored.mode || fresh.mode),
      monthlyLimitUsd: parseMonthlyLimit(ENV_OPENAI_TEST_BUDGET_USD || ENV_AI_MONTHLY_LIMIT_USD || stored.monthlyLimitUsd, fresh.monthlyLimitUsd),
      usage: normalizeAiUsage(stored.usage || fresh.usage),
      providers: {
        openai: {
          ...fresh.providers.openai,
          ...(stored.providers?.openai || {}),
          model: ENV_AI_MODEL || ENV_OPENAI_MODEL || stored.providers?.openai?.model || fresh.providers.openai.model,
        },
        anthropic: { ...fresh.providers.anthropic, ...(stored.providers?.anthropic || {}) },
      },
      keys: stored.keys && typeof stored.keys === "object" ? stored.keys : {},
    };
  } catch {
    return fresh;
  }
}

function writeAiProviderConfig(config) {
  ensureDataDir();
  const nextConfig = {
    ...config,
    provider: sanitizeProvider(config.provider),
    mode: sanitizeAiMode(config.mode),
    monthlyLimitUsd: parseMonthlyLimit(ENV_OPENAI_TEST_BUDGET_USD || ENV_AI_MONTHLY_LIMIT_USD || config.monthlyLimitUsd, 10),
    usage: normalizeAiUsage(config.usage),
    updatedAt: now(),
  };
  const temporary = `${AI_PROVIDER_FILE}.${process.pid}.${crypto.randomBytes(5).toString("hex")}.tmp`;
  const descriptor = fs.openSync(temporary, "w", 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(nextConfig, null, 2)}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, AI_PROVIDER_FILE);
  try {
    fs.chmodSync(AI_PROVIDER_FILE, 0o600);
  } catch {
    // Best effort on external drives/filesystems that do not support POSIX modes.
  }
  return nextConfig;
}

function keyFromConfig(config, provider) {
  if (provider === "openai" && ENV_OPENAI_API_KEY) return ENV_OPENAI_API_KEY;
  if (provider === "anthropic" && ENV_ANTHROPIC_API_KEY) return ENV_ANTHROPIC_API_KEY;
  const stored = config.keys?.[provider];
  if (stored && typeof stored === "object") {
    return secureSecrets.getSecret({
      dataDir: DATA_DIR,
      provider,
      storage: stored.storage,
    });
  }
  if (typeof stored === "string" && stored) return stored;
  return "";
}

function keySource(config, provider) {
  if (provider === "openai" && ENV_OPENAI_API_KEY) return "environment";
  if (provider === "anthropic" && ENV_ANTHROPIC_API_KEY) return "environment";
  const stored = config.keys?.[provider];
  if (stored && typeof stored === "object") return stored.storage || "secure_store";
  if (typeof stored === "string" && stored) return "server-config";
  return "none";
}

function activeProviderSettings(config) {
  const provider = sanitizeProvider(config.provider);
  if (provider === "anthropic") return config.providers.anthropic;
  if (provider === "openai") return config.providers.openai;
  return { model: "local-demo", temperature: 0, maxOutputTokens: 700 };
}

function aiProviderLabel(provider) {
  const normalized = sanitizeProvider(provider);
  if (normalized === "openai") return "OpenAI";
  if (normalized === "anthropic") return "Anthropic";
  return "Local Demo";
}

function aiModeLabel(provider, mode) {
  return isLocalProvider(provider) || mode !== "live" ? "Local Demo" : "Live API";
}

function safeAiErrorMessage(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const raw = String(error?.message || error || "").toLowerCase();
  if (status === 401 || status === 403 || raw.includes("incorrect api key") || raw.includes("invalid api key")) {
    return "OpenAI API is configured but the API key was rejected. Check the Railway key and OpenAI project.";
  }
  if (
    status === 429
    || raw.includes("quota")
    || raw.includes("billing")
    || raw.includes("credit")
    || raw.includes("insufficient_quota")
    || raw.includes("rate limit")
  ) {
    return "OpenAI API is configured but not active. Check billing, credits, usage limits, or rate limits.";
  }
  if (raw.includes("model") && (raw.includes("not found") || raw.includes("does not exist") || raw.includes("invalid"))) {
    return "OpenAI API is reachable, but the selected model is not available for this project.";
  }
  if (raw.includes("fetch failed") || raw.includes("network") || raw.includes("timeout")) {
    return "OpenAI API could not be reached. Check network access and try again.";
  }
  return "OpenAI API is configured but not active. Check billing, credits, or API key.";
}

function logAiProviderError(scope, error) {
  const status = error?.status || error?.statusCode || "unknown";
  console.error(`[ai-provider:${scope}] status=${status} message=${error?.message || error}`);
}

function currentAiProviderStatus(config = readAiProviderConfig()) {
  const provider = sanitizeProvider(config.provider);
  const mode = isLocalProvider(provider) ? "demo" : sanitizeAiMode(config.mode);
  const usage = normalizeAiUsage(config.usage);
  const activeSettings = activeProviderSettings({ ...config, provider });
  const keyConfigured = provider === "openai"
    ? Boolean(keyFromConfig(config, "openai"))
    : provider === "anthropic"
      ? Boolean(keyFromConfig(config, "anthropic"))
      : false;
  const lastTest = config.lastTest || null;
  const lastError = lastTest?.success === false ? lastTest.message || lastTest.error || "Provider test failed." : "";
  let connectionStatus = "Not configured";
  if (isLocalProvider(provider) || mode !== "live") {
    connectionStatus = "Connected";
  } else if (lastError) {
    connectionStatus = "Error";
  } else if (keyConfigured) {
    connectionStatus = "Connected";
  }
  return {
    provider,
    providerLabel: aiProviderLabel(provider),
    mode,
    modeLabel: aiModeLabel(provider, mode),
    configured: isLocalProvider(provider) || keyConfigured,
    connected: connectionStatus === "Connected",
    connectionStatus,
    model: isLocalProvider(provider) ? "local-demo" : activeSettings.model || "Not selected",
    activeModel: isLocalProvider(provider) ? "local-demo" : activeSettings.model || "Not selected",
    lastTest,
    lastError,
    monthlyLimitUsd: config.monthlyLimitUsd,
    usage,
  };
}

function currentSystemStatus() {
  const state = readState();
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const approvals = Array.isArray(state.approvals) ? state.approvals : [];
  const artifacts = Array.isArray(state.artifacts) ? state.artifacts : [];
  const audit = Array.isArray(state.audit) ? state.audit : [];
  const memoryLayers = state.memory && typeof state.memory === "object" ? state.memory : {};
  const memoryCount = Object.values(memoryLayers).reduce((sum, entries) => sum + (Array.isArray(entries) ? entries.length : 0), 0);
  const queuedTasks = tasks.filter((task) => ["queued", "needs_revision"].includes(task.status)).length;
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending").length;
  const aiStatus = currentAiProviderStatus();
  const users = activeUserCount(readAuthStore());
  const processMemory = readArgentumProcessMemorySnapshot();
  const clippingOfficeState = readClippingOfficeStateSnapshot();
  const queueTotal = queuedTasks + pendingApprovals;
  const agentHealth = aiStatus.connectionStatus === "Error" || !clippingOfficeState.available ? "Needs attention" : "Online";
  const health = aiStatus.connectionStatus === "Error"
    ? "OpenAI needs attention"
    : !clippingOfficeState.available
      ? "Clipping Office state unavailable"
    : "Local systems operational";
  const memoryMb = Math.round(Number(processMemory.totalBytes || 0) / 1024 ** 2);

  return {
    health,
    agentHealth,
    agentMode: state.agent?.mode || "Draft only",
    metrics: [
      { label: "Runtime", value: "Online", percent: 100, measured: true },
      { label: "Queued work", value: String(queueTotal), percent: null, measured: true },
      { label: "Argentum RAM", value: `${memoryMb} MB`, percent: processMemory.percentOfSystem, measured: true },
      { label: "Human Gate", value: users > 0 ? pendingApprovals ? `${pendingApprovals} pending` : "Clear" : "Setup", percent: users > 0 ? 100 : null, measured: true },
    ],
    chart: [],
    counts: {
      queuedTasks,
      pendingApprovals,
      memoryCount,
      artifacts: artifacts.length,
      audit: audit.length,
      queueTotal,
    },
    memory: processMemory,
    dataQuality: {
      mode: "measured",
      estimatedFields: [],
      sampledAt: processMemory.measuredAt,
    },
    ai: {
      provider: aiStatus.providerLabel,
      mode: aiStatus.modeLabel,
      connectionStatus: aiStatus.connectionStatus,
    },
    updatedAt: now(),
  };
}

function safeDisplayText(value, limit = 180) {
  return redactSensitiveText(String(value ?? "").replace(/\s+/g, " ").trim()).slice(0, limit);
}

function displayStatusCount(records = [], statuses = []) {
  const allowed = new Set(statuses);
  return listFrom(records).filter((record) => allowed.has(String(record?.status || record?.state || "").toLowerCase())).length;
}

function displayActiveStatus(value = "") {
  const status = String(value || "").toLowerCase();
  return INFRASTRUCTURE_ACTIVE_STATUSES.has(status) || ["active", "working", "watching", "connecting"].includes(status);
}

function buildAgentDisplaySummary(state = {}, infrastructure = null) {
  const tasks = listFrom(state.tasks);
  const missions = listFrom(state.agent101Missions);
  const runs = listFrom(state.agent101Runs);
  const activeWork = [...missions, ...runs, ...tasks].find((item) => displayActiveStatus(item.status || item.state));
  const missionStep = listFrom(state.mission?.steps)[Number(state.mission?.currentStep || 0)] || null;
  const agentNodes = listFrom(infrastructure?.nodes).filter((node) => node.kind === "agent");
  const agentNode = agentNodes.find((node) => node.id === "agent:agent-101") || agentNodes[0] || {};
  const queuedTasks = displayStatusCount(tasks, ["queued", "needs_revision", "pending"]);
  const runningTasks = displayStatusCount(tasks, ["running", "processing", "in_progress", "drafting", "verifying"]);
  const completedTasks = displayStatusCount(tasks, ["complete", "completed", "approved"]);
  const activeMissions = missions.filter((mission) => displayActiveStatus(mission.status)).length;
  const activeRuns = runs.filter((run) => displayActiveStatus(run.status)).length;
  const pendingApprovals = listFrom(state.approvals).filter((approval) => approval.status === "pending").length;
  const currentTask = activeWork?.title
    || activeWork?.prompt
    || activeWork?.mission
    || missionStep?.title
    || "Standing by for bounded work";

  return {
    status: safeDisplayText(state.agent101?.status || agentNode.lifecycle || "Active supervised", 80),
    currentTask: safeDisplayText(currentTask, 220),
    mode: safeDisplayText(state.agent101?.mode || state.agent?.mode || "Supervised internal work", 120),
    activeAgents: Math.max(1, agentNodes.filter((node) => node.availability !== "offline").length || 1),
    queuedTasks,
    runningTasks: runningTasks + activeMissions + activeRuns,
    completedTasks,
    activeMissions,
    activeRuns,
    pendingApprovals,
    agents: [
      {
        id: "agent-1010",
        label: "Agent 1010",
        status: safeDisplayText(state.agent101?.status || agentNode.lifecycle || "Active supervised", 80),
        office: safeDisplayText(state.agent101?.currentOffice || "Control Floor", 80),
        authority: "Human Gate external actions",
      },
    ],
  };
}

function buildClippingDisplaySummary() {
  try {
    const dashboard = buildClipOfficeDashboardSnapshot();
    const raw = readClippingOfficeStateSnapshot();
    const pendingApprovals = listFrom(raw.approvalRequests).filter((approval) => String(approval.status || "").toLowerCase() === "pending").length;
    const postingQueue = listFrom(raw.postingDrafts).filter((draft) => !["approved", "posted", "published", "dismissed", "rejected"].includes(String(draft.status || draft.approvalStatus || "").toLowerCase())).length;
    return {
      available: dashboard.available,
      status: dashboard.status,
      monitoringStatus: dashboard.automation.enabled ? dashboard.automation.status : dashboard.status,
      headline: safeDisplayText(dashboard.headline || "Office standing by", 140),
      streamsWatched: dashboard.metrics.activeStreams,
      streams: listFrom(dashboard.watchers).slice(0, 6).map((watcher) => ({
        id: safeDisplayText(watcher.id, 80),
        streamerName: safeDisplayText(watcher.streamerName || "Live stream", 80),
        platform: safeDisplayText(watcher.platform || "live", 32),
        status: safeDisplayText(watcher.status || "watching", 48),
        bufferedSeconds: watcher.bufferedSeconds,
        messagesPerMinute: watcher.messagesPerMinute,
      })),
      clipCandidates: dashboard.metrics.capturedClips,
      clipsQueued: dashboard.metrics.discovery + dashboard.metrics.studio + dashboard.metrics.precheck,
      clipsAwaitingApproval: pendingApprovals,
      postingQueue,
      workflow: dashboard.workflow,
      recentClips: listFrom(dashboard.recentClips).slice(0, 6).map((clip) => ({
        id: safeDisplayText(clip.id, 80),
        title: safeDisplayText(clip.title || "Clip candidate", 120),
        streamerName: safeDisplayText(clip.streamerName || "", 80),
        stage: safeDisplayText(clip.stage || "discovery", 40),
        quality: clip.quality,
        updatedAt: clip.updatedAt || null,
      })),
      activity: listFrom(dashboard.activity).slice(0, 6),
      updatedAt: dashboard.updatedAt || dashboard.sampledAt || null,
      error: dashboard.error || null,
    };
  } catch (error) {
    return {
      available: false,
      status: "offline",
      monitoringStatus: "unavailable",
      headline: "Clipping Office state unavailable",
      streamsWatched: null,
      streams: [],
      clipCandidates: null,
      clipsQueued: null,
      clipsAwaitingApproval: null,
      postingQueue: null,
      workflow: [],
      recentClips: [],
      activity: [],
      updatedAt: null,
      error: safeDisplayText(error.message || "Unavailable", 160),
    };
  }
}

function buildTradingDisplaySummary(state = {}) {
  try {
    const permissions = stockPermissions("viewer");
    const snapshot = stockOfficeSnapshot(state, permissions, { cachedIntelligence: true });
    const overview = stockOverview(snapshot);
    const brokerControl = brokerControlOverview(snapshot);
    const scheduler = stockIntelligenceScheduler.getStatus();
    const session = marketSession(new Date());
    const tradeDrafts = listFrom(overview.tradeDrafts);
    const attentionDrafts = tradeDrafts.filter((draft) => ["awaiting_human_gate", "approved", "dispatch_claimed", "stopped", "failed"].includes(String(draft.status || "").toLowerCase()));
    const positions = listFrom(overview.broker?.positions).slice(0, 6).map((position) => ({
      symbol: safeDisplayText(position.symbol || position.instrument || "POSITION", 20),
      quantity: position.quantity ?? position.shares ?? null,
      marketValue: position.marketValue || position.market_value || null,
      currentPrice: position.currentPrice || position.current_price || null,
    }));
    const sourceHealth = overview.sourceHealth || {};
    const providerHealth = overview.providerHealth || {};
    return {
      available: overview.available !== false,
      status: overview.killSwitch?.active ? "halted" : brokerControl.liveReady ? "live-ready gated" : "research guarded",
      marketState: safeDisplayText(overview.marketContext?.riskState || overview.marketContext?.regime || session.label || session.status || "unknown", 80),
      researchStatus: scheduler.running ? "running" : safeDisplayText(sourceHealth.status || providerHealth.status || "idle", 80),
      sourceHealth: {
        status: safeDisplayText(sourceHealth.status || "unknown", 80),
        ready: sourceHealth.ready ?? null,
        stale: sourceHealth.stale ?? null,
        error: sourceHealth.error ?? null,
      },
      positionsSummary: {
        count: positions.length,
        accountValue: overview.broker?.accountValue || null,
        cash: overview.broker?.cash || null,
        buyingPower: overview.broker?.buyingPower || null,
        updatedAt: overview.broker?.updatedAt || null,
        positions,
      },
      ordersRequiringAttention: attentionDrafts.length,
      tradeDrafts: attentionDrafts.slice(0, 5).map((draft) => ({
        id: safeDisplayText(draft.id, 80),
        side: safeDisplayText(draft.side || "", 12),
        symbol: safeDisplayText(draft.symbol || "", 16),
        status: safeDisplayText(draft.status || "draft", 48),
        expiresAt: draft.expiresAt || null,
      })),
      alerts: listFrom(overview.alerts).slice(0, 6).map((alert) => ({
        level: safeDisplayText(alert.level || "info", 20),
        title: safeDisplayText(alert.title || "Stock Office alert", 120),
        body: safeDisplayText(alert.body || "", 180),
      })),
      activity: listFrom(overview.activity).slice(0, 6),
      scheduler: {
        running: Boolean(scheduler.running),
        lastCompletedAt: scheduler.lastCompletedAt || null,
        nextRunAt: scheduler.nextRunAt || null,
      },
      updatedAt: overview.generatedAt || null,
    };
  } catch (error) {
    return {
      available: false,
      status: "unavailable",
      marketState: "unknown",
      researchStatus: "unavailable",
      sourceHealth: { status: "unknown", ready: null, stale: null, error: null },
      positionsSummary: { count: null, accountValue: null, cash: null, buyingPower: null, updatedAt: null, positions: [] },
      ordersRequiringAttention: null,
      tradeDrafts: [],
      alerts: [{ level: "warning", title: "Stock Office unavailable", body: safeDisplayText(error.message || "Stock Office summary could not be read.", 180) }],
      activity: [],
      scheduler: { running: false, lastCompletedAt: null, nextRunAt: null },
      updatedAt: null,
    };
  }
}

function buildHumanGateDisplaySummary(state = {}) {
  const approvals = listFrom(state.approvals)
    .filter((approval) => approval.status === "pending")
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  return {
    pending: approvals.length,
    approvals: approvals.slice(0, 10).map((approval) => {
      const risk = String(approval.riskLevel || approval.risk || "medium").toLowerCase();
      return {
        id: safeDisplayText(approval.id, 100),
        title: safeDisplayText(approval.title || "Approval required", 140),
        category: safeDisplayText(approval.officeId || approval.workflowId || approval.actionType || "central", 80),
        urgency: risk.includes("high") ? "high" : risk.includes("low") ? "low" : "medium",
        originatingSystem: safeDisplayText(approval.officeId || approval.metadata?.officeId || approval.source || "Argentum", 80),
        createdAt: approval.createdAt || null,
      };
    }),
  };
}

function buildDisplayActivityFeed(state = {}, clipping = {}, trading = {}, display = {}) {
  const items = [
    ...listFrom(state.audit).slice(0, 10).map((entry) => ({
      id: entry.id,
      source: "Audit",
      title: safeDisplayText(entry.title || "Argentum event", 120),
      detail: safeDisplayText(entry.body || "", 180),
      createdAt: entry.createdAt || null,
    })),
    ...listFrom(clipping.activity).slice(0, 6).map((entry) => ({
      id: `clip:${entry.id || entry.createdAt || Math.random()}`,
      source: "Clipping",
      title: safeDisplayText(entry.title || entry.type || "Clipping update", 120),
      detail: safeDisplayText(entry.detail || "", 180),
      createdAt: entry.createdAt || null,
    })),
    ...listFrom(trading.activity).slice(0, 6).map((entry) => ({
      id: `stock:${entry.id || entry.createdAt || Math.random()}`,
      source: "Trading",
      title: safeDisplayText(entry.title || entry.type || "Stock Office update", 120),
      detail: safeDisplayText(entry.body || entry.detail || "", 180),
      createdAt: entry.createdAt || entry.updatedAt || null,
    })),
  ];
  if (display.lastCommandAt) {
    items.push({
      id: `display-command:${display.commandVersion}`,
      source: "Display",
      title: `View changed to ${display.view}`,
      detail: `Command source: ${display.lastCommandSource || "api"}`,
      createdAt: display.lastCommandAt,
    });
  }
  return items
    .filter((item) => item.title)
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
    .slice(0, 14);
}

function buildDisplayAlertSummary(system = {}, humanGate = {}, trading = {}, infrastructure = null, display = {}) {
  const alerts = [];
  if (display.pairing) {
    alerts.push({
      level: "pairing",
      title: `Pair ${display.pairing.label}`,
      body: `Verify code ${display.pairing.code} on Monitor 3, then press Accept on the ESP32 screen.`,
    });
  }
  if (Number(humanGate.pending || 0) > 0) {
    alerts.push({
      level: humanGate.approvals.some((approval) => approval.urgency === "high") ? "urgent" : "attention",
      title: `${humanGate.pending} Human Gate approval${humanGate.pending === 1 ? "" : "s"} pending`,
      body: "Operator review is required before external or risky work can continue.",
    });
  }
  listFrom(trading.alerts).forEach((alert) => alerts.push(alert));
  listFrom(infrastructure?.warnings).slice(0, 4).forEach((warning) => {
    alerts.push({ level: "warning", title: "Infrastructure warning", body: safeDisplayText(warning, 180) });
  });
  if (/attention|unavailable|error/i.test(system.health || "")) {
    alerts.push({ level: "warning", title: "System attention", body: safeDisplayText(system.health, 180) });
  }
  return alerts.slice(0, 10);
}

function buildDisplayStateDelta(state = {}, reason = "state.write") {
  const tasks = listFrom(state.tasks);
  const approvals = listFrom(state.approvals);
  const display = publicDisplayState(state);
  const missionStep = listFrom(state.mission?.steps)[Number(state.mission?.currentStep || 0)] || null;
  return {
    reason,
    display,
    agent: {
      status: safeDisplayText(state.agent101?.status || "Active supervised", 80),
      currentTask: safeDisplayText(missionStep?.title || "Standing by", 160),
    },
    counts: {
      queuedTasks: displayStatusCount(tasks, ["queued", "needs_revision", "pending"]),
      runningTasks: displayStatusCount(tasks, ["running", "processing", "in_progress", "drafting", "verifying"]),
      completedTasks: displayStatusCount(tasks, ["complete", "completed", "approved"]),
      pendingApprovals: approvals.filter((approval) => approval.status === "pending").length,
    },
    updatedAt: state.meta?.updatedAt || now(),
  };
}

async function buildArgentumDisplaySnapshot(state = readState()) {
  let infrastructure = null;
  try {
    infrastructure = await controlFloorInfrastructureSnapshot(state, { includeAdminOnly: false });
  } catch (error) {
    infrastructure = {
      partial: true,
      sources: [],
      summary: {},
      nodes: [],
      warnings: [`Control Floor infrastructure unavailable: ${safeDisplayText(error.message, 140)}`],
    };
  }
  const display = publicDisplayState(state);
  const system = currentSystemStatus();
  const agents = buildAgentDisplaySummary(state, infrastructure);
  const clipping = buildClippingDisplaySummary();
  const trading = buildTradingDisplaySummary(state);
  const humanGate = buildHumanGateDisplaySummary(state);
  const alerts = buildDisplayAlertSummary(system, humanGate, trading, infrastructure, display);
  const activity = buildDisplayActivityFeed(state, clipping, trading, display);
  return {
    schemaVersion: 1,
    generatedAt: now(),
    display,
    header: {
      brand: "ARGENTUM",
      hubStatus: "HUB ONLINE",
      localConnectionStatus: "HUB ONLINE",
      activeAgentCount: agents.activeAgents,
      alertCount: alerts.length,
      currentTime: now(),
    },
    system: {
      status: system.health,
      agentHealth: system.agentHealth,
      metrics: system.metrics,
      counts: system.counts,
      ai: system.ai,
      updatedAt: system.updatedAt,
    },
    agents,
    clipping,
    trading,
    humanGate,
    activity,
    alerts,
    infrastructure: {
      partial: Boolean(infrastructure.partial),
      summary: infrastructure.summary || {},
      sources: listFrom(infrastructure.sources).map((source) => ({
        id: safeDisplayText(source.id, 80),
        status: safeDisplayText(source.status, 60),
        freshness: safeDisplayText(source.freshness, 60),
        warning: safeDisplayText(source.warning || "", 160),
      })),
    },
  };
}

function detachDisplayEventClient(client) {
  if (!client) return;
  clearInterval(client.timer);
  displayEventClients.delete(client);
}

function writeDisplaySse(client, eventName, payload = {}) {
  const eventId = `${Date.now()}-${displayEventSequence += 1}`;
  try {
    client.res.write(`id: ${eventId}\n`);
    client.res.write(`event: ${eventName}\n`);
    client.res.write(`data: ${JSON.stringify({ ...payload, type: payload.type || eventName, emittedAt: now() })}\n\n`);
  } catch {
    detachDisplayEventClient(client);
  }
}

function publishDisplayEvent(eventName, payload = {}) {
  if (!displayEventClients.size) return;
  [...displayEventClients].forEach((client) => writeDisplaySse(client, eventName, payload));
}

function queueDisplayStateChanged(state = {}, reason = "state.write") {
  if (!displayEventClients.size) return;
  const payload = buildDisplayStateDelta(state, reason);
  setImmediate(() => publishDisplayEvent("argentum.state_changed", payload));
}

async function handleDisplayEvents(req, res) {
  requireAdminAccess(req);
  res.writeHead(200, {
    ...securityHeaders(req),
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const client = { res, timer: null };
  displayEventClients.add(client);
  req.on("close", () => detachDisplayEventClient(client));
  writeDisplaySse(client, "display.snapshot", await buildArgentumDisplaySnapshot(readState()));
  client.timer = setInterval(() => {
    writeDisplaySse(client, "display.heartbeat", { display: publicDisplayState(readState()) });
  }, DISPLAY_SSE_HEARTBEAT_MS);
  client.timer.unref?.();
}

function updateDisplayHeartbeat(payload = {}, source = "hardware") {
  const state = readState();
  const display = normalizeDisplayState(state.display || {});
  const trust = displayControllerTrust(display, payload);
  const observedAt = now();
  if (trust.trusted && trust.controller) {
    trust.controller.lastSeenAt = observedAt;
    trust.controller.status = String(payload.status || "online").replace(/[^a-z0-9_.:-]/gi, "").slice(0, 80) || "online";
    display.controllerConnected = true;
    display.controllerLastSeenAt = observedAt;
    display.controllerDeviceId = trust.deviceId;
    display.controllerStatus = trust.controller.status;
  }
  display.lastCommandSource = source;
  display.updatedAt = observedAt;
  state.display = display;
  writeState(state);
  const publicState = publicDisplayState(state);
  publishDisplayEvent("display.controller", { display: publicState });
  return { ...publicState, trusted: trust.trusted, pairingRequired: !trust.trusted };
}

function navigateDisplay(payload = {}, source = "api") {
  const view = normalizeDisplayView(payload.view ?? payload.target ?? payload.targetView, null);
  if (!view) throw guardedError(`Display view must be one of: ${DISPLAY_VIEW_ORDER.join(", ")}.`, 400);
  const state = readState();
  const display = normalizeDisplayState(state.display || {});
  if (source === "hardware") {
    const trust = displayControllerTrust(display, payload);
    if (!trust.trusted) throw guardedError("Display controller is not paired. Request pairing and press Accept on the ESP32 screen first.", 403);
    if (trust.controller) {
      trust.controller.lastSeenAt = now();
      trust.controller.status = "online";
    }
  }
  const changedAt = now();
  display.view = view;
  display.lastCommandAt = changedAt;
  display.lastCommandSource = source;
  display.commandVersion += 1;
  display.updatedAt = changedAt;
  if (payload.deviceId && source !== "hardware") {
    display.controllerConnected = true;
    display.controllerLastSeenAt = changedAt;
    display.controllerDeviceId = String(payload.deviceId).replace(/[^a-z0-9_.:-]/gi, "").slice(0, 120);
    display.controllerStatus = "online";
  } else if (payload.deviceId && source === "hardware") {
    display.controllerConnected = true;
    display.controllerLastSeenAt = changedAt;
    display.controllerDeviceId = displayDeviceId(payload.deviceId);
    display.controllerStatus = "online";
  }
  state.display = display;
  audit(state, "Monitor 3 display changed", `Dedicated display view changed to ${view} by ${source}.`);
  writeState(state);
  const publicState = publicDisplayState(state);
  publishDisplayEvent("display.navigate", { display: publicState, view, source });
  return publicState;
}

function createDisplayPairingRequest(payload = {}) {
  const deviceId = displayDeviceId(payload.deviceId);
  if (!deviceId) throw guardedError("A display controller deviceId is required for pairing.", 400);
  const state = readState();
  const display = normalizeDisplayState(state.display || {});
  const requestedAt = now();
  display.pairing = {
    deviceId,
    label: displayDeviceLabel(payload.label || payload.deviceLabel || deviceId),
    code: displayPairingCode(),
    status: "pending",
    requestedAt,
    expiresAt: new Date(Date.now() + DISPLAY_PAIRING_TTL_MS).toISOString(),
    acceptedAt: null,
  };
  display.updatedAt = requestedAt;
  state.display = display;
  audit(state, "Monitor 3 controller pairing requested", `${display.pairing.label} requested display control pairing. Verify the code on Monitor 3 before accepting on the controller.`);
  writeState(state);
  const publicState = publicDisplayState(state);
  publishDisplayEvent("display.pairing_requested", { display: publicState, pairing: publicState.pairing });
  return publicState;
}

function acceptDisplayPairing(payload = {}) {
  const deviceId = displayDeviceId(payload.deviceId);
  const pairingCode = String(payload.pairingCode || payload.code || "").replace(/\D/g, "");
  if (!deviceId || !pairingCode) throw guardedError("deviceId and pairingCode are required to accept display pairing.", 400);
  const state = readState();
  const display = normalizeDisplayState(state.display || {});
  const pairing = normalizeDisplayPairing(display.pairing);
  const expiresAt = Date.parse(pairing?.expiresAt || "");
  if (!pairing || pairing.status !== "pending" || pairing.deviceId !== deviceId || pairing.code !== pairingCode || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw guardedError("Display pairing request is not valid or has expired.", 403);
  }
  const deviceToken = crypto.randomBytes(32).toString("base64url");
  const acceptedAt = now();
  const controller = {
    deviceId,
    label: pairing.label,
    pairedAt: acceptedAt,
    lastSeenAt: acceptedAt,
    status: "online",
    tokenHash: displayTokenHash(deviceToken),
  };
  display.trustedControllers = [controller, ...display.trustedControllers.filter((item) => item.deviceId !== deviceId)].slice(0, 8);
  display.pairing = { ...pairing, status: "accepted", acceptedAt };
  display.controllerConnected = true;
  display.controllerLastSeenAt = acceptedAt;
  display.controllerDeviceId = deviceId;
  display.controllerStatus = "online";
  display.updatedAt = acceptedAt;
  state.display = display;
  audit(state, "Monitor 3 controller paired", `${pairing.label} was paired from the ESP32 accept button. Future hardware navigation requires its one-device token.`);
  writeState(state);
  const publicState = publicDisplayState(state);
  publishDisplayEvent("display.controller", { display: publicState });
  return { display: publicState, deviceToken };
}

function handleHardwareDisplayCommand(payload = {}) {
  const action = String(payload.action || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (action === "request_pairing" || action === "pairing_request" || action === "pair") {
    return { display: createDisplayPairingRequest(payload), action: "request_pairing" };
  }
  if (action === "accept_pairing" || action === "accept") {
    return { ...acceptDisplayPairing(payload), action: "accept_pairing" };
  }
  if (action === "navigate") {
    return { display: navigateDisplay({ view: payload.target || payload.view, deviceId: payload.deviceId, deviceToken: payload.deviceToken || payload.token }, "hardware"), action };
  }
  if (action === "return_home") {
    return { display: navigateDisplay({ view: "home", deviceId: payload.deviceId, deviceToken: payload.deviceToken || payload.token }, "hardware"), action };
  }
  if (action === "heartbeat" || action === "status") {
    return { display: updateDisplayHeartbeat(payload, "hardware"), action };
  }
  throw guardedError("Unsupported display hardware action. Allowed actions: request_pairing, accept_pairing, navigate, return_home, heartbeat, status.", 400);
}

function publicAiProviderSettings(config = readAiProviderConfig()) {
  const provider = sanitizeProvider(config.provider);
  const mode = isLocalProvider(provider) ? "demo" : sanitizeAiMode(config.mode);
  const activeSettings = activeProviderSettings({ ...config, provider });
  const status = currentAiProviderStatus(config);
  return {
    provider,
    providerLabel: status.providerLabel,
    mode,
    modeLabel: status.modeLabel,
    configured: status.configured,
    connected: status.connected,
    connectionStatus: status.connectionStatus,
    activeModel: status.activeModel,
    lastError: status.lastError,
    monthlyLimitUsd: status.monthlyLimitUsd,
    usage: status.usage,
    temperature: activeSettings.temperature,
    maxOutputTokens: activeSettings.maxOutputTokens,
    lastTest: config.lastTest || null,
    providers: {
      local_demo: {
        keyConfigured: false,
        keyStatus: "No key required",
        model: "local-demo",
      },
      openai: {
        keyConfigured: Boolean(keyFromConfig(config, "openai")),
        keyStatus: keyFromConfig(config, "openai") ? "Key saved securely" : "Not configured",
        keySource: keySource(config, "openai"),
        keyStorageLabel: secureSecrets.publicStorageLabel(keySource(config, "openai")),
        model: config.providers.openai.model,
        temperature: config.providers.openai.temperature,
        maxOutputTokens: config.providers.openai.maxOutputTokens,
      },
      anthropic: {
        keyConfigured: Boolean(keyFromConfig(config, "anthropic")),
        keyStatus: keyFromConfig(config, "anthropic") ? "Key saved securely" : "Not configured",
        keySource: keySource(config, "anthropic"),
        keyStorageLabel: secureSecrets.publicStorageLabel(keySource(config, "anthropic")),
        model: config.providers.anthropic.model,
        temperature: config.providers.anthropic.temperature,
        maxOutputTokens: config.providers.anthropic.maxOutputTokens,
      },
    },
    storageNote: APP_MODE === "local"
      ? "API keys are held server-side only. Local saved keys use Mac Keychain when available."
      : "API keys are held server-side only. Prefer environment variables on Railway; cloud saved keys live in ignored backend config.",
  };
}

function updateAiProviderSettings(payload) {
  const config = readAiProviderConfig();
  const provider = sanitizeProvider(payload.provider || config.provider);
  const mode = isLocalProvider(provider) ? "demo" : sanitizeAiMode(payload.mode || config.mode || "live");
  config.provider = provider;
  config.mode = mode;
  if (provider === "openai" || provider === "anthropic") {
    const current = config.providers[provider];
    const temperature = Number(payload.temperature);
    const maxOutputTokens = Number(payload.maxOutputTokens);
    config.providers[provider] = {
      ...current,
      model: String(payload.model || current.model || "").trim() || current.model,
      temperature: Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : current.temperature,
      maxOutputTokens: Number.isFinite(maxOutputTokens) ? Math.max(64, Math.min(4096, Math.round(maxOutputTokens))) : current.maxOutputTokens,
    };
  }
  return publicAiProviderSettings(writeAiProviderConfig(config));
}

function estimatedAiCostUsd(usage = {}) {
  const inputTokens = Number(usage.input_tokens || usage.inputTokens || 0);
  const outputTokens = Number(usage.output_tokens || usage.outputTokens || 0);
  if ((!Number.isFinite(inputTokens) || inputTokens <= 0) && (!Number.isFinite(outputTokens) || outputTokens <= 0)) return 0;
  const cost = (Math.max(0, inputTokens) * AI_BUDGET_INPUT_USD_PER_MILLION / 1_000_000)
    + (Math.max(0, outputTokens) * AI_BUDGET_OUTPUT_USD_PER_MILLION / 1_000_000);
  return Math.ceil(cost * 10000) / 10000;
}

function estimatedAiInputTokens(value) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return Math.max(256, Math.min(250_000, Math.ceil(Buffer.byteLength(serialized, "utf8") / 4)));
}

function reserveAiRequest(provider, model, requestBody, maxOutputTokens) {
  return reserveAiUsage({
    provider,
    model,
    estimatedInputTokens: estimatedAiInputTokens(requestBody),
    maxOutputTokens: Math.max(1, Number(maxOutputTokens || 0)),
  });
}

function activeAiReservationUsd() {
  return [...aiBudgetReservations.values()].reduce((total, reservation) => total + Number(reservation.amountUsd || 0), 0);
}

function reserveAiUsage({ provider, model, estimatedInputTokens = 16_000, maxOutputTokens = 2_000, estimatedCostUsd = 0 } = {}) {
  const config = readAiProviderConfig();
  const amountUsd = Math.max(
    estimatedAiCostUsd({ inputTokens: estimatedInputTokens, outputTokens: maxOutputTokens }),
    Math.max(0, Number(estimatedCostUsd || 0)),
  );
  const usage = normalizeAiUsage(config.usage);
  const limit = parseMonthlyLimit(config.monthlyLimitUsd, 10);
  const projected = usage.estimatedMonthlyUsd + activeAiReservationUsd() + amountUsd;
  if (limit > 0 && projected > limit) {
    config.usage = { ...usage, blockedByLimit: true, lastError: "AI monthly spending limit would be exceeded by the next reserved call." };
    writeAiProviderConfig(config);
    throw guardedError("AI monthly spending limit would be exceeded by the next model call. Use Local Demo Mode or raise the operator-controlled limit.", 402);
  }
  const id = `ai-reservation-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
  aiBudgetReservations.set(id, { id, provider, model, amountUsd, createdAt: now() });
  return id;
}

function releaseAiUsageReservation(reservationId) {
  if (reservationId) aiBudgetReservations.delete(reservationId);
}

function aiUsageLimitReached(config) {
  const usage = normalizeAiUsage(config.usage);
  const limit = parseMonthlyLimit(config.monthlyLimitUsd, 10);
  return limit > 0 && usage.estimatedMonthlyUsd >= limit;
}

function aiUsageBudgetStatus(config) {
  const usage = normalizeAiUsage(config.usage);
  const limit = parseMonthlyLimit(config.monthlyLimitUsd, 10);
  const inFlightReservedUsd = activeAiReservationUsd();
  const projectedMonthlyUsd = usage.estimatedMonthlyUsd + inFlightReservedUsd;
  const ratio = limit > 0 ? projectedMonthlyUsd / limit : 0;
  return {
    limitUsd: limit,
    estimatedMonthlyUsd: usage.estimatedMonthlyUsd,
    inFlightReservedUsd,
    projectedMonthlyUsd,
    percentUsed: limit > 0 ? Math.min(100, Math.round(ratio * 100)) : 0,
    warning: limit > 0 && ratio >= 0.75 && ratio < 1,
    blocked: limit > 0 && ratio >= 1,
  };
}

function assertAiUsageBudget(config) {
  const latest = readAiProviderConfig();
  if (!aiUsageBudgetStatus(latest).blocked) return latest;
  latest.usage = {
    ...normalizeAiUsage(latest.usage),
    blockedByLimit: true,
    lastError: "AI monthly spending limit reached.",
  };
  writeAiProviderConfig(latest);
  throw guardedError("AI monthly spending limit reached. Agent 101 used Local Demo Mode fallback.", 402);
}

function recordAiUsage(config, usage = {}, options = {}) {
  releaseAiUsageReservation(options.reservationId);
  const latest = readAiProviderConfig();
  const current = normalizeAiUsage(latest.usage);
  const inputTokens = Number(usage.input_tokens || usage.inputTokens || 0);
  const outputTokens = Number(usage.output_tokens || usage.outputTokens || 0);
  latest.usage = {
    ...current,
    requestCount: current.requestCount + 1,
    inputTokens: current.inputTokens + (Number.isFinite(inputTokens) ? inputTokens : 0),
    outputTokens: current.outputTokens + (Number.isFinite(outputTokens) ? outputTokens : 0),
    estimatedMonthlyUsd: Math.round((current.estimatedMonthlyUsd + Math.max(estimatedAiCostUsd(usage), Math.max(0, Number(options.estimatedCostUsd || 0)))) * 10000) / 10000,
    lastCallAt: now(),
    lastError: null,
  };
  latest.usage.blockedByLimit = aiUsageLimitReached(latest);
  if (aiUsageBudgetStatus(latest).warning && !latest.usage.warnedAt) latest.usage.warnedAt = now();
  writeAiProviderConfig(latest);
  if (config && typeof config === "object") config.usage = latest.usage;
  return latest.usage;
}

function recordAiProviderFailure(config, message, reservationId = "") {
  releaseAiUsageReservation(reservationId);
  const latest = readAiProviderConfig();
  latest.usage = {
    ...normalizeAiUsage(latest.usage),
    lastError: String(message || "Provider error").slice(0, 240),
  };
  writeAiProviderConfig(latest);
  if (config && typeof config === "object") config.usage = latest.usage;
}

function saveAiProviderKey(payload) {
  const provider = sanitizeProvider(payload.provider);
  if (!["openai", "anthropic"].includes(provider)) {
    throw guardedError("Choose OpenAI or Anthropic before saving a provider key.", 400);
  }
  const apiKey = String(payload.apiKey || "").trim();
  if (apiKey.length < 12) {
    throw guardedError("API key is too short.", 400);
  }
  const config = readAiProviderConfig();
  config.keys = config.keys || {};
  if (APP_MODE === "local") {
    const saved = secureSecrets.setSecret({
      dataDir: DATA_DIR,
      provider,
      value: apiKey,
      preferKeychain: true,
    });
    config.keys[provider] = {
      storage: saved.storage,
      configured: true,
      updatedAt: saved.updatedAt,
    };
    localDatabase.upsertSecretMetadata(DATA_DIR, provider, saved.storage, true);
    const state = readState();
    audit(state, "Provider key saved", `${aiProviderLabel(provider)} key saved to ${secureSecrets.publicStorageLabel(saved.storage)}.`);
    writeState(state);
  } else {
    config.keys[provider] = apiKey;
  }
  writeAiProviderConfig(config);
  return publicAiProviderSettings(config);
}

function removeAiProviderKey(payload) {
  const provider = sanitizeProvider(payload.provider);
  if (!["openai", "anthropic"].includes(provider)) {
    throw guardedError("Choose OpenAI or Anthropic before removing a provider key.", 400);
  }
  const config = readAiProviderConfig();
  if (config.keys?.[provider] && APP_MODE === "local") {
    const storage = typeof config.keys[provider] === "object" ? config.keys[provider].storage : "";
    secureSecrets.deleteSecret({ dataDir: DATA_DIR, provider, storage });
    localDatabase.upsertSecretMetadata(DATA_DIR, provider, storage || "secure_store", false);
    const state = readState();
    audit(state, "Provider key removed", `${aiProviderLabel(provider)} key removed from local secure storage.`);
    writeState(state);
  }
  if (config.keys) delete config.keys[provider];
  writeAiProviderConfig(config);
  return publicAiProviderSettings(config);
}

function localRuntimeStatusPayload() {
  return localRuntime.publicRuntimeStatus({
    appMode: APP_MODE,
    host: HOST,
    port: PORT,
    dataDir: DATA_DIR,
    dbStatus: localDatabaseStatus || (APP_MODE === "local" ? localDatabase.status(DATA_DIR) : null),
  });
}

function createLocalAgentJob(payload = {}) {
  const goal = String(payload.goal || payload.message || "").trim();
  if (!goal) throw guardedError("Local job goal is required.", 400);
  const risky = detectRiskyAction(goal);
  if (risky && requiresHumanGate(risky)) {
    const approval = createHumanGatePackage({
      title: `Review local agent action: ${risky}`,
      message: goal,
      actionType: risky,
      risk: "high",
      evidence: "Local job runner detected a dangerous desktop action. Nothing was executed.",
    }).approval;
    const job = localDatabase.enqueueAgentJob(DATA_DIR, {
      goal,
      riskLevel: "high",
      requiresApproval: true,
      approvalId: approval.id,
      status: "waiting_approval",
    });
    localDatabase.recordLocalAudit(DATA_DIR, {
      actor: "agent-101",
      action: "Local job blocked by Human Gate",
      detail: `${risky}: ${goal}`,
    });
    return { job, approval, requiresApproval: true };
  }
  const job = localDatabase.enqueueAgentJob(DATA_DIR, {
    goal,
    riskLevel: payload.riskLevel || "low",
    requiresApproval: false,
    status: "queued",
  });
  localDatabase.recordLocalAudit(DATA_DIR, {
    actor: "agent-101",
    action: "Local job queued",
    detail: goal,
  });
  return { job, requiresApproval: false };
}

function runNextLocalAgentJob() {
  const job = localDatabase.listAgentJobs(DATA_DIR, 50).reverse().find((item) => item.status === "queued");
  if (!job) return { job: null, message: "No queued local jobs." };
  const result = {
    summary: "Local Agent 101 job completed in draft-only mode. No external action was executed.",
    completedAt: now(),
    output: localDepoDemoResponse(job.goal),
  };
  localDatabase.updateAgentJob(DATA_DIR, job.id, { status: "complete", result });
  const state = readState();
  audit(state, "Local agent job completed", job.goal);
  writeState(state);
  return { job: { ...job, status: "complete", result }, result };
}

function localWorkspacePermissions(payload = {}) {
  return {
    read: payload.read !== false,
    write: payload.write === true,
    delete: false,
    agentAccess: payload.agentAccess === true,
  };
}

function addLocalFileWorkspace(payload = {}) {
  const folderPath = path.resolve(String(payload.folderPath || payload.path || "").trim());
  if (!folderPath || folderPath === path.parse(folderPath).root) {
    throw guardedError("Choose a specific folder, not the whole disk.", 400);
  }
  if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
    throw guardedError("Folder does not exist or is not a directory.", 400);
  }
  const permissions = localWorkspacePermissions(payload.permissions || payload);
  const workspace = localDatabase.upsertFileWorkspace(DATA_DIR, {
    folderPath,
    label: String(payload.label || path.basename(folderPath) || "Local workspace").slice(0, 80),
    permissions,
  });
  localDatabase.logFileAccess(DATA_DIR, {
    workspaceId: workspace.id,
    action: "grant_workspace",
    filePath: folderPath,
    allowed: true,
    reason: "Operator manually added folder workspace.",
  });
  const state = readState();
  audit(state, "Local file workspace added", `${workspace.label}: read=${permissions.read}, write=${permissions.write}, agentAccess=${permissions.agentAccess}.`);
  writeState(state);
  return workspace;
}

function detectRiskyAction(text) {
  const value = String(text || "").toLowerCase();
  const checks = [
    ["publish_video", ["publish video", "post video", "post this video", "upload video", "upload this video", "publish the clip", "post the clip", "post to tiktok", "post this to tiktok", "post it to tiktok", "post to instagram", "post to youtube"]],
    ["direct_post", ["direct post", "post it live", "publish now", "go live", "make this live", "send it live"]],
    ["upload_to_tiktok", ["upload to tiktok", "upload this to tiktok", "tiktok upload"]],
    ["publish", ["publish", "post listing", "go live", "external publish"]],
    ["spend_money", ["spend money", "buy ", "purchase", "pay for", "charge card"]],
    ["move_money", ["move money", "transfer money", "wire funds", "withdraw"]],
    ["contact_customer", ["contact customer", "email customer", "call customer", "message customer"]],
    ["change_account_settings", ["change account setting", "update profile", "change profile", "delete post"]],
    ["access_payment_methods", ["payment method", "ad settings", "billing settings", "payment settings"]],
    ["modify_account", ["modify account", "change account", "update account", "delete account"]],
    ["create_live_agent", ["create live agent", "activate agent", "launch agent", "make agent live"]],
    ["modify_permissions", ["modify permission", "edit permission"]],
    ["change_permissions", ["change permission", "grant permission", "admin permission"]],
    ["change_api_key", ["change api key", "rotate key", "replace key"]],
    ["delete_file", ["delete file", "delete files", "remove file", "remove files", "wipe folder", "erase folder"]],
    ["write_file", ["write file", "write files", "modify file", "modify files", "edit file", "edit files", "overwrite file"]],
    ["send_email", ["send email", "email this", "mail customer", "send message", "send outreach"]],
    ["change_system_settings", ["change system setting", "change mac setting", "system settings", "grant full disk access", "install extension"]],
    ["deploy_campaign", ["deploy campaign", "launch campaign", "send campaign"]],
    ["external_api_action", ["call external api", "run external api", "external api action"]],
    ["browser_login", ["log in for me", "login for me", "use my login", "sign into", "sign in to my account"]],
    ["payment_action", ["payment action", "use payment", "add card", "charge this", "buy with my card"]],
  ];
  const match = checks.find(([, phrases]) => phrases.some((phrase) => value.includes(phrase)));
  return match ? match[0] : null;
}

function isClipsOfficeIntakeRequest(text) {
  const value = String(text || "").toLowerCase();
  const clipsTerms = [
    "clip",
    "clipping",
    "streamer",
    "stream",
    "twitch",
    "kick",
    "capcut",
    "tiktok",
    "youtube shorts",
    "short-form",
    "short form",
  ];
  return clipsTerms.some((term) => value.includes(term));
}

function normalizedAgent101ChatHistory(context = {}) {
  const incoming = Array.isArray(context.chatHistory) ? context.chatHistory : [];
  return incoming
    .map((message) => {
      const rawRole = String(message?.speaker || message?.role || message?.sender || "").toLowerCase();
      const speaker = ["operator", "user"].includes(rawRole)
        ? "operator"
        : ["agent", "assistant", "depo"].includes(rawRole)
          ? "agent"
          : rawRole === "tool"
            ? "tool"
            : "agent";
      return {
        speaker,
        text: String(message?.text || message?.content || message?.message || "").trim().slice(0, 1000),
        roomId: String(message?.roomId || message?.metadata?.roomId || context.roomId || context.officeId || "").slice(0, 80),
        createdAt: message?.createdAt && !Number.isNaN(Date.parse(message.createdAt)) ? message.createdAt : undefined,
      };
    })
    .filter((message) => message.text)
    .slice(-18);
}

function hasClipsOfficeChatContext(context = {}) {
  return normalizedAgent101ChatHistory(context).some((message) => {
    const text = message.text.toLowerCase();
    return text.includes("clips office")
      || text.includes("auto-clipping")
      || text.includes("auto clipping")
      || text.includes("streamer scoring")
      || text.includes("capcut")
      || text.includes("clip radar")
      || text.includes("clipping");
  });
}

function buildClipsOfficeIntakeResponse(message, context = {}) {
  return buildClipOfficeExecutiveResponse(message, { ...context, roomId: context.roomId || context.officeId || context.office || "clips-office" });
}

function buildClipsOfficeFollowupResponse(message, context = {}) {
  return buildClipOfficeExecutiveResponse(message, context);
}

function shouldUseClipsOfficeIntake(message, context = {}, response = null) {
  const hasClipsContext = isClipsOfficeIntakeRequest(message) || hasClipsOfficeChatContext(context);
  if (!hasClipsContext) return false;
  if (detectRiskyAction(message)) return false;
  if (!response) return true;
  const responseText = [
    response.message,
    response.blockedAction,
    ...(response.logs || []),
  ].join(" ").toLowerCase();
  return Boolean(response.requiresApproval || response.blockedAction || /cannot help|can't help|impersonat|deceptive|claiming/.test(responseText));
}

function requiresHumanGate(actionType) {
  return AI_RISKY_ACTION_TYPES.has(actionType);
}

function localDepoDemoResponse(message) {
  const text = String(message || "").toLowerCase();
  if (text.includes("clip") || text.includes("capcut") || text.includes("tiktok") || text.includes("short video")) {
    return "Clips Office plan: 1. define goal and audience, 2. list raw footage/audio/script assets, 3. create three hook-first clip structures, 4. prepare CapCut handoff notes, 5. draft TikTok/Instagram/YouTube captions, 6. package the posting decision for Human Gate. No posting or account action will happen without approval.";
  }
  if (text.includes("what can you do") || text.includes("can you do")) {
    return "Agent 101 operating scope: research, evidence organization, draft outputs, task plans, workflow plans, internal notes, reports, and Human Gate packages for risky work.";
  }
  if (text.includes("blocked") || text.includes("cannot") || text.includes("can't")) {
    return "I cannot publish, spend money, move money, contact customers, modify accounts, create live agents, change permissions, change API keys, deploy campaigns, or call external APIs without Human Gate approval.";
  }
  if (text.includes("workflow")) {
    return "A safe workflow is: Task Intake -> Research Lab -> Verify Station -> Draft Studio -> Human Gate -> Output Bench -> System Log.";
  }
  if (text.includes("agent") || text.includes("grow")) {
    return "There is only one live agent: Agent 101. I can draft future-agent blueprints, but activation stays behind Human Gate.";
  }
  return "I can work on this locally in draft-only mode. Give me one bounded task, and I will structure it into research, verification, draft, approval, output, and log steps.";
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeDepoAiPayload(payload, fallbackMessage) {
  const parsed = typeof payload === "string" ? safeJsonParse(payload, null) : payload;
  if (!parsed || typeof parsed !== "object") {
    return {
      message: String(fallbackMessage || payload || "").trim() || "Agent 101 returned an empty response.",
      suggestedActions: [],
      requiresApproval: false,
      riskLevel: "low",
      logs: [],
    };
  }
  return {
    message: String(parsed.message || fallbackMessage || "Agent 101 response ready.").trim(),
    suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions : [],
    requiresApproval: Boolean(parsed.requiresApproval),
    riskLevel: ["low", "medium", "high"].includes(parsed.riskLevel) ? parsed.riskLevel : "low",
    blockedAction: parsed.blockedAction ? String(parsed.blockedAction) : undefined,
    logs: Array.isArray(parsed.logs) ? parsed.logs.map(String).slice(0, 6) : [],
  };
}

function extractOpenAiOutputText(payload = {}) {
  if (typeof payload.output_text === "string") return payload.output_text;
  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .map((part) => part.text || part.value || "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractJsonObjectText(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) return candidate.slice(start, end + 1);
  return candidate;
}

function normalizeSuggestedActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions.slice(0, 6).map((action) => {
    if (typeof action === "string") {
      return { label: action, action: action.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), requiresApproval: false };
    }
    return {
      label: String(action?.label || action?.action || "Review").slice(0, 80),
      action: String(action?.action || action?.label || "review").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      requiresApproval: Boolean(action?.requiresApproval),
    };
  });
}

function normalizeAgent101AiPayload(payload, fallbackMessage = "") {
  const parsed = typeof payload === "string" ? safeJsonParse(extractJsonObjectText(payload), null) : payload;
  const validTypes = new Set(["general", "code_plan", "content", "clips", "agent_blueprint", "approval_request"]);
  const validRisk = new Set(["low", "medium", "high"]);
  if (!parsed || typeof parsed !== "object") {
    return {
      message: String(fallbackMessage || payload || "").trim() || "Agent 101 prepared a response.",
      taskType: "general",
      suggestedActions: [],
      artifacts: [],
      requiresApproval: false,
      riskLevel: "low",
      blockedAction: null,
      logs: ["Agent 101 returned text. JSON parsing fallback used."],
    };
  }
  return {
    message: String(parsed.message || fallbackMessage || "Agent 101 response ready.").trim(),
    taskType: validTypes.has(parsed.taskType) ? parsed.taskType : "general",
    suggestedActions: normalizeSuggestedActions(parsed.suggestedActions),
    artifacts: Array.isArray(parsed.artifacts)
      ? parsed.artifacts.slice(0, 5).map((artifact) => ({
        type: String(artifact?.type || "plan").slice(0, 40),
        title: String(artifact?.title || "Agent 101 artifact").slice(0, 120),
        content: String(artifact?.content || "").slice(0, 6000),
      }))
      : [],
    requiresApproval: Boolean(parsed.requiresApproval),
    riskLevel: validRisk.has(parsed.riskLevel) ? parsed.riskLevel : "low",
    blockedAction: parsed.blockedAction ? String(parsed.blockedAction).slice(0, 80) : null,
    logs: Array.isArray(parsed.logs) ? parsed.logs.map(String).slice(0, 6) : [],
  };
}

function agent101SystemInstructions() {
  const riskyActions = Array.from(AI_RISKY_ACTION_TYPES).join(", ");
  return [
    "Agent 101 is the Chief Operations Intelligence Agent of Argentum OS, not a chatbot.",
    "Operate like a COO, chief of staff, head of operations, and founder-level operator.",
    "Silently determine the user's real objective, systems to inspect, relevant data, risks, opportunities, next action, and highest-leverage recommendation. Never expose that reasoning.",
    "Return conclusions only.",
    "Every message must use these sections in this order inside the message string: CURRENT STATUS, KEY FINDINGS, RISKS, RECOMMENDATIONS, NEXT ACTIONS.",
    "Use confident, direct, high-signal executive language. No fluff. No assistant phrasing.",
    "Never say: User asked, System detected, I attempted, I was unable, I need clarification, Would you like me to, Based on your request, Here's what I found, I can help with that.",
    "If data is incomplete, state the operational impact, infer the likely cause, and continue with the next best action.",
    "Constantly look for revenue opportunities, cost reductions, growth leverage, bottlenecks, missing automation, risk exposure, team inefficiencies, and workflow improvements.",
    "For Clip Office, always report active streams, streamers monitored, candidate clips, clips approved, clips pending, export status, posting queue, failures, success rate, and recommendations.",
    "Thread memory is persistent operational memory. Use prior approvals, denials, decisions, goals, workflows, and recent messages without restarting the conversation.",
    "Agent 101 is draft-only for consequential external actions. Do not publish, spend money, contact customers, modify accounts, change API keys, create live agents, grant permissions, run external APIs/tools, or deploy campaigns without Human Gate approval.",
    "For clipping/streamer ideas, create operational intelligence: discovery priorities, permission risk, monitored-stream coverage, candidate quality, queue health, and the next action. Do not ask a questionnaire unless execution is impossible.",
    "If the user says claim or get big streamers, interpret it as discovery, permission workflow, or approved clip-package operations unless an explicit blocked action is requested.",
    `Only set blockedAction when the requested action directly matches one of these exact blocked action IDs: ${riskyActions}.`,
    "If the user asks for a coding task, return an executive implementation brief with impacted systems, risks, and next actions.",
    "Do not claim you edited files unless a real code-editing tool exists and was used.",
    "Return only valid JSON with keys: message, taskType, suggestedActions, artifacts, requiresApproval, riskLevel, blockedAction, logs.",
  ].join(" ");
}

function agent101UserInput(message, context = {}) {
  const chatHistory = normalizedAgent101ChatHistory(context);
  return [
    `Message: ${message}`,
    `Room ID: ${context.roomId || context.office || "agent-office"}`,
    `Current stage: ${context.currentStage || "Agent 101"}`,
    `Grounded business and knowledge context: ${JSON.stringify(context.context || {}, null, 2).slice(0, 16_000)}`,
    `Recent room chat: ${JSON.stringify(chatHistory, null, 2).slice(0, 5000)}`,
    "Allowed task types: general, code_plan, content, clips, agent_blueprint, approval_request.",
    "Use the recent room chat as memory for this conversation. Do not restart as if the user is asking from zero.",
    "If key details are missing, make intelligent assumptions and identify the next verification action.",
    "If the request is about Clips Office, streamer discovery, clipping, Twitch, Kick, CapCut, or TikTok and does not explicitly request a blocked external action, return Clip Office operational intelligence with the required metrics.",
    "If risky, return taskType approval_request, requiresApproval true, riskLevel high, blockedAction as an exact blocked action ID only, and a Send to Human Gate suggested action.",
  ].join("\n");
}

function depoResponseSchemaInstruction() {
  return "Return only JSON with keys: message string, suggestedActions array, requiresApproval boolean, riskLevel low|medium|high, logs array. If a risky action is requested, set requiresApproval true, riskLevel high, and blockedAction to the action type.";
}

async function callOpenAiProvider(config, message, context) {
  const provider = "openai";
  const key = keyFromConfig(config, provider);
  if (!key) throw guardedError("OpenAI API key is not configured.", 400);
  const settings = config.providers.openai;
  const requestBody = {
    model: settings.model,
    instructions: `${DEPO_SYSTEM_RULES} ${depoResponseSchemaInstruction()}`,
    input: [
      {
        role: "user",
        content: `Room: ${context.roomId || "depo-habitat"}\nStage: ${context.currentStage || "Agent Habitat"}\nMessage: ${message}`,
      },
    ],
    temperature: settings.temperature,
    max_output_tokens: settings.maxOutputTokens,
  };
  const reservationId = reserveAiRequest(provider, settings.model, requestBody, settings.maxOutputTokens);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(60_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = guardedError(payload.error?.message || `OpenAI request failed with ${response.status}.`, response.status);
      error.openAiCode = payload.error?.code || "";
      error.openAiType = payload.error?.type || "";
      throw error;
    }
    recordAiUsage(config, payload.usage || {}, { reservationId });
    const outputText = extractOpenAiOutputText(payload);
    return normalizeDepoAiPayload(outputText, outputText);
  } finally {
    releaseAiUsageReservation(reservationId);
  }
}

async function callOpenAiAgent101(config, message, context = {}) {
  const key = keyFromConfig(config, "openai");
  if (!key) throw guardedError("OpenAI API key is not configured.", 400);
  const settings = config.providers.openai;
  const requestBody = {
    model: settings.model,
    instructions: agent101SystemInstructions(),
    input: [
      {
        role: "user",
        content: agent101UserInput(message, context),
      },
    ],
    temperature: settings.temperature,
    max_output_tokens: Math.max(700, Number(settings.maxOutputTokens || 900)),
  };

  async function sendRequest(body) {
    const reservationId = reserveAiRequest("openai", settings.model, body, body.max_output_tokens);
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = guardedError(payload.error?.message || `OpenAI request failed with ${response.status}.`, response.status);
        error.openAiCode = payload.error?.code || "";
        error.openAiType = payload.error?.type || "";
        throw error;
      }
      recordAiUsage(config, payload.usage || {}, { reservationId });
      return extractOpenAiOutputText(payload);
    } finally {
      releaseAiUsageReservation(reservationId);
    }
  }

  const firstText = await sendRequest(requestBody);
  let normalized = normalizeAgent101AiPayload(firstText, firstText);
  if (normalized.logs.includes("Agent 101 returned text. JSON parsing fallback used.")) {
    const retryText = await sendRequest({
      ...requestBody,
      input: [
        ...requestBody.input,
        {
          role: "user",
          content: `Your previous response was not valid JSON. Convert this text into the exact required JSON schema and return JSON only:\n${firstText.slice(0, 6000)}`,
        },
      ],
    });
    normalized = normalizeAgent101AiPayload(retryText, firstText);
    if (normalized.logs.includes("Agent 101 returned text. JSON parsing fallback used.")) {
      normalized.logs = ["OpenAI response was not valid JSON after retry; text fallback used."];
    }
  }
  return normalized;
}

async function callAnthropicAgent101(config, message, context = {}) {
  const key = keyFromConfig(config, "anthropic");
  if (!key) throw guardedError("Anthropic API key is not configured.", 400);
  const settings = config.providers.anthropic;

  async function sendRequest(messages) {
    const maxTokens = Math.max(700, Number(settings.maxOutputTokens || 900));
    const body = {
      model: settings.model,
      max_tokens: maxTokens,
      temperature: settings.temperature,
      system: agent101SystemInstructions(),
      messages,
    };
    const reservationId = reserveAiRequest("anthropic", settings.model, body, maxTokens);
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw guardedError(payload.error?.message || `Anthropic request failed with ${response.status}.`, response.status);
      recordAiUsage(config, payload.usage || {}, { reservationId });
      return (payload.content || []).filter((part) => part.type === "text").map((part) => part.text || "").join("\n").trim();
    } finally {
      releaseAiUsageReservation(reservationId);
    }
  }

  const userInput = agent101UserInput(message, context);
  const firstText = await sendRequest([{ role: "user", content: userInput }]);
  let normalized = normalizeAgent101AiPayload(firstText, firstText);
  if (normalized.logs.includes("Agent 101 returned text. JSON parsing fallback used.")) {
    const retryText = await sendRequest([
      { role: "user", content: userInput },
      { role: "assistant", content: firstText },
      { role: "user", content: "Convert the response into the exact required JSON object. Return JSON only and preserve the factual content." },
    ]);
    normalized = normalizeAgent101AiPayload(retryText, firstText);
  }
  return normalized;
}

async function callAnthropicProvider(config, message, context) {
  const provider = "anthropic";
  const key = keyFromConfig(config, provider);
  if (!key) throw guardedError("Anthropic API key is not configured.", 400);
  const settings = config.providers.anthropic;
  const body = {
    model: settings.model,
    max_tokens: settings.maxOutputTokens,
    temperature: settings.temperature,
    system: `${DEPO_SYSTEM_RULES} ${depoResponseSchemaInstruction()}`,
    messages: [
      {
        role: "user",
        content: `Room: ${context.roomId || "depo-habitat"}\nStage: ${context.currentStage || "Agent Habitat"}\nMessage: ${message}`,
      },
    ],
  };
  const reservationId = reserveAiRequest(provider, settings.model, body, settings.maxOutputTokens);
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw guardedError(payload.error?.message || `Anthropic request failed with ${response.status}.`, response.status);
    }
    recordAiUsage(config, payload.usage || {}, { reservationId });
    const outputText = (payload.content || []).map((part) => part.text || "").join("\n");
    return normalizeDepoAiPayload(outputText, outputText);
  } finally {
    releaseAiUsageReservation(reservationId);
  }
}

function blockedDepoResponse(actionType) {
  return {
    message: formatAgent101ExecutiveReport({
      title: "HUMAN GATE STATUS",
      currentStatus: [
        `Requested action: ${String(actionType || "external_action").replaceAll("_", " ")}.`,
        "Execution status: blocked pending human decision.",
        "Internal planning and approval-package preparation remain available.",
      ],
      keyFindings: [
        "The requested action crosses Agent 101's external/consequential authority boundary.",
        "No external action was executed.",
      ],
      risks: [
        "Proceeding without approval would bypass the audit trail and operator control.",
        "Account, posting, file, payment, customer, permission, or system-setting changes require exact scoped approval.",
      ],
      recommendations: [
        "Create a Human Gate package with action scope, evidence, reversibility, expiration, and risk level.",
        "Keep all preparatory work draft-only until the operator approves the exact step.",
      ],
      nextActions: [
        "Review the Human Gate request and decide approve, send back, or decline.",
      ],
    }),
    suggestedActions: [],
    requiresApproval: true,
    riskLevel: "high",
    blockedAction: actionType,
    logs: [`Blocked risky action: ${actionType}`],
  };
}

async function testAiProvider(payload = {}) {
  const config = readAiProviderConfig();
  const provider = sanitizeProvider(payload.provider || config.provider);
  const testConfig = {
    ...config,
    provider,
    mode: isLocalProvider(provider) ? "demo" : sanitizeAiMode(payload.mode || config.mode || "live"),
  };
  try {
    let result;
    if (isLocalProvider(provider) || testConfig.mode !== "live") {
      result = {
        success: true,
        provider,
        model: "local-demo",
        message: "Local Demo Mode is ready. No external API call was made.",
        monthlyLimitUsd: testConfig.monthlyLimitUsd,
      };
    } else if (provider === "openai") {
      const response = await callOpenAiProvider(testConfig, "Reply with a short JSON health check for Agent 101.", { roomId: "settings" });
      result = {
        success: true,
        provider,
        model: testConfig.providers.openai.model,
        message: response.message || "OpenAI API connection is active.",
        monthlyLimitUsd: testConfig.monthlyLimitUsd,
      };
    } else if (provider === "anthropic") {
      const response = await callAnthropicProvider(testConfig, "Reply with a short JSON health check for Agent 101.", { roomId: "settings" });
      result = { success: true, provider, model: testConfig.providers.anthropic.model, message: response.message };
    } else {
      throw guardedError("Unknown AI provider.", 400);
    }
    config.lastTest = { ...result, testedAt: now() };
    writeAiProviderConfig(config);
    return result;
  } catch (error) {
    logAiProviderError("test", error);
    const friendly = provider === "openai" ? safeAiErrorMessage(error) : error.message;
    const result = {
      success: false,
      provider,
      model: isLocalProvider(provider) ? "local-demo" : activeProviderSettings({ ...config, provider }).model,
      message: friendly,
      error: friendly,
      monthlyLimitUsd: config.monthlyLimitUsd,
    };
    config.lastTest = { ...result, testedAt: now() };
    writeAiProviderConfig(config);
    return result;
  }
}

function agent101OpenAiStatus(config = readAiProviderConfig()) {
  const provider = sanitizeProvider(config.provider);
  const mode = provider === "openai" ? sanitizeAiMode(config.mode || "live") : "demo";
  const configured = Boolean(keyFromConfig(config, "openai"));
  const budget = aiUsageBudgetStatus(config);
  const lastTest = config.lastTest || null;
  const hasError = lastTest?.provider === "openai" && lastTest?.success === false;
  return {
    provider: "openai",
    mode: provider === "openai" && mode === "live" ? "live" : "demo",
    configured,
    model: config.providers.openai.model,
    status: configured ? budget.blocked ? "error" : hasError ? "error" : "ready" : "missing_key",
    lastTest: lastTest?.testedAt || lastTest?.timestamp || null,
    error: hasError ? safeAiErrorMessage(lastTest) : null,
    budget,
  };
}

async function testAgent101OpenAi() {
  const config = readAiProviderConfig();
  const configured = Boolean(keyFromConfig(config, "openai"));
  if (!configured) {
    const result = {
      success: false,
      provider: "openai",
      mode: "demo",
      configured: false,
      model: config.providers.openai.model,
      message: "OpenAI API key is not configured. Agent 101 is using Local Demo Mode.",
      status: "missing_key",
      testedAt: now(),
    };
    config.lastTest = result;
    writeAiProviderConfig(config);
    return result;
  }
  try {
    const settings = config.providers.openai;
    const body = {
      model: settings.model,
      instructions: "Reply with exactly: Agent 101 online.",
      input: [{ role: "user", content: "Reply with exactly: Agent 101 online." }],
      max_output_tokens: 24,
    };
    const reservationId = reserveAiRequest("openai", settings.model, body, 24);
    let payload;
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${keyFromConfig(config, "openai")}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = guardedError(payload.error?.message || `OpenAI request failed with ${response.status}.`, response.status);
        error.openAiCode = payload.error?.code || "";
        throw error;
      }
      recordAiUsage(config, payload.usage || {}, { reservationId });
    } finally {
      releaseAiUsageReservation(reservationId);
    }
    const outputText = extractOpenAiOutputText(payload);
    const result = {
      success: true,
      provider: "openai",
      mode: "live",
      configured: true,
      model: settings.model,
      message: outputText || "Agent 101 online.",
      status: "ready",
      testedAt: now(),
      budget: aiUsageBudgetStatus(config),
    };
    config.lastTest = result;
    writeAiProviderConfig(config);
    const state = readState();
    audit(state, "OpenAI connection tested", "Agent 101 OpenAI Live health check succeeded.");
    writeState(state);
    return result;
  } catch (error) {
    logAiProviderError("agent101-openai-test", error);
    const friendly = safeAiErrorMessage(error);
    recordAiProviderFailure(config, friendly);
    const result = {
      success: false,
      provider: "openai",
      mode: "demo",
      configured: true,
      model: config.providers.openai.model,
      message: friendly,
      error: friendly,
      status: "error",
      testedAt: now(),
      budget: aiUsageBudgetStatus(config),
    };
    config.lastTest = result;
    writeAiProviderConfig(config);
    const state = readState();
    audit(state, "OpenAI connection test failed", friendly);
    writeState(state);
    return result;
  }
}

function logOpenClawRuntimeEvent(event) {
  const parts = [
    `requestId=${event.requestId || "unknown"}`,
    "provider=openclaw",
    `target=${event.target || "unknown"}`,
    `durationMs=${Number.isFinite(Number(event.durationMs)) ? Number(event.durationMs) : 0}`,
    `ok=${Boolean(event.ok)}`,
  ];
  if (event.httpStatus) parts.push(`httpStatus=${event.httpStatus}`);
  if (event.errorCode) parts.push(`errorCode=${event.errorCode}`);
  console.info(`[agent-runtime] ${parts.join(" ")}`);
}

function createOpenClawRuntime() {
  return new openclawRuntime.OpenClawRuntime({
    config: openclawRuntime.readOpenClawConfig(process.env),
    logger: logOpenClawRuntimeEvent,
  });
}

function openClawConnectorStatus(state = readState(), extra = {}) {
  const stored = state.toolConnections?.openclaw || {};
  const base = openclawRuntime.publicOpenClawStatus(openclawRuntime.readOpenClawConfig(process.env), {
    lastTest: stored.lastTest || extra.lastTest || null,
    lastError: stored.lastError || extra.lastError || null,
    models: extra.models || stored.models || [],
    connected: extra.connected || stored.status === "ready",
    status: extra.status || stored.status,
    selectedModel: stored.selectedModel,
  });
  return {
    id: "openclaw",
    label: CONNECTOR_DEFINITIONS.openclaw.label,
    category: CONNECTOR_DEFINITIONS.openclaw.category,
    status: !base.enabled ? "not_configured" : base.configured ? (base.lastError ? "error" : base.connected ? "ready" : "approval_required") : "error",
    mode: base.mode,
    configured: base.configured,
    connected: base.connected,
    requiredEnv: CONNECTOR_DEFINITIONS.openclaw.requiredEnv.filter((name) => name !== "OPENCLAW_GATEWAY_TOKEN"),
    secretEnv: ["Gateway token"],
    missingEnv: base.missingConfig,
    approvalRequired: false,
    blockedActions: CONNECTOR_DEFINITIONS.openclaw.blockedActions,
    checklist: CONNECTOR_DEFINITIONS.openclaw.checklist,
    baseUrlOrigin: base.baseUrlOrigin,
    defaultModel: base.defaultModel,
    selectedModel: base.selectedModel,
    tokenConfigured: base.tokenConfigured,
    timeoutMs: base.timeoutMs,
    models: base.models,
    lastTest: base.lastTest,
    lastError: base.lastError,
    securityBoundary: base.securityBoundary,
  };
}

function rememberOpenClawTest(result) {
  const state = readState();
  state.toolConnections = state.toolConnections || {};
  state.toolConnections.openclaw = {
    ...(state.toolConnections.openclaw || {}),
    status: result.success ? "ready" : "error",
    selectedModel: result.selectedModel || openclawRuntime.readOpenClawConfig(process.env).defaultModel,
    models: Array.isArray(result.models) ? result.models.slice(0, 50) : [],
    lastTest: {
      success: Boolean(result.success),
      provider: "openclaw",
      message: result.message,
      requestId: result.requestId || null,
      durationMs: result.durationMs || null,
      testedAt: result.testedAt || now(),
    },
    lastError: result.success ? null : result.message,
  };
  audit(state, result.success ? "OpenClaw connection tested" : "OpenClaw connection test failed", result.message);
  writeState(state);
}

async function testOpenClawRuntime() {
  try {
    const result = await createOpenClawRuntime().testConnection();
    rememberOpenClawTest(result);
    return {
      ...result,
      status: openClawConnectorStatus(readState(), { connected: true, models: result.models }),
    };
  } catch (error) {
    const safeError = openclawRuntime.safePublicError(error);
    const result = {
      success: false,
      provider: "openclaw",
      connected: false,
      selectedModel: openclawRuntime.readOpenClawConfig(process.env).defaultModel,
      models: [],
      message: safeError.message,
      code: safeError.code,
      httpStatus: safeError.httpStatus,
      testedAt: now(),
      configurationErrors: safeError.configurationErrors,
    };
    rememberOpenClawTest(result);
    return {
      ...result,
      status: openClawConnectorStatus(readState(), { connected: false, lastError: safeError.message }),
    };
  }
}

async function listOpenClawModels() {
  try {
    const result = await createOpenClawRuntime().listModels();
    return {
      success: true,
      provider: "openclaw",
      selectedModel: result.selectedModel,
      models: result.models,
      requestId: result.requestId,
      durationMs: result.durationMs,
    };
  } catch (error) {
    const safeError = openclawRuntime.safePublicError(error);
    return {
      success: false,
      provider: "openclaw",
      selectedModel: openclawRuntime.readOpenClawConfig(process.env).defaultModel,
      models: [],
      message: safeError.message,
      code: safeError.code,
      httpStatus: safeError.httpStatus,
      configurationErrors: safeError.configurationErrors,
    };
  }
}

async function runOpenClawAgentRequest(payload = {}) {
  try {
    const result = await createOpenClawRuntime().runAgent({
      conversationId: payload.conversationId || payload.threadId || "agent101-main",
      input: payload.input || payload.message || payload.goal,
      model: payload.model || payload.target,
    });
    const state = readState();
    audit(state, "OpenClaw agent request completed", `Target ${result.model} completed request ${result.requestId}.`);
    writeState(state);
    return {
      success: true,
      provider: "openclaw",
      model: result.model,
      conversationUser: result.conversationUser,
      requestId: result.requestId,
      durationMs: result.durationMs,
      outputText: result.outputText,
      rawId: result.rawId,
    };
  } catch (error) {
    const safeError = openclawRuntime.safePublicError(error);
    const state = readState();
    audit(state, "OpenClaw agent request failed", safeError.message);
    writeState(state);
    const status = error.status || 502;
    const wrapped = guardedError(safeError.message, status);
    wrapped.code = safeError.code;
    wrapped.httpStatus = safeError.httpStatus;
    wrapped.configurationErrors = safeError.configurationErrors;
    throw wrapped;
  }
}

async function handleDepoChat(payload = {}) {
  const message = String(payload.message || "").trim();
  if (!message) throw guardedError("Message is required.", 400);
  const riskyRequest = detectRiskyAction(message);
  if (riskyRequest && requiresHumanGate(riskyRequest)) return blockedDepoResponse(riskyRequest);
  const config = readAiProviderConfig();
  const provider = sanitizeProvider(config.provider);
  const mode = isLocalProvider(provider) ? "demo" : sanitizeAiMode(config.mode);
  if (mode !== "live" || isLocalProvider(provider)) {
    return {
      message: localDepoDemoResponse(message),
      suggestedActions: [],
      requiresApproval: false,
      riskLevel: "low",
      logs: ["Local Demo Mode response. No external API call was made."],
      provider: "local_demo",
      mode: "demo",
    };
  }

  let response;
  try {
    if (provider === "openai") {
      response = await callOpenAiProvider(config, message, payload);
    } else if (provider === "anthropic") {
      response = await callAnthropicProvider(config, message, payload);
    } else {
      response = {
        message: localDepoDemoResponse(message),
        suggestedActions: [],
        requiresApproval: false,
        riskLevel: "low",
        logs: ["Unknown provider; used Local Demo Mode."],
      };
    }
  } catch (error) {
    logAiProviderError("chat", error);
    const friendly = provider === "openai" ? safeAiErrorMessage(error) : "Live AI provider failed. Agent 101 used Local Demo Mode fallback.";
    config.lastTest = {
      success: false,
      provider,
      model: activeProviderSettings({ ...config, provider }).model,
      message: friendly,
      error: friendly,
      testedAt: now(),
    };
    writeAiProviderConfig(config);
    response = {
      message: localDepoDemoResponse(message),
      suggestedActions: [],
      requiresApproval: false,
      riskLevel: "low",
      logs: [friendly, "Local Demo fallback used. No external action was executed."],
      fallback: true,
    };
  }
  const riskyResponse = detectRiskyAction(`${response.message} ${(response.suggestedActions || []).join(" ")}`);
  if (riskyResponse && requiresHumanGate(riskyResponse)) return blockedDepoResponse(riskyResponse);
  return {
    ...response,
    provider,
    mode,
  };
}

function agent101Model(state = readState()) {
  return {
    ...(state.agent101 || {}),
    currentOffice: "Clips Office",
    approvalRequired: true,
    externalActions: "Locked",
  };
}

function publicToolConnections(state = readState(), options = {}) {
  const ai = currentAiProviderStatus();
  const stored = state.toolConnections || {};
  const browser = stored.browser || {};
  const capcut = stored.capcut || {};
  const tiktok = stored.tiktok || {};
  const openclaw = openClawConnectorStatus(state);
  const connections = {
    openai: {
      provider: "OpenAI",
      status: ai.configured ? ai.connectionStatus : "Not configured",
      mode: ai.modeLabel,
      keyStatus: ai.configured ? "Configured server-side or not required" : "Not configured",
      model: ai.activeModel,
      budgetLimit: ai.monthlyLimitUsd,
      estimatedSpend: ai.usage?.estimatedMonthlyUsd || 0,
      lastTest: ai.lastTest,
      lastTestResult: ai.lastError || ai.lastTest?.message || "Not tested",
    },
    browser: {
      status: browser.status || "restricted",
      label: browser.status === "ready" ? "Ready" : "Restricted",
      allowedDomains: browser.allowedDomains || [],
      blockedDomains: browser.blockedDomains || [],
      approvalRequired: true,
      note: "Login, payment, and account changes require Human Gate approval. Browser automation is not enabled yet.",
    },
    capcut: {
      status: capcut.status || "manual_handoff",
      label: capcut.status === "connected" ? "Connected" : "Manual handoff",
      mode: "manual_handoff",
      handoffUrl: capcut.handoffUrl || "",
      blocked: ["automatic publishing", "account changes", "payment actions", "raw credential login"],
    },
    tiktok: {
      status: tiktok.status || "not_connected",
      label: tiktok.status === "oauth_connected" ? "OAuth connected" : "Not connected",
      mode: tiktok.mode || "draft_package",
      postingMode: "Draft package",
      accountHandle: tiktok.accountHandle || "",
      lastSync: tiktok.lastSync || null,
      blocked: ["direct posting", "profile changes", "deleting posts", "ad spend", "payment settings"],
    },
    instagram: { status: stored.instagram?.status || "not_connected", label: "Not connected", placeholder: true },
    youtube: { status: stored.youtube?.status || "not_connected", label: "Not connected", placeholder: true },
    storage: {
      status: stored.storage?.status || "ready",
      label: "Ready",
      localProjectFiles: true,
      googleDrive: stored.storage?.googleDrive || "not_connected",
      fileTypes: stored.storage?.fileTypes || ["raw_footage", "audio", "scripts", "exports", "thumbnails", "captions", "posting_package"],
    },
  };
  if (options.includeOpenClaw) {
    connections.openclaw = {
      provider: "OpenClaw",
      status: openclaw.status,
      mode: "Optional server-side runtime",
      keyStatus: openclaw.tokenConfigured ? "Gateway token configured server-side" : "Not configured",
      target: openclaw.selectedModel,
      lastTest: openclaw.lastTest,
      lastTestResult: openclaw.lastError || openclaw.lastTest?.message || "Not tested",
      securityBoundary: openclaw.securityBoundary,
    };
  }
  return connections;
}

function normalizeConnectorStatus(value, fallback = "not_configured") {
  const normalized = String(value || fallback).toLowerCase();
  return CONNECTOR_STATUS_VALUES.has(normalized) ? normalized : fallback;
}

function envConfigured(names = []) {
  return names.filter((name) => Boolean(String(process.env[name] || "").trim()));
}

function publicConnectorStatus(connectorId, state = readState()) {
  const definition = CONNECTOR_DEFINITIONS[connectorId];
  if (!definition) throw guardedError("Connector not found.", 404);
  if (connectorId === "openai") {
    const ai = currentAiProviderStatus();
    const configured = Boolean(ai.configured);
    const connected = ai.connectionStatus === "Connected" || ai.connectionStatus === "Local Demo";
    return {
      id: "openai",
      label: definition.label,
      category: definition.category,
      status: configured ? (connected ? "ready" : "error") : "not_configured",
      mode: ai.modeLabel,
      configured,
      connected,
      model: ai.activeModel,
      monthlyLimitUsd: ai.monthlyLimitUsd,
      estimatedMonthlyUsd: ai.usage?.estimatedMonthlyUsd || 0,
      lastTest: ai.lastTest,
      lastError: ai.lastError || null,
      requiredEnv: definition.requiredEnv,
      missingEnv: configured ? [] : ["OPENAI_API_KEY"],
      approvalRequired: false,
      blockedActions: definition.blockedActions,
      checklist: definition.checklist,
    };
  }
  if (connectorId === "openclaw") {
    return openClawConnectorStatus(state);
  }

  const stored = state.toolConnections?.[connectorId] || {};
  const configuredEnv = envConfigured(definition.requiredEnv);
  const missingEnv = definition.requiredEnv.filter((name) => !configuredEnv.includes(name));
  const storedStatus = normalizeConnectorStatus(stored.status || stored.googleDrive, definition.status);
  const readyByEnv = definition.requiredEnv.length > 0 && missingEnv.length === 0;
  const status = readyByEnv && storedStatus !== "error" ? "approval_required" : storedStatus;
  return {
    id: connectorId,
    label: definition.label,
    category: definition.category,
    status,
    mode: stored.mode || status,
    configured: readyByEnv || status === "manual_handoff" || status === "approval_required" || status === "ready",
    connected: status === "ready",
    requiredEnv: definition.requiredEnv,
    missingEnv,
    approvalRequired: definition.approvalRequired || status === "approval_required",
    blockedActions: definition.blockedActions,
    checklist: definition.checklist,
    lastTest: stored.lastTest || null,
    lastError: stored.lastError || null,
  };
}

function publicConnectorStatuses(state = readState(), options = {}) {
  const includeAdminOnly = Boolean(options.includeAdminOnly);
  return Object.keys(CONNECTOR_DEFINITIONS)
    .filter((connectorId) => includeAdminOnly || connectorId !== "openclaw")
    .map((connectorId) => publicConnectorStatus(connectorId, state));
}

function testConnector(connectorId) {
  const state = readState();
  const status = publicConnectorStatus(connectorId, state);
  const testedAt = now();
  if (connectorId === "openai") {
    return testAgent101OpenAi();
  }
  if (connectorId === "openclaw") {
    return testOpenClawRuntime();
  }
  const success = status.status === "manual_handoff" || status.status === "ready" || status.status === "approval_required";
  const result = {
    success,
    connectorId,
    status: status.status,
    mode: status.mode,
    testedAt,
    message: success
      ? `${status.label} is available as ${status.status.replaceAll("_", " ")}. External execution remains gated.`
      : `${status.label} is not configured yet. Add Railway env vars and keep secrets server-side.`,
    missingEnv: status.missingEnv,
    approvalRequired: status.approvalRequired,
  };
  state.toolConnections = state.toolConnections || {};
  state.toolConnections[connectorId] = {
    ...(state.toolConnections[connectorId] || {}),
    status: status.status,
    lastTest: result,
    lastError: success ? null : result.message,
  };
  audit(state, "Connector test", `${status.label}: ${result.message}`);
  writeState(state);
  return result;
}

function officeDefinition(officeId = "clips-office") {
  const normalized = String(officeId || "clips-office").trim().toLowerCase();
  return BUSINESS_OFFICES[normalized] || BUSINESS_OFFICES["clips-office"];
}

function agent101Readiness(state = readState()) {
  const connectors = publicConnectorStatuses(state);
  const openai = connectors.find((connector) => connector.id === "openai");
  const pendingApprovals = (state.approvals || []).filter((approval) => approval.status === "pending").length;
  const queuedTasks = (state.tasks || []).filter((task) => ["queued", "needs_revision"].includes(task.status)).length;
  const agent = agent101Model(state);
  return {
    agent,
    openaiConnection: openai?.status || "not_configured",
    providerMode: openai?.mode || "Local Demo",
    humanGate: "active",
    draftOnlyMode: String(agent.mode || "").toLowerCase().includes("draft"),
    systemLogs: "active",
    taskCreation: "ready",
    artifactCreation: "ready",
    approvalRouting: "ready",
    externalActions: "locked",
    queuedTasks,
    pendingApprovals,
    connectors,
    clipsOfficeReady: Boolean(connectors.find((connector) => connector.id === "capcut") && connectors.find((connector) => connector.id === "tiktok") && connectors.find((connector) => connector.id === "youtube")),
  };
}

const INFRASTRUCTURE_ACTIVE_STATUSES = new Set([
  "queued",
  "running",
  "processing",
  "in_progress",
  "drafting",
  "verifying",
  "recovering",
  "waiting_approval",
]);
const INFRASTRUCTURE_PENDING_STATUSES = new Set(["pending", "waiting", "waiting_approval"]);

function infrastructureFreshness(value, options = {}) {
  const observedMs = Date.parse(value || "");
  if (!Number.isFinite(observedMs)) return "unknown";
  const ageMs = Math.max(0, Date.now() - observedMs);
  const liveMs = Number(options.liveMs || 2 * 60 * 1000);
  const freshMs = Number(options.freshMs || 24 * 60 * 60 * 1000);
  if (ageMs <= liveMs) return "live";
  if (ageMs <= freshMs) return "fresh";
  return "stale";
}

function readPrintShopRecordedSummary() {
  try {
    const state = readState();
    const payload = printShopWorkspace.publicSnapshot(PRINT_SHOP_DATA_ROOT, { approvals: state.approvals || [] });
    return {
      available: true,
      recordedAt: payload.updatedAt,
      freshness: infrastructureFreshness(payload.updatedAt, { liveMs: 5 * 60 * 1000, freshMs: 7 * DAY_MS }),
      counts: {
        products: Number(payload.counts?.candidates || 0),
        opportunities: Number(payload.counts?.opportunities || 0),
        orders: null,
        customers: null,
        printJobs: Number(payload.counts?.designJobs || 0),
        approvalsPending: Number(payload.counts?.pendingApprovals || 0),
        artifacts: Number(payload.counts?.stlArtifacts || 0),
      },
      workflow: infrastructurePrintWorkflow(payload, payload.updatedAt),
      payload,
    };
  } catch (error) {
    return {
      available: false,
      recordedAt: null,
      freshness: "unknown",
      counts: { products: null, opportunities: null, orders: null, customers: null, printJobs: null, approvalsPending: null, artifacts: null },
      workflow: infrastructurePrintWorkflow(null, null),
      warning: error?.code === "ENOENT" ? "Print Shop Product Research Lab has no persisted state yet." : "Print Shop Product Research Lab state could not be read.",
    };
  }
}

async function probePrintShopRuntime() {
  const recorded = readPrintShopRecordedSummary();
  if (!recorded.available) {
    return {
      observedAt: now(),
      reachable: false,
      status: "state_unavailable",
      counts: recorded.counts,
      workflow: recorded.workflow,
      warning: recorded.warning,
    };
  }
  return {
    observedAt: now(),
    reachable: true,
    status: "integrated",
    counts: recorded.counts,
    workflow: recorded.workflow,
    warning: "Authenticated Product Lab is integrated. A slicer and physical printer are not connected.",
  };
}

function infrastructureConnectorState(connector = {}) {
  const status = String(connector.status || "unknown").toLowerCase();
  const localDemo = connector.id === "openai" && /local demo/i.test(String(connector.mode || ""));
  const lastTest = connector.lastTest && typeof connector.lastTest === "object" ? connector.lastTest : null;
  const verified = !localDemo && connector.connected === true && status === "ready" && lastTest?.success === true;
  if (localDemo) return { state: "local_demo", label: "Local demo", verified: false };
  if (verified) return { state: "connected", label: "Verified connection", verified: true };
  if (status === "ready" || connector.connected === true) return { state: "configured_unverified", label: "Configured · unverified", verified: false };
  if (status === "approval_required") return { state: "approval_required", label: "Approval required", verified: false };
  if (status === "manual_handoff") return { state: "manual_handoff", label: "Manual handoff", verified: false };
  if (["not_configured", "not_connected"].includes(status)) return { state: "not_connected", label: "Not connected", verified: false };
  if (status === "error") return { state: "error", label: "Needs attention", verified: false };
  return { state: "unknown", label: "Unavailable", verified: false };
}

function infrastructureMemoryCount(state = {}) {
  const memory = state.memory || {};
  return ["working", "shared", "agent"].reduce((total, layer) => total + listFrom(memory[layer]).length, 0);
}

function infrastructureKnownSum(...values) {
  if (!values.length || values.some((value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)))) return null;
  return values.reduce((total, value) => total + Number(value), 0);
}

const INFRASTRUCTURE_WORKFLOW_ITEM_LIMIT = 8;
const INFRASTRUCTURE_RUNNING_STATUSES = new Set([
  "running",
  "processing",
  "in_progress",
  "drafting",
  "verifying",
  "recovering",
]);
const INFRASTRUCTURE_QUEUE_STATUSES = new Set([
  "queued",
  "draft",
  "planned",
  "intake",
  "needs_revision",
]);

function infrastructureSafeText(value, maxLength = 140) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function infrastructureRecordedAt(...values) {
  for (const value of values) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

function infrastructureRecordItem(record = {}, options = {}) {
  const id = infrastructureSafeText(options.id ?? record.id, 180);
  if (!id) return null;
  const status = infrastructureSafeText(
    options.status ?? record.status ?? record.stage ?? record.decision,
    80,
  );
  return {
    id,
    title: infrastructureSafeText(
      options.title
        ?? record.title
        ?? record.name
        ?? record.goal
        ?? record.ticker
        ?? record.action,
      160,
    ),
    status,
    meta: infrastructureSafeText(options.meta, 120),
    updatedAt: infrastructureRecordedAt(
      options.updatedAt,
      record.updatedAt,
      record.updated_at,
      record.createdAt,
      record.created_at,
    ),
    recordType: infrastructureSafeText(options.recordType, 60),
    state: options.state || (INFRASTRUCTURE_RUNNING_STATUSES.has(String(status || "").toLowerCase())
      ? "active"
      : INFRASTRUCTURE_PENDING_STATUSES.has(String(status || "").toLowerCase())
        ? "attention"
        : "recorded"),
    ...(options.metrics && typeof options.metrics === "object" ? { metrics: options.metrics } : {}),
    ...(options.media && typeof options.media === "object" ? { media: options.media } : {}),
  };
}

function infrastructureWorkflowStage(id, label, records, options = {}) {
  if (records === null) {
    return { id, label, count: null, state: "unavailable", items: [], hasMore: false };
  }
  const items = listFrom(records)
    .filter(Boolean)
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
    .slice(0, INFRASTRUCTURE_WORKFLOW_ITEM_LIMIT);
  return {
    id,
    label,
    count: listFrom(records).length,
    state: options.state || (items.some((item) => item.state === "attention") ? "attention" : options.active ? "active" : "recorded"),
    items,
    hasMore: listFrom(records).length > items.length,
  };
}

function infrastructureNewestItem(items = []) {
  return [...listFrom(items)]
    .filter(Boolean)
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))[0] || null;
}

function infrastructureGenericOfficeWorkflow(records = {}, observedAt = null) {
  const workRecords = [
    ...listFrom(records.tasks).map((record) => ({ record, recordType: "task" })),
    ...listFrom(records.missions).map((record) => ({ record, recordType: "mission" })),
    ...listFrom(records.runs).map((record) => ({ record, recordType: "run" })),
    ...listFrom(records.contracts).map((record) => ({ record, recordType: "task contract" })),
  ];
  const queued = workRecords
    .filter(({ record, recordType }) => INFRASTRUCTURE_QUEUE_STATUSES.has(String(record.status || "").toLowerCase()) || (recordType === "task contract" && String(record.status || "").toLowerCase() === "confirmed"))
    .map(({ record, recordType }) => infrastructureRecordItem(record, { title: record.title ?? record.interpretedGoal, recordType }))
    .filter(Boolean);
  const active = workRecords
    .filter(({ record }) => INFRASTRUCTURE_RUNNING_STATUSES.has(String(record.status || "").toLowerCase()) && String(record.status || "").toLowerCase() !== "verifying")
    .map(({ record, recordType }) => infrastructureRecordItem(record, { title: record.title ?? record.interpretedGoal, recordType }))
    .filter(Boolean);
  const verifying = workRecords
    .filter(({ record }) => ["verifying", "needs_revision", "failed_verification"].includes(String(record.status || "").toLowerCase()))
    .map(({ record, recordType }) => infrastructureRecordItem(record, {
      title: record.title ?? record.interpretedGoal,
      recordType,
      state: String(record.status || "").toLowerCase() === "verifying" ? "active" : "attention",
    }))
    .filter(Boolean);
  const waitingWork = workRecords
    .filter(({ record }) => ["waiting", "waiting_approval", "needs_approval"].includes(String(record.status || "").toLowerCase()))
    .map(({ record, recordType }) => infrastructureRecordItem(record, {
      title: record.title ?? record.interpretedGoal,
      recordType,
      state: "attention",
    }))
    .filter(Boolean);
  const approvals = [...waitingWork, ...listFrom(records.approvals)
    .map((record) => infrastructureRecordItem(record, {
      title: record.title ?? record.actionType ?? record.action,
      recordType: "approval",
      state: INFRASTRUCTURE_PENDING_STATUSES.has(String(record.status || "").toLowerCase()) ? "attention" : "recorded",
    }))
    .filter(Boolean)];
  const outputs = listFrom(records.artifacts)
    .map((record) => infrastructureRecordItem(record, { recordType: record.type || "output" }))
    .filter(Boolean);
  const current = infrastructureNewestItem(active)
    || infrastructureNewestItem(verifying)
    || infrastructureNewestItem(approvals.filter((item) => item.state === "attention"))
    || null;
  const activeStageId = active.length ? "active" : verifying.length ? "verify" : approvals.some((item) => item.state === "attention") ? "gate" : null;
  return {
    source: "argentum-state",
    measured: true,
    observedAt,
    activeStageId,
    current: current ? { ...current, stageId: activeStageId } : null,
    stages: [
      infrastructureWorkflowStage("queue", "Queue", queued),
      infrastructureWorkflowStage("active", "Active", active, { active: activeStageId === "active" }),
      infrastructureWorkflowStage("verify", "Verify", verifying, { active: activeStageId === "verify" }),
      infrastructureWorkflowStage("gate", "Human Gate", approvals, { active: activeStageId === "gate" }),
      infrastructureWorkflowStage("outputs", "Outputs", outputs),
    ],
  };
}

function clippingProductionWorkflowStage(candidate = {}, automation = {}) {
  const stage = String(candidate.productionWorkflow?.stage || "editing").toLowerCase();
  if (candidate.productionWorkflow?.localLibraryPath || stage === "library") return "library";
  if (stage === "product_ready") return "ready";
  if (stage === "precheck") return "precheck";
  if (
    String(automation.workerStatus || "").toLowerCase() === "processing"
    && automation.workerClipId
    && candidate.id === automation.workerClipId
  ) return "review";
  return "studio";
}

function clippingProductionWorkflowEligible(candidate = {}, automation = {}) {
  if (clipOfficeCandidateStage(candidate) === "dismissed") return false;
  const stage = String(candidate.productionWorkflow?.stage || "editing").toLowerCase();
  return Boolean(
    candidate.builderApproved
    || candidate.builderStatus === "approved"
    || ["builder_ready", "in_builder"].includes(String(candidate.status || "").toLowerCase())
    || candidate.builderDraft
    || stage !== "editing"
    || (
      String(automation.workerStatus || "").toLowerCase() === "processing"
      && automation.workerClipId
      && candidate.id === automation.workerClipId
    )
  );
}

function infrastructureClippingWorkflow(clipping = {}) {
  const stageDefinitions = [
    ["studio", "Studio"],
    ["review", "Review"],
    ["precheck", "Precheck"],
    ["ready", "Ready"],
    ["library", "Library"],
  ];
  if (!clipping.available) {
    return {
      source: "clipping-office",
      measured: false,
      observedAt: null,
      activeStageId: null,
      current: null,
      operation: null,
      stages: stageDefinitions.map(([id, label]) => infrastructureWorkflowStage(id, label, null)),
    };
  }
  const automation = clipping.automation || {};
  const sourceCandidateCount = Number(clipping.sourceCounts?.clipCandidates);
  const candidateProjectionComplete = !Number.isFinite(sourceCandidateCount)
    || sourceCandidateCount <= listFrom(clipping.clipCandidates).length;
  const candidates = visibleClipOfficeCandidates(clipping)
    .filter((candidate) => clippingProductionWorkflowEligible(candidate, automation));
  const byStage = Object.fromEntries(stageDefinitions.map(([id]) => [id, []]));
  candidates.forEach((candidate) => {
    const stageId = clippingProductionWorkflowStage(candidate, automation);
    const qualityValue = candidate.qualityScore ?? candidate.score;
    const durationValue = candidate.durationSeconds ?? candidate.duration;
    const title = infrastructureSafeText(
      candidate.editorialCaption?.primary_caption
      ?? candidate.editorialCaption?.text
      ?? candidate.title,
      160,
    );
    const item = infrastructureRecordItem(candidate, {
      title,
      status: candidate.productionWorkflow?.status ?? candidate.status ?? candidate.decision,
      meta: candidate.streamerName ?? candidate.creatorName,
      updatedAt: candidate.productionWorkflow?.updatedAt ?? candidate.updatedAt ?? candidate.createdAt,
      recordType: "clip",
      state: stageId === "review" ? "active" : stageId === "precheck" ? "attention" : "recorded",
      metrics: {
        quality: qualityValue !== null && qualityValue !== undefined && qualityValue !== "" && Number.isFinite(Number(qualityValue))
          ? Math.max(0, Math.min(100, Math.round(Number(qualityValue))))
          : null,
        durationSeconds: durationValue !== null && durationValue !== undefined && durationValue !== "" && Number.isFinite(Number(durationValue))
          ? Math.max(0, Math.round(Number(durationValue)))
          : null,
      },
      media: {
        thumbnailUrl: infrastructureSafeText(clipOfficeThumbnailUrl(candidate.thumbnailUrl), 1000),
        playbackUrl: infrastructureSafeText(candidate.productionWorkflow?.playbackUrl ?? candidate.playbackUrl, 1000),
        savedLocally: Boolean(candidate.productionWorkflow?.localLibraryPath),
      },
    });
    if (item) byStage[stageId].push(item);
  });
  const workerCandidate = automation.workerClipId
    ? candidates.find((candidate) => candidate.id === automation.workerClipId)
    : null;
  const workerStageId = workerCandidate ? clippingProductionWorkflowStage(workerCandidate, automation) : null;
  const activeStageId = stageDefinitions.some(([id]) => id === workerStageId)
    ? workerStageId
    : null;
  const workerItem = workerStageId
    ? byStage[workerStageId].find((item) => item.id === automation.workerClipId) || null
    : null;
  const hasWorkerState = [automation.status, automation.workerStatus, automation.workerStage, automation.workerDetail]
    .some((value) => infrastructureSafeText(value));
  const operation = hasWorkerState ? {
    status: infrastructureSafeText(automation.status, 80),
    workerStatus: infrastructureSafeText(automation.workerStatus, 80),
    stage: infrastructureSafeText(automation.workerStage, 120),
    detail: infrastructureSafeText(automation.workerDetail, 260),
    progress: Object.hasOwn(automation, "workerProgress") && Number.isFinite(Number(automation.workerProgress))
      ? Math.max(0, Math.min(100, Number(automation.workerProgress)))
      : null,
    recordId: infrastructureSafeText(automation.workerClipId, 180),
    lastFailure: automation.workerLastFailure && typeof automation.workerLastFailure === "object"
      ? {
        recordId: infrastructureSafeText(automation.workerLastFailure.clipId, 180),
        message: infrastructureSafeText(automation.workerLastFailure.error, 260),
        at: infrastructureRecordedAt(automation.workerLastFailure.at),
      }
      : null,
  } : null;
  return {
    source: "clipping-office",
    measured: true,
    observedAt: infrastructureRecordedAt(clipping.sourceUpdatedAt),
    activeStageId,
    current: workerItem ? { ...workerItem, stageId: workerStageId } : null,
    operation,
    complete: candidateProjectionComplete,
    stages: stageDefinitions.map(([id, label]) => {
      const stage = infrastructureWorkflowStage(id, label, byStage[id], { active: activeStageId === id });
      return candidateProjectionComplete ? stage : { ...stage, count: null, sampled: true };
    }),
  };
}

function infrastructureStockWorkflow(stock = {}, records = {}, observedAt = null) {
  if (!stock.available) {
    return {
      source: "stock-office",
      measured: false,
      observedAt: null,
      activeStageId: null,
      current: null,
      stages: ["sources", "evaluations", "readiness", "gate", "outputs"].map((id) => infrastructureWorkflowStage(id, ({ sources: "Sources", evaluations: "Evaluations", readiness: "Readiness", gate: "Human Gate", outputs: "Outputs" })[id], null)),
    };
  }
  const sourceItems = listFrom(stock.sources).map((source) => infrastructureRecordItem(source, {
    title: source.label,
    status: source.status,
    updatedAt: source.generatedAt ?? source.lastModified,
    recordType: source.category || "source",
    state: ["error", "stale", "missing"].includes(String(source.status || "").toLowerCase()) ? "attention" : "recorded",
  })).filter(Boolean);
  const evaluationItems = listFrom(stock.records).map((record) => infrastructureRecordItem(record, {
    id: record.id ?? record.ticker,
    title: record.ticker,
    status: record.status ?? record.decision,
    meta: record.decision,
    updatedAt: record.lastUpdated,
    recordType: "evaluation",
    metrics: {
      score: Number.isFinite(Number(record.score)) ? Number(record.score) : null,
      confidence: infrastructureSafeText(record.confidence, 40),
    },
  })).filter(Boolean);
  const readinessCheckByName = new Map();
  listFrom(stock.readiness?.checks).forEach((check, index) => {
    const key = String(check?.name || `check-${index}`).trim().toLowerCase();
    const existing = readinessCheckByName.get(key);
    if (!existing || (existing.passed && check?.passed === false) || (existing.severity !== "blocker" && check?.severity === "blocker")) {
      readinessCheckByName.set(key, check);
    }
  });
  const readinessItems = [...readinessCheckByName.values()].map((check, index) => infrastructureRecordItem({}, {
    id: `readiness:${index}:${String(check.name || "check").slice(0, 40)}`,
    title: check.name,
    status: check.passed ? "passed" : check.severity || "not passed",
    meta: check.detail,
    updatedAt: stock.readiness?.generatedAt,
    recordType: "readiness check",
    state: check.passed ? "recorded" : "attention",
  })).filter(Boolean);
  const approvalItems = listFrom(records.approvals).map((record) => infrastructureRecordItem(record, {
    title: record.title ?? record.actionType ?? record.action,
    recordType: "approval",
    state: INFRASTRUCTURE_PENDING_STATUSES.has(String(record.status || "").toLowerCase()) ? "attention" : "recorded",
  })).filter(Boolean);
  const outputItems = listFrom(records.artifacts).map((record) => infrastructureRecordItem(record, { recordType: record.type || "output" })).filter(Boolean);
  const activeSync = infrastructureNewestItem([...listFrom(stock.syncRuns), ...listFrom(stock.assistantRuns)]
    .filter((run) => INFRASTRUCTURE_RUNNING_STATUSES.has(String(run.status || "").toLowerCase()))
    .map((run) => infrastructureRecordItem(run, { recordType: "stock run" }))
    .filter(Boolean));
  const needsReadiness = readinessItems.some((item) => item.state === "attention");
  const needsGate = approvalItems.some((item) => item.state === "attention");
  const activeStageId = activeSync ? "evaluations" : needsReadiness ? "readiness" : needsGate ? "gate" : null;
  const current = activeSync
    || infrastructureNewestItem(readinessItems.filter((item) => item.state === "attention"))
    || infrastructureNewestItem(approvalItems.filter((item) => item.state === "attention"))
    || null;
  const sourceObservedAt = infrastructureRecordedAt(...listFrom(stock.sources)
    .flatMap((source) => [source.generatedAt, source.lastModified])
    .filter(Boolean)
    .sort((left, right) => String(right).localeCompare(String(left))));
  return {
    source: "stock-office",
    measured: true,
    observedAt: sourceObservedAt || infrastructureRecordedAt(observedAt),
    activeStageId,
    current: current ? { ...current, stageId: activeStageId } : null,
    stages: [
      infrastructureWorkflowStage("sources", "Sources", sourceItems),
      infrastructureWorkflowStage("evaluations", "Evaluations", evaluationItems, { active: activeStageId === "evaluations" }),
      infrastructureWorkflowStage("readiness", "Readiness", readinessItems, { active: activeStageId === "readiness" }),
      infrastructureWorkflowStage("gate", "Human Gate", approvalItems, { active: activeStageId === "gate" }),
      infrastructureWorkflowStage("outputs", "Outputs", outputItems),
    ],
  };
}

function infrastructurePrintWorkflow(payload, observedAt = null) {
  if (Array.isArray(payload?.candidates) && Array.isArray(payload?.artifacts)) {
    const candidates = payload.candidates;
    const designJobs = listFrom(payload.designJobs);
    const artifacts = payload.artifacts;
    const researchRequests = listFrom(payload.researchRequests);
    const candidateItems = candidates.map((candidate) => infrastructureRecordItem(candidate, {
      title: candidate.title,
      status: candidate.status,
      meta: candidate.requirements?.templateName,
      updatedAt: candidate.updatedAt,
      recordType: "product concept",
      state: candidate.assessment?.generationEligible ? "recorded" : "attention",
    })).filter(Boolean);
    const feasibilityItems = candidates.map((candidate) => infrastructureRecordItem(candidate, {
      id: `feasibility:${candidate.id}`,
      title: candidate.title,
      status: candidate.assessment?.printerFit?.status,
      meta: candidate.assessment?.headline,
      updatedAt: candidate.updatedAt,
      recordType: "A1 Mini feasibility",
      state: candidate.assessment?.generationEligible ? "recorded" : "attention",
      metrics: {
        evidenceCoverage: Number(candidate.assessment?.requirementsCoverage?.percent || 0),
        requiredColors: Number(candidate.requirements?.requiredColors || 1),
      },
    })).filter(Boolean);
    const designItems = designJobs.map((job) => {
      const candidate = candidates.find((item) => item.id === job.candidateId);
      return infrastructureRecordItem(job, {
        title: candidate?.title || job.id,
        status: job.status,
        meta: job.generator?.templateId,
        recordType: "design job",
      });
    }).filter(Boolean);
    const sliceItems = artifacts.map((artifact) => infrastructureRecordItem(artifact, {
      title: artifact.name,
      status: artifact.validation?.slicerStatus || "not_run",
      meta: artifact.validation?.slicerStatus === "accepted" ? "Exact profile accepted" : "Exact A1 Mini slice pending",
      recordType: artifact.kind || "design artifact",
      state: artifact.validation?.slicerStatus === "accepted" ? "recorded" : "attention",
      metrics: {
        triangles: Number(artifact.validation?.triangleCount || 0),
        byteSize: Number(artifact.byteSize || 0),
      },
    })).filter(Boolean);
    const approvalItems = researchRequests.map((request) => infrastructureRecordItem(request, {
      title: request.query,
      status: request.status,
      meta: request.provider,
      recordType: "external research approval",
      state: ["pending", "pending_approval", "approved_not_run"].includes(request.status) ? "attention" : "recorded",
    })).filter(Boolean);
    const prototypeItems = artifacts
      .filter((artifact) => artifact.validation?.prototypeStatus && artifact.validation.prototypeStatus !== "not_run")
      .map((artifact) => infrastructureRecordItem(artifact, {
        id: `prototype:${artifact.id}`,
        title: artifact.name,
        status: artifact.validation.prototypeStatus,
        recordType: "prototype evidence",
        state: artifact.validation.prototypeStatus === "verified" ? "recorded" : "attention",
      }))
      .filter(Boolean);
    const currentGate = infrastructureNewestItem(approvalItems.filter((item) => item.state === "attention"));
    const currentSlice = infrastructureNewestItem(sliceItems.filter((item) => item.state === "attention"));
    const candidatesWithDesign = new Set(designJobs.map((job) => job.candidateId));
    const currentDesign = infrastructureNewestItem(candidateItems.filter((item) => {
      const candidate = candidates.find((entry) => entry.id === item.id);
      return candidate?.assessment?.generationEligible && !candidatesWithDesign.has(candidate.id);
    }));
    const currentFeasibility = infrastructureNewestItem(feasibilityItems.filter((item) => item.state === "attention"));
    const activeStageId = currentGate ? "gate" : currentSlice ? "slice" : currentDesign ? "design" : currentFeasibility ? "feasibility" : null;
    const current = currentGate || currentSlice || currentDesign || currentFeasibility;
    return {
      source: "print-shop-product-lab",
      measured: true,
      observedAt: infrastructureRecordedAt(observedAt || payload.updatedAt),
      activeStageId,
      current: current ? { ...current, stageId: activeStageId } : null,
      stages: [
        infrastructureWorkflowStage("concept", "Concepts", candidateItems),
        infrastructureWorkflowStage("feasibility", "A1 Mini fit", feasibilityItems, { active: activeStageId === "feasibility" }),
        infrastructureWorkflowStage("design", "Design files", designItems, { active: activeStageId === "design" }),
        infrastructureWorkflowStage("slice", "Slice check", sliceItems, { active: activeStageId === "slice" }),
        infrastructureWorkflowStage("gate", "Human Gate", approvalItems, { active: activeStageId === "gate" }),
        infrastructureWorkflowStage("prototype", "Prototype", prototypeItems),
      ],
    };
  }
  const stageDefinitions = [
    ["products", "Products"],
    ["orders", "Orders"],
    ["print_jobs", "Print queue"],
    ["gate", "Human Gate"],
    ["outputs", "Outputs"],
  ];
  if (!payload || typeof payload !== "object") {
    return {
      source: "print-shop",
      measured: false,
      observedAt: null,
      activeStageId: null,
      current: null,
      stages: stageDefinitions.map(([id, label]) => infrastructureWorkflowStage(id, label, null)),
    };
  }
  const products = listFrom(payload.products);
  const productById = new Map(products.filter((product) => product?.id).map((product) => [product.id, product]));
  const productItems = products.map((product) => infrastructureRecordItem(product, {
    title: product.name,
    recordType: "product",
  })).filter(Boolean);
  const orderItems = listFrom(payload.orders).map((order) => {
    const product = productById.get(order.product_id);
    return infrastructureRecordItem(order, {
      title: product?.name,
      meta: order.id,
      recordType: "order",
      state: ["pending", "paid", "printing"].includes(String(order.status || "").toLowerCase()) ? "active" : "recorded",
    });
  }).filter(Boolean);
  const printItems = listFrom(payload.printJobs).map((job) => {
    const product = productById.get(job.product_id);
    return infrastructureRecordItem(job, {
      title: product?.name,
      meta: job.order_id,
      recordType: "print job",
      state: ["queued", "printing"].includes(String(job.status || "").toLowerCase()) ? "active" : "recorded",
    });
  }).filter(Boolean);
  const approvalItems = listFrom(payload.approvalRequests).map((approval) => infrastructureRecordItem(approval, {
    title: approval.tool,
    meta: approval.input?.order_id,
    updatedAt: approval.resolved_at ?? approval.created_at,
    recordType: "approval",
    state: INFRASTRUCTURE_PENDING_STATUSES.has(String(approval.status || "").toLowerCase()) ? "attention" : "recorded",
  })).filter(Boolean);
  const outputItems = listFrom(payload.artifacts).map((artifact) => infrastructureRecordItem(artifact, {
    title: artifact.title ?? artifact.name,
    recordType: artifact.type || "output",
  })).filter(Boolean);
  const currentPrint = infrastructureNewestItem(printItems.filter((item) => item.state === "active"));
  const currentOrder = infrastructureNewestItem(orderItems.filter((item) => item.state === "active"));
  const currentApproval = infrastructureNewestItem(approvalItems.filter((item) => item.state === "attention"));
  const current = currentPrint || currentApproval || currentOrder;
  const activeStageId = currentPrint ? "print_jobs" : currentApproval ? "gate" : currentOrder ? "orders" : null;
  return {
    source: "print-shop",
    measured: true,
    observedAt: infrastructureRecordedAt(observedAt),
    activeStageId,
    current: current ? { ...current, stageId: activeStageId } : null,
    stages: [
      infrastructureWorkflowStage("products", "Products", productItems),
      infrastructureWorkflowStage("orders", "Orders", orderItems, { active: activeStageId === "orders" }),
      infrastructureWorkflowStage("print_jobs", "Print queue", printItems, { active: activeStageId === "print_jobs" }),
      infrastructureWorkflowStage("gate", "Human Gate", approvalItems, { active: activeStageId === "gate" }),
      infrastructureWorkflowStage("outputs", "Outputs", outputItems),
    ],
  };
}

async function controlFloorInfrastructureSnapshot(state = readState(), options = {}) {
  const generatedAt = now();
  const includeAdminOnly = Boolean(options.includeAdminOnly);
  const officeContracts = Object.values(BUSINESS_OFFICES).filter((office) => office.id !== "human-gate");
  const officeById = Object.fromEntries(officeContracts.map((office) => [office.id, office]));
  const workflowOwners = new Map();
  officeContracts.forEach((office) => {
    const owners = workflowOwners.get(office.workflowId) || [];
    owners.push(office.id);
    workflowOwners.set(office.workflowId, owners);
  });

  const tasks = listFrom(state.tasks);
  const artifacts = listFrom(state.artifacts);
  const approvals = listFrom(state.approvals);
  const missions = listFrom(state.agent101Missions);
  const runs = listFrom(state.agent101Runs);
  const taskContracts = listFrom(state.agent101TaskContracts);
  const taskById = Object.fromEntries(tasks.filter((item) => item?.id).map((item) => [item.id, item]));
  const artifactById = Object.fromEntries(artifacts.filter((item) => item?.id).map((item) => [item.id, item]));
  const contractById = Object.fromEntries(taskContracts.filter((item) => item?.id).map((item) => [item.id, item]));

  const recordOfficeIds = (record = {}, depth = 0) => {
    const ids = new Set();
    const add = (value) => {
      const normalized = String(value || "").trim();
      if (officeById[normalized]) ids.add(normalized);
    };
    add(record.officeId);
    add(record.roomId);
    add(record.metadata?.officeId);
    add(record.metadata?.roomId);
    add(record.content?.officeId);
    add(record.content?.roomId);
    listFrom(record.officeIds).forEach(add);
    listFrom(record.relatedOffices).forEach(add);
    const contract = contractById[record.taskContractId];
    if (contract) listFrom(contract.relatedOffices).forEach(add);
    if (!ids.size && depth < 2 && record.taskId && taskById[record.taskId]) {
      recordOfficeIds(taskById[record.taskId], depth + 1).forEach(add);
    }
    if (!ids.size && depth < 2 && record.artifactId && artifactById[record.artifactId]) {
      recordOfficeIds(artifactById[record.artifactId], depth + 1).forEach(add);
    }
    if (!ids.size && record.workflowId) {
      const owners = workflowOwners.get(record.workflowId) || [];
      if (owners.length === 1) add(owners[0]);
    }
    return [...ids];
  };

  const grouped = Object.fromEntries(officeContracts.map((office) => [office.id, {
    tasks: [], artifacts: [], approvals: [], missions: [], runs: [], contracts: [],
  }]));
  const unlinked = { tasks: 0, artifacts: 0, approvals: 0, missions: 0, runs: 0, contracts: 0 };
  const assign = (records, key) => {
    records.forEach((record) => {
      const ids = recordOfficeIds(record);
      if (!ids.length) {
        unlinked[key] += 1;
        return;
      }
      ids.forEach((officeId) => grouped[officeId]?.[key].push(record));
    });
  };
  assign(tasks, "tasks");
  assign(artifacts, "artifacts");
  assign(approvals, "approvals");
  assign(missions, "missions");
  assign(runs, "runs");
  assign(taskContracts, "contracts");

  const clipping = readClippingOfficeStateSnapshot();
  const clippingFreshness = infrastructureFreshness(clipping.sourceUpdatedAt, { liveMs: 2 * 60 * 1000, freshMs: 60 * 60 * 1000 });
  const clippingWorkerActive = Boolean(
    clipping.available
    && clippingFreshness !== "stale"
    && (clipping.automation?.status === "running" || clipping.automation?.workerStatus === "processing")
  );
  const clippingPending = clipping.available
    ? listFrom(clipping.approvalRequests).filter((item) => INFRASTRUCTURE_PENDING_STATUSES.has(String(item.status || "").toLowerCase())).length
    : null;

  const stock = loadStockOfficeSnapshot({ rootDir: ROOT, state, runtimeRoot: STOCK_GURU_RUNTIME_ROOT });
  const stockSources = listFrom(stock.sources);
  const stockErrors = stockSources.filter((source) => source.status === "error").length;
  const stockStale = stockSources.filter((source) => source.status === "stale").length;
  const stockFreshness = stockErrors || stockStale ? "stale" : stock.available ? "fresh" : "unknown";

  const printRecorded = readPrintShopRecordedSummary();
  const printProbe = await probePrintShopRuntime();
  const printCounts = printProbe.reachable ? printProbe.counts : printRecorded.counts;
  const genericOfficeSurfaceAvailable = fs.existsSync(path.join(BUSINESS_OFFICE_APP_DIR, "index.html"));
  const connectorRecords = publicConnectorStatuses(state, { includeAdminOnly }).map((connector) => ({
    ...connector,
    presentation: infrastructureConnectorState(connector),
  }));
  const projectWorkspace = agent101ProjectWorkspace.inspectWorkspace({ state, rootDir: ROOT });
  const clippingWorkflow = infrastructureClippingWorkflow(clipping);
  const clippingWorkflowCount = clippingWorkflow.measured && clippingWorkflow.stages.every((stage) => stage.count !== null)
    ? clippingWorkflow.stages.reduce((sum, stage) => sum + Number(stage.count || 0), 0)
    : null;
  const printWorkflow = printProbe.reachable ? printProbe.workflow : printRecorded.workflow;

  const officeNodes = officeContracts.map((office) => {
    const records = grouped[office.id];
    const activeTasks = records.tasks.filter((item) => INFRASTRUCTURE_ACTIVE_STATUSES.has(String(item.status || "").toLowerCase())).length;
    const activeMissions = records.missions.filter((item) => INFRASTRUCTURE_ACTIVE_STATUSES.has(String(item.status || "").toLowerCase())).length;
    const activeRuns = records.runs.filter((item) => INFRASTRUCTURE_ACTIVE_STATUSES.has(String(item.status || "").toLowerCase())).length;
    const pendingApprovals = records.approvals.filter((item) => INFRASTRUCTURE_PENDING_STATUSES.has(String(item.status || "").toLowerCase())).length;
    let counts = {
      tasks: records.tasks.length,
      activeTasks,
      missions: records.missions.length,
      activeMissions,
      runs: records.runs.length,
      activeRuns,
      outputs: records.artifacts.length,
      approvalsPending: pendingApprovals,
    };
    let lifecycle = pendingApprovals ? "waiting_approval" : activeTasks || activeMissions || activeRuns ? "running" : records.artifacts.length ? "completed" : "idle";
    let availability = "online";
    let freshness = "live";
    let evidenceLevel = records.tasks.length || records.artifacts.length || records.approvals.length || records.missions.length || records.runs.length || records.contracts.length ? "recorded" : "declared";
    let warning = "";
    let workflow = infrastructureGenericOfficeWorkflow(records, generatedAt);
    counts.contracts = records.contracts.length;
    const stockIntelligenceStatus = stockIntelligenceScheduler.getStatus();
    if (workflow.activeStageId === "gate") lifecycle = "waiting_approval";
    else if (["active", "verify"].includes(workflow.activeStageId)) lifecycle = "running";

    if (office.id === "clips-office") {
      counts = {
        ...counts,
        watchSessions: clipping.available ? listFrom(clipping.watchSessions).length : null,
        candidates: clippingWorkflowCount,
        officeOutputs: clipping.available ? listFrom(clipping.artifacts).length : null,
        officeApprovalsPending: clippingPending,
      };
      lifecycle = clippingPending || pendingApprovals ? "waiting_approval" : clippingWorkerActive ? "running" : lifecycle;
      availability = clipping.available ? clippingFreshness === "stale" ? "degraded" : "online" : "unknown";
      freshness = clippingFreshness;
      evidenceLevel = clipping.available ? "measured" : evidenceLevel;
      workflow = clippingWorkflow;
      if (!clipping.available) warning = "Clipping Office runtime projection is not available.";
      else if (clippingFreshness === "stale") warning = "Clipping Office runtime projection is stale.";
    } else if (office.id === "stock-office") {
      const stockTrackedRecords = stock.available && Number.isFinite(Number(stock.metrics?.trackedRecords))
        ? Number(stock.metrics.trackedRecords)
        : stock.available ? listFrom(stock.records).length : null;
      counts = {
        ...counts,
        trackedRecords: stockTrackedRecords,
        records: stock.available ? listFrom(stock.records).length : null,
        sources: stock.available ? stockSources.length : null,
        staleSources: stock.available ? stockStale : null,
        sourceErrors: stock.available ? stockErrors : null,
        activeResearch: stock.available ? Number(Boolean(stockIntelligenceStatus?.running)) : null,
      };
      availability = !stock.available ? "unknown" : stockErrors || stockStale ? "degraded" : "online";
      freshness = stockFreshness;
      evidenceLevel = stock.available ? "measured" : evidenceLevel;
      workflow = infrastructureStockWorkflow(stock, records, generatedAt);
      if (!stock.available) warning = "Stock Office source snapshot is unavailable.";
      else if (stockErrors || stockStale) warning = `${stockErrors} source errors · ${stockStale} stale sources.`;
    } else if (office.id === "print-shop-office") {
      counts = { ...counts, ...printCounts };
      lifecycle = printCounts.approvalsPending
        ? "waiting_approval"
        : printWorkflow?.current && printWorkflow.activeStageId !== "gate"
          ? "running"
          : records.artifacts.length || printCounts.artifacts
            ? "completed"
            : "idle";
      availability = printProbe.reachable ? "online" : "offline";
      freshness = printRecorded.freshness;
      evidenceLevel = printRecorded.available ? "recorded" : "declared";
      workflow = printWorkflow;
      warning = printProbe.warning;
    } else if (["etsy-office", "essentrx-office"].includes(office.id)) {
      availability = genericOfficeSurfaceAvailable ? "surface_only" : "offline";
      freshness = genericOfficeSurfaceAvailable ? "fresh" : "unknown";
      warning = genericOfficeSurfaceAvailable ? "Local office surface; no independent store runtime is registered." : "Local office surface is unavailable.";
    }

    return {
      id: `office:${office.id}`,
      kind: "office",
      label: office.name,
      description: office.title,
      lifecycle,
      availability,
      authority: office.id === "stock-office" ? "locked" : "approval_required",
      freshness,
      evidenceLevel,
      observedAt: generatedAt,
      source: { system: office.id === "clips-office" ? "clipping-office" : office.id === "stock-office" ? "stock-office" : office.id === "print-shop-office" ? "print-shop" : "argentum-state", recordId: office.id },
      refs: { officeId: office.id, workflowId: office.workflowId },
      counts,
      route: office.externalUrl || ({
        "depo-habitat": "/?agent101=1",
        "clips-office": "/apps/clipping-office/",
        "stock-office": "/apps/stock-office/",
        "print-shop-office": "/apps/print-shop-office/",
        "etsy-office": "/apps/etsy-office/",
        "essentrx-office": "/apps/essentrx-office/",
      })[office.id] || `/apps/${office.id}/`,
      allowedWork: office.allowedWork,
      blockedWork: office.blockedWork,
      outputs: office.outputs,
      warning,
      workflow,
    };
  });

  const centralPending = approvals.filter((item) => INFRASTRUCTURE_PENDING_STATUSES.has(String(item.status || "").toLowerCase())).length;
  const activeMissions = missions.filter((item) => INFRASTRUCTURE_ACTIVE_STATUSES.has(String(item.status || "").toLowerCase())).length;
  const activeRuns = runs.filter((item) => INFRASTRUCTURE_ACTIVE_STATUSES.has(String(item.status || "").toLowerCase())).length;
  const activeTasks = tasks.filter((item) => INFRASTRUCTURE_ACTIVE_STATUSES.has(String(item.status || "").toLowerCase())).length;
  const printStateAvailable = printProbe.reachable || printRecorded.available;
  const printPending = printStateAvailable ? Number(printCounts.approvalsPending || 0) : null;
  const clippingOutputs = clipping.available ? listFrom(clipping.artifacts).length : null;
  const printOutputs = printStateAvailable ? Number(printCounts.artifacts || 0) : null;
  const totalPending = infrastructureKnownSum(centralPending, clippingPending, printPending);
  const totalOutputs = infrastructureKnownSum(artifacts.length, clippingOutputs, printOutputs);
  const hasPendingApprovals = [centralPending, clippingPending, printPending].some((value) => Number(value) > 0);

  const nodes = [
    {
      id: "workspace:argentum",
      kind: "project",
      label: path.basename(projectWorkspace.root),
      description: "Approved supervised source workspace",
      lifecycle: projectWorkspace.pendingProposals.length ? "waiting_approval" : "idle",
      availability: "online",
      authority: "approval_required",
      freshness: "live",
      evidenceLevel: "measured",
      observedAt: generatedAt,
      source: { system: "agent101-project-workspace", recordId: projectWorkspace.root },
      refs: {},
      counts: { pendingProposals: projectWorkspace.pendingProposals.length, recentProposals: projectWorkspace.recentProposals.length },
    },
    {
      id: "agent:agent-101",
      kind: "agent",
      label: "Agent 101",
      description: "Supervised founder-operator",
      lifecycle: hasPendingApprovals ? "waiting_approval" : activeMissions || activeRuns || activeTasks ? "running" : "idle",
      availability: "online",
      authority: "internal_only",
      freshness: "live",
      evidenceLevel: "measured",
      observedAt: generatedAt,
      source: { system: "argentum-state", recordId: "agent-101" },
      refs: { agentId: "agent-101" },
      counts: { missions: missions.length, activeMissions, runs: runs.length, activeRuns, tasks: tasks.length, activeTasks },
    },
    ...officeNodes,
    {
      id: "gate:human",
      kind: "approval",
      label: "Human Gate",
      description: "Three isolated approval domains",
      lifecycle: hasPendingApprovals ? "waiting_approval" : "idle",
      availability: "online",
      authority: "locked",
      freshness: "live",
      evidenceLevel: "measured",
      observedAt: generatedAt,
      source: { system: "approval-domains", recordId: "human-gate" },
      refs: {},
      counts: { central: centralPending, clippingOffice: clippingPending, printShop: printPending, pending: totalPending },
    },
    {
      id: "output:local",
      kind: "output",
      label: "Saved Outputs",
      description: "Internal artifacts remain approval-gated",
      lifecycle: Number(totalOutputs) > 0 ? "completed" : "idle",
      availability: fs.existsSync(AGENT101_OUTPUT_ROOT) ? "online" : "unknown",
      authority: "internal_only",
      freshness: "live",
      evidenceLevel: "measured",
      observedAt: generatedAt,
      source: { system: "local-output-stores", recordId: AGENT101_OUTPUT_ROOT },
      refs: {},
      counts: { central: artifacts.length, clippingOffice: clippingOutputs, printShop: printOutputs, total: totalOutputs },
      warning: totalOutputs === null ? "One or more output stores could not be measured; the total is unknown." : "",
    },
    {
      id: "memory:local",
      kind: "memory",
      label: "Local Memory",
      description: "Recorded context available to Agent 101",
      lifecycle: "idle",
      availability: "online",
      authority: "internal_only",
      freshness: "live",
      evidenceLevel: "recorded",
      observedAt: generatedAt,
      source: { system: "argentum-state", recordId: "memory" },
      refs: {},
      counts: { notes: infrastructureMemoryCount(state) },
    },
    ...connectorRecords.map((connector) => ({
      id: `connector:${connector.id}`,
      kind: "connector",
      label: connector.label,
      description: connector.presentation.label,
      lifecycle: connector.presentation.verified ? "running" : connector.presentation.state === "error" ? "failed" : "idle",
      availability: connector.presentation.verified ? "online" : connector.presentation.state === "error" ? "degraded" : "unknown",
      authority: connector.presentation.state === "manual_handoff" ? "manual_handoff" : connector.approvalRequired ? "approval_required" : "internal_only",
      freshness: connector.lastTest?.testedAt ? infrastructureFreshness(connector.lastTest.testedAt, { liveMs: 60 * 60 * 1000, freshMs: 7 * DAY_MS }) : "unknown",
      evidenceLevel: connector.presentation.verified ? "measured" : "declared",
      observedAt: generatedAt,
      source: { system: "connector-registry", recordId: connector.id },
      refs: { connectorId: connector.id },
      counts: {},
      connectorState: connector.presentation.state,
      connectorLabel: connector.presentation.label,
      connected: connector.presentation.verified,
      configured: Boolean(connector.configured),
      missingConfigurationCount: listFrom(connector.missingEnv).length,
    })),
  ];

  const edges = [];
  const pushEdge = ({ id, from, to, relation, basis, flow = "idle", authority = "internal_only", evidence = [] }) => {
    edges.push({ id, from, to, relation, basis, flow, authority, evidence });
  };
  pushEdge({
    id: "edge:workspace:agent101",
    from: "workspace:argentum",
    to: "agent:agent-101",
    relation: "approved_workspace",
    basis: "measured_workspace",
    flow: "available",
    evidence: [{ source: "agent101-project-workspace", recordId: projectWorkspace.root, field: "mode", observedAt: generatedAt }],
  });
  officeNodes.forEach((officeNode) => {
    const explicitRecordCount = officeNode.counts.tasks + officeNode.counts.missions + officeNode.counts.runs + Number(officeNode.counts.contracts || 0);
    pushEdge({
      id: `edge:agent101:${officeNode.refs.officeId}`,
      from: "agent:agent-101",
      to: officeNode.id,
      relation: "routes_to",
      basis: explicitRecordCount ? "explicit_record" : "declared_contract",
      flow: explicitRecordCount || officeNode.lifecycle === "running" ? "active" : "idle",
      authority: "internal_only",
      evidence: explicitRecordCount
        ? [{ source: "argentum-state", recordId: officeNode.refs.officeId, field: "officeId", observedAt: generatedAt }]
        : [{ source: "office-registry", recordId: officeNode.refs.officeId, field: "workflowId", observedAt: generatedAt }],
    });
    const pending = Number(officeNode.counts.approvalsPending || 0) + Number(officeNode.counts.officeApprovalsPending || 0);
    pushEdge({
      id: `edge:${officeNode.refs.officeId}:gate`,
      from: officeNode.id,
      to: "gate:human",
      relation: "risk_gated_by",
      basis: pending ? "explicit_record" : "declared_policy",
      flow: pending ? "blocked" : "enforced",
      authority: "approval_required",
      evidence: [{ source: pending ? officeNode.source.system : "office-registry", recordId: officeNode.refs.officeId, field: pending ? "approval" : "blockedWork", observedAt: generatedAt }],
    });
    const officeOutputs = Number(officeNode.counts.outputs || 0) + Number(officeNode.counts.officeOutputs || 0) + Number(officeNode.counts.artifacts || 0);
    pushEdge({
      id: `edge:${officeNode.refs.officeId}:output`,
      from: officeNode.id,
      to: "output:local",
      relation: "produces",
      basis: officeOutputs ? "explicit_record" : "declared_contract",
      flow: officeOutputs ? "recorded" : "idle",
      authority: "internal_only",
      evidence: [{ source: officeOutputs ? officeNode.source.system : "office-registry", recordId: officeNode.refs.officeId, field: officeOutputs ? "artifacts" : "outputs", observedAt: generatedAt }],
    });
  });
  connectorRecords.forEach((connector) => {
    pushEdge({
      id: `edge:agent101:connector:${connector.id}`,
      from: "agent:agent-101",
      to: `connector:${connector.id}`,
      relation: "uses_connector",
      basis: connector.presentation.verified ? "verified_test" : "declared_registry",
      flow: connector.presentation.verified ? "active" : connector.presentation.state,
      authority: connector.presentation.state === "manual_handoff" ? "manual_handoff" : connector.approvalRequired ? "approval_required" : "internal_only",
      evidence: [{ source: "connector-registry", recordId: connector.id, field: connector.presentation.verified ? "lastTest.success" : "status", observedAt: generatedAt }],
    });
  });

  const sources = [
    { id: "core-state", kind: "state_file", status: "available", freshness: infrastructureFreshness(state.meta?.updatedAt), observedAt: generatedAt, sourceUpdatedAt: state.meta?.updatedAt || null, warning: "" },
    { id: "project-workspace", kind: "local_workspace", status: "available", freshness: "live", observedAt: generatedAt, sourceUpdatedAt: null, warning: "" },
    { id: "clipping-office", kind: "local_projection", status: clipping.available ? (clippingFreshness === "stale" ? "degraded" : "available") : "unavailable", freshness: clippingFreshness, observedAt: generatedAt, sourceUpdatedAt: clipping.sourceUpdatedAt || null, warning: clipping.available ? "" : "Clipping Office runtime projection is unavailable." },
    { id: "stock-office", kind: "local_workspace", status: !stock.available ? "unavailable" : stockErrors || stockStale ? "degraded" : "available", freshness: stockFreshness, observedAt: generatedAt, sourceUpdatedAt: stock.generatedAt || null, warning: stockErrors || stockStale ? `${stockErrors} source errors · ${stockStale} stale sources.` : "" },
    { id: "print-shop", kind: "local_workspace", status: printProbe.reachable ? "available" : "unavailable", freshness: printRecorded.freshness, observedAt: printProbe.observedAt, sourceUpdatedAt: printRecorded.recordedAt, warning: printProbe.reachable ? "Physical printer and slicer connections are not configured." : printProbe.warning },
    { id: "connector-registry", kind: "connector_registry", status: "available", freshness: "live", observedAt: generatedAt, sourceUpdatedAt: null, warning: "Connection means a verified successful test; manual handoff is not connected." },
  ];
  const degradedSources = sources.filter((source) => ["unavailable", "degraded"].includes(source.status)).length;
  const unlinkedTotal = Object.values(unlinked).reduce((sum, count) => sum + count, 0);
  const warnings = sources.map((source) => source.warning).filter(Boolean);
  if (unlinkedTotal) warnings.push(`${unlinkedTotal} legacy records have no explicit office link and were not inferred into office routes.`);
  if ((workflowOwners.get("workflow-pod-lab") || []).length > 1) warnings.push("Etsy and Essentrx share one legacy workflow ID; records without an explicit office ID remain unlinked.");
  if (!printProbe.reachable) warnings.push("The integrated Print Shop Product Lab state is unavailable.");

  return {
    schemaVersion: 1,
    snapshotId: `infra-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    generatedAt,
    partial: degradedSources > 0,
    sources,
    summary: {
      registeredOffices: officeNodes.length,
      activeMissions,
      activeTasks,
      activeRuns,
      activeOffices: officeNodes.some((node) => node.availability === "unknown")
        ? null
        : officeNodes.filter((node) => ["running", "waiting_approval", "verifying"].includes(node.lifecycle)).length,
      outputsReady: totalOutputs,
      approvalsPending: totalPending,
      connectorsVerified: connectorRecords.filter((connector) => connector.presentation.verified).length,
      sourcesDegraded: degradedSources,
      unlinkedRecords: unlinkedTotal,
    },
    workspace: {
      root: projectWorkspace.root,
      mode: projectWorkspace.mode,
      readPolicy: projectWorkspace.readPolicy,
      writePolicy: projectWorkspace.writePolicy,
      immutableFiles: projectWorkspace.immutableFiles,
      pendingProposals: projectWorkspace.pendingProposals,
      recentProposals: projectWorkspace.recentProposals,
      outputRoot: AGENT101_OUTPUT_ROOT,
      safety: "supervised_human_gate",
      workerCount: agent101MissionWorkers.size,
    },
    approvalDomains: {
      central: { label: "Central Human Gate", pending: centralPending, evidenceLevel: "recorded" },
      clippingOffice: { label: "Clipping Office approvals", pending: clippingPending, evidenceLevel: clipping.available ? "measured" : "unavailable" },
      printShop: { label: "Print Shop approvals", pending: printPending, evidenceLevel: printRecorded.available ? "recorded" : "unavailable" },
    },
    nodes,
    edges,
    warnings: [...new Set(warnings)].slice(0, 20),
    unlinked,
  };
}

function listFrom(value) {
  return Array.isArray(value) ? value : [];
}

function sectionLines(title, lines = []) {
  const normalized = listFrom(lines).map((line) => String(line || "").trim()).filter(Boolean);
  return [title, ...normalized.map((line) => `• ${line}`)].join("\n");
}

function formatAgent101ExecutiveReport({ title = "AGENT 101 OPERATING STATUS", currentStatus = [], keyFindings = [], risks = [], recommendations = [], nextActions = [] } = {}) {
  return [
    title,
    "",
    sectionLines("CURRENT STATUS", currentStatus),
    "",
    sectionLines("KEY FINDINGS", keyFindings),
    "",
    sectionLines("RISKS", risks),
    "",
    sectionLines("RECOMMENDATIONS", recommendations),
    "",
    sectionLines("NEXT ACTIONS", nextActions),
  ].join("\n");
}

function agent101MessageViolatesExecutiveStyle(message = "") {
  return [
    /\bUser asked\b/i,
    /\bSystem detected\b/i,
    /\bI attempted\b/i,
    /\bI was unable\b/i,
    /\bI need clarification\b/i,
    /\bWould you like me to\b/i,
    /\bBased on your request\b/i,
    /\bHere's what I found\b/i,
    /\bI can help with that\b/i,
  ].some((pattern) => pattern.test(String(message || "")));
}

function agent101MessageHasExecutiveSections(message = "") {
  const text = String(message || "");
  return /CURRENT STATUS/i.test(text)
    && /KEY FINDINGS/i.test(text)
    && /RISKS/i.test(text)
    && /RECOMMENDATIONS/i.test(text)
    && /NEXT ACTIONS/i.test(text);
}

const CLIPPING_OFFICE_OVERVIEW_CACHE_TTL_MS = 1500;
const CLIPPING_OFFICE_OVERVIEW_ARRAY_FIELDS = [
  "streamers",
  "watchSessions",
  "clipCandidates",
  "clipPackages",
  "postingDrafts",
  "approvalRequests",
  "mediaJobs",
  "artifacts",
  "watchEvents",
];
let clippingOfficeOverviewCache = null;
const clippingOfficeLegacyBootstrapRuntimeDirs = new Set();

function projectClippingOfficeOverview(source = {}, fallbackUpdatedAt = null) {
  const projection = {
    sourceUpdatedAt: typeof source.sourceUpdatedAt === "string" && source.sourceUpdatedAt.trim()
      ? source.sourceUpdatedAt
      : fallbackUpdatedAt,
    automation: source.automation && typeof source.automation === "object" ? source.automation : {},
    sourceCounts: source.sourceCounts && typeof source.sourceCounts === "object" ? source.sourceCounts : null,
  };
  for (const field of CLIPPING_OFFICE_OVERVIEW_ARRAY_FIELDS) {
    projection[field] = listFrom(source[field]);
  }
  return projection;
}

function clippingOfficeSnapshotFromProjection(projection, filePath) {
  return {
    available: true,
    filePath,
    sourceUpdatedAt: projection.sourceUpdatedAt,
    automation: projection.automation,
    sourceCounts: projection.sourceCounts,
    ...Object.fromEntries(CLIPPING_OFFICE_OVERVIEW_ARRAY_FIELDS.map((field) => [field, projection[field]])),
  };
}

function clippingOfficeUnavailableSnapshot(filePath, error) {
  return {
    available: false,
    filePath,
    sourceUpdatedAt: null,
    automation: {},
    sourceCounts: null,
    error: error?.code === "ENOENT" ? "not_initialized" : error?.message || "not_initialized",
    ...Object.fromEntries(CLIPPING_OFFICE_OVERVIEW_ARRAY_FIELDS.map((field) => [field, []])),
  };
}

function clippingOfficeOverviewStatSignature(stat) {
  if (!stat) return null;
  return {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    inode: String(stat.ino || ""),
  };
}

function clippingOfficeOverviewSignatureMatches(left, right) {
  return Boolean(left && right)
    && left.mtimeMs === right.mtimeMs
    && left.size === right.size
    && left.inode === right.inode;
}

function cacheClippingOfficeOverview(projection, filePath, stat = null, checkedAtMs = Date.now()) {
  const snapshot = clippingOfficeSnapshotFromProjection(projection, filePath);
  clippingOfficeOverviewCache = {
    checkedAtMs,
    runtimeDir: path.dirname(filePath),
    signature: clippingOfficeOverviewStatSignature(stat),
    snapshot,
  };
  return snapshot;
}

function writeClippingOfficeOverviewAtomic(filePath, projection) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(projection)}\n`, "utf8");
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch (_cleanupError) {}
    throw error;
  }
}

function readClippingOfficeStateSnapshot() {
  const runtimeDir = process.env.CLIPPING_OFFICE_DATA_DIR || path.join(DATA_DIR, "clipping-office");
  const overviewPath = path.join(runtimeDir, "overview.json");
  const legacyStatePath = path.join(runtimeDir, "state.json");
  const checkedAtMs = Date.now();
  if (
    clippingOfficeOverviewCache
    && clippingOfficeOverviewCache.runtimeDir === runtimeDir
    && checkedAtMs - clippingOfficeOverviewCache.checkedAtMs < CLIPPING_OFFICE_OVERVIEW_CACHE_TTL_MS
  ) {
    return clippingOfficeOverviewCache.snapshot;
  }

  let overviewError = null;
  try {
    const overviewStat = fs.statSync(overviewPath);
    const signature = clippingOfficeOverviewStatSignature(overviewStat);
    if (
      clippingOfficeOverviewCache?.runtimeDir === runtimeDir
      && clippingOfficeOverviewSignatureMatches(clippingOfficeOverviewCache.signature, signature)
    ) {
      clippingOfficeOverviewCache.checkedAtMs = checkedAtMs;
      return clippingOfficeOverviewCache.snapshot;
    }
    const overview = JSON.parse(fs.readFileSync(overviewPath, "utf8"));
    const projection = projectClippingOfficeOverview(overview, overviewStat.mtime.toISOString());
    return cacheClippingOfficeOverview(projection, overviewPath, overviewStat, checkedAtMs);
  } catch (error) {
    overviewError = error;
  }

  if (clippingOfficeOverviewCache?.runtimeDir === runtimeDir) {
    clippingOfficeOverviewCache.checkedAtMs = checkedAtMs;
    return clippingOfficeOverviewCache.snapshot;
  }

  let legacyError = null;
  if (!clippingOfficeLegacyBootstrapRuntimeDirs.has(runtimeDir)) {
    try {
      const legacyStat = fs.statSync(legacyStatePath);
      clippingOfficeLegacyBootstrapRuntimeDirs.add(runtimeDir);
      let legacyState = JSON.parse(fs.readFileSync(legacyStatePath, "utf8"));
      const projection = projectClippingOfficeOverview(legacyState, legacyStat.mtime.toISOString());
      legacyState = null;
      try {
        writeClippingOfficeOverviewAtomic(overviewPath, projection);
        const overviewStat = fs.statSync(overviewPath);
        return cacheClippingOfficeOverview(projection, overviewPath, overviewStat, checkedAtMs);
      } catch (_writeError) {
        return cacheClippingOfficeOverview(projection, legacyStatePath, null, checkedAtMs);
      }
    } catch (error) {
      legacyError = error;
      if (error?.code !== "ENOENT") clippingOfficeLegacyBootstrapRuntimeDirs.add(runtimeDir);
    }
  }

  const unavailableError = legacyError && legacyError.code !== "ENOENT"
    ? legacyError
    : overviewError && overviewError.code !== "ENOENT"
      ? overviewError
      : legacyError || overviewError;
  return clippingOfficeUnavailableSnapshot(overviewPath, unavailableError);
}

function clipOfficeCandidateStage(candidate = {}) {
  const workflowStage = String(candidate.productionWorkflow?.stage || "").toLowerCase();
  const status = String(candidate.status || candidate.decision || "").toLowerCase();
  if (candidate.operatorDeclined || candidate.declinedAt || ["rejected", "dismissed", "deleted"].includes(status)) return "dismissed";
  if (workflowStage === "product_ready" || status === "product_ready") return "ready";
  if (workflowStage === "precheck") return "precheck";
  if (
    ["editing"].includes(workflowStage)
    || candidate.builderApproved
    || candidate.builderStatus === "approved"
    || ["builder_ready", "in_builder"].includes(status)
    || candidate.builderDraft
  ) return "studio";
  return "discovery";
}

function clipOfficeCandidateUsesPracticeEvidence(candidate = {}) {
  const sourceType = String(candidate.sourceType || "").trim().toLowerCase();
  const provenance = [candidate.sourceProvenance, candidate.provenance]
    .map((value) => String(value || "").trim().toLowerCase());
  return provenance.includes("demo_source")
    || ["demo", "practice", "agent101_demo"].includes(sourceType);
}

function clipOfficeSessionIsCurrent(session = {}) {
  const latestActivityAt = [
    session.heartbeatAt,
    session.lastMediaAt,
    session.rollingBuffer?.updatedAt,
    session.updatedAt,
  ]
    .map((value) => new Date(value || "").getTime())
    .filter(Number.isFinite)
    .reduce((latest, value) => Math.max(latest, value), 0);
  if (!latestActivityAt) return true;
  if (Date.now() - latestActivityAt <= 90_000) return true;
  const leaseExpiresAt = new Date(session.leaseExpiresAt || "").getTime();
  return Number.isFinite(leaseExpiresAt) && leaseExpiresAt > Date.now();
}

function visibleClipOfficeCandidates(clipState = {}) {
  const activeWatchStatuses = new Set(["queued", "starting", "connecting", "watching", "degraded", "reconnecting"]);
  const activeWatchSessionIds = new Set(
    listFrom(clipState.watchSessions)
      .filter((session) => activeWatchStatuses.has(String(session.status || "").toLowerCase()) && clipOfficeSessionIsCurrent(session))
      .map((session) => session.id)
      .filter(Boolean),
  );
  return listFrom(clipState.clipCandidates).filter((candidate) => {
    if (clipOfficeCandidateUsesPracticeEvidence(candidate)) return false;
    if (candidate?.sourceType !== "live_recording_window") return true;
    if (["studio", "precheck", "ready"].includes(clipOfficeCandidateStage(candidate))) return true;
    return activeWatchSessionIds.has(candidate?.watchSessionId);
  });
}

function clipOfficeCandidateTitle(candidate = {}) {
  const caption = String(candidate.editorialCaption?.primary_caption || candidate.editorialCaption?.text || "").trim();
  if (caption) return caption.slice(0, 90);
  const title = String(candidate.title || "").trim();
  if (title && !/^\d+s clip window \d+:/i.test(title)) return title.slice(0, 90);
  const streamer = String(candidate.streamerName || candidate.creatorName || "Creator").trim();
  return `${streamer} clip`;
}

function clipOfficeThumbnailUrl(value = "") {
  return String(value || "")
    .trim()
    .replaceAll("{width}", "640")
    .replaceAll("{height}", "360");
}

function readArgentumProcessMemorySnapshot() {
  const systemTotalBytes = os.totalmem();
  const systemUsedBytes = Math.max(0, systemTotalBytes - os.freemem());
  const fallbackBytes = Number(process.memoryUsage().rss || 0);
  const fallback = {
    totalBytes: fallbackBytes,
    percentOfSystem: systemTotalBytes ? Number(((fallbackBytes / systemTotalBytes) * 100).toFixed(1)) : 0,
    processCount: 1,
    systemTotalBytes,
    systemUsedBytes,
    systemUsedPercent: systemTotalBytes ? Math.round((systemUsedBytes / systemTotalBytes) * 100) : 0,
    status: "Measured",
    measuredAt: now(),
    source: "macOS process RSS",
    breakdown: [{ id: "core", label: "Argentum core", bytes: fallbackBytes, processCount: 1 }],
  };
  try {
    const output = execFileSync("ps", ["-axo", "pid=,ppid=,rss=,command="], {
      encoding: "utf8",
      timeout: 1500,
      maxBuffer: 4 * 1024 * 1024,
    });
    const rows = output
      .split("\n")
      .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/))
      .filter(Boolean)
      .map((match) => ({ pid: Number(match[1]), ppid: Number(match[2]), rssKb: Number(match[3]), command: match[4] }));
    const byPid = new Map(rows.map((row) => [row.pid, row]));
    let rootPid = process.pid;
    let cursor = byPid.get(process.pid);
    while (cursor && cursor.ppid > 1) {
      if (/\/(?:Argentum OS|Electron)\.app\/Contents\/MacOS\/(?:Argentum OS|Electron)(?:\s|$)/.test(cursor.command)) {
        rootPid = cursor.pid;
        break;
      }
      cursor = byPid.get(cursor.ppid);
    }
    const selected = new Set([rootPid]);
    let expanded = true;
    while (expanded) {
      expanded = false;
      rows.forEach((row) => {
        if (selected.has(row.ppid) && !selected.has(row.pid)) {
          selected.add(row.pid);
          expanded = true;
        }
      });
    }
    selected.add(process.pid);
    const included = rows.filter((row) => selected.has(row.pid));
    if (!included.length) return fallback;
    const buckets = new Map();
    included.forEach((row) => {
      let id = "core";
      let label = "Argentum core";
      if (/ffmpeg|ffprobe|streamlink|yt-dlp/i.test(row.command) && /clipping-office|watch_session|rolling/i.test(row.command)) {
        id = "media";
        label = "Live media workers";
      } else if (/--type=renderer|Helper \(Renderer\)/i.test(row.command)) {
        id = "renderer";
        label = "Interface renderer";
      } else if (/--type=gpu-process/i.test(row.command)) {
        id = "graphics";
        label = "Graphics";
      } else if (/--type=utility/i.test(row.command)) {
        id = "services";
        label = "Local services";
      }
      const current = buckets.get(id) || { id, label, bytes: 0, processCount: 0 };
      current.bytes += Math.max(0, row.rssKb) * 1024;
      current.processCount += 1;
      buckets.set(id, current);
    });
    const totalBytes = [...buckets.values()].reduce((sum, bucket) => sum + bucket.bytes, 0);
    return {
      totalBytes,
      percentOfSystem: systemTotalBytes ? Number(((totalBytes / systemTotalBytes) * 100).toFixed(1)) : 0,
      processCount: included.length,
      systemTotalBytes,
      systemUsedBytes,
      systemUsedPercent: systemTotalBytes ? Math.round((systemUsedBytes / systemTotalBytes) * 100) : 0,
      status: totalBytes >= 2 * 1024 ** 3 ? "High" : totalBytes >= 1024 ** 3 ? "Elevated" : "Efficient",
      measuredAt: now(),
      source: "macOS process RSS",
      breakdown: [...buckets.values()].sort((left, right) => right.bytes - left.bytes),
    };
  } catch {
    return fallback;
  }
}

function clipOfficeEventTitle(type = "", streamerName = "") {
  const labels = {
    chat_keyword_detected: "Chat keyword detected",
    recording_window_waiting_for_source: "Capture source pending",
    candidate_created: "Moment captured",
    candidate_saved: "Clip saved",
    clip_builder_approved: "Clip entered Studio",
    editor_export_completed: "Render completed",
    product_ready_approved: "Clip approved",
  };
  const label = labels[type] || String(type || "Office activity").replaceAll("_", " ");
  return streamerName ? `${streamerName} · ${label}` : label;
}

function buildClipOfficeDashboardSnapshot() {
  const clipState = readClippingOfficeStateSnapshot();
  const processMemory = readArgentumProcessMemorySnapshot();
  const activeWatchStatuses = new Set(["queued", "starting", "connecting", "watching", "degraded", "reconnecting"]);
  const streamerById = new Map(clipState.streamers.map((streamer) => [streamer.id, streamer]));
  const sessionById = new Map(clipState.watchSessions.map((session) => [session.id, session]));
  const latestChatRateBySession = new Map();
  [...clipState.watchEvents]
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
    .forEach((event) => {
      if (!latestChatRateBySession.has(event.sessionId) && Number.isFinite(Number(event.payload?.messagesPerMinute))) {
        latestChatRateBySession.set(event.sessionId, Number(event.payload.messagesPerMinute));
      }
    });
  const activeSessions = clipState.watchSessions
    .filter((session) => activeWatchStatuses.has(String(session.status || "").toLowerCase()) && clipOfficeSessionIsCurrent(session))
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
  const recordingSessions = activeSessions.filter((session) => session.rollingBuffer?.running === true);
  const metadataOnlySessions = activeSessions.filter((session) => (
    String(session.status || "").toLowerCase() === "degraded" && session.rollingBuffer?.running !== true
  ));
  const connectingSessions = Math.max(0, activeSessions.length - recordingSessions.length - metadataOnlySessions.length);
  const watchers = activeSessions.slice(0, 50).map((session) => {
    const streamer = streamerById.get(session.streamerId) || {};
    const liveMetadata = streamer.officialLiveMetadata && typeof streamer.officialLiveMetadata === "object"
      ? streamer.officialLiveMetadata
      : {};
    return {
      id: session.id,
      streamerName: session.streamerName || streamer.displayName || streamer.name || streamer.login || "Live stream",
      platform: session.platform || streamer.platform || "live",
      status: String(session.status || "watching"),
      stage: String(session.currentStage || "Listening to live media"),
      bufferedSeconds: Math.max(0, Number(session.rollingBuffer?.bufferedSeconds || 0)),
      retentionSeconds: Math.max(1, Number(session.rollingBuffer?.retentionSeconds || 180)),
      bufferRunning: Boolean(session.rollingBuffer?.running),
      messagesPerMinute: Math.max(0, Number(latestChatRateBySession.get(session.id) ?? session.lastChatMessagesPerMinute ?? 0)),
      thumbnailUrl: clipOfficeThumbnailUrl(liveMetadata.thumbnail || streamer.thumbnailUrl),
      streamTitle: String(liveMetadata.title || session.streamTitle || ""),
      category: String(liveMetadata.category || session.category || ""),
      viewerCount: Number.isFinite(Number(liveMetadata.viewerCount ?? session.viewerCount))
        ? Math.max(0, Number(liveMetadata.viewerCount ?? session.viewerCount))
        : null,
      verifiedAt: liveMetadata.verifiedAt || null,
      metadataSource: String(liveMetadata.source || ""),
      updatedAt: session.updatedAt || session.rollingBuffer?.updatedAt || "",
    };
  });
  const visibleCandidates = visibleClipOfficeCandidates(clipState);
  const candidates = visibleCandidates.filter((candidate) => clipOfficeCandidateStage(candidate) !== "dismissed");
  const stageCounts = { discovery: 0, studio: 0, precheck: 0, ready: 0 };
  candidates.forEach((candidate) => {
    const stage = clipOfficeCandidateStage(candidate);
    if (Object.hasOwn(stageCounts, stage)) stageCounts[stage] += 1;
  });
  const stagePriority = { studio: 0, precheck: 1, discovery: 2, ready: 3 };
  const recentClips = [...candidates]
    .sort((left, right) => {
      const stageDifference = (stagePriority[clipOfficeCandidateStage(left)] ?? 9) - (stagePriority[clipOfficeCandidateStage(right)] ?? 9);
      return stageDifference || String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || ""));
    })
    .slice(0, 12)
    .map((candidate) => ({
      id: candidate.id,
      streamerName: infrastructureSafeText(candidate.streamerName ?? candidate.creatorName, 160),
      title: infrastructureSafeText(
        candidate.editorialCaption?.primary_caption
        ?? candidate.editorialCaption?.text
        ?? candidate.title,
        160,
      ),
      stage: clipOfficeCandidateStage(candidate),
      quality: candidate.qualityScore !== null && candidate.qualityScore !== undefined && candidate.qualityScore !== "" && Number.isFinite(Number(candidate.qualityScore))
        ? Math.max(0, Math.min(100, Math.round(Number(candidate.qualityScore))))
        : candidate.score !== null && candidate.score !== undefined && candidate.score !== "" && Number.isFinite(Number(candidate.score))
          ? Math.max(0, Math.min(100, Math.round(Number(candidate.score))))
          : null,
      durationSeconds: candidate.durationSeconds !== null && candidate.durationSeconds !== undefined && candidate.durationSeconds !== "" && Number.isFinite(Number(candidate.durationSeconds))
        ? Math.max(0, Math.round(Number(candidate.durationSeconds)))
        : candidate.duration !== null && candidate.duration !== undefined && candidate.duration !== "" && Number.isFinite(Number(candidate.duration))
          ? Math.max(0, Math.round(Number(candidate.duration)))
          : null,
      updatedAt: candidate.updatedAt || candidate.productionWorkflow?.updatedAt || candidate.createdAt || "",
      captionsReady: Boolean(candidate.builderDraft?.editorState?.captions?.enabled),
      stickerReady: Boolean(candidate.builderDraft?.editorState?.sticker?.enabled),
      localSaved: Boolean(candidate.productionWorkflow?.localLibraryPath),
      thumbnailUrl: clipOfficeThumbnailUrl(candidate.thumbnailUrl),
      playbackUrl: String(candidate.productionWorkflow?.playbackUrl || candidate.playbackUrl || ""),
    }));
  const seenEvents = new Set();
  const activity = [...clipState.watchEvents]
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
    .filter((event) => {
      const key = `${event.sessionId || "office"}:${event.type || "activity"}`;
      if (seenEvents.has(key)) return false;
      seenEvents.add(key);
      return true;
    })
    .slice(0, 10)
    .map((event) => {
      const session = sessionById.get(event.sessionId) || {};
      const streamer = streamerById.get(session.streamerId) || {};
      const streamerName = session.streamerName || streamer.displayName || streamer.name || event.payload?.channel || "";
      return {
        id: event.id,
        type: event.type || "activity",
        title: clipOfficeEventTitle(event.type, streamerName),
        detail: String(event.payload?.message || session.currentStage || "Clipping Office state updated.").slice(0, 180),
        createdAt: event.createdAt || "",
      };
    });
  const averageBufferSeconds = watchers.length
    ? Math.round(watchers.reduce((sum, watcher) => sum + watcher.bufferedSeconds, 0) / watchers.length)
    : 0;
  const activeEdits = stageCounts.studio + stageCounts.precheck;
  const automation = clipState.automation || {};
  const focusLabel = String(automation.focusLabel || automation.focus || "").trim() || "Not configured";
  const missingSourceCandidates = clipState.clipCandidates.filter((candidate) => candidate.sourceIntegrity?.status === "missing").length;
  const excludedPracticeCandidates = clipState.clipCandidates.filter(clipOfficeCandidateUsesPracticeEvidence).length;
  const staleActiveSessions = clipState.watchSessions.filter((session) => (
    activeWatchStatuses.has(String(session.status || "").toLowerCase()) && !clipOfficeSessionIsCurrent(session)
  )).length;
  return {
    available: clipState.available,
    error: clipState.error || null,
    updatedAt: clipState.sourceUpdatedAt || null,
    sampledAt: now(),
    status: activeSessions.length ? "live" : clipState.available ? "idle" : "offline",
    headline: activeSessions.length
      ? `${recordingSessions.length} recording · ${metadataOnlySessions.length} metadata-only · ${connectingSessions} connecting`
      : activeEdits ? `Preparing ${activeEdits} clip${activeEdits === 1 ? "" : "s"}` : "Office standing by",
    summary: `${stageCounts.discovery} in Discovery · ${stageCounts.studio} in Studio · ${stageCounts.precheck} in Precheck · ${stageCounts.ready} ready`,
    metrics: {
      activeStreams: activeSessions.length,
      recordingStreams: recordingSessions.length,
      metadataOnlyStreams: metadataOnlySessions.length,
      connectingStreams: connectingSessions,
      capturedClips: candidates.length,
      discovery: stageCounts.discovery,
      studio: stageCounts.studio,
      precheck: stageCounts.precheck,
      ready: stageCounts.ready,
      localLibrary: candidates.filter((candidate) => candidate.productionWorkflow?.localLibraryPath).length,
      averageBufferSeconds,
    },
    workflow: [
      { id: "discovery", label: "Discovery", count: stageCounts.discovery, detail: "Captured moments under review" },
      { id: "studio", label: "Studio", count: stageCounts.studio, detail: "Captions, stickers, and reframing" },
      { id: "precheck", label: "Precheck", count: stageCounts.precheck, detail: "Rendered clips awaiting validation" },
      { id: "ready", label: "Product Ready", count: stageCounts.ready, detail: "Verified and saved locally" },
    ],
    watchers,
    recentClips,
    activity,
    memory: processMemory,
    automation: {
      enabled: automation.enabled === true,
      focus: String(automation.focus || ""),
      focusLabel,
      status: String(automation.status || (automation.enabled ? "running" : "paused")),
      workerStatus: String(automation.workerStatus || "unavailable"),
      workerClipId: String(automation.workerClipId || ""),
      workerProgress: Math.max(0, Math.min(100, Number(automation.workerProgress || 0))),
      workerStage: String(automation.workerStage || ""),
      workerDetail: String(automation.workerDetail || ""),
      workerLastFailure: automation.workerLastFailure && typeof automation.workerLastFailure === "object"
        ? {
          clipId: String(automation.workerLastFailure.clipId || ""),
          error: String(automation.workerLastFailure.error || ""),
          at: automation.workerLastFailure.at || null,
        }
        : null,
      lastScanAt: automation.lastScanAt || null,
      nextScanAt: automation.nextScanAt || null,
      matchedStreams: Math.max(0, Number(automation.matchedStreams || 0)),
      scannedStreams: Math.max(0, Number(automation.scannedStreams || 0)),
      activeFocusedStreams: Math.max(0, Number(automation.activeFocusedStreams || 0)),
      scanTruncated: automation.scanTruncated === true,
      providerPages: automation.providerPages && typeof automation.providerPages === "object"
        ? automation.providerPages
        : {},
      lastError: String(automation.lastError || ""),
      sourceIntegrity: {
        status: String(automation.sourceIntegrity?.status || (missingSourceCandidates ? "attention" : "verified")),
        missingProductionSources: Math.max(0, Number(automation.sourceIntegrity?.missingProductionSources ?? missingSourceCandidates)),
        checkedAt: automation.sourceIntegrity?.checkedAt || null,
        detail: String(automation.sourceIntegrity?.detail || ""),
      },
    },
    dataQuality: {
      mode: "measured",
      label: "Verified live data",
      source: "Clipping Office state",
      sourceUpdatedAt: clipState.sourceUpdatedAt || null,
      sampledAt: now(),
      estimatedFields: [],
      excludedHistoricalCandidates: Math.max(0, clipState.clipCandidates.length - visibleCandidates.length - excludedPracticeCandidates),
      excludedPracticeCandidates,
      missingSourceCandidates,
      staleActiveSessions,
      candidateRule: "Active Discovery windows plus durable Studio, Precheck, and Product Ready clips",
    },
  };
}

function buildClipOfficeOperationsSnapshot() {
  const clipState = readClippingOfficeStateSnapshot();
  const activeWatchStatuses = new Set(["queued", "starting", "connecting", "watching", "degraded", "reconnecting"]);
  const terminalWatchStatuses = new Set(["stream_ended", "completed", "failed", "cancelled"]);
  const streamers = clipState.streamers;
  const watchSessions = clipState.watchSessions;
  const candidates = clipState.clipCandidates;
  const packages = clipState.clipPackages;
  const drafts = clipState.postingDrafts;
  const mediaJobs = clipState.mediaJobs;
  const approvals = clipState.approvalRequests;
  const monitoredStreamers = streamers.filter((streamer) => streamer.monitorEnabled);
  const activeWatchSessions = watchSessions.filter((session) => (
    activeWatchStatuses.has(String(session.status || "").toLowerCase()) && clipOfficeSessionIsCurrent(session)
  ));
  const failedWatchSessions = watchSessions.filter((session) => String(session.status || "").toLowerCase() === "failed");
  const liveStreamers = streamers.filter((streamer) => String(streamer.liveStatus || "").toLowerCase() === "live");
  const approvedCandidates = candidates.filter((candidate) => {
    const decision = String(candidate.decision || candidate.status || "").toLowerCase();
    return ["accepted", "approved", "ready", "ready_to_package", "packaged"].includes(decision) || Number(candidate.qualityScore || candidate.score || 0) >= 80;
  });
  const dismissedCandidates = candidates.filter((candidate) => {
    const decision = String(candidate.decision || candidate.status || "").toLowerCase();
    return ["rejected", "dismissed", "deleted"].includes(decision);
  });
  const pendingCandidates = candidates.filter((candidate) => {
    if (approvedCandidates.includes(candidate) || dismissedCandidates.includes(candidate)) return false;
    const decision = String(candidate.decision || candidate.status || "").toLowerCase();
    return !decision || ["review", "recording", "pending", "queued", "source_pending"].includes(decision) || candidate.qualityScore == null;
  });
  const completedExports = mediaJobs.filter((job) => String(job.status || "").toLowerCase() === "completed").length
    + clipState.artifacts.filter((artifact) => artifact.type === "rendered_clip").length;
  const failedExports = mediaJobs.filter((job) => ["failed", "error"].includes(String(job.status || "").toLowerCase())).length;
  const pendingDrafts = drafts.filter((draft) => !["approved", "posted", "published", "dismissed", "rejected"].includes(String(draft.status || draft.approvalStatus || "").toLowerCase()));
  const pendingApprovals = approvals.filter((approval) => String(approval.status || "").toLowerCase() === "pending");
  const failures = failedWatchSessions.length + failedExports;
  const successRate = candidates.length ? Math.round((approvedCandidates.length / candidates.length) * 100) : 0;
  const inactiveMonitored = monitoredStreamers.filter((streamer) => !liveStreamers.some((live) => live.id === streamer.id));

  const recommendations = [];
  if (!clipState.available) recommendations.push("Initialize Clip Office state by opening the local app and running one watch cycle.");
  if (!monitoredStreamers.length) recommendations.push("Add and approve at least three streamers before relying on Clip Radar volume.");
  if (activeWatchSessions.length && !candidates.length) recommendations.push("Restart watcher coverage and verify fresh 30-second windows are being written.");
  if (pendingCandidates.length > Math.max(10, approvedCandidates.length * 3)) recommendations.push("Delete weak candidates in bulk before the review queue buries the good clips.");
  if (pendingApprovals.length) recommendations.push("Clear Human Gate posting decisions before expanding the queue.");
  if (failures) recommendations.push("Resolve failed watch/export records before running another production cycle.");
  if (!recommendations.length) recommendations.push("Keep monitoring live streamers and advance the strongest verified candidates to Clip Builder.");

  return {
    available: clipState.available,
    filePath: clipState.filePath,
    error: clipState.error || null,
    totalStreamers: streamers.length,
    monitoredStreamers: monitoredStreamers.length,
    activeStreams: activeWatchSessions.length,
    liveNow: liveStreamers.length,
    offlineStreamers: Math.max(0, streamers.length - liveStreamers.length),
    inactiveMonitored: inactiveMonitored.length,
    candidateClips: candidates.length,
    clipsApproved: approvedCandidates.length,
    clipsPending: pendingCandidates.length,
    clipsDismissed: dismissedCandidates.length,
    packages: packages.length,
    exportCompleted: completedExports,
    exportPending: mediaJobs.filter((job) => !["completed", "failed", "error"].includes(String(job.status || "").toLowerCase())).length,
    exportFailed: failedExports,
    postingQueue: pendingDrafts.length,
    postingDrafts: drafts.length,
    pendingApprovals: pendingApprovals.length,
    failures,
    successRate,
    recommendations,
    terminalWatchSessions: watchSessions.filter((session) => terminalWatchStatuses.has(String(session.status || "").toLowerCase())).length,
  };
}

function clipOfficeCurrentStatusLines(metrics) {
  return [
    `Active streams: ${metrics.activeStreams}.`,
    `Streamers monitored: ${metrics.monitoredStreamers}/${metrics.totalStreamers}.`,
    `Candidate clips: ${metrics.candidateClips}.`,
    `Clips approved: ${metrics.clipsApproved}.`,
    `Clips pending: ${metrics.clipsPending}.`,
    `Export status: ${metrics.exportCompleted} complete, ${metrics.exportPending} pending, ${metrics.exportFailed} failed.`,
    `Posting queue: ${metrics.postingQueue} pending draft(s), ${metrics.pendingApprovals} Human Gate approval(s).`,
    `Failures: ${metrics.failures}.`,
    `Success rate: ${metrics.successRate}%.`,
  ];
}

function buildClipOfficeExecutiveResponse(message, context = {}) {
  const metrics = buildClipOfficeOperationsSnapshot();
  const history = normalizedAgent101ChatHistory(context);
  const memoryLine = history.length
    ? `Thread memory retained: ${history.slice(-3).map((item) => item.text).join(" | ").slice(0, 240)}.`
    : "";
  const keyFindings = [
    metrics.available ? "Clip Office state is readable from the local runtime." : `Clip Office state is not initialized at ${metrics.filePath}.`,
    metrics.activeStreams ? `${metrics.activeStreams} active watcher(s) should be producing current windows.` : "No active watcher is currently recorded.",
    metrics.candidateClips ? `${metrics.candidateClips} candidate clip(s) exist for review/scoring.` : "No candidate clips are available yet.",
    metrics.postingQueue || metrics.pendingApprovals ? "Posting is bottlenecked at draft/Human Gate review." : "Posting queue is clear.",
    memoryLine,
  ].filter(Boolean);
  const risks = [
    !metrics.available ? "Operational data is incomplete until Clip Office writes its state file." : "",
    metrics.activeStreams && !metrics.candidateClips ? "Monitoring without candidates indicates a watcher ingestion or radar refresh gap." : "",
    metrics.clipsPending > Math.max(20, metrics.clipsApproved * 4) ? "Review backlog is high enough to hide good clips." : "",
    metrics.inactiveMonitored ? `${metrics.inactiveMonitored} monitored streamer(s) are not live; watch capacity may be underused.` : "",
    metrics.failures ? `${metrics.failures} failure record(s) need cleanup before scale-up.` : "",
  ].filter(Boolean);
  return {
    message: formatAgent101ExecutiveReport({
      title: "CLIP OFFICE STATUS",
      currentStatus: clipOfficeCurrentStatusLines(metrics),
      keyFindings,
      risks: risks.length ? risks : ["No critical Clip Office blocker is visible in the local state."],
      recommendations: metrics.recommendations,
      nextActions: [
        metrics.activeStreams && !metrics.candidateClips ? "Refresh Clip Radar and restart the active watcher if no 30-second window appears." : "Review the strongest current candidates and delete obvious low-quality windows.",
        metrics.postingQueue || metrics.pendingApprovals ? "Clear Human Gate posting decisions before adding more queue volume." : "Keep the watch cycle running and package only clips with verified media or strong live-window evidence.",
      ],
    }),
    taskType: "clips",
    suggestedActions: [
      { label: "Refresh Clip Radar", action: "refresh_clip_radar", requiresApproval: false },
      { label: "Review pending clips", action: "review_clip_candidates", requiresApproval: false },
      { label: "Package approvals", action: "package_for_approval", requiresApproval: true },
    ],
    artifacts: [
      {
        type: "operations_report",
        title: "Clip Office operating snapshot",
        content: JSON.stringify(metrics, null, 2),
      },
    ],
    requiresApproval: false,
    riskLevel: metrics.failures || metrics.pendingApprovals ? "medium" : "low",
    blockedAction: null,
    logs: ["Clip Office operational snapshot generated from local runtime state."],
  };
}

function buildGeneralExecutiveResponse(message, context = {}) {
  const state = readState();
  const readiness = agent101Readiness(state);
  const history = normalizedAgent101ChatHistory(context);
  const activeRuns = listFrom(state.agent101Runs).filter((run) => ["queued", "running", "waiting_approval", "verifying"].includes(run.status)).length;
  const pendingTasks = listFrom(state.tasks).filter((task) => ["queued", "needs_revision", "running"].includes(task.status)).length;
  const artifactsReady = listFrom(state.artifacts).filter((artifact) => ["draft_ready", "ready", "complete"].includes(artifact.status)).length;
  const pendingApprovals = listFrom(state.approvals).filter((approval) => approval.status === "pending").length;
  const recommendations = [
    pendingApprovals ? "Clear Human Gate approvals before adding more external-risk work." : "Move the next safe internal task into execution.",
    readiness.openaiConnection === "ready" ? "Use live model calls only for analysis that benefits from language reasoning; keep secrets server-side." : "Keep local deterministic mode active until provider status is ready.",
    "Convert repeated operator decisions into sourced memory after confirmation.",
  ];
  return {
    message: formatAgent101ExecutiveReport({
      title: "AGENT 101 OPERATING STATUS",
      currentStatus: [
        `Provider mode: ${readiness.providerMode}.`,
        `Human Gate: ${readiness.humanGate}.`,
        `External actions: ${readiness.externalActions}.`,
        `Active runs: ${activeRuns}.`,
        `Queued tasks: ${pendingTasks}.`,
        `Pending approvals: ${pendingApprovals}.`,
        `Ready artifacts: ${artifactsReady}.`,
      ],
      keyFindings: [
        `Business readiness score: ${agent101Os.businessReadiness(state).score}%.`,
        history.length ? `Thread memory retained across ${history.length} recent message(s).` : "No prior thread context was supplied with this message.",
        pendingTasks ? `${pendingTasks} task(s) need operator or Agent 101 movement.` : "No queued task bottleneck is visible.",
      ],
      risks: [
        pendingApprovals ? "Approval backlog can block posting, account, or external execution lanes." : "No current approval backlog.",
        readiness.openaiConnection === "ready" ? "" : "Live model provider is not the current dependable reasoning layer.",
        "External actions remain locked until Human Gate creates an exact approval record.",
      ].filter(Boolean),
      recommendations,
      nextActions: [
        "Convert the current request into a bounded task contract or run the relevant office workflow.",
        "Update memory only after a durable decision is confirmed.",
      ],
    }),
    taskType: "general",
    suggestedActions: [
      { label: "Create task plan", action: "create_task_plan", requiresApproval: false },
      { label: "Run safe workflow", action: "run_safe_internal_workflow", requiresApproval: false },
      { label: "Package approval", action: "package_for_approval", requiresApproval: true },
    ],
    artifacts: [
      {
        type: "operations_report",
        title: "Agent 101 operating snapshot",
        content: `Request: ${String(message || "").slice(0, 1200)}\nReadiness: ${JSON.stringify(readiness, null, 2).slice(0, 3000)}`,
      },
    ],
    requiresApproval: false,
    riskLevel: pendingApprovals ? "medium" : "low",
    blockedAction: null,
    logs: ["Agent 101 executive operating snapshot generated."],
  };
}

function clipWorkflowStages() {
  return [
    "Plan & Brief",
    "Gather Assets",
    "Create Clip Structure",
    "CapCut Handoff",
    "Preview Package",
    "Human Gate",
    "Output",
  ];
}

function buildClipBrief(payload = {}) {
  const title = String(payload.title || payload.goal || "Three short clips from raw footage").trim();
  const audience = String(payload.audience || "warm audience").trim();
  const style = String(payload.style || "clean, fast, useful, premium").trim();
  const format = String(payload.format || "9:16 vertical").trim();
  return {
    title,
    goal: String(payload.goal || "Create 3 short clips from raw footage and prepare approval-ready posting drafts.").trim(),
    audience,
    format,
    duration: String(payload.duration || "15-30s each").trim(),
    style,
    filesNeeded: [
      "Raw footage clips",
      "Logo or brand mark if needed",
      "Music/audio preference",
      "Product or topic notes",
      "Posting account target",
    ],
    clipStructures: [1, 2, 3].map((index) => ({
      clip: index,
      hook: `Open with the strongest visual or claim in the first 2 seconds for clip ${index}.`,
      body: "Cut to the proof, result, or process. Keep each shot short and captions readable.",
      captionMoments: ["Hook text", "Proof point", "CTA"],
      visualCuts: ["Fast intro cut", "Detail close-up", "Result shot"],
      cta: "Save this, follow for the next step, or review the full package.",
    })),
    capcut: {
      aspectRatio: "9:16",
      resolution: "1080x1920",
      exportFormat: "MP4",
      captions: "Auto captions on, manually reviewed before export.",
      effects: "Clean zooms, light motion blur, no distracting overlays.",
      transitions: "Fast cuts or subtle push transitions.",
      musicNotes: "Use low-volume music under voice or natural audio; no copyrighted audio unless licensed.",
    },
    postingDrafts: {
      tiktok: {
        caption: `${title}: quick version. Draft only until Human Gate approves posting.`,
        hashtags: ["#shorts", "#behindthescenes", "#business", "#draft"],
      },
      instagram: {
        caption: `${title} - save this workflow. Draft only.`,
        hashtags: ["#reels", "#creatorworkflow", "#smallbusiness"],
      },
      youtube: {
        title: `${title} | Short draft`,
        description: "Prepared by Agent 101. Human approval required before posting.",
      },
    },
    thumbnailIdea: "High-contrast still with 3-5 word headline and clear subject.",
    checklist: ["Confirm raw files", "Review captions", "Export MP4", "Attach posting drafts", "Submit to Human Gate"],
    status: "Draft",
  };
}

function buildTaskPlanArtifact(payload = {}, office = officeDefinition(payload.officeId)) {
  const message = String(payload.message || payload.goal || payload.title || "Create a bounded supervised task.").trim();
  return {
    type: "task_plan",
    title: payload.title || `${office.name}: Task plan`,
    summary: `Bounded ${office.name} task plan prepared by Agent 101.`,
    risk: payload.riskLevel || office.risk,
    workflowId: office.workflowId,
    content: {
      officeId: office.id,
      office: office.name,
      goal: message,
      allowedWork: office.allowedWork,
      requiredInputs: office.requiredInputs,
      outputs: office.outputs,
      blockedWork: office.blockedWork,
      steps: [
        "Clarify the exact operator goal.",
        "Collect only local or approved context.",
        "Draft the work product with evidence labels.",
        "Check risk and blocked actions.",
        "Package anything external for Human Gate.",
        "Log what changed.",
      ],
    },
    sections: [
      { label: "Goal", body: message },
      { label: "Allowed work", body: office.allowedWork.join(", ") },
      { label: "Blocked work", body: office.blockedWork.join(", ") },
    ],
    blockedActions: office.blockedWork,
  };
}

function buildCodexPromptArtifact(payload = {}, office = officeDefinition(payload.officeId)) {
  const message = String(payload.message || payload.goal || "Implement the bounded Argentum change safely.").trim();
  return {
    type: "codex_prompt",
    title: payload.title || `${office.name}: Codex prompt`,
    summary: "Scoped implementation prompt prepared for Codex.",
    risk: payload.riskLevel || office.risk,
    workflowId: office.workflowId,
    content: [
      "You are editing the existing Argentum OS project.",
      `Focus area: ${office.title}.`,
      `Goal: ${message}`,
      "Keep API keys and credentials server-side only.",
      "Do not execute external actions, publish, spend, change accounts, or create live agents.",
      "Implement the smallest safe backend/frontend path, run npm run check, and verify the touched UI or endpoint.",
    ].join("\n"),
    sections: [
      { label: "Focus", body: office.title },
      { label: "Goal", body: message },
      { label: "Safety", body: "No external execution. Human Gate handles risky actions." },
    ],
    blockedActions: office.blockedWork,
  };
}

function buildConnectorSetupChecklist(payload = {}) {
  const office = officeDefinition(payload.officeId || "clips-office");
  const requested = Array.isArray(payload.connectors) && payload.connectors.length
    ? payload.connectors
    : ["twitch", "tiktok", "youtube", "capcut", "google_drive"];
  const connectors = requested
    .filter((connectorId) => CONNECTOR_DEFINITIONS[connectorId])
    .map((connectorId) => publicConnectorStatus(connectorId));
  return {
    type: "connector_setup_checklist",
    title: payload.title || "Clipping account setup checklist",
    summary: "Manual-handoff setup checklist for clipping accounts and creator tools. No login or API key creation performed.",
    risk: "medium",
    workflowId: office.workflowId,
    content: {
      officeId: office.id,
      operatorOwns: [
        "Create or log into Twitch, TikTok, YouTube, CapCut, and Drive accounts manually.",
        "Create OAuth apps or API keys manually when approved.",
        "Add secrets only to Railway environment variables.",
        "Confirm every connector test from the authenticated Argentum UI.",
      ],
      agent101CanDo: [
        "Prepare env var names and setup steps.",
        "Create content workflow plans.",
        "Draft captions, metadata, checklists, and approval bundles.",
        "Log connector readiness without exposing keys.",
      ],
      agent101CannotDo: [
        "Log into accounts.",
        "Create or rotate API keys.",
        "Publish videos.",
        "Change profile/account settings.",
        "Spend money or enable campaigns.",
      ],
      connectors,
    },
    sections: connectors.map((connector) => ({
      label: connector.label,
      body: `${connector.status}. Env: ${connector.requiredEnv.join(", ") || "none"}. Missing: ${connector.missingEnv.join(", ") || "none"}.`,
    })),
    blockedActions: ["browser_login", "change_api_key", "modify_account", "publish_video", "spend_money"],
  };
}

function createAgent101Artifact(state, artifact) {
  const next = {
    id: artifact.id || `artifact-agent101-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    officeId: artifact.officeId || artifact.content?.officeId || null,
    workflowId: artifact.workflowId || "workflow-clips-office",
    type: artifact.type || "clips_package",
    title: artifact.title || "Agent 101 artifact",
    summary: artifact.summary || "Draft artifact prepared by Agent 101.",
    status: artifact.status || "draft_ready",
    risk: artifact.risk || "medium",
    content: artifact.content || null,
    fileRefs: Array.isArray(artifact.fileRefs) ? artifact.fileRefs : [],
    evidence: Array.isArray(artifact.evidence) ? artifact.evidence : ["Created locally by Agent 101."],
    sections: Array.isArray(artifact.sections) ? artifact.sections : [],
    blockedActions: Array.isArray(artifact.blockedActions) ? artifact.blockedActions : ["external posting"],
    createdBy: "agent-101",
    createdAt: now(),
    updatedAt: now(),
  };
  state.artifacts.unshift(next);
  state.artifacts = state.artifacts.slice(0, 50);
  return next;
}

function createAgent101Task(payload = {}) {
  const state = readState();
  const text = String(payload.text || payload.goal || payload.title || "Create a Clips Office package for review.").trim();
  const office = officeDefinition(payload.officeId || payload.office || "clips-office");
  const classification = classifyTask(text, payload.workflowId || office.workflowId || "workflow-clips-office");
  const task = {
    id: `agent101-task-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: String(payload.title || text).slice(0, 90),
    goal: String(payload.goal || text),
    operatorText: text,
    officeId: office.id,
    workflowId: classification.workflowId,
    intent: payload.intent || office.intent || classification.intent,
    risk: payload.riskLevel || payload.risk || office.risk || classification.risk,
    status: "queued",
    stage: "Plan & Brief",
    rawFiles: Array.isArray(payload.rawFiles) ? payload.rawFiles : [],
    script: String(payload.script || ""),
    captions: [],
    editBrief: null,
    postingDrafts: [],
    approvalStatus: "not_requested",
    evidence: ["Agent 101 received a bounded local job.", "No external action has been executed."],
    output: "",
    createdAt: now(),
    updatedAt: now(),
  };
  state.tasks.unshift(task);
  state.mission.activeWorkflowId = task.workflowId;
  state.agent101 = { ...agent101Model(state), currentOffice: office.name };
  audit(state, "Agent 101 received task", task.title);
  if (APP_MODE === "local" && localDatabaseStatus?.dbPath) {
    localDatabase.enqueueLocalJob(localDatabaseStatus.dbPath, {
      id: `local-${task.id}`,
      type: "agent101_task",
      status: "queued",
      payload: { taskId: task.id, officeId: task.officeId, workflowId: task.workflowId, risk: task.risk },
    });
  }
  writeState(state);
  return { task, state };
}

function createOfficeTask(officeId, payload = {}) {
  const office = officeDefinition(officeId || payload.officeId);
  const result = createAgent101Task({
    ...payload,
    officeId: office.id,
    workflowId: payload.workflowId || office.workflowId,
    title: payload.title || `${office.name}: ${payload.intent || "bounded task"}`,
    goal: payload.goal || payload.message || `Prepare supervised work for ${office.name}.`,
  });
  return { ...result, office };
}

function createOfficeArtifact(officeId, payload = {}) {
  const office = officeDefinition(officeId || payload.officeId);
  const state = readState();
  const artifact = createAgent101Artifact(state, {
    ...payload,
    officeId: office.id,
    workflowId: payload.workflowId || office.workflowId,
    type: payload.type || "office_artifact",
    title: payload.title || `${office.name}: Draft artifact`,
    summary: payload.summary || `Draft artifact prepared for ${office.name}.`,
    risk: payload.risk || payload.riskLevel || office.risk,
    content: payload.content && typeof payload.content === "object"
      ? { ...payload.content, officeId: office.id }
      : {
        officeId: office.id,
        message: payload.message || payload.goal || "Draft artifact prepared locally.",
        allowedWork: office.allowedWork,
        blockedWork: office.blockedWork,
      },
    blockedActions: payload.blockedActions || office.blockedWork,
  });
  addMemory(state, "working", `${office.name} artifact drafted`, artifact.summary, office.id);
  audit(state, "Office artifact drafted", `${office.name}: ${artifact.title}`);
  writeState(state);
  return { artifact, office, state };
}

function createClipsBrief(payload = {}) {
  const state = readState();
  const brief = buildClipBrief(payload);
  const artifact = createAgent101Artifact(state, {
    type: "clips_edit_brief",
    title: `Clip brief: ${brief.title}`,
    summary: `${brief.format}, ${brief.duration}, ${brief.clipStructures.length} clips. CapCut handoff ready.`,
    content: brief,
    sections: [
      { label: "Plan & Brief", body: brief.goal },
      { label: "Assets Needed", body: brief.filesNeeded.join(", ") },
      { label: "CapCut Handoff", body: `${brief.capcut.resolution}, ${brief.capcut.captions}, ${brief.capcut.exportFormat}.` },
      { label: "Posting Drafts", body: "TikTok, Instagram, and YouTube draft copy created. Posting remains blocked." },
    ],
    blockedActions: ["publish video", "upload to TikTok", "change account settings", "spend ad money"],
  });
  addMemory(state, "working", "Clips brief prepared", brief.goal, "clips_office");
  audit(state, "Clips brief created", artifact.title);
  writeState(state);
  return { brief, artifact };
}

function createClipsApprovalPackage(payload = {}) {
  const state = readState();
  const brief = payload.brief || buildClipBrief(payload);
  const artifact = createAgent101Artifact(state, {
    type: "posting_package",
    title: `Posting package: ${brief.title || "Clips Office"}`,
    summary: "Approval-ready draft package for short-form video posting. No external upload performed.",
    content: brief,
    status: "pending_review",
    blockedActions: ["publish_video", "upload_to_tiktok", "direct_post", "change_account_settings", "spend_money"],
  });
  const approval = {
    id: `approval-clips-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: `Review Clips Office package: ${brief.title || "short-form video"}`,
    actionType: "publish_video",
    risk: "medium",
    riskLevel: "medium",
    evidence: "Agent 101 created a local clips brief, CapCut handoff, draft captions, hashtag notes, and export checklist.",
    action: "Review and decide whether this draft can move toward manual posting. No upload, post, account change, or spend has occurred.",
    status: "pending",
    createdBy: "agent-101",
    artifactId: artifact.id,
    workflowId: "workflow-clips-office",
    createdAt: now(),
  };
  state.approvals.unshift(approval);
  state.approvals = state.approvals.slice(0, 50);
  audit(state, "Approval requested", approval.title);
  writeState(state);
  return { package: artifact, approval };
}

function createHumanGateRequest(payload = {}) {
  const actionType = String(payload.actionType || detectRiskyAction(payload.message || payload.title || "") || "external_api_action");
  const state = readState();
  const linkedId = String(payload.linkedId || "").slice(0, 240) || null;
  const existing = linkedId
    ? (state.approvals || []).find((item) => item.linkedId === linkedId && item.actionType === actionType && item.status === "pending")
    : null;
  if (existing) return { approval: existing, message: "Human Gate approval required.", requiresApproval: true, riskLevel: existing.riskLevel };
  const evidenceObject = payload.evidence && typeof payload.evidence === "object" ? payload.evidence : null;
  const details = payload.details && typeof payload.details === "object"
    ? payload.details
    : evidenceObject?.details && typeof evidenceObject.details === "object"
      ? evidenceObject.details
      : {};
  const evidence = typeof payload.evidence === "string"
    ? payload.evidence
    : evidenceObject?.reason || "Agent 101 routed this request to Human Gate before any consequential action.";
  const approval = {
    id: `approval-agent101-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: String(payload.title || `Review blocked action: ${actionType}`),
    actionType,
    risk: payload.riskLevel || "high",
    riskLevel: payload.riskLevel || "high",
    evidence: String(evidence).slice(0, 4000),
    action: String(payload.action || "Operator approval required. No external action was executed."),
    exactScope: String(payload.exactScope || "Only the exact action and details recorded on this request are authorized.").slice(0, 4000),
    originalExactScope: String(payload.exactScope || "Only the exact action and details recorded on this request are authorized.").slice(0, 4000),
    details,
    originalDetails: JSON.parse(JSON.stringify(details)),
    grantedDetails: null,
    linkedId,
    officeId: payload.officeId || details.officeId || null,
    workflowId: payload.workflowId || null,
    runId: payload.runId || evidenceObject?.runId || null,
    missionId: payload.missionId || null,
    reversible: payload.reversible !== false,
    expiresAt: payload.expiresAt || new Date(Date.now() + (1000 * 60 * 60 * 24)).toISOString(),
    expectedPostcondition: String(payload.expectedPostcondition || "The exact approved action completes and is recorded in the audit trail.").slice(0, 2000),
    rollbackPlan: String(payload.rollbackPlan || "Stop on mismatch; source edits use atomic rollback and output actions remain isolated.").slice(0, 2000),
    status: "pending",
    useCount: 0,
    consumedAt: null,
    createdBy: "agent-101",
    createdAt: now(),
  };
  state.approvals.unshift(approval);
  const activeApprovals = state.approvals.filter((item) => ["pending", "approved", "needs_revision"].includes(item.status) && !item.consumedAt);
  const archivedApprovals = state.approvals.filter((item) => !activeApprovals.includes(item)).slice(0, Math.max(0, 50 - activeApprovals.length));
  state.approvals = [...activeApprovals, ...archivedApprovals];
  audit(state, "Risky action blocked", `${actionType}: Human Gate approval required.`);
  writeState(state);
  return { approval, message: "Human Gate approval required.", requiresApproval: true, riskLevel: approval.riskLevel };
}

function createStockOrderApprovalRequest(draft) {
  const envelope = executionEnvelope(draft);
  const plan = draft.tradePlan || {};
  const position = plan.position || {};
  const tradeSummary = {
    symbol: draft.symbol,
    side: draft.side,
    quantity: draft.estimatedQuantity,
    estimatedOrderValue: draft.cappedDollars,
    score: plan.opportunityScore ?? null,
    confidence: plan.confidenceScore ?? null,
    entry: plan.preferredEntry ?? draft.referencePrice,
    stop: plan.stop ?? null,
    targets: Array.isArray(plan.targets) ? plan.targets : [],
    riskDollars: position.estimatedRiskDollars ?? draft.riskBudgetDollars ?? null,
    accountRiskPct: position.accountRiskPct ?? null,
    catalyst: plan.catalyst || null,
    majorReasons: Array.isArray(plan.reasons) ? plan.reasons : [],
    blockingWarnings: draft.blockers || [],
    currentSpread: null,
    quoteAgeSeconds: null,
    provider: draft.sourceType,
  };
  const approvalResult = createHumanGateRequest({
    actionType: "place_robinhood_equity_order",
    title: `Approve exact Robinhood order: ${draft.side} ${draft.symbol}`,
    riskLevel: "critical",
    linkedId: `stock-office:order:${draft.fingerprint}`,
    officeId: "stock-office",
    workflowId: "workflow-stock-watch",
    expiresAt: draft.expiresAt,
    evidence: `${draft.side} ${draft.symbol} · $${draft.cappedDollars.toFixed(2)} · ${draft.estimatedQuantity.toFixed(6)} shares · entry $${draft.referencePrice.toFixed(2)}. Local gates passed; Robinhood must still return a clean exact-order review.`,
    action: `Review and, only if Robinhood's review_equity_order returns no warning or scope change before ${draft.expiresAt}, place this one ${draft.side} ${draft.symbol} order in the dedicated Agentic account.`,
    exactScope: `One-use order fingerprint ${draft.fingerprint}: ${draft.side} ${draft.symbol}, market notional no more than $${draft.cappedDollars.toFixed(2)}, regular market hours, GFD, ref_id ${draft.clientRefId}. Reject on any broker warning, repricing outside policy, account mismatch, stale data, or scope change.`,
    details: {
      officeId: "stock-office",
      draftId: draft.id,
      fingerprint: draft.fingerprint,
      executionEnvelope: envelope,
      tradeSummary,
      riskDecision: draft.riskDecision,
      tradePlan: draft.tradePlan,
      maxNotionalDollars: draft.cappedDollars,
      accountScope: "dedicated_agentic_account_only",
      moneyMovementAuthorized: false,
      recurringAuthorization: false,
    },
    reversible: false,
    expectedPostcondition: "The exact order is broker-reviewed, placed at most once, and reconciled to a Robinhood order ID; otherwise no order is placed.",
    rollbackPlan: "If still open, cancel the exact broker order; if filled, stop automation and create a separate explicit SELL review. Never create an offsetting order automatically.",
  });
  stockIntelligenceStore.recordApproval(approvalResult.approval, {
    proposalId: draft.sourceId || draft.id,
    actorType: "SYSTEM",
  });
  stockEventBus.publish("trade.approval_requested", {
    proposalId: draft.sourceId || draft.id,
    approvalId: approvalResult.approval.id,
    symbol: draft.symbol,
    side: draft.side,
    status: "pending",
    draft,
    approval: approvalResult.approval,
  }, { id: `trade.approval_requested:${approvalResult.approval.id}` });
  return { approvalResult, envelope };
}

function createStockRiskReviewRequest(proposal) {
  if (!proposal?.riskReviewEligible || !proposal.riskReviewFingerprint) {
    throw guardedError("This proposal is not eligible for a strategy-risk review. Hard data, account, sizing, and exit-plan checks cannot be waived.", 409);
  }
  const score = Number(proposal.research?.score || 0);
  const requiredScore = Number(proposal.riskReviewRequiredScore || 85);
  const approvalResult = createHumanGateRequest({
    actionType: "review_stock_strategy_risk",
    title: `Review strategy risk — no order: ${proposal.symbol}`,
    riskLevel: "high",
    linkedId: `stock-office:risk-review:${proposal.riskReviewFingerprint}`,
    officeId: "stock-office",
    workflowId: "workflow-stock-watch",
    expiresAt: new Date(Date.now() + (30 * 60 * 1_000)).toISOString(),
    evidence: proposal.riskReviewReason,
    action: `Decide whether ${proposal.symbol}'s below-threshold setup merits continued supervised research. This decision cannot authorize an order or a policy exception.`,
    exactScope: `Advisory review only for risk fingerprint ${proposal.riskReviewFingerprint}. No broker call, order approval, order placement, guardrail change, money movement, or hard-gate bypass is authorized.`,
    details: {
      officeId: "stock-office",
      proposalId: proposal.id,
      proposalFingerprint: proposal.fingerprint,
      riskReviewFingerprint: proposal.riskReviewFingerprint,
      symbol: proposal.symbol,
      side: proposal.side,
      score,
      requiredScore,
      requestedDollars: proposal.requestedDollars,
      exitPlan: proposal.exitPlan,
      blockers: proposal.blockers,
      orderAuthorized: false,
      brokerActionAuthorized: false,
      strategyExceptionAuthorized: false,
    },
    reversible: true,
    expectedPostcondition: "The operator's advisory decision is recorded and research continues; no broker action or order occurs.",
    rollbackPlan: "No external rollback is required because this request cannot place an order or change a trading gate.",
  });
  stockIntelligenceStore.recordApproval(approvalResult.approval, {
    proposalId: proposal.id,
    actorType: "SYSTEM",
  });
  return approvalResult;
}

function stockOrderNotificationProposal(draft = {}, preferredProposal = null) {
  const proposal = preferredProposal && typeof preferredProposal === "object" ? preferredProposal : {};
  const checks = Array.isArray(draft.checks) ? draft.checks : [];
  return {
    ...proposal,
    id: proposal.id || draft.sourceId || draft.id,
    fingerprint: proposal.fingerprint || draft.fingerprint,
    draftEligible: true,
    symbol: proposal.symbol || draft.symbol,
    side: proposal.side || draft.side,
    requestedDollars: proposal.requestedDollars ?? draft.requestedDollars,
    referencePrice: proposal.referencePrice ?? draft.referencePrice,
    research: {
      sourceLabel: draft.sourceType,
      mainReason: draft.thesis,
      checksPassed: checks.filter((check) => check.passed).length,
      checksTotal: checks.length,
      ...(proposal.research || {}),
    },
  };
}

async function publishStockResearchCheckpoint({ runId = "", phase = "evaluator_complete" } = {}) {
  const state = readState();
  const snapshot = stockOfficeSnapshot(state);
  const plan = buildCopyPortfolioPlan(snapshot);
  const recommendations = (plan.proposals || [])
    .filter((proposal) => proposal.researchOnly === true || (proposal.kind === "native_entry" && proposal.side === "BUY"))
    .map((proposal) => proposal.researchOnly === true ? proposal : {
      ...proposal,
      researchOnly: true,
      recommendation: true,
      research: {
        ...(proposal.research || {}),
        recommendation: proposal.research?.recommendation || "preliminary research review",
      },
    })
    .sort((a, b) => Number(b.research?.score || b.rankingScore || 0) - Number(a.research?.score || a.rankingScore || 0))
    .slice(0, 6);
  const checkpointId = `research.recommendations_ready:${runId || crypto.createHash("sha256").update(JSON.stringify(recommendations.map((item) => item.fingerprint))).digest("hex").slice(0, 24)}`;
  stockEventBus.publish("research.recommendations_ready", {
    runId,
    phase,
    recommendationCount: recommendations.length,
    symbols: recommendations.map((proposal) => proposal.symbol),
    researchOnly: true,
    message: recommendations.length
      ? `${recommendations.length} research recommendation${recommendations.length === 1 ? "" : "s"} is available before the full evidence cycle completes.`
      : "The evaluator checkpoint completed; no recommendation currently passed the research floor.",
  }, { id: checkpointId });
  return {
    recommendations: recommendations.length,
    delivery: {
      sent: false,
      state: "suppressed_research_only",
      reason: "Research-only recommendations stay in Stock Office Research; Telegram is reserved for qualified Human Gate trade alerts.",
    },
  };
}

async function notifyStockOrderHumanGate(draft, approval, preferredProposal = null, approvals = null) {
  const currentApprovals = Array.isArray(approvals) ? approvals : (readState().approvals || []);
  return stockTelegramNotifier.notifyQualifiedProposal(
    stockOrderNotificationProposal(draft, preferredProposal),
    draft,
    approval,
    currentApprovals,
  );
}

async function syncPendingStockOrderHumanGateToTelegram() {
  const state = readState();
  const approvals = state.approvals || [];
  const notificationStatus = stockTelegramNotifier.publicStatus(approvals);
  if (!notificationStatus.enabled) return { checked: 0, sent: 0, state: notificationStatus.state };
  const drafts = normalizeStockOfficeState(state.stockOffice).tradeDrafts || [];
  const draftsById = new Map(drafts.map((draft) => [String(draft.id || ""), draft]));
  const pending = approvals.filter((approval) => approval?.officeId === "stock-office"
    && approval.actionType === "place_robinhood_equity_order"
    && approval.status === "pending"
    && !approval.consumedAt
    && (!approval.expiresAt || Date.parse(approval.expiresAt) > Date.now()))
    .slice(0, 10);
  const results = [];
  for (const approval of pending) {
    const draftId = String(approval.details?.draftId || approval.originalDetails?.draftId || "");
    const storedDraft = draftsById.get(draftId);
    if (!storedDraft) continue;
    const draft = tradeDraftWithApprovalState(storedDraft, [approval]);
    if (draft.status !== "awaiting_human_gate" || !draft.fingerprint) continue;
    const delivery = await notifyStockOrderHumanGate(draft, approval, null, approvals)
      .catch((error) => ({ sent: false, state: "failed", reason: redactSensitiveText(error.message).slice(0, 300) }));
    results.push({ approvalId: approval.id, draftId: draft.id, symbol: draft.symbol, side: draft.side, ...delivery });
    if (!delivery.sent) continue;
    const latestState = readState();
    const current = normalizeStockOfficeState(latestState.stockOffice);
    if (current.continuousReview?.activeApprovalId === approval.id) {
      latestState.stockOffice = normalizeStockOfficeState({
        ...current,
        continuousReview: {
          ...current.continuousReview,
          lastOutcome: "notification_delivered",
          notificationState: delivery.state,
          notificationSentAt: delivery.sentAt,
          lastMessage: `${draft.side} ${draft.symbol} is in Human Gate and Telegram was notified. No order has occurred.`,
        },
      });
    }
    audit(latestState, "Pending Human Gate Telegram delivered", `${draft.side} ${draft.symbol} approval was repaired and delivered to Telegram exactly once.`);
    writeState(latestState);
  }
  return { checked: pending.length, sent: results.filter((result) => result.sent).length, state: "active", results };
}

function stockTelegramReportText(label, report) {
  if (!report) return `${label}\nNo persisted report is available yet.`;
  const top = (report.topOpportunities || []).slice(0, 5);
  return [
    label,
    `Generated ${report.generatedAt || "unknown"}`,
    `Researched ${report.summary?.researched || 0} · High ${report.summary?.highPriority || 0} · Candidates ${report.summary?.candidates || 0}`,
    `Market ${report.marketState?.riskState || report.marketState?.regime || "unknown"} · Feeds ${report.providerHealth?.status || "unknown"}`,
    `Measured ${report.performance?.measuredSignals || 0} · Expectancy ${Number.isFinite(Number(report.performance?.expectancyPct)) ? `${(Number(report.performance.expectancyPct) * 100).toFixed(2)}%` : "insufficient sample"}`,
    "",
    ...(top.length ? top.map((item, index) => `${index + 1}. ${item.symbol} — ${Math.round(Number(item.aiScore || item.overallScore || 0))} · ${item.status}`) : ["No opportunity currently meets the persisted candidate threshold."]),
    "",
    report.type === "morning" ? "Overnight theses still require current premarket and broker revalidation." : "Research only. No order authority.",
  ].join("\n");
}

async function stockTelegramCommandContext(input = {}) {
  const command = String(input.command || "help").toLowerCase();
  const state = readState();
  const snapshot = stockOfficeSnapshot(state);
  const control = brokerControlOverview(snapshot);
  const plan = buildCopyPortfolioPlan(snapshot);
  const intelligence = snapshot.intelligence || stockIntelligenceState();
  const session = marketSession(new Date());
  const opportunities = intelligence.opportunities || [];
  const pending = (state.approvals || []).filter((item) => item.officeId === "stock-office" && item.status === "pending" && !item.consumedAt);
  if (command === "help") {
    return { text: "ARGENTUM COMMANDS\n/status /portfolio /positions /watchlist /opportunities /pending /research SYMBOL /overnight /morning /mirror /sources /risk /performance /health /symbol SYMBOL /help\n\nOnly environment-authorized Telegram user and chat IDs can control Human Gate." };
  }
  if (command === "status") {
    return { text: [
      "ARGENTUM STATUS",
      `${control.executionMode} · ${session.label}`,
      `Portfolio ${control.accountValueDollars === null ? "unavailable" : `$${control.accountValueDollars.toFixed(2)}`}`,
      `Buying power ${control.buyingPowerDollars === null ? "unavailable" : `$${control.buyingPowerDollars.toFixed(2)}`}`,
      `Opportunities ${opportunities.filter((item) => ["candidate", "high_priority"].includes(item.status)).length}`,
      `Pending Human Gate ${pending.length}`,
      `Execution ${control.liveReady ? "eligible for exact approval" : `blocked — ${control.blockers[0] || "unknown state"}`}`,
    ].join("\n") };
  }
  if (command === "portfolio") {
    return { text: [
      "ARGENTUM PORTFOLIO",
      `Value ${control.accountValueDollars === null ? "unavailable" : `$${control.accountValueDollars.toFixed(2)}`}`,
      `Cash ${control.cashDollars === null ? "unavailable" : `$${control.cashDollars.toFixed(2)}`}`,
      `Buying power ${control.buyingPowerDollars === null ? "unavailable" : `$${control.buyingPowerDollars.toFixed(2)}`}`,
      `Stocks ${control.equityValueDollars === null ? "unavailable" : `$${control.equityValueDollars.toFixed(2)}`}`,
      `Today P&L ${control.capital.dayPnlDollars === null ? "unavailable" : `$${control.capital.dayPnlDollars.toFixed(2)}`}`,
      `Positions ${control.positions.length} · Open orders ${control.openOrderCount}`,
      `Updated ${control.snapshotUpdatedAt || "unavailable"}`,
    ].join("\n") };
  }
  if (command === "positions") {
    return { text: [
      "ARGENTUM POSITIONS",
      ...(control.positions.length ? control.positions.slice(0, 15).map((position) => {
        const quantity = Number(position.quantity ?? position.sharesAvailableForSells ?? 0);
        const price = Number(position.currentPrice);
        return `${position.symbol} · ${quantity.toFixed(4)} shares · ${Number.isFinite(price) ? `$${price.toFixed(2)}` : "price unavailable"}`;
      }) : ["No verified live positions."]),
    ].join("\n") };
  }
  if (["watchlist", "opportunities"].includes(command)) {
    const top = opportunities.filter((item) => ["candidate", "high_priority"].includes(item.status)).slice(0, 8);
    return { text: [command === "watchlist" ? "ARGENTUM WATCHLIST" : "ARGENTUM OPPORTUNITIES", ...(top.length ? top.map((item, index) => `${index + 1}. ${item.symbol} · Score ${Math.round(item.overallScore)} · Confidence ${item.confidenceScore ?? item.confidence} · ${item.status.replaceAll("_", " ")}`) : ["No opportunity currently passes the persisted candidate threshold and hard gates."])].join("\n") };
  }
  if (command === "pending") {
    return { text: ["ARGENTUM PENDING", ...(pending.length ? pending.slice(0, 10).map((item) => `${String(item.details?.side || "REVIEW")} ${String(item.details?.executionEnvelope?.args?.symbol || item.title || "").slice(0, 80)} · ${item.id.slice(-8)} · expires ${item.expiresAt || "unknown"}`) : ["No Stock Office Human Gate request is pending."])].join("\n") };
  }
  if (["research", "symbol", "why"].includes(command)) {
    const symbol = String(input.args?.[0] || "").toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
    if (!symbol) return { text: "Use /research SYMBOL, for example /research NET." };
    const opportunity = opportunities.find((item) => item.symbol === symbol);
    const proposal = plan.proposals.find((item) => item.symbol === symbol);
    if (!opportunity && !proposal) return { text: `${symbol}\nNo persisted Argentum research is available for this symbol.` };
    const evidence = opportunity?.evidence || [];
    return { text: [
      `ARGENTUM RESEARCH · ${symbol}`,
      `Thesis ${opportunity?.thesis?.setup || proposal?.research?.setupType || "monitoring"}`,
      `Score ${opportunity?.overallScore ?? "unavailable"} · Technical ${opportunity?.technicalScore ?? "unavailable"} · Smart Money ${opportunity?.mirrorScore ?? "unavailable"} · Risk ${opportunity?.riskScore ?? "unavailable"}`,
      `Confidence ${opportunity?.confidenceScore ?? opportunity?.confidence ?? proposal?.research?.confidence ?? "unavailable"} · State ${opportunity?.state || "unavailable"}`,
      `Provider ${opportunity?.raw?.dataProvider || opportunity?.marketContext?.sourceProvider || "unavailable"} · ${opportunity?.raw?.dataHealthState || opportunity?.marketContext?.dataHealthState || "UNKNOWN"}`,
      ...evidence.slice(0, 6).map((item) => `${item.direction === "supporting" ? "✓" : "!"} ${item.label}`),
      `Risk ${opportunity?.thesis?.risk || proposal?.research?.mainRisk || "unavailable"}`,
      `Updated ${opportunity?.lastResearchedAt || proposal?.research?.lastResearchedAt || "unavailable"}`,
      `Next review ${opportunity?.nextReviewAt || proposal?.research?.nextReviewAt || "unavailable"}`,
      opportunity?.blockers?.length ? `Hard gate ${opportunity.blockers[0].reason || opportunity.blockers[0].code}` : proposal?.blockers?.length ? `Blocked ${proposal.blockers[0]}` : "Execution still requires exact Human Gate and broker revalidation.",
    ].join("\n") };
  }
  if (command === "overnight") return { text: stockTelegramReportText("ARGENTUM NIGHT RESEARCH", intelligence.reports?.overnight) };
  if (command === "morning") return { text: stockTelegramReportText("ARGENTUM MORNING INTELLIGENCE", intelligence.reports?.morning) };
  if (command === "mirror") {
    const mirror = intelligence.mirror || {};
    return { text: [
      "ARGENTUM MIRROR",
      `Sources ${(mirror.sources || []).filter((item) => item.active).length}/${(mirror.sources || []).length}`,
      `Events ${(mirror.events || []).length} · Consensus ${(mirror.consensus || []).length}`,
      ...(mirror.consensus || []).slice(0, 5).map((item) => `${item.symbol} ${item.side} · ${item.sourceCount} sources · ${Math.round(item.score)}`),
      ...(mirror.events || []).slice(0, 4).map((item) => `${item.symbol || "—"} ${item.side || "—"} · ${item.delaySeconds === null ? "delay unavailable" : `${Math.round(item.delaySeconds / 3600)}h delay`} · ${item.status}`),
    ].join("\n") };
  }
  if (command === "sources") {
    return { text: ["ARGENTUM SOURCES", ...(snapshot.sources || []).slice(0, 15).map((source) => `${source.label || source.id} · ${source.status} · ${source.generatedAt || source.lastModified || "no timestamp"}`)].join("\n") };
  }
  if (command === "risk") {
    const halt = snapshot.killSwitch || {};
    return { text: [
      "ARGENTUM RISK",
      `Mode ${control.executionMode}`,
      `Trading halt ${halt.active ? "ACTIVE" : "clear"} · ${halt.scope || "new_entries_only"}`,
      halt.active ? `Reason ${halt.reason || "unknown"}` : null,
      `Max order $${control.guardrails.maxOrderDollars.toFixed(2)} · Max deployed $${control.guardrails.maxTotalDollars.toFixed(2)}`,
      `Daily stop $${control.capital.dailyLossLimitDollars.toFixed(2)} · Trades ${control.capital.tradesToday ?? "unavailable"}/${control.guardrails.maxTradesPerDay}`,
      ...(control.blockers.length ? control.blockers.slice(0, 8).map((item) => `BLOCK · ${item}`) : ["Current loaded checks pass."]),
    ].filter(Boolean).join("\n") };
  }
  if (command === "performance") {
    const performance = intelligence.performance || stockIntelligenceStore.performanceReport();
    const summary = performance.summary || {};
    return { text: [
      "ARGENTUM PERFORMANCE",
      `Signals ${summary.totalSignals || 0} · Measured ${summary.measuredSignals || 0} · Pending ${summary.pendingSignals || 0}`,
      `Wins ${summary.wins || 0} · Losses ${summary.losses || 0}`,
      `Expectancy ${Number.isFinite(Number(summary.expectancyPct)) ? `${(Number(summary.expectancyPct) * 100).toFixed(2)}%` : "insufficient sample"}`,
      `Average R ${Number.isFinite(Number(summary.averageRMultiple)) ? Number(summary.averageRMultiple).toFixed(2) : "insufficient sample"}`,
      `Max drawdown ${Number.isFinite(Number(summary.maximumDrawdownPct)) ? `${(Number(summary.maximumDrawdownPct) * 100).toFixed(2)}%` : "insufficient sample"}`,
      `Broker trades ${summary.brokerTrades || 0} · Approved ${summary.approvedTrades || 0} · Rejected ${summary.rejectedTrades || 0}`,
      "Signal outcomes, simulation, backtests, and live broker fills remain separate.",
    ].join("\n") };
  }
  if (command === "health") {
    const health = stockIntelligenceStore.health({ executionMode: snapshot.executionMode, executionBlocked: !control.liveReady, sourceHealth: snapshot.sourceHealth, providerHealth: snapshot.providerHealth, broker: { authenticationVerified: control.authenticationVerified, updatedAt: control.snapshotUpdatedAt }, telegram: stockTelegramNotifier.publicStatus(state.approvals || []) });
    return { text: [
      "ARGENTUM HEALTH",
      `Market data ${health.marketData.status}`,
      `Broker ${health.broker.status}`,
      `Telegram ${health.telegram.status}`,
      `Research ${health.research.status}`,
      `Mirror ${health.mirror.healthy}/${health.mirror.total}`,
      `Database ${health.database.status}`,
      `Worker heartbeat ${health.lastWorkerHeartbeat || "pending"}`,
      ...(health.marketData.providers || []).slice(0, 8).map((provider) => `${provider.provider} · ${provider.status} · ${provider.latencyMs === null ? "latency unavailable" : `${provider.latencyMs}ms`}`),
    ].join("\n") };
  }
  return { text: "Use /help for Argentum commands." };
}

async function stockTelegramApprovalAction(input = {}) {
  const state = readState();
  const approval = (state.approvals || []).find((item) => item.id === String(input.approvalId || ""));
  if (!approval || approval.officeId !== "stock-office" || approval.actionType !== "place_robinhood_equity_order") {
    return { text: "BLOCKED\nThis immutable Stock Office approval ID is unavailable or invalid." };
  }
  if (approval.status !== "pending") {
    return { text: `NO CHANGE\nThis request is already ${approval.status}${approval.consumedAt ? " and consumed" : ""}.` };
  }
  const decision = input.decision === "approve" ? "approve" : "reject";
  const decided = decideHumanGateRequest(approval.id, {
    decision,
    note: `Telegram ${decision} from authorized user ${String(input.actorId || "").slice(-8)}.`,
    actorType: "TELEGRAM",
    actorId: input.actorId,
    telegramMessageId: input.messageId,
  });
  stockIntelligenceStore.recordApproval(decided.request, {
    proposalId: decided.request.details?.draftId || "",
    actorType: "TELEGRAM",
    actorId: input.actorId,
    idempotencyKey: input.idempotencyKey,
    telegramMessageId: input.messageId,
  });
  stockEventBus.publish(decision === "approve" ? "trade.approved" : "trade.rejected", {
    approvalId: approval.id,
    proposalId: approval.details?.draftId || "",
    symbol: approval.details?.executionEnvelope?.args?.symbol || "",
    decision,
    status: decided.request.status,
  }, { actorType: "TELEGRAM", actorId: input.actorId, id: `telegram:${decision}:${approval.id}` });
  if (decision !== "approve") return { text: "DECLINED\nThe exact Human Gate request was rejected. No broker review or order occurred." };
  try {
    const execution = await executeApprovedStockDraft(String(approval.details?.draftId || ""), {
      dispatchMode: "telegram_human_gate_approval",
      actorType: "TELEGRAM",
      actorId: input.actorId,
      telegramMessageId: input.messageId,
    });
    return { text: execution.liveOrderPlaced
      ? `APPROVED\n${execution.draft.side} ${execution.draft.symbol} was broker-reviewed and independently reconciled as ${execution.draft.status}. Order ••••${String(execution.draft.brokerOrderId || "").slice(-4)}.`
      : `BLOCKED AFTER APPROVAL\n${execution.draft.lastDispatchError || "No independently verified broker order was recorded."}` };
  } catch (error) {
    return { text: `BLOCKED AFTER APPROVAL\n${redactSensitiveText(error.message).slice(0, 800)}\nNo retry will occur automatically.` };
  }
}

async function stockTelegramWatchAction(input = {}) {
  const state = readState();
  const snapshot = stockOfficeSnapshot(state);
  const proposal = buildCopyPortfolioPlan(snapshot).proposals.find((item) => item.id === String(input.proposalId || ""));
  if (!proposal) return { text: "WATCH FAILED\nThe proposal changed or expired. Request /opportunities again." };
  const current = normalizeStockOfficeState(state.stockOffice);
  const decision = { proposalId: proposal.id, fingerprint: proposal.fingerprint, symbol: proposal.symbol, side: proposal.side, decision: "reviewed", decidedAt: now() };
  state.stockOffice = normalizeStockOfficeState({ ...current, proposalDecisions: [decision, ...current.proposalDecisions.filter((item) => item.proposalId !== proposal.id)] });
  audit(state, "Stock Office Telegram watch", `${proposal.symbol} was marked for continued research by an authorized Telegram user; no broker action occurred.`);
  writeState(state);
  stockEventBus.publish("opportunity.updated", { proposalId: proposal.id, symbol: proposal.symbol, decision: "watch", status: "monitoring" }, { actorType: "TELEGRAM", actorId: input.actorId, id: `telegram:watch:${input.idempotencyKey}` });
  return { text: `WATCHING ${proposal.symbol}\nArgentum will retain it in research memory and re-evaluate it on future cycles. No order occurred.` };
}

async function processStockContinuousReview(result = {}) {
  const completedAt = result.completedAt || now();
  const session = marketSession(new Date(completedAt));
  const initialState = readState();
  const initialOffice = normalizeStockOfficeState(initialState.stockOffice);
  const baseReview = initialOffice.continuousReview || {};
  const recordReview = (updates) => {
    const state = readState();
    const current = normalizeStockOfficeState(state.stockOffice);
    const evaluatedAt = now();
    const nextReview = {
      ...current.continuousReview,
      lastCycleCompletedAt: completedAt,
      lastEvaluatedAt: evaluatedAt,
      reviewTrigger: result.trigger || "market_research",
      decisionCadenceSeconds: Math.round(stockReadinessIntervalMs() / 1_000),
      ...updates,
    };
    const materialKeys = ["lastOutcome", "lastMessage", "activeProposalFingerprint", "activeDraftId", "activeApprovalId", "notificationState", "notificationSentAt"];
    const materialStateUnchanged = materialKeys.every((key) => JSON.stringify(current.continuousReview[key] ?? null) === JSON.stringify(nextReview[key] ?? null));
    const lastPersistedAt = Date.parse(current.continuousReview.lastEvaluatedAt || "");
    const throttleUnchangedFastTick = result.trigger === "live_readiness"
      && materialStateUnchanged
      && current.continuousReview.reviewTrigger === "live_readiness"
      && current.continuousReview.decisionCadenceSeconds === nextReview.decisionCadenceSeconds
      && Number.isFinite(lastPersistedAt)
      && Date.now() - lastPersistedAt < 15_000;
    if (throttleUnchangedFastTick) return nextReview;
    state.stockOffice = normalizeStockOfficeState({
      ...current,
      continuousReview: nextReview,
    });
    writeState(state);
    return state.stockOffice.continuousReview;
  };
  if (!session.regular) {
    return recordReview({ lastOutcome: "market_closed", lastMessage: `${session.label}; research remains scheduled, but no live order request is staged outside regular hours.` });
  }
  if (!["success", "partial"].includes(result.status)) {
    return recordReview({ lastOutcome: "failed_safe", lastMessage: result.errors?.[0] || result.message || "The research cycle did not complete successfully; no proposal was staged." });
  }

  const snapshot = stockOfficeSnapshot(initialState);
  const plan = buildCopyPortfolioPlan(snapshot);
  const tradeDrafts = initialOffice.tradeDrafts.map((draft) => tradeDraftWithApprovalState(draft, initialState.approvals || []));
  const activeDraft = tradeDrafts.find((draft) => ["awaiting_human_gate", "approved", "dispatch_claimed"].includes(draft.status));
  if (activeDraft) {
    return recordReview({
      lastOutcome: "waiting_for_human_gate",
      lastMessage: `${activeDraft.side} ${activeDraft.symbol} is already waiting for operator review; market research continues on the next cycle.`,
      activeDraftId: activeDraft.id,
      activeApprovalId: activeDraft.approvalId,
    });
  }

  const cycleDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(completedAt));
  const priorCycleDay = baseReview.lastCycleCompletedAt
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(baseReview.lastCycleCompletedAt))
    : "";
  const selectionReview = priorCycleDay && priorCycleDay !== cycleDay ? { ...baseReview, stagedProposalFingerprints: [] } : baseReview;
  const proposal = selectNextQualifiedProposal(plan, selectionReview, { session, now: completedAt });
  if (!proposal) {
    const riskProposal = [...(plan.proposals || [])]
      .filter((item) => item.riskReviewEligible === true)
      .sort((a, b) => Number(b.research?.score || 0) - Number(a.research?.score || 0))[0] || null;
    if (riskProposal) {
      const linkedId = `stock-office:risk-review:${riskProposal.riskReviewFingerprint}`;
      const existingRiskReview = (initialState.approvals || []).find((item) => item.actionType === "review_stock_strategy_risk" && item.linkedId === linkedId);
      if (!existingRiskReview) {
        const riskReview = createStockRiskReviewRequest(riskProposal);
        return recordReview({
          lastOutcome: "risk_review_requested",
          lastMessage: `${riskProposal.symbol} is near the normal entry threshold, so an advisory Human Gate risk review was created. It cannot authorize an order or bypass a hard check.`,
          activeProposalFingerprint: "",
          activeDraftId: "",
          activeApprovalId: "",
          riskReviewApprovalId: riskReview.approval.id,
        });
      }
    }
    const blockers = plan.proposals?.find((item) => item.side !== "HOLD")?.blockers || [];
    return recordReview({
      lastOutcome: "no_qualified_proposal",
      lastMessage: blockers[0] || "Cycle completed with BUY, HOLD, and SELL reviews; no exact order passed every current check.",
      activeProposalFingerprint: "",
      activeDraftId: "",
      activeApprovalId: "",
    });
  }

  const draft = buildTradeDraft({
    candidateId: proposal.candidateId || undefined,
    symbol: proposal.symbol,
    side: proposal.side,
    requestedDollars: proposal.requestedDollars,
  }, snapshot, { approvalTtlMinutes: stockApprovalTtlMinutes() });
  if (draft.status !== "ready_for_broker_review" || draft.blockers.length || draft.fingerprint !== proposal.draftFingerprint) {
    return recordReview({ lastOutcome: "failed_safe", lastMessage: draft.blockers[0] || "Proposal evidence changed during final cycle revalidation; nothing was staged." });
  }

  let state = readState();
  let current = normalizeStockOfficeState(state.stockOffice);
  state.stockOffice = normalizeStockOfficeState({
    ...current,
    tradeDrafts: [draft, ...current.tradeDrafts.filter((item) => item.fingerprint !== draft.fingerprint)],
  });
  audit(state, "Stock Office continuous order draft", `${draft.side} ${draft.symbol} passed the completed research cycle and was staged locally; no broker review or order occurred.`);
  writeState(state);

  const { approvalResult } = createStockOrderApprovalRequest(draft);
  state = readState();
  current = normalizeStockOfficeState(state.stockOffice);
  const awaitingDraft = tradeDraftWithApprovalState({ ...draft, approvalId: approvalResult.approval.id, status: "awaiting_human_gate", updatedAt: now() }, [approvalResult.approval]);
  state.stockOffice = normalizeStockOfficeState({
    ...current,
    tradeDrafts: [awaitingDraft, ...current.tradeDrafts.filter((item) => item.id !== draft.id)],
    continuousReview: {
      ...current.continuousReview,
      lastCycleCompletedAt: completedAt,
      lastEvaluatedAt: now(),
      lastOutcome: "proposal_staged",
      lastMessage: `${proposal.side} ${proposal.symbol} passed this cycle and is waiting in Human Gate. Research continues; no order has occurred.`,
      activeProposalFingerprint: proposal.fingerprint,
      activeDraftId: awaitingDraft.id,
      activeApprovalId: approvalResult.approval.id,
      notificationState: "pending",
      notificationSentAt: null,
      stagedProposalFingerprints: [...selectionReview.stagedProposalFingerprints, proposal.fingerprint].slice(-40),
    },
  });
  audit(state, "Stock Office cycle awaiting Human Gate", `${proposal.side} ${proposal.symbol} is the one exact proposal staged from this market cycle; no live order placed.`);
  writeState(state);

  const notificationState = readState();
  const delivery = await notifyStockOrderHumanGate(awaitingDraft, approvalResult.approval, proposal, notificationState.approvals || []);
  state = readState();
  current = normalizeStockOfficeState(state.stockOffice);
  state.stockOffice = normalizeStockOfficeState({
    ...current,
    continuousReview: {
      ...current.continuousReview,
      lastOutcome: delivery.sent ? "notification_delivered" : "notification_unavailable",
      notificationState: delivery.state || "unavailable",
      notificationSentAt: delivery.sentAt || null,
      lastMessage: delivery.sent
        ? `${proposal.side} ${proposal.symbol} is in Human Gate and Telegram was notified. No order has occurred.`
        : `${proposal.side} ${proposal.symbol} is in Human Gate. Telegram did not send: ${delivery.reason || delivery.state}.`,
    },
  });
  audit(state, delivery.sent ? "Qualified proposal Telegram delivered" : "Qualified proposal Telegram not delivered", delivery.sent ? `${proposal.side} ${proposal.symbol} Human Gate alert delivered.` : `No proposal alert sent: ${delivery.reason || delivery.state}.`);
  writeState(state);
  return state.stockOffice.continuousReview;
}

async function executeApprovedStockDraft(draftId, options = {}) {
  if (stockExecutionMode() !== "live") {
    throw guardedError("Stock Office is in PAPER mode. Live dispatch requires STOCK_GURU_EXECUTION_MODE=live and an app restart.", 409);
  }
  const executionSession = marketSession();
  if (process.env.NODE_ENV !== "test" && !executionSession.regular) {
    throw guardedError(`${executionSession.label}. Regular-hours market orders cannot be reviewed or placed outside the regular session. Research remains active.`, 409);
  }
  const state = readState();
  const snapshot = stockOfficeSnapshot(state, options.permissions);
  const draft = snapshot.tradeDrafts.find((item) => item.id === draftId);
  if (!draft) throw guardedError("Order draft not found.", 404);
  if (options.confirmationFingerprint && String(options.confirmationFingerprint) !== draft.fingerprint) {
    throw guardedError("Action-time order confirmation does not match the exact approved fingerprint.", 409);
  }
  const approval = (state.approvals || []).find((item) => item.id === draft.approvalId)
    || (state.approvals || []).find((item) => item.linkedId === `stock-office:order:${draft.fingerprint}`);
  if (!approval) throw guardedError("Exact Human Gate order approval not found.", 409);
  let claimed;
  try {
    claimed = claimApprovedDispatch(draft, approval, snapshot);
  } catch (error) {
    const approvalCanBeFinalized = approval.status === "approved"
      && approval.actionType === "place_robinhood_equity_order"
      && !approval.consumedAt
      && !(Number(approval.useCount) > 0);
    if (!approvalCanBeFinalized) throw error;
    const stoppedAt = now();
    const stoppedReason = redactSensitiveText(error.message || "Final order revalidation stopped safely.").slice(0, 500);
    const current = normalizeStockOfficeState(state.stockOffice);
    const stoppedDraftInput = {
      ...draft,
      status: "review_rejected",
      brokerReviewPassed: false,
      brokerWarnings: [],
      lastDispatchError: stoppedReason,
      liveOrderPlaced: false,
      updatedAt: stoppedAt,
    };
    const stoppedApproval = {
      ...approval,
      useCount: Number(approval.useCount || 0) + 1,
      consumedAt: stoppedAt,
      executionOutcome: "broker_execution_stopped",
      executionError: stoppedReason,
      executionStoppedAt: stoppedAt,
      executionDraftId: draft.id,
      executionBrokerOrderId: null,
    };
    state.stockOffice = normalizeStockOfficeState({
      ...current,
      tradeDrafts: [stoppedDraftInput, ...current.tradeDrafts.filter((item) => item.id !== draft.id)],
      continuousReview: {
        ...current.continuousReview,
        activeDraftId: "",
        activeApprovalId: "",
        lastOutcome: "failed_safe",
        lastMessage: `${draft.side} ${draft.symbol} stopped during final revalidation: ${stoppedReason}`,
      },
    });
    const approvalIndex = (state.approvals || []).findIndex((item) => item.id === approval.id);
    if (approvalIndex >= 0) state.approvals[approvalIndex] = stoppedApproval;
    const stoppedDraft = state.stockOffice.tradeDrafts.find((item) => item.id === draft.id) || stoppedDraftInput;
    stockIntelligenceStore.recordOrderAudit({
      correlationId: `revalidation:${approval.id}`,
      actorType: options.actorType || "WEB",
      actorId: options.actorId || "",
      proposalId: draft.sourceId || draft.id,
      approvalId: approval.id,
      symbol: draft.symbol,
      side: draft.side,
      action: "final_revalidation_stopped",
      oldState: draft.status,
      newState: stoppedDraft.status,
      reason: stoppedReason,
      error: stoppedReason,
      telegramMessageId: options.telegramMessageId || "",
    });
    stockEventBus.publish("order.rejected", {
      proposalId: draft.sourceId || draft.id,
      approvalId: approval.id,
      symbol: draft.symbol,
      side: draft.side,
      status: stoppedDraft.status,
      reason: stoppedReason,
      draft: stoppedDraft,
    }, { correlationId: `revalidation:${approval.id}`, actorType: options.actorType || "WEB", actorId: options.actorId || "" });
    audit(state, "Approved Stock Office order stopped during final revalidation", `${draft.side} ${draft.symbol}: ${stoppedReason}; exact one-use approval consumed and no broker order was attempted.`);
    writeState(state);
    return {
      draft: stoppedDraft,
      approval: stoppedApproval,
      liveOrderPlaced: false,
      reconciliationRequired: false,
      notificationDelivery: { sent: false, state: "ineligible", reason: "No broker order was recorded." },
      notificationStatus: stockTelegramNotifier.publicStatus(state.approvals || []),
    };
  }
  const current = normalizeStockOfficeState(state.stockOffice);
  state.stockOffice = normalizeStockOfficeState({ ...current, tradeDrafts: [claimed.draft, ...current.tradeDrafts.filter((item) => item.id !== draft.id)] });
  approval.dispatchClaimId = claimed.claim.id;
  approval.dispatchClaimedAt = claimed.draft.dispatchClaimedAt;
  approval.dispatchClaimExpiresAt = claimed.claim.expiresAt;
  approval.dispatchMode = options.dispatchMode || "direct_official_robinhood_mcp";
  stockIntelligenceStore.recordOrderAudit({
    correlationId: claimed.claim.id,
    actorType: options.actorType || "WEB",
    actorId: options.actorId || "",
    proposalId: draft.sourceId || draft.id,
    approvalId: approval.id,
    symbol: draft.symbol,
    side: draft.side,
    action: "dispatch_claimed",
    oldState: draft.status,
    newState: claimed.draft.status,
    reason: "One-use claim persisted before official broker review.",
    telegramMessageId: options.telegramMessageId || "",
  });
  stockEventBus.publish("order.review_started", { proposalId: draft.sourceId || draft.id, approvalId: approval.id, symbol: draft.symbol, side: draft.side, status: "broker_review", draft: claimed.draft }, { correlationId: claimed.claim.id, actorType: options.actorType || "WEB", actorId: options.actorId || "" });
  audit(state, "Stock Office direct dispatch claimed", `${draft.side} ${draft.symbol} claim ${claimed.claim.id} was persisted before any official Robinhood broker call.`);
  writeState(state);

  let brokerResult;
  try {
    brokerResult = await robinhoodMcpClient.executeApprovedEnvelope(claimed.claim.envelope);
  } catch (error) {
    brokerResult = { reviewPassed: false, warnings: [], placementAttempted: false, brokerOrderId: "", brokerState: "", reconciliation: { matched: false }, error: `Official Robinhood execution stopped before a verified placement: ${error.message}` };
  }

  const latestState = readState();
  const latestCurrent = normalizeStockOfficeState(latestState.stockOffice);
  const latestDraft = latestCurrent.tradeDrafts.find((item) => item.id === draft.id);
  const approvalIndex = (latestState.approvals || []).findIndex((item) => item.id === approval.id);
  if (!latestDraft || approvalIndex < 0) throw guardedError("The persisted dispatch state changed during broker execution; manual reconciliation is required.", 409);
  const settled = settleApprovedDispatch(latestDraft, latestState.approvals[approvalIndex], brokerResult, claimed.claim.token, { trustedBrokerResult: true });
  latestState.stockOffice = normalizeStockOfficeState({
    ...latestCurrent,
    tradeDrafts: [settled.draft, ...latestCurrent.tradeDrafts.filter((item) => item.id !== draft.id)],
    continuousReview: {
      ...latestCurrent.continuousReview,
      activeDraftId: "",
      activeApprovalId: "",
      lastOutcome: settled.liveOrderPlaced ? "proposal_staged" : "failed_safe",
      lastMessage: settled.liveOrderPlaced
        ? `${draft.side} ${draft.symbol} was independently reconciled by Robinhood. Research continues on the next cycle.`
        : `${draft.side} ${draft.symbol} stopped safely: ${settled.draft.lastDispatchError || "no independently verified order"}.`,
    },
  });
  latestState.approvals[approvalIndex] = settled.approval;
  stockIntelligenceStore.recordOrderAudit({
    correlationId: claimed.claim.id,
    actorType: options.actorType || "WEB",
    actorId: options.actorId || "",
    proposalId: draft.sourceId || draft.id,
    approvalId: approval.id,
    orderId: settled.draft.brokerOrderId || "",
    symbol: draft.symbol,
    side: draft.side,
    action: settled.liveOrderPlaced ? "broker_reconciled" : "broker_stopped",
    oldState: claimed.draft.status,
    newState: settled.draft.status,
    reason: settled.draft.lastDispatchError || "Official Robinhood result reconciled.",
    brokerResponse: brokerResult,
    error: settled.liveOrderPlaced ? "" : settled.draft.lastDispatchError,
    telegramMessageId: options.telegramMessageId || "",
  });
  stockEventBus.publish(settled.liveOrderPlaced ? (settled.draft.status === "filled" ? "order.filled" : "order.submitted") : "order.rejected", {
    proposalId: draft.sourceId || draft.id,
    approvalId: approval.id,
    orderId: settled.draft.brokerOrderId || "",
    symbol: draft.symbol,
    side: draft.side,
    status: settled.draft.status,
    reason: settled.draft.lastDispatchError || "",
    draft: settled.draft,
  }, { correlationId: claimed.claim.id, actorType: options.actorType || "WEB", actorId: options.actorId || "" });
  audit(latestState, settled.liveOrderPlaced ? "Stock Office broker order independently reconciled" : "Stock Office direct dispatch stopped or needs reconciliation", settled.liveOrderPlaced ? `${draft.side} ${draft.symbol} matched official Robinhood order ${settled.draft.brokerOrderId}; exact one-use approval consumed.` : `${draft.side} ${draft.symbol}: ${settled.draft.lastDispatchError || "no independently verified order"}; exact one-use approval consumed and placement will not be retried.`);
  writeState(latestState);
  if (settled.liveOrderPlaced) {
    const signal = stockIntelligenceStore.latestSignalForSymbol(draft.symbol);
    stockIntelligenceStore.recordTradeJournal({
      signalId: signal?.id || null,
      proposalId: draft.sourceId || draft.id,
      approvalId: approval.id,
      brokerOrderId: settled.draft.brokerOrderId,
      strategyVersion: signal?.strategyVersion || draft.tradePlan?.version || "unknown",
      symbol: draft.symbol,
      side: draft.side,
      status: settled.draft.status,
      quantity: draft.estimatedQuantity,
      entryPrice: draft.side === "BUY" ? draft.referencePrice : null,
      exitPrice: draft.side === "SELL" ? draft.referencePrice : null,
      humanIntervention: `${options.actorType || "WEB"} Human Gate approval`,
      openedAt: draft.side === "BUY" ? settled.draft.reconciliationObservedAt : null,
      closedAt: draft.side === "SELL" && settled.draft.status === "filled" ? settled.draft.reconciliationObservedAt : null,
      data: { draft: settled.draft, tradePlan: draft.tradePlan, riskDecision: draft.riskDecision },
    });
  }
  const notificationDelivery = settled.liveOrderPlaced
    ? await stockTelegramNotifier.notifyVerifiedTrade(settled.draft, latestState.approvals || []).catch((error) => ({ sent: false, state: "failed", reason: error.message }))
    : { sent: false, state: "ineligible", reason: "No independently reconciled broker order was recorded." };
  if (settled.liveOrderPlaced) {
    audit(latestState, notificationDelivery.sent ? "Verified trade Telegram delivered" : "Verified trade Telegram not delivered", notificationDelivery.sent ? `${draft.side} ${draft.symbol} alert delivered after broker reconciliation.` : `No Telegram alert sent: ${notificationDelivery.reason || notificationDelivery.state}.`);
    writeState(latestState);
  }
  return { draft: settled.draft, approval: settled.approval, liveOrderPlaced: settled.liveOrderPlaced, reconciliationRequired: settled.reconciliationRequired, notificationDelivery, notificationStatus: stockTelegramNotifier.publicStatus(latestState.approvals || []) };
}

async function reconcileStockBrokerOrderLifecycle(brokerSnapshot = robinhoodMcpClient.currentBrokerSnapshot()) {
  const state = readState();
  const current = normalizeStockOfficeState(state.stockOffice);
  const reconciled = reconcileOrderDrafts(current.tradeDrafts, brokerSnapshot, { now: now() });
  const { changes } = reconciled;
  if (!changes.length) return { changed: 0 };
  state.stockOffice = normalizeStockOfficeState({ ...current, tradeDrafts: reconciled.drafts });
  for (const change of changes) {
    const { before, after } = change;
    const reconciliationReason = change.reason === "ambiguous_placement_reconciled"
      ? "A previously ambiguous placement was uniquely matched in official Robinhood order history without retrying it."
      : "Official Robinhood order history changed state.";
    const approval = (state.approvals || []).find((item) => item.id === after.approvalId);
    if (approval && change.reason === "ambiguous_placement_reconciled") {
      approval.executionOutcome = "broker_order_reconciled";
      approval.executionBrokerOrderId = after.brokerOrderId;
      approval.executionError = "";
      approval.reconciledAt = after.reconciliationObservedAt || after.updatedAt;
    }
    const eventType = after.status === "filled" ? "order.filled" : after.status === "cancelled" ? "order.cancelled" : after.status === "rejected" ? "order.rejected" : "order.updated";
    stockIntelligenceStore.recordOrderAudit({
      correlationId: `broker-order:${after.brokerOrderId}`,
      actorType: "SYSTEM",
      proposalId: after.sourceId || after.id,
      approvalId: after.approvalId,
      orderId: after.brokerOrderId,
      symbol: after.symbol,
      side: after.side,
      action: "broker_state_reconciled",
      oldState: before.brokerState || before.status,
      newState: after.brokerState,
      reason: reconciliationReason,
      brokerResponse: change.order,
    });
    const signal = stockIntelligenceStore.latestSignalForSymbol(after.symbol);
    stockIntelligenceStore.recordTradeJournal({
      signalId: signal?.id || null,
      proposalId: after.sourceId || after.id,
      approvalId: after.approvalId,
      brokerOrderId: after.brokerOrderId,
      strategyVersion: signal?.strategyVersion || after.tradePlan?.version || "unknown",
      symbol: after.symbol,
      side: after.side,
      status: after.status,
      quantity: Number.isFinite(Number(change.order?.quantity)) ? Number(change.order.quantity) : after.estimatedQuantity,
      entryPrice: after.side === "BUY" ? after.referencePrice : null,
      exitPrice: after.side === "SELL" ? after.referencePrice : null,
      humanIntervention: "Previously approved exact Human Gate order",
      openedAt: after.side === "BUY" ? after.reconciliationObservedAt : null,
      closedAt: after.side === "SELL" && after.status === "filled" ? after.reconciliationObservedAt : null,
      updatedAt: after.updatedAt,
      data: { order: change.order, draft: after },
    });
    stockEventBus.publish(eventType, {
      proposalId: after.sourceId || after.id,
      approvalId: after.approvalId,
      orderId: after.brokerOrderId,
      symbol: after.symbol,
      side: after.side,
      oldState: before.brokerState || before.status,
      newState: after.brokerState,
      status: after.status,
      reason: reconciliationReason,
      draft: after,
    }, { correlationId: `broker-order:${after.brokerOrderId}` });
    if (after.status === "filled") {
      const notificationDelivery = await stockTelegramNotifier.notifyVerifiedTrade(after, state.approvals || [])
        .catch((error) => ({ sent: false, state: "failed", reason: error.message }));
      audit(state, notificationDelivery.sent ? "Reconciled trade Telegram delivered" : "Reconciled trade Telegram not delivered", notificationDelivery.sent
        ? `${after.side} ${after.symbol} alert delivered after official history reconciliation.`
        : `Reconciled ${after.side} ${after.symbol} Telegram alert did not send: ${notificationDelivery.reason || notificationDelivery.state}.`);
    }
    audit(state, "Stock Office broker lifecycle reconciled", change.reason === "ambiguous_placement_reconciled"
      ? `${after.side} ${after.symbol} order ••••${String(after.brokerOrderId).slice(-4)} was uniquely matched in official Robinhood history; no placement retry occurred.`
      : `${after.side} ${after.symbol} order ••••${String(after.brokerOrderId).slice(-4)} changed from ${before.brokerState || before.status} to ${after.brokerState}.`);
  }
  writeState(state);
  return { changed: changes.length, states: changes.map((item) => ({ orderId: item.after.brokerOrderId, state: item.after.brokerState })) };
}

function decideHumanGateRequest(approvalId, payload = {}) {
  const state = readState();
  const approval = (state.approvals || []).find((item) => item.id === approvalId);
  if (!approval) throw guardedError("Approval request not found.", 404);
  if (approval.status !== "pending") throw guardedError("Approval request is no longer pending.", 409);
  const decision = ["approve", "approve_limited", "send_back", "reject", "block"].includes(payload.decision) ? payload.decision : "send_back";
  if (decision === "approve_limited") {
    if (!payload.grantedDetails || typeof payload.grantedDetails !== "object" || Array.isArray(payload.grantedDetails)) {
      throw guardedError("A limited approval requires a structured grantedDetails scope.", 400);
    }
    const original = approval.originalDetails || approval.details || {};
    const unknownKey = Object.keys(payload.grantedDetails).find((key) => !(key in original));
    if (unknownKey) throw guardedError(`Limited approval contains an unknown scope field: ${unknownKey}.`, 400);
    approval.grantedDetails = JSON.parse(JSON.stringify(payload.grantedDetails));
    approval.grantedScopeNote = String(payload.exactScope || payload.note || "Operator granted a narrower structured scope.").slice(0, 2000);
  } else if (decision === "approve") {
    approval.grantedDetails = JSON.parse(JSON.stringify(approval.originalDetails || approval.details || {}));
  }
  approval.status = decision === "approve" || decision === "approve_limited" ? "approved" : decision === "reject" || decision === "block" ? "blocked" : "needs_revision";
  approval.decision = decision;
  approval.decisionNote = String(payload.note || payload.decisionNote || "").slice(0, 1000);
  approval.decidedAt = now();
  approval.decidedBy = payload.actorType === "TELEGRAM" ? "telegram" : "operator";
  approval.decidedById = String(payload.actorId || "").slice(0, 160) || null;
  approval.telegramMessageId = String(payload.telegramMessageId || "").slice(0, 160) || null;
  audit(state, `Human Gate ${approval.status}`, `${approval.title}: ${approval.decisionNote || "No note."}`);

  const mission = approval.missionId ? findAgent101Mission(state, approval.missionId) : null;
  if (mission && !agent101MissionManager.TERMINAL_STATUSES.has(mission.status)) {
    if (approval.status === "needs_revision") {
      agent101MissionManager.transition(mission, "paused", { stage: "human_gate_revision", message: "Human Gate sent the requested action back for revision." });
    } else if (approval.status === "blocked") {
      agent101MissionManager.transition(mission, "blocked", { stage: "human_gate_blocked", message: "Human Gate blocked the requested action. The mission stopped without executing it." });
    }
    if (mission.threadId) {
      const thread = findAgent101Thread(state, mission.threadId);
      if (thread) {
        const approvalMessage = (thread.messages || []).find((message) => message.metadata?.approvalId === approval.id);
        if (approvalMessage) {
          approvalMessage.status = approval.status === "approved" ? "complete" : approval.status === "needs_revision" ? "paused" : "blocked";
          approvalMessage.updatedAt = now();
        }
        thread.status = mission.status === "blocked" ? "blocked" : mission.status === "paused" ? "paused" : thread.status;
      }
    }
  }
  writeState(state);

  let resumedMission = null;
  if (approval.status === "approved" && mission?.autoResume) {
    const latestState = readState();
    const latestMission = findAgent101Mission(latestState, mission.id);
    if (latestMission && agent101MissionManager.resumable(latestMission, latestState.approvals || [])) resumedMission = resumeAgent101Mission(latestMission.id);
  }
  return { request: approval, mission: resumedMission };
}

function configuredPrintShopSearchProvider() {
  if (ENV_BRAVE_API_KEY) return "brave";
  if (ENV_SERP_API_KEY) return "serpapi";
  const config = readAiProviderConfig();
  const openAiStatus = agent101OpenAiStatus(config);
  if (openAiStatus.configured && openAiStatus.mode === "live" && openAiStatus.status === "ready") return "openai_web_search";
  return "";
}

function printShopSearchProviderModel(provider) {
  if (provider !== "openai_web_search") return null;
  const config = readAiProviderConfig();
  return String(config.providers?.openai?.model || "").trim() || null;
}

function printShopDiscoveryScope({ runId, plan, provider, model }) {
  const openAi = provider === "openai_web_search";
  return {
    officeId: "print-shop-office",
    runId,
    provider,
    model: model || null,
    planHash: plan.planHash,
    geography: plan.brief.geography,
    queryHashes: plan.queries.map((query) => query.queryHash),
    maximumProviderRequests: openAi ? 1 : plan.maximumCalls,
    maximumToolCalls: plan.maximumCalls,
    maximumResultsPerCall: plan.maximumResultsPerCall,
    maximumOpportunities: 8,
    maximumOutputTokens: openAi ? 3200 : 0,
    externalWebAccess: true,
  };
}

function consumePrintShopDiscoveryApproval({ approvalId, run, provider, model }) {
  const state = readState();
  const approval = (state.approvals || []).find((item) => item.id === approvalId);
  if (!approval || approval.id !== run.approvalId) {
    throw guardedError("Human Gate approval does not match this discovery run.", 403);
  }
  if (approval.status !== "approved" || approval.actionType !== "agent101_product_discovery" || approval.officeId !== "print-shop-office") {
    throw guardedError("Human Gate has not approved this exact opportunity discovery.", 403);
  }
  if (approval.expiresAt) {
    const expiresAt = Date.parse(approval.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw guardedError("Human Gate approval expired before discovery ran.", 409);
  }
  if (approval.consumedAt || Number(approval.useCount || 0) >= 1) {
    throw guardedError("Human Gate approval has already been used.", 409);
  }
  const expected = printShopDiscoveryScope({ runId: run.id, plan: run.plan, provider, model });
  const granted = approval.grantedDetails || approval.originalDetails || approval.details || {};
  const mismatch = Object.entries(expected).find(([key, value]) => JSON.stringify(granted[key] ?? null) !== JSON.stringify(value));
  if (mismatch) throw guardedError(`Human Gate scope does not match the approved ${mismatch[0]}.`, 403);
  if (JSON.stringify(run.scope || {}) !== JSON.stringify(expected)) {
    throw guardedError("The persisted discovery scope changed after Human Gate review.", 409);
  }
  approval.useCount = Number(approval.useCount || 0) + 1;
  approval.consumedAt = now();
  approval.consumedBy = "print-shop-office";
  audit(state, "Human Gate approval consumed", `${approval.title}: one bounded ${provider} discovery run started.`);
  writeState(state);
  return approval;
}

function consumePrintShopResearchApproval({ approvalId, request, provider }) {
  const state = readState();
  const currentQueryHash = crypto.createHash("sha256")
    .update(`${String(request.query || "").toLowerCase()}|${String(request.geography || "").toLowerCase()}|${provider}`)
    .digest("hex");
  if (currentQueryHash !== request.queryHash) {
    throw guardedError("The research query changed after Human Gate review.", 409);
  }
  const approval = (state.approvals || []).find((item) => item.id === approvalId);
  if (!approval || approval.id !== request.approvalId) {
    throw guardedError("Human Gate approval does not match this research request.", 403);
  }
  if (approval.status !== "approved" || approval.actionType !== "agent101_web_search" || approval.officeId !== "print-shop-office") {
    throw guardedError("Human Gate has not approved this exact product search.", 403);
  }
  if (approval.expiresAt) {
    const expiresAt = Date.parse(approval.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw guardedError("Human Gate approval expired before the search ran.", 409);
    }
  }
  if (approval.consumedAt || Number(approval.useCount || 0) >= 1) {
    throw guardedError("Human Gate approval has already been used.", 409);
  }
  const expected = {
    officeId: "print-shop-office",
    provider,
    queryHash: request.queryHash,
    geography: request.geography,
    maximumCalls: 1,
    maximumResults: 8,
  };
  const granted = approval.grantedDetails || approval.originalDetails || approval.details || {};
  const mismatch = Object.entries(expected).find(([key, value]) => String(granted[key] ?? "") !== String(value));
  if (mismatch) throw guardedError(`Human Gate scope does not match the approved ${mismatch[0]}.`, 403);
  approval.useCount = Number(approval.useCount || 0) + 1;
  approval.consumedAt = now();
  approval.consumedBy = "print-shop-office";
  audit(state, "Human Gate approval consumed", `${approval.title}: one bounded ${provider} search started.`);
  writeState(state);
  return approval;
}

async function fetchPrintShopResearchResults({ provider, query, geography }) {
  const searchGeography = String(geography || "").toLowerCase() === "united states";
  if (provider === "brave" && ENV_BRAVE_API_KEY) {
    const endpoint = new URL("https://api.search.brave.com/res/v1/web/search");
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("count", "8");
    if (searchGeography) {
      endpoint.searchParams.set("country", "us");
      endpoint.searchParams.set("search_lang", "en");
    }
    const response = await fetch(endpoint, {
      headers: { "x-subscription-token": ENV_BRAVE_API_KEY, accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw guardedError(`Brave Search failed with status ${response.status}.`, 502);
    return (data.web?.results || []).slice(0, 8).map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.description,
    }));
  }
  if (provider === "serpapi" && ENV_SERP_API_KEY) {
    const endpoint = new URL("https://serpapi.com/search.json");
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("api_key", ENV_SERP_API_KEY);
    endpoint.searchParams.set("num", "8");
    if (searchGeography) {
      endpoint.searchParams.set("gl", "us");
      endpoint.searchParams.set("hl", "en");
    }
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(20_000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw guardedError(`SerpAPI search failed with status ${response.status}.`, 502);
    return (data.organic_results || []).slice(0, 8).map((item) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet,
    }));
  }
  if (provider === "openai_web_search") {
    const queryHash = crypto.createHash("sha256").update(`${String(query).toLowerCase()}|${String(geography).toLowerCase()}`).digest("hex");
    const plan = {
      brief: {
        laneId: "manual_research",
        laneName: "Manual product research",
        geography: geography || "United States",
        objective: `Collect current cited observations about: ${query}`,
      },
      queries: [{ id: "manual-research", label: "Manual research", query, queryHash }],
      planHash: crypto.createHash("sha256").update(queryHash).digest("hex"),
      maximumCalls: 1,
      maximumResultsPerCall: 8,
    };
    const result = await fetchOpenAiPrintShopDiscovery({ plan, maximumToolCalls: 1, maximumOutputTokens: 1800 });
    return result.results.slice(0, 8).map((item) => ({ title: item.title, url: item.url, snippet: item.snippet }));
  }
  throw guardedError("No supported Print Shop search provider is configured.", 409);
}

function canonicalPrintShopExternalUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    [...parsed.searchParams.keys()].forEach((key) => {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) parsed.searchParams.delete(key);
    });
    return parsed.toString();
  } catch {
    return "";
  }
}

function printShopDiscoveryStructuredSchema(plan) {
  const queryIds = plan.queries.map((query) => query.id);
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      observations: {
        type: "array",
        maxItems: 18,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", maxLength: 240 },
            url: { type: "string", maxLength: 2000 },
            summary: { type: "string", maxLength: 800 },
            queryIds: { type: "array", minItems: 1, maxItems: queryIds.length, items: { type: "string", enum: queryIds } },
          },
          required: ["title", "url", "summary", "queryIds"],
        },
      },
      opportunities: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", maxLength: 100 },
            problem: { type: "string", maxLength: 500 },
            targetBuyer: { type: "string", maxLength: 240 },
            suggestedTemplateId: { type: "string", enum: ["storage_tray", "label_plate", "spacer_block", "divider_set", "custom"] },
            sourceUrls: { type: "array", minItems: 1, maxItems: 6, items: { type: "string", maxLength: 2000 } },
          },
          required: ["title", "problem", "targetBuyer", "suggestedTemplateId", "sourceUrls"],
        },
      },
    },
    required: ["observations", "opportunities"],
  };
}

function openAiDiscoveryPrompt(plan) {
  const angles = plan.queries.map((query) => `- ${query.id}: ${query.query}`).join("\n");
  return [
    "Run a current web research sweep for Agent 101's supervised Product Research Lab.",
    `Research objective: ${plan.brief.objective}`,
    `Geography: ${plan.brief.geography}`,
    "Approved research angles:",
    angles,
    "Saved production constraints: Bambu Lab A1 mini; 180 x 180 x 180 mm factory volume; 176 x 176 x 176 mm conservative planning envelope; installed 0.4 mm nozzle; one color at a time; PLA, PETG, and TPU are preferred materials.",
    "Look for recurring physical fit, organization, replacement, handling, display, or workflow problems that a small measured product might investigate.",
    "Every observation must use a real URL consulted during this web-search response. Every opportunity must cite at least one of those exact URLs.",
    "Treat each idea as a product hypothesis only. Do not claim or estimate demand, sales, competition, price, revenue, profit, unit economics, filament grams, print time, safety, commercial rights, dimensions, or printer fit.",
    "Do not copy a protected branded design. Prefer customization, exact fit, simple single-color parts, or intentionally separate color parts.",
    "Use concise source paraphrases, not long quotes. Return only the requested structured object.",
  ].join("\n\n");
}

function openAiDiscoverySources(payload = {}) {
  const sources = new Map();
  const add = (value, title = "") => {
    const url = canonicalPrintShopExternalUrl(value);
    if (!url) return;
    const existing = sources.get(url);
    if (!existing || (!existing.title && title)) sources.set(url, { url, title: String(title || "").trim().slice(0, 240) });
  };
  for (const item of payload.output || []) {
    for (const source of item?.action?.sources || []) add(source?.url, source?.title);
    for (const content of item?.content || []) {
      for (const annotation of content?.annotations || []) {
        if (annotation?.type === "url_citation") add(annotation.url, annotation.title);
      }
    }
  }
  return sources;
}

async function fetchOpenAiPrintShopDiscovery({ plan, maximumToolCalls, maximumOutputTokens }) {
  const config = readAiProviderConfig();
  const key = keyFromConfig(config, "openai");
  if (!key) throw guardedError("OpenAI web search is no longer configured.", 409);
  const settings = config.providers.openai;
  const requestBody = {
    model: settings.model,
    tools: [{
      type: "web_search",
      external_web_access: true,
      search_context_size: "medium",
      user_location: String(plan.brief.geography || "").toLowerCase() === "united states"
        ? { type: "approximate", country: "US" }
        : undefined,
    }],
    tool_choice: "required",
    max_tool_calls: maximumToolCalls,
    include: ["web_search_call.action.sources"],
    max_output_tokens: maximumOutputTokens,
    text: {
      format: {
        type: "json_schema",
        name: "print_product_discovery",
        strict: true,
        schema: printShopDiscoveryStructuredSchema(plan),
      },
    },
    input: [{ role: "user", content: openAiDiscoveryPrompt(plan) }],
  };
  if (!requestBody.tools[0].user_location) delete requestBody.tools[0].user_location;
  const reservationId = reserveAiRequest("openai", settings.model, requestBody, maximumOutputTokens);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(90_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = guardedError(payload.error?.message || `OpenAI web research failed with ${response.status}.`, response.status);
      error.openAiCode = payload.error?.code || "";
      throw error;
    }
    recordAiUsage(config, payload.usage || {}, { reservationId });
    const consultedSources = openAiDiscoverySources(payload);
    const parsed = safeJsonParse(extractJsonObjectText(extractOpenAiOutputText(payload)), null) || {};
    const allQueryIds = plan.queries.map((query) => query.id);
    const resultsByUrl = new Map();
    for (const observation of Array.isArray(parsed.observations) ? parsed.observations : []) {
      const url = canonicalPrintShopExternalUrl(observation?.url);
      const consulted = consultedSources.get(url);
      if (!url || !consulted) continue;
      resultsByUrl.set(url, {
        queryIds: (Array.isArray(observation.queryIds) ? observation.queryIds : []).filter((id) => allQueryIds.includes(id)),
        title: String(observation.title || consulted.title || new URL(url).hostname).slice(0, 240),
        url,
        snippet: String(observation.summary || "").slice(0, 1200),
        observationType: "provider_summary",
      });
    }
    for (const source of consultedSources.values()) {
      if (resultsByUrl.has(source.url)) continue;
      resultsByUrl.set(source.url, {
        queryIds: allQueryIds,
        title: source.title || new URL(source.url).hostname,
        url: source.url,
        snippet: "Consulted by OpenAI web search for the approved research plan; no page excerpt was stored.",
        observationType: "citation",
      });
    }
    const maximumSources = plan.maximumCalls * plan.maximumResultsPerCall;
    const results = [...resultsByUrl.values()]
      .map((result) => ({ ...result, queryIds: result.queryIds.length ? result.queryIds : allQueryIds }))
      .slice(0, maximumSources);
    if (!results.length) throw guardedError("OpenAI web research returned no usable cited HTTP(S) sources.", 502);
    const allowedUrls = new Set(results.map((result) => result.url));
    const opportunities = (Array.isArray(parsed.opportunities) ? parsed.opportunities : []).slice(0, 8).map((opportunity) => ({
      title: opportunity?.title,
      problem: opportunity?.problem,
      targetBuyer: opportunity?.targetBuyer,
      suggestedTemplateId: opportunity?.suggestedTemplateId,
      sourceUrls: (Array.isArray(opportunity?.sourceUrls) ? opportunity.sourceUrls : [])
        .map(canonicalPrintShopExternalUrl)
        .filter((url) => allowedUrls.has(url)),
    })).filter((opportunity) => opportunity.sourceUrls.length);
    const toolCallsUsed = (payload.output || []).filter((item) => item?.type === "web_search_call").length;
    return {
      results,
      opportunities,
      providerResponseId: String(payload.id || ""),
      callsCompleted: 1,
      toolCallsUsed,
    };
  } finally {
    releaseAiUsageReservation(reservationId);
  }
}

async function fetchPrintShopDiscoveryResults({ provider, plan, scope }) {
  if (provider === "openai_web_search") {
    return fetchOpenAiPrintShopDiscovery({
      plan,
      maximumToolCalls: scope.maximumToolCalls,
      maximumOutputTokens: scope.maximumOutputTokens,
    });
  }
  const results = [];
  let callsCompleted = 0;
  for (const query of plan.queries.slice(0, scope.maximumProviderRequests)) {
    const observations = await fetchPrintShopResearchResults({
      provider,
      query: query.query,
      geography: plan.brief.geography,
    });
    callsCompleted += 1;
    observations.slice(0, scope.maximumResultsPerCall).forEach((result) => results.push({
      ...result,
      queryId: query.id,
      observationType: "search_snippet",
    }));
  }
  return { results, opportunities: [], providerResponseId: null, callsCompleted, toolCallsUsed: callsCompleted };
}

function createHumanGatePackage(payload = {}) {
  const packageTypes = new Set(["connector_setup", "posting_package", "store_change", "campaign", "new_agent_proposal", "general"]);
  const packageType = packageTypes.has(String(payload.packageType || "")) ? payload.packageType : "general";
  const office = officeDefinition(payload.officeId || payload.office || "clips-office");
  const actionType = payload.actionType || detectRiskyAction(payload.message || payload.title || "") || (
    packageType === "connector_setup" ? "external_api_action" :
      packageType === "posting_package" ? "publish_video" :
        packageType === "new_agent_proposal" ? "create_live_agent" :
          "external_api_action"
  );
  const request = createHumanGateRequest({
    ...payload,
    actionType,
    title: payload.title || `${office.name}: ${packageType.replaceAll("_", " ")} review`,
    evidence: payload.evidence || `Agent 101 prepared a ${packageType.replaceAll("_", " ")} package for ${office.name}.`,
    action: payload.action || "Operator must approve, send back, block, or mark manually completed. No external action was executed.",
    riskLevel: payload.riskLevel || (packageType === "connector_setup" || packageType === "posting_package" ? "medium" : office.risk),
  });
  const state = readState();
  const approval = (state.approvals || []).find((item) => item.id === request.approval.id);
  if (approval) {
    approval.packageType = packageType;
    approval.officeId = office.id;
    approval.connectedOffice = office.name;
    approval.decisionOptions = ["approve_draft", "send_back", "block", "mark_manually_completed"];
    writeState(state);
    return { ...request, approval, office, packageType };
  }
  return { ...request, office, packageType };
}

function detectAgent101ActionIntent(message, explicitAction) {
  const action = String(explicitAction || "").trim().toLowerCase();
  const text = String(message || "").toLowerCase();
  if (action) return action;
  if (text.includes("codex prompt") || text.includes("prompt for codex")) return "create_codex_prompt";
  if (text.includes("setup") || text.includes("set up") || text.includes("connector") || text.includes("twitch") || text.includes("capcut account") || text.includes("youtube account") || text.includes("tiktok account")) return "connector_setup_checklist";
  if (text.includes("clips plan") || text.includes("clip plan") || text.includes("capcut brief") || text.includes("caption")) return "create_clips_plan";
  if (text.includes("package") || text.includes("approval") || text.includes("human gate")) return "package_for_approval";
  if (text.includes("task plan") || text.includes("make a plan") || text.includes("bounded job") || text.includes("go do") || text.includes("start work")) return "create_task_plan";
  if (text.includes("remember this") || text.includes("save note") || text.includes("add memory")) return "save_memory";
  return "";
}

function handleAgent101Action(payload = {}) {
  const message = String(payload.message || payload.context || payload.goal || "").trim();
  const action = detectAgent101ActionIntent(message, payload.action || payload.intent);
  if (!action) throw guardedError("Agent 101 action is required.", 400);
  const risky = detectRiskyAction(message);
  if (risky && requiresHumanGate(risky)) {
    return createHumanGatePackage({
      ...payload,
      packageType: "general",
      actionType: risky,
      title: `Review blocked Agent 101 action: ${risky}`,
      evidence: `Requested action: ${message}`,
      riskLevel: "high",
    });
  }

  const office = officeDefinition(payload.officeId || payload.office || "clips-office");
  if (action === "create_task_plan" || action === "draft_workflow") {
    const task = createOfficeTask(office.id, {
      ...payload,
      message,
      title: payload.title || `${office.name}: Bounded task plan`,
      goal: message || `Create a bounded task plan for ${office.name}.`,
    });
    const artifact = createOfficeArtifact(office.id, buildTaskPlanArtifact({ ...payload, message }, office));
    return {
      message: `Created a bounded ${office.name} task plan. It is queued in draft-only mode and external actions remain locked.`,
      task: task.task,
      artifact: artifact.artifact,
      office,
      taskType: "task_plan",
      suggestedActions: [{ label: "Package for approval", action: "package_for_approval", requiresApproval: true }],
      requiresApproval: false,
      riskLevel: task.task.risk,
      logs: [`Task queued for ${office.name}.`, `Plan artifact created for ${office.name}.`],
    };
  }

  if (action === "create_codex_prompt") {
    const artifact = createOfficeArtifact(office.id, buildCodexPromptArtifact({ ...payload, message }, office));
    return {
      message: `Created a scoped Codex prompt for ${office.name}.`,
      artifact: artifact.artifact,
      office,
      taskType: "codex_prompt",
      suggestedActions: [{ label: "Create task plan", action: "create_task_plan", requiresApproval: false }],
      requiresApproval: false,
      riskLevel: office.risk,
      logs: [`Codex prompt artifact created for ${office.name}.`],
    };
  }

  if (action === "create_clips_plan") {
    const task = createOfficeTask("clips-office", {
      ...payload,
      title: payload.title || "Clips Office: Short-form video workflow",
      goal: message || "Create clips plan, CapCut handoff, captions, and Human Gate package.",
      workflowId: "workflow-clips-office",
    });
    const brief = createClipsBrief({
      ...payload,
      title: payload.title || "Short-form video workflow",
      goal: message || "Create clips plan, CapCut handoff, captions, and Human Gate package.",
    });
    return {
      message: "Created a real Clips Office plan with a queued task and draft artifact. Posting, login, and account changes remain blocked.",
      task: task.task,
      artifact: brief.artifact,
      brief: brief.brief,
      office: BUSINESS_OFFICES["clips-office"],
      taskType: "clips_plan",
      suggestedActions: [{ label: "Package for approval", action: "package_for_approval", requiresApproval: true }],
      requiresApproval: false,
      riskLevel: "medium",
      logs: ["Clips task queued.", "Clips plan artifact created."],
    };
  }

  if (action === "connector_setup_checklist") {
    const artifact = createOfficeArtifact(office.id, buildConnectorSetupChecklist({ ...payload, officeId: office.id }));
    const approval = createHumanGatePackage({
      ...payload,
      officeId: office.id,
      packageType: "connector_setup",
      title: `${office.name}: Connector setup review`,
      evidence: "Agent 101 prepared a manual-handoff connector checklist. Operator must own account login, API key creation, and Railway env changes.",
      riskLevel: "medium",
    });
    return {
      message: `Created a connector setup checklist for ${office.name} and routed the risky setup decision to Human Gate.`,
      artifact: artifact.artifact,
      approval: approval.approval,
      office,
      taskType: "connector_setup",
      suggestedActions: [{ label: "Review in Human Gate", action: "review_human_gate", requiresApproval: true }],
      requiresApproval: true,
      riskLevel: "medium",
      logs: ["Connector checklist created.", "Human Gate package created."],
    };
  }

  if (action === "package_for_approval" || action === "send_to_human_gate") {
    const approval = createHumanGatePackage({
      ...payload,
      officeId: office.id,
      packageType: payload.packageType || (office.id === "clips-office" ? "posting_package" : "general"),
      title: payload.title || `${office.name}: Approval package`,
      evidence: payload.evidence || `Agent 101 packaged this request from ${office.name}: ${message || "operator requested review"}`,
      riskLevel: payload.riskLevel || office.risk,
    });
    return {
      message: `Packaged ${office.name} for Human Gate. The operator can approve draft, send back, block, or mark manually completed.`,
      approval: approval.approval,
      office,
      taskType: "approval_package",
      suggestedActions: [{ label: "Review Human Gate", action: "review_human_gate", requiresApproval: true }],
      requiresApproval: true,
      riskLevel: approval.approval.riskLevel,
      logs: [`Human Gate package created for ${office.name}.`],
    };
  }

  if (action === "save_memory") {
    const state = readState();
    addMemory(state, "working", `${office.name} note`, message || "Operator note saved.", office.id);
    audit(state, "Agent 101 saved memory", `${office.name}: ${String(message).slice(0, 120)}`);
    writeState(state);
    return {
      message: `Saved a working-memory note for ${office.name}.`,
      memory: state.memory.working[0],
      office,
      taskType: "memory_note",
      requiresApproval: false,
      riskLevel: "low",
      logs: [`Memory saved for ${office.name}.`],
    };
  }

  throw guardedError("Agent 101 action is not supported yet.", 400);
}

function localAgent101ChatResponse(message, context = {}) {
  const text = String(message || "").toLowerCase();
  const risky = detectRiskyAction(text);
  if (risky) return blockedDepoResponse(risky);
  if (hasClipsOfficeChatContext(context)) {
    return buildClipsOfficeFollowupResponse(message, context);
  }
  if (isClipsOfficeIntakeRequest(text)) {
    return buildClipsOfficeIntakeResponse(message, context);
  }
  if (text.includes("codex") || text.includes("code") || text.includes("ui") || text.includes("fix") || text.includes("implement")) {
    return {
      message: formatAgent101ExecutiveReport({
        title: "IMPLEMENTATION STATUS",
        currentStatus: [
          "Request classified as an internal implementation task.",
          "External actions remain locked.",
          "Human Gate is required only if the work touches credentials, publishing, spending, customer contact, or system settings.",
        ],
        keyFindings: [
          "Primary leverage is a scoped code inspection before edits.",
          "Likely affected systems: UI state, backend route, persistence, tests, and packaged Mac app if desktop behavior is involved.",
          "Verification must prove the exact screen or endpoint changed.",
        ],
        risks: [
          "Copy-only changes will not fix runtime behavior.",
          "Unscoped refactors can destabilize working offices.",
          "Secrets and external account actions must stay server-side and approval-gated.",
        ],
        recommendations: [
          "Inspect repo docs, target files, related routes, and tests before patching.",
          "Patch the smallest path that changes real behavior.",
          "Run syntax, unit, endpoint, and packaged-app checks before calling it ready.",
        ],
        nextActions: [
          "Create the implementation brief, patch the target path, run checks, and verify the local app.",
        ],
      }),
      taskType: "code_plan",
      suggestedActions: [
        { label: "Create Codex prompt", action: "create_codex_prompt", requiresApproval: false },
        { label: "Create task plan", action: "create_task_plan", requiresApproval: false },
      ],
      requiresApproval: false,
      riskLevel: "low",
      artifacts: [
        {
          type: "code_plan",
          title: "Codex implementation prompt",
          content: [
            "Goal: make the requested change without redesigning unrelated surfaces.",
            "Inspect: README, project memory, target UI component, related CSS, backend route if data is involved.",
            "Patch strategy: keep edits scoped, preserve existing state and safety rules, avoid key exposure.",
            "Test: npm run check, endpoint smoke tests, and browser verification for the touched UI.",
            "Acceptance: no console errors, no layout overlap, and only requested behavior changes.",
          ].join("\n"),
        },
      ],
      logs: ["Agent 101 created a local Codex-style implementation plan."],
    };
  }
  if (text.includes("clip") || text.includes("capcut") || text.includes("tiktok") || text.includes("caption")) {
    return buildClipOfficeExecutiveResponse(message, context);
  }
  if (text.includes("agent") || text.includes("blueprint") || text.includes("hire")) {
    return {
      message: formatAgent101ExecutiveReport({
        title: "AGENT BLUEPRINT STATUS",
        currentStatus: [
          "Request classified as future-agent planning.",
          "Live agent activation is locked behind Human Gate.",
          "Allowed work: role design, tool boundaries, evals, budget, and approval package.",
        ],
        keyFindings: [
          "The highest-risk part is permission expansion, not drafting the blueprint.",
          "A useful blueprint needs authority levels, blocked actions, success metrics, memory scope, and rollback rules.",
        ],
        risks: [
          "Activating an agent without approval can bypass supervision.",
          "Unbounded tools can expose accounts, files, money, or customer contact channels.",
        ],
        recommendations: [
          "Draft the agent as a proposal-only operating spec.",
          "Attach eval checks before any capability moves from draft to live.",
          "Route activation, permissions, credentials, and external tools through Human Gate.",
        ],
        nextActions: [
          "Create a proposed-agent blueprint with allowed tools, prohibited actions, eval gates, and approval scope.",
        ],
      }),
      taskType: "agent_blueprint",
      suggestedActions: [
        { label: "Propose new agent", action: "propose_new_agent", requiresApproval: true },
        { label: "Package for approval", action: "package_for_approval", requiresApproval: true },
      ],
      requiresApproval: false,
      riskLevel: "medium",
      artifacts: [
        {
          type: "brief",
          title: "Future agent blueprint",
          content: "Role, purpose, requested permissions, blocked actions, eval checklist, and Human Gate activation requirement.",
        },
      ],
      logs: ["Agent 101 drafted a future-agent blueprint locally."],
    };
  }
  if (text.includes("blocked") || text.includes("cannot") || text.includes("can't")) {
    return {
      message: formatAgent101ExecutiveReport({
        title: "AUTHORITY STATUS",
        currentStatus: [
          "Safe internal analysis, planning, drafting, reporting, and local artifact work are available.",
          "External execution remains locked by Human Gate.",
        ],
        keyFindings: [
          "Blocked categories: publishing, spending, money movement, customer contact, account changes, credential automation, live agent creation, permission changes, API key changes, system-setting changes, file deletion, and external API actions.",
        ],
        risks: [
          "Bypassing Human Gate would remove the audit trail and approval boundary.",
        ],
        recommendations: [
          "Convert risky work into a scoped approval package with exact action, evidence, reversibility, and expiration.",
        ],
        nextActions: [
          "Prepare the internal draft or create a Human Gate request for the exact external step.",
        ],
      }),
      taskType: "general",
      suggestedActions: [{ label: "Package for approval", action: "package_for_approval", requiresApproval: true }],
      requiresApproval: false,
      riskLevel: "low",
      artifacts: [],
      logs: ["Blocked action list returned."],
    };
  }
  return buildGeneralExecutiveResponse(message, context);
}

async function handleAgent101Chat(payload = {}) {
  const message = String(payload.message || "").trim();
  if (!message) throw guardedError("Message is required.", 400);
  const risky = detectRiskyAction(message);
  if (risky && requiresHumanGate(risky)) {
    const request = createHumanGateRequest({
      actionType: risky,
      title: `Review blocked Agent 101 action: ${risky}`,
      evidence: `Agent 101 chat request: ${message}`,
      riskLevel: "high",
    });
    return {
      ...blockedDepoResponse(risky),
      taskType: "approval_request",
      suggestedActions: [{ label: "Send to Human Gate", action: "send_to_human_gate", requiresApproval: true }],
      artifacts: [],
      approval: request.approval,
      provider: "local_demo",
      mode: "demo",
    };
  }

  const actionIntent = detectAgent101ActionIntent(message, payload.action || "");
  if (actionIntent) {
    return {
      ...handleAgent101Action({
        ...payload,
        action: actionIntent,
        message,
        officeId: payload.officeId || payload.office || payload.roomId || "clips-office",
      }),
      provider: "local_demo",
      mode: "demo",
    };
  }

  const groundingState = readState();
  let knowledgeContext = null;
  try {
    const status = obsidianStatusPayload();
    if (status.initialized || status.connected) {
      knowledgeContext = agentContextBuilder.buildAgentContext({
        vaultPath: status.vaultPath,
        state: groundingState,
        agentId: "agent.1010",
        threadId: payload.threadId || null,
        officeId: payload.officeId || payload.office || payload.roomId || "depo-habitat",
        includeTrace: false,
      });
    }
  } catch {
    knowledgeContext = null;
  }
  payload = {
    ...payload,
    context: {
      operating: agent101Os.buildAgent101Context(groundingState, {
        goal: message,
        threadId: payload.threadId || null,
        obsidianContext: knowledgeContext,
      }),
      knowledge: knowledgeContext,
    },
  };

  const config = readAiProviderConfig();
  const provider = sanitizeProvider(config.provider);
  const mode = isLocalProvider(provider) ? "demo" : sanitizeAiMode(config.mode);
  const canUseLiveProvider = ["openai", "anthropic"].includes(provider) && mode === "live" && Boolean(keyFromConfig(config, provider));
  if (!canUseLiveProvider) {
    return { ...localAgent101ChatResponse(message, payload), provider: "local_demo", mode: "demo" };
  }

  try {
    const live = provider === "anthropic"
      ? await callAnthropicAgent101(config, message, payload)
      : await callOpenAiAgent101(config, message, payload);
    if (shouldUseClipsOfficeIntake(message, payload, live)) {
      const contextualResponse = hasClipsOfficeChatContext(payload)
        ? buildClipsOfficeFollowupResponse(message, payload)
        : buildClipsOfficeIntakeResponse(message, payload);
      return { ...contextualResponse, provider, mode };
    }
    if (agent101MessageViolatesExecutiveStyle(live.message) || !agent101MessageHasExecutiveSections(live.message)) {
      const guarded = localAgent101ChatResponse(message, payload);
      return {
        ...guarded,
        logs: [...(guarded.logs || []), "Executive format guard replaced a noncompliant provider response."],
        provider,
        mode,
      };
    }
    const riskyResponse = detectRiskyAction(
      [
        live.message,
        live.blockedAction,
        ...(live.suggestedActions || []).map((action) => `${action.label} ${action.action}`),
        ...(live.artifacts || []).map((artifact) => `${artifact.title} ${artifact.content}`),
      ].join(" "),
    );
    if ((live.requiresApproval || riskyResponse) && requiresHumanGate(live.blockedAction || riskyResponse)) {
      const actionType = live.blockedAction || riskyResponse;
      const request = createHumanGateRequest({
        actionType,
        title: `Review Agent 101 request: ${actionType}`,
        evidence: `Agent 101 live chat request: ${message}`,
        riskLevel: "high",
      });
      return {
        ...live,
        taskType: "approval_request",
        requiresApproval: true,
        riskLevel: "high",
        blockedAction: actionType,
        approval: request.approval,
        provider,
        mode,
      };
    }
    const state = readState();
    audit(state, "Agent 101 live response", `${live.taskType}: ${message.slice(0, 120)}`);
    writeState(state);
    return { ...live, provider, mode };
  } catch (error) {
    logAiProviderError("agent101-chat", error);
    const friendly = provider === "openai" ? safeAiErrorMessage(error) : "Anthropic could not complete the grounded Agent 101 response; Local Demo fallback was used.";
    recordAiProviderFailure(config, friendly);
    const state = readState();
    audit(state, "Agent 101 provider fallback", friendly);
    writeState(state);
    return {
      ...localAgent101ChatResponse(message, payload),
      logs: [friendly, "Provider error fallback used."],
      fallback: true,
      provider: "local_demo",
      mode: "demo",
    };
  }
}

function guardedError(message, status = 409) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function enforceAutomationGuards(state, action) {
  if (state.governance.killSwitch) {
    throw guardedError("Kill switch is enabled. Resume Argentum before running Agent 101.", 423);
  }
  if (action === "cycle" && state.governance.cycleCount >= state.governance.cycleLimit) {
    state.mission.paused = true;
    audit(state, "Loop guard paused Agent 101", `Cycle limit reached at ${state.governance.cycleCount}/${state.governance.cycleLimit}.`);
    writeState(state);
    throw guardedError("Cycle limit reached. Reset the loop guard before continuing.", 429);
  }
}

function recordAutomationCost(state, action) {
  if (action === "cycle") state.governance.cycleCount += 1;
  if (action === "task") state.governance.taskRunCount += 1;
  if (action === "function") state.governance.functionRunCount += 1;
  const increment = action === "cycle" ? 0.01 : action === "task" ? 0.03 : 0.02;
  state.governance.estimatedSpendUsd = Number((state.governance.estimatedSpendUsd + increment).toFixed(2));
}

function functionSpecForTask(task) {
  if (task.intent === "market_monitoring") {
    return {
      name: "Read-only market watch note",
      description: "Reusable paper-mode workflow for converting stock algorithm signals into reviewable notes without broker access or trade execution.",
      inputs: ["watchlist", "signal assumptions", "time horizon"],
      outputs: ["signal note", "confidence label", "blocked-action checklist"],
      blockedActions: ["place trade", "connect broker", "move money", "recommend guaranteed returns"],
    };
  }
  if (task.intent === "agent_factory") {
    return {
      name: "Future agent proposal",
      description: "Reusable approval-gated workflow for drafting a new agent manifest, permissions, tests, budgets, and review packet.",
      inputs: ["agent job", "allowed tools", "risk level"],
      outputs: ["draft manifest", "eval checklist", "approval package"],
      blockedActions: ["deploy agent", "change permissions", "modify core routing", "connect production tools"],
    };
  }
  return {
    name: "Clips Office package",
    description: "Reusable draft-only workflow for turning raw video notes into a short-form content package for Human Gate review.",
    inputs: ["raw video notes", "platform target", "brand context"],
    outputs: ["clip plan", "CapCut handoff", "caption package", "approval package"],
    blockedActions: ["publish video", "log into accounts", "create API keys", "change account settings", "spend money"],
  };
}

function promoteTaskToFunction(state, task) {
  const spec = functionSpecForTask(task);
  const existing = state.functions.find((item) => item.sourceTaskId === task.id);
  if (existing) {
    existing.status = "approved";
    existing.updatedAt = now();
    return existing;
  }

  const fn = {
    id: `func-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: spec.name,
    workflowId: task.workflowId,
    sourceTaskId: task.id,
    status: "approved",
    risk: task.risk,
    ownerAgentId: "agent-001-depo",
    description: spec.description,
    inputs: spec.inputs,
    outputs: spec.outputs,
    blockedActions: spec.blockedActions,
    createdAt: now(),
  };
  state.functions.unshift(fn);
  state.functions = state.functions.slice(0, 40);

  const capabilityId = `cap-${fn.id}`;
  if (!state.capabilities.some((capability) => capability.id === capabilityId)) {
    state.capabilities.unshift({
      id: capabilityId,
      name: fn.name,
      status: "Approved function",
      description: fn.description,
    });
  }
  return fn;
}

function classifyTask(text, requestedWorkflowId) {
  const lower = text.toLowerCase();
  if (requestedWorkflowId) {
    const workflowRisk = {
      "workflow-clips-office": ["content_creation", "medium"],
      "workflow-pod-lab": ["print_on_demand", "low"],
      "workflow-stock-watch": ["market_monitoring", "high"],
      "workflow-agent-factory": ["agent_factory", "medium"],
    }[requestedWorkflowId];
    if (workflowRisk) {
      return { workflowId: requestedWorkflowId, intent: workflowRisk[0], risk: workflowRisk[1] };
    }
  }
  if (lower.includes("stock") || lower.includes("trade") || lower.includes("algo") || lower.includes("market")) {
    return { workflowId: "workflow-stock-watch", intent: "market_monitoring", risk: "high" };
  }
  if (lower.includes("clip") || lower.includes("video") || lower.includes("capcut") || lower.includes("tiktok") || lower.includes("reel") || lower.includes("short")) {
    return { workflowId: "workflow-clips-office", intent: "content_creation", risk: "medium" };
  }
  if (lower.includes("agent") || lower.includes("function") || lower.includes("capability")) {
    return { workflowId: "workflow-agent-factory", intent: "agent_factory", risk: "medium" };
  }
  return { workflowId: "workflow-clips-office", intent: "content_creation", risk: "medium" };
}

function taskPlan(task) {
  if (task.intent === "content_creation") {
    return {
      evidence: [
        "Posting and account actions are blocked until Human Gate approval.",
        "CapCut is handled as a manual handoff, not a credentialed API integration.",
        "TikTok, Instagram, and YouTube output stays as draft captions and posting packages.",
      ],
      output: "Agent 101 prepared a Clips Office draft: define the clip goal, list raw footage and audio needs, create three clip structures, write CapCut edit instructions, draft posting captions, and route publishing through Human Gate.",
      approvalTitle: "Review Clips Office posting package",
      approvalAction: "Decide whether this draft clip package can move toward manual posting. No upload or external account action has been executed.",
    };
  }
  if (task.intent === "market_monitoring") {
    return {
      evidence: [
        "Execution permissions are blocked.",
        "Output is limited to paper notes and signal summaries.",
        "Any broker connection, trade, or money movement must be approved separately.",
      ],
      output: "Agent 101 prepared a read-only stock algorithm watch note: define the watchlist, record signal assumptions, log confidence, and keep every trade-related action in paper mode until a human approves a separate connector.",
      approvalTitle: "Review read-only market monitor task",
      approvalAction: "Confirm this task may be saved as paper-trading guidance only.",
    };
  }
  if (task.intent === "agent_factory") {
    return {
      evidence: [
        "New agents are proposals only.",
        "Manifest, budget, tests, and permissions must be reviewed together.",
        "Deployment is blocked until explicit approval.",
      ],
      output: "Agent 101 drafted a future-agent proposal path: define the job, list blocked capabilities, set a spend limit, write eval cases, and send the manifest to the approval queue without deployment.",
      approvalTitle: "Review future agent proposal task",
      approvalAction: "Decide whether this proposed function can become a draft manifest.",
    };
  }
  return {
    evidence: [
      "Posting and account actions are blocked until Human Gate approval.",
      "CapCut and platform setup remain manual handoffs.",
      "Agent 101 can draft clips packages, but cannot log in, upload, publish, or create API keys.",
    ],
    output: "Agent 101 prepared a Clips Office draft: define the clip goal, list source footage needs, write three hook options, create a CapCut handoff, draft captions, and package any posting step for Human Gate approval.",
    approvalTitle: "Review Clips Office package",
    approvalAction: "Decide whether this draft clip package can move toward manual posting. No upload or external account action has been executed.",
  };
}

function artifactForTask(task, plan) {
  if (task.intent === "content_creation") {
    return {
      type: "clips_package",
      title: "Clips Office video package",
      summary: "Draft-only short-form video workflow with CapCut handoff notes and posting drafts.",
      sections: [
        {
          label: "Clip objective",
          body: "Create three 9:16 short clips, each with a fast hook, clean visual cuts, caption moments, and one clear call to action.",
        },
        {
          label: "CapCut handoff",
          body: "Use 1080x1920, 15-30 seconds, auto captions reviewed by operator, light transitions, music ducked below speech, and export as MP4.",
        },
        {
          label: "Posting drafts",
          body: "Prepare TikTok, Instagram, and YouTube Shorts captions and hashtags as drafts only. Posting requires Human Gate approval.",
        },
      ],
      blockedActions: ["publish video", "upload to TikTok", "change social account", "spend ad money", "use raw credentials"],
    };
  }
  if (task.intent === "market_monitoring") {
    return {
      type: "stock_watch_note",
      title: "Read-only stock algorithm watch note",
      summary: "Paper-mode market signal note that records assumptions and blocks live trading.",
      sections: [
        {
          label: "Watch objective",
          body: "Track algorithm signals as research notes only, with no broker connection and no trade execution.",
        },
        {
          label: "Signal checklist",
          body: "Record ticker, signal source, confidence, time horizon, contradiction notes, and paper outcome.",
        },
        {
          label: "Operator gate",
          body: "Any broker access, trade order, money movement, or customer-facing financial claim must go through approval.",
        },
      ],
      blockedActions: ["place trade", "connect broker", "move money", "recommend guaranteed returns"],
    };
  }
  if (task.intent === "agent_factory") {
    return {
      type: "agent_proposal",
      title: "Future agent function proposal",
      summary: "Draft manifest path for a new agent or capability that remains proposal-only.",
      sections: [
        {
          label: "Proposed job",
          body: "Define the agent function, owner, allowed tools, memory scope, budgets, and stop conditions.",
        },
        {
          label: "Eval plan",
          body: "Write scenario tests, permission tests, loop tests, and failure behavior before any deployment request.",
        },
        {
          label: "Approval gate",
          body: "Deployment, permission changes, production connectors, and core routing changes are blocked.",
        },
      ],
      blockedActions: ["deploy agent", "change permissions", "modify core routing", "connect production tools"],
    };
  }
  return {
    type: "pod_brief",
    title: "Print-on-demand niche brief",
    summary: "Draft-only Etsy/POD research brief that turns a niche idea into an approval-ready listing plan.",
    sections: [
      {
        label: "Niche hypothesis",
        body: "Choose one product/niche angle, then gather demand, competitor, pricing, and differentiation notes.",
      },
      {
        label: "Listing outline",
        body: "Draft title angles, keyword themes, product mockup needs, fulfillment assumptions, and cost notes.",
      },
      {
        label: "Approval gate",
        body: "Publishing, store setup, spend, earnings claims, and customer contact remain blocked until approved.",
      },
    ],
    blockedActions: ["publish listing", "create seller account", "spend money", "make earnings claims"],
  };
}

function createArtifact(state, task, plan) {
  const spec = artifactForTask(task, plan);
  const artifact = {
    id: `artifact-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    taskId: task.id,
    functionId: task.functionId || null,
    workflowId: task.workflowId,
    type: spec.type,
    title: spec.title,
    summary: spec.summary,
    status: "draft_ready",
    risk: task.risk,
    evidence: plan.evidence,
    sections: spec.sections,
    blockedActions: spec.blockedActions,
    createdAt: now(),
    updatedAt: now(),
  };
  state.artifacts.unshift(artifact);
  state.artifacts = state.artifacts.slice(0, 50);
  return artifact;
}

function createTask(payload) {
  const text = String(payload.text || payload.title || "").trim();
  if (!text) {
    throw new Error("Task text is required");
  }
  const state = readState();
  const classification = classifyTask(text, payload.workflowId);
  const task = {
    id: `task-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: text.length > 76 ? `${text.slice(0, 73)}...` : text,
    operatorText: text,
    workflowId: classification.workflowId,
    intent: classification.intent,
    risk: classification.risk,
    status: "queued",
    evidence: [],
    output: "",
    createdAt: now(),
    updatedAt: now(),
  };
  state.tasks.unshift(task);
  audit(state, "Operator assigned Agent 101 a task", task.title);
  writeState(state);
  return state;
}

function createTaskFromTemplate(templateId) {
  const state = readState();
  const template = state.taskTemplates.find((item) => item.id === templateId);
  if (!template) {
    throw guardedError("Template not found", 404);
  }
  const classification = classifyTask(template.prompt, template.workflowId);
  const task = {
    id: `task-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: template.name,
    operatorText: template.prompt,
    workflowId: classification.workflowId,
    templateId: template.id,
    intent: classification.intent,
    risk: classification.risk,
    status: "queued",
    evidence: [],
    output: "",
    createdAt: now(),
    updatedAt: now(),
  };
  state.tasks.unshift(task);
  state.mission.activeWorkflowId = task.workflowId;
  state.mission.currentStep = 0;
  audit(state, "Template queued for Agent 101", `${template.name}: ${template.outcome}`);
  addMemory(state, "working", `Template queued: ${template.name}`, template.prompt, "task_template");
  writeState(state);
  return state;
}

function intentForWorkflow(workflowId) {
  if (workflowId === "workflow-clips-office") return "content_creation";
  if (workflowId === "workflow-stock-watch") return "market_monitoring";
  if (workflowId === "workflow-agent-factory") return "agent_factory";
  return "print_on_demand";
}

function riskForWorkflow(workflowId) {
  if (workflowId === "workflow-clips-office") return "medium";
  if (workflowId === "workflow-stock-watch") return "high";
  if (workflowId === "workflow-agent-factory") return "medium";
  return "low";
}

function runFunction(functionId, payload = {}) {
  const state = readState();
  enforceAutomationGuards(state, "function");
  const fn = state.functions.find((item) => item.id === functionId);
  if (!fn) {
    const error = new Error("Function not found");
    error.status = 404;
    throw error;
  }
  if (!["approved", "seeded"].includes(fn.status)) {
    const error = new Error("Function is not runnable");
    error.status = 409;
    throw error;
  }

  const operatorText = String(payload.input || "").trim() || `Run ${fn.name} with draft-only safeguards.`;
  const task = {
    id: `task-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: `${fn.name}: ${operatorText}`.slice(0, 90),
    operatorText,
    workflowId: fn.workflowId,
    functionId: fn.id,
    intent: intentForWorkflow(fn.workflowId),
    risk: fn.risk || riskForWorkflow(fn.workflowId),
    status: "queued",
    evidence: [
      `Function inputs: ${(fn.inputs || []).join(", ") || "unspecified"}.`,
      `Blocked actions: ${(fn.blockedActions || []).join(", ") || "none listed"}.`,
    ],
    output: "",
    createdAt: now(),
    updatedAt: now(),
  };
  state.tasks.unshift(task);

  const execution = {
    id: `exec-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    functionId: fn.id,
    functionName: fn.name,
    taskId: task.id,
    status: "queued_task",
    input: operatorText,
    risk: task.risk,
    createdAt: now(),
  };
  state.executions.unshift(execution);
  state.executions = state.executions.slice(0, 50);

  state.mission.activeWorkflowId = fn.workflowId;
  state.mission.currentStep = 0;
  recordAutomationCost(state, "function");
  addMemory(state, "working", `Function run queued: ${fn.name}`, operatorText, "function_execution");
  audit(state, "Agent 101 queued a function run", `${fn.name} created a new supervised task.`);
  writeState(state);
  return state;
}

function runTask(taskId) {
  const state = readState();
  enforceAutomationGuards(state, "task");
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) {
    const error = new Error("Task not found");
    error.status = 404;
    throw error;
  }
  if (!["queued", "needs_revision"].includes(task.status)) {
    const error = new Error("Task is not runnable");
    error.status = 409;
    throw error;
  }

  const plan = taskPlan(task);
  const artifact = createArtifact(state, task, plan);
  task.status = "draft_ready";
  task.evidence = plan.evidence;
  task.output = plan.output;
  task.artifactId = artifact.id;
  task.updatedAt = now();
  state.mission.activeWorkflowId = task.workflowId;
  state.mission.currentStep = 3;
  recordAutomationCost(state, "task");

  addMemory(state, "working", `Task draft: ${task.title}`, task.output, "depo_task");
  audit(state, "Agent 101 completed a task draft", `${task.title}: ${task.output}`);

  const approvalId = `approval-${task.id}`;
  const existingApproval = state.approvals.find((approval) => approval.id === approvalId && approval.status === "pending");
  if (!existingApproval) {
    state.approvals.unshift({
      id: approvalId,
      taskId: task.id,
      artifactId: artifact.id,
      title: plan.approvalTitle,
      risk: task.risk,
      evidence: plan.evidence.join(" "),
      action: plan.approvalAction,
      status: "pending",
      createdAt: now(),
    });
  }

  writeState(state);
  return state;
}

function runNextTask() {
  const state = readState();
  const task = state.tasks.find((item) => item.status === "queued" || item.status === "needs_revision");
  if (!task) {
    throw guardedError("No queued task is available for Agent 101.", 404);
  }
  return runTask(task.id);
}

function runWorkday(payload = {}) {
  const requestedLimit = Number(payload.limit || 3);
  const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 3, 5));
  const runIds = [];
  let state = readState();

  for (let index = 0; index < limit; index += 1) {
    const nextTask = state.tasks.find((item) => item.status === "queued" || item.status === "needs_revision");
    if (!nextTask) break;
    state = runTask(nextTask.id);
    runIds.push(nextTask.id);
  }

  state = readState();
  audit(state, "Supervised workday completed", `Agent 101 processed ${runIds.length} queued task${runIds.length === 1 ? "" : "s"}.`);
  state.governance.lastWorkday = {
    runIds,
    limit,
    completedAt: now(),
  };
  writeState(state);
  return state;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendHtml(req, res, status, html, extraHeaders = {}) {
  res.writeHead(status, {
    ...securityHeaders(req),
    ...extraHeaders,
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(html);
}

function sendRobinhoodOauthResultPage(req, res, result) {
  const views = {
    connected: {
      status: 200,
      eyebrow: "CONNECTION COMPLETE",
      title: "Robinhood is connected",
      message: "Return to Argentum. Stock Office will load the connected account automatically.",
      tone: "#43d99b",
    },
    needs_refresh: {
      status: 200,
      eyebrow: "CONNECTION SAVED",
      title: "Robinhood is connected",
      message: "Return to Argentum and use Refresh account if the broker snapshot does not appear automatically.",
      tone: "#f5c451",
    },
    connection_error: {
      status: 400,
      eyebrow: "CONNECTION NOT FINISHED",
      title: "Robinhood did not connect",
      message: "Return to Argentum and try Connect Robinhood again. No trade or money movement occurred.",
      tone: "#ff7f8b",
    },
  };
  const view = views[result] || views.connection_error;
  sendHtml(req, res, view.status, `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${view.title} | Argentum</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; color: #edf5ff; background: radial-gradient(circle at 15% 15%, #12334b, transparent 34%), radial-gradient(circle at 85% 10%, #22205a, transparent 38%), #07101f; }
    main { width: min(560px, 100%); padding: 34px; border: 1px solid #284968; border-radius: 22px; background: rgba(8, 20, 38, .9); box-shadow: 0 24px 80px rgba(0, 0, 0, .42); }
    .mark { width: 46px; height: 46px; display: grid; place-items: center; margin-bottom: 24px; border-radius: 14px; color: #06131d; background: ${view.tone}; font-size: 24px; font-weight: 900; }
    .eyebrow { margin: 0 0 8px; color: ${view.tone}; font-size: 12px; font-weight: 800; letter-spacing: .14em; }
    h1 { margin: 0; font-size: clamp(28px, 6vw, 42px); line-height: 1.05; }
    p { margin: 16px 0 0; color: #b9cbe0; font-size: 17px; line-height: 1.55; }
    .safe { margin-top: 26px; padding-top: 18px; border-top: 1px solid #243a55; color: #8198b3; font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <div class="mark" aria-hidden="true">A</div>
    <p class="eyebrow">${view.eyebrow}</p>
    <h1>${view.title}</h1>
    <p>${view.message}</p>
    <p class="safe">You can close this window. Argentum never receives your Robinhood password.</p>
  </main>
</body>
</html>`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function readCredentials(req) {
  const raw = await readRawBody(req);
  const contentType = req.headers["content-type"] || "";
  if (contentType.includes("application/json")) {
    return raw ? JSON.parse(raw) : {};
  }
  const params = new URLSearchParams(raw);
  return {
    username: params.get("username") || "",
    password: params.get("password") || "",
    confirmPassword: params.get("confirmPassword") || "",
    remember: params.get("remember") || "",
    savePassword: params.get("savePassword") || "",
  };
}

function rememberSessionLabel() {
  const days = Math.max(1, Math.round(REMEMBER_SESSION_TTL_MS / DAY_MS));
  return `${days} day${days === 1 ? "" : "s"}`;
}

function wantsRememberedSession(value) {
  return value === true || ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function issueSession(res, req, user, options = {}) {
  const sessionTtlMs = options.remember ? REMEMBER_SESSION_TTL_MS : SESSION_TTL_MS;
  const token = signSession({
    uid: user.id,
    user: user.username,
    role: user.role,
    iat: Date.now(),
    exp: Date.now() + sessionTtlMs,
    remembered: Boolean(options.remember),
    nonce: crypto.randomBytes(16).toString("hex"),
  });
  res.writeHead(302, {
    ...securityHeaders(req),
    "set-cookie": sessionCookie(req, token, sessionTtlMs),
    "cache-control": "no-store",
    location: APP_MODE === "cloud" ? "/app" : "/",
  });
  res.end();
}

async function handleSetup(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  const isRootRoute = url.pathname === "/";
  const isSetupRoute = url.pathname === "/setup";
  const setupRoute = APP_MODE === "cloud" ? isSetupRoute : isRootRoute || isSetupRoute;
  if (!setupRoute) return false;

  const store = readAuthStore();
  if (activeUserCount(store) > 0) {
    if (isSetupRoute) {
      redirect(res, currentSession(req) ? (APP_MODE === "cloud" ? "/app" : "/") : "/login", req);
      return true;
    }
    return false;
  }

  if (isSetupRoute && req.method === "GET") {
    if (APP_MODE === "cloud") {
      sendHtml(req, res, 200, setupPage());
      return true;
    }
    redirect(res, "/", req);
    return true;
  }

  if (isRootRoute && req.method === "GET") {
    sendHtml(req, res, 200, setupPage());
    return true;
  }

  if (req.method === "POST") {
    if (isLoginLimited(req)) {
      sendHtml(req, res, 429, setupPage("Too many attempts. Wait 15 minutes, then try again."));
      return true;
    }
    try {
      const payload = await readCredentials(req);
      const user = createInitialAccessUser(payload);
      clearLoginFailures(req);
      issueSession(res, req, user, {
        remember: wantsRememberedSession(payload.savePassword),
      });
    } catch (error) {
      recordLoginFailure(req);
      sendHtml(req, res, error.status || 400, setupPage(error.message));
    }
    return true;
  }

  sendHtml(req, res, 405, setupPage("Unsupported setup request."));
  return true;
}

async function handleLogin(req, res) {
  if (req.method === "GET" && req.url.startsWith("/login")) {
    if (activeUserCount(readAuthStore()) === 0) {
      redirect(res, APP_MODE === "cloud" ? "/setup" : "/", req);
      return true;
    }
    if (currentSession(req)) {
      redirect(res, APP_MODE === "cloud" ? "/app" : "/", req);
      return true;
    }
    sendHtml(req, res, 200, loginPage());
    return true;
  }

  if (req.method === "POST" && (req.url.startsWith("/login") || req.url.startsWith("/api/login"))) {
    if (activeUserCount(readAuthStore()) === 0) {
      if (req.url.startsWith("/api/login")) {
        sendJson(res, 409, { error: "Create the first admin login before signing in." });
      } else {
        redirect(res, APP_MODE === "cloud" ? "/setup" : "/", req);
      }
      return true;
    }
    if (isLoginLimited(req)) {
      sendHtml(req, res, 429, loginPage("Too many attempts. Wait 15 minutes, then try again."));
      return true;
    }
    const payload = await readCredentials(req);
    const username = String(payload.username || "");
    const password = String(payload.password || "");
    const store = readAuthStore();
    const user = findAuthUser(store, username);
    const valid = verifyPassword(password, user);

    if (!valid) {
      recordLoginFailure(req);
      sendHtml(req, res, 401, loginPage("Invalid username or password."));
      return true;
    }

    clearLoginFailures(req);
    user.lastLoginAt = now();
    user.updatedAt = user.updatedAt || now();
    writeAuthStore(store);
    issueSession(res, req, user, {
      remember: wantsRememberedSession(payload.remember),
    });
    return true;
  }

  if (req.method === "POST" && req.url.startsWith("/api/logout")) {
    res.writeHead(200, {
      ...securityHeaders(req),
      "set-cookie": clearSessionCookie(req),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  if (req.method === "GET" && req.url.startsWith("/logout")) {
    res.writeHead(302, {
      ...securityHeaders(req),
      "set-cookie": clearSessionCookie(req),
      "cache-control": "no-store",
      location: "/login",
    });
    res.end();
    return true;
  }

  return false;
}

function advanceCycle() {
  const state = readState();
  enforceAutomationGuards(state, "cycle");
  const steps = state.mission.steps;
  state.mission.currentStep = (state.mission.currentStep + 1) % steps.length;
  const step = steps[state.mission.currentStep];
  recordAutomationCost(state, "cycle");

  audit(state, `Agent 101 moved to ${step.station}`, step.copy);

  if (step.station === "Draft") {
    addMemory(
      state,
      "working",
      "Draft artifact prepared",
      "Agent 101 prepared the Clips Office lane as a reusable draft workflow. Posting, login, connector, and account actions remain blocked.",
      "depo_cycle",
    );
  }

  if (step.station === "Approval") {
    const exists = state.approvals.some((approval) => approval.id === "approval-depo-cycle-package" && approval.status === "pending");
    if (!exists) {
      state.approvals.unshift({
        id: "approval-depo-cycle-package",
        title: "Review Agent 101 cycle package",
        risk: "medium",
        evidence: "Latest Clips Office cycle includes setup planning, verification, draft package, and blocked-action classification.",
        action: "Review whether Agent 101 can continue the Clips Office package toward manual Human Gate handoff.",
        status: "pending",
        createdAt: now(),
      });
    }
  }

  writeState(state);
  return state;
}

function currentAccessUser(req) {
  const session = currentSession(req);
  if (!session) return null;
  const store = readAuthStore();
  return {
    store,
    user: findAuthUserById(store, session.uid),
  };
}

function requireAdminAccess(req) {
  const access = currentAccessUser(req);
  if (!access?.user) throw guardedError("Authentication required", 401);
  if (access.user.role !== "admin") throw guardedError("Admin access is required.", 403);
  return access;
}

function requireLocalMode() {
  if (APP_MODE !== "local") throw guardedError("Local desktop mode is not enabled.", 409);
  ensureDataDir();
  return localDatabaseStatus;
}

function readObsidianVaultPath() {
  if (APP_MODE !== "local") return "";
  requireLocalMode();
  return localDatabase.getLocalSetting(DATA_DIR, "obsidianVaultPath", "") || "";
}

function normalizeStockSecIdentity(value) {
  const identity = String(value || "").trim().replace(/\s+/g, " ").slice(0, 240);
  const email = identity.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  const label = email ? identity.replace(email, "").trim().replace(/[-|,;]+$/, "").trim() : "";
  if (!email || label.length < 2) {
    throw guardedError("Enter an organization or operator name plus a monitored email, for example: Argentum Stock Office ops@example.com.", 400);
  }
  return identity;
}

function hydrateStockSecIdentity() {
  if (process.env.STOCK_GURU_SEC_USER_AGENT || APP_MODE !== "local") return;
  try {
    const stored = localDatabase.getLocalSetting(DATA_DIR, "stockSecUserAgent", "");
    if (stored) process.env.STOCK_GURU_SEC_USER_AGENT = normalizeStockSecIdentity(stored);
  } catch {
    // A missing local database or invalid old value keeps SEC intake safely disabled.
  }
}

function stockSecSetupPayload() {
  const configured = Boolean(String(process.env.STOCK_GURU_SEC_USER_AGENT || "").trim());
  return {
    configured,
    status: configured ? "ready" : "setup_required",
    storage: configured ? "local_database_server_only" : "not_configured",
    transmittedTo: "SEC.gov automated filing requests only",
  };
}

function configuredObsidianVaultPath() {
  return readObsidianVaultPath() || obsidianVault.defaultVaultPath();
}

function obsidianStatusPayload() {
  const configuredPath = readObsidianVaultPath();
  const vaultPath = configuredPath || obsidianVault.defaultVaultPath();
  return {
    configured: Boolean(configuredPath),
    defaultVaultPath: obsidianVault.defaultVaultPath(),
    ...obsidianVault.vaultStatus(vaultPath),
  };
}

function brainStartupStatusPayload() {
  const configuredPath = readObsidianVaultPath();
  const vaultPath = configuredPath || obsidianVault.defaultVaultPath();
  const exists = fs.existsSync(vaultPath);
  let writable = false;
  if (exists) {
    try {
      fs.accessSync(vaultPath, fs.constants.R_OK | fs.constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }
  }
  const schema = exists ? obsidianVault.loadVaultSchema(vaultPath) : null;
  let manifestLoaded = false;
  let indexLoaded = false;
  let validationStatus = "unavailable";
  if (exists && writable) {
    try {
      const manifest = obsidianVault.rebuildEntityManifest(vaultPath);
      manifestLoaded = Boolean(manifest.entities?.length);
      const index = obsidianVault.rebuildSearchIndex(vaultPath);
      indexLoaded = Boolean(index.notes?.length);
      const validation = obsidianVault.validateVault(vaultPath);
      validationStatus = validation.healthy ? "healthy" : "degraded";
    } catch {
      validationStatus = "degraded";
    }
  }
  const lastBackupPath = brainBackup.latestBackup();
  return {
    vaultPath,
    configured: Boolean(configuredPath),
    exists,
    writable,
    schemaVersion: schema?.schemaVersion || null,
    manifestLoaded,
    indexLoaded,
    validationStatus,
    lastBackup: lastBackupPath || "",
    status: exists && writable && schema?.schemaVersion === "2.0.0" && manifestLoaded && indexLoaded && validationStatus === "healthy"
      ? "ready"
      : configuredPath && !exists
        ? "configured_missing"
        : "degraded",
  };
}

function appendAgent101CitationsToMessage(message, structured) {
  const evidence = (structured?.evidence || []).slice(0, 6);
  if (!message || !evidence.length) return message;
  if (/^CITATIONS/m.test(message)) return message;
  return `${message.trim()}\n\nCITATIONS\n${evidence.map((item, index) => `${index + 1}. ${item.title} (${item.canonicalPath || item.sourceId})`).join("\n")}`;
}

function currentRequestIsAdmin(req) {
  return currentAccessUser(req)?.user?.role === "admin";
}

function requireStockOfficeAccess(req, capability = "view") {
  const access = currentAccessUser(req);
  if (!access?.user) throw guardedError("Session is no longer valid.", 401);
  const permissions = stockPermissions(access.user.role);
  const capabilityMap = {
    view: "canViewWorkspace",
    records: "canViewRecords",
    sources: "canViewSources",
    chat_read: "canViewChat",
    chat_write: "canPostChat",
    assistant: "canUseAssistant",
    sync: "canTriggerSync",
    mirror_request: "canRequestMirrorApproval",
    broker_view: "canViewWorkspace",
    broker_connect: "canRequestBrokerConnection",
    broker_guardrails: "canRequestGuardrailChange",
    order_draft: "canDraftBrokerOrder",
    order_approval: "canRequestOrderApproval",
  };
  const permissionKey = capabilityMap[capability] || "canViewWorkspace";
  if (!permissions[permissionKey]) {
    throw guardedError("You do not have permission to use this Stock Office action.", 403);
  }
  return { user: access.user, permissions };
}

function stockLogoSymbol(pathname = "") {
  const match = String(pathname).match(/^\/api\/stock-office\/logos\/([A-Za-z0-9.-]{1,12})$/);
  return match ? match[1].toUpperCase() : "";
}

function stockLogoPlaceholder(symbol) {
  const label = String(symbol || "?").slice(0, 2);
  const hue = [...symbol].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 360;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="hsl(${hue} 70% 48%)"/><stop offset="1" stop-color="hsl(${(hue + 46) % 360} 70% 26%)"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#g)"/><text x="32" y="39" fill="white" font-family="Arial,sans-serif" font-size="22" font-weight="700" text-anchor="middle">${label}</text></svg>`);
}

async function sendStockLogo(req, res, symbol) {
  requireStockOfficeAccess(req, "view");
  fs.mkdirSync(STOCK_LOGO_CACHE_DIR, { recursive: true });
  const cachePath = path.join(STOCK_LOGO_CACHE_DIR, `${symbol}.img`);
  const metaPath = path.join(STOCK_LOGO_CACHE_DIR, `${symbol}.json`);
  try {
    const cached = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    const stat = fs.statSync(cachePath);
    if (stat.isFile() && Date.now() - stat.mtimeMs <= STOCK_LOGO_MAX_AGE_MS && ["image/svg+xml", "image/png", "image/webp", "image/jpeg"].includes(cached.contentType)) {
      res.writeHead(200, { ...securityHeaders(req), "content-type": cached.contentType, "cache-control": "private, max-age=86400", "x-argentum-logo-source": "cache" });
      res.end(fs.readFileSync(cachePath));
      return;
    }
  } catch {}
  try {
    const response = await fetch(`https://assets.parqet.com/logos/symbol/${encodeURIComponent(symbol)}?format=png&size=96`, {
      headers: { accept: "image/png,image/webp,image/svg+xml", "user-agent": "Argentum-Stock-Office/1.0" },
      signal: AbortSignal.timeout(5_000),
    });
    const contentType = String(response.headers.get("content-type") || "").split(";")[0].toLowerCase();
    const body = Buffer.from(await response.arrayBuffer());
    if (!response.ok || !["image/svg+xml", "image/png", "image/webp", "image/jpeg"].includes(contentType) || body.length < 64 || body.length > 1_000_000) {
      throw new Error("logo unavailable");
    }
    const temporary = `${cachePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, body, { mode: 0o600 });
    fs.renameSync(temporary, cachePath);
    fs.writeFileSync(metaPath, `${JSON.stringify({ contentType, source: "parqet_symbol_logo", observedAt: now() })}\n`, { mode: 0o600 });
    res.writeHead(200, { ...securityHeaders(req), "content-type": contentType, "cache-control": "private, max-age=86400", "x-argentum-logo-source": "parqet" });
    res.end(body);
  } catch {
    res.writeHead(200, { ...securityHeaders(req), "content-type": "image/svg+xml", "cache-control": "private, max-age=300", "x-argentum-logo-source": "generated-fallback" });
    res.end(stockLogoPlaceholder(symbol));
  }
}

function enforceStockOfficeRateLimit(req, action, maxRequests = 40, windowMs = 60_000) {
  const key = `${clientKey(req)}:${action}`;
  const nowMs = Date.now();
  const bucket = stockOfficeRateBuckets.get(key);
  const activeBucket = bucket && bucket.resetAt > nowMs ? bucket : { count: 0, resetAt: nowMs + windowMs };
  activeBucket.count += 1;
  stockOfficeRateBuckets.set(key, activeBucket);
  if (activeBucket.count > maxRequests) {
    throw guardedError("Too many Stock Office requests. Try again shortly.", 429);
  }
}

function stockExecutionMode() {
  return String(process.env.STOCK_GURU_EXECUTION_MODE || "paper").trim().toLowerCase() === "live" ? "live" : "paper";
}

function stockApprovalTtlMinutes() {
  const value = Number(process.env.STOCK_GURU_APPROVAL_TTL_MINUTES);
  return Number.isFinite(value) ? Math.max(1, Math.min(30, Math.round(value))) : 15;
}

function stockIntelligenceState() {
  return {
    opportunities: stockIntelligenceStore.listOpportunities(),
    performance: stockIntelligenceStore.performanceReport(),
    daily: stockDailyIntelligenceSummary(),
    reports: {
      overnight: stockIntelligenceStore.latestReport("overnight"),
      morning: stockIntelligenceStore.latestReport("morning"),
    },
    mirror: stockIntelligenceStore.mirrorState(),
  };
}

const STOCK_INTELLIGENCE_CACHE_MS = 15_000;
let stockIntelligenceStateCache = null;
let stockIntelligenceStateCachedAt = 0;

function invalidateStockIntelligenceStateCache() {
  stockIntelligenceStateCache = null;
  stockIntelligenceStateCachedAt = 0;
}

function cachedStockIntelligenceState() {
  if (stockIntelligenceStateCache && Date.now() - stockIntelligenceStateCachedAt < STOCK_INTELLIGENCE_CACHE_MS) {
    return stockIntelligenceStateCache;
  }
  stockIntelligenceStateCache = stockIntelligenceState();
  stockIntelligenceStateCachedAt = Date.now();
  return stockIntelligenceStateCache;
}

function stockDecisionIntelligenceState() {
  return {
    opportunities: stockIntelligenceStore.listOpportunities(),
    mirror: stockIntelligenceStore.mirrorState(),
  };
}

function stockAlgorithmTestSummary(simulationLab = {}) {
  const recentCycles = Array.isArray(simulationLab.recentCycles) ? simulationLab.recentCycles : [];
  const day = easternDay(new Date());
  return {
    status: simulationLab.mode === "autonomous_local_stress_test" ? String(simulationLab.status || "waiting") : "waiting",
    cyclesToday: recentCycles.filter((cycle) => cycle.completedAt && easternDay(new Date(cycle.completedAt)) === day).length,
    totalCycles: Number(simulationLab.cycleCount || 0),
    lastCycleAt: simulationLab.lastCycleAt || null,
    candidatesTested: Number(simulationLab.candidatesTested || 0),
    strategyConfigurations: Number(simulationLab.strategyConfigurations || 0),
    scenarioPaths: Number(simulationLab.scenarioPaths || 0),
    strategyConfigurationsPerSecond: Number(simulationLab.strategyConfigurationsPerSecond || 0),
    scenarioPathsPerSecond: Number(simulationLab.scenarioPathsPerSecond || 0),
    durationMs: Number(simulationLab.durationMs || 0),
  };
}

function stockDailyIntelligenceSummary() {
  return {
    ...stockIntelligenceStore.dailySummary(),
    algorithmTests: stockAlgorithmTestSummary(readStockSimulationLab() || {}),
  };
}

function stockBackgroundWorkerStatus(scheduler = {}) {
  const active = scheduler.enabled === true && Boolean(scheduler.running || scheduler.handoffPending || scheduler.nextRunAt || scheduler.lastCompletedAt);
  return {
    status: active ? "running" : scheduler.enabled === false ? "blocked" : "starting",
    independentOfView: true,
    detail: active
      ? "Server worker is scheduled while Argentum is open; Stock Office view is not required."
      : "Waiting for the server worker to start.",
    lastCompletedAt: scheduler.lastCompletedAt || null,
    nextRunAt: scheduler.nextRunAt || null,
  };
}

function stockAgentStatus(state = {}) {
  const rawStatus = String(state.agent101?.status || state.agent?.status || "active").toLowerCase();
  const attention = /offline|error|failed|blocked|unavailable/.test(rawStatus);
  return {
    status: attention ? "attention" : "connected",
    detail: attention ? "Agent 101 needs attention." : "Agent 101 is available in supervised mode.",
  };
}

function stockOfficeSystemHealth({ snapshot, brokerControl, notificationStatus, scheduler, state }) {
  const health = stockIntelligenceStore.health({
    executionMode: snapshot.executionMode,
    executionBlocked: !brokerControl.liveReady,
    sourceHealth: snapshot.sourceHealth,
    providerHealth: snapshot.providerHealth,
    broker: { authenticationVerified: brokerControl.authenticationVerified, updatedAt: brokerControl.snapshotUpdatedAt },
    telegram: notificationStatus,
  });
  health.agent = stockAgentStatus(state);
  health.backgroundWorker = stockBackgroundWorkerStatus(scheduler);
  return health;
}

function stockOfficeBrokerSnapshot(state, permissions) {
  const snapshot = loadStockOfficeSnapshot({ rootDir: ROOT, state, runtimeRoot: STOCK_GURU_RUNTIME_ROOT });
  if (!(process.env.NODE_ENV === "test" && process.env.ARGENTUM_TEST_TRUST_BROKER_FIXTURE === "1")) {
    const officialBroker = robinhoodMcpClient.currentBrokerSnapshot();
    snapshot.broker = officialBroker;
    snapshot.positions = officialBroker.positions;
    snapshot.metrics = {
      ...snapshot.metrics,
      brokerPositions: officialBroker.positions.length,
      openOrders: officialBroker.openOrders.length,
      accountValue: officialBroker.accountValue,
      buyingPower: officialBroker.buyingPower,
    };
  }
  snapshot.executionMode = stockExecutionMode();
  snapshot.killSwitch = evaluateTradingHalt(snapshot, state);
  snapshot.permissions = permissions || snapshot.permissions;
  return snapshot;
}

function stockOfficeSnapshot(state, permissions, options = {}) {
  const snapshot = stockOfficeBrokerSnapshot(state, permissions);
  snapshot.intelligence = options.cachedIntelligence ? cachedStockIntelligenceState() : stockIntelligenceState();
  return snapshot;
}

function readStockShadowPortfolio(snapshot = {}) {
  try {
    const stat = fs.statSync(STOCK_SHADOW_FILE);
    if (!stat.isFile() || stat.size > 2_000_000) return normalizeShadowPortfolio({}, { snapshot });
    return normalizeShadowPortfolio(JSON.parse(fs.readFileSync(STOCK_SHADOW_FILE, "utf8")), { snapshot });
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn("Stock shadow portfolio read failed safely:", error.message);
    return normalizeShadowPortfolio({}, { snapshot });
  }
}

function writeStockShadowPortfolio(portfolio) {
  fs.mkdirSync(path.dirname(STOCK_SHADOW_FILE), { recursive: true });
  const temporaryPath = `${STOCK_SHADOW_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(portfolio, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, STOCK_SHADOW_FILE);
}

let stockShadowTimer = null;
let stockSimulationTimer = null;
let stockReadinessTimer = null;
let stockTelegramPollTimer = null;
let stockTelegramPollPromise = null;
let stockContinuousReviewPromise = null;
let stockReadinessBrokerSnapshotAt = "";
let stockSimulationLabState = null;
let stockFlowManagerSupervisor = null;

function stockReadinessIntervalMs() {
  return simulationInteger(process.env.STOCK_GURU_READINESS_INTERVAL_MS, 1_000, 1_000, 60_000);
}

async function runStockContinuousReview(result = {}) {
  if (stockContinuousReviewPromise) return stockContinuousReviewPromise;
  stockContinuousReviewPromise = processStockContinuousReview(result);
  try {
    return await stockContinuousReviewPromise;
  } finally {
    stockContinuousReviewPromise = null;
  }
}

async function runStockReadinessCycle() {
  if (robinhoodMcpClient.publicStatus().oauthAuthenticated) {
    const brokerSnapshot = await robinhoodMcpClient.refreshIfStale(5_000).catch((error) => {
      stockEventBus.publish("broker.disconnected", { status: "unavailable", error: error.message, reason: "Fast live-readiness refresh failed; execution remains closed." });
      return null;
    });
    const snapshotAt = brokerSnapshot?.updatedAt || "";
    if (snapshotAt && snapshotAt !== stockReadinessBrokerSnapshotAt) {
      await reconcileStockBrokerOrderLifecycle().catch((error) => console.warn("Fast Stock order reconciliation failed safely:", error.message));
      stockReadinessBrokerSnapshotAt = snapshotAt;
    }
  }
  return runStockContinuousReview({
    status: "success",
    completedAt: now(),
    trigger: "live_readiness",
  });
}

function simulationInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function stockSimulationOptions() {
  return {
    intervalMs: simulationInteger(process.env.STOCK_SIMULATION_INTERVAL_MS, 10_000, 1_000, 60_000),
    configurationsPerCandidate: simulationInteger(process.env.STOCK_SIMULATION_CONFIGURATIONS_PER_CANDIDATE, 64, 1, 256),
    pathsPerConfiguration: simulationInteger(process.env.STOCK_SIMULATION_PATHS_PER_CONFIGURATION, 32, 1, 128),
  };
}

function readStockSimulationLab() {
  if (stockSimulationLabState) return stockSimulationLabState;
  try {
    const stat = fs.statSync(STOCK_SIMULATION_FILE);
    if (!stat.isFile() || stat.size > 5_000_000) return null;
    const persisted = JSON.parse(fs.readFileSync(STOCK_SIMULATION_FILE, "utf8"));
    if (persisted?.mode !== "autonomous_local_stress_test" || !Array.isArray(persisted.results)) return null;
    stockSimulationLabState = persisted;
    return stockSimulationLabState;
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn("Stock simulation state read failed safely:", error.message);
    return null;
  }
}

function writeStockSimulationLab(simulationLab) {
  fs.mkdirSync(path.dirname(STOCK_SIMULATION_FILE), { recursive: true });
  const temporaryPath = `${STOCK_SIMULATION_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(simulationLab, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, STOCK_SIMULATION_FILE);
}

function refreshStockSimulationLab(options = {}) {
  const state = options.state || readState();
  const snapshot = stockOfficeBrokerSnapshot(state);
  snapshot.intelligence = stockDecisionIntelligenceState();
  const settings = stockSimulationOptions();
  const previous = readStockSimulationLab() || {};
  const ageMs = previous.lastCycleAt ? Date.now() - new Date(previous.lastCycleAt).getTime() : Number.POSITIVE_INFINITY;
  if (!options.force && Number.isFinite(ageMs) && ageMs < settings.intervalMs - 50) return previous;
  const plan = options.plan || buildCopyPortfolioPlan(snapshot);
  const updated = {
    ...runAutonomousSimulationCycle(plan, previous, settings),
    persistedAt: previous.persistedAt || null,
  };
  stockSimulationLabState = updated;
  const lastPersistedAt = previous.persistedAt ? new Date(previous.persistedAt).getTime() : 0;
  const shouldPersist = options.persist === true
    || !lastPersistedAt
    || Date.now() - lastPersistedAt >= 30_000
    || previous.sourceFingerprint !== updated.sourceFingerprint;
  if (shouldPersist) {
    stockSimulationLabState = { ...updated, persistedAt: now() };
    writeStockSimulationLab(stockSimulationLabState);
  }
  return stockSimulationLabState;
}

function refreshStockShadowPortfolio(options = {}) {
  const state = options.state || readState();
  const snapshot = stockOfficeSnapshot(state);
  const existing = readStockShadowPortfolio(snapshot);
  const ageMs = existing.lastCycleAt ? Date.now() - new Date(existing.lastCycleAt).getTime() : Number.POSITIVE_INFINITY;
  if (!options.force && Number.isFinite(ageMs) && ageMs < 55_000) return existing;
  const updated = runShadowPortfolioCycle(existing, snapshot);
  writeStockShadowPortfolio(updated);
  return updated;
}

function withPaperProposalReadiness(plan = {}, shadowPortfolio = {}, snapshot = {}) {
  const proposals = (Array.isArray(plan.proposals) ? plan.proposals : []).map((proposal) => ({
    ...proposal,
    paperTest: paperProposalEligibility(shadowPortfolio, snapshot, proposal),
  }));
  return {
    ...plan,
    proposals,
    summary: {
      ...(plan.summary || {}),
      paperReady: proposals.filter((proposal) => proposal.paperTest?.eligible).length,
    },
  };
}

function collectStockFlowManagerInput() {
  const state = readState();
  const snapshot = stockOfficeSnapshot(state, undefined, { cachedIntelligence: true });
  const intelligenceScheduler = stockIntelligenceScheduler.getStatus();
  const shadowPortfolio = refreshStockShadowPortfolio({ state });
  const portfolioPlan = withPaperProposalReadiness(buildContinuousReviewView({
    plan: buildCopyPortfolioPlan(snapshot),
    review: normalizeStockOfficeState(state.stockOffice).continuousReview,
    scheduler: intelligenceScheduler,
    tradeDrafts: snapshot.tradeDrafts || [],
  }), shadowPortfolio, snapshot);
  portfolioPlan.decisions = normalizeStockOfficeState(state.stockOffice).proposalDecisions;
  return {
    portfolioPlan,
    simulationLab: readStockSimulationLab() || refreshStockSimulationLab({ state, plan: portfolioPlan, force: true }),
    shadowPortfolio,
    intelligenceScheduler,
    recordCount: Number(snapshot.metrics?.trackedRecords || 0),
    opportunityCount: Array.isArray(snapshot.intelligence?.opportunities) ? snapshot.intelligence.opportunities.length : 0,
  };
}

function getStockFlowManagerSupervisor() {
  if (!stockFlowManagerSupervisor) {
    stockFlowManagerSupervisor = createStockFlowManagerSupervisor({
      dataDir: DATA_DIR,
      collect: collectStockFlowManagerInput,
      intervalMs: 15_000,
    });
  }
  return stockFlowManagerSupervisor;
}

function startStockFlowManagers() {
  if (process.env.NODE_ENV === "test") return null;
  return getStockFlowManagerSupervisor().start();
}

function startStockShadowScheduler() {
  if (process.env.NODE_ENV === "test" || stockShadowTimer) return stockShadowTimer;
  try {
    refreshStockShadowPortfolio({ force: true });
  } catch (error) {
    console.warn("Stock shadow portfolio startup cycle failed safely:", error.message);
  }
  const shadowTimer = setInterval(() => {
    try {
      refreshStockShadowPortfolio({ force: true });
    } catch (error) {
      console.warn("Stock shadow portfolio cycle failed safely:", error.message);
    }
  }, 60_000);
  shadowTimer.unref();
  stockShadowTimer = shadowTimer;
  return stockShadowTimer;
}

function startStockSimulationScheduler() {
  if (process.env.NODE_ENV === "test" || stockSimulationTimer) return stockSimulationTimer;
  const settings = stockSimulationOptions();
  try {
    refreshStockSimulationLab({ force: true, persist: true });
  } catch (error) {
    console.warn("Stock autonomous simulation startup failed safely:", error.message);
  }
  const simulationTimer = setInterval(() => {
    try {
      refreshStockSimulationLab({ force: true });
    } catch (error) {
      console.warn("Stock autonomous simulation cycle failed safely:", error.message);
    }
  }, settings.intervalMs);
  simulationTimer.unref();
  stockSimulationTimer = simulationTimer;
  return stockSimulationTimer;
}

function startStockReadinessScheduler() {
  if (process.env.NODE_ENV === "test" || stockReadinessTimer) return stockReadinessTimer;
  const intervalMs = stockReadinessIntervalMs();
  Promise.resolve().then(runStockReadinessCycle).catch((error) => console.warn("Fast Stock readiness startup failed safely:", error.message));
  const readinessTimer = setInterval(() => {
    runStockReadinessCycle().catch((error) => console.warn("Fast Stock readiness cycle failed safely:", error.message));
  }, intervalMs);
  readinessTimer.unref();
  stockReadinessTimer = readinessTimer;
  return stockReadinessTimer;
}

function startStockTelegramPolling() {
  if (process.env.NODE_ENV === "test" || APP_MODE !== "local" || stockTelegramPollTimer) return stockTelegramPollTimer;
  const intervalMs = simulationInteger(process.env.STOCK_GURU_TELEGRAM_POLL_INTERVAL_MS, 2_000, 1_000, 30_000);
  const poll = async () => {
    if (stockTelegramPollPromise) return stockTelegramPollPromise;
    stockTelegramPollPromise = (async () => {
      const deliverySync = await syncPendingStockOrderHumanGateToTelegram()
        .catch((error) => ({ checked: 0, sent: 0, state: "failed", reason: redactSensitiveText(error.message).slice(0, 300) }));
      const updates = await stockTelegramNotifier.pollUpdates({ approvals: readState().approvals || [] });
      return { deliverySync, updates };
    })();
    try {
      return await stockTelegramPollPromise;
    } finally {
      stockTelegramPollPromise = null;
    }
  };
  Promise.resolve().then(poll).catch((error) => console.warn("Telegram local polling failed safely:", error.message));
  stockTelegramPollTimer = setInterval(() => {
    poll().catch((error) => console.warn("Telegram local polling failed safely:", error.message));
  }, intervalMs);
  stockTelegramPollTimer.unref();
  return stockTelegramPollTimer;
}

function stockOfficeErrorResponse(error) {
  const status = error.status || 500;
  return {
    status,
    payload: {
      error: status >= 500 ? "Stock Office could not complete that request safely." : error.message,
    },
  };
}

function stockOfficeQueryOptions(url) {
  return {
    q: url.searchParams.get("q") || "",
    status: url.searchParams.get("status") || "all",
    sort: url.searchParams.get("sort") || "score_desc",
    page: Number(url.searchParams.get("page") || 1),
    pageSize: Number(url.searchParams.get("pageSize") || 20),
  };
}

function createStockOfficeSyncRun(snapshot, refresh = null) {
  const warnings = [
    ...snapshot.alerts.filter((alert) => alert.level !== "error").map((alert) => `${alert.title}: ${alert.body}`),
    ...snapshot.sources.filter((source) => source.status === "stale").map((source) => `${source.label}: ${source.summary}`),
  ].slice(0, 8);
  const errors = snapshot.sources
    .filter((source) => source.status === "error")
    .map((source) => `${source.label}: ${source.safeError || source.summary}`)
    .slice(0, 8);
  return {
    id: `stock-sync-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    mode: "evaluator_and_mirror_refresh",
    status: errors.length || ["partial", "failed"].includes(refresh?.status) ? "partial" : "success",
    recordsImported: snapshot.records.length,
    changedRecords: 0,
    warnings,
    errors,
    refreshStatus: refresh?.status || "rescan_only",
    refreshMessage: refresh?.message || "Local reports rescanned.",
    liveOrdersPlaced: 0,
    startedAt: refresh?.startedAt || now(),
    completedAt: now(),
  };
}

function requireCurrentPassword(req, payload, store, user) {
  const currentPassword = String(payload.currentPassword || "");
  if (!verifyPassword(currentPassword, user)) {
    throw guardedError("Current password is required for access changes.", 403);
  }
}

function activeUserCount(store) {
  return (store.users || []).filter((user) => !user.disabled).length;
}

function createInitialAccessUser(payload) {
  const existingStore = readAuthStore();
  if (activeUserCount(existingStore) > 0) {
    throw guardedError("Initial setup is already complete.", 409);
  }
  const username = validateUsername(payload.username);
  const password = validateNewPassword(payload.password);
  const user = createUserRecord(username, password, { temporary: false });
  const store = {
    ...emptyAuthStore(),
    users: [user],
  };
  writeAuthStore(store);
  return user;
}

function changeCurrentPassword(req, payload) {
  const access = currentAccessUser(req);
  if (!access?.user) throw guardedError("Session is no longer valid.", 401);
  requireCurrentPassword(req, payload, access.store, access.user);
  const nextPassword = validateNewPassword(payload.newPassword);
  Object.assign(access.user, hashPassword(nextPassword), {
    temporary: false,
    updatedAt: now(),
  });
  writeAuthStore(access.store);
  return sanitizedAccessState(access.user);
}

function createAccessUser(req, payload) {
  const access = currentAccessUser(req);
  if (!access?.user) throw guardedError("Session is no longer valid.", 401);
  requireCurrentPassword(req, payload, access.store, access.user);
  const username = validateUsername(payload.username);
  const password = validateNewPassword(payload.password);
  if (findAuthUser(access.store, username)) {
    throw guardedError("That username already exists.", 409);
  }
  const user = createUserRecord(username, password, { temporary: false });
  access.store.users.push(user);
  writeAuthStore(access.store);
  return sanitizedAccessState(access.user);
}

function deleteAccessUser(req, userIdToDelete, payload) {
  const access = currentAccessUser(req);
  if (!access?.user) throw guardedError("Session is no longer valid.", 401);
  requireCurrentPassword(req, payload, access.store, access.user);
  const user = findAuthUserById(access.store, userIdToDelete);
  if (!user) throw guardedError("User not found.", 404);
  if (user.id === access.user.id) {
    throw guardedError("You cannot delete the account you are currently using.", 409);
  }
  if (activeUserCount(access.store) <= 1) {
    throw guardedError("Create another admin login before deleting this one.", 409);
  }
  access.store.users = access.store.users.filter((item) => item.id !== user.id);
  writeAuthStore(access.store);
  return sanitizedAccessState(access.user);
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/print-shop/workspace") {
    try {
      const state = readState();
      sendJson(res, 200, printShopWorkspace.publicSnapshot(PRINT_SHOP_DATA_ROOT, {
        approvals: state.approvals || [],
        searchProvider: configuredPrintShopSearchProvider(),
      }));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/print-shop/candidates") {
    try {
      const payload = await readBody(req);
      const candidate = printShopWorkspace.analyzeCandidate(PRINT_SHOP_DATA_ROOT, payload);
      sendJson(res, 201, { candidate });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const printShopCandidateUpdateMatch = url.pathname.match(/^\/api\/print-shop\/candidates\/([^/]+)$/);
  if (req.method === "PATCH" && printShopCandidateUpdateMatch) {
    try {
      const payload = await readBody(req);
      const candidate = printShopWorkspace.updateCandidate(
        PRINT_SHOP_DATA_ROOT,
        decodeURIComponent(printShopCandidateUpdateMatch[1]),
        payload,
      );
      sendJson(res, 200, { candidate });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const printShopGenerateMatch = url.pathname.match(/^\/api\/print-shop\/candidates\/([^/]+)\/generate$/);
  if (req.method === "POST" && printShopGenerateMatch) {
    try {
      const payload = await readBody(req);
      const result = printShopWorkspace.generateCandidateModel(
        PRINT_SHOP_DATA_ROOT,
        decodeURIComponent(printShopGenerateMatch[1]),
        payload,
      );
      sendJson(res, 201, result);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/print-shop/discovery-runs") {
    try {
      const payload = await readBody(req);
      const provider = configuredPrintShopSearchProvider();
      if (!provider) {
        throw guardedError("Product discovery is not connected. Configure OpenAI Live, BRAVE_API_KEY, or SERP_API_KEY server-side before requesting approval.", 409);
      }
      if (provider === "openai_web_search") {
        const budget = aiUsageBudgetStatus(readAiProviderConfig());
        if (budget.blocked) throw guardedError("OpenAI web research is blocked by the configured monthly AI budget.", 402);
      }
      const plan = printShopWorkspace.buildDiscoveryPlan({
        laneId: payload.laneId,
        geography: payload.geography || "United States",
      });
      const runId = `print-discovery-${crypto.randomUUID()}`;
      const model = printShopSearchProviderModel(provider);
      const scope = printShopDiscoveryScope({ runId, plan, provider, model });
      const gate = createHumanGateRequest({
        title: `Approve product-opportunity discovery: ${plan.brief.laneName}`,
        actionType: "agent101_product_discovery",
        officeId: "print-shop-office",
        workflowId: "workflow-print-shop",
        linkedId: `print-shop-discovery:${provider}:${model || "direct"}:${plan.planHash}`,
        riskLevel: "medium",
        details: scope,
        evidence: `Agent 101 prepared ${plan.queries.length} bounded research angles for ${plan.brief.laneName}. This would disclose them to ${provider} and may consume paid API usage. No external call has run.`,
        action: "Approve one bounded opportunity-discovery sweep. This does not authorize buying, printing, publishing, pricing, customer contact, or use of a third-party design.",
        exactScope: provider === "openai_web_search"
          ? `One OpenAI Responses request using at most ${scope.maximumToolCalls} web-search calls, at most ${scope.maximumOpportunities} source-linked research leads, and the exact saved plan hash ${plan.planHash}.`
          : `${scope.maximumProviderRequests} exact ${provider} search calls with at most ${scope.maximumResultsPerCall} observations per call and the saved plan hash ${plan.planHash}.`,
        expectedPostcondition: "Cited source observations and source-linked product hypotheses are saved. Demand, price, competition, fit, cost, safety, and commercial rights remain unmeasured.",
        rollbackPlan: "Do not call the provider on any scope mismatch. The local discovery record can be dismissed without changing an external account.",
      });
      const run = printShopWorkspace.recordDiscoveryRun(PRINT_SHOP_DATA_ROOT, {
        id: runId,
        plan,
        provider,
        providerModel: model,
        approvalId: gate.approval.id,
        scope,
      });
      sendJson(res, 202, { run, approval: gate.approval, requiresApproval: true });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const printShopDiscoveryRunMatch = url.pathname.match(/^\/api\/print-shop\/discovery-runs\/([^/]+)\/run$/);
  if (req.method === "POST" && printShopDiscoveryRunMatch) {
    let consumed = false;
    let run = null;
    try {
      const payload = await readBody(req);
      const runId = decodeURIComponent(printShopDiscoveryRunMatch[1]);
      run = printShopWorkspace.loadWorkspace(PRINT_SHOP_DATA_ROOT).discoveryRuns.find((item) => item.id === runId);
      if (!run) throw guardedError("Print Shop discovery run not found.", 404);
      if (["running", "complete", "partial", "failed", "interrupted"].includes(run.status)) {
        throw guardedError("This opportunity-discovery run is already active or terminal.", 409);
      }
      const provider = configuredPrintShopSearchProvider();
      const model = printShopSearchProviderModel(provider);
      if (!provider || provider !== run.provider || (run.providerModel || null) !== (model || null)) {
        throw guardedError("The approved discovery provider or model is no longer configured with the same scope.", 409);
      }
      consumePrintShopDiscoveryApproval({
        approvalId: String(payload.approvalId || "").trim(),
        run,
        provider,
        model,
      });
      consumed = true;
      printShopWorkspace.startDiscoveryRun(PRINT_SHOP_DATA_ROOT, run.id);
      const execution = await fetchPrintShopDiscoveryResults({ provider, plan: run.plan, scope: run.scope });
      const completedRun = printShopWorkspace.completeDiscoveryRun(PRINT_SHOP_DATA_ROOT, run.id, {
        provider,
        ...execution,
      });
      sendJson(res, 200, {
        run: completedRun,
        sourceCount: completedRun.sourceObservationIds.length,
        opportunityCount: completedRun.opportunityIds.length,
      });
    } catch (error) {
      if (consumed && run) {
        try {
          printShopWorkspace.failDiscoveryRun(PRINT_SHOP_DATA_ROOT, run.id, error, { callsCompleted: 1 });
        } catch {}
      }
      sendJson(res, error.status || (consumed ? 502 : 500), { error: error.message });
    }
    return;
  }

  const printShopOpportunityMatch = url.pathname.match(/^\/api\/print-shop\/opportunities\/([^/]+)$/);
  if (req.method === "PATCH" && printShopOpportunityMatch) {
    try {
      const payload = await readBody(req);
      const opportunity = printShopWorkspace.updateOpportunity(
        PRINT_SHOP_DATA_ROOT,
        decodeURIComponent(printShopOpportunityMatch[1]),
        payload,
      );
      sendJson(res, 200, { opportunity });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const printShopOpportunityPromoteMatch = url.pathname.match(/^\/api\/print-shop\/opportunities\/([^/]+)\/promote$/);
  if (req.method === "POST" && printShopOpportunityPromoteMatch) {
    try {
      const result = printShopWorkspace.promoteOpportunity(
        PRINT_SHOP_DATA_ROOT,
        decodeURIComponent(printShopOpportunityPromoteMatch[1]),
      );
      sendJson(res, 201, result);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/print-shop/research-requests") {
    try {
      const payload = await readBody(req);
      const query = String(payload.query || "").trim().replace(/\s+/g, " ").slice(0, 240);
      if (query.length < 3) throw guardedError("Enter a product research query.", 400);
      const geography = String(payload.geography || "United States").trim().slice(0, 80);
      const provider = configuredPrintShopSearchProvider();
      if (!provider) {
        throw guardedError("Product search is not connected. Configure BRAVE_API_KEY or SERP_API_KEY server-side before requesting approval.", 409);
      }
      const queryHash = crypto.createHash("sha256").update(`${query.toLowerCase()}|${geography.toLowerCase()}|${provider}`).digest("hex");
      const details = {
        officeId: "print-shop-office",
        provider,
        queryHash,
        geography,
        maximumCalls: 1,
        maximumResults: 8,
      };
      const gate = createHumanGateRequest({
        title: `Approve product research: ${query}`,
        actionType: "agent101_web_search",
        officeId: "print-shop-office",
        workflowId: "workflow-print-shop",
        linkedId: `print-shop-research:${queryHash}`,
        riskLevel: "medium",
        details,
        evidence: "This search would disclose the recorded query to an external AI/search provider and may consume paid API usage. No provider call has run.",
        action: "Approve one bounded external product-research call. This does not authorize buying, publishing, pricing, customer contact, or use of any third-party design license.",
        exactScope: `One external research call for query \"${query}\" in ${geography}, returning at most 8 cited observations.`,
        expectedPostcondition: "A source-linked research record is saved; unknown demand and commercial rights remain unknown unless a source directly supports them.",
        rollbackPlan: "Do not call the provider on any scope mismatch. Research records can be archived locally without changing any external account.",
      });
      const request = printShopWorkspace.recordResearchRequest(PRINT_SHOP_DATA_ROOT, {
        query,
        geography,
        provider,
        queryHash,
        approvalId: gate.approval.id,
      });
      sendJson(res, 202, { request, approval: gate.approval, requiresApproval: true });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const printShopResearchRunMatch = url.pathname.match(/^\/api\/print-shop\/research-requests\/([^/]+)\/run$/);
  if (req.method === "POST" && printShopResearchRunMatch) {
    let consumed = false;
    let request = null;
    try {
      const payload = await readBody(req);
      const requestId = decodeURIComponent(printShopResearchRunMatch[1]);
      request = printShopWorkspace.loadWorkspace(PRINT_SHOP_DATA_ROOT).researchRequests.find((item) => item.id === requestId);
      if (!request) throw guardedError("Print Shop research request not found.", 404);
      if (["complete", "failed"].includes(request.status)) throw guardedError("This research request is already terminal.", 409);
      const approvalId = String(payload.approvalId || "").trim();
      const provider = configuredPrintShopSearchProvider();
      if (!provider || provider !== request.provider) {
        throw guardedError("The approved search provider is no longer configured with the same scope.", 409);
      }
      consumePrintShopResearchApproval({ approvalId, request, provider });
      consumed = true;
      const results = await fetchPrintShopResearchResults({
        provider,
        query: request.query,
        geography: request.geography,
      });
      const completedRequest = printShopWorkspace.completeResearchRequest(PRINT_SHOP_DATA_ROOT, request.id, { provider, results });
      sendJson(res, 200, { request: completedRequest, resultCount: completedRequest.sources.length });
    } catch (error) {
      if (consumed && request) {
        try {
          printShopWorkspace.failResearchRequest(PRINT_SHOP_DATA_ROOT, request.id, error);
        } catch {}
      }
      sendJson(res, error.status || (consumed ? 502 : 500), { error: error.message });
    }
    return;
  }

  const printShopArtifactMatch = url.pathname.match(/^\/api\/print-shop\/artifacts\/([^/]+)\/download$/);
  if (req.method === "GET" && printShopArtifactMatch) {
    try {
      const { artifact, absolutePath } = printShopWorkspace.artifactForDownload(
        PRINT_SHOP_DATA_ROOT,
        decodeURIComponent(printShopArtifactMatch[1]),
      );
      const fileName = `${String(artifact.name || "argentum-part").replace(/[^A-Za-z0-9._-]+/g, "-")}.stl`;
      res.writeHead(200, {
        ...securityHeaders(req),
        "content-type": "model/stl",
        "content-disposition": `attachment; filename=\"${fileName}\"`,
        "content-length": fs.statSync(absolutePath).size,
        "cache-control": "private, no-store",
        "x-content-sha256": artifact.sha256,
      });
      fs.createReadStream(absolutePath).pipe(res);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/system/status") {
    sendJson(res, 200, currentSystemStatus());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/display/state") {
    try {
      requireAdminAccess(req);
      const state = readState();
      sendJson(res, 200, {
        display: publicDisplayState(state),
        snapshot: await buildArgentumDisplaySnapshot(state),
      });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/display/events") {
    try {
      await handleDisplayEvents(req, res);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/display/navigate") {
    try {
      requireAdminAccess(req);
      const payload = await readBody(req);
      const display = navigateDisplay(payload, "api");
      sendJson(res, 200, { ok: true, display });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/hardware/display") {
    try {
      const state = readState();
      const display = normalizeDisplayState(state.display || {});
      const deviceId = displayDeviceId(url.searchParams.get("deviceId") || "");
      const trusted = deviceId ? display.trustedControllers.some((controller) => controller.deviceId === deviceId) : false;
      sendJson(res, 200, { display: publicDisplayState(state), trusted, pairingRequired: Boolean(deviceId && !trusted) });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/hardware/display/pairing/request") {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, { ok: true, display: createDisplayPairingRequest(payload) });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/hardware/display/pairing/accept") {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, { ok: true, action: "accept_pairing", ...acceptDisplayPairing(payload) });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/hardware/display/heartbeat") {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, { ok: true, display: updateDisplayHeartbeat(payload, "hardware") });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && (url.pathname === "/api/hardware/display" || url.pathname === "/api/hardware/display/command")) {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, { ok: true, ...handleHardwareDisplayCommand(payload) });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/clipping-office/overview") {
    sendJson(res, 200, buildClipOfficeDashboardSnapshot());
    return;
  }

  if (req.method === "GET" && (url.pathname === "/api/local/status" || url.pathname === "/api/local/runtime")) {
    try {
      requireAdminAccess(req);
      sendJson(res, 200, {
        ...localRuntimeStatusPayload(),
        secretStorage: {
          keychainAvailable: secureSecrets.canUseKeychain(),
          preferred: secureSecrets.canUseKeychain() ? "Mac Keychain" : "Encrypted local file",
        },
        controls: {
          adminRoutesPublic: false,
          authRequired: true,
          humanGateRequired: true,
          fileWorkspaceRequiresPermission: true,
          autoLock: "Optional via session timeout",
        },
      });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/local/audit") {
    try {
      requireAdminAccess(req);
      requireLocalMode();
      sendJson(res, 200, { events: localDatabase.listLocalAudit(DATA_DIR, url.searchParams.get("limit") || 100) });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/local/jobs") {
    try {
      requireAdminAccess(req);
      requireLocalMode();
      sendJson(res, 200, { jobs: localDatabase.listAgentJobs(DATA_DIR, url.searchParams.get("limit") || 100) });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/local/jobs") {
    try {
      requireAdminAccess(req);
      requireLocalMode();
      const payload = await readBody(req);
      sendJson(res, 201, createLocalAgentJob(payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/local/jobs/run-next") {
    try {
      requireAdminAccess(req);
      requireLocalMode();
      sendJson(res, 200, runNextLocalAgentJob());
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && (url.pathname === "/api/local/files/workspaces" || url.pathname === "/api/local/file-workspaces")) {
    try {
      requireAdminAccess(req);
      requireLocalMode();
      sendJson(res, 200, { workspaces: localDatabase.listFileWorkspaces(DATA_DIR) });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && (url.pathname === "/api/local/files/workspaces" || url.pathname === "/api/local/file-workspaces")) {
    try {
      requireAdminAccess(req);
      requireLocalMode();
      const payload = await readBody(req);
      sendJson(res, 201, { workspace: addLocalFileWorkspace(payload), workspaces: localDatabase.listFileWorkspaces(DATA_DIR) });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const localWorkspaceMatch = url.pathname.match(/^\/api\/local\/file-workspaces\/([^/]+)$/);
  if (req.method === "DELETE" && localWorkspaceMatch) {
    try {
      requireAdminAccess(req);
      requireLocalMode();
      const workspaceId = decodeURIComponent(localWorkspaceMatch[1]);
      const workspace = localDatabase.getFileWorkspace(DATA_DIR, workspaceId);
      if (workspace) {
        localDatabase.logFileAccess(DATA_DIR, {
          workspaceId,
          action: "revoke_workspace",
          filePath: workspace.folderPath,
          allowed: true,
          reason: "Operator removed folder workspace.",
        });
      }
      sendJson(res, 200, { ...localDatabase.removeFileWorkspace(DATA_DIR, workspaceId), workspaces: localDatabase.listFileWorkspaces(DATA_DIR) });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/local/secrets") {
    try {
      requireAdminAccess(req);
      requireLocalMode();
      const payload = await readBody(req);
      const provider = String(payload.provider || payload.name || "").trim().toLowerCase();
      const value = String(payload.value || payload.apiKey || "").trim();
      if (!provider || value.length < 8) throw guardedError("Choose a secret and enter a valid value.", 400);
      const saved = secureSecrets.setSecret({ dataDir: DATA_DIR, provider, value, preferKeychain: true });
      localDatabase.upsertSecretMetadata(DATA_DIR, provider, saved.storage, true);
      if (["openai", "anthropic"].includes(provider)) {
        const config = readAiProviderConfig();
        config.keys = config.keys || {};
        config.keys[provider] = {
          storage: saved.storage,
          configured: true,
          updatedAt: saved.updatedAt,
        };
        writeAiProviderConfig(config);
      }
      if (isLocalConnectorSecretProvider(provider)) reloadClippingOfficeModuleFromLocalSecrets();
      const state = readState();
      audit(state, "Local secret saved", `${provider} saved to ${secureSecrets.publicStorageLabel(saved.storage)}.`);
      writeState(state);
      sendJson(res, 200, {
        provider,
        configured: true,
        storage: secureSecrets.publicStorageLabel(saved.storage),
        updatedAt: saved.updatedAt,
        clippingOfficeReloaded: isLocalConnectorSecretProvider(provider),
      });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "DELETE" && url.pathname === "/api/local/secrets") {
    try {
      requireAdminAccess(req);
      requireLocalMode();
      const payload = await readBody(req);
      const provider = String(payload.provider || payload.name || "").trim().toLowerCase();
      if (!provider) throw guardedError("Choose a secret to remove.", 400);
      const removed = secureSecrets.deleteSecret({ dataDir: DATA_DIR, provider });
      localDatabase.upsertSecretMetadata(DATA_DIR, provider, removed.storage, false);
      if (["openai", "anthropic"].includes(provider)) {
        const config = readAiProviderConfig();
        if (config.keys) delete config.keys[provider];
        writeAiProviderConfig(config);
      }
      if (isLocalConnectorSecretProvider(provider)) reloadClippingOfficeModuleFromLocalSecrets();
      const state = readState();
      audit(state, "Local secret removed", `${provider} removed from local secure storage.`);
      writeState(state);
      sendJson(res, 200, {
        provider,
        configured: false,
        storage: secureSecrets.publicStorageLabel(removed.storage),
        updatedAt: removed.updatedAt,
        clippingOfficeReloaded: isLocalConnectorSecretProvider(provider),
      });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (url.pathname.startsWith("/api/brain")) {
    try {
      requireAdminAccess(req);
      requireLocalMode();
      const status = obsidianStatusPayload();
      const vaultPath = status.vaultPath || configuredObsidianVaultPath();
      const dbPath = localDatabase.databasePath(DATA_DIR);

      if (req.method === "GET" && url.pathname === "/api/brain/startup-status") {
        sendJson(res, 200, brainStartupStatusPayload());
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/brain/health") {
        const context = status.initialized || status.connected
          ? agentContextBuilder.buildAgentContext({ vaultPath, state: readState(), agentId: "agent.1010", officeId: "office.clipping", projectId: "project.clip_office_production", includeTrace: false })
          : null;
        sendJson(res, 200, {
          startup: brainStartupStatusPayload(),
          vault: status,
          database: { path: dbPath, available: Boolean(localDatabaseStatus?.available) },
          conflicts: status.initialized || status.connected ? brainVerification.detectConflicts(vaultPath) : [],
          context: context ? { contextHash: context.contextHash, tokenEstimate: context.tokenEstimate, excludedCount: context.excluded.length, citationCount: context.citations.length } : null,
          backup: { latest: brainBackup.latestBackup() || "" },
          gateway: { bridge: gatewayAdapter.bridgeConfig(process.env), credentials: gatewayAdapter.listGatewayCredentials(DATA_DIR).filter((credential) => credential.status === "active").length },
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/brain/verify") {
        const report = brainVerification.verifyBrain({
          vaultPath,
          contextBuilder: (payload) => agentContextBuilder.buildAgentContext({ ...payload, vaultPath, state: readState() }),
          skipBackup: true,
        });
        const state = readState();
        audit(state, "Brain verification run", `Status ${report.status}, critical ${report.criticalCount}.`);
        writeState(state);
        sendJson(res, report.criticalCount ? 409 : 200, { report });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/brain/backup") {
        const manifest = brainBackup.createBrainBackup({ vaultPath, databasePath: dbPath, appConfigDir: DATA_DIR });
        const state = readState();
        audit(state, "Brain backup created", `${manifest.backupId} verified=${manifest.verified}`);
        writeState(state);
        sendJson(res, manifest.verified ? 200 : 409, { backup: manifest });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/brain/backup/verify") {
        const payload = await readBody(req);
        const backupPath = payload.backupPath || brainBackup.latestBackup();
        sendJson(res, 200, { verification: brainBackup.verifyBrainBackup(backupPath) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/brain/restore/dry-run") {
        const payload = await readBody(req);
        const result = brainBackup.restoreDryRun({ backupPath: payload.backupPath || brainBackup.latestBackup(), vaultPath });
        const state = readState();
        audit(state, "Brain restore dry-run", result.backupPath);
        writeState(state);
        sendJson(res, 200, { restore: result });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/brain/restore") {
        const payload = await readBody(req);
        const result = brainBackup.restoreBackup({ backupPath: payload.backupPath, vaultPath, databasePath: dbPath, appConfigDir: DATA_DIR, confirmation: payload.confirmation });
        const state = readState();
        audit(state, "Brain restored", `${result.backupId} restored to ${result.vaultPath}.`);
        writeState(state);
        sendJson(res, 200, { restore: result });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/brain/context/agent101") {
        const payload = await readBody(req);
        const context = agentContextBuilder.buildAgentContext({ ...payload, vaultPath, state: readState(), agentId: payload.agentId || "agent.1010" });
        const state = readState();
        audit(state, "Agent 1010 context built", `${context.contextHash} with ${context.citations.length} citation(s).`);
        writeState(state);
        sendJson(res, 200, { context });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/brain/conflicts") {
        sendJson(res, 200, { conflicts: brainVerification.detectConflicts(vaultPath) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/brain/decisions") {
        const payload = await readBody(req);
        const decision = obsidianVault.createDecision(vaultPath, payload);
        const state = readState();
        audit(state, "Brain decision created", `${decision.id}: ${decision.path}`);
        writeState(state);
        sendJson(res, 201, decision);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/brain/memory/proposals") {
        const payload = await readBody(req);
        const note = obsidianVault.createMemoryProposal(vaultPath, payload);
        const state = readState();
        audit(state, "Brain memory proposal created", note.path);
        writeState(state);
        sendJson(res, 201, { note });
        return;
      }

      const correctionMatch = url.pathname.match(/^\/api\/brain\/memory\/([^/]+)\/correct$/);
      if (req.method === "POST" && correctionMatch) {
        const payload = await readBody(req);
        const note = obsidianVault.createMemoryCorrection(vaultPath, decodeURIComponent(correctionMatch[1]), payload);
        const state = readState();
        audit(state, "Brain memory correction proposed", note.path);
        writeState(state);
        sendJson(res, 201, { note });
        return;
      }

      const approveCorrectionMatch = url.pathname.match(/^\/api\/brain\/memory-corrections\/([^/]+)\/approve$/);
      if (req.method === "POST" && approveCorrectionMatch) {
        const payload = await readBody(req);
        const note = obsidianVault.approveMemoryCorrection(vaultPath, decodeURIComponent(approveCorrectionMatch[1]), payload.oldRef || payload.oldId || payload.supersedes);
        const state = readState();
        audit(state, "Brain memory correction approved", note.path);
        writeState(state);
        sendJson(res, 200, { note });
        return;
      }

      const renameMatch = url.pathname.match(/^\/api\/brain\/entities\/([^/]+)\/rename$/);
      if (req.method === "POST" && renameMatch) {
        const payload = await readBody(req);
        const note = obsidianVault.renameCanonicalEntity(vaultPath, decodeURIComponent(renameMatch[1]), payload.title);
        const state = readState();
        audit(state, "Brain canonical entity renamed", `${renameMatch[1]} -> ${note.path}`);
        writeState(state);
        sendJson(res, 200, { note });
        return;
      }

      const archiveMatch = url.pathname.match(/^\/api\/brain\/notes\/(.+)\/archive$/);
      if (req.method === "POST" && archiveMatch) {
        const payload = await readBody(req);
        const note = obsidianVault.archiveNote(vaultPath, decodeURIComponent(archiveMatch[1]), payload.reason || "");
        const state = readState();
        audit(state, "Brain note archived", note.path);
        writeState(state);
        sendJson(res, 200, { note });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/brain/gateway/credentials") {
        const payload = await readBody(req);
        const credential = gatewayAdapter.createGatewayCredential(DATA_DIR, payload);
        const state = readState();
        audit(state, "Gateway credential created", credential.credential.id);
        writeState(state);
        sendJson(res, 201, credential);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/brain/gateway/credentials") {
        sendJson(res, 200, { credentials: gatewayAdapter.listGatewayCredentials(DATA_DIR) });
        return;
      }

      const rotateCredentialMatch = url.pathname.match(/^\/api\/brain\/gateway\/credentials\/([^/]+)\/rotate$/);
      if (req.method === "POST" && rotateCredentialMatch) {
        const result = gatewayAdapter.rotateGatewayCredential(DATA_DIR, decodeURIComponent(rotateCredentialMatch[1]));
        const state = readState();
        audit(state, "Gateway credential rotated", result.credential.id);
        writeState(state);
        sendJson(res, 200, result);
        return;
      }

      const revokeCredentialMatch = url.pathname.match(/^\/api\/brain\/gateway\/credentials\/([^/]+)\/revoke$/);
      if (req.method === "POST" && revokeCredentialMatch) {
        const credential = gatewayAdapter.revokeGatewayCredential(DATA_DIR, decodeURIComponent(revokeCredentialMatch[1]));
        const state = readState();
        audit(state, "Gateway credential revoked", credential.id);
        writeState(state);
        sendJson(res, 200, { credential });
        return;
      }

      sendJson(res, 404, { error: "Unknown Brain route" });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message, details: error.details || undefined });
    }
    return;
  }

  if (url.pathname.startsWith("/api/gateway/v1")) {
    try {
      const denyRoute = /\/(vault\/write|tools\/execute|filesystem|env|sqlite)/.test(url.pathname)
        || /^\/api\/gateway\/v1\/approvals\/[^/]+\/(decide|approve|reject)$/.test(url.pathname);
      if (denyRoute) {
        gatewayAdapter.assertGatewayAuth(DATA_DIR, req, gatewayAdapter.REQUIRED_SCOPES.health);
        gatewayAdapter.audit(DATA_DIR, { action: "gateway_denial", reason: "blocked_route", path: url.pathname });
        throw guardedError("Gateway route is outside the read-only adapter boundary.", 403);
      }

      if (req.method === "GET" && url.pathname === "/api/gateway/v1/health") {
        const auth = gatewayAdapter.assertGatewayAuth(DATA_DIR, req, gatewayAdapter.REQUIRED_SCOPES.health);
        sendJson(res, 200, {
          status: "ok",
          requestId: auth.requestId,
          adapter: "argentum-gateway-v1",
          bridge: gatewayAdapter.bridgeConfig(process.env),
          scopes: auth.credential.scopes,
          brain: brainStartupStatusPayload(),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/gateway/v1/threads") {
        gatewayAdapter.assertGatewayAuth(DATA_DIR, req, gatewayAdapter.REQUIRED_SCOPES.threadsRead);
        sendJson(res, 200, { threads: publicAgent101ChatThreads(readState()) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/gateway/v1/threads") {
        gatewayAdapter.assertGatewayAuth(DATA_DIR, req, gatewayAdapter.REQUIRED_SCOPES.threadsWrite);
        const payload = await readBody(req);
        const result = createAgent101ChatThread({ title: payload.title || "Gateway Agent 101 thread", roomId: "agent-office" });
        gatewayAdapter.audit(DATA_DIR, { action: "gateway_request", route: "threads.create", threadId: result.thread.id });
        sendJson(res, 201, { thread: result.thread });
        return;
      }

      const gatewayThreadMatch = url.pathname.match(/^\/api\/gateway\/v1\/threads\/([^/]+)$/);
      if (req.method === "GET" && gatewayThreadMatch) {
        gatewayAdapter.assertGatewayAuth(DATA_DIR, req, gatewayAdapter.REQUIRED_SCOPES.threadsRead);
        const thread = findAgent101Thread(readState(), decodeURIComponent(gatewayThreadMatch[1]));
        if (!thread) throw guardedError("Thread not found.", 404);
        sendJson(res, 200, { thread: publicAgent101ChatThreads({ agent101ChatThreads: [thread] })[0] });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/gateway/v1/agent101/messages") {
        gatewayAdapter.assertGatewayAuth(DATA_DIR, req, gatewayAdapter.REQUIRED_SCOPES.chat);
        const payload = await readBody(req);
        let threadId = payload.threadId;
        if (!threadId) {
          const created = createAgent101ChatThread({ title: `OpenClaw ${payload.externalSessionId || "session"}`, roomId: "agent-office" });
          threadId = created.thread.id;
        }
        const result = await addAgent101ChatMessage(threadId, { content: payload.message, roomId: "agent-office", clientMessageId: payload.metadata?.clientMessageId || payload.externalSessionId || "" });
        const thread = result.thread;
        const lastAgent = (thread.messages || []).slice().reverse().find((message) => message.role === "agent" || message.role === "system");
        let citations = lastAgent?.metadata?.evidence || [];
        if (!citations.length) {
          const brain = obsidianStatusPayload();
          if (brain.initialized || brain.connected) {
            citations = agentContextBuilder.buildAgentContext({ vaultPath: brain.vaultPath, state: readState(), threadId, agentId: "agent.1010", officeId: "office.clipping" }).citations;
          }
        }
        gatewayAdapter.audit(DATA_DIR, { action: "gateway_request", route: "agent101.messages", threadId });
        sendJson(res, 200, {
          threadId,
          messageId: lastAgent?.id || "",
          status: thread.status === "waiting_approval" ? "waiting_approval" : result.error ? "failed" : "answered",
          message: lastAgent?.content || "",
          citations,
          runId: result.run?.runId || null,
          approvalIds: (thread.messages || []).filter((message) => message.metadata?.approvalId).map((message) => message.metadata.approvalId),
          artifacts: lastAgent?.metadata?.artifacts || [],
        });
        return;
      }

      const gatewayThreadMessageMatch = url.pathname.match(/^\/api\/gateway\/v1\/threads\/([^/]+)\/messages$/);
      if (req.method === "POST" && gatewayThreadMessageMatch) {
        gatewayAdapter.assertGatewayAuth(DATA_DIR, req, gatewayAdapter.REQUIRED_SCOPES.chat);
        const payload = await readBody(req);
        const threadId = decodeURIComponent(gatewayThreadMessageMatch[1]);
        const result = await addAgent101ChatMessage(threadId, { content: payload.message || payload.content, roomId: "agent-office", clientMessageId: payload.clientMessageId || "" });
        const lastAgent = (result.thread.messages || []).slice().reverse().find((message) => message.role === "agent" || message.role === "system");
        let citations = lastAgent?.metadata?.evidence || [];
        if (!citations.length) {
          const brain = obsidianStatusPayload();
          if (brain.initialized || brain.connected) citations = agentContextBuilder.buildAgentContext({ vaultPath: brain.vaultPath, state: readState(), threadId, agentId: "agent.1010", officeId: "office.clipping" }).citations;
        }
        gatewayAdapter.audit(DATA_DIR, { action: "gateway_request", route: "threads.messages", threadId });
        sendJson(res, 200, { threadId, messageId: lastAgent?.id || "", status: result.thread.status === "waiting_approval" ? "waiting_approval" : "answered", message: lastAgent?.content || "", citations });
        return;
      }

      const gatewayRunMatch = url.pathname.match(/^\/api\/gateway\/v1\/runs\/([^/]+)$/);
      if (req.method === "GET" && gatewayRunMatch) {
        gatewayAdapter.assertGatewayAuth(DATA_DIR, req, gatewayAdapter.REQUIRED_SCOPES.runsRead);
        const runId = decodeURIComponent(gatewayRunMatch[1]);
        const state = readState();
        const run = (state.agent101Runs || []).find((item) => item.id === runId || item.runId === runId);
        if (!run) throw guardedError("Run not found.", 404);
        sendJson(res, 200, { run });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/gateway/v1/approvals") {
        gatewayAdapter.assertGatewayAuth(DATA_DIR, req, gatewayAdapter.REQUIRED_SCOPES.approvalsRead);
        const approvals = (readState().approvals || []).filter((approval) => approval.status === "pending");
        sendJson(res, 200, { approvals });
        return;
      }

      const approvalNotifyMatch = url.pathname.match(/^\/api\/gateway\/v1\/approvals\/([^/]+)\/notify$/);
      if (req.method === "POST" && approvalNotifyMatch) {
        gatewayAdapter.assertGatewayAuth(DATA_DIR, req, gatewayAdapter.REQUIRED_SCOPES.approvalsNotify);
        gatewayAdapter.audit(DATA_DIR, { action: "gateway_request", route: "approvals.notify", approvalId: decodeURIComponent(approvalNotifyMatch[1]) });
        sendJson(res, 200, { notified: true, approvalId: decodeURIComponent(approvalNotifyMatch[1]), decisionAllowed: false });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/gateway/v1/memory/search") {
        gatewayAdapter.assertGatewayAuth(DATA_DIR, req, gatewayAdapter.REQUIRED_SCOPES.memorySearch);
        const payload = await readBody(req);
        const status = obsidianStatusPayload();
        if (!status.initialized && !status.connected) throw guardedError("Brain is unavailable.", 503);
        const results = obsidianVault.searchVault(status.vaultPath, payload.query || "", {
          limit: Math.min(Number(payload.limit) || 10, 25),
          business: payload.businessId || undefined,
          includeDraft: false,
          includeArchive: false,
          includeRejected: false,
          includeSuperseded: false,
          includeExpired: false,
        })
          .filter((item) => ["approved", "active"].includes(String(item.status || "").toLowerCase()) || item.canonical)
          .filter((item) => !payload.types?.length || payload.types.includes(item.type))
          .map((item) => ({
            id: item.id,
            title: item.title,
            type: item.type,
            snippet: item.snippet || item.excerpt,
            confidence: item.confidence,
            updatedAt: item.updatedAt,
            citation: { sourceId: item.id, canonicalPath: item.path },
          }));
        gatewayAdapter.audit(DATA_DIR, { action: "gateway_request", route: "memory.search", count: results.length });
        sendJson(res, 200, { results });
        return;
      }

      const artifactMatch = url.pathname.match(/^\/api\/gateway\/v1\/artifacts\/([^/]+)\/summary$/);
      if (req.method === "GET" && artifactMatch) {
        gatewayAdapter.assertGatewayAuth(DATA_DIR, req, gatewayAdapter.REQUIRED_SCOPES.artifactsSummary);
        const artifactId = decodeURIComponent(artifactMatch[1]);
        const artifact = (readState().artifacts || []).find((item) => item.id === artifactId);
        if (!artifact) throw guardedError("Artifact not found.", 404);
        sendJson(res, 200, { artifact: { id: artifact.id, title: artifact.title, type: artifact.type, status: artifact.status, summary: artifact.summary, createdAt: artifact.createdAt, updatedAt: artifact.updatedAt } });
        return;
      }

      sendJson(res, 404, { error: "Unknown Gateway route" });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (url.pathname.startsWith("/api/obsidian")) {
    try {
      requireAdminAccess(req);
      requireLocalMode();

      const activeVaultPath = () => configuredObsidianVaultPath();
      const requireObsidianVault = () => {
        const status = obsidianStatusPayload();
        if (!status.initialized && !status.connected) throw guardedError("Connect or initialize the Obsidian vault first.", 409);
        return status;
      };

      if (req.method === "GET" && url.pathname === "/api/obsidian/status") {
        sendJson(res, 200, obsidianStatusPayload());
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/obsidian/settings") {
        const payload = await readBody(req);
        const vaultPath = path.resolve(String(payload.vaultPath || "").trim() || obsidianVault.defaultVaultPath());
        localDatabase.setLocalSetting(DATA_DIR, "obsidianVaultPath", vaultPath);
        const state = readState();
        audit(state, "Obsidian vault path saved", vaultPath);
        writeState(state);
        sendJson(res, 200, obsidianStatusPayload());
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/obsidian/init") {
        const payload = await readBody(req);
        const vaultPath = path.resolve(String(payload.vaultPath || readObsidianVaultPath() || obsidianVault.defaultVaultPath()));
        localDatabase.setLocalSetting(DATA_DIR, "obsidianVaultPath", vaultPath);
        const status = obsidianVault.initializeVault(vaultPath);
        const state = readState();
        audit(state, "Obsidian brain initialized", `Vault ready at ${status.vaultPath}.`);
        writeState(state);
        sendJson(res, 200, { ...status, configured: true, defaultVaultPath: obsidianVault.defaultVaultPath() });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/obsidian/migrate/dry-run") {
        const payload = await readBody(req);
        const vaultPath = path.resolve(String(payload.vaultPath || activeVaultPath()));
        sendJson(res, 200, obsidianVault.migrateLegacyVault(vaultPath, { dryRun: true }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/obsidian/migrate") {
        const payload = await readBody(req);
        const vaultPath = path.resolve(String(payload.vaultPath || activeVaultPath()));
        localDatabase.setLocalSetting(DATA_DIR, "obsidianVaultPath", vaultPath);
        const result = obsidianVault.migrateLegacyVault(vaultPath, { dryRun: false });
        const state = readState();
        audit(state, "Obsidian vault migrated", `Vault migrated at ${vaultPath}.`);
        writeState(state);
        sendJson(res, 200, { ...result, configured: true, defaultVaultPath: obsidianVault.defaultVaultPath() });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/obsidian/validate") {
        const status = requireObsidianVault();
        sendJson(res, 200, { validation: obsidianVault.validateVault(status.vaultPath), status: obsidianStatusPayload() });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/obsidian/reindex") {
        const status = requireObsidianVault();
        const indexes = obsidianVault.rebuildIndexes(status.vaultPath);
        const validation = obsidianVault.validateVault(status.vaultPath);
        sendJson(res, 200, { indexes, validation, status: obsidianStatusPayload() });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/obsidian/entities") {
        const status = requireObsidianVault();
        const type = url.searchParams.get("type");
        const manifest = obsidianVault.rebuildEntityManifest(status.vaultPath);
        const entities = type ? manifest.entities.filter((entity) => entity.type === type) : manifest.entities;
        sendJson(res, 200, { schemaVersion: obsidianVault.SCHEMA_VERSION, entities });
        return;
      }

      const entityMatch = url.pathname.match(/^\/api\/obsidian\/entities\/([^/]+)$/);
      if (req.method === "GET" && entityMatch) {
        const status = requireObsidianVault();
        const id = decodeURIComponent(entityMatch[1]);
        const entity = obsidianVault.resolveCanonicalEntity(status.vaultPath, id);
        if (!entity) throw guardedError("Canonical entity not found.", 404);
        sendJson(res, 200, { entity, note: obsidianVault.readNote(status.vaultPath, entity.path), related: obsidianVault.listRelatedEntities(status.vaultPath, id) });
        return;
      }

      const backlinkMatch = url.pathname.match(/^\/api\/obsidian\/backlinks\/([^/]+)$/);
      if (req.method === "GET" && backlinkMatch) {
        const status = requireObsidianVault();
        const id = decodeURIComponent(backlinkMatch[1]);
        sendJson(res, 200, { backlinks: obsidianVault.listBacklinks(status.vaultPath, id) });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/obsidian/graph") {
        const status = requireObsidianVault();
        sendJson(res, 200, obsidianVault.graph(status.vaultPath, { includeWorking: url.searchParams.get("includeWorking") === "1" }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/obsidian/daily-notes") {
        const status = requireObsidianVault();
        sendJson(res, 200, { notes: obsidianVault.recentDailyNotes(status.vaultPath, Number(url.searchParams.get("limit") || 7)) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/obsidian/daily-note") {
        const status = requireObsidianVault();
        const payload = await readBody(req);
        const note = obsidianVault.createOrUpdateDailyNote(status.vaultPath, payload);
        const state = readState();
        audit(state, "Obsidian daily note updated", note.path);
        writeState(state);
        sendJson(res, 200, { note });
        return;
      }

      if ((req.method === "POST" || req.method === "GET") && url.pathname === "/api/obsidian/search") {
        const status = requireObsidianVault();
        const payload = req.method === "POST" ? await readBody(req) : Object.fromEntries(url.searchParams.entries());
        sendJson(res, 200, { results: obsidianVault.searchVault(status.vaultPath, payload.query || payload.q || "", payload) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/obsidian/create") {
        const status = requireObsidianVault();
        const payload = await readBody(req);
        const note = obsidianVault.createCanonicalNote(status.vaultPath, payload);
        const state = readState();
        audit(state, "Obsidian canonical note created", note.path);
        writeState(state);
        sendJson(res, 201, { note });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/obsidian/tool") {
        const status = requireObsidianVault();
        const payload = await readBody(req);
        const result = obsidianVault.openClawToolAction(status.vaultPath, payload.action, payload);
        const state = readState();
        audit(state, "Obsidian tool action", payload.action);
        writeState(state);
        sendJson(res, 200, result);
        return;
      }

      if ((req.method === "POST" || req.method === "GET") && url.pathname === "/api/obsidian/context") {
        const status = requireObsidianVault();
        const payload = req.method === "POST" ? await readBody(req) : Object.fromEntries(url.searchParams.entries());
        sendJson(res, 200, { context: obsidianVault.buildAgentContext(status.vaultPath, payload) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/obsidian/memory/propose") {
        const status = requireObsidianVault();
        const payload = await readBody(req);
        const note = obsidianVault.createMemoryProposal(status.vaultPath, payload);
        const state = readState();
        audit(state, "Obsidian memory proposed", note.path);
        writeState(state);
        sendJson(res, 201, { note });
        return;
      }

      const approveMemoryMatch = url.pathname.match(/^\/api\/obsidian\/memory\/([^/]+)\/approve$/);
      if (req.method === "POST" && approveMemoryMatch) {
        const status = requireObsidianVault();
        const note = obsidianVault.approveMemoryProposal(status.vaultPath, decodeURIComponent(approveMemoryMatch[1]));
        const state = readState();
        audit(state, "Obsidian memory approved", note.path);
        writeState(state);
        sendJson(res, 200, { note });
        return;
      }

      const rejectMemoryMatch = url.pathname.match(/^\/api\/obsidian\/memory\/([^/]+)\/reject$/);
      if (req.method === "POST" && rejectMemoryMatch) {
        const status = requireObsidianVault();
        const payload = await readBody(req);
        const note = obsidianVault.rejectMemoryProposal(status.vaultPath, decodeURIComponent(rejectMemoryMatch[1]), payload.reason || "");
        const state = readState();
        audit(state, "Obsidian memory rejected", note.path);
        writeState(state);
        sendJson(res, 200, { note });
        return;
      }

      sendJson(res, 404, { error: "Unknown Obsidian route" });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/ai/status") {
    sendJson(res, 200, currentAiProviderStatus());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ai/test") {
    const payload = await readBody(req);
    sendJson(res, 200, await testAiProvider(payload));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/settings/ai-provider") {
    sendJson(res, 200, publicAiProviderSettings());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/settings/ai-provider") {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, updateAiProviderSettings(payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/settings/ai-provider/key") {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, saveAiProviderKey(payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "DELETE" && url.pathname === "/api/settings/ai-provider/key") {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, removeAiProviderKey(payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/settings/ai-provider/test") {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, await testAiProvider(payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/settings/connections/openai/test") {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, await testAiProvider({ ...payload, provider: "openai" }));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/settings/connections/tiktok/status") {
    const state = readState();
    sendJson(res, 200, publicToolConnections(state).tiktok);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/depo/chat") {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, await handleDepoChat(payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/connectors/status") {
    try {
      const state = readState();
      sendJson(res, 200, { connectors: publicConnectorStatuses(state, { includeAdminOnly: currentRequestIsAdmin(req) }) });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/agent-runtime/openclaw/status") {
    try {
      requireAdminAccess(req);
      sendJson(res, 200, { status: openClawConnectorStatus(readState()) });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/agent-runtime/openclaw/models") {
    try {
      requireAdminAccess(req);
      sendJson(res, 200, await listOpenClawModels());
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agent-runtime/openclaw/test") {
    try {
      requireAdminAccess(req);
      sendJson(res, 200, await testOpenClawRuntime());
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agent-runtime/openclaw/run") {
    try {
      requireAdminAccess(req);
      const payload = await readBody(req);
      sendJson(res, 200, await runOpenClawAgentRequest(payload));
    } catch (error) {
      sendJson(res, error.status || 500, {
        error: error.message,
        code: error.code || undefined,
        httpStatus: error.httpStatus || undefined,
        configurationErrors: error.configurationErrors || undefined,
      });
    }
    return;
  }

  const connectorTestMatch = url.pathname.match(/^\/api\/connectors\/([^/]+)\/test$/);
  if (req.method === "POST" && connectorTestMatch) {
    try {
      if (connectorTestMatch[1] === "openclaw") requireAdminAccess(req);
      sendJson(res, 200, await testConnector(connectorTestMatch[1]));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/agent101/readiness") {
    try {
      sendJson(res, 200, agent101Readiness(readState()));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/agent101/tool-status") {
    const state = readState();
    const includeOpenClaw = currentRequestIsAdmin(req);
    sendJson(res, 200, {
      agent101: agent101Model(state),
      tools: publicToolConnections(state, { includeOpenClaw }),
      connectors: publicConnectorStatuses(state, { includeAdminOnly: includeOpenClaw }),
      readiness: agent101Readiness(state),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/agent101/openai-status") {
    sendJson(res, 200, agent101OpenAiStatus());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agent101/openai-test") {
    sendJson(res, 200, await testAgent101OpenAi());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/agent101/studio/status") {
    const state = readState();
    const provider = currentAiProviderStatus();
    sendJson(res, 200, {
      status: "ready",
      provider,
      outputRoot: AGENT101_OUTPUT_ROOT,
      projectWorkspace: agent101ProjectWorkspace.inspectWorkspace({ state, rootDir: ROOT }),
      layout: state.agent101StudioLayout,
      activeMissions: (state.agent101Missions || []).filter((mission) => agent101MissionManager.ACTIVE_STATUSES.has(mission.status)).length,
      workerCount: agent101MissionWorkers.size,
      safety: "supervised_human_gate",
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/agent101/project-workspace") {
    const state = readState();
    sendJson(res, 200, {
      workspace: agent101ProjectWorkspace.inspectWorkspace({ state, rootDir: ROOT }),
      layout: state.agent101StudioLayout,
      proposals: (state.agent101EditProposals || []).slice(0, 50),
    });
    return;
  }

  const agent101ProjectEditMatch = url.pathname.match(/^\/api\/agent101\/project-edits\/([^/]+)$/);
  if (req.method === "GET" && agent101ProjectEditMatch) {
    try {
      const state = readState();
      const proposal = agent101ProjectWorkspace.editProposalPreview({
        state,
        rootDir: ROOT,
        outputRoot: AGENT101_OUTPUT_ROOT,
        proposalId: decodeURIComponent(agent101ProjectEditMatch[1]),
      });
      sendJson(res, 200, { proposal });
    } catch (error) {
      sendJson(res, /not found/i.test(error.message) ? 404 : 409, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/agent101/missions") {
    const state = readState();
    const threadId = String(url.searchParams.get("threadId") || "");
    const status = String(url.searchParams.get("status") || "");
    let missions = state.agent101Missions || [];
    if (threadId) missions = missions.filter((mission) => mission.threadId === threadId);
    if (status) missions = missions.filter((mission) => mission.status === status);
    sendJson(res, 200, { missions: missions.map((mission) => publicAgent101Mission(mission, { includeEvents: false })) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agent101/missions") {
    try {
      const payload = await readBody(req);
      sendJson(res, 201, { mission: createAgent101Mission(payload) });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const agent101MissionStreamMatch = url.pathname.match(/^\/api\/agent101\/missions\/([^/]+)\/stream$/);
  if (req.method === "GET" && agent101MissionStreamMatch) {
    try {
      subscribeAgent101Mission(decodeURIComponent(agent101MissionStreamMatch[1]), req, res);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const agent101MissionActionMatch = url.pathname.match(/^\/api\/agent101\/missions\/([^/]+)\/(resume|cancel)$/);
  if (req.method === "POST" && agent101MissionActionMatch) {
    try {
      const missionId = decodeURIComponent(agent101MissionActionMatch[1]);
      const mission = agent101MissionActionMatch[2] === "resume"
        ? resumeAgent101Mission(missionId)
        : cancelAgent101Mission(missionId);
      sendJson(res, 200, { mission });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const agent101MissionMatch = url.pathname.match(/^\/api\/agent101\/missions\/([^/]+)$/);
  if (req.method === "GET" && agent101MissionMatch) {
    try {
      const state = readState();
      const mission = findAgent101Mission(state, decodeURIComponent(agent101MissionMatch[1]));
      if (!mission) throw guardedError("Agent 101 mission not found.", 404);
      sendJson(res, 200, { mission: publicAgent101Mission(mission) });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/agent101/chats") {
    try {
      const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
      const includeArchived = url.searchParams.get("archived") === "1" || url.searchParams.get("archived") === "true";
      const state = readState();
      let threads = publicAgent101ChatThreads(state).filter((thread) => includeArchived || !thread.archived);
      if (query) {
        threads = threads.filter((thread) => {
          const full = findAgent101Thread(state, thread.id);
          const searchable = [
            thread.title,
            thread.lastMessage,
            ...(full?.messages || []).map((message) => message.content),
          ]
            .join(" ")
            .toLowerCase();
          return searchable.includes(query);
        });
      }
      sendJson(res, 200, { threads });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agent101/chats") {
    try {
      const payload = await readBody(req);
      sendJson(res, 201, createAgent101ChatThread(payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const agent101ChatAppendMatch = url.pathname.match(/^\/api\/agent101\/chats\/([^/]+)\/append$/);
  if (req.method === "POST" && agent101ChatAppendMatch) {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, appendAgent101ChatThreadMessagesDirect(decodeURIComponent(agent101ChatAppendMatch[1]), payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const agent101ChatMatch = url.pathname.match(/^\/api\/agent101\/chats\/([^/]+)$/);
  if (agent101ChatMatch) {
    const threadId = decodeURIComponent(agent101ChatMatch[1]);
    try {
      if (req.method === "GET") {
        const state = readState();
        const thread = findAgent101Thread(state, threadId);
        if (!thread) throw guardedError("Chat thread not found.", 404);
        thread.lastOpenedAt = now();
        writeState(state);
        sendJson(res, 200, { thread, threads: publicAgent101ChatThreads(state) });
        return;
      }
      if (req.method === "PATCH") {
        const payload = await readBody(req);
        sendJson(res, 200, updateAgent101ChatThread(threadId, payload));
        return;
      }
      if (req.method === "DELETE") {
        sendJson(res, 200, deleteAgent101ChatThread(threadId));
        return;
      }
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
      return;
    }
  }

  const agent101ChatMessagesMatch = url.pathname.match(/^\/api\/agent101\/chats\/([^/]+)\/messages$/);
  if (req.method === "GET" && agent101ChatMessagesMatch) {
    try {
      const state = readState();
      const thread = findAgent101Thread(state, decodeURIComponent(agent101ChatMessagesMatch[1]));
      if (!thread) throw guardedError("Chat thread not found.", 404);
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 80)));
      const before = Number(url.searchParams.get("before") || 0);
      const messages = (thread.messages || [])
        .filter((message) => (before ? Number(message.sequence || 0) < before : true))
        .slice(-limit);
      sendJson(res, 200, { thread: publicAgent101ChatThreads(state).find((item) => item.id === thread.id), messages });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const agent101ChatMessageMatch = url.pathname.match(/^\/api\/agent101\/chats\/([^/]+)\/messages$/);
  if (req.method === "POST" && agent101ChatMessageMatch) {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, await addAgent101ChatMessage(decodeURIComponent(agent101ChatMessageMatch[1]), payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agent101/run") {
    try {
      const payload = await readBody(req);
      const result = await runAgent101FromRoot(payload);
      sendJson(res, result.status === "error" ? 500 : 200, result);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agent101/chat") {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, await handleAgent101Chat(payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat/messages") {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, appendChatMessages(payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agent101/actions") {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, handleAgent101Action(payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const officeTaskMatch = url.pathname.match(/^\/api\/offices\/([^/]+)\/tasks$/);
  if (req.method === "POST" && officeTaskMatch) {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, createOfficeTask(officeTaskMatch[1], payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const officeArtifactMatch = url.pathname.match(/^\/api\/offices\/([^/]+)\/artifacts$/);
  if (req.method === "POST" && officeArtifactMatch) {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, createOfficeArtifact(officeArtifactMatch[1], payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/human-gate/packages") {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, createHumanGatePackage(payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agent101/tasks") {
    try {
      const payload = await readBody(req);
      const result = createAgent101Task(payload);
      sendJson(res, 200, { task: result.task, state: result.state });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agent101/clips/brief") {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, createClipsBrief(payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agent101/clips/package") {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, createClipsApprovalPackage(payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agent101/human-gate/request") {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, createHumanGateRequest(payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/agent101/artifacts") {
    const state = readState();
    sendJson(res, 200, (state.artifacts || []).filter((artifact) => artifact.createdBy === "agent-101" || artifact.workflowId === "workflow-clips-office"));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/agent101/operating-system") {
    const state = readState();
    sendJson(res, 200, agent101Os.publicOperatingSystemPayload(state));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/business/profile") {
    const state = readState();
    sendJson(res, 200, { profile: state.businessProfile, readiness: agent101Os.businessReadiness(state) });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/business/profile") {
    try {
      const payload = await readBody(req);
      const state = readState();
      const profile = agent101Os.updateBusinessProfile(state, payload);
      audit(state, "Business profile updated", `Updated profile for ${profile.companyName || "Argentum"}.`);
      writeState(state);
      sendJson(res, 200, { profile, readiness: agent101Os.businessReadiness(state) });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/business/readiness") {
    const state = readState();
    sendJson(res, 200, agent101Os.businessReadiness(state));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/business/goals") {
    const state = readState();
    sendJson(res, 200, { goals: state.businessProfile?.goals || [] });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/business/goals") {
    try {
      const payload = await readBody(req);
      const state = readState();
      state.businessProfile.goals = Array.isArray(state.businessProfile.goals) ? state.businessProfile.goals : [];
      const goal = {
        id: `goal-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        title: String(payload.title || payload.goal || "").trim().slice(0, 200),
        status: String(payload.status || "active").slice(0, 40),
        metric: payload.metric ? String(payload.metric).slice(0, 120) : "",
        deadline: payload.deadline || null,
        createdAt: now(),
      };
      if (!goal.title) throw guardedError("Goal title is required.", 400);
      state.businessProfile.goals.unshift(goal);
      audit(state, "Business goal added", goal.title);
      writeState(state);
      sendJson(res, 201, { goal, goals: state.businessProfile.goals });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/business/kpis") {
    const state = readState();
    sendJson(res, 200, { kpis: state.businessProfile?.kpis || [] });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/business/kpis") {
    try {
      const payload = await readBody(req);
      const state = readState();
      state.businessProfile.kpis = Array.isArray(state.businessProfile.kpis) ? state.businessProfile.kpis : [];
      const kpi = {
        id: `kpi-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        label: String(payload.label || payload.title || "").trim().slice(0, 160),
        value: payload.value ?? 0,
        target: payload.target ?? "",
        createdAt: now(),
      };
      if (!kpi.label) throw guardedError("KPI label is required.", 400);
      state.businessProfile.kpis.unshift(kpi);
      audit(state, "Business KPI added", kpi.label);
      writeState(state);
      sendJson(res, 201, { kpi, kpis: state.businessProfile.kpis });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/knowledge") {
    const state = readState();
    const status = String(url.searchParams.get("status") || "").trim();
    const category = String(url.searchParams.get("category") || "").trim();
    let items = state.businessKnowledge || [];
    if (status) items = items.filter((item) => item.status === status);
    if (category) items = items.filter((item) => item.category === category);
    sendJson(res, 200, { knowledge: items });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/knowledge") {
    try {
      const payload = await readBody(req);
      const state = readState();
      const item = agent101Os.upsertKnowledgeItem(state, payload);
      audit(state, "Knowledge item saved", `${item.title} (${item.status})`);
      writeState(state);
      sendJson(res, 201, { item });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/knowledge/search") {
    try {
      const payload = await readBody(req);
      const state = readState();
      sendJson(res, 200, { results: agent101Os.searchKnowledge(state, payload.query || payload.q || "", payload) });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const knowledgeMatch = url.pathname.match(/^\/api\/knowledge\/([^/]+)$/);
  if (knowledgeMatch) {
    const knowledgeId = decodeURIComponent(knowledgeMatch[1]);
    try {
      const state = readState();
      const item = (state.businessKnowledge || []).find((entry) => entry.id === knowledgeId);
      if (!item) throw guardedError("Knowledge item not found.", 404);
      if (req.method === "GET") {
        sendJson(res, 200, { item });
        return;
      }
      if (req.method === "PATCH") {
        const payload = await readBody(req);
        const updated = agent101Os.upsertKnowledgeItem(state, { ...item, ...payload, id: item.id, version: Number(item.version || 1) + 1 });
        audit(state, "Knowledge item updated", updated.title);
        writeState(state);
        sendJson(res, 200, { item: updated });
        return;
      }
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
      return;
    }
  }

  const knowledgeApproveMatch = url.pathname.match(/^\/api\/knowledge\/([^/]+)\/approve$/);
  if (req.method === "POST" && knowledgeApproveMatch) {
    const state = readState();
    const item = agent101Os.approveKnowledgeItem(state, decodeURIComponent(knowledgeApproveMatch[1]), "operator");
    if (!item) {
      sendJson(res, 404, { error: "Knowledge item not found." });
      return;
    }
    audit(state, "Knowledge approved", item.title);
    writeState(state);
    sendJson(res, 200, { item });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/agent101/memory") {
    const state = readState();
    sendJson(res, 200, {
      memory: state.agent101MemoryRecords || [],
      legacyMemory: state.memory || { working: [], shared: [], agent: [] },
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agent101/memory/proposals") {
    try {
      const payload = await readBody(req);
      const state = readState();
      const record = {
        id: `memory-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        type: ["working", "episodic", "semantic", "procedural", "preference", "decision"].includes(payload.type) ? payload.type : "working",
        title: String(payload.title || "Memory proposal").slice(0, 160),
        content: String(payload.content || payload.body || "").slice(0, 6000),
        source: String(payload.source || "operator").slice(0, 120),
        sourceRecordIds: Array.isArray(payload.sourceRecordIds) ? payload.sourceRecordIds.slice(0, 20) : [],
        confidence: Math.max(0, Math.min(1, Number(payload.confidence || 0.7))),
        importance: ["low", "medium", "high"].includes(payload.importance) ? payload.importance : "medium",
        status: "proposed",
        approved: false,
        approvedBy: null,
        effectiveFrom: now(),
        expiresAt: payload.expiresAt || null,
        supersedes: payload.supersedes || null,
        createdAt: now(),
        updatedAt: now(),
      };
      if (!record.content) throw guardedError("Memory proposal content is required.", 400);
      state.agent101MemoryRecords.unshift(record);
      audit(state, "Memory proposal created", record.title);
      writeState(state);
      sendJson(res, 201, { record });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const memoryDecisionMatch = url.pathname.match(/^\/api\/agent101\/memory\/([^/]+)\/(approve|reject)$/);
  if (req.method === "POST" && memoryDecisionMatch) {
    const [, memoryId, decision] = memoryDecisionMatch;
    const state = readState();
    const record = (state.agent101MemoryRecords || []).find((item) => item.id === decodeURIComponent(memoryId));
    if (!record) {
      sendJson(res, 404, { error: "Memory record not found." });
      return;
    }
    record.status = decision === "approve" ? "approved" : "rejected";
    record.approved = decision === "approve";
    record.approvedBy = decision === "approve" ? "operator" : null;
    record.updatedAt = now();
    audit(state, `Memory ${record.status}`, record.title);
    writeState(state);
    sendJson(res, 200, { record });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agent101/memory/search") {
    try {
      const payload = await readBody(req);
      const q = String(payload.query || payload.q || "").toLowerCase();
      const state = readState();
      const results = (state.agent101MemoryRecords || []).filter((record) => {
        if (!q) return true;
        return `${record.title} ${record.content} ${record.type}`.toLowerCase().includes(q);
      }).slice(0, Number(payload.limit || 20));
      sendJson(res, 200, { results });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const runMatch = url.pathname.match(/^\/api\/agent101\/runs\/([^/]+)$/);
  if (req.method === "GET" && runMatch) {
    const state = readState();
    const run = (state.agent101Runs || []).find((item) => item.id === decodeURIComponent(runMatch[1]));
    if (!run) {
      sendJson(res, 404, { error: "Agent 101 run not found." });
      return;
    }
    sendJson(res, 200, { run, toolResults: (state.agent101ToolResults || []).filter((tool) => run.toolCalls?.some((call) => call.toolCallId === tool.toolCallId)), verificationResults: run.verificationResults || [] });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agent101/runs") {
    try {
      const payload = await readBody(req);
      const result = await runAgent101FromRoot(payload);
      sendJson(res, result.status === "error" ? 500 : 200, result);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const runActionMatch = url.pathname.match(/^\/api\/agent101\/runs\/([^/]+)\/(pause|resume|cancel|retry-step)$/);
  if (req.method === "POST" && runActionMatch) {
    const [, runIdRaw, action] = runActionMatch;
    const state = readState();
    const run = (state.agent101Runs || []).find((item) => item.id === decodeURIComponent(runIdRaw));
    if (!run) {
      sendJson(res, 404, { error: "Agent 101 run not found." });
      return;
    }
    if (action === "pause") run.status = "waiting_input";
    if (action === "resume") run.status = "running";
    if (action === "cancel") run.status = "cancelled";
    if (action === "retry-step") run.status = "queued";
    run.updatedAt = now();
    audit(state, `Agent 101 run ${action}`, run.id);
    writeState(state);
    sendJson(res, 200, { run });
    return;
  }

  const agentTaskMatch = url.pathname.match(/^\/api\/agent101\/tasks\/([^/]+)$/);
  if (req.method === "GET" && agentTaskMatch) {
    const state = readState();
    const contract = (state.agent101TaskContracts || []).find((item) => item.id === decodeURIComponent(agentTaskMatch[1]));
    if (!contract) {
      sendJson(res, 404, { error: "Agent 101 task contract not found." });
      return;
    }
    sendJson(res, 200, { task: contract });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/offices") {
    sendJson(res, 200, {
      offices: Object.values(BUSINESS_OFFICES),
      toolReadiness: publicConnectorStatuses(readState(), { includeAdminOnly: currentRequestIsAdmin(req) }),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/control-floor/infrastructure") {
    try {
      const snapshot = await controlFloorInfrastructureSnapshot(readState(), { includeAdminOnly: currentRequestIsAdmin(req) });
      sendJson(res, 200, snapshot);
    } catch (error) {
      sendJson(res, error.status || 500, { error: "Project infrastructure could not be measured safely." });
    }
    return;
  }

  const officeMatch = url.pathname.match(/^\/api\/offices\/([^/]+)$/);
  if (req.method === "GET" && officeMatch) {
    const office = BUSINESS_OFFICES[decodeURIComponent(officeMatch[1])];
    if (!office) {
      sendJson(res, 404, { error: "Office not found." });
      return;
    }
    const state = readState();
    sendJson(res, 200, {
      office,
      tasks: (state.tasks || []).filter((task) => task.officeId === office.id || task.workflowId === office.workflowId),
      artifacts: (state.artifacts || []).filter((artifact) => artifact.workflowId === office.workflowId),
      approvals: (state.approvals || []).filter((approval) => approval.officeId === office.id || approval.workflowId === office.workflowId),
    });
    return;
  }

  const officeRunsMatch = url.pathname.match(/^\/api\/offices\/([^/]+)\/runs$/);
  if (req.method === "GET" && officeRunsMatch) {
    const office = BUSINESS_OFFICES[decodeURIComponent(officeRunsMatch[1])];
    if (!office) {
      sendJson(res, 404, { error: "Office not found." });
      return;
    }
    const state = readState();
    const runs = (state.agent101Runs || []).filter((run) => {
      const contract = (state.agent101TaskContracts || []).find((item) => item.id === run.taskContractId);
      return contract?.relatedOffices?.includes(office.id);
    });
    sendJson(res, 200, { office, runs });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/agent-blueprints") {
    sendJson(res, 200, { blueprints: readState().agentBlueprints || [] });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agent-blueprints") {
    try {
      const payload = await readBody(req);
      const state = readState();
      const blueprint = {
        id: `agent-blueprint-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        proposedName: String(payload.proposedName || payload.name || "Future Agent").slice(0, 120),
        proposedRole: String(payload.proposedRole || payload.role || "Specialist").slice(0, 160),
        businessPurpose: String(payload.businessPurpose || payload.purpose || "").slice(0, 1000),
        responsibilities: Array.isArray(payload.responsibilities) ? payload.responsibilities.slice(0, 20) : [],
        inputs: Array.isArray(payload.inputs) ? payload.inputs.slice(0, 20) : [],
        outputs: Array.isArray(payload.outputs) ? payload.outputs.slice(0, 20) : [],
        tools: Array.isArray(payload.tools) ? payload.tools.slice(0, 20) : [],
        memoryScope: payload.memoryScope || "bounded",
        authorityLevel: payload.authorityLevel || 1,
        requiredApprovals: ["tool_review", "authority_review", "evaluation_pass", "human_gate"],
        prohibitedActions: Array.from(agent101Os.RISKY_ACTION_TYPES),
        evaluationSuite: payload.evaluationSuite || [],
        riskLevel: payload.riskLevel || "medium",
        status: "draft",
        createdBy: "agent-101",
        createdAt: now(),
      };
      state.agentBlueprints.unshift(blueprint);
      audit(state, "Agent blueprint drafted", blueprint.proposedName);
      writeState(state);
      sendJson(res, 201, { blueprint });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const agentBlueprintMatch = url.pathname.match(/^\/api\/agent-blueprints\/([^/]+)(?:\/(test|request-approval))?$/);
  if (agentBlueprintMatch) {
    try {
      const [, blueprintIdRaw, action] = agentBlueprintMatch;
      const state = readState();
      const blueprint = (state.agentBlueprints || []).find((item) => item.id === decodeURIComponent(blueprintIdRaw));
      if (!blueprint) throw guardedError("Agent blueprint not found.", 404);
      if (req.method === "PATCH" && !action) {
        const payload = await readBody(req);
        Object.assign(blueprint, payload, { id: blueprint.id, updatedAt: now() });
        audit(state, "Agent blueprint updated", blueprint.proposedName);
        writeState(state);
        sendJson(res, 200, { blueprint });
        return;
      }
      if (req.method === "POST" && action === "test") {
        blueprint.status = "testing";
        blueprint.lastTest = { status: "manual_eval_required", testedAt: now(), message: "Blueprint testing requires an evaluation suite before approval." };
        writeState(state);
        sendJson(res, 200, { blueprint, test: blueprint.lastTest });
        return;
      }
      if (req.method === "POST" && action === "request-approval") {
        const approval = {
          id: `approval-blueprint-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          title: `Review future agent blueprint: ${blueprint.proposedName}`,
          actionType: "create_live_agent",
          requestedAction: `Approve blueprint for possible future activation: ${blueprint.proposedName}`,
          exactScope: "Blueprint review only. Does not activate the agent.",
          reason: "Live agent activation requires Human Gate.",
          risk: "high",
          riskLevel: "high",
          evidence: `Blueprint ID: ${blueprint.id}`,
          reversible: false,
          status: "pending",
          createdBy: "agent-101",
          createdAt: now(),
        };
        state.approvals.unshift(approval);
        blueprint.status = "pending_approval";
        writeState(state);
        sendJson(res, 200, { blueprint, approval });
        return;
      }
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
      return;
    }
  }

  if (req.method === "GET" && url.pathname === "/api/human-gate/requests") {
    const state = readState();
    sendJson(res, 200, { requests: state.approvals || [] });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/human-gate/requests") {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, createHumanGatePackage(payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const humanGateDecisionMatch = url.pathname.match(/^\/api\/human-gate\/requests\/([^/]+)\/decision$/);
  if (req.method === "POST" && humanGateDecisionMatch) {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, decideHumanGateRequest(decodeURIComponent(humanGateDecisionMatch[1]), payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/feedback") {
    try {
      const payload = await readBody(req);
      const state = readState();
      const result = agent101Os.addFeedback(state, payload);
      audit(state, "Agent 101 feedback recorded", `${result.feedback.rating}: ${result.feedback.targetType}`);
      writeState(state);
      sendJson(res, 201, result);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/evals") {
    const state = readState();
    sendJson(res, 200, {
      promptVersion: agent101Os.AGENT_101_PROMPT_VERSION,
      requiredCategories: ["truthfulness", "task_understanding", "planning", "tool_use", "business_quality", "safety", "memory", "completion"],
      runs: state.agent101EvalRuns || [],
      feedbackCases: state.agent101EvalCases || [],
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/evals/run") {
    try {
      const state = readState();
      const evalRun = await agent101Os.runAgent101EvalSuite(state);
      state.agent101EvalRuns.unshift(evalRun);
      state.agent101EvalRuns = state.agent101EvalRuns.slice(0, 100);
      audit(state, "Agent 101 eval run", `${evalRun.status}: ${evalRun.score}%`);
      writeState(state);
      sendJson(res, 200, { evalRun });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const evalRunMatch = url.pathname.match(/^\/api\/evals\/runs\/([^/]+)$/);
  if (req.method === "GET" && evalRunMatch) {
    const state = readState();
    const evalRun = (state.agent101EvalRuns || []).find((item) => item.id === decodeURIComponent(evalRunMatch[1]));
    if (!evalRun) {
      sendJson(res, 404, { error: "Eval run not found." });
      return;
    }
    sendJson(res, 200, { evalRun });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stock-office/notifications/telegram/webhook") {
    try {
      enforceStockOfficeRateLimit(req, "telegram-webhook", 120, 60_000);
      const payload = await readBody(req);
      const state = readState();
      const result = await stockTelegramNotifier.processUpdate(payload, {
        webhookSecret: req.headers["x-telegram-bot-api-secret-token"],
        approvals: state.approvals || [],
      });
      sendJson(res, result.httpStatus || 200, { ok: result.accepted === true, status: result.status, duplicate: result.duplicate === true });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stock-office/permissions") {
    try {
      const access = requireStockOfficeAccess(req, "view");
      sendJson(res, 200, { permissions: access.permissions });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stock-office/overview") {
    try {
      enforceStockOfficeRateLimit(req, "overview", 80, 60_000);
      const access = requireStockOfficeAccess(req, "view");
      const state = readState();
      const snapshot = stockOfficeSnapshot(state, access.permissions, { cachedIntelligence: true });
      const brokerControl = brokerControlOverview(snapshot);
      const notificationStatus = stockTelegramNotifier.publicStatus(state.approvals || []);
      const intelligenceScheduler = stockIntelligenceScheduler.getStatus();
      sendJson(res, 200, {
        ...stockOverview(snapshot),
        intelligence: snapshot.intelligence,
        systemHealth: stockOfficeSystemHealth({ snapshot, brokerControl, notificationStatus, scheduler: intelligenceScheduler, state }),
      });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stock-office/events") {
    try {
      enforceStockOfficeRateLimit(req, "events", 12, 60_000);
      requireStockOfficeAccess(req, "view");
      res.writeHead(200, {
        ...securityHeaders(req),
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      const detach = stockEventBus.attachSse(res);
      req.on("close", detach);
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stock-office/intelligence") {
    try {
      enforceStockOfficeRateLimit(req, "intelligence", 80, 60_000);
      requireStockOfficeAccess(req, "view");
      const state = readState();
      const snapshot = stockOfficeSnapshot(state, undefined, { cachedIntelligence: true });
      const brokerControl = brokerControlOverview(snapshot);
      const notificationStatus = stockTelegramNotifier.publicStatus(state.approvals || []);
      const intelligenceScheduler = stockIntelligenceScheduler.getStatus();
      sendJson(res, 200, {
        ...snapshot.intelligence,
        events: stockIntelligenceStore.recentEvents(80),
        systemHealth: stockOfficeSystemHealth({ snapshot, brokerControl, notificationStatus, scheduler: intelligenceScheduler, state }),
      });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stock-office/records") {
    try {
      enforceStockOfficeRateLimit(req, "records", 80, 60_000);
      const access = requireStockOfficeAccess(req, "records");
      const snapshot = stockOfficeSnapshot(readState(), access.permissions, { cachedIntelligence: true });
      sendJson(res, 200, {
        ...listStockRecords(snapshot, stockOfficeQueryOptions(url)),
        generatedAt: snapshot.generatedAt,
        sourceHealth: snapshot.sourceHealth,
      });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  const stockRecordMatch = url.pathname.match(/^\/api\/stock-office\/records\/([^/]+)$/);
  if (req.method === "GET" && stockRecordMatch) {
    try {
      enforceStockOfficeRateLimit(req, "record", 100, 60_000);
      const access = requireStockOfficeAccess(req, "records");
      const snapshot = stockOfficeSnapshot(readState(), access.permissions, { cachedIntelligence: true });
      const record = getStockRecord(snapshot, decodeURIComponent(stockRecordMatch[1]));
      if (!record) throw guardedError("Stock Office record not found.", 404);
      sendJson(res, 200, {
        record,
        generatedAt: snapshot.generatedAt,
        citations: [record.provenance].filter(Boolean),
        safety: snapshot.workspace.safetyRule,
      });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stock-office/sources") {
    try {
      enforceStockOfficeRateLimit(req, "sources", 60, 60_000);
      const access = requireStockOfficeAccess(req, "sources");
      const snapshot = stockOfficeSnapshot(readState(), access.permissions, { cachedIntelligence: true });
      sendJson(res, 200, {
        sources: snapshot.sources,
        sourceHealth: snapshot.sourceHealth,
        secSetup: stockSecSetupPayload(),
        threatModel: snapshot.threatModel,
        workspace: snapshot.workspace,
      });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stock-office/sources/sec-identity") {
    try {
      enforceStockOfficeRateLimit(req, "sec-identity", 6, 300_000);
      requireStockOfficeAccess(req, "sources");
      requireLocalMode();
      const payload = await readBody(req);
      const identity = normalizeStockSecIdentity(payload.identity);
      localDatabase.setLocalSetting(DATA_DIR, "stockSecUserAgent", identity);
      process.env.STOCK_GURU_SEC_USER_AGENT = identity;
      const intelligenceScheduler = stockIntelligenceScheduler.refreshConfiguration();
      const state = readState();
      audit(state, "Stock Office SEC contact configured", "A monitored SEC request identity was saved to the server-only local database. The value was not returned to the browser; the next bounded SEC research cycle may transmit it to SEC.gov.");
      writeState(state);
      sendJson(res, 200, {
        secSetup: stockSecSetupPayload(),
        intelligenceScheduler,
        externalRequestMade: false,
        liveOrderPlaced: false,
      });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stock-office/activity") {
    try {
      enforceStockOfficeRateLimit(req, "activity", 80, 60_000);
      const access = requireStockOfficeAccess(req, "view");
      const snapshot = stockOfficeSnapshot(readState(), access.permissions, { cachedIntelligence: true });
      sendJson(res, 200, { activity: snapshot.activity, syncRuns: snapshot.syncRuns, assistantRuns: snapshot.assistantRuns });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stock-office/mirror") {
    try {
      enforceStockOfficeRateLimit(req, "mirror", 60, 60_000);
      const access = requireStockOfficeAccess(req, "view");
      const snapshot = stockOfficeSnapshot(readState(), access.permissions, { cachedIntelligence: true });
      sendJson(res, 200, {
        mirror: snapshot.mirror,
        mirrorIntelligence: snapshot.intelligence.mirror,
        traderResearch: stockTraderResearchAgent.getState(),
        safety: snapshot.workspace.safetyRule,
      });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  const traderResearchRetryMatch = url.pathname.match(/^\/api\/stock-office\/trader-research\/([^/]+)\/retry$/);
  if (req.method === "POST" && traderResearchRetryMatch) {
    try {
      enforceStockOfficeRateLimit(req, "trader-research-retry", 12, 300_000);
      requireStockOfficeAccess(req, "sync");
      const job = stockTraderResearchAgent.retry(decodeURIComponent(traderResearchRetryMatch[1]));
      if (!job) throw guardedError("Trader research job not found.", 404);
      sendJson(res, 200, {
        job,
        traderResearch: stockTraderResearchAgent.getState(),
        brokerCalled: false,
        liveOrderPlaced: false,
      });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  const mirrorSourceControlMatch = url.pathname.match(/^\/api\/stock-office\/mirror\/sources\/([^/]+)$/);
  if (req.method === "POST" && mirrorSourceControlMatch) {
    try {
      enforceStockOfficeRateLimit(req, "mirror-source-control", 20, 300_000);
      requireStockOfficeAccess(req, "order_draft");
      const payload = await readBody(req);
      const source = stockIntelligenceStore.setMirrorSourceState(decodeURIComponent(mirrorSourceControlMatch[1]), {
        following: payload.following,
        mirrorEnabled: payload.mirrorEnabled,
        actorType: "WEB",
        actorId: "local-owner",
      });
      invalidateStockIntelligenceStateCache();
      if (!source) throw guardedError("Mirror source not found. Run a research refresh first.", 404);
      stockEventBus.publish("mirror.source_control_changed", { sourceId: source.id, following: source.following, mirrorEnabled: source.mirrorEnabled, status: "updated" }, { actorType: "WEB", actorId: "local-owner" });
      sendJson(res, 200, { source, mirrorIntelligence: stockIntelligenceStore.mirrorState(), safety: "Mirror controls affect research/proposal eligibility only. Human Gate and broker revalidation remain mandatory." });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stock-office/live") {
    try {
      enforceStockOfficeRateLimit(req, "live-portfolio", 150, 60_000);
      const access = requireStockOfficeAccess(req, "broker_view");
      if (robinhoodMcpClient.publicStatus().oauthAuthenticated) {
        // The browser can request a fresh display every second while the
        // connector's own cache keeps external Robinhood reads at >= 5s.
        const brokerSnapshot = await robinhoodMcpClient.refreshIfStale(5_000).catch(() => null);
        const snapshotAt = brokerSnapshot?.updatedAt || "";
        if (snapshotAt && snapshotAt !== stockReadinessBrokerSnapshotAt) {
          await reconcileStockBrokerOrderLifecycle().catch(() => null);
          stockReadinessBrokerSnapshotAt = snapshotAt;
        }
      }
      const state = readState();
      const snapshot = stockOfficeBrokerSnapshot(state, access.permissions);
      const brokerControl = brokerControlOverview(snapshot);
      sendJson(res, 200, {
        brokerControl,
        robinhoodConnection: robinhoodMcpClient.publicStatus(),
        serverTime: now(),
      });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stock-office/broker-control") {
    try {
      enforceStockOfficeRateLimit(req, "broker-control", 80, 60_000);
      const access = requireStockOfficeAccess(req, "broker_view");
      if (robinhoodMcpClient.publicStatus().oauthAuthenticated) {
        const brokerSnapshot = await robinhoodMcpClient.refreshIfStale(5_000).catch(() => null);
        const snapshotAt = brokerSnapshot?.updatedAt || "";
        if (snapshotAt && snapshotAt !== stockReadinessBrokerSnapshotAt) {
          await reconcileStockBrokerOrderLifecycle().catch(() => null);
          stockReadinessBrokerSnapshotAt = snapshotAt;
        }
      }
      const state = readState();
      const snapshot = stockOfficeSnapshot(state, access.permissions, { cachedIntelligence: true });
      const tradeDrafts = snapshot.tradeDrafts
        .map((draft) => tradeDraftWithApprovalState(draft, state.approvals || []))
        .slice(0, 20);
      const connectionApproval = (state.approvals || []).find((item) => item.linkedId === "stock-office:robinhood-agentic-mcp:onboarding") || null;
      const guardrailApproval = (state.approvals || []).find((item) => item.actionType === "change_stock_trading_guardrails" && !item.consumedAt) || null;
      const guardrailDetails = guardrailApproval ? (guardrailApproval.grantedDetails || guardrailApproval.originalDetails || guardrailApproval.details || {}) : {};
      const brokerControl = brokerControlOverview(snapshot);
      const intelligenceScheduler = stockIntelligenceScheduler.getStatus();
      const shadowPortfolio = refreshStockShadowPortfolio({ state });
      const portfolioPlan = withPaperProposalReadiness(buildContinuousReviewView({
        plan: buildCopyPortfolioPlan(snapshot),
        review: normalizeStockOfficeState(state.stockOffice).continuousReview,
        scheduler: intelligenceScheduler,
        tradeDrafts,
      }), shadowPortfolio, snapshot);
      portfolioPlan.decisions = normalizeStockOfficeState(state.stockOffice).proposalDecisions;
      const simulationLab = readStockSimulationLab() || refreshStockSimulationLab({ state, plan: portfolioPlan, force: true });
      const notificationScope = stockTelegramNotifier.approvalScope();
      const notificationApproval = notificationScope.destinationHash
        ? (state.approvals || []).find((item) => {
            const details = item.grantedDetails || item.originalDetails || item.details || {};
            const eventTypes = Array.isArray(details.eventTypes) ? details.eventTypes : [];
            return item.actionType === STOCK_TELEGRAM_APPROVAL_ACTION
              && item.linkedId === `stock-office:telegram:${notificationScope.destinationHash}`
              && notificationScope.eventTypes.every((type) => eventTypes.includes(type));
          }) || null
        : null;
      const notificationStatus = stockTelegramNotifier.publicStatus(state.approvals || []);
      const systemHealth = stockOfficeSystemHealth({ snapshot, brokerControl, notificationStatus, scheduler: intelligenceScheduler, state });
      sendJson(res, 200, {
        brokerControl,
        portfolioPlan,
        intelligence: snapshot.intelligence,
        systemHealth,
        shadowPortfolio,
        simulationLab,
        intelligenceScheduler,
        marketWorkers: buildStockMarketWorkers({ snapshot, brokerControl, portfolioPlan, intelligenceScheduler, intelligence: snapshot.intelligence }),
        flowManagers: getStockFlowManagerSupervisor().getStatus(),
        notificationStatus,
        notificationApproval: notificationApproval ? {
          id: notificationApproval.id,
          status: notificationApproval.status,
          expiresAt: notificationApproval.expiresAt || null,
          activatedAt: notificationApproval.activatedAt || null,
        } : null,
        robinhoodConnection: robinhoodMcpClient.publicStatus(),
        connectionApproval: connectionApproval ? {
          id: connectionApproval.id,
          status: connectionApproval.status,
          consumedAt: connectionApproval.consumedAt || null,
          expiresAt: connectionApproval.expiresAt || null,
        } : null,
        guardrailApproval: guardrailApproval ? {
          id: guardrailApproval.id,
          status: guardrailApproval.status,
          expiresAt: guardrailApproval.expiresAt || null,
          fingerprint: String(guardrailDetails.fingerprint || ""),
          guardrails: normalizeGuardrails(guardrailDetails.guardrails || {}),
        } : null,
        guardrailsSource: snapshot.guardrailsSource,
        tradeDrafts,
        permissions: access.permissions,
      });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stock-office/managers/validate") {
    try {
      enforceStockOfficeRateLimit(req, "flow-manager-validate", 30, 60_000);
      requireStockOfficeAccess(req, "broker_view");
      const flowManagers = getStockFlowManagerSupervisor().runNow();
      sendJson(res, 200, {
        flowManagers,
        liveOrderPlaced: false,
        brokerCalled: false,
        humanGateCreated: false,
      });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  const stockFlowManagerMatch = url.pathname.match(/^\/api\/stock-office\/managers\/(research|simulation)$/);
  if (req.method === "POST" && stockFlowManagerMatch) {
    try {
      enforceStockOfficeRateLimit(req, "flow-manager-update", 20, 60_000);
      requireStockOfficeAccess(req, "broker_view");
      const body = await readBody(req);
      if (typeof body.enabled !== "boolean") throw guardedError("Manager activation must be true or false.", 400);
      const flowManagers = getStockFlowManagerSupervisor().setEnabled(stockFlowManagerMatch[1], body.enabled);
      sendJson(res, 200, {
        flowManagers,
        liveOrderPlaced: false,
        brokerCalled: false,
        humanGateCreated: false,
      });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  const stockProposalDecisionMatch = url.pathname.match(/^\/api\/stock-office\/proposals\/([^/]+)\/decline$/);
  if (req.method === "POST" && stockProposalDecisionMatch) {
    try {
      enforceStockOfficeRateLimit(req, "proposal-decline", 30, 300_000);
      requireStockOfficeAccess(req, "order_draft");
      const state = readState();
      const snapshot = stockOfficeSnapshot(state);
      const portfolioPlan = buildCopyPortfolioPlan(snapshot);
      const proposalId = decodeURIComponent(stockProposalDecisionMatch[1]);
      const proposal = portfolioPlan.proposals.find((item) => item.id === proposalId);
      if (!proposal) throw guardedError("Trade proposal is no longer current. Refresh Overview.", 409);
      const current = normalizeStockOfficeState(state.stockOffice);
      const decision = {
        proposalId: proposal.id,
        fingerprint: proposal.fingerprint,
        symbol: proposal.symbol,
        side: proposal.side,
        decision: "declined",
        decidedAt: now(),
      };
      state.stockOffice = normalizeStockOfficeState({
        ...current,
        proposalDecisions: [decision, ...current.proposalDecisions.filter((item) => item.proposalId !== proposal.id)],
      });
      audit(state, "Stock Office proposal declined", `${proposal.side} ${proposal.symbol} research proposal was dismissed locally; no Human Gate request, broker review, order, or money movement occurred.`);
      writeState(state);
      sendJson(res, 200, { decision, liveOrderPlaced: false, humanGateCreated: false });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  const stockPaperProposalMatch = url.pathname.match(/^\/api\/stock-office\/proposals\/([^/]+)\/paper-test$/);
  if (req.method === "POST" && stockPaperProposalMatch) {
    try {
      enforceStockOfficeRateLimit(req, "proposal-paper-test", 20, 300_000);
      requireStockOfficeAccess(req, "order_draft");
      const state = readState();
      const snapshot = stockOfficeSnapshot(state);
      const proposalId = decodeURIComponent(stockPaperProposalMatch[1]);
      const proposal = buildCopyPortfolioPlan(snapshot).proposals.find((item) => item.id === proposalId);
      if (!proposal) throw guardedError("Trade proposal is no longer current. Refresh Overview.", 409);
      const result = applyPaperProposal(readStockShadowPortfolio(snapshot), snapshot, proposal);
      if (result.action.outcome !== "filled") throw guardedError(result.action.reason || "Paper test is not currently eligible.", 409);
      writeStockShadowPortfolio(result.portfolio);
      audit(
        state,
        "Stock Office proposal paper-tested",
        `${proposal.side} ${proposal.symbol} recorded a $${result.action.requestedDollars.toFixed(2)} simulated fill. No Robinhood call, money movement, Human Gate request, or live order occurred.`,
      );
      writeState(state);
      const plan = withPaperProposalReadiness(buildCopyPortfolioPlan(snapshot), result.portfolio, snapshot);
      sendJson(res, 200, {
        action: result.action,
        shadowPortfolio: result.portfolio,
        portfolioPlan: plan,
        liveOrderPlaced: false,
        brokerCalled: false,
      });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stock-office/notifications/telegram/configure") {
    try {
      enforceStockOfficeRateLimit(req, "telegram-configure", 6, 300_000);
      requireStockOfficeAccess(req, "broker_guardrails");
      const payload = await readBody(req);
      const state = readState();
      const notificationStatus = stockTelegramNotifier.configure({ botToken: payload.botToken, chatId: payload.chatId }, state.approvals || []);
      audit(state, "Stock Office Telegram configured", "Telegram destination and bot credentials were stored in local secure storage; values were not written to Argentum state or returned to the browser.");
      writeState(state);
      sendJson(res, 200, { notificationStatus, liveOrderPlaced: false, messageSent: false });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "DELETE" && url.pathname === "/api/stock-office/notifications/telegram/configure") {
    try {
      enforceStockOfficeRateLimit(req, "telegram-remove", 4, 300_000);
      requireStockOfficeAccess(req, "broker_guardrails");
      const state = readState();
      const notificationStatus = stockTelegramNotifier.removeConfiguration(state.approvals || []);
      audit(state, "Stock Office Telegram removed", "Telegram notifications were disabled and both local secure values were removed.");
      writeState(state);
      sendJson(res, 200, { notificationStatus, liveOrderPlaced: false, messageSent: false });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stock-office/notifications/telegram/human-gate") {
    try {
      enforceStockOfficeRateLimit(req, "telegram-gate", 5, 300_000);
      requireStockOfficeAccess(req, "broker_guardrails");
      const state = readState();
      const scope = stockTelegramNotifier.approvalScope();
      if (!scope.configured) throw guardedError("Configure the Telegram bot token and chat ID before requesting notification approval.", 409);
      const approvalResult = createHumanGateRequest({
        actionType: STOCK_TELEGRAM_APPROVAL_ACTION,
        title: "Enable Stock Office Telegram command center",
        riskLevel: "medium",
        linkedId: `stock-office:telegram:${scope.destinationHash}`,
        officeId: "stock-office",
        workflowId: "workflow-stock-watch",
        evidence: `${scope.destination} is configured in local secure storage. No credential value is available to the browser.`,
        action: "Allow Stock Office to send research-only recommendation summaries, actionable approval cards, broker outcomes, source/broker failures, persisted night and morning reports, health replies, and operator-requested command responses to the one authorized Telegram destination.",
        exactScope: "Telegram only, one configured private destination or an environment-allowlisted group user. Research recommendation alerts are read-only summaries with WATCH and RESEARCH controls; they never create an order or Human Gate approval. Human Gate approvals reference immutable internal approval IDs and use the same one-use broker path as web approvals. No raw Telegram text can create an order. Ordinary rejected research candidates, unverified fills, and secret values are excluded.",
        details: {
          officeId: "stock-office",
          channel: scope.channel,
          destinationHash: scope.destinationHash,
          eventTypes: STOCK_TELEGRAM_EVENT_TYPES,
          automaticBrokerNotifications: true,
          qualifiedProposalAlertsAuthorized: true,
          researchRecommendationAlertsAuthorized: true,
          remoteCommandsAuthorized: true,
          reportsAuthorized: true,
          brokerAndSourceFailureAlertsAuthorized: true,
          rejectedResearchAlertsAuthorized: false,
          blockedDraftsAuthorized: false,
          paperTradesAuthorized: false,
          customerContactAuthorized: false,
        },
        reversible: true,
        expiresAt: new Date(Date.now() + 365 * DAY_MS).toISOString(),
        expectedPostcondition: "The exact Telegram destination may receive research-only recommendation summaries, qualified Human Gate proposal alerts, verified broker order alerts, and requested connection tests.",
        rollbackPlan: "Disable Telegram in Stock Office or remove its secure configuration immediately.",
      });
      sendJson(res, 200, { ...approvalResult, notificationStatus: stockTelegramNotifier.publicStatus(readState().approvals || []), liveOrderPlaced: false, messageSent: false });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stock-office/notifications/telegram/enable") {
    try {
      enforceStockOfficeRateLimit(req, "telegram-enable", 5, 300_000);
      requireStockOfficeAccess(req, "broker_guardrails");
      const payload = await readBody(req);
      const state = readState();
      const approval = (state.approvals || []).find((item) => item.id === String(payload.approvalId || ""));
      if (!approval) throw guardedError("Approved Telegram notification request not found.", 404);
      const result = stockTelegramNotifier.enable(approval, state.approvals || []);
      approval.activatedAt = now();
      approval.activatedBy = "stock-office";
      audit(state, "Stock Office Telegram enabled", "The approved server-side Telegram channel can now send research recommendation alerts, qualified Human Gate proposal alerts, broker-confirmed trade alerts, and operator-requested tests.");
      writeState(state);
      sendJson(res, 200, { notificationStatus: result.status, liveOrderPlaced: false, messageSent: false });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stock-office/notifications/telegram/disable") {
    try {
      enforceStockOfficeRateLimit(req, "telegram-disable", 8, 300_000);
      requireStockOfficeAccess(req, "broker_guardrails");
      const state = readState();
      const result = stockTelegramNotifier.disable(state.approvals || []);
      audit(state, "Stock Office Telegram disabled", "Automatic Telegram notifications were stopped; no broker or account setting changed.");
      writeState(state);
      sendJson(res, 200, { notificationStatus: result.status, liveOrderPlaced: false, messageSent: false });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stock-office/notifications/telegram/test") {
    try {
      enforceStockOfficeRateLimit(req, "telegram-test", 3, 300_000);
      requireStockOfficeAccess(req, "broker_guardrails");
      const state = readState();
      const delivery = await stockTelegramNotifier.sendTest(state.approvals || []);
      audit(state, delivery.sent ? "Stock Office Telegram test delivered" : "Stock Office Telegram test stopped", delivery.sent ? "One operator-requested Telegram test was delivered." : `No message sent: ${delivery.reason || delivery.state}.`);
      writeState(state);
      sendJson(res, delivery.sent ? 200 : 409, { delivery, notificationStatus: stockTelegramNotifier.publicStatus(state.approvals || []), liveOrderPlaced: false });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stock-office/shadow/reset") {
    try {
      enforceStockOfficeRateLimit(req, "shadow-reset", 4, 300_000);
      requireStockOfficeAccess(req, "broker_guardrails");
      const payload = await readBody(req);
      const requestedCash = payload.startingCashDollars === undefined ? null : Number(payload.startingCashDollars);
      if (requestedCash !== null && (!Number.isFinite(requestedCash) || requestedCash < 1 || requestedCash > 1_000_000)) {
        throw guardedError("Paper starting cash must be between $1 and $1,000,000.", 400);
      }
      const state = readState();
      const snapshot = stockOfficeSnapshot(state);
      const shadowPortfolio = resetShadowPortfolio(snapshot, { startingCashDollars: requestedCash });
      writeStockShadowPortfolio(shadowPortfolio);
      audit(
        state,
        "Stock Office paper shadow portfolio reset",
        `A fresh $${shadowPortfolio.initialCashDollars.toFixed(2)} simulated portfolio was created. No broker call, money movement, or live order occurred.`,
      );
      writeState(state);
      sendJson(res, 200, { shadowPortfolio, liveOrderPlaced: false, brokerCalled: false });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stock-office/robinhood/status") {
    try {
      enforceStockOfficeRateLimit(req, "robinhood-status", 80, 60_000);
      requireStockOfficeAccess(req, "broker_view");
      const state = readState();
      const approval = (state.approvals || []).find((item) => item.linkedId === "stock-office:robinhood-agentic-mcp:onboarding") || null;
      sendJson(res, 200, {
        connection: robinhoodMcpClient.publicStatus(),
        connectionApproval: approval ? {
          id: approval.id,
          status: approval.status,
          consumedAt: approval.consumedAt || null,
          expiresAt: approval.expiresAt || null,
        } : null,
        liveOrderPlaced: false,
      });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stock-office/robinhood/oauth/start") {
    try {
      enforceStockOfficeRateLimit(req, "robinhood-oauth-start", 3, 300_000);
      requireStockOfficeAccess(req, "broker_connect");
      const state = readState();
      const approval = (state.approvals || []).find((item) => item.linkedId === "stock-office:robinhood-agentic-mcp:onboarding" && item.status === "approved" && !item.consumedAt);
      if (!approval) throw guardedError("Approve the exact Robinhood connection request in Human Gate before starting OAuth.", 409);
      const details = approval.grantedDetails || approval.originalDetails || approval.details || {};
      if (details.provider !== "robinhood_agentic_mcp" || details.accountScope !== "dedicated_agentic_account_only" || details.orderPlacementAuthorized !== false || details.moneyMovementAuthorized !== false) {
        throw guardedError("The approved Robinhood connection scope does not match the required read-only Agentic-account onboarding contract.", 409);
      }
      const redirectUri = `http://127.0.0.1:${PORT}/api/stock-office/robinhood/oauth/callback`;
      const started = await robinhoodMcpClient.beginAuthorization({ redirectUri, approvalId: approval.id });
      approval.oauthStartedAt = now();
      audit(state, "Robinhood OAuth handoff prepared", `Human Gate approval ${approval.id} opened only the official Robinhood OAuth flow; no order or money movement was authorized.`);
      writeState(state);
      sendJson(res, 200, { ...started, liveOrderPlaced: false });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stock-office/robinhood/oauth/callback") {
    try {
      const completed = await robinhoodMcpClient.completeAuthorization({
        state: url.searchParams.get("state") || "",
        code: url.searchParams.get("code") || "",
      });
      const state = readState();
      const approval = (state.approvals || []).find((item) => item.id === completed.approvalId);
      if (!approval || approval.status !== "approved" || approval.consumedAt) {
        robinhoodMcpClient.disconnect();
        throw guardedError("The Robinhood connection approval is no longer valid. The local OAuth token was removed.", 409);
      }
      approval.useCount = Number(approval.useCount || 0) + 1;
      approval.consumedAt = now();
      approval.executionOutcome = "robinhood_oauth_connected";
      let refreshError = "";
      try {
        await robinhoodMcpClient.refreshBrokerSnapshot();
      } catch (error) {
        refreshError = error.message;
      }
      audit(state, "Robinhood OAuth completed", refreshError
        ? `Official OAuth completed, but the dedicated Agentic-account snapshot did not verify: ${refreshError}`
        : "Official OAuth and the dedicated Agentic-account read-only snapshot verified; no order or money movement occurred.");
      writeState(state);
      sendRobinhoodOauthResultPage(req, res, refreshError ? "needs_refresh" : "connected");
    } catch (error) {
      sendRobinhoodOauthResultPage(req, res, "connection_error");
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stock-office/robinhood/refresh") {
    try {
      enforceStockOfficeRateLimit(req, "robinhood-refresh", 12, 60_000);
      requireStockOfficeAccess(req, "broker_view");
      const broker = await robinhoodMcpClient.refreshBrokerSnapshot();
      const snapshot = stockOfficeSnapshot(readState());
      sendJson(res, 200, {
        connection: robinhoodMcpClient.publicStatus(),
        brokerControl: brokerControlOverview(snapshot),
        broker: {
          account: broker.account,
          buyingPower: broker.buyingPower,
          positions: broker.positions.length,
          openOrders: broker.openOrders.length,
          updatedAt: broker.updatedAt,
        },
        liveOrderPlaced: false,
      });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stock-office/broker-connect/human-gate") {
    try {
      enforceStockOfficeRateLimit(req, "broker-connect", 4, 300_000);
      requireStockOfficeAccess(req, "broker_connect");
      const snapshot = stockOfficeSnapshot(readState());
      const control = brokerControlOverview(snapshot);
      const approvalResult = createHumanGateRequest({
        actionType: "connect_robinhood_agentic_mcp",
        title: "Connect the dedicated Robinhood Agentic account",
        riskLevel: "high",
        linkedId: "stock-office:robinhood-agentic-mcp:onboarding",
        officeId: "stock-office",
        workflowId: "workflow-stock-watch",
        evidence: `Robinhood Trading MCP is registered at ${control.endpoint}. Current connector status: ${control.connectorStatus}. Authentication is not treated as complete until a fresh account snapshot is returned.`,
        action: "Authorize opening Robinhood's official OAuth/onboarding flow for a dedicated Agentic Trading account. This approval does not authorize a deposit, transfer, order, option trade, crypto trade, or event contract.",
        exactScope: `Connect only the official Robinhood Trading MCP endpoint ${control.endpoint}, authenticate through Robinhood, and verify the dedicated Agentic account. No money movement or order placement is included.`,
        details: {
          officeId: "stock-office",
          provider: "robinhood_agentic_mcp",
          endpoint: control.endpoint,
          accountScope: control.accountScope,
          allowedResult: "fresh_read_only_account_snapshot",
          orderPlacementAuthorized: false,
          moneyMovementAuthorized: false,
        },
        reversible: true,
        expectedPostcondition: "Robinhood OAuth returns a fresh read-only Agentic-account snapshot and required MCP tool availability; no order is placed.",
        rollbackPlan: "Disconnect the Robinhood Trading MCP from Robinhood or Codex and keep the live-order kill switch active.",
      });
      sendJson(res, 200, { ...approvalResult, brokerControl: control, liveOrderPlaced: false });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stock-office/guardrails/human-gate") {
    try {
      enforceStockOfficeRateLimit(req, "broker-guardrails", 8, 300_000);
      requireStockOfficeAccess(req, "broker_guardrails");
      const payload = await readBody(req);
      const requested = normalizeGuardrails(payload);
      if (requested.principalDollars <= 0 || requested.maxTotalDollars <= 0 || requested.maxOrderDollars <= 0) {
        throw guardedError("Principal, maximum deployed capital, and per-order cap must be greater than zero.", 400);
      }
      if (requested.maxOrderDollars > requested.maxTotalDollars || requested.maxTotalDollars > requested.principalDollars) {
        throw guardedError("Per-order cap must not exceed maximum deployed capital, and maximum deployed capital must not exceed principal.", 400);
      }
      const fingerprint = crypto.createHash("sha256").update(JSON.stringify(requested)).digest("hex");
      const approvalResult = createHumanGateRequest({
        actionType: "change_stock_trading_guardrails",
        title: "Review Stock Office capital limits",
        riskLevel: "high",
        linkedId: `stock-office:guardrails:${fingerprint}`,
        officeId: "stock-office",
        workflowId: "workflow-stock-watch",
        evidence: `Requested principal $${requested.principalDollars.toFixed(2)}, maximum deployed $${requested.maxTotalDollars.toFixed(2)}, maximum order $${requested.maxOrderDollars.toFixed(2)}, cash reserve $${requested.cashReserveDollars.toFixed(2)}, daily loss lock ${(requested.dailyLossLimitPct * 100).toFixed(2)}%.`,
        action: "Review these exact risk limits. Approval changes no Robinhood setting and moves no money by itself.",
        exactScope: `Approve only guardrail fingerprint ${fingerprint}: ${JSON.stringify(requested)}. No deposit, transfer, account change, or broker order is included.`,
        details: {
          officeId: "stock-office",
          fingerprint,
          guardrails: requested,
          moneyMovementAuthorized: false,
          orderPlacementAuthorized: false,
        },
        reversible: true,
        expectedPostcondition: "The exact capital-policy proposal is approved for a later controlled configuration apply; no external financial action occurs.",
        rollbackPlan: "Reject or supersede this proposal before applying it; if later applied, create a new approval to restore prior limits.",
      });
      sendJson(res, 200, { ...approvalResult, guardrails: requested, liveOrderPlaced: false });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stock-office/guardrails/apply") {
    try {
      enforceStockOfficeRateLimit(req, "broker-guardrails-apply", 6, 300_000);
      requireStockOfficeAccess(req, "broker_guardrails");
      const payload = await readBody(req);
      const state = readState();
      const approval = (state.approvals || []).find((item) => item.id === String(payload.approvalId || ""));
      if (!approval || approval.actionType !== "change_stock_trading_guardrails") throw guardedError("Approved capital-policy request not found.", 404);
      if (approval.status !== "approved" || approval.consumedAt || Number(approval.useCount || 0) > 0) {
        throw guardedError("Capital-policy approval is not approved and unused.", 409);
      }
      if (approval.expiresAt && new Date(approval.expiresAt).getTime() <= Date.now()) throw guardedError("Capital-policy approval expired.", 409);
      const details = approval.grantedDetails || approval.originalDetails || approval.details || {};
      const requested = normalizeGuardrails(details.guardrails || {});
      const fingerprint = crypto.createHash("sha256").update(JSON.stringify(requested)).digest("hex");
      if (!details.fingerprint || details.fingerprint !== fingerprint || approval.linkedId !== `stock-office:guardrails:${fingerprint}`) {
        throw guardedError("Capital-policy approval fingerprint does not match the exact limits.", 409);
      }
      if (requested.principalDollars <= 0 || requested.maxTotalDollars <= 0 || requested.maxOrderDollars <= 0
        || requested.maxOrderDollars > requested.maxTotalDollars || requested.maxTotalDollars > requested.principalDollars) {
        throw guardedError("Approved capital limits are internally invalid.", 409);
      }
      const current = normalizeStockOfficeState(state.stockOffice);
      const appliedAt = now();
      state.stockOffice = normalizeStockOfficeState({
        ...current,
        activeGuardrails: requested,
        guardrailsAppliedAt: appliedAt,
        guardrailsApprovalId: approval.id,
      });
      approval.useCount = Number(approval.useCount || 0) + 1;
      approval.consumedAt = appliedAt;
      approval.executionOutcome = "stock_guardrails_applied_locally";
      audit(state, "Stock Office capital limits applied", `Exact Human Gate fingerprint ${fingerprint} became the active local order policy. No deposit, transfer, broker setting, or order occurred.`);
      writeState(state);
      const snapshot = stockOfficeSnapshot(readState());
      sendJson(res, 200, {
        guardrails: snapshot.guardrails,
        guardrailsSource: snapshot.guardrailsSource,
        brokerControl: brokerControlOverview(snapshot),
        portfolioPlan: buildCopyPortfolioPlan(snapshot),
        approval: { id: approval.id, status: approval.status, consumedAt: approval.consumedAt },
        moneyMoved: false,
        liveOrderPlaced: false,
      });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  const stockProposalRiskReviewMatch = url.pathname.match(/^\/api\/stock-office\/proposals\/([^/]+)\/risk-review$/);
  if (req.method === "POST" && stockProposalRiskReviewMatch) {
    try {
      enforceStockOfficeRateLimit(req, "proposal-risk-review", 8, 300_000);
      const access = requireStockOfficeAccess(req, "order_approval");
      const state = readState();
      const snapshot = stockOfficeSnapshot(state, access.permissions);
      const proposalId = decodeURIComponent(stockProposalRiskReviewMatch[1]);
      const proposal = buildCopyPortfolioPlan(snapshot).proposals.find((item) => item.id === proposalId);
      if (!proposal) throw guardedError("Current proposal not found. Refresh Research before requesting a risk review.", 404);
      const approvalResult = createStockRiskReviewRequest(proposal);
      const auditState = readState();
      audit(auditState, "Stock strategy risk review requested", `${proposal.symbol} was sent to Human Gate for advisory strategy review only; no broker call, policy exception, or order occurred.`);
      writeState(auditState);
      sendJson(res, 200, {
        ...approvalResult,
        proposal,
        orderAuthorized: false,
        brokerCalled: false,
        liveOrderPlaced: false,
      });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stock-office/orders/draft") {
    try {
      enforceStockOfficeRateLimit(req, "order-draft", 20, 300_000);
      const access = requireStockOfficeAccess(req, "order_draft");
      const payload = await readBody(req);
      const state = readState();
      const snapshot = stockOfficeSnapshot(state, access.permissions);
      const draft = buildTradeDraft({
        symbol: payload.symbol,
        side: payload.side,
        requestedDollars: payload.requestedDollars,
        candidateId: payload.candidateId,
      }, snapshot, { approvalTtlMinutes: stockApprovalTtlMinutes() });
      const current = normalizeStockOfficeState(state.stockOffice);
      state.stockOffice = normalizeStockOfficeState({
        ...current,
        tradeDrafts: [draft, ...current.tradeDrafts.filter((item) => item.fingerprint !== draft.fingerprint)],
      });
      audit(state, "Stock Office order draft", `${draft.side} ${draft.symbol} $${draft.requestedDollars.toFixed(2)}: ${draft.status}; ${draft.blockers.length} blocker(s); no live order placed.`);
      writeState(state);
      sendJson(res, 200, {
        draft,
        brokerControl: brokerControlOverview(stockOfficeSnapshot(readState(), access.permissions)),
        liveOrderPlaced: false,
      });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  const stockOrderGateMatch = url.pathname.match(/^\/api\/stock-office\/orders\/([^/]+)\/human-gate$/);
  if (req.method === "POST" && stockOrderGateMatch) {
    try {
      enforceStockOfficeRateLimit(req, "order-human-gate", 10, 300_000);
      requireStockOfficeAccess(req, "order_approval");
      const executionSession = marketSession();
      if (process.env.NODE_ENV !== "test" && !executionSession.regular) {
        throw guardedError(`${executionSession.label}. This regular-hours market order cannot enter Human Gate until the regular session is open. Research remains active.`, 409);
      }
      const state = readState();
      const snapshot = stockOfficeSnapshot(state);
      const draft = snapshot.tradeDrafts.find((item) => item.id === decodeURIComponent(stockOrderGateMatch[1]));
      if (!draft) throw guardedError("Order draft not found.", 404);
      if (new Date(draft.expiresAt).getTime() <= Date.now()) throw guardedError("Order draft expired. Rebuild it with fresh market and broker data.", 409);
      if (draft.status !== "ready_for_broker_review" || draft.blockers.length) {
        throw guardedError(`Order draft is blocked: ${draft.blockers[0] || "fresh broker review is unavailable"}`, 409);
      }
      const { approvalResult, envelope } = createStockOrderApprovalRequest(draft);
      const latestState = readState();
      const current = normalizeStockOfficeState(latestState.stockOffice);
      const awaitingDraft = tradeDraftWithApprovalState({
        ...draft,
        approvalId: approvalResult.approval.id,
        status: "awaiting_human_gate",
        updatedAt: now(),
      }, [approvalResult.approval]);
      latestState.stockOffice = normalizeStockOfficeState({
        ...current,
        tradeDrafts: [awaitingDraft, ...current.tradeDrafts.filter((item) => item.id !== draft.id)],
      });
      audit(latestState, "Stock Office order awaiting Human Gate", `${draft.side} ${draft.symbol} order fingerprint ${draft.fingerprint} is awaiting one-use approval; no live order placed.`);
      writeState(latestState);
      const matchingProposal = buildCopyPortfolioPlan(snapshot).proposals.find((proposal) => proposal.draftFingerprint === draft.fingerprint);
      const notificationState = readState();
      const notificationDelivery = await notifyStockOrderHumanGate(
        awaitingDraft,
        approvalResult.approval,
        matchingProposal,
        notificationState.approvals || [],
      ).catch((error) => ({ sent: false, state: "failed", reason: redactSensitiveText(error.message).slice(0, 300) }));
      const auditState = readState();
      audit(auditState, notificationDelivery.sent ? "Qualified proposal Telegram delivered" : "Qualified proposal Telegram not delivered", notificationDelivery.sent
        ? `${draft.side} ${draft.symbol} Human Gate approval card delivered.`
        : `No proposal approval card sent: ${notificationDelivery.reason || notificationDelivery.state}.`);
      writeState(auditState);
      sendJson(res, 200, { ...approvalResult, draft: awaitingDraft, envelope, notificationDelivery, liveOrderPlaced: false });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  const stockDirectExecuteMatch = url.pathname.match(/^\/api\/stock-office\/orders\/([^/]+)\/dispatch\/execute$/);
  if (req.method === "POST" && stockDirectExecuteMatch) {
    try {
      enforceStockOfficeRateLimit(req, "order-direct-execute", 3, 300_000);
      const access = requireStockOfficeAccess(req, "order_approval");
      const payload = await readBody(req);
      const draftId = decodeURIComponent(stockDirectExecuteMatch[1]);
      const execution = await executeApprovedStockDraft(draftId, {
        permissions: access.permissions,
        confirmationFingerprint: payload.confirmationFingerprint,
      });
      sendJson(res, 200, execution);
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }
  const stockDispatchClaimMatch = url.pathname.match(/^\/api\/stock-office\/orders\/([^/]+)\/dispatch\/claim$/);
  if (req.method === "POST" && stockDispatchClaimMatch) {
    try {
      enforceStockOfficeRateLimit(req, "order-dispatch-claim", 6, 300_000);
      const access = requireStockOfficeAccess(req, "order_approval");
      const state = readState();
      const snapshot = stockOfficeSnapshot(state, access.permissions);
      const draftId = decodeURIComponent(stockDispatchClaimMatch[1]);
      const draft = snapshot.tradeDrafts.find((item) => item.id === draftId);
      if (!draft) throw guardedError("Order draft not found.", 404);
      const approval = (state.approvals || []).find((item) => item.id === draft.approvalId)
        || (state.approvals || []).find((item) => item.linkedId === `stock-office:order:${draft.fingerprint}`);
      if (!approval) throw guardedError("Exact Human Gate order approval not found.", 409);
      const claimed = claimApprovedDispatch(draft, approval, snapshot);
      const current = normalizeStockOfficeState(state.stockOffice);
      state.stockOffice = normalizeStockOfficeState({
        ...current,
        tradeDrafts: [claimed.draft, ...current.tradeDrafts.filter((item) => item.id !== draft.id)],
      });
      approval.dispatchClaimId = claimed.claim.id;
      approval.dispatchClaimedAt = claimed.draft.dispatchClaimedAt;
      approval.dispatchClaimExpiresAt = claimed.claim.expiresAt;
      audit(state, "Stock Office one-use dispatch claimed", `${draft.side} ${draft.symbol} claim ${claimed.claim.id} expires ${claimed.claim.expiresAt}; broker review required before any placement.`);
      writeState(state);
      sendJson(res, 200, {
        claim: claimed.claim,
        draft: claimed.draft,
        liveOrderPlaced: false,
        warning: "This claim is single-use. Run Robinhood review first and submit the result before expiry; never place on warnings or changed scope.",
      });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  const stockDispatchResultMatch = url.pathname.match(/^\/api\/stock-office\/orders\/([^/]+)\/dispatch\/result$/);
  if (req.method === "POST" && stockDispatchResultMatch) {
    try {
      enforceStockOfficeRateLimit(req, "order-dispatch-result", 6, 300_000);
      const access = requireStockOfficeAccess(req, "order_approval");
      const payload = await readBody(req);
      const state = readState();
      const snapshot = stockOfficeSnapshot(state, access.permissions);
      const draftId = decodeURIComponent(stockDispatchResultMatch[1]);
      const draft = snapshot.tradeDrafts.find((item) => item.id === draftId);
      if (!draft) throw guardedError("Order draft not found.", 404);
      const approvalIndex = (state.approvals || []).findIndex((item) => item.id === draft.approvalId || item.linkedId === `stock-office:order:${draft.fingerprint}`);
      if (approvalIndex < 0) throw guardedError("Exact Human Gate order approval not found.", 409);
      const settled = settleApprovedDispatch(draft, state.approvals[approvalIndex], payload, payload.claimToken);
      const current = normalizeStockOfficeState(state.stockOffice);
      state.stockOffice = normalizeStockOfficeState({
        ...current,
        tradeDrafts: [settled.draft, ...current.tradeDrafts.filter((item) => item.id !== draft.id)],
      });
      state.approvals[approvalIndex] = settled.approval;
      audit(
        state,
        settled.liveOrderPlaced ? "Stock Office broker order recorded" : "Stock Office dispatch stopped safely",
        settled.liveOrderPlaced
          ? `${draft.side} ${draft.symbol} reconciled to broker order ${settled.draft.brokerOrderId}; one-use approval consumed.`
          : `${draft.side} ${draft.symbol} stopped after broker review or incomplete placement evidence; no live order recorded; one-use approval consumed.`,
      );
      writeState(state);
      sendJson(res, 200, {
        draft: settled.draft,
        approval: settled.approval,
        liveOrderPlaced: settled.liveOrderPlaced,
      });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  const stockMirrorGateMatch = url.pathname.match(/^\/api\/stock-office\/mirror\/([^/]+)\/human-gate$/);
  if (req.method === "POST" && stockMirrorGateMatch) {
    try {
      enforceStockOfficeRateLimit(req, "mirror-gate", 10, 300_000);
      const access = requireStockOfficeAccess(req, "mirror_request");
      const state = readState();
      const snapshot = stockOfficeSnapshot(state, access.permissions);
      const candidate = getMirrorCandidate(snapshot, decodeURIComponent(stockMirrorGateMatch[1]));
      if (!candidate) throw guardedError("Copy Trader candidate not found.", 404);
      if (snapshot.mirror.stale) throw guardedError("Copy Trader plan is stale. Refresh the public signal and current price before Human Gate review.", 409);
      if (!candidate.humanGateEligible || candidate.status !== "paper_ready") {
        throw guardedError("Only a fresh paper-ready mirror candidate can be sent to Human Gate.", 409);
      }
      if (!candidate.sourceUrl || !candidate.fingerprint) {
        throw guardedError("Mirror candidate provenance is incomplete.", 409);
      }
      const mirrorNotionalLabel = `$${Number(candidate.mirrorNotionalDollars || 0).toFixed(2)}`;
      const approvalResult = createHumanGateRequest({
        actionType: "review_trade_plan",
        title: `Review copy-mirror plan: ${candidate.side} ${candidate.symbol}`,
        riskLevel: "high",
        linkedId: `stock-mirror:${candidate.fingerprint}`,
        officeId: "stock-office",
        workflowId: "workflow-stock-watch",
        evidence: `${candidate.traderName} public signal from ${candidate.sourceName}. Reported transaction ${candidate.transactionAt}; disclosed ${candidate.disclosedAt}; disclosure lag ${candidate.disclosureLagHours.toFixed(1)}h; current-price drift ${candidate.priceDriftPct === null ? "unknown" : `${(candidate.priceDriftPct * 100).toFixed(2)}%`}; provenance ${candidate.sourceUrl}.`,
        action: `Review a capped ${mirrorNotionalLabel} ${candidate.side} ${candidate.symbol} mirror plan. This plan-review approval records the decision only and is not an order approval.`,
        exactScope: `Review only: ${candidate.side} ${candidate.symbol}, maximum ${mirrorNotionalLabel}, source fingerprint ${candidate.fingerprint}. No order placement, money movement, account change, event-contract trade, or recurring authorization is included.`,
        details: {
          officeId: "stock-office",
          candidateId: candidate.id,
          fingerprint: candidate.fingerprint,
          symbol: candidate.symbol,
          side: candidate.side,
          maxNotionalDollars: candidate.mirrorNotionalDollars,
          sourceName: candidate.sourceName,
          sourceUrl: candidate.sourceUrl,
          disclosureLagHours: candidate.disclosureLagHours,
          priceDriftPct: candidate.priceDriftPct,
          executionAvailable: false,
        },
        reversible: true,
        expectedPostcondition: "Human Gate records an operator decision on this exact mirror plan. No broker order is submitted.",
        rollbackPlan: "No external rollback is needed because this review route performs no broker action; reject or expire the review record.",
      });
      sendJson(res, 200, { ...approvalResult, candidate, liveOrderPlaced: false });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stock-office/chat") {
    try {
      enforceStockOfficeRateLimit(req, "chat-read", 80, 60_000);
      const access = requireStockOfficeAccess(req, "chat_read");
      const snapshot = stockOfficeSnapshot(readState(), access.permissions);
      sendJson(res, 200, { messages: snapshot.chatMessages, assistantRuns: snapshot.assistantRuns });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stock-office/chat") {
    try {
      enforceStockOfficeRateLimit(req, "chat-write", 20, 60_000);
      const access = requireStockOfficeAccess(req, "chat_write");
      const payload = await readBody(req);
      const question = redactSensitiveText(String(payload.message || payload.question || "").trim()).slice(0, 700);
      if (!question) throw guardedError("Stock Office question is required.", 400);
      const state = readState();
      const snapshot = stockOfficeSnapshot(state, access.permissions);
      const response = answerStockQuestion(snapshot, question);
      const current = normalizeStockOfficeState(state.stockOffice);
      const operatorMessage = {
        id: `stock-chat-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
        sender: "operator",
        text: question,
        citations: [],
        createdAt: now(),
      };
      const assistantMessage = {
        id: `stock-chat-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
        sender: "assistant",
        text: response.answer,
        citations: response.citations,
        createdAt: now(),
      };
      state.stockOffice = normalizeStockOfficeState({
        ...current,
        chatMessages: [...current.chatMessages, operatorMessage, assistantMessage],
      });
      audit(state, "Stock Office chat answered", `Answered a read-only Stock Office question with ${response.citations.length} citation(s).`);
      writeState(state);
      const updatedSnapshot = stockOfficeSnapshot(readState(), access.permissions);
      sendJson(res, 200, { response, messages: updatedSnapshot.chatMessages, assistantRuns: updatedSnapshot.assistantRuns });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stock-office/assistant") {
    try {
      enforceStockOfficeRateLimit(req, "assistant", 15, 60_000);
      const access = requireStockOfficeAccess(req, "assistant");
      const payload = await readBody(req);
      const question = redactSensitiveText(String(payload.message || payload.question || "").trim()).slice(0, 700);
      if (!question) throw guardedError("Assistant question is required.", 400);
      const state = readState();
      const snapshot = stockOfficeSnapshot(state, access.permissions);
      const response = answerStockQuestion(snapshot, question);
      const current = normalizeStockOfficeState(state.stockOffice);
      const run = {
        id: `stock-assistant-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
        question,
        answerPreview: response.answer,
        citationCount: response.citations.length,
        createdAt: now(),
      };
      const nextChatMessages =
        payload.saveToChat === false
          ? current.chatMessages
          : [
              ...current.chatMessages,
              { id: `stock-chat-${crypto.randomBytes(8).toString("hex")}`, sender: "operator", text: question, citations: [], createdAt: now() },
              { id: `stock-chat-${crypto.randomBytes(8).toString("hex")}`, sender: "assistant", text: response.answer, citations: response.citations, createdAt: now() },
            ];
      state.stockOffice = normalizeStockOfficeState({
        ...current,
        chatMessages: nextChatMessages,
        assistantRuns: [run, ...current.assistantRuns],
      });
      audit(state, "Stock Office assistant run", `Created a read-only Stock Office assistant answer with ${response.citations.length} citation(s).`);
      writeState(state);
      sendJson(res, 200, { run, response, messages: state.stockOffice.chatMessages });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stock-office/sync") {
    try {
      enforceStockOfficeRateLimit(req, "sync", 8, 300_000);
      const access = requireStockOfficeAccess(req, "sync");
      const refresh = await stockGuruRefreshManager.refresh({ stockRoot: resolveStockRoot(ROOT) });
      stockIntelligenceScheduler.recordManualRefresh(refresh);
      const state = readState();
      const snapshot = stockOfficeSnapshot(state, access.permissions);
      const syncRun = createStockOfficeSyncRun(snapshot, refresh);
      const current = normalizeStockOfficeState(state.stockOffice);
      state.stockOffice = normalizeStockOfficeState({
        ...current,
        lastLocalSyncAt: syncRun.completedAt,
        syncRuns: [syncRun, ...current.syncRuns],
      });
      audit(state, "Stock Office data refresh", `Refresh ${refresh.status}; loaded ${syncRun.recordsImported} Stock Guru record(s); 0 live orders placed.`);
      writeState(state);
      let updatedSnapshot = stockOfficeSnapshot(readState(), access.permissions);
      if (["success", "partial"].includes(refresh.status)) {
        const persisted = stockIntelligenceStore.ingestSnapshot(updatedSnapshot, {
          status: refresh.status,
          startedAt: refresh.startedAt,
          completedAt: refresh.completedAt,
          nextScheduledAt: stockIntelligenceScheduler.getStatus().nextRunAt,
          cycleType: marketSession(new Date(refresh.completedAt || Date.now())).status,
          trigger: "manual_refresh",
        });
        stockEventBus.publish("research.completed", {
          runId: persisted.runId,
          status: refresh.status,
          symbolsScanned: persisted.opportunities.length,
          reportTypes: Object.keys(persisted.reports || {}),
        }, { correlationId: persisted.correlationId });
        stockTraderResearchAgent.enqueueFromSnapshot(updatedSnapshot);
        updatedSnapshot = stockOfficeSnapshot(readState(), access.permissions);
      }
      sendJson(res, 200, { refresh, syncRun, overview: stockOverview(updatedSnapshot), records: listStockRecords(updatedSnapshot, { pageSize: 30 }) });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stock-office/refresh-status") {
    try {
      enforceStockOfficeRateLimit(req, "refresh-status", 240, 300_000);
      requireStockOfficeAccess(req, "sources");
      sendJson(res, 200, {
        refresh: stockGuruRefreshManager.getStatus(),
        intelligenceScheduler: stockIntelligenceScheduler.getStatus(),
      });
    } catch (error) {
      const response = stockOfficeErrorResponse(error);
      sendJson(res, response.status, response.payload);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, readState());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/human-gate/pending") {
    const state = readState();
    const approvals = (state.approvals || [])
      .filter((approval) => approval?.status === "pending")
      .map((approval) => ({
        id: String(approval.id || ""),
        title: redactSensitiveText(approval.title || "Approval required"),
        action: redactSensitiveText(approval.action || "Operator review required."),
        exactScope: redactSensitiveText(approval.exactScope || "Only this recorded action is included."),
        evidence: redactSensitiveText(approval.evidence || "No additional evidence was attached."),
        risk: String(approval.risk || approval.riskLevel || "medium"),
        riskLevel: String(approval.riskLevel || approval.risk || "medium"),
        officeId: String(approval.officeId || ""),
        workflowId: String(approval.workflowId || ""),
        createdAt: approval.createdAt || null,
      }))
      .slice(0, 50);
    sendJson(res, 200, { approvals, pending: approvals.length, generatedAt: now() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/access") {
    const access = currentAccessUser(req);
    if (!access?.user) {
      sendJson(res, 401, { error: "Session is no longer valid" });
      return;
    }
    sendJson(res, 200, sanitizedAccessState(access.user));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/access/password") {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, changeCurrentPassword(req, payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/access/users") {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, createAccessUser(req, payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const accessDeleteMatch = url.pathname.match(/^\/api\/access\/users\/([^/]+)\/delete$/);
  if (req.method === "POST" && accessDeleteMatch) {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, deleteAccessUser(req, accessDeleteMatch[1], payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/cycle") {
    try {
      sendJson(res, 200, advanceCycle());
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/pause") {
    const state = readState();
    state.mission.paused = !state.mission.paused;
    audit(state, state.mission.paused ? "Operator paused Agent 101" : "Operator resumed Agent 101", "The supervised task cycle was toggled by the operator.");
    writeState(state);
    sendJson(res, 200, state);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/governance/kill-switch") {
    const payload = await readBody(req);
    const state = readState();
    const nextValue = typeof payload.enabled === "boolean" ? payload.enabled : !state.governance.killSwitch;
    state.governance.killSwitch = nextValue;
    state.mission.paused = nextValue ? true : state.mission.paused;
    audit(state, nextValue ? "Kill switch enabled" : "Kill switch disabled", "Operator changed Argentum's emergency execution guard.");
    writeState(state);
    sendJson(res, 200, state);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/governance/reset-loop") {
    const state = readState();
    state.governance.cycleCount = 0;
    state.governance.estimatedSpendUsd = 0;
    state.mission.paused = false;
    audit(state, "Loop guard reset", "Operator reset cycle count and estimated local sandbox spend.");
    writeState(state);
    sendJson(res, 200, state);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tasks") {
    const payload = await readBody(req);
    sendJson(res, 200, createTask(payload));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tasks/run-next") {
    try {
      sendJson(res, 200, runNextTask());
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/workday/run") {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, runWorkday(payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const templateMatch = url.pathname.match(/^\/api\/templates\/([^/]+)\/queue$/);
  if (req.method === "POST" && templateMatch) {
    try {
      sendJson(res, 200, createTaskFromTemplate(templateMatch[1]));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const functionRunMatch = url.pathname.match(/^\/api\/functions\/([^/]+)\/run$/);
  if (req.method === "POST" && functionRunMatch) {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, runFunction(functionRunMatch[1], payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const taskRunMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/run$/);
  if (req.method === "POST" && taskRunMatch) {
    try {
      sendJson(res, 200, runTask(taskRunMatch[1]));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const approvalMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)\/(approve|revise|block)$/);
  if (req.method === "POST" && approvalMatch) {
    const [, approvalId, action] = approvalMatch;
    const currentState = readState();
    const supervisedApproval = currentState.approvals.find((item) => item.id === approvalId && (
      item.missionId
      || (item.officeId === "print-shop-office" && item.actionType === "agent101_web_search")
    ));
    if (supervisedApproval) {
      try {
        const decision = action === "approve" ? "approve" : action === "revise" ? "send_back" : "block";
        decideHumanGateRequest(approvalId, { decision });
        sendJson(res, 200, readState());
      } catch (error) {
        sendJson(res, error.status || 500, { error: error.message });
      }
      return;
    }
    const state = readState();
    const approval = state.approvals.find((item) => item.id === approvalId);
    if (!approval) {
      sendJson(res, 404, { error: "Approval not found" });
      return;
    }
    if (approval.status !== "pending") {
      sendJson(res, 409, { error: "Approval is no longer pending" });
      return;
    }
    approval.status = action === "approve" ? "approved" : action === "revise" ? "needs_revision" : "blocked";
    approval.resolvedAt = now();
    audit(state, `Approval ${approval.status}`, `${approval.title}: ${approval.action}`);
    if (approval.taskId) {
      const task = state.tasks.find((item) => item.id === approval.taskId);
      if (task) {
        task.status = approval.status === "approved" ? "approved" : approval.status;
        task.updatedAt = now();
        if (approval.artifactId) {
          const artifact = state.artifacts.find((item) => item.id === approval.artifactId);
          if (artifact) {
            artifact.status = approval.status === "approved" ? "approved" : approval.status;
            artifact.updatedAt = now();
          }
        }
        if (approval.status === "approved") {
          const fn = promoteTaskToFunction(state, task);
          addMemory(state, "shared", `Approved task: ${task.title}`, task.output, "human_approval");
          addMemory(state, "agent", `Function learned: ${fn.name}`, fn.description, "function_library");
          audit(state, "Agent 101 promoted a function", `${fn.name} is now available as an approved reusable function.`);
        }
      }
    }
    writeState(state);
    if (approval.officeId === "stock-office") {
      const details = approval.grantedDetails || approval.originalDetails || approval.details || {};
      stockIntelligenceStore.recordApproval(approval, { proposalId: details.draftId || details.candidateId || "", actorType: "WEB" });
      stockEventBus.publish(approval.status === "approved" ? "trade.approved" : approval.status === "blocked" ? "trade.rejected" : "trade.approval_revised", {
        approvalId: approval.id,
        proposalId: details.draftId || details.candidateId || "",
        symbol: details.executionEnvelope?.args?.symbol || details.symbol || "",
        decision: action,
        status: approval.status,
      }, { actorType: "WEB", id: `web:${action}:${approval.id}` });
    }
    if (action === "approve" && approval.actionType === "place_robinhood_equity_order") {
      const details = approval.grantedDetails || approval.originalDetails || approval.details || {};
      try {
        const execution = await executeApprovedStockDraft(String(details.draftId || ""), { dispatchMode: "human_gate_approval" });
        const latest = readState();
        const latestApproval = (latest.approvals || []).find((item) => item.id === approval.id);
        if (latestApproval) {
          latestApproval.executionOutcome = execution.liveOrderPlaced
            ? "broker_order_reconciled"
            : execution.reconciliationRequired
              ? "placement_outcome_unverified"
              : "broker_execution_stopped";
          latestApproval.executionDraftId = execution.draft?.id || null;
          latestApproval.executionBrokerOrderId = execution.draft?.brokerOrderId || null;
          writeState(latest);
        }
      } catch (error) {
        const latest = readState();
        const latestApproval = (latest.approvals || []).find((item) => item.id === approval.id);
        if (latestApproval) {
          latestApproval.executionOutcome = "broker_execution_stopped";
          latestApproval.executionError = redactSensitiveText(error.message || "The approved order stopped during final revalidation.").slice(0, 500);
          audit(latest, "Approved Stock Office order stopped safely", latestApproval.executionError);
          writeState(latest);
        }
      }
    }
    sendJson(res, 200, readState());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reset") {
    const state = defaultState();
    writeState(state);
    sendJson(res, 200, state);
    return;
  }

  sendJson(res, 404, { error: "Unknown API route" });
}

function serveStatic(req, res, url) {
  let filePath = url.pathname === "/" || url.pathname === "/app" ? "/index.html" : decodeURIComponent(url.pathname);
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(ROOT, filePath);

  if (!absolutePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(absolutePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const extension = path.extname(absolutePath);
    const type = mimeTypes[extension] || "application/octet-stream";
    const cacheControl = extension === ".html"
      ? "no-store"
      : APP_MODE === "local" && [".css", ".js"].includes(extension)
        ? "private, max-age=60"
        : [".css", ".js"].includes(extension)
          ? "no-store"
          : "private, max-age=300";
    res.writeHead(200, {
      ...securityHeaders(req),
      "content-type": type,
      "cache-control": cacheControl,
    });
    res.end(data);
  });
}

const PUBLIC_WEBSITE_ROUTES = new Map([
  ["/terms", "terms.html"],
  ["/terms/", "terms.html"],
  ["/privacy", "privacy.html"],
  ["/privacy/", "privacy.html"],
  ["/support", "support.html"],
  ["/support/", "support.html"],
  ["/website.css", "website.css"],
  ["/og.png", "og.png"],
  ["/robots.txt", "robots.txt"],
  ["/site.webmanifest", "site.webmanifest"],
]);

function publicWebsiteFile(url) {
  if (APP_MODE === "cloud" && url.pathname === "/") return path.join(PUBLIC_SITE_DIR, "index.html");
  if (url.pathname === "/favicon.svg") return path.join(ROOT, "desktop", "argentum-icon.svg");
  const routeFile = PUBLIC_WEBSITE_ROUTES.get(url.pathname);
  if (routeFile) return path.join(PUBLIC_SITE_DIR, routeFile);
  if (/^\/[A-Za-z0-9._-]+\.txt$/.test(url.pathname)) {
    return path.join(PUBLIC_SITE_DIR, path.basename(url.pathname));
  }
  return "";
}

function publicRequestOrigin(req) {
  const forwardedProtocol = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  const protocol = ["http", "https"].includes(forwardedProtocol)
    ? forwardedProtocol
    : req.socket?.encrypted
      ? "https"
      : "http";
  const forwardedHost = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  const host = /^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(forwardedHost) ? forwardedHost : "127.0.0.1";
  return `${protocol}://${host}`;
}

function handlePublicWebsite(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const absolutePath = publicWebsiteFile(url);
  if (!absolutePath) return false;

  fs.readFile(absolutePath, (error, data) => {
    if (error) {
      res.writeHead(404, {
        ...securityHeaders(req),
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end("Not found");
      return;
    }
    const extension = path.extname(absolutePath);
    const type = mimeTypes[extension] || "application/octet-stream";
    const body = extension === ".html"
      ? Buffer.from(data.toString("utf8").replaceAll("{{PUBLIC_ORIGIN}}", publicRequestOrigin(req)))
      : data;
    res.writeHead(200, {
      ...securityHeaders(req),
      "content-type": type,
      "cache-control": extension === ".html" ? "no-store" : "public, max-age=3600",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  });
  return true;
}

let clippingOfficeModulePromise = null;
let clippingOfficeRuntimeKey = "";

async function prewarmLocalOffices() {
  startStockShadowScheduler();
  startStockSimulationScheduler();
  startStockReadinessScheduler();
  startStockFlowManagers();
  startStockTelegramPolling();
  stockIntelligenceScheduler.start();
  stockTraderResearchAgent.start();
  if (APP_MODE !== "local") return [];
  // Clipping Office recovery resumes live media workers. Load it when its route is opened
  // instead of competing with the first visible desktop page at application startup.
  return Promise.allSettled([
    Promise.resolve().then(() => recoverAgent101Missions()),
    Promise.resolve().then(() => {
      const snapshot = loadStockOfficeSnapshot({ rootDir: ROOT, state: readState(), runtimeRoot: STOCK_GURU_RUNTIME_ROOT });
      return stockOverview(snapshot);
    }),
  ]);
}

async function shutdownLocalOffices() {
  await stockIntelligenceScheduler.stop();
  await stockTraderResearchAgent.stop();
  getStockFlowManagerSupervisor().stop();
  if (stockShadowTimer) clearInterval(stockShadowTimer);
  if (stockSimulationTimer) clearInterval(stockSimulationTimer);
  if (stockReadinessTimer) clearInterval(stockReadinessTimer);
  if (stockTelegramPollTimer) clearInterval(stockTelegramPollTimer);
  stockShadowTimer = null;
  stockSimulationTimer = null;
  stockReadinessTimer = null;
  stockTelegramPollTimer = null;
  stockTelegramPollPromise = null;
  stockReadinessBrokerSnapshotAt = "";
  if (!clippingOfficeModulePromise) return { clippingOffice: "not_loaded" };
  const clippingOffice = await clippingOfficeModulePromise.catch(() => null);
  if (!clippingOffice || typeof clippingOffice.shutdownRuntime !== "function") {
    return { clippingOffice: "unavailable" };
  }
  return { clippingOffice: await clippingOffice.shutdownRuntime() };
}

function clippingOfficeAgent101BridgeTarget(method = "GET", pathname = "") {
  if (!pathname.startsWith(CLIPPING_OFFICE_AGENT101_BRIDGE)) return "";
  const target = `/api/agent101${pathname.slice(CLIPPING_OFFICE_AGENT101_BRIDGE.length)}`;
  if (target === "/api/agent101/chats" && ["GET", "POST"].includes(method)) return target;
  if (/^\/api\/agent101\/chats\/[^/]+$/.test(target) && method === "GET") return target;
  if (/^\/api\/agent101\/chats\/[^/]+\/messages$/.test(target) && method === "POST") return target;
  return "";
}

async function handleClippingOffice(req, res, url) {
  const agent101Target = clippingOfficeAgent101BridgeTarget(req.method, url.pathname);
  if (agent101Target) {
    const originalUrl = req.url;
    const bridgedUrl = new URL(`${agent101Target}${url.search || ""}`, `http://${req.headers.host || "127.0.0.1"}`);
    req.url = `${agent101Target}${url.search || ""}`;
    try {
      await handleApi(req, res, bridgedUrl);
    } finally {
      req.url = originalUrl;
    }
    return;
  }

  if (url.pathname === CLIPPING_OFFICE_MOUNT) {
    res.writeHead(302, {
      ...securityHeaders(req),
      location: `${CLIPPING_OFFICE_MOUNT}/`,
      "cache-control": "no-store",
    });
    res.end();
    return;
  }

  const clippingOffice = await clippingOfficeModule();
  const originalUrl = req.url;
  const strippedPath = url.pathname.slice(CLIPPING_OFFICE_MOUNT.length) || "/";
  req.url = `${strippedPath}${url.search || ""}`;
  try {
    await clippingOffice.handleRequest(req, res);
  } finally {
    req.url = originalUrl;
  }
}

function handleDisplayApp(req, res, url) {
  const strippedPath = url.pathname === DISPLAY_APP_MOUNT
    ? "/"
    : url.pathname.slice(DISPLAY_APP_MOUNT.length) || "/";
  let filePath = strippedPath === "/" ? "/index.html" : decodeURIComponent(strippedPath);
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(DISPLAY_APP_DIR, filePath);

  if (!absolutePath.startsWith(DISPLAY_APP_DIR)) {
    res.writeHead(403, { ...securityHeaders(req), "content-type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.readFile(absolutePath, (error, data) => {
    if (error) {
      res.writeHead(404, { ...securityHeaders(req), "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const extension = path.extname(absolutePath);
    const type = mimeTypes[extension] || "application/octet-stream";
    res.writeHead(200, {
      ...securityHeaders(req),
      "content-type": type,
      "cache-control": extension === ".html"
        ? "no-store"
        : APP_MODE === "local" && [".css", ".js"].includes(extension)
          ? "private, max-age=60"
          : [".css", ".js"].includes(extension)
            ? "no-store"
            : "private, max-age=300",
      ...(extension === ".html" ? { "x-argentum-display": "monitor-3" } : {}),
    });
    res.end(data);
  });
}

function handleStockOfficeApp(req, res, url) {
  if (url.pathname === STOCK_OFFICE_MOUNT) {
    res.writeHead(302, {
      ...securityHeaders(req),
      location: `${STOCK_OFFICE_MOUNT}/`,
      "cache-control": "no-store",
    });
    res.end();
    return;
  }

  const strippedPath = url.pathname.slice(STOCK_OFFICE_MOUNT.length) || "/";
  let filePath = strippedPath === "/" ? "/index.html" : decodeURIComponent(strippedPath);
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(STOCK_OFFICE_APP_DIR, filePath);

  if (!absolutePath.startsWith(STOCK_OFFICE_APP_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(absolutePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const extension = path.extname(absolutePath);
    const type = mimeTypes[extension] || "application/octet-stream";
    res.writeHead(200, {
      ...securityHeaders(req),
      "content-type": type,
      "cache-control": extension === ".html"
        ? "no-store"
        : APP_MODE === "local" && [".css", ".js"].includes(extension)
          ? "private, max-age=60"
          : [".css", ".js"].includes(extension)
            ? "no-store"
            : "private, max-age=300",
    });
    res.end(data);
  });
}

function handlePrintShopOfficeApp(req, res, url) {
  if (url.pathname === PRINT_SHOP_OFFICE_MOUNT) {
    res.writeHead(302, {
      ...securityHeaders(req),
      location: `${PRINT_SHOP_OFFICE_MOUNT}/`,
      "cache-control": "no-store",
    });
    res.end();
    return;
  }

  const strippedPath = url.pathname.slice(PRINT_SHOP_OFFICE_MOUNT.length) || "/";
  let filePath = strippedPath === "/" ? "/index.html" : decodeURIComponent(strippedPath);
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(PRINT_SHOP_OFFICE_APP_DIR, filePath);

  if (!absolutePath.startsWith(PRINT_SHOP_OFFICE_APP_DIR)) {
    res.writeHead(403, { ...securityHeaders(req), "content-type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.readFile(absolutePath, (error, data) => {
    if (error) {
      res.writeHead(404, { ...securityHeaders(req), "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const extension = path.extname(absolutePath);
    const type = mimeTypes[extension] || "application/octet-stream";
    res.writeHead(200, {
      ...securityHeaders(req),
      "content-type": type,
      "cache-control": extension === ".html"
        ? "no-store"
        : APP_MODE === "local" && [".css", ".js"].includes(extension)
          ? "private, max-age=60"
          : [".css", ".js"].includes(extension)
            ? "no-store"
            : "private, max-age=300",
      ...(extension === ".html" ? { "x-argentum-office-id": "print-shop-office" } : {}),
    });
    res.end(data);
  });
}

function handleBusinessOfficeApp(req, res, url, mountPath, officeId) {
  if (url.pathname === mountPath) {
    res.writeHead(302, {
      ...securityHeaders(req),
      location: `${mountPath}/`,
      "cache-control": "no-store",
    });
    res.end();
    return;
  }

  const strippedPath = url.pathname.slice(mountPath.length) || "/";
  let filePath = strippedPath === "/" ? "/index.html" : decodeURIComponent(strippedPath);
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(BUSINESS_OFFICE_APP_DIR, filePath);

  if (!absolutePath.startsWith(BUSINESS_OFFICE_APP_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(absolutePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const extension = path.extname(absolutePath);
    const type = mimeTypes[extension] || "application/octet-stream";
    const headers = {
      ...securityHeaders(req),
      "content-type": type,
      "cache-control": extension === ".html"
        ? "no-store"
        : APP_MODE === "local" && [".css", ".js"].includes(extension)
          ? "private, max-age=60"
          : [".css", ".js"].includes(extension)
            ? "no-store"
            : "private, max-age=300",
    };
    if (extension === ".html") headers["x-argentum-office-id"] = officeId;
    res.writeHead(200, headers);
    res.end(data);
  });
}

async function handleArgentumRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  const shouldBypassClippingOfficeAuth = APP_MODE === "local" || (LOCAL_OFFICE_BYPASS && localRuntime.isLocalHost(url.hostname));
  const isLocalRobinhoodOauthCallback = APP_MODE === "local"
    && req.method === "GET"
    && localRuntime.isLocalHost(url.hostname)
    && url.pathname === "/api/stock-office/robinhood/oauth/callback";
  const isTelegramWebhook = req.method === "POST"
    && url.pathname === "/api/stock-office/notifications/telegram/webhook";
  const isLocalHardwareDisplayRoute = APP_MODE === "local"
    && localRuntime.isLocalHost(url.hostname)
    && url.pathname.startsWith("/api/hardware/display");
  try {
    assertTrustedOrigin(req);
    if (handlePublicWebsite(req, res, url)) {
      return;
    }
    if (await handleSetup(req, res)) {
      return;
    }
    if (await handleLogin(req, res)) {
      return;
    }
    if (shouldBypassClippingOfficeAuth && url.pathname.startsWith(CLIPPING_OFFICE_MOUNT)) {
      await handleClippingOffice(req, res, url);
      return;
    }
    if (url.pathname.startsWith("/api/gateway/v1")) {
      await handleApi(req, res, url);
      return;
    }
    // Robinhood returns here from another browser origin, so the normal Argentum
    // SameSite session cookie may be absent. The callback remains protected by the
    // in-memory one-use OAuth state, PKCE verifier, and approved Human Gate request.
    if (isLocalRobinhoodOauthCallback) {
      await handleApi(req, res, url);
      return;
    }
    if (isTelegramWebhook) {
      await handleApi(req, res, url);
      return;
    }
    if (isLocalHardwareDisplayRoute) {
      await handleApi(req, res, url);
      return;
    }
    if (!currentSession(req)) {
      if (url.pathname.startsWith("/api/")) {
        sendJson(res, 401, { error: "Authentication required" });
        return;
      }
      redirect(res, "/login", req);
      return;
    }
    const logoSymbol = stockLogoSymbol(url.pathname);
    if (req.method === "GET" && logoSymbol) {
      await sendStockLogo(req, res, logoSymbol);
      return;
    }
    if (url.pathname === "/app/") {
      redirect(res, "/app", req);
      return;
    }
    if (url.pathname === DISPLAY_APP_MOUNT || url.pathname.startsWith(`${DISPLAY_APP_MOUNT}/`)) {
      handleDisplayApp(req, res, url);
      return;
    }
    if (url.pathname.startsWith(CLIPPING_OFFICE_MOUNT)) {
      await handleClippingOffice(req, res, url);
      return;
    }
    if (url.pathname.startsWith(STOCK_OFFICE_MOUNT)) {
      handleStockOfficeApp(req, res, url);
      return;
    }
    if (url.pathname === PRINT_SHOP_OFFICE_MOUNT || url.pathname.startsWith(`${PRINT_SHOP_OFFICE_MOUNT}/`)) {
      handlePrintShopOfficeApp(req, res, url);
      return;
    }
    const businessOfficeMount = Object.keys(BUSINESS_OFFICE_APP_MOUNTS).find((mountPath) => url.pathname === mountPath || url.pathname.startsWith(`${mountPath}/`));
    if (businessOfficeMount) {
      handleBusinessOfficeApp(req, res, url, businessOfficeMount, BUSINESS_OFFICE_APP_MOUNTS[businessOfficeMount]);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
}

function createArgentumServer() {
  return http.createServer(handleArgentumRequest);
}

ensureState();
readAuthStore();

if (require.main === module) {
  const server = createArgentumServer();
  let standaloneShutdownPromise = null;
  const shutdownStandaloneServer = () => {
    if (standaloneShutdownPromise) return standaloneShutdownPromise;
    standaloneShutdownPromise = (async () => {
      await Promise.race([
        Promise.resolve(shutdownLocalOffices()).catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 10_000)),
      ]);
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          server.closeAllConnections?.();
          resolve();
        }, 2500);
        server.close(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    })().finally(() => process.exit(0));
    return standaloneShutdownPromise;
  };
  process.on("message", (message) => {
    if (message?.type === "argentum:shutdown") shutdownStandaloneServer();
  });
  process.once("SIGTERM", shutdownStandaloneServer);
  process.once("SIGINT", shutdownStandaloneServer);
  server.listen(PORT, HOST, () => {
    localRuntime.assertLocalListening(server, APP_MODE);
    console.log(`Argentum OS is running in ${APP_MODE} mode on ${HOST}:${PORT}`);
    prewarmLocalOffices().catch(() => {});
    process.send?.({ type: "argentum:backend-ready", host: HOST, port: PORT });
  });
}

module.exports = {
  APP_MODE,
  DATA_DIR,
  HOST,
  PORT,
  createArgentumServer,
  createAgent101Mission,
  cancelAgent101Mission,
  executeAgent101Mission,
  recoverAgent101Missions,
  handleArgentumRequest,
  localRuntimeStatusPayload,
  prewarmLocalOffices,
  stockIntelligenceScheduler,
  stockTraderResearchAgent,
  startStockShadowScheduler,
  startStockSimulationScheduler,
  startStockReadinessScheduler,
  startStockFlowManagers,
  startStockTelegramPolling,
  shutdownLocalOffices,
};

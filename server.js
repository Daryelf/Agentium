const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
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
const { materializeStockGuruRuntime, resolveStockGuruWorkspace } = require("./services/stock-guru-workspace");
const { createRobinhoodMcpClient } = require("./services/robinhood-mcp-client");
const {
  brokerControlOverview,
  buildTradeDraft,
  claimApprovedDispatch,
  executionEnvelope,
  normalizeGuardrails,
  settleApprovedDispatch,
  tradeDraftWithApprovalState,
} = require("./services/stock-broker-control");

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const STOCK_GURU_USER_DATA_DIR = path.resolve(process.env.ARGENTUM_STOCK_GURU_DATA_DIR || (
  process.platform === "darwin"
    ? path.join(os.homedir(), "Library", "Application Support", "Argentum OS")
    : path.join(os.homedir(), ".argentum-os")
));
const stockGuruSourceWorkspace = resolveStockGuruWorkspace({
  workspaceRoot: ROOT,
  userDataPath: STOCK_GURU_USER_DATA_DIR,
});
if (stockGuruSourceWorkspace.available) {
  const stockGuruRuntime = materializeStockGuruRuntime({
    sourcePath: stockGuruSourceWorkspace.path,
    userDataPath: STOCK_GURU_USER_DATA_DIR,
  });
  if (stockGuruRuntime.available) {
    process.env.STOCK_GURU_SOURCE_PATH = stockGuruSourceWorkspace.path;
    process.env.STOCK_GURU_PATH = stockGuruRuntime.path;
  }
}
const CLIPPING_OFFICE_MOUNT = "/apps/clipping-office";
const CLIPPING_OFFICE_SERVER = path.join(ROOT, "CLIPPING OFFICE ", "server.js");
const PUBLIC_SITE_DIR = path.join(ROOT, "website");
const STOCK_OFFICE_MOUNT = "/apps/stock-office";
const STOCK_OFFICE_APP_DIR = path.join(ROOT, "apps", "stock-office");
const STATE_FILE = path.join(DATA_DIR, "argentum-state.json");
const AUTH_FILE = path.join(DATA_DIR, "argentum-auth.json");
const SESSION_SECRET_FILE = path.join(DATA_DIR, "argentum-session-secret.json");
const AI_PROVIDER_FILE = path.join(DATA_DIR, "argentum-ai-provider.json");
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
const SESSION_SECRET = process.env.SESSION_SECRET || readPersistentSessionSecret();
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
const stockGuruRefreshManager = createStockGuruRefreshManager();
const robinhoodMcpClient = createRobinhoodMcpClient({
  dataDir: path.join(STOCK_GURU_USER_DATA_DIR, "broker-auth"),
});
const AI_PROVIDER_OPTIONS = new Set(["local_demo", "local", "openai", "anthropic"]);
const AI_MODE_OPTIONS = new Set(["demo", "live"]);
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
]);
const DEPO_SYSTEM_RULES = [
  "Agent 101 is the supervised draft-only agent inside Argentum OS.",
  "Agent 101 can research, organize evidence, draft outputs, create task plans, create workflow plans, prepare prompts, prepare reports, save internal notes, package work for approval, and create future agent blueprints.",
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

function boundedDurationMs(value, fallback, max) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
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
    "content-security-policy": `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src ${connectSrc}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
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
    action: "/setup",
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
      role: "Draft-only Operator",
      state: "active_supervised",
      spendLimit: "$5/day sandbox",
      externalActions: "Draft only",
      memoryAccess: "Working + verified shared",
    },
    agent101: {
      id: "agent-101",
      name: "Agent 101",
      role: "Master Agent",
      mode: "Draft-only",
      status: "Active supervised",
      currentOffice: "Clips Office",
      approvalRequired: true,
      externalActions: "Locked",
    },
    stockOffice: {
      workspaceId: STOCK_WORKSPACE_ID,
      lastLocalSyncAt: null,
      selectedTicker: "",
      chatMessages: [],
      syncRuns: [],
      assistantRuns: [],
      tradeDrafts: [],
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
  state.stockOffice = normalizeStockOfficeState(state.stockOffice || fresh.stockOffice);
  state.toolConnections = {
    ...fresh.toolConnections,
    ...(state.toolConnections || {}),
  };
  if (state.agent?.id === "agent-001-depo") {
    state.agent.name = "Agent 101";
    state.agent.role = "Draft-only Operator";
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
  state.approvals = state.approvals.filter((approval) => !["approval-pod-lane-v0", "approval-stock-readonly-v0"].includes(approval?.id));
  state.chatMessages = normalizeChatMessages(Array.isArray(state.chatMessages) ? state.chatMessages : fresh.chatMessages);
  state.agent101ChatThreads = normalizeAgent101ChatThreads(state.agent101ChatThreads, state.chatMessages);
  state.memory = {
    working: mergeById(normalizeMemoryEntries(state.memory?.working || []), fresh.memory.working),
    shared: mergeById(normalizeMemoryEntries(state.memory?.shared || []), fresh.memory.shared),
    agent: mergeById(normalizeMemoryEntries(state.memory?.agent || []), fresh.memory.agent),
  };
  state.audit = Array.isArray(state.audit) ? state.audit : fresh.audit;
  return state;
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
  const validStatuses = new Set(["queued", "sending", "sent", "thinking", "running", "waiting_approval", "complete", "failed", "cancelled", "error"]);
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
          content: "Ready. Send one goal and I will keep the plan, tool steps, approvals, saved outputs, and final summary in this thread.",
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
  const validStatuses = new Set(["idle", "thinking", "running", "waiting_approval", "complete", "error"]);
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
  const active = (thread.messages || []).slice().reverse().find((message) => ["thinking", "running", "waiting_approval"].includes(message.status));
  thread.status = active?.status === "waiting_approval" ? "waiting_approval" : active?.status === "running" ? "running" : active?.status === "thinking" ? "thinking" : thread.status === "error" ? "error" : "idle";
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
        content: "New chat started. Tell me what you want Agent 101 to plan, draft, check, or run safely.",
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
  if (payload.status !== undefined && ["idle", "thinking", "running", "waiting_approval", "complete", "error"].includes(payload.status)) thread.status = payload.status;
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
  const toolMessages = (result.steps || [])
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
      (result.steps || [])
        .flatMap((step) => step.details?.approvalIds || (step.details?.approvalId ? [step.details.approvalId] : []))
        .filter(Boolean),
    ),
  );
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
        actionType: "publish_video",
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
        ? result.summary || "Done. The safe internal clipping workflow completed and any external posting remains behind Human Gate."
        : result.summary || "This action needs Human Gate approval. I can prepare the package, but I cannot execute it externally.",
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
  if (!clippingOfficeModulePromise) {
    clippingOfficeModulePromise = import(pathToFileURL(CLIPPING_OFFICE_SERVER).href);
  }
  return clippingOfficeModulePromise;
}

async function runClippingOfficeAgent101(payload = {}) {
  const clippingOffice = await clippingOfficeModule();
  if (typeof clippingOffice.runAgent101Workflow !== "function") {
    throw guardedError("StreamClipper Agent runner is not available.", 503);
  }
  return clippingOffice.runAgent101Workflow(payload);
}

async function runAgent101FromRoot(payload = {}) {
  const result = await runClippingOfficeAgent101({
    goal: payload.goal || payload.message,
    mode: payload.mode || "demo",
    maxSteps: payload.maxSteps || 10,
  });
  if (payload.threadId) {
    const state = readState();
    const thread = findAgent101Thread(state, payload.threadId);
    if (thread) {
      appendRunMessagesToThread(thread, result);
      writeState(state);
      return { ...result, thread, threads: publicAgent101ChatThreads(state) };
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
  if (shouldTriggerAgentRunner(content)) {
    appendAgent101ThreadMessages(thread, {
      role: "agent",
      content: "I can run that as a safe internal draft workflow. Posting and uploads stay blocked by Human Gate. Starting now.",
      status: "running",
      metadata: { taskType: "agent_run", roomId: thread.roomId, riskLevel: "low", clientMessageId },
    });
    thread.status = "running";
    writeState(state);
    try {
      const result = await runClippingOfficeAgent101({
        goal: content,
        mode: payload.mode || "demo",
        maxSteps: payload.maxSteps || 10,
        threadId,
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
        content: `I could not finish that run: ${error.message}. Your request is saved in this thread and nothing external happened.`,
        status: "failed",
        metadata: { taskType: "agent_run_error", roomId: thread.roomId, clientMessageId, riskLevel: "medium" },
      });
      erroredThread.status = "error";
      writeState(erroredState);
      return { thread: erroredThread, threads: publicAgent101ChatThreads(erroredState), error: error.message };
    }
  }

  const response = await handleAgent101Chat({
    message: content,
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
  appendAgent101ThreadMessages(thread, {
    role: response.approval ? "system" : "agent",
    content:
      response.message ||
      (response.approval
        ? "This action needs Human Gate approval. I can prepare a draft package, but I cannot execute it."
        : "I can help with safe internal draft work."),
    status: "complete",
    metadata: {
      taskType: response.taskType,
      artifacts: response.artifacts || [],
      requiresApproval: Boolean(response.requiresApproval || response.approval),
      riskLevel: response.riskLevel || "low",
      approvalId: response.approval?.id,
      roomId: payload.roomId || thread.roomId,
      clientMessageId,
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
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function audit(state, title, body) {
  state.audit.unshift({
    id: `audit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title,
    body,
    createdAt: now(),
  });
  state.audit = state.audit.slice(0, 50);
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
    mode: provider === "openai" ? sanitizeAiMode(ENV_AI_MODE || "live") : "demo",
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
  fs.writeFileSync(AI_PROVIDER_FILE, `${JSON.stringify(nextConfig, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(AI_PROVIDER_FILE, 0o600);
  } catch {
    // Best effort on external drives/filesystems that do not support POSIX modes.
  }
  return nextConfig;
}

function keyFromConfig(config, provider) {
  const stored = String(config.keys?.[provider] || "");
  if (stored) return stored;
  if (provider === "openai") return ENV_OPENAI_API_KEY;
  if (provider === "anthropic") return ENV_ANTHROPIC_API_KEY;
  return "";
}

function keySource(config, provider) {
  if (String(config.keys?.[provider] || "")) return "server-config";
  if (provider === "openai" && ENV_OPENAI_API_KEY) return "environment";
  if (provider === "anthropic" && ENV_ANTHROPIC_API_KEY) return "environment";
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
  const keyConfigured = provider === "openai" ? Boolean(keyFromConfig(config, "openai")) : false;
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
  const heap = process.memoryUsage();
  const heapPercent = heap.heapTotal > 0 ? Math.round((heap.heapUsed / heap.heapTotal) * 100) : 0;
  const users = activeUserCount(readAuthStore());
  const queueTotal = queuedTasks + pendingApprovals;
  const workloadPercent = Math.min(100, queueTotal * 18 + artifacts.length * 4);
  const healthPercent = Math.max(35, 100 - workloadPercent);
  const agentHealth = workloadPercent >= 78 ? "Overloaded" : workloadPercent >= 48 ? "Busy" : "Stable";
  const workloadLabel = workloadPercent >= 78 ? "Heavy" : workloadPercent >= 48 ? "Medium" : "Light";
  const health = aiStatus.connectionStatus === "Error"
    ? "OpenAI needs attention"
    : "Local systems operational";

  return {
    health,
    agentHealth,
    agentMode: state.agent?.mode || "Draft only",
    metrics: [
      { label: "Agent Health", value: agentHealth, percent: healthPercent },
      { label: "Workload", value: workloadLabel, percent: workloadPercent },
      { label: "Memory", value: String(memoryCount), percent: Math.min(100, Math.max(8, memoryCount * 8)) },
      { label: "Safety Gate", value: users > 0 ? pendingApprovals ? `${pendingApprovals} pending` : "On" : "Setup", percent: users > 0 ? pendingApprovals ? Math.min(100, 50 + pendingApprovals * 12) : 100 : 35 },
    ],
    chart: [
      healthPercent,
      Math.min(100, 28 + queuedTasks * 12),
      Math.min(100, 30 + pendingApprovals * 10),
      Math.min(100, 26 + artifacts.length * 7),
      Math.min(100, 34 + audit.length * 4),
      Math.min(100, Math.max(12, heapPercent)),
      workloadPercent,
      aiStatus.connectionStatus === "Error" ? 34 : 76,
    ],
    counts: {
      queuedTasks,
      pendingApprovals,
      memoryCount,
      artifacts: artifacts.length,
      audit: audit.length,
      heapPercent,
    },
    ai: {
      provider: aiStatus.providerLabel,
      mode: aiStatus.modeLabel,
      connectionStatus: aiStatus.connectionStatus,
    },
    updatedAt: now(),
  };
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
        model: config.providers.openai.model,
        temperature: config.providers.openai.temperature,
        maxOutputTokens: config.providers.openai.maxOutputTokens,
      },
    },
    storageNote: "API keys are held server-side only. Prefer environment variables on Railway; local saved keys live in ignored backend config.",
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
  const totalTokens = inputTokens + outputTokens;
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return 0;
  return Math.round((totalTokens / 1000) * 0.001 * 10000) / 10000;
}

function aiUsageLimitReached(config) {
  const usage = normalizeAiUsage(config.usage);
  const limit = parseMonthlyLimit(config.monthlyLimitUsd, 10);
  return limit > 0 && usage.estimatedMonthlyUsd >= limit;
}

function aiUsageBudgetStatus(config) {
  const usage = normalizeAiUsage(config.usage);
  const limit = parseMonthlyLimit(config.monthlyLimitUsd, 10);
  const ratio = limit > 0 ? usage.estimatedMonthlyUsd / limit : 0;
  return {
    limitUsd: limit,
    estimatedMonthlyUsd: usage.estimatedMonthlyUsd,
    percentUsed: limit > 0 ? Math.min(100, Math.round(ratio * 100)) : 0,
    warning: limit > 0 && ratio >= 0.75 && ratio < 1,
    blocked: limit > 0 && ratio >= 1,
  };
}

function assertAiUsageBudget(config) {
  if (!aiUsageLimitReached(config)) return;
  config.usage = {
    ...normalizeAiUsage(config.usage),
    blockedByLimit: true,
    lastError: "AI monthly spending limit reached.",
  };
  writeAiProviderConfig(config);
  throw guardedError("AI monthly spending limit reached. Agent 101 used Local Demo Mode fallback.", 402);
}

function recordAiUsage(config, usage = {}) {
  const current = normalizeAiUsage(config.usage);
  const inputTokens = Number(usage.input_tokens || usage.inputTokens || 0);
  const outputTokens = Number(usage.output_tokens || usage.outputTokens || 0);
  config.usage = {
    ...current,
    requestCount: current.requestCount + 1,
    inputTokens: current.inputTokens + (Number.isFinite(inputTokens) ? inputTokens : 0),
    outputTokens: current.outputTokens + (Number.isFinite(outputTokens) ? outputTokens : 0),
    estimatedMonthlyUsd: Math.round((current.estimatedMonthlyUsd + estimatedAiCostUsd(usage)) * 10000) / 10000,
    lastCallAt: now(),
    lastError: null,
  };
  config.usage.blockedByLimit = aiUsageLimitReached(config);
  if (aiUsageBudgetStatus(config).warning && !config.usage.warnedAt) config.usage.warnedAt = now();
  writeAiProviderConfig(config);
  return config.usage;
}

function recordAiProviderFailure(config, message) {
  config.usage = {
    ...normalizeAiUsage(config.usage),
    lastError: String(message || "Provider error").slice(0, 240),
  };
  writeAiProviderConfig(config);
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
  config.keys[provider] = apiKey;
  writeAiProviderConfig(config);
  return publicAiProviderSettings(config);
}

function removeAiProviderKey(payload) {
  const provider = sanitizeProvider(payload.provider);
  if (!["openai", "anthropic"].includes(provider)) {
    throw guardedError("Choose OpenAI or Anthropic before removing a provider key.", 400);
  }
  const config = readAiProviderConfig();
  if (config.keys) delete config.keys[provider];
  writeAiProviderConfig(config);
  return publicAiProviderSettings(config);
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
    .map((message) => ({
      speaker: ["operator", "depo", "agent"].includes(message?.speaker) ? message.speaker : "depo",
      text: String(message?.text || "").trim().slice(0, 1000),
      roomId: String(message?.roomId || context.roomId || context.officeId || "").slice(0, 80),
      createdAt: message?.createdAt && !Number.isNaN(Date.parse(message.createdAt)) ? message.createdAt : undefined,
    }))
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

function buildClipsOfficeIntakeResponse(message) {
  return {
    message: [
      "Got it. I will treat this as a Clips Office build/intake request, not a shutdown.",
      "",
      "I can help build the auto-clipping system for your own channels, approved creators, or public discovery lists. I will not log in, impersonate creators, claim ownership of channels, post, spend, or change accounts without Human Gate.",
      "",
      "Answer these so I can turn it into a real workflow:",
      "1. Which platform first: Twitch, Kick, YouTube, TikTok, or all discovery?",
      "2. Are we monitoring your own account, creators who gave permission, or public streams for research only?",
      "3. When you say claim big streamers, do you mean find/recommend streamers, draft outreach, request clipping permission, or manage approved clip packages?",
      "4. What games/categories should Agent 101 watch first?",
      "5. What counts as a good clip: reaction, clutch, funny moment, tutorial, drama-free highlight, or something else?",
      "6. What output should come first: streamer shortlist, clip radar candidates, CapCut brief, posting draft, or Human Gate permission package?",
      "7. What daily limit should stay active while this is draft-only?",
      "",
      "Safe next move: I can create a Clips Office intake plan with a permission checklist, discovery rubric, streamer scoring rules, and a Human Gate package for any external step.",
    ].join("\n"),
    taskType: "clips",
    suggestedActions: [
      { label: "Create Clips Office intake", action: "create_task_plan", requiresApproval: false },
      { label: "Create streamer scoring rubric", action: "create_clips_plan", requiresApproval: false },
      { label: "Package external permissions", action: "package_for_approval", requiresApproval: true },
    ],
    artifacts: [
      {
        type: "intake",
        title: "Clips Office intake questions",
        content: `Original request: ${String(message || "").slice(0, 1200)}\n\nNeeded: platform, permission model, streamer discovery goal, clip scoring rubric, first output, daily limit, and Human Gate boundaries.`,
      },
    ],
    requiresApproval: false,
    riskLevel: "medium",
    blockedAction: null,
    logs: ["Agent 101 entered Clips Office intake mode instead of blocking ambiguous planning work."],
  };
}

function buildClipsOfficeFollowupResponse(message, context = {}) {
  const history = normalizedAgent101ChatHistory(context);
  const answered = String(message || "").trim();
  const priorOperatorAnswers = history
    .filter((item) => item.speaker === "operator")
    .map((item) => item.text)
    .slice(-4);
  return {
    message: [
      "Got it. I kept this inside the Clips Office thread and added it to the working setup context.",
      "",
      answered ? `Latest answer: ${answered}` : "Latest answer captured.",
      priorOperatorAnswers.length ? `Current thread context: ${priorOperatorAnswers.join(" | ").slice(0, 700)}` : "",
      "",
      "Next safe build step:",
      "1. Turn this into a Clips Office intake record.",
      "2. Build a streamer discovery rubric for approved/public discovery only.",
      "3. Create a permission checklist before any creator outreach or posting.",
      "4. Draft the first CapCut/posting package for Human Gate review.",
      "",
      "Still blocked without approval: logging in, claiming ownership, posting, spending, account changes, API key changes, or contacting people as if permission already exists.",
    ].filter(Boolean).join("\n"),
    taskType: "clips",
    suggestedActions: [
      { label: "Create Clips Office intake", action: "create_task_plan", requiresApproval: false },
      { label: "Draft discovery rubric", action: "create_clips_plan", requiresApproval: false },
      { label: "Package permissions", action: "package_for_approval", requiresApproval: true },
    ],
    artifacts: [
      {
        type: "working_context",
        title: "Clips Office setup context",
        content: `Latest operator answer: ${answered}\n\nRecent thread:\n${history.map((item) => `${item.speaker}: ${item.text}`).join("\n").slice(0, 4000)}`,
      },
    ],
    requiresApproval: false,
    riskLevel: "medium",
    blockedAction: null,
    logs: ["Agent 101 used recent Clips Office chat context instead of starting over."],
  };
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
    return "I can help you turn ideas into safe, structured work: research, organize evidence, draft outputs, create task plans, draft workflows, save internal notes, prepare reports, and package risky work for Human Gate review.";
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
    "You are Agent 101, the first supervised master agent inside Argentum OS.",
    "You help the user turn ideas into safe, structured work.",
    "You can plan, research, organize, draft, write prompts, create implementation plans, prepare code-change instructions, create workflow plans, generate content packages, and propose future agents.",
    "You are draft-only. You cannot perform external actions.",
    "You cannot publish, spend money, contact customers, modify accounts, change API keys, create live agents, grant permissions, run external APIs/tools, or deploy campaigns.",
    "Any risky action must be routed to Human Gate for approval.",
    "Important: do not behave like a generic refusal chatbot. If the user gives a vague business goal, ask intake questions and propose safe internal next steps.",
    "For clipping/streamer ideas, you may create discovery rubrics, approved-streamer checklists, CapCut briefs, posting drafts, permission checklists, and Human Gate packages. Ask clarifying questions when ownership, permission, platform, or output is unclear.",
    "If the user says claim or get big streamers, clarify what they mean and reframe toward approved discovery, permission requests, and draft-only packages. Do not set blockedAction just because wording is rough.",
    `Only set blockedAction when the requested action directly matches one of these exact blocked action IDs: ${riskyActions}.`,
    "If the user asks for a coding task, create a clear implementation plan, file checklist, patch strategy, test plan, and prompt for Codex or Claude if needed.",
    "Do not claim you edited files unless a real code-editing tool exists and was used.",
    "Be direct, useful, operational, and concise.",
    "Return only valid JSON with keys: message, taskType, suggestedActions, artifacts, requiresApproval, riskLevel, blockedAction, logs.",
  ].join(" ");
}

function agent101UserInput(message, context = {}) {
  const chatHistory = normalizedAgent101ChatHistory(context);
  return [
    `Message: ${message}`,
    `Room ID: ${context.roomId || context.office || "agent-office"}`,
    `Current stage: ${context.currentStage || "Agent 101"}`,
    `Context: ${JSON.stringify(context.context || {}, null, 2).slice(0, 2000)}`,
    `Recent room chat: ${JSON.stringify(chatHistory, null, 2).slice(0, 5000)}`,
    "Allowed task types: general, code_plan, content, clips, agent_blueprint, approval_request.",
    "Use the recent room chat as memory for this conversation. Do not restart as if the user is asking from zero.",
    "If key details are missing, ask follow-up questions in the message and keep requiresApproval false.",
    "If the request is about Clips Office, streamer discovery, clipping, Twitch, Kick, CapCut, or TikTok and does not explicitly request a blocked external action, return a helpful Clips Office intake/workflow response.",
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
  assertAiUsageBudget(config);
  const settings = config.providers.openai;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
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
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = guardedError(payload.error?.message || `OpenAI request failed with ${response.status}.`, response.status);
    error.openAiCode = payload.error?.code || "";
    error.openAiType = payload.error?.type || "";
    throw error;
  }
  recordAiUsage(config, payload.usage || {});
  const outputText = extractOpenAiOutputText(payload);
  return normalizeDepoAiPayload(outputText, outputText);
}

async function callOpenAiAgent101(config, message, context = {}) {
  const key = keyFromConfig(config, "openai");
  if (!key) throw guardedError("OpenAI API key is not configured.", 400);
  assertAiUsageBudget(config);
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
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = guardedError(payload.error?.message || `OpenAI request failed with ${response.status}.`, response.status);
      error.openAiCode = payload.error?.code || "";
      error.openAiType = payload.error?.type || "";
      throw error;
    }
    recordAiUsage(config, payload.usage || {});
    return extractOpenAiOutputText(payload);
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

async function callAnthropicProvider(config, message, context) {
  const provider = "anthropic";
  const key = keyFromConfig(config, provider);
  if (!key) throw guardedError("Anthropic API key is not configured.", 400);
  const settings = config.providers.anthropic;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
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
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw guardedError(payload.error?.message || `Anthropic request failed with ${response.status}.`, response.status);
  }
  const outputText = (payload.content || []).map((part) => part.text || "").join("\n");
  return normalizeDepoAiPayload(outputText, outputText);
}

function blockedDepoResponse(actionType) {
  return {
    message: "Human Gate approval required before this can continue.",
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
    assertAiUsageBudget(config);
    const settings = config.providers.openai;
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${keyFromConfig(config, "openai")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: settings.model,
        instructions: "Reply with exactly: Agent 101 online.",
        input: [{ role: "user", content: "Reply with exactly: Agent 101 online." }],
        max_output_tokens: 24,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = guardedError(payload.error?.message || `OpenAI request failed with ${response.status}.`, response.status);
      error.openAiCode = payload.error?.code || "";
      throw error;
    }
    recordAiUsage(config, payload.usage || {});
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

function publicToolConnections(state = readState()) {
  const ai = currentAiProviderStatus();
  const stored = state.toolConnections || {};
  const browser = stored.browser || {};
  const capcut = stored.capcut || {};
  const tiktok = stored.tiktok || {};
  return {
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

function publicConnectorStatuses(state = readState()) {
  return Object.keys(CONNECTOR_DEFINITIONS).map((connectorId) => publicConnectorStatus(connectorId, state));
}

function testConnector(connectorId) {
  const state = readState();
  const status = publicConnectorStatus(connectorId, state);
  const testedAt = now();
  if (connectorId === "openai") {
    return testAgent101OpenAi();
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
    workflowId: payload.workflowId || office.workflowId,
    type: payload.type || "office_artifact",
    title: payload.title || `${office.name}: Draft artifact`,
    summary: payload.summary || `Draft artifact prepared for ${office.name}.`,
    risk: payload.risk || payload.riskLevel || office.risk,
    content: payload.content || {
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
    return buildClipsOfficeIntakeResponse(message);
  }
  if (text.includes("codex") || text.includes("code") || text.includes("ui") || text.includes("fix") || text.includes("implement")) {
    return {
      message: "Code plan ready: define the broken behavior, inspect the affected files first, patch only the scoped UI/backend path, run the app checks, then verify the exact screen or endpoint before shipping.",
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
    return {
      message: "Clips plan ready: create three short hooks, list required raw footage/audio, prepare CapCut edit notes, draft captions, then send posting decisions to Human Gate. No upload or posting happens here.",
      taskType: "clips",
      suggestedActions: [
        { label: "Create clips plan", action: "create_clips_plan", requiresApproval: false },
        { label: "Package for approval", action: "package_for_approval", requiresApproval: true },
      ],
      requiresApproval: false,
      riskLevel: "medium",
      artifacts: [
        {
          type: "brief",
          title: "Short-form clips draft package",
          content: "Hooks, asset checklist, CapCut handoff notes, caption drafts, and Human Gate posting note.",
        },
      ],
      logs: ["Agent 101 created a local clips plan."],
    };
  }
  if (text.includes("agent") || text.includes("blueprint") || text.includes("hire")) {
    return {
      message: "Blueprint draft only: define the future agent role, allowed local tools, blocked permissions, approval requirements, eval checks, and budget. Human Gate must approve before any live agent exists.",
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
      message: "Blocked: publishing without approval, spending money, account changes, customer contact, ad actions, raw credential login automation, live agent creation, permission changes, and API key changes.",
      taskType: "general",
      suggestedActions: [{ label: "Package for approval", action: "package_for_approval", requiresApproval: true }],
      requiresApproval: false,
      riskLevel: "low",
      artifacts: [],
      logs: ["Blocked action list returned."],
    };
  }
  return {
    message: "I can turn this into bounded supervised work: clarify the goal, list needed context, break it into steps, label risks, draft the output, and route anything risky to Human Gate.",
    taskType: "general",
    suggestedActions: [
      { label: "Create task plan", action: "create_task_plan", requiresApproval: false },
      { label: "Draft workflow", action: "draft_workflow", requiresApproval: false },
      { label: "Package for approval", action: "package_for_approval", requiresApproval: true },
    ],
    requiresApproval: false,
    riskLevel: "low",
    artifacts: [
      {
        type: "plan",
        title: "Bounded task plan",
        content: "Goal, context needed, steps, risks, draft output, Human Gate check, and final log.",
      },
    ],
    logs: ["Local Agent 101 response. No external API call was made."],
  };
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

  const config = readAiProviderConfig();
  const provider = sanitizeProvider(config.provider);
  const mode = isLocalProvider(provider) ? "demo" : sanitizeAiMode(config.mode);
  const canUseOpenAi = provider === "openai" && mode === "live" && Boolean(keyFromConfig(config, "openai"));
  if (!canUseOpenAi) {
    return { ...localAgent101ChatResponse(message, payload), provider: "local_demo", mode: "demo" };
  }

  try {
    const live = await callOpenAiAgent101(config, message, payload);
    if (shouldUseClipsOfficeIntake(message, payload, live)) {
      const contextualResponse = hasClipsOfficeChatContext(payload)
        ? buildClipsOfficeFollowupResponse(message, payload)
        : buildClipsOfficeIntakeResponse(message);
      return { ...contextualResponse, provider, mode };
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
    const friendly = provider === "openai" ? safeAiErrorMessage(error) : "Live provider failed; Local Demo fallback used.";
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
    location: "/app",
  });
  res.end();
}

async function handleSetup(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  const isSetupRoute = url.pathname === "/setup";
  if (!isSetupRoute) return false;

  const store = readAuthStore();
  if (activeUserCount(store) > 0) {
    redirect(res, currentSession(req) ? "/app" : "/login", req);
    return true;
  }

  if (req.method === "GET") {
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
      redirect(res, "/setup", req);
      return true;
    }
    if (currentSession(req)) {
      redirect(res, "/app", req);
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
        redirect(res, "/setup", req);
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

function stockOfficeSnapshot(state, permissions) {
  const snapshot = loadStockOfficeSnapshot({ rootDir: ROOT, state });
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
  snapshot.permissions = permissions || snapshot.permissions;
  return snapshot;
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
  if (req.method === "GET" && url.pathname === "/api/system/status") {
    sendJson(res, 200, currentSystemStatus());
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
      sendJson(res, 200, { connectors: publicConnectorStatuses(state) });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const connectorTestMatch = url.pathname.match(/^\/api\/connectors\/([^/]+)\/test$/);
  if (req.method === "POST" && connectorTestMatch) {
    try {
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
    sendJson(res, 200, {
      agent101: agent101Model(state),
      tools: publicToolConnections(state),
      connectors: publicConnectorStatuses(state),
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
      const snapshot = stockOfficeSnapshot(readState(), access.permissions);
      sendJson(res, 200, stockOverview(snapshot));
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
      const snapshot = stockOfficeSnapshot(readState(), access.permissions);
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
      const snapshot = stockOfficeSnapshot(readState(), access.permissions);
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
      const snapshot = stockOfficeSnapshot(readState(), access.permissions);
      sendJson(res, 200, {
        sources: snapshot.sources,
        sourceHealth: snapshot.sourceHealth,
        threatModel: snapshot.threatModel,
        workspace: snapshot.workspace,
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
      const snapshot = stockOfficeSnapshot(readState(), access.permissions);
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
      const snapshot = stockOfficeSnapshot(readState(), access.permissions);
      sendJson(res, 200, { mirror: snapshot.mirror, safety: snapshot.workspace.safetyRule });
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
      const state = readState();
      const snapshot = stockOfficeSnapshot(state, access.permissions);
      const tradeDrafts = snapshot.tradeDrafts
        .map((draft) => tradeDraftWithApprovalState(draft, state.approvals || []))
        .slice(0, 20);
      const connectionApproval = (state.approvals || []).find((item) => item.linkedId === "stock-office:robinhood-agentic-mcp:onboarding") || null;
      sendJson(res, 200, {
        brokerControl: brokerControlOverview(snapshot),
        robinhoodConnection: robinhoodMcpClient.publicStatus(),
        connectionApproval: connectionApproval ? {
          id: connectionApproval.id,
          status: connectionApproval.status,
          consumedAt: connectionApproval.consumedAt || null,
          expiresAt: connectionApproval.expiresAt || null,
        } : null,
        tradeDrafts,
        permissions: access.permissions,
      });
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
      res.writeHead(302, { location: `${STOCK_OFFICE_MOUNT}?robinhood=${refreshError ? "needs_refresh" : "connected"}` });
      res.end();
    } catch (error) {
      res.writeHead(302, { location: `${STOCK_OFFICE_MOUNT}?robinhood=connection_error` });
      res.end();
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
      }, snapshot);
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
      const state = readState();
      const snapshot = stockOfficeSnapshot(state);
      const draft = snapshot.tradeDrafts.find((item) => item.id === decodeURIComponent(stockOrderGateMatch[1]));
      if (!draft) throw guardedError("Order draft not found.", 404);
      if (new Date(draft.expiresAt).getTime() <= Date.now()) throw guardedError("Order draft expired. Rebuild it with fresh market and broker data.", 409);
      if (draft.status !== "ready_for_broker_review" || draft.blockers.length) {
        throw guardedError(`Order draft is blocked: ${draft.blockers[0] || "fresh broker review is unavailable"}`, 409);
      }
      const envelope = executionEnvelope(draft);
      const approvalResult = createHumanGateRequest({
        actionType: "place_robinhood_equity_order",
        title: `Approve exact Robinhood order: ${draft.side} ${draft.symbol}`,
        riskLevel: "critical",
        linkedId: `stock-office:order:${draft.fingerprint}`,
        officeId: "stock-office",
        workflowId: "workflow-stock-watch",
        expiresAt: draft.expiresAt,
        evidence: `${draft.thesis} Reference price $${draft.referencePrice.toFixed(2)}; requested and capped notional $${draft.cappedDollars.toFixed(2)}; all local capital, position, freshness, and kill-switch checks passed. Robinhood review must still return no warnings before placement.`,
        action: `Review and, only if Robinhood's review_equity_order returns no warning or scope change before ${draft.expiresAt}, place this one ${draft.side} ${draft.symbol} order in the dedicated Agentic account.`,
        exactScope: `One-use order fingerprint ${draft.fingerprint}: ${draft.side} ${draft.symbol}, market notional no more than $${draft.cappedDollars.toFixed(2)}, regular market hours, GFD, ref_id ${draft.clientRefId}. Reject on any broker warning, repricing outside policy, account mismatch, stale data, or scope change.`,
        details: {
          officeId: "stock-office",
          draftId: draft.id,
          fingerprint: draft.fingerprint,
          executionEnvelope: envelope,
          maxNotionalDollars: draft.cappedDollars,
          accountScope: "dedicated_agentic_account_only",
          moneyMovementAuthorized: false,
          recurringAuthorization: false,
        },
        reversible: false,
        expectedPostcondition: "The exact order is broker-reviewed, placed at most once, and reconciled to a Robinhood order ID; otherwise no order is placed.",
        rollbackPlan: "If still open, cancel the exact broker order; if filled, stop automation and create a separate explicit SELL review. Never create an offsetting order automatically.",
      });
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
      sendJson(res, 200, { ...approvalResult, draft: awaitingDraft, envelope, liveOrderPlaced: false });
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
      const state = readState();
      const snapshot = stockOfficeSnapshot(state, access.permissions);
      const draftId = decodeURIComponent(stockDirectExecuteMatch[1]);
      const draft = snapshot.tradeDrafts.find((item) => item.id === draftId);
      if (!draft) throw guardedError("Order draft not found.", 404);
      if (String(payload.confirmationFingerprint || "") !== draft.fingerprint) {
        throw guardedError("Action-time order confirmation does not match the exact approved fingerprint.", 409);
      }
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
      approval.dispatchMode = "direct_official_robinhood_mcp";
      audit(state, "Stock Office direct dispatch claimed", `${draft.side} ${draft.symbol} claim ${claimed.claim.id} was persisted before any official Robinhood broker call.`);
      writeState(state);

      let brokerResult;
      try {
        brokerResult = await robinhoodMcpClient.executeApprovedEnvelope(claimed.claim.envelope);
      } catch (error) {
        brokerResult = {
          reviewPassed: false,
          warnings: [],
          placementAttempted: false,
          brokerOrderId: "",
          brokerState: "",
          reconciliation: { matched: false },
          error: `Official Robinhood execution stopped before a verified placement: ${error.message}`,
        };
      }

      const latestState = readState();
      const latestCurrent = normalizeStockOfficeState(latestState.stockOffice);
      const latestDraft = latestCurrent.tradeDrafts.find((item) => item.id === draft.id);
      const approvalIndex = (latestState.approvals || []).findIndex((item) => item.id === approval.id);
      if (!latestDraft || approvalIndex < 0) throw guardedError("The persisted dispatch state changed during broker execution; manual reconciliation is required.", 409);
      const settled = settleApprovedDispatch(
        latestDraft,
        latestState.approvals[approvalIndex],
        brokerResult,
        claimed.claim.token,
        { trustedBrokerResult: true },
      );
      latestState.stockOffice = normalizeStockOfficeState({
        ...latestCurrent,
        tradeDrafts: [settled.draft, ...latestCurrent.tradeDrafts.filter((item) => item.id !== draft.id)],
      });
      latestState.approvals[approvalIndex] = settled.approval;
      audit(
        latestState,
        settled.liveOrderPlaced ? "Stock Office broker order independently reconciled" : "Stock Office direct dispatch stopped or needs reconciliation",
        settled.liveOrderPlaced
          ? `${draft.side} ${draft.symbol} matched official Robinhood order ${settled.draft.brokerOrderId}; exact one-use approval consumed.`
          : `${draft.side} ${draft.symbol}: ${settled.draft.lastDispatchError || "no independently verified order"}; exact one-use approval consumed and placement will not be retried.`,
      );
      writeState(latestState);
      sendJson(res, 200, {
        draft: settled.draft,
        approval: settled.approval,
        liveOrderPlaced: settled.liveOrderPlaced,
        reconciliationRequired: settled.reconciliationRequired,
      });
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
      const updatedSnapshot = stockOfficeSnapshot(readState(), access.permissions);
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
      sendJson(res, 200, { refresh: stockGuruRefreshManager.getStatus() });
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
    sendJson(res, 200, state);
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
  let filePath = url.pathname === "/app" ? "/index.html" : decodeURIComponent(url.pathname);
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
    const cacheControl = [".html", ".css", ".js"].includes(extension) ? "no-store" : "private, max-age=300";
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
  ["/favicon.svg", "favicon.svg"],
  ["/og.png", "og.png"],
  ["/robots.txt", "robots.txt"],
  ["/site.webmanifest", "site.webmanifest"],
]);

function publicWebsiteFile(url) {
  if (url.pathname === "/") return path.join(PUBLIC_SITE_DIR, "index.html");
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
      "x-argentum-site": "public",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  });
  return true;
}

let clippingOfficeModulePromise = null;

async function handleClippingOffice(req, res, url) {
  if (url.pathname === CLIPPING_OFFICE_MOUNT) {
    res.writeHead(302, {
      ...securityHeaders(req),
      location: `${CLIPPING_OFFICE_MOUNT}/`,
      "cache-control": "no-store",
    });
    res.end();
    return;
  }

  if (!clippingOfficeModulePromise) {
    clippingOfficeModulePromise = import(pathToFileURL(CLIPPING_OFFICE_SERVER).href);
  }
  const clippingOffice = await clippingOfficeModulePromise;
  const originalUrl = req.url;
  const strippedPath = url.pathname.slice(CLIPPING_OFFICE_MOUNT.length) || "/";
  req.url = `${strippedPath}${url.search || ""}`;
  try {
    await clippingOffice.handleRequest(req, res);
  } finally {
    req.url = originalUrl;
  }
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
      "cache-control": [".html", ".css", ".js"].includes(extension) ? "no-store" : "private, max-age=300",
    });
    res.end(data);
  });
}

ensureState();
readAuthStore();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  try {
    assertTrustedOrigin(req);
    if (handlePublicWebsite(req, res, url)) {
      return;
    }
    if (["/login", "/setup", "/app", "/app/"].includes(url.pathname)) {
      redirect(res, "/", req);
      return;
    }
    if (await handleSetup(req, res)) {
      return;
    }
    if (await handleLogin(req, res)) {
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
    if (url.pathname === "/app/") {
      redirect(res, "/app", req);
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
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Argentum is running on ${HOST}:${PORT}`);
});

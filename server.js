const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
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
const AI_PROVIDER_OPTIONS = new Set(["local_demo", "local", "openai", "anthropic"]);
const AI_MODE_OPTIONS = new Set(["demo", "live"]);
const AI_RISKY_ACTION_TYPES = new Set([
  "publish",
  "spend_money",
  "move_money",
  "contact_customer",
  "modify_account",
  "create_live_agent",
  "change_permissions",
  "change_api_key",
  "deploy_campaign",
  "external_api_action",
]);
const DEPO_SYSTEM_RULES = [
  "Agent 101 is the supervised draft-only agent inside Argentum OS.",
  "Agent 101 can research, organize evidence, draft outputs, create task plans, create workflow plans, prepare prompts, prepare reports, save internal notes, package work for approval, and create future agent blueprints.",
  "Agent 101 cannot publish, spend money, move money, contact customers, modify accounts, create live agents, change permissions, change API keys, deploy campaigns, or call external APIs without Human Gate approval.",
  "Any risky action must be returned as pending approval, not executed.",
].join(" ");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
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
    action: "/",
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
      activeWorkflowId: "workflow-pod-lab",
      currentStep: 0,
      paused: false,
      steps: [
        {
          station: "Research",
          x: "18%",
          y: "44%",
          progress: 28,
          confidence: 72,
          title: "Build Etsy print-on-demand research lane",
          copy: "Agent 101 is collecting demand signals, competitor notes, and freshness labels before any listing idea becomes durable memory.",
          risk: "Low",
        },
        {
          station: "Verify",
          x: "78%",
          y: "44%",
          progress: 51,
          confidence: 82,
          title: "Check contradictions and policy risk",
          copy: "Agent 101 is separating verified evidence from guesses and blocking claims that would need legal, financial, or customer-facing review.",
          risk: "Medium",
        },
        {
          station: "Draft",
          x: "21%",
          y: "70%",
          progress: 74,
          confidence: 88,
          title: "Draft the first workflow",
          copy: "Agent 101 is preparing a repeatable research-to-approval workflow with no account creation, publishing, or spending permission.",
          risk: "Low",
        },
        {
          station: "Approval",
          x: "77%",
          y: "70%",
          progress: 92,
          confidence: 91,
          title: "Package decision for the operator",
          copy: "Agent 101 is bundling evidence, assumptions, expected upside, risks, and the exact action that needs your sign-off.",
          risk: "Approval required",
        }
      ],
    },
    capabilities: [
      {
        id: "cap-pod-niche-scout",
        name: "POD niche scout",
        status: "Draft ready",
        description: "Researches product niches, ranks evidence, and creates listing briefs for approval.",
      },
      {
        id: "cap-market-signal-notebook",
        name: "Market signal notebook",
        status: "Sandbox",
        description: "Summarizes watchlist movement and creates notes. It cannot place trades.",
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
        id: "func-pod-research-brief",
        name: "POD research brief",
        workflowId: "workflow-pod-lab",
        status: "seeded",
        risk: "low",
        ownerAgentId: "agent-001-depo",
        description: "Reusable draft-only process for turning a print-on-demand niche idea into an evidence-labeled listing brief.",
        inputs: ["niche hypothesis", "product type", "evidence notes"],
        outputs: ["listing brief", "assumption log", "approval package"],
        blockedActions: ["publish listing", "create seller account", "purchase inventory", "make earnings claims"],
        createdAt: now(),
      }
    ],
    workflows: [
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
        id: "tpl-pod-niche-scan",
        name: "POD niche scan",
        workflowId: "workflow-pod-lab",
        risk: "low",
        prompt: "Research one Etsy print-on-demand niche and draft an evidence-labeled niche brief. Do not publish, create accounts, or spend money.",
        outcome: "POD brief artifact",
      },
      {
        id: "tpl-pod-listing-outline",
        name: "Listing outline",
        workflowId: "workflow-pod-lab",
        risk: "low",
        prompt: "Turn an approved POD niche into a draft listing outline with title angles, keyword themes, mockup needs, and blocked actions.",
        outcome: "Draft listing plan",
      },
      {
        id: "tpl-stock-watch-note",
        name: "Stock watch note",
        workflowId: "workflow-stock-watch",
        risk: "high",
        prompt: "Prepare a read-only stock algorithm watch note in paper mode. Do not connect a broker, place trades, move money, or make return claims.",
        outcome: "Paper-mode watch note",
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
    tasks: [
      {
        id: "task-seed-pod-niche-brief",
        title: "Draft a POD niche research brief",
        operatorText: "Find a low-risk print-on-demand niche and prepare a listing research workflow for approval.",
        workflowId: "workflow-pod-lab",
        intent: "print_on_demand",
        risk: "low",
        status: "queued",
        evidence: [],
        output: "",
        createdAt: now(),
        updatedAt: now(),
      }
    ],
    artifacts: [],
    executions: [],
    approvals: [
      {
        id: "approval-pod-lane-v0",
        title: "Approve POD research lane v0",
        risk: "low",
        evidence: "3 source notes, 1 contradiction check, 1 spend estimate",
        action: "Allow Agent 101 to save this workflow as a reusable playbook.",
        status: "pending",
        createdAt: now(),
      },
      {
        id: "approval-stock-readonly-v0",
        title: "Review stock algorithm monitor",
        risk: "high",
        evidence: "Signal summary only. Execution permissions blocked.",
        action: "Confirm this lane remains read-only and paper-trading only.",
        status: "pending",
        createdAt: now(),
      }
    ],
    memory: {
      working: [
        {
          id: "mem-working-current-task",
          title: "Current task",
          body: "Design a visible first-agent system for Argentum with Agent 101 as the supervised starting worker.",
          provenance: "operator_goal",
          updatedAt: now(),
        },
        {
          id: "mem-working-domain-priority",
          title: "Open question",
          body: "Business domain priorities are Etsy print-on-demand first, stock algorithm monitoring second.",
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
  if (state.agent?.id === "agent-001-depo") {
    state.agent.name = "Agent 101";
    state.agent.role = "Draft-only Operator";
  }
  state.governance = { ...fresh.governance, ...state.governance };
  state.mission = { ...fresh.mission, ...state.mission };
  state.capabilities = Array.isArray(state.capabilities) ? state.capabilities : fresh.capabilities;
  state.functions = Array.isArray(state.functions) ? state.functions : fresh.functions;
  state.workflows = Array.isArray(state.workflows) ? state.workflows : fresh.workflows;
  state.taskTemplates = Array.isArray(state.taskTemplates) ? state.taskTemplates : fresh.taskTemplates;
  state.tasks = Array.isArray(state.tasks) ? state.tasks : fresh.tasks;
  state.artifacts = Array.isArray(state.artifacts) ? state.artifacts : fresh.artifacts;
  state.executions = Array.isArray(state.executions) ? state.executions : fresh.executions;
  state.approvals = Array.isArray(state.approvals) ? state.approvals : fresh.approvals;
  state.memory = {
    working: state.memory?.working || fresh.memory.working,
    shared: state.memory?.shared || fresh.memory.shared,
    agent: state.memory?.agent || fresh.memory.agent,
  };
  state.audit = Array.isArray(state.audit) ? state.audit : fresh.audit;
  return state;
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
  };
}

function defaultAiProviderConfig() {
  const provider = sanitizeProvider(ENV_AI_PROVIDER || "local_demo");
  return {
    version: 1,
    provider,
    mode: provider === "openai" ? sanitizeAiMode(ENV_AI_MODE || "live") : "demo",
    monthlyLimitUsd: parseMonthlyLimit(ENV_AI_MONTHLY_LIMIT_USD, 10),
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
      monthlyLimitUsd: parseMonthlyLimit(ENV_AI_MONTHLY_LIMIT_USD || stored.monthlyLimitUsd, fresh.monthlyLimitUsd),
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
    monthlyLimitUsd: parseMonthlyLimit(ENV_AI_MONTHLY_LIMIT_USD || config.monthlyLimitUsd, 10),
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
  const health = aiStatus.connectionStatus === "Error"
    ? "OpenAI needs attention"
    : "Local systems operational";

  return {
    health,
    agentId: "Agent 101 active",
    agentMode: state.agent?.externalActions || "Draft only",
    metrics: [
      { label: "State", value: "Ready", percent: 100 },
      { label: "Memory", value: String(memoryCount), percent: Math.min(100, Math.max(8, memoryCount * 8)) },
      { label: "Queue", value: String(queueTotal), percent: Math.min(100, queueTotal * 18) },
      { label: "Security", value: users > 0 ? "On" : "Setup", percent: users > 0 ? 100 : 35 },
    ],
    chart: [
      Math.min(100, 22 + queuedTasks * 12),
      Math.min(100, 30 + pendingApprovals * 10),
      Math.min(100, 26 + artifacts.length * 7),
      Math.min(100, 34 + audit.length * 4),
      Math.min(100, Math.max(12, heapPercent)),
      Math.min(100, 42 + memoryCount * 3),
      aiStatus.connectionStatus === "Error" ? 34 : 76,
      users > 0 ? 88 : 42,
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

function assertAiUsageBudget(config) {
  if (!aiUsageLimitReached(config)) return;
  throw guardedError("AI monthly spending limit reached. Switch to Local Demo Mode or raise AI_MONTHLY_LIMIT_USD.", 402);
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
  };
  config.usage.blockedByLimit = aiUsageLimitReached(config);
  writeAiProviderConfig(config);
  return config.usage;
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
    ["publish", ["publish", "post listing", "go live", "external publish"]],
    ["spend_money", ["spend money", "buy ", "purchase", "pay for", "charge card"]],
    ["move_money", ["move money", "transfer money", "wire funds", "withdraw"]],
    ["contact_customer", ["contact customer", "email customer", "call customer", "message customer"]],
    ["modify_account", ["modify account", "change account", "update account", "delete account"]],
    ["create_live_agent", ["create live agent", "activate agent", "launch agent", "make agent live"]],
    ["change_permissions", ["change permission", "grant permission", "admin permission"]],
    ["change_api_key", ["change api key", "rotate key", "replace key"]],
    ["deploy_campaign", ["deploy campaign", "launch campaign", "send campaign"]],
    ["external_api_action", ["call external api", "run external api", "external api action"]],
  ];
  const match = checks.find(([, phrases]) => phrases.some((phrase) => value.includes(phrase)));
  return match ? match[0] : null;
}

function requiresHumanGate(actionType) {
  return AI_RISKY_ACTION_TYPES.has(actionType);
}

function localDepoDemoResponse(message) {
  const text = String(message || "").toLowerCase();
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
  const outputText = payload.output_text || payload.output?.flatMap((item) => item.content || []).map((part) => part.text || "").join("\n");
  return normalizeDepoAiPayload(outputText, outputText);
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
    name: "POD niche brief",
    description: "Reusable draft-only workflow for converting a print-on-demand idea into an evidence-labeled niche and listing brief.",
    inputs: ["niche idea", "product format", "source notes"],
    outputs: ["niche brief", "listing outline", "assumption log"],
    blockedActions: ["publish listing", "create seller account", "spend money", "make earnings claims"],
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
  if (lower.includes("agent") || lower.includes("function") || lower.includes("capability")) {
    return { workflowId: "workflow-agent-factory", intent: "agent_factory", risk: "medium" };
  }
  return { workflowId: "workflow-pod-lab", intent: "print_on_demand", risk: "low" };
}

function taskPlan(task) {
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
      "Publishing and store actions are blocked.",
      "Listing research must separate verified evidence from assumptions.",
      "Reusable POD playbooks need human approval before promotion to shared memory.",
    ],
    output: "Agent 101 drafted a POD research brief: choose one niche hypothesis, gather demand and competitor evidence, label assumptions, create a listing outline, estimate costs, and stop before publishing or account actions.",
    approvalTitle: "Review POD task output",
    approvalAction: "Approve whether this POD task output can be promoted into shared memory as a reusable playbook.",
  };
}

function artifactForTask(task, plan) {
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
  if (workflowId === "workflow-stock-watch") return "market_monitoring";
  if (workflowId === "workflow-agent-factory") return "agent_factory";
  return "print_on_demand";
}

function riskForWorkflow(workflowId) {
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
    location: "/",
  });
  res.end();
}

async function handleSetup(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  const isRootRoute = url.pathname === "/";
  const isSetupRoute = url.pathname === "/setup";
  if (!isRootRoute && !isSetupRoute) return false;

  const store = readAuthStore();
  if (activeUserCount(store) > 0) {
    if (isSetupRoute) {
      redirect(res, currentSession(req) ? "/" : "/login", req);
      return true;
    }
    return false;
  }

  if (isSetupRoute && req.method === "GET") {
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
      redirect(res, "/", req);
      return true;
    }
    if (currentSession(req)) {
      redirect(res, "/", req);
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
        redirect(res, "/", req);
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
      "Agent 101 prepared the POD research lane as a reusable draft workflow. Publishing remains blocked.",
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
        evidence: "Latest cycle includes research, verification, draft, and policy classification.",
        action: "Review whether Agent 101 can promote the POD workflow into shared memory.",
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

  if (req.method === "POST" && url.pathname === "/api/depo/chat") {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, await handleDepoChat(payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
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
    if (approval.status === "approved" && approval.id === "approval-pod-lane-v0") {
      addMemory(
        state,
        "shared",
        "POD research lane approved",
        "The operator approved Agent 101's print-on-demand research workflow as a reusable playbook.",
        "human_approval",
      );
      const workflow = state.workflows.find((item) => item.id === "workflow-pod-lab");
      if (workflow) workflow.status = "approved_playbook";
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
  let filePath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
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

ensureState();
readAuthStore();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  try {
    assertTrustedOrigin(req);
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

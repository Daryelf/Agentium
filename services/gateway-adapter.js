const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_SCOPES = {
  health: "agent101.chat",
  chat: "agent101.chat",
  threadsRead: "agent101.threads.read",
  threadsWrite: "agent101.threads.write",
  runsRead: "agent101.runs.read",
  approvalsRead: "approvals.read",
  approvalsNotify: "approvals.notify",
  memorySearch: "memory.search",
  artifactsSummary: "artifacts.summary",
};

const SAFE_SCOPES = [
  "agent101.chat",
  "agent101.threads.read",
  "agent101.threads.write",
  "agent101.runs.read",
  "approvals.read",
  "approvals.notify",
  "memory.search",
  "artifacts.summary",
];

const DENIED_SCOPES = new Set(["approvals.decide", "vault.write", "tools.execute", "agents.create", "authority.change", "filesystem.access"]);

function now() {
  return new Date().toISOString();
}

function credentialStorePath(dataDir) {
  return path.join(dataDir, "gateway-credentials.json");
}

function emptyStore() {
  return { credentials: [], audit: [], rateLimits: {} };
}

function readStore(dataDir) {
  const filePath = credentialStorePath(dataDir);
  if (!fs.existsSync(filePath)) return emptyStore();
  try {
    return { ...emptyStore(), ...JSON.parse(fs.readFileSync(filePath, "utf8")) };
  } catch {
    return emptyStore();
  }
}

function writeStore(dataDir, store) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(credentialStorePath(dataDir), `${JSON.stringify(store, null, 2)}\n`);
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function publicCredential(record) {
  const { tokenHash: _hash, ...publicRecord } = record;
  return publicRecord;
}

function audit(dataDir, event) {
  const store = readStore(dataDir);
  store.audit.unshift({
    id: `gateway-audit-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    createdAt: now(),
    ...event,
    token: undefined,
    authorization: undefined,
  });
  store.audit = store.audit.slice(0, 500);
  writeStore(dataDir, store);
}

function createGatewayCredential(dataDir, payload = {}) {
  const requestedScopes = Array.isArray(payload.scopes) && payload.scopes.length ? payload.scopes : SAFE_SCOPES;
  const denied = requestedScopes.filter((scope) => DENIED_SCOPES.has(scope) || !SAFE_SCOPES.includes(scope));
  if (denied.length) {
    const error = new Error(`Gateway scopes are not allowed: ${denied.join(", ")}`);
    error.status = 400;
    throw error;
  }
  const token = `agw_${crypto.randomBytes(32).toString("base64url")}`;
  const record = {
    id: `gateway-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    name: String(payload.name || "OpenClaw Test Gateway").slice(0, 120),
    scopes: requestedScopes,
    status: "active",
    tokenHash: tokenHash(token),
    createdAt: now(),
    lastUsedAt: null,
    expiresAt: payload.expiresAt || null,
  };
  const store = readStore(dataDir);
  store.credentials.unshift(record);
  writeStore(dataDir, store);
  audit(dataDir, { action: "gateway_credential_create", credentialId: record.id, scopes: record.scopes });
  return { credential: publicCredential(record), token };
}

function listGatewayCredentials(dataDir) {
  return readStore(dataDir).credentials.map(publicCredential);
}

function revokeGatewayCredential(dataDir, credentialId) {
  const store = readStore(dataDir);
  const record = store.credentials.find((credential) => credential.id === credentialId);
  if (!record) {
    const error = new Error("Gateway credential not found.");
    error.status = 404;
    throw error;
  }
  record.status = "revoked";
  record.revokedAt = now();
  writeStore(dataDir, store);
  audit(dataDir, { action: "gateway_credential_revoke", credentialId });
  return publicCredential(record);
}

function rotateGatewayCredential(dataDir, credentialId) {
  const store = readStore(dataDir);
  const record = store.credentials.find((credential) => credential.id === credentialId);
  if (!record) {
    const error = new Error("Gateway credential not found.");
    error.status = 404;
    throw error;
  }
  const token = `agw_${crypto.randomBytes(32).toString("base64url")}`;
  record.tokenHash = tokenHash(token);
  record.rotatedAt = now();
  record.status = "active";
  writeStore(dataDir, store);
  audit(dataDir, { action: "gateway_credential_rotate", credentialId });
  return { credential: publicCredential(record), token };
}

function extractBearer(headers = {}) {
  const auth = headers.authorization || headers.Authorization || "";
  const match = String(auth).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function assertGatewayAuth(dataDir, req, requiredScope) {
  const requestId = req.headers["x-request-id"] || `gateway-req-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const token = extractBearer(req.headers || {});
  if (!token) {
    audit(dataDir, { action: "gateway_denial", reason: "missing_token", requestId });
    const error = new Error("Gateway token required.");
    error.status = 401;
    throw error;
  }
  const store = readStore(dataDir);
  const hash = tokenHash(token);
  const record = store.credentials.find((credential) => credential.tokenHash === hash);
  if (!record || record.status !== "active") {
    audit(dataDir, { action: "gateway_denial", reason: record?.status === "revoked" ? "revoked_token" : "invalid_token", requestId });
    const error = new Error("Gateway token is invalid or revoked.");
    error.status = 401;
    throw error;
  }
  if (record.expiresAt && Date.parse(record.expiresAt) < Date.now()) {
    audit(dataDir, { action: "gateway_denial", reason: "expired_token", credentialId: record.id, requestId });
    const error = new Error("Gateway token has expired.");
    error.status = 401;
    throw error;
  }
  if (requiredScope && !record.scopes.includes(requiredScope)) {
    audit(dataDir, { action: "gateway_denial", reason: "missing_scope", credentialId: record.id, requiredScope, requestId });
    const error = new Error("Gateway credential is missing required scope.");
    error.status = 403;
    throw error;
  }
  const minute = Math.floor(Date.now() / 60000);
  const bucketKey = `${record.id}:${minute}`;
  store.rateLimits[bucketKey] = (store.rateLimits[bucketKey] || 0) + 1;
  if (store.rateLimits[bucketKey] > 120) {
    writeStore(dataDir, store);
    audit(dataDir, { action: "gateway_denial", reason: "rate_limited", credentialId: record.id, requestId });
    const error = new Error("Gateway rate limit reached.");
    error.status = 429;
    throw error;
  }
  record.lastUsedAt = now();
  writeStore(dataDir, store);
  return { credential: publicCredential(record), requestId };
}

function bridgeConfig(env = process.env) {
  const mode = String(env.OPENCLAW_BRIDGE_MODE || "disabled").toLowerCase();
  return {
    enabled: String(env.OPENCLAW_BRIDGE_ENABLED || "false").toLowerCase() === "true",
    mode: ["disabled", "test", "production"].includes(mode) ? mode : "disabled",
    gatewayUrl: String(env.OPENCLAW_GATEWAY_URL || ""),
    profile: String(env.OPENCLAW_PROFILE || "argentum-test"),
    allowed: mode === "test" || mode === "production",
  };
}

module.exports = {
  REQUIRED_SCOPES,
  SAFE_SCOPES,
  assertGatewayAuth,
  audit,
  bridgeConfig,
  createGatewayCredential,
  listGatewayCredentials,
  revokeGatewayCredential,
  rotateGatewayCredential,
};

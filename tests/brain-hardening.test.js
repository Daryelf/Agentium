const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const test = require("node:test");

const agentContextBuilder = require("../services/agent-context-builder");
const brainBackup = require("../services/brain-backup");
const brainVerification = require("../services/brain-verification");
const gatewayAdapter = require("../services/gateway-adapter");
const obsidianVault = require("../services/obsidian-vault");

function invoke(handler, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body || "";
    const req = new Readable({
      read() {
        this.push(body);
        this.push(null);
      },
    });
    req.method = options.method || "GET";
    req.url = options.url || "/";
    req.headers = { host: "127.0.0.1:5173", ...(options.headers || {}) };
    req.socket = { remoteAddress: "127.0.0.1", encrypted: false };
    const chunks = [];
    const res = {
      statusCode: 200,
      headers: {},
      writeHead(statusCode, headers = {}) {
        this.statusCode = statusCode;
        this.headers = { ...this.headers, ...headers };
      },
      write(chunk) {
        if (chunk) chunks.push(Buffer.from(chunk));
      },
      end(chunk) {
        if (chunk) chunks.push(Buffer.from(chunk));
        resolve({ status: this.statusCode, headers: this.headers, body: Buffer.concat(chunks).toString("utf8") });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

async function loginServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-brain-hardening-"));
  process.env.APP_MODE = "local";
  process.env.HOST = "127.0.0.1";
  process.env.ARGENTUM_DATA_DIR = dataDir;
  process.env.SESSION_SECRET = "brain-hardening-session-secret-brain-hardening-session-secret";
  process.env.ADMIN_USERNAME = "";
  process.env.ADMIN_PASSWORD = "";
  delete require.cache[require.resolve("../server")];
  const { handleArgentumRequest } = require("../server");
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const setup = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username: "brainadmin",
      password: "BrainAdmin12345",
      confirmPassword: "BrainAdmin12345",
    }).toString(),
  });
  assert.equal(setup.status, 302);
  return { handleArgentumRequest, cookie: String(setup.headers["set-cookie"] || "").split(";")[0], dataDir };
}

test("brain backup verifies and restore dry-run does not change live vault", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brain-backup-vault-"));
  const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), "brain-backups-"));
  obsidianVault.initializeVault(root);
  const before = fs.readFileSync(path.join(root, "00_System", "Manifests", "canonical-entities.json"), "utf8");
  const backup = brainBackup.createBrainBackup({ vaultPath: root, backupRoot });
  const verification = brainBackup.verifyBrainBackup(backup.backupPath);
  const dryRun = brainBackup.restoreDryRun({ backupPath: backup.backupPath, vaultPath: root });
  const after = fs.readFileSync(path.join(root, "00_System", "Manifests", "canonical-entities.json"), "utf8");
  assert.equal(backup.verified, true);
  assert.equal(verification.verified, true);
  assert.equal(dryRun.changesLiveFiles, false);
  assert.equal(after, before);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(backupRoot, { recursive: true, force: true });
});

test("deterministic Agent 1010 context includes required evidence and excludes rejected/archive/unrelated records", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brain-context-vault-"));
  obsidianVault.initializeVault(root);
  const proposal = obsidianVault.createMemoryProposal(root, {
    title: "Clipping preference memory",
    content: "Clipping Office prefers approved streamer monitoring before publishing.",
    business: "business.argentum",
    office: "office.clipping",
    confidence: 0.9,
  });
  obsidianVault.approveMemoryProposal(root, proposal.path);
  const rejected = obsidianVault.createMemoryProposal(root, { title: "Rejected memory", content: "Do not use.", business: "business.argentum" });
  obsidianVault.rejectMemoryProposal(root, rejected.path, "bad data");
  const archived = obsidianVault.createCanonicalNote(root, { type: "knowledge", title: "Archived Test Knowledge", data: { overview: "Archive me." } });
  obsidianVault.archiveNote(root, archived.path, "test");
  const context = agentContextBuilder.buildAgentContext({ vaultPath: root, officeId: "office.clipping", projectId: "project.clip_office_production", includeTrace: true });
  const serialized = JSON.stringify(context);
  assert.match(serialized, /Supervised_Agent_Rules/);
  assert.match(serialized, /Agent_1010/);
  assert.match(serialized, /Clipping_Office/);
  assert.match(serialized, /Clipping preference memory/);
  assert.doesNotMatch(serialized, /Rejected memory/);
  assert.doesNotMatch(serialized, /Archived Test Knowledge/);
  assert.equal(context.citations.some((citation) => citation.canonicalPath === "30_Agents/Agent_1010/_Agent.md"), true);
  assert.equal(typeof context.contextHash, "string");
  fs.rmSync(root, { recursive: true, force: true });
});

test("memory correction supersedes old approved memory and archive removes records from default search", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brain-memory-vault-"));
  obsidianVault.initializeVault(root);
  const proposal = obsidianVault.createMemoryProposal(root, { title: "Correction target", content: "Old value.", business: "business.argentum", confidence: 0.8 });
  const approved = obsidianVault.approveMemoryProposal(root, proposal.path);
  const correction = obsidianVault.createMemoryCorrection(root, approved.path, { newValue: "New value.", confidence: 0.9 });
  const corrected = obsidianVault.approveMemoryCorrection(root, correction.path, approved.path);
  const old = obsidianVault.readNote(root, approved.path);
  assert.equal(old.frontmatter.status, "superseded");
  assert.equal(corrected.frontmatter.status, "approved");
  assert.equal(obsidianVault.searchVault(root, "Old value").some((item) => item.path === approved.path), false);
  const archived = obsidianVault.archiveNote(root, corrected.path, "done");
  assert.equal(obsidianVault.searchVault(root, "New value").some((item) => item.path === archived.path), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("rename preserves stable ID and legacy path resolves", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brain-rename-vault-"));
  obsidianVault.initializeVault(root);
  const note = obsidianVault.createCanonicalNote(root, { type: "project", title: "Rename Safety Project", businessId: "business.argentum" });
  const id = note.frontmatter.id;
  const oldPath = note.path;
  const renamed = obsidianVault.renameCanonicalEntity(root, id, "Renamed Safety Project");
  assert.equal(renamed.frontmatter.id, id);
  assert.notEqual(renamed.path, oldPath);
  assert.equal(obsidianVault.resolveLegacyPath(root, oldPath), renamed.path);
  fs.rmSync(root, { recursive: true, force: true });
});

test("brain verification report passes critical checks and writes reports", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brain-verify-vault-"));
  obsidianVault.initializeVault(root);
  const report = brainVerification.verifyBrain({
    vaultPath: root,
    contextBuilder: (payload) => agentContextBuilder.buildAgentContext({ ...payload, vaultPath: root }),
    skipBackup: true,
  });
  assert.equal(report.criticalCount, 0);
  assert.equal(fs.existsSync(path.join(root, "00_System", "Manifests", "brain-verification-report.json")), true);
  assert.equal(fs.existsSync(path.join(root, "00_System", "Manifests", "brain-verification-report.md")), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("gateway credentials require scopes, reject blocked routes, and read memory only", async (t) => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "brain-gateway-vault-"));
  obsidianVault.initializeVault(vaultPath);
  const { handleArgentumRequest, cookie } = await loginServer(t);
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));

  await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/api/obsidian/init",
    headers: { cookie, "content-type": "application/json", origin: "http://127.0.0.1:5173" },
    body: JSON.stringify({ vaultPath }),
  });
  const proposal = obsidianVault.createMemoryProposal(vaultPath, { title: "Gateway clipping memory", content: "Approved memory is read-only through gateway.", business: "business.argentum", confidence: 0.8 });
  obsidianVault.approveMemoryProposal(vaultPath, proposal.path);

  const credentialRes = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/api/brain/gateway/credentials",
    headers: { cookie, "content-type": "application/json", origin: "http://127.0.0.1:5173" },
    body: JSON.stringify({ name: "Test Gateway", scopes: gatewayAdapter.SAFE_SCOPES }),
  });
  assert.equal(credentialRes.status, 201);
  const token = JSON.parse(credentialRes.body).token;

  const health = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/api/gateway/v1/health",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(health.status, 200);

  const memory = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/api/gateway/v1/memory/search",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query: "Gateway clipping", businessId: "business.argentum", limit: 5 }),
  });
  assert.equal(memory.status, 200);
  assert.equal(JSON.parse(memory.body).results.some((result) => result.title === "Gateway clipping memory"), true);

  const agentMessage = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/api/gateway/v1/agent101/messages",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ externalSessionId: "gateway-test-session", channel: "openclaw", userId: "operator", message: "What is Agent 1010's approved role?", metadata: {} }),
  });
  assert.equal(agentMessage.status, 200);
  const agentPayload = JSON.parse(agentMessage.body);
  assert.equal(["answered", "waiting_approval"].includes(agentPayload.status), true);
  assert.equal(agentPayload.citations.some((citation) => citation.canonicalPath === "30_Agents/Agent_1010/_Agent.md"), true);

  const blockedWrite = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/api/gateway/v1/vault/write",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ path: "x", content: "no" }),
  });
  assert.equal(blockedWrite.status, 403);

  const revokeRes = await invoke(handleArgentumRequest, {
    method: "POST",
    url: `/api/brain/gateway/credentials/${JSON.parse(credentialRes.body).credential.id}/revoke`,
    headers: { cookie, origin: "http://127.0.0.1:5173" },
  });
  assert.equal(revokeRes.status, 200);

  const denied = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/api/gateway/v1/health",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(denied.status, 401);
});

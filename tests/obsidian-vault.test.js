const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const test = require("node:test");

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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-obsidian-route-"));
  process.env.APP_MODE = "local";
  process.env.HOST = "127.0.0.1";
  process.env.ARGENTUM_DATA_DIR = dataDir;
  process.env.SESSION_SECRET = "obsidian-route-session-secret-obsidian-route-session-secret";
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
      username: "obsidianadmin",
      password: "ObsidianAdmin12345",
      confirmPassword: "ObsidianAdmin12345",
    }).toString(),
  });
  assert.equal(setup.status, 302);
  return { handleArgentumRequest, cookie: String(setup.headers["set-cookie"] || "").split(";")[0], dataDir };
}

test("Obsidian vault initializes canonical Argentum Brain v2 structure", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-brain-v2-"));
  const status = obsidianVault.initializeVault(root);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "00_System", "Manifests", "canonical-entities.json"), "utf8"));

  assert.equal(status.status, "Healthy");
  assert.equal(status.connected, true);
  assert.equal(status.schemaVersion, "2.0.0");
  assert.equal(fs.existsSync(path.join(root, "00_System", "Taxonomy.md")), true);
  assert.equal(fs.existsSync(path.join(root, "30_Agents", "Agent_1010", "_Agent.md")), true);
  assert.equal(fs.existsSync(path.join(root, "20_Offices", "Argentum", "Clipping_Office", "_Office.md")), true);
  assert.equal(manifest.entities.filter((entity) => entity.id === "agent.1010").length, 1);
  assert.equal(manifest.entities.some((entity) => entity.path === "10_Businesses/Argentum/_Business.md"), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("Obsidian tool adapter stays inside vault and rejects actual secrets", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-brain-tools-"));
  obsidianVault.initializeVault(root);

  const append = obsidianVault.openClawToolAction(root, "append_note", {
    note: "80_Memory/Imported/Lessons_Learned.md",
    content: "- Keep Obsidian as the long-term brain.",
  });
  assert.match(append.result.content, /long-term brain/);

  assert.throws(
    () => obsidianVault.openClawToolAction(root, "read_note", { note: "../outside" }),
    /restricted to the configured vault/,
  );
  assert.throws(
    () => obsidianVault.openClawToolAction(root, "append_note", { note: "80_Memory/Imported/Lessons_Learned.md", content: "OPENAI_API_KEY=sk-secret-value" }),
    /must not contain API keys/i,
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("Agent context loader uses deterministic canonical sections without blind traversal", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-brain-context-"));
  obsidianVault.initializeVault(root);
  obsidianVault.createMemoryProposal(root, { title: "Approved operating memory", content: "Agent 1010 should preserve Human Gate approvals.", confidence: 0.8 });
  const proposal = obsidianVault.searchVault(root, "Approved operating memory", { includeWorking: true, includeDraft: true })[0];
  obsidianVault.approveMemoryProposal(root, proposal.path);

  const context = obsidianVault.buildAgentContext(root, {
    business: "business.argentum",
    office: "office.clipping",
    workflow: "workflow.clipping",
    conversationSummary: "Operator asked for a canonical Obsidian brain.",
  });
  const paths = context.notes.map((note) => note.path);

  assert.equal(context.agent, "agent.1010");
  assert.equal(context.budgets.length, 7);
  assert.equal(paths.includes("30_Agents/Agent_1010/_Agent.md"), true);
  assert.equal(paths.includes("20_Offices/Argentum/Clipping_Office/_Office.md"), true);
  assert.equal(context.notes.some((note) => note.section === "memory" && /Approved operating memory/.test(note.title)), true);
  assert.equal(paths.some((item) => item.startsWith("90_Execution/Daily_Notes/")), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("Migration dry-run maps legacy paths and actual migration backs up old vault", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-brain-legacy-"));
  fs.mkdirSync(path.join(root, "02_Agents"), { recursive: true });
  fs.writeFileSync(path.join(root, "02_Agents", "Agent_1010.md"), "# Agent 1010\n\nLegacy authority note.\n");

  const dryRun = obsidianVault.migrateLegacyVault(root, { dryRun: true });
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.actions.some((action) => action.from === "02_Agents/Agent_1010.md" && action.to === "30_Agents/Agent_1010/_Agent.md"), true);

  const migrated = obsidianVault.migrateLegacyVault(root);
  assert.equal(migrated.status, "Healthy");
  assert.equal(fs.existsSync(migrated.backupPath), true);
  assert.match(fs.readFileSync(path.join(root, "30_Agents", "Agent_1010", "_Agent.md"), "utf8"), /Legacy authority note/);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(migrated.backupPath, { recursive: true, force: true });
});

test("Canonical note creation prevents duplicate IDs and names", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-brain-create-"));
  obsidianVault.initializeVault(root);

  const note = obsidianVault.createCanonicalNote(root, {
    type: "workflow",
    title: "Nightly Review Workflow",
    businessId: "business.argentum",
    data: { overview: "Nightly operating review." },
  });
  assert.equal(note.path, "50_Operations/Workflows/Nightly_Review_Workflow.md");
  assert.throws(
    () => obsidianVault.createCanonicalNote(root, { type: "workflow", title: "Nightly Review Workflow" }),
    /already exists/i,
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("Obsidian routes initialize, search, validate, list entities, graph, and context", async (t) => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-route-brain-"));
  const { handleArgentumRequest, cookie } = await loginServer(t);
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));

  const init = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/api/obsidian/init",
    headers: { cookie, "content-type": "application/json", origin: "http://127.0.0.1:5173" },
    body: JSON.stringify({ vaultPath }),
  });
  assert.equal(init.status, 200);
  assert.equal(JSON.parse(init.body).status, "Healthy");

  const search = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/api/obsidian/search?q=Agent%201010&limit=5",
    headers: { cookie, origin: "http://127.0.0.1:5173" },
  });
  assert.equal(search.status, 200);
  assert.equal(JSON.parse(search.body).results.some((result) => result.path === "30_Agents/Agent_1010/_Agent.md"), true);

  const entities = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/api/obsidian/entities?type=agent",
    headers: { cookie, origin: "http://127.0.0.1:5173" },
  });
  assert.equal(entities.status, 200);
  assert.equal(JSON.parse(entities.body).entities.some((entity) => entity.id === "agent.1010"), true);

  const graph = await invoke(handleArgentumRequest, {
    method: "GET",
    url: "/api/obsidian/graph",
    headers: { cookie, origin: "http://127.0.0.1:5173" },
  });
  assert.equal(graph.status, 200);
  assert.equal(JSON.parse(graph.body).nodes.some((node) => node.id === "agent.1010"), true);

  const validation = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/api/obsidian/validate",
    headers: { cookie, "content-type": "application/json", origin: "http://127.0.0.1:5173" },
    body: "{}",
  });
  assert.equal(validation.status, 200);
  assert.equal(JSON.parse(validation.body).validation.healthy, true);

  const context = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/api/obsidian/context",
    headers: { cookie, "content-type": "application/json", origin: "http://127.0.0.1:5173" },
    body: JSON.stringify({ business: "business.argentum", office: "office.clipping", workflow: "workflow.clipping" }),
  });
  assert.equal(context.status, 200);
  assert.equal(JSON.parse(context.body).context.notes.some((note) => note.path === "30_Agents/Agent_1010/_Agent.md"), true);
});

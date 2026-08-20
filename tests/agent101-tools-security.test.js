const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const toolsModuleUrl = pathToFileURL(
  path.join(__dirname, "..", "CLIPPING OFFICE ", "services", "agent-tools.js")
).href;

let toolsModulePromise;

function loadTools() {
  toolsModulePromise ||= import(toolsModuleUrl);
  return toolsModulePromise;
}

async function makeFixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "argentum-agent101-tools-"));
  const projectRoot = path.join(base, "project");
  const outputRoot = path.join(base, "outputs");
  const outsideRoot = path.join(base, "outside");
  await Promise.all([
    fs.mkdir(projectRoot, { recursive: true }),
    fs.mkdir(outputRoot, { recursive: true }),
    fs.mkdir(outsideRoot, { recursive: true })
  ]);

  const state = { approvalRequests: [] };
  let approvalSequence = 0;
  const context = {
    projectRoot,
    outputRoot,
    state,
    config: {},
    runId: "run_security_test",
    sessionId: "session_security_test",
    createApprovalRequest(payload) {
      const existing = state.approvalRequests.find(
        (approval) => approval.linkedId === payload.linkedId
          && approval.type === payload.type
          && approval.status === "pending"
      );
      if (existing) return existing;
      const approval = {
        ...payload,
        id: `approval_${++approvalSequence}`,
        status: "pending",
        createdAt: new Date().toISOString()
      };
      state.approvalRequests.unshift(approval);
      return approval;
    },
    async saveState() {},
    async logEvent() {}
  };

  t.after(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  return { base, projectRoot, outputRoot, outsideRoot, state, context };
}

test("Agent 101 file tools block secrets, traversal, and symlink reads", async (t) => {
  const { executeTool } = await loadTools();
  const { projectRoot, outsideRoot, context } = await makeFixture(t);
  await fs.mkdir(path.join(projectRoot, "data"), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(projectRoot, "safe.txt"), "safe project context\n"),
    fs.writeFile(path.join(projectRoot, ".env"), "OPENAI_API_KEY=do-not-read\n"),
    fs.writeFile(path.join(projectRoot, ".env.example"), "OPENAI_API_KEY=\n"),
    fs.writeFile(path.join(projectRoot, "api-token.txt"), "do-not-read\n"),
    fs.writeFile(path.join(projectRoot, "data", "runtime-state.json"), "{}\n"),
    fs.writeFile(path.join(outsideRoot, "outside.txt"), "outside\n")
  ]);
  await fs.symlink(outsideRoot, path.join(projectRoot, "linked-outside"));

  const safe = await executeTool("read_file", { path: "safe.txt" }, context);
  assert.match(safe.content, /safe project context/);
  const envExample = await executeTool("read_file", { path: ".env.example" }, context);
  assert.equal(envExample.content, "OPENAI_API_KEY=\n");

  await assert.rejects(
    executeTool("read_file", { path: ".env" }, context),
    /environment files are not readable/i
  );
  await assert.rejects(
    executeTool("read_file", { path: "api-token.txt" }, context),
    /token.*not readable/i
  );
  await assert.rejects(
    executeTool("read_file", { path: "data/runtime-state.json" }, context),
    /data.*outside Agent 101's readable workspace/i
  );
  await assert.rejects(
    executeTool("read_file", { path: "../outside/outside.txt" }, context),
    /path traversal/i
  );
  await assert.rejects(
    executeTool("read_file", { path: path.join(outsideRoot, "outside.txt") }, context),
    /outside the allowed directory/i
  );
  await assert.rejects(
    executeTool("read_file", { path: "linked-outside/outside.txt" }, context),
    /symbolic links are not allowed/i
  );
  await assert.rejects(
    executeTool("write_file", { path: "../escaped.txt", content: "escape" }, context),
    /path traversal/i
  );
  await assert.rejects(
    executeTool("read_file", { path: "Data/runtime-state.json" }, context),
    /Data.*outside Agent 101's readable workspace/i
  );
  await assert.rejects(
    executeTool("read_file", { path: ".GIT/config" }, context),
    /\.GIT.*outside Agent 101's readable workspace/i
  );
  await assert.rejects(
    executeTool("write_file", { path: "outputs/.TMP/forged.json", content: "{}\n" }, context),
    /reserved for Argentum integrity records/i
  );
  await assert.rejects(
    executeTool("write_file", { path: "outputs/PROJECT-EDIT-PROPOSALS/forged.json", content: "{}\n" }, context),
    /reserved for Argentum integrity records/i
  );

});

test("project search and sliced reads support large source without exposing secrets", async (t) => {
  const { executeTool } = await loadTools();
  const { projectRoot, context } = await makeFixture(t);
  const source = `${"const filler = 1;\n".repeat(9000)}const durableMissionMarker = true;\n`;
  await fs.writeFile(path.join(projectRoot, "large.js"), source);
  await fs.writeFile(path.join(projectRoot, ".env"), "DURABLE_MISSION_MARKER=secret\n");

  const search = await executeTool("search_project_text", { query: "durableMissionMarker", path: "." }, context);
  assert.equal(search.matches.length, 1);
  assert.equal(search.matches[0].path, "large.js");
  assert.equal(search.matches[0].line, 9001);

  const first = await executeTool("read_file", { path: "large.js", max_chars: 1000 }, context);
  assert.equal(first.truncated, true);
  assert.equal(first.offsetBytes, 0);
  const tail = await executeTool("read_file", { path: "large.js", offset_bytes: first.sizeBytes - 100, max_chars: 100 }, context);
  assert.match(tail.content, /durableMissionMarker/);
  assert(!search.matches.some((match) => match.path === ".env"));
});

test("run_shell approvals are action-typed, session-bound, exact-scope, and one-time", async (t) => {
  const { executeTool } = await loadTools();
  const { projectRoot, state, context } = await makeFixture(t);
  const scriptsDir = path.join(projectRoot, "scripts");
  await fs.mkdir(scriptsDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(scriptsDir, "emit.mjs"), "console.log('scope-ok');\n"),
    fs.writeFile(
      path.join(scriptsDir, "write-marker.mjs"),
      "import fs from 'node:fs/promises'; await fs.writeFile('command-marker.txt', 'executed');\n"
    ),
    fs.writeFile(
      path.join(scriptsDir, "cwd-marker.mjs"),
      "import fs from 'node:fs/promises'; await fs.writeFile('../cwd-marker.txt', 'executed');\n"
    )
  ]);

  state.approvalRequests.push({
    id: "approval_wrong_command",
    status: "approved",
    actionType: "agent101_shell",
    details: { command: "node scripts/emit.mjs", cwd: "." },
    evidence: { sessionId: context.sessionId }
  });
  const wrongCommand = await executeTool("run_shell", {
    command: "node scripts/write-marker.mjs",
    approval_id: "approval_wrong_command"
  }, context);
  assert.equal(wrongCommand.requiresApproval, true);
  assert.equal(wrongCommand.executed, false);
  assert.notEqual(wrongCommand.approval_id, "approval_wrong_command");
  await assert.rejects(fs.stat(path.join(projectRoot, "command-marker.txt")), { code: "ENOENT" });

  state.approvalRequests.push({
    id: "approval_wrong_cwd",
    status: "approved",
    actionType: "agent101_shell",
    details: { command: "node cwd-marker.mjs", cwd: "." },
    evidence: { sessionId: context.sessionId }
  });
  const wrongCwd = await executeTool("run_shell", {
    command: "node cwd-marker.mjs",
    cwd: "scripts",
    approval_id: "approval_wrong_cwd"
  }, context);
  assert.equal(wrongCwd.requiresApproval, true);
  assert.equal(wrongCwd.executed, false);
  assert.notEqual(wrongCwd.approval_id, "approval_wrong_cwd");
  await assert.rejects(fs.stat(path.join(projectRoot, "cwd-marker.txt")), { code: "ENOENT" });

  state.approvalRequests.push({
    id: "approval_wrong_action_type",
    status: "approved",
    actionType: "agent101_output_delete",
    details: { command: "node scripts/emit.mjs", cwd: "." },
    evidence: { sessionId: context.sessionId }
  });
  const wrongActionType = await executeTool("run_shell", {
    command: "node scripts/emit.mjs",
    approval_id: "approval_wrong_action_type"
  }, context);
  assert.equal(wrongActionType.requiresApproval, true);
  assert.equal(wrongActionType.executed, false);

  state.approvalRequests.push({
    id: "approval_wrong_session",
    status: "approved",
    actionType: "agent101_shell",
    details: { command: "node scripts/emit.mjs", cwd: "." },
    evidence: { sessionId: "different_session" }
  });
  const wrongSession = await executeTool("run_shell", {
    command: "node scripts/emit.mjs",
    approval_id: "approval_wrong_session"
  }, context);
  assert.equal(wrongSession.requiresApproval, true);
  assert.equal(wrongSession.executed, false);

  state.approvalRequests.push({
    id: "approval_exact_scope",
    status: "approved",
    actionType: "agent101_shell",
    details: { command: "node scripts/emit.mjs", cwd: "." },
    evidence: { sessionId: context.sessionId }
  });
  const exact = await executeTool("run_shell", {
    command: "node scripts/emit.mjs",
    approval_id: "approval_exact_scope"
  }, context);
  assert.equal(exact.exitCode, 0);
  assert.match(exact.stdout, /scope-ok/);
  assert.equal(exact.approval_id, "approval_exact_scope");
  const consumedApproval = state.approvalRequests.find((approval) => approval.id === "approval_exact_scope");
  assert.equal(consumedApproval.useCount, 1);
  assert.match(consumedApproval.consumedAt, /^\d{4}-\d{2}-\d{2}T/);

  const replay = await executeTool("run_shell", {
    command: "node scripts/emit.mjs",
    approval_id: "approval_exact_scope"
  }, context);
  assert.equal(replay.requiresApproval, true);
  assert.equal(replay.executed, false);
  assert.notEqual(replay.approval_id, "approval_exact_scope");
});

test("run_shell reports a nonzero approved command as an execution error", async (t) => {
  const { executeTool } = await loadTools();
  const { projectRoot, state, context } = await makeFixture(t);
  await fs.mkdir(path.join(projectRoot, "scripts"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "scripts", "fail.mjs"),
    "console.error('expected failure'); process.exit(7);\n"
  );
  state.approvalRequests.push({
    id: "approval_expected_failure",
    status: "approved",
    actionType: "agent101_shell",
    details: { command: "node scripts/fail.mjs", cwd: "." },
    evidence: { sessionId: context.sessionId }
  });

  const result = await executeTool("run_shell", {
    command: "node scripts/fail.mjs",
    approval_id: "approval_expected_failure"
  }, context);

  assert.equal(result.error, true);
  assert.equal(result.exitCode, 7);
  assert.match(result.stderr, /expected failure/);
  assert.equal(result.approval_id, "approval_expected_failure");
});

test("delete_file requires approval for the exact output path", async (t) => {
  const { executeTool } = await loadTools();
  const { outputRoot, state, context } = await makeFixture(t);
  const firstPath = path.join(outputRoot, "documents", "first.txt");
  const secondPath = path.join(outputRoot, "documents", "second.txt");
  await fs.mkdir(path.dirname(firstPath), { recursive: true });
  await Promise.all([
    fs.writeFile(firstPath, "keep until approved\n"),
    fs.writeFile(secondPath, "different scope\n")
  ]);

  const gated = await executeTool("delete_file", { path: "outputs/documents/first.txt" }, context);
  assert.equal(gated.requiresApproval, true);
  assert.equal(gated.deleted, false);
  assert.equal((await fs.stat(firstPath)).isFile(), true);

  const requested = state.approvalRequests.find((approval) => approval.id === gated.approval_id);
  assert(requested, "delete should create a Human Gate approval");
  requested.status = "approved";

  const wrongPath = await executeTool("delete_file", {
    path: "outputs/documents/second.txt",
    approval_id: requested.id
  }, context);
  assert.equal(wrongPath.requiresApproval, true);
  assert.equal(wrongPath.deleted, false);
  assert.equal((await fs.stat(secondPath)).isFile(), true);

  const deleted = await executeTool("delete_file", {
    path: "outputs/documents/first.txt",
    approval_id: requested.id
  }, context);
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.approval_id, requested.id);
  await assert.rejects(fs.stat(firstPath), { code: "ENOENT" });
});

test("write_file requires a one-time exact before-and-after approval to overwrite output", async (t) => {
  const { executeTool } = await loadTools();
  const { outputRoot, state, context } = await makeFixture(t);
  const publicPath = "outputs/documents/locked.txt";
  const absolutePath = path.join(outputRoot, "documents", "locked.txt");
  const original = "operator-reviewed original\n";
  const replacement = "approved replacement\n";

  const created = await executeTool("write_file", { path: publicPath, content: original }, context);
  assert.equal(created.written, true);

  const gated = await executeTool("write_file", { path: publicPath, content: replacement }, context);
  assert.equal(gated.requiresApproval, true);
  assert.equal(gated.written, false);
  assert.equal(await fs.readFile(absolutePath, "utf8"), original);

  const requested = state.approvalRequests.find((approval) => approval.id === gated.approval_id);
  assert(requested, "overwrite should create a Human Gate request");
  assert.equal(requested.actionType, "agent101_output_overwrite");
  assert.equal(requested.evidence.sessionId, context.sessionId);
  assert.equal(requested.evidence.details.path, publicPath);
  assert.equal(requested.evidence.details.expectedSha256, gated.expectedSha256);
  assert.equal(requested.evidence.details.contentSha256, gated.contentSha256);
  requested.status = "approved";

  const differentContent = await executeTool("write_file", {
    path: publicPath,
    content: "unapproved alternate replacement\n",
    approval_id: requested.id
  }, context);
  assert.equal(differentContent.requiresApproval, true);
  assert.equal(differentContent.written, false);
  assert.notEqual(differentContent.approval_id, requested.id);
  assert.equal(await fs.readFile(absolutePath, "utf8"), original);

  const overwritten = await executeTool("write_file", {
    path: publicPath,
    content: replacement,
    approval_id: requested.id
  }, context);
  assert.equal(overwritten.written, true);
  assert.equal(await fs.readFile(absolutePath, "utf8"), replacement);
  assert.equal(requested.useCount, 1);
  assert.match(requested.consumedAt, /^\d{4}-\d{2}-\d{2}T/);

  const replay = await executeTool("write_file", {
    path: publicPath,
    content: replacement,
    approval_id: requested.id
  }, context);
  assert.equal(replay.requiresApproval, true);
  assert.equal(replay.written, false);
  assert.notEqual(replay.approval_id, requested.id);
});

test("configured web search requires exact Human Gate approval before fetch", async (t) => {
  const { executeTool } = await loadTools();
  const { state, context } = await makeFixture(t);
  context.config.braveApiKey = "configured-test-key";
  const fetchCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    fetchCalls.push(args);
    return {
      ok: true,
      async json() {
        return { web: { results: [{ title: "Verified result", url: "https://example.com/result", description: "Evidence" }] } };
      }
    };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const input = { query: "3D printing demand 2026", purpose: "Validate a market assumption" };
  const gated = await executeTool("search_web", input, context);
  assert.equal(gated.requiresApproval, true);
  assert.equal(gated.searched, false);
  assert.equal(gated.provider, "brave");
  assert.equal(fetchCalls.length, 0, "search must not call the provider before Human Gate approval");

  const approval = state.approvalRequests.find((item) => item.id === gated.approval_id);
  assert(approval, "configured search should create a Human Gate request");
  assert.equal(approval.actionType, "agent101_web_search");
  assert.equal(approval.evidence.sessionId, context.sessionId);
  assert.deepEqual(approval.evidence.details, {
    provider: "brave",
    queryHash: gated.query_hash,
    purpose: input.purpose
  });
  approval.status = "approved";

  const wrongPurpose = await executeTool("search_web", {
    ...input,
    purpose: "A different external disclosure"
  }, {
    ...context
  });
  assert.equal(wrongPurpose.requiresApproval, true);
  assert.equal(wrongPurpose.searched, false);
  assert.equal(fetchCalls.length, 0, "an approval for another purpose must not authorize fetch");

  const searched = await executeTool("search_web", { ...input, approval_id: approval.id }, context);
  assert.equal(fetchCalls.length, 1);
  assert.equal(searched.provider, "brave");
  assert.equal(searched.results.length, 1);
  assert.match(String(fetchCalls[0][0]), /api\.search\.brave\.com/);
  assert.equal(approval.useCount, 1);
  assert.match(approval.consumedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("write_copy with Anthropic configured requests paid-copy approval without a provider call", async (t) => {
  const { executeTool } = await loadTools();
  const { state, context } = await makeFixture(t);
  let providerCalls = 0;
  let reservationCalls = 0;
  context.config.anthropicModel = "claude-test-model";
  context.beforeModelCall = async () => {
    reservationCalls += 1;
    return "reservation-test";
  };
  context.anthropicClient = {
    messages: {
      async create() {
        providerCalls += 1;
        return { content: [{ type: "text", text: "Should not be reached before approval." }], usage: {} };
      }
    }
  };

  const result = await executeTool("write_copy", {
    type: "homepage",
    business: { name: "Operator Forge", audience: "prototype buyers" },
    tone: "precise and human",
    length: "long"
  }, context);

  assert.equal(result.requiresApproval, true);
  assert.equal(result.provider, "anthropic");
  assert.match(result.input_hash, /^[a-f0-9]{64}$/);
  assert.equal(providerCalls, 0);
  assert.equal(reservationCalls, 0, "budget reservation must not start before Human Gate approval");
  const approval = state.approvalRequests.find((item) => item.id === result.approval_id);
  assert(approval, "paid copy should create a Human Gate request");
  assert.equal(approval.actionType, "agent101_paid_copy");
  assert.equal(approval.evidence.sessionId, context.sessionId);
  assert.deepEqual(approval.evidence.details, {
    provider: "anthropic",
    purpose: "write_copy",
    inputHash: result.input_hash
  });

  approval.status = "approved";
  let recordedUsage = null;
  context.recordUsage = async (...args) => {
    recordedUsage = args;
  };
  const approved = await executeTool("write_copy", {
    type: "homepage",
    business: { name: "Operator Forge", audience: "prototype buyers" },
    tone: "precise and human",
    length: "long",
    approval_id: approval.id
  }, context);
  assert.equal(approved.provider, "claude");
  assert.match(approved.content, /Should not be reached/);
  assert.equal(providerCalls, 1);
  assert.equal(reservationCalls, 1);
  assert.equal(recordedUsage?.[0], "anthropic");
  assert.equal(recordedUsage?.[3], "reservation-test");
  assert.equal(approval.useCount, 1);

  const replay = await executeTool("write_copy", {
    type: "homepage",
    business: { name: "Operator Forge", audience: "prototype buyers" },
    tone: "precise and human",
    length: "long",
    approval_id: approval.id
  }, context);
  assert.equal(replay.requiresApproval, true);
  assert.equal(providerCalls, 1, "a consumed paid-copy approval must not be replayed");
});

test("paid image generation reserves budget and consumes an exact approval once", async (t) => {
  const { executeTool } = await loadTools();
  const { outputRoot, state, context } = await makeFixture(t);
  context.config.openaiApiKey = "configured-test-key";
  const reservations = [];
  const usageRecords = [];
  context.beforeModelCall = async (payload) => {
    reservations.push(payload);
    return "image-reservation";
  };
  context.recordUsage = async (...args) => usageRecords.push(args);
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return {
      ok: true,
      async json() {
        return { data: [{ b64_json: Buffer.from("synthetic-png-bytes").toString("base64") }] };
      }
    };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const input = {
    business_name: "Operator Forge",
    tagline: "Precision prototypes without chaos",
    style: "clean industrial studio"
  };
  const gated = await executeTool("generate_hero_image", input, context);
  assert.equal(gated.requiresApproval, true);
  assert.equal(fetchCalls, 0);
  assert.equal(reservations.length, 0);
  const approval = state.approvalRequests.find((item) => item.id === gated.approval_id);
  assert.equal(approval.actionType, "agent101_paid_image");
  approval.status = "approved";

  const generated = await executeTool("generate_hero_image", { ...input, approval_id: approval.id }, context);
  assert.match(generated.image_path, /^outputs\/images\/hero-[a-f0-9]{10}\.png$/);
  assert.equal(fetchCalls, 1);
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0].estimatedCostUsd, 0.20);
  assert.equal(usageRecords[0][0], "openai");
  assert.equal(usageRecords[0][2].estimatedCostUsd, 0.20);
  assert.equal(usageRecords[0][3], "image-reservation");
  assert.equal(await fs.readFile(path.join(outputRoot, generated.image_path.replace(/^outputs\//, "")), "utf8"), "synthetic-png-bytes");
  assert.equal(approval.useCount, 1);

  const replay = await executeTool("generate_hero_image", { ...input, approval_id: approval.id }, context);
  assert.equal(replay.requiresApproval, true);
  assert.equal(fetchCalls, 1);
});

test("deterministic builders preserve prior-run outputs while approved write_file can replace one", async (t) => {
  const { executeTool } = await loadTools();
  const { outputRoot, state, context } = await makeFixture(t);
  const priorRoot = path.join(outputRoot, "websites", "prior-run");
  const priorPackage = "{\"name\":\"operator-owned-prior-run\"}\n";
  const priorStripe = "// operator-owned Stripe integration from a prior run\n";
  await fs.mkdir(path.join(priorRoot, "config"), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(priorRoot, "package.json"), priorPackage),
    fs.writeFile(path.join(priorRoot, "config", "stripe.js"), priorStripe)
  ]);

  const scaffold = await executeTool("scaffold_website", {
    name: "Prior Run",
    type: "shop",
    description: "A fresh build that must not replace prior output"
  }, context);
  assert.equal(scaffold.path, "outputs/websites/prior-run-v2");
  assert.equal(await fs.readFile(path.join(priorRoot, "package.json"), "utf8"), priorPackage);

  await assert.rejects(
    executeTool("add_stripe_checkout", {
      website_path: "outputs/websites/prior-run",
      products: [{ id: "one", name: "One", description: "One product", price_cents: 1000, currency: "usd" }]
    }, context),
    /refusing to replace existing output.*config\/stripe\.js.*Human Gate overwrite approval/i
  );
  assert.equal(await fs.readFile(path.join(priorRoot, "config", "stripe.js"), "utf8"), priorStripe);

  const replacement = "// operator-approved exact replacement\n";
  const gated = await executeTool("write_file", {
    path: "outputs/websites/prior-run/config/stripe.js",
    content: replacement
  }, context);
  assert.equal(gated.requiresApproval, true);
  const approval = state.approvalRequests.find((item) => item.id === gated.approval_id);
  assert(approval);
  approval.status = "approved";
  const replaced = await executeTool("write_file", {
    path: "outputs/websites/prior-run/config/stripe.js",
    content: replacement,
    approval_id: approval.id
  }, context);
  assert.equal(replaced.written, true);
  assert.equal(await fs.readFile(path.join(priorRoot, "config", "stripe.js"), "utf8"), replacement);
});

test("model-authored JavaScript execution is not exposed as an Agent 101 tool", async () => {
  const { executeTool, TOOL_REGISTRY } = await loadTools();
  assert.equal(TOOL_REGISTRY.some((tool) => tool.name === "run_node_script"), false);
  await assert.rejects(
    executeTool("run_node_script", { script: "Buffer.constructor.constructor('return process')()", description: "escape" }, {}),
    /unknown Agent 101 tool/i
  );
});

test("untrusted executable output requires hash-locked approval and is not booted", async (t) => {
  const { executeTool } = await loadTools();
  const { outputRoot, state, context } = await makeFixture(t);
  const projectPath = "outputs/untrusted-project";
  const markerPath = path.join(outputRoot, "untrusted-project", "EXECUTION_MARKER.txt");
  const files = {
    [`${projectPath}/package.json`]: `${JSON.stringify({ name: "untrusted-project", version: "1.0.0", private: true, scripts: { start: "node server.js" } }, null, 2)}\n`,
    [`${projectPath}/README.md`]: "# Untrusted project\n\nThis fixture must never boot before Human Gate approval.\n",
    [`${projectPath}/public/index.html`]: "<!doctype html><title>Untrusted fixture</title><main>Do not execute automatically.</main>\n",
    [`${projectPath}/server.js`]: [
      "const fs = require('node:fs');",
      "const http = require('node:http');",
      "const path = require('node:path');",
      "fs.writeFileSync(path.join(__dirname, 'EXECUTION_MARKER.txt'), 'booted');",
      "const server = http.createServer((request, response) => {",
      "  response.writeHead(200, { 'content-type': 'application/json' });",
      "  response.end(request.url === '/api/products' ? '[]' : '{}');",
      "});",
      "server.listen(Number(process.env.PORT || 3000), '127.0.0.1');",
      ""
    ].join("\n")
  };
  for (const [filePath, content] of Object.entries(files)) {
    const created = await executeTool("write_file", { path: filePath, content }, context);
    assert.equal(created.written, true, filePath);
  }

  const verification = await executeTool("verify_output_project", {
    project_path: projectPath
  }, context);

  assert.equal(verification.verified, false);
  assert.equal(verification.requiresApproval, true);
  assert.equal(verification.executionTrust, "blocked");
  assert.equal(verification.runtime, null);
  assert.match(verification.executableFingerprint, /^[a-f0-9]{64}$/);
  assert(verification.checks.some((check) => check.check === "runtime-execution-authorization" && check.status === "fail"));
  await assert.rejects(fs.stat(markerPath), { code: "ENOENT" });

  const approval = state.approvalRequests.find((item) => item.id === verification.approval_id);
  assert(approval, "verification should create a Human Gate request");
  assert.equal(approval.actionType, "agent101_output_execution");
  assert.equal(approval.riskLevel, "critical");
  assert.equal(approval.evidence.sessionId, context.sessionId);
  assert.equal(approval.evidence.details.projectPath, projectPath);
  assert.equal(approval.evidence.details.executableFingerprint, verification.executableFingerprint);
});

test("generated shop verification proves core HTTP routes and no placeholder checkout", async (t) => {
  const { executeTool } = await loadTools();
  const { outputRoot, context } = await makeFixture(t);

  const scaffold = await executeTool("scaffold_website", {
    name: "Security Forge",
    type: "shop",
    description: "A verified 3D printing storefront",
    pages: ["Home", "Products", "About", "Contact"],
    features: ["product catalog", "Stripe checkout", "order dashboard"]
  }, context);
  assert.equal(scaffold.scaffolded, true);

  const stripe = await executeTool("add_stripe_checkout", {
    website_path: scaffold.path,
    products: [{ id: "prototype", name: "Prototype Print", price_cents: 7900, currency: "usd" }]
  }, context);
  assert.equal(stripe.integrated, true);
  const stripeIdempotent = await executeTool("add_stripe_checkout", {
    website_path: scaffold.path,
    products: [{ id: "prototype", name: "Prototype Print", price_cents: 7900, currency: "usd" }]
  }, context);
  assert.equal(stripeIdempotent.integrated, true);

  const email = await executeTool("add_email_flow", {
    website_path: scaffold.path,
    events: ["order_confirmation"],
    provider: "resend"
  }, context);
  assert.equal(email.integrated, true);
  const emailIdempotent = await executeTool("add_email_flow", {
    website_path: scaffold.path,
    events: ["order_confirmation"],
    provider: "resend"
  }, context);
  assert.equal(emailIdempotent.integrated, true);

  const verification = await executeTool("verify_output_project", {
    project_path: scaffold.path,
    required_files: [
      "package.json",
      "server.js",
      "public/index.html",
      "server/stripe-checkout.js",
      "server/stripe-webhook.js",
      "server/order-store.js"
    ],
    boot: true
  }, context);

  assert.equal(
    verification.verified,
    true,
    verification.checks.map((check) => `${check.check}: ${check.status} (${check.evidence})`).join("\n")
  );
  assert(verification.checks.some((check) => check.check === "runtime-admin-auth" && check.status === "pass"));
  assert.equal(verification.runtime?.homeStatus, 200);
  assert.equal(verification.runtime?.productsStatus, 200);
  assert.equal(verification.runtime?.adminOrdersStatus, 200);
  assert(verification.checks.some((check) => check.check === "secret-scan" && check.status === "pass"));
  assert(verification.files_created.some((file) => /VERIFICATION\.json$/.test(file)));

  const generatedRoot = path.join(outputRoot, scaffold.path.replace(/^outputs\//, ""));
  const serverSource = await fs.readFile(path.join(generatedRoot, "server.js"), "utf8");
  assert.match(serverSource, /createCheckoutSession/);
  assert.doesNotMatch(serverSource, /statusCode\s*:\s*501|sendJson\([^,]+,\s*501|not implemented/i);
  assert.match(serverSource, /MAX_BODY_BYTES/);
  assert.match(serverSource, /runtime|content-security-policy/i);

  const checkoutSource = await fs.readFile(path.join(generatedRoot, "server", "stripe-checkout.js"), "utf8");
  assert.match(checkoutSource, /unknown product/i);
  assert.match(checkoutSource, /quantity must be an integer from 1 to 20/i);

  const webhookSource = await fs.readFile(path.join(generatedRoot, "server", "stripe-webhook.js"), "utf8");
  assert.equal((webhookSource.match(/import \{ sendEventEmail \} from "\.\/email\.js";/g) || []).length, 1);
  assert.equal((webhookSource.match(/await sendEventEmail\("order_confirmation"/g) || []).length, 1);
  assert.match(webhookSource, /if \(created && process\.env\.EMAIL_SEND_ENABLED === "true"/);

  const emailModule = await import(`${pathToFileURL(path.join(generatedRoot, "server", "email.js")).href}?test=${Date.now()}`);
  const preview = await emailModule.sendEventEmail("order_confirmation", {
    to: "operator@example.com",
    subject: "Preview",
    data: { customer_name: "<img src=x onerror=alert(1)>", order_id: "order-1" }
  });
  assert.equal(preview.sent, false, "email must remain preview-only without the explicit live switch");
  assert.equal(preview.approval_required, true);
  assert.doesNotMatch(preview.html, /<img src=x/);
  assert.match(preview.html, /&lt;img src=x/);
});

test("generated website escapes hostile business content and keeps generated JavaScript valid", async (t) => {
  const { executeTool } = await loadTools();
  const { outputRoot, context } = await makeFixture(t);
  const hostileName = "Forge <script>alert('x')</script> ${process.exit(1)}";

  const scaffold = await executeTool("scaffold_website", {
    name: hostileName,
    type: "landing",
    description: "A <b>customer-provided</b> description",
    pages: ["Home", "<img src=x onerror=alert(1)>"] ,
    features: ["Fast <script>alert(1)</script>"]
  }, context);

  const generatedRoot = path.join(outputRoot, scaffold.path.replace(/^outputs\//, ""));
  const html = await fs.readFile(path.join(generatedRoot, "public", "index.html"), "utf8");
  assert.doesNotMatch(html, /<script>alert\('x'\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x onerror=/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);

  const verification = await executeTool("verify_output_project", {
    project_path: scaffold.path,
    required_files: ["package.json", "server.js", "public/index.html"],
    boot: true
  }, context);
  assert.equal(verification.verified, true);
});

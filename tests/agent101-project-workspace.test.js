const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const projectWorkspace = require("../services/agent101-project-workspace");

function createFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-agent101-workspace-"));
  const rootDir = path.join(directory, "project");
  const outputRoot = path.join(directory, "outputs");
  fs.mkdirSync(rootDir, { recursive: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, rootDir, outputRoot, state: { approvals: [] } };
}

function proposalWithApproval(fixture, input) {
  let request;
  const result = projectWorkspace.createEditProposal({
    state: fixture.state,
    rootDir: fixture.rootDir,
    outputRoot: fixture.outputRoot,
    input,
    createApprovalRequest(payload) {
      request = payload;
      const approval = {
        id: `approval-${fixture.state.approvals.length + 1}`,
        status: "pending",
        actionType: payload.actionType,
        details: payload.details,
      };
      fixture.state.approvals.push(approval);
      return approval;
    },
  });
  return { result, request, approval: fixture.state.approvals.at(-1) };
}

test("Agent 101 project workspace rejects traversal, secret files, and symlink traversal", (t) => {
  const fixture = createFixture(t);
  fs.writeFileSync(path.join(fixture.rootDir, ".env"), "OPENAI_API_KEY=do-not-read\n");
  fs.writeFileSync(path.join(fixture.directory, "outside.js"), "module.exports = 'outside';\n");
  fs.symlinkSync(path.join(fixture.directory, "outside.js"), path.join(fixture.rootDir, "linked.js"));
  fs.mkdirSync(path.join(fixture.directory, "outside-directory"));
  fs.symlinkSync(path.join(fixture.directory, "outside-directory"), path.join(fixture.rootDir, "linked-directory"));

  assert.throws(
    () => projectWorkspace.readFileSnapshot(fixture.rootDir, "../outside.js"),
    /traversal|relative to the approved workspace/i
  );
  assert.throws(
    () => projectWorkspace.readFileSnapshot(fixture.rootDir, ".env"),
    /credential|environment files/i
  );
  assert.throws(
    () => projectWorkspace.readFileSnapshot(fixture.rootDir, "linked.js"),
    /symbolic links/i
  );
  assert.throws(
    () => projectWorkspace.readFileSnapshot(fixture.rootDir, "linked-directory/new.js", { allowMissing: true, forWrite: true }),
    /symbolic links/i
  );
  for (const restrictedPath of [
    ".GIT/config",
    "Data/runtime-state.json",
    "DIST/app.js",
    "Node_Modules/package/index.js",
    "Browser-Profile/cookies.json",
  ]) {
    assert.throws(
      () => projectWorkspace.readFileSnapshot(fixture.rootDir, restrictedPath, { allowMissing: true, forWrite: true }),
      /outside Agent 101's source-editing scope/i,
      restrictedPath
    );
  }
  assert.throws(
    () => projectWorkspace.readFileSnapshot(fixture.rootDir, "agents.MD", { allowMissing: true, forWrite: true }),
    /safety boundary.*cannot be self-modified/i
  );
});

test("creating a project edit proposal stores an exact review artifact without writing source", (t) => {
  const fixture = createFixture(t);
  const sourcePath = path.join(fixture.rootDir, "feature.js");
  const before = "module.exports = { enabled: false };\n";
  const after = "module.exports = { enabled: true };\n";
  fs.writeFileSync(sourcePath, before);

  const { result, request, approval } = proposalWithApproval(fixture, {
    path: "feature.js",
    content: after,
    expected_sha256: projectWorkspace.sha256(before),
    reason: "Enable the reviewed feature.",
  });

  assert.equal(result.status, "pending");
  assert.equal(result.requiresApproval, true);
  assert.equal(result.executed, false);
  assert.equal(fs.readFileSync(sourcePath, "utf8"), before);
  assert.equal(fixture.state.agent101EditProposals[0].status, "waiting_approval");
  assert.equal(request.actionType, "project_source_edit");
  assert.deepEqual(request.details, {
    proposalId: result.proposal_id,
    path: "feature.js",
    expectedSha256: projectWorkspace.sha256(before),
    contentSha256: projectWorkspace.sha256(after),
    editMode: "full_content",
    replacementCount: 0,
    previewEndpoint: `/api/agent101/project-edits/${encodeURIComponent(result.proposal_id)}`,
  });
  assert.equal(approval.status, "pending");

  const proposalPath = path.join(fixture.outputRoot, fixture.state.agent101EditProposals[0].storagePath);
  const stored = JSON.parse(fs.readFileSync(proposalPath, "utf8"));
  assert.equal(stored.content, after);
  assert.equal(stored.contentSha256, projectWorkspace.sha256(after));
});

test("applying a project edit requires the exact Human Gate approval scope", (t) => {
  const fixture = createFixture(t);
  const sourcePath = path.join(fixture.rootDir, "feature.js");
  const before = "module.exports = 1;\n";
  fs.writeFileSync(sourcePath, before);
  const { result, approval } = proposalWithApproval(fixture, {
    path: "feature.js",
    content: "module.exports = 2;\n",
  });
  approval.status = "approved";
  approval.details = { ...approval.details, proposalId: "different-proposal" };

  assert.throws(
    () => projectWorkspace.applyEditProposal({
      state: fixture.state,
      rootDir: fixture.rootDir,
      outputRoot: fixture.outputRoot,
      proposalId: result.proposal_id,
      approvalId: approval.id,
    }),
    /scope does not match/i
  );
  assert.equal(fs.readFileSync(sourcePath, "utf8"), before);
  assert.equal(fixture.state.agent101EditProposals[0].status, "waiting_approval");
});

test("a hash conflict prevents an approved proposal from overwriting newer source", (t) => {
  const fixture = createFixture(t);
  const sourcePath = path.join(fixture.rootDir, "feature.js");
  fs.writeFileSync(sourcePath, "module.exports = 'original';\n");
  const { result, approval } = proposalWithApproval(fixture, {
    path: "feature.js",
    content: "module.exports = 'proposed';\n",
  });
  approval.status = "approved";
  const newerSource = "module.exports = 'newer operator edit';\n";
  fs.writeFileSync(sourcePath, newerSource);

  assert.throws(
    () => projectWorkspace.applyEditProposal({
      state: fixture.state,
      rootDir: fixture.rootDir,
      outputRoot: fixture.outputRoot,
      proposalId: result.proposal_id,
      approvalId: approval.id,
    }),
    /changed after approval was requested/i
  );
  assert.equal(fs.readFileSync(sourcePath, "utf8"), newerSource);
  assert.equal(fixture.state.agent101EditProposals[0].status, "conflict");
});

test("an exact approved proposal applies atomically and passes source validation", (t) => {
  const fixture = createFixture(t);
  const sourcePath = path.join(fixture.rootDir, "feature.js");
  const before = "module.exports = function value() { return 1; };\n";
  const after = "module.exports = function value() { return 2; };\n";
  fs.writeFileSync(sourcePath, before);
  const { result, approval } = proposalWithApproval(fixture, {
    path: "feature.js",
    content: after,
    expected_sha256: projectWorkspace.sha256(before),
  });
  approval.status = "approved";

  const applied = projectWorkspace.applyEditProposal({
    state: fixture.state,
    rootDir: fixture.rootDir,
    outputRoot: fixture.outputRoot,
    proposalId: result.proposal_id,
    approvalId: approval.id,
  });

  assert.equal(applied.applied, true);
  assert.equal(applied.backup_created, true);
  assert.equal(applied.after_sha256, projectWorkspace.sha256(after));
  assert.equal(applied.validation.status, "passed");
  assert.equal(applied.validation.check, "node --check");
  assert.equal(fs.readFileSync(sourcePath, "utf8"), after);
  assert.equal(fixture.state.agent101EditProposals[0].status, "applied");

  const idempotent = projectWorkspace.applyEditProposal({
    state: fixture.state,
    rootDir: fixture.rootDir,
    outputRoot: fixture.outputRoot,
    proposalId: result.proposal_id,
    approvalId: approval.id,
  });
  assert.equal(idempotent.idempotent, true);
});

test("large source files can use narrow exact-replacement proposals", (t) => {
  const fixture = createFixture(t);
  const sourcePath = path.join(fixture.rootDir, "large-source.js");
  const before = `${"// unchanged context\n".repeat(8000)}const featureFlag = false;\n`;
  fs.writeFileSync(sourcePath, before);
  const { result, approval } = proposalWithApproval(fixture, {
    path: "large-source.js",
    replacements: [{ search: "const featureFlag = false;", replace: "const featureFlag = true;", expected_count: 1 }],
    expected_sha256: projectWorkspace.sha256(before),
    reason: "Enable the reviewed feature without replacing unrelated source.",
  });
  assert.equal(result.requiresApproval, true);
  assert.equal(fixture.state.agent101EditProposals[0].editMode, "exact_replacements");
  assert.equal(fs.readFileSync(sourcePath, "utf8"), before);

  approval.status = "approved";
  const applied = projectWorkspace.applyEditProposal({
    state: fixture.state,
    rootDir: fixture.rootDir,
    outputRoot: fixture.outputRoot,
    proposalId: result.proposal_id,
    approvalId: approval.id,
  });
  assert.equal(applied.applied, true);
  const after = fs.readFileSync(sourcePath, "utf8");
  assert(after.includes("const featureFlag = true;"));
  assert.equal(after.split("// unchanged context").length - 1, 8000);
});

test("self-edit proposals cannot replace critical files wholesale or alter Human Gate controls", (t) => {
  const fixture = createFixture(t);
  const source = "function createHumanGateRequest() { return { status: 'pending' }; }\nconst safeValue = true;\n";
  fs.writeFileSync(path.join(fixture.rootDir, "server.js"), source);
  fs.mkdirSync(path.join(fixture.rootDir, "CLIPPING OFFICE "), { recursive: true });
  fs.writeFileSync(
    path.join(fixture.rootDir, "CLIPPING OFFICE ", "server.js"),
    "module.exports = { office: 'clipping' };\n"
  );
  assert.throws(() => proposalWithApproval(fixture, {
    path: "server.js",
    content: "module.exports = {};\n",
    reason: "Replace the backend.",
  }), /critical.*exact replacements|full-file/i);
  assert.throws(() => proposalWithApproval(fixture, {
    path: "CLIPPING OFFICE /server.js",
    content: "module.exports = { bypassed: true };\n",
    reason: "Replace the Clipping Office backend wholesale.",
  }), /critical.*exact replacements|full-file/i);
  assert.throws(() => proposalWithApproval(fixture, {
    path: "server.js",
    replacements: [{ search: "createHumanGateRequest", replace: "bypassHumanGate" }],
    reason: "Change approval behavior.",
  }), /safety controls|Human Gate/i);
});

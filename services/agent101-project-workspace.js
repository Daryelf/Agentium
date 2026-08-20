const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const EDITABLE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const BLOCKED_PATH_SEGMENTS = new Set([
  ".git",
  ".idea",
  ".vscode",
  "browser-profile",
  "data",
  "dist",
  "node_modules",
]);

const IMMUTABLE_FILES = new Set([
  "AGENTS.md",
  "CLIPPING OFFICE /services/agent-tools.js",
  "services/agent101-project-workspace.js",
  "services/secure-secrets.js",
]);

const PROTECTED_EDIT_PATTERNS = [
  /AI_RISKY_ACTION_TYPES/,
  /createHumanGateRequest/,
  /humanGateDecisionMatch/,
  /requiresHumanGate/,
  /detectRiskyAction/,
  /securityHeaders/,
  /currentSession/,
  /keyFromConfig/,
  /secureSecrets/,
];

const SENSITIVE_BASENAME_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /(?:^|[-_.])(auth|credential|password|secret|session|token)(?:[-_.]|$)/i,
  /\.(?:key|pem|p12|pfx)$/i,
];

function now() {
  return new Date().toISOString();
}

function cleanText(value, limit = 4000) {
  return String(value ?? "").trim().slice(0, limit);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
}

function normalizeRelativePath(rawPath) {
  const text = cleanText(rawPath, 1000).replaceAll("\\", "/");
  if (!text || path.isAbsolute(text)) throw new Error("Project path must be relative to the approved workspace.");
  const normalized = path.posix.normalize(text).replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error("Project path traversal is not allowed.");
  }
  return normalized;
}

function assertInside(rootDir, candidate) {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(candidate);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Resolved project path is outside the approved workspace.");
  }
  return resolved;
}

function assertNoSymlinkTraversal(rootDir, candidate, options = {}) {
  const root = path.resolve(rootDir);
  const target = assertInside(root, candidate);
  const relative = path.relative(root, target);
  let cursor = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) {
      if (options.allowMissing) break;
      throw new Error("Project path does not exist.");
    }
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error("Symbolic links are not allowed in Agent 101 project paths.");
  }
  return target;
}

function pathSegments(relativePath) {
  return normalizeRelativePath(relativePath).split("/").filter(Boolean);
}

function pathPolicy(relativePath, options = {}) {
  const normalized = normalizeRelativePath(relativePath);
  const segments = pathSegments(normalized);
  const normalizedKey = normalized.toLowerCase();
  const foldedSegments = segments.map((segment) => segment.toLowerCase());
  const basename = segments.at(-1) || "";
  const basenameKey = basename.toLowerCase();
  const extension = path.extname(basename).toLowerCase();
  const blockedIndex = foldedSegments.findIndex((segment) => BLOCKED_PATH_SEGMENTS.has(segment));
  const blockedSegment = blockedIndex >= 0 ? segments[blockedIndex] : "";
  const sensitive = SENSITIVE_BASENAME_PATTERNS.some((pattern) => pattern.test(basename));
  const immutable = [...IMMUTABLE_FILES].some((file) => file.toLowerCase() === normalizedKey);
  const allowedExtension = EDITABLE_EXTENSIONS.has(extension) || basenameKey === "dockerfile" || basenameKey === "procfile";
  const lockfile = /^(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/i.test(basename);
  const critical = ["server.js", "main.js", "package.json"].includes(basenameKey)
    || foldedSegments.includes("services")
    || foldedSegments[0] === "desktop";
  const reason = blockedSegment
    ? `The '${blockedSegment}' directory is outside Agent 101's source-editing scope.`
    : sensitive
      ? "Credential, token, authentication, session, and environment files are never available to Agent 101."
      : immutable
        ? "This file defines Agent 101's safety boundary and cannot be self-modified."
        : lockfile
          ? "Dependency lockfiles must be changed by an explicitly approved package-manager command."
          : !allowedExtension
            ? `Files with the '${extension || "none"}' extension are not in the source-edit allowlist.`
            : "";
  return {
    path: normalized,
    editable: !reason,
    readable: !blockedSegment && !sensitive,
    critical,
    reason,
    allowMissing: Boolean(options.allowMissing),
  };
}

function resolveProjectFile(rootDir, relativePath, options = {}) {
  const policy = pathPolicy(relativePath, options);
  if (options.forWrite ? !policy.editable : !policy.readable) throw new Error(policy.reason);
  const absolute = assertInside(rootDir, path.join(path.resolve(rootDir), policy.path));
  return { ...policy, absolute };
}

function readFileSnapshot(rootDir, relativePath, options = {}) {
  const resolved = resolveProjectFile(rootDir, relativePath, options);
  assertNoSymlinkTraversal(rootDir, resolved.absolute, { allowMissing: options.allowMissing });
  if (!fs.existsSync(resolved.absolute)) {
    if (!options.allowMissing) throw new Error("Project file does not exist.");
    return { ...resolved, exists: false, bytes: 0, content: "", sha256: null };
  }
  const stats = fs.statSync(resolved.absolute);
  if (!stats.isFile()) throw new Error("Project path must point to a file.");
  if (stats.size > MAX_SOURCE_BYTES) throw new Error("Project file is too large for an Agent 101 source proposal.");
  const content = fs.readFileSync(resolved.absolute, "utf8");
  return { ...resolved, exists: true, bytes: stats.size, content, sha256: sha256(content) };
}

function normalizeProposalState(state) {
  state.agent101EditProposals = Array.isArray(state.agent101EditProposals) ? state.agent101EditProposals : [];
  return state.agent101EditProposals;
}

function proposalStoragePath(outputRoot, proposalId) {
  const directory = assertInside(outputRoot, path.join(path.resolve(outputRoot), "project-edit-proposals", proposalId));
  return {
    directory,
    proposal: path.join(directory, "proposal.json"),
    backup: path.join(directory, "before.txt"),
  };
}

function diffSummary(before, after) {
  const beforeLines = String(before || "").split("\n");
  const afterLines = String(after || "").split("\n");
  let prefix = 0;
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix
    && suffix < afterLines.length - prefix
    && beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) suffix += 1;
  return {
    beforeLines: beforeLines.length,
    afterLines: afterLines.length,
    changedBeforeLines: Math.max(0, beforeLines.length - prefix - suffix),
    changedAfterLines: Math.max(0, afterLines.length - prefix - suffix),
    firstChangedLine: prefix + 1,
  };
}

function createEditProposal({ state, rootDir, outputRoot, input = {}, createApprovalRequest }) {
  if (!state || typeof state !== "object") throw new Error("Agent 101 state is required.");
  if (typeof createApprovalRequest !== "function") throw new Error("Human Gate approval routing is required.");
  const target = readFileSnapshot(rootDir, input.path, { allowMissing: true, forWrite: true });
  const replacements = Array.isArray(input.replacements) ? input.replacements.slice(0, 50) : [];
  const hasFullContent = typeof input.content === "string" && input.content.length > 0;
  if (target.critical && hasFullContent) {
    throw new Error("Critical backend and service files require narrow exact replacements; full-file self-replacement is blocked.");
  }
  if (target.critical && replacements.some((replacement) => PROTECTED_EDIT_PATTERNS.some((pattern) => pattern.test(`${replacement?.search || ""}\n${replacement?.replace || ""}`)))) {
    throw new Error("This proposal touches authentication, credentials, Human Gate, risk classification, or Agent 101 safety controls and cannot be self-modified.");
  }
  let content = hasFullContent ? String(input.content) : target.content;
  if (!hasFullContent) {
    if (!replacements.length) throw new Error("Provide exact replacement operations or complete source content for the project edit proposal.");
    if (!target.exists) throw new Error("Exact replacement operations require an existing project file.");
    for (const [index, replacement] of replacements.entries()) {
      const search = String(replacement?.search ?? "");
      const replace = String(replacement?.replace ?? "");
      const expectedCount = Math.max(1, Math.min(100, Number(replacement?.expected_count || replacement?.expectedCount || 1)));
      if (!search) throw new Error(`Replacement ${index + 1} is missing exact search text.`);
      const actualCount = content.split(search).length - 1;
      if (actualCount !== expectedCount) {
        throw new Error(`Replacement ${index + 1} expected ${expectedCount} exact match(es) but found ${actualCount}. Read the latest source and narrow the patch.`);
      }
      content = content.split(search).join(replace);
    }
  }
  if (!content.trim()) throw new Error("A project edit proposal cannot replace a source file with empty content.");
  if (Buffer.byteLength(content) > MAX_SOURCE_BYTES) throw new Error("Proposed source content exceeds the 2 MB limit.");
  const suppliedExpected = cleanText(input.expected_sha256 || input.expectedSha256, 128);
  if (suppliedExpected && suppliedExpected !== target.sha256) {
    throw new Error("The source file changed after Agent 101 read it. Read the latest file and create a new proposal.");
  }

  const proposalId = newId("agent101-edit");
  const contentHash = sha256(content);
  const storage = proposalStoragePath(outputRoot, proposalId);
  fs.mkdirSync(storage.directory, { recursive: true });
  const storedPayload = {
    id: proposalId,
    path: target.path,
    expectedSha256: target.sha256,
    contentSha256: contentHash,
    content,
    editMode: hasFullContent ? "full_content" : "exact_replacements",
    replacements: replacements.map((replacement) => ({
      search: String(replacement?.search ?? ""),
      replace: String(replacement?.replace ?? ""),
      expectedCount: Math.max(1, Math.min(100, Number(replacement?.expected_count || replacement?.expectedCount || 1))),
    })),
    reason: cleanText(input.reason || "Agent 101 proposed an operator-requested project improvement.", 2000),
    createdAt: now(),
  };
  fs.writeFileSync(storage.proposal, `${JSON.stringify(storedPayload, null, 2)}\n`, { mode: 0o600 });

  const summary = diffSummary(target.content, content);
  const approvalResult = createApprovalRequest({
    actionType: "project_source_edit",
    title: `Review Agent 101 source edit: ${target.path}`,
    action: `Replace ${target.path} with the exact content locked to proposal ${proposalId}.`,
    evidence: `Expected source SHA-256 ${target.sha256 || "new-file"}; proposed content SHA-256 ${contentHash}.`,
    exactScope: `One atomic write to ${target.path}; no other project files, credentials, publishing, deployment, or external actions.`,
    riskLevel: target.critical ? "critical" : "high",
    reversible: false,
    expectedPostcondition: `${target.path} matches the approved content SHA-256 and the trusted validation scope is recorded.`,
    rollbackPlan: "A validation failure restores the pre-edit bytes automatically. After a successful apply, restoration requires a new hash-locked project edit proposal and a new Human Gate approval.",
    details: {
      proposalId,
      path: target.path,
      expectedSha256: target.sha256,
      contentSha256: contentHash,
      editMode: storedPayload.editMode,
      replacementCount: storedPayload.replacements.length,
      previewEndpoint: `/api/agent101/project-edits/${encodeURIComponent(proposalId)}`,
    },
  });
  const approval = approvalResult?.approval || approvalResult;
  const record = {
    id: proposalId,
    path: target.path,
    status: "waiting_approval",
    critical: target.critical,
    reason: storedPayload.reason,
    expectedSha256: target.sha256,
    contentSha256: contentHash,
    approvalId: approval?.id || null,
    storagePath: path.relative(path.resolve(outputRoot), storage.proposal).replaceAll(path.sep, "/"),
    diff: summary,
    editMode: storedPayload.editMode,
    replacementCount: storedPayload.replacements.length,
    createdAt: storedPayload.createdAt,
    updatedAt: storedPayload.createdAt,
    appliedAt: null,
    validation: null,
  };
  normalizeProposalState(state).unshift(record);
  const activeProposals = state.agent101EditProposals.filter((item) => ["waiting_approval", "approved", "applying"].includes(item.status));
  const archivedProposals = state.agent101EditProposals.filter((item) => !activeProposals.includes(item)).slice(0, Math.max(0, 100 - activeProposals.length));
  state.agent101EditProposals = [...activeProposals, ...archivedProposals];
  return {
    proposal_id: proposalId,
    approval_id: record.approvalId,
    status: "pending",
    requiresApproval: true,
    executed: false,
    path: target.path,
    expected_sha256: target.sha256,
    content_sha256: contentHash,
    diff: summary,
    risk_level: target.critical ? "critical" : "high",
  };
}

function editProposalPreview({ state, rootDir, outputRoot, proposalId }) {
  const proposal = normalizeProposalState(state).find((item) => item.id === cleanText(proposalId, 180));
  if (!proposal) throw new Error("Project edit proposal was not found.");
  const storage = proposalStoragePath(outputRoot, proposal.id);
  const stored = JSON.parse(fs.readFileSync(storage.proposal, "utf8"));
  if (stored.path !== proposal.path || sha256(stored.content) !== proposal.contentSha256) {
    throw new Error("Stored project edit proposal failed integrity verification.");
  }
  const current = readFileSnapshot(rootDir, proposal.path, { allowMissing: true, forWrite: true });
  return {
    id: proposal.id,
    path: proposal.path,
    status: proposal.status,
    reason: proposal.reason,
    approvalId: proposal.approvalId,
    critical: proposal.critical,
    conflict: current.sha256 !== proposal.expectedSha256,
    expectedSha256: proposal.expectedSha256,
    currentSha256: current.sha256,
    contentSha256: proposal.contentSha256,
    diff: proposal.diff,
    before: current.sha256 === proposal.expectedSha256 ? current.content : "",
    proposed: stored.content,
    editMode: stored.editMode || "full_content",
    replacements: stored.replacements || [],
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
  };
}

function safeValidationFor(targetPath, content) {
  const extension = path.extname(targetPath).toLowerCase();
  if (extension === ".json") {
    JSON.parse(content);
    return { status: "passed", check: "JSON parse", output: "Valid JSON." };
  }
  if ([".js", ".cjs", ".mjs"].includes(extension)) {
    const output = execFileSync(process.execPath, ["--check", targetPath], {
      encoding: "utf8",
      timeout: 30_000,
      env: {
        HOME: process.env.HOME || "",
        PATH: process.env.PATH || "",
        TMPDIR: process.env.TMPDIR || "/tmp",
      },
    });
    return { status: "passed", check: "node --check", output: cleanText(output || "Syntax valid.", 4000) };
  }
  return {
    status: "not_applicable",
    check: "atomic write and SHA-256 verification",
    output: "The approved bytes were written atomically and hash-verified. No syntax parser is registered for this file type.",
  };
}

function applyEditProposal({ state, rootDir, outputRoot, proposalId, approvalId }) {
  const proposals = normalizeProposalState(state);
  const proposal = proposals.find((item) => item.id === cleanText(proposalId, 160));
  if (!proposal) throw new Error("Project edit proposal was not found.");
  if (proposal.status === "applied") {
    return { applied: true, idempotent: true, proposal_id: proposal.id, path: proposal.path, validation: proposal.validation };
  }
  const approval = (state.approvals || []).find((item) => item.id === cleanText(approvalId || proposal.approvalId, 180));
  if (!approval || approval.status !== "approved") throw new Error("Human Gate has not approved this exact project edit proposal.");
  if (approval.actionType !== "project_source_edit") throw new Error("Human Gate approval has the wrong action type for a project source edit.");
  if (approval.expiresAt && !Number.isNaN(Date.parse(approval.expiresAt)) && Date.parse(approval.expiresAt) <= Date.now()) {
    throw new Error("Human Gate approval for this project edit has expired.");
  }
  if (approval.consumedAt || Number(approval.useCount || 0) >= 1) {
    throw new Error("Human Gate approval for this project edit has already been used.");
  }
  const grantedDetails = approval.grantedDetails || approval.details || {};
  if (
    approval.id !== proposal.approvalId
    || grantedDetails.proposalId !== proposal.id
    || grantedDetails.path !== proposal.path
    || (grantedDetails.expectedSha256 ?? null) !== (proposal.expectedSha256 ?? null)
    || grantedDetails.contentSha256 !== proposal.contentSha256
    || grantedDetails.editMode !== proposal.editMode
    || Number(grantedDetails.replacementCount || 0) !== Number(proposal.replacementCount || 0)
  ) {
    throw new Error("Approval scope does not match this project edit proposal.");
  }

  const storage = proposalStoragePath(outputRoot, proposal.id);
  const stored = JSON.parse(fs.readFileSync(storage.proposal, "utf8"));
  if (stored.path !== proposal.path || sha256(stored.content) !== proposal.contentSha256) {
    throw new Error("Stored project edit proposal failed integrity verification.");
  }
  const current = readFileSnapshot(rootDir, proposal.path, { allowMissing: true, forWrite: true });
  if (current.sha256 !== proposal.expectedSha256) {
    proposal.status = "conflict";
    proposal.updatedAt = now();
    throw new Error("The project file changed after approval was requested. Agent 101 must create a fresh proposal.");
  }

  // Consume the exact approval before the first filesystem mutation. Callers
  // persist state in a finally block, including validation rollback failures.
  proposal.status = "applying";
  proposal.updatedAt = now();
  approval.useCount = Number(approval.useCount || 0) + 1;
  approval.consumedAt = now();
  approval.consumedByProposalId = proposal.id;

  fs.mkdirSync(path.dirname(current.absolute), { recursive: true });
  assertNoSymlinkTraversal(rootDir, path.dirname(current.absolute), { allowMissing: true });
  if (current.exists) fs.writeFileSync(storage.backup, current.content, { mode: 0o600 });
  const temporary = `${current.absolute}.agent101-${crypto.randomBytes(5).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, stored.content, { mode: current.exists ? fs.statSync(current.absolute).mode : 0o644 });
  fs.renameSync(temporary, current.absolute);

  let validation;
  try {
    validation = safeValidationFor(current.absolute, stored.content);
  } catch (error) {
    validation = { status: "failed", check: "syntax validation", output: cleanText(error.stderr || error.message, 4000) };
    if (current.exists) fs.copyFileSync(storage.backup, current.absolute);
    else fs.unlinkSync(current.absolute);
    proposal.status = "rolled_back";
    proposal.validation = validation;
    proposal.updatedAt = now();
    throw new Error(`Project edit failed validation and was rolled back: ${validation.output}`);
  }

  const result = readFileSnapshot(rootDir, proposal.path, { forWrite: true });
  if (result.sha256 !== proposal.contentSha256) throw new Error("Project edit was written but failed final hash verification.");
  proposal.status = "applied";
  proposal.validation = validation;
  proposal.appliedAt = now();
  proposal.updatedAt = proposal.appliedAt;
  return {
    applied: true,
    proposal_id: proposal.id,
    approval_id: approval.id,
    path: proposal.path,
    before_sha256: proposal.expectedSha256,
    after_sha256: result.sha256,
    bytes: result.bytes,
    validation,
    backup_created: current.exists,
    reversible: current.exists,
    validation_scope: validation.check,
  };
}

function inspectWorkspace({ state, rootDir }) {
  const proposals = normalizeProposalState(state);
  return {
    root: path.resolve(rootDir),
    mode: "supervised_project_workspace",
    readPolicy: "Text source inside the approved project; secrets, runtime data, dependencies, builds, and browser profiles are excluded.",
    writePolicy: "Exact-content, hash-locked proposal followed by a matching Human Gate approval and atomic validated write.",
    immutableFiles: [...IMMUTABLE_FILES],
    pendingProposals: proposals.filter((item) => item.status === "waiting_approval").map((item) => ({
      id: item.id,
      path: item.path,
      approvalId: item.approvalId,
      riskLevel: item.critical ? "critical" : "high",
    })),
    recentProposals: proposals.slice(0, 10).map((item) => ({ id: item.id, path: item.path, status: item.status, updatedAt: item.updatedAt })),
  };
}

function configureStudioLayout({ state, input = {} }) {
  const allowedPanels = new Set(["mission", "knowledge", "tools", "files", "approvals", "business_blueprint", "conversation"]);
  const requested = Array.isArray(input.panels) ? input.panels.map((item) => cleanText(item, 80)).filter((item) => allowedPanels.has(item)) : [];
  const panels = [...new Set(requested.length ? requested : ["mission", "knowledge", "tools", "files", "approvals"])]
    .slice(0, allowedPanels.size);
  const density = ["comfortable", "compact"].includes(input.density) ? input.density : "comfortable";
  const accent = ["blue", "violet", "gold", "emerald"].includes(input.accent) ? input.accent : "blue";
  state.agent101StudioLayout = {
    panels,
    density,
    accent,
    updatedBy: "agent-101",
    updatedAt: now(),
  };
  return { configured: true, reversible: true, layout: state.agent101StudioLayout };
}

module.exports = {
  MAX_SOURCE_BYTES,
  IMMUTABLE_FILES,
  pathPolicy,
  readFileSnapshot,
  createEditProposal,
  applyEditProposal,
  editProposalPreview,
  inspectWorkspace,
  configureStudioLayout,
  normalizeProposalState,
  sha256,
};

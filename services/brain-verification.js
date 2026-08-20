const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const obsidianVault = require("./obsidian-vault");
const brainBackup = require("./brain-backup");

function now() {
  return new Date().toISOString();
}

function issue(severity, code, message, extra = {}) {
  return { severity, code, message, ...extra };
}

function safeReadJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function loadIndex(vaultPath) {
  return safeReadJson(path.join(vaultPath, "00_System", "Manifests", "search-index.json"), { notes: [] });
}

function loadManifest(vaultPath) {
  return safeReadJson(path.join(vaultPath, "00_System", "Manifests", "canonical-entities.json"), { entities: [] });
}

function detectConflicts(vaultPath) {
  const manifest = loadManifest(vaultPath);
  const index = loadIndex(vaultPath);
  const conflicts = [];
  const idGroups = new Map();
  manifest.entities.forEach((entity) => {
    idGroups.set(entity.id, [...(idGroups.get(entity.id) || []), entity]);
  });
  idGroups.forEach((records, id) => {
    if (records.length > 1) {
      conflicts.push({
        id: `conflict.duplicate.${id}`,
        recordIds: records.map((record) => record.id),
        conflictType: "duplicate_canonical_entity",
        summary: `Multiple canonical entities share ${id}.`,
        severity: "critical",
        status: "open",
        createdAt: now(),
      });
    }
  });
  const primaryPriorities = index.notes.filter((note) => note.status === "active" && (note.tags || []).includes("primary-priority"));
  if (primaryPriorities.length > 1) {
    conflicts.push({
      id: "conflict.primary-priorities",
      recordIds: primaryPriorities.map((note) => note.id || note.path),
      conflictType: "multiple_primary_priorities",
      summary: "Multiple current priorities are marked primary.",
      severity: "warning",
      status: "open",
      createdAt: now(),
    });
  }
  const authorityRules = index.notes.filter((note) => /Human Gate approval is required/i.test(note.content || "") && /approval is not required/i.test(note.content || ""));
  authorityRules.forEach((note) => {
    conflicts.push({
      id: `conflict.authority.${crypto.createHash("sha1").update(note.path).digest("hex").slice(0, 8)}`,
      recordIds: [note.id || note.path],
      conflictType: "conflicting_authority_rule",
      summary: `Possible conflicting authority wording in ${note.title}.`,
      severity: "error",
      status: "open",
      createdAt: now(),
    });
  });
  const approvedMemory = index.notes.filter((note) => note.type === "memory" && note.status === "approved");
  const byTitle = new Map();
  approvedMemory.forEach((note) => {
    const key = String(note.title || "").toLowerCase();
    byTitle.set(key, [...(byTitle.get(key) || []), note]);
  });
  byTitle.forEach((records, title) => {
    if (records.length > 1 && !records.some((record) => record.supersedes || record.supersededBy)) {
      conflicts.push({
        id: `conflict.memory.${crypto.createHash("sha1").update(title).digest("hex").slice(0, 8)}`,
        recordIds: records.map((record) => record.id || record.path),
        conflictType: "overlapping_memory_without_supersession",
        summary: `Multiple approved memory records share title '${title}' without supersession.`,
        severity: "warning",
        status: "open",
        createdAt: now(),
      });
    }
  });
  const expiredActive = index.notes.filter((note) => note.status === "active" && note.expiresAt && Date.parse(note.expiresAt) < Date.now());
  expiredActive.forEach((note) => {
    conflicts.push({
      id: `conflict.expired.${crypto.createHash("sha1").update(note.path).digest("hex").slice(0, 8)}`,
      recordIds: [note.id || note.path],
      conflictType: "expired_active_record",
      summary: `${note.title} is expired but still active.`,
      severity: "error",
      status: "open",
      createdAt: now(),
    });
  });
  return conflicts;
}

function assertCondition(issues, condition, severity, code, message, extra = {}) {
  if (!condition) issues.push(issue(severity, code, message, extra));
}

function verifyBrain(options = {}) {
  const vaultPath = path.resolve(options.vaultPath || obsidianVault.defaultVaultPath());
  const issues = [];
  const validation = obsidianVault.validateVault(vaultPath);
  const manifest = loadManifest(vaultPath);
  const searchIndex = loadIndex(vaultPath);
  const legacyMap = safeReadJson(path.join(vaultPath, "00_System", "Manifests", "legacy-path-map.json"), null);
  const schema = safeReadJson(path.join(vaultPath, "00_System", "Manifests", "vault-schema.json"), null);

  assertCondition(issues, fs.existsSync(vaultPath), "critical", "vault_exists", "Vault does not exist.", { vaultPath });
  try {
    fs.accessSync(vaultPath, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    issues.push(issue("critical", "vault_writable", "Vault is not readable and writable.", { vaultPath }));
  }
  assertCondition(issues, schema?.schemaVersion === "2.0.0", "critical", "schema_version", "Schema is not 2.0.0.", { actual: schema?.schemaVersion || null });
  assertCondition(issues, manifest.entities.length > 0, "critical", "manifest_loads", "Canonical entity manifest did not load.");
  assertCondition(issues, Boolean(legacyMap), "error", "legacy_map_loads", "Legacy path map did not load.");
  assertCondition(issues, searchIndex.notes.length > 0, "critical", "search_index_loads", "Search index did not load.");

  const ids = manifest.entities.map((entity) => entity.id);
  assertCondition(issues, ids.length === new Set(ids).size, "critical", "unique_ids", "Canonical entity IDs are not unique.");
  assertCondition(issues, manifest.entities.filter((entity) => entity.id === "agent.1010").length === 1, "critical", "single_agent_1010", "Agent 1010 must have exactly one canonical entity.");
  manifest.entities.forEach((entity) => {
    assertCondition(issues, fs.existsSync(path.join(vaultPath, entity.path)), "error", "entity_path_valid", `Canonical path missing for ${entity.id}.`, { path: entity.path });
    if (entity.business) assertCondition(issues, ids.includes(entity.business), "error", "business_resolves", `${entity.id} references missing business ${entity.business}.`);
    if (entity.office) assertCondition(issues, ids.includes(entity.office), "error", "office_resolves", `${entity.id} references missing office ${entity.office}.`);
    if (entity.agent) assertCondition(issues, ids.includes(entity.agent), "error", "agent_resolves", `${entity.id} references missing agent ${entity.agent}.`);
    if (entity.parent) assertCondition(issues, ids.includes(entity.parent), "error", "parent_resolves", `${entity.id} references missing parent ${entity.parent}.`);
  });

  const context = options.contextBuilder
    ? options.contextBuilder({ agentId: "agent.1010", officeId: "office.clipping", projectId: "project.clip_office_production", includeTrace: true })
    : obsidianVault.buildAgentContext(vaultPath, { business: "business.argentum", office: "office.clipping", workflow: "workflow.clipping" });
  const contextText = JSON.stringify(context);
  assertCondition(issues, /Supervised_Agent_Rules/.test(contextText), "critical", "context_governance", "Agent context missing governance.");
  assertCondition(issues, /Agent_1010/.test(contextText), "critical", "context_agent_profile", "Agent context missing Agent 1010 profile.");
  assertCondition(issues, /Argentum/.test(contextText), "critical", "context_business", "Agent context missing Argentum business.");
  assertCondition(issues, /Clipping_Office/.test(contextText), "error", "context_office", "Agent context missing active office.");
  assertCondition(issues, !/99_Archive/.test(contextText), "critical", "context_excludes_archive", "Agent context includes archive content.");
  assertCondition(issues, !/80_Memory\/Rejected/.test(contextText), "critical", "context_excludes_rejected", "Agent context includes rejected memory.");

  const searchChecks = [
    ["agent.1010", "Agent 1010 by ID"],
    ["Agent 1010", "Agent 1010 by title"],
    ["agent.agent-1010", "Agent 1010 by alias"],
    ["Clipping Office", "Clipping Office"],
    ["Human Gate", "Human Gate"],
    ["Clipping Workflow", "Clipping Workflow"],
    ["02_Agents/Agent_1010.md", "legacy path"],
  ];
  searchChecks.forEach(([query, label]) => {
    const results = obsidianVault.searchVault(vaultPath, query, { limit: 10 });
    assertCondition(issues, results.length > 0, "error", "search_result", `Search failed: ${label}.`, { query });
  });

  const conflicts = detectConflicts(vaultPath);
  conflicts.filter((conflict) => conflict.severity === "critical").forEach((conflict) => {
    issues.push(issue("critical", "critical_conflict", conflict.summary, { conflict }));
  });

  let backup = null;
  let restoreDryRun = null;
  if (options.skipBackup !== true && options.backupOptions) {
    backup = brainBackup.createBrainBackup(options.backupOptions);
    assertCondition(issues, backup.verified, "critical", "backup_verified", "Backup did not verify.", { backupPath: backup.backupPath });
    restoreDryRun = brainBackup.restoreDryRun({ backupPath: backup.backupPath, vaultPath });
    assertCondition(issues, restoreDryRun.verified && restoreDryRun.changesLiveFiles === false, "critical", "restore_dry_run", "Restore dry-run failed or changed live files.");
  }

  const criticalCount = issues.filter((item) => item.severity === "critical").length;
  const errorCount = issues.filter((item) => item.severity === "error").length;
  const report = {
    schemaVersion: "2.0.0",
    generatedAt: now(),
    vaultPath,
    status: criticalCount === 0 ? "pass" : "fail",
    criticalCount,
    errorCount,
    warningCount: issues.filter((item) => item.severity === "warning").length,
    validation,
    conflicts,
    context: {
      contextHash: context.contextHash || "",
      tokenEstimate: context.tokenEstimate || 0,
      includedCount: Array.isArray(context.citations) ? context.citations.length : (context.notes || []).length,
      excludedCount: Array.isArray(context.excluded) ? context.excluded.length : 0,
    },
    backup,
    restoreDryRun,
    issues,
  };
  writeReports(vaultPath, report);
  return report;
}

function writeReports(vaultPath, report) {
  const jsonPath = path.join(vaultPath, "00_System", "Manifests", "brain-verification-report.json");
  const mdPath = path.join(vaultPath, "00_System", "Manifests", "brain-verification-report.md");
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(mdPath, `---
id: "system.brain-verification-report"
type: "report"
title: "Brain Verification Report"
status: "active"
canonical: false
owner: "Agent 1010"
business: "business.argentum"
office: ""
agent: "agent.1010"
parent: "system.brain-status"
aliases: []
tags: ["brain","verification"]
source: "Argentum OS local verifier"
confidence: 1
created: "${report.generatedAt}"
updated: "${report.generatedAt}"
reviewed: ""
review_due: ""
---

# Brain Verification Report

- Generated: ${report.generatedAt}
- Status: ${report.status}
- Critical: ${report.criticalCount}
- Errors: ${report.errorCount}
- Warnings: ${report.warningCount}
- Vault: ${report.vaultPath}

## Issues
${report.issues.length ? report.issues.map((item) => `- ${item.severity.toUpperCase()} ${item.code}: ${item.message}`).join("\n") : "- No critical verification issues."}

## Context
- Hash: ${report.context.contextHash || "n/a"}
- Token estimate: ${report.context.tokenEstimate}
- Included: ${report.context.includedCount}
- Excluded: ${report.context.excludedCount}

## Backup
${report.backup ? `- ${report.backup.backupId}: ${report.backup.verified ? "verified" : "failed"}` : "- Backup check not requested for this run."}
`);
}

module.exports = {
  detectConflicts,
  verifyBrain,
};

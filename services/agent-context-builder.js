const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const obsidianVault = require("./obsidian-vault");
const { detectConflicts } = require("./brain-verification");

function now() {
  return new Date().toISOString();
}

function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 4);
}

function hashContext(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function readSearchIndex(vaultPath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(vaultPath, "00_System", "Manifests", "search-index.json"), "utf8"));
  } catch {
    obsidianVault.rebuildIndexes(vaultPath);
    return JSON.parse(fs.readFileSync(path.join(vaultPath, "00_System", "Manifests", "search-index.json"), "utf8"));
  }
}

function evidenceFor(note, claim, section = "") {
  return {
    id: `evidence.${crypto.createHash("sha1").update(`${note.path}:${claim}`).digest("hex").slice(0, 12)}`,
    claim,
    sourceType: "vault_note",
    sourceId: note.frontmatter?.id || note.path,
    title: note.title,
    canonicalPath: note.path,
    section,
    confidence: Number(note.frontmatter?.confidence ?? 1),
    retrievedAt: now(),
  };
}

function publicRecord(note, whyIncluded) {
  return {
    id: note.frontmatter?.id || note.path,
    title: note.title,
    type: note.frontmatter?.type || "note",
    canonicalPath: note.path,
    path: note.path,
    status: note.frontmatter?.status || "",
    confidence: Number(note.frontmatter?.confidence ?? 0),
    updatedAt: note.frontmatter?.updated || note.updatedAt,
    whyIncluded,
    source: note.frontmatter?.source || "Argentum Brain",
    excerpt: note.body.slice(0, 2000),
  };
}

function addNote(vaultPath, target, ref, whyIncluded, claim) {
  if (!ref) return;
  try {
    const note = obsidianVault.readNote(vaultPath, ref);
    const key = note.frontmatter?.id || note.path;
    if (target._seen.has(key)) return;
    target._seen.add(key);
    const record = publicRecord(note, whyIncluded);
    target.records.push(record);
    target.citations.push(evidenceFor(note, claim || whyIncluded, whyIncluded));
  } catch (error) {
    target.excluded.push({ record: ref, reason: "missing_required_record", detail: error.message });
  }
}

function noteExcluded(note, filters = {}) {
  const status = String(note.status || "").toLowerCase();
  if (String(note.path || "").startsWith("99_Archive/")) return "archived";
  if (status === "rejected") return "rejected";
  if (status === "superseded") return "superseded";
  if (note.expiresAt && Date.parse(note.expiresAt) < Date.now()) return "expired";
  if (note.type === "memory" && !["approved", "active"].includes(status)) return "draft_not_authoritative";
  if (filters.businessId && note.business && note.business !== filters.businessId) return "unrelated_business";
  if (filters.officeId && note.office && note.office !== filters.officeId) return "unrelated_office";
  return "";
}

function addIndexedMatches(vaultPath, target, section, predicate, whyIncluded, limit = 5, filters = {}) {
  const index = readSearchIndex(vaultPath);
  index.notes
    .filter(predicate)
    .sort((a, b) => String(b.updated).localeCompare(String(a.updated)))
    .forEach((note) => {
      const reason = noteExcluded(note, filters);
      if (reason) {
        target.excluded.push({ record: note.id || note.path, title: note.title, type: note.type, canonicalPath: note.path, reason });
        return;
      }
      if (target.sections[section].length >= limit) {
        target.excluded.push({ record: note.id || note.path, title: note.title, type: note.type, canonicalPath: note.path, reason: "low_relevance" });
        return;
      }
      try {
        const fullNote = obsidianVault.readNote(vaultPath, note.path);
        const key = fullNote.frontmatter?.id || fullNote.path;
        if (target._seen.has(key)) {
          target.excluded.push({ record: key, title: fullNote.title, canonicalPath: fullNote.path, reason: "duplicate" });
          return;
        }
        target._seen.add(key);
        const record = publicRecord(fullNote, whyIncluded);
        target.sections[section].push(record);
        target.citations.push(evidenceFor(fullNote, whyIncluded, section));
      } catch {
        target.excluded.push({ record: note.id || note.path, title: note.title, reason: "missing_required_record" });
      }
    });
}

function currentThread(state, threadId) {
  return (state?.agent101ChatThreads || []).find((thread) => thread.id === threadId) || null;
}

function buildAgentContext({
  vaultPath = obsidianVault.defaultVaultPath(),
  state = null,
  agentId = "agent.1010",
  threadId = "",
  taskId = "",
  projectId = "",
  officeId = "office.clipping",
  businessId = "business.argentum",
  maxTokens = 8000,
  includeTrace = false,
} = {}) {
  const sections = {
    governance: [],
    business: [],
    office: [],
    project: [],
    task: [],
    approvals: [],
    procedures: [],
    memory: [],
    toolResults: [],
    conversation: [],
  };
  const target = { sections, records: [], citations: [], excluded: [], _seen: new Set() };
  const add = (section, ref, why, claim) => {
    const before = target.records.length;
    addNote(vaultPath, target, ref, why, claim);
    if (target.records.length > before) sections[section].push(target.records[target.records.length - 1]);
  };

  add("governance", "00_System/Governance/Supervised_Agent_Rules.md", "required_governance", "Agent 1010 follows supervised-agent rules.");
  add("governance", "00_System/Governance/Human_Gate_Rules.md", "required_human_gate_policy", "Human Gate defines approval boundaries.");
  add("governance", "00_System/Link_Policy.md", "required_context_policy", "Context follows hub-and-spoke policy.");
  add("governance", "00_System/Context_Manifests/Agent_1010_Context.md", "required_context_manifest", "Agent 1010 context uses a deterministic manifest.");
  add("business", agentId, "agent_identity", "Agent 1010 identity and role are canonical.");
  add("business", businessId, "active_business", "Argentum business profile is active context.");
  add("office", officeId, "active_office", "Active office is part of the current task context.");
  if (projectId) add("project", projectId, "active_project", "Active project is part of the current task context.");

  addIndexedMatches(vaultPath, target, "procedures", (note) => note.type === "workflow" && (!note.business || note.business === businessId) && (!note.office || note.office === officeId), "relevant_approved_procedure", 4, { businessId, officeId });
  addIndexedMatches(vaultPath, target, "memory", (note) => note.type === "memory" && note.status === "approved" && (!note.business || note.business === businessId) && (!note.office || note.office === officeId), "relevant_approved_memory", 8, { businessId, officeId });

  if (state) {
    const task = (state.tasks || []).find((item) => item.id === taskId);
    if (task) {
      const record = {
        id: task.id,
        title: task.title,
        type: "task",
        canonicalPath: "",
        status: task.status,
        confidence: 1,
        updatedAt: task.updatedAt || task.createdAt,
        whyIncluded: "current_task_contract",
        source: "database_record",
        excerpt: [task.operatorText, task.output].filter(Boolean).join("\n").slice(0, 2000),
      };
      sections.task.push(record);
      target.citations.push({ id: `evidence.${task.id}`, claim: "Current task contract loaded.", sourceType: "database_record", sourceId: task.id, title: task.title, canonicalPath: "", section: "task", confidence: 1, retrievedAt: now() });
    }
    (state.approvals || [])
      .filter((approval) => approval.status === "pending")
      .slice(0, 6)
      .forEach((approval) => {
        sections.approvals.push({
          id: approval.id,
          title: approval.title,
          type: "approval",
          canonicalPath: "",
          status: approval.status,
          confidence: 1,
          updatedAt: approval.updatedAt || approval.createdAt,
          whyIncluded: "pending_approval",
          source: "database_record",
          excerpt: String(approval.evidence || approval.action || "").slice(0, 1000),
        });
        target.citations.push({ id: `evidence.${approval.id}`, claim: "Pending approval loaded.", sourceType: "database_record", sourceId: approval.id, title: approval.title, canonicalPath: "", section: "approvals", confidence: 1, retrievedAt: now() });
      });
    const thread = currentThread(state, threadId);
    if (thread) {
      if (thread.threadSummary?.summary || thread.summary) {
        sections.conversation.push({
          id: `${thread.id}.summary`,
          title: "Thread Summary",
          type: "thread_summary",
          canonicalPath: "",
          status: "active",
          confidence: 0.8,
          updatedAt: thread.updatedAt,
          whyIncluded: "thread_summary",
          source: "operator_message",
          excerpt: String(thread.threadSummary?.summary || thread.summary).slice(0, 1200),
        });
      }
      (thread.messages || []).slice(-8).forEach((message) => {
        sections.conversation.push({
          id: message.id,
          title: `${message.role} message`,
          type: "message",
          canonicalPath: "",
          status: message.status,
          confidence: 1,
          updatedAt: message.updatedAt || message.createdAt,
          whyIncluded: "recent_message",
          source: "operator_message",
          excerpt: String(message.content || "").slice(0, 1000),
        });
      });
    }
  }

  const conflicts = detectConflicts(vaultPath);
  const criticalConflicts = conflicts.filter((conflict) => conflict.severity === "critical");
  criticalConflicts.forEach((conflict) => {
    target.excluded.push({ record: conflict.id, reason: "critical_conflict", detail: "Conflicting approved records require operator resolution.", conflict });
  });

  let ordered = Object.values(sections).flat();
  let tokenEstimate = estimateTokens(ordered.map((record) => record.excerpt).join("\n"));
  while (tokenEstimate > maxTokens && ordered.length > 0) {
    const removed = ordered.pop();
    target.excluded.push({ record: removed.id, title: removed.title, reason: "token_budget" });
    Object.keys(sections).forEach((key) => {
      sections[key] = sections[key].filter((record) => record.id !== removed.id);
    });
    tokenEstimate = estimateTokens(Object.values(sections).flat().map((record) => record.excerpt).join("\n"));
  }

  const context = {
    agent: sections.business.find((record) => record.id === agentId) || {},
    governance: sections.governance,
    business: sections.business.filter((record) => record.id !== agentId),
    office: sections.office,
    project: sections.project,
    task: sections.task,
    approvals: sections.approvals,
    procedures: sections.procedures,
    memory: sections.memory,
    toolResults: sections.toolResults,
    conversation: sections.conversation,
    citations: target.citations,
    excluded: target.excluded,
    conflicts,
    tokenEstimate,
    contextHash: "",
  };
  context.contextHash = hashContext({ ...context, contextHash: "", excluded: includeTrace ? context.excluded : context.excluded.map((item) => ({ record: item.record, reason: item.reason })) });
  return context;
}

function structureAgentResponse(message, context, options = {}) {
  const evidence = Array.isArray(context?.citations) ? context.citations : [];
  const claims = [];
  if (/approved role|role|authority/i.test(String(message || ""))) {
    const agentEvidence = evidence.find((item) => item.canonicalPath?.includes("Agent_1010/_Agent.md"));
    if (agentEvidence) {
      claims.push({ claim: "Agent 1010 is the Chief Operations Intelligence Agent of Argentum OS.", evidenceId: agentEvidence.id });
    }
  }
  return {
    message,
    claims,
    evidence,
    unknowns: options.unknowns || [],
    conflicts: (context?.conflicts || []).filter((conflict) => conflict.severity === "critical"),
    actionsTaken: options.actionsTaken || [],
    artifacts: options.artifacts || [],
    approvals: options.approvals || [],
    nextAction: options.nextAction || null,
  };
}

module.exports = {
  buildAgentContext,
  evidenceFor,
  structureAgentResponse,
};

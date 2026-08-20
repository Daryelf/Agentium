const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const VAULT_NAME = "Argentum-Brain";
const SCHEMA_VERSION = "2.0.0";
const MAX_NOTE_BYTES = 512 * 1024;
const SECRET_PATTERN = /((api[_-\s]?key|secret|token|password)\s*[:=]\s*\S{8,}|bearer\s+[a-z0-9._-]{12,}|sk-[a-z0-9_-]{12,}|xox[baprs]-[a-z0-9-]{12,})/i;

const REQUIRED_FRONTMATTER_FIELDS = [
  "id",
  "type",
  "title",
  "status",
  "canonical",
  "owner",
  "business",
  "office",
  "agent",
  "parent",
  "aliases",
  "tags",
  "source",
  "confidence",
  "created",
  "updated",
  "reviewed",
  "review_due",
];

const REQUIRED_DIRS = [
  "00_System",
  "00_System/Architecture",
  "00_System/Context_Manifests",
  "00_System/Governance",
  "00_System/Manifests",
  "00_System/Templates",
  "10_Businesses",
  "10_Businesses/Argentum",
  "10_Businesses/Essentrx",
  "10_Businesses/Zytrip",
  "20_Offices",
  "20_Offices/Argentum",
  "20_Offices/Argentum/Clipping_Office",
  "20_Offices/Argentum/Stock_Office",
  "20_Offices/Argentum/Research_Office",
  "20_Offices/Argentum/Human_Gate",
  "30_Agents",
  "30_Agents/Agent_1010",
  "30_Agents/Clipping_Agent",
  "30_Agents/Backend_Agent",
  "30_Agents/Frontend_Agent",
  "40_Capabilities",
  "40_Capabilities/Skills",
  "40_Capabilities/Tools",
  "40_Capabilities/Integrations",
  "50_Operations",
  "50_Operations/Workflows",
  "50_Operations/Runbooks",
  "50_Operations/Human_Gate",
  "60_Projects",
  "70_Knowledge",
  "80_Memory",
  "80_Memory/Approved",
  "80_Memory/Imported",
  "80_Memory/Proposed",
  "80_Memory/Rejected",
  "90_Execution",
  "90_Execution/Daily_Notes",
  "90_Execution/Decisions",
  "90_Execution/Logs",
  "90_Execution/Runs",
  "90_Execution/Tasks",
  "95_Inbox",
  "95_Inbox/Memory_Proposals",
  "98_Assets",
  "99_Archive",
];

const CORE_SYSTEM_FILES = [
  "00_System/Argentum_Brain_Home.md",
  "00_System/Brain_Status.md",
  "00_System/Brain_Architecture.md",
  "00_System/Taxonomy.md",
  "00_System/Naming_Standard.md",
  "00_System/Link_Policy.md",
  "00_System/Memory_Lifecycle.md",
  "00_System/Graph_View_Guide.md",
  "00_System/Migration_Report.md",
  "00_System/Governance/Supervised_Agent_Rules.md",
  "00_System/Governance/Human_Gate_Rules.md",
  "00_System/Governance/Secret_Handling_Rules.md",
  "00_System/Context_Manifests/Agent_1010_Context.md",
  "00_System/Architecture/System_Architecture.md",
  "00_System/Architecture/Vault_Taxonomy.md",
  "00_System/Architecture/Agent_Context_Flow.md",
  "00_System/Architecture/Memory_Lifecycle.md",
  "10_Businesses/_Businesses_Index.md",
  "20_Offices/_Offices_Index.md",
  "30_Agents/_Agents_Index.md",
  "40_Capabilities/_Capabilities_Index.md",
  "40_Capabilities/Skills/_Skills_Index.md",
  "40_Capabilities/Tools/_Tools_Index.md",
  "40_Capabilities/Integrations/_Integrations_Index.md",
  "50_Operations/_Operations_Index.md",
  "50_Operations/Workflows/_Workflows_Index.md",
  "50_Operations/Runbooks/_Runbooks_Index.md",
  "50_Operations/Human_Gate/_Human_Gate_Index.md",
  "60_Projects/_Projects_Index.md",
  "70_Knowledge/_Knowledge_Index.md",
  "80_Memory/_Memory_Index.md",
  "90_Execution/_Execution_Index.md",
  "90_Execution/Decisions/_Decisions_Index.md",
  "90_Execution/Tasks/_Tasks_Index.md",
  "90_Execution/Runs/_Runs_Index.md",
  "90_Execution/Daily_Notes/_Daily_Notes_Index.md",
  "95_Inbox/_Inbox_Index.md",
  "95_Inbox/Memory_Proposals/_Memory_Proposals_Index.md",
  "98_Assets/_Assets_Index.md",
  "99_Archive/_Archive_Index.md",
];

const LEGACY_PATH_MAP = {
  "00_System/Argentum_Index.md": "00_System/Argentum_Brain_Home.md",
  "00_System/Agent_Rules.md": "00_System/Governance/Supervised_Agent_Rules.md",
  "00_System/Memory_Rules.md": "00_System/Memory_Lifecycle.md",
  "00_System/Daily_Note_Template.md": "00_System/Templates/daily_note.md",
  "00_System/Skill_Template.md": "00_System/Templates/skill.md",
  "01_Businesses/Argentum/Argentum_Master.md": "10_Businesses/Argentum/_Business.md",
  "01_Businesses/Argentum/Agent_1010.md": "30_Agents/Agent_1010/_Agent.md",
  "01_Businesses/Argentum/Clipping_Office.md": "20_Offices/Argentum/Clipping_Office/_Office.md",
  "01_Businesses/Argentum/Stock_Office.md": "20_Offices/Argentum/Stock_Office/_Office.md",
  "01_Businesses/Essentrx/Essentrx_Master.md": "10_Businesses/Essentrx/_Business.md",
  "01_Businesses/Zytrip/Zytrip_Master.md": "10_Businesses/Zytrip/_Business.md",
  "02_Agents/Agent_1010.md": "30_Agents/Agent_1010/_Agent.md",
  "02_Agents/Backend_Agent.md": "30_Agents/Backend_Agent/_Agent.md",
  "02_Agents/Frontend_Agent.md": "30_Agents/Frontend_Agent/_Agent.md",
  "02_Agents/Clipping_Agent.md": "30_Agents/Clipping_Agent/_Agent.md",
  "03_Skills/Analyze_Stream_Clip.md": "40_Capabilities/Skills/Analyze_Stream_Clip.md",
  "03_Skills/Build_React_Page.md": "40_Capabilities/Skills/Build_React_Page.md",
  "03_Skills/Create_TikTok_Hook.md": "40_Capabilities/Skills/Create_TikTok_Hook.md",
  "03_Skills/Deploy_Railway.md": "40_Capabilities/Skills/Deploy_Railway.md",
  "03_Skills/Fix_TypeScript_Error.md": "40_Capabilities/Skills/Fix_TypeScript_Error.md",
  "03_Skills/Research_Competitor.md": "40_Capabilities/Skills/Research_Competitor.md",
  "04_Workflows/Clipping_Workflow.md": "50_Operations/Workflows/Clipping_Workflow.md",
  "04_Workflows/Deployment_Workflow.md": "50_Operations/Workflows/Deployment_Workflow.md",
  "04_Workflows/Human_Gate_Workflow.md": "50_Operations/Workflows/Human_Gate_Workflow.md",
  "04_Workflows/Website_Update_Workflow.md": "50_Operations/Workflows/Website_Update_Workflow.md",
  "05_Memory/Lessons_Learned.md": "80_Memory/Imported/Lessons_Learned.md",
  "05_Memory/Decisions.md": "90_Execution/Decisions/Imported_Decisions.md",
  "05_Memory/User_Preferences.md": "80_Memory/Imported/User_Preferences.md",
  "06_Daily_Notes": "90_Execution/Daily_Notes",
  "07_Archive": "99_Archive/Legacy",
};

const ENTITY_CONFIG = {
  business: { root: "10_Businesses", fileName: "_Business.md", idPrefix: "business", typeLabel: "Business" },
  office: { root: "20_Offices/Argentum", fileName: "_Office.md", idPrefix: "office", typeLabel: "Office" },
  agent: { root: "30_Agents", fileName: "_Agent.md", idPrefix: "agent", typeLabel: "Agent" },
  skill: { root: "40_Capabilities/Skills", fileName: null, idPrefix: "skill", typeLabel: "Skill" },
  tool: { root: "40_Capabilities/Tools", fileName: null, idPrefix: "tool", typeLabel: "Tool" },
  integration: { root: "40_Capabilities/Integrations", fileName: null, idPrefix: "integration", typeLabel: "Integration" },
  workflow: { root: "50_Operations/Workflows", fileName: null, idPrefix: "workflow", typeLabel: "Workflow" },
  runbook: { root: "50_Operations/Runbooks", fileName: null, idPrefix: "runbook", typeLabel: "Runbook" },
  project: { root: "60_Projects", fileName: "_Project.md", idPrefix: "project", typeLabel: "Project" },
  knowledge: { root: "70_Knowledge", fileName: null, idPrefix: "knowledge", typeLabel: "Knowledge" },
  memory: { root: "80_Memory/Approved", fileName: null, idPrefix: "memory", typeLabel: "Memory" },
  decision: { root: "90_Execution/Decisions", fileName: null, idPrefix: "decision", typeLabel: "Decision" },
  task: { root: "90_Execution/Tasks", fileName: null, idPrefix: "task", typeLabel: "Task" },
  run: { root: "90_Execution/Runs", fileName: null, idPrefix: "run", typeLabel: "Run" },
};

const CANONICAL_ENTITIES = [
  { type: "business", id: "business.argentum", title: "Argentum", path: "10_Businesses/Argentum/_Business.md", status: "active", tags: ["business", "operating-system"], body: "Argentum is the supervised AI operating-company console. It coordinates offices, agents, Human Gate approvals, and local-first execution.\n\n## Current Operating Focus\n- Local Mac desktop runtime\n- Clip Office production readiness\n- Agent 1010 executive operations intelligence\n- Obsidian long-term memory architecture\n\n## Canonical Links\n- [[30_Agents/Agent_1010/_Agent|Agent 1010]]\n- [[20_Offices/Argentum/Clipping_Office/_Office|Clipping Office]]\n- [[50_Operations/Workflows/Human_Gate_Workflow|Human Gate Workflow]]" },
  { type: "business", id: "business.essentrx", title: "Essentrx", path: "10_Businesses/Essentrx/_Business.md", status: "active", tags: ["business", "commerce"], body: "Essentrx is a commerce and fragrance business connected to Argentum operations.\n\n## Known Facts\n- Product, creator, storefront, checkout, fulfillment, and admin workflows are managed separately from Argentum system code.\n\n## Unknowns\n- TODO - operator input required for current revenue targets, offer map, and campaign calendar." },
  { type: "business", id: "business.zytrip", title: "Zytrip", path: "10_Businesses/Zytrip/_Business.md", status: "draft", tags: ["business", "travel"], body: "Zytrip is tracked as a separate business domain.\n\n## Unknowns\n- TODO - operator input required for active product status, target market, and current workflows." },
  { type: "office", id: "office.clipping", title: "Clipping Office", path: "20_Offices/Argentum/Clipping_Office/_Office.md", business: "business.argentum", status: "active", tags: ["office", "clips"], body: "The Clipping Office finds live streams, monitors approved streamers, creates 30-second watch windows, scores candidate clips, and prepares packages for human review.\n\n## Operating Metrics To Report\n- Active streams\n- Streamers monitored\n- Candidate clips\n- Clips approved\n- Clips pending\n- Export status\n- Posting queue\n- Failures\n- Success rate\n\n## Guardrails\n- Human Gate approval is required before posting externally, deleting source files, spending money, or changing system settings." },
  { type: "office", id: "office.stock", title: "Stock Office", path: "20_Offices/Argentum/Stock_Office/_Office.md", business: "business.argentum", status: "active", tags: ["office", "stocks"], body: "The Stock Office is the read-only market intelligence workspace inside Argentum unless Human Gate grants a higher-risk action.\n\n## Guardrails\n- Fail closed on stale evaluator data, broker ambiguity, account mismatch, or unavailable buying power." },
  { type: "office", id: "office.research", title: "Research Office", path: "20_Offices/Argentum/Research_Office/_Office.md", business: "business.argentum", status: "draft", tags: ["office", "research"], body: "The Research Office investigates markets, competitors, products, and operating context for Argentum businesses.\n\n## Unknowns\n- TODO - operator input required for current priority research queues." },
  { type: "office", id: "office.human_gate", title: "Human Gate", path: "20_Offices/Argentum/Human_Gate/_Office.md", business: "business.argentum", status: "active", tags: ["office", "approval"], body: "Human Gate is the approval boundary for high-risk or externally visible actions.\n\n## Approval Required\n- Delete files\n- Post content\n- Send emails\n- Spend money\n- Change system settings\n- Change account permissions\n- Publish externally" },
  { type: "agent", id: "agent.1010", title: "Agent 1010", path: "30_Agents/Agent_1010/_Agent.md", business: "business.argentum", office: "office.human_gate", status: "active", tags: ["agent", "operations"], body: "Agent 1010 is the Chief Operations Intelligence Agent of Argentum OS.\n\n## Identity\nAgent 1010 investigates, analyzes, infers, plans, executes, reports, and optimizes. It communicates like a COO, Chief of Staff, Head of Operations, and founder-level operator.\n\n## Response Contract\n- Current status\n- Key findings\n- Risks\n- Recommendations\n- Next actions\n\n## Guardrails\nAgent 1010 may draft, plan, inspect, summarize, and prepare actions. Human Gate approval remains required for dangerous or externally visible execution." },
  { type: "agent", id: "agent.clipping", title: "Clipping Agent", path: "30_Agents/Clipping_Agent/_Agent.md", business: "business.argentum", office: "office.clipping", status: "active", tags: ["agent", "clips"], body: "The Clipping Agent supports live stream discovery, watch windows, scoring, and candidate packaging.\n\n## Current Standard\n- Use real stream metadata when available.\n- Do not present fallback rows as verified live data.\n- Keep source status truthful." },
  { type: "agent", id: "agent.backend", title: "Backend Agent", path: "30_Agents/Backend_Agent/_Agent.md", business: "business.argentum", status: "active", tags: ["agent", "backend"], body: "The Backend Agent owns server routes, local runtime wiring, data persistence, integrations, tests, and safety gates." },
  { type: "agent", id: "agent.frontend", title: "Frontend Agent", path: "30_Agents/Frontend_Agent/_Agent.md", business: "business.argentum", status: "active", tags: ["agent", "frontend"], body: "The Frontend Agent owns Argentum UI behavior, Mac app polish, state refresh, workflow clarity, and truthful operational displays." },
  { type: "skill", id: "skill.analyze_stream_clip", title: "Analyze Stream Clip", path: "40_Capabilities/Skills/Analyze_Stream_Clip.md", business: "business.argentum", office: "office.clipping", status: "active", tags: ["skill", "clips"], body: "Evaluate a stream moment for hook strength, context, replay value, platform fit, and risk.\n\n## Inputs\n- Stream title\n- Viewer count\n- Chat activity\n- Transcript or speech summary when available\n- Visual source status when available\n\n## Output\n- Score\n- Rationale\n- Risk flags\n- Recommended next action" },
  { type: "skill", id: "skill.create_tiktok_hook", title: "Create TikTok Hook", path: "40_Capabilities/Skills/Create_TikTok_Hook.md", business: "business.argentum", office: "office.clipping", status: "draft", tags: ["skill", "hooks"], body: "Draft short-form hooks only after a real clip candidate exists.\n\n## Guardrail\nDo not invent events that are not visible, transcribed, or supported by stream metadata." },
  { type: "skill", id: "skill.build_react_page", title: "Build React Page", path: "40_Capabilities/Skills/Build_React_Page.md", status: "active", tags: ["skill", "frontend"], body: "Build frontend pages using the existing app patterns, controls, and visual system. Keep runtime state truthful." },
  { type: "skill", id: "skill.fix_typescript_error", title: "Fix TypeScript Error", path: "40_Capabilities/Skills/Fix_TypeScript_Error.md", status: "active", tags: ["skill", "code"], body: "Diagnose build or type errors from the exact compiler output, then make the narrowest reliable code change." },
  { type: "skill", id: "skill.deploy_railway", title: "Deploy Railway", path: "40_Capabilities/Skills/Deploy_Railway.md", status: "draft", tags: ["skill", "deployment"], body: "Railway deployment is cloud-mode only. Local Mac behavior must stay additive and must not break production." },
  { type: "skill", id: "skill.research_competitor", title: "Research Competitor", path: "40_Capabilities/Skills/Research_Competitor.md", status: "draft", tags: ["skill", "research"], body: "Investigate competitor positioning, offers, channels, pricing, and operational lessons. Cite sources when current web data is used." },
  { type: "tool", id: "tool.openclaw", title: "OpenClaw", path: "40_Capabilities/Tools/OpenClaw.md", status: "active", tags: ["tool", "action-gateway"], body: "OpenClaw is the supervised action gateway. It is not an approval bypass.\n\n## Rule\nDangerous actions route through Human Gate." },
  { type: "tool", id: "tool.claude_code", title: "Claude Code", path: "40_Capabilities/Tools/Claude_Code.md", status: "active", tags: ["tool", "code"], body: "Claude Code is tracked as a coding worker surface inside Argentum operations." },
  { type: "tool", id: "tool.browser_workspace", title: "Browser Workspace", path: "40_Capabilities/Tools/Browser_Workspace.md", status: "active", tags: ["tool", "browser"], body: "Browser Workspace handles supervised browser actions and smoke checks when approved." },
  { type: "tool", id: "tool.local_job_runner", title: "Local Job Runner", path: "40_Capabilities/Tools/Local_Job_Runner.md", status: "active", tags: ["tool", "local"], body: "The local job runner queues agent tasks inside the Mac app runtime." },
  { type: "integration", id: "integration.twitch", title: "Twitch", path: "40_Capabilities/Integrations/Twitch.md", office: "office.clipping", status: "active", tags: ["integration", "streaming"], body: "Twitch is an external streaming integration used for live status, streamer discovery, and stream metadata when credentials are configured server-side." },
  { type: "integration", id: "integration.kick", title: "Kick", path: "40_Capabilities/Integrations/Kick.md", office: "office.clipping", status: "active", tags: ["integration", "streaming"], body: "Kick is an external streaming integration used for live stream discovery and metadata when credentials are configured server-side." },
  { type: "integration", id: "integration.openai", title: "OpenAI", path: "40_Capabilities/Integrations/OpenAI.md", status: "active", tags: ["integration", "ai"], body: "OpenAI is a Cloud API integration. API keys must stay server-side in secure storage." },
  { type: "integration", id: "integration.claude", title: "Claude", path: "40_Capabilities/Integrations/Claude.md", status: "active", tags: ["integration", "ai"], body: "Claude is a Cloud API integration. API keys must stay server-side in secure storage." },
  { type: "integration", id: "integration.tiktok", title: "TikTok", path: "40_Capabilities/Integrations/TikTok.md", status: "draft", tags: ["integration", "posting"], body: "TikTok posting is externally visible and requires Human Gate approval before publishing." },
  { type: "integration", id: "integration.stripe", title: "Stripe", path: "40_Capabilities/Integrations/Stripe.md", status: "draft", tags: ["integration", "payments"], body: "Stripe is a financial integration. Spending, refunds, billing changes, and key changes require strict approval controls." },
  { type: "integration", id: "integration.capcut", title: "CapCut", path: "40_Capabilities/Integrations/CapCut.md", status: "draft", tags: ["integration", "editing"], body: "CapCut is a manual handoff integration for editing packages until a verified local automation path exists." },
  { type: "integration", id: "integration.obsidian", title: "Obsidian", path: "40_Capabilities/Integrations/Obsidian.md", status: "active", tags: ["integration", "memory"], body: "Obsidian stores Argentum long-term operational memory. It must not store secrets." },
  { type: "workflow", id: "workflow.clipping", title: "Clipping Workflow", path: "50_Operations/Workflows/Clipping_Workflow.md", business: "business.argentum", office: "office.clipping", agent: "agent.clipping", status: "active", tags: ["workflow", "clips"], body: "## Steps\n1. Discover live streamers from configured providers.\n2. Add only approved streamers to monitored watch.\n3. Record 30-second watch windows.\n4. Score good or bad moments.\n5. Send package-worthy clips to Clip Builder.\n6. Route posting and deletion decisions through Human Gate when required." },
  { type: "workflow", id: "workflow.human_gate", title: "Human Gate Workflow", path: "50_Operations/Workflows/Human_Gate_Workflow.md", business: "business.argentum", office: "office.human_gate", agent: "agent.1010", status: "active", tags: ["workflow", "approval"], body: "## Steps\n1. Detect risk.\n2. Prepare the action with evidence.\n3. Queue approval.\n4. Wait for operator decision.\n5. Execute only the approved action.\n6. Log the outcome." },
  { type: "workflow", id: "workflow.deployment", title: "Deployment Workflow", path: "50_Operations/Workflows/Deployment_Workflow.md", business: "business.argentum", status: "active", tags: ["workflow", "deployment"], body: "## Rule\nCloud deployment and local Mac mode must remain separate. APP_MODE=local uses local storage. APP_MODE=cloud keeps production behavior." },
  { type: "workflow", id: "workflow.website_update", title: "Website Update Workflow", path: "50_Operations/Workflows/Website_Update_Workflow.md", business: "business.essentrx", status: "draft", tags: ["workflow", "website"], body: "Track website updates with evidence, tests, and deployment status. Do not claim live status without verification." },
  { type: "workflow", id: "workflow.daily_review", title: "Daily Review Workflow", path: "50_Operations/Workflows/Daily_Review_Workflow.md", business: "business.argentum", agent: "agent.1010", status: "draft", tags: ["workflow", "review"], body: "Summarize current status, key findings, risks, recommendations, and next actions across active offices." },
  { type: "project", id: "project.local_mac_app", title: "Local Mac App", path: "60_Projects/Local_Mac_App/_Project.md", business: "business.argentum", status: "active", tags: ["project", "desktop"], body: "Argentum OS local Mac desktop mode runs the frontend, backend, local database, secure storage, and selected integrations locally." },
  { type: "project", id: "project.clip_office_production", title: "Clip Office Production Readiness", path: "60_Projects/Clip_Office_Production_Readiness/_Project.md", business: "business.argentum", office: "office.clipping", status: "active", tags: ["project", "clips"], body: "Clip Office production readiness focuses on real live watching, candidate creation, clip review, deletion, builder handoff, and truthful source status." },
  { type: "project", id: "project.obsidian_brain_rebuild", title: "Obsidian Brain Rebuild", path: "60_Projects/Obsidian_Brain_Rebuild/_Project.md", business: "business.argentum", agent: "agent.1010", status: "active", tags: ["project", "memory"], body: "Rebuild the Argentum Obsidian vault into a canonical, validated, schema-versioned operational brain." },
];

function now() {
  return new Date().toISOString();
}

function defaultVaultPath() {
  return path.join(os.homedir(), "Documents", VAULT_NAME);
}

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function normalizeVaultPath(vaultPath) {
  return path.resolve(String(vaultPath || defaultVaultPath()).replace(/^~(?=$|\/)/, os.homedir()));
}

function ensureInsideVault(vaultPath, targetPath) {
  const vault = normalizeVaultPath(vaultPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(vault, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    const error = new Error("Obsidian file access is restricted to the configured vault.");
    error.status = 403;
    throw error;
  }
  return target;
}

function assertSafeContent(content) {
  if (SECRET_PATTERN.test(String(content || ""))) {
    const error = new Error("Obsidian notes must not contain API keys, tokens, passwords, or secrets.");
    error.status = 400;
    throw error;
  }
}

function titleFromSegment(segment) {
  return String(segment || "")
    .replace(/\.md$/i, "")
    .replace(/^_/, "")
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fileSegment(title) {
  const cleaned = String(title || "")
    .trim()
    .replace(/\.md$/i, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90);
  return cleaned || "Untitled";
}

function slugId(value) {
  return String(value || "")
    .trim()
    .replace(/\.md$/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^\w\s.-]/g, "")
    .replace(/[_\s.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function stableId(type, title) {
  if (type === "agent" && /^agent\s*1010$/i.test(String(title || "").trim())) return "agent.1010";
  return `${ENTITY_CONFIG[type]?.idPrefix || type}.${slugId(title) || crypto.randomBytes(3).toString("hex")}`;
}

function toYamlValue(value) {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (value === null || value === undefined) return "\"\"";
  return JSON.stringify(String(value));
}

function fromYamlValue(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith("\"") && value.endsWith("\"")) || value.startsWith("[") || value.startsWith("{")) {
    try {
      return JSON.parse(value);
    } catch {
      return value.replace(/^"|"$/g, "");
    }
  }
  return value;
}

function frontmatter(fields = {}) {
  const full = {};
  REQUIRED_FRONTMATTER_FIELDS.forEach((key) => {
    if (key === "aliases" || key === "tags") full[key] = [];
    else if (key === "canonical") full[key] = false;
    else if (key === "confidence") full[key] = 0;
    else full[key] = "";
  });
  Object.assign(full, fields);
  const lines = Object.entries(full).map(([key, value]) => `${key}: ${toYamlValue(value)}`);
  return `---\n${lines.join("\n")}\n---\n\n`;
}

function parseFrontmatter(content) {
  const text = String(content || "");
  if (!text.startsWith("---\n")) return { data: {}, body: text, hasFrontmatter: false };
  const end = text.indexOf("\n---", 4);
  if (end === -1) return { data: {}, body: text, hasFrontmatter: false };
  const raw = text.slice(4, end).trim();
  const body = text.slice(end + 4).replace(/^\n+/, "");
  const data = {};
  raw.split("\n").forEach((line) => {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) return;
    data[match[1]] = fromYamlValue(match[2]);
  });
  return { data, body, hasFrontmatter: true };
}

function md(relPath, fields, body) {
  assertSafeContent(body);
  return `${frontmatter(fields)}# ${fields.title}\n\n${String(body || "").trim()}\n`;
}

function canonicalFields(overrides = {}) {
  const timestamp = overrides.created || now();
  return {
    id: overrides.id || stableId(overrides.type || "note", overrides.title),
    type: overrides.type || "note",
    title: overrides.title || "Untitled",
    status: overrides.status || "draft",
    canonical: Boolean(overrides.canonical),
    owner: overrides.owner || "Agent 1010",
    business: overrides.business || "",
    office: overrides.office || "",
    agent: overrides.agent || "",
    parent: overrides.parent || "",
    aliases: overrides.aliases || [],
    tags: overrides.tags || [],
    source: overrides.source || "Argentum OS local vault",
    confidence: overrides.confidence ?? (overrides.status === "draft" ? 0 : 1),
    created: timestamp,
    updated: overrides.updated || now(),
    reviewed: overrides.reviewed || "",
    review_due: overrides.review_due || "",
    ...overrides,
  };
}

function systemNote(relPath, title, body, extra = {}) {
  return {
    relPath,
    overwrite: true,
    content: md(relPath, canonicalFields({
      id: extra.id || `system.${slugId(title)}`,
      type: extra.type || "system",
      title,
      status: extra.status || "active",
      canonical: false,
      owner: "Agent 1010",
      tags: extra.tags || ["system"],
      confidence: 1,
      ...extra.frontmatter,
    }), body),
  };
}

function entityNote(entity) {
  return {
    relPath: entity.path,
    overwrite: false,
    content: md(entity.path, canonicalFields({ ...entity, canonical: true, confidence: entity.confidence ?? 1 }), entity.body),
  };
}

function templateNote(type) {
  const label = ENTITY_CONFIG[type]?.typeLabel || titleFromSegment(type);
  const relPath = `00_System/Templates/${type}.md`;
  const sampleFields = canonicalFields({
    id: `template.${type}`,
    type: "template",
    title: `${label} Template`,
    status: "active",
    canonical: false,
    tags: ["template", type],
    confidence: 1,
  });
  const body = `Use this template through POST /api/obsidian/create. The backend fills IDs, paths, timestamps, and links.\n\n## Overview\nTODO - operator input required.\n\n## Current Status\nTODO - operator input required.\n\n## Key Links\n\n## Notes\n`;
  return { relPath, overwrite: true, content: md(relPath, sampleFields, body) };
}

function requiredSystemNotes() {
  const taxonomyBody = `## One Meaning Per Type
- Business: revenue or operating entity, canonical home under \`10_Businesses/<Name>/_Business.md\`.
- Office: functional operating unit, canonical home under \`20_Offices/<Business>/<Office>/_Office.md\`.
- Agent: accountable AI/operator role, canonical home under \`30_Agents/<Agent>/_Agent.md\`.
- Skill: reusable capability, canonical home under \`40_Capabilities/Skills/<Skill>.md\`.
- Tool: execution surface, canonical home under \`40_Capabilities/Tools/<Tool>.md\`.
- Integration: external or cloud connector, canonical home under \`40_Capabilities/Integrations/<Integration>.md\`.
- Workflow: repeated operating process, canonical home under \`50_Operations/Workflows/<Workflow>.md\`.
- Project: bounded outcome, canonical home under \`60_Projects/<Project>/_Project.md\`.
- Decision: durable choice, canonical home under \`90_Execution/Decisions/<Decision>.md\`.
- Task: actionable unit, canonical home under \`90_Execution/Tasks/<Task>.md\`.
- Run: execution record, canonical home under \`90_Execution/Runs/<Run>.md\`.
- Memory: approved long-term fact, canonical home under \`80_Memory/Approved/<Memory>.md\`.

## Rule
Agent 1010 has one canonical home: [[30_Agents/Agent_1010/_Agent|Agent 1010]]. Do not duplicate it under a business folder.`;

  const linkPolicyBody = `## Hub And Spoke
- Canonical entities link to their parent hub and 2-7 directly relevant spokes.
- Index pages can link broadly.
- Working logs, daily notes, runs, assets, archive, and rejected memory are excluded from Agent 1010 context by default.
- Avoid blind wikilink traversal for agent context. Use context manifests and entity manifests.

## Valid Cross Links
- Business to offices, agents, workflows, and projects.
- Office to owning business, assigned agents, workflows, tools, and integrations.
- Agent to authority, assigned offices, workflows, and approved memory.
- Workflow to responsible business, office, agent, tools, and Human Gate rules.`;

  const namingBody = `## File Names
- Use underscores in filenames and folders.
- Keep display titles human-readable in frontmatter.
- Canonical folder homes use \`_Business.md\`, \`_Office.md\`, \`_Agent.md\`, and \`_Project.md\`.
- Do not create duplicate canonical homes for the same entity.

## IDs
- Stable IDs are lowercase dotted strings such as \`agent.1010\`, \`business.argentum\`, and \`workflow.clipping\`.
- IDs are the backend truth for resolving entities.`;

  const memoryLifecycleBody = `## States
1. Proposed: placed in \`80_Memory/Proposed\`.
2. Approved: moved to \`80_Memory/Approved\` and included in context.
3. Rejected: moved to \`80_Memory/Rejected\` and excluded from context.
4. Archived: moved to \`99_Archive\` and excluded from context.

## Rules
- Never store secrets.
- Incomplete facts are marked TODO with confidence 0.
- Approved memory must have source and confidence.
- Memory proposals do not enter Agent 1010 context until approved.`;

  return [
    systemNote("00_System/Brain_Architecture.md", "Brain Architecture", "Argentum Brain v2 is a schema-versioned local Obsidian vault. Canonical entities live in one home each. Manifests, search indexes, and validation reports are generated by Argentum OS."),
    systemNote("00_System/Taxonomy.md", "Taxonomy", taxonomyBody),
    systemNote("00_System/Naming_Standard.md", "Naming Standard", namingBody),
    systemNote("00_System/Link_Policy.md", "Link Policy", linkPolicyBody),
    systemNote("00_System/Memory_Lifecycle.md", "Memory Lifecycle", memoryLifecycleBody),
    systemNote("00_System/Governance/Supervised_Agent_Rules.md", "Supervised Agent Rules", "## Authority\nArgentum agents can investigate, analyze, draft, propose, plan, and prepare local execution.\n\n## Boundary\nHigh-risk actions require Human Gate approval before execution.\n\n## Never\n- Do not store secrets in notes.\n- Do not claim unverified state.\n- Do not bypass Human Gate."),
    systemNote("00_System/Governance/Human_Gate_Rules.md", "Human Gate Rules", "## Approval Required\n- Delete files\n- Post content\n- Send emails\n- Spend money\n- Change system settings\n- Change access permissions\n- Publish externally\n\n## Approval Record\nEvery approval should include request, risk, requested by, created time, operator decision, and outcome."),
    systemNote("00_System/Governance/Secret_Handling_Rules.md", "Secret Handling Rules", "## Rule\nAPI keys, tokens, passwords, session secrets, payment credentials, and private keys must never be stored in Obsidian.\n\n## Storage\nUse Mac Keychain or the local encrypted fallback through Argentum OS settings."),
    systemNote("00_System/Context_Manifests/Agent_1010_Context.md", "Agent 1010 Context Manifest", "## Load Order\n1. Governance - 15%\n2. Identity and authority - 15%\n3. Business - 15%\n4. Office and project - 20%\n5. Task and execution - 20%\n6. Approved memory - 10%\n7. Conversation - 5%\n\n## Exclusions\nArchive, daily notes, raw logs, rejected memory, proposed memory, unapproved tasks, assets, and legacy notes are excluded by default.\n\n## Core Notes\n- [[00_System/Governance/Supervised_Agent_Rules|Supervised Agent Rules]]\n- [[00_System/Governance/Human_Gate_Rules|Human Gate Rules]]\n- [[30_Agents/Agent_1010/_Agent|Agent 1010]]\n- [[10_Businesses/Argentum/_Business|Argentum]]"),
    systemNote("00_System/Architecture/System_Architecture.md", "System Architecture", "```mermaid\nflowchart LR\n  App[\"Argentum OS Mac App\"] --> API[\"Local API\"]\n  API --> DB[\"Local SQLite\"]\n  API --> Vault[\"Obsidian Vault\"]\n  API --> Gate[\"Human Gate\"]\n  API --> Jobs[\"Local Job Runner\"]\n  Jobs --> Agents[\"Agents\"]\n  Agents --> Gate\n  API --> Cloud[\"Optional Cloud APIs\"]\n```\n"),
    systemNote("00_System/Architecture/Vault_Taxonomy.md", "Vault Taxonomy", "```mermaid\nflowchart TD\n  System[\"00 System\"] --> Businesses[\"10 Businesses\"]\n  Businesses --> Offices[\"20 Offices\"]\n  Offices --> Agents[\"30 Agents\"]\n  Agents --> Capabilities[\"40 Capabilities\"]\n  Capabilities --> Operations[\"50 Operations\"]\n  Operations --> Projects[\"60 Projects\"]\n  Projects --> Knowledge[\"70 Knowledge\"]\n  Knowledge --> Memory[\"80 Memory\"]\n  Memory --> Execution[\"90 Execution\"]\n```\n"),
    systemNote("00_System/Architecture/Agent_Context_Flow.md", "Agent Context Flow", "```mermaid\nflowchart LR\n  Request[\"User Request\"] --> Manifest[\"Context Manifest\"]\n  Manifest --> Entities[\"Canonical Entity Manifest\"]\n  Entities --> Approved[\"Approved Memory\"]\n  Approved --> Context[\"Budgeted Agent Context\"]\n  Context --> Agent[\"Agent 1010\"]\n  Agent --> Gate[\"Human Gate if risky\"]\n```\n"),
    systemNote("00_System/Architecture/Memory_Lifecycle.md", "Memory Lifecycle Diagram", "```mermaid\nflowchart LR\n  Inbox[\"Inbox\"] --> Proposed[\"Proposed Memory\"]\n  Proposed --> Approved[\"Approved Memory\"]\n  Proposed --> Rejected[\"Rejected Memory\"]\n  Approved --> Context[\"Agent Context\"]\n  Approved --> Archive[\"Archive\"]\n```\n"),
    systemNote("00_System/Graph_View_Guide.md", "Graph View Guide", "## Default Graph\nShow canonical entities only: businesses, offices, agents, capabilities, workflows, and projects.\n\n## Hide By Default\nTasks, runs, logs, daily notes, assets, legacy files, rejected memory, proposed memory, and archive.\n\n## Goal\nThe graph should reveal operating structure, not every working note."),
    ...Object.keys(ENTITY_CONFIG).map(templateNote),
  ];
}

function ensureDir(vaultPath, relPath) {
  fs.mkdirSync(path.join(normalizeVaultPath(vaultPath), relPath), { recursive: true });
}

function writeJson(vaultPath, relPath, value) {
  const filePath = ensureInsideVault(vaultPath, path.join(normalizeVaultPath(vaultPath), relPath));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return relPath;
}

function readJson(vaultPath, relPath, fallback = null) {
  const filePath = ensureInsideVault(vaultPath, path.join(normalizeVaultPath(vaultPath), relPath));
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeMarkdown(vaultPath, relPath, content, { overwrite = false } = {}) {
  assertSafeContent(content);
  const filePath = ensureInsideVault(vaultPath, path.join(normalizeVaultPath(vaultPath), relPath));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!overwrite && fs.existsSync(filePath)) return relPath;
  fs.writeFileSync(filePath, `${String(content).trim()}\n`);
  return relPath;
}

function listMarkdownFiles(vaultPath, options = {}) {
  const root = normalizeVaultPath(vaultPath);
  if (!fs.existsSync(root)) return [];
  const files = [];
  function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      if (entry.name.startsWith(".")) return;
      const next = path.join(dir, entry.name);
      ensureInsideVault(root, next);
      const rel = path.relative(root, next).replaceAll(path.sep, "/");
      if (entry.isDirectory()) {
        if (!options.includeArchive && rel === "99_Archive") return;
        walk(next);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(next);
      }
    });
  }
  walk(root);
  return files;
}

function relativeNotePath(vaultPath, absolutePath) {
  return path.relative(normalizeVaultPath(vaultPath), absolutePath).replaceAll(path.sep, "/");
}

function noteTitleFromPath(relPath) {
  return path.basename(relPath, ".md").replace(/^_/, "").replaceAll("_", " ");
}

function resolveLegacyPath(vaultPath, legacyPath) {
  const normalized = String(legacyPath || "").replaceAll("\\", "/").replace(/^\/+/, "").replace(/\.md$/i, ".md");
  const dynamicMap = readJson(vaultPath, "00_System/Manifests/legacy-path-map.json", {});
  return dynamicMap[normalized] || LEGACY_PATH_MAP[normalized] || "";
}

function loadEntityManifest(vaultPath) {
  return readJson(vaultPath, "00_System/Manifests/canonical-entities.json", { schemaVersion: SCHEMA_VERSION, entities: [] }) || { schemaVersion: SCHEMA_VERSION, entities: [] };
}

function resolveCanonicalEntity(vaultPath, ref) {
  const value = String(ref || "").trim();
  if (!value) return null;
  const manifest = loadEntityManifest(vaultPath);
  const normalizedPath = value.replaceAll("\\", "/").replace(/^\/+/, "");
  return manifest.entities.find((entity) => {
    return entity.id === value
      || entity.path === normalizedPath
      || entity.title.toLowerCase() === value.toLowerCase()
      || entity.aliases?.some((alias) => String(alias).toLowerCase() === value.toLowerCase());
  }) || null;
}

function notePath(vaultPath, noteRef) {
  const root = normalizeVaultPath(vaultPath);
  const entity = resolveCanonicalEntity(root, noteRef);
  if (entity) return ensureInsideVault(root, path.join(root, entity.path));
  const index = readJson(root, "00_System/Manifests/search-index.json", null);
  const indexed = index?.notes?.find((note) => note.id === noteRef || note.path === noteRef);
  if (indexed) return ensureInsideVault(root, path.join(root, indexed.path));
  const legacy = resolveLegacyPath(root, noteRef);
  if (legacy) return ensureInsideVault(root, path.join(root, legacy));
  const raw = String(noteRef || "").trim().replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].split("#")[0];
  const withExt = raw.endsWith(".md") ? raw : `${raw}.md`;
  const direct = ensureInsideVault(root, path.join(root, withExt));
  if (fs.existsSync(direct)) return direct;
  const basename = path.basename(withExt);
  const match = listMarkdownFiles(root, { includeArchive: true }).find((file) => path.basename(file) === basename);
  return match || direct;
}

function readNote(vaultPath, noteRef) {
  const filePath = notePath(vaultPath, noteRef);
  ensureInsideVault(vaultPath, filePath);
  if (!fs.existsSync(filePath)) {
    const error = new Error("Obsidian note not found.");
    error.status = 404;
    throw error;
  }
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_NOTE_BYTES) {
    const error = new Error("Obsidian note is too large for safe agent context.");
    error.status = 413;
    throw error;
  }
  const content = fs.readFileSync(filePath, "utf8");
  const parsed = parseFrontmatter(content);
  return {
    path: relativeNotePath(vaultPath, filePath),
    title: parsed.data.title || path.basename(filePath, ".md"),
    frontmatter: parsed.data,
    content,
    body: parsed.body,
    updatedAt: stat.mtime.toISOString(),
  };
}

function writeNote(vaultPath, noteRef, content, options = {}) {
  assertSafeContent(content);
  const filePath = notePath(vaultPath, noteRef);
  ensureInsideVault(vaultPath, filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath) && !options.overwrite) {
    return appendNote(vaultPath, noteRef, content, { heading: options.heading || "Updates" });
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > MAX_NOTE_BYTES && !options.approvedLargeOverwrite) {
    const error = new Error("Large note overwrite requires Human Gate approval.");
    error.status = 409;
    throw error;
  }
  fs.writeFileSync(filePath, `${String(content).trim()}\n`);
  rebuildIndexes(vaultPath);
  return readNote(vaultPath, noteRef);
}

function appendNote(vaultPath, noteRef, content, options = {}) {
  assertSafeContent(content);
  const filePath = notePath(vaultPath, noteRef);
  ensureInsideVault(vaultPath, filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const heading = String(options.heading || "").trim();
  const prefix = fs.existsSync(filePath) ? "\n" : frontmatter(canonicalFields({
    id: `note.${slugId(path.basename(filePath, ".md"))}`,
    type: "note",
    title: noteTitleFromPath(filePath),
    status: "draft",
    canonical: false,
    confidence: 0,
  }));
  const section = `${prefix}${heading ? `\n## ${heading}\n` : "\n"}${String(content).trim()}\n`;
  fs.appendFileSync(filePath, section);
  rebuildIndexes(vaultPath);
  return readNote(vaultPath, noteRef);
}

function createNote(vaultPath, relPath, content, options = {}) {
  const filePath = notePath(vaultPath, relPath);
  ensureInsideVault(vaultPath, filePath);
  if (fs.existsSync(filePath)) {
    if (options.appendIfExists !== false) return appendNote(vaultPath, relPath, content, { heading: options.heading || "Updates" });
    const error = new Error("Obsidian note already exists. Append to it instead of creating a duplicate.");
    error.status = 409;
    throw error;
  }
  return writeNote(vaultPath, relPath, content, { overwrite: true });
}

function resolveWikiLinks(content) {
  const links = new Set();
  const pattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  let match;
  while ((match = pattern.exec(String(content || "")))) links.add(match[1].trim());
  return Array.from(links);
}

function resolveWikilink(vaultPath, linkRef) {
  const root = normalizeVaultPath(vaultPath);
  const raw = String(linkRef || "").trim().replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].split("#")[0];
  if (!raw) return null;
  const directRel = raw.endsWith(".md") ? raw : `${raw}.md`;
  const direct = path.join(root, directRel);
  if (!path.relative(root, direct).startsWith("..") && fs.existsSync(direct)) return readNote(root, directRel);
  const manifestEntity = resolveCanonicalEntity(root, raw);
  if (manifestEntity) return readNote(root, manifestEntity.path);
  const basename = path.basename(directRel);
  const match = listMarkdownFiles(root, { includeArchive: true }).find((filePath) => path.basename(filePath) === basename || path.basename(filePath, ".md") === raw);
  return match ? readNote(root, relativeNotePath(root, match)) : null;
}

function backupVault(vaultPath) {
  const root = normalizeVaultPath(vaultPath);
  if (!fs.existsSync(root)) return { created: false, backupPath: "" };
  const backupPath = `${root}.backup-${timestampSlug()}`;
  fs.cpSync(root, backupPath, { recursive: true, errorOnExist: true });
  return { created: true, backupPath };
}

function hasCanonicalSchema(vaultPath) {
  return fs.existsSync(path.join(normalizeVaultPath(vaultPath), "00_System", "Manifests", "vault-schema.json"));
}

function hasLegacyStructure(vaultPath) {
  const root = normalizeVaultPath(vaultPath);
  return ["01_Businesses", "02_Agents", "03_Skills", "04_Workflows", "05_Memory", "06_Daily_Notes", "07_Archive"].some((dir) => fs.existsSync(path.join(root, dir)));
}

function seedVault(vaultPath, options = {}) {
  const root = normalizeVaultPath(vaultPath);
  fs.mkdirSync(root, { recursive: true });
  REQUIRED_DIRS.forEach((dir) => ensureDir(root, dir));
  requiredSystemNotes().forEach((note) => writeMarkdown(root, note.relPath, note.content, { overwrite: note.overwrite }));
  CANONICAL_ENTITIES.forEach((entity) => {
    const note = entityNote(entity);
    writeMarkdown(root, note.relPath, note.content, { overwrite: options.overwriteCanonical === true });
  });
  writeJson(root, "00_System/Manifests/vault-schema.json", {
    schemaVersion: SCHEMA_VERSION,
    initializedAt: options.initializedAt || now(),
    updatedAt: now(),
    canonicalRoots: REQUIRED_DIRS.filter((dir) => /^\d{2}_/.test(dir) && !dir.includes("/")),
  });
  writeJson(root, "00_System/Manifests/legacy-path-map.json", LEGACY_PATH_MAP);
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function migrationPlan(vaultPath) {
  const root = normalizeVaultPath(vaultPath);
  const files = fs.existsSync(root) ? listMarkdownFiles(root, { includeArchive: true }).map((filePath) => relativeNotePath(root, filePath)) : [];
  const actions = files
    .filter((relPath) => /^(00_System\/Argentum_Index|01_Businesses|02_Agents|03_Skills|04_Workflows|05_Memory|06_Daily_Notes|07_Archive)/.test(relPath))
    .map((relPath) => ({
      from: relPath,
      to: LEGACY_PATH_MAP[relPath] || LEGACY_PATH_MAP[relPath.replace(/\/[^/]+\.md$/, "")] || `99_Archive/Legacy/${relPath}`,
      hash: fs.existsSync(path.join(root, relPath)) ? hashFile(path.join(root, relPath)) : "",
      action: LEGACY_PATH_MAP[relPath] ? "merge" : "archive",
    }));
  return { schemaVersion: SCHEMA_VERSION, vaultPath: root, generatedAt: now(), actions, legacyPathMap: LEGACY_PATH_MAP };
}

function appendLegacySection(vaultPath, destRelPath, sourceRelPath, content) {
  const filePath = path.join(normalizeVaultPath(vaultPath), destRelPath);
  const parsed = parseFrontmatter(content);
  const legacyBody = parsed.body.trim();
  if (!legacyBody) return;
  if (!fs.existsSync(filePath)) {
    const type = destRelPath.startsWith("80_Memory/") ? "memory" : destRelPath.startsWith("90_Execution/Decisions/") ? "decision" : "note";
    writeMarkdown(vaultPath, destRelPath, md(destRelPath, canonicalFields({
      id: `${type}.imported.${slugId(sourceRelPath)}`,
      type,
      title: titleFromSegment(path.basename(destRelPath, ".md")),
      status: "imported",
      canonical: false,
      tags: ["legacy-import"],
      source: sourceRelPath,
      confidence: 0.5,
    }), `## Legacy import from ${sourceRelPath}\n\n${legacyBody}`), { overwrite: false });
    return;
  }
  const current = fs.readFileSync(filePath, "utf8");
  if (current.includes(`Legacy import from ${sourceRelPath}`)) return;
  fs.appendFileSync(filePath, `\n## Legacy import from ${sourceRelPath}\n\n${legacyBody}\n`);
}

function archiveLegacyRoots(vaultPath) {
  const root = normalizeVaultPath(vaultPath);
  const archiveRoot = path.join(root, "99_Archive", "Legacy", timestampSlug());
  const moved = [];
  ["01_Businesses", "02_Agents", "03_Skills", "04_Workflows", "05_Memory", "06_Daily_Notes", "07_Archive"].forEach((dir) => {
    const source = path.join(root, dir);
    if (!fs.existsSync(source)) return;
    fs.mkdirSync(archiveRoot, { recursive: true });
    const target = path.join(archiveRoot, dir);
    fs.renameSync(source, target);
    moved.push({ from: dir, to: relativeNotePath(root, target) });
  });
  return moved;
}

function migrateLegacyVault(vaultPath = defaultVaultPath(), options = {}) {
  const root = normalizeVaultPath(vaultPath);
  const plan = migrationPlan(root);
  if (options.dryRun) return { dryRun: true, ...plan };
  const backup = fs.existsSync(root) ? backupVault(root) : { created: false, backupPath: "" };
  const legacyFiles = fs.existsSync(root) ? listMarkdownFiles(root, { includeArchive: true }).map((filePath) => relativeNotePath(root, filePath)) : [];
  seedVault(root, { initializedAt: now() });
  legacyFiles.forEach((relPath) => {
    const sourcePath = path.join(root, relPath);
    if (!fs.existsSync(sourcePath)) return;
    const destination = LEGACY_PATH_MAP[relPath];
    if (!destination) return;
    appendLegacySection(root, destination, relPath, fs.readFileSync(sourcePath, "utf8"));
  });
  const movedLegacyRoots = archiveLegacyRoots(root);
  const report = migrationReportMarkdown(root, {
    mode: "migration",
    backupPath: backup.backupPath,
    plannedActions: plan.actions.length,
    movedLegacyRoots,
    notes: "Legacy content was merged into canonical homes where mapped. Original legacy folders were moved under 99_Archive/Legacy after backup.",
  });
  writeMarkdown(root, "00_System/Migration_Report.md", report, { overwrite: true });
  writeJson(root, "00_System/Manifests/legacy-path-map.json", LEGACY_PATH_MAP);
  rebuildIndexes(root);
  const validation = validateVault(root);
  return { ...getVaultStatus(root), backupPath: backup.backupPath, migration: plan, validation };
}

function migrationReportMarkdown(vaultPath, data = {}) {
  const fields = canonicalFields({
    id: "system.migration-report",
    type: "system",
    title: "Migration Report",
    status: "active",
    canonical: false,
    tags: ["system", "migration"],
    confidence: 1,
  });
  return `${frontmatter(fields)}# Migration Report

## Summary
- Schema version: ${SCHEMA_VERSION}
- Mode: ${data.mode || "initialization"}
- Vault path: ${normalizeVaultPath(vaultPath)}
- Backup path: ${data.backupPath || "No prior vault backup required"}
- Planned actions: ${data.plannedActions ?? 0}
- Generated: ${now()}

## Result
${data.notes || "No legacy vault existed. Argentum created a clean canonical v2 vault."}

## Legacy Root Moves
${(data.movedLegacyRoots || []).map((item) => `- ${item.from} -> ${item.to}`).join("\n") || "- None"}
`;
}

function initializeVault(vaultPath = defaultVaultPath(), options = {}) {
  const root = normalizeVaultPath(vaultPath);
  const existed = fs.existsSync(root);
  if (existed && hasLegacyStructure(root) && !hasCanonicalSchema(root) && options.skipMigration !== true) {
    return migrateLegacyVault(root, { dryRun: false });
  }
  let backup = { created: false, backupPath: "" };
  if (existed && !hasCanonicalSchema(root) && options.backupExisting !== false) backup = backupVault(root);
  seedVault(root, { initializedAt: now() });
  if (!fs.existsSync(path.join(root, "00_System", "Migration_Report.md")) || backup.created || !existed) {
    writeMarkdown(root, "00_System/Migration_Report.md", migrationReportMarkdown(root, {
      mode: existed ? "canonical initialization" : "new vault",
      backupPath: backup.backupPath,
      notes: existed ? "Existing vault files were preserved. Canonical Argentum Brain v2 structure was added." : "No prior vault existed. Argentum created a clean canonical v2 vault.",
    }), { overwrite: true });
  }
  rebuildIndexes(root);
  validateVault(root);
  return getVaultStatus(root);
}

function loadVaultSchema(vaultPath) {
  return readJson(vaultPath, "00_System/Manifests/vault-schema.json", null);
}

function markdownHeadings(body) {
  return String(body || "")
    .split("\n")
    .filter((line) => /^#{1,4}\s+/.test(line))
    .map((line) => line.replace(/^#{1,4}\s+/, "").trim());
}

function canonicalEntityFromNote(vaultPath, relPath, note) {
  const fm = note.frontmatter || {};
  return {
    id: fm.id,
    type: fm.type,
    title: fm.title || note.title,
    path: relPath,
    status: fm.status || "draft",
    canonical: Boolean(fm.canonical),
    owner: fm.owner || "",
    business: fm.business || "",
    office: fm.office || "",
    agent: fm.agent || "",
    parent: fm.parent || "",
    aliases: Array.isArray(fm.aliases) ? fm.aliases : [],
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    source: fm.source || "",
    confidence: Number(fm.confidence) || 0,
    updated: fm.updated || note.updatedAt,
  };
}

function rebuildEntityManifest(vaultPath) {
  const root = normalizeVaultPath(vaultPath);
  const entities = listMarkdownFiles(root, { includeArchive: false })
    .map((filePath) => {
      const relPath = relativeNotePath(root, filePath);
      const note = readNote(root, relPath);
      return canonicalEntityFromNote(root, relPath, note);
    })
    .filter((entity) => entity.canonical === true && entity.id && entity.type)
    .sort((a, b) => `${a.type}:${a.title}`.localeCompare(`${b.type}:${b.title}`));
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: now(),
    count: entities.length,
    entities,
  };
  writeJson(root, "00_System/Manifests/canonical-entities.json", manifest);
  return manifest;
}

function rebuildSearchIndex(vaultPath) {
  const root = normalizeVaultPath(vaultPath);
  const notes = listMarkdownFiles(root, { includeArchive: true }).map((filePath) => {
    const relPath = relativeNotePath(root, filePath);
    const note = readNote(root, relPath);
    const parsed = parseFrontmatter(note.content);
    return {
      id: parsed.data.id || "",
      type: parsed.data.type || "note",
      title: parsed.data.title || note.title,
      path: relPath,
      aliases: parsed.data.aliases || [],
      status: parsed.data.status || "",
      canonical: Boolean(parsed.data.canonical),
      business: parsed.data.business || "",
      office: parsed.data.office || "",
      agent: parsed.data.agent || "",
      project: parsed.data.project || "",
      review_due: parsed.data.review_due || "",
      expiresAt: parsed.data.expiresAt || parsed.data.expires_at || "",
      supersedes: parsed.data.supersedes || "",
      supersededBy: parsed.data.supersededBy || parsed.data.superseded_by || "",
      tags: parsed.data.tags || [],
      headings: markdownHeadings(parsed.body),
      content: parsed.body.replace(/\s+/g, " ").slice(0, 20000),
      updated: parsed.data.updated || note.updatedAt,
      confidence: Number(parsed.data.confidence) || 0,
      hash: hashFile(filePath),
    };
  });
  const index = { schemaVersion: SCHEMA_VERSION, generatedAt: now(), count: notes.length, notes };
  writeJson(root, "00_System/Manifests/search-index.json", index);
  return index;
}

function groupEntitiesByType(entities) {
  return entities.reduce((groups, entity) => {
    groups[entity.type] = groups[entity.type] || [];
    groups[entity.type].push(entity);
    return groups;
  }, {});
}

function entityLink(entity) {
  return `[[${entity.path.replace(/\.md$/, "")}|${entity.title}]]`;
}

function indexMarkdown(relPath, title, body) {
  return md(relPath, canonicalFields({
    id: `index.${slugId(title)}`,
    type: "index",
    title,
    status: "active",
    canonical: false,
    tags: ["index"],
    confidence: 1,
  }), body);
}

function writeIndexes(vaultPath, manifest, searchIndex) {
  const grouped = groupEntitiesByType(manifest.entities);
  const allLines = (type) => (grouped[type] || []).map((entity) => `- ${entityLink(entity)} - ${entity.status}`).join("\n") || "- No canonical records yet.";
  const indexSpecs = [
    ["10_Businesses/_Businesses_Index.md", "Businesses Index", allLines("business")],
    ["20_Offices/_Offices_Index.md", "Offices Index", allLines("office")],
    ["30_Agents/_Agents_Index.md", "Agents Index", allLines("agent")],
    ["40_Capabilities/_Capabilities_Index.md", "Capabilities Index", ["skill", "tool", "integration"].map((type) => `## ${ENTITY_CONFIG[type].typeLabel}s\n${allLines(type)}`).join("\n\n")],
    ["40_Capabilities/Skills/_Skills_Index.md", "Skills Index", allLines("skill")],
    ["40_Capabilities/Tools/_Tools_Index.md", "Tools Index", allLines("tool")],
    ["40_Capabilities/Integrations/_Integrations_Index.md", "Integrations Index", allLines("integration")],
    ["50_Operations/_Operations_Index.md", "Operations Index", ["workflow", "runbook"].map((type) => `## ${ENTITY_CONFIG[type].typeLabel}s\n${allLines(type)}`).join("\n\n")],
    ["50_Operations/Workflows/_Workflows_Index.md", "Workflows Index", allLines("workflow")],
    ["50_Operations/Runbooks/_Runbooks_Index.md", "Runbooks Index", allLines("runbook")],
    ["50_Operations/Human_Gate/_Human_Gate_Index.md", "Human Gate Index", "- [[50_Operations/Workflows/Human_Gate_Workflow|Human Gate Workflow]]\n- [[00_System/Governance/Human_Gate_Rules|Human Gate Rules]]"],
    ["60_Projects/_Projects_Index.md", "Projects Index", allLines("project")],
    ["70_Knowledge/_Knowledge_Index.md", "Knowledge Index", allLines("knowledge")],
    ["80_Memory/_Memory_Index.md", "Memory Index", "## Approved Memory\n" + allLines("memory") + "\n\n## Proposed Memory\nStored under `80_Memory/Proposed` until approved."],
    ["90_Execution/_Execution_Index.md", "Execution Index", ["decision", "task", "run"].map((type) => `## ${ENTITY_CONFIG[type].typeLabel}s\n${allLines(type)}`).join("\n\n")],
    ["90_Execution/Decisions/_Decisions_Index.md", "Decisions Index", allLines("decision")],
    ["90_Execution/Tasks/_Tasks_Index.md", "Tasks Index", allLines("task")],
    ["90_Execution/Runs/_Runs_Index.md", "Runs Index", allLines("run")],
    ["90_Execution/Daily_Notes/_Daily_Notes_Index.md", "Daily Notes Index", "Daily notes are execution logs. They are excluded from Agent 1010 context by default."],
    ["95_Inbox/_Inbox_Index.md", "Inbox Index", "Untriaged notes land here before canonical routing."],
    ["95_Inbox/Memory_Proposals/_Memory_Proposals_Index.md", "Memory Proposals Index", "Memory proposals wait here until operator approval. They are not authoritative context."],
    ["98_Assets/_Assets_Index.md", "Assets Index", "Images, exports, media, and non-note files live here."],
    ["99_Archive/_Archive_Index.md", "Archive Index", "Archived and legacy notes are preserved but excluded from default context and graph views."],
  ];
  indexSpecs.forEach(([relPath, title, body]) => writeMarkdown(vaultPath, relPath, indexMarkdown(relPath, title, body), { overwrite: true }));
  writeMarkdown(vaultPath, "00_System/Argentum_Brain_Home.md", buildHomeNote(vaultPath, manifest, searchIndex), { overwrite: true });
}

function buildHomeNote(vaultPath, manifest, searchIndex) {
  const grouped = groupEntitiesByType(manifest.entities);
  const count = (type) => (grouped[type] || []).length;
  const body = `## Current Status
- Schema version: ${SCHEMA_VERSION}
- Notes indexed: ${searchIndex.count}
- Canonical entities: ${manifest.count}
- Businesses: ${count("business")}
- Offices: ${count("office")}
- Agents: ${count("agent")}
- Workflows: ${count("workflow")}
- Approved memory: ${count("memory")}

## Operating Hubs
- [[10_Businesses/_Businesses_Index|Businesses]]
- [[20_Offices/_Offices_Index|Offices]]
- [[30_Agents/_Agents_Index|Agents]]
- [[40_Capabilities/_Capabilities_Index|Capabilities]]
- [[50_Operations/_Operations_Index|Operations]]
- [[80_Memory/_Memory_Index|Memory]]

## Primary Agent
- [[30_Agents/Agent_1010/_Agent|Agent 1010]]
`;
  return md("00_System/Argentum_Brain_Home.md", canonicalFields({
    id: "system.argentum-brain-home",
    type: "system",
    title: "Argentum Brain Home",
    status: "active",
    canonical: false,
    tags: ["system", "home"],
    confidence: 1,
  }), body);
}

function rebuildIndexes(vaultPath) {
  const root = normalizeVaultPath(vaultPath);
  const manifest = rebuildEntityManifest(root);
  const searchIndex = rebuildSearchIndex(root);
  writeIndexes(root, manifest, searchIndex);
  const refreshedManifest = rebuildEntityManifest(root);
  const refreshedSearch = rebuildSearchIndex(root);
  return { manifest: refreshedManifest, searchIndex: refreshedSearch };
}

function validateVault(vaultPath, options = {}) {
  const root = normalizeVaultPath(vaultPath);
  const issues = [];
  if (!fs.existsSync(root)) {
    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: now(),
      healthy: false,
      issues: [{ severity: "critical", code: "vault_missing", message: "Vault path does not exist.", path: root }],
      counts: { notes: 0, canonicalEntities: 0, brokenLinks: 0, duplicateIds: 0, orphanNotes: 0, pendingMemory: 0 },
    };
  }
  REQUIRED_DIRS.forEach((dir) => {
    if (!fs.existsSync(path.join(root, dir))) issues.push({ severity: "error", code: "missing_dir", message: `Missing required folder ${dir}.`, path: dir });
  });
  CORE_SYSTEM_FILES.forEach((relPath) => {
    if (!fs.existsSync(path.join(root, relPath))) issues.push({ severity: "error", code: "missing_file", message: `Missing required note ${relPath}.`, path: relPath });
  });
  const files = listMarkdownFiles(root, { includeArchive: false });
  const ids = new Map();
  const hashes = new Map();
  let brokenLinks = 0;
  let orphanNotes = 0;
  let pendingMemory = 0;
  files.forEach((filePath) => {
    const relPath = relativeNotePath(root, filePath);
    const content = fs.readFileSync(filePath, "utf8");
    const parsed = parseFrontmatter(content);
    if (!parsed.hasFrontmatter) {
      issues.push({ severity: "error", code: "frontmatter_missing", message: "Missing YAML frontmatter.", path: relPath });
      return;
    }
    REQUIRED_FRONTMATTER_FIELDS.forEach((field) => {
      if (!(field in parsed.data)) issues.push({ severity: "error", code: "frontmatter_field_missing", message: `Missing frontmatter field ${field}.`, path: relPath });
    });
    if (parsed.data.status === "proposed" || relPath.startsWith("80_Memory/Proposed/")) pendingMemory += 1;
    const id = String(parsed.data.id || "");
    if (id) {
      if (ids.has(id)) issues.push({ severity: "error", code: "duplicate_id", message: `Duplicate id ${id}.`, path: relPath, duplicateOf: ids.get(id) });
      ids.set(id, relPath);
    }
    const hash = crypto.createHash("sha256").update(parsed.body.replace(/\s+/g, " ").trim()).digest("hex");
    if (hashes.has(hash) && parsed.body.trim().length > 120) issues.push({ severity: "warning", code: "duplicate_content", message: "Possible exact duplicate content.", path: relPath, duplicateOf: hashes.get(hash) });
    hashes.set(hash, relPath);
    resolveWikiLinks(content).forEach((link) => {
      if (!resolveWikilink(root, link)) {
        brokenLinks += 1;
        issues.push({ severity: "warning", code: "broken_wikilink", message: `Unresolved wikilink ${link}.`, path: relPath });
      }
    });
  });
  const manifest = loadEntityManifest(root);
  const linkedTargets = new Set();
  files.forEach((filePath) => {
    const content = fs.readFileSync(filePath, "utf8");
    resolveWikiLinks(content).forEach((link) => {
      const resolved = resolveWikilink(root, link);
      if (resolved) linkedTargets.add(resolved.path);
    });
  });
  manifest.entities.forEach((entity) => {
    if (entity.type !== "business" && entity.path && !linkedTargets.has(entity.path)) orphanNotes += 1;
  });
  const errorCount = issues.filter((issue) => issue.severity === "critical" || issue.severity === "error").length;
  const report = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: now(),
    healthy: errorCount === 0,
    issues,
    counts: {
      notes: files.length,
      canonicalEntities: manifest.entities.length || Array.from(ids.keys()).filter((id) => !id.startsWith("index.") && !id.startsWith("system.")).length,
      brokenLinks,
      duplicateIds: issues.filter((issue) => issue.code === "duplicate_id").length,
      orphanNotes,
      pendingMemory,
    },
  };
  if (options.writeReport !== false) writeJson(root, "00_System/Manifests/validation-report.json", report);
  writeMarkdown(root, "00_System/Brain_Status.md", buildBrainStatusNote(root, report), { overwrite: true });
  return report;
}

function buildBrainStatusNote(vaultPath, validation) {
  const counts = validation.counts || {};
  const body = `## Validation
- Status: ${validation.healthy ? "Healthy" : "Needs Repair"}
- Last validation: ${validation.generatedAt}
- Notes: ${counts.notes || 0}
- Canonical entities: ${counts.canonicalEntities || 0}
- Broken links: ${counts.brokenLinks || 0}
- Duplicate IDs: ${counts.duplicateIds || 0}
- Orphans: ${counts.orphanNotes || 0}
- Pending memory: ${counts.pendingMemory || 0}

## Issues
${validation.issues.length ? validation.issues.slice(0, 25).map((issue) => `- ${issue.severity.toUpperCase()} ${issue.code}: ${issue.path} - ${issue.message}`).join("\n") : "- No blocking validation issues."}
`;
  return md("00_System/Brain_Status.md", canonicalFields({
    id: "system.brain-status",
    type: "system",
    title: "Brain Status",
    status: validation.healthy ? "active" : "needs_review",
    canonical: false,
    tags: ["system", "status"],
    confidence: validation.healthy ? 1 : 0.5,
  }), body);
}

function getVaultStatus(vaultPath) {
  const root = normalizeVaultPath(vaultPath);
  if (!vaultPath) return { status: "Missing", connected: false, vaultPath: "", schemaVersion: SCHEMA_VERSION, initialized: false, missing: ["vault_path"] };
  if (!fs.existsSync(root)) return { status: "Missing", connected: false, vaultPath: root, schemaVersion: SCHEMA_VERSION, initialized: false, missing: [VAULT_NAME] };
  try {
    fs.accessSync(root, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    return { status: "Permission Error", connected: false, vaultPath: root, schemaVersion: SCHEMA_VERSION, initialized: false, missing: [] };
  }
  const schema = loadVaultSchema(root);
  const validation = validateVault(root, { writeReport: true });
  const manifest = loadEntityManifest(root);
  const searchIndex = readJson(root, "00_System/Manifests/search-index.json", { generatedAt: "", count: 0, notes: [] });
  const migrationReport = readNoteIfExists(root, "00_System/Migration_Report.md");
  const missing = [
    ...REQUIRED_DIRS.filter((dir) => !fs.existsSync(path.join(root, dir))),
    ...CORE_SYSTEM_FILES.filter((relPath) => !fs.existsSync(path.join(root, relPath))),
  ];
  const counts = validation.counts || {};
  return {
    status: schema && validation.healthy ? "Healthy" : schema ? "Needs Validation" : "Sync Needed",
    connected: Boolean(schema && validation.healthy),
    initialized: Boolean(schema),
    vaultPath: root,
    schemaVersion: schema?.schemaVersion || SCHEMA_VERSION,
    lastMigration: migrationReport?.updatedAt || "",
    lastValidation: validation.generatedAt || "",
    lastIndexed: searchIndex.generatedAt || "",
    noteCount: counts.notes || searchIndex.count || 0,
    canonicalCount: manifest.entities?.length || 0,
    brokenCount: counts.brokenLinks || 0,
    duplicateCount: counts.duplicateIds || 0,
    orphanCount: counts.orphanNotes || 0,
    pendingCount: counts.pendingMemory || 0,
    counts: {
      notes: counts.notes || searchIndex.count || 0,
      canonical: manifest.entities?.length || 0,
      broken: counts.brokenLinks || 0,
      duplicate: counts.duplicateIds || 0,
      orphan: counts.orphanNotes || 0,
      pending: counts.pendingMemory || 0,
    },
    issueCounts: validation.issues.reduce((acc, issue) => {
      acc[issue.severity] = (acc[issue.severity] || 0) + 1;
      return acc;
    }, {}),
    syncNeeded: missing.length > 0 || !validation.healthy,
    missing,
  };
}

function readNoteIfExists(vaultPath, relPath) {
  try {
    return readNote(vaultPath, relPath);
  } catch {
    return null;
  }
}

function matchSearchNote(note, query, options = {}) {
  const q = String(query || options.q || "").trim().toLowerCase();
  const normalizedQ = q === "agent.agent-1010" ? "agent.1010" : q;
  const reasons = [];
  let score = 0;
  const aliases = Array.isArray(note.aliases) ? note.aliases : [];
  const tags = Array.isArray(note.tags) ? note.tags : [];
  const fields = {
    id: String(note.id || "").toLowerCase(),
    title: String(note.title || "").toLowerCase(),
    path: String(note.path || "").toLowerCase(),
    aliases: aliases.join(" ").toLowerCase(),
    tags: tags.join(" ").toLowerCase(),
    type: String(note.type || "").toLowerCase(),
    status: String(note.status || "").toLowerCase(),
    business: String(note.business || "").toLowerCase(),
    office: String(note.office || "").toLowerCase(),
    agent: String(note.agent || "").toLowerCase(),
    content: String(note.content || "").toLowerCase(),
    headings: (note.headings || []).join(" ").toLowerCase(),
  };
  if (options.id && fields.id === String(options.id).toLowerCase()) { score += 120; reasons.push("exact_id_filter"); }
  if (options.type && fields.type === String(options.type).toLowerCase()) { score += 15; reasons.push("type_filter"); }
  if (options.status && fields.status === String(options.status).toLowerCase()) { score += 15; reasons.push("status_filter"); }
  if (options.business && fields.business === String(options.business).toLowerCase()) { score += 12; reasons.push("business_filter"); }
  if (options.office && fields.office === String(options.office).toLowerCase()) { score += 12; reasons.push("office_filter"); }
  if (options.agent && fields.agent === String(options.agent).toLowerCase()) { score += 12; reasons.push("agent_filter"); }
  if (options.tag && tags.map((tag) => String(tag).toLowerCase()).includes(String(options.tag).toLowerCase())) { score += 10; reasons.push("tag_filter"); }
  if (!q) return { matched: true, score: score + (note.canonical ? 5 : 0), reasons: reasons.length ? reasons : ["unfiltered"] };
  if (fields.id === normalizedQ || fields.id === q) { score += 120; reasons.push("exact_id"); }
  if (fields.title === q) { score += 100; reasons.push("exact_title"); }
  if (aliases.some((alias) => String(alias).toLowerCase() === q)) { score += 95; reasons.push("exact_alias"); }
  if (options.legacyQuery && fields.path === q) { score += 110; reasons.push("legacy_path"); }
  if (fields.path === q || fields.path === `${q}.md`) { score += 90; reasons.push("exact_path"); }
  if (fields.title.includes(q)) { score += 45; reasons.push("title"); }
  if (fields.aliases.includes(q)) { score += 40; reasons.push("alias"); }
  if (fields.tags.includes(q)) { score += 25; reasons.push("tag"); }
  if (fields.headings.includes(q)) { score += 20; reasons.push("heading"); }
  if (fields.content.includes(q)) { score += 10; reasons.push("full_text"); }
  if (fields.path.includes(q)) { score += 8; reasons.push("path"); }
  return { matched: score > 0, score: score + (note.canonical ? 5 : 0), reasons };
}

function isExpired(note) {
  const reviewDue = note.review_due || note.reviewDue || "";
  const expiresAt = note.expiresAt || note.expires_at || "";
  const candidate = expiresAt || "";
  return candidate ? Date.parse(candidate) < Date.now() : false;
}

function defaultSearchExcluded(note, options = {}) {
  if (options.includeArchive !== true && String(note.path || "").startsWith("99_Archive/")) return "archived";
  if (options.includeRejected !== true && String(note.status || "").toLowerCase() === "rejected") return "rejected";
  if (options.includeSuperseded !== true && String(note.status || "").toLowerCase() === "superseded") return "superseded";
  if (options.includeExpired !== true && isExpired(note)) return "expired";
  if (options.includeWorking !== true && /^90_Execution\/(Logs|Daily_Notes|Runs)\//.test(String(note.path || ""))) return "execution_log";
  if (options.includeDraft !== true && String(note.type || "") === "memory" && ["draft", "proposed", "pending_review"].includes(String(note.status || "").toLowerCase())) return "draft_not_authoritative";
  return "";
}

function searchVault(vaultPath, query = "", options = {}) {
  const root = normalizeVaultPath(vaultPath);
  const limit = Math.max(1, Math.min(100, Number(options.limit) || 20));
  const index = readJson(root, "00_System/Manifests/search-index.json", null) || rebuildSearchIndex(root);
  const rawQuery = String(query || options.q || "").trim();
  const legacyTarget = rawQuery ? resolveLegacyPath(root, rawQuery) : "";
  const effectiveQuery = legacyTarget || query;
  const searchOptions = legacyTarget ? { ...options, legacyQuery: rawQuery } : options;
  return index.notes
    .filter((note) => !defaultSearchExcluded(note, options))
    .filter((note) => !options.type || note.type === options.type)
    .filter((note) => !options.status || note.status === options.status)
    .filter((note) => !options.business || note.business === options.business)
    .filter((note) => !options.office || note.office === options.office)
    .filter((note) => !options.agent || note.agent === options.agent)
    .filter((note) => !options.tag || (note.tags || []).includes(options.tag))
    .map((note) => ({ note, match: matchSearchNote(note, effectiveQuery, searchOptions) }))
    .filter((item) => item.match.matched)
    .sort((a, b) => b.match.score - a.match.score || Number(b.note.canonical) - Number(a.note.canonical) || String(b.note.updated).localeCompare(String(a.note.updated)))
    .slice(0, limit)
    .map(({ note, match }) => ({
      id: note.id,
      type: note.type,
      title: note.title,
      path: note.path,
      status: note.status,
      canonical: note.canonical,
      tags: note.tags,
      confidence: note.confidence,
      snippet: note.content.slice(0, 260),
      excerpt: note.content.slice(0, 260),
      updatedAt: note.updated,
      score: match.score,
      whyMatched: match.reasons,
    }));
}

function searchByType(vaultPath, type, options = {}) {
  return searchVault(vaultPath, options.query || "", { ...options, type });
}

function canonicalPathForPayload(payload = {}) {
  const type = String(payload.type || "").toLowerCase();
  const title = String(payload.title || payload.name || "").trim();
  const config = ENTITY_CONFIG[type];
  if (!config) {
    const error = new Error("Unsupported canonical note type.");
    error.status = 400;
    throw error;
  }
  if (!title) {
    const error = new Error("Canonical note title is required.");
    error.status = 400;
    throw error;
  }
  const segment = fileSegment(title);
  if (config.fileName) return `${config.root}/${segment}/${config.fileName}`;
  return `${config.root}/${segment}.md`;
}

function entityBodyFromPayload(type, title, data = {}) {
  const sections = [
    "## Overview",
    data.overview || "TODO - operator input required.",
    "",
    "## Current Status",
    data.currentStatus || data.statusText || "TODO - operator input required.",
    "",
  ];
  if (type === "agent") sections.push("## Authority", data.authority || "Draft, investigate, analyze, plan, and prepare actions. Human Gate required for high-risk execution.", "");
  if (type === "office") sections.push("## Operating Metrics", data.metrics || "TODO - define active streams, queue, failures, success rate, owner, and escalation path.", "");
  if (type === "workflow") sections.push("## Steps", data.steps || "1. TODO - define repeatable operating steps.", "");
  if (type === "project") sections.push("## Target Outcome", data.outcome || "TODO - define target outcome, owner, deadline, and risks.", "");
  if (type === "memory") sections.push("## Memory", data.memory || data.content || "TODO - approved memory content required.", "");
  sections.push("## Links", data.links || "", "", "## Notes", data.notes || "");
  return sections.join("\n").trim();
}

function createCanonicalNote(vaultPath, payload = {}) {
  const root = normalizeVaultPath(vaultPath);
  const type = String(payload.type || "").toLowerCase();
  const title = String(payload.title || payload.name || "").trim();
  const relPath = canonicalPathForPayload({ type, title });
  const id = payload.id || payload.data?.id || stableId(type, title);
  const manifest = loadEntityManifest(root);
  const duplicate = manifest.entities.find((entity) => entity.id === id || entity.path === relPath || (entity.type === type && entity.title.toLowerCase() === title.toLowerCase()));
  if (duplicate || fs.existsSync(path.join(root, relPath))) {
    const error = new Error(`Canonical ${type} already exists: ${duplicate?.path || relPath}`);
    error.status = 409;
    throw error;
  }
  const fields = canonicalFields({
    id,
    type,
    title,
    status: payload.status || payload.data?.status || "draft",
    canonical: true,
    owner: payload.owner || payload.data?.owner || "Agent 1010",
    business: payload.businessId || payload.business || payload.data?.business || "",
    office: payload.officeId || payload.office || payload.data?.office || "",
    agent: payload.agentId || payload.agent || payload.data?.agent || "",
    parent: payload.parentId || payload.parent || payload.data?.parent || "",
    aliases: payload.aliases || payload.data?.aliases || [],
    tags: payload.tags || payload.data?.tags || [type],
    source: payload.source || payload.data?.source || "Argentum OS create route",
    confidence: payload.confidence ?? payload.data?.confidence ?? 0,
  });
  writeMarkdown(root, relPath, md(relPath, fields, payload.content || entityBodyFromPayload(type, title, payload.data || {})), { overwrite: false });
  rebuildIndexes(root);
  validateVault(root);
  return readNote(root, relPath);
}

function updateCanonicalNote(vaultPath, ref, updates = {}) {
  const root = normalizeVaultPath(vaultPath);
  const entity = resolveCanonicalEntity(root, ref);
  if (!entity) {
    const error = new Error("Canonical entity not found.");
    error.status = 404;
    throw error;
  }
  const note = readNote(root, entity.path);
  const parsed = parseFrontmatter(note.content);
  const nextFields = { ...parsed.data, ...updates.frontmatter, updated: now() };
  const nextBody = updates.body !== undefined ? String(updates.body) : parsed.body;
  writeMarkdown(root, entity.path, `${frontmatter(nextFields)}${nextBody.trim()}\n`, { overwrite: true });
  rebuildIndexes(root);
  validateVault(root);
  return readNote(root, entity.path);
}

function createTypedNote(vaultPath, payload = {}) {
  return createCanonicalNote(vaultPath, {
    ...payload,
    title: payload.title || payload.name,
    data: payload.data || {},
  });
}

function recentDailyNotes(vaultPath, limit = 7) {
  const dailyDir = path.join(normalizeVaultPath(vaultPath), "90_Execution", "Daily_Notes");
  if (!fs.existsSync(dailyDir)) return [];
  return fs.readdirSync(dailyDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
    .sort()
    .reverse()
    .slice(0, limit)
    .map((name) => readNote(vaultPath, `90_Execution/Daily_Notes/${name}`));
}

function createOrUpdateDailyNote(vaultPath, payload = {}) {
  const date = String(payload.date || new Date().toISOString().slice(0, 10));
  const relPath = `90_Execution/Daily_Notes/${date}.md`;
  const root = normalizeVaultPath(vaultPath);
  if (!fs.existsSync(path.join(root, relPath))) {
    const content = md(relPath, canonicalFields({
      id: `daily.${date}`,
      type: "daily_note",
      title: `Daily Note ${date}`,
      status: "active",
      canonical: false,
      tags: ["daily-note"],
      confidence: 1,
    }), "## Completed\n\n## Decisions\n\n## Errors / Blockers\n\n## Lessons\n\n## Next Steps\n");
    writeMarkdown(root, relPath, content, { overwrite: false });
  }
  const lines = [];
  if (payload.completed) lines.push(`- Completed: ${payload.completed}`);
  if (payload.decision) lines.push(`- Decision: ${payload.decision}`);
  if (payload.error) lines.push(`- Error/Blocker: ${payload.error}`);
  if (payload.lesson) lines.push(`- Lesson: ${payload.lesson}`);
  if (payload.next) lines.push(`- Next: ${payload.next}`);
  const linked = Object.values(payload.links || {}).filter(Boolean).map((link) => `[[${link}]]`);
  if (linked.length) lines.push(`- Links: ${linked.join(" ")}`);
  const note = appendNote(root, relPath, lines.join("\n") || "- Daily note touched by Argentum OS.", { heading: `Argentum Update - ${now()}` });
  rebuildIndexes(root);
  return note;
}

function listBacklinks(vaultPath, noteRef) {
  const root = normalizeVaultPath(vaultPath);
  const target = resolveCanonicalEntity(root, noteRef);
  let targetPath = target?.path;
  if (!targetPath) {
    try {
      targetPath = readNote(root, noteRef).path;
    } catch {
      targetPath = String(noteRef || "");
    }
  }
  return listMarkdownFiles(root, { includeArchive: false })
    .map((filePath) => readNote(root, relativeNotePath(root, filePath)))
    .filter((note) => resolveWikiLinks(note.content).some((link) => resolveWikilink(root, link)?.path === targetPath))
    .map((note) => ({ id: note.frontmatter.id || "", path: note.path, title: note.title, type: note.frontmatter.type || "note" }));
}

function listChildren(vaultPath, parentId) {
  const manifest = loadEntityManifest(vaultPath);
  return manifest.entities.filter((entity) => entity.parent === parentId || entity.business === parentId || entity.office === parentId || entity.agent === parentId);
}

function listRelatedEntities(vaultPath, ref) {
  const entity = resolveCanonicalEntity(vaultPath, ref);
  if (!entity) return [];
  const manifest = loadEntityManifest(vaultPath);
  const ids = new Set([entity.parent, entity.business, entity.office, entity.agent].filter(Boolean));
  return manifest.entities.filter((candidate) => ids.has(candidate.id) || candidate.parent === entity.id || candidate.business === entity.id || candidate.office === entity.id || candidate.agent === entity.id);
}

function buildAgentContext(vaultPath, payload = {}) {
  const root = normalizeVaultPath(vaultPath);
  const businessRef = payload.businessId || payload.business || "business.argentum";
  const officeRef = payload.officeId || payload.office || "";
  const projectRef = payload.projectId || payload.project || "";
  const workflowRef = payload.workflowId || payload.workflow || "workflow.human_gate";
  const sections = [
    { key: "governance", budget: 15, refs: ["00_System/Governance/Supervised_Agent_Rules.md", "00_System/Governance/Human_Gate_Rules.md", "00_System/Link_Policy.md"] },
    { key: "identity_authority", budget: 15, refs: ["30_Agents/Agent_1010/_Agent.md", "00_System/Context_Manifests/Agent_1010_Context.md"] },
    { key: "business", budget: 15, refs: [businessRef] },
    { key: "office_project", budget: 20, refs: [officeRef, projectRef, workflowRef].filter(Boolean) },
    { key: "task_execution", budget: 20, refs: ["90_Execution/Tasks/_Tasks_Index.md", "90_Execution/Decisions/_Decisions_Index.md"] },
    { key: "memory", budget: 10, refs: searchByType(root, "memory", { limit: 8 }).filter((item) => item.status === "approved" || item.path.startsWith("80_Memory/Approved/")).map((item) => item.path) },
    { key: "conversation", budget: 5, refs: [] },
  ];
  const notes = [];
  const seen = new Set();
  sections.forEach((section) => {
    section.refs.forEach((ref) => {
      try {
        const note = readNote(root, ref);
        if (/^(99_Archive|90_Execution\/(Logs|Daily_Notes|Runs)|80_Memory\/(Proposed|Rejected)|98_Assets)/.test(note.path)) return;
        if (seen.has(note.path)) return;
        seen.add(note.path);
        notes.push({
          section: section.key,
          budget: section.budget,
          id: note.frontmatter.id || "",
          type: note.frontmatter.type || "note",
          path: note.path,
          title: note.title,
          excerpt: note.body.slice(0, 2400),
        });
      } catch {
        // Missing refs should not stop context assembly; validation reports the gap.
      }
    });
  });
  if (payload.conversationSummary) {
    notes.push({
      section: "conversation",
      budget: 5,
      id: "conversation.current",
      type: "conversation",
      path: "",
      title: "Current Conversation Summary",
      excerpt: String(payload.conversationSummary).slice(0, 1200),
    });
  }
  return {
    source: "obsidian",
    schemaVersion: SCHEMA_VERSION,
    vaultPath: root,
    agent: "agent.1010",
    business: businessRef,
    office: officeRef,
    workflow: workflowRef,
    budgets: sections.map(({ key, budget }) => ({ section: key, budgetPercent: budget })),
    notes,
    recentDailyNotes: [],
  };
}

function createMemoryProposal(vaultPath, payload = {}) {
  const title = String(payload.title || "Memory Proposal").trim();
  const relPath = `95_Inbox/Memory_Proposals/${new Date().toISOString().slice(0, 10)}_${fileSegment(title)}.md`;
  const id = payload.id || `memory.proposed.${slugId(title)}.${crypto.randomBytes(3).toString("hex")}`;
  const content = md(relPath, canonicalFields({
    id,
    type: "memory",
    title,
    status: "pending_review",
    canonical: false,
    business: payload.business || payload.businessId || "",
    office: payload.office || payload.officeId || "",
    agent: payload.agent || payload.agentId || "agent.1010",
    tags: payload.tags || ["memory", "proposal", payload.proposalType || "entity_fact"],
    source: payload.source || "Agent 1010 memory proposal",
    confidence: payload.confidence ?? 0,
    importance: payload.importance || "medium",
    proposedBy: payload.proposedBy || "agent.1010",
    sourceRecordIds: payload.sourceRecordIds || [],
  }), `## Proposal\n${payload.content || payload.body || "TODO - memory content required."}\n\n## Approval\nPending Human Gate or operator review.`);
  writeMarkdown(vaultPath, relPath, content, { overwrite: false });
  rebuildIndexes(vaultPath);
  validateVault(vaultPath);
  return readNote(vaultPath, relPath);
}

function moveNote(vaultPath, fromRelPath, toRelPath, frontmatterUpdates = {}) {
  const root = normalizeVaultPath(vaultPath);
  const source = notePath(root, fromRelPath);
  const target = ensureInsideVault(root, path.join(root, toRelPath));
  if (!fs.existsSync(source)) {
    const error = new Error("Obsidian note not found.");
    error.status = 404;
    throw error;
  }
  const parsed = parseFrontmatter(fs.readFileSync(source, "utf8"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${frontmatter({ ...parsed.data, ...frontmatterUpdates, updated: now() })}${parsed.body.trim()}\n`);
  if (source !== target) fs.rmSync(source, { force: true });
  rebuildIndexes(root);
  validateVault(root);
  return readNote(root, toRelPath);
}

function approveMemoryProposal(vaultPath, ref) {
  const root = normalizeVaultPath(vaultPath);
  const note = readNote(root, ref);
  const parsed = parseFrontmatter(note.content);
  const target = `80_Memory/Approved/${fileSegment(note.title)}.md`;
  const memoryId = String(parsed.data.id || "").replace(/^memory\.proposed\./, "memory.").replace(/\.[a-f0-9]{6}$/i, "") || `memory.${slugId(note.title)}`;
  const approvedFields = {
    ...parsed.data,
    id: memoryId.startsWith("memory.") ? memoryId : `memory.${slugId(note.title)}`,
    status: "approved",
    canonical: true,
    reviewed: now(),
    approvedFromProposal: parsed.data.id || "",
    confidence: Math.max(Number(parsed.data.confidence) || 0, 0.75),
  };
  writeMarkdown(root, target, `${frontmatter(approvedFields)}${parsed.body.trim()}\n`, { overwrite: false });
  writeMarkdown(root, note.path, `${frontmatter({ ...parsed.data, status: "approved", canonical: false, reviewed: now(), approvedMemoryPath: target, approvedMemoryId: approvedFields.id })}${parsed.body.trim()}\n`, { overwrite: true });
  rebuildIndexes(root);
  validateVault(root);
  return readNote(root, target);
}

function rejectMemoryProposal(vaultPath, ref, reason = "") {
  const note = readNote(vaultPath, ref);
  const target = `80_Memory/Rejected/${fileSegment(note.title)}.md`;
  const rejected = moveNote(vaultPath, note.path, target, { status: "rejected", canonical: false, reviewed: now() });
  if (reason) appendNote(vaultPath, rejected.path, `- Rejection reason: ${reason}`, { heading: "Review" });
  return rejected;
}

function createMemoryCorrection(vaultPath, ref, payload = {}) {
  const oldNote = readNote(vaultPath, ref);
  return createMemoryProposal(vaultPath, {
    title: payload.title || `Correction - ${oldNote.title}`,
    content: [
      `Old record: ${oldNote.frontmatter.id || oldNote.path}`,
      "",
      "## Old Value",
      payload.oldValue || oldNote.body.slice(0, 1200),
      "",
      "## Proposed New Value",
      payload.newValue || payload.content || "TODO - corrected value required.",
      "",
      "## Affected Context",
      payload.affectedContext || "Agent 1010 context should prefer the approved correction after review.",
    ].join("\n"),
    proposalType: "correction",
    sourceRecordIds: [oldNote.frontmatter.id || oldNote.path, ...(payload.sourceRecordIds || [])],
    confidence: payload.confidence ?? 0.5,
    importance: payload.importance || "high",
    business: oldNote.frontmatter.business || payload.business || "",
    office: oldNote.frontmatter.office || payload.office || "",
  });
}

function approveMemoryCorrection(vaultPath, proposalRef, oldRef) {
  const root = normalizeVaultPath(vaultPath);
  const oldNote = readNote(root, oldRef);
  const approved = approveMemoryProposal(root, proposalRef);
  const oldParsed = parseFrontmatter(oldNote.content);
  writeMarkdown(root, oldNote.path, `${frontmatter({
    ...oldParsed.data,
    status: "superseded",
    canonical: false,
    reviewed: now(),
    supersededBy: approved.frontmatter.id || approved.path,
  })}${oldParsed.body.trim()}\n\n## Supersession\nSuperseded by [[${approved.path.replace(/\.md$/, "")}|${approved.title}]].\n`, { overwrite: true });
  const approvedParsed = parseFrontmatter(approved.content);
  writeMarkdown(root, approved.path, `${frontmatter({
    ...approvedParsed.data,
    supersedes: oldParsed.data.id || oldNote.path,
  })}${approvedParsed.body.trim()}\n`, { overwrite: true });
  rebuildIndexes(root);
  validateVault(root);
  return readNote(root, approved.path);
}

function renameCanonicalEntity(vaultPath, ref, nextTitle) {
  const root = normalizeVaultPath(vaultPath);
  const entity = resolveCanonicalEntity(root, ref);
  if (!entity) {
    const error = new Error("Canonical entity not found.");
    error.status = 404;
    throw error;
  }
  const title = String(nextTitle || "").trim();
  if (!title) {
    const error = new Error("New title is required.");
    error.status = 400;
    throw error;
  }
  const note = readNote(root, entity.path);
  const parsed = parseFrontmatter(note.content);
  const oldPath = entity.path;
  const config = ENTITY_CONFIG[entity.type];
  const targetPath = config?.fileName
    ? `${path.dirname(path.dirname(oldPath))}/${fileSegment(title)}/${config.fileName}`
    : `${path.dirname(oldPath)}/${fileSegment(title)}.md`;
  const target = ensureInsideVault(root, path.join(root, targetPath));
  if (fs.existsSync(target)) {
    const error = new Error("Target canonical path already exists.");
    error.status = 409;
    throw error;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${frontmatter({
    ...parsed.data,
    title,
    aliases: Array.from(new Set([...(parsed.data.aliases || []), parsed.data.title || note.title])),
    updated: now(),
  })}${parsed.body.replace(/^# .*\n/, `# ${title}\n`).trim()}\n`);
  fs.rmSync(path.join(root, oldPath), { force: true });
  const legacyMap = readJson(root, "00_System/Manifests/legacy-path-map.json", {});
  legacyMap[oldPath] = targetPath;
  writeJson(root, "00_System/Manifests/legacy-path-map.json", legacyMap);
  rebuildIndexes(root);
  validateVault(root);
  return readNote(root, targetPath);
}

function archiveNote(vaultPath, ref, reason = "") {
  const note = readNote(vaultPath, ref);
  const year = new Date().getFullYear();
  const target = `99_Archive/${year}/${note.path}`;
  const archived = moveNote(vaultPath, note.path, target, { status: "archived", canonical: false, reviewed: now() });
  if (reason) appendNote(vaultPath, archived.path, `- Archive reason: ${reason}`, { heading: "Archive" });
  return archived;
}

function createDecision(vaultPath, payload = {}) {
  const title = String(payload.title || "").trim();
  const decision = String(payload.decision || "").trim();
  if (!title || !decision) {
    const error = new Error("Decision title and decision text are required.");
    error.status = 400;
    throw error;
  }
  const note = createCanonicalNote(vaultPath, {
    type: "decision",
    title,
    businessId: payload.businessId || payload.business || "business.argentum",
    tags: ["decision"],
    status: "active",
    confidence: payload.confidence ?? 1,
    source: payload.source || "Argentum decision endpoint",
    data: {
      overview: decision,
      currentStatus: "Decision recorded.",
    },
    content: [
      "## Decision",
      decision,
      "",
      "## Context",
      payload.context || "TODO - operator input required.",
      "",
      "## Alternatives",
      (payload.alternatives || []).map((item) => `- ${item}`).join("\n") || "- None recorded.",
      "",
      "## Reason",
      payload.reason || "TODO - operator input required.",
      "",
      "## Consequences",
      (payload.consequences || []).map((item) => `- ${item}`).join("\n") || "- None recorded.",
      "",
      "## Review",
      payload.reviewDate ? `Review on ${payload.reviewDate}.` : "No review date set.",
      "",
      "## Sources",
      (payload.sourceRecordIds || []).map((item) => `- ${item}`).join("\n") || "- Operator entry.",
    ].join("\n"),
  });
  return {
    id: note.frontmatter.id,
    path: note.path,
    note,
  };
}

function graph(vaultPath, options = {}) {
  const manifest = loadEntityManifest(vaultPath);
  const excluded = new Set(options.includeWorking ? [] : ["task", "run", "log", "daily_note", "asset", "legacy"]);
  const entities = manifest.entities.filter((entity) => !excluded.has(entity.type) && !entity.path.startsWith("99_Archive/"));
  const ids = new Set(entities.map((entity) => entity.id));
  const nodes = entities.map((entity) => ({ id: entity.id, label: entity.title, type: entity.type, path: entity.path, status: entity.status }));
  const edges = [];
  entities.forEach((entity) => {
    ["parent", "business", "office", "agent"].forEach((field) => {
      if (entity[field] && ids.has(entity[field])) edges.push({ from: entity.id, to: entity[field], type: field });
    });
  });
  return { schemaVersion: SCHEMA_VERSION, generatedAt: now(), nodes, edges };
}

function openClawToolAction(vaultPath, action, payload = {}) {
  const actions = {
    read_note: () => readNote(vaultPath, payload.note || payload.path || payload.id),
    write_note: () => writeNote(vaultPath, payload.note || payload.path || payload.id, payload.content || "", { overwrite: Boolean(payload.overwrite), approvedLargeOverwrite: Boolean(payload.approvedLargeOverwrite) }),
    append_note: () => appendNote(vaultPath, payload.note || payload.path || payload.id, payload.content || "", { heading: payload.heading }),
    search_notes: () => searchVault(vaultPath, payload.query || payload.q || "", payload),
    search_by_type: () => searchByType(vaultPath, payload.type, payload),
    create_note: () => createCanonicalNote(vaultPath, payload),
    list_backlinks: () => listBacklinks(vaultPath, payload.note || payload.path || payload.id),
    list_children: () => listChildren(vaultPath, payload.id || payload.parentId),
    related_entities: () => listRelatedEntities(vaultPath, payload.id || payload.path || payload.title),
    resolve_wikilinks: () => resolveWikiLinks(payload.content || readNote(vaultPath, payload.note || payload.path).content),
    resolve_entity: () => resolveCanonicalEntity(vaultPath, payload.id || payload.path || payload.title),
  };
  if (!actions[action]) {
    const error = new Error("Unsupported Obsidian tool action.");
    error.status = 400;
    throw error;
  }
  return { action, result: actions[action]() };
}

module.exports = {
  SCHEMA_VERSION,
  VAULT_NAME,
  agentContext: buildAgentContext,
  appendNote,
  approveMemoryCorrection,
  approveMemoryProposal,
  archiveNote,
  backupVault,
  buildAgentContext,
  createCanonicalNote,
  createDecision,
  createMemoryCorrection,
  createMemoryProposal,
  createNote,
  createOrUpdateDailyNote,
  createTypedNote,
  defaultVaultPath,
  getVaultStatus,
  graph,
  initializeVault,
  listBacklinks,
  listChildren,
  listMarkdownFiles,
  listRelatedEntities,
  loadVaultSchema,
  migrateLegacyVault,
  openClawToolAction,
  readNote,
  rebuildEntityManifest,
  rebuildIndexes,
  rebuildSearchIndex,
  recentDailyNotes,
  renameCanonicalEntity,
  rejectMemoryProposal,
  resolveCanonicalEntity,
  resolveLegacyPath,
  resolveWikiLinks,
  resolveWikilink,
  searchByType,
  searchNotes: searchVault,
  searchVault,
  updateCanonicalNote,
  validateVault,
  vaultStatus: getVaultStatus,
  writeNote,
};

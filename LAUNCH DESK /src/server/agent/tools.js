import { tool } from "@openai/agents";
import { z } from "zod";

export const launchBriefSchema = z.object({
  brief: z.string().min(1),
  audience: z.string().optional().default(""),
  launchDate: z.string().optional().default(""),
  constraints: z.string().optional().default(""),
  assets: z.string().optional().default(""),
  channels: z.string().optional().default(""),
  owners: z.string().optional().default("")
});

function splitText(value) {
  return String(value || "")
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function inferChannels(payload) {
  const stated = splitText(payload.channels);
  if (stated.length) return stated;

  const text = `${payload.brief} ${payload.assets}`.toLowerCase();
  const channels = [];
  if (/email|newsletter/.test(text)) channels.push("Email");
  if (/blog|seo|article/.test(text)) channels.push("Blog");
  if (/sales|customer|crm/.test(text)) channels.push("Sales enablement");
  if (/social|linkedin|x |twitter|tiktok/.test(text)) channels.push("Social");
  if (!channels.length) channels.push("Product update", "Email", "Internal enablement");
  return channels;
}

function inferOwners(payload) {
  const owners = splitText(payload.owners);
  if (owners.length) return owners;
  return ["Engineering", "Product", "Design", "Marketing", "Support"];
}

export function extractLaunchTasks(payload) {
  const constraints = splitText(payload.constraints);
  const assets = splitText(payload.assets);
  const channels = inferChannels(payload);
  const owners = inferOwners(payload);
  const missing = [];

  if (!payload.audience?.trim()) missing.push("specific audience");
  if (!payload.launchDate?.trim()) missing.push("launch date");
  if (!payload.assets?.trim()) missing.push("available assets");
  if (!payload.constraints?.trim()) missing.push("constraints and non-goals");

  const taskSeed = [
    ["Clarify launch promise", "Product", "Define the one-sentence value prop and success metric.", "high"],
    ["Freeze scope and release criteria", "Engineering", "Confirm launch-blocking bugs, supported paths, and rollback conditions.", "high"],
    ["Prepare launch assets", "Design", `Inventory assets: ${assets.length ? assets.join(", ") : "screenshots, demo, docs, and changelog"}.`, "medium"],
    ["Draft channel copy", "Marketing", `Create tailored copy for ${channels.join(", ")}.`, "medium"],
    ["Build customer-facing FAQ", "Support", "Answer eligibility, pricing, migration, support, and troubleshooting questions.", "medium"],
    ["Run launch readiness review", "Engineering", "Score risks, owner coverage, approvals, observability, and support readiness.", "high"]
  ];

  return {
    tasks: taskSeed.map(([title, owner, detail, priority], index) => ({
      id: `LD-${String(index + 1).padStart(2, "0")}`,
      title,
      owner: owners.includes(owner) ? owner : owner,
      detail,
      priority,
      status: index < 2 ? "ready to start" : "queued"
    })),
    channels,
    constraints,
    missingDetails: missing
  };
}

export function checkLaunchReadiness(payload) {
  const tasks = extractLaunchTasks(payload);
  const hasDate = Boolean(payload.launchDate?.trim());
  const hasAudience = Boolean(payload.audience?.trim());
  const hasAssets = splitText(payload.assets).length > 0;
  const hasConstraints = splitText(payload.constraints).length > 0;
  const riskItems = [];

  if (!hasDate) riskItems.push({ risk: "Launch date is missing", level: "high", mitigation: "Set a target date or planning window before committing owners." });
  if (!hasAudience) riskItems.push({ risk: "Audience is too broad", level: "high", mitigation: "Define primary user segment and excluded users." });
  if (!hasAssets) riskItems.push({ risk: "Launch assets are not inventoried", level: "medium", mitigation: "List screenshots, demos, docs, changelog, and proof points." });
  if (!hasConstraints) riskItems.push({ risk: "Constraints are undefined", level: "medium", mitigation: "Document budget, compliance, staffing, timing, and platform limits." });
  if (/security|privacy|billing|payment|migration|data/i.test(`${payload.brief} ${payload.constraints}`)) {
    riskItems.push({ risk: "High-trust launch surface", level: "high", mitigation: "Require security/privacy review and rollback plan." });
  }

  const score = Math.max(20, 100 - riskItems.reduce((total, item) => total + (item.level === "high" ? 18 : 10), 0));

  return {
    readinessScore: score,
    rating: score >= 80 ? "strong" : score >= 60 ? "needs review" : "not ready",
    rubric: [
      { area: "Audience clarity", status: hasAudience ? "ready" : "missing" },
      { area: "Date and sequencing", status: hasDate ? "ready" : "missing" },
      { area: "Asset coverage", status: hasAssets ? "ready" : "missing" },
      { area: "Constraint handling", status: hasConstraints ? "ready" : "missing" },
      { area: "Owner coverage", status: tasks.tasks.length >= 5 ? "ready" : "review" }
    ],
    risks: riskItems.length ? riskItems : [
      { risk: "Launch plan is broad but workable", level: "low", mitigation: "Keep owners explicit and run one final readiness review." }
    ]
  };
}

export function generateOwnerChecklist(payload) {
  const owners = inferOwners(payload);
  const base = {
    Engineering: ["Confirm release branch and rollback path", "Verify monitoring and alerts", "Prepare known-issues note"],
    Product: ["Freeze launch narrative", "Approve scope and non-goals", "Define success metrics"],
    Design: ["Export final screenshots or demo clips", "Validate UI states used in launch materials", "Prepare social preview asset"],
    Marketing: ["Draft email, social, and product update copy", "Coordinate timing", "Prepare tracking links"],
    Support: ["Write FAQ and escalation rules", "Prep saved replies", "Confirm support coverage window"]
  };

  return {
    checklists: owners.map((owner) => ({
      owner,
      items: base[owner] || [`Confirm ${owner} launch responsibility`, "Document blockers", "Report ready/not-ready status"]
    }))
  };
}

export function draftLaunchCopy(payload) {
  const audience = payload.audience?.trim() || "target users";
  const promise = String(payload.brief).split(/[.!?]/)[0].trim() || "a new product update";
  const channels = inferChannels(payload);

  return {
    copy: channels.map((channel) => ({
      channel,
      headline: `${promise} for ${audience}`,
      body: channel.toLowerCase().includes("email")
        ? `Hi ${audience},\n\nWe are preparing ${promise}. The launch plan focuses on a clear rollout, known constraints, and a safe path to support.`
        : `Launching: ${promise}. Built for ${audience}, with a focused rollout and clear next steps.`,
      cta: channel.toLowerCase().includes("internal") ? "Review launch plan" : "Learn more"
    }))
  };
}

export const extractTasksTool = tool({
  name: "extract_launch_tasks",
  description: "Extract prioritized launch tasks, owners, channels, and missing details from a rough product brief.",
  parameters: launchBriefSchema,
  execute: async (payload) => extractLaunchTasks(payload)
});

export const readinessTool = tool({
  name: "check_launch_readiness",
  description: "Score launch readiness against audience, date, asset, constraint, owner, risk, and review coverage.",
  parameters: launchBriefSchema,
  execute: async (payload) => checkLaunchReadiness(payload)
});

export const ownerChecklistTool = tool({
  name: "generate_owner_checklist",
  description: "Generate owner-specific checklists for the launch team.",
  parameters: launchBriefSchema,
  execute: async (payload) => generateOwnerChecklist(payload)
});

export const launchCopyTool = tool({
  name: "draft_channel_launch_copy",
  description: "Draft launch copy tailored to product update, email, social, blog, and internal channels.",
  parameters: launchBriefSchema,
  execute: async (payload) => draftLaunchCopy(payload)
});

export const launchTools = [
  extractTasksTool,
  readinessTool,
  ownerChecklistTool,
  launchCopyTool
];

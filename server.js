const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const STATE_FILE = path.join(DATA_DIR, "argentum-state.json");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function now() {
  return new Date().toISOString();
}

function defaultState() {
  return {
    meta: {
      name: "Argentum",
      version: "0.1.0",
      mode: "local_supervised",
      updatedAt: now(),
    },
    agent: {
      id: "agent-001-depo",
      name: "Depo",
      role: "Depository Operator",
      state: "active_supervised",
      spendLimit: "$5/day sandbox",
      externalActions: "Draft only",
      memoryAccess: "Working + verified shared",
    },
    governance: {
      killSwitch: false,
      cycleCount: 0,
      cycleLimit: 12,
      taskRunCount: 0,
      functionRunCount: 0,
      estimatedSpendUsd: 0,
      dailySpendLimitUsd: 5,
      highRiskActionsRequireApproval: true,
      blockedActions: [
        "move money",
        "place trades",
        "publish external claims",
        "create external accounts",
        "contact customers",
        "deploy new agents",
        "modify core systems"
      ],
    },
    mission: {
      activeWorkflowId: "workflow-pod-lab",
      currentStep: 0,
      paused: false,
      steps: [
        {
          station: "Research",
          x: "18%",
          y: "44%",
          progress: 28,
          confidence: 72,
          title: "Build Etsy print-on-demand research lane",
          copy: "Depo is collecting demand signals, competitor notes, and freshness labels before any listing idea becomes durable memory.",
          risk: "Low",
        },
        {
          station: "Verify",
          x: "78%",
          y: "44%",
          progress: 51,
          confidence: 82,
          title: "Check contradictions and policy risk",
          copy: "Depo is separating verified evidence from guesses and blocking claims that would need legal, financial, or customer-facing review.",
          risk: "Medium",
        },
        {
          station: "Draft",
          x: "21%",
          y: "70%",
          progress: 74,
          confidence: 88,
          title: "Draft the first workflow",
          copy: "Depo is preparing a repeatable research-to-approval workflow with no account creation, publishing, or spending permission.",
          risk: "Low",
        },
        {
          station: "Approval",
          x: "77%",
          y: "70%",
          progress: 92,
          confidence: 91,
          title: "Package decision for the operator",
          copy: "Depo is bundling evidence, assumptions, expected upside, risks, and the exact action that needs your sign-off.",
          risk: "Approval required",
        }
      ],
    },
    capabilities: [
      {
        id: "cap-pod-niche-scout",
        name: "POD niche scout",
        status: "Draft ready",
        description: "Researches product niches, ranks evidence, and creates listing briefs for approval.",
      },
      {
        id: "cap-market-signal-notebook",
        name: "Market signal notebook",
        status: "Sandbox",
        description: "Summarizes watchlist movement and creates notes. It cannot place trades.",
      },
      {
        id: "cap-agent-manifest-drafter",
        name: "Agent manifest drafter",
        status: "Proposal only",
        description: "Drafts future agent prompts, permissions, evals, and budgets for human review.",
      },
      {
        id: "cap-memory-curator",
        name: "Memory curator",
        status: "Active",
        description: "Turns useful observations into structured memory after provenance and freshness checks.",
      }
    ],
    functions: [
      {
        id: "func-pod-research-brief",
        name: "POD research brief",
        workflowId: "workflow-pod-lab",
        status: "seeded",
        risk: "low",
        ownerAgentId: "agent-001-depo",
        description: "Reusable draft-only process for turning a print-on-demand niche idea into an evidence-labeled listing brief.",
        inputs: ["niche hypothesis", "product type", "evidence notes"],
        outputs: ["listing brief", "assumption log", "approval package"],
        blockedActions: ["publish listing", "create seller account", "purchase inventory", "make earnings claims"],
        createdAt: now(),
      }
    ],
    workflows: [
      {
        id: "workflow-pod-lab",
        name: "Print-on-demand lab",
        type: "business_lane",
        status: "active_draft",
        risk: "low",
        description: "Find niches, draft listings, estimate demand, and send publishing actions to approval.",
        nextFunction: "Generate a reusable listing research brief from evidence and assumptions.",
      },
      {
        id: "workflow-stock-watch",
        name: "Stock algorithm watch",
        type: "monitoring_lane",
        status: "read_only",
        risk: "high",
        description: "Monitor signals and produce notes only. Trading remains blocked without approval.",
        nextFunction: "Create paper-trading notes without broker access or live execution.",
      },
      {
        id: "workflow-agent-factory",
        name: "Agent factory",
        type: "governance_lane",
        status: "proposal_only",
        risk: "medium",
        description: "Draft new agent manifests, tests, budgets, and permissions as proposals.",
        nextFunction: "Propose a second agent only after Depo's first workflow is approved.",
      }
    ],
    taskTemplates: [
      {
        id: "tpl-pod-niche-scan",
        name: "POD niche scan",
        workflowId: "workflow-pod-lab",
        risk: "low",
        prompt: "Research one Etsy print-on-demand niche and draft an evidence-labeled niche brief. Do not publish, create accounts, or spend money.",
        outcome: "POD brief artifact",
      },
      {
        id: "tpl-pod-listing-outline",
        name: "Listing outline",
        workflowId: "workflow-pod-lab",
        risk: "low",
        prompt: "Turn an approved POD niche into a draft listing outline with title angles, keyword themes, mockup needs, and blocked actions.",
        outcome: "Draft listing plan",
      },
      {
        id: "tpl-stock-watch-note",
        name: "Stock watch note",
        workflowId: "workflow-stock-watch",
        risk: "high",
        prompt: "Prepare a read-only stock algorithm watch note in paper mode. Do not connect a broker, place trades, move money, or make return claims.",
        outcome: "Paper-mode watch note",
      },
      {
        id: "tpl-agent-function-proposal",
        name: "Function proposal",
        workflowId: "workflow-agent-factory",
        risk: "medium",
        prompt: "Draft a proposal for a future Argentum function with manifest, permissions, budget, evals, and approval gates. Do not deploy it.",
        outcome: "Future-function proposal",
      }
    ],
    tasks: [
      {
        id: "task-seed-pod-niche-brief",
        title: "Draft a POD niche research brief",
        operatorText: "Find a low-risk print-on-demand niche and prepare a listing research workflow for approval.",
        workflowId: "workflow-pod-lab",
        intent: "print_on_demand",
        risk: "low",
        status: "queued",
        evidence: [],
        output: "",
        createdAt: now(),
        updatedAt: now(),
      }
    ],
    artifacts: [],
    executions: [],
    approvals: [
      {
        id: "approval-pod-lane-v0",
        title: "Approve POD research lane v0",
        risk: "low",
        evidence: "3 source notes, 1 contradiction check, 1 spend estimate",
        action: "Allow Depo to save this workflow as a reusable playbook.",
        status: "pending",
        createdAt: now(),
      },
      {
        id: "approval-stock-readonly-v0",
        title: "Review stock algorithm monitor",
        risk: "high",
        evidence: "Signal summary only. Execution permissions blocked.",
        action: "Confirm this lane remains read-only and paper-trading only.",
        status: "pending",
        createdAt: now(),
      }
    ],
    memory: {
      working: [
        {
          id: "mem-working-current-task",
          title: "Current task",
          body: "Design a visible first-agent system for Argentum with Depo as the supervised starting worker.",
          provenance: "operator_goal",
          updatedAt: now(),
        },
        {
          id: "mem-working-domain-priority",
          title: "Open question",
          body: "Business domain priorities are Etsy print-on-demand first, stock algorithm monitoring second.",
          provenance: "operator_goal",
          updatedAt: now(),
        }
      ],
      shared: [
        {
          id: "mem-shared-operating-rule",
          title: "Operating rule",
          body: "External publishing, trades, account creation, customer contact, and new agent deployment require human approval.",
          provenance: "safety_policy",
          updatedAt: now(),
        },
        {
          id: "mem-shared-mvp-architecture",
          title: "MVP architecture",
          body: "Start with one visible agent, a small task loop, memory layers, approval queue, and audit trail.",
          provenance: "architecture_prompt",
          updatedAt: now(),
        }
      ],
      agent: [
        {
          id: "mem-agent-depo-identity",
          title: "Depo identity",
          body: "Depo is the depository operator: gather, verify, draft, and package work for approval.",
          provenance: "agent_manifest",
          updatedAt: now(),
        },
        {
          id: "mem-agent-failure-habit",
          title: "Failure habit",
          body: "When evidence is stale, contradictory, or missing, Depo must ask for review instead of inventing certainty.",
          provenance: "safety_policy",
          updatedAt: now(),
        }
      ],
    },
    audit: [
      {
        id: "audit-system-created",
        title: "Argentum local state created",
        body: "Depo was initialized as the first supervised agent with approval-gated business workflows.",
        createdAt: now(),
      }
    ],
  };
}

function ensureState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STATE_FILE)) {
    writeState(defaultState());
  }
}

function normalizeState(state) {
  const fresh = defaultState();
  state.meta = { ...fresh.meta, ...state.meta };
  state.agent = { ...fresh.agent, ...state.agent };
  state.governance = { ...fresh.governance, ...state.governance };
  state.mission = { ...fresh.mission, ...state.mission };
  state.capabilities = Array.isArray(state.capabilities) ? state.capabilities : fresh.capabilities;
  state.functions = Array.isArray(state.functions) ? state.functions : fresh.functions;
  state.workflows = Array.isArray(state.workflows) ? state.workflows : fresh.workflows;
  state.taskTemplates = Array.isArray(state.taskTemplates) ? state.taskTemplates : fresh.taskTemplates;
  state.tasks = Array.isArray(state.tasks) ? state.tasks : fresh.tasks;
  state.artifacts = Array.isArray(state.artifacts) ? state.artifacts : fresh.artifacts;
  state.executions = Array.isArray(state.executions) ? state.executions : fresh.executions;
  state.approvals = Array.isArray(state.approvals) ? state.approvals : fresh.approvals;
  state.memory = {
    working: state.memory?.working || fresh.memory.working,
    shared: state.memory?.shared || fresh.memory.shared,
    agent: state.memory?.agent || fresh.memory.agent,
  };
  state.audit = Array.isArray(state.audit) ? state.audit : fresh.audit;
  return state;
}

function readState() {
  ensureState();
  return normalizeState(JSON.parse(fs.readFileSync(STATE_FILE, "utf8")));
}

function writeState(state) {
  state.meta.updatedAt = now();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function audit(state, title, body) {
  state.audit.unshift({
    id: `audit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title,
    body,
    createdAt: now(),
  });
  state.audit = state.audit.slice(0, 50);
}

function addMemory(state, layer, title, body, provenance) {
  const entries = state.memory[layer];
  if (!entries) return;
  entries.unshift({
    id: `mem-${layer}-${Date.now()}`,
    title,
    body,
    provenance,
    updatedAt: now(),
  });
  state.memory[layer] = entries.slice(0, 20);
}

function guardedError(message, status = 409) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function enforceAutomationGuards(state, action) {
  if (state.governance.killSwitch) {
    throw guardedError("Kill switch is enabled. Resume Argentum before running Depo.", 423);
  }
  if (action === "cycle" && state.governance.cycleCount >= state.governance.cycleLimit) {
    state.mission.paused = true;
    audit(state, "Loop guard paused Depo", `Cycle limit reached at ${state.governance.cycleCount}/${state.governance.cycleLimit}.`);
    writeState(state);
    throw guardedError("Cycle limit reached. Reset the loop guard before continuing.", 429);
  }
}

function recordAutomationCost(state, action) {
  if (action === "cycle") state.governance.cycleCount += 1;
  if (action === "task") state.governance.taskRunCount += 1;
  if (action === "function") state.governance.functionRunCount += 1;
  const increment = action === "cycle" ? 0.01 : action === "task" ? 0.03 : 0.02;
  state.governance.estimatedSpendUsd = Number((state.governance.estimatedSpendUsd + increment).toFixed(2));
}

function functionSpecForTask(task) {
  if (task.intent === "market_monitoring") {
    return {
      name: "Read-only market watch note",
      description: "Reusable paper-mode workflow for converting stock algorithm signals into reviewable notes without broker access or trade execution.",
      inputs: ["watchlist", "signal assumptions", "time horizon"],
      outputs: ["signal note", "confidence label", "blocked-action checklist"],
      blockedActions: ["place trade", "connect broker", "move money", "recommend guaranteed returns"],
    };
  }
  if (task.intent === "agent_factory") {
    return {
      name: "Future agent proposal",
      description: "Reusable approval-gated workflow for drafting a new agent manifest, permissions, tests, budgets, and review packet.",
      inputs: ["agent job", "allowed tools", "risk level"],
      outputs: ["draft manifest", "eval checklist", "approval package"],
      blockedActions: ["deploy agent", "change permissions", "modify core routing", "connect production tools"],
    };
  }
  return {
    name: "POD niche brief",
    description: "Reusable draft-only workflow for converting a print-on-demand idea into an evidence-labeled niche and listing brief.",
    inputs: ["niche idea", "product format", "source notes"],
    outputs: ["niche brief", "listing outline", "assumption log"],
    blockedActions: ["publish listing", "create seller account", "spend money", "make earnings claims"],
  };
}

function promoteTaskToFunction(state, task) {
  const spec = functionSpecForTask(task);
  const existing = state.functions.find((item) => item.sourceTaskId === task.id);
  if (existing) {
    existing.status = "approved";
    existing.updatedAt = now();
    return existing;
  }

  const fn = {
    id: `func-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: spec.name,
    workflowId: task.workflowId,
    sourceTaskId: task.id,
    status: "approved",
    risk: task.risk,
    ownerAgentId: "agent-001-depo",
    description: spec.description,
    inputs: spec.inputs,
    outputs: spec.outputs,
    blockedActions: spec.blockedActions,
    createdAt: now(),
  };
  state.functions.unshift(fn);
  state.functions = state.functions.slice(0, 40);

  const capabilityId = `cap-${fn.id}`;
  if (!state.capabilities.some((capability) => capability.id === capabilityId)) {
    state.capabilities.unshift({
      id: capabilityId,
      name: fn.name,
      status: "Approved function",
      description: fn.description,
    });
  }
  return fn;
}

function classifyTask(text, requestedWorkflowId) {
  const lower = text.toLowerCase();
  if (requestedWorkflowId) {
    const workflowRisk = {
      "workflow-pod-lab": ["print_on_demand", "low"],
      "workflow-stock-watch": ["market_monitoring", "high"],
      "workflow-agent-factory": ["agent_factory", "medium"],
    }[requestedWorkflowId];
    if (workflowRisk) {
      return { workflowId: requestedWorkflowId, intent: workflowRisk[0], risk: workflowRisk[1] };
    }
  }
  if (lower.includes("stock") || lower.includes("trade") || lower.includes("algo") || lower.includes("market")) {
    return { workflowId: "workflow-stock-watch", intent: "market_monitoring", risk: "high" };
  }
  if (lower.includes("agent") || lower.includes("function") || lower.includes("capability")) {
    return { workflowId: "workflow-agent-factory", intent: "agent_factory", risk: "medium" };
  }
  return { workflowId: "workflow-pod-lab", intent: "print_on_demand", risk: "low" };
}

function taskPlan(task) {
  if (task.intent === "market_monitoring") {
    return {
      evidence: [
        "Execution permissions are blocked.",
        "Output is limited to paper notes and signal summaries.",
        "Any broker connection, trade, or money movement must be approved separately.",
      ],
      output: "Depo prepared a read-only stock algorithm watch note: define the watchlist, record signal assumptions, log confidence, and keep every trade-related action in paper mode until a human approves a separate connector.",
      approvalTitle: "Review read-only market monitor task",
      approvalAction: "Confirm this task may be saved as paper-trading guidance only.",
    };
  }
  if (task.intent === "agent_factory") {
    return {
      evidence: [
        "New agents are proposals only.",
        "Manifest, budget, tests, and permissions must be reviewed together.",
        "Deployment is blocked until explicit approval.",
      ],
      output: "Depo drafted a future-agent proposal path: define the job, list blocked capabilities, set a spend limit, write eval cases, and send the manifest to the approval queue without deployment.",
      approvalTitle: "Review future agent proposal task",
      approvalAction: "Decide whether this proposed function can become a draft manifest.",
    };
  }
  return {
    evidence: [
      "Publishing and store actions are blocked.",
      "Listing research must separate verified evidence from assumptions.",
      "Reusable POD playbooks need human approval before promotion to shared memory.",
    ],
    output: "Depo drafted a POD research brief: choose one niche hypothesis, gather demand and competitor evidence, label assumptions, create a listing outline, estimate costs, and stop before publishing or account actions.",
    approvalTitle: "Review POD task output",
    approvalAction: "Approve whether this POD task output can be promoted into shared memory as a reusable playbook.",
  };
}

function artifactForTask(task, plan) {
  if (task.intent === "market_monitoring") {
    return {
      type: "stock_watch_note",
      title: "Read-only stock algorithm watch note",
      summary: "Paper-mode market signal note that records assumptions and blocks live trading.",
      sections: [
        {
          label: "Watch objective",
          body: "Track algorithm signals as research notes only, with no broker connection and no trade execution.",
        },
        {
          label: "Signal checklist",
          body: "Record ticker, signal source, confidence, time horizon, contradiction notes, and paper outcome.",
        },
        {
          label: "Operator gate",
          body: "Any broker access, trade order, money movement, or customer-facing financial claim must go through approval.",
        },
      ],
      blockedActions: ["place trade", "connect broker", "move money", "recommend guaranteed returns"],
    };
  }
  if (task.intent === "agent_factory") {
    return {
      type: "agent_proposal",
      title: "Future agent function proposal",
      summary: "Draft manifest path for a new agent or capability that remains proposal-only.",
      sections: [
        {
          label: "Proposed job",
          body: "Define the agent function, owner, allowed tools, memory scope, budgets, and stop conditions.",
        },
        {
          label: "Eval plan",
          body: "Write scenario tests, permission tests, loop tests, and failure behavior before any deployment request.",
        },
        {
          label: "Approval gate",
          body: "Deployment, permission changes, production connectors, and core routing changes are blocked.",
        },
      ],
      blockedActions: ["deploy agent", "change permissions", "modify core routing", "connect production tools"],
    };
  }
  return {
    type: "pod_brief",
    title: "Print-on-demand niche brief",
    summary: "Draft-only Etsy/POD research brief that turns a niche idea into an approval-ready listing plan.",
    sections: [
      {
        label: "Niche hypothesis",
        body: "Choose one product/niche angle, then gather demand, competitor, pricing, and differentiation notes.",
      },
      {
        label: "Listing outline",
        body: "Draft title angles, keyword themes, product mockup needs, fulfillment assumptions, and cost notes.",
      },
      {
        label: "Approval gate",
        body: "Publishing, store setup, spend, earnings claims, and customer contact remain blocked until approved.",
      },
    ],
    blockedActions: ["publish listing", "create seller account", "spend money", "make earnings claims"],
  };
}

function createArtifact(state, task, plan) {
  const spec = artifactForTask(task, plan);
  const artifact = {
    id: `artifact-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    taskId: task.id,
    functionId: task.functionId || null,
    workflowId: task.workflowId,
    type: spec.type,
    title: spec.title,
    summary: spec.summary,
    status: "draft_ready",
    risk: task.risk,
    evidence: plan.evidence,
    sections: spec.sections,
    blockedActions: spec.blockedActions,
    createdAt: now(),
    updatedAt: now(),
  };
  state.artifacts.unshift(artifact);
  state.artifacts = state.artifacts.slice(0, 50);
  return artifact;
}

function createTask(payload) {
  const text = String(payload.text || payload.title || "").trim();
  if (!text) {
    throw new Error("Task text is required");
  }
  const state = readState();
  const classification = classifyTask(text, payload.workflowId);
  const task = {
    id: `task-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: text.length > 76 ? `${text.slice(0, 73)}...` : text,
    operatorText: text,
    workflowId: classification.workflowId,
    intent: classification.intent,
    risk: classification.risk,
    status: "queued",
    evidence: [],
    output: "",
    createdAt: now(),
    updatedAt: now(),
  };
  state.tasks.unshift(task);
  audit(state, "Operator assigned Depo a task", task.title);
  writeState(state);
  return state;
}

function createTaskFromTemplate(templateId) {
  const state = readState();
  const template = state.taskTemplates.find((item) => item.id === templateId);
  if (!template) {
    throw guardedError("Template not found", 404);
  }
  const classification = classifyTask(template.prompt, template.workflowId);
  const task = {
    id: `task-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: template.name,
    operatorText: template.prompt,
    workflowId: classification.workflowId,
    templateId: template.id,
    intent: classification.intent,
    risk: classification.risk,
    status: "queued",
    evidence: [],
    output: "",
    createdAt: now(),
    updatedAt: now(),
  };
  state.tasks.unshift(task);
  state.mission.activeWorkflowId = task.workflowId;
  state.mission.currentStep = 0;
  audit(state, "Template queued for Depo", `${template.name}: ${template.outcome}`);
  addMemory(state, "working", `Template queued: ${template.name}`, template.prompt, "task_template");
  writeState(state);
  return state;
}

function intentForWorkflow(workflowId) {
  if (workflowId === "workflow-stock-watch") return "market_monitoring";
  if (workflowId === "workflow-agent-factory") return "agent_factory";
  return "print_on_demand";
}

function riskForWorkflow(workflowId) {
  if (workflowId === "workflow-stock-watch") return "high";
  if (workflowId === "workflow-agent-factory") return "medium";
  return "low";
}

function runFunction(functionId, payload = {}) {
  const state = readState();
  enforceAutomationGuards(state, "function");
  const fn = state.functions.find((item) => item.id === functionId);
  if (!fn) {
    const error = new Error("Function not found");
    error.status = 404;
    throw error;
  }
  if (!["approved", "seeded"].includes(fn.status)) {
    const error = new Error("Function is not runnable");
    error.status = 409;
    throw error;
  }

  const operatorText = String(payload.input || "").trim() || `Run ${fn.name} with draft-only safeguards.`;
  const task = {
    id: `task-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: `${fn.name}: ${operatorText}`.slice(0, 90),
    operatorText,
    workflowId: fn.workflowId,
    functionId: fn.id,
    intent: intentForWorkflow(fn.workflowId),
    risk: fn.risk || riskForWorkflow(fn.workflowId),
    status: "queued",
    evidence: [
      `Function inputs: ${(fn.inputs || []).join(", ") || "unspecified"}.`,
      `Blocked actions: ${(fn.blockedActions || []).join(", ") || "none listed"}.`,
    ],
    output: "",
    createdAt: now(),
    updatedAt: now(),
  };
  state.tasks.unshift(task);

  const execution = {
    id: `exec-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    functionId: fn.id,
    functionName: fn.name,
    taskId: task.id,
    status: "queued_task",
    input: operatorText,
    risk: task.risk,
    createdAt: now(),
  };
  state.executions.unshift(execution);
  state.executions = state.executions.slice(0, 50);

  state.mission.activeWorkflowId = fn.workflowId;
  state.mission.currentStep = 0;
  recordAutomationCost(state, "function");
  addMemory(state, "working", `Function run queued: ${fn.name}`, operatorText, "function_execution");
  audit(state, "Depo queued a function run", `${fn.name} created a new supervised task.`);
  writeState(state);
  return state;
}

function runTask(taskId) {
  const state = readState();
  enforceAutomationGuards(state, "task");
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) {
    const error = new Error("Task not found");
    error.status = 404;
    throw error;
  }
  if (!["queued", "needs_revision"].includes(task.status)) {
    const error = new Error("Task is not runnable");
    error.status = 409;
    throw error;
  }

  const plan = taskPlan(task);
  const artifact = createArtifact(state, task, plan);
  task.status = "draft_ready";
  task.evidence = plan.evidence;
  task.output = plan.output;
  task.artifactId = artifact.id;
  task.updatedAt = now();
  state.mission.activeWorkflowId = task.workflowId;
  state.mission.currentStep = 3;
  recordAutomationCost(state, "task");

  addMemory(state, "working", `Task draft: ${task.title}`, task.output, "depo_task");
  audit(state, "Depo completed a task draft", `${task.title}: ${task.output}`);

  const approvalId = `approval-${task.id}`;
  const existingApproval = state.approvals.find((approval) => approval.id === approvalId && approval.status === "pending");
  if (!existingApproval) {
    state.approvals.unshift({
      id: approvalId,
      taskId: task.id,
      artifactId: artifact.id,
      title: plan.approvalTitle,
      risk: task.risk,
      evidence: plan.evidence.join(" "),
      action: plan.approvalAction,
      status: "pending",
      createdAt: now(),
    });
  }

  writeState(state);
  return state;
}

function runNextTask() {
  const state = readState();
  const task = state.tasks.find((item) => item.status === "queued" || item.status === "needs_revision");
  if (!task) {
    throw guardedError("No queued task is available for Depo.", 404);
  }
  return runTask(task.id);
}

function runWorkday(payload = {}) {
  const requestedLimit = Number(payload.limit || 3);
  const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 3, 5));
  const runIds = [];
  let state = readState();

  for (let index = 0; index < limit; index += 1) {
    const nextTask = state.tasks.find((item) => item.status === "queued" || item.status === "needs_revision");
    if (!nextTask) break;
    state = runTask(nextTask.id);
    runIds.push(nextTask.id);
  }

  state = readState();
  audit(state, "Supervised workday completed", `Depo processed ${runIds.length} queued task${runIds.length === 1 ? "" : "s"}.`);
  state.governance.lastWorkday = {
    runIds,
    limit,
    completedAt: now(),
  };
  writeState(state);
  return state;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function advanceCycle() {
  const state = readState();
  enforceAutomationGuards(state, "cycle");
  const steps = state.mission.steps;
  state.mission.currentStep = (state.mission.currentStep + 1) % steps.length;
  const step = steps[state.mission.currentStep];
  recordAutomationCost(state, "cycle");

  audit(state, `Depo moved to ${step.station}`, step.copy);

  if (step.station === "Draft") {
    addMemory(
      state,
      "working",
      "Draft artifact prepared",
      "Depo prepared the POD research lane as a reusable draft workflow. Publishing remains blocked.",
      "depo_cycle",
    );
  }

  if (step.station === "Approval") {
    const exists = state.approvals.some((approval) => approval.id === "approval-depo-cycle-package" && approval.status === "pending");
    if (!exists) {
      state.approvals.unshift({
        id: "approval-depo-cycle-package",
        title: "Review Depo cycle package",
        risk: "medium",
        evidence: "Latest cycle includes research, verification, draft, and policy classification.",
        action: "Review whether Depo can promote the POD workflow into shared memory.",
        status: "pending",
        createdAt: now(),
      });
    }
  }

  writeState(state);
  return state;
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, readState());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/cycle") {
    try {
      sendJson(res, 200, advanceCycle());
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/pause") {
    const state = readState();
    state.mission.paused = !state.mission.paused;
    audit(state, state.mission.paused ? "Operator paused Depo" : "Operator resumed Depo", "The supervised task cycle was toggled by the operator.");
    writeState(state);
    sendJson(res, 200, state);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/governance/kill-switch") {
    const payload = await readBody(req);
    const state = readState();
    const nextValue = typeof payload.enabled === "boolean" ? payload.enabled : !state.governance.killSwitch;
    state.governance.killSwitch = nextValue;
    state.mission.paused = nextValue ? true : state.mission.paused;
    audit(state, nextValue ? "Kill switch enabled" : "Kill switch disabled", "Operator changed Argentum's emergency execution guard.");
    writeState(state);
    sendJson(res, 200, state);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/governance/reset-loop") {
    const state = readState();
    state.governance.cycleCount = 0;
    state.governance.estimatedSpendUsd = 0;
    state.mission.paused = false;
    audit(state, "Loop guard reset", "Operator reset cycle count and estimated local sandbox spend.");
    writeState(state);
    sendJson(res, 200, state);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tasks") {
    const payload = await readBody(req);
    sendJson(res, 200, createTask(payload));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tasks/run-next") {
    try {
      sendJson(res, 200, runNextTask());
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/workday/run") {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, runWorkday(payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const templateMatch = url.pathname.match(/^\/api\/templates\/([^/]+)\/queue$/);
  if (req.method === "POST" && templateMatch) {
    try {
      sendJson(res, 200, createTaskFromTemplate(templateMatch[1]));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const functionRunMatch = url.pathname.match(/^\/api\/functions\/([^/]+)\/run$/);
  if (req.method === "POST" && functionRunMatch) {
    try {
      const payload = await readBody(req);
      sendJson(res, 200, runFunction(functionRunMatch[1], payload));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const taskRunMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/run$/);
  if (req.method === "POST" && taskRunMatch) {
    try {
      sendJson(res, 200, runTask(taskRunMatch[1]));
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }

  const approvalMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)\/(approve|revise|block)$/);
  if (req.method === "POST" && approvalMatch) {
    const [, approvalId, action] = approvalMatch;
    const state = readState();
    const approval = state.approvals.find((item) => item.id === approvalId);
    if (!approval) {
      sendJson(res, 404, { error: "Approval not found" });
      return;
    }
    if (approval.status !== "pending") {
      sendJson(res, 409, { error: "Approval is no longer pending" });
      return;
    }
    approval.status = action === "approve" ? "approved" : action === "revise" ? "needs_revision" : "blocked";
    approval.resolvedAt = now();
    audit(state, `Approval ${approval.status}`, `${approval.title}: ${approval.action}`);
    if (approval.taskId) {
      const task = state.tasks.find((item) => item.id === approval.taskId);
      if (task) {
        task.status = approval.status === "approved" ? "approved" : approval.status;
        task.updatedAt = now();
        if (approval.artifactId) {
          const artifact = state.artifacts.find((item) => item.id === approval.artifactId);
          if (artifact) {
            artifact.status = approval.status === "approved" ? "approved" : approval.status;
            artifact.updatedAt = now();
          }
        }
        if (approval.status === "approved") {
          const fn = promoteTaskToFunction(state, task);
          addMemory(state, "shared", `Approved task: ${task.title}`, task.output, "human_approval");
          addMemory(state, "agent", `Function learned: ${fn.name}`, fn.description, "function_library");
          audit(state, "Depo promoted a function", `${fn.name} is now available as an approved reusable function.`);
        }
      }
    }
    if (approval.status === "approved" && approval.id === "approval-pod-lane-v0") {
      addMemory(
        state,
        "shared",
        "POD research lane approved",
        "The operator approved Depo's print-on-demand research workflow as a reusable playbook.",
        "human_approval",
      );
      const workflow = state.workflows.find((item) => item.id === "workflow-pod-lab");
      if (workflow) workflow.status = "approved_playbook";
    }
    writeState(state);
    sendJson(res, 200, state);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reset") {
    const state = defaultState();
    writeState(state);
    sendJson(res, 200, state);
    return;
  }

  sendJson(res, 404, { error: "Unknown API route" });
}

function serveStatic(req, res, url) {
  let filePath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(ROOT, filePath);

  if (!absolutePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(absolutePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const type = mimeTypes[path.extname(absolutePath)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(data);
  });
}

ensureState();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Argentum is running on ${HOST}:${PORT}`);
});

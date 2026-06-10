const fallbackState = {
  meta: {
    mode: "static_fallback",
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
    lastWorkday: {
      runIds: [],
      limit: 3,
      completedAt: null,
    },
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
      "modify core systems",
    ],
  },
  mission: {
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
      },
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
    },
  ],
  functions: [
    {
      id: "func-pod-research-brief",
      name: "POD research brief",
      workflowId: "workflow-pod-lab",
      status: "seeded",
      risk: "low",
      description: "Reusable draft-only process for turning a print-on-demand niche idea into an evidence-labeled listing brief.",
      inputs: ["niche hypothesis", "product type", "evidence notes"],
      outputs: ["listing brief", "assumption log", "approval package"],
      blockedActions: ["publish listing", "create seller account", "purchase inventory", "make earnings claims"],
    },
  ],
  workflows: [
    {
      id: "workflow-pod-lab",
      name: "Print-on-demand lab",
      status: "active_draft",
      risk: "low",
      description: "Find niches, draft listings, estimate demand, and send publishing actions to approval.",
      nextFunction: "Generate a reusable listing research brief from evidence and assumptions.",
    },
    {
      id: "workflow-stock-watch",
      name: "Stock algorithm watch",
      status: "read_only",
      risk: "high",
      description: "Monitor signals and produce notes only. Trading remains blocked without approval.",
      nextFunction: "Create paper-trading notes without broker access or live execution.",
    },
    {
      id: "workflow-agent-factory",
      name: "Agent factory",
      status: "proposal_only",
      risk: "medium",
      description: "Draft new agent manifests, tests, budgets, and permissions as proposals.",
      nextFunction: "Propose a second agent only after Depo's first workflow is approved.",
    },
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
      id: "tpl-stock-watch-note",
      name: "Stock watch note",
      workflowId: "workflow-stock-watch",
      risk: "high",
      prompt: "Prepare a read-only stock algorithm watch note in paper mode. Do not connect a broker, place trades, move money, or make return claims.",
      outcome: "Paper-mode watch note",
    },
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
    },
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
    },
    {
      id: "approval-stock-readonly-v0",
      title: "Review stock algorithm monitor",
      risk: "high",
      evidence: "Signal summary only. Execution permissions blocked.",
      action: "Confirm this lane remains read-only and paper-trading only.",
      status: "pending",
    },
  ],
  memory: {
    working: [
      {
        title: "Current task",
        body: "Design a visible first-agent system for Argentum with Depo as the supervised starting worker.",
      },
      {
        title: "Open question",
        body: "Business domain priorities are Etsy print-on-demand first, stock algorithm monitoring second.",
      },
    ],
    shared: [
      {
        title: "Operating rule",
        body: "External publishing, trades, account creation, customer contact, and new agent deployment require human approval.",
      },
      {
        title: "MVP architecture",
        body: "Start with one visible agent, a small task loop, memory layers, approval queue, and audit trail.",
      },
    ],
    agent: [
      {
        title: "Depo identity",
        body: "Depo is the depository operator: gather, verify, draft, and package work for approval.",
      },
      {
        title: "Failure habit",
        body: "When evidence is stale, contradictory, or missing, Depo must ask for review instead of inventing certainty.",
      },
    ],
  },
  audit: [
    {
      title: "Static console loaded",
      body: "Start the local server with npm start to enable persistent memory, approvals, and Depo cycles.",
    },
  ],
};

let state = fallbackState;
let activeMemoryLayer = "working";
let cycleTimer = null;
let apiAvailable = false;

const avatar = document.querySelector("#depoAvatar");
const progress = document.querySelector("#missionProgress");
const cycleStatus = document.querySelector("#cycleStatus");
const missionTitle = document.querySelector("#missionTitle");
const missionCopy = document.querySelector("#missionCopy");
const confidenceChip = document.querySelector("#confidenceChip");
const taskStage = document.querySelector("#taskStage");
const riskLevel = document.querySelector("#riskLevel");
const pauseBtn = document.querySelector("#pauseBtn");
const runCycleBtn = document.querySelector("#runCycleBtn");
const notificationBtn = document.querySelector("#notificationBtn");
const notificationPanel = document.querySelector("#notificationPanel");
const notificationList = document.querySelector("#notificationList");
const notificationDot = document.querySelector("#notificationDot");
const adminMenuBtn = document.querySelector("#adminMenuBtn");
const adminMenu = document.querySelector("#adminMenu");
const adminSettingsBtn = document.querySelector("#adminSettingsBtn");
const profileInitials = document.querySelector("#profileInitials");
const settingsSessionInitials = document.querySelector("#settingsSessionInitials");
const settingsCurrentUser = document.querySelector("#settingsCurrentUser");
const settingsSessionMeta = document.querySelector("#settingsSessionMeta");
const settingsLoginHistory = document.querySelector("#settingsLoginHistory");
const securityScanBtn = document.querySelector("#securityScanBtn");
const settingsNavButtons = document.querySelectorAll("[data-settings-target]");
const capabilityList = document.querySelector("#capabilityList");
const approvalList = document.querySelector("#approvalList");
const queueCount = document.querySelector("#queueCount");
const artifactList = document.querySelector("#artifactList");
const artifactCount = document.querySelector("#artifactCount");
const memoryList = document.querySelector("#memoryList");
const auditLog = document.querySelector("#auditLog");
const systemFeedCard = document.querySelector("#systemFeedCard");
const systemFeedMini = document.querySelector("#systemFeedMini");
const systemFeedPageList = document.querySelector("#systemFeedPageList");
const feedBackBtn = document.querySelector("#feedBackBtn");
const workflowList = document.querySelector("#workflowList");
const templateList = document.querySelector("#templateList");
const templateCount = document.querySelector("#templateCount");
const agentState = document.querySelector("#agentState");
const taskForm = document.querySelector("#taskForm");
const taskInput = document.querySelector("#taskInput");
const taskWorkflow = document.querySelector("#taskWorkflow");
const taskList = document.querySelector("#taskList");
const taskCount = document.querySelector("#taskCount");
const functionList = document.querySelector("#functionList");
const functionCount = document.querySelector("#functionCount");
const executionList = document.querySelector("#executionList");
const executionCount = document.querySelector("#executionCount");
const killSwitchStatus = document.querySelector("#killSwitchStatus");
const runNextTaskBtn = document.querySelector("#runNextTaskBtn");
const runWorkdayBtn = document.querySelector("#runWorkdayBtn");
const killSwitchBtn = document.querySelector("#killSwitchBtn");
const resetLoopBtn = document.querySelector("#resetLoopBtn");
const cycleLimitMetric = document.querySelector("#cycleLimitMetric");
const spendMetric = document.querySelector("#spendMetric");
const budgetUsedMetric = document.querySelector("#budgetUsedMetric");
const agentCountMetric = document.querySelector("#agentCountMetric");
const agentStatusMetric = document.querySelector("#agentStatusMetric");
const liveRevenueMetric = document.querySelector("#liveRevenueMetric");
const overviewQueuedTaskMetric = document.querySelector("#overviewQueuedTaskMetric");
const overviewHighRiskTaskMetric = document.querySelector("#overviewHighRiskTaskMetric");
const overviewDraftReadyMetric = document.querySelector("#overviewDraftReadyMetric");
const overviewTotalTaskMetric = document.querySelector("#overviewTotalTaskMetric");
const workflowResearchMetric = document.querySelector("#workflowResearchMetric");
const workflowVerifyMetric = document.querySelector("#workflowVerifyMetric");
const workflowDraftMetric = document.querySelector("#workflowDraftMetric");
const workflowApprovalMetric = document.querySelector("#workflowApprovalMetric");
const revenueGuardMetric = document.querySelector("#revenueGuardMetric");
const mapAgentCount = document.querySelector("#mapAgentCount");
const mapTaskCount = document.querySelector("#mapTaskCount");
const mapApprovalCount = document.querySelector("#mapApprovalCount");
const mapSpendCount = document.querySelector("#mapSpendCount");
const mapMemoryCount = document.querySelector("#mapMemoryCount");
const mapLoopCount = document.querySelector("#mapLoopCount");
const mapOutputCount = document.querySelector("#mapOutputCount");
const mapAuditCount = document.querySelector("#mapAuditCount");
const taskRunMetric = document.querySelector("#taskRunMetric");
const functionRunMetric = document.querySelector("#functionRunMetric");
const lastWorkdayMetric = document.querySelector("#lastWorkdayMetric");
const queuedTaskMetric = document.querySelector("#queuedTaskMetric");
const pendingApprovalMetric = document.querySelector("#pendingApprovalMetric");
const approvedFunctionMetric = document.querySelector("#approvedFunctionMetric");
const highRiskMetric = document.querySelector("#highRiskMetric");
const readinessMetric = document.querySelector("#readinessMetric");
const artifactThroughputMetric = document.querySelector("#artifactThroughputMetric");
const podBriefMetric = document.querySelector("#podBriefMetric");
const marketNoteMetric = document.querySelector("#marketNoteMetric");
const functionGrowthMetric = document.querySelector("#functionGrowthMetric");
const approvalLoadMetric = document.querySelector("#approvalLoadMetric");
const riskQueueMetric = document.querySelector("#riskQueueMetric");
const stationMap = document.querySelector("#stationMap");
const habitatCanvas = document.querySelector("#habitatCanvas");
const zoomInBtn = document.querySelector("#zoomInBtn");
const zoomOutBtn = document.querySelector("#zoomOutBtn");
const zoomReadout = document.querySelector("#zoomReadout");
const centerMapBtn = document.querySelector("#centerMapBtn");
const fullscreenMapBtn = document.querySelector("#fullscreenMapBtn");
const systemClock = document.querySelector("#systemClock");
const systemDate = document.querySelector("#systemDate");
const backToHabitatBtn = document.querySelector("#backToHabitatBtn");
const inspectorPanel = document.querySelector("#inspectorPanel");
const inspectorType = document.querySelector("#inspectorType");
const inspectorTitle = document.querySelector("#inspectorTitle");
const inspectorSummary = document.querySelector("#inspectorSummary");
const inspectorChips = document.querySelector("#inspectorChips");
const inspectorGrid = document.querySelector("#inspectorGrid");
const inspectorActions = document.querySelector("#inspectorActions");
const activityFeed = document.querySelector("#activityFeed");
const workspaceOverlay = document.querySelector("#workspaceOverlay");
const workspaceEyebrow = document.querySelector("#workspaceEyebrow");
const workspaceTitle = document.querySelector("#workspaceTitle");
const workspaceGrid = document.querySelector("#workspaceGrid");
const workspaceFeed = document.querySelector("#workspaceFeed");
const closeWorkspaceBtn = document.querySelector("#closeWorkspaceBtn");
const accessUserCount = document.querySelector("#accessUserCount");
const accessUserList = document.querySelector("#accessUserList");
const accessAlert = document.querySelector("#accessAlert");
const passwordForm = document.querySelector("#passwordForm");
const createUserForm = document.querySelector("#createUserForm");

const roomProfiles = {
  Overview: {
    title: "Depo Habitat",
    type: "Agent Overview",
    status: "Supervised",
    roomClass: "station-overview",
    summary: "One active agent, Depo, runs a bounded loop: gather evidence, verify claims, draft outputs, and package anything risky for human approval.",
    agents: ["Depo"],
    connected: ["Research Intake", "Evidence Guard", "Human Gate"],
    tasks: ["Gather evidence", "Check contradictions", "Prepare approval-ready drafts"],
    activity: ["Depo is the only active agent.", "Revenue and external actions are not connected.", "Human approval remains required for high-risk actions."],
    metrics: [
      ["Agent count", "1"],
      ["Mode", "Draft only"],
      ["Revenue", "Not connected"],
    ],
  },
  Research: {
    title: "Research Intake",
    type: "AI Thinking",
    status: "Gathering",
    roomClass: "station-research",
    summary: "Depo collects source notes, labels freshness, and keeps assumptions separate from verified evidence.",
    agents: ["Depo"],
    connected: ["Private Memory", "Evidence Guard", "Task Inbox"],
    tasks: ["Collect source notes", "Label evidence freshness", "Capture open assumptions"],
    activity: ["Research stays read-only.", "Assumptions are labeled before reuse.", "Unclear evidence is routed to review."],
    metrics: [
      ["Freshness checks", "Required"],
      ["Evidence items", "2 min"],
      ["Guessing", "Blocked"],
    ],
  },
  Verify: {
    title: "Evidence Guard",
    type: "Security / Quality",
    status: "Protected",
    roomClass: "station-verify",
    summary: "Security and quality checks enforce contradiction review, confidence labels, password-protected access, and approval gates.",
    agents: ["Depo"],
    connected: ["Human Gate", "System Feed", "Budget Guard"],
    tasks: ["Check contradictions", "Classify policy risk", "Keep external actions locked"],
    activity: ["Password hashes stay server-side.", "Signed sessions use HttpOnly cookies.", "Financial, publishing, account, and customer actions are blocked."],
    metrics: [
      ["Blocked actions", "7"],
      ["Auth", "Hashed"],
      ["Sessions", "HttpOnly"],
    ],
  },
  Draft: {
    title: "Task Inbox",
    type: "Work Queue",
    status: "Queued",
    roomClass: "station-draft",
    summary: "Depo turns bounded operator requests into draft artifacts and never publishes or spends from this lane.",
    agents: ["Depo"],
    connected: ["Research Intake", "Output Bench", "Human Gate"],
    tasks: ["Run next queued task", "Build draft artifact", "Attach evidence notes"],
    activity: ["Tasks are operator assigned.", "Drafts are evidence-labeled.", "Promotion requires review."],
    metrics: [
      ["Queue", "Live"],
      ["Outputs", "Draft"],
      ["Publishing", "Blocked"],
    ],
  },
  Commerce: {
    title: "POD Lane",
    type: "Commerce Drafts",
    status: "Draft only",
    roomClass: "station-commerce",
    summary: "Print-on-demand planning is active as research and draft output only. Store setup, publishing, buying, and earnings claims remain blocked.",
    agents: ["Depo"],
    connected: ["Task Inbox", "Output Bench", "Human Gate"],
    tasks: ["Draft POD brief", "List blocked store actions", "Package review notes"],
    activity: ["No live storefront is connected.", "No order or revenue claims are shown.", "Listing plans stay approval-gated."],
    metrics: [
      ["Live orders", "0"],
      ["Live sales", "0"],
      ["Store access", "Blocked"],
    ],
  },
  Finance: {
    title: "Budget Guard",
    type: "Finance Safety",
    status: "Sandbox",
    roomClass: "station-finance",
    summary: "Budget tracking only covers local sandbox activity. Revenue, broker access, payment movement, and trades are not connected.",
    agents: ["Depo"],
    connected: ["Evidence Guard", "System Feed", "Human Gate"],
    tasks: ["Track sandbox spend", "Keep trade permissions blocked", "Log finance-related risk"],
    activity: ["Daily sandbox limit is $5.", "Money movement is blocked.", "Market notes remain paper-mode."],
    metrics: [
      ["Revenue", "Not connected"],
      ["Spend cap", "$5/day"],
      ["Money movement", "Blocked"],
    ],
  },
  Inventory: {
    title: "Private Memory",
    type: "Memory",
    status: "Local",
    roomClass: "station-inventory",
    summary: "Local memory stores working notes, verified shared notes, and agent-specific habits without committing runtime state to Git.",
    agents: ["Depo"],
    connected: ["Research Intake", "System Feed", "Output Bench"],
    tasks: ["Write provenance", "Keep runtime state local", "Separate working and verified memory"],
    activity: ["Runtime state is ignored by Git.", "Secrets are not stored in project memory.", "Depo memory is provenance-labeled."],
    metrics: [
      ["Memory layers", "3"],
      ["Runtime files", "Ignored"],
      ["Secrets", "Excluded"],
    ],
  },
  Logistics: {
    title: "Loop Guard",
    type: "Efficiency",
    status: "Bounded",
    roomClass: "station-logistics",
    summary: "The loop guard caps autonomous cycles and pauses Depo when the limit is reached or the kill switch is active.",
    agents: ["Depo"],
    connected: ["Task Inbox", "Evidence Guard", "System Feed"],
    tasks: ["Track cycle count", "Respect kill switch", "Keep task runs bounded"],
    activity: ["Cycle limits prevent runaway loops.", "Workday runs are capped.", "Every run writes audit history."],
    metrics: [
      ["Cycle cap", "12"],
      ["Workday cap", "5"],
      ["Kill switch", "Ready"],
    ],
  },
  Approval: {
    title: "Human Gate",
    type: "Approval Pipeline",
    status: "Required",
    roomClass: "station-approval",
    summary: "Draft outputs, future functions, business claims, publishing, finance actions, account changes, and new agents all wait for human review.",
    agents: ["Depo"],
    connected: ["Task Inbox", "Evidence Guard", "Output Bench"],
    tasks: ["Review draft package", "Approve or block outputs", "Keep risky actions supervised"],
    activity: ["High-risk actions require approval.", "Depo cannot approve its own work.", "Approved drafts can become reusable functions."],
    metrics: [
      ["Approval model", "Human"],
      ["Self-approval", "Blocked"],
      ["Promotion", "Reviewed"],
    ],
  },
  Marketing: {
    title: "Output Bench",
    type: "Draft Outputs",
    status: "Drafting",
    roomClass: "station-marketing",
    summary: "Depo produces bounded artifacts such as POD briefs, paper-mode market notes, and future-agent proposals.",
    agents: ["Depo"],
    connected: ["Task Inbox", "Private Memory", "Human Gate"],
    tasks: ["Draft artifact", "Attach blocked actions", "Send review package"],
    activity: ["Outputs are drafts.", "Claims need evidence.", "External publication is blocked."],
    metrics: [
      ["Artifacts", "Live"],
      ["Claims", "Evidence"],
      ["External post", "Blocked"],
    ],
  },
  Support: {
    title: "Contact Gate",
    type: "Privacy",
    status: "Blocked",
    roomClass: "station-support",
    summary: "Customer contact and outbound messages are blocked until the operator explicitly approves a future connector and workflow.",
    agents: ["Depo"],
    connected: ["Evidence Guard", "Human Gate", "System Feed"],
    tasks: ["Hold outbound contact", "Protect personal data", "Route privacy-sensitive work to review"],
    activity: ["No customer connector is enabled.", "No outbound messages are sent.", "Sensitive actions require explicit approval."],
    metrics: [
      ["Customer contact", "Blocked"],
      ["Outbound messages", "0"],
      ["Privacy gate", "On"],
    ],
  },
  Logs: {
    title: "System Feed",
    type: "Trace",
    status: "Recording",
    roomClass: "station-logs",
    summary: "The local audit feed records Depo cycles, operator actions, task runs, approval decisions, and security-relevant changes.",
    agents: ["Depo"],
    connected: ["Evidence Guard", "Loop Guard", "Private Memory"],
    tasks: ["Record events", "Expose recent actions", "Keep operator-visible trace"],
    activity: ["Audit entries are visible.", "Login/access history lives in settings.", "System feed opens from the overview card."],
    metrics: [
      ["Trace", "Local"],
      ["Feed", "Openable"],
      ["Retention", "Latest 12"],
    ],
  },
};

const agentProfiles = {
  depo: {
    name: "Depo",
    role: "Depository Operator",
    status: "Active supervised",
    room: "Overview",
    currentTask: "Gather evidence, verify assumptions, draft useful work, and package approval-ready decisions.",
    queue: ["Research intake", "Contradiction check", "Draft approval package"],
    actions: ["Maintains draft-only mode", "Keeps external actions gated", "Writes provenance-labeled memory"],
    permissions: ["Read/write working memory", "Draft artifacts", "Cannot publish, spend, trade, contact customers, or deploy agents"],
    modules: ["Research Intake", "Evidence Guard", "Human Gate"],
  },
};

const workspaceProfiles = {
  depo: {
    title: "Depo Workspace",
    eyebrow: "Agent 001 / Depository Operator",
    sections: [
      ["Current loop", "Research -> verify -> draft -> approval. Every risky action stops at the human gate."],
      ["Security", "Password-protected admin access, signed HttpOnly sessions, CSP headers, and blocked legacy defaults."],
      ["Privacy", "Runtime state and auth files stay local and ignored by Git. No customer connector is enabled."],
      ["Quality", "Requires evidence labels, contradiction checks, confidence labels, and policy classification before promotion."],
    ],
    feed: ["Depo is active supervised", "Live revenue is not connected", "External actions remain locked"],
  },
};

let selectedRoomKey = null;
let selectedAgentKey = null;
let mapView = { x: 0, y: 0, scale: 1 };
let isPanning = false;
let panStart = { x: 0, y: 0, viewX: 0, viewY: 0 };
let pointerCache = new Map();
let pinchStart = null;
let accessState = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
    },
    ...options,
  });
  if (!response.ok) {
    let message = `API request failed: ${response.status}`;
    try {
      const payload = await response.json();
      if (payload?.error) message = payload.error;
    } catch {
      // Keep the status-based message when the response is not JSON.
    }
    throw new Error(message);
  }
  return response.json();
}

async function postJson(path, payload = {}) {
  return api(path, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function loadState() {
  try {
    state = await api("/api/state");
    apiAvailable = true;
  } catch (error) {
    state = fallbackState;
    apiAvailable = false;
  }
  render();
}

async function mutate(path) {
  if (!apiAvailable) {
    return false;
  }
  state = await api(path, { method: "POST" });
  render();
  return true;
}

function currentStep() {
  return state.mission.steps[state.mission.currentStep % state.mission.steps.length];
}

function setStep() {
  const step = currentStep();
  const habitatCoordinates = {
    Research: { x: "42%", y: "41%" },
    Verify: { x: "58%", y: "41%" },
    Draft: { x: "42%", y: "65%" },
    Approval: { x: "58%", y: "65%" },
  };
  const coordinate = habitatCoordinates[step.station] || { x: step.x, y: step.y };
  avatar.style.setProperty("--agent-x", coordinate.x);
  avatar.style.setProperty("--agent-y", coordinate.y);
  progress.style.width = `${step.progress}%`;
  cycleStatus.textContent = state.mission.paused ? "Cycle paused" : `At ${step.station}`;
  missionTitle.textContent = step.title;
  missionCopy.textContent = step.copy;
  confidenceChip.textContent = `${step.confidence}% confidence`;
  taskStage.textContent = `Stage: ${step.station}`;
  riskLevel.textContent = `Risk: ${step.risk}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function applyMapView(animated = true) {
  if (!habitatCanvas) return;
  habitatCanvas.classList.toggle("is-animating", animated);
  habitatCanvas.style.transform = `translate3d(${mapView.x}px, ${mapView.y}px, 0) scale(${mapView.scale})`;
  if (zoomReadout) zoomReadout.textContent = `${Math.round(mapView.scale * 100)}%`;
  if (animated) {
    window.setTimeout(() => habitatCanvas.classList.remove("is-animating"), 420);
  }
}

function setMapView(nextView, animated = true) {
  mapView = {
    x: Number.isFinite(nextView.x) ? nextView.x : mapView.x,
    y: Number.isFinite(nextView.y) ? nextView.y : mapView.y,
    scale: clamp(Number.isFinite(nextView.scale) ? nextView.scale : mapView.scale, 0.72, 2.8),
  };
  applyMapView(animated);
}

function resetHabitatView(animated = true) {
  selectedRoomKey = null;
  selectedAgentKey = null;
  document.querySelectorAll(".station.selected").forEach((item) => item.classList.remove("selected"));
  document.querySelectorAll(".roster-agent.selected").forEach((item) => item.classList.remove("selected"));
  stationMap?.classList.remove("has-selection");
  setMapView({ x: 0, y: 0, scale: 1 }, animated);
  renderInspector();
}

function setMapFullscreen(open) {
  if (!stationMap || !fullscreenMapBtn) return;
  stationMap.classList.toggle("map-fullscreen", open);
  fullscreenMapBtn.title = open ? "Exit fullscreen map" : "Toggle fullscreen map";
  fullscreenMapBtn.setAttribute("aria-label", fullscreenMapBtn.title);
  window.setTimeout(() => applyMapView(), 80);
}

function zoomMap(delta, point) {
  if (!stationMap) return;
  const rect = stationMap.getBoundingClientRect();
  const anchor = point || { x: rect.width / 2, y: rect.height / 2 };
  const nextScale = clamp(mapView.scale + delta, 0.72, 2.8);
  const worldX = (anchor.x - mapView.x) / mapView.scale;
  const worldY = (anchor.y - mapView.y) / mapView.scale;
  setMapView({
    x: anchor.x - worldX * nextScale,
    y: anchor.y - worldY * nextScale,
    scale: nextScale,
  });
}

function stationElementForRoom(roomKey) {
  return document.querySelector(`.station[data-station="${CSS.escape(roomKey)}"]`);
}

function focusRoom(roomKey, options = {}) {
  const station = stationElementForRoom(roomKey);
  if (!station || !stationMap) return;
  const mapRect = stationMap.getBoundingClientRect();
  const centerX = station.offsetLeft + station.offsetWidth / 2;
  const centerY = station.offsetTop + station.offsetHeight / 2;
  const scale = options.scale || 1.72;
  selectedRoomKey = roomKey;
  if (options.agentKey) selectedAgentKey = options.agentKey;

  document.querySelectorAll(".station").forEach((item) => {
    item.classList.toggle("selected", item.dataset.station === roomKey);
  });
  document.querySelectorAll(".roster-agent").forEach((item) => {
    item.classList.toggle("selected", item.dataset.agent === selectedAgentKey);
  });
  stationMap.classList.add("has-selection");
  setMapView({
    x: mapRect.width / 2 - centerX * scale,
    y: mapRect.height / 2 - centerY * scale,
    scale,
  });
  renderInspector();
}

function listMarkup(items) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderInspector() {
  if (!inspectorPanel) return;
  const agent = selectedAgentKey ? agentProfiles[selectedAgentKey] : null;
  const room = selectedRoomKey ? roomProfiles[selectedRoomKey] : roomProfiles.Overview;
  const activeRoom = agent ? roomProfiles[agent.room] : room;

  inspectorPanel.classList.toggle("is-focused", Boolean(selectedRoomKey || selectedAgentKey));
  inspectorPanel.closest(".task-panel")?.classList.toggle("focused-inspector", Boolean(selectedRoomKey || selectedAgentKey));
  inspectorType.textContent = agent ? "Agent Detail" : activeRoom.type;
  inspectorTitle.textContent = agent ? `${agent.name} // ${agent.role}` : activeRoom.title;
  inspectorSummary.textContent = agent ? agent.currentTask : activeRoom.summary;

  inspectorChips.innerHTML = (agent
    ? [agent.status, activeRoom.title, `${agent.queue.length} queued`]
    : [
        activeRoom.status,
        `${activeRoom.agents.length} ${activeRoom.agents.length === 1 ? "agent" : "agents"}`,
        `${activeRoom.connected.length} links`,
      ]
  )
    .map((chip) => `<span>${escapeHtml(chip)}</span>`)
    .join("");

  inspectorGrid.innerHTML = agent
    ? `
      <div><span>Current task</span><strong>${escapeHtml(agent.currentTask)}</strong></div>
      <div><span>Queue</span>${listMarkup(agent.queue)}</div>
      <div><span>Permissions</span>${listMarkup(agent.permissions)}</div>
      <div><span>Connected modules</span>${listMarkup(agent.modules)}</div>
    `
    : `
      ${activeRoom.metrics.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}
      <div><span>Connected agents</span>${listMarkup(activeRoom.agents)}</div>
      <div><span>Connected modules</span>${listMarkup(activeRoom.connected)}</div>
      <div><span>Active tasks</span>${listMarkup(activeRoom.tasks)}</div>
    `;

  inspectorActions.innerHTML = agent
    ? `
      <button class="small-button" type="button" data-inspector-action="tasks">View tasks</button>
      <button class="small-button" type="button" data-inspector-action="workspace" data-agent="${escapeHtml(selectedAgentKey)}">Open workspace</button>
      <button class="ghost-button" type="button" data-inspector-action="check">Run check</button>
      <button class="ghost-button" type="button" data-inspector-action="pause">Pause agent</button>
      <button class="ghost-button" type="button" data-inspector-action="logs">View logs</button>
    `
    : `
      <button class="small-button" type="button" data-inspector-action="room-tasks">View tasks</button>
      <button class="ghost-button" type="button" data-inspector-action="room-logs">View logs</button>
    `;

  const feed = agent ? agent.actions : activeRoom.activity;
  activityFeed.innerHTML = feed
    .map((item) => `<article><span></span><p>${escapeHtml(item)}</p></article>`)
    .join("");
}

function openAgent(agentKey) {
  const agent = agentProfiles[agentKey];
  if (!agent) return;
  selectedAgentKey = agentKey;
  focusRoom(agent.room, { scale: 1.9, agentKey });
}

function renderWorkspace(agentKey) {
  const agent = agentProfiles[agentKey];
  if (!agent) return;
  const profile = workspaceProfiles[agentKey] || {
    title: `${agent.name} Workspace`,
    eyebrow: agent.role,
    sections: [
      ["Current task", agent.currentTask],
      ["Queue", agent.queue.join(", ")],
      ["Permissions", agent.permissions.join(", ")],
      ["Connected modules", agent.modules.join(", ")],
    ],
    feed: agent.actions,
  };
  workspaceEyebrow.textContent = profile.eyebrow;
  workspaceTitle.textContent = profile.title;
  workspaceGrid.innerHTML = profile.sections
    .map(([label, body]) => `<div><span>${escapeHtml(label)}</span><p>${escapeHtml(body)}</p></div>`)
    .join("");
  workspaceFeed.innerHTML = profile.feed
    .map((item) => `<article><span></span><p>${escapeHtml(item)}</p></article>`)
    .join("");
}

function openWorkspace(agentKey) {
  renderWorkspace(agentKey || selectedAgentKey || "depo");
  workspaceOverlay.classList.add("open");
  workspaceOverlay.setAttribute("aria-hidden", "false");
}

function closeWorkspace() {
  workspaceOverlay.classList.remove("open");
  workspaceOverlay.setAttribute("aria-hidden", "true");
}

function updateSystemClock() {
  if (!systemClock || !systemDate) return;
  const nowDate = new Date();
  systemClock.textContent = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(nowDate);
  systemDate.textContent = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(nowDate);
}

function showAccessMessage(message, type = "info") {
  if (!accessAlert) return;
  accessAlert.hidden = false;
  accessAlert.className = `access-alert ${type}`;
  accessAlert.textContent = message;
}

function clearAccessMessage() {
  if (!accessAlert) return;
  accessAlert.hidden = true;
  accessAlert.textContent = "";
}

function profileBadgeText(username) {
  const compact = String(username || "").trim().replace(/[^a-z0-9]/gi, "");
  return compact ? compact.slice(0, 2).toLowerCase() : "--";
}

function renderProfileIdentity(user) {
  const badge = profileBadgeText(user?.username);
  if (profileInitials) profileInitials.textContent = badge;
  if (settingsSessionInitials) settingsSessionInitials.textContent = badge;
  if (settingsCurrentUser) settingsCurrentUser.textContent = user?.username || "Signed-in user";
  if (settingsSessionMeta) {
    const host = window.location.hostname || "127.0.0.1";
    settingsSessionMeta.textContent = `Browser session - ${host}`;
  }
}

async function loadProfileIdentity() {
  if (!profileInitials || !apiAvailable) return;
  try {
    const access = await api("/api/access");
    renderProfileIdentity(access.currentUser);
    if (accessUserList && !accessState) {
      accessState = access;
      renderAccessState();
    }
  } catch {
    renderProfileIdentity(null);
  }
}

async function loadAccessState() {
  if (!accessUserList) return;
  try {
    accessState = await api("/api/access");
    renderAccessState();
  } catch (error) {
    showAccessMessage(error.message, "error");
  }
}

function renderAccessState() {
  if (!accessState || !accessUserList) return;
  renderProfileIdentity(accessState.currentUser);
  const users = accessState.users || [];
  accessUserCount.textContent = `${users.length} ${users.length === 1 ? "user" : "users"}`;
  renderLoginHistory(users);
  accessUserList.innerHTML = users
    .map((user) => {
      const isCurrent = accessState.currentUser?.id === user.id;
      const canDelete = !isCurrent && users.filter((item) => !item.disabled).length > 1;
      return `
        <article class="access-user-card ${isCurrent ? "current" : ""}">
          <div>
            <div class="access-user-top">
              <strong>${escapeHtml(user.username)}</strong>
              <span>${escapeHtml(user.role)}</span>
              ${isCurrent ? "<em>current</em>" : ""}
              ${user.temporary ? "<em class=\"warning\">temporary</em>" : ""}
            </div>
            <p>${user.lastLoginAt ? `Last login ${escapeHtml(new Date(user.lastLoginAt).toLocaleString())}` : "No login recorded yet"}</p>
          </div>
          <button class="danger-button" type="button" data-access-delete="${escapeHtml(user.id)}" ${canDelete ? "" : "disabled"}>Delete</button>
        </article>
      `;
    })
    .join("");
}

function renderLoginHistory(users) {
  if (!settingsLoginHistory) return;
  const rows = [...users]
    .filter((user) => user.lastLoginAt)
    .sort((left, right) => new Date(right.lastLoginAt) - new Date(left.lastLoginAt))
    .slice(0, 4);

  if (!rows.length) {
    settingsLoginHistory.innerHTML = `
      <div class="login-history-row muted-row">
        <span>No login history yet</span>
        <span>127.0.0.1</span>
        <strong>Ready</strong>
      </div>
    `;
    return;
  }

  settingsLoginHistory.innerHTML = rows
    .map(
      (user) => `
        <div class="login-history-row">
          <span>${escapeHtml(new Date(user.lastLoginAt).toLocaleString())}</span>
          <span>${escapeHtml(user.username)}</span>
          <strong>Success</strong>
        </div>
      `,
    )
    .join("");
}

function renderCapabilities() {
  capabilityList.innerHTML = state.capabilities
    .map(
      (capability) => `
        <article class="capability-item">
          <div>
            <strong>${escapeHtml(capability.name)}</strong>
            <p>${escapeHtml(capability.description)}</p>
          </div>
          <button class="small-button" type="button" data-capability="${escapeHtml(capability.id)}">${escapeHtml(capability.status)}</button>
        </article>
      `,
    )
    .join("");
}

function workflowIcon(workflow) {
  if (workflow.id.includes("stock")) {
    return `<svg viewBox="0 0 24 24"><path d="M4 18l5-6 4 3 7-9"/><path d="M4 20h18"/></svg>`;
  }
  if (workflow.id.includes("factory")) {
    return `<svg viewBox="0 0 24 24"><path d="M12 3v18"/><path d="M6 8h12"/><path d="M6 16h12"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24"><path d="M4 7h16v13H4z"/><path d="M8 7a4 4 0 0 1 8 0"/></svg>`;
}

function renderWorkflows() {
  workflowList.innerHTML = state.workflows
    .map(
      (workflow) => `
        <article class="pipeline-card ${workflow.id === state.mission.activeWorkflowId ? "active-pipeline" : ""}">
          <div class="pipeline-icon" aria-hidden="true">${workflowIcon(workflow)}</div>
          <div>
            <div class="workflow-title-row">
              <h4>${escapeHtml(workflow.name)}</h4>
              <span class="risk-tag ${escapeHtml(workflow.risk)}">${escapeHtml(workflow.status.replaceAll("_", " "))}</span>
            </div>
            <p>${escapeHtml(workflow.description)}</p>
            <p class="next-function"><strong>Next:</strong> ${escapeHtml(workflow.nextFunction)}</p>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderTemplates() {
  const templates = state.taskTemplates || [];
  templateCount.textContent = `${templates.length} ${templates.length === 1 ? "template" : "templates"}`;
  if (templates.length === 0) {
    templateList.innerHTML = `
      <article class="template-item empty-state">
        <strong>No templates yet</strong>
        <p>Templates will appear here as Argentum gains repeatable business lanes.</p>
      </article>
    `;
    return;
  }

  templateList.innerHTML = templates
    .map(
      (template) => `
        <article class="template-item">
          <div>
            <div class="task-top">
              <strong>${escapeHtml(template.name)}</strong>
              <span class="risk-tag ${escapeHtml(template.risk)}">${escapeHtml(template.risk)} risk</span>
            </div>
            <p>${escapeHtml(template.prompt)}</p>
            <div class="task-meta">
              <span>${escapeHtml(workflowName(template.workflowId))}</span>
              <span>${escapeHtml(template.outcome)}</span>
            </div>
          </div>
          <button class="small-button" type="button" data-template-queue="${escapeHtml(template.id)}">Queue</button>
        </article>
      `,
    )
    .join("");
}

function pendingApprovals() {
  return state.approvals.filter((approval) => approval.status === "pending");
}

function renderApprovals() {
  const approvals = pendingApprovals();
  queueCount.textContent = `${approvals.length} pending`;
  if (approvals.length === 0) {
    approvalList.innerHTML = `
      <article class="approval-item empty-state">
        <strong>No pending approvals</strong>
        <p>Depo will create new approval packages when a workflow reaches the human gate.</p>
      </article>
    `;
    return;
  }
  approvalList.innerHTML = approvals
    .map(
      (approval) => `
        <article class="approval-item">
          <div class="approval-top">
            <div>
              <strong>${escapeHtml(approval.title)}</strong>
              <p>${escapeHtml(approval.action)}</p>
            </div>
            <span class="risk-tag ${escapeHtml(approval.risk)}">${escapeHtml(approval.risk)} risk</span>
          </div>
          <p><strong>Evidence:</strong> ${escapeHtml(approval.evidence)}</p>
          <div class="approval-actions">
            <button class="ghost-button" type="button" data-approval-action="revise" data-approval-id="${escapeHtml(approval.id)}">Send back</button>
            <button class="small-button" type="button" data-approval-action="approve" data-approval-id="${escapeHtml(approval.id)}">Approve draft</button>
            <button class="danger-button" type="button" data-approval-action="block" data-approval-id="${escapeHtml(approval.id)}">Block</button>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderArtifacts() {
  const artifacts = state.artifacts || [];
  artifactCount.textContent = `${artifacts.length} ${artifacts.length === 1 ? "artifact" : "artifacts"}`;
  if (artifacts.length === 0) {
    artifactList.innerHTML = `
      <article class="artifact-item empty-state">
        <strong>No artifacts yet</strong>
        <p>Run a Depo task to produce a POD brief, stock watch note, or agent proposal.</p>
      </article>
    `;
    return;
  }

  artifactList.innerHTML = artifacts
    .map(
      (artifact) => `
        <article class="artifact-item">
          <div class="task-top">
            <div>
              <strong>${escapeHtml(artifact.title)}</strong>
              <p>${escapeHtml(artifact.summary)}</p>
            </div>
            <span class="risk-tag ${escapeHtml(artifact.risk)}">${escapeHtml(statusLabel(artifact.status))}</span>
          </div>
          <div class="task-meta">
            <span>${escapeHtml(statusLabel(artifact.type))}</span>
            <span>${escapeHtml(workflowName(artifact.workflowId))}</span>
          </div>
          <div class="artifact-sections">
            ${(artifact.sections || [])
              .map(
                (section) => `
                  <div>
                    <span>${escapeHtml(section.label)}</span>
                    <p>${escapeHtml(section.body)}</p>
                  </div>
                `,
              )
              .join("")}
          </div>
          <div class="artifact-evidence">
            <div>
              <span>Evidence</span>
              <p>${escapeHtml((artifact.evidence || []).join(" "))}</p>
            </div>
            <div>
              <span>Blocked</span>
              <p>${escapeHtml((artifact.blockedActions || []).join(", "))}</p>
            </div>
          </div>
        </article>
      `,
    )
    .join("");
}

function statusLabel(value) {
  return String(value || "").replaceAll("_", " ");
}

function workflowName(id) {
  return state.workflows.find((workflow) => workflow.id === id)?.name || "Auto routed";
}

function renderTasks() {
  const tasks = state.tasks || [];
  taskCount.textContent = `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`;
  if (tasks.length === 0) {
    taskList.innerHTML = `
      <article class="task-item empty-state">
        <strong>No tasks yet</strong>
        <p>Assign Depo one bounded business job and it will prepare a draft for approval.</p>
      </article>
    `;
    return;
  }

  taskList.innerHTML = tasks
    .map((task) => {
      const runnable = ["queued", "needs_revision"].includes(task.status);
      return `
        <article class="task-item">
          <div class="task-top">
            <div>
              <strong>${escapeHtml(task.title)}</strong>
              <p>${escapeHtml(task.operatorText)}</p>
            </div>
            <span class="risk-tag ${escapeHtml(task.risk)}">${escapeHtml(statusLabel(task.status))}</span>
          </div>
          <div class="task-meta">
            <span>${escapeHtml(workflowName(task.workflowId))}</span>
            <span>${escapeHtml(task.intent)}</span>
          </div>
          ${task.output ? `<p class="task-output">${escapeHtml(task.output)}</p>` : ""}
          ${
            task.evidence?.length
              ? `<ul class="evidence-list">${task.evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
              : ""
          }
          <div class="task-actions">
            <button class="small-button" type="button" data-task-run="${escapeHtml(task.id)}" ${runnable ? "" : "disabled"}>Run Depo</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderFunctions() {
  const functions = state.functions || [];
  functionCount.textContent = `${functions.length} ${functions.length === 1 ? "function" : "functions"}`;
  if (functions.length === 0) {
    functionList.innerHTML = `
      <article class="function-item empty-state">
        <strong>No reusable functions yet</strong>
        <p>Approve a Depo task output to promote it into a reusable function.</p>
      </article>
    `;
    return;
  }

  functionList.innerHTML = functions
    .map(
      (fn) => `
        <article class="function-item">
          <div class="task-top">
            <div>
              <strong>${escapeHtml(fn.name)}</strong>
              <p>${escapeHtml(fn.description)}</p>
            </div>
            <span class="risk-tag ${escapeHtml(fn.risk)}">${escapeHtml(statusLabel(fn.status))}</span>
          </div>
          <div class="function-grid">
            <div>
              <span>Inputs</span>
              <p>${escapeHtml((fn.inputs || []).join(", "))}</p>
            </div>
            <div>
              <span>Outputs</span>
              <p>${escapeHtml((fn.outputs || []).join(", "))}</p>
            </div>
            <div>
              <span>Blocked</span>
              <p>${escapeHtml((fn.blockedActions || []).join(", "))}</p>
            </div>
          </div>
          <div class="function-runner">
            <input type="text" data-function-input="${escapeHtml(fn.id)}" placeholder="Optional run input" />
            <button class="small-button" type="button" data-function-run="${escapeHtml(fn.id)}">Run function</button>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderExecutions() {
  const executions = state.executions || [];
  executionCount.textContent = `${executions.length} ${executions.length === 1 ? "run" : "runs"}`;
  if (executions.length === 0) {
    executionList.innerHTML = `
      <article class="execution-item empty-state">
        <strong>No function runs yet</strong>
        <p>Run an approved function to create a supervised Depo task.</p>
      </article>
    `;
    return;
  }

  executionList.innerHTML = executions
    .slice(0, 8)
    .map(
      (execution) => `
        <article class="execution-item">
          <div class="task-top">
            <div>
              <strong>${escapeHtml(execution.functionName)}</strong>
              <p>${escapeHtml(execution.input)}</p>
            </div>
            <span class="risk-tag ${escapeHtml(execution.risk)}">${escapeHtml(statusLabel(execution.status))}</span>
          </div>
          <div class="task-meta">
            <span>${escapeHtml(execution.taskId)}</span>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderMemory() {
  const entries = state.memory[activeMemoryLayer] || [];
  memoryList.innerHTML = entries
    .map(
      (entry) => `
        <article class="memory-item">
          <strong>${escapeHtml(entry.title)}</strong>
          <p>${escapeHtml(entry.body)}</p>
          <span class="memory-source">${escapeHtml(entry.provenance || "local")}</span>
        </article>
      `,
    )
    .join("");
}

function systemFeedEntries() {
  const auditEntries = Array.isArray(state.audit) ? state.audit : [];
  const seededEntries = [
    {
      title: "Depo guardrails active",
      body: "Draft-only mode is active and external actions remain blocked.",
    },
    {
      title: "Human gate ready",
      body: "Risky work is routed to the approval queue before any external action.",
    },
    {
      title: "Privacy mode local",
      body: "Runtime state and auth files stay local and are ignored by Git.",
    },
    {
      title: "Revenue not connected",
      body: "No storefront, payment, broker, or customer-contact connector is enabled.",
    },
  ];

  return [...auditEntries, ...seededEntries].slice(0, 12).map((entry, index) => ({
    title: entry.title || "System event",
    body: entry.body || "Event recorded in the local console.",
    createdAt: entry.createdAt || entry.timestamp || "",
    index,
  }));
}

function formatFeedTime(entry) {
  if (entry.createdAt) {
    const date = new Date(entry.createdAt);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
  }
  if (entry.index === 0) return "Just now";
  return `${entry.index * 2}m ago`;
}

function compactFeedTitle(title) {
  const normalizedTitle = String(title || "");
  const compactTitles = {
    "Static console loaded": "Console loaded",
    "Depo guardrails active": "Guardrails active",
    "Human gate ready": "Human gate ready",
    "Privacy mode local": "Privacy local",
    "Revenue not connected": "Revenue offline",
  };

  if (compactTitles[normalizedTitle]) return compactTitles[normalizedTitle];
  if (normalizedTitle.length <= 24) return normalizedTitle;
  return `${normalizedTitle.slice(0, 21)}...`;
}

function renderSystemFeed() {
  const entries = systemFeedEntries();

  if (systemFeedMini) {
    systemFeedMini.innerHTML = entries
      .slice(0, 4)
      .map(
        (entry) => `
          <span>
            <strong>${escapeHtml(compactFeedTitle(entry.title))}</strong>
            <em>${escapeHtml(formatFeedTime(entry))}</em>
          </span>
        `,
      )
      .join("");
  }

  if (systemFeedPageList) {
    systemFeedPageList.innerHTML = entries
      .map(
        (entry) => `
          <article class="system-feed-row">
            <span aria-hidden="true"></span>
            <div>
              <strong>${escapeHtml(entry.title)}</strong>
              <p>${escapeHtml(entry.body)}</p>
            </div>
            <em>${escapeHtml(formatFeedTime(entry))}</em>
          </article>
        `,
      )
      .join("");
  }
}

function renderAudit() {
  auditLog.innerHTML = state.audit
    .slice(0, 12)
    .map(
      (entry) => `
        <article class="audit-item">
          <strong>${escapeHtml(entry.title)}</strong>
          <p>${escapeHtml(entry.body)}</p>
        </article>
      `,
    )
    .join("");
  renderSystemFeed();
}

function renderAgent() {
  agentState.textContent = state.agent.state.replaceAll("_", " / ");
  const manifestItems = document.querySelectorAll(".manifest-grid dd");
  manifestItems[1].textContent = state.agent.spendLimit;
  manifestItems[2].textContent = state.agent.externalActions;
  manifestItems[3].textContent = state.agent.memoryAccess;
}

function renderStatus() {
  const paused = Boolean(state.mission.paused);
  pauseBtn.classList.toggle("is-active", paused);
  pauseBtn.setAttribute("aria-label", paused ? "Resume Depo" : "Pause Depo");
  pauseBtn.title = paused ? "Resume Depo" : "Pause Depo";
  pauseBtn.innerHTML = paused
    ? `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`
    : `<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>`;
}

function notificationItems() {
  const approvals = state.approvals || [];
  const tasks = state.tasks || [];
  const governance = state.governance || fallbackState.governance;
  const items = [];
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  const queuedTasks = tasks.filter((task) => task.status === "queued");

  if (pendingApprovals.length) {
    items.push({
      title: `${pendingApprovals.length} approval${pendingApprovals.length === 1 ? "" : "s"} waiting`,
      body: pendingApprovals[0].title,
    });
  }
  if (queuedTasks.length) {
    items.push({
      title: `${queuedTasks.length} queued task${queuedTasks.length === 1 ? "" : "s"}`,
      body: queuedTasks[0].title,
    });
  }
  if (governance.killSwitch) {
    items.push({
      title: "Kill switch enabled",
      body: "Automation is stopped until the operator disables the guard.",
    });
  }
  if (state.mission.paused) {
    items.push({
      title: "Cycle paused",
      body: "Depo will hold the current stage until resumed.",
    });
  }
  return items.slice(0, 4);
}

function renderNotifications() {
  if (!notificationList || !notificationBtn || !notificationDot) return;
  const items = notificationItems();
  notificationBtn.classList.toggle("has-alerts", items.length > 0);
  notificationDot.hidden = items.length === 0;
  notificationList.innerHTML = items.length
    ? items
        .map(
          (item) => `
            <article>
              <strong>${escapeHtml(item.title)}</strong>
              <p>${escapeHtml(item.body)}</p>
            </article>
          `,
        )
        .join("")
    : `
        <article>
          <strong>All clear</strong>
          <p>No queued alerts need operator attention.</p>
        </article>
      `;
}

function setNotificationsOpen(open) {
  if (!notificationPanel || !notificationBtn) return;
  notificationPanel.hidden = !open;
  notificationBtn.classList.toggle("is-active", open);
  notificationBtn.setAttribute("aria-expanded", String(open));
}

function setAdminMenuOpen(open) {
  if (!adminMenu || !adminMenuBtn) return;
  adminMenu.hidden = !open;
  adminMenuBtn.classList.toggle("is-active", open);
  adminMenuBtn.setAttribute("aria-expanded", String(open));
  if (!open) setNotificationsOpen(false);
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function setText(element, value) {
  if (element) element.textContent = value;
}

function renderOverviewTelemetry() {
  const governance = state.governance || fallbackState.governance;
  const tasks = state.tasks || [];
  const artifacts = state.artifacts || [];
  const approvals = state.approvals || [];
  const memory = state.memory || {};
  const auditEntries = state.audit || [];
  const queuedTasks = tasks.filter((task) => task.status === "queued");
  const draftReadyTasks = tasks.filter((task) => task.status === "draft_ready");
  const highRiskTasks = tasks.filter((task) => task.risk === "high");
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  const highRiskApprovals = pendingApprovals.filter((approval) => approval.risk === "high");
  const memoryCount = ["working", "shared", "agent"].reduce((count, layer) => count + (memory[layer]?.length || 0), 0);
  const agentStateLabel = statusLabel(state.agent?.state || "active_supervised");

  setText(agentCountMetric, "1");
  setText(agentStatusMetric, agentStateLabel);
  setText(liveRevenueMetric, "Not connected");
  setText(budgetUsedMetric, money(governance.estimatedSpendUsd));
  setText(overviewQueuedTaskMetric, String(queuedTasks.length));
  setText(overviewHighRiskTaskMetric, String(highRiskTasks.length));
  setText(overviewDraftReadyMetric, String(draftReadyTasks.length));
  setText(overviewTotalTaskMetric, String(tasks.length));
  setText(workflowResearchMetric, queuedTasks.length ? "Queued" : "Ready");
  setText(workflowVerifyMetric, "On");
  setText(workflowDraftMetric, String(artifacts.length));
  setText(workflowApprovalMetric, String(pendingApprovals.length));
  setText(revenueGuardMetric, "No live sales");

  setText(mapAgentCount, "1 agent");
  setText(mapTaskCount, `${queuedTasks.length} queued`);
  setText(mapApprovalCount, `${pendingApprovals.length} pending`);
  setText(mapSpendCount, `${money(governance.estimatedSpendUsd)} used`);
  setText(mapMemoryCount, `${memoryCount} notes`);
  setText(mapLoopCount, `${governance.cycleCount} / ${governance.cycleLimit} cycles`);
  setText(mapOutputCount, `${artifacts.length} drafts`);
  setText(mapAuditCount, `${Math.min(auditEntries.length, 50)} events`);
  setText(highRiskMetric, String(highRiskApprovals.length));
}

function renderGovernance() {
  const governance = state.governance || fallbackState.governance;
  const approvals = state.approvals || [];
  const tasks = state.tasks || [];
  const functions = state.functions || [];
  killSwitchStatus.textContent = governance.killSwitch ? "Kill switch on" : "Kill switch off";
  killSwitchStatus.className = governance.killSwitch ? "status-pill danger-status" : "status-pill";
  killSwitchBtn.textContent = governance.killSwitch ? "Disable kill switch" : "Enable kill switch";
  cycleLimitMetric.textContent = `${governance.cycleCount} / ${governance.cycleLimit}`;
  spendMetric.textContent = `${money(governance.estimatedSpendUsd)} / ${money(governance.dailySpendLimitUsd)}`;
  taskRunMetric.textContent = String(governance.taskRunCount);
  functionRunMetric.textContent = String(governance.functionRunCount);
  lastWorkdayMetric.textContent = `${governance.lastWorkday?.runIds?.length || 0} tasks`;
  queuedTaskMetric.textContent = String(tasks.filter((task) => task.status === "queued").length);
  pendingApprovalMetric.textContent = String(approvals.filter((approval) => approval.status === "pending").length);
  approvedFunctionMetric.textContent = String(functions.filter((fn) => ["approved", "seeded"].includes(fn.status)).length);
  highRiskMetric.textContent = String(approvals.filter((approval) => approval.status === "pending" && approval.risk === "high").length);
}

function renderKpis() {
  const artifacts = state.artifacts || [];
  const approvals = state.approvals || [];
  const functions = state.functions || [];
  const approvedArtifacts = artifacts.filter((artifact) => artifact.status === "approved").length;
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending").length;
  const highRiskApprovals = approvals.filter((approval) => approval.status === "pending" && approval.risk === "high").length;
  const podBriefs = artifacts.filter((artifact) => artifact.type === "pod_brief").length;
  const marketNotes = artifacts.filter((artifact) => artifact.type === "stock_watch_note").length;
  const approvalDrag = Math.min(pendingApprovals * 5, 45);
  const readiness = Math.max(
    0,
    Math.min(100, Math.round(approvedArtifacts * 18 + functions.length * 12 + artifacts.length * 4 - approvalDrag)),
  );

  readinessMetric.textContent = `${readiness}% ready`;
  artifactThroughputMetric.textContent = String(artifacts.length);
  podBriefMetric.textContent = String(podBriefs);
  marketNoteMetric.textContent = String(marketNotes);
  functionGrowthMetric.textContent = String(functions.length);
  approvalLoadMetric.textContent = String(pendingApprovals);
  riskQueueMetric.textContent = String(highRiskApprovals);
}

function render() {
  setStep();
  renderStatus();
  renderNotifications();
  renderGovernance();
  renderKpis();
  renderOverviewTelemetry();
  renderAgent();
  renderCapabilities();
  renderWorkflows();
  renderTemplates();
  renderTasks();
  renderFunctions();
  renderExecutions();
  renderApprovals();
  renderArtifacts();
  renderMemory();
  renderAudit();
  renderInspector();
}

function addLocalAudit(title, body) {
  state.audit.unshift({
    title,
    body,
  });
  state.audit = state.audit.slice(0, 12);
}

function startCycle() {
  clearInterval(cycleTimer);
  cycleTimer = setInterval(() => {
    if (state.mission.paused) return;
    const governance = state.governance || fallbackState.governance;
    if (governance.killSwitch || governance.cycleCount >= governance.cycleLimit) return;
    if (!apiAvailable) {
      state.mission.currentStep = (state.mission.currentStep + 1) % state.mission.steps.length;
      render();
      return;
    }
    mutate("/api/cycle").catch((error) => {
      addLocalAudit("Cycle unavailable", error.message);
      loadState();
      render();
    });
  }, 5200);
}

function activateView(viewName) {
  const target = document.querySelector(`#view-${CSS.escape(viewName)}`);
  if (!target) return;
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === viewName);
  });
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  target.classList.add("active");
  if (viewName === "settings") {
    loadAccessState();
  }
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => activateView(button.dataset.view));
});

function openSystemFeed() {
  renderSystemFeed();
  activateView("feed");
}

systemFeedCard?.addEventListener("click", openSystemFeed);
systemFeedCard?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  openSystemFeed();
});
feedBackBtn?.addEventListener("click", () => activateView("floor"));

settingsNavButtons.forEach((button) => {
  button.addEventListener("click", () => {
    settingsNavButtons.forEach((item) => item.classList.toggle("active", item === button));
    const target = document.querySelector(`#${CSS.escape(button.dataset.settingsTarget)}`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

securityScanBtn?.addEventListener("click", () => {
  loadAccessState();
  showAccessMessage("Security scan complete. Password hashing, signed sessions, legacy-default blocking, and approval gates are active.", "success");
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    activeMemoryLayer = tab.dataset.memory;
    renderMemory();
  });
});

document.querySelectorAll(".station").forEach((station) => {
  station.setAttribute("role", "button");
  station.setAttribute("tabindex", "0");
  station.addEventListener("click", (event) => {
    event.stopPropagation();
    selectedAgentKey = null;
    focusRoom(station.dataset.station);
  });
  station.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectedAgentKey = null;
    focusRoom(station.dataset.station);
  });
});

document.querySelectorAll(".roster-agent").forEach((agentNode) => {
  const activate = () => openAgent(agentNode.dataset.agent);
  agentNode.addEventListener("click", activate);
  agentNode.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate();
  });
});

stationMap.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = stationMap.getBoundingClientRect();
  const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  zoomMap(event.deltaY > 0 ? -0.12 : 0.12, point);
}, { passive: false });

stationMap.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".map-controls") || event.target.closest(".station")) return;
  pointerCache.set(event.pointerId, { x: event.clientX, y: event.clientY });
  stationMap.setPointerCapture(event.pointerId);
  if (pointerCache.size === 1) {
    isPanning = true;
    panStart = {
      x: event.clientX,
      y: event.clientY,
      viewX: mapView.x,
      viewY: mapView.y,
    };
  }
  if (pointerCache.size === 2) {
    const points = Array.from(pointerCache.values());
    const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    pinchStart = { distance, scale: mapView.scale };
  }
});

stationMap.addEventListener("pointermove", (event) => {
  if (!pointerCache.has(event.pointerId)) return;
  pointerCache.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointerCache.size === 2 && pinchStart) {
    const points = Array.from(pointerCache.values());
    const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    const nextScale = clamp(pinchStart.scale * (distance / pinchStart.distance), 0.72, 2.8);
    setMapView({ scale: nextScale }, false);
    return;
  }
  if (!isPanning) return;
  setMapView({
    x: panStart.viewX + event.clientX - panStart.x,
    y: panStart.viewY + event.clientY - panStart.y,
  }, false);
});

function endPointer(event) {
  pointerCache.delete(event.pointerId);
  if (pointerCache.size < 2) pinchStart = null;
  if (pointerCache.size === 0) isPanning = false;
}

stationMap.addEventListener("pointerup", endPointer);
stationMap.addEventListener("pointercancel", endPointer);
stationMap.addEventListener("click", (event) => {
  if (event.target === stationMap || event.target === habitatCanvas) {
    selectedAgentKey = null;
    selectedRoomKey = null;
    document.querySelectorAll(".station.selected, .roster-agent.selected").forEach((item) => item.classList.remove("selected"));
    stationMap.classList.remove("has-selection");
    renderInspector();
  }
});

zoomInBtn.addEventListener("click", () => zoomMap(0.18));
zoomOutBtn.addEventListener("click", () => zoomMap(-0.18));
centerMapBtn.addEventListener("click", () => resetHabitatView());
fullscreenMapBtn.addEventListener("click", () => {
  setMapFullscreen(!stationMap.classList.contains("map-fullscreen"));
});
backToHabitatBtn.addEventListener("click", () => resetHabitatView());
closeWorkspaceBtn.addEventListener("click", closeWorkspace);
workspaceOverlay.addEventListener("click", (event) => {
  if (event.target === workspaceOverlay) closeWorkspace();
});
adminMenuBtn?.addEventListener("click", (event) => {
  event.stopPropagation();
  setAdminMenuOpen(adminMenu?.hidden ?? true);
});
adminMenu?.addEventListener("click", (event) => {
  event.stopPropagation();
});
adminSettingsBtn?.addEventListener("click", () => {
  setAdminMenuOpen(false);
  activateView("settings");
});
notificationBtn?.addEventListener("click", (event) => {
  event.stopPropagation();
  renderNotifications();
  setNotificationsOpen(notificationPanel?.hidden ?? true);
});
notificationPanel?.addEventListener("click", (event) => {
  event.stopPropagation();
});
document.addEventListener("click", () => {
  setAdminMenuOpen(false);
  setNotificationsOpen(false);
});
inspectorActions.addEventListener("click", (event) => {
  const button = event.target.closest("[data-inspector-action]");
  if (!button) return;
  const action = button.dataset.inspectorAction;
  if (action === "workspace") {
    openWorkspace(button.dataset.agent || selectedAgentKey);
    return;
  }
  addLocalAudit("Inspector action", `${button.textContent.trim()} requested for ${selectedAgentKey ? agentProfiles[selectedAgentKey].name : roomProfiles[selectedRoomKey || "Overview"].title}.`);
  renderAudit();
  renderInspector();
});

passwordForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearAccessMessage();
  const form = new FormData(passwordForm);
  const newPassword = String(form.get("newPassword") || "");
  const confirmPassword = String(form.get("confirmPassword") || "");
  if (newPassword !== confirmPassword) {
    showAccessMessage("New passwords do not match.", "error");
    return;
  }
  try {
    accessState = await postJson("/api/access/password", {
      currentPassword: form.get("currentPassword"),
      newPassword,
    });
    passwordForm.reset();
    renderAccessState();
    showAccessMessage("Password updated. Use the new password next time you sign in.", "success");
  } catch (error) {
    showAccessMessage(error.message, "error");
  }
});

createUserForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearAccessMessage();
  const form = new FormData(createUserForm);
  const password = String(form.get("password") || "");
  const confirmPassword = String(form.get("confirmPassword") || "");
  if (password !== confirmPassword) {
    showAccessMessage("New account passwords do not match.", "error");
    return;
  }
  try {
    accessState = await postJson("/api/access/users", {
      username: form.get("username"),
      password,
      currentPassword: form.get("currentPassword"),
    });
    createUserForm.reset();
    renderAccessState();
    showAccessMessage("New admin login created. Sign out and test it before removing any older login.", "success");
  } catch (error) {
    showAccessMessage(error.message, "error");
  }
});

accessUserList?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-access-delete]");
  if (!button) return;
  const currentPassword = window.prompt("Enter your current password to delete this login.");
  if (!currentPassword) return;
  clearAccessMessage();
  try {
    accessState = await postJson(`/api/access/users/${encodeURIComponent(button.dataset.accessDelete)}/delete`, {
      currentPassword,
    });
    renderAccessState();
    showAccessMessage("Login deleted.", "success");
  } catch (error) {
    showAccessMessage(error.message, "error");
  }
});

pauseBtn.addEventListener("click", () => {
  mutate("/api/pause").then((changed) => {
    if (changed) return;
    state.mission.paused = !state.mission.paused;
    addLocalAudit("Pause changed locally", "Start the app with npm start to persist this action.");
    render();
  }).catch((error) => {
    state.mission.paused = !state.mission.paused;
    addLocalAudit("Pause changed locally", error.message);
    render();
  });
});

runCycleBtn.addEventListener("click", () => {
  mutate("/api/cycle").then((changed) => {
    if (changed) return;
    state.mission.currentStep = (state.mission.currentStep + 1) % state.mission.steps.length;
    addLocalAudit("Cycle changed locally", "Start the app with npm start to persist this action.");
    render();
  }).catch((error) => {
    state.mission.currentStep = (state.mission.currentStep + 1) % state.mission.steps.length;
    addLocalAudit("Cycle changed locally", error.message);
    loadState();
    render();
  });
});

killSwitchBtn.addEventListener("click", () => {
  if (!apiAvailable) {
    state.governance.killSwitch = !state.governance.killSwitch;
    state.mission.paused = state.governance.killSwitch ? true : state.mission.paused;
    addLocalAudit("Kill switch changed locally", "Start the app with npm start to persist governance controls.");
    render();
    return;
  }
  postJson("/api/governance/kill-switch", {
    enabled: !(state.governance || fallbackState.governance).killSwitch,
  }).then((nextState) => {
    state = nextState;
    render();
  }).catch((error) => {
    addLocalAudit("Kill switch failed", error.message);
    render();
  });
});

resetLoopBtn.addEventListener("click", () => {
  if (!apiAvailable) {
    state.governance.cycleCount = 0;
    state.governance.estimatedSpendUsd = 0;
    state.mission.paused = false;
    addLocalAudit("Loop guard reset locally", "Start the app with npm start to persist governance controls.");
    render();
    return;
  }
  mutate("/api/governance/reset-loop").catch((error) => {
    addLocalAudit("Loop reset failed", error.message);
    render();
  });
});

runNextTaskBtn.addEventListener("click", () => {
  if (!apiAvailable) {
    const task = state.tasks.find((item) => item.status === "queued" || item.status === "needs_revision");
    if (!task) {
      addLocalAudit("No queued task", "Assign or queue a task before running Depo.");
      render();
      return;
    }
    task.status = "draft_ready";
    task.output = "Depo prepared a local draft. Start the server to persist artifacts and approvals.";
    task.evidence = ["Static preview only.", "Persistent artifacts require the local server."];
    addLocalAudit("Next task ran locally", task.title);
    render();
    return;
  }
  mutate("/api/tasks/run-next").catch((error) => {
    addLocalAudit("Run next task failed", error.message);
    loadState();
    render();
  });
});

runWorkdayBtn.addEventListener("click", () => {
  if (!apiAvailable) {
    let ran = 0;
    state.tasks.forEach((task) => {
      if (ran >= 3 || !["queued", "needs_revision"].includes(task.status)) return;
      task.status = "draft_ready";
      task.output = "Depo prepared a local draft. Start the server to persist artifacts and approvals.";
      task.evidence = ["Static preview only.", "Persistent artifacts require the local server."];
      ran += 1;
    });
    state.governance.lastWorkday = {
      runIds: Array.from({ length: ran }, (_, index) => `local-${index}`),
      limit: 3,
      completedAt: new Date().toISOString(),
    };
    addLocalAudit("Workday ran locally", `Depo processed ${ran} local task${ran === 1 ? "" : "s"}.`);
    render();
    return;
  }
  postJson("/api/workday/run", { limit: 3 }).then((nextState) => {
    state = nextState;
    render();
  }).catch((error) => {
    addLocalAudit("Run workday failed", error.message);
    loadState();
    render();
  });
});

capabilityList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-capability]");
  if (!button) return;
  const capability = state.capabilities.find((item) => item.id === button.dataset.capability);
  if (!capability) return;
  addLocalAudit("Capability inspected", `${capability.name} is ${capability.status.toLowerCase()} and remains approval-gated.`);
  renderAudit();
});

approvalList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-approval-action]");
  if (!button) return;
  const action = button.dataset.approvalAction;
  const id = button.dataset.approvalId;
  mutate(`/api/approvals/${encodeURIComponent(id)}/${action}`).then((changed) => {
    if (changed) return;
    addLocalAudit("Approval changed locally", "Start the app with npm start to persist this action.");
    render();
  }).catch((error) => {
    addLocalAudit("Approval unavailable", error.message);
    render();
  });
});

taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = taskInput.value.trim();
  if (!text) return;
  if (!apiAvailable) {
    const classification = taskWorkflow.value || "workflow-pod-lab";
    state.tasks.unshift({
      id: `local-task-${Date.now()}`,
      title: text.length > 76 ? `${text.slice(0, 73)}...` : text,
      operatorText: text,
      workflowId: classification,
      intent: classification.includes("stock") ? "market_monitoring" : classification.includes("factory") ? "agent_factory" : "print_on_demand",
      risk: classification.includes("stock") ? "high" : classification.includes("factory") ? "medium" : "low",
      status: "queued",
      evidence: [],
      output: "",
    });
    taskInput.value = "";
    addLocalAudit("Task queued locally", "Start the app with npm start to persist assigned tasks.");
    render();
    return;
  }
  postJson("/api/tasks", {
    text,
    workflowId: taskWorkflow.value,
  }).then((nextState) => {
    state = nextState;
    taskInput.value = "";
    render();
  }).catch((error) => {
    addLocalAudit("Task assignment failed", error.message);
    render();
  });
});

templateList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-template-queue]");
  if (!button) return;
  const id = button.dataset.templateQueue;
  if (!apiAvailable) {
    const template = state.taskTemplates.find((item) => item.id === id);
    if (!template) return;
    state.tasks.unshift({
      id: `local-template-task-${Date.now()}`,
      title: template.name,
      operatorText: template.prompt,
      workflowId: template.workflowId,
      templateId: template.id,
      intent: template.workflowId.includes("stock") ? "market_monitoring" : template.workflowId.includes("factory") ? "agent_factory" : "print_on_demand",
      risk: template.risk,
      status: "queued",
      evidence: [],
      output: "",
    });
    addLocalAudit("Template queued locally", "Start the app with npm start to persist template tasks.");
    render();
    return;
  }
  mutate(`/api/templates/${encodeURIComponent(id)}/queue`).catch((error) => {
    addLocalAudit("Template queue failed", error.message);
    render();
  });
});

taskList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-task-run]");
  if (!button) return;
  const id = button.dataset.taskRun;
  if (!apiAvailable) {
    const task = state.tasks.find((item) => item.id === id);
    if (!task) return;
    task.status = "draft_ready";
    task.output = "Depo prepared a local draft. Start the server to create persistent evidence, memory, and approvals.";
    task.evidence = ["Static preview only.", "Persistent approval package requires the local server."];
    addLocalAudit("Task ran locally", task.title);
    render();
    return;
  }
  mutate(`/api/tasks/${encodeURIComponent(id)}/run`).catch((error) => {
    addLocalAudit("Task run failed", error.message);
    loadState();
    render();
  });
});

functionList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-function-run]");
  if (!button) return;
  const id = button.dataset.functionRun;
  const input = document.querySelector(`[data-function-input="${CSS.escape(id)}"]`)?.value.trim() || "";
  if (!apiAvailable) {
    const fn = state.functions.find((item) => item.id === id);
    if (!fn) return;
    const task = {
      id: `local-function-task-${Date.now()}`,
      title: `${fn.name}: ${input || "draft-only run"}`,
      operatorText: input || `Run ${fn.name} with draft-only safeguards.`,
      workflowId: fn.workflowId,
      functionId: fn.id,
      intent: fn.workflowId?.includes("stock") ? "market_monitoring" : fn.workflowId?.includes("factory") ? "agent_factory" : "print_on_demand",
      risk: fn.risk,
      status: "queued",
      evidence: [],
      output: "",
    };
    state.tasks.unshift(task);
    state.executions.unshift({
      id: `local-exec-${Date.now()}`,
      functionId: fn.id,
      functionName: fn.name,
      taskId: task.id,
      status: "queued_task",
      input: task.operatorText,
      risk: task.risk,
    });
    addLocalAudit("Function run queued locally", "Start the app with npm start to persist function runs.");
    render();
    return;
  }
  postJson(`/api/functions/${encodeURIComponent(id)}/run`, { input }).then((nextState) => {
    state = nextState;
    render();
  }).catch((error) => {
    addLocalAudit("Function run failed", error.message);
    loadState();
    render();
  });
});

loadState().then(() => {
  loadProfileIdentity();
});
startCycle();
updateSystemClock();
setInterval(updateSystemClock, 1000);

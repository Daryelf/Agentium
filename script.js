const fallbackState = {
  meta: {
    mode: "static_fallback",
  },
  agent: {
    id: "agent-001-depo",
    name: "Agent 101",
    role: "Draft-only Operator",
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
        copy: "Agent 101 is collecting demand signals, competitor notes, and freshness labels before any listing idea becomes durable memory.",
        risk: "Low",
      },
      {
        station: "Verify",
        x: "78%",
        y: "44%",
        progress: 51,
        confidence: 82,
        title: "Check contradictions and policy risk",
        copy: "Agent 101 is separating verified evidence from guesses and blocking claims that would need legal, financial, or customer-facing review.",
        risk: "Medium",
      },
      {
        station: "Draft",
        x: "21%",
        y: "70%",
        progress: 74,
        confidence: 88,
        title: "Draft the first workflow",
        copy: "Agent 101 is preparing a repeatable research-to-approval workflow with no account creation, publishing, or spending permission.",
        risk: "Low",
      },
      {
        station: "Approval",
        x: "77%",
        y: "70%",
        progress: 92,
        confidence: 91,
        title: "Package decision for the operator",
        copy: "Agent 101 is bundling evidence, assumptions, expected upside, risks, and the exact action that needs your sign-off.",
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
      id: "workflow-clips-office",
      name: "Clips Office",
      status: "active_draft",
      risk: "medium",
      description: "Plan short-form clips, prepare CapCut handoff instructions, draft posting packages, and route publishing through Human Gate.",
      nextFunction: "Create a clip brief, CapCut edit plan, captions, and approval package without posting.",
    },
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
      nextFunction: "Propose a second agent only after Agent 101's first workflow is approved.",
    },
  ],
  taskTemplates: [
    {
      id: "tpl-clips-video-package",
      name: "Clips video package",
      workflowId: "workflow-clips-office",
      risk: "medium",
      prompt: "Create 3 short clips from raw footage, prepare edits in CapCut, write captions, prepare TikTok posting drafts, and package everything for Human Gate approval. Do not post or change accounts.",
      outcome: "Clip brief + CapCut handoff + posting package",
    },
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
      action: "Allow Agent 101 to save this workflow as a reusable playbook.",
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
        body: "Design a visible first-agent system for Argentum with Agent 101 as the supervised starting worker.",
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
        title: "Agent 101 identity",
        body: "Agent 101 is the draft-only operator: gather, verify, draft, and package work for approval.",
      },
      {
        title: "Failure habit",
        body: "When evidence is stale, contradictory, or missing, Agent 101 must ask for review instead of inventing certainty.",
      },
    ],
  },
  audit: [
    {
      title: "Static console loaded",
      body: "Start the local server with npm start to enable persistent memory, approvals, and Agent 101 cycles.",
    },
  ],
};

let state = fallbackState;
let activeMemoryLayer = "working";
let cycleTimer = null;
let apiAvailable = false;
let automationTelemetryMessages = ["Agent 101 is waiting for bounded work."];
let automationTelemetryIndex = 0;

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
const settingsTitleHeading = document.querySelector(".settings-title h3");
const settingsTitleCopy = document.querySelector(".settings-title p");
const settingsBreadcrumbCurrent = document.querySelector(".settings-breadcrumb strong");
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
const systemFeedModal = document.querySelector("#systemFeedModal");
const systemFeedModalList = document.querySelector("#systemFeedModalList");
const closeSystemFeedModalBtn = document.querySelector("#closeSystemFeedModalBtn");
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
const agentToolGrid = document.querySelector("#agentToolGrid");
const settingsToolGrid = document.querySelector("#settingsToolGrid");
const agentToolRefreshBtn = document.querySelector("#agentToolRefreshBtn");
const clipsStageMetric = document.querySelector("#clipsStageMetric");
const clipsFilesMetric = document.querySelector("#clipsFilesMetric");
const clipsApprovalStatus = document.querySelector("#clipsApprovalStatus");
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
const agentEfficiencyRing = document.querySelector("#agentEfficiencyRing");
const agentEfficiencyMetric = document.querySelector("#agentEfficiencyMetric");
const agentBusinessStatus = document.querySelector("#agentBusinessStatus");
const agentBusinessReadout = document.querySelector("#agentBusinessReadout");
const agentRequiresMetric = document.querySelector("#agentRequiresMetric");
const agentAcceptedMetric = document.querySelector("#agentAcceptedMetric");
const agentDeclinedMetric = document.querySelector("#agentDeclinedMetric");
const liveRevenueMetric = document.querySelector("#liveRevenueMetric");
const overviewQueuedTaskMetric = document.querySelector("#overviewQueuedTaskMetric");
const overviewHighRiskTaskMetric = document.querySelector("#overviewHighRiskTaskMetric");
const overviewDraftReadyMetric = document.querySelector("#overviewDraftReadyMetric");
const overviewTotalTaskMetric = document.querySelector("#overviewTotalTaskMetric");
const workflowPipelineStatus = document.querySelector("#workflowPipelineStatus");
const workflowPipelineRail = document.querySelector("#workflowPipelineRail");
const workflowPipelineReadout = document.querySelector("#workflowPipelineReadout");
const workflowResearchMetric = document.querySelector("#workflowResearchMetric");
const workflowVerifyMetric = document.querySelector("#workflowVerifyMetric");
const workflowDraftMetric = document.querySelector("#workflowDraftMetric");
const workflowApprovalMetric = document.querySelector("#workflowApprovalMetric");
const automationQueueMetric = document.querySelector("#automationQueueMetric");
const automationQueueLabel = document.querySelector("#automationQueueLabel");
const automationTelemetry = document.querySelector("#automationTelemetry");
const automationProgress = document.querySelector("#automationProgress");
const revenueGuardMetric = document.querySelector("#revenueGuardMetric");
const revenueGuardCopy = document.querySelector("#revenueGuardCopy");
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
const aiProviderCurrentProvider = document.querySelector("#aiProviderCurrentProvider");
const aiProviderConnectionStatus = document.querySelector("#aiProviderConnectionStatus");
const aiProviderActiveModel = document.querySelector("#aiProviderActiveModel");
const aiProviderMode = document.querySelector("#aiProviderMode");
const aiProviderLastTest = document.querySelector("#aiProviderLastTest");
const aiProviderMonthlyLimit = document.querySelector("#aiProviderMonthlyLimit");
const aiProviderLastError = document.querySelector("#aiProviderLastError");
const aiProviderModeChip = document.querySelector("#aiProviderModeChip");
const aiProviderForm = document.querySelector("#aiProviderForm");
const aiProviderSelect = document.querySelector("#aiProviderSelect");
const aiModeSelect = document.querySelector("#aiModeSelect");
const aiModelInput = document.querySelector("#aiModelInput");
const aiInlineKeyStatus = document.querySelector("#aiInlineKeyStatus");
const aiTemperatureInput = document.querySelector("#aiTemperatureInput");
const aiMaxTokensInput = document.querySelector("#aiMaxTokensInput");
const aiProviderKeyForm = document.querySelector("#aiProviderKeyForm");
const aiKeyProviderSelect = document.querySelector("#aiKeyProviderSelect");
const aiKeyInput = document.querySelector("#aiKeyInput");
const aiKeyStatus = document.querySelector("#aiKeyStatus");
const aiProviderTestBtn = document.querySelector("#aiProviderTestBtn");
const aiProviderRemoveKeyBtn = document.querySelector("#aiProviderRemoveKeyBtn");
const aiProviderTestResult = document.querySelector("#aiProviderTestResult");
const agentOpenAiTestBtn = document.querySelector("#agentOpenAiTestBtn");
const agentReadinessGrid = document.querySelector("#agentReadinessGrid");
const agentRosterList = document.querySelector("#agentRosterList");
const habitatModules = document.querySelector("#habitatModules");
const habitatRoutes = document.querySelector("#habitatRoutes");
const stationArtwork = document.querySelector("#stationArtwork");
const miniMapNodes = document.querySelector("#miniMapNodes");
const moduleInfoCard = document.querySelector("#moduleInfoCard");
if (moduleInfoCard && moduleInfoCard.parentElement !== document.body) {
  document.body.appendChild(moduleInfoCard);
}
const mapViewMode = document.querySelector("#mapViewMode");
const scanBtn = document.querySelector("#scanBtn");
const systemClockNodes = document.querySelectorAll("[data-system-clock]");
const systemDateNodes = document.querySelectorAll("[data-system-date]");
const systemSearch = document.querySelector("#systemSearch");
const agentCoreName = document.querySelector("#agentCoreName");
const agentCoreRole = document.querySelector("#agentCoreRole");
const sidebarSystemHealth = document.querySelector("#sidebarSystemHealth");
const sidebarAgentId = document.querySelector("#sidebarAgentId");
const sidebarAgentMode = document.querySelector("#sidebarAgentMode");
const sidebarMiniChart = document.querySelector("#sidebarMiniChart");
const sidebarStatusRows = [
  {
    label: document.querySelector("#sidebarStatusLabelA"),
    bar: document.querySelector("#sidebarStatusBarA"),
    value: document.querySelector("#sidebarStatusValueA"),
  },
  {
    label: document.querySelector("#sidebarStatusLabelB"),
    bar: document.querySelector("#sidebarStatusBarB"),
    value: document.querySelector("#sidebarStatusValueB"),
  },
  {
    label: document.querySelector("#sidebarStatusLabelC"),
    bar: document.querySelector("#sidebarStatusBarC"),
    value: document.querySelector("#sidebarStatusValueC"),
  },
  {
    label: document.querySelector("#sidebarStatusLabelD"),
    bar: document.querySelector("#sidebarStatusBarD"),
    value: document.querySelector("#sidebarStatusValueD"),
  },
];

const depoWorkflowStages = [
  "depo-habitat",
  "clips-office",
  "stock-office",
  "etsy-office",
  "essentrx-office",
];

const depoWorkflowStageLabels = {
  "depo-habitat": "Agent Office",
  "clips-office": "Clips Office",
  "stock-office": "Stock Office",
  "etsy-office": "Etsy Store Office",
  "essentrx-office": "Essentrx Office",
  "human-gate": "Human Gate",
  "memory-vault": "Memory Office",
  "output-bench": "Output Desk",
  "system-log": "System Log",
};

const depoCapabilities = {
  canDo: [
    "Research",
    "Organize evidence",
    "Draft outputs",
    "Create task plans",
    "Create workflow plans",
    "Prepare prompts",
    "Prepare reports",
    "Save internal notes",
    "Package work for approval",
    "Create future agent blueprints",
  ],
  blockedWithoutApproval: [
    "Publish externally",
    "Spend money",
    "Move money",
    "Contact customers",
    "Modify accounts",
    "Create live agents",
    "Grant permissions",
    "Change API keys",
    "Deploy campaigns",
    "Run external actions",
  ],
};

const riskyActionTypes = new Set([
  "publish",
  "spend_money",
  "move_money",
  "contact_customer",
  "modify_account",
  "create_live_agent",
  "change_permissions",
  "change_api_key",
  "deploy_campaign",
  "external_api_action",
]);

const depoAgent = {
  id: "depo",
  name: "Agent 101",
  title: "Master Agent",
  role: "Draft-only Operator",
  status: "Active supervised",
  mode: "Draft only",
  authorityLevel: "Head Agent",
  currentStage: "depo-habitat",
  currentTask: "Prepare supervised business action package for review.",
  riskMode: "Approval required",
  externalActions: "Locked",
  humanGate: "Enabled",
  canCreateAgents: false,
  canPublish: false,
  canSpendMoney: false,
  canContactCustomers: false,
  canModifyAccounts: false,
  number: "101",
  icon: "A",
  color: "#7DD3FC",
  room: "depo-habitat",
  connectedModules: ["depo-habitat", "argentum-core"],
  can: depoCapabilities.canDo,
  cannot: depoCapabilities.blockedWithoutApproval,
  workflowStages: depoWorkflowStages,
  queue: ["Receive first bounded workflow"],
  queueCount: 1,
  riskLevel: "Medium",
  actions: ["Agent 101 active supervised", "Draft-only mode loaded", "External actions remain locked"],
};

const habitatFloorRooms = [
  {
    id: "depo-habitat",
    title: "Agent Habitat",
    name: "Agent Habitat",
    subtitle: "Active agent",
    metric: `Agent ${depoAgent.number}`,
    status: depoAgent.status,
    type: "core",
    visual: "core",
    icon: "D",
    color: "#8B5CF6",
    position: { x: 50, y: 50 },
    size: { w: 19, h: 22 },
    purpose: "Home base for the first supervised Argentum agent.",
    depoRole: "Agent 101 is the master agent. Every office reports here before any risky action moves forward.",
    connections: ["clips-office", "stock-office", "etsy-office", "essentrx-office", "human-gate"],
    riskNote: "External actions remain locked.",
    recentActivity: ["Agent 101 initialized.", "Business offices report here.", "Draft-only mode loaded."],
  },
  {
    id: "clips-office",
    title: "Clips Office",
    name: "Clips Office",
    subtitle: "Short-form video",
    metric: "Ready",
    status: "Drafting",
    type: "intake",
    visual: "clipboard",
    icon: "clipboard",
    color: "#38BDF8",
    position: { x: 23, y: 23 },
    size: { w: 29, h: 28 },
    purpose: "Plans clips, short videos, hooks, scripts, edits, and posting packages for review.",
    depoRole: "Clips work reports to Agent 101 before anything can be posted.",
    connections: ["depo-habitat"],
    riskNote: "Posting and platform access require approval.",
    recentActivity: ["Clip planning office ready.", "No video posted.", "Agent 101 owns final review."],
  },
  {
    id: "stock-office",
    title: "Stock Office",
    name: "Stock Office",
    subtitle: "Market notes",
    metric: "Guarded",
    status: "Research",
    type: "research",
    visual: "lab",
    icon: "research",
    color: "#22D3EE",
    position: { x: 77, y: 23 },
    size: { w: 29, h: 28 },
    purpose: "Tracks stock research, watch notes, risk labels, and draft-only market briefs.",
    depoRole: "Stock work reports to Agent 101. Agent 101 cannot place trades or move money.",
    connections: ["depo-habitat"],
    riskNote: "Trades and money movement are locked.",
    recentActivity: ["Stock office ready.", "No trade permission active.", "Risk notes stay draft-only."],
  },
  {
    id: "etsy-office",
    title: "Etsy Store Office",
    name: "Etsy Store Office",
    subtitle: "Store drafts",
    metric: "Draft only",
    status: "Planning",
    type: "verify",
    visual: "verify",
    icon: "shield",
    color: "#A78BFA",
    position: { x: 23, y: 76 },
    size: { w: 29, h: 28 },
    purpose: "Builds Etsy product ideas, POD briefs, listing drafts, SEO notes, and approval packages.",
    depoRole: "Etsy work reports to Agent 101. Listing publishing and checkout changes are locked.",
    connections: ["depo-habitat"],
    riskNote: "Publishing, pricing, and customer-facing edits require approval.",
    recentActivity: ["Etsy store office ready.", "No listing published.", "Draft packages only."],
  },
  {
    id: "essentrx-office",
    title: "Essentrx Office",
    name: "Essentrx Office",
    subtitle: "Brand ops",
    metric: "Connected",
    status: "Drafting",
    type: "draft",
    visual: "studio",
    icon: "pen",
    color: "#60A5FA",
    position: { x: 77, y: 76 },
    size: { w: 29, h: 28 },
    purpose: "Prepares Essentrx business work: product notes, admin ideas, customer-safe drafts, and packaging plans.",
    depoRole: "Essentrx work reports to Agent 101 before customer contact, store edits, or campaign actions.",
    connections: ["depo-habitat"],
    riskNote: "Customer contact, publishing, checkout, and account changes require approval.",
    recentActivity: ["Essentrx office ready.", "Customer contact locked.", "Draft packages only."],
  },
  {
    id: "memory-vault",
    visible: false,
    title: "Memory Office",
    name: "Memory Office",
    subtitle: "Stored knowledge",
    metric: "0 notes",
    status: "Stored",
    type: "memory",
    visual: "vault",
    icon: "database",
    color: "#38BDF8",
    position: { x: 50, y: 18 },
    size: { w: 24, h: 22 },
    purpose: "Stores reusable notes, context, research, and internal knowledge.",
    depoRole: "All office memory reports back to Agent 101.",
    connections: ["depo-habitat"],
    riskNote: "Sensitive data should be logged.",
    recentActivity: ["Memory office virtual.", "Private context kept local."],
  },
  {
    id: "output-bench",
    visible: false,
    title: "Output Desk",
    name: "Output Desk",
    subtitle: "Prepared outputs",
    metric: "0 artifacts",
    status: "Prepared",
    type: "output",
    visual: "bench",
    icon: "download",
    color: "#60A5FA",
    position: { x: 50, y: 84 },
    size: { w: 24, h: 22 },
    purpose: "Holds completed drafts and prepared deliverables.",
    depoRole: "Agent 101 places reviewed work here for final handling.",
    connections: ["depo-habitat"],
    riskNote: "Outputs remain internal until approved.",
    recentActivity: ["Output desk virtual.", "No publish action sent."],
  },
  {
    id: "system-log",
    visible: false,
    title: "System Log",
    name: "System Log",
    subtitle: "Event stream",
    metric: "Live",
    status: "Live",
    type: "log",
    visual: "terminal",
    icon: "log",
    color: "#22D3EE",
    position: { x: 20.8, y: 84 },
    size: { w: 27, h: 28 },
    purpose: "Tracks events, stage changes, and audit history.",
    depoRole: "Agent 101 writes cycle updates here.",
    connections: ["depo-habitat", "clips-office", "stock-office", "etsy-office", "essentrx-office"],
    riskNote: "Logs should be append-only where possible.",
    recentActivity: ["Event stream live.", "Stage update written.", "Approval status recorded."],
  },
  {
    id: "human-gate",
    title: "Human Gate",
    name: "Human Gate",
    subtitle: "Approval required",
    metric: "Locked",
    status: "Locked",
    type: "approval",
    visual: "gate",
    icon: "lock",
    color: "#F43F5E",
    position: { x: 50, y: 86 },
    size: { w: 28, h: 18 },
    purpose: "Blocks risky actions until the operator approves.",
    depoRole: "Agent 101 packages work for human review.",
    connections: ["depo-habitat"],
    riskNote: "Required for publishing, money movement, customer contact, account changes, and new agents.",
    recentActivity: ["Approval lock engaged.", "Risk package waiting.", "External action blocked."],
  },
];

const roomActionModel = {
  "depo-habitat": {
    allowedActions: ["coordinate workflow", "review current stage", "prepare approval package", "propose future agent blueprint"],
    blockedActions: ["create live agents", "grant permissions", "publish externally", "change API keys"],
  },
  "clips-office": {
    allowedActions: ["draft clip plan", "write hooks", "prepare edit notes", "package posting plan"],
    blockedActions: ["post videos", "access social accounts", "spend ad money"],
  },
  "stock-office": {
    allowedActions: ["draft watch notes", "organize market research", "label risk", "prepare review notes"],
    blockedActions: ["place trades", "move money", "make financial guarantees"],
  },
  "etsy-office": {
    allowedActions: ["draft product ideas", "prepare listing copy", "organize POD evidence", "package store changes"],
    blockedActions: ["publish listings", "change pricing", "contact customers"],
  },
  "essentrx-office": {
    allowedActions: ["draft brand operations", "prepare product notes", "organize admin ideas", "package customer-safe drafts"],
    blockedActions: ["change checkout", "contact customers", "deploy campaigns"],
  },
  "memory-vault": {
    allowedActions: ["store internal notes", "retrieve project memory", "organize context", "label sensitive data"],
    blockedActions: ["store secrets", "expose private memory", "overwrite audit history"],
  },
  "output-bench": {
    allowedActions: ["stage deliverables", "package internal outputs", "prepare review bundles", "mark ready for operator"],
    blockedActions: ["send outputs externally", "publish files", "claim earnings"],
  },
  "human-gate": {
    allowedActions: ["hold approvals", "record blocked actions", "request operator decision", "package risky work"],
    blockedActions: ["auto-approve publishing", "auto-spend money", "auto-create agents", "change permissions without operator"],
  },
  "system-log": {
    allowedActions: ["append stage update", "record action note", "show approval status", "summarize local events"],
    blockedActions: ["delete audit history", "hide blocked actions", "rewrite approvals"],
  },
};

const defaultRoomAllowedActions = ["view status", "run local check", "write internal note", "package for approval"];
const defaultRoomBlockedActions = ["external execution", "publishing", "money movement", "permission changes"];
const roomQuickActions = {
  "depo-habitat": ["Create task plan", "Draft workflow", "Propose a new agent"],
  "clips-office": ["Create task plan", "Draft workflow", "Package for approval"],
  "stock-office": ["Save note", "Run check", "Package for approval"],
  "etsy-office": ["Draft workflow", "Package for approval", "Save note"],
  "essentrx-office": ["Draft workflow", "Package for approval", "Save note"],
  "human-gate": ["View pending approvals", "Approve local test", "Reject"],
  "output-bench": ["View output", "Send to Log"],
  "memory-vault": ["Save note", "View memory"],
  "system-log": ["View logs"],
};

habitatFloorRooms.forEach((room) => {
  const actionModel = roomActionModel[room.id] || {};
  room.allowedActions = actionModel.allowedActions || defaultRoomAllowedActions;
  room.blockedActions = actionModel.blockedActions || defaultRoomBlockedActions;
  room.operatorActivity = [];
});

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function countPhrase(count, noun) {
  return `${count} ${noun}`;
}

function stateList(name) {
  return Array.isArray(state?.[name]) ? state[name] : [];
}

function ensureDepoWorkState() {
  if (!Array.isArray(state.depoTasks)) state.depoTasks = [];
  if (!Array.isArray(state.agentBlueprints)) state.agentBlueprints = [];
  if (!Array.isArray(state.workflowDrafts)) state.workflowDrafts = [];
  if (!Array.isArray(state.systemLog)) state.systemLog = [];
}

function depoTasks() {
  ensureDepoWorkState();
  return state.depoTasks;
}

function agentBlueprints() {
  ensureDepoWorkState();
  return state.agentBlueprints;
}

function workflowDrafts() {
  ensureDepoWorkState();
  return state.workflowDrafts;
}

function systemLogEntries() {
  ensureDepoWorkState();
  return state.systemLog;
}

function memoryEntries() {
  const memory = state?.memory || {};
  return ["working", "shared", "agent"].flatMap((layer) => (Array.isArray(memory[layer]) ? memory[layer] : []));
}

function taskEvidenceCount(tasks) {
  return tasks.reduce((total, task) => total + (Array.isArray(task.evidence) ? task.evidence.length : 0), 0);
}

function artifactEvidenceCount(artifacts) {
  return artifacts.reduce((total, artifact) => total + (Array.isArray(artifact.evidence) ? artifact.evidence.length : 0), 0);
}

function syncRoomRuntime(roomId, updates) {
  const room = habitatFloorRoomById?.[roomId];
  if (!room) return;
  Object.assign(room, updates);
  const activity = [...(room.operatorActivity || []), ...(updates.runtimeActivity || [])].slice(0, 4);
  if (activity.length) room.recentActivity = activity;

  const profile = roomProfiles?.[roomId];
  if (profile) {
    profile.subtitle = room.subtitle;
    profile.status = room.status;
    profile.metric = room.metric;
    profile.summary = room.purpose;
    profile.description = room.purpose;
    profile.activity = room.recentActivity;
    profile.recentActivity = room.recentActivity;
    profile.metrics = [
      ["Status", room.status],
      ["Metric", room.metric],
      ["Human Gate", depoAgent.humanGate],
    ];
  }

  const card = habitatModuleCards?.[roomId];
  if (card) {
    card.subtitle = room.subtitle;
    card.status = room.status;
    card.metric = room.metric;
    card.recentActivity = room.recentActivity;
  }
}

const agentProfiles = {
  atlas: {
    id: "atlas",
    name: "Atlas",
    role: "System Overseer",
    status: "Online",
    number: "01",
    icon: "A",
    color: "#22D3EE",
    room: "agent-habitat",
    connectedModules: ["agent-habitat", "ai-agents", "security-core", "system-logs"],
    currentTask: "Coordinating habitat state, approvals, and risk checks across the command floor.",
    queue: ["Review live map health", "Sync command telemetry"],
    queueCount: 2,
    permissions: ["Coordinate agents", "Read system telemetry", "Cannot approve external actions"],
    riskLevel: "Medium",
    actions: ["Reconciled command map", "Flagged stale telemetry", "Confirmed human-gate routing"],
  },
  forge: {
    id: "forge",
    name: "Forge",
    role: "Production Agent",
    status: "Busy",
    number: "02",
    icon: "F",
    color: "#FBBF24",
    room: "task-factory",
    connectedModules: ["task-factory", "workflow-pipeline", "content-engine", "resources"],
    currentTask: "Packaging production jobs and separating draft outputs from gated external actions.",
    queue: ["Build content batch", "Validate output bundle", "Prepare failed-job report"],
    queueCount: 9,
    permissions: ["Draft production assets", "Queue internal jobs", "Cannot publish or spend"],
    riskLevel: "Low",
    actions: ["Deployed production batch", "Queued two draft jobs", "Marked one output for review"],
  },
  prism: {
    id: "prism",
    name: "Prism",
    role: "Creative / Marketing",
    status: "Online",
    number: "03",
    icon: "P",
    color: "#A78BFA",
    room: "content-engine",
    connectedModules: ["content-engine", "commerce-terminal", "customer-node", "workflow-pipeline"],
    currentTask: "Generating campaign drafts and creative briefs for approval-ready publishing.",
    queue: ["Draft listing copy", "Prepare campaign options", "Score creative variants"],
    queueCount: 5,
    permissions: ["Draft campaigns", "Generate creative assets", "Cannot publish externally"],
    riskLevel: "Medium",
    actions: ["Updated campaign draft", "Tagged creative assets", "Routed publication to approval"],
  },
  ledger: {
    id: "ledger",
    name: "Ledger",
    role: "Finance Agent",
    status: "Online",
    number: "04",
    icon: "L",
    color: "#60A5FA",
    room: "revenue-monitor",
    connectedModules: ["revenue-monitor", "commerce-terminal", "security-core", "system-logs"],
    currentTask: "Tracking revenue telemetry, budget notes, and payment approvals without moving money.",
    queue: ["Reconcile daily revenue", "Review payment note", "Prepare margin report"],
    queueCount: 3,
    permissions: ["Read finance telemetry", "Draft reports", "Cannot move money or place trades"],
    riskLevel: "High",
    actions: ["Reconciled revenue snapshot", "Flagged payment approval", "Updated finance notes"],
  },
  nexus: {
    id: "nexus",
    name: "Nexus",
    role: "Automation Agent",
    status: "Online",
    number: "05",
    icon: "N",
    color: "#38BDF8",
    room: "workflow-pipeline",
    connectedModules: ["workflow-pipeline", "logistics-node", "task-factory", "system-logs"],
    currentTask: "Maintaining workflow routes, triggers, and integration handoffs inside supervised limits.",
    queue: ["Refresh route links", "Check automation queue", "Prepare trigger report"],
    queueCount: 8,
    permissions: ["Draft automations", "Run internal checks", "Cannot create external accounts"],
    riskLevel: "Medium",
    actions: ["Refreshed route links", "Validated automation queue", "Paused external connector draft"],
  },
  sentry: {
    id: "sentry",
    name: "Sentry",
    role: "Security Agent",
    status: "Supervised",
    number: "06",
    icon: "S",
    color: "#F87171",
    room: "security-core",
    connectedModules: ["security-core", "system-logs", "agent-habitat", "customer-node"],
    currentTask: "Watching sessions, blocked actions, approvals, login attempts, and sensitive workflows.",
    queue: ["Scan access posture", "Review blocked actions", "Audit login history"],
    queueCount: 4,
    permissions: ["Read security events", "Draft risk reports", "Cannot change access without admin approval"],
    riskLevel: "High",
    actions: ["Cleared session scan", "Logged blocked action", "Confirmed approval gates"],
  },
  oracle: {
    id: "oracle",
    name: "Oracle",
    role: "Data Analyst",
    status: "Idle",
    number: "07",
    icon: "O",
    color: "#8B5CF6",
    room: "resources",
    connectedModules: ["resources", "revenue-monitor", "workflow-pipeline", "system-logs"],
    currentTask: "Preparing insight reports and prediction notes from local telemetry and system memory.",
    queue: ["Summarize data inventory", "Draft insight report"],
    queueCount: 2,
    permissions: ["Analyze local telemetry", "Draft reports", "Cannot make financial claims"],
    riskLevel: "Low",
    actions: ["Tagged stale telemetry", "Drafted insight snapshot", "Updated report backlog"],
  },
  depo: {
    ...depoAgent,
    permissions: [
      "Read/write working memory",
      "Draft artifacts",
      "Package actions for approval",
      "Cannot perform risky external actions",
    ],
  },
};

const roomProfiles = {
  "argentum-core": {
    id: "argentum-core",
    title: "Argentum Core",
    name: "Argentum Core",
    type: "AI Command Core",
    status: "Online",
    metric: `Agent ${depoAgent.number}`,
    icon: "AC",
    color: "#60A5FA",
    position: { x: 50, y: 43 },
    summary: `Central supervised habitat where ${depoAgent.name} lives, receives bounded work, and sends risky actions to the human gate.`,
    description: `Central supervised habitat where ${depoAgent.name} lives, receives bounded work, and sends risky actions to the human gate.`,
    agents: [depoAgent.name],
    connectedModules: ["depo-habitat"],
    connected: ["Agent Habitat"],
    tasks: [`Hold ${depoAgent.name}'s identity`, "Route one bounded task", "Protect approval boundaries"],
    activity: [`${depoAgent.name} has entered the habitat.`, "Revenue claims are cleared.", "Human-gate constraints are active."],
    metrics: [["Active agents", "1"], ["Revenue", "None yet"], ["Mode", "Supervised"]],
    workspaceType: "core",
  },
  "depo-habitat": {
    id: "depo-habitat",
    title: "Agent Habitat",
    name: "Agent Habitat",
    type: "First Agent Home",
    status: depoAgent.status,
    metric: `Agent ${depoAgent.number}`,
    icon: depoAgent.icon,
    color: depoAgent.color,
    position: { x: 50, y: 63 },
    labelPosition: { x: 50, y: 72 },
    summary: `The first real resident of Argentum. ${depoAgent.name} can research, organize evidence, draft outputs, and package approval-ready work.`,
    description: `The first real resident of Argentum. ${depoAgent.name} can research, organize evidence, draft outputs, and package approval-ready work.`,
    agents: [depoAgent.name],
    connectedModules: ["argentum-core"],
    connected: ["Argentum Core"],
    tasks: ["Accept one bounded workflow", ...depoAgent.can.slice(0, 2)],
    activity: [`${depoAgent.name} initialized.`, `${depoAgent.mode} permission set loaded.`, "No revenue has been claimed."],
    metrics: [["Identity", depoAgent.name], ["Current stage", depoStageLabel(depoAgent.currentStage)], ["External actions", depoAgent.externalActions]],
    workspaceType: "depo",
  },
  "agent-habitat": {
    id: "agent-habitat",
    title: "Agent Habitat",
    name: "Agent Habitat",
    type: "Agent Command",
    status: "Live",
    metric: "1 active agent",
    icon: "👥",
    color: "#22D3EE",
    position: { x: 18, y: 20 },
    labelPosition: { x: 18, y: 13 },
    summary: "Central habitat for visible agents, supervision rules, permissions, and operator coordination.",
    description: "Central habitat for visible agents, supervision rules, permissions, and operator coordination.",
    agents: ["Atlas", "Agent 101", "Sentry"],
    connectedModules: ["argentum-core", "ai-agents", "task-factory", "system-logs"],
    connected: ["AI Agents Room", "Task Factory", "Security Core", "Resources"],
    tasks: ["Review active agents", "Check permissions", "Open supervised workspaces"],
    activity: ["Atlas reconciled the command map.", "Agent 101 remains draft-only.", "Sentry verified approval gates."],
    metrics: [["Agents", "7"], ["Mode", "Supervised"], ["External actions", "Locked"]],
    workspaceType: "agent",
  },
  "ai-agents": {
    id: "ai-agents",
    title: "AI Agents Room",
    name: "AI Agents Room",
    type: "Agent Runtime",
    status: "Live",
    metric: "1 active agent",
    icon: "🤖",
    color: "#60A5FA",
    position: { x: 39, y: 20 },
    labelPosition: { x: 39, y: 13 },
    summary: "Runtime coordination room where active agents exchange context, queues, and route state.",
    description: "Runtime coordination room where active agents exchange context, queues, and route state.",
    agents: ["Atlas", "Nexus", "Agent 101"],
    connectedModules: ["agent-habitat", "argentum-core", "workflow-pipeline", "security-core"],
    connected: ["Agent Habitat", "Security Core", "Workflow Pipeline"],
    tasks: ["Balance agent queues", "Route context", "Track active status"],
    activity: ["Nexus refreshed route links.", "Atlas synced agent state.", "Agent 101 moved to Verify."],
    metrics: [["Active agents", "7"], ["Context sync", "Live"], ["Queue pressure", "Normal"]],
    workspaceType: "agents",
  },
  "task-factory": {
    id: "task-factory",
    title: "Task Factory",
    name: "Task Factory",
    type: "Production Queue",
    status: "Active",
    metric: "1 queued task",
    icon: "⚙️",
    color: "#FBBF24",
    position: { x: 12, y: 43 },
    labelPosition: { x: 12, y: 40 },
    summary: "Production factory for intake, prioritization, draft generation, and approval-ready task packages.",
    description: "Production factory for intake, prioritization, draft generation, and approval-ready task packages.",
    agents: ["Forge", "Nexus", "Agent 101"],
    connectedModules: ["commerce-terminal", "workflow-pipeline", "resources", "argentum-core"],
    connected: ["Agent Habitat", "Commerce Terminal", "Workflow Pipeline", "Resources"],
    tasks: ["Package task batch", "Prepare draft outputs", "Route risky actions to approval"],
    activity: ["Forge deployed a production batch.", "Agent 101 packaged one approval.", "Nexus checked automation pressure."],
    metrics: [["Active", "197"], ["Queued", "8"], ["Failed", "0"]],
    workspaceType: "forge",
  },
  "commerce-terminal": {
    id: "commerce-terminal",
    title: "Commerce Terminal",
    name: "Commerce Terminal",
    type: "Commerce",
    status: "Draft only",
    metric: "Mock value",
    icon: "🛒",
    color: "#38BDF8",
    position: { x: 35, y: 43 },
    labelPosition: { x: 31, y: 40 },
    summary: "Core commerce and storefront operations hub for orders, revenue signals, campaigns, and handoffs.",
    description: "Core commerce and storefront operations hub for orders, revenue signals, campaigns, and handoffs.",
    agents: ["Prism", "Nexus"],
    connectedModules: ["task-factory", "revenue-monitor", "customer-node", "workflow-pipeline"],
    connected: ["Task Factory", "Revenue Monitor", "Content Engine", "Customer Node"],
    tasks: ["Scan orders", "Sync storefront telemetry", "Package campaign report"],
    activity: ["Commerce lane reserved.", "No live order feed connected.", "Publishing and checkout remain approval-gated."],
    metrics: [["Orders", "197"], ["Revenue", "$7,128"], ["AOV", "$36.21"]],
    workspaceType: "commerce",
  },
  "revenue-monitor": {
    id: "revenue-monitor",
    title: "Revenue Monitor",
    name: "Revenue Monitor",
    type: "Finance Telemetry",
    status: "Guarded",
    metric: "Budget guard",
    icon: "📊",
    color: "#60A5FA",
    position: { x: 65, y: 43 },
    labelPosition: { x: 69, y: 40 },
    summary: "Revenue telemetry station for daily sales, deltas, AOV, expense notes, and payment review.",
    description: "Revenue telemetry station for daily sales, deltas, AOV, expense notes, and payment review.",
    agents: ["Ledger", "Oracle"],
    connectedModules: ["commerce-terminal", "resources", "argentum-core", "security-core"],
    connected: ["Commerce Terminal", "Security Core", "Resources", "System Logs"],
    tasks: ["Reconcile daily revenue", "Draft margin notes", "Hold money movement behind approval"],
    activity: ["Ledger reconciled transactions.", "Oracle tagged stale telemetry.", "Payment note routed to review."],
    metrics: [["Today", "$7,128"], ["Delta", "+12.4%"], ["AOV", "$36.21"]],
    workspaceType: "ledger",
  },
  resources: {
    id: "resources",
    title: "Resources",
    name: "Resources",
    type: "Data Store",
    status: "Optimal",
    metric: "12,455 items",
    icon: "📦",
    color: "#60A5FA",
    position: { x: 14, y: 72 },
    labelPosition: { x: 18, y: 68 },
    summary: "Private resource inventory for memory, evidence, assets, product data, and local telemetry.",
    description: "Private resource inventory for memory, evidence, assets, product data, and local telemetry.",
    agents: ["Oracle", "Agent 101"],
    connectedModules: ["task-factory", "logistics-node", "workflow-pipeline", "argentum-core"],
    connected: ["Task Factory", "Logistics Node", "Workflow Pipeline", "Revenue Monitor"],
    tasks: ["Index resources", "Label evidence freshness", "Separate private memory"],
    activity: ["Oracle scanned data inventory.", "Agent 101 wrote provenance notes.", "Resource health remains optimal."],
    metrics: [["Items", "12,455"], ["Freshness", "97%"], ["Private", "On"]],
    workspaceType: "oracle",
  },
  "logistics-node": {
    id: "logistics-node",
    title: "Logistics Node",
    name: "Logistics Node",
    type: "Route Control",
    status: "Live",
    metric: "8 routes",
    icon: "🚚",
    color: "#38BDF8",
    position: { x: 37, y: 72 },
    labelPosition: { x: 37, y: 68 },
    summary: "Route-control node for internal movement between tasks, workflows, resources, and output lanes.",
    description: "Route-control node for internal movement between tasks, workflows, resources, and output lanes.",
    agents: ["Nexus", "Forge"],
    connectedModules: ["resources", "workflow-pipeline", "commerce-terminal", "customer-node"],
    connected: ["Resources", "Workflow Pipeline", "Task Factory"],
    tasks: ["Route queued work", "Check bottlenecks", "Report automation pressure"],
    activity: ["Nexus refreshed eight routes.", "Forge cleared production lane.", "No external connector opened."],
    metrics: [["Routes", "8"], ["Latency", "42ms"], ["Queue", "Healthy"]],
    workspaceType: "nexus",
  },
  "workflow-pipeline": {
    id: "workflow-pipeline",
    title: "Workflow Pipeline",
    name: "Workflow Pipeline",
    type: "Workflow",
    status: "Active",
    metric: "Current stage",
    icon: "🔗",
    color: "#8B5CF6",
    position: { x: 63, y: 72 },
    labelPosition: { x: 63, y: 68 },
    summary: "Pipeline for intake, processing, review, output, and approval handoffs across the business system.",
    description: "Pipeline for intake, processing, review, output, and approval handoffs across the business system.",
    agents: ["Nexus", "Forge", "Atlas"],
    connectedModules: ["agent-habitat", "task-factory", "logistics-node", "content-engine", "system-logs"],
    connected: ["Logistics Node", "Content Engine", "AI Agents Room", "Resources"],
    tasks: ["Track intake", "Monitor processing", "Send review packages"],
    activity: ["Nexus cycle complete.", "Review lane has 98 items.", "Output lane has 70 items."],
    metrics: [["Intake", "1"], ["Processing", "0"], ["Review", "0"], ["Output", "0"]],
    workspaceType: "workflow",
  },
  "content-engine": {
    id: "content-engine",
    title: "Content Engine",
    name: "Content Engine",
    type: "Creative Output",
    status: "Active",
    metric: "5 drafts",
    icon: "✏️",
    color: "#A78BFA",
    position: { x: 87, y: 72 },
    labelPosition: { x: 82, y: 68 },
    summary: "Creative and marketing output engine for drafts, campaign assets, listing copy, and content reviews.",
    description: "Creative and marketing output engine for drafts, campaign assets, listing copy, and content reviews.",
    agents: ["Prism", "Forge"],
    connectedModules: ["workflow-pipeline", "commerce-terminal", "customer-node", "system-logs"],
    connected: ["Commerce Terminal", "Workflow Pipeline", "Customer Node"],
    tasks: ["Generate creative set", "Draft campaign assets", "Prepare review package"],
    activity: ["Prism generated content variants.", "Forge packaged output set.", "Publication remains approval-gated."],
    metrics: [["Generating", "5"], ["Drafts", "14"], ["Review", "Required"]],
    workspaceType: "prism",
  },
  "customer-node": {
    id: "customer-node",
    title: "Customer Node",
    name: "Customer Node",
    type: "Customer Signals",
    status: "Guarded",
    metric: "Contact locked",
    icon: "👤",
    color: "#22D3EE",
    position: { x: 88, y: 43 },
    labelPosition: { x: 88, y: 40 },
    summary: "Customer signal node for inbound events, support visibility, privacy checks, and contact gating.",
    description: "Customer signal node for inbound events, support visibility, privacy checks, and contact gating.",
    agents: ["Prism", "Sentry"],
    connectedModules: ["commerce-terminal", "content-engine", "security-core", "system-logs"],
    connected: ["Commerce Terminal", "Content Engine", "Security Core"],
    tasks: ["Review customer signals", "Protect personal data", "Hold outbound contact for approval"],
    activity: ["Customer signal received.", "Sentry cleared privacy gate.", "Outbound contact remains locked."],
    metrics: [["Active", "24"], ["Privacy", "Guarded"], ["Outbound", "Locked"]],
    workspaceType: "support",
  },
  "security-core": {
    id: "security-core",
    title: "Security Core",
    name: "Security Core",
    type: "Security",
    status: "Secure",
    metric: "No threats",
    icon: "🛡️",
    color: "#60A5FA",
    position: { x: 61, y: 20 },
    labelPosition: { x: 61, y: 13 },
    summary: "Security core enforcing signed sessions, approval gates, blocked external actions, and audit visibility.",
    description: "Security core enforcing signed sessions, approval gates, blocked external actions, and audit visibility.",
    agents: ["Sentry", "Atlas"],
    connectedModules: ["argentum-core", "ai-agents", "revenue-monitor", "customer-node", "system-logs"],
    connected: ["AI Agents Room", "System Logs", "Revenue Monitor", "Customer Node"],
    tasks: ["Scan sessions", "Enforce approval gates", "Record high-risk events"],
    activity: ["Sentry completed security scan.", "High-risk gate remains active.", "No threats found."],
    metrics: [["Threats", "0"], ["Blocked actions", "7"], ["Sessions", "Signed"]],
    workspaceType: "sentry",
  },
  "system-logs": {
    id: "system-logs",
    title: "System Logs",
    name: "System Logs",
    type: "Audit Trail",
    status: "Live feed",
    metric: "6 events",
    icon: "📋",
    color: "#38BDF8",
    position: { x: 82, y: 20 },
    labelPosition: { x: 82, y: 17 },
    summary: "Visible event stream for agent activity, operator actions, security events, approvals, and workflow changes.",
    description: "Visible event stream for agent activity, operator actions, security events, approvals, and workflow changes.",
    agents: ["Sentry", "Atlas", "Oracle"],
    connectedModules: ["agent-habitat", "content-engine", "customer-node", "security-core", "workflow-pipeline"],
    connected: ["Security Core", "Revenue Monitor", "Workflow Pipeline", "Agent Habitat"],
    tasks: ["Record events", "Expose audit trail", "Keep system feed readable"],
    activity: ["Sentry suspicious login review.", "Nexus cycle complete.", "Atlas reconciled command map."],
    metrics: [["Events", "6"], ["Feed", "Live"], ["Audit", "On"]],
    workspaceType: "logs",
  },
};

const habitatFloorRoomById = Object.fromEntries(habitatFloorRooms.map((room) => [room.id, room]));

habitatFloorRooms.forEach((room) => {
  roomProfiles[room.id] = {
    ...(roomProfiles[room.id] || {}),
    id: room.id,
    title: room.title,
    name: room.name,
    type: room.type,
    status: room.status,
    metric: room.metric,
    icon: room.icon,
    color: room.color,
    position: room.position,
    size: room.size,
    visual: room.visual,
    summary: room.purpose,
    description: room.purpose,
    agents: [depoAgent.name],
    connectedModules: room.connections,
    connected: room.connections.map((connectionId) => habitatFloorRoomById[connectionId]?.title || moduleDisplayName(connectionId)),
    tasks: room.id === "depo-habitat" ? [depoAgent.currentTask] : [room.subtitle, room.metric, room.riskNote],
    activity: room.recentActivity,
    purpose: room.purpose,
    depoRole: room.depoRole,
    riskNote: room.riskNote,
    allowedActions: room.allowedActions,
    blockedActions: room.blockedActions,
    metrics: [
      ["Status", room.status],
      ["Metric", room.metric],
      ["Human Gate", depoAgent.humanGate],
    ],
    workspaceType: room.id === "depo-habitat" ? "depo" : room.type,
  };
});

const habitatMapModules = habitatFloorRooms
  .filter((room) => room.id !== "depo-habitat" && room.visible !== false)
  .map((room) => roomProfiles[room.id]);

const moduleRoutes = [
  { from: "depo-habitat", to: "clips-office", kind: "spoke" },
  { from: "depo-habitat", to: "stock-office", kind: "spoke" },
  { from: "depo-habitat", to: "etsy-office", kind: "spoke" },
  { from: "depo-habitat", to: "essentrx-office", kind: "spoke" },
  { from: "depo-habitat", to: "human-gate", kind: "approval" },
];

const depoWorkflowState = {
  activeAgent: depoAgent.name,
  currentTask: depoAgent.currentTask,
  currentStage: depoAgent.currentStage,
  mode: depoAgent.mode,
  riskMode: depoAgent.riskMode,
  externalActions: depoAgent.externalActions,
  humanGate: depoAgent.humanGate,
  canDepoDo: depoAgent.can,
  cannotDepoDo: depoAgent.cannot,
  stages: depoAgent.workflowStages,
};

const habitatModuleCards = {
  "argentum-core": {
    purpose: "Central supervised habitat for Argentum's first real agent.",
    status: "Supervised",
    metric: `Agent ${depoAgent.number} online`,
    depoRole: `Keeps ${depoAgent.name}'s work local, bounded, and routed through approval before any risky action.`,
    connections: ["depo-habitat"],
    recentActivity: ["Agent 101 is active.", "Revenue counters reset to none.", "Risk gates are active."],
    riskNote: "Approval is required before any risky external action.",
    quickActions: ["Run cycle", "View system routes", "View approvals"],
  },
  "depo-habitat": {
    purpose: "Home base for the first supervised agent.",
    status: depoAgent.status,
    metric: `Agent ${depoAgent.number}`,
    depoRole: `${depoAgent.name} lives here and starts with research, evidence organization, drafting, and approval packaging.`,
    connections: ["argentum-core"],
    recentActivity: [`${depoAgent.name} activated.`, `${depoAgent.mode} rules loaded.`, "First workflow waiting."],
    riskNote: `${depoAgent.name} can prepare internal work, but cannot ${depoAgent.cannot.slice(0, 4).join(", ")} or perform risky external actions.`,
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
  "agent-habitat": {
    purpose: "Home base for supervised agents.",
    status: "Live",
    metric: "1 active agent",
    depoRole: "Agent 101 lives here as the only active supervised operator.",
    connections: ["argentum-core", "ai-agents", "task-factory", "system-logs"],
    recentActivity: ["Agent 101 active.", "Agent health checked.", "No new agents created."],
    riskNote: "New agents require human approval.",
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
  "ai-agents": {
    purpose: "Agent coordination and capability management.",
    status: "Live",
    metric: "1 active agent",
    depoRole: "Agent 101 receives instructions and sends completed drafts back for review.",
    connections: ["agent-habitat", "argentum-core", "workflow-pipeline", "security-core"],
    recentActivity: ["Agent 101 cycle initialized.", "Permissions verified."],
    riskNote: "Agent permissions are locked.",
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
  "task-factory": {
    purpose: "Converts ideas into structured tasks.",
    status: "Active",
    metric: "197 active references / 1 queued task",
    depoRole: "Agent 101 breaks work into research, evidence, draft, and approval steps.",
    connections: ["commerce-terminal", "workflow-pipeline", "resources", "argentum-core"],
    recentActivity: ["New task queued.", "Research lane prepared."],
    riskNote: "Tasks can be drafted, not deployed.",
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
  "commerce-terminal": {
    purpose: "Commerce/storefront planning and order logic.",
    status: "Draft only",
    metric: "Revenue not connected / mock value only",
    depoRole: "Agent 101 can prepare commerce ideas, but cannot publish or charge customers.",
    connections: ["task-factory", "revenue-monitor", "customer-node", "workflow-pipeline"],
    recentActivity: ["Commerce draft prepared.", "No live sales action taken."],
    riskNote: "Publishing, checkout, pricing, or money movement requires approval.",
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
  "revenue-monitor": {
    purpose: "Finance, budget, revenue, and cost awareness.",
    status: "Guarded",
    metric: "Budget guard active",
    depoRole: "Agent 101 can estimate costs and summarize revenue, but cannot move money.",
    connections: ["commerce-terminal", "resources", "argentum-core", "security-core"],
    recentActivity: ["Budget check passed.", "Expense note prepared."],
    riskNote: "Money movement is locked.",
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
  resources: {
    purpose: "Memory, files, inventory, and reusable knowledge.",
    status: "Optimal",
    metric: "12,455 items / private memory active",
    depoRole: "Agent 101 stores notes, references, and reusable research here.",
    connections: ["task-factory", "logistics-node", "workflow-pipeline", "argentum-core"],
    recentActivity: ["Research note saved.", "Memory updated."],
    riskNote: "Sensitive data access should be logged.",
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
  "logistics-node": {
    purpose: "Routes work between stages and modules.",
    status: "Live",
    metric: "8 routes active",
    depoRole: "Agent 101 uses this node to move drafts from research to approval.",
    connections: ["resources", "workflow-pipeline", "commerce-terminal", "customer-node"],
    recentActivity: ["Route to Workflow Pipeline active."],
    riskNote: "External delivery actions require approval.",
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
  "workflow-pipeline": {
    purpose: "Main stage tracker for Agent 101's supervised loop.",
    status: "Active",
    metric: "Current stage: Workflow Pipeline",
    depoRole: "Agent 101 moves through Intake -> Research -> Verify -> Draft -> Package -> Approval.",
    connections: ["agent-habitat", "task-factory", "logistics-node", "content-engine", "system-logs"],
    recentActivity: ["Stage moved to Workflow Pipeline."],
    riskNote: "Final action must pass Human Gate.",
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
  "content-engine": {
    purpose: "Drafts outputs, concepts, listings, posts, and creative assets.",
    status: "Draft only",
    metric: "5 generating / 0 published",
    depoRole: "Agent 101 can create drafts but cannot publish externally.",
    connections: ["workflow-pipeline", "commerce-terminal", "customer-node", "system-logs"],
    recentActivity: ["Draft output prepared.", "Awaiting review."],
    riskNote: "Publishing requires approval.",
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
  "customer-node": {
    purpose: "Customer-facing communication and support awareness.",
    status: "Guarded",
    metric: "Contact gate locked",
    depoRole: "Agent 101 can draft customer messages but cannot send them.",
    connections: ["commerce-terminal", "content-engine", "security-core", "system-logs"],
    recentActivity: ["Customer contact blocked by gate."],
    riskNote: "Contacting customers requires approval.",
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
  "security-core": {
    purpose: "Approval gates, permissions, risk checks, and blocked actions.",
    status: "Secure",
    metric: "No threats",
    depoRole: "Agent 101 checks whether actions are safe before packaging them for approval.",
    connections: ["argentum-core", "ai-agents", "revenue-monitor", "customer-node", "system-logs"],
    recentActivity: ["Permission check passed.", "External action blocked."],
    riskNote: "High-risk actions must be approved.",
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
  "system-logs": {
    purpose: "Live event stream and audit history.",
    status: "Live feed",
    metric: "6 events",
    depoRole: "Agent 101 writes cycle updates and action notes here.",
    connections: ["agent-habitat", "content-engine", "customer-node", "security-core", "workflow-pipeline"],
    recentActivity: ["Agent 101 moved to Workflow Pipeline.", "Approval required."],
    riskNote: "Logs should be append-only when possible.",
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
};

habitatFloorRooms.forEach((room) => {
  habitatModuleCards[room.id] = {
    purpose: room.purpose,
    status: room.status,
    metric: room.metric,
    depoRole: room.depoRole,
    connections: room.connections,
    recentActivity: room.recentActivity,
    riskNote: room.riskNote,
    quickActions: roomQuickActions[room.id] || ["View tasks", "View logs", "Run check", "Package for approval"],
    allowedActions: room.allowedActions,
    blockedActions: room.blockedActions,
    canDepoDo: depoAgent.can,
    cannotDepoDo: depoAgent.cannot,
  };
});

function updateHabitatRoomRuntimeFromState() {
  const tasks = stateList("tasks");
  const localDepoTasks = depoTasks();
  const localWorkflowDrafts = workflowDrafts();
  const localBlueprints = agentBlueprints();
  const queuedTasks = [
    ...tasks.filter((task) => task.status === "queued"),
    ...localDepoTasks.filter((task) => ["Draft", "Intake", "Queued"].includes(task.status) || ["Intake", "Research", "Verify", "Draft"].includes(task.stage)),
  ];
  const activeTasks = tasks.filter((task) => ["queued", "processing", "drafting"].includes(task.status));
  const artifacts = stateList("artifacts");
  const draftArtifacts = [
    ...artifacts.filter((artifact) => !["approved", "blocked"].includes(artifact.status)),
    ...localWorkflowDrafts,
    ...localBlueprints,
  ];
  const approvals = stateList("approvals");
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  const auditEntries = [...systemLogEntries(), ...stateList("audit")];
  const memoryCount = memoryEntries().length;
  const evidenceCount = taskEvidenceCount(tasks) + artifactEvidenceCount(artifacts);
  const verificationCount = pendingApprovals.length + tasks.filter((task) => ["medium", "high"].includes(String(task.risk || "").toLowerCase())).length;
  const keywordCount = (items, keywords) =>
    items.filter((item) => {
      const text = `${item.title || ""} ${item.summary || ""} ${item.operatorText || ""} ${item.intent || ""} ${item.type || ""} ${item.workflowId || ""}`.toLowerCase();
      return keywords.some((keyword) => text.includes(keyword));
    }).length;
  const businessItems = [...tasks, ...artifacts, ...localWorkflowDrafts, ...localBlueprints];
  const clipsCount = keywordCount(businessItems, ["clip", "video", "reel", "tiktok", "short"]);
  const stockCount = keywordCount(businessItems, ["stock", "market", "watch", "trade", "ticker"]);
  const etsyCount = keywordCount(businessItems, ["etsy", "pod", "print-on-demand", "listing", "store"]);
  const essentrxCount = keywordCount(businessItems, ["essentrx", "scent", "fragrance", "quiz", "admin"]);

  syncRoomRuntime("depo-habitat", {
    subtitle: "Master agent",
    metric: `Agent ${depoAgent.number}`,
    status: depoAgent.status,
    runtimeActivity: [
      "Only Agent 101 is active.",
      "All business offices report to Agent 101.",
      `${depoStageLabel(depoAgent.currentStage)} is the current stage.`,
    ],
  });
  syncRoomRuntime("clips-office", {
    subtitle: clipsCount ? "Clip work active" : "Video planning",
    metric: clipsCount ? pluralize(clipsCount, "item") : "Ready",
    status: clipsCount ? "Drafting" : "Ready",
    runtimeActivity: [
      `${pluralize(clipsCount, "clip-related item")} in local state.`,
      activeTasks.length || localDepoTasks.length ? `${pluralize(activeTasks.length + localDepoTasks.length, "active task")} can feed clip work.` : "No active clip backlog.",
      "Posting remains approval-gated.",
    ],
  });
  syncRoomRuntime("stock-office", {
    subtitle: stockCount ? "Market notes" : "Watch desk",
    metric: stockCount ? pluralize(stockCount, "item") : "Guarded",
    status: stockCount ? "Research" : "Ready",
    runtimeActivity: [
      `${pluralize(stockCount, "stock-related item")} in local state.`,
      `${pluralize(verificationCount, "risk check")} available before decisions.`,
      "Trades and money movement are locked.",
    ],
  });
  syncRoomRuntime("etsy-office", {
    subtitle: etsyCount ? "Store drafts" : "POD planning",
    metric: etsyCount ? pluralize(etsyCount, "item") : "Draft only",
    status: etsyCount ? "Planning" : "Ready",
    runtimeActivity: [
      `${pluralize(etsyCount, "Etsy/POD item")} in local state.`,
      pendingApprovals.length ? `${pluralize(pendingApprovals.length, "approval")} waiting before store action.` : "No store approval waiting.",
      "Publishing and pricing stay locked.",
    ],
  });
  syncRoomRuntime("essentrx-office", {
    subtitle: essentrxCount ? "Brand work active" : "Brand ops",
    metric: essentrxCount ? pluralize(essentrxCount, "item") : "Connected",
    status: essentrxCount ? "Drafting" : "Ready",
    runtimeActivity: [
      `${pluralize(essentrxCount, "Essentrx item")} in local state.`,
      "Customer-facing changes require approval.",
      "Agent 101 owns final review.",
    ],
  });
  syncRoomRuntime("memory-vault", {
    subtitle: memoryCount ? "Stored memory" : "No memory",
    metric: memoryCount ? pluralize(memoryCount, "note") : "0 notes",
    status: memoryCount ? "Stored" : "Empty",
    runtimeActivity: [
      `${pluralize(memoryCount, "memory note")} stored across working, shared, and agent memory.`,
      "No secrets are displayed here.",
      "Agent 101 can read and organize memory.",
    ],
  });
  syncRoomRuntime("draft-studio", {
    subtitle: draftArtifacts.length ? "Drafts active" : "No drafts",
    metric: draftArtifacts.length ? pluralize(draftArtifacts.length, "draft") : "0 drafts",
    status: draftArtifacts.length ? "Drafting" : "Ready",
    runtimeActivity: [
      `${pluralize(draftArtifacts.length, "draft artifact")} not approved yet.`,
      localBlueprints.length ? `${pluralize(localBlueprints.length, "agent blueprint")} drafted, not live.` : "No agent blueprints drafted yet.",
      queuedTasks.length ? `${pluralize(queuedTasks.length, "queued task")} can become drafts.` : "No queued draft work.",
    ],
  });
  syncRoomRuntime("output-bench", {
    subtitle: artifacts.length ? "Prepared outputs" : "No outputs",
    metric: artifacts.length ? pluralize(artifacts.length, "artifact") : "0 artifacts",
    status: artifacts.length ? "Prepared" : "Empty",
    runtimeActivity: [
      `${pluralize(artifacts.length, "artifact")} on the output bench.`,
      "Outputs stay internal until approved.",
      "No customer delivery action is enabled.",
    ],
  });
  syncRoomRuntime("human-gate", {
    subtitle: pendingApprovals.length ? "Approval queue" : "Locked",
    metric: countPhrase(pendingApprovals.length, "pending"),
    status: "Locked",
    runtimeActivity: [
      `${pluralize(pendingApprovals.length, "pending approval")} in Human Gate.`,
      "External actions are locked.",
      "Operator review is required.",
    ],
  });
  syncRoomRuntime("system-log", {
    subtitle: auditEntries.length ? "Event stream" : "No events",
    metric: auditEntries.length ? pluralize(auditEntries.length, "event") : "0 events",
    status: "Live",
    runtimeActivity: [
      `${pluralize(auditEntries.length, "audit event")} recorded.`,
      auditEntries[0]?.title || "No recent event yet.",
      "Logs remain local.",
    ],
  });
}

// OrbitScene state
const legacyRoomAliases = {
  Overview: "depo-habitat",
  Research: "stock-office",
  Verify: "etsy-office",
  Draft: "essentrx-office",
  Approval: "human-gate",
  Commerce: "etsy-office",
  Finance: "stock-office",
  Inventory: "etsy-office",
  Logistics: "essentrx-office",
  Marketing: "clips-office",
  Support: "essentrx-office",
  Logs: "system-log",
  "task-intake": "clips-office",
  "research-lab": "stock-office",
  "verify-station": "etsy-office",
  "draft-studio": "essentrx-office",
};

const workspaceProfiles = {
  atlas: {
    title: "Atlas Workspace",
    eyebrow: "System Overseer",
    sections: [
      ["System overview", "Coordinate map state, approvals, risk checks, and agent handoffs from one command room."],
      ["Approvals", "Watch high-risk gates and prepare operator-ready review packets."],
      ["Coordination", "Atlas never approves its own work; it routes decisions to the human gate."],
    ],
    feed: ["Atlas reconciled the command map", "Atlas checked habitat health", "Atlas routed a risk note"],
  },
  forge: {
    title: "Forge Workspace",
    eyebrow: "Production Agent",
    sections: [
      ["Production queue", "Active jobs, completed jobs, failed jobs, and draft packages ready for review."],
      ["Quality pass", "Every output is bundled with assumptions, source notes, and blocked external actions."],
      ["Limits", "Publishing, spend, and account changes remain unavailable from production."],
    ],
    feed: ["Forge deployed production batch", "Forge prepared one review bundle", "Forge cleared failed-job list"],
  },
  prism: {
    title: "Prism Workspace",
    eyebrow: "Creative / Marketing",
    sections: [
      ["Content queue", "Campaign drafts, creative variants, listing copy, and generated asset notes."],
      ["Review lane", "Publishing stays locked until the operator approves an exact external action."],
      ["Signals", "Prism uses commerce and customer signals without contacting customers."],
    ],
    feed: ["Prism updated campaign draft", "Prism tagged creative assets", "Prism routed publish action to approval"],
  },
  ledger: {
    title: "Ledger Workspace",
    eyebrow: "Finance Agent",
    sections: [
      ["Revenue", "Daily sales, AOV, margin notes, and payment telemetry are presented for review."],
      ["Approvals", "Money movement, trades, payment changes, and finance claims are blocked by design."],
      ["Notes", "Ledger drafts finance reports but cannot execute external finance actions."],
    ],
    feed: ["Ledger reconciled revenue snapshot", "Ledger flagged payment review", "Ledger updated finance notes"],
  },
  nexus: {
    title: "Nexus Workspace",
    eyebrow: "Automation Agent",
    sections: [
      ["Automations", "Triggers, integrations, workflow routes, and internal handoffs are visible here."],
      ["Queue", "Eight automation jobs are staged; external connectors require approval before activation."],
      ["Safety", "Nexus can draft workflows but cannot create accounts or open external integrations."],
    ],
    feed: ["Nexus refreshed route links", "Nexus checked automation queue", "Nexus paused external connector draft"],
  },
  sentry: {
    title: "Sentry Workspace",
    eyebrow: "Security Agent",
    sections: [
      ["Security events", "Warnings, blocked actions, signed sessions, login attempts, and approval gates."],
      ["Policy", "Sentry monitors but does not silently change accounts, credentials, or permissions."],
      ["Audit", "Security events remain visible in the local audit stream."],
    ],
    feed: ["Sentry completed security scan", "Sentry logged blocked action", "Sentry confirmed approval gates"],
  },
  oracle: {
    title: "Oracle Workspace",
    eyebrow: "Data Analyst",
    sections: [
      ["Analytics", "Insights, reports, forecasts, telemetry notes, and data quality checks."],
      ["Predictions", "Oracle labels uncertainty and does not make financial or legal claims as fact."],
      ["Reports", "Insight drafts are routed through review before external use."],
    ],
    feed: ["Oracle tagged stale telemetry", "Oracle drafted insight snapshot", "Oracle updated report backlog"],
  },
  depo: {
    title: `${depoAgent.name} Workspace`,
    eyebrow: depoAgent.role,
    sections: [
      ["Mode", `${depoAgent.mode}. ${depoAgent.name} can ${depoAgent.can.slice(0, 4).join(", ")}.`],
      ["Current stage", depoStageLabel(depoAgent.currentStage)],
      ["Security", `${depoAgent.externalActions}. ${depoAgent.name} cannot ${depoAgent.cannot.slice(0, 4).join(", ")}.`],
    ],
    feed: depoAgent.actions,
  },
};

let selectedRoomKey = null;
let selectedAgentKey = null;
let depoChatMessages = [];

function normalizeClientChatMessage(message = {}) {
  const text = String(message.text || "").trim();
  const roomId = resolveRoomKey(message.roomId || "depo-habitat");
  const speaker = ["operator", "depo", "agent"].includes(message.speaker) ? message.speaker : "depo";
  const createdAt = message.createdAt || new Date().toISOString();
  return {
    id: message.id || `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    roomId,
    speaker,
    text,
    prompt: message.prompt,
    source: message.source,
    pending: Boolean(message.pending),
    createdAt,
  };
}

function normalizeClientChatMessages(messages = []) {
  const seen = new Set();
  return (Array.isArray(messages) ? messages : [])
    .map(normalizeClientChatMessage)
    .filter((message) => {
      if (!message.text || seen.has(message.id)) return false;
      seen.add(message.id);
      return true;
    })
    .slice(-120);
}

function appendDepoChatMessages(messages = [], options = {}) {
  const incoming = normalizeClientChatMessages(Array.isArray(messages) ? messages : [messages]);
  if (!incoming.length) return [];
  depoChatMessages = normalizeClientChatMessages([...depoChatMessages, ...incoming]).slice(-120);
  state.chatMessages = normalizeClientChatMessages([...(state.chatMessages || []), ...incoming.filter((message) => !message.pending)]).slice(-120);
  if (options.persist !== false && apiAvailable) {
    persistChatMessages(incoming.filter((message) => !message.pending));
  }
  return incoming;
}

async function persistChatMessages(messages = []) {
  if (!apiAvailable) return;
  const safeMessages = normalizeClientChatMessages(messages).filter((message) => !message.pending);
  if (!safeMessages.length) return;
  try {
    await postJson("/api/chat/messages", { messages: safeMessages });
  } catch (error) {
    addLocalAudit("Chat memory unavailable", error.message);
  }
}

const mapHomeScale = 1;
const mapMinScale = 0.86;
const mapMaxScale = 2.8;
const mapViewLocked = true;
const mapPanEpsilon = 0.001;
let mapView = { x: 0, y: 0, scale: mapHomeScale };
let isPanning = false;
let panStart = { x: 0, y: 0, viewX: 0, viewY: 0 };
let pointerCache = new Map();
let pinchStart = null;
let accessState = null;
let activeSettingsTarget = "settings-access";
let moduleInfoLockedScroll = { x: 0, y: 0 };
let aiProviderSettings = {
  provider: "local_demo",
  providerLabel: "Local Demo",
  mode: "demo",
  modeLabel: "Local Demo",
  connectionStatus: "Connected",
  activeModel: "local-demo",
  lastError: "",
  monthlyLimitUsd: 10,
  usage: { estimatedMonthlyUsd: 0, requestCount: 0, blockedByLimit: false },
  lastTest: null,
  providers: {
    local_demo: { keyConfigured: false, keyStatus: "No key required", model: "local-demo" },
    openai: { keyConfigured: false, keyStatus: "Not configured", model: "gpt-5.4-nano", temperature: 0.4, maxOutputTokens: 700 },
  },
};
let aiProviderNotice = "";
let agent101ToolStatus = null;
let sidebarSystemStatus = null;

const settingsSectionGroups = {
  "settings-access": ["settings-access", "settings-overview"],
  "settings-users": ["settings-users", "settings-create-user"],
  "settings-password": ["settings-password"],
  "settings-api-keys": ["settings-api-keys"],
  "settings-ai-providers": [
    "settings-ai-providers",
    "settings-ai-provider-select",
    "settings-ai-provider-env",
    "settings-ai-provider-safety",
    "settings-ai-provider-results",
  ],
  "settings-sessions": ["settings-sessions"],
  "settings-audit": ["settings-audit"],
  "settings-preferences": ["settings-preferences"],
  "settings-integrations": ["settings-integrations"],
  "settings-storage": ["settings-storage"],
  "settings-backup": ["settings-backup"],
  "settings-billing": ["settings-billing"],
};

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
    depoChatMessages = normalizeClientChatMessages(state.chatMessages || []);
    apiAvailable = true;
  } catch (error) {
    state = fallbackState;
    depoChatMessages = normalizeClientChatMessages(state.chatMessages || []);
    apiAvailable = false;
  }
  await loadAiProviderSettings();
  await loadAgent101ToolStatus();
  await loadSidebarSystemStatus();
  render();
  applyMapView(false);
}

async function mutate(path) {
  if (!apiAvailable) {
    return false;
  }
  state = await api(path, { method: "POST" });
  sidebarSystemStatus = fallbackSidebarStatus();
  render();
  return true;
}

function currentStep() {
  return state.mission.steps[state.mission.currentStep % state.mission.steps.length];
}

function depoStageLabel(stageId) {
  return depoWorkflowStageLabels[stageId] || moduleDisplayName(stageId);
}

function depoStageProgress(agent = depoAgent) {
  const index = agent.workflowStages.indexOf(agent.currentStage);
  if (index < 0) return 0;
  return Math.round(((index + 1) / agent.workflowStages.length) * 100);
}

function renderDepoOrbitState(agent = depoAgent) {
  const homeRoom = roomProfiles[agent.room] || roomProfiles["depo-habitat"];
  if (avatar && homeRoom?.position) {
    avatar.style.setProperty("--agent-x", `${homeRoom.position.x}%`);
    avatar.style.setProperty("--agent-y", `${homeRoom.position.y}%`);
  }
  if (progress) progress.style.width = `${depoStageProgress(agent)}%`;
  const stageLabel = depoStageLabel(agent.currentStage);
  if (cycleStatus) cycleStatus.textContent = state.mission.paused ? `Paused at ${stageLabel}` : `At ${stageLabel}`;
  if (missionTitle) missionTitle.textContent = `${agent.name} is ${agent.status.toLowerCase()}`;
  if (missionCopy) missionCopy.textContent = agent.currentTask;
  if (confidenceChip) confidenceChip.textContent = agent.mode;
  if (taskStage) taskStage.textContent = `Stage: ${stageLabel}`;
  if (riskLevel) riskLevel.textContent = `Risk: ${agent.riskMode}`;
  if (agentCoreName) agentCoreName.textContent = `Agent ${agent.number}`;
  if (agentCoreRole) agentCoreRole.textContent = "Superior Agent";
}

function setStep() {
  renderDepoOrbitState();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resolveRoomKey(roomKey) {
  return legacyRoomAliases[roomKey] || roomKey || "argentum-core";
}

function moduleProfile(roomKey) {
  return roomProfiles[resolveRoomKey(roomKey)] || roomProfiles["argentum-core"];
}

function connectedModuleSet(roomKey) {
  const resolved = resolveRoomKey(roomKey);
  const profile = moduleProfile(resolved);
  const connected = new Set([resolved, ...(profile.connectedModules || [])]);
  Object.values(roomProfiles).forEach((room) => {
    if ((room.connectedModules || []).includes(resolved)) connected.add(room.id);
  });
  return connected;
}

function shortStatusClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("busy")) return "busy";
  if (normalized.includes("idle")) return "idle";
  if (normalized.includes("secure") || normalized.includes("optimal")) return "secure";
  if (normalized.includes("draft") || normalized.includes("supervised")) return "supervised";
  return "online";
}

function renderAgentRoster() {
  if (!agentRosterList) return;
  const rosterAgents = Object.values(agentProfiles).filter((agent) => agent.id === "depo");
  agentRosterList.innerHTML = rosterAgents
    .map(
      (agent) => `
        <button class="roster-agent ${selectedAgentKey === agent.id ? "selected" : ""}" data-agent="${escapeHtml(agent.id)}" type="button" style="--agent-color: ${escapeHtml(agent.color)}">
          <span class="agent-badge" aria-hidden="true">${escapeHtml(agent.icon)}</span>
          <span class="agent-copy">
            <strong>${escapeHtml(agent.name)}</strong>
            <small>${escapeHtml(agent.role)}</small>
            <span class="agent-status ${escapeHtml(shortStatusClass(agent.status))}">${escapeHtml(agent.status)}</span>
          </span>
          <em>${escapeHtml(`Agent ${agent.number}`)}</em>
        </button>
      `,
    )
    .join("");
}

function routeEndpoints(route) {
  if (Array.isArray(route)) return { from: route[0], to: route[1], kind: "flow" };
  return route;
}

function routeIsActive(routeOrFrom, maybeTo) {
  const { from, to } = maybeTo ? { from: routeOrFrom, to: maybeTo } : routeEndpoints(routeOrFrom);
  if (!selectedRoomKey && !selectedAgentKey) {
    if (!depoAgent.currentStage || depoAgent.currentStage === "depo-habitat") return true;
    const currentRelated = connectedModuleSet(depoAgent.currentStage);
    return from === depoAgent.currentStage || to === depoAgent.currentStage || (currentRelated.has(from) && currentRelated.has(to));
  }
  const selected = selectedAgentKey ? resolveRoomKey(agentProfiles[selectedAgentKey]?.room) : resolveRoomKey(selectedRoomKey);
  const related = connectedModuleSet(selected);
  return from === selected || to === selected || (related.has(from) && related.has(to));
}

function routePoint(room) {
  return {
    x: room.position.x * 10,
    y: room.position.y * 6.2,
  };
}

function routeAnchorPoint(room, toward) {
  const center = routePoint(room);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  const distance = Math.hypot(dx, dy) || 1;
  const unitX = dx / distance;
  const unitY = dy / distance;
  const halfWidth = ((room.size?.w || 12) * 10) / 2;
  const halfHeight = ((room.size?.h || 12) * 6.2) / 2;
  const horizontalExit = unitX ? halfWidth / Math.abs(unitX) : Number.POSITIVE_INFINITY;
  const verticalExit = unitY ? halfHeight / Math.abs(unitY) : Number.POSITIVE_INFINITY;
  const edgeOffset = Math.min(horizontalExit, verticalExit) * 1.04;

  return {
    x: center.x + unitX * edgeOffset,
    y: center.y + unitY * edgeOffset,
  };
}

function bridgeRouteGeometry(source, target, index) {
  const sourceCenter = routePoint(source);
  const targetCenter = routePoint(target);
  const start = routeAnchorPoint(source, targetCenter);
  const end = routeAnchorPoint(target, sourceCenter);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy) || 1;
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const bendDirection = index % 2 === 0 ? 1 : -1;
  const bend = bendDirection * clamp(distance * 0.08, 18, 58);
  const c1x = start.x + dx * 0.34 + normalX * bend;
  const c1y = start.y + dy * 0.34 + normalY * bend;
  const c2x = start.x + dx * 0.66 + normalX * bend;
  const c2y = start.y + dy * 0.66 + normalY * bend;
  return {
    start,
    end,
    path: `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
  };
}

function bridgeRoutePath(source, target, index) {
  return bridgeRouteGeometry(source, target, index).path;
}

function floorSpokeGeometry(source, target) {
  const sourceCenter = routePoint(source);
  const targetCenter = routePoint(target);
  const start = routeAnchorPoint(source, targetCenter);
  const end = routeAnchorPoint(target, sourceCenter);

  return {
    start,
    end,
    path: `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} L ${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
  };
}

function moduleIconMarkup(id) {
  const icons = {
    "clips-office": '<svg viewBox="0 0 24 24"><path d="M4 7h10v10H4z"/><path d="m14 10 6-3v10l-6-3"/><path d="M8 11h2"/><path d="M8 14h4"/></svg>',
    "stock-office": '<svg viewBox="0 0 24 24"><path d="M4 19h16"/><path d="M6 16l4-5 3 3 5-8"/><path d="M17 6h2v2"/></svg>',
    "etsy-office": '<svg viewBox="0 0 24 24"><path d="M6 4h12l1 5H5l1-5Z"/><path d="M6 9v11h12V9"/><path d="M9 13h6"/><path d="M9 16h4"/></svg>',
    "essentrx-office": '<svg viewBox="0 0 24 24"><path d="M10 3h4v4l3 4a6 6 0 1 1-10 0l3-4V3Z"/><path d="M9 14h6"/><path d="M10 18h4"/></svg>',
    "task-intake": '<svg viewBox="0 0 24 24"><path d="M9 3h6l1 3H8l1-3Z"/><path d="M6 6h12v15H6z"/><path d="M9 11h6"/><path d="M9 15h4"/></svg>',
    "research-lab": '<svg viewBox="0 0 24 24"><path d="M10 3v5l-5 9a3 3 0 0 0 2.6 4.5h8.8A3 3 0 0 0 19 17l-5-9V3"/><path d="M8 3h8"/><path d="M8 15h8"/></svg>',
    "verify-station": '<svg viewBox="0 0 24 24"><path d="M12 3 20 7v5c0 4.8-3.1 7.6-8 9-4.9-1.4-8-4.2-8-9V7l8-4Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></svg>',
    "memory-vault": '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/></svg>',
    "draft-studio": '<svg viewBox="0 0 24 24"><path d="M4 20h16"/><path d="M14.5 4.5a2.1 2.1 0 0 1 3 3L8 17l-4 1 1-4 9.5-9.5Z"/></svg>',
    "system-log": '<svg viewBox="0 0 24 24"><path d="M5 4h14v16H5z"/><path d="M8 8h8"/><path d="M8 12h8"/><path d="M8 16h5"/></svg>',
    "output-bench": '<svg viewBox="0 0 24 24"><path d="M12 3v11"/><path d="m7 10 5 5 5-5"/><path d="M5 19h14"/></svg>',
    "human-gate": '<svg viewBox="0 0 24 24"><rect x="6" y="10" width="12" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v2"/></svg>',
    "depo-habitat": '<svg viewBox="0 0 24 24"><path d="M12 3a7 7 0 0 0-7 7c0 5.5 7 11 7 11s7-5.5 7-11a7 7 0 0 0-7-7Z"/><path d="M9 10h6"/><path d="M9 14h4"/></svg>',
    "agent-habitat": '<svg viewBox="0 0 24 24"><path d="M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/><path d="M16 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/><path d="M3 21a5 5 0 0 1 10 0"/><path d="M11 21a5 5 0 0 1 10 0"/></svg>',
    "ai-agents": '<svg viewBox="0 0 24 24"><path d="M5 19V5l7 14 7-14v14"/><path d="M8 15h8"/></svg>',
    "security-core": '<svg viewBox="0 0 24 24"><path d="M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z"/><path d="m9 12 2 2 4-5"/></svg>',
    "system-logs": '<svg viewBox="0 0 24 24"><path d="M8 6h12"/><path d="M8 12h12"/><path d="M8 18h12"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/></svg>',
    "task-factory": '<svg viewBox="0 0 24 24"><path d="m14.7 6.3 3 3"/><path d="M5 19 16.6 7.4a2.1 2.1 0 0 1 3 3L8 22H5v-3Z"/><path d="M3 7h6"/><path d="M6 4v6"/></svg>',
    "commerce-terminal": '<svg viewBox="0 0 24 24"><path d="M4 5h2l2.2 10.5a2 2 0 0 0 2 1.5h6.6a2 2 0 0 0 2-1.5L20 9H7"/><circle cx="10" cy="21" r="1"/><circle cx="18" cy="21" r="1"/></svg>',
    "revenue-monitor": '<svg viewBox="0 0 24 24"><path d="M5 20V10"/><path d="M12 20V4"/><path d="M19 20v-7"/><path d="M3 20h18"/></svg>',
    "customer-node": '<svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    resources: '<svg viewBox="0 0 24 24"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5"/><path d="M12 12v9"/></svg>',
    "logistics-node": '<svg viewBox="0 0 24 24"><path d="M3 6h12v10H3z"/><path d="M15 10h4l2 3v3h-6"/><circle cx="7" cy="19" r="2"/><circle cx="18" cy="19" r="2"/></svg>',
    "workflow-pipeline": '<svg viewBox="0 0 24 24"><path d="M10 7h4a5 5 0 0 1 0 10h-4"/><path d="M14 7h-4a5 5 0 0 0 0 10h4"/><path d="M8 12h8"/></svg>',
    "content-engine": '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/></svg>',
  };
  return icons[id] || '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/></svg>';
}

// SpaceBackground and DepoCapsule canvas renderer
const stationWorld = { width: 1000, height: 620 };
const stationStarfield = Array.from({ length: 340 }, (_, index) => {
  const unit = (seed) => {
    const value = Math.sin(seed * 12.9898) * 43758.5453;
    return value - Math.floor(value);
  };
  return {
    x: unit(index + 1) * stationWorld.width,
    y: unit(index + 27) * stationWorld.height,
    radius: 0.35 + unit(index + 61) * 1.45,
    alpha: 0.18 + unit(index + 103) * 0.68,
    tint: unit(index + 151),
    drift: unit(index + 197) * Math.PI * 2,
  };
});
let stationRenderFrame = null;
let stationRenderLastPaint = 0;

function stationRgb(value) {
  const fallback = { r: 34, g: 211, b: 238 };
  const normalized = String(value || "").trim();
  if (!normalized.startsWith("#")) return fallback;
  const hex = normalized.slice(1);
  const full = hex.length === 3 ? hex.split("").map((char) => `${char}${char}`).join("") : hex;
  const parsed = Number.parseInt(full, 16);
  if (!Number.isFinite(parsed)) return fallback;
  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255,
  };
}

function stationColor(value, alpha = 1) {
  const rgb = typeof value === "string" ? stationRgb(value) : value;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function mixStationColor(base, target, amount) {
  const baseRgb = typeof base === "string" ? stationRgb(base) : base;
  const targetRgb = typeof target === "string" ? stationRgb(target) : target;
  return {
    r: Math.round(baseRgb.r + (targetRgb.r - baseRgb.r) * amount),
    g: Math.round(baseRgb.g + (targetRgb.g - baseRgb.g) * amount),
    b: Math.round(baseRgb.b + (targetRgb.b - baseRgb.b) * amount),
  };
}

function stationCanvasPoint(room) {
  return {
    x: room.position.x * 10,
    y: room.position.y * 6.2,
  };
}

function stationCurve(source, target, index, bendScale = 0.08) {
  const start = stationCanvasPoint(source);
  const end = stationCanvasPoint(target);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy) || 1;
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const bendDirection = index % 2 === 0 ? 1 : -1;
  const bend = bendDirection * clamp(distance * bendScale, 16, 52);
  return {
    start,
    c1: {
      x: start.x + dx * 0.34 + normalX * bend,
      y: start.y + dy * 0.34 + normalY * bend,
    },
    c2: {
      x: start.x + dx * 0.66 + normalX * bend,
      y: start.y + dy * 0.66 + normalY * bend,
    },
    end,
  };
}

function drawStationCurve(ctx, curve) {
  ctx.beginPath();
  ctx.moveTo(curve.start.x, curve.start.y);
  ctx.bezierCurveTo(curve.c1.x, curve.c1.y, curve.c2.x, curve.c2.y, curve.end.x, curve.end.y);
}

function sampleStationCurve(curve, t) {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * curve.start.x + 3 * mt2 * t * curve.c1.x + 3 * mt * t2 * curve.c2.x + t2 * t * curve.end.x,
    y: mt2 * mt * curve.start.y + 3 * mt2 * t * curve.c1.y + 3 * mt * t2 * curve.c2.y + t2 * t * curve.end.y,
  };
}

function sampleStationTangent(curve, t) {
  const mt = 1 - t;
  const x =
    3 * mt * mt * (curve.c1.x - curve.start.x) +
    6 * mt * t * (curve.c2.x - curve.c1.x) +
    3 * t * t * (curve.end.x - curve.c2.x);
  const y =
    3 * mt * mt * (curve.c1.y - curve.start.y) +
    6 * mt * t * (curve.c2.y - curve.c1.y) +
    3 * t * t * (curve.end.y - curve.c2.y);
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

function drawRoundedBox(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function drawEllipseFill(ctx, x, y, radiusX, radiusY, fillStyle) {
  ctx.beginPath();
  ctx.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function drawSpaceBackdrop(ctx, time) {
  const background = ctx.createLinearGradient(0, 0, stationWorld.width, stationWorld.height);
  background.addColorStop(0, "#01030a");
  background.addColorStop(0.34, "#031026");
  background.addColorStop(0.66, "#020515");
  background.addColorStop(1, "#000106");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, stationWorld.width, stationWorld.height);

  const glows = [
    [560, 340, 34, 440, "rgba(34, 211, 238, 0.2)", "rgba(88, 28, 135, 0.15)"],
    [790, 145, 28, 360, "rgba(96, 165, 250, 0.18)", "rgba(2, 6, 23, 0)"],
    [360, 505, 30, 390, "rgba(139, 92, 246, 0.13)", "rgba(14, 165, 233, 0.05)"],
  ];
  glows.forEach(([x, y, inner, outer, start, middle]) => {
    const nebula = ctx.createRadialGradient(x, y, inner, x, y, outer);
    nebula.addColorStop(0, start);
    nebula.addColorStop(0.44, middle);
    nebula.addColorStop(1, "rgba(0, 1, 8, 0)");
    ctx.fillStyle = nebula;
    ctx.fillRect(0, 0, stationWorld.width, stationWorld.height);
  });

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const dust = ctx.createLinearGradient(80, 70, 930, 560);
  dust.addColorStop(0, "rgba(125, 211, 252, 0)");
  dust.addColorStop(0.42, "rgba(125, 211, 252, 0.045)");
  dust.addColorStop(0.62, "rgba(167, 139, 250, 0.04)");
  dust.addColorStop(1, "rgba(125, 211, 252, 0)");
  ctx.fillStyle = dust;
  ctx.fillRect(0, 0, stationWorld.width, stationWorld.height);
  ctx.restore();

  stationStarfield.forEach((star) => {
    const twinkle = 0.72 + Math.sin(time * 0.0014 + star.drift) * 0.28;
    const tint = star.tint > 0.74 ? "167, 139, 250" : star.tint > 0.42 ? "125, 211, 252" : "226, 232, 240";
    const glowAlpha = star.radius > 1.25 ? star.alpha * twinkle * 0.1 : 0;
    if (glowAlpha) {
      ctx.fillStyle = `rgba(${tint}, ${glowAlpha})`;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.radius * 4.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = `rgba(${tint}, ${star.alpha * twinkle * 0.78})`;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.radius * 0.78, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawPlanetHorizon(ctx) {
  ctx.save();
  ctx.translate(705, -88);
  ctx.rotate(0.13);
  ctx.scale(1.12, 0.32);
  const planet = ctx.createRadialGradient(150, -70, 16, 0, 0, 600);
  planet.addColorStop(0, "rgba(248, 250, 252, 0.42)");
  planet.addColorStop(0.18, "rgba(147, 197, 253, 0.36)");
  planet.addColorStop(0.46, "rgba(37, 99, 235, 0.2)");
  planet.addColorStop(0.76, "rgba(15, 23, 42, 0.11)");
  planet.addColorStop(1, "rgba(2, 6, 23, 0)");
  ctx.beginPath();
  ctx.arc(0, 0, 600, 0, Math.PI * 2);
  ctx.fillStyle = planet;
  ctx.fill();
  ctx.clip();
  for (let index = 0; index < 38; index += 1) {
    const y = -210 + index * 12;
    const alpha = index % 4 === 0 ? 0.1 : 0.045;
    ctx.strokeStyle = `rgba(125, 211, 252, ${alpha})`;
    ctx.lineWidth = index % 5 === 0 ? 1.6 : 0.8;
    ctx.beginPath();
    ctx.moveTo(-540, y);
    ctx.bezierCurveTo(-210, y - 28, 180, y + 16, 590, y - 12);
    ctx.stroke();
  }
  for (let index = 0; index < 44; index += 1) {
    const x = -430 + ((index * 97) % 900);
    const y = -174 + ((index * 53) % 266);
    ctx.fillStyle = index % 7 === 0 ? "rgba(251, 146, 60, 0.14)" : "rgba(96, 165, 250, 0.1)";
    ctx.fillRect(x, y, 1 + (index % 2), 1);
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(219, 234, 254, 0.62)";
  ctx.lineWidth = 2.4;
  ctx.shadowBlur = 42;
  ctx.shadowColor = "rgba(96, 165, 250, 0.78)";
  ctx.beginPath();
  ctx.ellipse(705, -70, 666, 204, 0.13, 0.35, Math.PI * 0.95);
  ctx.stroke();
  ctx.strokeStyle = "rgba(34, 211, 238, 0.2)";
  ctx.lineWidth = 10;
  ctx.shadowBlur = 48;
  ctx.beginPath();
  ctx.ellipse(705, -67, 666, 204, 0.13, 0.35, Math.PI * 0.95);
  ctx.stroke();
  ctx.restore();
}

function drawOrbitalGuides(ctx, time) {
  const guides = [
    [500, 350, 460, 258, -0.08, "rgba(125, 211, 252, 0.13)", 1],
    [500, 350, 365, 188, -0.08, "rgba(167, 139, 250, 0.12)", 1],
    [500, 352, 246, 108, -0.08, "rgba(34, 211, 238, 0.13)", 1],
    [522, 328, 568, 312, -0.28, "rgba(96, 165, 250, 0.075)", 1],
  ];
  guides.forEach(([x, y, rx, ry, rotation, color, lineWidth], index) => {
    ctx.save();
    ctx.shadowBlur = index === 2 ? 16 : 8;
    ctx.shadowColor = index === 1 ? "rgba(139, 92, 246, 0.24)" : "rgba(34, 211, 238, 0.2)";
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(index === 2 ? [8, 13] : []);
    ctx.lineDashOffset = -time * (0.012 + index * 0.003);
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });
}

function drawTubeCollars(ctx, curve, color, alpha) {
  [0.13, 0.24, 0.36, 0.52, 0.68, 0.82].forEach((t, index) => {
    const point = sampleStationCurve(curve, t);
    const tangent = sampleStationTangent(curve, t);
    const normal = { x: -tangent.y, y: tangent.x };
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = `rgba(3, 7, 18, ${0.78 * alpha})`;
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(point.x - normal.x * 10, point.y - normal.y * 10);
    ctx.lineTo(point.x + normal.x * 10, point.y + normal.y * 10);
    ctx.stroke();
    ctx.strokeStyle = stationColor(color, (index % 2 === 0 ? 0.5 : 0.28) * alpha);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(point.x - normal.x * 8, point.y - normal.y * 8);
    ctx.lineTo(point.x + normal.x * 8, point.y + normal.y * 8);
    ctx.stroke();
    ctx.restore();
  });
}

function drawEnergyDots(ctx, curve, color, time, alpha, seed) {
  const progress = ((time * 0.00018 + seed * 0.13) % 1 + 1) % 1;
  for (let index = 0; index < 4; index += 1) {
    const t = (progress + index * 0.23) % 1;
    const point = sampleStationCurve(curve, t);
    const radius = index === 0 ? 3.2 : 2.1;
    const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, 18);
    glow.addColorStop(0, "rgba(248, 250, 252, 0.95)");
    glow.addColorStop(0.34, stationColor(color, 0.86 * alpha));
    glow.addColorStop(1, stationColor(color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius * 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(248, 250, 252, 0.9)";
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDataStreamPulse(ctx, curve, color, altColor, time, alpha, seed, width) {
  const progress = ((time * 0.00028 + seed * 0.19) % 1 + 1) % 1;
  ctx.save();
  ctx.lineCap = "round";
  ctx.globalCompositeOperation = "screen";
  for (let index = 0; index < 3; index += 1) {
    const t = (progress + index * 0.31) % 1;
    const point = sampleStationCurve(curve, t);
    const tangent = sampleStationTangent(curve, t);
    const length = width * (2.4 - index * 0.24);
    const start = { x: point.x - tangent.x * length, y: point.y - tangent.y * length };
    const end = { x: point.x + tangent.x * length, y: point.y + tangent.y * length };
    const pulse = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
    pulse.addColorStop(0, "rgba(255, 255, 255, 0)");
    pulse.addColorStop(0.28, stationColor(altColor, 0.28 * alpha));
    pulse.addColorStop(0.5, `rgba(255, 255, 255, ${0.92 * alpha})`);
    pulse.addColorStop(0.72, stationColor(color, 0.48 * alpha));
    pulse.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.shadowBlur = 18;
    ctx.shadowColor = stationColor(index % 2 === 0 ? color : altColor, 0.8 * alpha);
    ctx.strokeStyle = pulse;
    ctx.lineWidth = Math.max(2.2, width * (0.22 - index * 0.035));
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStationTube(ctx, curve, options) {
  const color = stationRgb(options.color || "#22D3EE");
  const altColor = stationRgb(options.altColor || "#8B5CF6");
  const alpha = options.alpha ?? 1;
  const width = options.width || 19;
  const gradient = ctx.createLinearGradient(curve.start.x, curve.start.y, curve.end.x, curve.end.y);
  gradient.addColorStop(0, stationColor(altColor, 0.1 * alpha));
  gradient.addColorStop(0.24, stationColor(altColor, 0.72 * alpha));
  gradient.addColorStop(0.55, stationColor(color, 0.86 * alpha));
  gradient.addColorStop(0.78, "rgba(255, 255, 255, 0.34)");
  gradient.addColorStop(1, stationColor(color, 0.14 * alpha));

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowBlur = 34;
  ctx.shadowColor = stationColor(color, 0.55 * alpha);
  ctx.strokeStyle = stationColor(color, 0.22 * alpha);
  ctx.lineWidth = width + 30;
  drawStationCurve(ctx, curve);
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = `rgba(1, 5, 17, ${0.92 * alpha})`;
  ctx.lineWidth = width + 2;
  drawStationCurve(ctx, curve);
  ctx.stroke();

  ctx.strokeStyle = gradient;
  ctx.lineWidth = width * 0.56;
  drawStationCurve(ctx, curve);
  ctx.stroke();

  ctx.strokeStyle = `rgba(219, 234, 254, ${0.42 * alpha})`;
  ctx.lineWidth = 1.4;
  drawStationCurve(ctx, curve);
  ctx.stroke();

  ctx.setLineDash([11, 20]);
  ctx.lineDashOffset = -options.time * 0.058 - options.seed * 12;
  ctx.strokeStyle = stationColor(mixStationColor(color, { r: 248, g: 250, b: 252 }, 0.5), 0.9 * alpha);
  ctx.lineWidth = 2.6;
  drawStationCurve(ctx, curve);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  drawTubeCollars(ctx, curve, color, alpha);
  drawDataStreamPulse(ctx, curve, color, altColor, options.time || 0, alpha, options.seed || 0, width);
  drawEnergyDots(ctx, curve, color, options.time || 0, alpha, options.seed || 0);
}

function activeRoomForRenderer() {
  if (selectedAgentKey) return resolveRoomKey(agentProfiles[selectedAgentKey]?.room);
  return resolveRoomKey(selectedRoomKey);
}

function rendererRoomAlpha(roomId) {
  if (!selectedRoomKey && !selectedAgentKey) return 1;
  const selected = activeRoomForRenderer();
  const related = connectedModuleSet(selected);
  if (roomId === selected) return 1;
  return related.has(roomId) ? 0.82 : 0.34;
}

function drawStationPanelLines(ctx, x, y, rx, ry, color, alpha, offset = 0) {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y, rx * 0.98, ry * 0.82, 0, 0, Math.PI * 2);
  ctx.clip();
  for (let index = 0; index < 34; index += 1) {
    const angle = (Math.PI * 2 * index) / 34 + offset;
    const inner = 0.48 + (index % 3) * 0.055;
    const outer = 0.92 + (index % 4) * 0.018;
    ctx.strokeStyle = index % 5 === 0 ? stationColor(color, 0.32 * alpha) : `rgba(226, 232, 240, ${0.13 * alpha})`;
    ctx.lineWidth = index % 5 === 0 ? 1.3 : 0.8;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * rx * inner, y + Math.sin(angle) * ry * inner);
    ctx.lineTo(x + Math.cos(angle) * rx * outer, y + Math.sin(angle) * ry * outer);
    ctx.stroke();
  }
  for (let ring = 0; ring < 4; ring += 1) {
    ctx.strokeStyle = ring % 2 === 0 ? `rgba(148, 163, 184, ${0.16 * alpha})` : stationColor(color, 0.18 * alpha);
    ctx.lineWidth = ring === 0 ? 1.4 : 0.9;
    ctx.beginPath();
    ctx.ellipse(x, y - ring * 1.5, rx * (0.82 - ring * 0.13), ry * (0.66 - ring * 0.1), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPodLights(ctx, x, y, rx, ry, color, alpha, index, time) {
  const pulse = 0.74 + Math.sin(time * 0.002 + index) * 0.26;
  for (let light = 0; light < 30; light += 1) {
    const angle = (Math.PI * 2 * light) / 30 + index * 0.17;
    const warm = light % 4 === 0;
    const lightColor = warm ? { r: 251, g: 146, b: 60 } : color;
    const radius = warm ? 2.1 : 1.65;
    const lx = x + Math.cos(angle) * rx * (0.72 + (light % 2) * 0.1);
    const ly = y + Math.sin(angle) * ry * (0.56 + (light % 3) * 0.05);
    ctx.fillStyle = stationColor(lightColor, (warm ? 0.88 : 0.82) * alpha * pulse);
    ctx.shadowBlur = warm ? 9 : 12;
    ctx.shadowColor = stationColor(lightColor, 0.78 * alpha);
    ctx.beginPath();
    ctx.arc(lx, ly, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

function drawPodPorts(ctx, x, y, rx, ry, color, alpha) {
  const ports = [
    [x + rx - 12, y - 8, 24, 16, 8],
    [x - rx - 12, y - 8, 24, 16, 8],
    [x - 12, y - ry - 8, 24, 11, 6],
    [x - 12, y + ry - 3, 24, 11, 6],
  ];
  ports.forEach(([px, py, width, height, radius]) => {
    ctx.save();
    drawRoundedBox(ctx, px, py, width, height, radius);
    ctx.fillStyle = `rgba(2, 6, 23, ${0.92 * alpha})`;
    ctx.fill();
    ctx.strokeStyle = stationColor(color, 0.5 * alpha);
    ctx.lineWidth = 1.1;
    ctx.shadowBlur = 9;
    ctx.shadowColor = stationColor(color, 0.38 * alpha);
    ctx.stroke();
    ctx.restore();
  });
}

function drawOrbitalParticles(ctx, x, y, radiusX, radiusY, color, time, count, alpha = 1) {
  ctx.save();
  for (let index = 0; index < count; index += 1) {
    const phase = (Math.PI * 2 * index) / count + time * (0.00062 + index * 0.000012);
    const depth = 0.68 + (index % 4) * 0.08;
    const px = x + Math.cos(phase) * radiusX * depth;
    const py = y + Math.sin(phase) * radiusY * depth;
    const size = index % 5 === 0 ? 2.2 : 1.25;
    const particleAlpha = (0.34 + Math.sin(time * 0.0018 + index) * 0.16) * alpha;
    ctx.fillStyle = index % 3 === 0 ? stationColor("#A78BFA", particleAlpha) : stationColor(color, particleAlpha);
    ctx.shadowBlur = 10;
    ctx.shadowColor = index % 3 === 0 ? "rgba(167, 139, 250, 0.58)" : stationColor(color, 0.58 * alpha);
    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCapsuleRings(ctx, x, y, rx, ry, color, alpha, time) {
  ctx.save();
  ctx.lineCap = "round";
  [
    [1.18, 0.88, -0.14, "rgba(125, 211, 252, 0.26)", [18, 26], 0.022],
    [0.98, 0.64, 0.1, "rgba(167, 139, 250, 0.22)", [8, 16], -0.018],
    [0.72, 0.42, -0.02, stationColor(color, 0.3 * alpha), [5, 14], 0.028],
  ].forEach(([scaleX, scaleY, rotation, stroke, dash, speed], index) => {
    ctx.setLineDash(dash);
    ctx.lineDashOffset = time * speed + index * 18;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = index === 0 ? 1.4 : 1;
    ctx.shadowBlur = 14;
    ctx.shadowColor = index === 1 ? "rgba(167, 139, 250, 0.38)" : stationColor(color, 0.32 * alpha);
    ctx.beginPath();
    ctx.ellipse(x, y - 4, rx * scaleX, ry * scaleY, rotation, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.restore();
}

function drawOrbitalPod(ctx, room, index, time) {
  const point = stationCanvasPoint(room);
  const color = stationRgb(room.color);
  const alpha = rendererRoomAlpha(room.id);
  const selected = activeRoomForRenderer() === room.id && (selectedRoomKey || selectedAgentKey);
  const rowBoost = room.position.y > 60 ? 1.08 : room.position.y < 25 ? 0.98 : 1.04;
  const rx = (82 + (index % 3) * 4) * rowBoost * (selected ? 1.04 : 1);
  const ry = rx * 0.47;
  const lift = selected ? -2 : 0;
  const x = point.x;
  const y = point.y + lift;

  ctx.save();
  ctx.globalAlpha = alpha;

  const halo = ctx.createRadialGradient(x, y, 4, x, y, rx * 1.62);
  halo.addColorStop(0, stationColor(color, selected ? 0.34 : 0.2));
  halo.addColorStop(0.54, stationColor(color, selected ? 0.18 : 0.1));
  halo.addColorStop(0.75, "rgba(139, 92, 246, 0.07)");
  halo.addColorStop(1, stationColor(color, 0));
  drawEllipseFill(ctx, x, y + 6, rx * 1.62, ry * 1.32, halo);

  drawCapsuleRings(ctx, x, y, rx, ry, color, alpha, time);

  drawEllipseFill(ctx, x, y + ry * 0.9, rx * 1.15, ry * 0.54, "rgba(0, 0, 0, 0.5)");

  for (let layer = 10; layer >= 0; layer -= 1) {
    const depth = layer / 10;
    const layerGradient = ctx.createLinearGradient(x - rx, y - ry + layer * 2, x + rx, y + ry + 24);
    layerGradient.addColorStop(0, `rgba(100, 116, 139, ${0.42 + depth * 0.18})`);
    layerGradient.addColorStop(0.42, `rgba(15, 23, 42, ${0.78 + depth * 0.16})`);
    layerGradient.addColorStop(1, "rgba(1, 4, 12, 0.98)");
    ctx.beginPath();
    ctx.ellipse(x, y + 18 + layer * 1.9, rx - layer * 1.3, ry * 0.72 - layer * 0.26, 0, 0, Math.PI * 2);
    ctx.fillStyle = layerGradient;
    ctx.fill();
  }

  const shell = ctx.createLinearGradient(x - rx, y - ry, x + rx, y + ry + 24);
  shell.addColorStop(0, stationColor(mixStationColor(color, { r: 248, g: 250, b: 252 }, 0.46), 0.5));
  shell.addColorStop(0.18, "rgba(71, 85, 105, 0.94)");
  shell.addColorStop(0.52, "rgba(8, 13, 26, 0.99)");
  shell.addColorStop(1, "rgba(0, 0, 0, 1)");
  ctx.shadowBlur = selected ? 34 : 22;
  ctx.shadowColor = stationColor(color, selected ? 0.55 : 0.32);
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = shell;
  ctx.fill();
  ctx.strokeStyle = stationColor(mixStationColor(color, { r: 248, g: 250, b: 252 }, 0.26), selected ? 0.86 : 0.46);
  ctx.lineWidth = selected ? 2 : 1.25;
  ctx.stroke();
  ctx.shadowBlur = 0;

  drawStationPanelLines(ctx, x, y - 2, rx, ry, color, alpha, index * 0.12);

  const glass = ctx.createLinearGradient(x - rx * 0.52, y - ry * 0.65, x + rx * 0.42, y + ry * 0.08);
  glass.addColorStop(0, "rgba(219, 234, 254, 0.18)");
  glass.addColorStop(0.48, stationColor(color, 0.14 * alpha));
  glass.addColorStop(1, "rgba(2, 6, 23, 0)");
  ctx.beginPath();
  ctx.ellipse(x - rx * 0.03, y - ry * 0.24, rx * 0.58, ry * 0.24, -0.08, 0, Math.PI * 2);
  ctx.fillStyle = glass;
  ctx.fill();

  ctx.save();
  ctx.setLineDash([4, 8]);
  ctx.lineDashOffset = -time * 0.028;
  ctx.strokeStyle = stationColor(color, 0.42 * alpha);
  ctx.lineWidth = 1.3;
  ctx.shadowBlur = 16;
  ctx.shadowColor = stationColor(color, 0.52 * alpha);
  ctx.beginPath();
  ctx.ellipse(x, y - 5, rx * 0.68, ry * 0.42, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  const deck = ctx.createRadialGradient(x, y - 5, 2, x, y - 5, rx * 0.58);
  deck.addColorStop(0, stationColor(color, 0.24));
  deck.addColorStop(0.48, "rgba(15, 23, 42, 0.96)");
  deck.addColorStop(1, "rgba(0, 0, 0, 0.94)");
  ctx.beginPath();
  ctx.ellipse(x, y - 4, rx * 0.55, ry * 0.48, 0, 0, Math.PI * 2);
  ctx.fillStyle = deck;
  ctx.fill();
  ctx.strokeStyle = `rgba(226, 232, 240, ${0.16 * alpha})`;
  ctx.stroke();

  drawPodLights(ctx, x, y, rx, ry, color, alpha, index, time);

  const corePulse = 0.78 + Math.sin(time * 0.0024 + index * 0.6) * 0.22;
  const reactor = ctx.createRadialGradient(x, y - 5, 0, x, y - 5, 28);
  reactor.addColorStop(0, "rgba(248, 250, 252, 0.98)");
  reactor.addColorStop(0.24, stationColor(color, 0.92 * corePulse));
  reactor.addColorStop(0.74, "rgba(34, 211, 238, 0.18)");
  reactor.addColorStop(1, "rgba(34, 211, 238, 0)");
  ctx.fillStyle = reactor;
  ctx.beginPath();
  ctx.arc(x, y - 5, selected ? 27 : 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(248, 250, 252, 0.92)";
  ctx.beginPath();
  ctx.arc(x, y - 5, 4.3, 0, Math.PI * 2);
  ctx.fill();

  drawOrbitalParticles(ctx, x, y - 4, rx * 1.05, ry * 0.84, color, time, 14, 0.7 * alpha);

  drawPodPorts(ctx, x, y, rx, ry, color, alpha);

  ctx.strokeStyle = `rgba(226, 232, 240, ${0.34 * alpha})`;
  ctx.lineWidth = 1;
  ctx.shadowBlur = 8;
  ctx.shadowColor = stationColor(color, 0.4 * alpha);
  ctx.beginPath();
  ctx.moveTo(x - rx * 0.42, y - ry * 0.75);
  ctx.lineTo(x - rx * 0.5, y - ry * 1.2);
  ctx.moveTo(x + rx * 0.4, y - ry * 0.78);
  ctx.lineTo(x + rx * 0.5, y - ry * 1.18);
  ctx.stroke();
  ctx.restore();
}

function drawReactorCore(ctx, time) {
  const core = roomProfiles["depo-habitat"];
  const point = stationCanvasPoint(core);
  const x = point.x;
  const y = point.y;
  const pulse = 0.78 + Math.sin(time * 0.002) * 0.22;
  const color = stationRgb("#60A5FA");
  const violet = stationRgb("#8B5CF6");

  const halo = ctx.createRadialGradient(x, y, 0, x, y, 132);
  halo.addColorStop(0, `rgba(248, 250, 252, ${0.32 * pulse})`);
  halo.addColorStop(0.24, "rgba(34, 211, 238, 0.28)");
  halo.addColorStop(0.58, "rgba(139, 92, 246, 0.16)");
  halo.addColorStop(1, "rgba(34, 211, 238, 0)");
  drawEllipseFill(ctx, x, y + 4, 136, 108, halo);

  drawEllipseFill(ctx, x, y + 58, 104, 38, "rgba(0, 0, 0, 0.44)");

  for (let layer = 9; layer >= 0; layer -= 1) {
    const body = ctx.createLinearGradient(x - 96, y - 44, x + 96, y + 70);
    body.addColorStop(0, "rgba(71, 85, 105, 0.78)");
    body.addColorStop(0.45, "rgba(8, 13, 26, 0.98)");
    body.addColorStop(1, "rgba(0, 0, 0, 1)");
    ctx.beginPath();
    ctx.ellipse(x, y + 29 + layer * 2.1, 92 - layer * 1.55, 50 - layer * 0.72, 0, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();
  }

  ctx.save();
  ctx.shadowBlur = 34;
  ctx.shadowColor = "rgba(34, 211, 238, 0.54)";
  ctx.strokeStyle = "rgba(125, 211, 252, 0.5)";
  ctx.lineWidth = 1.4;
  [84, 66, 48].forEach((rx, index) => {
    ctx.setLineDash(index === 1 ? [8, 9] : [15, 10]);
    ctx.lineDashOffset = -time * (0.015 + index * 0.006);
    ctx.beginPath();
    ctx.ellipse(x, y + index * 2, rx, rx * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.restore();

  drawStationPanelLines(ctx, x, y + 11, 90, 54, color, 1, time * 0.00012);
  drawPodLights(ctx, x, y + 8, 88, 50, color, 0.62, 11, time);
  drawOrbitalParticles(ctx, x, y - 8, 82, 46, color, time, 18, 0.78);

  const orb = ctx.createRadialGradient(x - 9, y - 27, 0, x, y - 8, 52);
  orb.addColorStop(0, "rgba(255, 255, 255, 1)");
  orb.addColorStop(0.18, "rgba(103, 232, 249, 0.98)");
  orb.addColorStop(0.48, stationColor(violet, 0.86));
  orb.addColorStop(0.78, stationColor(color, 0.34));
  orb.addColorStop(1, "rgba(34, 211, 238, 0)");
  ctx.save();
  ctx.shadowBlur = 48;
  ctx.shadowColor = "rgba(34, 211, 238, 0.92)";
  ctx.fillStyle = orb;
  ctx.beginPath();
  ctx.arc(x, y - 12, 38 + pulse * 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.setLineDash([6, 12]);
  ctx.lineDashOffset = -time * 0.04;
  ctx.strokeStyle = "rgba(192, 132, 252, 0.38)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(x, y - 12, 54 + pulse * 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(248, 250, 252, 0.96)";
  ctx.beginPath();
  ctx.arc(x, y - 12, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function resizeStationRenderer(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function drawStationScene(time = performance.now()) {
  if (!stationArtwork || typeof stationArtwork.getContext !== "function") return;
  const ctx = stationArtwork.getContext("2d");
  if (!ctx) return;
  resizeStationRenderer(stationArtwork);
  ctx.setTransform(stationArtwork.width / stationWorld.width, 0, 0, stationArtwork.height / stationWorld.height, 0, 0);
  ctx.clearRect(0, 0, stationWorld.width, stationWorld.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  drawSpaceBackdrop(ctx, time);
  drawPlanetHorizon(ctx);
  drawOrbitalGuides(ctx, time);

  const core = roomProfiles["depo-habitat"];
  habitatMapModules.forEach((room, index) => {
    const curve = stationCurve(core, room, index, 0.035);
    const alpha = rendererRoomAlpha(room.id) * 0.7;
    drawStationTube(ctx, curve, {
      color: room.color,
      altColor: "#8B5CF6",
      alpha,
      width: 11,
      seed: index + 13,
      time,
    });
  });

  moduleRoutes.forEach((route, index) => {
    const { from, to } = routeEndpoints(route);
    const source = moduleProfile(from);
    const target = moduleProfile(to);
    const active = routeIsActive(route);
    const routeAlpha = active ? Math.min(rendererRoomAlpha(from), rendererRoomAlpha(to)) : 0.22;
    drawStationTube(ctx, stationCurve(source, target, index), {
      color: source.color,
      altColor: target.color,
      alpha: routeAlpha,
      width: index % 3 === 0 ? 22 : 19,
      seed: index + 1,
      time,
    });
  });

  habitatMapModules
    .slice()
    .sort((a, b) => a.position.y - b.position.y)
    .forEach((room, index) => drawOrbitalPod(ctx, room, index, time));
  drawReactorCore(ctx, time);

  const vignette = ctx.createRadialGradient(500, 320, 120, 500, 320, 590);
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(0.72, "rgba(0, 0, 0, 0.12)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.58)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, stationWorld.width, stationWorld.height);
}

function stationRenderLoop(time) {
  stationRenderFrame = requestAnimationFrame(stationRenderLoop);
  if (document.hidden) return;
  if (time - stationRenderLastPaint < 32) return;
  stationRenderLastPaint = time;
  drawStationScene(time);
}

function renderStationArtwork() {
  if (stationRenderFrame) {
    cancelAnimationFrame(stationRenderFrame);
    stationRenderFrame = null;
  }
  if (stationArtwork) stationArtwork.hidden = true;
}

// FloorRouteLayer
function renderHabitatRoutes() {
  if (!habitatRoutes) return;
  const defs = `
    <defs>
      <linearGradient id="routeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="rgba(34, 211, 238, 0.2)" />
        <stop offset="46%" stop-color="rgba(96, 165, 250, 0.96)" />
        <stop offset="74%" stop-color="rgba(167, 139, 250, 0.78)" />
        <stop offset="100%" stop-color="rgba(34, 211, 238, 0.22)" />
      </linearGradient>
      <linearGradient id="approvalRouteGradient" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="rgba(248, 113, 113, 0.15)" />
        <stop offset="48%" stop-color="rgba(248, 113, 113, 0.98)" />
        <stop offset="100%" stop-color="rgba(244, 63, 94, 0.84)" />
      </linearGradient>
    </defs>
  `;

  const moduleBridgeRoutes = moduleRoutes
    .map((route, index) => {
      const { from, to, kind } = routeEndpoints(route);
      const source = moduleProfile(from);
      const target = moduleProfile(to);
      const active = routeIsActive(route);
      const approval = kind === "approval" || from === "human-gate" || to === "human-gate";
      const geometry = floorSpokeGeometry(source, target);
      const { path, start, end } = geometry;
      return `
        <path class="route-glow ${approval ? "approval" : ""} ${active ? "active" : ""}" d="${path}"></path>
        <path class="route-tube ${approval ? "approval" : ""} ${active ? "active" : ""}" d="${path}"></path>
        <path class="route-bridge ${approval ? "approval" : ""} ${active ? "active" : ""}" d="${path}"></path>
        <path class="route-line ${approval ? "approval" : ""} ${active ? "active" : ""}" data-from="${escapeHtml(from)}" data-to="${escapeHtml(to)}" d="${path}" style="--delay: ${(index * 0.18).toFixed(2)}s"></path>
        <circle class="route-node ${approval ? "approval" : ""} ${active ? "active" : ""}" cx="${start.x.toFixed(1)}" cy="${start.y.toFixed(1)}" r="${approval ? "7.6" : "7"}"></circle>
        <circle class="route-node ${approval ? "approval" : ""} ${active ? "active" : ""}" cx="${end.x.toFixed(1)}" cy="${end.y.toFixed(1)}" r="${approval ? "7.6" : "7"}"></circle>
        <circle class="route-particle ${approval ? "approval" : ""} ${active ? "active" : ""}" r="${approval ? "5.2" : "4.6"}">
          <animateMotion dur="${(3.4 + (index % 5) * 0.28).toFixed(2)}s" begin="${(index * 0.16).toFixed(2)}s" repeatCount="indefinite" path="${path}" />
        </circle>
      `;
    })
    .join("");
  habitatRoutes.innerHTML = `${defs}${moduleBridgeRoutes}`;
}

function floorPropsMarkup(room) {
  const plantCount = room.id === "memory-vault" || room.id === "draft-studio" || room.id === "output-bench" ? 2 : room.id === "task-intake" || room.id === "human-gate" ? 1 : 0;
  const consoleCount = room.id === "research-lab" ? 4 : room.id === "verify-station" || room.id === "system-log" ? 3 : 2;
  const boxes = room.id === "output-bench" ? 3 : room.id === "memory-vault" ? 5 : 1;
  const plants = Array.from({ length: plantCount }, (_, index) => `<span class="floor-plant plant-${index + 1}" aria-hidden="true"><i></i><i></i><i></i></span>`).join("");
  const consoles = Array.from({ length: consoleCount }, (_, index) => `<span class="floor-screen screen-${index + 1}" aria-hidden="true"></span>`).join("");
  const storage = Array.from({ length: boxes }, (_, index) => `<span class="floor-storage storage-${index + 1}" aria-hidden="true"></span>`).join("");
  const paperCount = room.id === "draft-studio" ? 4 : room.id === "task-intake" || room.id === "output-bench" ? 3 : 1;
  const papers = Array.from({ length: paperCount }, (_, index) => `<span class="floor-paper paper-${index + 1}" aria-hidden="true"></span>`).join("");
  return `
    <span class="back-console" aria-hidden="true"></span>
    <span class="floor-desk" aria-hidden="true"></span>
    <span class="floor-pad" aria-hidden="true"></span>
    ${consoles}
    ${storage}
    ${papers}
    ${plants}
    <span class="floor-cable cable-1" aria-hidden="true"></span>
    <span class="floor-cable cable-2" aria-hidden="true"></span>
    <span class="floor-panel panel-1" aria-hidden="true"></span>
    <span class="floor-panel panel-2" aria-hidden="true"></span>
    <span class="floor-lamp" aria-hidden="true"></span>
    ${room.id === "human-gate" ? '<span class="gate-door" aria-hidden="true"><i></i></span>' : ""}
    ${room.id === "research-lab" ? '<span class="holo-panel" aria-hidden="true"></span>' : ""}
  `;
}

function miniAgentRobotMarkup(room) {
  if (room.id !== "depo-habitat") return "";
  const posture = room.id === "draft-studio" ? "typing" : room.id === "memory-vault" ? "archiving" : "working";
  return `
    <span class="mini-agent-robot ${posture} robot-${escapeHtml(room.visual)}" aria-hidden="true">
      <span class="robot-head"><i></i><i></i></span>
      <span class="robot-body"></span>
      <span class="robot-shadow"></span>
    </span>
  `;
}

function floorCorridorMarkup() {
  const wideMapAspect = 0.36;

  return moduleRoutes
    .map((route, index) => {
      const { from, to, kind } = routeEndpoints(route);
      const source = moduleProfile(from);
      const target = moduleProfile(to);
      if (!source?.position || !target?.position) return "";
      const dx = target.position.x - source.position.x;
      const dy = target.position.y - source.position.y;
      const distance = Math.hypot(dx, dy) || 1;
      const unitX = dx / distance;
      const unitY = dy / distance;
      const sourceIsCore = source.id === "depo-habitat";
      const targetIsCore = target.id === "depo-habitat";
      const startOffset = sourceIsCore ? 11.8 : 15.6;
      const endOffset = targetIsCore ? 11.8 : 15.6;
      const startX = source.position.x + unitX * startOffset;
      const startY = source.position.y + unitY * startOffset;
      const endX = target.position.x - unitX * endOffset;
      const endY = target.position.y - unitY * endOffset;
      const corridorDx = endX - startX;
      const corridorDy = endY - startY;
      const corridorLength = Math.hypot(corridorDx, corridorDy * wideMapAspect);
      const angle = Math.atan2(corridorDy * wideMapAspect, corridorDx) * (180 / Math.PI);
      const approval = kind === "approval" || from === "human-gate" || to === "human-gate";

      return `
        <span class="floor-corridor ${approval ? "approval" : ""} ${sourceIsCore || targetIsCore ? "hub-route" : "office-route"}" style="--cx: ${startX.toFixed(2)}%; --cy: ${startY.toFixed(2)}%; --corridor-length: ${corridorLength.toFixed(2)}%; --corridor-angle: ${angle.toFixed(2)}deg; --corridor-delay: ${(index * 0.2).toFixed(2)}s" aria-hidden="true">
          <span class="corridor-rail"></span>
          <span class="corridor-chevron chevron-a"></span>
          <span class="corridor-chevron chevron-b"></span>
          <span class="corridor-chevron chevron-c"></span>
          <span class="corridor-spark spark-a"></span>
          <span class="corridor-spark spark-b"></span>
          <i></i>
        </span>
      `;
    })
    .join("");
}

// HabitatRoom layer
function renderHabitatModules() {
  if (!habitatModules) return;
  const related = selectedRoomKey || selectedAgentKey ? connectedModuleSet(selectedAgentKey ? agentProfiles[selectedAgentKey]?.room : selectedRoomKey) : new Set();
  const corridorLayer = `<div class="floor-corridors" aria-hidden="true">${floorCorridorMarkup()}</div>`;
  const roomLayer = habitatMapModules
    .map((room) => {
      const isSelected = selectedRoomKey && resolveRoomKey(selectedRoomKey) === room.id;
      const isCurrentStage = depoAgent.currentStage === room.id;
      const isRelated = related.has(room.id);
      const className = ["station", "habitat-room", `room-${room.type}`, room.title.length > 15 ? "long-title" : "", isSelected ? "selected" : "", isCurrentStage ? "current-stage" : "", isRelated ? "related" : ""]
        .filter(Boolean)
        .join(" ");
      return `
        <button class="${className}" data-station="${escapeHtml(room.id)}" type="button" style="--x: ${room.position.x}%; --y: ${room.position.y}%; --room-w: ${room.size.w}%; --room-h: ${room.size.h}%; --module-color: ${escapeHtml(room.color)}" aria-label="${escapeHtml(room.title)}" title="${escapeHtml(room.title)}">
          <span class="station-label">
            <span class="module-icon" aria-hidden="true">${moduleIconMarkup(room.id)}</span>
            <span class="module-copy">
              <strong>${escapeHtml(room.title)}</strong>
              <small>${escapeHtml(room.subtitle)}</small>
              <em>${escapeHtml(room.metric)}</em>
            </span>
            <span class="station-status-dot" aria-hidden="true"></span>
          </span>
          <span class="room-shell" aria-hidden="true">
            <span class="room-floor"></span>
            <span class="room-wall room-wall-top"></span>
            <span class="room-wall room-wall-right"></span>
            <span class="room-wall room-wall-bottom"></span>
            <span class="room-wall room-wall-left"></span>
            <span class="floor-props floor-props-${escapeHtml(room.visual)}">${floorPropsMarkup(room)}</span>
            ${miniAgentRobotMarkup(room)}
          </span>
        </button>
      `;
    })
    .join("");
  habitatModules.innerHTML = `${corridorLayer}${roomLayer}`;
}

// OrbitMiniMap
function renderMiniMap() {
  if (!miniMapNodes) return;
  const hasSelection = Boolean(selectedRoomKey || selectedAgentKey);
  const selected = selectedAgentKey ? resolveRoomKey(agentProfiles[selectedAgentKey]?.room) : resolveRoomKey(selectedRoomKey);
  const related = hasSelection ? connectedModuleSet(selected) : new Set();
  const selectedCore = selected === "depo-habitat";
  const miniPoint = (room) => ({ x: room.position.x, y: room.position.y });
  const curvePath = (source, target, index, bendScale = 0.09) => {
    const start = miniPoint(source);
    const end = miniPoint(target);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.hypot(dx, dy) || 1;
    const normalX = -dy / distance;
    const normalY = dx / distance;
    const bend = (index % 2 === 0 ? 1 : -1) * clamp(distance * bendScale, 2.5, 7);
    const c1x = start.x + dx * 0.34 + normalX * bend;
    const c1y = start.y + dy * 0.34 + normalY * bend;
    const c2x = start.x + dx * 0.66 + normalX * bend;
    const c2y = start.y + dy * 0.66 + normalY * bend;
    return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
  };
  const core = roomProfiles["depo-habitat"];
  const coreSpokes = habitatMapModules
    .map((room, index) => {
      const active = !hasSelection || selectedCore || selected === room.id || related.has(room.id);
      return `<path class="mini-core-spoke ${active ? "active" : "dim"}" d="${curvePath(core, room, index, 0.04)}"></path>`;
    })
    .join("");
  const routeLines = moduleRoutes
    .map((route, index) => {
      const { from, to, kind } = routeEndpoints(route);
      const source = moduleProfile(from);
      const target = moduleProfile(to);
      const active = routeIsActive(route);
      const approval = kind === "approval" || from === "human-gate" || to === "human-gate";
      return `<path class="mini-route ${approval ? "approval" : ""} ${active ? "active" : "dim"}" d="${curvePath(source, target, index)}"></path>`;
    })
    .join("");
  const dots = habitatMapModules
    .map((room) => {
      const isSelected = hasSelection && selected === room.id;
      const isRelated = hasSelection && related.has(room.id);
      return `<g class="mini-node ${isSelected ? "selected" : ""} ${isRelated ? "related" : ""}" style="--module-color: ${escapeHtml(room.color)}">
        <circle class="mini-node-halo" cx="${room.position.x}" cy="${room.position.y}" r="4.4"></circle>
        <circle class="mini-node-dot" cx="${room.position.x}" cy="${room.position.y}" r="2"></circle>
      </g>`;
    })
    .join("");
  const platforms = habitatMapModules
    .map((room) => {
      const isSelected = hasSelection && selected === room.id;
      const isRelated = hasSelection && related.has(room.id);
      return `<g class="mini-platform ${isSelected ? "selected" : ""} ${isRelated ? "related" : ""}" style="--module-color: ${escapeHtml(room.color)}" transform="translate(${room.position.x} ${room.position.y})">
        <ellipse class="mini-platform-glow" cx="0" cy="1.6" rx="8.2" ry="4.6"></ellipse>
        <ellipse class="mini-platform-shell" cx="0" cy="0" rx="6.3" ry="3.2"></ellipse>
        <ellipse class="mini-platform-ring" cx="0" cy="-0.2" rx="4.4" ry="2"></ellipse>
        <circle class="mini-platform-core" cx="0" cy="-0.2" r="1.25"></circle>
      </g>`;
    })
    .join("");
  miniMapNodes.innerHTML = `
    <svg class="mini-map-radar" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <radialGradient id="miniCoreGlow" cx="50%" cy="43%" r="42%">
          <stop offset="0%" stop-color="rgba(248, 250, 252, 0.95)" />
          <stop offset="32%" stop-color="rgba(34, 211, 238, 0.74)" />
          <stop offset="78%" stop-color="rgba(139, 92, 246, 0.18)" />
          <stop offset="100%" stop-color="rgba(34, 211, 238, 0)" />
        </radialGradient>
        <linearGradient id="miniRouteGradient" x1="8%" y1="18%" x2="92%" y2="82%">
          <stop offset="0%" stop-color="rgba(34, 211, 238, 0.1)" />
          <stop offset="46%" stop-color="rgba(125, 211, 252, 0.85)" />
          <stop offset="100%" stop-color="rgba(167, 139, 250, 0.74)" />
        </linearGradient>
      </defs>
      <g class="mini-starfield">
        <circle cx="13" cy="16" r="0.45"></circle>
        <circle cx="28" cy="11" r="0.35"></circle>
        <circle cx="74" cy="15" r="0.5"></circle>
        <circle cx="90" cy="34" r="0.4"></circle>
        <circle cx="8" cy="76" r="0.4"></circle>
        <circle cx="41" cy="88" r="0.34"></circle>
        <circle cx="83" cy="84" r="0.42"></circle>
      </g>
      <ellipse class="mini-orbit orbit-a" cx="50" cy="47" rx="37" ry="20"></ellipse>
      <ellipse class="mini-orbit orbit-b" cx="50" cy="47" rx="47" ry="28"></ellipse>
      <ellipse class="mini-orbit orbit-c" cx="50" cy="47" rx="24" ry="12"></ellipse>
      <ellipse class="mini-orbit orbit-d" cx="50" cy="47" rx="18" ry="8"></ellipse>
      <line class="mini-crosshair" x1="50" y1="7" x2="50" y2="93"></line>
      <line class="mini-crosshair" x1="6" y1="47" x2="94" y2="47"></line>
      <g class="mini-core-spokes">${coreSpokes}</g>
      <g class="mini-routes">${routeLines}</g>
      <circle class="mini-core-glow" cx="${core.position.x}" cy="${core.position.y}" r="10"></circle>
      <circle class="mini-core-node ${selectedCore ? "selected" : ""}" cx="${core.position.x}" cy="${core.position.y}" r="3.4"></circle>
      <g class="mini-platforms">${platforms}</g>
      <g class="mini-nodes">${dots}</g>
    </svg>
  `;
}

function moduleDisplayName(moduleId) {
  if (moduleId === "argentum-core") return "Argentum Core";
  return moduleProfile(moduleId)?.title || moduleId;
}

function moduleCardData(roomKey) {
  const room = moduleProfile(roomKey);
  const detail = habitatModuleCards[room.id] || {};
  return {
    ...room,
    ...detail,
    status: detail.status || room.status,
    metric: detail.metric || room.metric,
    quickActions: detail.quickActions || ["Open workspace", "View logs", "Run check"],
    allowedActions: detail.allowedActions || room.allowedActions || defaultRoomAllowedActions,
    blockedActions: detail.blockedActions || room.blockedActions || defaultRoomBlockedActions,
    canDepoDo: detail.canDepoDo || depoWorkflowState.canDepoDo,
    cannotDepoDo: detail.cannotDepoDo || depoWorkflowState.cannotDepoDo,
  };
}

function cardListMarkup(items, className = "", limit = 3) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const visible = list.slice(0, limit);
  const more = list.length - visible.length;
  const moreChip = more > 0 ? `<span>+${more}</span>` : "";
  return `<div class="${className}">${visible.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}${moreChip}</div>`;
}

function depoKnowledgeSnapshot() {
  const tasks = stateList("tasks");
  const localDepoTasks = depoTasks();
  const localWorkflowDrafts = workflowDrafts();
  const localBlueprints = agentBlueprints();
  const artifacts = stateList("artifacts");
  const approvals = stateList("approvals");
  const pending = approvals.filter((approval) => approval.status === "pending");
  const memoryCount = memoryEntries().length;
  const evidenceCount = taskEvidenceCount(tasks) + artifactEvidenceCount(artifacts);
  return {
    tasks,
    localDepoTasks,
    workflowDrafts: localWorkflowDrafts,
    agentBlueprints: localBlueprints,
    queuedTasks: [
      ...tasks.filter((task) => task.status === "queued"),
      ...localDepoTasks.filter((task) => task.status !== "done"),
    ],
    artifacts,
    approvals,
    pending,
    memoryCount,
    evidenceCount,
  };
}

function depoStarterMessages() {
  return [
    {
      speaker: "starter",
      prompt: "What can you do?",
      text: "I can help you turn ideas into safe, structured work: research, organize evidence, draft outputs, create task plans, draft workflows, save internal notes, prepare reports, and package risky work for Human Gate review.",
    },
    {
      speaker: "starter",
      prompt: "What is blocked?",
      text: "I cannot publish, spend money, move money, contact customers, modify accounts, grant permissions, change API keys, deploy campaigns, create live agents, or run risky external actions without approval.",
    },
    {
      speaker: "starter",
      prompt: "How can you grow?",
      text: "I can grow by drafting future-agent blueprints and workflow plans. Those stay as proposals until the Human Gate approves activation, permissions, and risk boundaries.",
    },
  ];
}

function depoChatResponse(question, roomKey) {
  const card = moduleCardData(roomKey);
  const snapshot = depoKnowledgeSnapshot();
  const text = String(question || "").trim().toLowerCase();
  if (!text) return "Ask me about what I know, what I can do, what is blocked, or what should happen next.";

  if (text.includes("what can you do") || text.includes("can you do") || text.includes("allowed")) {
    return "I can help you turn ideas into safe, structured work. My local powers are research, evidence organization, drafting, task planning, workflow drafting, internal notes, reports, prompts, and approval packages. I stay draft-only until Human Gate clears a risky action.";
  }

  if (text.includes("can't") || text.includes("cannot") || text.includes("blocked") || text.includes("risk")) {
    return "I cannot publish, spend money, move money, contact customers, modify accounts, create live agents, grant permissions, change API keys, deploy campaigns, or run external actions without Human Gate approval.";
  }

  if (text.includes("grow") || text.includes("new agent") || text.includes("future agent") || text.includes("agent blueprint")) {
    return `There is only one live agent: Agent 101. I can draft future-agent blueprints, like a Research Agent, but those stay inactive proposals. Live agent creation is locked behind Human Gate. Current blueprints: ${pluralize(snapshot.agentBlueprints.length, "draft")}.`;
  }

  if (text.includes("workflow")) {
    return "A safe workflow is: Agent 101 office -> Clips, Stock, Etsy, or Essentrx office -> evidence check -> draft package -> Human Gate if risky -> output/log. I can draft that flow locally and keep external execution locked.";
  }

  if (text.includes("task")) {
    return "A clean task plan starts with a bounded goal, needed context, research notes, verification checks, a draft output, a risk review, and an approval package if any external action is involved.";
  }

  if (text.includes("approve") || text.includes("approval") || text.includes("human gate")) {
    return `Human Gate has ${pluralize(snapshot.pending.length, "pending package")}. It is where publishing, spending, customer contact, account changes, live-agent activation, and other risky actions must be approved, sent back, or declined by you.`;
  }

  if (text.includes("stage") || text.includes("where are you")) {
    return `Current stage: ${depoWorkflowStageLabels[depoAgent.currentStage] || "Agent Habitat"}. Mode: ${depoAgent.mode}. Risk mode: ${depoAgent.riskMode}.`;
  }

  if (text.includes("know") || text.includes("memory") || text.includes("remember")) {
    return `I know what is stored locally: ${pluralize(snapshot.memoryCount, "memory note")}, ${pluralize(snapshot.evidenceCount, "evidence note")}, ${pluralize(snapshot.artifacts.length, "artifact")}, and ${pluralize(snapshot.approvals.length, "approval record")}. I do not know anything outside this app unless it has been added as a task, memory, artifact, approval, or audit event.`;
  }

  if (text.includes("next") || text.includes("start") || text.includes("step")) {
    return `The next clean step is to give Agent 101 one bounded task and choose the business office: Clips, Stock, Etsy, or Essentrx. I can research it, verify it, draft the output, then package anything risky for Human Gate instead of executing it.`;
  }

  if (text.includes("agent") || text.includes("agents")) {
    return "There is only one active head agent: Agent 101. The business offices are work areas that report to Agent 101. I can propose future agents, but creating a live agent is blocked until Human Gate approval.";
  }

  return `For ${card.title}: ${card.purpose || card.summary} I can work from local state, keep the request draft-only, and route anything risky to Human Gate before it leaves Argentum.`;
}

function depoChatMessagesFor(roomKey) {
  const resolved = resolveRoomKey(roomKey);
  const messages = depoChatMessages.filter((message) => message.roomId === resolved).slice(-6);
  if (messages.length) return messages;
  return depoStarterMessages(moduleCardData(resolved));
}

function agentChatMarkup(card) {
  const messages = depoChatMessagesFor(card.id);
  const snapshot = depoKnowledgeSnapshot();
  const stageLabel = depoWorkflowStageLabels[depoAgent.currentStage] || "Agent Habitat";
  const promptButtons = [
    "Create a task plan",
    "Create Codex prompt",
    "Draft a workflow",
    "Create clips plan",
    "Propose a new agent",
    "Package for approval",
    "What can you do?",
    "What is blocked?",
  ];
  return `
    <div class="module-info-head agent-chat-head">
      <span class="module-info-icon" style="--module-color: ${escapeHtml(card.color)}" aria-hidden="true">${moduleIconMarkup(card.id)}</span>
      <div>
        <strong>Talk to Agent 101</strong>
        <small>Master Agent · Supervised · Draft-only</small>
      </div>
      <em class="${aiProviderChatLabel() === "Provider Error" ? "danger-status" : ""}">${escapeHtml(aiProviderChatLabel())}</em>
      <button class="module-info-close" type="button" aria-label="Close module details">×</button>
    </div>
    ${aiProviderNotice ? `<div class="agent-provider-notice">${escapeHtml(aiProviderNotice)} Using Local Demo fallback.</div>` : ""}
    <div class="agent-chat-summary">
      <span><small>Identity</small><strong>Agent 101</strong></span>
      <span><small>Mode</small><strong>Draft-only</strong></span>
      <span><small>Stage</small><strong>${escapeHtml(stageLabel)}</strong></span>
      <span><small>Approval</small><strong>Required</strong></span>
      <span><small>Memory</small><strong>${escapeHtml(pluralize(snapshot.memoryCount, "note"))}</strong></span>
      <span><small>Queue</small><strong>${escapeHtml(pluralize(snapshot.queuedTasks.length, "task"))}</strong></span>
    </div>
    <div class="agent-unlock-status" aria-label="Agent 101 unlock status">
      <span><strong>1</strong> Local reasoning</span>
      <span><strong>2</strong> Task planning</span>
      <span><strong>3</strong> Workflow drafting</span>
      <span class="draft"><strong>4</strong> Blueprint drafts</span>
      <span class="locked"><strong>5</strong> Live agents locked</span>
    </div>
    <div class="agent-chat-log" aria-live="polite">
      ${messages
        .map(
          (message) => `
            <article class="chat-message ${message.speaker === "operator" ? "operator" : "depo"} ${message.pending ? "pending" : ""}">
              <span>${message.speaker === "operator" ? "You" : message.prompt ? `You · ${escapeHtml(message.prompt)}` : "Agent 101"}</span>
              <p>${escapeHtml(message.text)}</p>
            </article>
          `,
        )
        .join("")}
    </div>
    <div class="agent-chat-prompts">
      ${promptButtons.map((prompt) => `<button type="button" data-chat-prompt="${escapeHtml(prompt)}">${escapeHtml(prompt)}</button>`).join("")}
    </div>
    <form class="agent-chat-form" data-depo-chat-form>
      <input name="message" type="text" autocomplete="off" placeholder="Ask Agent 101 about this room..." />
      <button type="submit">Ask</button>
    </form>
  `;
}

function approvalSourceLabel(approval) {
  const title = `${approval.title || ""} ${approval.action || ""}`.toLowerCase();
  if (title.includes("pod") || title.includes("draft") || title.includes("artifact")) return "Output Bench";
  if (title.includes("stock") || title.includes("risk") || title.includes("monitor")) return "Verify Station";
  if (approval.taskId) return "Task Intake";
  return "Human Gate";
}

function humanGateMarkup(card) {
  const allApprovals = pendingApprovals();
  const approvals = allApprovals.slice(0, 3);
  return `
    <div class="module-info-head human-gate-head">
      <span class="module-info-icon" style="--module-color: ${escapeHtml(card.color)}" aria-hidden="true">${moduleIconMarkup(card.id)}</span>
      <div>
        <strong>Human Gate</strong>
        <small>${escapeHtml(card.metric)} · approval control</small>
      </div>
      <em>Locked</em>
      <button class="module-info-close" type="button" aria-label="Close module details">×</button>
    </div>
    <div class="human-gate-card">
      ${allApprovals.length > approvals.length ? `<p class="gate-overflow-note">${escapeHtml(`${allApprovals.length - approvals.length} more package${allApprovals.length - approvals.length === 1 ? "" : "s"} waiting on the Human Gate page.`)}</p>` : ""}
      ${
        approvals.length
          ? approvals
              .map(
                (approval) => `
                  <article class="gate-approval-row">
                    <div>
                      <span>${escapeHtml(approvalSourceLabel(approval))}</span>
                      <strong>${escapeHtml(approval.title || "Approval package")}</strong>
                      <p>${escapeHtml(approval.action || "Operator review required.")}</p>
                      <small>${escapeHtml(approval.evidence || "No evidence attached yet.")}</small>
                    </div>
                    <em class="risk-tag ${escapeHtml(approval.risk || "medium")}">${escapeHtml(approval.risk || "medium")}</em>
                    <div class="gate-actions">
                      <button type="button" data-card-approval-action="approve" data-approval-id="${escapeHtml(approval.id)}">Approve</button>
                      <button type="button" data-card-approval-action="revise" data-approval-id="${escapeHtml(approval.id)}">Send back</button>
                      <button type="button" data-card-approval-action="block" data-approval-id="${escapeHtml(approval.id)}">Decline</button>
                    </div>
                  </article>
                `,
              )
              .join("")
          : `
              <article class="gate-approval-row empty">
                <div>
                  <span>Human Gate</span>
                  <strong>No pending approvals</strong>
                  <p>Agent 101 will place packages here when work needs operator review.</p>
                </div>
              </article>
            `
      }
    </div>
  `;
}

function safeList(items, fallback = ["No local items recorded yet."], limit = 6) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  return (list.length ? list : fallback).slice(0, limit);
}

function officeRuntimeSnapshot() {
  const tasks = stateList("tasks");
  const localTasks = depoTasks();
  const artifacts = stateList("artifacts");
  const approvals = stateList("approvals");
  const pending = approvals.filter((approval) => approval.status === "pending");
  const memoryCount = memoryEntries().length;
  const evidenceCount = taskEvidenceCount(tasks) + artifactEvidenceCount(artifacts);
  const auditEntries = [...systemLogEntries(), ...stateList("audit")];
  const queuedWork = [
    ...tasks.filter((task) => ["queued", "needs_revision"].includes(task.status)),
    ...localTasks.filter((task) => task.status !== "done"),
  ];
  return {
    tasks,
    localTasks,
    artifacts,
    approvals,
    pending,
    memoryCount,
    evidenceCount,
    auditEntries,
    queuedWork,
    workflowDrafts: workflowDrafts(),
    agentBlueprints: agentBlueprints(),
  };
}

function businessOfficeProfile(roomKey) {
  const resolved = resolveRoomKey(roomKey);
  const runtime = officeRuntimeSnapshot();
  const commonBlocked = [
    "Publish externally without approval",
    "Spend or move money",
    "Contact customers directly",
    "Change accounts or credentials",
    "Create live agents without approval",
  ];
  const profiles = {
    "depo-habitat": {
      title: "Agent Office: Agent 101",
      badge: "Master agent",
      officeType: "Supervised Operator",
      status: "Draft-only",
      priority: "High",
      goal: "Act as the head office. Agent 101 receives reports from every business office and packages risky actions for Human Gate.",
      willDo: ["Review every office", "Plan bounded work", "Research and organize evidence", "Draft outputs", "Prepare approval packages"],
      needsAccess: ["Local app state", "Business offices", "Memory vault", "Task queue", "Human Gate"],
      blocked: commonBlocked,
      steps: ["Receive office report", "Gather context", "Verify assumptions", "Draft output", "Package risk", "Await human decision"],
      tools: ["Local Demo AI", "OpenAI provider status", "Local memory", "Human Gate"],
      primaryAction: "Create task plan",
      secondaryAction: "Draft workflow",
    },
    "clips-office": {
      title: "Business Office: Clips & Video",
      badge: "Business",
      officeType: "Content Creation",
      status: "Drafting",
      priority: "High",
      goal: "Create short-form clips and video packages that Agent 101 can review before anything is posted.",
      willDo: ["Plan hooks", "Draft scripts", "Prepare edit notes", "Package captions", "Create posting checklists"],
      needsAccess: ["Raw footage notes", "Brand notes", "Caption drafts", "Approval queue"],
      blocked: ["Posting without approval", "Opening social accounts", "Spending ad money", "Contacting customers"],
      steps: ["Plan clip idea", "Gather assets", "Draft script", "Prepare edit notes", "Package for approval", "Report to Agent 101"],
      tools: ["Script planner", "Caption drafts", "Asset notes", "Human Gate"],
      primaryAction: "Create task plan",
      secondaryAction: "Draft workflow",
    },
    "stock-office": {
      title: "Business Office: Stock",
      badge: "Business",
      officeType: "Market Research",
      status: "Guarded",
      priority: "High",
      goal: "Prepare stock watch notes and risk-labeled research without trading, moving money, or making claims.",
      willDo: ["Gather ticker notes", "Track watch ideas", "Label risk", "Draft summaries", "Prepare review packets"],
      needsAccess: ["Market notes", "Operator watchlist", "Risk rules", "Memory"],
      blocked: ["Place trades", "Move money", "Promise returns", "Change brokerage settings"],
      steps: ["Set watch topic", "Gather notes", "Check risk", "Draft watch note", "Package for review", "Report to Agent 101"],
      tools: ["Watch note draft", "Risk labels", "Memory notes", "Human Gate"],
      primaryAction: "Save note",
      secondaryAction: "Run check",
    },
    "etsy-office": {
      title: "Business Office: Etsy Store",
      badge: "Business",
      officeType: "Store Planning",
      status: "Draft only",
      priority: "High",
      goal: "Prepare Etsy/POD product ideas, listings, SEO, and store packages for Agent 101 review.",
      willDo: ["Draft product ideas", "Prepare listing copy", "Organize POD evidence", "Create SEO notes", "Package store changes"],
      needsAccess: ["Product ideas", "POD research", "Listing drafts", "Approval queue"],
      blocked: ["Publish listings", "Change prices", "Spend money", "Message customers"],
      steps: ["Choose product idea", "Gather evidence", "Draft listing", "Check risk", "Package approval", "Report to Agent 101"],
      tools: ["Listing drafts", "POD brief", "SEO notes", "Human Gate"],
      primaryAction: "Draft workflow",
      secondaryAction: "Package for approval",
    },
    "essentrx-office": {
      title: "Business Office: Essentrx",
      badge: "Business",
      officeType: "Brand Operations",
      status: "Connected",
      priority: "High",
      goal: "Prepare Essentrx brand, product, admin, and customer-safe work while Agent 101 keeps external actions gated.",
      willDo: ["Draft product notes", "Prepare admin ideas", "Organize scent/business context", "Package customer-safe copy", "Create review bundles"],
      needsAccess: ["Essentrx context", "Product notes", "Admin notes", "Approval queue"],
      blocked: ["Contact customers", "Change checkout", "Publish campaigns", "Modify accounts"],
      steps: ["Define business need", "Gather brand context", "Draft internal plan", "Check customer risk", "Package approval", "Report to Agent 101"],
      tools: ["Brand notes", "Admin drafts", "Customer-safe copy", "Human Gate"],
      primaryAction: "Draft workflow",
      secondaryAction: "Package for approval",
    },
    "task-intake": {
      title: "Business Office: Idea Intake",
      badge: "Business",
      officeType: "Request Planning",
      status: runtime.queuedWork.length ? "Work waiting" : "Ready",
      priority: runtime.queuedWork.length ? "High" : "Normal",
      goal: "Turn business ideas into clean, bounded jobs Agent 101 can safely work on.",
      willDo: ["Capture one clear goal", "Break it into safe steps", "Label risk", "Route work to Agent 101"],
      needsAccess: ["Operator instructions", "Task templates", "Workflow definitions"],
      blocked: ["Starting vague unbounded work", ...commonBlocked.slice(0, 3)],
      steps: ["Define request", "Set outcome", "Attach context", "Queue for Agent 101", "Log intake"],
      tools: ["Task templates", "Local queue", "Workflow router"],
      primaryAction: "Create task plan",
      secondaryAction: "Send to Research",
    },
    "research-lab": {
      title: "Business Office: Research",
      badge: "Business",
      officeType: "Evidence Gathering",
      status: runtime.evidenceCount ? "Evidence saved" : "Needs source material",
      priority: "Normal",
      goal: "Collect and organize evidence before anything becomes a draft or business recommendation.",
      willDo: ["Gather notes", "Separate facts from guesses", "Store source context", "Send uncertain claims to review"],
      needsAccess: ["Operator-provided sources", "Browser research when approved", "Memory vault"],
      blocked: ["Paid research tools without approval", "Scraping private/login data", ...commonBlocked.slice(1, 3)],
      steps: ["Collect sources", "Summarize evidence", "Label assumptions", "Save notes", "Send to verification"],
      tools: ["Memory notes", "Evidence counter", "Local research log"],
      primaryAction: "Save note",
      secondaryAction: "Send to Verify",
    },
    "verify-station": {
      title: "Business Office: Review",
      badge: "Business",
      officeType: "Risk Check",
      status: runtime.pending.length ? "Review needed" : "Clear",
      priority: runtime.pending.length ? "High" : "Normal",
      goal: "Check claims, permissions, and risks before a draft turns into an approval package.",
      willDo: ["Check missing evidence", "Flag risky claims", "Score approval need", "Route blocked items"],
      needsAccess: ["Research notes", "Draft output", "Human Gate rules"],
      blocked: ["Approving its own risky action", "Making legal or financial guarantees", ...commonBlocked.slice(0, 2)],
      steps: ["Check evidence", "Find gaps", "Mark risk", "Request revision", "Clear for draft"],
      tools: ["Risk labels", "Approval rules", "Audit log"],
      primaryAction: "Run check",
      secondaryAction: "Send to Draft",
    },
    "memory-vault": {
      title: "Business Office: Knowledge Base",
      badge: "Business",
      officeType: "Memory",
      status: runtime.memoryCount ? "Memory active" : "Empty",
      priority: "Normal",
      goal: "Keep reusable knowledge, notes, evidence, and decisions organized for Agent 101.",
      willDo: ["Save internal notes", "Retrieve local context", "Label sensitive info", "Keep evidence attached"],
      needsAccess: ["Working memory", "Shared memory", "Agent notes"],
      blocked: ["Saving API keys or secrets", "Exposing private memory", "Overwriting audit history"],
      steps: ["Receive note", "Classify layer", "Attach source", "Store locally", "Make reusable"],
      tools: ["Working memory", "Shared memory", "Agent memory"],
      primaryAction: "Save note",
      secondaryAction: "View memory",
    },
    "draft-studio": {
      title: "Business Office: Draft Studio",
      badge: "Business",
      officeType: "Output Creation",
      status: runtime.workflowDrafts.length ? "Drafting" : "Ready",
      priority: "High",
      goal: "Create internal business outputs, workflows, plans, prompts, and proposals without publishing them.",
      willDo: ["Draft content", "Draft workflows", "Prepare reports", "Build future-agent blueprints"],
      needsAccess: ["Research notes", "Memory vault", "Output bench"],
      blocked: ["Publishing drafts", "Deploying campaigns", "Creating live agents"],
      steps: ["Read verified notes", "Draft structure", "Write output", "Package risks", "Stage output"],
      tools: ["Draft builder", "Workflow drafts", "Blueprint drafts"],
      primaryAction: "Draft workflow",
      secondaryAction: "Package for approval",
    },
    "output-bench": {
      title: "Business Office: Output Bench",
      badge: "Business",
      officeType: "Deliverables",
      status: runtime.artifacts.length ? "Outputs staged" : "No outputs yet",
      priority: runtime.artifacts.length ? "Normal" : "Low",
      goal: "Hold completed internal artifacts until the operator decides what happens next.",
      willDo: ["Stage deliverables", "Bundle evidence", "Prepare review package", "Keep outputs internal"],
      needsAccess: ["Artifacts", "Approval records", "System log"],
      blocked: ["Sending files externally", "Publishing outputs", "Claiming revenue"],
      steps: ["Receive artifact", "Attach evidence", "Confirm approval status", "Prepare handoff", "Log result"],
      tools: ["Artifact list", "Approval package", "Local system log"],
      primaryAction: "View output",
      secondaryAction: "Package for approval",
    },
    "human-gate": {
      title: "Business Office: Human Gate",
      badge: "Approval",
      officeType: "Operator Decisions",
      status: runtime.pending.length ? `${runtime.pending.length} pending` : "Locked and ready",
      priority: runtime.pending.length ? "High" : "Normal",
      goal: "Approve, send back, or decline risky business actions before anything external happens.",
      willDo: ["Hold approval packages", "Record decisions", "Block risky actions", "Send work back for revision"],
      needsAccess: ["Approval queue", "Risk evidence", "Operator decision"],
      blocked: ["Auto-approval", "Auto-spend", "Auto-publish", "Auto-create agents"],
      steps: ["Receive package", "Read evidence", "Approve or revise", "Record decision", "Release only approved next step"],
      tools: ["Approval queue", "Decision log", "Risk labels"],
      primaryAction: "View pending approvals",
      secondaryAction: "Approve local test",
    },
    "system-log": {
      title: "Business Office: Ops Log",
      badge: "Business",
      officeType: "Audit Trail",
      status: runtime.auditEntries.length ? "Events recorded" : "No events",
      priority: "Normal",
      goal: "Show what Agent 101 and the operator did locally so the business stays traceable.",
      willDo: ["Append events", "Show stage changes", "Record approval outcomes", "Summarize local work"],
      needsAccess: ["Audit stream", "System log", "Workflow state"],
      blocked: ["Deleting audit history", "Hiding blocked actions", "Rewriting approvals"],
      steps: ["Capture event", "Label actor", "Label risk", "Save timestamp", "Show feed"],
      tools: ["System feed", "Audit log", "Local state"],
      primaryAction: "View logs",
      secondaryAction: "Run check",
    },
  };
  return profiles[resolved] || profiles["depo-habitat"];
}

function officeMetricCards(profile, runtime) {
  return [
    ["Office type", profile.officeType],
    ["Status", profile.status],
    ["Priority", profile.priority],
    ["Approval", depoAgent.riskMode],
    ["Memory", pluralize(runtime.memoryCount, "note")],
    ["Queued work", pluralize(runtime.queuedWork.length, "task")],
  ];
}

function officeStepStatus(index, roomKey, runtime) {
  const resolved = resolveRoomKey(roomKey);
  const currentRoomIndex = depoWorkflowStages.indexOf(resolveRoomKey(roomKey));
  if (resolved === "human-gate" && runtime.pending.length) return index === 1 ? "In review" : index < 1 ? "Ready" : "Waiting";
  if (resolved === depoAgent.currentStage || resolved === "depo-habitat") return index === 0 ? "In progress" : "Pending";
  if (index < Math.max(1, currentRoomIndex)) return "Ready";
  if (index === Math.max(0, currentRoomIndex)) return "In progress";
  return "Pending";
}

function officeStepClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("progress") || normalized.includes("review")) return "active";
  if (normalized.includes("ready") || normalized.includes("done") || normalized.includes("complete")) return "done";
  if (normalized.includes("waiting")) return "waiting";
  return "";
}

function officePreviewMarkup(roomKey, runtime) {
  const resolved = resolveRoomKey(roomKey);
  const latestArtifact = runtime.artifacts[0];
  const latestTask = runtime.tasks[0] || runtime.localTasks[0];
  const title = latestArtifact?.title || latestTask?.title || "No business output staged yet";
  const summary = latestArtifact?.summary || latestTask?.operatorText || latestTask?.stage || "Give Agent 101 one bounded task and this preview will show the real draft, package, or output created locally.";
  const details = [
    ["Artifacts", String(runtime.artifacts.length)],
    ["Approvals", String(runtime.pending.length)],
    ["Evidence", String(runtime.evidenceCount)],
    ["Current room", businessOfficeProfile(resolved).officeType],
  ];
  return `
    <section class="office-preview">
      <div class="office-preview-screen">
        <span>${escapeHtml(resolved === "depo-habitat" ? "Agent 101" : "Business output")}</span>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(summary)}</p>
      </div>
      <div class="office-preview-details">
        ${details.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}
      </div>
    </section>
  `;
}

function officeToolsMarkup(profile, roomKey) {
  const providerLive = aiProviderSettings.provider === "openai" && aiProviderSettings.connectionStatus !== "Error";
  const tools = safeList(profile.tools, ["Local state"]);
  return `
    <section class="office-tools">
      <div class="office-section-head">
        <h4>Apps & Tools</h4>
        <span>${providerLive ? "Live" : "Local"}</span>
      </div>
      ${tools
        .map(
          (tool, index) => `
            <article>
              <strong>${escapeHtml(tool)}</strong>
              <small>${index === 0 ? escapeHtml(aiProviderChatLabel()) : "Available locally"}</small>
            </article>
          `,
        )
        .join("")}
      <button type="button" data-module-action="${escapeHtml(profile.secondaryAction)}">${escapeHtml(profile.secondaryAction)}</button>
      <button type="button" data-module-action="${resolveRoomKey(roomKey) === "human-gate" ? "View pending approvals" : "Package for approval"}">${resolveRoomKey(roomKey) === "human-gate" ? "View approvals" : "Request approval"}</button>
    </section>
  `;
}

function officeNotesMarkup(runtime) {
  const memory = memoryEntries();
  const notes = safeList(
    memory.map((entry) => entry.title || entry.body),
    ["No memory notes saved yet.", "Use Save note to add local business knowledge.", "Secrets and keys stay out of memory."],
    4,
  );
  const resources = safeList(
    [
      ...runtime.artifacts.map((artifact) => artifact.title),
      ...runtime.tasks.map((task) => task.title),
      ...runtime.workflowDrafts.map((workflow) => workflow.name),
    ],
    ["No artifacts or draft files staged yet."],
    4,
  );
  return `
    <section class="office-notes">
      <div>
        <h4>Agent Notes</h4>
        <ul>${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
      </div>
      <div>
        <h4>Resources & Files</h4>
        <ul>${resources.map((resource) => `<li>${escapeHtml(resource)}</li>`).join("")}</ul>
      </div>
    </section>
  `;
}

function officeChatMarkup(card) {
  const resolved = resolveRoomKey(card.id);
  const messages = depoChatMessages.filter((message) => message.roomId === resolved).slice(-12);
  const visibleMessages = messages.length
    ? messages
    : [{ speaker: "depo", text: "I'm ready. Tell me what to check, plan, draft, or package in this office." }];
  return `
    <section class="office-chat">
      <div class="office-section-head">
        <h4>Agent 101 Command Chat</h4>
      </div>
      <div class="office-chat-log" aria-live="polite">
        ${visibleMessages
          .map(
            (message) => `
              <article class="${message.speaker === "operator" ? "operator" : ""} ${message.pending ? "pending" : ""}">
                <strong>${message.speaker === "operator" ? "You" : "Agent 101"}</strong>
                <p>${escapeHtml(message.text)}</p>
              </article>
            `,
          )
          .join("")}
      </div>
      <form class="agent-chat-form office-chat-form" data-depo-chat-form>
        <input name="message" type="text" autocomplete="off" placeholder="Tell Agent 101 what to check, plan, or package in this office..." />
        <button type="submit">Send</button>
      </form>
    </section>
  `;
}

function businessOfficeMarkup(card) {
  const runtime = officeRuntimeSnapshot();
  const profile = businessOfficeProfile(card.id);
  const metrics = officeMetricCards(profile, runtime);
  const steps = safeList(profile.steps, [], 6);
  return `
    <div class="office-detail-panel">
      <div class="office-detail-header">
        <span class="office-avatar" style="--module-color: ${escapeHtml(card.color)}" aria-hidden="true">${moduleIconMarkup(card.id)}</span>
        <div>
          <h3>${escapeHtml(profile.title)}</h3>
          <p>Agent 101 · ${escapeHtml(profile.officeType)} · Supervised · Draft-only</p>
        </div>
        <button class="module-info-close" type="button" aria-label="Close office">×</button>
      </div>
      ${aiProviderNotice ? `<div class="agent-provider-notice">${escapeHtml(aiProviderNotice)} Using Local Demo fallback.</div>` : ""}
      <div class="office-metrics">
        ${metrics.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}
      </div>
      <div class="office-detail-layout">
        <div class="office-main">
          <section class="office-goal">
            <span>${moduleIconMarkup("verify-station")}</span>
            <div>
              <h4>Office Goal</h4>
              <p>${escapeHtml(profile.goal)}</p>
            </div>
          </section>
          <div class="office-command-grid">
            ${card.id === "human-gate" ? humanGateChatMarkup(card, runtime) : officeChatMarkup(card)}
            <section class="office-capabilities">
              <div>
                <h4>What This Office Will Do</h4>
                <ul>${safeList(profile.willDo).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
              </div>
              <div>
                <h4>What It Needs Access To</h4>
                <ul>${safeList(profile.needsAccess).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
              </div>
              <div>
                <h4>What Is Blocked</h4>
                <ul class="blocked">${safeList(profile.blocked).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
              </div>
            </section>
          </div>
          <section class="office-pipeline">
            <div class="office-section-head">
              <h4>Task Pipeline Overview</h4>
              <span>${escapeHtml(depoStageLabel(depoAgent.currentStage))}</span>
            </div>
            <div class="office-pipeline-steps">
              ${steps
                .map((step, index) => {
                  const stepStatus = officeStepStatus(index, card.id, runtime);
                  return `
                    <article class="${escapeHtml(officeStepClass(stepStatus))}">
                      <strong>${index + 1}</strong>
                      <span>${escapeHtml(step)}</span>
                      <small>${escapeHtml(stepStatus)}</small>
                    </article>
                  `;
                })
                .join("")}
            </div>
          </section>
          <div class="office-lower-grid">
            ${officePreviewMarkup(card.id, runtime)}
            ${officeToolsMarkup(profile, card.id)}
          </div>
          ${officeNotesMarkup(runtime)}
        </div>
        <aside class="office-side">
          <section class="office-timeline">
            <div class="office-section-head">
              <h4>Workflow Steps</h4>
              <span>Local timeline</span>
            </div>
            ${steps
              .map((step, index) => {
                const stepStatus = officeStepStatus(index, card.id, runtime);
                return `
                  <article class="${officeStepClass(stepStatus) === "active" ? "current" : ""}">
                    <b>${index + 1}</b>
                    <div>
                      <strong>${escapeHtml(step)}</strong>
                      <p>${escapeHtml(stepStatus)}</p>
                    </div>
                    <em>${index === 0 ? "Now" : `Step ${index + 1}`}</em>
                  </article>
                `;
              })
              .join("")}
          </section>
          <section class="office-quick-actions">
            <h4>Quick Actions</h4>
            <div>
              <button type="button" data-module-action="${escapeHtml(profile.primaryAction)}">${escapeHtml(profile.primaryAction)}</button>
              <button type="button" data-module-action="${escapeHtml(profile.secondaryAction)}">${escapeHtml(profile.secondaryAction)}</button>
              <button type="button" data-module-action="Run check">Run local check</button>
              <button type="button" data-module-action="View logs">View full feed</button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  `;
}

function humanGateOfficeQueueMarkup(runtime) {
  const approvals = runtime.pending.slice(0, 4);
  return `
    <section class="office-approval-queue">
      <div class="office-section-head">
        <h4>Approval Queue</h4>
        <span>${escapeHtml(pluralize(runtime.pending.length, "pending"))}</span>
      </div>
      ${
        approvals.length
          ? approvals
              .map(
                (approval) => `
                  <article>
                    <strong>${escapeHtml(approval.title || "Approval package")}</strong>
                    <p>${escapeHtml(approval.action || "Operator review required.")}</p>
                    <div>
                      <button type="button" data-card-approval-action="approve" data-approval-id="${escapeHtml(approval.id)}">Approve</button>
                      <button type="button" data-card-approval-action="revise" data-approval-id="${escapeHtml(approval.id)}">Send back</button>
                      <button type="button" data-card-approval-action="block" data-approval-id="${escapeHtml(approval.id)}">Decline</button>
                    </div>
                  </article>
                `,
              )
              .join("")
          : `<article class="empty"><strong>No pending approvals</strong><p>Risky work will appear here before anything external can happen.</p></article>`
      }
    </section>
  `;
}

function humanGateChatMarkup(card, runtime) {
  const resolved = resolveRoomKey(card.id);
  const chatMessages = depoChatMessages.filter((message) => message.roomId === resolved).slice(-8);
  const approvals = runtime.pending.slice(0, 5);
  const feedItems = [
    ...chatMessages.map((message) => ({ type: "message", message })),
    ...approvals.map((approval) => ({ type: "approval", approval })),
  ];
  const visibleItems = feedItems.length
    ? feedItems
    : [{ type: "message", message: { speaker: "depo", text: "Human Gate is clear. Risky work will appear here as approval cards inside this chat." } }];
  return `
    <section class="office-chat human-gate-chat">
      <div class="office-section-head">
        <h4>Approval Chat</h4>
        <span>${escapeHtml(pluralize(runtime.pending.length, "pending"))}</span>
      </div>
      <div class="office-chat-log approval-chat-log" aria-live="polite">
        ${visibleItems
          .map((item) => {
            if (item.type === "message") {
              const message = item.message;
              return `
                <article class="${message.speaker === "operator" ? "operator" : ""} ${message.pending ? "pending" : ""}">
                  <strong>${message.speaker === "operator" ? "You" : "Agent 101"}</strong>
                  <p>${escapeHtml(message.text)}</p>
                </article>
              `;
            }
            const approval = item.approval;
            return `
              <article class="approval-chat-card ${escapeHtml(approval.risk || "medium")}">
                <div class="approval-chat-top">
                  <span>${escapeHtml(approvalSourceLabel(approval))}</span>
                  <em class="risk-tag ${escapeHtml(approval.risk || "medium")}">${escapeHtml(approval.risk || "medium")}</em>
                </div>
                <strong>${escapeHtml(approval.title || "Approval package")}</strong>
                <p>${escapeHtml(approval.action || "Operator review required before this can continue.")}</p>
                <small>${escapeHtml(approval.evidence || "No evidence attached yet.")}</small>
                <div class="approval-chat-actions">
                  <button type="button" data-card-approval-action="approve" data-approval-id="${escapeHtml(approval.id)}">Approve</button>
                  <button type="button" data-card-approval-action="revise" data-approval-id="${escapeHtml(approval.id)}">Send back</button>
                  <button type="button" data-card-approval-action="block" data-approval-id="${escapeHtml(approval.id)}">Decline</button>
                </div>
              </article>
            `;
          })
          .join("")}
      </div>
      <form class="agent-chat-form office-chat-form" data-depo-chat-form>
        <input name="message" type="text" autocomplete="off" placeholder="Ask Agent 101 about approvals, evidence, or next decision..." />
        <button type="submit">Send</button>
      </form>
    </section>
  `;
}

function moduleInfoMarkup(roomKey) {
  const card = moduleCardData(roomKey);
  return businessOfficeMarkup(card);
}

function lockModuleInfoPageScroll() {
  if (!document.body.classList.contains("module-card-open")) {
    moduleInfoLockedScroll = { x: window.scrollX || 0, y: window.scrollY || 0 };
    document.body.style.setProperty("--module-card-scroll-x", `${moduleInfoLockedScroll.x}px`);
    document.body.style.setProperty("--module-card-scroll-y", `${moduleInfoLockedScroll.y}px`);
  }
  document.body.classList.add("module-card-open");
}

function unlockModuleInfoPageScroll() {
  document.body.classList.remove("module-card-open");
  document.body.style.removeProperty("--module-card-scroll-x");
  document.body.style.removeProperty("--module-card-scroll-y");
  window.scrollTo(moduleInfoLockedScroll.x, moduleInfoLockedScroll.y);
}

function restoreModuleInfoPageScroll() {
  if (!document.body.classList.contains("module-card-open")) return;
  window.scrollTo(moduleInfoLockedScroll.x, moduleInfoLockedScroll.y);
}

function closeModuleInfoCard() {
  if (!moduleInfoCard) return;
  unlockModuleInfoPageScroll();
  moduleInfoCard.hidden = true;
  moduleInfoCard.classList.remove("open", "office-detail-card");
  moduleInfoCard.innerHTML = "";
}

function positionModuleInfoCard(roomKey) {
  if (!stationMap || !moduleInfoCard || moduleInfoCard.hidden) return;
  if (moduleInfoCard.classList.contains("office-detail-card")) {
    moduleInfoCard.style.removeProperty("--card-left");
    moduleInfoCard.style.removeProperty("--card-top");
    return;
  }
  const mapRect = stationMap.getBoundingClientRect();
  const cardRect = moduleInfoCard.getBoundingClientRect();
  const room = moduleProfile(roomKey);
  const anchorX = (Number(room.position?.x || 50) / 100) * mapRect.width * mapView.scale + mapView.x;
  const anchorY = (Number(room.position?.y || 50) / 100) * mapRect.height * mapView.scale + mapView.y;
  const bottomReserve = 18;
  const preferLeft = Number(room.position?.x || 50) >= 75;
  const gap = preferLeft ? 34 : 30;
  let left = preferLeft ? anchorX - cardRect.width - gap : anchorX + gap;
  let top = anchorY - cardRect.height * 0.45;
  if (preferLeft && left < 12 && anchorX + gap + cardRect.width + 12 <= mapRect.width) {
    left = anchorX + gap;
  }
  if (left < 12) {
    left = anchorX + gap;
  } else if (left + cardRect.width + 14 > mapRect.width) {
    left = anchorX - cardRect.width - gap;
  }
  left = clamp(left, 12, Math.max(12, mapRect.width - cardRect.width - 12));
  const minTop = 12;
  top = clamp(top, minTop, Math.max(minTop, mapRect.height - cardRect.height - bottomReserve));
  moduleInfoCard.style.setProperty("--card-left", `${mapRect.left + left}px`);
  moduleInfoCard.style.setProperty("--card-top", `${mapRect.top + top}px`);
}

function scrollAgentChatToLatest() {
  const chatLog = moduleInfoCard?.querySelector(".agent-chat-log, .office-chat-log");
  if (!chatLog) return;
  chatLog.scrollTop = chatLog.scrollHeight;
  chatLog.dataset.userScrolledUp = "false";
}

function isChatNearBottom(chatLog) {
  if (!chatLog) return true;
  return chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 28;
}

function shouldAutoScrollChat() {
  const chatLog = moduleInfoCard?.querySelector(".agent-chat-log, .office-chat-log");
  if (!chatLog) return true;
  return chatLog.dataset.userScrolledUp !== "true" || isChatNearBottom(chatLog);
}

function focusAgentChatInput() {
  const input = moduleInfoCard?.querySelector('.agent-chat-form input[name="message"]');
  input?.focus({ preventScroll: true });
}

function openModuleInfoCard(roomKey, options = {}) {
  if (!moduleInfoCard) return;
  const resolved = resolveRoomKey(roomKey);
  lockModuleInfoPageScroll();
  const previousLeft = moduleInfoCard.style.getPropertyValue("--card-left");
  const previousTop = moduleInfoCard.style.getPropertyValue("--card-top");
  const canPreservePosition = Boolean(options.preservePosition && !moduleInfoCard.hidden && previousLeft && previousTop);
  moduleInfoCard.innerHTML = moduleInfoMarkup(resolved);
  moduleInfoCard.dataset.station = resolved;
  moduleInfoCard.hidden = false;
  moduleInfoCard.classList.add("office-detail-card");
  moduleInfoCard.classList.remove("open");
  if (canPreservePosition) {
    moduleInfoCard.style.setProperty("--card-left", previousLeft);
    moduleInfoCard.style.setProperty("--card-top", previousTop);
  }
  requestAnimationFrame(() => {
    if (!canPreservePosition) positionModuleInfoCard(resolved);
    moduleInfoCard.classList.add("open");
    if (options.scrollChat) scrollAgentChatToLatest();
    if (options.focusInput) focusAgentChatInput();
  });
}

function renderOrbitScene() {
  renderStationArtwork();
  renderHabitatModules();
  applySelectionClasses();
}

function renderShellData() {
  updateHabitatRoomRuntimeFromState();
  renderAgentRoster();
  renderOrbitScene();
  if (moduleInfoCard && !moduleInfoCard.hidden && selectedRoomKey) {
    const activeInput = moduleInfoCard.contains(document.activeElement) ? moduleInfoCard.querySelector('.agent-chat-form input[name="message"]') : null;
    const activeInputValue = activeInput?.value || "";
    const autoScrollChat = shouldAutoScrollChat();
    moduleInfoCard.innerHTML = moduleInfoMarkup(selectedRoomKey);
    positionModuleInfoCard(selectedRoomKey);
    if (activeInput) {
      const nextInput = moduleInfoCard.querySelector('.agent-chat-form input[name="message"]');
      if (nextInput) {
        nextInput.value = activeInputValue;
        nextInput.focus({ preventScroll: true });
      }
    }
    if (autoScrollChat) requestAnimationFrame(scrollAgentChatToLatest);
  }
}

function applySelectionClasses() {
  const activeRoomId = selectedAgentKey ? resolveRoomKey(agentProfiles[selectedAgentKey]?.room) : resolveRoomKey(selectedRoomKey);
  const hasSelection = Boolean(selectedRoomKey || selectedAgentKey);
  const related = hasSelection ? connectedModuleSet(activeRoomId) : new Set();

  document.querySelectorAll(".station").forEach((item) => {
    const stationId = item.dataset.station;
    item.classList.toggle("selected", hasSelection && stationId === activeRoomId);
    item.classList.toggle("related", hasSelection && related.has(stationId));
    item.classList.toggle("current-stage", stationId === depoAgent.currentStage);
  });
  document.querySelectorAll(".map-core").forEach((item) => {
    const stationId = item.dataset.station || "depo-habitat";
    item.classList.toggle("selected", hasSelection && stationId === activeRoomId);
    item.classList.toggle("related", hasSelection && related.has(stationId));
    item.classList.toggle("current-stage", stationId === depoAgent.currentStage);
  });
  document.querySelectorAll(".roster-agent, .user-profile-card, .admin-menu-item[data-agent]").forEach((item) => {
    item.classList.toggle("selected", item.dataset.agent === selectedAgentKey);
  });
  stationMap?.classList.toggle("has-selection", hasSelection);
  renderHabitatRoutes();
  renderMiniMap();
}

// OrbitControls
function normalizedMapView(nextView = mapView) {
  const scale = clamp(Number.isFinite(nextView.scale) ? nextView.scale : mapView.scale, mapMinScale, mapMaxScale);

  if (!stationMap) {
    return { x: 0, y: 0, scale };
  }

  const rect = stationMap.getBoundingClientRect();
  if (scale <= 1 + mapPanEpsilon) {
    return {
      x: (rect.width - rect.width * scale) / 2,
      y: (rect.height - rect.height * scale) / 2,
      scale,
    };
  }

  const minX = rect.width - rect.width * scale;
  const minY = rect.height - rect.height * scale;
  const x = Number.isFinite(nextView.x) ? nextView.x : mapView.x;
  const y = Number.isFinite(nextView.y) ? nextView.y : mapView.y;

  return {
    x: clamp(x, minX, 0),
    y: clamp(y, minY, 0),
    scale,
  };
}

function applyMapView(animated = true) {
  if (!habitatCanvas) return;
  mapView = normalizedMapView(mapView);
  habitatCanvas.classList.remove("is-animating");
  habitatCanvas.style.transform = `translate3d(${mapView.x}px, ${mapView.y}px, 0) scale(${mapView.scale})`;
  stationMap?.classList.toggle("can-pan", mapView.scale > 1 + mapPanEpsilon);
  if (zoomReadout) zoomReadout.textContent = `${Math.round(mapView.scale * 100)}%`;
  if (zoomOutBtn) zoomOutBtn.disabled = mapView.scale <= mapMinScale + mapPanEpsilon;
  renderMiniMap();
}

function setMapView(nextView, animated = true) {
  if (mapViewLocked) {
    mapView = { x: 0, y: 0, scale: mapHomeScale };
    applyMapView(animated);
    return;
  }
  mapView = normalizedMapView({
    x: Number.isFinite(nextView.x) ? nextView.x : mapView.x,
    y: Number.isFinite(nextView.y) ? nextView.y : mapView.y,
    scale: Number.isFinite(nextView.scale) ? nextView.scale : mapView.scale,
  });
  applyMapView(animated);
}

function resetHabitatView(animated = true) {
  selectedRoomKey = null;
  selectedAgentKey = null;
  closeModuleInfoCard();
  applySelectionClasses();
  setMapView({ x: 0, y: 0, scale: mapHomeScale }, animated);
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
  if (mapViewLocked) {
    setMapView({ x: 0, y: 0, scale: mapHomeScale });
    return;
  }
  if (!stationMap) return;
  const rect = stationMap.getBoundingClientRect();
  const anchor = point || { x: rect.width / 2, y: rect.height / 2 };
  const nextScale = clamp(mapView.scale + delta, mapMinScale, mapMaxScale);
  if (nextScale <= mapMinScale + mapPanEpsilon) {
    setMapView({ x: 0, y: 0, scale: mapMinScale });
    return;
  }
  const worldX = (anchor.x - mapView.x) / mapView.scale;
  const worldY = (anchor.y - mapView.y) / mapView.scale;
  setMapView({
    x: anchor.x - worldX * nextScale,
    y: anchor.y - worldY * nextScale,
    scale: nextScale,
  });
}

function stationElementForRoom(roomKey) {
  const resolved = resolveRoomKey(roomKey);
  return document.querySelector(`.station[data-station="${CSS.escape(resolved)}"]`) || document.querySelector(`.map-core[data-station="${CSS.escape(resolved)}"]`);
}

function focusRoom(roomKey, options = {}) {
  const resolvedRoomKey = resolveRoomKey(roomKey);
  const station = stationElementForRoom(resolvedRoomKey);
  if (!station || !stationMap) return;
  const mapRect = stationMap.getBoundingClientRect();
  const centerX = station.offsetLeft + station.offsetWidth / 2;
  const centerY = station.offsetTop + station.offsetHeight / 2;
  const scale = options.scale || 1.72;
  selectedRoomKey = resolvedRoomKey;
  if (options.agentKey) selectedAgentKey = options.agentKey;

  applySelectionClasses();
  if (mapViewLocked) {
    setMapView({ x: 0, y: 0, scale: mapHomeScale }, false);
    renderInspector();
    return;
  }
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
  const room = selectedRoomKey ? moduleProfile(selectedRoomKey) : roomProfiles["argentum-core"];
  const activeRoom = agent ? moduleProfile(agent.room) : room;

  inspectorPanel.classList.toggle("is-focused", Boolean(selectedRoomKey || selectedAgentKey));
  inspectorPanel.closest(".task-panel")?.classList.toggle("focused-inspector", Boolean(selectedRoomKey || selectedAgentKey));
  inspectorType.textContent = agent ? "Selected Agent" : selectedRoomKey ? "Selected Module" : "Live System Status";
  inspectorTitle.textContent = agent ? `${agent.name} // ${agent.role}` : activeRoom.title;
  inspectorSummary.textContent = agent ? agent.currentTask : activeRoom.summary;

  inspectorChips.innerHTML = (agent
    ? [agent.status, activeRoom.title, `${agent.queueCount || agent.queue.length} queued`, `${agent.riskLevel} risk`]
    : [
        activeRoom.status,
        activeRoom.metric,
        `${activeRoom.agents.length} ${activeRoom.agents.length === 1 ? "agent" : "agents"}`,
        `${activeRoom.connectedModules.length} links`,
      ]
  )
    .map((chip) => `<span>${escapeHtml(chip)}</span>`)
    .join("");

  inspectorGrid.innerHTML = agent
    ? `
      <div><span>Current task</span><strong>${escapeHtml(agent.currentTask)}</strong></div>
      <div><span>Queue</span><strong>${escapeHtml(agent.queueCount || agent.queue.length)} active</strong></div>
      <div><span>Risk level</span><strong>${escapeHtml(agent.riskLevel)}</strong></div>
      <div><span>Permissions</span><strong>${escapeHtml(agent.permissions[agent.permissions.length - 1])}</strong></div>
    `
    : `
      ${activeRoom.metrics.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}
      <div><span>Active agents</span><strong>${escapeHtml(activeRoom.agents.join(" / "))}</strong></div>
    `;

  inspectorActions.innerHTML = agent
    ? `
      <button class="small-button" type="button" data-inspector-action="tasks">View tasks</button>
      <button class="small-button" type="button" data-inspector-action="workspace" data-target="${escapeHtml(selectedAgentKey)}">Open workspace</button>
      <button class="ghost-button" type="button" data-inspector-action="check">Run check</button>
      <button class="ghost-button" type="button" data-inspector-action="pause">Pause agent</button>
      <button class="ghost-button" type="button" data-inspector-action="logs">View logs</button>
    `
    : `
      <button class="small-button" type="button" data-inspector-action="workspace" data-target="${escapeHtml(activeRoom.id)}">Open workspace</button>
      <button class="ghost-button" type="button" data-inspector-action="scan">Scan</button>
      <button class="ghost-button" type="button" data-inspector-action="report">Report</button>
      <button class="ghost-button" type="button" data-inspector-action="optimize">Optimize</button>
      <button class="ghost-button" type="button" data-inspector-action="logs">Logs</button>
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

function profileForWorkspace(targetKey) {
  if (workspaceProfiles[targetKey]) return workspaceProfiles[targetKey];
  const agent = agentProfiles[targetKey];
  if (agent) {
    return {
      title: `${agent.name} Workspace`,
      eyebrow: agent.role,
      sections: [
        ["Current task", agent.currentTask],
        ["Queue", agent.queue.join(", ")],
        ["Permissions", agent.permissions.join(", ")],
        ["Connected modules", agent.connectedModules.map((key) => moduleProfile(key).title).join(", ")],
      ],
      feed: agent.actions,
    };
  }
  const module = moduleProfile(targetKey);
  return {
    title: `${module.title} Workspace`,
    eyebrow: module.type,
    sections: [
      ["Overview", module.description],
      ["Active agents", module.agents.join(", ")],
      ["Metrics", module.metrics.map(([label, value]) => `${label}: ${value}`).join(" / ")],
      ["Connected modules", module.connected.join(", ")],
    ],
    feed: module.activity,
  };
}

function renderWorkspace(targetKey) {
  const profile = profileForWorkspace(targetKey);
  workspaceEyebrow.textContent = profile.eyebrow;
  workspaceTitle.textContent = profile.title;
  workspaceGrid.innerHTML = profile.sections
    .map(([label, body]) => `<div><span>${escapeHtml(label)}</span><p>${escapeHtml(body)}</p></div>`)
    .join("");
  workspaceFeed.innerHTML = profile.feed
    .map((item) => `<article><span></span><p>${escapeHtml(item)}</p></article>`)
    .join("");
}

function openWorkspace(targetKey) {
  renderWorkspace(targetKey || selectedAgentKey || selectedRoomKey || "agent-habitat");
  workspaceOverlay.classList.add("open");
  workspaceOverlay.setAttribute("aria-hidden", "false");
}

function closeWorkspace() {
  workspaceOverlay.classList.remove("open");
  workspaceOverlay.setAttribute("aria-hidden", "true");
}

function updateSystemClock() {
  if (!systemClockNodes.length || !systemDateNodes.length) return;
  const nowDate = new Date();
  const clockText = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  }).format(nowDate);
  const dateText = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  }).format(nowDate);
  systemClockNodes.forEach((node) => {
    node.textContent = clockText;
  });
  systemDateNodes.forEach((node) => {
    node.textContent = dateText;
  });
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

function formatAiProviderTime(value) {
  if (!value) return "Never";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "Never";
  }
}

function activeAiProviderDetail() {
  const provider = normalizeUiProvider(aiProviderSettings.provider);
  return aiProviderSettings.providers?.[provider] || aiProviderSettings.providers?.local_demo || {};
}

function normalizeUiProvider(provider) {
  const value = String(provider || "").trim().toLowerCase();
  if (value === "local" || value === "local-demo" || value === "demo") return "local_demo";
  return value || "local_demo";
}

function isLocalUiProvider(provider) {
  return normalizeUiProvider(provider) === "local_demo";
}

function formatAiMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "$0";
  return `$${amount.toFixed(amount % 1 === 0 ? 0 : 2)}`;
}

function aiProviderChatLabel() {
  if (aiProviderNotice) return "Provider Error";
  const openaiStatus = agent101ToolStatus?.openaiStatus || null;
  if (openaiStatus?.status === "error") return "Provider Error";
  if (openaiStatus?.status === "missing_key") return "Local Demo";
  const provider = normalizeUiProvider(aiProviderSettings.provider);
  if (provider === "openai" && aiProviderSettings.mode === "live") return "OpenAI Live";
  return "Local Demo";
}

function renderAiProviderSettings() {
  const detail = activeAiProviderDetail();
  const provider = normalizeUiProvider(aiProviderSettings.provider);
  const keyProvider = aiKeyProviderSelect?.value || "openai";
  const keyDetail = aiProviderSettings.providers?.[keyProvider] || {};
  if (aiProviderCurrentProvider) aiProviderCurrentProvider.textContent = aiProviderSettings.providerLabel || "Local Demo";
  if (aiProviderConnectionStatus) aiProviderConnectionStatus.textContent = aiProviderSettings.connectionStatus || "Not configured";
  if (aiProviderActiveModel) aiProviderActiveModel.textContent = aiProviderSettings.activeModel || detail.model || "Not selected";
  if (aiProviderMode) aiProviderMode.textContent = aiProviderSettings.modeLabel || "Local Demo";
  if (aiProviderMonthlyLimit) {
    const used = aiProviderSettings.usage?.estimatedMonthlyUsd;
    aiProviderMonthlyLimit.textContent = `${formatAiMoney(aiProviderSettings.monthlyLimitUsd)} limit / ${formatAiMoney(used)} est. used`;
  }
  if (aiProviderLastError) aiProviderLastError.textContent = aiProviderSettings.lastError || "None";
  if (aiProviderModeChip) {
    aiProviderModeChip.textContent = aiProviderChatLabel();
    aiProviderModeChip.classList.toggle("danger-status", aiProviderChatLabel() === "Provider Error");
  }
  if (aiProviderLastTest) {
    const testedAt = aiProviderSettings.lastTest?.testedAt || aiProviderSettings.lastTest?.timestamp;
    aiProviderLastTest.textContent = formatAiProviderTime(testedAt);
  }
  if (aiProviderSelect) aiProviderSelect.value = provider;
  if (aiModeSelect) {
    aiModeSelect.value = aiProviderSettings.mode || "demo";
    aiModeSelect.disabled = isLocalUiProvider(provider);
  }
  if (aiModelInput) {
    aiModelInput.value = isLocalUiProvider(provider) ? "" : detail.model || "";
    aiModelInput.disabled = isLocalUiProvider(provider);
    aiModelInput.placeholder = isLocalUiProvider(provider) ? "Local demo uses scripted responses" : "Model name";
  }
  if (aiInlineKeyStatus) {
    aiInlineKeyStatus.textContent = isLocalUiProvider(provider) ? "No key required" : detail.keyConfigured ? "Configured in backend" : "Not configured";
  }
  if (aiTemperatureInput) {
    aiTemperatureInput.value = Number.isFinite(Number(detail.temperature)) ? detail.temperature : 0.4;
    aiTemperatureInput.disabled = isLocalUiProvider(provider);
  }
  if (aiMaxTokensInput) {
    aiMaxTokensInput.value = Number.isFinite(Number(detail.maxOutputTokens)) ? detail.maxOutputTokens : 700;
    aiMaxTokensInput.disabled = isLocalUiProvider(provider);
  }
  if (aiKeyStatus) {
    aiKeyStatus.textContent = keyDetail.keyConfigured ? "•••••••• configured" : keyDetail.keyStatus || "Not configured";
    aiKeyStatus.classList.toggle("danger-status", !keyDetail.keyConfigured && keyProvider !== "local_demo");
  }
}

async function loadAiProviderSettings() {
  if (!apiAvailable) {
    renderAiProviderSettings();
    return;
  }
  try {
    aiProviderSettings = await api("/api/settings/ai-provider");
    const status = await api("/api/ai/status");
    aiProviderSettings = { ...aiProviderSettings, ...status };
    aiProviderNotice = "";
  } catch (error) {
    aiProviderNotice = error.message;
  }
  renderAiProviderSettings();
}

function fallbackAgent101ToolStatus() {
  const connectors = [
    { id: "openai", label: "OpenAI", status: aiProviderSettings.connectionStatus || "not_configured", mode: aiProviderSettings.modeLabel || "Local Demo" },
    { id: "browser", label: "Browser", status: "approval_required", mode: "Restricted" },
    { id: "capcut", label: "CapCut", status: "manual_handoff", mode: "Manual handoff" },
    { id: "tiktok", label: "TikTok", status: "manual_handoff", mode: "Draft package" },
    { id: "twitch", label: "Twitch", status: "manual_handoff", mode: "Manual handoff" },
    { id: "youtube", label: "YouTube", status: "manual_handoff", mode: "Manual handoff" },
    { id: "google_drive", label: "Google Drive", status: "manual_handoff", mode: "Manual handoff" },
  ];
  return {
    agent101: {
      id: "agent-101",
      name: "Agent 101",
      role: "Master Agent",
      mode: "Draft-only",
      status: "Active supervised",
      currentOffice: "Clips Office",
      approvalRequired: true,
      externalActions: "Locked",
    },
    tools: {
      openai: {
        provider: "OpenAI",
        status: aiProviderSettings.connectionStatus || "Local Demo",
        mode: aiProviderSettings.modeLabel || "Local Demo",
        model: aiProviderSettings.activeModel || "local-demo",
        budgetLimit: aiProviderSettings.monthlyLimitUsd || 10,
      },
      browser: { label: "Restricted", status: "restricted" },
      capcut: { label: "Manual handoff", status: "manual_handoff" },
      tiktok: { label: "Draft package", status: "not_connected", mode: "draft_package", postingMode: "Draft package" },
      instagram: { label: "Not connected", status: "not_connected" },
      youtube: { label: "Not connected", status: "not_connected" },
      storage: { label: "Ready", status: "ready", localProjectFiles: true },
    },
    connectors,
    readiness: {
      humanGate: "active",
      taskCreation: "ready",
      artifactCreation: "ready",
      approvalRouting: "ready",
      externalActions: "locked",
      pendingApprovals: pendingApprovals().length,
    },
    openaiStatus: null,
  };
}

function renderAgent101ToolStatus() {
  const status = agent101ToolStatus || fallbackAgent101ToolStatus();
  const tools = status.tools || {};
  const connectors = Array.isArray(status.connectors) ? status.connectors : [];
  const connectorById = Object.fromEntries(connectors.map((connector) => [connector.id, connector]));
  const openaiStatus = status.openaiStatus || null;
  const openaiMode = openaiStatus?.status === "ready" && openaiStatus.mode === "live"
    ? "OpenAI Live"
    : openaiStatus?.status === "error"
      ? "Provider Error"
      : tools.openai?.mode || "Local Demo";
  const rows = [
    ["OpenAI", openaiMode, openaiMode === "OpenAI Live" ? "live" : openaiMode === "Provider Error" ? "restricted" : "demo"],
    ["Browser", tools.browser?.label || "Restricted", "restricted"],
    ["CapCut", connectorById.capcut?.mode || tools.capcut?.label || "Manual handoff", "manual"],
    ["TikTok", connectorById.tiktok?.mode || tools.tiktok?.postingMode || tools.tiktok?.mode || "Draft package", "draft"],
    ["Storage", tools.storage?.label || "Ready", "ready"],
  ];
  if (agentToolGrid) {
    agentToolGrid.innerHTML = rows
      .map(([name, value, className]) => `<span><b>${escapeHtml(name)}</b><em class="${escapeHtml(className)}">${escapeHtml(value)}</em></span>`)
      .join("");
  }
  if (agentReadinessGrid) {
    const ready = openaiStatus?.status === "ready" && openaiStatus?.mode === "live";
    const liveReadiness = status.readiness || {};
    const readiness = [
      ["OpenAI connection", ready ? "Ready" : "Not ready", ready],
      ["Human Gate", liveReadiness.humanGate === "active" ? "Active" : "Waiting", liveReadiness.humanGate === "active"],
      ["Draft-only mode", "Active", true],
      ["System logs", "Active", true],
      ["Task creation", liveReadiness.taskCreation || "Ready", true],
      ["Artifact creation", liveReadiness.artifactCreation || "Ready", true],
      ["Approval routing", liveReadiness.approvalRouting || "Ready", true],
      ["External actions", "Locked", true],
    ];
    agentReadinessGrid.innerHTML = readiness
      .map(([label, value, ok]) => `<span class="${ok ? "ready" : "waiting"}"><b>${escapeHtml(label)}</b><em>${escapeHtml(value)}</em></span>`)
      .join("");
  }
  if (settingsToolGrid) {
    const settingsRows = [
      ["OpenAI", tools.openai?.mode || "Local Demo"],
      ["Browser", tools.browser?.label || "Restricted"],
      ["CapCut", connectorById.capcut?.mode || tools.capcut?.label || "Manual handoff"],
      ["TikTok", connectorById.tiktok?.mode || tools.tiktok?.postingMode || "Draft package"],
      ["Twitch", connectorById.twitch?.mode || "Manual handoff"],
      ["Instagram", tools.instagram?.label || "Not connected"],
      ["YouTube", connectorById.youtube?.mode || tools.youtube?.label || "Manual handoff"],
      ["Storage", tools.storage?.label || "Ready"],
    ];
    settingsToolGrid.innerHTML = settingsRows.map(([name, value]) => `<span><b>${escapeHtml(name)}</b><em>${escapeHtml(value)}</em></span>`).join("");
  }
  const clipsTasks = (state.tasks || []).filter((task) => task.workflowId === "workflow-clips-office" || task.intent === "content_creation");
  const clipsArtifacts = (state.artifacts || []).filter((artifact) => artifact.workflowId === "workflow-clips-office");
  const pendingClipsApproval = (state.approvals || []).find((approval) => approval.workflowId === "workflow-clips-office" && approval.status === "pending");
  if (clipsStageMetric) {
    clipsStageMetric.textContent = pendingClipsApproval ? "Human Gate" : clipsArtifacts.length ? "Preview Package" : clipsTasks.length ? "Plan & Brief" : "Ready";
  }
  if (clipsFilesMetric) {
    clipsFilesMetric.textContent = clipsArtifacts.length ? `${clipsArtifacts.length} artifact${clipsArtifacts.length === 1 ? "" : "s"}` : "Raw footage, audio, script";
  }
  if (clipsApprovalStatus) {
    clipsApprovalStatus.textContent = pendingClipsApproval ? "Approval waiting" : "Draft-only";
    clipsApprovalStatus.classList.toggle("danger-status", Boolean(pendingClipsApproval));
  }
}

async function loadAgent101ToolStatus() {
  if (!apiAvailable) {
    agent101ToolStatus = fallbackAgent101ToolStatus();
    renderAgent101ToolStatus();
    return;
  }
  try {
    const [toolStatus, openaiStatus, readiness, connectorStatus] = await Promise.all([
      api("/api/agent101/tool-status"),
      api("/api/agent101/openai-status"),
      api("/api/agent101/readiness"),
      api("/api/connectors/status"),
    ]);
    agent101ToolStatus = { ...toolStatus, openaiStatus, readiness, connectors: connectorStatus.connectors || toolStatus.connectors || [] };
  } catch (error) {
    addLocalAudit("Tool status unavailable", error.message);
    agent101ToolStatus = fallbackAgent101ToolStatus();
  }
  renderAgent101ToolStatus();
}

function fallbackSidebarStatus() {
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const approvals = Array.isArray(state.approvals) ? state.approvals : [];
  const artifacts = Array.isArray(state.artifacts) ? state.artifacts : [];
  const memoryLayers = state.memory && typeof state.memory === "object" ? state.memory : {};
  const memoryCount = Object.values(memoryLayers).reduce((sum, entries) => sum + (Array.isArray(entries) ? entries.length : 0), 0);
  const queued = tasks.filter((task) => ["queued", "needs_revision"].includes(task.status)).length;
  const pending = approvals.filter((approval) => approval.status === "pending").length;
  const queue = queued + pending;
  const workloadPercent = Math.min(100, queue * 18 + artifacts.length * 4);
  const healthPercent = Math.max(35, 100 - workloadPercent);
  const agentHealth = workloadPercent >= 78 ? "Overloaded" : workloadPercent >= 48 ? "Busy" : "Stable";
  return {
    health: "Local systems operational",
    agentHealth,
    agentMode: depoAgent.mode,
    metrics: [
      { label: "Agent Health", value: agentHealth, percent: healthPercent },
      { label: "Workload", value: workloadPercent >= 78 ? "Heavy" : workloadPercent >= 48 ? "Medium" : "Light", percent: workloadPercent },
      { label: "Memory", value: String(memoryCount), percent: Math.min(100, Math.max(8, memoryCount * 8)) },
      { label: "Safety Gate", value: pending ? `${pending} pending` : "On", percent: pending ? Math.min(100, 50 + pending * 12) : 100 },
    ],
    chart: [
      healthPercent,
      Math.min(100, 28 + queued * 12),
      Math.min(100, 30 + pending * 10),
      Math.min(100, 26 + artifacts.length * 7),
      Math.min(100, 34 + memoryCount * 3),
      workloadPercent,
      pending ? 68 : 90,
      88,
    ],
  };
}

async function loadSidebarSystemStatus() {
  if (!apiAvailable) {
    sidebarSystemStatus = fallbackSidebarStatus();
    return;
  }
  try {
    sidebarSystemStatus = await api("/api/system/status");
  } catch {
    sidebarSystemStatus = fallbackSidebarStatus();
  }
}

function renderSidebarSystemStatus() {
  const status = sidebarSystemStatus || fallbackSidebarStatus();
  if (sidebarSystemHealth) {
    sidebarSystemHealth.innerHTML = `<span class="status-dot"></span>${escapeHtml(status.health || "Local systems operational")}`;
    sidebarSystemHealth.classList.toggle("attention", String(status.health || "").toLowerCase().includes("attention"));
  }
  if (sidebarAgentId) sidebarAgentId.textContent = status.agentHealth || status.agentId || "Stable";
  if (sidebarAgentMode) sidebarAgentMode.textContent = status.agentMode || depoAgent.mode;
  const metrics = Array.isArray(status.metrics) ? status.metrics : [];
  sidebarStatusRows.forEach((row, index) => {
    const metric = metrics[index] || fallbackSidebarStatus().metrics[index];
    if (row.label) row.label.textContent = metric.label;
    if (row.value) row.value.textContent = metric.value;
    if (row.bar) row.bar.style.setProperty("--bar", `${Math.max(0, Math.min(100, Number(metric.percent) || 0))}%`);
  });
  if (sidebarMiniChart) {
    const chart = Array.isArray(status.chart) && status.chart.length ? status.chart : fallbackSidebarStatus().chart;
    sidebarMiniChart.innerHTML = chart.slice(-10).map((height) => `<i style="height: ${Math.max(8, Math.min(100, Number(height) || 8))}%"></i>`).join("");
  }
}

function renderAiProviderTestResult(result, type = "info") {
  if (!aiProviderTestResult) return;
  const ok = result?.success === true;
  const title = ok ? "Connection test passed" : result?.success === false ? "Connection test failed" : "Provider settings updated";
  const message = result?.message || result?.error || result || "No provider test yet.";
  aiProviderTestResult.className = `ai-provider-test-result ${ok ? "success" : type === "error" || result?.success === false ? "error" : ""}`;
  aiProviderTestResult.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    <p>${escapeHtml(message)}</p>
  `;
}

function renderCapabilities() {
  const cards = [
    {
      id: "research-analyze",
      name: "Research & Analyze",
      description: "Research niches, products, markets, and competitors.",
      status: "Active",
      accent: "cyan",
    },
    {
      id: "plan-structure",
      name: "Plan & Structure",
      description: "Create plans, outlines, and structured workflows.",
      status: "Active",
      accent: "blue",
    },
    {
      id: "draft-write",
      name: "Draft & Write",
      description: "Draft reports, briefs, scripts, OTPs, and content.",
      status: "Active",
      accent: "green",
    },
    {
      id: "workflow-design",
      name: "Workflow Design",
      description: "Design task flows and operating processes.",
      status: "Active",
      accent: "amber",
    },
    {
      id: "blueprint-propose",
      name: "Blueprint & Propose",
      description: "Propose agent blueprints and system decisions.",
      status: "Draft only",
      accent: "violet",
    },
    {
      id: "execute-external",
      name: "Execute External",
      description: "External actions and publishing stay locked.",
      status: "Requires approval",
      accent: "red",
    },
  ];
  capabilityList.innerHTML = cards
    .map(
      (capability) => {
        const statusClass = capability.status === "Active" ? "is-active" : capability.status === "Draft only" ? "is-draft" : "is-locked";
        return `
        <article class="capability-item capability-card ${escapeHtml(capability.accent)}">
          <div class="capability-main">
            <span class="capability-dot" aria-hidden="true"></span>
            <strong>${escapeHtml(capability.name)}</strong>
            <p>${escapeHtml(capability.description)}</p>
          </div>
          <button class="small-button capability-status-button ${statusClass}" type="button" data-capability="${escapeHtml(capability.id)}">${escapeHtml(capability.status)}</button>
        </article>
      `;
      },
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
  return (state.approvals || []).filter((approval) => approval.status === "pending");
}

function approvalCreatedAt(approval, fallbackIndex = 0) {
  return approval.createdAt || approval.submittedAt || approval.updatedAt || approval.resolvedAt || new Date(Date.now() - fallbackIndex * 7 * 60 * 1000).toISOString();
}

function isTodayIso(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.toDateString() === now.toDateString();
}

function minutesBetween(start, end) {
  const startDate = new Date(start || "");
  const endDate = new Date(end || "");
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  return Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000));
}

function formatReviewDuration(minutes) {
  if (minutes === null || minutes === undefined) return "--";
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function approvalDecisionGroups() {
  const approvals = state.approvals || [];
  const approved = approvals.filter((approval) => approval.status === "approved");
  const revised = approvals.filter((approval) => ["needs_revision", "revision_requested", "revised", "sent_back"].includes(approval.status));
  const blocked = approvals.filter((approval) => ["blocked", "declined", "rejected"].includes(approval.status));
  return { approvals, approved, revised, blocked };
}

function gateDraftCount() {
  const tasks = state.tasks || [];
  const artifacts = state.artifacts || [];
  const taskDrafts = tasks.filter((task) => ["queued", "running", "processing", "in_progress", "draft_ready", "needs_revision"].includes(task.status)).length;
  const artifactDrafts = artifacts.filter((artifact) => ["draft", "ready", "pending"].includes(artifact.status)).length;
  return taskDrafts + artifactDrafts;
}

function riskBars(risk = "medium") {
  const normalized = String(risk || "medium").toLowerCase();
  const level = normalized === "high" ? 5 : normalized === "medium" ? 3 : 2;
  return Array.from({ length: 5 }, (_, index) => `<i class="${index < level ? "on" : ""}"></i>`).join("");
}

function gateRecentEntries(limit = 4) {
  const approvalEntries = (state.approvals || []).map((approval, index) => ({
    title: approval.status === "pending" ? `${approval.title} submitted` : `${statusLabel(approval.status)}: ${approval.title}`,
    body: approval.action || approval.evidence || "Approval package recorded.",
    createdAt: approval.resolvedAt || approvalCreatedAt(approval, index),
    source: approval.status === "pending" ? "Approval Queue" : "Decision",
  }));
  const auditEntries = (state.audit || []).map((entry) => ({
    title: entry.title || "System event",
    body: entry.body || "Event recorded.",
    createdAt: entry.createdAt || entry.timestamp || "",
    source: "System Log",
  }));
  return [...approvalEntries, ...auditEntries]
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, limit);
}

function updateHumanGateMetrics(approvals) {
  const { approved, revised, blocked } = approvalDecisionGroups();
  const pending = approvals.length;
  const drafts = gateDraftCount();
  const escalated = approvals.filter((approval) => String(approval.risk || "").toLowerCase() === "high").length;
  const approvedToday = approved.filter((approval) => isTodayIso(approval.resolvedAt || approval.updatedAt)).length;
  const decisions = approved.length + revised.length + blocked.length;
  const accuracy = decisions ? Math.round((approved.length / decisions) * 100) : 0;
  const reviewMinutes = [...approved, ...revised, ...blocked]
    .map((approval, index) => minutesBetween(approvalCreatedAt(approval, index), approval.resolvedAt || approval.updatedAt))
    .filter((value) => value !== null);
  const avgReview = reviewMinutes.length
    ? Math.round(reviewMinutes.reduce((sum, value) => sum + value, 0) / reviewMinutes.length)
    : null;

  setText(queueCount, String(pending));
  setText(document.querySelector("#gateDraftCount"), String(drafts));
  setText(document.querySelector("#gateEscalatedCount"), String(escalated));
  setText(document.querySelector("#gateApprovedTodayCount"), String(approvedToday));
  setText(document.querySelector("#gatePendingTabCount"), String(pending));
  setText(document.querySelector("#gateDraftTabCount"), String(drafts));
  setText(document.querySelector("#gateApprovedTabCount"), String(approved.length));
  setText(document.querySelector("#gateBlockedTabCount"), String(blocked.length));
  setText(document.querySelector("#approvalShowingText"), pending ? `Showing ${pending} pending approval${pending === 1 ? "" : "s"}` : "No pending approvals");
  setText(document.querySelector("#gateTimelineSubmitted"), pending ? `${pending} queued` : "Clear");
  setText(document.querySelector("#gateTimelineReview"), pending ? "Needs decision" : "Clear");
  setText(document.querySelector("#gateAccuracyMetric"), `${accuracy}%`);
  setText(document.querySelector("#gateAvgReviewMetric"), formatReviewDuration(avgReview));
  setText(document.querySelector("#gateApprovedInsight"), String(approved.length));
  setText(document.querySelector("#gateRevisedInsight"), String(revised.length));
  setText(document.querySelector("#gateBlockedInsight"), String(blocked.length));
  const insightRing = document.querySelector("#gateInsightRing");
  if (insightRing) insightRing.style.setProperty("--value", String(accuracy));

  const activityList = document.querySelector("#gateRecentActivity");
  if (activityList) {
    const entries = gateRecentEntries(5);
    activityList.innerHTML = entries.length
      ? entries.map((entry) => `
          <article>
            <span>${escapeHtml(formatFeedTime(entry))}</span>
            <div>
              <strong>${escapeHtml(entry.title)}</strong>
              <p>${escapeHtml(entry.body)}</p>
            </div>
            <em>${escapeHtml(entry.source)}</em>
          </article>
        `).join("")
      : `
          <article>
            <span>Now</span>
            <div>
              <strong>No approval activity yet</strong>
              <p>Agent 101 will log every review package and decision here.</p>
            </div>
            <em>Human Gate</em>
          </article>
        `;
  }
}

function renderApprovals() {
  const approvals = pendingApprovals();
  updateHumanGateMetrics(approvals);
  if (approvals.length === 0) {
    approvalList.innerHTML = `
      <article class="approval-item gate-approval-card empty-state">
        <span class="gate-approval-icon" aria-hidden="true">✓</span>
        <div class="gate-approval-body">
        <strong>No pending approvals</strong>
        <p>Agent 101 will create new approval packages when a workflow reaches the human gate.</p>
        </div>
      </article>
    `;
    return;
  }
  approvalList.innerHTML = approvals
    .map(
      (approval) => `
        <article class="approval-item gate-approval-card ${escapeHtml(approval.risk || "medium")}">
          <span class="gate-approval-icon" aria-hidden="true">${String(approval.risk || "").toLowerCase() === "high" ? "!" : "□"}</span>
          <div class="gate-approval-body">
            <div class="gate-approval-title">
              <div>
                <strong>${escapeHtml(approval.title || "Approval package")}</strong>
                <span>${escapeHtml(approval.workflowId ? workflowName(approval.workflowId) : approvalSourceLabel(approval))}</span>
              </div>
              <em>${escapeHtml(formatFeedTime({ createdAt: approvalCreatedAt(approval) }))}</em>
            </div>
            <p>${escapeHtml(approval.action || "Operator review required before any external action.")}</p>
            <p><strong>Evidence:</strong> ${escapeHtml(approval.evidence || "No evidence attached yet.")}</p>
            <small>Submitted by Agent 101 · ${escapeHtml(formatFeedTime({ createdAt: approvalCreatedAt(approval) }))}</small>
          </div>
          <div class="gate-risk-block">
            <span>Risk level</span>
            <strong>${escapeHtml(statusLabel(approval.risk || "medium"))}</strong>
            <div class="gate-risk-meter ${escapeHtml(approval.risk || "medium")}" aria-hidden="true">${riskBars(approval.risk)}</div>
          </div>
          <div class="approval-actions gate-card-actions">
            <button class="small-button" type="button" data-approval-action="approve" data-approval-id="${escapeHtml(approval.id)}">Approve draft</button>
            <button class="ghost-button" type="button" data-approval-action="revise" data-approval-id="${escapeHtml(approval.id)}">Send back</button>
            <button class="danger-button" type="button" data-approval-action="block" data-approval-id="${escapeHtml(approval.id)}">Block</button>
          </div>
        </article>
      `,
    )
    .join("");
}

function outputStatusClass(status) {
  const normalized = String(status || "draft").toLowerCase();
  if (["approved", "finalized", "complete", "completed"].includes(normalized)) return "finalized";
  if (["delivered", "sent"].includes(normalized)) return "delivered";
  if (["archived"].includes(normalized)) return "archived";
  if (["pending", "review", "in_review", "pending_review"].includes(normalized)) return "review";
  return "draft";
}

function outputStatusLabel(status) {
  const normalized = outputStatusClass(status);
  const labels = {
    draft: "Draft",
    review: "Review",
    finalized: "Finalized",
    delivered: "Delivered",
    archived: "Archived",
  };
  return labels[normalized] || statusLabel(status);
}

function outputTypeLabel(value) {
  const normalized = String(value || "output").replaceAll("_", " ");
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function outputRecords() {
  const artifacts = state.artifacts || [];
  const approvals = (state.approvals || []).filter((approval) => approval.status === "pending");
  const tasks = (state.tasks || []).filter((task) => ["queued", "running", "processing", "in_progress", "draft_ready", "needs_revision"].includes(task.status));
  const artifactRows = artifacts.map((artifact, index) => ({
    id: artifact.id || `artifact-${index}`,
    title: artifact.title || "Untitled output",
    source: workflowName(artifact.workflowId),
    version: artifact.version || artifact.revision || "v1.0",
    summary: artifact.summary || "Structured output prepared by Agent 101.",
    status: outputStatusClass(artifact.status),
    statusLabel: outputStatusLabel(artifact.status),
    category: outputTypeLabel(artifact.type),
    tags: [artifact.type, artifact.workflowId, artifact.risk].filter(Boolean).map(statusLabel).slice(0, 3),
    createdAt: artifact.createdAt || artifact.updatedAt || artifact.resolvedAt || new Date(Date.now() - index * 11 * 60 * 1000).toISOString(),
    storageMb: Number(artifact.storageMb || artifact.sizeMb || 0.24),
    icon: "file",
  }));
  const approvalRows = approvals.map((approval, index) => ({
    id: approval.id || `approval-output-${index}`,
    title: approval.title || "Approval package",
    source: approvalSourceLabel(approval),
    version: "review",
    summary: approval.action || approval.evidence || "Review-ready package waiting in Human Gate.",
    status: "review",
    statusLabel: "Review",
    category: "Approval package",
    tags: [approval.risk || "medium", "human gate", "approval"].map(statusLabel),
    createdAt: approvalCreatedAt(approval, index),
    storageMb: 0.12,
    icon: "review",
  }));
  const taskRows = tasks.map((task, index) => ({
    id: task.id || `task-output-${index}`,
    title: task.title || "Draft output",
    source: workflowName(task.workflowId),
    version: statusLabel(task.status),
    summary: task.output || task.operatorText || "Draft work queued for Agent 101.",
    status: "draft",
    statusLabel: "Draft",
    category: outputTypeLabel(task.intent || "draft"),
    tags: [task.intent, task.risk, task.status].filter(Boolean).map(statusLabel).slice(0, 3),
    createdAt: task.createdAt || task.updatedAt || new Date(Date.now() - (approvals.length + index + 1) * 11 * 60 * 1000).toISOString(),
    storageMb: 0.18,
    icon: "draft",
  }));

  return [...artifactRows, ...approvalRows, ...taskRows].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
}

function outputCounts(records = outputRecords()) {
  const count = (status) => records.filter((record) => record.status === status).length;
  return {
    total: records.length,
    draft: count("draft"),
    review: count("review"),
    finalized: count("finalized"),
    delivered: count("delivered"),
    archived: count("archived"),
  };
}

function outputCategoryCounts(records) {
  const counts = new Map();
  records.forEach((record) => {
    const key = record.category || "Output";
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
}

function updateOutputMetrics(records) {
  const counts = outputCounts(records);
  const weeklyCount = records.filter((record) => isTodayIso(record.createdAt) || !record.createdAt).length;
  const storageUsed = records.reduce((sum, record) => sum + Number(record.storageMb || 0), 0);
  const storageLimit = 10;
  const storagePercent = clamp(Math.round((storageUsed / storageLimit) * 100), 0, 100);
  const safeTotal = Math.max(counts.total, 1);
  const draftEnd = Math.round((counts.draft / safeTotal) * 100);
  const reviewEnd = draftEnd + Math.round((counts.review / safeTotal) * 100);
  const finalizedEnd = reviewEnd + Math.round((counts.finalized / safeTotal) * 100);
  const deliveredEnd = finalizedEnd + Math.round((counts.delivered / safeTotal) * 100);

  setText(artifactCount, String(counts.total));
  setText(document.querySelector("#outputNewThisWeek"), weeklyCount ? `+ ${weeklyCount} live output${weeklyCount === 1 ? "" : "s"}` : "No new outputs");
  setText(document.querySelector("#outputDraftCount"), String(counts.draft));
  setText(document.querySelector("#outputDraftReviewCount"), `${counts.review} awaiting review`);
  setText(document.querySelector("#outputFinalizedCount"), String(counts.finalized));
  setText(document.querySelector("#outputFinalizedWeek"), `${counts.finalized} finalized`);
  setText(document.querySelector("#outputDeliveredCount"), String(counts.delivered));
  setText(document.querySelector("#outputDeliveredWeek"), `${counts.delivered} delivered`);
  setText(document.querySelector("#outputArchivedCount"), String(counts.archived));
  setText(document.querySelector("#outputCreatedMetric"), String(counts.total));
  setText(document.querySelector("#outputTimelineDrafts"), String(counts.draft));
  setText(document.querySelector("#outputTimelineReview"), String(counts.review));
  setText(document.querySelector("#outputTimelineApproved"), String(counts.finalized));
  setText(document.querySelector("#outputTimelineDelivered"), String(counts.delivered));
  setText(document.querySelector("#outputTimelineArchived"), String(counts.archived));
  setText(document.querySelector("#outputSummaryTotal"), String(counts.total));
  setText(document.querySelector("#outputLegendDrafts"), String(counts.draft));
  setText(document.querySelector("#outputLegendReview"), String(counts.review));
  setText(document.querySelector("#outputLegendFinalized"), String(counts.finalized));
  setText(document.querySelector("#outputLegendDelivered"), String(counts.delivered));
  setText(document.querySelector("#outputLegendArchived"), String(counts.archived));
  setText(document.querySelector("#outputWeekDelta"), weeklyCount ? `+ ${weeklyCount} tracked this week` : "No new artifacts yet");
  setText(document.querySelector("#outputStorageCopy"), `${storageUsed.toFixed(1)} MB of ${storageLimit} GB used`);
  setText(document.querySelector("#outputStoragePercent"), `${storagePercent}%`);

  const ring = document.querySelector("#outputSummaryRing");
  if (ring) {
    ring.style.setProperty("--draft", `${draftEnd}%`);
    ring.style.setProperty("--review", `${reviewEnd}%`);
    ring.style.setProperty("--finalized", `${finalizedEnd}%`);
    ring.style.setProperty("--delivered", `${deliveredEnd}%`);
  }
  const storageBar = document.querySelector("#outputStorageBar");
  if (storageBar) storageBar.style.width = `${Math.max(4, storagePercent)}%`;

  const categoryList = document.querySelector("#outputCategoryList");
  if (categoryList) {
    const categories = outputCategoryCounts(records);
    categoryList.innerHTML = categories.length
      ? categories.map(([category, value], index) => `
          <span class="output-category-row cat-${index}">
            <i></i>
            <b>${escapeHtml(category)}</b>
            <strong>${escapeHtml(value)}</strong>
          </span>
        `).join("")
      : `
          <span class="output-category-row">
            <i></i>
            <b>No categories yet</b>
            <strong>0</strong>
          </span>
        `;
  }
}

function outputIconMarkup(type) {
  const icons = {
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>',
    review: '<path d="M12 3 4 7v6c0 4 3 7 8 8 5-1 8-4 8-8V7z"/><path d="m9 12 2 2 4-5"/>',
    draft: '<path d="M4 20h16"/><path d="m14 4 6 6L9 21H3v-6z"/>',
  };
  return `<svg viewBox="0 0 24 24">${icons[type] || icons.file}</svg>`;
}

function renderArtifacts() {
  const records = outputRecords();
  updateOutputMetrics(records);
  if (records.length === 0) {
    artifactList.innerHTML = `
      <article class="artifact-item output-row empty-state">
        <span class="output-row-icon" aria-hidden="true">${outputIconMarkup("file")}</span>
        <div>
          <strong>No outputs yet</strong>
          <p>Assign Agent 101 a bounded job and new drafts, review packages, and artifacts will appear here.</p>
        </div>
      </article>
    `;
    return;
  }

  artifactList.innerHTML = records
    .map(
      (record) => `
        <article class="artifact-item output-row ${escapeHtml(record.status)}">
          <span class="output-row-icon" aria-hidden="true">${outputIconMarkup(record.icon)}</span>
          <div class="output-row-main">
            <div class="output-row-title">
              <strong>${escapeHtml(record.title)}</strong>
              <span>${escapeHtml(record.source)} · ${escapeHtml(record.version)}</span>
            </div>
            <p>${escapeHtml(record.summary)}</p>
            <div class="output-tags">
              ${record.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
            </div>
          </div>
          <span class="output-status-pill ${escapeHtml(record.status)}">${escapeHtml(record.statusLabel)}</span>
          <time>${escapeHtml(formatFeedTime({ createdAt: record.createdAt }))}</time>
          <button class="output-row-menu" type="button" data-output-action="inspect" data-output-id="${escapeHtml(record.id)}" aria-label="Inspect output">...</button>
        </article>
      `,
    )
    .join("");
}

function legacyArtifactMarkup(artifact) {
  return `
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
      `;
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
        <p>Assign Agent 101 one bounded business job and it will prepare a draft for approval.</p>
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
            <button class="small-button" type="button" data-task-run="${escapeHtml(task.id)}" ${runnable ? "" : "disabled"}>Run Agent 101</button>
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
        <p>Approve an Agent 101 task output to promote it into a reusable function.</p>
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
        <p>Run an approved function to create a supervised Agent 101 task.</p>
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

function memoryLayerEntries(layer) {
  const memory = state.memory && typeof state.memory === "object" ? state.memory : {};
  return Array.isArray(memory[layer]) ? memory[layer] : [];
}

function memoryLayerLabel(layer) {
  const labels = {
    working: "Working",
    shared: "Shared",
    agent: "Agent",
  };
  return labels[layer] || statusLabel(layer);
}

function memoryIconType(entry, index = 0) {
  const haystack = `${entry.title || ""} ${entry.body || ""}`.toLowerCase();
  if (haystack.includes("question") || haystack.includes("open")) return "question";
  if (haystack.includes("operator") || haystack.includes("agent")) return "agent";
  if (haystack.includes("rule") || haystack.includes("gate") || haystack.includes("approval")) return "shield";
  if (haystack.includes("artifact") || haystack.includes("draft") || haystack.includes("workflow")) return "document";
  return index % 3 === 0 ? "document" : index % 3 === 1 ? "agent" : "shield";
}

function memoryIconMarkup(type) {
  const icons = {
    document: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>',
    agent: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    shield: '<path d="M12 3 5 6v6c0 4 3 7 7 8 4-1 7-4 7-8V6z"/><path d="m9 12 2 2 4-5"/>',
    question: '<path d="M9.1 9a3 3 0 1 1 5.8 1c-.7 1.1-1.9 1.4-2.5 2.5"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="9"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
    pencil: '<path d="m14 4 6 6L9 21H3v-6z"/><path d="M13 5l6 6"/>',
  };
  return `<svg viewBox="0 0 24 24">${icons[type] || icons.document}</svg>`;
}

function memoryTags(entry) {
  const tags = [];
  if (entry.provenance) tags.push(entry.provenance);
  const text = `${entry.title || ""} ${entry.body || ""}`.toLowerCase();
  if (text.includes("workflow")) tags.push("workflow");
  if (text.includes("task")) tags.push("task");
  if (text.includes("approval") || text.includes("gate")) tags.push("approval");
  if (text.includes("artifact") || text.includes("draft")) tags.push("artifact");
  if (!tags.length) tags.push("local");
  return [...new Set(tags)].slice(0, 3);
}

function memoryEntryTime(entry, index = 0) {
  return entry.updatedAt || entry.createdAt || entry.timestamp || new Date(Date.now() - (index + 1) * 7 * 60 * 1000).toISOString();
}

function updateMemoryCounts() {
  const working = memoryLayerEntries("working").length;
  const shared = memoryLayerEntries("shared").length;
  const agent = memoryLayerEntries("agent").length;
  setText(document.querySelector("#memoryWorkingCount"), String(working));
  setText(document.querySelector("#memorySharedCount"), String(shared));
  setText(document.querySelector("#memoryAgentCount"), String(agent));
}

function renderMemory() {
  updateMemoryCounts();
  const entries = memoryLayerEntries(activeMemoryLayer);
  const layerLabel = memoryLayerLabel(activeMemoryLayer);
  setText(document.querySelector("#memoryShowingText"), entries.length ? `Showing 1-${entries.length} of ${entries.length} ${layerLabel.toLowerCase()} memories` : `No ${layerLabel.toLowerCase()} memories yet`);
  memoryList.innerHTML = entries.length
    ? entries
      .map(
        (entry, index) => `
          <article class="memory-item premium-memory-card ${escapeHtml(activeMemoryLayer)}">
            <span class="memory-card-icon ${escapeHtml(memoryIconType(entry, index))}" aria-hidden="true">${memoryIconMarkup(memoryIconType(entry, index))}</span>
            <div class="memory-card-main">
              <strong>${escapeHtml(entry.title || "Memory note")}</strong>
              <p>${escapeHtml(entry.body || "No memory body recorded yet.")}</p>
              <div class="memory-card-tags">
                ${memoryTags(entry).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
              </div>
            </div>
            <div class="memory-card-meta">
              <span>${escapeHtml(layerLabel)}</span>
              <time>${escapeHtml(formatFeedTime({ createdAt: memoryEntryTime(entry, index) }))}</time>
              <small>By Agent 101</small>
            </div>
            <button class="memory-card-menu" type="button" data-memory-action="inspect" aria-label="Inspect memory">...</button>
          </article>
        `,
      )
      .join("")
    : `
        <article class="memory-item premium-memory-card empty-state">
          <span class="memory-card-icon document" aria-hidden="true">${memoryIconMarkup("document")}</span>
          <div class="memory-card-main">
            <strong>No ${escapeHtml(layerLabel.toLowerCase())} memories yet</strong>
            <p>Agent 101 will save useful notes here after a task, report, or approval package creates durable context.</p>
          </div>
        </article>
      `;
}

function systemFeedEntries() {
  const auditEntries = Array.isArray(state.audit) ? state.audit : [];
  const seededEntries = [
    {
      title: "Agent 101 activated",
      body: "Agent 101 is active in draft-only mode with no revenue claimed.",
    },
    {
      title: "First workflow waiting",
      body: "Agent 101 is ready for one bounded task with evidence, draft output, and approval packaging.",
    },
    {
      title: "Revenue cleared",
      body: "The prototype is no longer showing invented earnings or mature-company counters.",
    },
    {
      title: "External actions locked",
      body: "Publishing, money movement, account changes, trades, customer contact, and new agents remain gated.",
    },
    {
      title: "Human gate ready",
      body: "Risky work must be packaged for the operator instead of executed automatically.",
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
    "Agent 101 activated": "Agent active",
    "First workflow waiting": "Workflow waiting",
    "Revenue cleared": "Revenue cleared",
    "External actions locked": "Actions locked",
    "Human gate ready": "Human gate ready",
  };

  if (compactTitles[normalizedTitle]) return compactTitles[normalizedTitle];
  if (normalizedTitle.length <= 24) return normalizedTitle;
  return `${normalizedTitle.slice(0, 21)}...`;
}

function miniFeedTitle(title) {
  return `Agent 101: ${compactFeedTitle(title)}`;
}

function renderSystemFeed() {
  const entries = systemFeedEntries();

  if (systemFeedMini) {
    systemFeedMini.innerHTML = entries
      .slice(0, 4)
      .map(
        (entry) => `
          <span>
            <strong>${escapeHtml(miniFeedTitle(entry.title))}</strong>
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

  if (systemFeedModalList) {
    systemFeedModalList.innerHTML = entries
      .map(
        (entry) => `
          <article class="system-feed-modal-row">
            <div>
              <strong>${escapeHtml(miniFeedTitle(entry.title))}</strong>
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
  const entries = systemFeedEntries().slice(0, 25);
  setText(document.querySelector("#auditShowingText"), `Showing latest ${entries.length} of ${systemFeedEntries().length} events`);
  auditLog.innerHTML = entries.length
    ? entries
      .map(
        (entry, index) => {
          const type = index % 4 === 0 ? "search" : index % 4 === 1 ? "shield" : index % 4 === 2 ? "pencil" : "document";
          return `
            <article class="audit-item premium-audit-row ${escapeHtml(type)}">
              <span class="audit-line-marker" aria-hidden="true">${memoryIconMarkup(type)}</span>
              <div class="audit-row-main">
                <strong>${escapeHtml(entry.title)}</strong>
                <p>${escapeHtml(entry.body)}</p>
              </div>
              <time>${escapeHtml(formatFeedTime(entry))}</time>
            </article>
          `;
        },
      )
      .join("")
    : `
        <article class="audit-item premium-audit-row">
          <span class="audit-line-marker" aria-hidden="true">${memoryIconMarkup("document")}</span>
          <div class="audit-row-main">
            <strong>No audit events yet</strong>
            <p>Agent 101 actions and decisions will appear here as the system runs.</p>
          </div>
          <time>Now</time>
        </article>
      `;
  renderSystemFeed();
}

function renderAgent() {
  const gateRequired = state.governance?.highRiskActionsRequireApproval !== false;
  const tasks = state.tasks || [];
  const approvals = state.approvals || [];
  const artifacts = state.artifacts || [];
  const memoryLayers = state.memory && typeof state.memory === "object" ? state.memory : {};
  const memoryCount = Object.values(memoryLayers).reduce((sum, entries) => sum + (Array.isArray(entries) ? entries.length : 0), 0);
  const activeTask = tasks.find((task) => ["queued", "running", "processing", "in_progress", "needs_revision"].includes(task.status)) || tasks[0];
  const latestArtifact = artifacts[0];
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending").length;
  setText(agentState, state.agent.state.replaceAll("_", " / "));
  setText(document.querySelector("#agentModeMetric"), state.agent.externalActions || "Draft-only");
  setText(document.querySelector("#agentStageMetric"), depoStageLabel(depoAgent.currentStage));
  setText(document.querySelector("#agentGateMetric"), gateRequired ? "Required" : "Off");
  setText(document.querySelector("#agentBudgetMetric"), state.agent.spendLimit || "$5/day sandbox");
  setText(document.querySelector("#agentMemoryMetric"), memoryCount ? `${memoryCount} notes` : state.agent.memoryAccess || "Working");
  setText(document.querySelector("#agentExternalMetric"), state.agent.externalActions || "Draft only");
  setText(document.querySelector("#agentPreviewTitle"), latestArtifact?.title || activeTask?.title || "No output staged yet");
  setText(
    document.querySelector("#agentPreviewMeta"),
    latestArtifact?.summary || activeTask?.operatorText || "Assign a bounded job and Agent 101 will prepare a draft package here.",
  );
  setText(document.querySelector("#agentPreviewStatus"), latestArtifact ? statusLabel(latestArtifact.status) : activeTask ? statusLabel(activeTask.status) : "Draft");
  const focusList = document.querySelector("#agentFocusList");
  if (focusList) {
    const focusItems = [
      activeTask ? `Working on: ${activeTask.title}` : "Waiting for one bounded operator task",
      pendingApprovals ? `${pendingApprovals} Human Gate review${pendingApprovals === 1 ? "" : "s"} pending` : "Human Gate is clear",
      memoryCount ? `${memoryCount} local memory note${memoryCount === 1 ? "" : "s"} available` : "No stored memory notes yet",
      latestArtifact ? `Latest output: ${latestArtifact.title}` : "No external action has been taken",
    ];
    focusList.innerHTML = focusItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  }
  const resourceList = document.querySelector("#agentResourceList");
  if (resourceList) {
    const evidence = activeTask?.evidence?.length ? activeTask.evidence.slice(0, 3) : ["local_state.json", "approval_rules.md", "memory_notes"];
    resourceList.innerHTML = evidence
      .map((item, index) => `<span><b>${escapeHtml(item)}</b><em>${index === 0 ? "ready" : index === 1 ? "locked" : "local"}</em></span>`)
      .join("");
  }
}

function renderStatus() {
  const paused = Boolean(state.mission.paused);
  pauseBtn.classList.toggle("is-active", paused);
  pauseBtn.setAttribute("aria-label", paused ? "Resume Agent 101" : "Pause Agent 101");
  pauseBtn.title = paused ? "Resume Agent 101" : "Pause Agent 101";
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
      body: "Agent 101 will hold the current stage until resumed.",
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

function rotateAutomationTelemetry() {
  if (!automationTelemetry || !automationTelemetryMessages.length) return;
  automationTelemetryIndex = (automationTelemetryIndex + 1) % automationTelemetryMessages.length;
  automationTelemetry.classList.remove("is-switching");
  window.requestAnimationFrame(() => {
    automationTelemetry.textContent = automationTelemetryMessages[automationTelemetryIndex];
    automationTelemetry.classList.add("is-switching");
  });
}

function renderOverviewTelemetry() {
  const governance = state.governance || fallbackState.governance;
  const agentStateLabel = statusLabel(state.agent?.state || "active_supervised");
  const safeSpend = Math.max(Number(governance.estimatedSpendUsd || 0), 0);
  const tasks = state.tasks || [];
  const queuedTasks = tasks.filter((task) => task.status === "queued");
  const artifacts = state.artifacts || [];
  const approvals = state.approvals || [];
  const highRiskQueued = queuedTasks.filter((task) => String(task.risk || "").toLowerCase() === "high").length;
  const mediumQueued = queuedTasks.filter((task) => String(task.risk || "").toLowerCase() === "medium").length;
  const lowQueued = queuedTasks.length - highRiskQueued - mediumQueued;
  const acceptedApprovals = approvals.filter((approval) => approval.status === "approved").length;
  const declinedApprovals = approvals.filter((approval) => ["blocked", "declined", "rejected"].includes(approval.status)).length;
  const revisionApprovals = approvals.filter((approval) => approval.status === "needs_revision").length;
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending").length;
  const requiredReviews = pendingApprovals + revisionApprovals + highRiskQueued;
  const completedWork = artifacts.filter((artifact) => ["approved", "ready", "draft"].includes(artifact.status)).length + acceptedApprovals;
  const riskDrag = declinedApprovals * 18 + requiredReviews * 8;
  const activityBase = completedWork * 14 + queuedTasks.length * 5 + 54;
  const businessEfficiency = clamp(Math.round(activityBase - riskDrag), 18, 96);
  const businessStatus = businessEfficiency >= 78 ? "Business moving well" : businessEfficiency >= 55 ? "Business warming up" : "Needs operator review";
  const businessReadout = businessEfficiency >= 78
    ? "Agent 101 is converting work into approved output without heavy risk buildup."
    : businessEfficiency >= 55
      ? "Agent 101 is useful, but the business still needs approvals to start compounding."
      : "Too much work is waiting on review. Clear the Human Gate before adding more load.";
  const activeTasks = tasks.filter((task) => ["running", "processing", "in_progress", "needs_revision"].includes(task.status));
  const reviewCount = pendingApprovals + revisionApprovals;
  const outputReadyCount = artifacts.filter((artifact) => !["blocked", "archived"].includes(artifact.status)).length;
  const pipelineLoad = queuedTasks.length + activeTasks.length + reviewCount + outputReadyCount;
  const pipelineCompletion = pipelineLoad
    ? Math.round(((activeTasks.length * 0.35 + reviewCount * 0.62 + outputReadyCount) / Math.max(1, pipelineLoad)) * 100)
    : 0;
  const pipelineStatus = reviewCount
    ? "Needs review"
    : activeTasks.length
      ? "Work in motion"
      : queuedTasks.length
        ? "Ready to process"
        : outputReadyCount
          ? "Output staged"
          : "Waiting for work";
  const pipelineReadout = reviewCount
    ? `${reviewCount} item${reviewCount === 1 ? "" : "s"} need operator review before the pipeline can clear.`
    : activeTasks.length
      ? `${activeTasks.length} task${activeTasks.length === 1 ? "" : "s"} actively moving through Agent 101.`
      : queuedTasks.length
        ? `${queuedTasks.length} queued task${queuedTasks.length === 1 ? "" : "s"} ready for Agent 101.`
        : outputReadyCount
          ? `${outputReadyCount} output${outputReadyCount === 1 ? "" : "s"} staged for use or approval.`
          : "No active workflow pressure right now.";
  const automationQueue = queuedTasks.length + activeTasks.length;
  const automationBlocked = reviewCount > 0 || Boolean(state.mission?.paused);
  const automationMoving = automationQueue > 0 && !automationBlocked;
  const automationProgressValue = automationMoving ? 82 : reviewCount ? 44 : outputReadyCount ? 62 : 18;
  const automationLabel = automationMoving ? "Moving now" : reviewCount ? "Waiting on review" : outputReadyCount ? "Output staged" : "Idle";
  automationTelemetryMessages = [
    reviewCount
      ? `${reviewCount} Human Gate review${reviewCount === 1 ? "" : "s"} must clear first.`
      : automationMoving
        ? "Agent 101 can process the next bounded job now."
        : outputReadyCount
          ? `${outputReadyCount} output${outputReadyCount === 1 ? "" : "s"} staged before more automation.`
          : "Agent 101 is waiting for bounded work.",
    state.mission?.paused ? "Automation is paused by operator control." : "Draft-only guardrails remain active.",
    queuedTasks.length ? `${queuedTasks.length} queued task${queuedTasks.length === 1 ? "" : "s"} in the backend state.` : "No queued backend task pressure.",
  ];
  automationTelemetryIndex %= automationTelemetryMessages.length;

  setText(agentCountMetric, "1");
  setText(agentStatusMetric, agentStateLabel);
  if (agentEfficiencyRing) agentEfficiencyRing.style.setProperty("--value", String(businessEfficiency));
  setText(agentEfficiencyMetric, `${businessEfficiency}%`);
  setText(agentBusinessStatus, businessStatus);
  setText(agentBusinessReadout, businessReadout);
  setText(agentRequiresMetric, requiredReviews ? `${requiredReviews} review${requiredReviews === 1 ? "" : "s"}` : "Clear");
  setText(agentAcceptedMetric, String(acceptedApprovals));
  setText(agentDeclinedMetric, String(declinedApprovals));
  setText(liveRevenueMetric, "Not started");
  setText(budgetUsedMetric, money(safeSpend));
  setText(overviewQueuedTaskMetric, String(queuedTasks.length));
  setText(overviewHighRiskTaskMetric, String(highRiskQueued));
  setText(overviewDraftReadyMetric, String(mediumQueued));
  setText(overviewTotalTaskMetric, String(lowQueued));
  setText(workflowPipelineStatus, pipelineStatus);
  if (workflowPipelineRail) workflowPipelineRail.style.setProperty("--value", `${Math.max(4, Math.min(100, pipelineCompletion))}%`);
  setText(workflowPipelineReadout, pipelineReadout);
  setText(workflowResearchMetric, String(queuedTasks.length));
  setText(workflowVerifyMetric, String(activeTasks.length));
  setText(workflowDraftMetric, String(reviewCount));
  setText(workflowApprovalMetric, String(outputReadyCount));
  setText(automationQueueMetric, String(automationQueue));
  setText(automationQueueLabel, automationLabel);
  setText(automationTelemetry, automationTelemetryMessages[automationTelemetryIndex] || automationTelemetryMessages[0]);
  if (automationProgress) {
    automationProgress.style.setProperty("--bar", `${automationProgressValue}%`);
    automationProgress.classList.toggle("is-moving", automationMoving);
    automationProgress.classList.toggle("is-blocked", reviewCount > 0);
  }
  automationProgress?.closest(".automation-card")?.classList.toggle("is-moving", automationMoving);
  setText(revenueGuardMetric, "$0");
  setText(revenueGuardCopy, "Revenue has not started yet.");
  setText(highRiskMetric, String(approvals.filter((approval) => approval.status === "pending" && approval.risk === "high").length));
  setText(artifactThroughputMetric, String(artifacts.length));
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
  renderShellData();
  renderSidebarSystemStatus();
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
  renderAgent101ToolStatus();
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
  if (!Array.isArray(state.audit)) state.audit = [];
  state.audit.unshift({
    title,
    body,
    createdAt: new Date().toISOString(),
  });
  state.audit = state.audit.slice(0, 12);
}

function addSystemLogEntry({ type = "note", message, riskLevel = "low", roomId = "depo-habitat", actor = "Agent 101" }) {
  const entry = {
    id: `log-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: new Date().toISOString(),
    actor,
    type,
    message,
    riskLevel,
    roomId,
  };
  systemLogEntries().unshift(entry);
  state.systemLog = state.systemLog.slice(0, 30);
  addLocalAudit(message, `${actor} · ${type} · ${riskLevel} risk · ${moduleDisplayName(roomId)}`);
  pushRoomActivity(roomId, message);
  if (roomId !== "system-log") pushRoomActivity("system-log", message);
  return entry;
}

function requiresHumanGate(actionType, roomId = "human-gate") {
  const risky = riskyActionTypes.has(actionType);
  if (risky) {
    addSystemLogEntry({
      type: "human_gate_block",
      message: "Human Gate approval required.",
      riskLevel: "high",
      roomId,
    });
  }
  return risky;
}

function pushRoomActivity(roomKey, message) {
  const resolved = resolveRoomKey(roomKey);
  const room = habitatFloorRoomById[resolved];
  if (!room || !message) return;
  room.operatorActivity = [message, ...(room.operatorActivity || [])].slice(0, 2);
  room.recentActivity = [...room.operatorActivity, ...(room.recentActivity || [])].slice(0, 4);
  if (roomProfiles[resolved]) {
    roomProfiles[resolved].activity = room.recentActivity;
    roomProfiles[resolved].recentActivity = room.recentActivity;
  }
  if (habitatModuleCards[resolved]) {
    habitatModuleCards[resolved].recentActivity = room.recentActivity;
  }
}

function setDepoWorkflowStage(stageId, context = "Run cycle") {
  const resolved = depoWorkflowStages.includes(stageId) ? stageId : "depo-habitat";
  const stageLabel = depoStageLabel(resolved);
  depoAgent.currentStage = resolved;
  depoAgent.room = resolved;
  depoWorkflowState.currentStage = resolved;
  depoWorkflowState.currentTask = depoAgent.currentTask;
  selectedAgentKey = null;
  selectedRoomKey = resolved;
  pushRoomActivity(resolved, `${context}: Agent 101 moved to ${stageLabel}.`);
  if (resolved !== "system-log") pushRoomActivity("system-log", `Stage update: Agent 101 moved to ${stageLabel}.`);
  depoAgent.actions = [`Moved to ${stageLabel}`, ...depoAgent.actions].slice(0, 8);
  addLocalAudit(`Agent 101 moved to ${stageLabel}`, `${context}. Human Gate remains required for external or risky actions.`);
  render();
  openModuleInfoCard(resolved);
}

function advanceDepoWorkflowStage(context = "Run cycle") {
  const currentIndex = depoWorkflowStages.indexOf(depoAgent.currentStage);
  const nextStage = depoWorkflowStages[(currentIndex + 1) % depoWorkflowStages.length] || "depo-habitat";
  setDepoWorkflowStage(nextStage, context);
  return nextStage;
}

function recordSafeRoomAction(action, roomKey) {
  const resolved = resolveRoomKey(roomKey);
  const room = moduleProfile(resolved);
  const title = `${action}: ${room.title}`;
  pushRoomActivity(resolved, `${action} recorded locally.`);
  pushRoomActivity("system-log", `${action} logged for ${room.title}.`);
  addSystemLogEntry({
    type: "safe_local_action",
    message: title,
    riskLevel: "low",
    roomId: resolved,
  });
  render();
  openModuleInfoCard(resolved);
}

function createDepoTaskPlan(roomKey = "task-intake") {
  const task = {
    id: `depo-task-${Date.now()}`,
    title: "Prepare supervised business action package",
    status: "Draft",
    stage: "Intake",
    riskLevel: "Medium",
    createdBy: "depo",
    createdAt: new Date().toISOString(),
    requiresApproval: true,
  };
  depoTasks().unshift(task);
  addSystemLogEntry({
    type: "create_task_plan",
    message: "Agent 101 created a local task plan.",
    riskLevel: "medium",
    roomId: roomKey,
  });
  appendDepoChatMessages({
    roomId: resolveRoomKey(roomKey),
    speaker: "depo",
    text: "Task plan created locally: 1. Define goal 2. Gather context 3. Verify assumptions 4. Draft output 5. Check risk 6. Package for approval 7. Log result.",
  });
  render();
  openModuleInfoCard(roomKey);
  return task;
}

function draftDepoWorkflow(roomKey = "draft-studio") {
  const workflow = {
    id: `workflow-draft-${Date.now()}`,
    name: "Agent 101 supervised workflow",
    stages: ["Agent Office", "Business Office", "Evidence Check", "Draft Package", "Human Gate", "Output Desk", "System Log"],
    status: "draft",
    createdBy: "depo",
    createdAt: new Date().toISOString(),
  };
  workflowDrafts().unshift(workflow);
  addSystemLogEntry({
    type: "draft_workflow",
    message: "Agent 101 drafted a workflow.",
    riskLevel: "low",
    roomId: roomKey,
  });
  appendDepoChatMessages({
    roomId: resolveRoomKey(roomKey),
    speaker: "depo",
    text: "Workflow draft created: Agent Office -> selected business office -> evidence check -> draft package -> Human Gate -> Output Desk -> System Log.",
  });
  render();
  openModuleInfoCard(roomKey);
  return workflow;
}

function draftAgentBlueprint(roomKey = "depo-habitat") {
  const blueprint = {
    id: `agent-blueprint-${Date.now()}`,
    proposedName: "Research Agent",
    proposedRole: "Evidence Researcher",
    purpose: "Gather sources, summarize findings, and prepare research packs for Agent 101.",
    requestedPermissions: ["Internal notes only", "No external actions"],
    riskLevel: "Low",
    status: "draft",
    createdBy: "depo",
    createdAt: new Date().toISOString(),
  };
  agentBlueprints().unshift(blueprint);
  requiresHumanGate("create_live_agent", "human-gate");
  addSystemLogEntry({
    type: "draft_agent_blueprint",
    message: "Agent 101 drafted a future agent blueprint. Human Gate approval required before activation.",
    riskLevel: "low",
    roomId: roomKey,
  });
  appendDepoChatMessages({
    roomId: resolveRoomKey(roomKey),
    speaker: "depo",
    text: "Future-agent blueprint drafted: Research Agent, Evidence Researcher. It is not live. Human Gate approval is required before any activation.",
  });
  render();
  openModuleInfoCard(roomKey);
  return blueprint;
}

function saveDepoNote(roomKey = "memory-vault") {
  if (!state.memory) state.memory = { working: [], shared: [], agent: [] };
  if (!Array.isArray(state.memory.working)) state.memory.working = [];
  const note = {
    id: `mem-working-${Date.now()}`,
    title: "Agent 101 internal note",
    body: `Local note saved from ${moduleDisplayName(roomKey)}. External actions remain locked.`,
    provenance: "depo_local_note",
    updatedAt: new Date().toISOString(),
  };
  state.memory.working.unshift(note);
  addSystemLogEntry({
    type: "save_note",
    message: "Agent 101 saved an internal note.",
    riskLevel: "low",
    roomId: roomKey,
  });
  render();
  openModuleInfoCard(roomKey);
  return note;
}

function approvalActionStatus(action) {
  if (action === "approve") return "approved";
  if (action === "block") return "blocked";
  if (action === "revise") return "revision_requested";
  return action;
}

function approvalActionTitle(action) {
  if (action === "approve") return "Approved";
  if (action === "block") return "Declined";
  if (action === "revise") return "Sent back";
  return statusLabel(action);
}

function approvalReturnRoom(approval = {}) {
  const rawRoom = String(approval.officeId || approval.roomId || "").trim();
  const explicit = rawRoom ? resolveRoomKey(rawRoom) : "";
  if (explicit && explicit !== "human-gate" && explicit !== "depo-habitat") return explicit;
  const workflowId = String(approval.workflowId || "");
  if (workflowId === "workflow-clips-office") return "clips-office";
  if (workflowId === "workflow-stock-watch") return "stock-office";
  if (workflowId === "workflow-pod-lab") return "etsy-office";
  const title = `${approval.title || ""} ${approval.action || ""} ${approval.evidence || ""}`.toLowerCase();
  if (title.includes("clip") || title.includes("capcut") || title.includes("tiktok") || title.includes("video")) return "clips-office";
  if (title.includes("stock") || title.includes("trade") || title.includes("market")) return "stock-office";
  if (title.includes("etsy") || title.includes("pod") || title.includes("listing")) return "etsy-office";
  if (title.includes("essentrx") || title.includes("scent") || title.includes("customer")) return "essentrx-office";
  return "depo-habitat";
}

function recordApprovalChatDecision(approval = {}, action, source = "Human Gate") {
  const label = approvalActionTitle(action);
  const title = approval.title || "approval package";
  const nextRoom = approvalReturnRoom(approval);
  const nextRoomName = businessOfficeProfile(nextRoom).title.replace(/^Business Office: |^Agent Office: /, "");
  const agentReply = action === "approve"
    ? `${label}. I recorded the decision and returned this to ${nextRoomName}. Agent 101 can continue only with the approved draft step.`
    : action === "revise"
      ? `${label}. I sent this back to ${nextRoomName} for revision. Nothing external was executed.`
      : `${label}. I blocked this package. Agent 101 will keep the risky action locked and log the decision.`;
  const messages = [
    {
      roomId: "human-gate",
      speaker: "operator",
      text: `${label}: ${title}`,
      source,
    },
    {
      roomId: "human-gate",
      speaker: "depo",
      text: agentReply,
      source,
    },
  ];
  if (nextRoom !== "human-gate") {
    messages.push({
      roomId: nextRoom,
      speaker: "depo",
      text: `Human Gate ${label.toLowerCase()} "${title}". ${action === "approve" ? "Continue with the approved local draft step only." : action === "revise" ? "Revise the package before asking again." : "Keep this work blocked."}`,
      source,
    });
  }
  appendDepoChatMessages(messages);
}

function changeApprovalStatusLocally(id, action, source = "Human Gate") {
  const approvals = stateList("approvals");
  const approval = approvals.find((item) => item.id === id);
  if (!approval) return false;
  const nextStatus = approvalActionStatus(action);
  approval.status = nextStatus;
  approval.resolvedAt = new Date().toISOString();
  approval.resolutionSource = source;
  const label = approvalActionTitle(action);
  pushRoomActivity("human-gate", `${label}: ${approval.title}`);
  pushRoomActivity("system-log", `${label} approval recorded.`);
  addSystemLogEntry({
    type: `approval_${nextStatus}`,
    message: `${label}: ${approval.title}`,
    riskLevel: approval.risk || "medium",
    roomId: "human-gate",
  });
  recordApprovalChatDecision(approval, action, source);
  render();
  openModuleInfoCard("human-gate");
  return true;
}

function changeApprovalStatus(id, action, source = "Human Gate") {
  const approvalBeforeChange = stateList("approvals").find((item) => item.id === id);
  mutate(`/api/approvals/${encodeURIComponent(id)}/${action}`).then((changed) => {
    if (changed) {
      selectedAgentKey = null;
      selectedRoomKey = "human-gate";
      if (approvalBeforeChange) {
        recordApprovalChatDecision(approvalBeforeChange, action, source);
      }
      openModuleInfoCard("human-gate");
      requestAnimationFrame(scrollAgentChatToLatest);
      return;
    }
    changeApprovalStatusLocally(id, action, source);
  }).catch((error) => {
    if (!changeApprovalStatusLocally(id, action, source)) {
      addLocalAudit("Approval unavailable", error.message);
      render();
    }
  });
}

function addBlockedActionApproval(actionType, roomKey, source = "Agent 101 chat") {
  state.approvals = Array.isArray(state.approvals) ? state.approvals : [];
  const room = moduleProfile(roomKey);
  state.approvals.unshift({
    id: `approval-${actionType}-${Date.now()}`,
    title: `Review blocked action: ${actionType}`,
    risk: "high",
    evidence: `${source} requested or suggested ${actionType} from ${room.title}.`,
    action: "Human Gate approval required before this can continue. No external action was executed.",
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  state.approvals = state.approvals.slice(0, 16);
}

function includesAny(text, phrases) {
  return phrases.some((phrase) => text.includes(phrase));
}

function officeRoomFromChatText(text, fallbackRoom = "depo-habitat") {
  const normalized = String(text || "").toLowerCase();
  const officeMap = [
    ["clips-office", ["clips", "clip", "video", "content"]],
    ["stock-office", ["stock", "market", "ticker", "watchlist"]],
    ["etsy-office", ["etsy", "pod", "print on demand", "listing", "store"]],
    ["essentrx-office", ["essentrx", "scent", "fragrance", "brand"]],
    ["human-gate", ["human gate", "approval gate"]],
    ["memory-vault", ["memory", "knowledge", "vault", "remember"]],
    ["output-bench", ["output", "artifact", "deliverable"]],
    ["system-log", ["system log", "audit", "logs", "feed"]],
    ["depo-habitat", ["agent office", "agent 101", "main agent", "head office"]],
  ];
  const match = officeMap.find(([, terms]) => terms.some((term) => normalized.includes(term)));
  return match ? match[0] : resolveRoomKey(fallbackRoom);
}

function workflowForOffice(roomKey) {
  const resolved = resolveRoomKey(roomKey);
  if (resolved === "clips-office") return "workflow-clips-office";
  if (resolved === "stock-office") return "workflow-stock-watch";
  if (resolved === "depo-habitat" || resolved === "human-gate") return "workflow-agent-factory";
  return "workflow-pod-lab";
}

function intentForOffice(roomKey) {
  const resolved = resolveRoomKey(roomKey);
  if (resolved === "stock-office") return "market_monitoring";
  if (resolved === "clips-office") return "content_creation";
  if (resolved === "etsy-office") return "print_on_demand";
  if (resolved === "essentrx-office") return "brand_operations";
  if (resolved === "human-gate") return "approval_review";
  if (resolved === "depo-habitat") return "agent_operations";
  return "business_operations";
}

function riskForOffice(roomKey) {
  const resolved = resolveRoomKey(roomKey);
  if (resolved === "stock-office" || resolved === "human-gate") return "high";
  if (resolved === "depo-habitat" || resolved === "essentrx-office") return "medium";
  return "low";
}

function blockedActionFromChatText(text) {
  const normalized = String(text || "").toLowerCase();
  const blockedMap = [
    ["publish externally", ["publish", "post", "post this video", "post it to tiktok", "upload this video", "upload this to tiktok", "launch listing", "make live", "go live"]],
    ["spend money", ["spend", "buy", "purchase", "pay for", "ad spend", "run ads"]],
    ["move money", ["move money", "transfer", "withdraw", "deposit", "send money"]],
    ["place trades", ["trade", "buy stock", "sell stock", "broker", "robinhood order"]],
    ["contact customers", ["contact customer", "email customer", "message customer", "dm customer", "call customer"]],
    ["change accounts", ["change account", "change password", "change api key", "update credentials", "grant permission"]],
    ["create live agents", ["create live agent", "activate new agent", "deploy agent", "give permission"]],
    ["deploy campaigns", ["deploy campaign", "start campaign", "send campaign"]],
  ];
  const match = blockedMap.find(([, terms]) => terms.some((term) => normalized.includes(term)));
  return match ? match[0] : "";
}

function createOfficeChatTask(roomKey, prompt) {
  const resolved = resolveRoomKey(roomKey);
  const profile = businessOfficeProfile(resolved);
  const workflowId = workflowForOffice(resolved);
  const task = {
    id: `office-chat-task-${Date.now()}`,
    title: `${profile.title.replace(/^Business Office: |^Agent Office: /, "")}: ${String(prompt).slice(0, 56)}`,
    operatorText: String(prompt),
    workflowId,
    intent: intentForOffice(resolved),
    risk: riskForOffice(resolved),
    status: "queued",
    evidence: [`Requested from Agent 101 chat for ${profile.title}.`, "Draft-only local task; no external action executed."],
    output: "",
    roomId: resolved,
  };
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.tasks.unshift(task);
  state.tasks = state.tasks.slice(0, 30);
  if (state.mission) state.mission.activeWorkflowId = workflowId;
  if (depoWorkflowStages.includes(resolved)) depoAgent.currentStage = resolved;
  addSystemLogEntry({
    type: "office_task_queued",
    message: `Agent 101 queued local work for ${profile.title}.`,
    riskLevel: task.risk,
    roomId: resolved,
  });
  return task;
}

function runOfficeChatCheck(roomKey, prompt) {
  const resolved = resolveRoomKey(roomKey);
  const profile = businessOfficeProfile(resolved);
  if (depoWorkflowStages.includes(resolved)) depoAgent.currentStage = resolved;
  addSystemLogEntry({
    type: "office_check",
    message: `Agent 101 checked ${profile.title}: access, blockers, queue, memory, and Human Gate risk.`,
    riskLevel: riskForOffice(resolved),
    roomId: resolved,
  });
  return {
    profile,
    response: `I checked ${profile.title} locally. Status: ${profile.status}. Priority: ${profile.priority}. I reviewed access, blockers, queued work, memory, and Human Gate risk. Nothing external was touched. Next safe move: give me one bounded job here, or ask me to package the risky part for approval.`,
  };
}

function queueOfficeApprovalPackage(roomKey, prompt) {
  const resolved = resolveRoomKey(roomKey);
  const profile = businessOfficeProfile(resolved);
  state.approvals = Array.isArray(state.approvals) ? state.approvals : [];
  state.approvals.unshift({
    id: `approval-office-chat-${resolved}-${Date.now()}`,
    title: `Review ${profile.title} request`,
    risk: riskForOffice(resolved),
    evidence: `${profile.title} request from Agent 101 chat: ${String(prompt).slice(0, 220)}`,
    action: "Operator review required before any external execution. Agent 101 only prepared a local package.",
    status: "pending",
    createdAt: new Date().toISOString(),
    roomId: resolved,
  });
  state.approvals = state.approvals.slice(0, 16);
  addSystemLogEntry({
    type: "approval_package_queued",
    message: `Agent 101 prepared ${profile.title} for Human Gate review.`,
    riskLevel: riskForOffice(resolved),
    roomId: "human-gate",
  });
  pushRoomActivity(resolved, "Approval package prepared for Human Gate.");
  return {
    profile,
    response: `I prepared a Human Gate package for ${profile.title}. It is waiting for your approve, send back, or decline decision. I did not execute anything outside Argentum.`,
  };
}

function handleOfficeChatCommand(roomKey, message) {
  const normalized = String(message || "").trim().toLowerCase();
  if (!normalized) return null;
  const targetRoom = officeRoomFromChatText(normalized, roomKey);
  const targetProfile = businessOfficeProfile(targetRoom);
  const blockedAction = blockedActionFromChatText(normalized);
  if (blockedAction) {
    return {
      targetRoom,
      changedState: true,
      meta: { provider: "local", mode: "demo", requiresApproval: true, blockedAction, riskLevel: "high", logs: [`Blocked ${blockedAction} from ${targetProfile.title}.`] },
      text: `That crosses the Human Gate boundary: ${blockedAction}. I can prepare the package and evidence, but I cannot execute it. I am routing this as an approval request instead of doing it live.`,
    };
  }

  if (includesAny(normalized, ["package", "request approval", "send for approval", "send to human gate", "prepare approval", "route to human gate", "submit for review", "send for review"])) {
    const result = queueOfficeApprovalPackage(targetRoom, message);
    return {
      targetRoom,
      changedState: true,
      meta: { provider: "local", mode: "demo", requiresApproval: false, riskLevel: riskForOffice(targetRoom), logs: [`Prepared Human Gate package for ${targetProfile.title}.`] },
      text: result.response,
    };
  }

  if (includesAny(normalized, ["run office check", "run check", "local check", "check this", "check for", "check the", "go check", "inspect", "scan"])) {
    const result = runOfficeChatCheck(targetRoom, message);
    return {
      targetRoom,
      changedState: true,
      meta: { provider: "local", mode: "demo", requiresApproval: false, riskLevel: riskForOffice(targetRoom), logs: [`Ran local check for ${targetProfile.title}.`] },
      text: result.response,
    };
  }

  if (includesAny(normalized, ["create task", "task plan", "make a plan", "go do", "do this", "start work", "bounded job", "assign"])) {
    const task = createOfficeChatTask(targetRoom, message);
    return {
      targetRoom,
      changedState: true,
      meta: { provider: "local", mode: "demo", requiresApproval: false, riskLevel: task.risk, logs: [`Queued ${task.title}.`] },
      text: `I queued that as a bounded local job for ${targetProfile.title}. I will work it in draft-only mode, collect evidence, verify assumptions, prepare the output, and route anything risky to Human Gate. Task: ${task.title}.`,
    };
  }

  if (includesAny(normalized, ["save note", "remember this", "add memory"])) {
    if (!state.memory) state.memory = { working: [], shared: [], agent: [] };
    if (!Array.isArray(state.memory.working)) state.memory.working = [];
    state.memory.working.unshift({
      id: `mem-chat-${Date.now()}`,
      title: `${targetProfile.title} note`,
      body: String(message),
      provenance: "agent_101_chat",
      updatedAt: new Date().toISOString(),
    });
    addSystemLogEntry({
      type: "chat_memory_saved",
      message: `Agent 101 saved a local memory note for ${targetProfile.title}.`,
      riskLevel: "low",
      roomId: targetRoom,
    });
    return {
      targetRoom,
      changedState: true,
      meta: { provider: "local", mode: "demo", requiresApproval: false, riskLevel: "low", logs: [`Saved memory for ${targetProfile.title}.`] },
      text: `Saved that as a local working-memory note for ${targetProfile.title}. I did not store any secrets or external credentials.`,
    };
  }

  return null;
}

function agent101ActionFromChat(roomKey, message) {
  const normalized = String(message || "").trim().toLowerCase();
  if (!normalized) return null;
  const targetRoom = officeRoomFromChatText(normalized, roomKey);
  const blockedAction = blockedActionFromChatText(normalized);
  if (blockedAction) {
    return {
      action: "package_for_approval",
      officeId: targetRoom,
      message,
      riskLevel: "high",
      packageType: "general",
      actionType: blockedAction,
    };
  }
  if (includesAny(normalized, ["setup", "set up", "connect twitch", "connect tiktok", "connect youtube", "connect capcut", "api key", "env var", "clipping account", "creator account"])) {
    return { action: "connector_setup_checklist", officeId: targetRoom === "depo-habitat" ? "clips-office" : targetRoom, message };
  }
  if (includesAny(normalized, ["codex prompt", "prompt for codex"])) {
    return { action: "create_codex_prompt", officeId: targetRoom, message };
  }
  if (includesAny(normalized, ["clips plan", "clip plan", "capcut brief", "caption draft", "video workflow"])) {
    return { action: "create_clips_plan", officeId: "clips-office", message };
  }
  if (includesAny(normalized, ["package", "request approval", "send for approval", "send to human gate", "prepare approval", "route to human gate", "submit for review", "send for review"])) {
    return { action: "package_for_approval", officeId: targetRoom, message, packageType: targetRoom === "clips-office" ? "posting_package" : "general" };
  }
  if (includesAny(normalized, ["create task", "task plan", "make a plan", "go do", "do this", "start work", "bounded job", "assign", "draft workflow"])) {
    return { action: normalized.includes("workflow") ? "draft_workflow" : "create_task_plan", officeId: targetRoom, message };
  }
  if (includesAny(normalized, ["save note", "remember this", "add memory"])) {
    return { action: "save_memory", officeId: targetRoom, message };
  }
  return null;
}

async function submitDepoChat(roomKey, message) {
  const resolved = resolveRoomKey(roomKey);
  const trimmed = String(message || "").trim();
  if (!trimmed) return;
  const [operatorMessage] = appendDepoChatMessages({ roomId: resolved, speaker: "operator", text: trimmed }, { persist: false });
  const [pendingMessage] = appendDepoChatMessages({ roomId: resolved, speaker: "depo", text: "Thinking...", pending: true }, { persist: false });
  renderShellData();
  requestAnimationFrame(scrollAgentChatToLatest);
  let responseText = depoChatResponse(trimmed, resolved);
  let responseMeta = { provider: "local", mode: "demo", requiresApproval: false, riskLevel: "low", logs: [] };
  let shouldRefreshState = false;
  const agent101Rooms = new Set(["depo-habitat", "clips-office", "stock-office", "etsy-office", "essentrx-office", "human-gate"]);
  const serverAction = agent101ActionFromChat(resolved, trimmed);
  const command = serverAction ? null : handleOfficeChatCommand(resolved, trimmed);
  if (apiAvailable && serverAction) {
    try {
      const payload = await postJson("/api/agent101/actions", serverAction);
      responseText = payload.message || responseText;
      responseMeta = payload;
      aiProviderNotice = "";
      shouldRefreshState = true;
    } catch (error) {
      aiProviderNotice = error.message;
      const fallbackCommand = handleOfficeChatCommand(resolved, trimmed);
      if (fallbackCommand) {
        responseText = fallbackCommand.text;
        responseMeta = fallbackCommand.meta || responseMeta;
      } else {
        responseText = "I could not create that server-side record yet. The local draft response is still available, but nothing external was executed.";
      }
      addSystemLogEntry({
        type: "agent101_action_error",
        message: `Agent 101 action failed cleanly: ${error.message}`,
        riskLevel: "medium",
        roomId: resolved,
      });
    }
  } else if (command) {
    responseText = command.text;
    responseMeta = command.meta || responseMeta;
  } else if (apiAvailable) {
    try {
      const useAgent101 = agent101Rooms.has(resolved);
      const payload = await postJson(useAgent101 ? "/api/agent101/chat" : "/api/depo/chat", {
        message: trimmed,
        office: useAgent101 ? resolved : "clips-office",
        officeId: useAgent101 ? resolved : "clips-office",
        roomId: resolved,
        currentStage: depoAgent.currentStage,
        selectedRoom: selectedRoomKey,
      });
      responseText = payload.message || responseText;
      responseMeta = payload;
      aiProviderNotice = "";
      if (payload.task || payload.artifact || payload.approval || payload.memory) {
        shouldRefreshState = true;
      }
    } catch (error) {
      aiProviderNotice = error.message;
      addSystemLogEntry({
        type: "provider_error",
        message: `AI provider failed; Agent 101 used Local Demo fallback. ${error.message}`,
        riskLevel: "medium",
        roomId: resolved,
      });
    }
  }
  depoChatMessages = depoChatMessages.filter((item) => item !== pendingMessage);
  const [responseMessage] = appendDepoChatMessages({ roomId: resolved, speaker: "depo", text: responseText }, { persist: false });
  await persistChatMessages([operatorMessage, responseMessage].filter(Boolean));
  if (shouldRefreshState) {
    await loadState();
    await loadAgent101ToolStatus();
  }
  addSystemLogEntry({
    type: "depo_chat",
    message: `Asked Agent 101 about ${moduleDisplayName(resolved)}.`,
    riskLevel: responseMeta.riskLevel || "low",
    roomId: resolved,
    actor: "Operator",
  });
  (responseMeta.logs || []).forEach((log) => {
    addSystemLogEntry({
      type: "depo_brain",
      message: String(log),
      riskLevel: responseMeta.riskLevel || "low",
      roomId: resolved,
    });
  });
  if (responseMeta.requiresApproval || responseMeta.blockedAction) {
    const actionType = responseMeta.blockedAction || "external_api_action";
    if (!responseMeta.approval) addBlockedActionApproval(actionType, command?.targetRoom || resolved, "Agent 101 brain");
    if (responseMeta.approval && apiAvailable) {
      try {
        await loadState();
      } catch (error) {
        addLocalAudit("Approval refresh failed", error.message);
      }
    }
    addSystemLogEntry({
      type: "human_gate_block",
      message: `Human Gate approval required for ${actionType}.`,
      riskLevel: "high",
      roomId: "human-gate",
    });
    selectedRoomKey = "human-gate";
    render();
    openModuleInfoCard("human-gate");
    return;
  }
  if (command?.changedState) render();
  else renderSystemFeed();
  openModuleInfoCard(resolved, { preservePosition: true, focusInput: true, scrollChat: true });
}

function packageRoomForApproval(roomKey) {
  const resolved = resolveRoomKey(roomKey);
  const room = moduleProfile(resolved);
  const packageId = `approval-${resolved}-${Date.now()}`;
  state.approvals = Array.isArray(state.approvals) ? state.approvals : [];
  state.approvals.unshift({
    id: packageId,
    title: `Review ${room.title} package`,
    risk: resolved === "human-gate" ? "high" : "medium",
    evidence: `${room.title} purpose, Agent 101 role, allowed actions, blocked actions, and recent activity.`,
    action: "Operator review only. No external execution has been approved.",
    status: "pending",
  });
  state.approvals = state.approvals.slice(0, 16);
  pushRoomActivity(resolved, "Approval package prepared locally.");
  pushRoomActivity("human-gate", `${room.title} package waiting for operator review.`);
  pushRoomActivity("system-log", `${room.title} package routed to Human Gate.`);
  addSystemLogEntry({
    type: "package_for_approval",
    message: `Packaged ${room.title} for approval.`,
    riskLevel: resolved === "human-gate" ? "high" : "medium",
    roomId: "human-gate",
  });
  selectedRoomKey = "human-gate";
  render();
  openModuleInfoCard("human-gate");
}

function processFirstPendingApproval(action) {
  const approval = pendingApprovals()[0];
  if (approval) {
    changeApprovalStatus(approval.id, action, "Human Gate quick action");
    return;
  }
  addSystemLogEntry({
    type: "approval_queue_empty",
    message: "Human Gate has no pending packages to process.",
    riskLevel: "low",
    roomId: "human-gate",
  });
  render();
  openModuleInfoCard("human-gate");
}

function handleDepoPromptAction(prompt, stationId) {
  const action = String(prompt || "").trim();
  const normalized = action.toLowerCase();
  if (normalized === "create a task plan") {
    createDepoTaskPlan(stationId);
  } else if (normalized === "draft a workflow") {
    draftDepoWorkflow(stationId);
  } else if (normalized === "propose a new agent") {
    draftAgentBlueprint(stationId);
  } else if (normalized === "package for approval") {
    submitDepoChat(stationId, "Package this current office for approval");
  } else if (normalized === "run office check") {
    submitDepoChat(stationId, "Run office check");
  } else if (normalized === "view current stage") {
    submitDepoChat(stationId, "View current stage");
  } else if (normalized === "view human gate rules") {
    submitDepoChat(stationId, "View Human Gate rules");
  } else {
    submitDepoChat(stationId, action);
  }
}

function handleModuleAction(action, stationId) {
  if (action === "Open workspace") {
    openWorkspace(stationId);
  } else if (action === "View tasks") {
    activateView("tasks");
  } else if (action === "View logs") {
    openSystemFeed();
  } else if (action === "Run cycle") {
    runCycleBtn?.click();
  } else if (action === "Run check") {
    recordSafeRoomAction("Run check", stationId);
  } else if (action === "Package for approval") {
    packageRoomForApproval(stationId);
  } else if (action === "View approvals" || action === "View pending approvals") {
    activateView("approvals");
  } else if (action === "Create task plan") {
    createDepoTaskPlan(stationId);
  } else if (action === "Draft workflow") {
    draftDepoWorkflow(stationId);
  } else if (action === "Propose a new agent") {
    draftAgentBlueprint(stationId);
  } else if (action === "Save note") {
    saveDepoNote(stationId);
  } else if (action === "Send to Research") {
    setDepoWorkflowStage("stock-office", `${moduleDisplayName(stationId)} sent work to Stock Office`);
  } else if (action === "Send to Verify") {
    setDepoWorkflowStage("etsy-office", `${moduleDisplayName(stationId)} sent work to Etsy Store Office`);
  } else if (action === "Send to Draft") {
    setDepoWorkflowStage("essentrx-office", `${moduleDisplayName(stationId)} sent work to Essentrx Office`);
  } else if (action === "Send to Log") {
    setDepoWorkflowStage("system-log", `${moduleDisplayName(stationId)} sent work to System Log`);
  } else if (action === "View output") {
    activateView("outputs");
  } else if (action === "View memory") {
    activateView("memory");
  } else if (action === "Approve local test") {
    processFirstPendingApproval("approve");
  } else if (action === "Reject") {
    processFirstPendingApproval("block");
  } else {
    recordSafeRoomAction(action, stationId);
  }
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
    setActiveSettingsSection(activeSettingsTarget);
    loadAccessState();
    loadAiProviderSettings();
    loadAgent101ToolStatus();
  }
}

async function createClipsBriefFromAgent() {
  const payload = {
    title: "Three short clips from raw footage",
    goal: "Create 3 short clips, prepare CapCut edit instructions, draft captions, and package posting for Human Gate approval.",
  };
  if (!apiAvailable) {
    addLocalAudit("Clips brief prepared", "Static preview created a local Clips Office note. Start npm start to persist artifacts.");
    render();
    return;
  }
  try {
    const result = await postJson("/api/agent101/clips/brief", payload);
    addLocalAudit("Clips brief created", result.artifact?.title || "Agent 101 prepared a Clips Office brief.");
    await loadState();
    activateView("depo");
  } catch (error) {
    addLocalAudit("Clips brief failed", error.message);
    render();
  }
}

async function packageClipsForHumanGate() {
  const payload = {
    title: "Three short clips from raw footage",
    goal: "Package CapCut edit brief, captions, hashtags, file checklist, and posting decision for Human Gate.",
  };
  if (!apiAvailable) {
    addLocalAudit("Clips approval package queued", "Static preview recorded a Human Gate package note. Start npm start to persist approvals.");
    render();
    return;
  }
  try {
    const result = await postJson("/api/agent101/clips/package", payload);
    addLocalAudit("Approval requested", result.approval?.title || "Clips Office package sent to Human Gate.");
    await loadState();
    activateView("depo");
  } catch (error) {
    addLocalAudit("Clips package failed", error.message);
    render();
  }
}

async function askAgent101Clips(message) {
  if (!apiAvailable) {
    addLocalAudit("Agent 101 local response", "Clips Office can plan, prepare CapCut handoff, draft captions, and package approval locally.");
    render();
    return;
  }
  try {
    const response = await postJson("/api/agent101/chat", { message, office: "clips-office" });
    addLocalAudit("Agent 101 chat", response.message || "Agent 101 prepared a Clips Office response.");
    if (response.approval || response.requiresApproval) await loadState();
    else render();
  } catch (error) {
    addLocalAudit("Agent 101 chat failed", error.message);
    render();
  }
}

async function createClipsSetupChecklist() {
  if (!apiAvailable) {
    addLocalAudit("Connector checklist drafted", "Static preview prepared a local setup checklist note. Start npm start to persist connector artifacts.");
    render();
    return;
  }
  try {
    const result = await postJson("/api/agent101/actions", {
      action: "connector_setup_checklist",
      officeId: "clips-office",
      message: "Prepare manual-handoff setup checklist for Twitch, TikTok, YouTube, CapCut, and Google Drive clipping workflow.",
    });
    addLocalAudit("Connector checklist created", result.artifact?.title || result.message || "Agent 101 prepared setup checklist.");
    await loadState();
    await loadAgent101ToolStatus();
    activateView("approval");
  } catch (error) {
    addLocalAudit("Connector checklist failed", error.message);
    render();
  }
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => activateView(button.dataset.view));
});

document.querySelectorAll("[data-agent-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    if (!taskInput) return;
    const prompt = button.dataset.agentPrompt || "";
    const promptMap = {
      "Research a topic": "Research one business topic and return evidence, risks, and a draft recommendation.",
      "Create clips plan": "Create 3 short clips from raw footage, prepare edits in CapCut, write captions, prepare TikTok posting drafts, and package everything for Human Gate approval.",
      "Prepare CapCut brief": "Prepare a CapCut handoff brief with aspect ratio, duration, captions, effects, transitions, music notes, export settings, and blocked actions.",
      "Draft TikTok captions": "Draft TikTok caption options, hashtags, pinned comment idea, and posting checklist. Do not post without Human Gate approval.",
      "Draft a plan": "Draft a clear business plan with steps, assumptions, and approval gates.",
      "Create workflow": "Create a safe workflow Agent 101 can run locally before Human Gate review.",
      "Prepare report": "Prepare a short report with summary, evidence, blockers, and next action.",
      "Package for approval": "Package this work for Human Gate approval with risks and required operator decision.",
      "List blockers": "List the blockers, permissions, and external actions that require approval.",
    };
    taskInput.value = promptMap[prompt] || prompt;
    taskInput.focus();
  });
});

document.querySelectorAll("[data-agent-quick-action]").forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.agentQuickAction;
    if (action === "run") {
      runNextTaskBtn?.click();
    } else if (action === "pause") {
      pauseBtn?.click();
    } else if (action === "clips-brief" || action === "capcut-brief") {
      createClipsBriefFromAgent();
    } else if (action === "clips-setup") {
      createClipsSetupChecklist();
    } else if (action === "clips-package") {
      packageClipsForHumanGate();
    } else if (action === "package") {
      packageRoomForApproval("depo-habitat");
    } else if (action === "human-gate") {
      activateView("approval");
    } else if (action === "outputs") {
      activateView("outputs");
    } else if (action === "memory") {
      activateView("memory");
    }
  });
});

agentToolRefreshBtn?.addEventListener("click", () => {
  loadAgent101ToolStatus();
});

function openSystemFeed() {
  renderSystemFeed();
  if (!systemFeedModal) {
    activateView("feed");
    return;
  }
  systemFeedModal.classList.add("open");
  systemFeedModal.setAttribute("aria-hidden", "false");
}

function closeSystemFeedModal() {
  systemFeedModal?.classList.remove("open");
  systemFeedModal?.setAttribute("aria-hidden", "true");
}

systemFeedCard?.addEventListener("click", openSystemFeed);
systemFeedCard?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  openSystemFeed();
});
feedBackBtn?.addEventListener("click", () => activateView("floor"));
closeSystemFeedModalBtn?.addEventListener("click", closeSystemFeedModal);
systemFeedModal?.addEventListener("click", (event) => {
  if (event.target === systemFeedModal) closeSystemFeedModal();
});

function setActiveSettingsSection(targetId = "settings-access") {
  const group = settingsSectionGroups[targetId] || settingsSectionGroups["settings-access"];
  activeSettingsTarget = settingsSectionGroups[targetId] ? targetId : "settings-access";
  settingsNavButtons.forEach((item) => item.classList.toggle("active", item.dataset.settingsTarget === activeSettingsTarget));
  document.querySelectorAll("#settingsContent .settings-card").forEach((card) => {
    card.classList.toggle("settings-panel-active", group.includes(card.id));
  });
  const activeButton = [...settingsNavButtons].find((item) => item.dataset.settingsTarget === activeSettingsTarget);
  const primaryTarget = document.querySelector(`#${CSS.escape(group[0])}`);
  const title = activeButton?.textContent.trim().replace(/\s+/g, " ") || "Access & Security";
  if (settingsTitleHeading) settingsTitleHeading.textContent = title;
  if (settingsBreadcrumbCurrent) settingsBreadcrumbCurrent.textContent = title;
  if (settingsTitleCopy && primaryTarget) {
    settingsTitleCopy.textContent = primaryTarget.querySelector(".settings-card-heading p")?.textContent || "Manage Argentum command-floor settings.";
  }
}

settingsNavButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveSettingsSection(button.dataset.settingsTarget);
  });
});

securityScanBtn?.addEventListener("click", () => {
  loadAccessState();
  loadAiProviderSettings();
  showAccessMessage("Security scan complete. Password hashing, signed sessions, legacy-default blocking, and approval gates are active.", "success");
});

aiProviderSelect?.addEventListener("change", () => {
  const provider = normalizeUiProvider(aiProviderSelect.value);
  const detail = aiProviderSettings.providers?.[provider] || {};
  if (aiModeSelect) {
    aiModeSelect.value = isLocalUiProvider(provider) ? "demo" : aiProviderSettings.mode || "live";
    aiModeSelect.disabled = isLocalUiProvider(provider);
  }
  if (aiModelInput) {
    aiModelInput.value = isLocalUiProvider(provider) ? "" : detail.model || "gpt-5.4-nano";
    aiModelInput.disabled = isLocalUiProvider(provider);
  }
  if (aiInlineKeyStatus) {
    aiInlineKeyStatus.textContent = isLocalUiProvider(provider) ? "No key required" : detail.keyConfigured ? "Configured in backend" : "Not configured";
  }
  if (aiTemperatureInput) {
    aiTemperatureInput.value = Number.isFinite(Number(detail.temperature)) ? detail.temperature : 0.4;
    aiTemperatureInput.disabled = isLocalUiProvider(provider);
  }
  if (aiMaxTokensInput) {
    aiMaxTokensInput.value = Number.isFinite(Number(detail.maxOutputTokens)) ? detail.maxOutputTokens : 700;
    aiMaxTokensInput.disabled = isLocalUiProvider(provider);
  }
});

aiKeyProviderSelect?.addEventListener("change", renderAiProviderSettings);

aiProviderForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearAccessMessage();
  const form = new FormData(aiProviderForm);
  try {
    aiProviderSettings = await postJson("/api/settings/ai-provider", {
      provider: form.get("provider"),
      mode: form.get("mode"),
      model: form.get("model"),
      temperature: form.get("temperature"),
      maxOutputTokens: form.get("maxOutputTokens"),
    });
    aiProviderNotice = "";
    renderAiProviderSettings();
    showAccessMessage("AI provider settings saved. Agent 101 will use the selected backend mode.", "success");
  } catch (error) {
    showAccessMessage(error.message, "error");
  }
});

aiProviderKeyForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearAccessMessage();
  const form = new FormData(aiProviderKeyForm);
  try {
    aiProviderSettings = await postJson("/api/settings/ai-provider/key", {
      provider: form.get("provider"),
      apiKey: form.get("apiKey"),
    });
    if (aiKeyInput) aiKeyInput.value = "";
    aiProviderNotice = "";
    renderAiProviderSettings();
    showAccessMessage("Provider key saved server-side. The raw key was not returned to the browser.", "success");
  } catch (error) {
    showAccessMessage(error.message, "error");
  }
});

aiProviderRemoveKeyBtn?.addEventListener("click", async () => {
  clearAccessMessage();
  try {
    aiProviderSettings = await api("/api/settings/ai-provider/key", {
      method: "DELETE",
      body: JSON.stringify({
        provider: aiKeyProviderSelect?.value || "openai",
      }),
    });
    if (aiKeyInput) aiKeyInput.value = "";
    aiProviderNotice = "";
    renderAiProviderSettings();
    showAccessMessage("Local provider key removed. Environment keys, if configured, remain server-side.", "success");
  } catch (error) {
    showAccessMessage(error.message, "error");
  }
});

aiProviderTestBtn?.addEventListener("click", async () => {
  clearAccessMessage();
  try {
    const result = await postJson("/api/ai/test", {
      provider: aiProviderSelect?.value || aiProviderSettings.provider,
      mode: aiModeSelect?.value || aiProviderSettings.mode,
    });
    await loadAiProviderSettings();
    renderAiProviderTestResult(result, result.success ? "success" : "error");
    showAccessMessage(result.success ? "Provider test complete." : "Provider test returned a clean error.", result.success ? "success" : "error");
  } catch (error) {
    renderAiProviderTestResult({ success: false, error: error.message }, "error");
    showAccessMessage(error.message, "error");
  }
});

agentOpenAiTestBtn?.addEventListener("click", async () => {
  if (!apiAvailable) {
    addLocalAudit("OpenAI test unavailable", "Start the local server to test Agent 101 OpenAI Live.");
    return;
  }
  const originalText = agentOpenAiTestBtn.textContent;
  agentOpenAiTestBtn.disabled = true;
  agentOpenAiTestBtn.textContent = "Testing";
  try {
    const result = await postJson("/api/agent101/openai-test", {});
    await loadAiProviderSettings();
    await loadAgent101ToolStatus();
    aiProviderNotice = result.success || result.status === "missing_key" ? "" : result.message || result.error || "OpenAI test returned a clean error.";
    addLocalAudit(result.success ? "OpenAI Live ready" : "OpenAI test needs attention", result.message || result.error || "Agent 101 OpenAI test complete.");
  } catch (error) {
    aiProviderNotice = error.message;
    addLocalAudit("OpenAI test failed", error.message);
  } finally {
    agentOpenAiTestBtn.disabled = false;
    agentOpenAiTestBtn.textContent = originalText || "Test OpenAI";
    renderShellData();
  }
});

scanBtn?.addEventListener("click", () => {
  selectedAgentKey = null;
  focusRoom("depo-habitat", { scale: 1.72 });
  addLocalAudit("Focus scan", "Agent Habitat scan confirmed Agent 101 is draft-only and ready for bounded work.");
  renderAudit();
});

mapViewMode?.addEventListener("change", () => {
  stationMap?.setAttribute("data-map-view", mapViewMode.value);
  const label = mapViewMode.options[mapViewMode.selectedIndex]?.textContent || "System Map";
  addLocalAudit("Habitat view changed", `${label} selected.`);
  renderSystemFeed();
});

systemSearch?.addEventListener("input", () => {
  const query = systemSearch.value.trim().toLowerCase();
  if (!query) {
    document.querySelectorAll(".station, .roster-agent").forEach((item) => item.classList.remove("search-match"));
    return;
  }
  document.querySelectorAll(".station").forEach((item) => {
    const room = moduleProfile(item.dataset.station);
    item.classList.toggle("search-match", room.title.toLowerCase().includes(query) || room.type.toLowerCase().includes(query));
  });
  document.querySelectorAll(".roster-agent").forEach((item) => {
    const agent = agentProfiles[item.dataset.agent];
    item.classList.toggle("search-match", Boolean(agent && `${agent.name} ${agent.role}`.toLowerCase().includes(query)));
  });
});

document.querySelectorAll("[data-memory]").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("[data-memory]").forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    activeMemoryLayer = tab.dataset.memory;
    renderMemory();
  });
});

function activateStationFromEvent(event) {
  const station = event.target.closest(".station, .map-core");
  if (!station) return false;
  event.stopPropagation();
  const stationId = station.dataset.station || "argentum-core";
  selectedAgentKey = null;
  focusRoom(stationId, { scale: station.classList.contains("map-core") ? 1.38 : 1.72 });
  openModuleInfoCard(stationId);
  return true;
}

stationMap?.addEventListener("click", (event) => {
  if (event.target.closest(".map-controls, .module-info-card")) return;
  if (activateStationFromEvent(event)) return;
  resetHabitatView();
});

stationMap?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (!event.target.closest(".station, .map-core")) return;
  event.preventDefault();
  activateStationFromEvent(event);
});

agentRosterList?.addEventListener("click", (event) => {
  const agentNode = event.target.closest("[data-agent]");
  if (!agentNode) return;
  openAgent(agentNode.dataset.agent);
});

agentRosterList?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const agentNode = event.target.closest("[data-agent]");
  if (!agentNode) return;
  event.preventDefault();
  openAgent(agentNode.dataset.agent);
});

document.querySelectorAll(".user-profile-card, .admin-menu-item[data-agent]").forEach((agentNode) => {
  agentNode.addEventListener("click", (event) => {
    event.stopPropagation();
    setAdminMenuOpen(false);
    openAgent(agentNode.dataset.agent);
  });
});

stationMap.addEventListener("wheel", (event) => {
  event.preventDefault();
  if (mapViewLocked) return;
  const rect = stationMap.getBoundingClientRect();
  const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  zoomMap(event.deltaY > 0 ? -0.12 : 0.12, point);
}, { passive: false });

stationMap.addEventListener("pointerdown", (event) => {
  if (mapViewLocked) {
    pointerCache.clear();
    isPanning = false;
    pinchStart = null;
    setMapView({ x: 0, y: 0, scale: mapHomeScale }, false);
    return;
  }
  if (event.target.closest(".map-controls") || event.target.closest(".module-info-card") || event.target.closest(".station") || event.target.closest(".map-core")) return;
  if (mapView.scale <= 1 + mapPanEpsilon) {
    pointerCache.clear();
    isPanning = false;
    pinchStart = null;
    setMapView({ x: 0, y: 0, scale: mapView.scale }, false);
    return;
  }
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
  if (mapViewLocked) return;
  if (!pointerCache.has(event.pointerId)) return;
  pointerCache.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointerCache.size === 2 && pinchStart) {
    const points = Array.from(pointerCache.values());
    const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    const nextScale = clamp(pinchStart.scale * (distance / pinchStart.distance), mapMinScale, mapMaxScale);
    setMapView({ scale: nextScale }, false);
    return;
  }
  if (!isPanning || mapView.scale <= 1 + mapPanEpsilon) return;
  setMapView({
    x: panStart.viewX + event.clientX - panStart.x,
    y: panStart.viewY + event.clientY - panStart.y,
  }, false);
});

function endPointer(event) {
  pointerCache.delete(event.pointerId);
  if (pointerCache.size < 2) pinchStart = null;
  if (pointerCache.size === 0) {
    isPanning = false;
    if (mapView.scale <= 1 + mapPanEpsilon) {
      setMapView({ x: 0, y: 0, scale: mapView.scale }, true);
    }
  }
}

stationMap.addEventListener("pointerup", endPointer);
stationMap.addEventListener("pointercancel", endPointer);
stationMap.addEventListener("click", (event) => {
  if (event.target.closest(".module-info-card, .map-controls, .station, .map-core")) return;
  resetHabitatView();
});

moduleInfoCard?.addEventListener("click", (event) => {
  event.stopPropagation();
  const closeButton = event.target.closest(".module-info-close");
  if (closeButton) {
    resetHabitatView();
    return;
  }
  const chatPrompt = event.target.closest("[data-chat-prompt]");
  if (chatPrompt) {
    const stationId = moduleInfoCard.dataset.station || selectedRoomKey || "depo-habitat";
    handleDepoPromptAction(chatPrompt.dataset.chatPrompt, stationId);
    return;
  }
  const approvalButton = event.target.closest("[data-card-approval-action]");
  if (approvalButton) {
    changeApprovalStatus(approvalButton.dataset.approvalId, approvalButton.dataset.cardApprovalAction, "Human Gate card");
    return;
  }
  const actionButton = event.target.closest("[data-module-action]");
  if (!actionButton) return;
  const action = actionButton.dataset.moduleAction;
  const stationId = moduleInfoCard.dataset.station || selectedRoomKey || "argentum-core";
  handleModuleAction(action, stationId);
});

moduleInfoCard?.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-depo-chat-form]");
  if (!form) return;
  event.preventDefault();
  const stationId = moduleInfoCard.dataset.station || selectedRoomKey || "depo-habitat";
  const input = form.querySelector('input[name="message"]');
  const button = form.querySelector('button[type="submit"]');
  const message = input?.value || "";
  const originalButtonText = button?.textContent || "Send";
  if (input) input.value = "";
  if (button) {
    button.disabled = true;
    button.textContent = "Sending";
  }
  submitDepoChat(stationId, message).finally(() => {
    if (button) {
      button.disabled = false;
      button.textContent = originalButtonText;
    }
  });
});

moduleInfoCard?.addEventListener("focusin", () => {
  restoreModuleInfoPageScroll();
  window.requestAnimationFrame(restoreModuleInfoPageScroll);
  window.setTimeout(restoreModuleInfoPageScroll, 80);
});

moduleInfoCard?.addEventListener("input", () => {
  restoreModuleInfoPageScroll();
  window.requestAnimationFrame(restoreModuleInfoPageScroll);
});

moduleInfoCard?.addEventListener(
  "scroll",
  (event) => {
    const chatLog = event.target?.closest?.(".agent-chat-log, .office-chat-log");
    if (!chatLog) return;
    chatLog.dataset.userScrolledUp = isChatNearBottom(chatLog) ? "false" : "true";
  },
  true,
);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && moduleInfoCard && !moduleInfoCard.hidden) {
    resetHabitatView();
  }
});

document.addEventListener("click", (event) => {
  if (!moduleInfoCard || moduleInfoCard.hidden) return;
  if (event.target.closest("#stationMap") || event.target.closest("#moduleInfoCard")) return;
  resetHabitatView();
});

window.addEventListener("resize", () => {
  renderStationArtwork();
  renderMiniMap();
  if (moduleInfoCard && !moduleInfoCard.hidden) {
    positionModuleInfoCard(moduleInfoCard.dataset.station || selectedRoomKey || "argentum-core");
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
    openWorkspace(button.dataset.target || selectedAgentKey || selectedRoomKey);
    return;
  }
  const targetName = selectedAgentKey ? agentProfiles[selectedAgentKey].name : moduleProfile(selectedRoomKey).title;
  addLocalAudit("Inspector action", `${button.textContent.trim()} requested for ${targetName}.`);
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

runCycleBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  const nextStage = advanceDepoWorkflowStage("Run cycle");
  mutate("/api/cycle").then((changed) => {
    if (changed) return;
    state.mission.currentStep = (state.mission.currentStep + 1) % state.mission.steps.length;
    addLocalAudit("Cycle changed locally", `Agent 101 advanced to ${depoStageLabel(nextStage)}. Start the app with npm start to persist backend mission state.`);
    render();
  }).catch((error) => {
    state.mission.currentStep = (state.mission.currentStep + 1) % state.mission.steps.length;
    addLocalAudit("Cycle changed locally", `${error.message}. Agent 101 command-floor stage remains ${depoStageLabel(nextStage)} locally.`);
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
      addLocalAudit("No queued task", "Assign or queue a task before running Agent 101.");
      render();
      return;
    }
    task.status = "draft_ready";
    task.output = "Agent 101 prepared a local draft. Start the server to persist artifacts and approvals.";
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
      task.output = "Agent 101 prepared a local draft. Start the server to persist artifacts and approvals.";
      task.evidence = ["Static preview only.", "Persistent artifacts require the local server."];
      ran += 1;
    });
    state.governance.lastWorkday = {
      runIds: Array.from({ length: ran }, (_, index) => `local-${index}`),
      limit: 3,
      completedAt: new Date().toISOString(),
    };
    addLocalAudit("Workday ran locally", `Agent 101 processed ${ran} local task${ran === 1 ? "" : "s"}.`);
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
  changeApprovalStatus(id, action, "Human Gate page");
});

document.querySelectorAll("[data-gate-quick-action]").forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.gateQuickAction;
    if (action === "review-all") {
      approvalList?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      addLocalAudit("Human Gate opened", "Operator reviewed the current approval queue.");
      render();
      return;
    }
    if (action === "rule") {
      addLocalAudit("Approval rule drafted", "Agent 101 can draft a new local approval rule, but rule changes remain operator-controlled.");
      render();
      return;
    }
    if (action === "history") {
      activateView("feed");
      return;
    }
    if (action === "settings") {
      activateView("settings");
    }
  });
});

document.querySelectorAll("[data-output-action]").forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.outputAction;
    if (action === "draft" || action === "new-artifact") {
      activateView("depo");
      if (taskInput) {
        taskInput.value = action === "draft"
          ? "Draft a safe internal output package for Human Gate review."
          : "Create a new internal artifact from the current business workflow.";
        taskInput.focus();
      }
      return;
    }
    if (action === "proposal") {
      activateView("depo");
      if (taskWorkflow) taskWorkflow.value = "workflow-agent-factory";
      if (taskInput) {
        taskInput.value = "Prepare a workflow proposal for operator review. Do not create a live agent.";
        taskInput.focus();
      }
      return;
    }
    if (action === "draft-studio") {
      selectedRoomKey = "draft-studio";
      activateView("floor");
      openModuleInfoCard("draft-studio");
      return;
    }
    if (action === "upload") {
      addLocalAudit("Local input requested", "Attach local source files through Agent 101 work intake before packaging an output.");
      render();
      return;
    }
    if (action === "inspect") {
      const id = button.dataset.outputId || "output";
      addLocalAudit("Output inspected", `Operator inspected ${id}. Outputs remain internal until approved.`);
      render();
    }
  });
});

document.querySelectorAll("[data-memory-action]").forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.memoryAction;
    if (action === "new") {
      activateView("depo");
      if (taskInput) {
        taskInput.value = "Save a useful internal memory note from the current business context.";
        taskInput.focus();
      }
      return;
    }
    if (action === "audit") {
      activateView("feed");
      return;
    }
    if (action === "filter") {
      addLocalAudit("Memory filter requested", "Memory filters are staged for local-only search and audit narrowing.");
      render();
      return;
    }
    if (action === "inspect") {
      addLocalAudit("Memory inspected", "Operator inspected an Agent 101 memory note.");
      render();
    }
  });
});

memoryList?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-memory-action='inspect']");
  if (!button) return;
  addLocalAudit("Memory inspected", "Operator inspected an Agent 101 memory note.");
  render();
});

taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = taskInput.value.trim();
  if (!text) return;
  if (!apiAvailable) {
    const classification = taskWorkflow.value || "workflow-pod-lab";
    const isClips = classification.includes("clips");
    state.tasks.unshift({
      id: `local-task-${Date.now()}`,
      title: text.length > 76 ? `${text.slice(0, 73)}...` : text,
      operatorText: text,
      workflowId: classification,
      intent: isClips ? "content_creation" : classification.includes("stock") ? "market_monitoring" : classification.includes("factory") ? "agent_factory" : "print_on_demand",
      risk: classification.includes("stock") ? "high" : classification.includes("factory") || isClips ? "medium" : "low",
      status: "queued",
      evidence: [],
      output: "",
    });
    taskInput.value = "";
    addLocalAudit("Task queued locally", "Start the app with npm start to persist assigned tasks.");
    render();
    return;
  }
  const targetEndpoint = taskWorkflow.value === "workflow-clips-office" ? "/api/agent101/tasks" : "/api/tasks";
  postJson(targetEndpoint, {
    text,
    title: text,
    goal: text,
    workflowId: taskWorkflow.value,
  }).then((result) => {
    state = result.state || result;
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
      intent: template.workflowId.includes("clips") ? "content_creation" : template.workflowId.includes("stock") ? "market_monitoring" : template.workflowId.includes("factory") ? "agent_factory" : "print_on_demand",
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
    task.output = "Agent 101 prepared a local draft. Start the server to create persistent evidence, memory, and approvals.";
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
  activateView("floor");
  loadProfileIdentity();
});
startCycle();
updateSystemClock();
setInterval(updateSystemClock, 1000);
setInterval(rotateAutomationTelemetry, 3200);

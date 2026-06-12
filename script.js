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
const agentRosterList = document.querySelector("#agentRosterList");
const habitatModules = document.querySelector("#habitatModules");
const habitatRoutes = document.querySelector("#habitatRoutes");
const stationArtwork = document.querySelector("#stationArtwork");
const miniMapNodes = document.querySelector("#miniMapNodes");
const moduleInfoCard = document.querySelector("#moduleInfoCard");
const mapViewMode = document.querySelector("#mapViewMode");
const scanBtn = document.querySelector("#scanBtn");
const systemClockNodes = document.querySelectorAll("[data-system-clock]");
const systemDateNodes = document.querySelectorAll("[data-system-date]");
const systemSearch = document.querySelector("#systemSearch");

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
    id: "depo",
    name: "Depo",
    role: "Depository Operator",
    status: "Draft only",
    number: "001",
    icon: "D",
    color: "#7DD3FC",
    room: "depo-habitat",
    connectedModules: ["depo-habitat", "argentum-core"],
    currentTask: "Newborn first agent. Depo is ready to turn one bounded idea into evidence, draft output, and an approval package.",
    queue: ["Receive first bounded workflow"],
    queueCount: 1,
    permissions: ["Read/write working memory", "Draft artifacts", "Cannot publish, spend, trade, contact customers, or deploy agents"],
    riskLevel: "Medium",
    actions: ["Depo born into the habitat", "Draft-only rules loaded", "External actions remain gated"],
  },
};

const roomProfiles = {
  "argentum-core": {
    id: "argentum-core",
    title: "Argentum Core",
    name: "Argentum Core",
    type: "AI Command Core",
    status: "Online",
    metric: "Agent 001",
    icon: "AC",
    color: "#60A5FA",
    position: { x: 50, y: 43 },
    summary: "Central supervised habitat where Agent 001 lives, receives bounded work, and sends risky actions to the human gate.",
    description: "Central supervised habitat where Agent 001 lives, receives bounded work, and sends risky actions to the human gate.",
    agents: ["Depo"],
    connectedModules: ["depo-habitat"],
    connected: ["Depo Habitat"],
    tasks: ["Hold Depo's identity", "Route one bounded task", "Protect approval boundaries"],
    activity: ["Depo has entered the habitat.", "Revenue claims are cleared.", "Human-gate constraints are active."],
    metrics: [["Active agents", "1"], ["Revenue", "None yet"], ["Mode", "Supervised"]],
    workspaceType: "core",
  },
  "depo-habitat": {
    id: "depo-habitat",
    title: "Depo Habitat",
    name: "Depo Habitat",
    type: "First Agent Home",
    status: "Born",
    metric: "Agent 001",
    icon: "D",
    color: "#7DD3FC",
    position: { x: 50, y: 63 },
    labelPosition: { x: 50, y: 72 },
    summary: "The first real resident of Argentum. Depo can research, verify, draft, curate memory, and package approval-ready work.",
    description: "The first real resident of Argentum. Depo can research, verify, draft, curate memory, and package approval-ready work.",
    agents: ["Depo"],
    connectedModules: ["argentum-core"],
    connected: ["Argentum Core"],
    tasks: ["Accept one bounded workflow", "Gather evidence", "Draft for approval"],
    activity: ["Agent 001 initialized.", "Draft-only permission set loaded.", "No revenue has been claimed."],
    metrics: [["Agent", "Depo"], ["Revenue", "None yet"], ["External actions", "Locked"]],
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
    agents: ["Atlas", "Depo", "Sentry"],
    connectedModules: ["argentum-core", "ai-agents", "task-factory", "system-logs"],
    connected: ["AI Agents Room", "Task Factory", "Security Core", "Resources"],
    tasks: ["Review active agents", "Check permissions", "Open supervised workspaces"],
    activity: ["Atlas reconciled the command map.", "Depo remains draft-only.", "Sentry verified approval gates."],
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
    agents: ["Atlas", "Nexus", "Depo"],
    connectedModules: ["agent-habitat", "argentum-core", "workflow-pipeline", "security-core"],
    connected: ["Agent Habitat", "Security Core", "Workflow Pipeline"],
    tasks: ["Balance agent queues", "Route context", "Track active status"],
    activity: ["Nexus refreshed route links.", "Atlas synced agent state.", "Depo moved to Verify."],
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
    agents: ["Forge", "Nexus", "Depo"],
    connectedModules: ["commerce-terminal", "workflow-pipeline", "resources", "argentum-core"],
    connected: ["Agent Habitat", "Commerce Terminal", "Workflow Pipeline", "Resources"],
    tasks: ["Package task batch", "Prepare draft outputs", "Route risky actions to approval"],
    activity: ["Forge deployed a production batch.", "Depo packaged one approval.", "Nexus checked automation pressure."],
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
    agents: ["Oracle", "Depo"],
    connectedModules: ["task-factory", "logistics-node", "workflow-pipeline", "argentum-core"],
    connected: ["Task Factory", "Logistics Node", "Workflow Pipeline", "Revenue Monitor"],
    tasks: ["Index resources", "Label evidence freshness", "Separate private memory"],
    activity: ["Oracle scanned data inventory.", "Depo wrote provenance notes.", "Resource health remains optimal."],
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

const habitatMapModules = [
  "depo-habitat",
].map((id) => roomProfiles[id]);

const moduleRoutes = [];

const depoWorkflowState = {
  activeAgent: "Depo",
  currentTask: "Prepare supervised business action package for review.",
  currentStage: "Workflow Pipeline",
  mode: "Supervised",
  riskMode: "Approval required",
  externalActions: "Locked",
  humanGate: "Enabled",
  canDepoDo: ["Research", "Draft", "Organize", "Package for approval"],
  cannotDepoDo: ["Publish", "Spend", "Contact externally"],
};

const habitatModuleCards = {
  "argentum-core": {
    purpose: "Central supervised habitat for Argentum's first real agent.",
    status: "Supervised",
    metric: "Agent 001 online",
    depoRole: "Keeps Depo's work local, bounded, and routed through approval before any risky action.",
    connections: ["depo-habitat"],
    recentActivity: ["Depo has entered the habitat.", "Revenue counters reset to none.", "Risk gates are active."],
    riskNote: "Approval is required before any risky external action.",
    quickActions: ["Run cycle", "View system routes", "View approvals"],
  },
  "depo-habitat": {
    purpose: "Home base for the first supervised agent.",
    status: "Born",
    metric: "Agent 001",
    depoRole: "Depo lives here and starts with research, verification, drafting, and approval packaging.",
    connections: ["argentum-core"],
    recentActivity: ["Depo born into habitat.", "Draft-only rules loaded.", "First workflow waiting."],
    riskNote: "Depo can draft and organize, but cannot publish, spend, trade, contact customers, or deploy agents.",
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
  "agent-habitat": {
    purpose: "Home base for supervised agents.",
    status: "Live",
    metric: "1 active agent",
    depoRole: "Depo lives here as the only active supervised operator.",
    connections: ["argentum-core", "ai-agents", "task-factory", "system-logs"],
    recentActivity: ["Depo active.", "Agent health checked.", "No new agents created."],
    riskNote: "New agents require human approval.",
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
  "ai-agents": {
    purpose: "Agent coordination and capability management.",
    status: "Live",
    metric: "1 active agent",
    depoRole: "Depo receives instructions and sends completed drafts back for review.",
    connections: ["agent-habitat", "argentum-core", "workflow-pipeline", "security-core"],
    recentActivity: ["Depo cycle initialized.", "Permissions verified."],
    riskNote: "Agent permissions are locked.",
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
  "task-factory": {
    purpose: "Converts ideas into structured tasks.",
    status: "Active",
    metric: "197 active references / 1 queued task",
    depoRole: "Depo breaks work into research, evidence, draft, and approval steps.",
    connections: ["commerce-terminal", "workflow-pipeline", "resources", "argentum-core"],
    recentActivity: ["New task queued.", "Research lane prepared."],
    riskNote: "Tasks can be drafted, not deployed.",
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
  "commerce-terminal": {
    purpose: "Commerce/storefront planning and order logic.",
    status: "Draft only",
    metric: "Revenue not connected / mock value only",
    depoRole: "Depo can prepare commerce ideas, but cannot publish or charge customers.",
    connections: ["task-factory", "revenue-monitor", "customer-node", "workflow-pipeline"],
    recentActivity: ["Commerce draft prepared.", "No live sales action taken."],
    riskNote: "Publishing, checkout, pricing, or money movement requires approval.",
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
  "revenue-monitor": {
    purpose: "Finance, budget, revenue, and cost awareness.",
    status: "Guarded",
    metric: "Budget guard active",
    depoRole: "Depo can estimate costs and summarize revenue, but cannot move money.",
    connections: ["commerce-terminal", "resources", "argentum-core", "security-core"],
    recentActivity: ["Budget check passed.", "Expense note prepared."],
    riskNote: "Money movement is locked.",
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
  resources: {
    purpose: "Memory, files, inventory, and reusable knowledge.",
    status: "Optimal",
    metric: "12,455 items / private memory active",
    depoRole: "Depo stores notes, references, and reusable research here.",
    connections: ["task-factory", "logistics-node", "workflow-pipeline", "argentum-core"],
    recentActivity: ["Research note saved.", "Memory updated."],
    riskNote: "Sensitive data access should be logged.",
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
  "logistics-node": {
    purpose: "Routes work between stages and modules.",
    status: "Live",
    metric: "8 routes active",
    depoRole: "Depo uses this node to move drafts from research to approval.",
    connections: ["resources", "workflow-pipeline", "commerce-terminal", "customer-node"],
    recentActivity: ["Route to Workflow Pipeline active."],
    riskNote: "External delivery actions require approval.",
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
  "workflow-pipeline": {
    purpose: "Main stage tracker for Depo's supervised loop.",
    status: "Active",
    metric: "Current stage: Workflow Pipeline",
    depoRole: "Depo moves through Intake -> Research -> Verify -> Draft -> Package -> Approval.",
    connections: ["agent-habitat", "task-factory", "logistics-node", "content-engine", "system-logs"],
    recentActivity: ["Stage moved to Workflow Pipeline."],
    riskNote: "Final action must pass Human Gate.",
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
  "content-engine": {
    purpose: "Drafts outputs, concepts, listings, posts, and creative assets.",
    status: "Draft only",
    metric: "5 generating / 0 published",
    depoRole: "Depo can create drafts but cannot publish externally.",
    connections: ["workflow-pipeline", "commerce-terminal", "customer-node", "system-logs"],
    recentActivity: ["Draft output prepared.", "Awaiting review."],
    riskNote: "Publishing requires approval.",
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
  "customer-node": {
    purpose: "Customer-facing communication and support awareness.",
    status: "Guarded",
    metric: "Contact gate locked",
    depoRole: "Depo can draft customer messages but cannot send them.",
    connections: ["commerce-terminal", "content-engine", "security-core", "system-logs"],
    recentActivity: ["Customer contact blocked by gate."],
    riskNote: "Contacting customers requires approval.",
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
  "security-core": {
    purpose: "Approval gates, permissions, risk checks, and blocked actions.",
    status: "Secure",
    metric: "No threats",
    depoRole: "Depo checks whether actions are safe before packaging them for approval.",
    connections: ["argentum-core", "ai-agents", "revenue-monitor", "customer-node", "system-logs"],
    recentActivity: ["Permission check passed.", "External action blocked."],
    riskNote: "High-risk actions must be approved.",
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
  "system-logs": {
    purpose: "Live event stream and audit history.",
    status: "Live feed",
    metric: "6 events",
    depoRole: "Depo writes cycle updates and action notes here.",
    connections: ["agent-habitat", "content-engine", "customer-node", "security-core", "workflow-pipeline"],
    recentActivity: ["Depo moved to Workflow Pipeline.", "Approval required."],
    riskNote: "Logs should be append-only when possible.",
    quickActions: ["Open workspace", "View logs", "Run check"],
  },
};

const legacyRoomAliases = {
  Overview: "depo-habitat",
  Research: "depo-habitat",
  Verify: "depo-habitat",
  Draft: "depo-habitat",
  Approval: "depo-habitat",
  Commerce: "depo-habitat",
  Finance: "depo-habitat",
  Inventory: "depo-habitat",
  Logistics: "depo-habitat",
  Marketing: "depo-habitat",
  Support: "depo-habitat",
  Logs: "depo-habitat",
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
    title: "Depo Workspace",
    eyebrow: "Depository Operator",
    sections: [
      ["Mode", "Draft only. Depo researches, verifies, drafts, and packages work for approval."],
      ["Current stage", "Research -> Evidence Guard -> Output Bench -> Human Gate."],
      ["Security", "External actions, revenue claims, customer contact, and new-agent deployment remain locked."],
    ],
    feed: ["Depo is active supervised", "Depo keeps external actions gated", "Depo writes provenance-labeled memory"],
  },
};

let selectedRoomKey = null;
let selectedAgentKey = null;
const mapMinScale = 1;
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
  applyMapView(false);
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
  const module = moduleProfile(step.station);
  const coordinate = module?.position
    ? { x: `${module.position.x}%`, y: `${module.position.y}%` }
    : { x: step.x, y: step.y };
  if (avatar) {
    avatar.style.setProperty("--agent-x", coordinate.x);
    avatar.style.setProperty("--agent-y", coordinate.y);
  }
  if (progress) progress.style.width = `${step.progress}%`;
  if (cycleStatus) cycleStatus.textContent = state.mission.paused ? "Cycle paused" : `At ${module?.title || step.station}`;
  if (missionTitle) missionTitle.textContent = step.title;
  if (missionCopy) missionCopy.textContent = step.copy;
  if (confidenceChip) confidenceChip.textContent = `${step.confidence}% confidence`;
  if (taskStage) taskStage.textContent = `Stage: ${module?.title || step.station}`;
  if (riskLevel) riskLevel.textContent = `Risk: ${step.risk}`;
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
          <em>${escapeHtml(agent.number)}</em>
        </button>
      `,
    )
    .join("");
}

function routeIsActive(from, to) {
  if (!selectedRoomKey && !selectedAgentKey) return true;
  const selected = selectedAgentKey ? resolveRoomKey(agentProfiles[selectedAgentKey]?.room) : resolveRoomKey(selectedRoomKey);
  const related = connectedModuleSet(selected);
  return related.has(from) && related.has(to);
}

function routePoint(room) {
  return {
    x: room.position.x * 10,
    y: room.position.y * 6.2,
  };
}

function bridgeRoutePath(source, target, index) {
  const start = routePoint(source);
  const end = routePoint(target);
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
  return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

function moduleIconMarkup(id) {
  const icons = {
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

const stationWorld = { width: 1000, height: 620 };
const stationStarfield = Array.from({ length: 260 }, (_, index) => {
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
  background.addColorStop(0, "#02040a");
  background.addColorStop(0.38, "#071126");
  background.addColorStop(0.72, "#030513");
  background.addColorStop(1, "#010208");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, stationWorld.width, stationWorld.height);

  const nebula = ctx.createRadialGradient(565, 340, 40, 565, 340, 430);
  nebula.addColorStop(0, "rgba(37, 99, 235, 0.2)");
  nebula.addColorStop(0.42, "rgba(88, 28, 135, 0.13)");
  nebula.addColorStop(1, "rgba(2, 6, 23, 0)");
  ctx.fillStyle = nebula;
  ctx.fillRect(0, 0, stationWorld.width, stationWorld.height);

  stationStarfield.forEach((star) => {
    const twinkle = 0.72 + Math.sin(time * 0.0014 + star.drift) * 0.28;
    const tint = star.tint > 0.74 ? "167, 139, 250" : star.tint > 0.42 ? "125, 211, 252" : "226, 232, 240";
    ctx.fillStyle = `rgba(${tint}, ${star.alpha * twinkle})`;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawPlanetHorizon(ctx) {
  ctx.save();
  ctx.translate(735, -74);
  ctx.rotate(0.15);
  ctx.scale(1.08, 0.36);
  const planet = ctx.createRadialGradient(170, -60, 12, 0, 0, 570);
  planet.addColorStop(0, "rgba(248, 250, 252, 0.58)");
  planet.addColorStop(0.15, "rgba(147, 197, 253, 0.48)");
  planet.addColorStop(0.42, "rgba(37, 99, 235, 0.3)");
  planet.addColorStop(0.74, "rgba(15, 23, 42, 0.16)");
  planet.addColorStop(1, "rgba(2, 6, 23, 0)");
  ctx.beginPath();
  ctx.arc(0, 0, 570, 0, Math.PI * 2);
  ctx.fillStyle = planet;
  ctx.fill();
  ctx.clip();
  for (let index = 0; index < 44; index += 1) {
    const y = -210 + index * 11;
    const alpha = index % 4 === 0 ? 0.16 : 0.07;
    ctx.strokeStyle = `rgba(125, 211, 252, ${alpha})`;
    ctx.lineWidth = index % 5 === 0 ? 2.2 : 1;
    ctx.beginPath();
    ctx.moveTo(-520, y);
    ctx.bezierCurveTo(-190, y - 32, 180, y + 18, 560, y - 14);
    ctx.stroke();
  }
  for (let index = 0; index < 90; index += 1) {
    const x = -420 + ((index * 97) % 870);
    const y = -180 + ((index * 53) % 295);
    ctx.fillStyle = index % 6 === 0 ? "rgba(251, 146, 60, 0.34)" : "rgba(96, 165, 250, 0.22)";
    ctx.fillRect(x, y, 2 + (index % 3), 1);
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(219, 234, 254, 0.9)";
  ctx.lineWidth = 3.2;
  ctx.shadowBlur = 34;
  ctx.shadowColor = "rgba(96, 165, 250, 0.92)";
  ctx.beginPath();
  ctx.ellipse(735, -62, 620, 214, 0.15, 0.36, Math.PI * 0.94);
  ctx.stroke();
  ctx.strokeStyle = "rgba(34, 211, 238, 0.34)";
  ctx.lineWidth = 9;
  ctx.shadowBlur = 42;
  ctx.beginPath();
  ctx.ellipse(735, -59, 620, 214, 0.15, 0.36, Math.PI * 0.94);
  ctx.stroke();
  ctx.restore();
}

function drawOrbitalGuides(ctx) {
  const guides = [
    [500, 348, 458, 260, -0.08, "rgba(125, 211, 252, 0.16)", 1],
    [500, 348, 366, 188, -0.08, "rgba(167, 139, 250, 0.14)", 1],
    [500, 350, 250, 108, -0.08, "rgba(34, 211, 238, 0.14)", 1],
    [520, 330, 560, 310, -0.28, "rgba(96, 165, 250, 0.09)", 1],
  ];
  guides.forEach(([x, y, rx, ry, rotation, color, lineWidth], index) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(index === 2 ? [8, 13] : []);
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

function drawStationTube(ctx, curve, options) {
  const color = stationRgb(options.color || "#22D3EE");
  const altColor = stationRgb(options.altColor || "#8B5CF6");
  const alpha = options.alpha ?? 1;
  const width = options.width || 19;
  const gradient = ctx.createLinearGradient(curve.start.x, curve.start.y, curve.end.x, curve.end.y);
  gradient.addColorStop(0, stationColor(color, 0.08 * alpha));
  gradient.addColorStop(0.24, stationColor(color, 0.68 * alpha));
  gradient.addColorStop(0.58, stationColor(altColor, 0.78 * alpha));
  gradient.addColorStop(1, stationColor(color, 0.12 * alpha));

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowBlur = 26;
  ctx.shadowColor = stationColor(color, 0.46 * alpha);
  ctx.strokeStyle = stationColor(color, 0.2 * alpha);
  ctx.lineWidth = width + 26;
  drawStationCurve(ctx, curve);
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = `rgba(2, 8, 23, ${0.9 * alpha})`;
  ctx.lineWidth = width;
  drawStationCurve(ctx, curve);
  ctx.stroke();

  ctx.strokeStyle = gradient;
  ctx.lineWidth = width * 0.52;
  drawStationCurve(ctx, curve);
  ctx.stroke();

  ctx.strokeStyle = `rgba(219, 234, 254, ${0.34 * alpha})`;
  ctx.lineWidth = 1.2;
  drawStationCurve(ctx, curve);
  ctx.stroke();

  ctx.setLineDash([9, 18]);
  ctx.lineDashOffset = -options.time * 0.045 - options.seed * 12;
  ctx.strokeStyle = stationColor(mixStationColor(color, { r: 248, g: 250, b: 252 }, 0.35), 0.8 * alpha);
  ctx.lineWidth = 2.4;
  drawStationCurve(ctx, curve);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  drawTubeCollars(ctx, curve, color, alpha);
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

  const halo = ctx.createRadialGradient(x, y, 4, x, y, rx * 1.38);
  halo.addColorStop(0, stationColor(color, selected ? 0.3 : 0.18));
  halo.addColorStop(0.54, stationColor(color, selected ? 0.18 : 0.09));
  halo.addColorStop(1, stationColor(color, 0));
  drawEllipseFill(ctx, x, y + 8, rx * 1.38, ry * 1.22, halo);

  drawEllipseFill(ctx, x, y + ry * 0.8, rx * 1.04, ry * 0.5, "rgba(0, 0, 0, 0.42)");

  for (let layer = 10; layer >= 0; layer -= 1) {
    const depth = layer / 10;
    const layerGradient = ctx.createLinearGradient(x - rx, y - ry + layer * 2, x + rx, y + ry + 24);
    layerGradient.addColorStop(0, `rgba(71, 85, 105, ${0.48 + depth * 0.2})`);
    layerGradient.addColorStop(0.5, `rgba(15, 23, 42, ${0.76 + depth * 0.18})`);
    layerGradient.addColorStop(1, "rgba(1, 4, 12, 0.98)");
    ctx.beginPath();
    ctx.ellipse(x, y + 18 + layer * 1.9, rx - layer * 1.3, ry * 0.72 - layer * 0.26, 0, 0, Math.PI * 2);
    ctx.fillStyle = layerGradient;
    ctx.fill();
  }

  const shell = ctx.createLinearGradient(x - rx, y - ry, x + rx, y + ry + 24);
  shell.addColorStop(0, stationColor(mixStationColor(color, { r: 248, g: 250, b: 252 }, 0.3), 0.4));
  shell.addColorStop(0.2, "rgba(51, 65, 85, 0.96)");
  shell.addColorStop(0.58, "rgba(8, 13, 26, 0.98)");
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
  const core = roomProfiles["argentum-core"];
  const point = stationCanvasPoint(core);
  const x = point.x;
  const y = point.y;
  const pulse = 0.78 + Math.sin(time * 0.002) * 0.22;
  const color = stationRgb("#60A5FA");
  const violet = stationRgb("#8B5CF6");

  const halo = ctx.createRadialGradient(x, y, 0, x, y, 150);
  halo.addColorStop(0, `rgba(248, 250, 252, ${0.38 * pulse})`);
  halo.addColorStop(0.24, "rgba(34, 211, 238, 0.34)");
  halo.addColorStop(0.58, "rgba(139, 92, 246, 0.18)");
  halo.addColorStop(1, "rgba(34, 211, 238, 0)");
  drawEllipseFill(ctx, x, y + 5, 154, 122, halo);

  drawEllipseFill(ctx, x, y + 62, 116, 42, "rgba(0, 0, 0, 0.42)");

  for (let layer = 9; layer >= 0; layer -= 1) {
    const body = ctx.createLinearGradient(x - 110, y - 50, x + 110, y + 78);
    body.addColorStop(0, "rgba(51, 65, 85, 0.88)");
    body.addColorStop(0.45, "rgba(8, 13, 26, 0.98)");
    body.addColorStop(1, "rgba(0, 0, 0, 1)");
    ctx.beginPath();
    ctx.ellipse(x, y + 30 + layer * 2.3, 104 - layer * 1.7, 58 - layer * 0.8, 0, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();
  }

  ctx.save();
  ctx.shadowBlur = 34;
  ctx.shadowColor = "rgba(34, 211, 238, 0.54)";
  ctx.strokeStyle = "rgba(125, 211, 252, 0.5)";
  ctx.lineWidth = 1.4;
  [96, 76, 56].forEach((rx, index) => {
    ctx.setLineDash(index === 1 ? [8, 9] : [15, 10]);
    ctx.lineDashOffset = -time * (0.015 + index * 0.006);
    ctx.beginPath();
    ctx.ellipse(x, y + index * 2, rx, rx * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.restore();

  drawStationPanelLines(ctx, x, y + 12, 100, 62, color, 1, time * 0.00012);
  drawPodLights(ctx, x, y + 8, 98, 58, color, 0.78, 11, time);

  const orb = ctx.createRadialGradient(x - 12, y - 30, 0, x, y - 8, 64);
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
  ctx.arc(x, y - 12, 52 + pulse * 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(248, 250, 252, 0.96)";
  ctx.beginPath();
  ctx.arc(x, y - 12, 11, 0, Math.PI * 2);
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
  drawOrbitalGuides(ctx);

  const core = roomProfiles["argentum-core"];
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

  moduleRoutes.forEach(([from, to], index) => {
    const source = moduleProfile(from);
    const target = moduleProfile(to);
    const active = routeIsActive(from, to);
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
  if (!stationArtwork || typeof stationArtwork.getContext !== "function") return;
  drawStationScene(performance.now());
  if (!stationRenderFrame) {
    stationRenderFrame = requestAnimationFrame(stationRenderLoop);
  }
}

function renderHabitatRoutes() {
  if (!habitatRoutes) return;
  const coreRoom = roomProfiles["argentum-core"];
  const corePos = { x: coreRoom.position.x * 10, y: coreRoom.position.y * 6.2 };
  const defs = `
    <defs>
      <linearGradient id="routeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="rgba(34, 211, 238, 0)" />
        <stop offset="45%" stop-color="rgba(125, 211, 252, 0.82)" />
        <stop offset="72%" stop-color="rgba(167, 139, 250, 0.7)" />
        <stop offset="100%" stop-color="rgba(34, 211, 238, 0)" />
      </linearGradient>
      <linearGradient id="coreBeamGradient" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="rgba(34, 211, 238, 0.72)" />
        <stop offset="60%" stop-color="rgba(125, 211, 252, 0.42)" />
        <stop offset="100%" stop-color="rgba(167, 139, 250, 0)" />
      </linearGradient>
    </defs>
  `;

  const coreConnected = roomProfiles["argentum-core"].connectedModules;
  const hasSelection = Boolean(selectedRoomKey || selectedAgentKey);
  const activeSet = hasSelection ? connectedModuleSet(selectedAgentKey ? agentProfiles[selectedAgentKey]?.room : selectedRoomKey) : null;

  const coreBeams = coreConnected.map((moduleId, index) => {
    const target = moduleProfile(moduleId);
    const end = routePoint(target);
    const active = !hasSelection || (activeSet && activeSet.has(moduleId));
    const path = `M ${corePos.x} ${corePos.y} L ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
    return `
      <path class="core-beam ${active ? "active" : ""}" d="${path}" style="--delay: ${(index * 0.22).toFixed(2)}s"></path>
      <path class="core-flow ${active ? "active" : ""}" d="${path}" style="--delay: ${(index * 0.22 + 0.12).toFixed(2)}s"></path>
      <circle class="route-particle ${active ? "active" : ""}" r="2.2">
        <animateMotion dur="${(2.6 + index * 0.3).toFixed(2)}s" begin="${(index * 0.18).toFixed(2)}s" repeatCount="indefinite" path="${path}" />
      </circle>
    `;
  }).join("");

  const moduleBridgeRoutes = moduleRoutes
    .map(([from, to], index) => {
      const source = moduleProfile(from);
      const target = moduleProfile(to);
      const active = routeIsActive(from, to);
      const path = bridgeRoutePath(source, target, index);
      return `
        <path class="route-glow ${active ? "active" : ""}" d="${path}"></path>
        <path class="route-tube ${active ? "active" : ""}" d="${path}"></path>
        <path class="route-bridge ${active ? "active" : ""}" d="${path}"></path>
        <path class="route-line ${active ? "active" : ""}" data-from="${escapeHtml(from)}" data-to="${escapeHtml(to)}" d="${path}" style="--delay: ${(index * 0.18).toFixed(2)}s"></path>
        <circle class="route-particle ${active ? "active" : ""}" r="3.5">
          <animateMotion dur="${(3.4 + (index % 5) * 0.28).toFixed(2)}s" begin="${(index * 0.16).toFixed(2)}s" repeatCount="indefinite" path="${path}" />
        </circle>
      `;
    })
    .join("");
  habitatRoutes.innerHTML = `${defs}${coreBeams}${moduleBridgeRoutes}`;
}

function renderHabitatModules() {
  if (!habitatModules) return;
  const related = selectedRoomKey || selectedAgentKey ? connectedModuleSet(selectedAgentKey ? agentProfiles[selectedAgentKey]?.room : selectedRoomKey) : new Set();
  habitatModules.innerHTML = habitatMapModules
    .map((room) => {
      const isSelected = selectedRoomKey && resolveRoomKey(selectedRoomKey) === room.id;
      const isRelated = related.has(room.id);
      const labelPosition = room.labelPosition || room.position;
      const className = ["station", "station-module", room.title.length > 15 ? "long-title" : "", isSelected ? "selected" : "", isRelated ? "related" : ""]
        .filter(Boolean)
        .join(" ");
      return `
        <button class="${className}" data-station="${escapeHtml(room.id)}" type="button" style="--x: ${labelPosition.x}%; --y: ${labelPosition.y}%; --module-color: ${escapeHtml(room.color)}" aria-label="${escapeHtml(room.title)}" title="${escapeHtml(room.title)}">
          <span class="station-label">
            <span class="module-icon" aria-hidden="true">${moduleIconMarkup(room.id)}</span>
            <span class="module-copy">
              <strong>${escapeHtml(room.title)}</strong>
              <small>${escapeHtml(room.metric)}</small>
              <em>${escapeHtml(room.status)}</em>
            </span>
            <span class="station-status-dot" aria-hidden="true"></span>
          </span>
        </button>
      `;
    })
    .join("");
}

function renderMiniMap() {
  if (!miniMapNodes) return;
  const hasSelection = Boolean(selectedRoomKey || selectedAgentKey);
  const selected = selectedAgentKey ? resolveRoomKey(agentProfiles[selectedAgentKey]?.room) : resolveRoomKey(selectedRoomKey);
  const related = hasSelection ? connectedModuleSet(selected) : new Set();
  const selectedCore = selected === "argentum-core";
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
  const core = roomProfiles["argentum-core"];
  const coreSpokes = habitatMapModules
    .map((room, index) => {
      const active = !hasSelection || selectedCore || selected === room.id || related.has(room.id);
      return `<path class="mini-core-spoke ${active ? "active" : "dim"}" d="${curvePath(core, room, index, 0.04)}"></path>`;
    })
    .join("");
  const routeLines = moduleRoutes
    .map(([from, to], index) => {
      const source = moduleProfile(from);
      const target = moduleProfile(to);
      const active = routeIsActive(from, to);
      return `<path class="mini-route ${active ? "active" : "dim"}" d="${curvePath(source, target, index)}"></path>`;
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
        <linearGradient id="miniSweepGradient" x1="50%" y1="50%" x2="100%" y2="16%">
          <stop offset="0%" stop-color="rgba(34, 211, 238, 0.36)" />
          <stop offset="100%" stop-color="rgba(34, 211, 238, 0)" />
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
      <path class="mini-sweep" d="M 50 47 L 93 16 A 48 32 0 0 1 96 47 Z"></path>
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
    canDepoDo: detail.canDepoDo || depoWorkflowState.canDepoDo,
    cannotDepoDo: detail.cannotDepoDo || depoWorkflowState.cannotDepoDo,
  };
}

function cardListMarkup(items, className = "") {
  return `<div class="${className}">${items.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`;
}

function moduleInfoMarkup(roomKey) {
  const card = moduleCardData(roomKey);
  const connectedNames = (card.connections || card.connectedModules || []).map(moduleDisplayName);
  const recent = Array.isArray(card.recentActivity) ? card.recentActivity : [card.recentActivity].filter(Boolean);
  const actions = card.quickActions || [];
  return `
    <div class="module-info-head">
      <span class="module-info-icon" style="--module-color: ${escapeHtml(card.color)}" aria-hidden="true">${moduleIconMarkup(card.id)}</span>
      <div>
        <strong>${escapeHtml(card.title)}</strong>
        <small>${escapeHtml(card.metric)}</small>
      </div>
      <em>${escapeHtml(card.status)}</em>
      <button class="module-info-close" type="button" aria-label="Close module details">×</button>
    </div>
    <div class="module-info-body">
      <section>
        <h4>Purpose</h4>
        <p>${escapeHtml(card.purpose || card.summary)}</p>
      </section>
      <div class="module-info-metrics">
        <span><small>Active agent</small><strong>${escapeHtml(depoWorkflowState.activeAgent)}</strong></span>
        <span><small>Mode</small><strong>${escapeHtml(card.id === "argentum-core" ? "Supervised local OS" : depoWorkflowState.mode)}</strong></span>
        <span><small>Human gate</small><strong>${escapeHtml(depoWorkflowState.humanGate)}</strong></span>
      </div>
      <section>
        <h4>Depo role</h4>
        <p>${escapeHtml(card.depoRole)}</p>
      </section>
      <section>
        <h4>Connected capsules</h4>
        ${cardListMarkup(connectedNames, "module-info-tags")}
      </section>
      <section>
        <h4>Recent activity</h4>
        <ul>${recent.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </section>
      <section class="module-info-risk">
        <h4>Approval / risk</h4>
        <p>${escapeHtml(card.riskNote)}</p>
        ${cardListMarkup(card.canDepoDo, "module-info-permissions can-do")}
        ${cardListMarkup(card.cannotDepoDo, "module-info-permissions cannot-do")}
      </section>
    </div>
    <div class="module-info-actions">
      ${actions.map((action) => `<button type="button" data-module-action="${escapeHtml(action)}">${escapeHtml(action)}</button>`).join("")}
    </div>
  `;
}

function closeModuleInfoCard() {
  if (!moduleInfoCard) return;
  moduleInfoCard.hidden = true;
  moduleInfoCard.classList.remove("open");
  moduleInfoCard.innerHTML = "";
}

function positionModuleInfoCard(roomKey) {
  if (!stationMap || !moduleInfoCard || moduleInfoCard.hidden) return;
  const mapRect = stationMap.getBoundingClientRect();
  const cardRect = moduleInfoCard.getBoundingClientRect();
  const room = moduleProfile(roomKey);
  const anchorX = mapRect.width / 2;
  const anchorY = mapRect.height / 2;
  const bottomReserve = 96;
  const preferLeft = Number(room.position?.x || 50) >= 75;
  const gap = preferLeft ? 132 : 88;
  let left = preferLeft ? anchorX - cardRect.width - gap : anchorX + gap;
  let top = anchorY - cardRect.height / 2;
  if (preferLeft && left < 180 && anchorX + gap + cardRect.width + 12 <= mapRect.width) {
    left = anchorX + gap;
  }
  if (left < 12) {
    left = anchorX + gap;
  } else if (left + cardRect.width + 14 > mapRect.width) {
    left = anchorX - cardRect.width - gap;
  }
  left = clamp(left, 12, Math.max(12, mapRect.width - cardRect.width - 12));
  const minTop = mapRect.height > 380 ? 46 : 12;
  top = clamp(top, minTop, Math.max(minTop, mapRect.height - cardRect.height - bottomReserve));
  moduleInfoCard.style.setProperty("--card-left", `${left}px`);
  moduleInfoCard.style.setProperty("--card-top", `${top}px`);
}

function openModuleInfoCard(roomKey) {
  if (!moduleInfoCard) return;
  const resolved = resolveRoomKey(roomKey);
  moduleInfoCard.innerHTML = moduleInfoMarkup(resolved);
  moduleInfoCard.dataset.station = resolved;
  moduleInfoCard.hidden = false;
  moduleInfoCard.classList.remove("open");
  requestAnimationFrame(() => {
    positionModuleInfoCard(resolved);
    moduleInfoCard.classList.add("open");
  });
  window.setTimeout(() => positionModuleInfoCard(resolved), 430);
}

function renderShellData() {
  renderAgentRoster();
  renderStationArtwork();
  renderHabitatRoutes();
  renderHabitatModules();
  renderMiniMap();
  applySelectionClasses();
  if (moduleInfoCard && !moduleInfoCard.hidden && selectedRoomKey) {
    moduleInfoCard.innerHTML = moduleInfoMarkup(selectedRoomKey);
    positionModuleInfoCard(selectedRoomKey);
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
  });
  document.querySelectorAll(".roster-agent, .user-profile-card, .admin-menu-item[data-agent]").forEach((item) => {
    item.classList.toggle("selected", item.dataset.agent === selectedAgentKey);
  });
  stationMap?.classList.toggle("has-selection", hasSelection);
  renderHabitatRoutes();
  renderMiniMap();
}

function applyMapView(animated = true) {
  if (!habitatCanvas) return;
  habitatCanvas.classList.toggle("is-animating", animated);
  habitatCanvas.style.transform = `translate3d(${mapView.x}px, ${mapView.y}px, 0) scale(${mapView.scale})`;
  if (zoomReadout) zoomReadout.textContent = `${Math.round(mapView.scale * 100)}%`;
  if (zoomOutBtn) zoomOutBtn.disabled = mapView.scale <= mapMinScale + 0.001;
  renderMiniMap();
  if (animated) {
    window.setTimeout(() => habitatCanvas.classList.remove("is-animating"), 420);
  }
}

function setMapView(nextView, animated = true) {
  mapView = {
    x: Number.isFinite(nextView.x) ? nextView.x : mapView.x,
    y: Number.isFinite(nextView.y) ? nextView.y : mapView.y,
    scale: clamp(Number.isFinite(nextView.scale) ? nextView.scale : mapView.scale, mapMinScale, 2.8),
  };
  applyMapView(animated);
}

function resetHabitatView(animated = true) {
  selectedRoomKey = null;
  selectedAgentKey = null;
  closeModuleInfoCard();
  applySelectionClasses();
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
  const nextScale = clamp(mapView.scale + delta, mapMinScale, 2.8);
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
    hour12: false,
    timeZone: "UTC",
  }).format(nowDate);
  const dateText = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
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
      title: "Depo born into habitat",
      body: "Agent 001 is active in draft-only mode with no revenue claimed.",
    },
    {
      title: "First workflow waiting",
      body: "Depo is ready for one bounded task with evidence, draft output, and approval packaging.",
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
    "Depo born into habitat": "Depo born",
    "First workflow waiting": "Workflow waiting",
    "Revenue cleared": "Revenue cleared",
    "External actions locked": "Actions locked",
    "Human gate ready": "Human gate ready",
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
  const agentStateLabel = statusLabel(state.agent?.state || "active_supervised");
  const safeSpend = Math.max(Number(governance.estimatedSpendUsd || 0), 0);
  const tasks = state.tasks || [];
  const queuedTasks = tasks.filter((task) => task.status === "queued");
  const artifacts = state.artifacts || [];
  const approvals = state.approvals || [];
  const highRiskQueued = queuedTasks.filter((task) => String(task.risk || "").toLowerCase() === "high").length;
  const mediumQueued = queuedTasks.filter((task) => String(task.risk || "").toLowerCase() === "medium").length;
  const lowQueued = queuedTasks.length - highRiskQueued - mediumQueued;
  const currentStage = currentStep()?.station || "Research";
  const stageCounts = {
    Research: currentStage === "Research" ? 1 : 0,
    Verify: currentStage === "Verify" ? 1 : 0,
    Draft: currentStage === "Draft" ? 1 : 0,
    Approval: currentStage === "Approval" ? 1 : 0,
  };

  setText(agentCountMetric, "1");
  setText(agentStatusMetric, agentStateLabel);
  setText(liveRevenueMetric, "Not started");
  setText(budgetUsedMetric, money(safeSpend));
  setText(overviewQueuedTaskMetric, String(queuedTasks.length));
  setText(overviewHighRiskTaskMetric, String(highRiskQueued));
  setText(overviewDraftReadyMetric, String(mediumQueued));
  setText(overviewTotalTaskMetric, String(lowQueued));
  setText(workflowResearchMetric, String(stageCounts.Research));
  setText(workflowVerifyMetric, String(stageCounts.Verify));
  setText(workflowDraftMetric, String(stageCounts.Draft));
  setText(workflowApprovalMetric, String(stageCounts.Approval));
  setText(revenueGuardMetric, "None yet");
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
    const title = button.textContent.trim().replace(/\s+/g, " ");
    if (settingsTitleHeading) settingsTitleHeading.textContent = title;
    if (settingsBreadcrumbCurrent) settingsBreadcrumbCurrent.textContent = title;
    if (settingsTitleCopy && target) {
      settingsTitleCopy.textContent = target.querySelector(".settings-card-heading p")?.textContent || "Manage Argentum command-floor settings.";
    }
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

securityScanBtn?.addEventListener("click", () => {
  loadAccessState();
  showAccessMessage("Security scan complete. Password hashing, signed sessions, legacy-default blocking, and approval gates are active.", "success");
});

scanBtn?.addEventListener("click", () => {
  selectedAgentKey = null;
  focusRoom("depo-habitat", { scale: 1.72 });
  addLocalAudit("Focus scan", "Depo habitat scan confirmed Agent 001 is draft-only and ready for bounded work.");
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

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
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
  if (activateStationFromEvent(event)) return;
  if (event.target === stationMap || event.target === habitatCanvas || event.target === stationArtwork || event.target.closest(".map-space-layer, .station-renderer")) {
    resetHabitatView();
  }
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
  const rect = stationMap.getBoundingClientRect();
  const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  zoomMap(event.deltaY > 0 ? -0.12 : 0.12, point);
}, { passive: false });

stationMap.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".map-controls") || event.target.closest(".module-info-card") || event.target.closest(".station") || event.target.closest(".map-core")) return;
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
    const nextScale = clamp(pinchStart.scale * (distance / pinchStart.distance), mapMinScale, 2.8);
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
  if (event.target.closest(".module-info-card")) return;
  if (event.target === stationMap || event.target === habitatCanvas || event.target === stationArtwork || event.target.closest(".station-renderer")) {
    resetHabitatView();
  }
});

moduleInfoCard?.addEventListener("click", (event) => {
  event.stopPropagation();
  const closeButton = event.target.closest(".module-info-close");
  if (closeButton) {
    resetHabitatView();
    return;
  }
  const actionButton = event.target.closest("[data-module-action]");
  if (!actionButton) return;
  const action = actionButton.dataset.moduleAction;
  const stationId = moduleInfoCard.dataset.station || selectedRoomKey || "argentum-core";
  if (action === "Open workspace") {
    openWorkspace(stationId);
  } else if (action === "View logs") {
    openSystemFeed();
  } else if (action === "Run cycle") {
    runCycleBtn?.click();
  } else if (action === "View approvals") {
    activateView("approvals");
  } else {
    addLocalAudit(`${action}: ${moduleDisplayName(stationId)}`, "Placeholder action recorded. External execution remains locked behind approval.");
    renderAudit();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && moduleInfoCard && !moduleInfoCard.hidden) {
    resetHabitatView();
  }
});

document.addEventListener("click", (event) => {
  if (!moduleInfoCard || moduleInfoCard.hidden) return;
  if (event.target.closest("#stationMap")) return;
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

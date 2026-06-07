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
const apiStatus = document.querySelector("#apiStatus");
const capabilityList = document.querySelector("#capabilityList");
const approvalList = document.querySelector("#approvalList");
const queueCount = document.querySelector("#queueCount");
const artifactList = document.querySelector("#artifactList");
const artifactCount = document.querySelector("#artifactCount");
const memoryList = document.querySelector("#memoryList");
const auditLog = document.querySelector("#auditLog");
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
    throw new Error(`API request failed: ${response.status}`);
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
}

function renderAgent() {
  agentState.textContent = state.agent.state.replaceAll("_", " / ");
  const manifestItems = document.querySelectorAll(".manifest-grid dd");
  manifestItems[1].textContent = state.agent.spendLimit;
  manifestItems[2].textContent = state.agent.externalActions;
  manifestItems[3].textContent = state.agent.memoryAccess;
}

function renderStatus() {
  apiStatus.textContent = apiAvailable ? "Persistent local OS" : "Static preview";
  pauseBtn.setAttribute("aria-label", state.mission.paused ? "Resume Depo" : "Pause Depo");
  pauseBtn.title = state.mission.paused ? "Resume Depo" : "Pause Depo";
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
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
  renderGovernance();
  renderKpis();
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

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
    button.classList.add("active");
    document.querySelector(`#view-${button.dataset.view}`).classList.add("active");
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

loadState();
startCycle();

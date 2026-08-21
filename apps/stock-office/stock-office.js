const state = {
  overview: null,
  records: [],
  selectedTicker: null,
  sources: [],
  secSetup: null,
  activity: [],
  messages: [],
  mirror: null,
  mirrorApprovalIds: new Set(),
  recordTotal: 0,
  loading: false,
  refresh: null,
  manualRefreshRunning: false,
  brokerControl: null,
  portfolioPlan: null,
  shadowPortfolio: null,
  simulationLab: null,
  intelligenceScheduler: null,
  marketWorkers: null,
  intelligence: null,
  systemHealth: null,
  mirrorIntelligence: null,
  traderResearch: null,
  flowManagers: null,
  notificationStatus: null,
  notificationApproval: null,
  robinhoodConnection: null,
  connectionApproval: null,
  guardrailApproval: null,
  guardrailsSource: null,
  tradeDrafts: [],
  proposalDecisions: [],
  expandedProposalResearch: new Set(),
  dispatchHandoff: null,
  brokerPolling: false,
  livePortfolioPolling: false,
  refreshStatusPolling: false,
  traderResearchPolling: false,
  workspacePayloadFingerprint: "",
  liveAccountFingerprint: "",
  hasRendered: false,
  operationsCollapsed: false,
  activeView: "overview",
};

const DEFAULT_CAPITAL_BASE_DOLLARS = 75;
const DEFAULT_CAPITAL_GOAL_DOLLARS = 150;

const $ = (selector) => document.querySelector(selector);

const stockOfficePreloader = {
  startedAt: window.performance?.now?.() || Date.now(),
  finished: false,
  fallbackTimer: null,
};

function updateStockOfficePreloader(message, step = "shell") {
  const screen = $("#stockOfficePreloader");
  if (!screen || stockOfficePreloader.finished) return;
  const status = $("#stockPreloadMessage");
  if (status) status.textContent = message;
  screen.querySelectorAll("[data-preload-step]").forEach((item) => {
    const steps = ["shell", "market", "account"];
    item.classList.toggle("active", steps.indexOf(item.dataset.preloadStep) <= steps.indexOf(step));
  });
}

function finishStockOfficePreloader() {
  const screen = $("#stockOfficePreloader");
  if (!screen || stockOfficePreloader.finished) return;
  stockOfficePreloader.finished = true;
  window.clearTimeout(stockOfficePreloader.fallbackTimer);
  const elapsed = (window.performance?.now?.() || Date.now()) - stockOfficePreloader.startedAt;
  window.setTimeout(() => {
    screen.classList.add("leaving");
    window.setTimeout(() => {
      screen.remove();
      document.body.classList.add("stock-office-ready");
    }, 260);
  }, Math.max(0, 460 - elapsed));
}

stockOfficePreloader.fallbackTimer = window.setTimeout(() => {
  updateStockOfficePreloader("The office is open. Live data is still connecting…", "account");
  finishStockOfficePreloader();
}, 6_500);

function setInputValue(selector, value) {
  const input = $(selector);
  if (input) input.value = value;
}

try {
  state.operationsCollapsed = window.localStorage.getItem("stock-office:operations-collapsed") === "1";
} catch {
  state.operationsCollapsed = false;
}

const STOCK_VIEWS = {
  overview: ["Stock workspace", "Overview"],
  portfolio: ["Testing only", "Simulation"],
  performance: ["Measured history", "Performance"],
  mirror: ["Market intelligence", "Research"],
  markets: ["Evaluator", "Markets"],
  trade: ["Supervised broker", "Trade desk"],
  sources: ["Market inputs", "Sources"],
  assistant: ["Research help", "Assistant"],
};

function renderExecutionModePill() {
  const modePill = $("#executionModePill");
  if (!modePill) return;
  if (state.activeView === "portfolio") {
    modePill.textContent = "SIMULATION ONLY";
    modePill.className = "status-pill warning";
    return;
  }
  const live = String(state.brokerControl?.executionMode || "PAPER").toUpperCase() === "LIVE";
  modePill.textContent = live ? "LIVE · HUMAN GATE" : "LIVE ORDERS OFF";
  modePill.className = `status-pill ${live ? "ready" : "warning"}`;
}

function setStockView(requestedView, options = {}) {
  const view = STOCK_VIEWS[requestedView] ? requestedView : "overview";
  state.activeView = view;
  document.querySelectorAll("[data-stock-view]").forEach((section) => {
    const active = section.dataset.stockView === view;
    section.hidden = !active;
    section.classList.toggle("active", active);
  });
  document.querySelectorAll("[data-stock-nav]").forEach((button) => {
    const active = button.dataset.stockNav === view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  const [kicker, title] = STOCK_VIEWS[view];
  $("#viewKicker").textContent = kicker;
  $("#viewTitle").textContent = title;
  $("#syncButton").hidden = view === "trade";
  renderExecutionModePill();
  if (state.hasRendered) renderActiveStockView();
  if (view === "mirror") pollTraderResearch();
  if (options.updateHash !== false) history.replaceState(null, "", `#${view}`);
  if (options.scroll !== false) $(".stock-main").scrollTo({ top: 0, behavior: "smooth" });
}

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
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Authentication required");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function formatTime(value) {
  if (!value) return "No timestamp";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Unknown";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(number);
}

function formatPercent(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Unknown";
  return `${(number * 100).toFixed(digits)}%`;
}

function formatCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: number >= 1_000 ? 1 : 0 }).format(number);
}

function formatResearchDuration(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  if (milliseconds < 1_000) return milliseconds < 100 ? "<0.1s" : `${(milliseconds / 1_000).toFixed(1)}s`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}

function formatBrokerPercent(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const normalized = Math.abs(number) > 1 ? number / 100 : number;
  return `${(normalized * 100).toFixed(digits)}%`;
}

function logoMarkup(symbol, name = "", options = {}) {
  const safeSymbol = String(symbol || "").toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
  if (!safeSymbol) return "";
  const loading = options.eager === true ? "eager" : "lazy";
  return `<span class="company-logo" data-symbol="${escapeHtml(safeSymbol)}"><img src="/api/stock-office/logos/${encodeURIComponent(safeSymbol)}" alt="" loading="${loading}" decoding="async" /><i aria-hidden="true">${escapeHtml(safeSymbol.slice(0, 2))}</i></span><span class="company-identity"><strong>${escapeHtml(safeSymbol)}</strong>${name && name !== safeSymbol ? `<small>${escapeHtml(name)}</small>` : ""}</span>`;
}

function outlookValue(value, fallback = "—") {
  const number = Number(value);
  return value === null || value === undefined || !Number.isFinite(number) || number <= 0 ? fallback : formatMoney(number);
}

function formatCadence(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return "Unknown";
  if (value < 60) return `${value} min`;
  if (value % (24 * 60) === 0) return `${value / (24 * 60)} day`;
  if (value % 60 === 0) return `${value / 60} hr`;
  return `${value} min`;
}

function getCapitalGoal() {
  try {
    const value = Number(window.localStorage.getItem("argentum.stockOffice.capitalGoalDollars"));
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_CAPITAL_GOAL_DOLLARS;
  } catch {
    return DEFAULT_CAPITAL_GOAL_DOLLARS;
  }
}

function getCapitalGoalBase() {
  try {
    const value = Number(window.localStorage.getItem("argentum.stockOffice.capitalGoalBaseDollars"));
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_CAPITAL_BASE_DOLLARS;
  } catch {
    return DEFAULT_CAPITAL_BASE_DOLLARS;
  }
}

function getCapitalGoalHorizon() {
  try {
    const value = Number(window.localStorage.getItem("argentum.stockOffice.capitalGoalHorizonMonths"));
    return [3, 6, 12, 24].includes(value) ? value : null;
  } catch {
    return 12;
  }
}

function renderCapitalGoalPlanner() {
  const buyingPower = numericMoney(state.brokerControl?.buyingPowerDollars);
  const baseInput = $("#capitalGoalBaseDollars");
  const goalInput = $("#capitalGoalDollars");
  const horizonInput = $("#capitalGoalHorizon");
  if (!baseInput || !goalInput || !horizonInput) return;
  const savedBase = getCapitalGoalBase();
  const savedGoal = getCapitalGoal();
  const horizon = getCapitalGoalHorizon();
  if (savedBase && !baseInput.value) baseInput.value = savedBase;
  if (savedGoal && !goalInput.value) goalInput.value = savedGoal;
  horizonInput.value = horizon ? String(horizon) : "";
  $("#capitalGoalBuyingPower").textContent = buyingPower === null ? "Unavailable" : formatMoney(buyingPower);
  $("#capitalGoalAvailable").textContent = buyingPower === null ? "—" : formatMoney(Math.max(0, buyingPower - (numericMoney(state.brokerControl?.committedDollars) || 0)));
  const base = Number(baseInput.value || savedBase || 0);
  const target = Number(goalInput.value || savedGoal || 0);
  const estimate = $("#capitalGoalEstimate");
  if (!estimate) return;
  if (!base || !target) {
    estimate.innerHTML = "<strong>Set starting capital and a target to see the required math.</strong>";
    return;
  }
  if (target < base) {
    estimate.innerHTML = "<strong>Target must be at least the planned starting capital.</strong>";
    return;
  }
  const requiredGain = target - base;
  const requiredPct = base > 0 ? requiredGain / base : null;
  const requiredReturnLabel = requiredPct === null ? "unavailable" : `${(requiredPct * 100).toFixed(1)}%`;
  if (!horizon) {
    estimate.innerHTML = `<div><strong>Open-ended goal tracking</strong><span>${escapeHtml(formatMoney(base))} planned capital → ${escapeHtml(formatMoney(target))} target</span></div><div class="capital-goal-required"><span><small>Required gain</small><strong>${escapeHtml(formatMoney(requiredGain))}</strong></span><span><small>Required change</small><strong>${escapeHtml(requiredReturnLabel)}</strong></span></div><small>The system will keep researching, rerun the numbers, and report measured progress. This is a target, not a profit promise.</small>`;
    return;
  }
  const endingCapital = (annualRate) => base * Math.pow(1 + annualRate, horizon / 12);
  const requiredAnnualized = base > 0 ? Math.pow(target / base, 12 / horizon) - 1 : null;
  estimate.innerHTML = `<div><strong>Illustrative capital paths</strong><span>${escapeHtml(formatMoney(base))} planned capital over ${horizon} months toward ${escapeHtml(formatMoney(target))}</span></div><div class="capital-goal-required"><span><small>Required gain</small><strong>${escapeHtml(formatMoney(requiredGain))}</strong></span><span><small>Required annualized change</small><strong>${escapeHtml(requiredAnnualized === null ? "unavailable" : `${(requiredAnnualized * 100).toFixed(1)}%`)}</strong></span></div><div class="capital-goal-scenarios"><span><small>Conservative · 4% annualized</small><strong>${escapeHtml(formatMoney(endingCapital(0.04)))}</strong></span><span><small>Base · 8% annualized</small><strong>${escapeHtml(formatMoney(endingCapital(0.08)))}</strong></span><span><small>Strong · 15% annualized</small><strong>${escapeHtml(formatMoney(endingCapital(0.15)))}</strong></span></div><small>Illustrative math only. Research, position sizing, and realized outcomes are rerun from current evidence; markets can lose money and no return is guaranteed.</small>`;
}

function statusClass(value) {
  return String(value || "muted").toLowerCase().replaceAll(" ", "_");
}

function metricCard(label, value, hint) {
  return `
    <article class="metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value ?? "-")}</strong>
      <small>${escapeHtml(hint || "")}</small>
    </article>
  `;
}

function numericMoney(value) {
  if (value === null || value === undefined || value === "") return null;
  if (Number.isFinite(Number(value))) return Number(value);
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function livePositionValue(position = {}) {
  const explicit = numericMoney(position.marketValueDollars ?? position.marketValue);
  if (explicit !== null) return explicit;
  const quantity = numericMoney(position.quantity ?? position.sharesAvailableForSells);
  const price = numericMoney(position.currentPrice);
  return quantity !== null && price !== null ? quantity * price : null;
}

function formatShares(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function relativeCycle(value) {
  if (!value) return "—";
  const delta = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(delta)) return "—";
  const minutes = Math.round(Math.abs(delta) / 60_000);
  if (Math.abs(delta) < 60_000) return delta >= 0 ? "<1m" : "now";
  if (minutes < 60) return delta >= 0 ? `${minutes}m` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return delta >= 0 ? `${hours}h` : `${hours}h ago`;
}

function formatCountdown(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(value / 60);
  const remainder = value % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function renderMarketWorkers() {
  const operations = state.marketWorkers || {};
  const workers = Array.isArray(operations.workers) ? operations.workers : [];
  const session = operations.market || {};
  const marketPill = $("#marketSessionPill");
  marketPill.textContent = session.label || "Market schedule unavailable";
  marketPill.dataset.status = session.status || "closed";
  const board = $("#overviewOperationsBoard");
  const body = $("#overviewOperationsBody");
  const summary = $("#overviewOperationsSummary");
  const toggle = $("#operationsToggle");
  const counts = workers.reduce((output, worker) => {
    const key = ["working", "watching", "blocked"].includes(worker.status) ? worker.status : "waiting";
    output[key] = (output[key] || 0) + 1;
    return output;
  }, { working: 0, watching: 0, blocked: 0, waiting: 0 });
  board?.classList.toggle("is-collapsed", state.operationsCollapsed);
  if (body) body.hidden = state.operationsCollapsed;
  if (summary) {
    summary.hidden = !state.operationsCollapsed;
    summary.innerHTML = [
      ["Working", counts.working],
      ["Watching", counts.watching],
      ["Blocked", counts.blocked],
      ["Waiting", counts.waiting],
    ].filter(([, value]) => value > 0).map(([label, value]) => `<span data-status="${escapeHtml(label.toLowerCase())}"><i></i><strong>${escapeHtml(value)}</strong><small>${escapeHtml(label)}</small></span>`).join("")
      || `<span data-status="waiting"><i></i><strong>0</strong><small>Workers loaded</small></span>`;
  }
  if (toggle) {
    toggle.textContent = state.operationsCollapsed ? "Expand" : "Minimize";
    toggle.setAttribute("aria-expanded", String(!state.operationsCollapsed));
  }
  $("#marketWorkers").innerHTML = workers.length
    ? workers.map((worker) => {
        const metrics = Array.isArray(worker.metrics) ? worker.metrics : [];
        const cycle = worker.status === "working"
          ? "Working now"
          : worker.nextRunAt
            ? `Active watch · next in ${relativeCycle(worker.nextRunAt)}`
            : worker.lastRunAt
              ? `Read ${relativeCycle(worker.lastRunAt)}`
              : "Waiting";
        return `<article class="overview-worker-row" data-status="${escapeHtml(worker.status)}">
          <div class="overview-worker-identity"><i>${escapeHtml(worker.initials)}</i><span><strong>${escapeHtml(worker.name)}</strong><small>${escapeHtml(worker.role)}</small></span></div>
          <div class="overview-worker-state"><i></i><strong>${escapeHtml(worker.status)}</strong></div>
          <div class="overview-worker-task"><strong>${escapeHtml(worker.task)}</strong><small>${escapeHtml(worker.finding)}</small></div>
          <div class="overview-worker-metrics">${metrics.map((metric) => `<span><small>${escapeHtml(metric.label)}</small><strong>${escapeHtml(metric.value)}</strong></span>`).join("")}</div>
          <div class="overview-worker-cycle"><strong>${escapeHtml(cycle)}</strong><small>${escapeHtml(worker.evidence)}</small>${worker.details?.length ? `<button type="button" data-worker-drawer="${escapeHtml(worker.id)}">Details</button>` : ""}</div>
        </article>`;
      }).join("")
    : `<div class="overview-empty-row"><strong>Worker status unavailable</strong><span>Refresh Stock Office to read the live scheduler.</span></div>`;
}

function toggleMarketWorkers() {
  state.operationsCollapsed = !state.operationsCollapsed;
  try {
    window.localStorage.setItem("stock-office:operations-collapsed", state.operationsCollapsed ? "1" : "0");
  } catch {
    // The preference is optional; the current session still updates immediately.
  }
  renderMarketWorkers();
}

function renderNotificationStatus() {
  const status = state.notificationStatus || {};
  const approval = state.notificationApproval || {};
  const label = status.enabled ? "Telegram live" : status.recoveryRequired ? "Telegram restore" : status.configured ? "Telegram approval" : "Telegram off";
  const overviewPill = $("#notificationStatusPill");
  if (overviewPill) {
    overviewPill.textContent = label;
    overviewPill.className = `status-pill ${status.enabled ? "ready" : status.configured ? "warning" : "muted"}`;
  }
  const panelPill = $("#telegramPanelStatus");
  panelPill.textContent = status.enabled ? "Alerts active" : status.recoveryRequired ? "Restore credentials" : status.configured ? "Approval required" : "Not configured";
  panelPill.className = `status-pill ${status.enabled ? "ready" : status.configured ? "warning" : "muted"}`;
  $("#telegramDestination").textContent = status.destination || "Telegram not configured";
  $("#telegramSummary").textContent = status.enabled
    ? "Qualified BUY/SELL reviews and broker-confirmed orders will notify this destination."
    : status.recoveryRequired
      ? "Your approved Telegram scope survived, but the secure bot token and chat ID are missing. Re-enter the same destination once to restore alerts."
    : status.configured
      ? approval.status === "approved" ? "Human Gate approved this destination. Enable it once." : "Credentials are secure. Human Gate must approve automatic alerts."
      : "Qualified trade alerts and broker outcomes will notify this destination.";
  const recent = Array.isArray(status.recent) ? status.recent : [];
  $("#telegramRecent").innerHTML = recent.length
    ? recent.map((item) => `<span data-status="${escapeHtml(item.status)}"><i></i><strong>${escapeHtml(String(item.kind || "notification").replaceAll("_", " "))}</strong><small>${escapeHtml(item.sentAt ? formatTime(item.sentAt) : item.status)}</small></span>`).join("")
    : `<span><i></i><strong>No messages sent</strong><small>Verified events will appear here.</small></span>`;
  $("#telegramConfigForm").hidden = status.configured;
  $("#telegramApprovalButton").hidden = !status.configured || status.enabled || ["pending", "approved"].includes(approval.status);
  $("#telegramEnableButton").hidden = approval.status !== "approved" || status.enabled;
  $("#telegramTestButton").hidden = !status.enabled;
  $("#telegramDisableButton").hidden = !status.enabled;
  $("#telegramRemoveButton").hidden = !status.configured;
  if (status.lastError) $("#telegramFeedback").textContent = status.lastError;
}

function managerStatusLabel(value) {
  const labels = {
    paused: "Paused",
    starting: "Starting",
    healthy: "Healthy",
    watching: "Watching",
    attention: "Needs attention",
  };
  return labels[String(value || "paused")] || String(value || "paused").replaceAll("_", " ");
}

function managerMetricEntries(manager = {}) {
  const metrics = manager.metrics || {};
  if (manager.id === "research") {
    return [
      ["Records", metrics.records ?? 0],
      ["BUY/SELL ideas", metrics.actionable ?? 0],
      ["Qualified", metrics.qualified ?? 0],
      ["Board eligible", metrics.boardEligible ?? 0],
    ];
  }
  return [
    ["Candidates", metrics.candidates ?? 0],
    ["Covered", metrics.covered ?? 0],
    ["Missing", metrics.missing ?? 0],
    ["Configs", formatCount(metrics.configurations || 0)],
    ["Paths", formatCount(metrics.paths || 0)],
  ];
}

function renderFlowManagers() {
  const widget = $("#stockManagersWidget");
  if (!widget) return;
  const payload = state.flowManagers || {};
  const managers = Array.isArray(payload.managers) ? payload.managers : [
    { id: "research", name: "Research Manager", enabled: false, status: "paused", summary: "Connect to the background supervisor to activate this manager.", checks: [], metrics: {} },
    { id: "simulation", name: "Simulation Manager", enabled: false, status: "paused", summary: "Connect to the background supervisor to activate this manager.", checks: [], metrics: {} },
  ];
  const activeCount = managers.filter((manager) => manager.enabled).length;
  const attentionCount = managers.filter((manager) => manager.enabled && manager.status === "attention").length;
  widget.dataset.status = attentionCount ? "attention" : activeCount ? "active" : "paused";
  $("#stockManagersTriggerStatus").textContent = attentionCount
    ? `${attentionCount} needs attention`
    : activeCount
      ? `${activeCount} active · background`
      : "Both paused";
  $("#stockManagersAttention").hidden = !attentionCount && !activeCount;
  $("#stockManagersRuntime").innerHTML = `<i></i>${escapeHtml(activeCount ? `${activeCount} manager${activeCount === 1 ? "" : "s"} validating outside this view` : "Background supervisor ready")}`;
  $("#stockManagersList").innerHTML = managers.map((manager) => {
    const enabled = manager.enabled === true;
    const checks = enabled && Array.isArray(manager.checks) ? manager.checks : [];
    const flowView = manager.id === "research" ? "mirror" : "portfolio";
    const flowLabel = manager.id === "research" ? "Open Research" : "Open Simulation";
    const checkedAt = manager.lastValidatedAt ? `Validated ${formatTime(manager.lastValidatedAt)}` : enabled ? "First validation starting" : "No validation while paused";
    return `<article class="stock-manager-card" data-manager-id="${escapeHtml(manager.id)}" data-status="${escapeHtml(manager.status || "paused")}">
      <div class="stock-manager-head">
        <i aria-hidden="true"></i>
        <span><strong>${escapeHtml(manager.name)}</strong><small>${escapeHtml(managerStatusLabel(manager.status))}</small></span>
        <button type="button" data-manager-toggle="${escapeHtml(manager.id)}" data-next-enabled="${enabled ? "false" : "true"}">${enabled ? "Pause" : "Activate"}</button>
      </div>
      <p class="stock-manager-summary">${escapeHtml(manager.summary || "Waiting for manager state.")}</p>
      ${enabled ? `<div class="stock-manager-metrics">${managerMetricEntries(manager).map(([label, value]) => `<span><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></span>`).join("")}</div>` : ""}
      ${checks.length ? `<div class="stock-manager-checks">${checks.map((item) => `<div class="stock-manager-check" data-status="${escapeHtml(item.status)}"><i aria-hidden="true"></i><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></span></div>`).join("")}</div>` : ""}
      <div class="stock-manager-actions"><button type="button" data-open-stock-view="${escapeHtml(flowView)}">${escapeHtml(flowLabel)}</button><small>${escapeHtml(checkedAt)}</small></div>
    </article>`;
  }).join("");
}

function setManagersPanel(open) {
  const panel = $("#stockManagersPanel");
  const trigger = $("#stockManagersTrigger");
  if (!panel || !trigger) return;
  panel.hidden = !open;
  trigger.setAttribute("aria-expanded", String(open));
}

async function updateStockFlowManager(managerId, enabled) {
  const button = $(`[data-manager-toggle="${CSS.escape(managerId)}"]`);
  if (button) {
    button.disabled = true;
    button.textContent = enabled ? "Activating…" : "Pausing…";
  }
  try {
    const payload = await api(`/api/stock-office/managers/${encodeURIComponent(managerId)}`, {
      method: "POST",
      body: JSON.stringify({ enabled }),
    });
    state.flowManagers = payload.flowManagers || state.flowManagers;
    renderFlowManagers();
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = error.message;
    }
  }
}

async function validateStockFlowManagers() {
  const button = $("[data-managers-refresh]");
  if (button) {
    button.disabled = true;
    button.textContent = "Validating…";
  }
  try {
    const payload = await api("/api/stock-office/managers/validate", { method: "POST", body: "{}" });
    state.flowManagers = payload.flowManagers || state.flowManagers;
    renderFlowManagers();
  } catch (error) {
    if ($("#stockManagersRuntime")) $("#stockManagersRuntime").textContent = error.message;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Validate now";
    }
  }
}

function systemLightTone(value) {
  const status = String(value || "waiting").toLowerCase();
  if (["healthy", "connected", "running", "online", "success", "active"].includes(status)) return "ready";
  if (["error", "failed", "disconnected", "offline", "unavailable", "attention", "blocked"].includes(status)) return "danger";
  return "warning";
}

function systemLightLabel(value) {
  const labels = {
    approval_required: "Approval required",
    not_configured: "Not configured",
    connected: "Connected",
    running: "Running",
    healthy: "Healthy",
    degraded: "Degraded",
    stale: "Stale",
    blocked: "Blocked",
    attention: "Needs attention",
    waiting: "Waiting",
  };
  const status = String(value || "waiting").toLowerCase();
  return labels[status] || status.replaceAll("_", " ");
}

function renderOverviewDashboard() {
  const metrics = state.overview?.metrics || {};
  const sourceHealth = state.overview?.sourceHealth || {};
  const providerHealth = state.overview?.providerHealth || {};
  const broker = state.overview?.broker || {};
  const control = state.brokerControl || {};
  const guardrails = control.guardrails || {};
  const capital = state.portfolioPlan?.capital || control.capital || {};
  const positions = Array.isArray(control.positions) && control.positions.length ? control.positions : broker.positions || [];
  const positionValue = positions.reduce((sum, position) => sum + (livePositionValue(position) || 0), 0);
  const buyingPower = numericMoney(control.buyingPowerDollars ?? broker.buyingPower);
  const cash = numericMoney(control.cashDollars ?? broker.cash);
  const stocksValue = numericMoney(control.equityValueDollars) ?? positionValue;
  const pendingDeposits = numericMoney(control.pendingDepositsDollars);
  const unsettledFunds = numericMoney(control.unsettledFundsDollars);
  const equity = numericMoney(control.accountValueDollars ?? broker.accountValue) ?? positionValue + (cash ?? buyingPower ?? 0);
  const deployed = numericMoney(capital.deployedDollars) ?? positionValue;
  const maxDeployed = numericMoney(capital.maxDeployedDollars ?? guardrails.maxTotalDollars) ?? 0;
  const dayPnl = numericMoney(control.dayPnlDollars ?? capital.dayPnlDollars);
  const dayPnlPct = numericMoney(control.dayPnlPct);
  const realizedPnl = numericMoney(control.realizedPnlDollars);
  const calculatedUnrealized = positions.reduce((sum, position) => sum + (numericMoney(position.unrealizedPnlDollars ?? position.unrealizedPnl) || 0), 0);
  const unrealizedPnl = numericMoney(control.unrealizedPnlDollars) ?? (positions.length ? calculatedUnrealized : null);
  const marketContext = state.overview?.marketContext || {};
  const marketSessionState = state.marketWorkers?.market || {};
  renderExecutionModePill();
  const capitalGoal = getCapitalGoal() || maxDeployed;
  const utilization = capitalGoal > 0 ? Math.max(0, Math.min(100, (deployed / capitalGoal) * 100)) : 0;
  const accountBand = $("#overviewAccountBand");
  accountBand.dataset.status = control.authenticationVerified ? "live" : "offline";
  $("#overviewEquity").textContent = formatMoney(equity);
  const dayPnlProvenance = control.dayPnlSource === "official_equity_previous_close" ? " · P&L from official previous close" : "";
  $("#overviewAccountMeta").textContent = `Official Robinhood total · ${positions.length} position${positions.length === 1 ? "" : "s"} · ${control.snapshotUpdatedAt ? formatTime(control.snapshotUpdatedAt) : "awaiting snapshot"}${dayPnlProvenance}`;
  $("#overviewAccountTape").innerHTML = [
    ["Buying power", buyingPower === null ? "—" : formatMoney(buyingPower), ""],
    ["Cash", cash === null ? "—" : formatMoney(cash), ""],
    ["Stocks", formatMoney(stocksValue), ""],
    ["Today P&L", dayPnl === null ? "—" : formatMoney(dayPnl), dayPnl === null ? "" : dayPnl < 0 ? "negative" : "positive"],
    ["Day %", formatBrokerPercent(dayPnlPct), dayPnlPct === null ? "" : dayPnlPct < 0 ? "negative" : "positive"],
    ["Unrealized", unrealizedPnl === null ? "—" : formatMoney(unrealizedPnl), unrealizedPnl === null ? "" : unrealizedPnl < 0 ? "negative" : "positive"],
    ["Realized", realizedPnl === null ? "—" : formatMoney(realizedPnl), realizedPnl === null ? "" : realizedPnl < 0 ? "negative" : "positive"],
    ["Pending", pendingDeposits === null ? "—" : formatMoney(pendingDeposits), ""],
    ["Unsettled", unsettledFunds === null ? "—" : formatMoney(unsettledFunds), ""],
    ["Open orders", String(control.openOrderCount || 0), ""],
  ].map(([label, value, className]) => `<span><small>${escapeHtml(label)}</small><strong class="${className}">${escapeHtml(value)}</strong></span>`).join("");
  $("#overviewPositionCount").textContent = String(positions.length);
  $("#overviewPositions").innerHTML = positions.length
    ? positions.map((position) => {
        const quantity = numericMoney(position.quantity ?? position.sharesAvailableForSells);
        const currentPrice = numericMoney(position.currentPrice);
        const value = livePositionValue(position);
        const pnl = numericMoney(position.unrealizedPnlDollars ?? position.unrealizedPnl);
        const pnlPct = Number(position.unrealizedPnlPct);
        const pnlClass = pnl === null ? "" : pnl < 0 ? "negative" : pnl > 0 ? "positive" : "";
        return `<article class="overview-position-row">
          <div class="overview-company"><span>${logoMarkup(position.symbol)}</span><small>${escapeHtml(formatShares(quantity))} shares</small></div>
          <div><small>Last</small><strong>${escapeHtml(currentPrice === null ? "—" : formatMoney(currentPrice))}</strong></div>
          <div><small>Value</small><strong>${escapeHtml(value === null ? "—" : formatMoney(value))}</strong></div>
          <div class="${pnlClass}"><small>Return</small><strong>${escapeHtml(pnl === null ? "—" : formatMoney(pnl))}</strong><em>${Number.isFinite(pnlPct) ? `${pnlPct.toFixed(2)}%` : ""}</em></div>
        </article>`;
      }).join("")
    : `<div class="overview-empty-row"><strong>No live positions</strong><span>Robinhood is connected, but no holding is available.</span></div>`;

  const totalSources = Number(sourceHealth.total || 0);
  const opportunities = Array.isArray(state.intelligence?.opportunities) ? state.intelligence.opportunities : [];
  $("#overviewFreshness").textContent = sourceHealth.stale ? `${sourceHealth.stale} stale` : sourceHealth.status || "Current";
  $("#overviewIntelSummary").innerHTML = [
    ["Researched", opportunities.length || metrics.trackedRecords || 0],
    ["High", opportunities.filter((item) => item.status === "high_priority").length],
    ["Candidates", opportunities.filter((item) => item.status === "candidate").length],
    ["Sources", totalSources ? `${sourceHealth.ready || 0}/${totalSources}` : sourceHealth.ready ?? 0],
  ].map(([label, value]) => `<span><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></span>`).join("");
  const topSetups = opportunities.filter((item) => ["high_priority", "candidate"].includes(item.status)).slice(0, 5);
  $("#overviewTopSetups").innerHTML = topSetups.length
    ? topSetups.map((item) => `<article data-opportunity-status="${escapeHtml(item.status)}"><span class="overview-setup-company">${logoMarkup(item.symbol)}</span><span>${escapeHtml(String(item.aiScore ?? "—"))}</span><span>${escapeHtml(item.thesis?.setup || "Researching")}</span><em>${escapeHtml(item.change?.trend || item.confidence || "—")}</em><button type="button" data-opportunity-drawer="${escapeHtml(item.id)}">Research</button></article>`).join("")
    : `<div class="overview-empty-row"><strong>No qualified opportunity</strong><span>No symbol currently meets the persisted research threshold.</span></div>`;

  const health = state.systemHealth || {};
  const daily = state.intelligence?.daily || {};
  const dailyResearch = daily.research || {};
  const reports = Array.isArray(daily.reports) ? daily.reports : [];
  $("#overviewDailyReportDate").textContent = daily.day ? `Today · ${daily.day}` : "Today";
  $("#overviewDailyResearchMetrics").innerHTML = [
    ["Runs", dailyResearch.runs || 0],
    ["Stocks", dailyResearch.symbolsScanned || 0],
    ["Signals", dailyResearch.signalsFound || 0],
    ["Reports", reports.length],
  ].map(([label, value]) => `<span><small>${escapeHtml(label)}</small><strong>${escapeHtml(formatCount(value))}</strong></span>`).join("");
  $("#overviewDailyResearchLatest").textContent = dailyResearch.latestCompletedAt
    ? `${dailyResearch.successfulRuns || 0} successful · last completed ${formatTime(dailyResearch.latestCompletedAt)}${reports.length ? ` · ${reports.map((report) => String(report.type || "report")).join(" + ")} report${reports.length === 1 ? "" : "s"}` : ""}`
    : "Waiting for the first completed research cycle.";
  const algorithm = daily.algorithmTests || state.simulationLab || {};
  const algorithmStatus = String(algorithm.status || "waiting").toLowerCase();
  $("#overviewAlgorithmTestStatus").textContent = systemLightLabel(algorithmStatus);
  $("#overviewAlgorithmTestStatus").dataset.status = systemLightTone(algorithmStatus);
  $("#overviewAlgorithmTestMetrics").innerHTML = [
    ["Cycles today", algorithm.cyclesToday || 0],
    ["Candidates", algorithm.candidatesTested || 0],
    ["Configs", algorithm.strategyConfigurations || 0],
    ["Paths", algorithm.scenarioPaths || 0],
  ].map(([label, value]) => `<span><small>${escapeHtml(label)}</small><strong>${escapeHtml(formatCount(value))}</strong></span>`).join("");
  $("#overviewAlgorithmTestLatest").textContent = algorithm.lastCycleAt
    ? `Cycle ${formatCount(algorithm.totalCycles || 0)} · last tested ${formatTime(algorithm.lastCycleAt)} · ${formatCount(algorithm.strategyConfigurationsPerSecond || 0)}/s configs`
    : "Autonomous paper testing runs in the background.";
  const systemLights = [
    ["Telegram", health.telegram?.status, health.telegram?.status === "connected" ? "Qualified alerts enabled" : "Approval or setup required"],
    ["Agent 101", health.agent?.status, health.agent?.detail || "Supervised agent status"],
    ["Background worker", health.backgroundWorker?.status, health.backgroundWorker?.detail || "Server-side scheduler status"],
    ["Market data", providerHealth.status || health.marketData?.status, "Provider and freshness state"],
    ["Broker", health.broker?.status, "Official account connection"],
    ["Database", health.database?.status, "Research persistence"],
  ];
  $("#overviewSystemHealth").innerHTML = systemLights.map(([label, value, detail]) => {
    const status = String(value || "waiting").toLowerCase();
    return `<span data-status="${escapeHtml(status)}" data-tone="${escapeHtml(systemLightTone(status))}" title="${escapeHtml(detail)}"><i aria-hidden="true"></i><div><small>${escapeHtml(label)}</small><strong>${escapeHtml(systemLightLabel(status))}</strong></div></span>`;
  }).join("");

  $("#overviewCapitalUse").textContent = `${formatMoney(deployed)} / ${formatMoney(capitalGoal)}`;
  $("#overviewCapitalFill").style.width = `${utilization.toFixed(1)}%`;
  $("#overviewRiskMetrics").innerHTML = [
    ["Max order", formatMoney(guardrails.maxOrderDollars)],
    ["Trades", `${capital.tradesToday ?? "—"}/${capital.maxTradesPerDay ?? guardrails.maxTradesPerDay ?? "—"}`],
    ["Daily stop", formatMoney(capital.dailyLossLimitDollars)],
    ["Position cap", formatMoney(capital.maxPositionDollars)],
  ].map(([label, value]) => `<span><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></span>`).join("");
  const primaryBlocker = control.blockers?.[0];
  const buyingPowerBlocked = /buying power|settled/i.test(primaryBlocker || "") || buyingPower === null || buyingPower <= 0;
  const action = $("#overviewAction");
  action.dataset.status = primaryBlocker ? "blocked" : "ready";
  action.innerHTML = primaryBlocker
    ? `<strong>${buyingPowerBlocked ? "New buys paused" : "Action needed"}</strong><span>${buyingPowerBlocked ? "Add settled cash, then refresh." : escapeHtml(primaryBlocker)}</span>`
    : `<strong>Account ready</strong><span>Orders require final review.</span>`;
  renderCapitalGoalPlanner();
  $("#stockStatusPill").textContent = sourceHealth.status ? `Sources: ${sourceHealth.status}` : "Read only";
  $("#safetyCopy").textContent = "Every order requires broker review and one-use Human Gate approval.";
  renderMarketWorkers();
  renderNotificationStatus();
  renderTradeProposals();
}

function renderTradeProposals() {
  document.querySelectorAll(".overview-proposal-evidence[data-proposal-research]").forEach((details) => {
    if (details.open) state.expandedProposalResearch.add(details.dataset.proposalResearch);
    else state.expandedProposalResearch.delete(details.dataset.proposalResearch);
  });
  const proposals = Array.isArray(state.portfolioPlan?.proposals) ? state.portfolioPlan.proposals : [];
  const cycle = state.portfolioPlan?.cycle || {};
  const executionSessionOpen = cycle.session?.regular === true;
  const cadenceMinutes = Number(cycle.cadenceMinutes || state.intelligenceScheduler?.activeCadenceMinutes || 5);
  const decisionCadenceSeconds = Number(cycle.decisionCadenceSeconds || 1);
  const summary = state.portfolioPlan?.summary || {};
  const nextAt = Date.parse(cycle.nextRunAt || "");
  const remainingSeconds = Number.isFinite(nextAt) ? Math.max(0, Math.ceil((nextAt - Date.now()) / 1_000)) : null;
  const cycleStatus = cycle.running
    ? "Research running now"
    : cycle.session?.regular && remainingSeconds !== null
      ? `Next full cycle ${formatCountdown(remainingSeconds)}`
      : cycle.session?.label || "Market schedule unavailable";
  const review = cycle.review || {};
  $("#overviewCycleRail").innerHTML = `
    <div class="overview-cycle-clock" data-status="${escapeHtml(cycle.running ? "working" : cycle.session?.regular ? "countdown" : "quiet")}">
      <i aria-hidden="true"></i><span><small>${escapeHtml(`${decisionCadenceSeconds}s live checks · ${cadenceMinutes}m data`)}</small><strong>${escapeHtml(cycleStatus)}</strong></span>
    </div>
    <div class="overview-cycle-decisions">
      <span class="sell"><small>SELL</small><strong>${escapeHtml(summary.sells || 0)}</strong></span>
      <span class="hold"><small>HOLD</small><strong>${escapeHtml(summary.holds || 0)}</strong></span>
      <span class="buy"><small>BUY</small><strong>${escapeHtml(summary.buys || 0)}</strong></span>
    </div>
    <div class="overview-cycle-copy"><small>Copy watch</small><strong>${escapeHtml(summary.copyWatchers || 0)} people · ${escapeHtml(summary.copySignalsObserved || 0)} signals</strong></div>
    <div class="overview-cycle-result"><small>Last decision check</small><strong>${escapeHtml(review.lastMessage || "Live readiness checks run automatically while the market is open.")}</strong></div>`;
  const decisions = new Set((state.proposalDecisions || state.portfolioPlan?.decisions || []).filter((item) => item.decision === "declined").map((item) => item.proposalId));
  const current = proposals.filter((proposal) => !decisions.has(proposal.id));
  const realOrderStates = new Set(["awaiting_human_gate", "approved", "dispatch_claimed", "submitting", "submitted", "partially_filled", "cancel_requested", "unknown_reconciling", "reconciliation_required", "dispatched", "filled"]);
  const actionCandidates = current.filter((proposal) => ["BUY", "SELL"].includes(proposal.side));
  const proposalPriority = (proposal) => {
    if (proposal.reviewState === "approved") return 0;
    if (proposal.reviewState === "awaiting_human_gate") return 1;
    if (proposal.draftEligible) return 2;
    if (proposal.side === "SELL") return 3;
    return 4;
  };
  const qualifiedCandidates = actionCandidates.filter((proposal) => proposal.draftEligible || realOrderStates.has(proposal.reviewState));
  const tradeEligibleNow = executionSessionOpen
    ? qualifiedCandidates
    : qualifiedCandidates.filter((proposal) => realOrderStates.has(proposal.reviewState));
  const visible = [...tradeEligibleNow]
    .sort((a, b) => proposalPriority(a) - proposalPriority(b) || Number(b.rankingScore || b.research?.score || 0) - Number(a.rankingScore || a.research?.score || 0))
    .slice(0, 12);
  const queueNow = Date.now();
  const queueStarts = (() => {
    try {
      return JSON.parse(window.localStorage.getItem("argentum.stockOffice.proposalQueueStarts") || "{}");
    } catch {
      return {};
    }
  })();
  const queueRemaining = (proposal) => {
    const storedStart = Number(queueStarts[proposal.id]);
    const enteredAt = Number.isFinite(storedStart) && storedStart > 0 ? storedStart : queueNow;
    if (!Number.isFinite(storedStart) || storedStart <= 0) {
      queueStarts[proposal.id] = enteredAt;
      try {
        window.localStorage.setItem("argentum.stockOffice.proposalQueueStarts", JSON.stringify(queueStarts));
      } catch {}
    }
    return Math.max(0, Math.ceil((enteredAt + 5 * 60 * 1_000 - queueNow) / 1_000));
  };
  const queuedVisible = visible.filter((proposal) => queueRemaining(proposal) > 0);
  const qualifiedNow = qualifiedCandidates.filter((proposal) => proposal.draftEligible && executionSessionOpen).length;
  const liveReady = executionSessionOpen ? qualifiedNow : 0;
  const pendingGate = qualifiedCandidates.filter((proposal) => proposal.reviewState === "awaiting_human_gate").length;
  const researchCandidates = actionCandidates.filter((proposal) => !proposal.draftEligible && !realOrderStates.has(proposal.reviewState));
  const closestCandidate = [...researchCandidates]
    .sort((a, b) => Number(b.research?.score || b.rankingScore || 0) - Number(a.research?.score || a.rankingScore || 0))[0] || null;
  const requiredScore = Number(state.brokerControl?.guardrails?.minEntryScore || 85);
  const closestScore = Number(closestCandidate?.research?.score ?? (Number(closestCandidate?.rankingScore || 0) * 100));
  const closestStatus = closestCandidate
    ? `Closest now: ${closestCandidate.symbol} ${Math.round(closestScore)}/${requiredScore}. ${closestCandidate.research?.mainRisk || closestCandidate.blockers?.[0] || "Waiting for stronger evidence."}`
    : "No current candidate has enough fresh evidence.";
  const executionLive = String(state.brokerControl?.executionMode || "PAPER").toUpperCase() === "LIVE";
  const accountVerified = state.brokerControl?.authenticationVerified === true;
  const buyingPower = Number(state.brokerControl?.buyingPowerDollars);
  const latestStoppedDraft = state.tradeDrafts.find((draft) => ["review_rejected", "reconciliation_required", "unknown_reconciling", "expired", "rejected", "cancelled"].includes(draft.status) && draft.lastDispatchError);
  $("#overviewProposalCount").textContent = pendingGate
    ? `${pendingGate} in Human Gate`
    : liveReady
      ? `${liveReady} ready for Human Gate`
      : qualifiedNow
        ? `${qualifiedNow} qualified · next regular session`
        : "0 qualified";
  $("#overviewTradeReadiness").innerHTML = `
    <div class="overview-readiness-metric"><small>BUYING POWER</small><strong>${escapeHtml(Number.isFinite(buyingPower) ? formatMoney(buyingPower) : "Unavailable")}</strong></div>
      <div class="overview-readiness-state ${liveReady || pendingGate ? "ready" : "waiting"}">
        <i aria-hidden="true"></i><span><small>ORDER QUEUE</small><strong>${escapeHtml(liveReady ? `${liveReady} ready now` : pendingGate ? `${pendingGate} awaiting approval` : qualifiedNow ? "Waiting for regular session" : "Waiting for a qualified trade")}</strong></span>
    </div>
    <button class="secondary" type="button" data-quick-order ${executionSessionOpen ? "" : "disabled"}>${escapeHtml(!executionSessionOpen ? "Regular session only" : executionLive && accountVerified ? "New real order" : "Check new order")}</button>`;
  $("#overviewProposalList").innerHTML = queuedVisible.length
    ? queuedVisible.map((proposal) => {
        const research = proposal.research || {};
        const outlook = proposal.outlook || {};
        const targetText = proposal.side === "BUY" && outlook.targetPrice
          ? `${outlookValue(outlook.targetPrice)}${Number.isFinite(Number(outlook.targetReturnPct)) ? ` · ${(Number(outlook.targetReturnPct) * 100).toFixed(1)}% · ${formatMoney(outlook.targetScenarioDollars)} scenario` : ""}`
          : proposal.side === "SELL" ? "Reduce verified holding" : "Keep monitoring position";
        const scores = proposal.scores || {};
        const scorePercent = (value) => value === null || value === undefined || !Number.isFinite(Number(value)) ? "—" : `${Math.round(Number(value))}%`;
        const reviewState = proposal.reviewState || (proposal.draftEligible ? "qualified" : "blocked");
        const waitingGate = reviewState === "awaiting_human_gate";
        const approved = reviewState === "approved";
        const liveStateClass = approved || waitingGate || proposal.draftEligible ? "ready" : proposal.researchOnly ? "recommendation" : proposal.monitoring ? "monitoring" : "blocked";
        const blocker = Array.isArray(proposal.blockers) && proposal.blockers.length
          ? proposal.blockers[0]
          : "Current live-order checks have not all passed.";
        const reviewExpiresAt = Date.parse(proposal.reviewExpiresAt || "");
        const approvalRemaining = Number.isFinite(reviewExpiresAt) ? Math.max(0, Math.ceil((reviewExpiresAt - Date.now()) / 1_000)) : null;
        const queueSeconds = proposal.researchOnly || proposal.blockers?.length > 0 ? null : queueRemaining(proposal);
        const timerLabel = proposal.researchOnly ? "RESEARCH" : proposal.blockers?.length > 0 ? "REVIEW" : formatCountdown(queueSeconds);
        return `<article class="overview-proposal ${escapeHtml(liveStateClass)}" data-proposal-id="${escapeHtml(proposal.id)}">
          <div class="overview-proposal-company">
            ${logoMarkup(proposal.symbol)}
            <div class="proposal-company-meta">
              <span class="proposal-symbol">${escapeHtml(proposal.symbol)}</span>
              <span class="proposal-timer">${escapeHtml(timerLabel)}</span>
            </div>
            <span class="proposal-side ${escapeHtml(proposal.side.toLowerCase())}">${escapeHtml(proposal.researchOnly ? "RESEARCH" : proposal.side)}</span>
          </div>
          <div class="overview-proposal-scores">
            <span><small>AI</small><strong>${escapeHtml(scorePercent(scores.ai ?? research.score))}</strong></span>
            <span><small>TECH</small><strong>${escapeHtml(scorePercent(scores.technical ?? research.score))}</strong></span>
            <span><small>COPY</small><strong>${escapeHtml(scorePercent(scores.mirror))}</strong></span>
            <span><small>RISK</small><strong>${escapeHtml(scorePercent(scores.risk))}</strong></span>
            <span><small>DATA</small><strong>${escapeHtml(scorePercent(scores.dataQuality ?? research.dataQualityScore))}</strong></span>
            <span><small>CONF</small><strong>${escapeHtml(scorePercent(scores.confidence ?? research.confidenceScore))}</strong></span>
          </div>
          <div class="overview-proposal-thesis">
            <div><span>${escapeHtml(research.recommendation || portfolioKindLabel(proposal.kind))}</span><strong>${escapeHtml(formatMoney(proposal.requestedDollars))}</strong><em>${escapeHtml(research.confidence || "unknown confidence")}</em></div>
            <p>${escapeHtml(research.mainReason || proposal.reasons?.[0] || "Proposal passed the current research planner.")}</p>
            <small>${escapeHtml(`${research.checksPassed ?? 0}/${research.checksTotal ?? 0} current checks passed`)}</small>
            <small>Risk: ${escapeHtml(research.mainRisk || "Market conditions can change before execution.")}</small>
          </div>
          <div class="overview-proposal-outlook">
            <span><small>Entry reference</small><strong>${escapeHtml(outlookValue(proposal.referencePrice))}</strong></span>
            <span><small>Market goal</small><strong>${escapeHtml(targetText)}</strong></span>
            <span><small>Projected exit</small><strong>${escapeHtml(outlook.horizonLabel || "Re-evaluate each market cycle")}</strong></span>
          </div>
          <details class="overview-proposal-evidence" data-proposal-research="${escapeHtml(proposal.id)}" ${state.expandedProposalResearch.has(proposal.id) ? "open" : ""}>
            <summary>Quick evidence</summary>
            <p><strong>Setup</strong>${escapeHtml(research.setupType || "Evaluator review")} · score ${escapeHtml(research.score ?? "—")} · ${escapeHtml(research.marketCondition || "market condition unavailable")}</p>
            <p><strong>Plan</strong>Entry ${escapeHtml(research.entryZone || "reprice before order")} · stop ${escapeHtml(outlookValue(outlook.stopPrice))}${Number.isFinite(Number(outlook.stopScenarioDollars)) ? ` · ${escapeHtml(formatMoney(outlook.stopScenarioDollars))} downside scenario` : ""} · ${escapeHtml(research.invalidationRule || "Rebuild on any evidence change.")}</p>
            <p><strong>Projected sell timing</strong>${escapeHtml(outlook.timingNote || outlook.horizonLabel || "No reliable exit time is available yet.")}</p>
            <p><strong>Evidence depth</strong>${escapeHtml(`${research.checksPassed ?? 0}/${research.checksTotal ?? 0} live checks · ${research.evidenceCompleteness === null || research.evidenceCompleteness === undefined ? "completeness unavailable" : `${Math.round(Number(research.evidenceCompleteness) * 100)}% evidence`} · ${research.dataQualityScore === null || research.dataQualityScore === undefined ? "data quality unavailable" : `${Math.round(Number(research.dataQualityScore))}% data quality`}`)}</p>
            <p><strong>Company / catalyst</strong>${escapeHtml([research.company?.name, research.company?.sector, research.company?.recommendation, research.company?.catalystSummary?.methodology].filter(Boolean).join(" · ") || "Structured company research is not available yet.")}</p>
            <p><strong>Market context</strong>${escapeHtml([research.marketContext?.alignment, research.marketContext?.relativeVolume ? `relative volume ${research.marketContext.relativeVolume}` : "", research.regimeContext?.regime, research.regimeContext?.riskState].filter(Boolean).join(" · ") || "Intraday and regime context is not available yet.")}</p>
            <p><strong>News</strong>${escapeHtml((research.news || []).slice(0, 2).map((item) => item.title).filter(Boolean).join(" · ") || "No structured news item is attached yet.")}</p>
            <p><strong>Source</strong>${escapeHtml(research.sourceLabel || "Stock Guru evaluator")}</p>
          </details>
          <div class="overview-proposal-actions">
            <button class="secondary" type="button" data-proposal-drawer="${escapeHtml(proposal.id)}">Why / Research</button>
            ${approved
                ? `<button type="button" data-order-execute="${escapeHtml(proposal.reviewDraftId)}">Review live order</button>`
                : waitingGate
                  ? `<span class="proposal-action-status pending">Gate pending${approvalRemaining === null ? "" : ` · ${escapeHtml(formatCountdown(approvalRemaining))}`}</span>`
                  : proposal.draftEligible && executionSessionOpen
                    ? `<button type="button" data-proposal-approve="${escapeHtml(proposal.id)}">Send ${escapeHtml(proposal.side)} ${escapeHtml(formatMoney(proposal.requestedDollars))} to Human Gate</button>`
                    : proposal.draftEligible
                      ? `<button type="button" disabled>Regular session only</button>`
                    : `<button type="button" data-proposal-review="${escapeHtml(proposal.id)}">${proposal.researchOnly ? "Review recommendation" : "Review &amp; recheck"}</button>`}
            ${approved || waitingGate ? "" : `<button class="secondary" type="button" data-proposal-decline="${escapeHtml(proposal.id)}">Dismiss</button>`}
            ${proposal.draftEligible && !executionSessionOpen ? `<small>${escapeHtml(`${cycle.session?.label || "Market closed"}. Research continues; live market orders wait for the regular session.`)}</small>` : proposal.draftEligible || approved || waitingGate ? "" : `<small>${escapeHtml(blocker)}</small>`}
          </div>
        </article>`;
      }).join("")
    : `<div class="overview-empty-row overview-live-empty"><strong>No qualified trade is ready yet</strong><span>Research stays in the Research view; only qualified trades appear here.</span><button class="secondary" type="button" data-open-stock-view="mirror">Open Research</button></div>`;
}

function openIntelligenceDrawer({ kicker = "INTELLIGENCE", title = "Details", tabs = [] }) {
  const drawer = $("#intelligenceDrawer");
  if (!drawer) return;
  $("#drawerKicker").textContent = kicker;
  $("#drawerTitle").textContent = title;
  const safeTabs = tabs.filter((tab) => tab && tab.label);
  const renderTab = (id) => {
    const selected = safeTabs.find((tab) => tab.id === id) || safeTabs[0];
    $("#drawerTabs").querySelectorAll("button").forEach((button) => button.classList.toggle("active", button.dataset.drawerTab === selected?.id));
    $("#drawerContent").innerHTML = selected?.html || `<div class="drawer-empty">No detail is available.</div>`;
  };
  $("#drawerTabs").innerHTML = safeTabs.map((tab, index) => `<button type="button" data-drawer-tab="${escapeHtml(tab.id)}" class="${index === 0 ? "active" : ""}">${escapeHtml(tab.label)}</button>`).join("");
  $("#drawerTabs").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => renderTab(button.dataset.drawerTab)));
  renderTab(safeTabs[0]?.id);
  if (typeof drawer.showModal === "function") drawer.showModal();
  else drawer.setAttribute("open", "");
}

function proposalDrawer(proposalId) {
  const proposal = (state.portfolioPlan?.proposals || []).find((item) => item.id === proposalId);
  if (!proposal) return;
  const research = proposal.research || {};
  const scores = proposal.scores || {};
  const evidence = Array.isArray(proposal.evidence) ? proposal.evidence : [];
  const checks = Array.isArray(proposal.blockers) ? proposal.blockers : [];
  openIntelligenceDrawer({
    kicker: `${proposal.side} PROPOSAL`,
    title: proposal.symbol,
    tabs: [
      { id: "why", label: "Why", html: `<div class="drawer-score-grid">${[["AI", scores.ai ?? research.score], ["Technical", scores.technical ?? research.score], ["Copy", scores.mirror], ["Risk", scores.risk]].map(([label, value]) => `<span><small>${escapeHtml(label)}</small><strong>${escapeHtml(value ?? "—")}</strong></span>`).join("")}</div><section><h3>Thesis</h3><p>${escapeHtml(research.mainReason || proposal.reasons?.[0] || "No thesis was recorded.")}</p></section><section><h3>Conflicting evidence</h3><p>${escapeHtml(research.mainRisk || "No explicit conflict was recorded.")}</p></section>` },
      { id: "research", label: "Research", html: `<dl class="drawer-facts"><div><dt>Setup</dt><dd>${escapeHtml(research.setupType || "—")}</dd></div><div><dt>Market</dt><dd>${escapeHtml(research.marketCondition || "—")}</dd></div><div><dt>Entry</dt><dd>${escapeHtml(research.entryZone || "Reprice before order")}</dd></div><div><dt>Last researched</dt><dd>${escapeHtml(research.lastResearchedAt ? formatTime(research.lastResearchedAt) : "—")}</dd></div><div><dt>Next review</dt><dd>${escapeHtml(research.nextReviewAt ? formatTime(research.nextReviewAt) : "—")}</dd></div></dl>${evidence.length ? `<ul class="drawer-evidence">${evidence.map((item) => `<li data-direction="${escapeHtml(item.direction)}"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.source)}</span></li>`).join("")}</ul>` : `<div class="drawer-empty">No separate persisted evidence rows are attached.</div>`}` },
      { id: "risk", label: "Risk", html: `<section><h3>Invalidation</h3><p>${escapeHtml(research.invalidationRule || "Rebuild on any evidence change.")}</p></section><section><h3>Execution blockers</h3>${checks.length ? `<ol class="drawer-blockers">${checks.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>` : `<p>Current draft checks pass. Final account, price, duplicate-order, approval, and broker checks still run at execution.</p>`}</section>` },
      { id: "source", label: "Source", html: `<dl class="drawer-facts"><div><dt>Source</dt><dd>${escapeHtml(research.sourceLabel || "Stock Guru evaluator")}</dd></div><div><dt>Fresh</dt><dd>${research.dataFresh ? "Yes" : "No / unavailable"}</dd></div><div><dt>Score method</dt><dd>${escapeHtml(scores.formula?.description || "Evaluator score; missing inputs are not invented.")}</dd></div></dl>${research.sourceUrl ? `<a href="${escapeHtml(research.sourceUrl)}" target="_blank" rel="noreferrer">Open original evidence ↗</a>` : ""}` },
      { id: "execution", label: "Execution", html: `<dl class="drawer-facts"><div><dt>State</dt><dd>${escapeHtml(proposal.reviewState || (proposal.draftEligible ? "qualified" : "blocked"))}</dd></div><div><dt>Amount</dt><dd>${escapeHtml(formatMoney(proposal.requestedDollars))}</dd></div><div><dt>Reference</dt><dd>${escapeHtml(outlookValue(proposal.referencePrice))}</dd></div><div><dt>Approval</dt><dd>One immutable Human Gate request; one-use broker claim</dd></div></dl><p class="drawer-boundary">Approval never skips fresh broker state, market freshness, risk, duplicate-order, price-drift, and Robinhood review checks.</p>` },
    ],
  });
}

function opportunityDrawer(opportunityId) {
  const opportunity = (state.intelligence?.opportunities || []).find((item) => item.id === opportunityId);
  if (!opportunity) return;
  openIntelligenceDrawer({
    kicker: "PERSISTENT OPPORTUNITY",
    title: opportunity.symbol,
    tabs: [
      { id: "research", label: "Research", html: `<div class="drawer-score-grid">${[["Opportunity", opportunity.overallScore], ["Confidence", opportunity.confidenceScore], ["Technical", opportunity.technicalScore], ["Risk", opportunity.riskScore]].map(([label, value]) => `<span><small>${escapeHtml(label)}</small><strong>${escapeHtml(value === null || value === undefined ? "—" : Math.round(value))}</strong></span>`).join("")}</div><section><h3>${escapeHtml(opportunity.thesis?.setup || "Research thesis")}</h3><p>${escapeHtml(opportunity.thesis?.reason || "No thesis statement was persisted.")}</p></section><ul class="drawer-evidence">${(opportunity.evidence || []).map((item) => `<li data-direction="${escapeHtml(item.direction)}"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.source)}</span></li>`).join("")}</ul>` },
      { id: "score", label: "Score", html: `<div class="drawer-score-grid">${(opportunity.scoreFormula?.components || []).map((item) => `<span><small>${escapeHtml(String(item.name || "component").replaceAll("_", " "))}</small><strong>${escapeHtml(item.available === false || item.score === null ? "—" : Math.round(item.score))}</strong></span>`).join("")}</div><ul class="drawer-evidence">${(opportunity.hardGates || []).map((gate) => `<li data-direction="${gate.passed === true ? "supporting" : gate.required ? "conflicting" : "context"}"><strong>${escapeHtml(String(gate.name || "gate").replaceAll("_", " "))} · ${escapeHtml(gate.passed === true ? "pass" : gate.required ? "blocked" : "action-time")}</strong><span>${escapeHtml(gate.reason || "No reason recorded")}</span></li>`).join("")}</ul>` },
      { id: "history", label: "History", html: `<dl class="drawer-facts"><div><dt>First seen</dt><dd>${escapeHtml(formatTime(opportunity.firstSeenAt))}</dd></div><div><dt>Last researched</dt><dd>${escapeHtml(formatTime(opportunity.lastResearchedAt))}</dd></div><div><dt>Next review</dt><dd>${escapeHtml(formatTime(opportunity.nextReviewAt))}</dd></div><div><dt>Trend</dt><dd>${escapeHtml(opportunity.change?.trend || "—")} ${opportunity.change?.scoreDelta === null ? "" : `(${opportunity.change.scoreDelta >= 0 ? "+" : ""}${opportunity.change.scoreDelta})`}</dd></div></dl>` },
      { id: "risk", label: "Risk", html: `<section><h3>Main risk</h3><p>${escapeHtml(opportunity.thesis?.risk || "Unavailable")}</p></section><section><h3>Invalidation</h3><p>${escapeHtml(opportunity.thesis?.invalidation || "Unavailable")}</p></section>` },
      { id: "provenance", label: "Data", html: `<dl class="drawer-facts"><div><dt>Provider</dt><dd>${escapeHtml(opportunity.raw?.dataProvider || opportunity.marketContext?.sourceProvider || "Unavailable")}</dd></div><div><dt>Feed</dt><dd>${escapeHtml(opportunity.raw?.dataFeedType || "Unavailable")}</dd></div><div><dt>Health</dt><dd>${escapeHtml(opportunity.raw?.dataHealthState || opportunity.marketContext?.dataHealthState || "UNKNOWN")}</dd></div><div><dt>Source time</dt><dd>${escapeHtml(formatTime(opportunity.raw?.dataSourceTimestamp || opportunity.marketContext?.sourceTimestamp))}</dd></div><div><dt>Quality</dt><dd>${escapeHtml(opportunity.dataQualityScore ?? "Unavailable")}</dd></div><div><dt>Strategy</dt><dd>${escapeHtml(opportunity.scoreFormula?.version || "Unavailable")}</dd></div></dl>` },
    ],
  });
}

function workerDrawer(workerId) {
  const worker = (state.marketWorkers?.workers || []).find((item) => item.id === workerId);
  if (!worker) return;
  openIntelligenceDrawer({ kicker: "WORKER", title: worker.name, tabs: [{ id: "details", label: "Details", html: `<div class="drawer-score-grid">${(worker.metrics || []).map((metric) => `<span><small>${escapeHtml(metric.label)}</small><strong>${escapeHtml(metric.value)}</strong></span>`).join("")}</div><dl class="drawer-facts"><div><dt>Status</dt><dd>${escapeHtml(worker.status)}</dd></div><div><dt>Last run</dt><dd>${escapeHtml(worker.lastRunAt ? formatTime(worker.lastRunAt) : "—")}</dd></div><div><dt>Next run</dt><dd>${escapeHtml(worker.nextRunAt ? formatTime(worker.nextRunAt) : "—")}</dd></div><div><dt>Evidence</dt><dd>${escapeHtml(worker.evidence || "—")}</dd></div></dl><ul class="drawer-evidence">${(worker.details || []).map((item) => `<li><strong>${escapeHtml(item)}</strong></li>`).join("")}</ul>` }] });
}

function reportDrawer(reportType) {
  const report = state.intelligence?.reports?.[reportType];
  openIntelligenceDrawer({ kicker: reportType === "morning" ? "MORNING INTELLIGENCE" : "NIGHT RESEARCH", title: report?.generatedAt ? formatTime(report.generatedAt) : "Report pending", tabs: [{ id: "report", label: "Report", html: report ? `<div class="drawer-score-grid"><span><small>Researched</small><strong>${escapeHtml(report.summary?.researched || 0)}</strong></span><span><small>High</small><strong>${escapeHtml(report.summary?.highPriority || 0)}</strong></span><span><small>Candidates</small><strong>${escapeHtml(report.summary?.candidates || 0)}</strong></span><span><small>Copy matched</small><strong>${escapeHtml(report.summary?.mirrorMatched || 0)}</strong></span></div><ol class="drawer-opportunities">${(report.topOpportunities || []).slice(0, 10).map((item) => `<li><strong>${logoMarkup(item.symbol)}</strong><span>AI ${escapeHtml(item.aiScore)} · ${escapeHtml(item.status)}</span></li>`).join("")}</ol><p class="drawer-boundary">${escapeHtml(report.limitations?.[1] || report.limitations?.[0] || "Research only.")}</p>` : `<div class="drawer-empty">This report has not been generated yet. Research continues on the session-aware scheduler.</div>` }] });
}

function renderMetrics() {
  renderOverviewDashboard();
  renderPerformance();
}

function performanceRanking(items = []) {
  if (!items.length) return `<div class="performance-empty">Insufficient historical sample.</div>`;
  return items.slice(0, 8).map((item) => {
    const value = Number(item.averageReturnPct);
    const tone = !Number.isFinite(value) ? "neutral" : value > 0 ? "positive" : value < 0 ? "negative" : "neutral";
    return `<article><strong>${escapeHtml(String(item.key || "Unknown").replaceAll("_", " "))}</strong><span>${escapeHtml(item.samples)} sample${Number(item.samples) === 1 ? "" : "s"}</span><em class="${tone}">${escapeHtml(Number.isFinite(value) ? formatPercent(value, 2) : "—")}</em></article>`;
  }).join("");
}

function performanceCurveMarkup(points = []) {
  if (!points.length) return `<div class="performance-empty">Insufficient historical sample.</div>`;
  const width = 720;
  const height = 210;
  const padding = 18;
  const values = points.map((point) => Number(point.equity)).filter(Number.isFinite);
  const minimum = Math.min(1, ...values);
  const maximum = Math.max(1, ...values);
  const range = Math.max(0.01, maximum - minimum);
  const coordinates = points.map((point, index) => {
    const x = padding + (points.length === 1 ? 0.5 : index / (points.length - 1)) * (width - padding * 2);
    const y = padding + (1 - (Number(point.equity) - minimum) / range) * (height - padding * 2);
    return { x, y, ...point };
  });
  const path = coordinates.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  const baselineY = padding + (1 - (1 - minimum) / range) * (height - padding * 2);
  const latest = points[points.length - 1];
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Measured signal equity curve">
    <defs><linearGradient id="performanceArea" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#22d3ee" stop-opacity=".32"/><stop offset="1" stop-color="#22d3ee" stop-opacity="0"/></linearGradient></defs>
    <line x1="${padding}" y1="${baselineY.toFixed(2)}" x2="${width - padding}" y2="${baselineY.toFixed(2)}" class="performance-baseline"/>
    ${coordinates.length > 1 ? `<path d="${path} L${coordinates[coordinates.length - 1].x.toFixed(2)},${height - padding} L${coordinates[0].x.toFixed(2)},${height - padding} Z" class="performance-area"/>` : ""}
    <path d="${path}" class="performance-line"/>
    <circle cx="${coordinates[coordinates.length - 1].x.toFixed(2)}" cy="${coordinates[coordinates.length - 1].y.toFixed(2)}" r="4" class="performance-point"/>
  </svg><div class="performance-curve-caption"><span>${escapeHtml(points[0].at ? formatTime(points[0].at) : "First sample")}</span><strong class="${Number(latest.equity) >= 1 ? "positive" : "negative"}">${escapeHtml(formatPercent(Number(latest.equity) - 1, 2))}</strong><span>${escapeHtml(latest.at ? formatTime(latest.at) : "Latest sample")}</span></div>`;
}

function renderPerformance() {
  const performance = state.intelligence?.performance || {};
  const summary = performance.summary || {};
  const measured = Number(summary.measuredSignals || 0);
  const sufficient = measured >= 20;
  const sampleState = $("#performanceSampleState");
  if (!sampleState) return;
  sampleState.textContent = sufficient ? `${measured} measured signals` : `Insufficient sample · ${measured}/20`;
  sampleState.dataset.status = sufficient ? "ready" : "limited";
  $("#performanceTopline").innerHTML = [
    ["Signals", summary.totalSignals || 0],
    ["Measured", measured],
    ["Win rate", measured ? formatPercent(summary.winRate, 1) : "—"],
    ["Avg winner", measured ? formatPercent(summary.averageWinnerPct, 2) : "—"],
    ["Avg loser", measured ? formatPercent(summary.averageLoserPct, 2) : "—"],
    ["Expectancy", measured ? formatPercent(summary.expectancyPct, 2) : "—"],
    ["Average R", Number.isFinite(Number(summary.averageRMultiple)) ? Number(summary.averageRMultiple).toFixed(2) : "—"],
    ["Profit factor", Number.isFinite(Number(summary.profitFactor)) ? Number(summary.profitFactor).toFixed(2) : "—"],
    ["Max drawdown", measured ? formatPercent(summary.maximumDrawdownPct, 2) : "—"],
    ["Realized P&L", formatMoney(summary.realizedBrokerPnl || 0)],
    ["Broker trades", summary.brokerTrades || 0],
  ].map(([label, value]) => `<span><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></span>`).join("");
  const curve = performance.series?.signalEquityCurve || [];
  $("#performanceCurve").innerHTML = performanceCurveMarkup(curve);
  $("#performanceCurveMeta").textContent = curve.length ? `${curve.length} immutable outcomes` : "No matured outcomes";
  const distribution = performance.series?.returnDistribution || [];
  const maxBucket = Math.max(1, ...distribution.map((item) => Number(item.count || 0)));
  $("#performanceDistribution").innerHTML = distribution.length
    ? distribution.map((item) => `<article><span>${escapeHtml(item.label)}</span><i><b style="width:${Math.max(2, (Number(item.count || 0) / maxBucket) * 100).toFixed(1)}%"></b></i><strong>${escapeHtml(item.count)}</strong></article>`).join("")
    : `<div class="performance-empty">Insufficient historical sample.</div>`;
  $("#performanceStrategies").innerHTML = performanceRanking(performance.attribution?.byStrategy || []);
  $("#performanceRegimes").innerHTML = performanceRanking(performance.attribution?.byRegime || []);
  $("#performanceSectors").innerHTML = performanceRanking(performance.attribution?.bySector || []);
  $("#performanceFeatures").innerHTML = performanceRanking(performance.attribution?.byFeatureSet || []);
  const governance = performance.strategyGovernance || {};
  $("#strategyGovernanceStatus").textContent = governance.autoActivationAllowed === false ? "Human-reviewed changes only" : "Governance unavailable";
  const versions = governance.versions || [];
  const proposals = governance.proposals || [];
  $("#strategyVersions").innerHTML = [
    ...versions.map((item) => `<article><span><i data-status="${escapeHtml(item.status)}"></i><strong>${escapeHtml(item.version)}</strong><small>${escapeHtml(item.status)}</small></span><em>${escapeHtml(item.activatedAt ? formatTime(item.activatedAt) : "Not activated")}</em></article>`),
    ...proposals.map((item) => `<article class="pending"><span><i data-status="pending"></i><strong>${escapeHtml(item.proposedVersion)}</strong><small>${escapeHtml(item.status.replaceAll("_", " "))}</small></span><em>${escapeHtml(item.createdAt ? formatTime(item.createdAt) : "Pending review")}</em></article>`),
  ].join("") || `<div class="performance-empty">The deployed strategy will appear after the next persisted research cycle.</div>`;
}

function brokerStatusLabel(value, toolContract = {}) {
  const labels = {
    live_snapshot_verified: "Live account verified",
    stale_snapshot: "Reconnect required",
    setup_required: "Connector not found",
    stock_office_link_required: toolContract.codexRegistered ? "Connected in Codex" : "Stock Office link needed",
    tool_contract_pending: "Tool check required",
  };
  return labels[value] || "Connection check needed";
}

function portfolioKindLabel(value) {
  const labels = {
    copy_entry: "Copy entry",
    copy_exit: "Copy exit",
    risk_exit: "Stop exit",
    profit_exit: "Profit-lock exit",
    strategy_exit_review: "Strategy exit",
    position_hold: "Position review",
    native_entry: "Independent scan",
  };
  return labels[value] || String(value || "review").replaceAll("_", " ");
}

function renderPortfolioPlan() {
  renderOverviewDashboard();
}

function renderShadowPortfolio() {
  const portfolio = state.shadowPortfolio || {};
  const simulation = state.simulationLab || {};
  const positions = portfolio.positions || [];
  const decisions = [...(portfolio.decisions || [])].reverse().slice(0, 8);
  const learning = portfolio.learning || {};
  const proposals = (state.portfolioPlan?.proposals || []).filter((proposal) => proposal.side === "BUY").slice(0, 12);
  const simulationByProposal = new Map((simulation.results || []).map((result) => [result.proposalId, result]));
  const status = $("#shadowPortfolioStatus");
  const running = simulation.mode === "autonomous_local_stress_test" && simulation.status === "running";
  status.textContent = running ? "AUTONOMOUS · RUNNING" : "Starting autonomous engine";
  status.className = running ? "ready-copy" : "danger-copy";
  $("#simulationCycle").textContent = running
    ? `Cycle ${simulation.cycleCount || 0} · ${formatCount(simulation.strategyConfigurationsPerSecond)} configs/sec · updated ${formatTime(simulation.lastCycleAt)}`
    : "Every current candidate will start automatically. No buttons required.";
  $("#shadowPortfolioMetrics").innerHTML = [
    ["Candidates", simulation.candidatesTested ?? 0, "all priced BUY ideas"],
    ["Strategy configs", formatCount(simulation.strategyConfigurations), "tested each cycle"],
    ["Scenario paths", formatCount(simulation.scenarioPaths), "modeled each cycle"],
    ["Config throughput", `${formatCount(simulation.strategyConfigurationsPerSecond)}/s`, "measured local compute"],
    ["Path throughput", `${formatCount(simulation.scenarioPathsPerSecond)}/s`, "measured local compute"],
    ["Cycle time", Number.isFinite(Number(simulation.durationMs)) ? `${Number(simulation.durationMs).toFixed(1)} ms` : "—", `next ${simulation.nextCycleAt ? formatTime(simulation.nextCycleAt) : "automatic"}`],
  ].map(([label, value, hint]) => metricCard(label, value, hint)).join("");
  $("#simulationCandidateCount").textContent = `${simulation.results?.length || 0} testing automatically`;
  $("#simulationCandidates").innerHTML = proposals.length
    ? proposals.map((proposal) => {
        const research = proposal.research || {};
        const result = simulationByProposal.get(proposal.id);
        const classification = String(result?.classification || "testing").replaceAll("_", " ");
        const statusTone = result?.classification === "promising_scenario" ? "ready" : result ? "running" : "blocked";
        return `<article class="simulation-candidate" data-status="${escapeHtml(statusTone)}">
          <div class="simulation-company">${logoMarkup(proposal.symbol)}<span><strong>${escapeHtml(proposal.symbol)}</strong><small>${escapeHtml(portfolioKindLabel(proposal.kind))}</small></span></div>
          <div class="simulation-score"><small>Score</small><strong>${escapeHtml(research.score ?? proposal.scores?.ai ?? "—")}</strong></div>
          <div class="simulation-thesis"><strong>${escapeHtml(research.setupType || research.mainReason || "Research candidate")}</strong><small>${escapeHtml(research.mainRisk || "Rechecked every cycle")}</small></div>
          <div class="simulation-notional"><small>Auto tested</small><strong>${result ? `${formatCount(result.configurationsTested)} × ${formatCount(result.pathsPerConfiguration)}` : "Starting"}</strong></div>
          <div class="simulation-action"><span>${escapeHtml(classification)}</span>${result
            ? `<small>${escapeHtml(`${formatPercent(result.finishPositiveRate)} positive · ${formatPercent(result.expectedReturnPct)} expected · ${formatPercent(result.downsideP10Pct)} P10`)}</small>`
            : `<small>Queued for the next autonomous cycle.</small>`}</div>
        </article>`;
      }).join("")
    : `<div class="empty-state"><p>The autonomous engine is running, but no current BUY proposal has a valid reference price. It will test the next persisted candidate automatically.</p></div>`;
  $("#shadowPositionTitle").textContent = `${positions.length} position${positions.length === 1 ? "" : "s"}`;
  $("#shadowPositions").innerHTML = positions.length
    ? positions.map((position) => `
        <article class="shadow-row">
          <div><strong>${escapeHtml(position.symbol)}</strong><span>${escapeHtml(position.entryKind === "copy_entry" ? position.traderName || "Copy signal" : "Evaluator")}</span></div>
          <div><b>${escapeHtml(formatMoney(position.marketValueDollars))}</b><small>${escapeHtml(Number(position.quantity || 0).toFixed(6))} shares</small></div>
          <div class="${Number(position.unrealizedPnlDollars) >= 0 ? "ready-copy" : "danger-copy"}"><b>${escapeHtml(formatMoney(position.unrealizedPnlDollars))}</b><small>${escapeHtml(formatMoney(position.avgEntryPrice))} entry</small></div>
        </article>
      `).join("")
    : `<div class="empty-state"><p>No paper position is open. The engine waits for fresh, eligible copy or evaluator evidence.</p></div>`;
  $("#shadowDecisions").innerHTML = decisions.length
    ? decisions.map((decision) => `
        <article class="shadow-row decision">
          <div><strong>${escapeHtml(decision.action)} ${escapeHtml(decision.symbol)}</strong><span>${escapeHtml(String(decision.outcome || "blocked").replaceAll("_", " "))}</span></div>
          <p>${escapeHtml(decision.reason || "Paper review recorded.")}</p>
          <small>${escapeHtml(formatTime(decision.observedAt))}</small>
        </article>
      `).join("")
    : `<div class="empty-state"><p>No paper decision has been recorded yet.</p></div>`;
  const profiles = learning.profiles || [];
  $("#shadowLearning").innerHTML = `
    <div class="simulation-paper-capital">
      <span><small>Paper equity</small><strong>${escapeHtml(formatMoney(portfolio.equityDollars))}</strong></span>
      <span><small>Paper cash</small><strong>${escapeHtml(formatMoney(portfolio.cashDollars))}</strong></span>
      <span><small>Paper P&amp;L</small><strong class="${Number(portfolio.totalPnlDollars) >= 0 ? "ready-copy" : "danger-copy"}">${escapeHtml(formatMoney(portfolio.totalPnlDollars))}</strong></span>
      <span><small>Drawdown</small><strong>${escapeHtml(formatPercent(portfolio.currentDrawdownPct || 0))}</strong></span>
    </div>
    <div class="simulation-accuracy-grid">
      <span><small>Closed</small><strong>${escapeHtml(learning.closedTrades || 0)}</strong></span>
      <span><small>Hit rate</small><strong>${learning.hitRate === null || learning.hitRate === undefined ? "—" : escapeHtml(formatPercent(learning.hitRate))}</strong></span>
      <span><small>Expectancy</small><strong>${learning.expectancyDollars === null || learning.expectancyDollars === undefined ? "—" : escapeHtml(formatMoney(learning.expectancyDollars))}</strong></span>
      <span><small>Realized</small><strong>${escapeHtml(formatMoney(learning.totalRealizedPnlDollars || 0))}</strong></span>
    </div>
    ${learning.closedTrades
      ? profiles.slice(0, 6).map((profile) => `
        <article class="shadow-row learning">
          <div><strong>${escapeHtml(profile.label)}</strong><span>${profile.trades} closed paper trade${profile.trades === 1 ? "" : "s"}</span></div>
          <div><b>${escapeHtml(formatMoney(profile.totalPnlDollars))}</b><small>${profile.hitRate === null ? "no hit rate" : escapeHtml(formatPercent(profile.hitRate))}</small></div>
          <div><b>${escapeHtml(formatMoney(profile.expectancyDollars))}</b><small>paper expectancy</small></div>
        </article>
      `).join("")
      : `<div class="simulation-sample-warning"><strong>Measured accuracy is still building</strong><span>Scenario percentages above are stress tests. Hit rate appears only after paper positions close.</span></div>`}`;
  const startingCash = $("#shadowStartingCash");
  if (!startingCash.dataset.loaded && portfolio.initialCashDollars > 0) {
    startingCash.value = portfolio.initialCashDollars;
    startingCash.dataset.loaded = "true";
  }
}

function renderIntelligenceMonitor() {
  const scheduler = state.intelligenceScheduler || {};
  const result = scheduler.lastResult || {};
  const history = [...(scheduler.history || [])].reverse().slice(0, 4);
  const status = $("#intelligenceStatus");
  if (!status) return;
  const healthy = scheduler.enabled && !scheduler.running && ["idle", "success", "skipped"].includes(result.status || "idle");
  status.textContent = !scheduler.enabled
    ? "Paused by environment"
    : scheduler.running
      ? `Running · ${String(scheduler.currentStage || "refreshing").replaceAll("_", " ")}`
      : result.status === "failed"
        ? "Last cycle failed safely"
        : result.status === "partial"
          ? "Current with warnings"
          : scheduler.lastCompletedAt
            ? "Continuous refresh active"
            : "First cycle scheduled";
  status.className = healthy ? "ready-copy" : scheduler.running ? "ready-copy" : "danger-copy";
  $("#intelligenceMetrics").innerHTML = [
    ["Active cadence", formatCadence(scheduler.activeCadenceMinutes), "weekdays 8am–6pm ET"],
    ["Quiet cadence", formatCadence(scheduler.quietCadenceMinutes), "nights and weekends"],
    ["Last completed", scheduler.lastCompletedAt ? formatTime(scheduler.lastCompletedAt) : "Pending", result.status || "idle"],
    ["Next cycle", scheduler.nextRunAt ? formatTime(scheduler.nextRunAt) : scheduler.running ? "Running now" : "Pending", scheduler.marketWindow === "market_day_active" ? "active market window" : "quiet window"],
    ["SEC Form 4", scheduler.secIdentityConfigured ? formatCadence(scheduler.form4CadenceMinutes) : "Blocked", "official filing intake"],
    ["SEC 13F", scheduler.secIdentityConfigured ? formatCadence(scheduler.form13fCadenceMinutes) : "Blocked", "delayed research only"],
  ].map(([label, value, hint]) => metricCard(label, value, hint)).join("");
  const blocker = scheduler.blockers?.[0];
  const currentMessage = scheduler.running ? scheduler.currentMessage : result.errors?.[0] || result.warnings?.[0] || result.message;
  $("#intelligenceMessage").innerHTML = `
    <strong>${escapeHtml(blocker ? "Source action needed" : scheduler.running ? "Cycle in progress" : "Latest scheduler result")}</strong>
    <p>${escapeHtml(blocker || currentMessage || "The first bounded intelligence cycle is scheduled.")}</p>
  `;
  $("#intelligenceHistory").innerHTML = history.length
    ? history.map((run) => `
        <article class="intelligence-run ${escapeHtml(run.status)}">
          <div><strong>${escapeHtml(String(run.trigger || "scheduled").replaceAll("_", " "))}</strong><span>${escapeHtml(run.status || "unknown")}</span></div>
          <p>${escapeHtml(run.message || "Refresh completed.")}</p>
          <small>${escapeHtml(formatTime(run.completedAt))} · SEC Form 4 ${run.includeSecForm4 ? "attempted" : "deferred"} · 13F ${run.includeSec13f ? "attempted" : "deferred"}</small>
        </article>
      `).join("")
    : `<div class="empty-state"><p>No completed intelligence cycle yet.</p></div>`;
}

function renderTradeDraft(draft) {
  const target = $("#orderDraftResult");
  if (!draft) {
    target.hidden = true;
    target.innerHTML = "";
    return;
  }
  target.hidden = false;
  const ready = draft.status === "ready_for_broker_review" && !draft.blockers?.length;
  const completed = draft.status === "filled";
  const pending = ["awaiting_human_gate", "approved", "dispatch_claimed", "submitting", "submitted", "partially_filled", "cancel_requested", "unknown_reconciling", "reconciliation_required", "dispatched"].includes(draft.status);
  const statusClassName = completed ? "ready" : pending ? "warn" : ready ? "ready" : "rejected";
  const statusCopy = draft.blockers?.length
    ? `<ul>${draft.blockers.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : draft.status === "ready_for_broker_review"
      ? `<p class="order-ready-copy">Local gates passed. Robinhood must still review the order and return no warnings.</p>`
      : draft.status === "awaiting_human_gate"
        ? `<p class="order-ready-copy">Waiting for the exact one-use Human Gate decision. No broker call has occurred.</p>`
        : draft.status === "approved"
          ? `<p class="order-ready-copy">Human Gate approved this exact fingerprint. A one-use broker-review claim may now be issued; placement is still not automatic.</p>`
          : draft.status === "dispatch_claimed"
            ? `<p class="order-ready-copy">A two-minute one-use dispatch is active. Robinhood review must complete first; a second claim is blocked.</p>`
            : draft.status === "reconciliation_required"
              ? `<p class="order-ready-copy">A placement attempt was reported, but Stock Office could not independently match the exact order in fresh Robinhood history. The approval is consumed and placement will not be retried.</p>`
            : completed
              ? `<p class="order-ready-copy">Broker order independently reconciled as ${escapeHtml(draft.brokerState || draft.status)}${draft.brokerOrderId ? ` · ${escapeHtml(draft.brokerOrderId)}` : ""}. The approval has been consumed.</p>`
              : `<p>${escapeHtml(draft.lastDispatchError || "This order draft did not advance to broker placement.")}</p>`;
  const gateLabel = ready
    ? "Send exact order to Human Gate"
    : draft.status === "awaiting_human_gate"
      ? "Awaiting Human Gate"
      : draft.status === "approved"
        ? "Approved · broker review required"
        : draft.status === "dispatch_claimed"
          ? "One-use dispatch claimed"
          : completed
            ? "Approval consumed"
            : "Order blocked";
  const directExecutionReady = state.robinhoodConnection?.snapshotVerified === true && state.brokerControl?.authenticationVerified === true;
  const actionButton = ready
    ? `<button type="button" data-order-gate="${escapeHtml(draft.id)}">Send exact order to Human Gate</button>`
    : draft.status === "approved"
      ? directExecutionReady
        ? `<div class="order-actions"><button type="button" data-order-execute="${escapeHtml(draft.id)}">Review and execute once with Robinhood</button><button class="secondary" type="button" data-order-claim="${escapeHtml(draft.id)}">Prepare manual 2-minute handoff</button></div>`
        : `<button type="button" data-order-claim="${escapeHtml(draft.id)}">Prepare 2-minute Robinhood handoff</button>`
      : `<button type="button" disabled>${gateLabel}</button>`;
  const handoff = state.dispatchHandoff?.draftId === draft.id ? state.dispatchHandoff : null;
  const handoffPanel = handoff
    ? `<div class="order-handoff">
        <strong>Robinhood handoff is ready until ${escapeHtml(formatTime(handoff.claim.expiresAt))}</strong>
        <p>Copy the exact broker job into Codex. Keep this window open: the one-use claim token stays only in this page and is never copied.</p>
        <button type="button" data-copy-order-handoff="${escapeHtml(draft.id)}">Copy exact Robinhood job</button>
        <label>Exact broker job
          <textarea id="brokerHandoffJson" rows="8" readonly>${escapeHtml(JSON.stringify(brokerHandoffJob(handoff), null, 2))}</textarea>
        </label>
        <label>Broker result JSON
          <textarea id="brokerResultJson" rows="5" placeholder='{"reviewPassed":false,"warnings":["reason"],"placementAttempted":false}'></textarea>
        </label>
        <button type="button" data-record-order-result="${escapeHtml(draft.id)}">Record Robinhood result</button>
        <small id="orderHandoffFeedback" aria-live="polite">No live result recorded yet.</small>
      </div>`
    : "";
  target.dataset.status = completed || ready ? "ready" : pending ? "pending" : "blocked";
  target.innerHTML = `
    <div class="order-draft-heading">
      <div><span>${escapeHtml(draft.side)} ${escapeHtml(draft.symbol)}</span><strong>${escapeHtml(formatMoney(draft.requestedDollars))}</strong></div>
      <em class="tag ${statusClassName}">${escapeHtml(String(draft.status || "blocked").replaceAll("_", " "))}</em>
    </div>
    <p>${escapeHtml(draft.thesis || "No thesis recorded.")}</p>
    <div class="order-draft-stats">
      <span><small>Reference</small><b>${escapeHtml(formatMoney(draft.referencePrice))}</b></span>
      <span><small>Estimated shares</small><b>${escapeHtml(Number(draft.estimatedQuantity || 0).toFixed(6))}</b></span>
      <span><small>Expires</small><b>${escapeHtml(formatTime(draft.expiresAt))}</b></span>
    </div>
    ${statusCopy}
    ${actionButton}
    ${handoffPanel}
    <small>Live order placed: ${draft.liveOrderPlaced ? "yes" : "no"}</small>
  `;
}

function brokerHandoffJob(handoff) {
  return {
    version: 1,
    purpose: "execute_one_approved_robinhood_equity_order",
    claimId: handoff.claim.id,
    expiresAt: handoff.claim.expiresAt,
    policy: handoff.claim.policy,
    envelope: handoff.claim.envelope,
    instructions: [
      "Use only Robinhood's official Trading MCP and the dedicated Agentic account.",
      "Refresh get_accounts, get_portfolio, get_equity_positions, get_equity_orders, get_equity_quotes, and get_equity_tradability; stop on any account, balance, position, order, price, or tradability mismatch.",
      "Call review_equity_order with the exact envelope.reviewArgs before any placement.",
      "If review returns any warning, mismatch, repricing, or scope change, do not place the order.",
      "If review passes exactly, call place_equity_order once with envelope.placementArgs and its one-use ref_id.",
      "Return only the broker result JSON described by resultSchema; do not claim a fill without a broker order ID and state.",
    ],
    resultSchema: {
      reviewPassed: "boolean",
      warnings: ["string"],
      placementAttempted: "boolean",
      brokerOrderId: "string or empty",
      brokerState: "string or empty",
      error: "string or empty",
    },
  };
}

function renderBrokerControl() {
  const control = state.brokerControl || {};
  const connection = state.robinhoodConnection || {};
  const connectionApproval = state.connectionApproval || {};
  const guardrails = control.guardrails || {};
  const toolContract = control.toolContract || {};
  const guardrailApproval = state.guardrailApproval || {};
  const displayedGuardrails = ["pending", "approved"].includes(guardrailApproval.status) && guardrailApproval.guardrails
    ? guardrailApproval.guardrails
    : guardrails;
  const pill = $("#brokerStatusPill");
  pill.textContent = brokerStatusLabel(control.connectorStatus, toolContract);
  pill.className = `status-pill ${control.authenticationVerified ? "ready" : toolContract.registered ? "warning" : "muted"}`;
  $("#tradeAccountBar").dataset.status = control.authenticationVerified ? "ready" : "offline";
  $("#brokerAccountLabel").textContent = control.accountLabel || "Not verified";
  $("#orderKillSwitch").textContent = control.buyReady ? "Ready" : control.authenticationVerified ? "Buys paused" : "Offline";
  $("#orderKillSwitch").className = control.killSwitchActive ? "danger-copy" : "ready-copy";
  $("#tradeAccountMetrics").innerHTML = [
    ["Buying power", control.buyingPowerDollars === null || control.buyingPowerDollars === undefined ? "—" : formatMoney(control.buyingPowerDollars)],
    ["Cash", control.cashDollars === null || control.cashDollars === undefined ? "—" : formatMoney(control.cashDollars)],
    ["Account value", control.accountValueDollars === null || control.accountValueDollars === undefined ? "—" : formatMoney(control.accountValueDollars)],
    [control.dayPnlSource === "official_equity_previous_close" ? "Today P&L · quotes" : "Today P&L", control.dayPnlDollars === null || control.dayPnlDollars === undefined ? "—" : formatMoney(control.dayPnlDollars)],
    ["Positions", control.positions?.length || 0],
    ["Open orders", control.openOrderCount || 0],
  ].map(([label, value]) => `<span class="trade-account-stat"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></span>`).join("");
  $("#brokerOnboarding").innerHTML = [
    [toolContract.registered, "Official Trading MCP registered"],
    [connection.oauthAuthenticated, "Stock Office app session linked"],
    [toolContract.verified, "Endpoint and equity tools verified"],
    [control.authenticationVerified, "Dedicated Agentic account verified"],
    [control.buyingPowerDollars > 0, "Dedicated account funded with settled buying power"],
    [control.buyReady, "Fresh portfolio, quotes, risk evidence, and kill switch ready"],
  ].map(([done, label]) => `<li class="${done ? "done" : "waiting"}"><i>${done ? "✓" : "•"}</i><span>${escapeHtml(label)}</span></li>`).join("");
  const primaryBlocker = control.blockers?.[0];
  const buyingPowerBlocked = /buying power|settled/i.test(primaryBlocker || "");
  const blockerCopy = buyingPowerBlocked
    ? "No settled buying power. Add funds in Robinhood, then refresh."
    : /stale|fresh/i.test(primaryBlocker || "")
      ? "Account data needs a refresh before another order can be reviewed."
      : primaryBlocker || "Account ready.";
  const blockerPanel = $("#brokerBlockers");
  blockerPanel.dataset.status = primaryBlocker ? "blocked" : "ready";
  blockerPanel.innerHTML = primaryBlocker
    ? `<strong>${buyingPowerBlocked ? "New buys paused" : "Action needed"}</strong><span>${escapeHtml(blockerCopy)}</span>`
    : `<strong>Account ready</strong><span>Orders still require review.</span>`;

  const connectionButton = $("#brokerConnectGate");
  if (connection.oauthAuthenticated) {
    connectionButton.dataset.action = "refresh";
    connectionButton.disabled = false;
    connectionButton.textContent = connection.snapshotVerified ? "Refresh account" : "Verify account";
  } else if (connectionApproval.status === "approved" && !connectionApproval.consumedAt) {
    connectionButton.dataset.action = "oauth";
    connectionButton.disabled = false;
    connectionButton.textContent = "Complete Robinhood OAuth on desktop";
  } else if (connectionApproval.status === "pending") {
    connectionButton.dataset.action = "approval";
    connectionButton.disabled = true;
    connectionButton.textContent = "Waiting for Human Gate approval";
  } else {
    connectionButton.dataset.action = "approval";
    connectionButton.disabled = false;
    connectionButton.textContent = connection.codexRegistered ? "Link Stock Office once" : "Authorize official connection";
  }
  const connectionFeedback = $("#brokerConnectionFeedback");
  connectionFeedback.textContent = connection.lastError
    ? `Connection check stopped: ${connection.lastError}`
    : connection.snapshotVerified ? ""
      : connection.oauthAuthenticated ? "Refresh the account to finish setup."
        : connection.codexRegistered ? "Link this app to use the existing Robinhood connection."
          : "Connect Robinhood to continue.";
  connectionFeedback.hidden = !connectionFeedback.textContent;

  if (!$("#guardrailForm").dataset.loaded) {
    setInputValue("#principalDollars", displayedGuardrails.principalDollars || 25);
    setInputValue("#maxTotalDollars", displayedGuardrails.maxTotalDollars || 25);
    setInputValue("#maxOrderDollars", displayedGuardrails.maxOrderDollars || 5);
    setInputValue("#cashReserveDollars", displayedGuardrails.cashReserveDollars || 0);
    setInputValue("#dailyLossLimitPct", ((displayedGuardrails.dailyLossLimitPct || 0.02) * 100).toFixed(1));
    setInputValue("#riskPerTradePct", ((displayedGuardrails.riskPerTradePct || 0.01) * 100).toFixed(1));
    setInputValue("#maxPositions", displayedGuardrails.maxPositions || 5);
    setInputValue("#maxTradesPerDay", displayedGuardrails.maxTradesPerDay || 3);
    setInputValue("#minEntryScore", displayedGuardrails.minEntryScore || 85);
    setInputValue("#orderDollars", Math.min(displayedGuardrails.maxOrderDollars || 5, 5));
    $("#guardrailForm").dataset.loaded = "true";
  }
  const applyGuardrails = $("#applyGuardrails");
  applyGuardrails.hidden = guardrailApproval.status !== "approved";
  applyGuardrails.disabled = guardrailApproval.status !== "approved";
  if (guardrailApproval.status === "approved") {
    $("#guardrailFeedback").textContent = "Human Gate approved these exact limits. Apply them to make them the active local order policy.";
  } else if (guardrailApproval.status === "pending") {
    $("#guardrailFeedback").textContent = "Exact limits are waiting in Human Gate. Current active limits remain unchanged.";
  } else if (state.guardrailsSource?.type === "human_gate_override") {
    $("#guardrailFeedback").textContent = `Approved limits are active since ${formatTime(state.guardrailsSource.appliedAt)}. No money was moved.`;
  }
  $("#guardrailFeedback").hidden = !$("#guardrailFeedback").textContent.trim();
  renderTradeDraft(state.tradeDrafts[0] || null);
}

function mirrorStatusLabel(value) {
  return String(value || "unknown").replaceAll("_", " ");
}

function isCurrentCopyCandidate(candidate = {}) {
  const symbol = String(candidate.symbol || "").toUpperCase();
  return candidate.referenceOnly !== true
    && candidate.tickerResolved !== false
    && !symbol.startsWith("CUSIP:")
    && /^[A-Z][A-Z0-9.-]{0,11}$/.test(symbol)
    && candidate.status === "paper_ready"
    && Number(candidate.currentPrice) > 0;
}

function normalizedResearchSymbol(value) {
  const symbol = String(value || "").toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
  return /^[A-Z][A-Z0-9.-]{0,11}$/.test(symbol) ? symbol : "";
}

const researchRenderKeys = new Map();
const researchFlowAnimationStartedAt = window.performance?.now?.() || Date.now();

function renderStableHtml(selector, key, html) {
  const root = $(selector);
  if (!root || researchRenderKeys.get(selector) === key) return false;
  root.innerHTML = html;
  researchRenderKeys.set(selector, key);
  return true;
}

function researchFlowStatus(value) {
  const status = String(value || "waiting").toLowerCase();
  if (["running", "working"].includes(status)) return "working";
  if (["success", "complete", "completed", "partial", "valid_setup", "paper_ready", "buy", "watch", "review", "hold"].includes(status)) return "complete";
  if (["blocked", "failed", "rejected", "stopped"].includes(status)) return "blocked";
  return "queued";
}

function researchFlowInitials(value) {
  return String(value || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

function renderResearchFlowConveyor(selector, items, options = {}) {
  const root = $(selector);
  if (!root) return;
  const label = options.label || "RESEARCH";
  const summary = options.summary || `${items.length} persisted item${items.length === 1 ? "" : "s"}`;
  const durationSeconds = Math.max(90, Number(options.durationSeconds || items.length * 10 || 90));
  const key = JSON.stringify({ label, items: items.map((item) => [item.id, item.symbol, item.name, item.detail, item.state]) });
  root.dataset.flowState = options.working || items.some((item) => item.state === "working") ? "working" : items.length ? "active" : "waiting";
  const existingSummary = root.querySelector(".research-flow-overlay strong");
  if (existingSummary && existingSummary.textContent !== summary) existingSummary.textContent = summary;
  if (researchRenderKeys.get(selector) === key) return;
  researchRenderKeys.set(selector, key);
  const elapsedSeconds = Math.max(0, ((window.performance?.now?.() || Date.now()) - researchFlowAnimationStartedAt) / 1_000);
  root.style.setProperty("--flow-duration", `${durationSeconds}s`);
  root.style.setProperty("--flow-delay", `${-(elapsedSeconds % durationSeconds).toFixed(2)}s`);
  if (!items.length) {
    root.innerHTML = `<div class="research-flow-overlay"><span>${escapeHtml(label)}</span><strong>${escapeHtml(summary)}</strong></div><div class="research-flow-empty"><i></i><strong>${escapeHtml(options.emptyTitle || "Waiting for persisted work")}</strong><small>${escapeHtml(options.emptyCopy || "The belt starts when the background engine records its first item.")}</small></div>`;
    return;
  }
  const itemMarkup = items.map((item) => {
    const identity = item.symbol
      ? logoMarkup(item.symbol, item.name || "")
      : `<span class="research-flow-avatar">${escapeHtml(researchFlowInitials(item.name))}</span>`;
    return `<article class="research-flow-item" data-item-state="${escapeHtml(item.state)}" data-flow-item="${escapeHtml(item.id || item.symbol || item.name)}">
      <span class="research-flow-identity">${identity}</span>
      <span class="research-flow-copy"><strong>${escapeHtml(item.symbol || item.name || "Unresolved")}</strong><small>${escapeHtml(item.detail || "Persisted research")}</small></span>
      <i aria-hidden="true"></i>
    </article>`;
  }).join("");
  root.innerHTML = `
    <div class="research-flow-overlay"><span>${escapeHtml(label)}</span><strong>${escapeHtml(summary)}</strong></div>
    <div class="research-flow-window">
      <div class="research-flow-track"><div class="research-flow-segment">${itemMarkup}</div><div class="research-flow-segment" aria-hidden="true" inert>${itemMarkup}</div></div>
      <div class="research-flow-scanner" aria-hidden="true"><b></b></div>
      <div class="research-flow-rail" aria-hidden="true"></div>
    </div>`;
}

function renderResearchFlowConveyors(jobs = [], watchers = []) {
  const scheduler = state.intelligenceScheduler || {};
  const progressSymbols = [...new Set((Array.isArray(scheduler.progressSymbols) ? scheduler.progressSymbols : []).map(normalizedResearchSymbol).filter(Boolean))];
  const currentTicker = normalizedResearchSymbol(scheduler.currentTicker);
  const recordBySymbol = new Map(state.records.map((record) => [normalizedResearchSymbol(record.ticker), record]));
  const progressCompleted = Math.max(0, Math.min(progressSymbols.length, Number(scheduler.progressCompleted || 0)));
  const progressTotal = Math.max(progressSymbols.length, Number(scheduler.progressTotal || 0));
  const persistedTotal = Math.max(state.records.length, Number(state.recordTotal || 0));
  const marketItems = progressSymbols.length
    ? progressSymbols.map((symbol, index) => {
        const record = recordBySymbol.get(symbol);
        return {
          id: `market:${symbol}`,
          symbol,
          name: record?.companyName || record?.name || "",
          detail: record
            ? `${mirrorStatusLabel(record.decision || record.status || "persisted")} · score ${record.score ?? "—"}`
            : `Evaluator batch · ${index + 1}/${progressTotal || progressSymbols.length}`,
          state: record ? researchFlowStatus(record.status === "rejected" ? "blocked" : "complete") : "queued",
        };
      })
    : state.records.map((record) => ({
        id: `record:${normalizedResearchSymbol(record.ticker)}`,
        symbol: normalizedResearchSymbol(record.ticker),
        name: record.companyName || record.name || "",
        detail: `${mirrorStatusLabel(record.decision || record.status || "evaluated")} · score ${record.score ?? "—"}`,
        state: researchFlowStatus(record.status === "rejected" ? "blocked" : "complete"),
      })).filter((item) => item.symbol);
  const marketFocusIndex = Math.max(0, currentTicker ? marketItems.findIndex((item) => item.symbol === currentTicker) : progressCompleted - 1);
  const marketStart = Math.max(0, Math.min(Math.max(0, marketItems.length - 14), Math.floor(marketFocusIndex / 10) * 10));
  const visibleMarketItems = marketItems.slice(marketStart, marketStart + 14);

  const copyItems = jobs.slice(0, 24).map((job) => ({
    id: `copy:${job.id}`,
    symbol: normalizedResearchSymbol(job.symbol),
    name: job.symbol ? job.traderName : job.issuerName || job.traderName,
    detail: `${job.traderName || "Verified manager"} · ${mirrorStatusLabel(job.currentStage || job.status)}`,
    state: researchFlowStatus(job.status),
  }));
  if (!copyItems.length) {
    watchers.filter((watcher) => watcher.enabled).slice(0, 16).forEach((watcher) => copyItems.push({
      id: `watcher:${watcher.id || watcher.cik || watcher.traderName}`,
      symbol: "",
      name: watcher.traderName,
      detail: `${watcher.firmName || "Verified SEC source"} · watching`,
      state: "queued",
    }));
  }

  const runningMarket = currentTicker ? 1 : 0;
  const runningCopy = copyItems.filter((item) => item.state === "working").length;
  renderResearchFlowConveyor("#marketResearchConveyor", visibleMarketItems, {
    label: "MARKET RESEARCH",
    summary: runningMarket
      ? `Analyzing ${currentTicker} · ${progressCompleted}/${progressTotal || progressSymbols.length} · ${persistedTotal} persisted`
      : `${persistedTotal} persisted evaluator record${persistedTotal === 1 ? "" : "s"}`,
    working: Boolean(currentTicker),
    durationSeconds: 140,
    emptyTitle: "Evaluator queue is loading",
    emptyCopy: "Only real evaluator records appear on this belt.",
  });
  renderResearchFlowConveyor("#copyTradeConveyor", copyItems, {
    label: "COPY-TRADE RESEARCH",
    summary: runningCopy ? `${runningCopy} agent${runningCopy === 1 ? "" : "s"} working · ${copyItems.length} jobs` : `${copyItems.length} persisted job${copyItems.length === 1 ? "" : "s"}`,
    durationSeconds: 150,
    emptyTitle: "No copy-trader job yet",
    emptyCopy: "Verified manager signals appear here after they create a persisted research job.",
  });
}

function traderAgentStatusLabel(job = {}) {
  if (job.status === "success") return "COMPLETE";
  if (job.status === "partial") return "PARTIAL";
  if (job.status === "running") return "WORKING";
  if (job.status === "queued") return "QUEUED";
  if (job.status === "blocked") return "BLOCKED";
  return "FAILED";
}

function renderTraderAgentConveyor(jobs = []) {
  const selector = "#traderAgentJobs";
  const root = $(selector);
  if (!root) return;
  if (!jobs.length) {
    renderStableHtml(selector, "empty", `<div class="trader-lab-empty"><strong>No trader-triggered jobs yet</strong><span>Verified manager holding changes will appear here only after a persisted agent job is created.</span></div>`);
    return;
  }
  const visibleJobs = jobs.slice(0, 20);
  const key = JSON.stringify(visibleJobs.map((job) => ({
    id: job.id,
    status: job.status,
    currentStage: job.currentStage,
    message: job.message,
    durationMs: job.durationMs,
    completedAt: job.completedAt,
    stages: (job.stages || []).map((stage) => [stage.id, stage.status, stage.durationMs]),
    result: {
      artifacts: job.result?.artifactCount,
      decision: job.result?.evaluation?.decision,
      score: job.result?.evaluation?.score,
      provider: job.result?.evaluation?.dataProvider || job.result?.intraday?.sourceProvider,
      health: job.result?.evaluation?.dataHealth || job.result?.intraday?.dataHealth,
    },
  })));
  if (researchRenderKeys.get(selector) === key) return;
  researchRenderKeys.set(selector, key);
  const cardMarkup = visibleJobs.map((job) => {
    const result = job.result || {};
    const evaluation = result.evaluation || {};
    const intraday = result.intraday || {};
    const statusLabel = traderAgentStatusLabel(job);
    const stageMarkup = (job.stages || []).map((stage) => `<span data-stage-status="${escapeHtml(stage.status)}"><i></i><small>${escapeHtml(stage.label)}</small><b>${escapeHtml(stage.status === "running" ? "working" : stage.status)}</b><em>${escapeHtml(stage.durationMs ? formatResearchDuration(stage.durationMs) : stage.status === "pending" ? "—" : "<0.1s")}</em></span>`).join("");
    const retry = ["blocked", "failed", "stopped"].includes(job.status)
      ? `<button type="button" data-trader-agent-retry="${escapeHtml(job.id)}">Retry</button>`
      : "";
    return `<article class="trader-agent-conveyor-card" data-job-status="${escapeHtml(job.status)}">
      <header>
        <div class="trader-agent-symbol">${job.symbol ? logoMarkup(job.symbol) : `<i>${escapeHtml(researchFlowInitials(job.issuerName || job.traderName))}</i>`}<span><small>${escapeHtml(job.traderName || "Verified manager")}</small><strong>${escapeHtml(job.symbol || job.issuerName || "Unresolved holding")}</strong></span></div>
        <div class="trader-agent-verdict"><em>${escapeHtml(statusLabel)}</em><strong>${escapeHtml(mirrorStatusLabel(job.currentStage || "queued"))}</strong><small>${escapeHtml(job.completedAt ? `${formatResearchDuration(job.durationMs)} · ${formatTime(job.completedAt)}` : job.startedAt ? `Started ${formatTime(job.startedAt)}` : `Queued ${formatTime(job.queuedAt)}`)}</small></div>
      </header>
      <div class="trader-agent-stages">${stageMarkup}</div>
      <p>${escapeHtml(job.message || "Persisted research job waiting for its next stage.")}</p>
      <div class="trader-agent-conveyor-metrics">
        <span><small>Decision</small><b>${escapeHtml(evaluation.decision || "Pending")}</b></span>
        <span><small>Score</small><b>${escapeHtml(Number.isFinite(Number(evaluation.score)) ? evaluation.score : "—")}</b></span>
        <span><small>Data</small><b>${escapeHtml(evaluation.dataProvider || intraday.sourceProvider || "Pending")}</b></span>
        <span><small>Health</small><b>${escapeHtml(evaluation.dataHealth || intraday.dataHealth || "Pending")}</b></span>
      </div>
      <footer><span>${escapeHtml(result.artifactCount ? `${result.artifactCount} persisted artifacts` : job.securityIdentifier ? `CUSIP ${job.securityIdentifier}` : "Evidence pending")}</span>${retry}</footer>
    </article>`;
  }).join("");
  const durationSeconds = Math.max(180, visibleJobs.length * 18);
  const elapsedSeconds = Math.max(0, ((window.performance?.now?.() || Date.now()) - researchFlowAnimationStartedAt) / 1_000);
  root.style.setProperty("--agent-flow-duration", `${durationSeconds}s`);
  root.style.setProperty("--agent-flow-delay", `${-(elapsedSeconds % durationSeconds).toFixed(2)}s`);
  root.innerHTML = `<div class="trader-agent-conveyor-window"><div class="trader-agent-conveyor-track"><div class="trader-agent-conveyor-segment">${cardMarkup}</div><div class="trader-agent-conveyor-segment" aria-hidden="true" inert>${cardMarkup}</div></div><div class="trader-agent-conveyor-scan" aria-hidden="true"></div><div class="trader-agent-conveyor-rail" aria-hidden="true"></div></div>`;
}

function renderMirror() {
  const mirror = state.mirror || state.overview?.mirror || {};
  const mirrorIntelligence = state.mirrorIntelligence || state.intelligence?.mirror || {};
  const watchers = Array.isArray(mirror.watchers) ? mirror.watchers : [];
  const warnings = mirror.warnings || [];
  const importer13f = mirror.importer13f || {};
  const knowledge = mirror.knowledge || {};
  const knowledgeSummary = knowledge.summary || {};
  const simulation = state.simulationLab || {};
  const paperLearning = state.shadowPortfolio?.learning || {};
  const traderResearch = state.traderResearch || {};
  const jobs = Array.isArray(traderResearch.jobs) ? traderResearch.jobs : [];
  const activeWatchers = watchers.filter((watcher) => watcher.enabled);
  const delayedWatchers = activeWatchers.filter((watcher) => watcher.researchOnly);
  const researchSignals = Array.isArray(importer13f.researchSignals) ? importer13f.researchSignals : [];
  const unresolvedSignals = researchSignals.filter((signal) => signal.tickerResolved === false).length;
  const runningJobs = jobs.filter((job) => job.status === "running").length;
  const queuedJobs = jobs.filter((job) => job.status === "queued").length;
  const completedJobs = jobs.filter((job) => ["success", "partial"].includes(job.status)).length;
  renderResearchFlowConveyors(jobs, watchers);
  const pill = $("#mirrorStatusPill");
  pill.textContent = runningJobs ? `${runningJobs} agent${runningJobs === 1 ? "" : "s"} working` : queuedJobs ? `${queuedJobs} queued` : "Background watch active";
  pill.className = `status-pill ${runningJobs || queuedJobs || activeWatchers.length ? "ready" : "muted"}`;

  $("#mirrorMetrics").innerHTML = [
    ["Managers monitored", activeWatchers.length, `${activeWatchers.filter((watcher) => watcher.researchAgentEnabled).length} agent-enabled identities`],
    ["Filings scanned", importer13f.filingsScanned || 0, importer13f.generatedAt ? `Last SEC read ${relativeCycle(importer13f.generatedAt)}` : "First SEC read pending"],
    ["Holding changes", importer13f.holdingChangesFound || 0, `${unresolvedSignals} awaiting verified ticker`],
    ["Research agents", `${runningJobs} live · ${queuedJobs} queued`, `${completedJobs} completed with persisted evidence`],
  ].map(([label, value, hint]) => `<div><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong><span>${escapeHtml(hint)}</span></div>`).join("");

  $("#mirrorWatcherCount").textContent = `${activeWatchers.length} monitored`;
  const watcherMarkup = watchers.length
    ? watchers.map((watcher) => {
        const initials = watcher.traderName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
        const watcherJobs = jobs.filter((job) => job.traderName === watcher.name || job.traderName === watcher.traderName);
        return `<article class="trader-roster-card" data-status="${escapeHtml(watcher.enabled ? "watching" : "off")}">
          <i>${escapeHtml(initials || "TR")}</i>
          <div class="trader-roster-identity"><strong>${escapeHtml(watcher.traderName)}</strong><span>${escapeHtml(watcher.firmName)}</span><small>${escapeHtml(watcher.strategy)}</small></div>
          <div class="trader-roster-state"><em>${escapeHtml(watcher.enabled ? "WATCHING" : "OFF")}</em><b>${escapeHtml(`${watcherJobs.length} job${watcherJobs.length === 1 ? "" : "s"}`)}</b></div>
          <div class="trader-roster-meta"><span>${escapeHtml(`${watcher.filingType} · CIK ${watcher.cik}`)}</span>${watcher.identityUrl ? `<a href="${escapeHtml(watcher.identityUrl)}" target="_blank" rel="noreferrer">SEC profile</a>` : ""}</div>
        </article>`;
      }).join("")
    : `<div class="trader-lab-empty"><strong>No verified managers configured</strong><span>Add a named SEC CIK before this independent research queue can run.</span></div>`;
  renderStableHtml("#mirrorWatchers", JSON.stringify(watchers.map((watcher) => [watcher.id, watcher.cik, watcher.enabled, watcher.traderName, jobs.filter((job) => job.traderName === watcher.name || job.traderName === watcher.traderName).length])), watcherMarkup);

  $("#traderAgentCount").textContent = `${jobs.length} job${jobs.length === 1 ? "" : "s"}`;
  renderTraderAgentConveyor(jobs);

  const consensus = Array.isArray(mirrorIntelligence.consensus) ? mirrorIntelligence.consensus : [];
  $("#mirrorConsensus").innerHTML = consensus.length
    ? consensus.slice(0, 8).map((item) => `<article><span>${logoMarkup(item.symbol)}</span><strong>${escapeHtml(item.side)}</strong><b>${escapeHtml(Math.round(item.score))}</b><small>${escapeHtml(`${item.sourceCount} sources · ${relativeCycle(item.lastUpdatedAt)}`)}</small></article>`).join("")
    : `<div class="trader-lab-empty"><strong>No independent consensus</strong><span>A match appears only when at least two attributable sources align on the same stock and direction.</span></div>`;
  const profiles = knowledge.sourceProfiles || [];
  $("#knowledgeStatus").textContent = knowledge.stale
    ? "Evidence stale"
    : `${completedJobs} agent reports · ${knowledgeSummary.measuredOutcomes || 0} measured outcomes`;
  $("#knowledgeMetrics").innerHTML = [
    ["Agent reports", completedJobs],
    ["SEC changes", importer13f.holdingChangesFound || 0],
    ["Scenario paths", formatCount(simulation.scenarioPaths || 0)],
    ["Paper closes", paperLearning.closedTrades ?? 0],
    ["Copy outcomes", knowledgeSummary.measuredOutcomes ?? 0],
  ].map(([label, value]) => `<span><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></span>`).join("");
  $("#knowledgeProfiles").innerHTML = profiles.length
    ? profiles.map((profile) => `
        <article class="knowledge-profile">
          <div><strong>${escapeHtml(profile.sourceId)}</strong><small>${escapeHtml(profile.sampleSize ? `${profile.sampleSize} samples · ${formatPercent(profile.hitRate)} hit` : "No matured outcomes")}</small></div>
          <div><b>${escapeHtml(Number(profile.evidenceScore ?? 0.5).toFixed(3))}</b><em class="tag ${profile.evidenceStatus === "measured" ? "ready" : "review"}">${escapeHtml(mirrorStatusLabel(profile.evidenceStatus))}</em></div>
        </article>
      `).join("")
    : `<p class="muted-copy">Scores remain neutral until post-disclosure outcomes mature.</p>`;
  const combinedWarnings = [
    delayedWatchers.length ? `${delayedWatchers.length} 13F watcher${delayedWatchers.length === 1 ? " is" : "s are"} delayed research only; no 13F change can become an order.` : "",
    unresolvedSignals ? `${unresolvedSignals} institutional holding change${unresolvedSignals === 1 ? " needs" : "s need"} a confident Yahoo equity-name match before stock research can begin.` : "",
    ...(importer13f.warnings || []),
    ...warnings,
    ...(knowledge.warnings || []),
  ].filter(Boolean);
  $("#mirrorWarnings").innerHTML = [...new Set(combinedWarnings)].slice(0, 8).map((warning) => `<li>${escapeHtml(warning)}</li>`).join("") || `<li>No warning record was loaded.</li>`;
}

function renderRecords() {
  const total = state.records.length;
  $("#recordsTitle").textContent = `${state.recordTotal} ${state.recordTotal === 1 ? "record" : "records"}`;
  if (!total) {
    const workspaceAvailable = state.overview?.available !== false;
    const trackedRecords = Number(state.overview?.metrics?.trackedRecords || 0);
    const filtered = trackedRecords > 0;
    $("#recordsList").innerHTML = `
      <div class="empty-state">
        <div>
          <h2>${filtered ? "No records match these filters" : workspaceAvailable ? "No evaluator records are available yet" : "Stock Guru workspace is not connected"}</h2>
          <p>${filtered ? "Clear the search or choose another status, then apply the filters again." : workspaceAvailable ? "Press Refresh Stock Office to run the evaluator and rebuild the guarded mirror plan." : "Keep the Argentum source drive connected and restart the app so it can auto-discover the Stock Guru workspace."}</p>
        </div>
      </div>
    `;
    return;
  }
  $("#recordsList").innerHTML = state.records
    .map((record) => {
      const selected = record.ticker === state.selectedTicker ? " selected" : "";
      return `
        <button class="record-row${selected}" type="button" data-ticker="${escapeHtml(record.ticker)}">
          <span><strong>${escapeHtml(record.ticker)}</strong><small>${escapeHtml(record.decision || "No decision")}</small></span>
          <span><em class="tag ${escapeHtml(statusClass(record.status))}">${escapeHtml(record.status || "unknown")}</em></span>
          <span>${escapeHtml(record.score ?? "-")}</span>
          <span>${escapeHtml(record.setupType || "Unclassified")}</span>
          <span>${escapeHtml(record.mainRisk || record.rejectionReason || "No risk note")}</span>
        </button>
      `;
    })
    .join("");
}

async function selectRecord(ticker) {
  if (!ticker) return;
  state.selectedTicker = ticker;
  if ($("#orderSymbol")) $("#orderSymbol").value = ticker;
  renderRecords();
  $("#recordDetail").innerHTML = `<h2>${escapeHtml(ticker)}</h2><p>Loading record...</p>`;
  try {
    const payload = await api(`/api/stock-office/records/${encodeURIComponent(ticker)}`);
    renderRecordDetail(payload.record, payload.safety);
  } catch (error) {
    $("#recordDetail").innerHTML = `<h2>${escapeHtml(ticker)}</h2><p>${escapeHtml(error.message)}</p>`;
  }
}

function renderRecordDetail(record, safety) {
  const stats = [
    ["Status", record.status || "unknown"],
    ["Score", record.score ?? "-"],
    ["Setup", record.setupType || "Unclassified"],
    ["Updated", formatTime(record.updatedAt || record.createdAt)],
  ];
  $("#recordDetail").innerHTML = `
    <h2>${escapeHtml(record.ticker)}</h2>
    <p>${escapeHtml(record.mainRisk || record.rejectionReason || record.decision || "No risk note recorded.")}</p>
    <div class="detail-stats">
      ${stats.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}
    </div>
    <p><strong>Decision:</strong> ${escapeHtml(record.decision || "No decision recorded.")}</p>
    <small>Source: ${escapeHtml(record.provenance?.sourceLabel || record.source || "Stock Guru")} · ${escapeHtml(record.provenance?.status || "unknown")}</small>
    <small>${escapeHtml(safety || "Read-only boundary active.")}</small>
  `;
}

function renderSources() {
  const secSetup = state.secSetup || {};
  const scheduler = state.intelligenceScheduler || {};
  const operationalIds = new Set([
    "evaluations",
    "research_context",
    "universe",
    "copy_trader_config",
    "copy_trader_watchlist",
    "copy_import_status",
    "sec_13f_import_status",
    "copy_trader_plan",
    "copy_knowledge",
  ]);
  const operational = state.sources.filter((source) => operationalIds.has(source.id)).map((source) => {
    if (["copy_import_status", "sec_13f_import_status"].includes(source.id) && !secSetup.configured) {
      return { ...source, status: "setup required", summary: "Add the SEC request identity above; this is not a missing app file." };
    }
    if (["copy_import_status", "sec_13f_import_status"].includes(source.id) && source.status === "missing") {
      return { ...source, status: "scheduled", summary: `Configured. The next bounded ${source.id === "copy_import_status" ? "Form 4" : "13F"} cycle will create this dataset.` };
    }
    return source;
  });
  operational.unshift({
    id: "robinhood_live",
    label: "Robinhood Agentic account",
    status: state.brokerControl?.authenticationVerified ? "live" : "refresh required",
    summary: state.brokerControl?.authenticationVerified
      ? `Official account snapshot · ${state.brokerControl.snapshotUpdatedAt ? formatTime(state.brokerControl.snapshotUpdatedAt) : "current session"}`
      : "Refresh the official connection before using account values.",
  });
  const readyCount = operational.filter((source) => ["ready", "configured", "live", "scheduled"].includes(source.status)).length;
  const providerHealth = state.overview?.providerHealth || {};
  const providers = Array.isArray(providerHealth.providers) ? providerHealth.providers : [];
  $("#providerHealthStatus").textContent = providerHealth.status || "Unknown";
  $("#providerHealthStatus").className = `status-pill ${providerHealth.status === "HEALTHY" ? "ready" : providerHealth.status === "UNKNOWN" ? "muted" : "warning"}`;
  $("#providerHealthList").innerHTML = providers.length
    ? providers.map((provider) => `<article data-status="${escapeHtml(String(provider.status || "UNKNOWN").toLowerCase())}"><span><i></i><strong>${escapeHtml(provider.provider)}</strong><small>${escapeHtml(provider.dataType || "market data")}</small></span><em>${escapeHtml(provider.status)}</em><b>${escapeHtml(provider.latencyMs === null ? "Latency —" : `${provider.latencyMs} ms`)}</b><small>${escapeHtml(provider.lastCheckedAt ? relativeCycle(provider.lastCheckedAt) : "Never checked")}</small></article>`).join("")
    : `<div class="performance-empty">No persisted provider telemetry is available yet.</div>`;
  $("#sourceTitle").textContent = "Operational inputs";
  $("#sourceBadge").textContent = `${readyCount}/${operational.length} ready`;
  $("#sourceList").innerHTML =
    operational
      .map(
        (source) => `
          <article class="source-row">
            <div>
              <strong>${escapeHtml(source.label || source.id || "Source")}</strong>
              <small>${escapeHtml(source.summary || "No source summary.")}</small>
            </div>
            <em class="tag ${escapeHtml(statusClass(source.status))}">${escapeHtml(source.status || "unknown")}</em>
          </article>
        `,
      )
      .join("") || `<div class="empty-state"><p>No source files are mounted yet.</p></div>`;
  $("#secSetupStatus").textContent = secSetup.configured ? "Configured" : "Setup required";
  $("#secSetupStatus").className = `status-pill ${secSetup.configured ? "ready" : "warning"}`;
  $("#secSetupTitle").textContent = secSetup.configured ? "Official filing intake enabled" : "Form 4 and 13F need a contact";
  $("#secSetupSummary").textContent = secSetup.configured
    ? `Form 4 ${formatCadence(scheduler.form4CadenceMinutes)} · 13F ${formatCadence(scheduler.form13fCadenceMinutes)} · next bounded research cycle`
    : "SEC.gov requires an organization/name and a monitored email for automated filing requests.";
  $("#secIdentityForm").querySelector("button").textContent = secSetup.configured ? "Update SEC contact" : "Save SEC contact";
}

function renderActivity() {
  $("#activityList").innerHTML =
    state.activity
      .slice(0, 8)
      .map(
        (entry) => `
          <article class="activity-row">
            <strong>${escapeHtml(entry.title || entry.event || "Stock Office event")}</strong>
            <span>${escapeHtml(entry.body || entry.details || "No details recorded.")}</span>
            <span>${escapeHtml(formatTime(entry.createdAt || entry.timestamp))}</span>
          </article>
        `,
      )
      .join("") || `<div class="empty-state"><p>No Stock Office activity yet.</p></div>`;
}

function renderChat() {
  $("#stockChat").innerHTML =
    state.messages
      .slice(-8)
      .map(
        (message) => `
          <article class="chat-message ${escapeHtml(message.sender || "assistant")}">
            <strong>${escapeHtml(message.sender === "operator" ? "You" : "Stock Guru")}</strong>
            <p>${escapeHtml(message.text || "")}</p>
            ${message.citations?.length ? `<small>${escapeHtml(message.citations.map((citation) => citation.label || citation.sourceLabel).join(" · "))}</small>` : ""}
          </article>
        `,
      )
      .join("") || `<article class="chat-message assistant"><strong>Stock Guru</strong><p>Ask about market research, copy-trader signals, source delay, price drift, or live-order readiness.</p></article>`;
  $("#stockChat").scrollTop = $("#stockChat").scrollHeight;
}

function renderActiveStockView() {
  if (!state.hasRendered) return;
  renderFlowManagers();
  if (state.activeView === "overview") renderOverviewDashboard();
  else if (state.activeView === "portfolio") renderShadowPortfolio();
  else if (state.activeView === "performance") renderPerformance();
  else if (state.activeView === "mirror") renderMirror();
  else if (state.activeView === "markets") {
    renderRecords();
    if (state.selectedTicker) selectRecord(state.selectedTicker);
  } else if (state.activeView === "trade") renderBrokerControl();
  else if (state.activeView === "sources") {
    renderSources();
    renderIntelligenceMonitor();
  } else if (state.activeView === "assistant") {
    renderChat();
    renderActivity();
  }
}

function payloadFingerprint(value) {
  return JSON.stringify(value, (key, nestedValue) => {
    if (["snapshotAgeMinutes", "observedAgeMinutes", "serverTime"].includes(key)) return undefined;
    return nestedValue;
  });
}

function liveAccountPayloadFingerprint(payload = {}) {
  const control = payload.brokerControl || {};
  return payloadFingerprint({
    brokerControl: {
      connectorStatus: control.connectorStatus,
      authenticationVerified: control.authenticationVerified,
      accountLabel: control.accountLabel,
      snapshotUpdatedAt: control.snapshotUpdatedAt,
      accountValueDollars: control.accountValueDollars,
      cashDollars: control.cashDollars,
      buyingPowerDollars: control.buyingPowerDollars,
      equityValueDollars: control.equityValueDollars,
      unsettledFundsDollars: control.unsettledFundsDollars,
      pendingDepositsDollars: control.pendingDepositsDollars,
      dayPnlDollars: control.dayPnlDollars,
      dayPnlPct: control.dayPnlPct,
      realizedPnlDollars: control.realizedPnlDollars,
      unrealizedPnlDollars: control.unrealizedPnlDollars,
      positions: control.positions,
      openOrderCount: control.openOrderCount,
      killSwitchActive: control.killSwitchActive,
      executionMode: control.executionMode,
      buyReady: control.buyReady,
      blockers: control.blockers,
      guardrails: control.guardrails,
      capital: control.capital,
    },
    robinhoodConnection: payload.robinhoodConnection,
  });
}

async function loadApp() {
  if (state.loading) return;
  state.loading = true;
  $("#applyFilters").disabled = true;
  updateStockOfficePreloader("Reading the latest market state…", "market");
  try {
    const query = new URLSearchParams({
      q: $("#searchInput")?.value || "",
      status: $("#statusFilter")?.value || "all",
      sort: "score_desc",
      pageSize: "30",
    });
    const [overview, records, sources, activity, chat, mirrorPayload, brokerPayload] = await Promise.all([
      api("/api/stock-office/overview"),
      api(`/api/stock-office/records?${query.toString()}`),
      api("/api/stock-office/sources"),
      api("/api/stock-office/activity"),
      api("/api/stock-office/chat"),
      api("/api/stock-office/mirror"),
      api("/api/stock-office/broker-control"),
    ]);
    state.overview = overview;
    state.records = records.records || [];
    state.recordTotal = Number(records.total || 0);
    state.sources = sources.sources || [];
    state.secSetup = sources.secSetup || null;
    state.activity = [...(activity.syncRuns || []), ...(activity.activity || []), ...(activity.assistantRuns || [])].sort((a, b) => new Date(b.createdAt || b.timestamp || 0) - new Date(a.createdAt || a.timestamp || 0));
    state.messages = chat.messages || [];
    state.mirror = mirrorPayload.mirror || overview.mirror || null;
    state.mirrorIntelligence = mirrorPayload.mirrorIntelligence || brokerPayload.intelligence?.mirror || null;
    state.traderResearch = mirrorPayload.traderResearch || null;
    state.flowManagers = brokerPayload.flowManagers || null;
    state.intelligence = brokerPayload.intelligence || overview.intelligence || null;
    state.systemHealth = brokerPayload.systemHealth || overview.systemHealth || null;
    state.brokerControl = brokerPayload.brokerControl || null;
    state.portfolioPlan = brokerPayload.portfolioPlan || null;
    state.proposalDecisions = brokerPayload.portfolioPlan?.decisions || [];
    state.shadowPortfolio = brokerPayload.shadowPortfolio || null;
    state.simulationLab = brokerPayload.simulationLab || null;
    state.intelligenceScheduler = brokerPayload.intelligenceScheduler || null;
    state.marketWorkers = brokerPayload.marketWorkers || null;
    state.notificationStatus = brokerPayload.notificationStatus || null;
    state.notificationApproval = brokerPayload.notificationApproval || null;
    state.robinhoodConnection = brokerPayload.robinhoodConnection || null;
    state.connectionApproval = brokerPayload.connectionApproval || null;
    state.guardrailApproval = brokerPayload.guardrailApproval || null;
    state.guardrailsSource = brokerPayload.guardrailsSource || overview.guardrailsSource || null;
    state.tradeDrafts = brokerPayload.tradeDrafts || [];
    if (!state.records.some((record) => record.ticker === state.selectedTicker)) {
      state.selectedTicker = state.records[0]?.ticker || null;
    }
    state.workspacePayloadFingerprint = payloadFingerprint(brokerPayload);
    state.liveAccountFingerprint = liveAccountPayloadFingerprint(brokerPayload);
    state.hasRendered = true;
    updateStockOfficePreloader("Drawing your live Stock Office…", "account");
    renderActiveStockView();
  } catch (error) {
    $("#stockStatusPill").textContent = "Error";
    $("#recordsList").innerHTML = `<div class="empty-state"><p>${escapeHtml(error.message)}</p></div>`;
  } finally {
    state.loading = false;
    $("#applyFilters").disabled = false;
  }
}

async function sendMirrorToHumanGate(candidateId) {
  const feedback = $("#mirrorGateFeedback");
  feedback.textContent = "Creating an exact review record...";
  try {
    const payload = await api(`/api/stock-office/mirror/${encodeURIComponent(candidateId)}/human-gate`, { method: "POST", body: "{}" });
    state.mirrorApprovalIds.add(candidateId);
    feedback.textContent = payload.approval?.status === "pending"
      ? "Human Gate review created. No live order was placed."
      : "Existing Human Gate review found. No live order was placed.";
    renderMirror();
  } catch (error) {
    feedback.textContent = error.message;
  }
}

async function stageMirrorOrder(candidateId) {
  const candidate = (state.mirror?.candidates || []).find((item) => item.id === candidateId);
  const button = $(`[data-mirror-draft="${CSS.escape(candidateId)}"]`);
  const feedback = $("#mirrorGateFeedback");
  if (!candidate || !button) return;
  button.disabled = true;
  button.textContent = "Running broker checks...";
  feedback.textContent = `Building a guarded ${candidate.side} ${candidate.symbol} draft from the exact copy signal...`;
  const position = (state.brokerControl?.positions || []).find((item) => item.symbol === candidate.symbol);
  const ownedPositionValue = Number(position?.sharesAvailableForSells ?? position?.quantity ?? 0) * Number(position?.currentPrice || candidate.currentPrice || 0);
  const requestedDollars = candidate.side === "SELL" && candidate.brokerPositionRequired
    ? Math.min(ownedPositionValue, Number(state.brokerControl?.guardrails?.maxOrderDollars || 0))
    : Number(candidate.mirrorNotionalDollars || 0);
  $("#orderSymbol").value = candidate.symbol;
  $("#orderSide").value = candidate.side;
  $("#orderDollars").value = requestedDollars.toFixed(2);
  try {
    const payload = await api("/api/stock-office/orders/draft", {
      method: "POST",
      body: JSON.stringify({
        candidateId,
        symbol: candidate.symbol,
        side: candidate.side,
        requestedDollars,
      }),
    });
    state.tradeDrafts = [payload.draft, ...state.tradeDrafts.filter((item) => item.id !== payload.draft.id)];
    state.brokerControl = payload.brokerControl || state.brokerControl;
    renderBrokerControl();
    feedback.textContent = payload.draft.status === "ready_for_broker_review"
      ? "Copy signal staged as an exact guarded order draft. Review its details before Human Gate."
      : `Draft created but blocked safely: ${payload.draft.blockers?.[0] || "fresh Robinhood evidence is required"}`;
    document.querySelector(".order-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Stage guarded order";
  }
}

async function stagePortfolioProposal(proposalId) {
  const proposal = (state.portfolioPlan?.proposals || []).find((item) => item.id === proposalId);
  const button = $(`[data-portfolio-draft="${CSS.escape(proposalId)}"]`);
  const feedback = $("#portfolioPlanFeedback");
  if (!proposal || !button || !proposal.draftEligible) return;
  button.disabled = true;
  button.textContent = "Revalidating...";
  feedback.textContent = `Revalidating ${proposal.side} ${proposal.symbol} against the current official account...`;
  $("#orderSymbol").value = proposal.symbol;
  $("#orderSide").value = proposal.side;
  $("#orderDollars").value = Number(proposal.requestedDollars || 0).toFixed(2);
  try {
    const payload = await api("/api/stock-office/orders/draft", {
      method: "POST",
      body: JSON.stringify({
        candidateId: proposal.candidateId || undefined,
        symbol: proposal.symbol,
        side: proposal.side,
        requestedDollars: Number(proposal.requestedDollars || 0),
      }),
    });
    state.tradeDrafts = [payload.draft, ...state.tradeDrafts.filter((item) => item.id !== payload.draft.id)];
    state.brokerControl = payload.brokerControl || state.brokerControl;
    renderBrokerControl();
    feedback.textContent = payload.draft.status === "ready_for_broker_review"
      ? "Exact proposal staged. It still requires its own Human Gate approval and Robinhood review."
      : `Proposal changed or blocked during revalidation: ${payload.draft.blockers?.[0] || "fresh evidence required"}`;
    document.querySelector(".order-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Stage exact draft";
  }
}

async function approveOverviewProposal(proposalId) {
  const proposal = (state.portfolioPlan?.proposals || []).find((item) => item.id === proposalId);
  const feedback = $("#overviewProposalFeedback");
  const button = $(`[data-proposal-approve="${CSS.escape(proposalId)}"]`);
  if (!proposal || !proposal.draftEligible || !button) return;
  button.disabled = true;
  button.textContent = "Revalidating…";
  feedback.textContent = `Revalidating ${proposal.side} ${proposal.symbol} against current account and market evidence…`;
  try {
    const drafted = await api("/api/stock-office/orders/draft", {
      method: "POST",
      body: JSON.stringify({
        candidateId: proposal.candidateId || undefined,
        symbol: proposal.symbol,
        side: proposal.side,
        requestedDollars: Number(proposal.requestedDollars || 0),
      }),
    });
    state.tradeDrafts = [drafted.draft, ...state.tradeDrafts.filter((item) => item.id !== drafted.draft.id)];
    state.brokerControl = drafted.brokerControl || state.brokerControl;
    if (drafted.draft.status !== "ready_for_broker_review") {
      throw new Error(drafted.draft.blockers?.[0] || "Proposal changed during revalidation.");
    }
    const gated = await api(`/api/stock-office/orders/${encodeURIComponent(drafted.draft.id)}/human-gate`, { method: "POST", body: "{}" });
    if (gated.draft) state.tradeDrafts = [gated.draft, ...state.tradeDrafts.filter((item) => item.id !== gated.draft.id)];
    feedback.textContent = `${proposal.side} ${proposal.symbol} is waiting in Human Gate. No broker review or order has occurred.`;
    window.dispatchEvent(new CustomEvent("argentum:approval-created", { detail: { officeId: "stock-office" } }));
    renderBrokerControl();
  } catch (error) {
    feedback.textContent = `Proposal stopped safely: ${error.message}`;
    button.disabled = false;
    button.textContent = "Send to Human Gate";
  }
}

function openQuickOrder(symbol = "", side = "BUY", dollars = null) {
  const dialog = $("#quickOrderDialog");
  $("#quickOrderSymbol").value = String(symbol || "").toUpperCase();
  $("#quickOrderSide").value = side === "SELL" ? "SELL" : "BUY";
  if (Number.isFinite(Number(dollars)) && Number(dollars) > 0) $("#quickOrderDollars").value = Number(dollars).toFixed(2);
  else if (!$("#quickOrderDollars").value) $("#quickOrderDollars").value = Number(state.brokerControl?.guardrails?.maxOrderDollars || 5).toFixed(2);
  $("#quickOrderFeedback").textContent = "No broker order occurs from this window.";
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function reviewOverviewProposal(proposalId) {
  const proposal = (state.portfolioPlan?.proposals || []).find((item) => item.id === proposalId);
  if (!proposal) return;
  openQuickOrder(proposal.symbol, proposal.side, proposal.requestedDollars);
  const blocker = Array.isArray(proposal.blockers) ? proposal.blockers[0] : "";
  $("#quickOrderFeedback").textContent = blocker
    ? `Current blocker: ${blocker} Run live checks again to verify whether it changed.`
    : "Run live checks to confirm this candidate before it can enter Human Gate.";
}

async function submitQuickOrder(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  const feedback = $("#quickOrderFeedback");
  button.disabled = true;
  button.textContent = "Running live checks…";
  feedback.textContent = "Checking current Robinhood state, price, limits, and duplicate orders…";
  try {
    const drafted = await api("/api/stock-office/orders/draft", {
      method: "POST",
      body: JSON.stringify({
        symbol: $("#quickOrderSymbol").value,
        side: $("#quickOrderSide").value,
        requestedDollars: Number($("#quickOrderDollars").value),
      }),
    });
    state.tradeDrafts = [drafted.draft, ...state.tradeDrafts.filter((item) => item.id !== drafted.draft.id)];
    state.brokerControl = drafted.brokerControl || state.brokerControl;
    if (drafted.draft.status !== "ready_for_broker_review") {
      throw new Error(drafted.draft.blockers?.[0] || "The order did not pass current live checks.");
    }
    button.textContent = "Creating Human Gate request…";
    const gated = await api(`/api/stock-office/orders/${encodeURIComponent(drafted.draft.id)}/human-gate`, { method: "POST", body: "{}" });
    if (gated.draft) state.tradeDrafts = [gated.draft, ...state.tradeDrafts.filter((item) => item.id !== gated.draft.id)];
    feedback.textContent = `${drafted.draft.side} ${drafted.draft.symbol} is in Human Gate. No broker review or order occurred.`;
    window.dispatchEvent(new CustomEvent("argentum:approval-created", { detail: { officeId: "stock-office" } }));
    renderBrokerControl();
  } catch (error) {
    feedback.textContent = `Stopped safely: ${error.message}`;
    button.disabled = false;
    button.textContent = "Run checks & send to Human Gate";
  }
}

async function configureSecIdentity(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  const feedback = $("#secSetupFeedback");
  button.disabled = true;
  button.textContent = "Saving locally…";
  feedback.textContent = "Validating the monitored SEC contact identity…";
  try {
    const payload = await api("/api/stock-office/sources/sec-identity", {
      method: "POST",
      body: JSON.stringify({ identity: $("#secIdentity").value }),
    });
    state.secSetup = payload.secSetup;
    state.intelligenceScheduler = payload.intelligenceScheduler || state.intelligenceScheduler;
    $("#secIdentity").value = "";
    renderSources();
    renderIntelligenceMonitor();
    feedback.textContent = "Saved server-side. Official Form 4 and 13F intake will run on its bounded cadence; no trade occurred.";
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = state.secSetup?.configured ? "Update SEC contact" : "Save SEC contact";
  }
}

async function declineOverviewProposal(proposalId) {
  const proposal = (state.portfolioPlan?.proposals || []).find((item) => item.id === proposalId);
  const button = $(`[data-proposal-decline="${CSS.escape(proposalId)}"]`);
  if (!proposal || !button) return;
  button.disabled = true;
  button.textContent = "Declining…";
  try {
    const payload = await api(`/api/stock-office/proposals/${encodeURIComponent(proposalId)}/decline`, { method: "POST", body: "{}" });
    state.proposalDecisions = [payload.decision, ...state.proposalDecisions.filter((item) => item.proposalId !== proposalId)];
    $("#overviewProposalFeedback").textContent = `${proposal.side} ${proposal.symbol} dismissed locally. No approval or order was created.`;
    renderTradeProposals();
  } catch (error) {
    button.disabled = false;
    button.textContent = "Decline";
    $("#overviewProposalFeedback").textContent = error.message;
  }
}

async function requestBrokerConnection() {
  const button = $("#brokerConnectGate");
  button.disabled = true;
  button.textContent = "Creating exact connection request...";
  try {
    const payload = await api("/api/stock-office/broker-connect/human-gate", { method: "POST", body: "{}" });
    button.textContent = payload.approval?.status === "pending" ? "Connection request is in Human Gate" : "Connection request already exists";
  } catch (error) {
    button.textContent = error.message;
  } finally {
    window.setTimeout(() => { button.disabled = false; }, 1200);
  }
}

async function startRobinhoodOAuth() {
  const button = $("#brokerConnectGate");
  button.disabled = true;
  button.textContent = "Opening Robinhood OAuth...";
  try {
    const payload = await api("/api/stock-office/robinhood/oauth/start", { method: "POST", body: "{}" });
    const desktopBridge = window.argentumDesktop?.openRobinhoodOAuth;
    if (typeof desktopBridge === "function") {
      const result = await desktopBridge(payload.authorizationUrl);
      if (!result?.opened) throw new Error("The default browser did not open.");
    } else {
      const popup = window.open(payload.authorizationUrl, "_blank", "noopener,noreferrer");
      if (!popup) throw new Error("Allow pop-ups for Stock Office, then try the Robinhood connection again.");
    }
    $("#brokerConnectionFeedback").hidden = false;
    $("#brokerConnectionFeedback").textContent = "Robinhood opened. Approve it there, then return here.";
    button.textContent = "OAuth browser opened";
  } catch (error) {
    $("#brokerConnectionFeedback").hidden = false;
    $("#brokerConnectionFeedback").textContent = error.message;
    button.textContent = "Complete Robinhood OAuth on desktop";
  } finally {
    window.setTimeout(() => { button.disabled = false; }, 800);
  }
}

async function refreshRobinhoodAccount() {
  const button = $("#brokerConnectGate");
  button.disabled = true;
  button.textContent = "Reading official account...";
  try {
    const payload = await api("/api/stock-office/robinhood/refresh", { method: "POST", body: "{}" });
    state.robinhoodConnection = payload.connection || state.robinhoodConnection;
    state.brokerControl = payload.brokerControl || state.brokerControl;
    await loadApp();
  } catch (error) {
    $("#brokerConnectionFeedback").hidden = false;
    $("#brokerConnectionFeedback").textContent = error.message;
  } finally {
    button.disabled = false;
    renderBrokerControl();
  }
}

async function executeApprovedOrder(draftId) {
  const draft = state.tradeDrafts.find((item) => item.id === draftId);
  if (!draft) return;
  const confirmed = window.confirm(`Final action-time confirmation\n\n${draft.side} ${draft.symbol}\nMaximum $${Number(draft.cappedDollars || 0).toFixed(2)}\nDedicated Agentic account only\n\nRobinhood will review first. Any warning stops placement. Continue once?`);
  if (!confirmed) return;
  const button = $(`[data-order-execute="${CSS.escape(draftId)}"]`);
  if (button) {
    button.disabled = true;
    button.textContent = "Refreshing, reviewing, and reconciling...";
  }
  try {
    const payload = await api(`/api/stock-office/orders/${encodeURIComponent(draftId)}/dispatch/execute`, {
      method: "POST",
      body: JSON.stringify({ confirmationFingerprint: draft.fingerprint }),
    });
    state.tradeDrafts = [payload.draft, ...state.tradeDrafts.filter((item) => item.id !== payload.draft.id)];
    await loadApp();
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = error.message;
    }
  }
}

async function requestGuardrails(event) {
  event.preventDefault();
  const feedback = $("#guardrailFeedback");
  feedback.hidden = false;
  feedback.textContent = "Creating a fingerprinted capital-policy request...";
  try {
    const payload = await api("/api/stock-office/guardrails/human-gate", {
      method: "POST",
      body: JSON.stringify({
        principalDollars: Number($("#principalDollars").value),
        maxTotalDollars: Number($("#maxTotalDollars").value),
        maxOrderDollars: Number($("#maxOrderDollars").value),
        cashReserveDollars: Number($("#cashReserveDollars").value),
        dailyLossLimitPct: Number($("#dailyLossLimitPct").value) / 100,
        riskPerTradePct: Number($("#riskPerTradePct").value) / 100,
        maxPositions: Number($("#maxPositions").value),
        maxTradesPerDay: Number($("#maxTradesPerDay").value),
        minEntryScore: Number($("#minEntryScore").value),
      }),
    });
    state.guardrailApproval = {
      id: payload.approval?.id,
      status: payload.approval?.status,
      guardrails: payload.guardrails,
    };
    feedback.textContent = payload.approval?.status === "pending"
      ? "Exact limits sent to Human Gate. No money moved and no broker setting changed."
      : "An identical limits request is already pending.";
    renderBrokerControl();
  } catch (error) {
    feedback.textContent = error.message;
  }
}

async function applyApprovedGuardrails() {
  const approval = state.guardrailApproval;
  const button = $("#applyGuardrails");
  if (!approval?.id || approval.status !== "approved") return;
  button.disabled = true;
  button.textContent = "Applying exact limits...";
  try {
    const payload = await api("/api/stock-office/guardrails/apply", {
      method: "POST",
      body: JSON.stringify({ approvalId: approval.id }),
    });
    state.guardrailApproval = null;
    state.guardrailsSource = payload.guardrailsSource;
    state.brokerControl = payload.brokerControl;
    state.portfolioPlan = payload.portfolioPlan;
    $("#guardrailForm").dataset.loaded = "";
    renderBrokerControl();
    $("#guardrailFeedback").textContent = "Approved limits are active. No deposit, transfer, broker setting, or order occurred.";
    $("#guardrailFeedback").hidden = false;
  } catch (error) {
    $("#guardrailFeedback").textContent = error.message;
    $("#guardrailFeedback").hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "Apply approved limits";
  }
}

async function buildOrderDraft(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  button.textContent = "Running risk checks...";
  try {
    const payload = await api("/api/stock-office/orders/draft", {
      method: "POST",
      body: JSON.stringify({
        symbol: $("#orderSymbol").value,
        side: $("#orderSide").value,
        requestedDollars: Number($("#orderDollars").value),
      }),
    });
    state.tradeDrafts = [payload.draft, ...state.tradeDrafts.filter((item) => item.id !== payload.draft.id)];
    state.brokerControl = payload.brokerControl || state.brokerControl;
    renderBrokerControl();
  } catch (error) {
    $("#orderDraftResult").hidden = false;
    $("#orderDraftResult").innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  } finally {
    button.disabled = false;
    button.textContent = "Review order";
  }
}

async function sendOrderToHumanGate(draftId) {
  const button = $(`[data-order-gate="${CSS.escape(draftId)}"]`);
  if (button) {
    button.disabled = true;
    button.textContent = "Creating one-use approval...";
  }
  try {
    const payload = await api(`/api/stock-office/orders/${encodeURIComponent(draftId)}/human-gate`, { method: "POST", body: "{}" });
    if (payload.draft) {
      state.tradeDrafts = [payload.draft, ...state.tradeDrafts.filter((item) => item.id !== payload.draft.id)];
      renderTradeDraft(payload.draft);
    } else if (button) {
      button.textContent = payload.approval?.status === "pending" ? "Exact order is in Human Gate" : "Approval already exists";
    }
  } catch (error) {
    if (button) button.textContent = error.message;
  }
}

async function copyOrderHandoff(draftId) {
  const feedback = $("#orderHandoffFeedback");
  const handoff = state.dispatchHandoff;
  if (!handoff || handoff.draftId !== draftId) {
    if (feedback) feedback.textContent = "This handoff is unavailable or expired. Prepare a fresh one.";
    return false;
  }
  try {
    await navigator.clipboard.writeText(JSON.stringify(brokerHandoffJob(handoff), null, 2));
    if (feedback) feedback.textContent = "Exact Robinhood job copied. Paste it into Codex now and return the broker result before expiry.";
    return true;
  } catch (error) {
    if (feedback) feedback.textContent = `Clipboard copy failed: ${error.message}`;
    return false;
  }
}

async function claimOrderDispatch(draftId) {
  const button = $(`[data-order-claim="${CSS.escape(draftId)}"]`);
  if (button) {
    button.disabled = true;
    button.textContent = "Preparing one-use handoff...";
  }
  try {
    const payload = await api(`/api/stock-office/orders/${encodeURIComponent(draftId)}/dispatch/claim`, { method: "POST", body: "{}" });
    state.dispatchHandoff = { draftId, claim: payload.claim };
    state.tradeDrafts = [payload.draft, ...state.tradeDrafts.filter((item) => item.id !== payload.draft.id)];
    renderBrokerControl();
    await copyOrderHandoff(draftId);
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = error.message;
    }
  }
}

async function recordOrderDispatchResult(draftId) {
  const feedback = $("#orderHandoffFeedback");
  const handoff = state.dispatchHandoff;
  if (!handoff || handoff.draftId !== draftId) {
    if (feedback) feedback.textContent = "The one-use handoff token is not available in this page. Build and approve a fresh draft.";
    return;
  }
  let brokerResult;
  try {
    brokerResult = JSON.parse($("#brokerResultJson")?.value || "");
  } catch (_error) {
    if (feedback) feedback.textContent = "Paste valid broker result JSON before recording the result.";
    return;
  }
  if (!brokerResult || typeof brokerResult !== "object" || Array.isArray(brokerResult)) {
    if (feedback) feedback.textContent = "Broker result must be one JSON object.";
    return;
  }
  if (feedback) feedback.textContent = "Recording the one-use Robinhood result...";
  try {
    const payload = await api(`/api/stock-office/orders/${encodeURIComponent(draftId)}/dispatch/result`, {
      method: "POST",
      body: JSON.stringify({
        claimToken: handoff.claim.token,
        reviewPassed: brokerResult.reviewPassed === true,
        warnings: Array.isArray(brokerResult.warnings) ? brokerResult.warnings : [],
        placementAttempted: brokerResult.placementAttempted === true,
        brokerOrderId: String(brokerResult.brokerOrderId || ""),
        brokerState: String(brokerResult.brokerState || ""),
        error: String(brokerResult.error || ""),
      }),
    });
    state.dispatchHandoff = null;
    state.tradeDrafts = [payload.draft, ...state.tradeDrafts.filter((item) => item.id !== payload.draft.id)];
    renderBrokerControl();
  } catch (error) {
    if (feedback) feedback.textContent = error.message;
  }
}

async function pollBrokerControl() {
  if (state.loading || state.brokerPolling || document.hidden) return;
  state.brokerPolling = true;
  try {
    const payload = await api("/api/stock-office/broker-control");
    const fingerprint = payloadFingerprint(payload);
    if (fingerprint === state.workspacePayloadFingerprint) return;
    state.workspacePayloadFingerprint = fingerprint;
    state.brokerControl = payload.brokerControl || state.brokerControl;
    state.portfolioPlan = payload.portfolioPlan || state.portfolioPlan;
    state.intelligence = payload.intelligence || state.intelligence;
    state.mirrorIntelligence = payload.intelligence?.mirror || state.mirrorIntelligence;
    state.systemHealth = payload.systemHealth || state.systemHealth;
    state.mirror = payload.mirror || state.mirror;
    state.proposalDecisions = payload.portfolioPlan?.decisions || state.proposalDecisions;
    state.shadowPortfolio = payload.shadowPortfolio || state.shadowPortfolio;
    state.simulationLab = payload.simulationLab || state.simulationLab;
    state.intelligenceScheduler = payload.intelligenceScheduler || state.intelligenceScheduler;
    state.marketWorkers = payload.marketWorkers || state.marketWorkers;
    state.flowManagers = payload.flowManagers || state.flowManagers;
    state.notificationStatus = payload.notificationStatus || state.notificationStatus;
    state.notificationApproval = payload.notificationApproval || null;
    state.robinhoodConnection = payload.robinhoodConnection || state.robinhoodConnection;
    state.connectionApproval = payload.connectionApproval || state.connectionApproval;
    state.guardrailApproval = payload.guardrailApproval || null;
    state.guardrailsSource = payload.guardrailsSource || state.guardrailsSource;
    state.tradeDrafts = payload.tradeDrafts || state.tradeDrafts;
    const activeDraft = state.dispatchHandoff
      ? state.tradeDrafts.find((draft) => draft.id === state.dispatchHandoff.draftId)
      : null;
    if (state.dispatchHandoff && activeDraft?.status === "dispatch_claimed") return;
    if (state.dispatchHandoff) state.dispatchHandoff = null;
    state.liveAccountFingerprint = liveAccountPayloadFingerprint(payload);
    renderActiveStockView();
  } catch (_error) {
  } finally {
    state.brokerPolling = false;
  }
}

async function pollLivePortfolio() {
  if (state.loading || state.livePortfolioPolling || document.hidden) return;
  state.livePortfolioPolling = true;
  try {
    const payload = await api("/api/stock-office/live");
    const fingerprint = liveAccountPayloadFingerprint(payload);
    if (fingerprint === state.liveAccountFingerprint) return;
    state.liveAccountFingerprint = fingerprint;
    state.brokerControl = payload.brokerControl || state.brokerControl;
    state.robinhoodConnection = payload.robinhoodConnection || state.robinhoodConnection;
    if (state.activeView === "overview") renderOverviewDashboard();
    if (state.activeView === "trade") renderBrokerControl();
    if (state.activeView === "sources") renderSources();
  } catch (_error) {
  } finally {
    state.livePortfolioPolling = false;
  }
}

async function configureTelegram(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  const feedback = $("#telegramFeedback");
  button.disabled = true;
  button.textContent = "Saving securely...";
  feedback.textContent = "";
  try {
    const payload = await api("/api/stock-office/notifications/telegram/configure", {
      method: "POST",
      body: JSON.stringify({ botToken: $("#telegramBotToken").value, chatId: $("#telegramChatId").value }),
    });
    state.notificationStatus = payload.notificationStatus;
    event.currentTarget.reset();
    feedback.textContent = "Saved in local secure storage. Request Human Gate approval next.";
    renderNotificationStatus();
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Save securely";
  }
}

async function requestTelegramApproval() {
  const button = $("#telegramApprovalButton");
  const feedback = $("#telegramFeedback");
  button.disabled = true;
  button.textContent = "Creating approval...";
  try {
    const payload = await api("/api/stock-office/notifications/telegram/human-gate", { method: "POST", body: "{}" });
    state.notificationApproval = { id: payload.approval?.id, status: payload.approval?.status, expiresAt: payload.approval?.expiresAt };
    state.notificationStatus = payload.notificationStatus || state.notificationStatus;
    feedback.textContent = "Open Human Gate and approve the exact Telegram destination and event scope.";
    renderNotificationStatus();
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Request approval";
  }
}

async function enableTelegram() {
  const button = $("#telegramEnableButton");
  const feedback = $("#telegramFeedback");
  button.disabled = true;
  try {
    const payload = await api("/api/stock-office/notifications/telegram/enable", {
      method: "POST",
      body: JSON.stringify({ approvalId: state.notificationApproval?.id }),
    });
    state.notificationStatus = payload.notificationStatus;
    feedback.textContent = "Qualified trade and verified Robinhood order alerts are now active.";
    renderNotificationStatus();
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function telegramAction(action) {
  const feedback = $("#telegramFeedback");
  feedback.textContent = action === "test" ? "Sending one approved test..." : "Updating Telegram...";
  try {
    const endpoint = action === "remove" ? "/api/stock-office/notifications/telegram/configure" : `/api/stock-office/notifications/telegram/${action}`;
    const payload = await api(endpoint, {
      method: action === "remove" ? "DELETE" : "POST",
      body: action === "remove" ? undefined : "{}",
    });
    state.notificationStatus = payload.notificationStatus;
    if (action === "remove") state.notificationApproval = null;
    feedback.textContent = action === "test" ? "Telegram test delivered." : action === "disable" ? "Automatic alerts are off." : "Telegram connection removed.";
    renderNotificationStatus();
  } catch (error) {
    feedback.textContent = error.message;
  }
}

async function resetShadowPortfolio(event) {
  event.preventDefault();
  const button = $("#shadowResetForm button");
  const feedback = $("#shadowPortfolioFeedback");
  button.disabled = true;
  feedback.textContent = "Resetting the simulated ledger only...";
  try {
    const payload = await api("/api/stock-office/shadow/reset", {
      method: "POST",
      body: JSON.stringify({ startingCashDollars: Number($("#shadowStartingCash").value) }),
    });
    state.shadowPortfolio = payload.shadowPortfolio || state.shadowPortfolio;
    renderShadowPortfolio();
    feedback.textContent = `Fresh ${formatMoney(state.shadowPortfolio?.initialCashDollars)} paper portfolio created. No Robinhood call or money movement occurred.`;
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function renderRefreshFeedback(refresh) {
  const panel = $("#refreshFeedback");
  state.refresh = refresh || null;
  if (!refresh || refresh.status === "idle") {
    panel.hidden = true;
    delete panel.dataset.status;
    return;
  }
  panel.hidden = false;
  panel.dataset.status = refresh.status;
  $("#refreshFeedbackTitle").textContent = refresh.status === "running"
    ? `Refreshing: ${String(refresh.stage || "starting").replaceAll("_", " ")}`
    : refresh.status === "success"
      ? "Market data updated"
      : refresh.status === "partial"
        ? "Market data updated with warnings"
        : refresh.status === "failed"
          ? "Market data update could not start"
          : "Local reports rescanned";
  const issue = ["failed", "partial"].includes(refresh.status)
    ? refresh.errors?.[0] || refresh.warnings?.[0]
    : "";
  $("#refreshFeedbackMessage").textContent = refresh.status === "success"
    ? "Latest available prices, rankings, research, and copy-source decisions loaded. Automatic monitoring continues."
    : issue || refresh.message || "Market data status updated.";
  $("#refreshFeedbackTime").textContent = refresh.completedAt ? formatTime(refresh.completedAt) : "Working now";
}

async function pollRefreshStatus() {
  if (state.refreshStatusPolling || document.hidden) return;
  state.refreshStatusPolling = true;
  try {
    const payload = await api("/api/stock-office/refresh-status");
    state.intelligenceScheduler = payload.intelligenceScheduler || state.intelligenceScheduler;
    renderIntelligenceMonitor();
    renderRefreshFeedback(payload.refresh);
    const stage = String(payload.refresh?.stage || "refresh").replaceAll("_", " ");
    $("#syncButton").textContent = payload.refresh?.status === "running" ? `Updating: ${stage}` : "Update market data";
  } catch (_error) {
  } finally {
    state.refreshStatusPolling = false;
  }
}

async function pollTraderResearch() {
  if (state.traderResearchPolling || document.hidden || state.activeView !== "mirror") return;
  state.traderResearchPolling = true;
  try {
    const payload = await api("/api/stock-office/mirror");
    state.mirror = payload.mirror || state.mirror;
    state.mirrorIntelligence = payload.mirrorIntelligence || state.mirrorIntelligence;
    state.traderResearch = payload.traderResearch || state.traderResearch;
    renderMirror();
  } catch (_error) {
  } finally {
    state.traderResearchPolling = false;
  }
}

async function retryTraderResearch(jobId) {
  const button = $(`[data-trader-agent-retry="${CSS.escape(jobId)}"]`);
  const feedback = $("#mirrorGateFeedback");
  if (button) {
    button.disabled = true;
    button.textContent = "Queueing…";
  }
  feedback.textContent = "Queueing a fresh isolated research attempt. No broker action is available to this agent.";
  try {
    const payload = await api(`/api/stock-office/trader-research/${encodeURIComponent(jobId)}/retry`, { method: "POST", body: "{}" });
    state.traderResearch = payload.traderResearch || state.traderResearch;
    feedback.textContent = "Research retry queued. The stage timings below update from persisted agent state.";
    renderMirror();
  } catch (error) {
    feedback.textContent = error.message;
    if (button) button.disabled = false;
  }
}

async function syncLocalFiles() {
  const button = $("#syncButton");
  const mirrorButton = $("#mirrorRefreshButton");
  button.disabled = true;
  button.textContent = "Starting market update...";
  state.manualRefreshRunning = true;
  if (mirrorButton) {
    mirrorButton.disabled = true;
    mirrorButton.textContent = "Scanning…";
  }
  renderRefreshFeedback({ status: "running", stage: "preflight", message: "Checking the local market scanner...", startedAt: new Date().toISOString() });
  const pollTimer = window.setInterval(pollRefreshStatus, 800);
  try {
    const payload = await api("/api/stock-office/sync", { method: "POST", body: "{}" });
    renderRefreshFeedback(payload.refresh);
    await loadApp();
    const count = Number(payload.syncRun?.recordsImported || state.overview?.metrics?.trackedRecords || 0);
    $("#filterFeedback").textContent = `Loaded ${count} evaluator record${count === 1 ? "" : "s"}.`;
  } catch (error) {
    renderRefreshFeedback({ status: "failed", stage: "complete", message: error.message, errors: [error.message], completedAt: new Date().toISOString() });
  } finally {
    window.clearInterval(pollTimer);
    state.manualRefreshRunning = false;
    button.disabled = false;
    button.textContent = "Update market data";
    if (mirrorButton) {
      mirrorButton.disabled = false;
      mirrorButton.textContent = "Scan managers now";
    }
  }
}

async function applyFilters() {
  const button = $("#applyFilters");
  const feedback = $("#filterFeedback");
  button.disabled = true;
  button.textContent = "Filtering...";
  feedback.textContent = "Filtering records...";
  try {
    await loadApp();
    feedback.textContent = state.recordTotal
      ? `Showing ${state.recordTotal} matching record${state.recordTotal === 1 ? "" : "s"}.`
      : state.overview?.metrics?.trackedRecords
        ? "No records match those filters."
        : "No records are loaded yet. Use Refresh Stock Office first.";
  } catch (error) {
    feedback.textContent = `Could not filter records: ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = "Filter records";
  }
}

async function askStockGuru(event) {
  event.preventDefault();
  const input = $("#stockChatInput");
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  state.messages = [...state.messages, { sender: "operator", text: message, createdAt: new Date().toISOString() }];
  renderChat();
  try {
    const payload = await api("/api/stock-office/chat", { method: "POST", body: JSON.stringify({ message }) });
    state.messages = payload.messages || state.messages;
    renderChat();
  } catch (error) {
    state.messages = [...state.messages, { sender: "assistant", text: error.message, createdAt: new Date().toISOString() }];
    renderChat();
  }
}

async function updateMirrorSourcePolicy(button) {
  if (!button || button.disabled) return;
  const sourceId = button.dataset.mirrorFollow || button.dataset.mirrorEnable;
  const followControl = Boolean(button.dataset.mirrorFollow);
  const payload = followControl
    ? { following: button.dataset.nextFollowing === "true", ...(button.dataset.nextFollowing === "false" ? { mirrorEnabled: false } : {}) }
    : { mirrorEnabled: button.dataset.nextEnabled === "true" };
  button.disabled = true;
  try {
    const response = await api(`/api/stock-office/mirror/sources/${encodeURIComponent(sourceId)}`, { method: "POST", body: JSON.stringify(payload) });
    state.mirrorIntelligence = response.mirrorIntelligence || state.mirrorIntelligence;
    renderMirror();
    showRefreshFeedback("Copy policy updated", response.safety || "Source controls updated.", "success");
  } catch (error) {
    button.disabled = false;
    showRefreshFeedback("Copy policy not changed", error.message, "error");
  }
}

document.addEventListener("click", (event) => {
  if (event.target.closest("#stockManagersTrigger")) setManagersPanel($("#stockManagersPanel").hidden);
  if (event.target.closest("[data-managers-close]")) setManagersPanel(false);
  if (event.target.closest("[data-managers-refresh]")) validateStockFlowManagers();
  const managerToggle = event.target.closest("[data-manager-toggle]");
  if (managerToggle && !managerToggle.disabled) updateStockFlowManager(managerToggle.dataset.managerToggle, managerToggle.dataset.nextEnabled === "true");
  const nav = event.target.closest("[data-stock-nav]");
  if (nav) setStockView(nav.dataset.stockNav);
  const viewLink = event.target.closest("[data-open-stock-view]");
  if (viewLink) {
    setStockView(viewLink.dataset.openStockView);
    if (viewLink.closest("#stockManagersPanel")) setManagersPanel(false);
  }
  const brokerConnect = event.target.closest("#brokerConnectGate");
  if (brokerConnect && brokerConnect.dataset.action === "oauth") startRobinhoodOAuth();
  else if (brokerConnect && brokerConnect.dataset.action === "refresh") refreshRobinhoodAccount();
  else if (brokerConnect) requestBrokerConnection();
  const orderGate = event.target.closest("[data-order-gate]");
  if (orderGate) sendOrderToHumanGate(orderGate.dataset.orderGate);
  const orderClaim = event.target.closest("[data-order-claim]");
  if (orderClaim) claimOrderDispatch(orderClaim.dataset.orderClaim);
  const orderExecute = event.target.closest("[data-order-execute]");
  if (orderExecute) executeApprovedOrder(orderExecute.dataset.orderExecute);
  const handoffCopy = event.target.closest("[data-copy-order-handoff]");
  if (handoffCopy) copyOrderHandoff(handoffCopy.dataset.copyOrderHandoff);
  const resultRecord = event.target.closest("[data-record-order-result]");
  if (resultRecord) recordOrderDispatchResult(resultRecord.dataset.recordOrderResult);
  const row = event.target.closest("[data-ticker]");
  if (row) selectRecord(row.dataset.ticker);
  const mirrorGate = event.target.closest("[data-mirror-gate]");
  if (mirrorGate && !mirrorGate.disabled) sendMirrorToHumanGate(mirrorGate.dataset.mirrorGate);
  const mirrorDraft = event.target.closest("[data-mirror-draft]");
  if (mirrorDraft && !mirrorDraft.disabled) stageMirrorOrder(mirrorDraft.dataset.mirrorDraft);
  const mirrorFollow = event.target.closest("[data-mirror-follow]");
  if (mirrorFollow) updateMirrorSourcePolicy(mirrorFollow);
  const mirrorEnable = event.target.closest("[data-mirror-enable]");
  if (mirrorEnable) updateMirrorSourcePolicy(mirrorEnable);
  const traderResearchRetry = event.target.closest("[data-trader-agent-retry]");
  if (traderResearchRetry && !traderResearchRetry.disabled) retryTraderResearch(traderResearchRetry.dataset.traderAgentRetry);
  const portfolioDraft = event.target.closest("[data-portfolio-draft]");
  if (portfolioDraft && !portfolioDraft.disabled) stagePortfolioProposal(portfolioDraft.dataset.portfolioDraft);
  const proposalApprove = event.target.closest("[data-proposal-approve]");
  if (proposalApprove && !proposalApprove.disabled) approveOverviewProposal(proposalApprove.dataset.proposalApprove);
  const proposalReview = event.target.closest("[data-proposal-review]");
  if (proposalReview && !proposalReview.disabled) reviewOverviewProposal(proposalReview.dataset.proposalReview);
  const mirrorApprove = event.target.closest("[data-mirror-approve]");
  if (mirrorApprove && !mirrorApprove.disabled) approveOverviewProposal(mirrorApprove.dataset.mirrorApprove);
  const proposalDecline = event.target.closest("[data-proposal-decline]");
  if (proposalDecline && !proposalDecline.disabled) declineOverviewProposal(proposalDecline.dataset.proposalDecline);
  const proposalDetails = event.target.closest("[data-proposal-drawer]");
  if (proposalDetails) proposalDrawer(proposalDetails.dataset.proposalDrawer);
  if (event.target.closest("[data-live-readiness]")) openQuickOrder();
  if (event.target.closest("[data-quick-order]")) openQuickOrder();
  if (event.target.closest("[data-close-quick-order]")) $("#quickOrderDialog").close();
  const opportunityDetails = event.target.closest("[data-opportunity-drawer]");
  if (opportunityDetails) opportunityDrawer(opportunityDetails.dataset.opportunityDrawer);
  const workerDetails = event.target.closest("[data-worker-drawer]");
  if (workerDetails) workerDrawer(workerDetails.dataset.workerDrawer);
  if (event.target.closest("#operationsToggle")) toggleMarketWorkers();
  const reportDetails = event.target.closest("[data-report-drawer]");
  if (reportDetails) reportDrawer(reportDetails.dataset.reportDrawer);
  if (event.target.closest("#telegramApprovalButton")) requestTelegramApproval();
  if (event.target.closest("#telegramEnableButton")) enableTelegram();
  if (event.target.closest("#telegramTestButton")) telegramAction("test");
  if (event.target.closest("#telegramDisableButton")) telegramAction("disable");
  if (event.target.closest("#telegramRemoveButton")) telegramAction("remove");
  if (event.target.closest("#mirrorRefreshButton")) syncLocalFiles();
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("#stockManagersWidget") && !$("#stockManagersPanel")?.hidden) setManagersPanel(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setManagersPanel(false);
});

$("#guardrailForm").addEventListener("submit", requestGuardrails);
$("#applyGuardrails").addEventListener("click", applyApprovedGuardrails);
$("#orderDraftForm").addEventListener("submit", buildOrderDraft);
$("#shadowResetForm").addEventListener("submit", resetShadowPortfolio);
$("#quickOrderForm").addEventListener("submit", submitQuickOrder);
$("#secIdentityForm").addEventListener("submit", configureSecIdentity);
$("#telegramConfigForm").addEventListener("submit", configureTelegram);

$("#applyFilters").addEventListener("click", applyFilters);
$("#syncButton").addEventListener("click", syncLocalFiles);
$("#stockChatForm").addEventListener("submit", askStockGuru);
$("#capitalGoalForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const baseInput = $("#capitalGoalBaseDollars");
  const input = $("#capitalGoalDollars");
  const feedback = $("#capitalGoalFeedback");
  const base = Number(baseInput.value);
  const value = Number(input.value);
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(value) || value <= 0) {
    feedback.textContent = "Enter planned starting capital and a target greater than zero.";
    return;
  }
  if (value < base) {
    feedback.textContent = "Target capital must be at least the planned starting capital.";
    return;
  }
  try {
    window.localStorage.setItem("argentum.stockOffice.capitalGoalBaseDollars", String(base));
    window.localStorage.setItem("argentum.stockOffice.capitalGoalDollars", String(value));
    window.localStorage.setItem("argentum.stockOffice.capitalGoalHorizonMonths", String($("#capitalGoalHorizon").value));
    feedback.textContent = `Saved: ${formatMoney(base)} planned capital toward a ${formatMoney(value)} target.`;
  } catch {
    feedback.textContent = "This goal could not be saved on this device.";
  }
  renderOverviewDashboard();
  renderCapitalGoalPlanner();
});
const savedCapitalGoal = getCapitalGoal();
const savedCapitalGoalBase = getCapitalGoalBase();
if (savedCapitalGoalBase) $("#capitalGoalBaseDollars").value = savedCapitalGoalBase;
if (savedCapitalGoal) $("#capitalGoalDollars").value = savedCapitalGoal;
$("#capitalGoalBaseDollars").addEventListener("input", renderCapitalGoalPlanner);
$("#capitalGoalDollars").addEventListener("input", renderCapitalGoalPlanner);
$("#capitalGoalHorizon").addEventListener("change", renderCapitalGoalPlanner);
renderCapitalGoalPlanner();

const oauthReturnStatus = new URLSearchParams(window.location.search).get("robinhood") || "";
setStockView(oauthReturnStatus ? "trade" : window.location.hash.slice(1), { updateHash: false, scroll: false });
Promise.all([loadApp(), pollRefreshStatus()]).then(() => {
  if (!oauthReturnStatus) return;
  const messages = {
    connected: "Robinhood approved the Stock Office link and the dedicated Agentic account read succeeded.",
    needs_refresh: "Robinhood approved the Stock Office link. Use the account refresh button to finish the live read check.",
    connection_error: "Robinhood did not finish the link. Sign in to Robinhood in your default browser, then start the connection again.",
  };
  $("#brokerConnectionFeedback").textContent = messages[oauthReturnStatus] || "Robinhood returned to Stock Office. Refresh the connection status before continuing.";
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("robinhood");
  history.replaceState(null, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash || "#trade"}`);
}).finally(finishStockOfficePreloader);
function tickLivePortfolio() {
  const clock = $("#overviewLiveClock");
  if (!clock) return;
  const snapshotAt = Date.parse(state.brokerControl?.snapshotUpdatedAt || "");
  const ageSeconds = Number.isFinite(snapshotAt) ? Math.max(0, Math.floor((Date.now() - snapshotAt) / 1_000)) : null;
  clock.textContent = ageSeconds === null ? "Waiting for live account" : `Display live · broker read ${ageSeconds}s ago`;
}

window.setInterval(tickLivePortfolio, 1_000);
window.setInterval(pollLivePortfolio, 1_000);
window.setInterval(pollRefreshStatus, 400);
window.setInterval(pollBrokerControl, 15_000);
window.setInterval(pollTraderResearch, 2_000);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) pollTraderResearch();
});

document.addEventListener("toggle", (event) => {
  const details = event.target;
  if (!details?.matches?.(".overview-proposal-evidence[data-proposal-research]")) return;
  const proposalId = details.dataset.proposalResearch;
  if (!proposalId) return;
  if (details.open) state.expandedProposalResearch.add(proposalId);
  else state.expandedProposalResearch.delete(proposalId);
}, true);

window.addEventListener("argentum:approval-changed", () => {
  pollBrokerControl();
});

let intelligenceEventSource = null;
let intelligenceEventTimer = null;
function connectIntelligenceEvents() {
  if (!("EventSource" in window) || intelligenceEventSource) return;
  const source = new EventSource("/api/stock-office/events", { withCredentials: true });
  intelligenceEventSource = source;
  const refreshFromEvent = () => {
    window.clearTimeout(intelligenceEventTimer);
    intelligenceEventTimer = window.setTimeout(() => {
      pollBrokerControl();
      pollRefreshStatus();
      if (state.activeView === "overview") pollLivePortfolio();
    }, 150);
  };
  [
    "research.completed",
    "research.recommendations_ready",
    "opportunity.created",
    "opportunity.updated",
    "trade.approval_requested",
    "trade.approved",
    "trade.rejected",
    "order.review_started",
    "order.submitted",
    "order.filled",
    "order.cancelled",
    "order.updated",
    "order.rejected",
    "risk.blocked",
    "mirror.signal_detected",
    "mirror.consensus_created",
    "source.failed",
    "broker.disconnected",
    "overnight.completed",
    "morning.report_ready",
  ].forEach((eventName) => source.addEventListener(eventName, refreshFromEvent));
  source.onerror = () => {
    source.close();
    intelligenceEventSource = null;
    window.setTimeout(connectIntelligenceEvents, 5_000);
  };
}

connectIntelligenceEvents();

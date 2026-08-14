const state = {
  overview: null,
  records: [],
  selectedTicker: null,
  sources: [],
  activity: [],
  messages: [],
  mirror: null,
  mirrorApprovalIds: new Set(),
  recordTotal: 0,
  loading: false,
  refresh: null,
  brokerControl: null,
  portfolioPlan: null,
  shadowPortfolio: null,
  intelligenceScheduler: null,
  marketWorkers: null,
  intelligence: null,
  systemHealth: null,
  mirrorIntelligence: null,
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
  activeView: "overview",
};

const $ = (selector) => document.querySelector(selector);

const STOCK_VIEWS = {
  overview: ["Stock workspace", "Overview"],
  portfolio: ["Paper engine", "Portfolio"],
  mirror: ["Copy trading", "Mirror"],
  markets: ["Evaluator", "Markets"],
  trade: ["Supervised broker", "Trade desk"],
  sources: ["Market inputs", "Sources"],
  assistant: ["Research help", "Assistant"],
};

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

function formatBrokerPercent(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const normalized = Math.abs(number) > 1 ? number / 100 : number;
  return `${(normalized * 100).toFixed(digits)}%`;
}

function logoMarkup(symbol, name = "") {
  const safeSymbol = String(symbol || "").toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
  if (!safeSymbol) return "";
  return `<span class="company-logo" data-symbol="${escapeHtml(safeSymbol)}"><img src="/api/stock-office/logos/${encodeURIComponent(safeSymbol)}" alt="" loading="lazy" decoding="async" /><i aria-hidden="true">${escapeHtml(safeSymbol.slice(0, 2))}</i></span><span class="company-identity"><strong>${escapeHtml(safeSymbol)}</strong>${name && name !== safeSymbol ? `<small>${escapeHtml(name)}</small>` : ""}</span>`;
}

function outlookValue(value, fallback = "—") {
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? fallback : formatMoney(value);
}

function formatCadence(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return "Unknown";
  if (value < 60) return `${value} min`;
  if (value % (24 * 60) === 0) return `${value / (24 * 60)} day`;
  if (value % 60 === 0) return `${value / 60} hr`;
  return `${value} min`;
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
  $("#marketWorkers").innerHTML = workers.length
    ? workers.map((worker) => {
        const metrics = Array.isArray(worker.metrics) ? worker.metrics : [];
        const cycle = worker.status === "working"
          ? "Running now"
          : worker.nextRunAt
            ? `Next ${relativeCycle(worker.nextRunAt)}`
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

function renderNotificationStatus() {
  const status = state.notificationStatus || {};
  const approval = state.notificationApproval || {};
  const label = status.enabled ? "Telegram live" : status.configured ? "Telegram approval" : "Telegram off";
  const overviewPill = $("#notificationStatusPill");
  overviewPill.textContent = label;
  overviewPill.className = `status-pill ${status.enabled ? "ready" : status.configured ? "warning" : "muted"}`;
  const panelPill = $("#telegramPanelStatus");
  panelPill.textContent = status.enabled ? "Alerts active" : status.configured ? "Approval required" : "Not configured";
  panelPill.className = `status-pill ${status.enabled ? "ready" : status.configured ? "warning" : "muted"}`;
  $("#telegramDestination").textContent = status.destination || "Telegram not configured";
  $("#telegramSummary").textContent = status.enabled
    ? "Qualified BUY/SELL reviews and broker-confirmed orders will notify this destination."
    : status.configured
      ? approval.status === "approved" ? "Human Gate approved this destination. Enable it once." : "Credentials are secure. Human Gate must approve automatic alerts."
      : "Get a message when a qualified proposal reaches Human Gate and after Robinhood confirms an order.";
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

function renderOverviewDashboard() {
  const metrics = state.overview?.metrics || {};
  const sourceHealth = state.overview?.sourceHealth || {};
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
  const executionMode = String(control.executionMode || state.systemHealth?.mode || "PAPER").toUpperCase();
  const modePill = $("#executionModePill");
  modePill.textContent = executionMode === "LIVE" ? "LIVE · HUMAN GATE" : "PAPER / SIMULATION";
  modePill.className = `status-pill ${executionMode === "LIVE" ? "ready" : "warning"}`;
  const utilization = maxDeployed > 0 ? Math.max(0, Math.min(100, (deployed / maxDeployed) * 100)) : 0;
  const accountBand = $("#overviewAccountBand");
  accountBand.dataset.status = control.authenticationVerified ? "live" : "offline";
  $("#overviewEquity").textContent = formatMoney(equity);
  $("#overviewAccountMeta").textContent = `Official Robinhood total · ${positions.length} position${positions.length === 1 ? "" : "s"} · ${control.snapshotUpdatedAt ? formatTime(control.snapshotUpdatedAt) : "awaiting snapshot"}`;
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
  const topSetups = opportunities.filter((item) => item.status !== "rejected").slice(0, 5);
  $("#overviewTopSetups").innerHTML = topSetups.length
    ? topSetups.map((item) => `<article data-opportunity-status="${escapeHtml(item.status)}"><span class="overview-setup-company">${logoMarkup(item.symbol)}</span><span>${escapeHtml(String(item.aiScore ?? "—"))}</span><span>${escapeHtml(item.thesis?.setup || "Researching")}</span><em>${escapeHtml(item.change?.trend || item.confidence || "—")}</em><button type="button" data-opportunity-drawer="${escapeHtml(item.id)}">Research</button></article>`).join("")
    : `<div class="overview-empty-row"><strong>No qualified opportunity</strong><span>No symbol currently meets the persisted research threshold.</span></div>`;

  const health = state.systemHealth || {};
  $("#overviewResearchState").textContent = health.research?.status || "Waiting";
  $("#overviewResearchTimestamp").textContent = health.research?.updatedAt ? `Updated ${relativeCycle(health.research.updatedAt)}` : "No persisted cycle";
  $("#overviewSystemHealth").innerHTML = [
    ["Data", health.marketData?.status],
    ["Broker", health.broker?.status],
    ["Telegram", health.telegram?.status],
    ["Research", health.research?.status],
    ["Mirror", health.mirror ? `${health.mirror.healthy}/${health.mirror.total}` : "waiting"],
    ["DB", health.database?.status],
  ].map(([label, value]) => `<span data-status="${escapeHtml(value || "waiting")}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(String(value || "waiting").replaceAll("_", " "))}</strong></span>`).join("");

  $("#overviewCapitalUse").textContent = `${formatMoney(deployed)} / ${formatMoney(maxDeployed)}`;
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
  const cadenceMinutes = Number(cycle.cadenceMinutes || state.intelligenceScheduler?.activeCadenceMinutes || 5);
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
      <i aria-hidden="true"></i><span><small>${escapeHtml(`${cadenceMinutes}-minute scan`)}</small><strong>${escapeHtml(cycleStatus)}</strong></span>
    </div>
    <div class="overview-cycle-decisions">
      <span class="sell"><small>SELL</small><strong>${escapeHtml(summary.sells || 0)}</strong></span>
      <span class="hold"><small>HOLD</small><strong>${escapeHtml(summary.holds || 0)}</strong></span>
      <span class="buy"><small>BUY</small><strong>${escapeHtml(summary.buys || 0)}</strong></span>
    </div>
    <div class="overview-cycle-copy"><small>Copy watch</small><strong>${escapeHtml(summary.copyWatchers || 0)} people · ${escapeHtml(summary.copySignalsObserved || 0)} signals</strong></div>
    <div class="overview-cycle-result"><small>Last cycle</small><strong>${escapeHtml(review.lastMessage || "Workers continue automatically while the market is open.")}</strong></div>`;
  const decisions = new Set((state.proposalDecisions || state.portfolioPlan?.decisions || []).filter((item) => item.decision === "declined").map((item) => item.proposalId));
  const visible = proposals.filter((proposal) => !decisions.has(proposal.id)).slice(0, 4);
  const ready = visible.filter((proposal) => proposal.draftEligible).length;
  $("#overviewProposalCount").textContent = visible.length ? `${ready} ready · ${visible.length} reviewed` : "No active proposal";
  $("#overviewProposalList").innerHTML = visible.length
    ? visible.map((proposal) => {
        const research = proposal.research || {};
        const outlook = proposal.outlook || {};
        const targetText = proposal.side === "BUY" && outlook.targetPrice
          ? `${outlookValue(outlook.targetPrice)}${Number.isFinite(Number(outlook.targetReturnPct)) ? ` · ${(Number(outlook.targetReturnPct) * 100).toFixed(1)}% · ${formatMoney(outlook.targetScenarioDollars)} scenario` : ""}`
          : proposal.side === "SELL" ? "Reduce verified holding" : "Keep monitoring position";
        const blockers = Array.isArray(proposal.blockers) ? proposal.blockers : [];
        const blocker = blockers[0] || "";
        const isHold = proposal.side === "HOLD";
        const scores = proposal.scores || {};
        const reviewState = proposal.reviewState || (proposal.draftEligible ? "qualified" : isHold ? "monitoring" : "blocked");
        const pendingGate = reviewState === "awaiting_human_gate";
        const approved = reviewState === "approved";
        const reviewExpiresAt = Date.parse(proposal.reviewExpiresAt || "");
        const approvalRemaining = Number.isFinite(reviewExpiresAt) ? Math.max(0, Math.ceil((reviewExpiresAt - Date.now()) / 1_000)) : null;
        return `<article class="overview-proposal ${proposal.draftEligible ? "ready" : isHold ? "monitoring" : "blocked"}" data-proposal-id="${escapeHtml(proposal.id)}">
          <div class="overview-proposal-company">
            ${logoMarkup(proposal.symbol)}
            <span class="proposal-side ${escapeHtml(proposal.side.toLowerCase())}">${escapeHtml(proposal.side)}</span>
          </div>
          <div class="overview-proposal-scores">
            <span><small>AI</small><strong>${escapeHtml(scores.ai ?? research.score ?? "—")}</strong></span>
            <span><small>TECH</small><strong>${escapeHtml(scores.technical ?? research.score ?? "—")}</strong></span>
            <span><small>MIRROR</small><strong>${escapeHtml(scores.mirror ?? "—")}</strong></span>
            <span><small>RISK</small><strong>${escapeHtml(scores.risk === null || scores.risk === undefined ? "—" : Math.round(scores.risk))}</strong></span>
          </div>
          <div class="overview-proposal-thesis">
            <div><span>${escapeHtml(portfolioKindLabel(proposal.kind))}</span><strong>${escapeHtml(formatMoney(proposal.requestedDollars))}</strong><em>${escapeHtml(research.confidence || "unknown confidence")}</em></div>
            <p>${escapeHtml(research.mainReason || proposal.reasons?.[0] || "Proposal passed the current research planner.")}</p>
            <small>${escapeHtml(`${research.checksPassed ?? 0}/${research.checksTotal ?? 0} current checks passed`)}</small>
            <small>Risk: ${escapeHtml(research.mainRisk || "Market conditions can change before execution.")}</small>
          </div>
          <div class="overview-proposal-outlook">
            <span><small>Reference</small><strong>${escapeHtml(outlookValue(proposal.referencePrice))}</strong></span>
            <span><small>Target scenario</small><strong>${escapeHtml(targetText)}</strong></span>
            <span><small>Review horizon</small><strong>${escapeHtml(outlook.horizonLabel || "Re-evaluate each market cycle")}</strong></span>
          </div>
          <details class="overview-proposal-evidence" data-proposal-research="${escapeHtml(proposal.id)}" ${state.expandedProposalResearch.has(proposal.id) ? "open" : ""}>
            <summary>Quick evidence</summary>
            <p><strong>Setup</strong>${escapeHtml(research.setupType || "Evaluator review")} · score ${escapeHtml(research.score ?? "—")} · ${escapeHtml(research.marketCondition || "market condition unavailable")}</p>
            <p><strong>Plan</strong>Entry ${escapeHtml(research.entryZone || "reprice before order")} · stop ${escapeHtml(outlookValue(outlook.stopPrice))}${Number.isFinite(Number(outlook.stopScenarioDollars)) ? ` · ${escapeHtml(formatMoney(outlook.stopScenarioDollars))} downside scenario` : ""} · ${escapeHtml(research.invalidationRule || "Rebuild on any evidence change.")}</p>
            <p><strong>Timing</strong>${escapeHtml(outlook.timingNote || "No profit date can be estimated reliably.")}</p>
            <p><strong>Source</strong>${escapeHtml(research.sourceLabel || "Stock Guru evaluator")}</p>
          </details>
          <div class="overview-proposal-actions">
            <button class="secondary" type="button" data-proposal-drawer="${escapeHtml(proposal.id)}">Why / Research</button>
            ${isHold
              ? `<button type="button" disabled>Monitoring</button><small>No order is needed. The next cycle checks exit conditions again.</small>`
              : approved
                ? `<button type="button" data-order-execute="${escapeHtml(proposal.reviewDraftId)}">Review & execute once</button><small>Human Gate approved. Robinhood review and final confirmation still apply.</small>`
                : pendingGate
                  ? `<button type="button" disabled>Human Gate pending</button><small>${approvalRemaining === null ? "Approval window active" : `Expires in ${escapeHtml(formatCountdown(approvalRemaining))}`} · use the bottom-left bubble or Telegram. No broker review or order has occurred.</small>`
                  : `<button type="button" data-proposal-approve="${escapeHtml(proposal.id)}" ${proposal.draftEligible ? "" : "disabled"}>${proposal.draftEligible ? "Send to Human Gate" : "Blocked"}</button>
                     <button class="secondary" type="button" data-proposal-decline="${escapeHtml(proposal.id)}">Decline</button>
                     ${blocker ? `<small><strong>${escapeHtml(`${blockers.length} check${blockers.length === 1 ? "" : "s"} blocking`)}</strong> · ${escapeHtml(blockers.slice(0, 3).join(" · "))}</small>` : `<small>One-use approval only; no automatic order.</small>`}`}
          </div>
        </article>`;
      }).join("")
    : `<div class="overview-empty-row"><strong>No actionable trade proposal</strong><span>The research planner is waiting for fresh evidence and available risk capacity.</span></div>`;
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
      { id: "why", label: "Why", html: `<div class="drawer-score-grid">${[["AI", scores.ai ?? research.score], ["Technical", scores.technical ?? research.score], ["Mirror", scores.mirror], ["Risk", scores.risk]].map(([label, value]) => `<span><small>${escapeHtml(label)}</small><strong>${escapeHtml(value ?? "—")}</strong></span>`).join("")}</div><section><h3>Thesis</h3><p>${escapeHtml(research.mainReason || proposal.reasons?.[0] || "No thesis was recorded.")}</p></section><section><h3>Conflicting evidence</h3><p>${escapeHtml(research.mainRisk || "No explicit conflict was recorded.")}</p></section>` },
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
      { id: "research", label: "Research", html: `<div class="drawer-score-grid">${[["AI", opportunity.aiScore], ["Technical", opportunity.technicalScore], ["Mirror", opportunity.mirrorScore], ["Risk", opportunity.riskScore]].map(([label, value]) => `<span><small>${escapeHtml(label)}</small><strong>${escapeHtml(value === null || value === undefined ? "—" : Math.round(value))}</strong></span>`).join("")}</div><section><h3>${escapeHtml(opportunity.thesis?.setup || "Research thesis")}</h3><p>${escapeHtml(opportunity.thesis?.reason || "No thesis statement was persisted.")}</p></section><ul class="drawer-evidence">${(opportunity.evidence || []).map((item) => `<li data-direction="${escapeHtml(item.direction)}"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.source)}</span></li>`).join("")}</ul>` },
      { id: "history", label: "History", html: `<dl class="drawer-facts"><div><dt>First seen</dt><dd>${escapeHtml(formatTime(opportunity.firstSeenAt))}</dd></div><div><dt>Last researched</dt><dd>${escapeHtml(formatTime(opportunity.lastResearchedAt))}</dd></div><div><dt>Next review</dt><dd>${escapeHtml(formatTime(opportunity.nextReviewAt))}</dd></div><div><dt>Trend</dt><dd>${escapeHtml(opportunity.change?.trend || "—")} ${opportunity.change?.scoreDelta === null ? "" : `(${opportunity.change.scoreDelta >= 0 ? "+" : ""}${opportunity.change.scoreDelta})`}</dd></div></dl>` },
      { id: "risk", label: "Risk", html: `<section><h3>Main risk</h3><p>${escapeHtml(opportunity.thesis?.risk || "Unavailable")}</p></section><section><h3>Invalidation</h3><p>${escapeHtml(opportunity.thesis?.invalidation || "Unavailable")}</p></section>` },
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
  openIntelligenceDrawer({ kicker: reportType === "morning" ? "MORNING INTELLIGENCE" : "NIGHT RESEARCH", title: report?.generatedAt ? formatTime(report.generatedAt) : "Report pending", tabs: [{ id: "report", label: "Report", html: report ? `<div class="drawer-score-grid"><span><small>Researched</small><strong>${escapeHtml(report.summary?.researched || 0)}</strong></span><span><small>High</small><strong>${escapeHtml(report.summary?.highPriority || 0)}</strong></span><span><small>Candidates</small><strong>${escapeHtml(report.summary?.candidates || 0)}</strong></span><span><small>Mirror</small><strong>${escapeHtml(report.summary?.mirrorMatched || 0)}</strong></span></div><ol class="drawer-opportunities">${(report.topOpportunities || []).slice(0, 10).map((item) => `<li><strong>${logoMarkup(item.symbol)}</strong><span>AI ${escapeHtml(item.aiScore)} · ${escapeHtml(item.status)}</span></li>`).join("")}</ol><p class="drawer-boundary">${escapeHtml(report.limitations?.[1] || report.limitations?.[0] || "Research only.")}</p>` : `<div class="drawer-empty">This report has not been generated yet. Research continues on the session-aware scheduler.</div>` }] });
}

function renderMetrics() {
  renderOverviewDashboard();
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
  const positions = portfolio.positions || [];
  const decisions = [...(portfolio.decisions || [])].reverse().slice(0, 8);
  const learning = portfolio.learning || {};
  const status = $("#shadowPortfolioStatus");
  const running = portfolio.mode === "paper_shadow_only" && portfolio.initialCashDollars > 0;
  status.textContent = running
    ? `Paper only · ${portfolio.lastCycleAt ? formatTime(portfolio.lastCycleAt) : "first cycle pending"}`
    : "Set paper starting cash";
  status.className = running ? "ready-copy" : "danger-copy";
  $("#shadowPortfolioMetrics").innerHTML = [
    ["Paper equity", formatMoney(portfolio.equityDollars), `started ${formatMoney(portfolio.initialCashDollars)}`],
    ["Paper cash", formatMoney(portfolio.cashDollars), `${formatMoney(portfolio.deployedDollars)} simulated deployment`],
    ["Total paper P&L", formatMoney(portfolio.totalPnlDollars), formatPercent(portfolio.totalReturnPct || 0)],
    ["Today paper P&L", formatMoney(portfolio.dayPnlDollars), portfolio.dailyLossLocked ? "new paper buys locked" : `lock ${formatMoney(portfolio.dailyLossLimitDollars)}`],
    ["Paper drawdown", formatPercent(portfolio.currentDrawdownPct || 0), `maximum ${formatPercent(portfolio.maxDrawdownPct || 0)}`],
    ["Closed outcomes", learning.closedTrades || 0, learning.hitRate === null || learning.hitRate === undefined ? "no closed sample yet" : `${formatPercent(learning.hitRate)} hit rate`],
  ].map(([label, value, hint]) => metricCard(label, value, hint)).join("");
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
  $("#shadowLearning").innerHTML = learning.closedTrades
    ? profiles.slice(0, 6).map((profile) => `
        <article class="shadow-row learning">
          <div><strong>${escapeHtml(profile.label)}</strong><span>${profile.trades} closed paper trade${profile.trades === 1 ? "" : "s"}</span></div>
          <div><b>${escapeHtml(formatMoney(profile.totalPnlDollars))}</b><small>${profile.hitRate === null ? "no hit rate" : escapeHtml(formatPercent(profile.hitRate))}</small></div>
          <div><b>${escapeHtml(formatMoney(profile.expectancyDollars))}</b><small>paper expectancy</small></div>
        </article>
      `).join("")
    : `<div class="empty-state"><p>Learning starts after a simulated position closes. Small samples are evidence, not a promise of future profit.</p></div>`;
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
  const completed = ["dispatched", "filled"].includes(draft.status);
  const pending = ["awaiting_human_gate", "approved", "dispatch_claimed", "reconciliation_required"].includes(draft.status);
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
    $("#principalDollars").value = displayedGuardrails.principalDollars || 25;
    $("#maxTotalDollars").value = displayedGuardrails.maxTotalDollars || 25;
    $("#maxOrderDollars").value = displayedGuardrails.maxOrderDollars || 5;
    $("#cashReserveDollars").value = displayedGuardrails.cashReserveDollars || 0;
    $("#dailyLossLimitPct").value = ((displayedGuardrails.dailyLossLimitPct || 0.02) * 100).toFixed(1);
    $("#riskPerTradePct").value = ((displayedGuardrails.riskPerTradePct || 0.01) * 100).toFixed(1);
    $("#maxPositions").value = displayedGuardrails.maxPositions || 5;
    $("#maxTradesPerDay").value = displayedGuardrails.maxTradesPerDay || 3;
    $("#minEntryScore").value = displayedGuardrails.minEntryScore || 85;
    $("#orderDollars").value = Math.min(displayedGuardrails.maxOrderDollars || 5, 5);
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
  renderPortfolioPlan();
  renderIntelligenceMonitor();
  renderShadowPortfolio();
  renderTradeDraft(state.tradeDrafts[0] || null);
}

function mirrorStatusLabel(value) {
  return String(value || "unknown").replaceAll("_", " ");
}

function renderMirror() {
  const mirror = state.mirror || state.overview?.mirror || {};
  const mirrorIntelligence = state.mirrorIntelligence || state.intelligence?.mirror || {};
  const summary = mirror.summary || {};
  const candidates = mirror.candidates || [];
  const sources = mirror.sources || [];
  const watchers = Array.isArray(mirror.watchers) ? mirror.watchers : [];
  const warnings = mirror.warnings || [];
  const importer = mirror.importer || {};
  const importer13f = mirror.importer13f || {};
  const knowledge = mirror.knowledge || {};
  const knowledgeSummary = knowledge.summary || {};
  const plan = state.portfolioPlan || {};
  const cycle = plan.cycle || {};
  const planSummary = plan.summary || {};
  const paper = state.shadowPortfolio || {};
  const guardrails = state.brokerControl?.guardrails || {};
  const scheduler = state.intelligenceScheduler || {};
  const cadenceMinutes = Number(cycle.cadenceMinutes || scheduler.activeCadenceMinutes || 5);
  const nextAt = Date.parse(cycle.nextRunAt || scheduler.nextRunAt || "");
  const remainingSeconds = Number.isFinite(nextAt) ? Math.max(0, Math.ceil((nextAt - Date.now()) / 1_000)) : null;
  const marketOpen = cycle.session?.regular === true;
  const cycleRunning = cycle.running === true || scheduler.running === true;
  const activeWatchers = watchers.filter((watcher) => watcher.enabled);
  const fastWatchers = activeWatchers.filter((watcher) => watcher.copyEligible);
  const delayedWatchers = activeWatchers.filter((watcher) => watcher.researchOnly);
  const proposalByCandidate = new Map((plan.proposals || []).filter((proposal) => proposal.candidateId).map((proposal) => [proposal.candidateId, proposal]));
  const liveGateCount = (plan.proposals || []).filter((proposal) => ["awaiting_human_gate", "approved"].includes(proposal.reviewState)).length;
  const pill = $("#mirrorStatusPill");
  pill.textContent = cycleRunning ? "Scanning now" : !mirror.available ? "Waiting for first scan" : mirror.stale ? "Signals stale" : "Engine active";
  pill.className = `status-pill ${cycleRunning || (!mirror.stale && mirror.available) ? "ready" : mirror.stale ? "warning" : "muted"}`;

  const cycleLabel = cycleRunning
    ? String(scheduler.currentMessage || "Refreshing copy signals and market evidence")
    : marketOpen && remainingSeconds !== null
      ? `Next scan ${formatCountdown(remainingSeconds)}`
      : cycle.session?.label || "Market schedule unavailable";
  $("#mirrorCycleRail").innerHTML = `
    <div class="mirror-cycle-primary" data-status="${escapeHtml(cycleRunning ? "working" : marketOpen ? "countdown" : "quiet")}">
      <i aria-hidden="true"></i><span><small>${escapeHtml(`${cadenceMinutes}-MINUTE ENGINE`)}</small><strong>${escapeHtml(cycleLabel)}</strong></span>
    </div>
    <div class="mirror-flow-step ${activeWatchers.length ? "done" : "blocked"}"><small>01</small><span><strong>Watch</strong><em>${escapeHtml(`${activeWatchers.length} people & funds`)}</em></span></div>
    <div class="mirror-flow-step ${cycleRunning ? "working" : mirror.available ? "done" : "waiting"}"><small>02</small><span><strong>Score</strong><em>${escapeHtml(`${summary.signalsReceived || 0} signals ranked`)}</em></span></div>
    <div class="mirror-flow-step ${paper.mode === "paper_shadow_only" ? "done" : "waiting"}"><small>03</small><span><strong>Paper copy</strong><em>${escapeHtml(paper.mode === "paper_shadow_only" ? "Runs automatically" : "Not started")}</em></span></div>
    <div class="mirror-flow-step gate"><small>04</small><span><strong>Live order</strong><em>${escapeHtml(liveGateCount ? `${liveGateCount} in Human Gate` : "Approval required")}</em></span></div>`;

  $("#mirrorMetrics").innerHTML = [
    ["Watching", activeWatchers.length || Number(importer.enabledEntries || 0) + Number(importer13f.enabledEntries || 0), `${fastWatchers.length} fast · ${delayedWatchers.length} delayed`],
    ["Signals", summary.signalsReceived ?? 0, `${summary.paperReady ?? 0} copy-ready`],
    ["Paper positions", (paper.positions || []).length, `${formatMoney(paper.deployedDollars || 0)} deployed`],
    ["Measured", knowledgeSummary.measuredOutcomes ?? 0, `${knowledgeSummary.pendingOutcomes ?? 0} pending`],
  ].map(([label, value, hint]) => `<div><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong><span>${escapeHtml(hint)}</span></div>`).join("");
  $("#mirrorAllocation").innerHTML = `
    <div><small>PAPER EQUITY</small><strong>${escapeHtml(formatMoney(paper.equityDollars || paper.initialCashDollars || 0))}</strong><span class="${Number(paper.totalPnlDollars || 0) >= 0 ? "positive" : "negative"}">${escapeHtml(`${formatMoney(paper.totalPnlDollars || 0)} P&L`)}</span></div>
    <div><small>MAX COPY</small><strong>${escapeHtml(formatMoney(guardrails.maxOrderDollars || mirror.policy?.maxTradeDollars || 0))}</strong><span>per live review</span></div>`;

  $("#mirrorDecisionCounts").innerHTML = [
    ["sell", "SELL", planSummary.sells || candidates.filter((candidate) => candidate.side === "SELL").length],
    ["hold", "HOLD", planSummary.holds || candidates.filter((candidate) => candidate.status !== "paper_ready").length],
    ["buy", "BUY", planSummary.buys || candidates.filter((candidate) => candidate.side === "BUY" && candidate.status === "paper_ready").length],
  ].map(([className, label, value]) => `<span class="${className}"><small>${label}</small><strong>${escapeHtml(value)}</strong></span>`).join("");

  $("#mirrorCandidates").innerHTML = candidates.length
      ? candidates.map((candidate) => {
        const proposal = proposalByCandidate.get(candidate.id) || null;
        const reviewState = proposal?.reviewState || "";
        const pendingGate = reviewState === "awaiting_human_gate";
        const approved = reviewState === "approved";
        const actionable = proposal?.draftEligible === true && !mirror.stale;
        const mainReason = candidate.reasons?.[0] || "No evaluation reason recorded.";
        const signalAge = Number(candidate.signalAgeHours ?? candidate.disclosureLagHours ?? 0);
        const statusLabel = candidate.status === "paper_ready" ? "COPY READY" : candidate.status === "research_only" ? "WATCH" : mirrorStatusLabel(candidate.status).toUpperCase();
        const sourceMode = candidate.sourceId === "sec_form4" || /form 4/i.test(candidate.sourceName) ? "FAST DISCLOSURE" : "DELAYED FILING";
        return `
          <article class="mirror-candidate ${escapeHtml(statusClass(candidate.status))}" data-side="${escapeHtml(candidate.side.toLowerCase())}">
            <div class="mirror-candidate-company">
              ${logoMarkup(candidate.symbol)}
              <span class="proposal-side ${escapeHtml(candidate.side.toLowerCase())}">${escapeHtml(candidate.side)}</span>
            </div>
            <div class="mirror-candidate-source">
              <small>${escapeHtml(sourceMode)}</small>
              <strong>${escapeHtml(candidate.traderName)}</strong>
              <span>${escapeHtml(candidate.sourceName)}</span>
            </div>
            <div class="mirror-candidate-market">
              <span><small>Signal → now</small><strong>${escapeHtml(`${outlookValue(candidate.signalPrice)} → ${outlookValue(candidate.currentPrice)}`)}</strong></span>
              <span><small>Drift</small><strong>${escapeHtml(candidate.priceDriftPct === null ? "—" : formatPercent(candidate.priceDriftPct, 2))}</strong></span>
              <span><small>Age</small><strong>${escapeHtml(signalAge < 1 ? `${Math.round(signalAge * 60)}m` : `${signalAge.toFixed(1)}h`)}</strong></span>
              <span><small>Copy size</small><strong>${escapeHtml(formatMoney(candidate.mirrorNotionalDollars))}</strong></span>
            </div>
            <div class="mirror-candidate-verdict">
              <em class="tag ${escapeHtml(statusClass(candidate.status))}">${escapeHtml(statusLabel)}</em>
              <strong>${escapeHtml(`${Math.round(Number(candidate.rankingScore || candidate.evidenceScore || 0) * 100)} score`)}</strong>
              <span>${escapeHtml(mainReason)}</span>
            </div>
            <div class="mirror-candidate-actions">
              ${candidate.sourceUrl ? `<a href="${escapeHtml(candidate.sourceUrl)}" target="_blank" rel="noreferrer">Filing ↗</a>` : `<span></span>`}
              ${approved && proposal?.reviewDraftId
                ? `<button type="button" data-order-execute="${escapeHtml(proposal.reviewDraftId)}">Review once</button>`
                : pendingGate
                  ? `<button type="button" disabled>Human Gate pending</button>`
                  : proposal
                    ? `<button type="button" data-mirror-approve="${escapeHtml(proposal.id)}" ${actionable ? "" : "disabled"}>${actionable ? "Send to Human Gate" : "Monitor only"}</button>`
                    : `<button type="button" disabled>Monitor only</button>`}
            </div>
          </article>
        `;
      }).join("")
    : `<div class="mirror-empty">
        <span class="mirror-radar" aria-hidden="true"><i></i></span>
        <div><h3>No current copy signal</h3><p>${escapeHtml(cycleRunning ? "The scanner is checking filings and prices now." : remainingSeconds !== null ? `The engine checks again in ${formatCountdown(remainingSeconds)}.` : "The engine is waiting for its next scheduled scan.")}</p></div>
        <strong>${escapeHtml(`${activeWatchers.length} watchers active`)}</strong>
      </div>`;

  $("#mirrorWatcherCount").textContent = `${activeWatchers.length} active`;
  $("#mirrorWatchers").innerHTML = watchers.length
    ? watchers.map((watcher) => {
        const initials = watcher.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
        const feed = watcher.copyEligible ? importer : importer13f;
        const status = watcher.enabled ? watcher.copyEligible ? "copy" : "research" : "off";
        return `<article class="mirror-watcher" data-status="${escapeHtml(status)}">
          <i>${escapeHtml(initials || "W")}</i>
          <div><strong>${escapeHtml(watcher.name)}</strong><span>${escapeHtml(watcher.filingType)} · ${escapeHtml(watcher.copyEligible ? "fast signal" : "delayed holdings")}</span></div>
          <em>${escapeHtml(watcher.enabled ? watcher.copyEligible ? "COPY" : "WATCH" : "OFF")}</em>
          <small>${escapeHtml(feed.generatedAt ? `Read ${relativeCycle(feed.generatedAt)}` : "First read pending")}</small>
        </article>`;
      }).join("")
    : `<div class="mirror-watch-empty"><strong>No named watchers</strong><span>Add verified CIKs in Sources to start the public filing watch.</span></div>`;

  const consensus = Array.isArray(mirrorIntelligence.consensus) ? mirrorIntelligence.consensus : [];
  $("#mirrorConsensus").innerHTML = consensus.length
    ? consensus.slice(0, 8).map((item) => `<article><span>${logoMarkup(item.symbol)}</span><strong>${escapeHtml(item.side)}</strong><b>${escapeHtml(Math.round(item.score))}</b><small>${escapeHtml(`${item.sourceCount} sources · ${relativeCycle(item.lastUpdatedAt)}`)}</small></article>`).join("")
    : `<div class="mirror-watch-empty"><strong>No multi-source consensus</strong><span>A consensus appears only when at least two distinct attributable sources align.</span></div>`;
  const mirrorEvents = Array.isArray(mirrorIntelligence.events) ? mirrorIntelligence.events : [];
  $("#mirrorEventFeed").innerHTML = mirrorEvents.length
    ? mirrorEvents.slice(0, 10).map((item) => `<article><i></i><div><strong>${escapeHtml(`${item.side || "OBSERVE"} ${item.symbol || "—"}`)}</strong><span>${escapeHtml(item.sourceId || "public source")}</span></div><em>${escapeHtml(item.delaySeconds === null || item.delaySeconds === undefined ? "delay unavailable" : item.delaySeconds < 3600 ? `${Math.round(item.delaySeconds / 60)}m delay` : `${(item.delaySeconds / 3600).toFixed(1)}h delay`)}</em><small>${escapeHtml(relativeCycle(item.receivedAt))}</small></article>`).join("")
    : `<div class="mirror-watch-empty"><strong>No persisted source event</strong><span>Only attributable imported events appear here.</span></div>`;

  $("#mirrorSources").innerHTML = sources.length
    ? sources.slice(0, 8).map((source) => `<article data-source-health="${escapeHtml(source.health || "waiting")}">
        <i class="${source.active ? "ready" : "delay"}"></i>
        <div><strong>${escapeHtml(source.name)}</strong><em>${escapeHtml(`${String(source.delayClass || "delay unknown").replaceAll("_", " ")} · ${source.health || "waiting"}`)}</em></div>
        <button type="button" data-mirror-follow="${escapeHtml(source.id)}" data-next-following="${source.following ? "false" : "true"}">${source.following ? "Following" : "Follow"}</button>
        <button type="button" data-mirror-enable="${escapeHtml(source.id)}" data-next-enabled="${source.mirrorEnabled ? "false" : "true"}" ${source.following ? "" : "disabled"}>${source.mirrorEnabled ? "Mirror enabled" : "Mirror off"}</button>
      </article>`).join("")
    : `<span><i class="delay"></i><strong>Source registry</strong><em>pending</em></span>`;
  const profiles = knowledge.sourceProfiles || [];
  $("#knowledgeStatus").textContent = !knowledge.available
    ? "No measured outcomes"
    : knowledge.stale
      ? "Ledger stale"
      : `${knowledgeSummary.measuredOutcomes || 0} measured`;
  $("#knowledgeMetrics").innerHTML = [
    ["Observations", knowledgeSummary.observationsSeen ?? 0],
    ["Measured", knowledgeSummary.measuredOutcomes ?? 0],
    ["Pending", knowledgeSummary.pendingOutcomes ?? 0],
    ["Form 4 signals", importer.signalsImported ?? 0],
    ["13F changes", importer13f.signalsImported ?? 0],
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
    delayedWatchers.length ? `${delayedWatchers.length} 13F watcher${delayedWatchers.length === 1 ? " is" : "s are"} delayed research, not automatic copy orders.` : "",
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
  const sourceHealth = state.overview?.sourceHealth || {};
  $("#sourceTitle").textContent = sourceHealth.status || "Source health";
  $("#sourceBadge").textContent = sourceHealth.ready ? `${sourceHealth.ready} ready` : "No sources";
  $("#sourceList").innerHTML =
    state.sources
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
      .join("") || `<article class="chat-message assistant"><strong>Stock Guru</strong><p>Ask about evaluator records, Mirror Lab decisions, source delay, price drift, or readiness blockers.</p></article>`;
  $("#stockChat").scrollTop = $("#stockChat").scrollHeight;
}

async function loadApp() {
  if (state.loading) return;
  state.loading = true;
  $("#applyFilters").disabled = true;
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
    state.activity = [...(activity.syncRuns || []), ...(activity.activity || []), ...(activity.assistantRuns || [])].sort((a, b) => new Date(b.createdAt || b.timestamp || 0) - new Date(a.createdAt || a.timestamp || 0));
    state.messages = chat.messages || [];
    state.mirror = mirrorPayload.mirror || overview.mirror || null;
    state.mirrorIntelligence = mirrorPayload.mirrorIntelligence || brokerPayload.intelligence?.mirror || null;
    state.intelligence = brokerPayload.intelligence || overview.intelligence || null;
    state.systemHealth = brokerPayload.systemHealth || overview.systemHealth || null;
    state.brokerControl = brokerPayload.brokerControl || null;
    state.portfolioPlan = brokerPayload.portfolioPlan || null;
    state.proposalDecisions = brokerPayload.portfolioPlan?.decisions || [];
    state.shadowPortfolio = brokerPayload.shadowPortfolio || null;
    state.intelligenceScheduler = brokerPayload.intelligenceScheduler || null;
    state.marketWorkers = brokerPayload.marketWorkers || null;
    state.notificationStatus = brokerPayload.notificationStatus || null;
    state.notificationApproval = brokerPayload.notificationApproval || null;
    state.robinhoodConnection = brokerPayload.robinhoodConnection || null;
    state.connectionApproval = brokerPayload.connectionApproval || null;
    state.guardrailApproval = brokerPayload.guardrailApproval || null;
    state.guardrailsSource = brokerPayload.guardrailsSource || overview.guardrailsSource || null;
    state.tradeDrafts = brokerPayload.tradeDrafts || [];
    renderMetrics();
    renderRecords();
    renderSources();
    renderActivity();
    renderChat();
    renderMirror();
    renderBrokerControl();
    if (!state.records.some((record) => record.ticker === state.selectedTicker)) {
      state.selectedTicker = state.records[0]?.ticker || null;
    }
    if (state.selectedTicker) selectRecord(state.selectedTicker);
    else $("#recordDetail").innerHTML = `<h2>No record selected</h2><p>${state.overview?.metrics?.trackedRecords ? "No record matches the current filters." : "Refresh Stock Office to load evaluator records."}</p>`;
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
    button.textContent = "Review & approve";
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
    state.brokerControl = payload.brokerControl || state.brokerControl;
    state.portfolioPlan = payload.portfolioPlan || state.portfolioPlan;
    state.intelligence = payload.intelligence || state.intelligence;
    state.mirrorIntelligence = payload.intelligence?.mirror || state.mirrorIntelligence;
    state.systemHealth = payload.systemHealth || state.systemHealth;
    state.mirror = payload.mirror || state.mirror;
    state.proposalDecisions = payload.portfolioPlan?.decisions || state.proposalDecisions;
    state.shadowPortfolio = payload.shadowPortfolio || state.shadowPortfolio;
    state.intelligenceScheduler = payload.intelligenceScheduler || state.intelligenceScheduler;
    state.marketWorkers = payload.marketWorkers || state.marketWorkers;
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
    renderBrokerControl();
    if (state.activeView === "mirror") renderMirror();
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
    state.brokerControl = payload.brokerControl || state.brokerControl;
    state.portfolioPlan = payload.portfolioPlan || state.portfolioPlan;
    state.intelligence = payload.intelligence || state.intelligence;
    state.mirrorIntelligence = payload.intelligence?.mirror || state.mirrorIntelligence;
    state.systemHealth = payload.systemHealth || state.systemHealth;
    state.mirror = payload.mirror || state.mirror;
    state.proposalDecisions = payload.portfolioPlan?.decisions || state.proposalDecisions;
    state.intelligenceScheduler = payload.intelligenceScheduler || state.intelligenceScheduler;
    state.robinhoodConnection = payload.robinhoodConnection || state.robinhoodConnection;
    state.tradeDrafts = payload.tradeDrafts || state.tradeDrafts;
    if (state.activeView === "overview") renderOverviewDashboard();
    if (state.activeView === "mirror") renderMirror();
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
    feedback.textContent = "Qualified proposal and verified Robinhood order alerts are now active.";
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
  if (!refresh || refresh.status === "idle") return;
  state.refresh = refresh;
  const panel = $("#refreshFeedback");
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
    ? "Latest available prices, rankings, and Mirror decisions loaded. Automatic monitoring continues."
    : issue || refresh.message || "Market data status updated.";
  $("#refreshFeedbackTime").textContent = refresh.completedAt ? formatTime(refresh.completedAt) : "Working now";
}

async function pollRefreshStatus() {
  try {
    const payload = await api("/api/stock-office/refresh-status");
    state.intelligenceScheduler = payload.intelligenceScheduler || state.intelligenceScheduler;
    renderIntelligenceMonitor();
    renderRefreshFeedback(payload.refresh);
    const stage = String(payload.refresh?.stage || "refresh").replaceAll("_", " ");
    $("#syncButton").textContent = payload.refresh?.status === "running" ? `Updating: ${stage}` : "Update market data";
  } catch (_error) {}
}

async function syncLocalFiles() {
  const button = $("#syncButton");
  const mirrorButton = $("#mirrorRefreshButton");
  button.disabled = true;
  button.textContent = "Starting market update...";
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
    button.disabled = false;
    button.textContent = "Update market data";
    if (mirrorButton) {
      mirrorButton.disabled = false;
      mirrorButton.textContent = "Run scan";
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
    renderMirrorLab();
    showRefreshFeedback("Mirror policy updated", response.safety || "Source controls updated.", "success");
  } catch (error) {
    button.disabled = false;
    showRefreshFeedback("Mirror policy not changed", error.message, "error");
  }
}

document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-stock-nav]");
  if (nav) setStockView(nav.dataset.stockNav);
  const viewLink = event.target.closest("[data-open-stock-view]");
  if (viewLink) setStockView(viewLink.dataset.openStockView);
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
  const portfolioDraft = event.target.closest("[data-portfolio-draft]");
  if (portfolioDraft && !portfolioDraft.disabled) stagePortfolioProposal(portfolioDraft.dataset.portfolioDraft);
  const proposalApprove = event.target.closest("[data-proposal-approve]");
  if (proposalApprove && !proposalApprove.disabled) approveOverviewProposal(proposalApprove.dataset.proposalApprove);
  const mirrorApprove = event.target.closest("[data-mirror-approve]");
  if (mirrorApprove && !mirrorApprove.disabled) approveOverviewProposal(mirrorApprove.dataset.mirrorApprove);
  const proposalDecline = event.target.closest("[data-proposal-decline]");
  if (proposalDecline && !proposalDecline.disabled) declineOverviewProposal(proposalDecline.dataset.proposalDecline);
  const proposalDetails = event.target.closest("[data-proposal-drawer]");
  if (proposalDetails) proposalDrawer(proposalDetails.dataset.proposalDrawer);
  const opportunityDetails = event.target.closest("[data-opportunity-drawer]");
  if (opportunityDetails) opportunityDrawer(opportunityDetails.dataset.opportunityDrawer);
  const workerDetails = event.target.closest("[data-worker-drawer]");
  if (workerDetails) workerDrawer(workerDetails.dataset.workerDrawer);
  const reportDetails = event.target.closest("[data-report-drawer]");
  if (reportDetails) reportDrawer(reportDetails.dataset.reportDrawer);
  if (event.target.closest("#telegramApprovalButton")) requestTelegramApproval();
  if (event.target.closest("#telegramEnableButton")) enableTelegram();
  if (event.target.closest("#telegramTestButton")) telegramAction("test");
  if (event.target.closest("#telegramDisableButton")) telegramAction("disable");
  if (event.target.closest("#telegramRemoveButton")) telegramAction("remove");
  if (event.target.closest("#mirrorRefreshButton")) syncLocalFiles();
});

$("#guardrailForm").addEventListener("submit", requestGuardrails);
$("#applyGuardrails").addEventListener("click", applyApprovedGuardrails);
$("#orderDraftForm").addEventListener("submit", buildOrderDraft);
$("#shadowResetForm").addEventListener("submit", resetShadowPortfolio);
$("#telegramConfigForm").addEventListener("submit", configureTelegram);

$("#applyFilters").addEventListener("click", applyFilters);
$("#syncButton").addEventListener("click", syncLocalFiles);
$("#stockChatForm").addEventListener("submit", askStockGuru);

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
});
function tickLivePortfolio() {
  const clock = $("#overviewLiveClock");
  if (!clock) return;
  const snapshotAt = Date.parse(state.brokerControl?.snapshotUpdatedAt || "");
  const ageSeconds = Number.isFinite(snapshotAt) ? Math.max(0, Math.floor((Date.now() - snapshotAt) / 1_000)) : null;
  clock.textContent = ageSeconds === null ? "Waiting for live account" : `Display live · broker read ${ageSeconds}s ago`;
  if (state.activeView === "overview") renderOverviewDashboard();
  if (state.activeView === "mirror") renderMirror();
}

window.setInterval(tickLivePortfolio, 1_000);
window.setInterval(pollLivePortfolio, 1_000);
window.setInterval(pollBrokerControl, 5_000);

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
      if (state.activeView === "overview") pollLivePortfolio();
    }, 150);
  };
  [
    "research.completed",
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

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
  robinhoodConnection: null,
  connectionApproval: null,
  guardrailApproval: null,
  guardrailsSource: null,
  tradeDrafts: [],
  dispatchHandoff: null,
};

const $ = (selector) => document.querySelector(selector);

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

function renderMetrics() {
  const metrics = state.overview?.metrics || {};
  const sourceHealth = state.overview?.sourceHealth || {};
  const cards = [
    ["Records", metrics.trackedRecords ?? 0, `${metrics.validSetups ?? 0} valid setup(s)`],
    ["Watchlist", metrics.watchlistCount ?? 0, "local universe"],
    ["Rejected", metrics.rejectedRecords ?? 0, "risk filtered"],
    ["Sources", sourceHealth.ready ?? 0, `${sourceHealth.stale ?? 0} stale · ${sourceHealth.error ?? 0} error`],
    ["Buying power", metrics.buyingPower || "Unknown", "masked broker snapshot"],
    ["Mirror signals", metrics.mirrorSignals ?? 0, `${metrics.mirrorPaperReady ?? 0} paper-ready`],
  ];
  $("#metricGrid").innerHTML = cards.map(([label, value, hint]) => metricCard(label, value, hint)).join("");
  $("#stockStatusPill").textContent = sourceHealth.status ? `Sources: ${sourceHealth.status}` : "Read only";
  $("#safetyCopy").textContent = state.overview?.workspace?.safetyRule || "Research and analytics only. No broker actions are available.";
}

function brokerStatusLabel(value) {
  const labels = {
    live_snapshot_verified: "Live account verified",
    stale_snapshot: "Reconnect required",
    oauth_required: "OAuth required",
    tool_contract_pending: "Tool check required",
  };
  return labels[value] || "Setup required";
}

function portfolioKindLabel(value) {
  const labels = {
    copy_entry: "Copy entry",
    copy_exit: "Copy exit",
    risk_exit: "Stop exit",
    profit_exit: "Profit-lock exit",
    strategy_exit_review: "Strategy exit",
    native_entry: "Evaluator entry",
  };
  return labels[value] || String(value || "review").replaceAll("_", " ");
}

function renderPortfolioPlan() {
  const plan = state.portfolioPlan || {};
  const capital = plan.capital || state.brokerControl?.capital || {};
  const proposals = plan.proposals || [];
  const ready = proposals.filter((item) => item.draftEligible).length;
  const status = $("#portfolioPlanStatus");
  status.textContent = capital.verified ? `${ready} exact draft${ready === 1 ? "" : "s"} ready` : "Capital evidence incomplete";
  status.className = capital.verified ? "ready-copy" : "danger-copy";
  $("#portfolioCapitalMetrics").innerHTML = [
    ["Allocated", formatMoney(capital.principalDollars), `maximum deployed ${formatMoney(capital.maxDeployedDollars)}`],
    ["Live deployed", formatMoney(capital.deployedDollars), `${formatMoney(capital.pendingBuyDollars)} pending buys`],
    ["New-buy room", formatMoney(capital.availableForNewBuys), `reserve ${formatMoney(capital.cashReserveDollars)}`],
    ["Today P&L", capital.dayPnlDollars === null || capital.dayPnlDollars === undefined ? "Unverified" : formatMoney(capital.dayPnlDollars), `loss lock ${formatMoney(capital.dailyLossLimitDollars)}`],
    ["Trades today", capital.tradesToday === null || capital.tradesToday === undefined ? "Unverified" : `${capital.tradesToday}/${capital.maxTradesPerDay}`, capital.tradeLimitReached ? "daily limit reached" : "official order history"],
    ["Per-symbol cap", formatMoney(capital.maxPositionDollars), "derived from max deployed ÷ positions"],
  ].map(([label, value, hint]) => metricCard(label, value, hint)).join("");
  $("#portfolioProposals").innerHTML = proposals.length
    ? proposals.map((proposal) => `
        <article class="portfolio-proposal ${proposal.draftEligible ? "ready" : "blocked"}">
          <div>
            <span>${escapeHtml(portfolioKindLabel(proposal.kind))}</span>
            <strong>${escapeHtml(proposal.side)} ${escapeHtml(proposal.symbol)} · ${escapeHtml(formatMoney(proposal.requestedDollars))}</strong>
            <small>${escapeHtml(proposal.reasons?.join(" ") || "Current evidence review.")}</small>
            ${proposal.blockers?.length ? `<em>${escapeHtml(proposal.blockers[0])}</em>` : `<em>Capital after proposal: ${escapeHtml(formatMoney(proposal.capitalAfterDollars))}</em>`}
          </div>
          <button type="button" data-portfolio-draft="${escapeHtml(proposal.id)}" ${proposal.draftEligible ? "" : "disabled"}>Stage exact draft</button>
        </article>
      `).join("")
    : `<div class="empty-state"><p>No buy or sell proposal passes the currently loaded copy, position, and evaluator evidence.</p></div>`;
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

function renderTradeDraft(draft) {
  const target = $("#orderDraftResult");
  if (!draft) {
    target.innerHTML = `<p>No order draft yet. Building a draft never places a trade.</p>`;
    return;
  }
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
  pill.textContent = brokerStatusLabel(control.connectorStatus);
  pill.className = `status-pill ${control.authenticationVerified ? "ready" : control.connectorStatus === "stale_snapshot" ? "warning" : "muted"}`;
  $("#brokerAccountLabel").textContent = control.accountLabel || "Not verified";
  $("#orderKillSwitch").textContent = control.killSwitchActive ? "Kill switch ON" : "Kill switch cleared";
  $("#orderKillSwitch").className = control.killSwitchActive ? "danger-copy" : "ready-copy";
  $("#brokerMetrics").innerHTML = [
    ["Connector", toolContract.registered ? "Registered" : "Setup required", "official Robinhood MCP"],
    ["Tool contract", toolContract.verified ? "Verified" : `${toolContract.missingTools?.length || 0} missing`, toolContract.endpointMatches ? "official endpoint" : "endpoint unverified"],
    ["Authentication", control.authenticationVerified ? "Verified" : "Not verified", control.snapshotAgeMinutes === null ? "no live snapshot" : `${control.snapshotAgeMinutes}m snapshot age`],
    ["Buying power", formatMoney(control.buyingPowerDollars), "live broker value required"],
    ["Positions", control.positions?.length || 0, `${control.openOrderCount || 0} open order(s)`],
    ["Per-order cap", formatMoney(guardrails.maxOrderDollars), `principal ${formatMoney(guardrails.principalDollars)}`],
    ["Live entry", control.buyReady ? "Ready" : "Blocked", control.killSwitchActive ? "kill switch active" : "strict checks"],
  ].map(([label, value, hint]) => metricCard(label, value, hint)).join("");

  $("#brokerOnboarding").innerHTML = [
    [toolContract.registered, "Official Trading MCP registered"],
    [toolContract.endpointMatches && !toolContract.missingTools?.length, "Official endpoint and required equity tools verified"],
    [control.authenticationVerified, "Robinhood OAuth and Agentic account verified"],
    [control.buyingPowerDollars > 0, "Dedicated account funded with settled buying power"],
    [control.buyReady, "Fresh portfolio, quotes, risk evidence, and kill switch ready"],
  ].map(([done, label]) => `<li class="${done ? "done" : "waiting"}"><i>${done ? "✓" : "•"}</i><span>${escapeHtml(label)}</span></li>`).join("");
  $("#brokerBlockers").innerHTML = control.blockers?.length
    ? `<strong>Before any new BUY:</strong><ul>${control.blockers.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : `<strong>New-entry preflight is clear.</strong><p>Every exact order still requires Robinhood review and Human Gate.</p>`;

  const connectionButton = $("#brokerConnectGate");
  if (connection.oauthAuthenticated) {
    connectionButton.dataset.action = "refresh";
    connectionButton.disabled = false;
    connectionButton.textContent = connection.snapshotVerified ? "Refresh live Robinhood account" : "Verify Agentic account now";
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
    connectionButton.textContent = "Authorize official connection setup";
  }
  $("#brokerConnectionFeedback").textContent = connection.lastError
    ? `Connection check stopped: ${connection.lastError}`
    : connection.snapshotVerified
      ? `Official live snapshot verified ${formatTime(connection.snapshotUpdatedAt)}. Tokens remain in Mac Keychain.`
      : connection.oauthAuthenticated
        ? "OAuth is connected, but the dedicated Agentic account still needs a successful live refresh."
        : connection.keychainAvailable === false
          ? "Mac Keychain is unavailable, so Stock Office refuses to store Robinhood OAuth tokens."
          : "No Robinhood password or token is entered into Stock Office.";

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
  renderPortfolioPlan();
  renderShadowPortfolio();
  renderTradeDraft(state.tradeDrafts[0] || null);
}

function mirrorStatusLabel(value) {
  return String(value || "unknown").replaceAll("_", " ");
}

function renderMirror() {
  const mirror = state.mirror || state.overview?.mirror || {};
  const summary = mirror.summary || {};
  const candidates = mirror.candidates || [];
  const sources = mirror.sources || [];
  const warnings = mirror.warnings || [];
  const importer = mirror.importer || {};
  const importer13f = mirror.importer13f || {};
  const knowledge = mirror.knowledge || {};
  const knowledgeSummary = knowledge.summary || {};
  const pill = $("#mirrorStatusPill");
  pill.textContent = !mirror.available ? "Waiting for plan" : mirror.stale ? "Plan stale" : "Paper + Human Gate";
  pill.className = `status-pill ${mirror.stale ? "warning" : "muted"}`;
  $("#mirrorMetrics").innerHTML = [
    ["Signals", summary.signalsReceived ?? 0, "attributable inputs"],
    ["Paper-ready", summary.paperReady ?? 0, "passed all checks"],
    ["Research-only", summary.researchOnly ?? 0, "too delayed or unsupported"],
    ["Planned paper", summary.plannedPaperNotional || "$0.00", "bounded notional"],
    ["Form 4 intake", importer.available ? `${importer.enabledEntries || 0} enabled` : "Not run", importer.available ? `${importer.signalsImported || 0} latest signal(s)` : "named reporting owners"],
    ["13F research", importer13f.available ? `${importer13f.enabledEntries || 0} managers` : "Not run", importer13f.available ? `${importer13f.signalsImported || 0} holding change(s)` : "delayed, never executable"],
    ["Measured", knowledgeSummary.measuredOutcomes ?? 0, `${knowledgeSummary.pendingOutcomes ?? 0} outcomes pending`],
    ["Live orders", summary.liveOrdersPlaced ?? 0, "must remain zero in this plan"],
  ].map(([label, value, hint]) => metricCard(label, value, hint)).join("");

  $("#mirrorCandidates").innerHTML = candidates.length
      ? candidates.map((candidate) => {
        const gateSent = state.mirrorApprovalIds.has(candidate.id);
        const gateEnabled = candidate.humanGateEligible && !mirror.stale && !gateSent;
        const ownedPositionExit = candidate.side === "SELL" && candidate.brokerPositionRequired === true
          && (state.brokerControl?.positions || []).some((position) => position.symbol === candidate.symbol && Number(position.sharesAvailableForSells ?? position.quantity) > 0);
        const draftEnabled = !mirror.stale && (candidate.humanGateEligible || ownedPositionExit);
        const mainReason = candidate.reasons?.[0] || "No evaluation reason recorded.";
        return `
          <article class="mirror-candidate ${escapeHtml(statusClass(candidate.status))}">
            <div class="mirror-candidate-head">
              <div>
                <span class="mirror-signal">${escapeHtml(candidate.side)} ${escapeHtml(candidate.symbol)}</span>
                <strong>${escapeHtml(candidate.traderName)}</strong>
              </div>
              <em class="tag ${escapeHtml(statusClass(candidate.status))}">${escapeHtml(mirrorStatusLabel(candidate.status))}</em>
            </div>
            <div class="mirror-candidate-metrics">
              <span><small>Source</small><b>${escapeHtml(candidate.sourceName)}</b></span>
              <span><small>Lag / quote age</small><b>${escapeHtml(`${Number(candidate.disclosureLagHours || 0).toFixed(1)}h · ${Number(candidate.currentPriceAgeHours || 0).toFixed(1)}h`)}</b></span>
              <span><small>Price drift</small><b>${escapeHtml(candidate.priceDriftPct === null ? "Unknown" : formatPercent(candidate.priceDriftPct, 2))}</b></span>
              <span><small>Evidence</small><b>${escapeHtml(`${Number(candidate.evidenceScore ?? 0.5).toFixed(3)} · ${mirrorStatusLabel(candidate.evidenceStatus)}`)}</b></span>
              <span><small>Paper cap</small><b>${escapeHtml(formatMoney(candidate.mirrorNotionalDollars))}</b></span>
            </div>
            <p>${escapeHtml(mainReason)}</p>
            <div class="mirror-candidate-actions">
              ${candidate.sourceUrl ? `<a href="${escapeHtml(candidate.sourceUrl)}" target="_blank" rel="noreferrer">Open provenance</a>` : `<span>Provenance unavailable</span>`}
              <button type="button" data-mirror-draft="${escapeHtml(candidate.id)}" ${draftEnabled ? "" : "disabled"}>
                ${ownedPositionExit ? "Stage owned-position exit" : candidate.humanGateEligible ? mirror.stale ? "Refresh before drafting" : "Stage guarded order" : "No verified position"}
              </button>
              <button type="button" data-mirror-gate="${escapeHtml(candidate.id)}" ${gateEnabled ? "" : "disabled"}>
                ${gateSent ? "Plan review sent" : candidate.humanGateEligible ? mirror.stale ? "Refresh before review" : "Review plan only" : "Research only"}
              </button>
            </div>
          </article>
        `;
      }).join("")
    : `<div class="empty-state mirror-empty"><div><h3>No eligible public signals yet</h3><p>The evaluator is working. Mirror candidates appear only after an approved, attributable source intake is configured with named SEC Form 4 CIKs and a compliant contact identity. Missing provenance, timing, or current prices fails closed.</p></div></div>`;

  $("#mirrorSources").innerHTML = sources.length
    ? sources.map((source) => `
        <article class="mirror-source">
          <div><strong>${escapeHtml(source.name)}</strong><small>${escapeHtml(source.sourceType)}</small></div>
          <em class="tag ${source.mirrorEligible && source.enabled ? "ready" : "review"}">${source.mirrorEligible && source.enabled ? "mirror eligible" : "research only"}</em>
          <p>${escapeHtml(source.notes || "No source note recorded.")}</p>
        </article>
      `).join("")
    : `<p class="muted-copy">No source registry was loaded.</p>`;
  const profiles = knowledge.sourceProfiles || [];
  $("#knowledgeStatus").textContent = !knowledge.available
    ? "Neutral · no ledger"
    : knowledge.stale
      ? "Ledger stale"
      : `${knowledgeSummary.measuredOutcomes || 0} measured`;
  $("#knowledgeStatus").className = `status-pill ${knowledge.stale ? "warning" : "muted"}`;
  $("#knowledgeMetrics").innerHTML = [
    ["Observations", knowledgeSummary.observationsSeen ?? 0],
    ["Measured", knowledgeSummary.measuredOutcomes ?? 0],
    ["Missing baseline", knowledgeSummary.missingBaselines ?? 0],
  ].map(([label, value]) => `<span><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></span>`).join("");
  $("#knowledgeProfiles").innerHTML = profiles.length
    ? profiles.map((profile) => `
        <article class="knowledge-profile">
          <div><strong>${escapeHtml(profile.sourceId)}</strong><small>${escapeHtml(profile.sampleSize ? `${profile.sampleSize} sample(s) · ${formatPercent(profile.hitRate)} hit` : "No matured outcomes")}</small></div>
          <div><b>${escapeHtml(Number(profile.evidenceScore ?? 0.5).toFixed(3))}</b><em class="tag ${profile.evidenceStatus === "measured" ? "ready" : "review"}">${escapeHtml(mirrorStatusLabel(profile.evidenceStatus))}</em></div>
        </article>
      `).join("")
    : `<p class="muted-copy">No profiles yet. Scores stay neutral until real outcomes mature.</p>`;
  const combinedWarnings = [...warnings, ...(knowledge.warnings || [])];
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
    state.brokerControl = brokerPayload.brokerControl || null;
    state.portfolioPlan = brokerPayload.portfolioPlan || null;
    state.shadowPortfolio = brokerPayload.shadowPortfolio || null;
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
    window.location.href = payload.authorizationUrl;
  } catch (error) {
    $("#brokerConnectionFeedback").textContent = error.message;
    button.disabled = false;
    button.textContent = "Complete Robinhood OAuth on desktop";
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
  } catch (error) {
    $("#guardrailFeedback").textContent = error.message;
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
    $("#orderDraftResult").innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  } finally {
    button.disabled = false;
    button.textContent = "Build guarded draft";
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
  if (state.loading) return;
  try {
    const payload = await api("/api/stock-office/broker-control");
    state.brokerControl = payload.brokerControl || state.brokerControl;
    state.portfolioPlan = payload.portfolioPlan || state.portfolioPlan;
    state.shadowPortfolio = payload.shadowPortfolio || state.shadowPortfolio;
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
  } catch (_error) {}
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
      ? "Stock Office refreshed"
      : refresh.status === "partial"
        ? "Refresh completed with warnings"
        : refresh.status === "failed"
          ? "Refresh could not start"
          : "Local reports rescanned";
  const issue = refresh.errors?.[0] || refresh.warnings?.[0];
  $("#refreshFeedbackMessage").textContent = issue || refresh.message || "Refresh status updated.";
  $("#refreshFeedbackTime").textContent = refresh.completedAt ? formatTime(refresh.completedAt) : "Working now";
}

async function pollRefreshStatus() {
  try {
    const payload = await api("/api/stock-office/refresh-status");
    renderRefreshFeedback(payload.refresh);
    const stage = String(payload.refresh?.stage || "refresh").replaceAll("_", " ");
    $("#syncButton").textContent = payload.refresh?.status === "running" ? `Refreshing: ${stage}` : "Refresh Stock Office";
  } catch (_error) {}
}

async function syncLocalFiles() {
  const button = $("#syncButton");
  button.disabled = true;
  button.textContent = "Starting refresh...";
  renderRefreshFeedback({ status: "running", stage: "preflight", message: "Connecting to the local evaluator...", startedAt: new Date().toISOString() });
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
    button.textContent = "Refresh Stock Office";
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

document.addEventListener("click", (event) => {
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
  const portfolioDraft = event.target.closest("[data-portfolio-draft]");
  if (portfolioDraft && !portfolioDraft.disabled) stagePortfolioProposal(portfolioDraft.dataset.portfolioDraft);
});

$("#guardrailForm").addEventListener("submit", requestGuardrails);
$("#applyGuardrails").addEventListener("click", applyApprovedGuardrails);
$("#orderDraftForm").addEventListener("submit", buildOrderDraft);
$("#shadowResetForm").addEventListener("submit", resetShadowPortfolio);

$("#applyFilters").addEventListener("click", applyFilters);
$("#syncButton").addEventListener("click", syncLocalFiles);
$("#stockChatForm").addEventListener("submit", askStockGuru);

Promise.all([loadApp(), pollRefreshStatus()]);
window.setInterval(pollBrokerControl, 3_000);

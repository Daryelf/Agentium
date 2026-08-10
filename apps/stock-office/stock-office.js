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
  tradeDrafts: [],
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
  };
  return labels[value] || "Setup required";
}

function renderTradeDraft(draft) {
  const target = $("#orderDraftResult");
  if (!draft) {
    target.innerHTML = `<p>No order draft yet. Building a draft never places a trade.</p>`;
    return;
  }
  const ready = draft.status === "ready_for_broker_review" && !draft.blockers?.length;
  target.dataset.status = ready ? "ready" : "blocked";
  target.innerHTML = `
    <div class="order-draft-heading">
      <div><span>${escapeHtml(draft.side)} ${escapeHtml(draft.symbol)}</span><strong>${escapeHtml(formatMoney(draft.requestedDollars))}</strong></div>
      <em class="tag ${ready ? "ready" : "rejected"}">${escapeHtml(String(draft.status || "blocked").replaceAll("_", " "))}</em>
    </div>
    <p>${escapeHtml(draft.thesis || "No thesis recorded.")}</p>
    <div class="order-draft-stats">
      <span><small>Reference</small><b>${escapeHtml(formatMoney(draft.referencePrice))}</b></span>
      <span><small>Estimated shares</small><b>${escapeHtml(Number(draft.estimatedQuantity || 0).toFixed(6))}</b></span>
      <span><small>Expires</small><b>${escapeHtml(formatTime(draft.expiresAt))}</b></span>
    </div>
    ${draft.blockers?.length ? `<ul>${draft.blockers.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p class="order-ready-copy">Local gates passed. Robinhood must still review the order and return no warnings.</p>`}
    <button type="button" data-order-gate="${escapeHtml(draft.id)}" ${ready ? "" : "disabled"}>Send exact order to Human Gate</button>
    <small>Live order placed: ${draft.liveOrderPlaced ? "yes" : "no"}</small>
  `;
}

function renderBrokerControl() {
  const control = state.brokerControl || {};
  const guardrails = control.guardrails || {};
  const pill = $("#brokerStatusPill");
  pill.textContent = brokerStatusLabel(control.connectorStatus);
  pill.className = `status-pill ${control.authenticationVerified ? "ready" : control.connectorStatus === "stale_snapshot" ? "warning" : "muted"}`;
  $("#brokerAccountLabel").textContent = control.accountLabel || "Not verified";
  $("#orderKillSwitch").textContent = control.killSwitchActive ? "Kill switch ON" : "Kill switch cleared";
  $("#orderKillSwitch").className = control.killSwitchActive ? "danger-copy" : "ready-copy";
  $("#brokerMetrics").innerHTML = [
    ["Connector", control.registrationStatus === "registered_in_codex" ? "Registered" : "Setup required", "official Robinhood MCP"],
    ["Authentication", control.authenticationVerified ? "Verified" : "Not verified", control.snapshotAgeMinutes === null ? "no live snapshot" : `${control.snapshotAgeMinutes}m snapshot age`],
    ["Buying power", formatMoney(control.buyingPowerDollars), "live broker value required"],
    ["Positions", control.positions?.length || 0, `${control.openOrderCount || 0} open order(s)`],
    ["Per-order cap", formatMoney(guardrails.maxOrderDollars), `principal ${formatMoney(guardrails.principalDollars)}`],
    ["Live entry", control.buyReady ? "Ready" : "Blocked", control.killSwitchActive ? "kill switch active" : "strict checks"],
  ].map(([label, value, hint]) => metricCard(label, value, hint)).join("");

  $("#brokerOnboarding").innerHTML = [
    [true, "Official Trading MCP registered"],
    [control.authenticationVerified, "Robinhood OAuth and Agentic account verified"],
    [control.buyingPowerDollars > 0, "Dedicated account funded with settled buying power"],
    [control.buyReady, "Fresh portfolio, quotes, risk evidence, and kill switch ready"],
  ].map(([done, label]) => `<li class="${done ? "done" : "waiting"}"><i>${done ? "✓" : "•"}</i><span>${escapeHtml(label)}</span></li>`).join("");
  $("#brokerBlockers").innerHTML = control.blockers?.length
    ? `<strong>Before any new BUY:</strong><ul>${control.blockers.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : `<strong>New-entry preflight is clear.</strong><p>Every exact order still requires Robinhood review and Human Gate.</p>`;

  if (!$("#guardrailForm").dataset.loaded) {
    $("#principalDollars").value = guardrails.principalDollars || 25;
    $("#maxTotalDollars").value = guardrails.maxTotalDollars || 25;
    $("#maxOrderDollars").value = guardrails.maxOrderDollars || 5;
    $("#cashReserveDollars").value = guardrails.cashReserveDollars || 0;
    $("#dailyLossLimitPct").value = ((guardrails.dailyLossLimitPct || 0.02) * 100).toFixed(1);
    $("#maxPositions").value = guardrails.maxPositions || 5;
    $("#orderDollars").value = Math.min(guardrails.maxOrderDollars || 5, 5);
    $("#guardrailForm").dataset.loaded = "true";
  }
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
  const pill = $("#mirrorStatusPill");
  pill.textContent = !mirror.available ? "Waiting for plan" : mirror.stale ? "Plan stale" : "Paper + Human Gate";
  pill.className = `status-pill ${mirror.stale ? "warning" : "muted"}`;
  $("#mirrorMetrics").innerHTML = [
    ["Signals", summary.signalsReceived ?? 0, "attributable inputs"],
    ["Paper-ready", summary.paperReady ?? 0, "passed all checks"],
    ["Research-only", summary.researchOnly ?? 0, "too delayed or unsupported"],
    ["Planned paper", summary.plannedPaperNotional || "$0.00", "bounded notional"],
    ["SEC intake", importer.available ? `${importer.enabledEntries || 0} enabled` : "Not run", importer.available ? `${importer.signalsImported || 0} latest signal(s)` : "opt-in named CIKs"],
    ["Live orders", summary.liveOrdersPlaced ?? 0, "must remain zero"],
  ].map(([label, value, hint]) => metricCard(label, value, hint)).join("");

  $("#mirrorCandidates").innerHTML = candidates.length
    ? candidates.map((candidate) => {
        const gateSent = state.mirrorApprovalIds.has(candidate.id);
        const gateEnabled = candidate.humanGateEligible && !mirror.stale && !gateSent;
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
              <span><small>Disclosure lag</small><b>${escapeHtml(`${Number(candidate.disclosureLagHours || 0).toFixed(1)}h`)}</b></span>
              <span><small>Price drift</small><b>${escapeHtml(candidate.priceDriftPct === null ? "Unknown" : formatPercent(candidate.priceDriftPct, 2))}</b></span>
              <span><small>Paper cap</small><b>${escapeHtml(formatMoney(candidate.mirrorNotionalDollars))}</b></span>
            </div>
            <p>${escapeHtml(mainReason)}</p>
            <div class="mirror-candidate-actions">
              ${candidate.sourceUrl ? `<a href="${escapeHtml(candidate.sourceUrl)}" target="_blank" rel="noreferrer">Open provenance</a>` : `<span>Provenance unavailable</span>`}
              <button type="button" data-mirror-gate="${escapeHtml(candidate.id)}" ${gateEnabled ? "" : "disabled"}>
                ${gateSent ? "Sent to Human Gate" : candidate.humanGateEligible ? mirror.stale ? "Refresh before review" : "Send to Human Gate" : "Research only"}
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
  $("#mirrorWarnings").innerHTML = warnings.slice(0, 6).map((warning) => `<li>${escapeHtml(warning)}</li>`).join("") || `<li>No warning record was loaded.</li>`;
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
        maxPositions: Number($("#maxPositions").value),
      }),
    });
    feedback.textContent = payload.approval?.status === "pending"
      ? "Exact limits sent to Human Gate. No money moved and no broker setting changed."
      : "An identical limits request is already pending.";
  } catch (error) {
    feedback.textContent = error.message;
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
    if (button) button.textContent = payload.approval?.status === "pending" ? "Exact order is in Human Gate" : "Approval already exists";
  } catch (error) {
    if (button) button.textContent = error.message;
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
  feedback.textContent = "Applying filters...";
  await loadApp();
  feedback.textContent = state.recordTotal
    ? `Showing ${state.recordTotal} matching record${state.recordTotal === 1 ? "" : "s"}.`
    : state.overview?.metrics?.trackedRecords
      ? "No records match those filters."
      : "No records are loaded yet. Use Refresh Stock Office first.";
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
  if (brokerConnect) requestBrokerConnection();
  const orderGate = event.target.closest("[data-order-gate]");
  if (orderGate) sendOrderToHumanGate(orderGate.dataset.orderGate);
  const row = event.target.closest("[data-ticker]");
  if (row) selectRecord(row.dataset.ticker);
  const mirrorGate = event.target.closest("[data-mirror-gate]");
  if (mirrorGate && !mirrorGate.disabled) sendMirrorToHumanGate(mirrorGate.dataset.mirrorGate);
});

$("#guardrailForm").addEventListener("submit", requestGuardrails);
$("#orderDraftForm").addEventListener("submit", buildOrderDraft);

$("#applyFilters").addEventListener("click", applyFilters);
$("#syncButton").addEventListener("click", syncLocalFiles);
$("#stockChatForm").addEventListener("submit", askStockGuru);

Promise.all([loadApp(), pollRefreshStatus()]);

const state = {
  overview: null,
  records: [],
  selectedTicker: null,
  sources: [],
  activity: [],
  messages: [],
  mirror: null,
  mirrorApprovalIds: new Set(),
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
    : `<div class="empty-state mirror-empty"><div><h3>No public signals imported</h3><p>Add named SEC CIKs to the copy watchlist, configure the SEC contact identity, then run <code>stock-guru copy-refresh-sec</code> or the continuous watcher. The system fails closed if provenance, timing, or current prices are missing.</p></div></div>`;

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
  $("#recordsTitle").textContent = `${total} ${total === 1 ? "record" : "records"}`;
  if (!total) {
    $("#recordsList").innerHTML = `
      <div class="empty-state">
        <div>
          <h2>No Stock Guru records loaded</h2>
          <p>Run the Stock Guru scanner/evaluator outside Argentum, then press Sync local files here.</p>
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
  try {
    const query = new URLSearchParams({
      q: $("#searchInput")?.value || "",
      status: $("#statusFilter")?.value || "all",
      sort: "score_desc",
      pageSize: "30",
    });
    const [overview, records, sources, activity, chat, mirrorPayload] = await Promise.all([
      api("/api/stock-office/overview"),
      api(`/api/stock-office/records?${query.toString()}`),
      api("/api/stock-office/sources"),
      api("/api/stock-office/activity"),
      api("/api/stock-office/chat"),
      api("/api/stock-office/mirror"),
    ]);
    state.overview = overview;
    state.records = records.records || [];
    state.sources = sources.sources || [];
    state.activity = [...(activity.syncRuns || []), ...(activity.activity || []), ...(activity.assistantRuns || [])].sort((a, b) => new Date(b.createdAt || b.timestamp || 0) - new Date(a.createdAt || a.timestamp || 0));
    state.messages = chat.messages || [];
    state.mirror = mirrorPayload.mirror || overview.mirror || null;
    renderMetrics();
    renderRecords();
    renderSources();
    renderActivity();
    renderChat();
    renderMirror();
    if (!state.selectedTicker && state.records[0]?.ticker) selectRecord(state.records[0].ticker);
  } catch (error) {
    $("#stockStatusPill").textContent = "Error";
    $("#recordsList").innerHTML = `<div class="empty-state"><p>${escapeHtml(error.message)}</p></div>`;
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

async function syncLocalFiles() {
  const button = $("#syncButton");
  button.disabled = true;
  button.textContent = "Syncing...";
  try {
    await api("/api/stock-office/sync", { method: "POST", body: "{}" });
    await loadApp();
  } catch (error) {
    $("#recordsList").innerHTML = `<div class="empty-state"><p>${escapeHtml(error.message)}</p></div>`;
  } finally {
    button.disabled = false;
    button.textContent = "Sync local files";
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
  const row = event.target.closest("[data-ticker]");
  if (row) selectRecord(row.dataset.ticker);
  const mirrorGate = event.target.closest("[data-mirror-gate]");
  if (mirrorGate && !mirrorGate.disabled) sendMirrorToHumanGate(mirrorGate.dataset.mirrorGate);
});

$("#applyFilters").addEventListener("click", loadApp);
$("#syncButton").addEventListener("click", syncLocalFiles);
$("#stockChatForm").addEventListener("submit", askStockGuru);

loadApp();

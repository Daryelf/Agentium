(function () {
  const VIEW_LABELS = {
    home: "Command Center",
    agents: "Agents",
    "agent-1010": "Agent 1010",
    clipping: "Clipping Office",
    trading: "Trading",
    "human-gate": "Human Gate",
    activity: "Activity",
  };

  const state = {
    display: { view: "home", allowedViews: Object.keys(VIEW_LABELS) },
    snapshot: null,
    connection: "reconnecting",
    eventSource: null,
    lastEventAt: 0,
    refreshTimer: null,
  };

  const refs = {
    shell: document.getElementById("displayShell"),
    stage: document.getElementById("displayStage"),
    viewLabel: document.getElementById("displayViewLabel"),
    rail: document.getElementById("modeRail"),
    currentTime: document.getElementById("currentTime"),
    activeAgentCount: document.getElementById("activeAgentCount"),
    alertMetric: document.getElementById("alertMetric"),
    hubStatusChip: document.getElementById("hubStatusChip"),
    connectionStatusChip: document.getElementById("connectionStatusChip"),
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function numberText(value, fallback = "0") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toLocaleString("en-US") : fallback;
  }

  function compactText(value, fallback = "Unavailable") {
    const text = String(value ?? "").trim();
    return text || fallback;
  }

  function timeText(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return "--";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function relativeText(value) {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "--";
    const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.round(hours / 24)}d`;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      ...options,
    });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return response.json();
  }

  function setConnection(next) {
    state.connection = next;
    const chip = refs.connectionStatusChip;
    chip.classList.remove("is-online", "is-reconnecting", "is-offline");
    chip.classList.add(next === "online" ? "is-online" : next === "offline" ? "is-offline" : "is-reconnecting");
    chip.querySelector("strong").textContent = next === "online" ? "HUB ONLINE" : next === "offline" ? "HUB OFFLINE" : "RECONNECTING";
  }

  function applyEnvelope(payload) {
    if (payload.display) state.display = payload.display;
    if (payload.snapshot) state.snapshot = payload.snapshot;
    else if (payload.schemaVersion) state.snapshot = payload;
    render();
  }

  function applyDelta(payload) {
    if (payload.display) state.display = payload.display;
    if (state.snapshot && payload.counts) {
      state.snapshot.system = state.snapshot.system || {};
      state.snapshot.system.counts = { ...(state.snapshot.system.counts || {}), ...payload.counts };
      state.snapshot.humanGate = state.snapshot.humanGate || {};
      state.snapshot.humanGate.pending = payload.counts.pendingApprovals;
      state.snapshot.agents = state.snapshot.agents || {};
      state.snapshot.agents.queuedTasks = payload.counts.queuedTasks;
      state.snapshot.agents.runningTasks = payload.counts.runningTasks;
      state.snapshot.agents.completedTasks = payload.counts.completedTasks;
    }
    if (state.snapshot && payload.agent) {
      state.snapshot.agents = { ...(state.snapshot.agents || {}), ...payload.agent };
    }
    render();
    scheduleRefresh(650);
  }

  function scheduleRefresh(delayMs) {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => loadState().catch(() => {}), delayMs);
  }

  async function loadState() {
    const payload = await api("/api/display/state");
    applyEnvelope(payload);
    setConnection("online");
  }

  function connectEvents() {
    if (state.eventSource) state.eventSource.close();
    const source = new EventSource("/api/display/events");
    state.eventSource = source;
    source.onopen = () => {
      state.lastEventAt = Date.now();
      setConnection("online");
    };
    source.onerror = () => {
      setConnection(Date.now() - state.lastEventAt > 30000 ? "offline" : "reconnecting");
    };
    source.addEventListener("display.snapshot", (event) => {
      state.lastEventAt = Date.now();
      applyEnvelope(JSON.parse(event.data));
      setConnection("online");
    });
    source.addEventListener("display.navigate", (event) => {
      state.lastEventAt = Date.now();
      const payload = JSON.parse(event.data);
      if (payload.display) state.display = payload.display;
      render();
      setConnection("online");
    });
    source.addEventListener("display.heartbeat", (event) => {
      state.lastEventAt = Date.now();
      const payload = JSON.parse(event.data);
      if (payload.display) state.display = payload.display;
      renderChrome();
      setConnection("online");
    });
    source.addEventListener("display.controller", (event) => {
      state.lastEventAt = Date.now();
      const payload = JSON.parse(event.data);
      if (payload.display) state.display = payload.display;
      renderChrome();
      setConnection("online");
    });
    source.addEventListener("display.pairing_requested", (event) => {
      state.lastEventAt = Date.now();
      const payload = JSON.parse(event.data);
      if (payload.display) state.display = payload.display;
      render();
      setConnection("online");
    });
    source.addEventListener("argentum.state_changed", (event) => {
      state.lastEventAt = Date.now();
      applyDelta(JSON.parse(event.data));
      setConnection("online");
    });
  }

  function startClock() {
    const tick = () => {
      refs.currentTime.textContent = timeText();
      if (state.lastEventAt && Date.now() - state.lastEventAt > 45000) setConnection("offline");
    };
    tick();
    setInterval(tick, 1000);
  }

  function renderRail() {
    const views = state.display.allowedViews || Object.keys(VIEW_LABELS);
    refs.rail.innerHTML = views.map((view) => `
      <span class="mode-tab ${view === state.display.view ? "is-active" : ""}">
        <span aria-hidden="true"></span>${escapeHtml(VIEW_LABELS[view] || view)}
      </span>
    `).join("");
  }

  function renderChrome() {
    const snapshot = state.snapshot || {};
    const view = state.display.view || "home";
    refs.shell.dataset.view = view;
    refs.viewLabel.textContent = VIEW_LABELS[view] || "Command Center";
    refs.activeAgentCount.textContent = numberText(snapshot.header?.activeAgentCount ?? snapshot.agents?.activeAgents, "1");
    const alertCount = Number(snapshot.header?.alertCount ?? snapshot.alerts?.length ?? 0);
    refs.alertMetric.querySelector("strong").textContent = numberText(alertCount, "0");
    refs.alertMetric.classList.toggle("has-alerts", alertCount > 0);
    refs.hubStatusChip.classList.add("is-online");
    refs.hubStatusChip.querySelector("strong").textContent = "HUB ONLINE";
    renderRail();
  }

  function metric(label, value, detail) {
    return `<div class="metric"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong><span>${escapeHtml(detail || "")}</span></div>`;
  }

  function badge(text, tone) {
    return `<span class="status-badge ${tone ? `is-${tone}` : ""}">${escapeHtml(text)}</span>`;
  }

  function panel(title, subtitle, body, status) {
    return `
      <section class="panel">
        <header>
          <div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle || "")}</p></div>
          ${status || ""}
        </header>
        <div class="panel-body">${body}</div>
      </section>
    `;
  }

  function rows(items, emptyLabel) {
    if (!items || !items.length) return `<div class="empty-state"><strong>${escapeHtml(emptyLabel)}</strong></div>`;
    return `<div class="list-stack">${items.map((item) => `
      <div class="row">
        <div><strong>${escapeHtml(item.title || item.label || item.name || "--")}</strong><span>${escapeHtml(item.detail || item.sub || item.status || "")}</span></div>
        <small>${escapeHtml(item.meta || item.count || item.time || "")}</small>
      </div>
    `).join("")}</div>`;
  }

  function activityRows(items) {
    if (!items || !items.length) return `<div class="empty-state"><strong>No recent activity</strong></div>`;
    return `<div class="list-stack activity-list">${items.map((item) => `
      <div class="row">
        <b>${escapeHtml(item.source || "Event")}</b>
        <div><strong>${escapeHtml(item.title || "Argentum event")}</strong><span>${escapeHtml(item.detail || "")}</span></div>
        <small>${escapeHtml(relativeText(item.createdAt))}</small>
      </div>
    `).join("")}</div>`;
  }

  function pairingBanner() {
    const pairing = state.display.pairing;
    if (!pairing || pairing.status !== "pending") return "";
    return `
      <aside class="pairing-banner" aria-live="assertive">
        <small>ESP32 PAIRING</small>
        <strong>${escapeHtml(pairing.code)}</strong>
        <span>${escapeHtml(pairing.label || pairing.deviceId)}</span>
      </aside>
    `;
  }

  function homeView(snapshot) {
    const agents = snapshot.agents || {};
    const clipping = snapshot.clipping || {};
    const trading = snapshot.trading || {};
    const humanGate = snapshot.humanGate || {};
    const system = snapshot.system || {};
    return `
      <div class="view-grid home-grid">
        <section class="panel is-main">
          <header>
            <div><h2>Agent 1010</h2><p>${escapeHtml(agents.mode || "Supervised internal work")}</p></div>
            ${badge(agents.status || "Active supervised")}
          </header>
          <div class="panel-body hero-readout">
            <div>
              <h3>${escapeHtml(agents.currentTask || "Standing by for bounded work")}</h3>
              <p>${escapeHtml(system.status || "Local systems operational")}</p>
            </div>
            <div class="metric-grid">
              ${metric("Queued", numberText(agents.queuedTasks), "tasks")}
              ${metric("Running", numberText(agents.runningTasks), "tasks and missions")}
              ${metric("Completed", numberText(agents.completedTasks), "tasks")}
            </div>
            ${activityRows(snapshot.activity || [])}
          </div>
        </section>
        ${panel("Clipping Office", clipping.headline || "Office standing by", `
          <div class="metric-grid">
            ${metric("Streams", numberText(clipping.streamsWatched, "--"), "watched now")}
            ${metric("Candidates", numberText(clipping.clipCandidates, "--"), "clip moments")}
            ${metric("Approvals", numberText(clipping.clipsAwaitingApproval, "--"), "awaiting gate")}
          </div>
        `, badge(clipping.monitoringStatus || "idle", clipping.available === false ? "warning" : ""))}
        ${panel("Trading", trading.marketState || "Market state unknown", `
          <div class="metric-grid">
            ${metric("Research", compactText(trading.researchStatus, "unknown"), "status")}
            ${metric("Positions", numberText(trading.positionsSummary?.count, "--"), "verified")}
            ${metric("Orders", numberText(trading.ordersRequiringAttention, "--"), "need attention")}
          </div>
        `, badge(trading.status || "research guarded", trading.available === false ? "warning" : ""))}
        ${panel("Human Gate", "Approval boundary", `
          ${rows((humanGate.approvals || []).slice(0, 4).map((approval) => ({
            title: approval.title,
            detail: approval.category,
            meta: approval.urgency,
          })), "No pending approvals")}
        `, badge(`${numberText(humanGate.pending)} pending`, humanGate.pending ? "warning" : ""))}
        ${panel("Alerts", "Important system signals", `
          ${rows((snapshot.alerts || []).slice(0, 6).map((alert) => ({
            title: alert.title,
            detail: alert.body,
            meta: alert.level,
          })), "No active alerts")}
        `)}
      </div>
    `;
  }

  function agentsView(snapshot) {
    const agents = snapshot.agents || {};
    return `
      <div class="view-grid two-column">
        <section class="panel is-main">
          <header><div><h2>Agent Roster</h2><p>Active supervised workers</p></div>${badge(`${numberText(agents.activeAgents, "1")} active`)}</header>
          <div class="panel-body scroll-body">
            ${rows((agents.agents || []).map((agent) => ({
              title: agent.label,
              detail: `${agent.status} / ${agent.authority}`,
              meta: agent.office,
            })), "No agents registered")}
          </div>
        </section>
        ${panel("Work Queue", "Current execution counts", `
          <div class="metric-grid">
            ${metric("Queued", numberText(agents.queuedTasks), "waiting")}
            ${metric("Running", numberText(agents.runningTasks), "active")}
            ${metric("Done", numberText(agents.completedTasks), "completed")}
          </div>
        `)}
      </div>
    `;
  }

  function agent1010View(snapshot) {
    const agents = snapshot.agents || {};
    return `
      <div class="view-grid two-column">
        <section class="panel is-main">
          <header><div><h2>Agent 1010</h2><p>${escapeHtml(agents.mode || "Supervised internal work")}</p></div>${badge(agents.status || "Active")}</header>
          <div class="panel-body hero-readout">
            <div class="detail-headline">
              <h3>${escapeHtml(agents.currentTask || "Standing by")}</h3>
              <p>External actions remain routed through Human Gate.</p>
            </div>
            <div class="metric-grid">
              ${metric("Missions", numberText(agents.activeMissions), "active")}
              ${metric("Runs", numberText(agents.activeRuns), "active")}
              ${metric("Gate", numberText(agents.pendingApprovals), "pending")}
            </div>
            ${activityRows((snapshot.activity || []).filter((item) => item.source === "Audit").slice(0, 8))}
          </div>
        </section>
        ${panel("System", snapshot.system?.status || "Local systems operational", `
          ${rows((snapshot.system?.metrics || []).map((item) => ({
            title: item.label,
            detail: item.value,
            meta: item.measured ? "live" : "",
          })), "No system metrics")}
        `)}
      </div>
    `;
  }

  function clippingView(snapshot) {
    const clipping = snapshot.clipping || {};
    return `
      <div class="view-grid two-column">
        <section class="panel is-main">
          <header><div><h2>Clipping Office</h2><p>${escapeHtml(clipping.headline || "Office standing by")}</p></div>${badge(clipping.monitoringStatus || "idle", clipping.available === false ? "warning" : "")}</header>
          <div class="panel-body scroll-body">
            <div class="workflow-strip">
              ${(clipping.workflow || []).map((step) => `<div class="workflow-step"><small>${escapeHtml(step.label)}</small><strong>${numberText(step.count)}</strong><small>${escapeHtml(step.detail || "")}</small></div>`).join("")}
            </div>
            <table class="signal-table">
              <thead><tr><th>Stream</th><th>Platform</th><th>Status</th><th>Buffer</th><th>Chat</th></tr></thead>
              <tbody>
                ${(clipping.streams || []).map((stream) => `
                  <tr><td>${escapeHtml(stream.streamerName)}</td><td>${escapeHtml(stream.platform)}</td><td>${escapeHtml(stream.status)}</td><td>${numberText(stream.bufferedSeconds, "--")}s</td><td>${numberText(stream.messagesPerMinute, "--")}/m</td></tr>
                `).join("") || `<tr><td colspan="5">No active streams</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
        ${panel("Clip Queue", "Candidates and posting", `
          <div class="metric-grid">
            ${metric("Candidates", numberText(clipping.clipCandidates, "--"), "visible")}
            ${metric("Queued", numberText(clipping.clipsQueued, "--"), "not ready")}
            ${metric("Posting", numberText(clipping.postingQueue, "--"), "drafts")}
          </div>
          ${rows((clipping.recentClips || []).map((clip) => ({
            title: clip.title,
            detail: clip.streamerName,
            meta: clip.stage,
          })), "No clip candidates")}
        `)}
      </div>
    `;
  }

  function tradingView(snapshot) {
    const trading = snapshot.trading || {};
    return `
      <div class="view-grid two-column">
        <section class="panel is-main">
          <header><div><h2>Trading</h2><p>${escapeHtml(trading.marketState || "Market state unknown")}</p></div>${badge(trading.status || "research guarded", trading.available === false ? "warning" : "")}</header>
          <div class="panel-body scroll-body">
            <div class="metric-grid">
              ${metric("Research", compactText(trading.researchStatus, "unknown"), "scheduler")}
              ${metric("Ready Sources", numberText(trading.sourceHealth?.ready, "--"), "loaded")}
              ${metric("Attention", numberText(trading.ordersRequiringAttention, "--"), "orders")}
            </div>
            <table class="signal-table">
              <thead><tr><th>Symbol</th><th>Quantity</th><th>Value</th><th>Price</th></tr></thead>
              <tbody>
                ${(trading.positionsSummary?.positions || []).map((position) => `
                  <tr><td>${escapeHtml(position.symbol)}</td><td>${escapeHtml(position.quantity ?? "--")}</td><td>${escapeHtml(position.marketValue ?? "--")}</td><td>${escapeHtml(position.currentPrice ?? "--")}</td></tr>
                `).join("") || `<tr><td colspan="4">No verified live positions</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
        ${panel("Orders and Alerts", `Next research ${relativeText(trading.scheduler?.nextRunAt)}`, `
          ${rows((trading.tradeDrafts || []).map((draft) => ({
            title: `${draft.side || ""} ${draft.symbol || ""}`.trim() || "Draft",
            detail: draft.status,
            meta: draft.expiresAt ? relativeText(draft.expiresAt) : "",
          })), "No orders requiring attention")}
          ${rows((trading.alerts || []).map((alert) => ({
            title: alert.title,
            detail: alert.body,
            meta: alert.level,
          })), "No trading alerts")}
        `)}
      </div>
    `;
  }

  function humanGateView(snapshot) {
    const gate = snapshot.humanGate || {};
    return `
      <div class="view-grid two-column">
        <section class="panel is-main">
          <header><div><h2>Human Gate</h2><p>Approval boundary</p></div>${badge(`${numberText(gate.pending)} pending`, gate.pending ? "warning" : "")}</header>
          <div class="panel-body scroll-body">
            ${rows((gate.approvals || []).map((approval) => ({
              title: approval.title,
              detail: `${approval.category} / ${approval.originatingSystem}`,
              meta: approval.urgency,
            })), "No pending approvals")}
          </div>
        </section>
        ${panel("Alert Load", "Items needing operator attention", `
          ${rows((snapshot.alerts || []).map((alert) => ({
            title: alert.title,
            detail: alert.body,
            meta: alert.level,
          })), "No active alerts")}
        `)}
      </div>
    `;
  }

  function activityView(snapshot) {
    return `
      <div class="view-grid two-column">
        <section class="panel is-main">
          <header><div><h2>Activity Feed</h2><p>Recent meaningful Argentum events</p></div>${badge(`${numberText((snapshot.activity || []).length)} events`)}</header>
          <div class="panel-body scroll-body">${activityRows(snapshot.activity || [])}</div>
        </section>
        ${panel("Sources", "Display data freshness", `
          ${rows((snapshot.infrastructure?.sources || []).map((source) => ({
            title: source.id,
            detail: `${source.status} / ${source.freshness}`,
            meta: source.warning ? "warn" : "ok",
          })), "No source records")}
        `)}
      </div>
    `;
  }

  function render() {
    renderChrome();
    const snapshot = state.snapshot;
    if (!snapshot) return;
    const view = state.display.view || "home";
    const renderers = {
      home: homeView,
      agents: agentsView,
      "agent-1010": agent1010View,
      clipping: clippingView,
      trading: tradingView,
      "human-gate": humanGateView,
      activity: activityView,
    };
    refs.stage.innerHTML = `${pairingBanner()}${(renderers[view] || homeView)(snapshot)}`;
  }

  startClock();
  renderRail();
  loadState().catch(() => setConnection("reconnecting"));
  connectEvents();
  setInterval(() => loadState().catch(() => {}), 30000);
})();

const navItems = [
  ["dashboard", "Dashboard", "D"],
  ["watchlist", "Stream Watchlist", "W"],
  ["radar", "Clip Radar", "R"],
  ["builder", "Clip Builder", "B"],
  ["queue", "Posting Queue", "Q"],
  ["gate", "Human Gate", "G"],
  ["outputs", "Outputs", "O"],
  ["logs", "Logs", "L"],
  ["settings", "Settings", "S"]
];

const state = {
  view: "dashboard",
  config: null,
  health: null,
  openai: null,
  twitch: null,
  streamers: [],
  candidates: [],
  packages: [],
  drafts: [],
  approvals: [],
  artifacts: [],
  logs: [],
  selectedCandidateId: localStorage.getItem("selectedCandidateId") || "",
  selectedStreamerId: localStorage.getItem("selectedStreamerId") || ""
};

const $ = (selector) => document.querySelector(selector);
const view = $("#view");
const appBasePath = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const apiBasePath = appBasePath === "" ? "" : appBasePath;

function appUrl(path) {
  const normalized = String(path || "");
  if (!apiBasePath || normalized.startsWith("http")) return normalized;
  return `${apiBasePath}${normalized.startsWith("/") ? normalized : `/${normalized}`}`;
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtDate(value) {
  if (!value) return "Never";
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function badge(text, tone = "neutral") {
  return `<span class="pill ${tone}">${esc(text)}</span>`;
}

function streamerName(id) {
  return state.streamers.find((streamer) => streamer.id === id)?.displayName || "Unknown streamer";
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function countWhere(items, predicate) {
  return items.filter(predicate).length;
}

function dailyLimitValue() {
  const approvedToday = countWhere(
    state.drafts,
    (draft) => draft.approvalStatus === "approved" && (draft.approvedAt || draft.updatedAt || draft.createdAt || "").slice(0, 10) === todayKey()
  );
  return {
    approvedToday,
    limit: state.config?.postDailyLimit || 20,
    pct: Math.min(100, Math.round((approvedToday / (state.config?.postDailyLimit || 20)) * 100))
  };
}

function candidateTone(score) {
  if (score >= 90) return "good";
  if (score >= 60) return "warn";
  return "info";
}

function initials(label) {
  return String(label || "SC")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function sparkline(seed = 0) {
  return Array.from({ length: 12 }, (_, index) => {
    const value = 16 + ((seed + index * 13) % 34);
    return `<i style="height:${value}%"></i>`;
  }).join("");
}

function miniThumb(label, index = 0) {
  return `
    <div class="clip-thumb thumb-${index % 5}">
      <span>LIVE</span>
      <strong>${esc(initials(label))}</strong>
      <em>${(index + 1) * 3}.${index + 7}K</em>
    </div>
  `;
}

function renderSidebarOps() {
  const limit = dailyLimitValue();
  const pendingApprovals = countWhere(state.approvals, (approval) => approval.status === "pending");
  $("#sidebar-ops").innerHTML = `
    <section class="limit-card">
      <span>Daily Limit</span>
      <div class="limit-ring" style="--p:${limit.pct}">
        <b>${limit.approvedToday} / ${limit.limit}</b>
        <small>Approved today</small>
      </div>
      <div class="limit-track"><i style="width:${limit.pct}%"></i></div>
      <p>${limit.pct}% used</p>
    </section>
    <section class="agent-chip">
      <span class="agent-orb">SC</span>
      <div>
        <strong>StreamClipper Pro</strong>
        <small>${pendingApprovals ? `${pendingApprovals} gate reviews` : "Supervised and ready"}</small>
      </div>
    </section>
  `;
}

async function api(path, options = {}) {
  const response = await fetch(appUrl(path), {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `${response.status} ${response.statusText}`);
  return json;
}

function toast(message, tone = "info") {
  const node = $("#toast");
  node.hidden = false;
  node.textContent = message;
  node.style.borderLeftColor = tone === "bad" ? "var(--red)" : tone === "good" ? "var(--green)" : "var(--cyan)";
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => {
    node.hidden = true;
  }, 4200);
}

async function loadCore() {
  const [health, config, openai, twitch, streamers, candidates, posts, approvals, artifacts, logs] = await Promise.all([
    api("/api/health"),
    api("/api/config"),
    api("/api/openai/status"),
    api("/api/twitch/status"),
    api("/api/twitch/streamers"),
    api("/api/clips/candidates"),
    api("/api/posts/queue"),
    api("/api/human-gate/approvals"),
    api("/api/artifacts"),
    api("/api/logs")
  ]);
  Object.assign(state, {
    health,
    config,
    openai,
    twitch,
    streamers: streamers.streamers,
    candidates: candidates.candidates,
    drafts: posts.drafts,
    approvals: approvals.approvals,
    artifacts: artifacts.artifacts,
    logs: logs.logs
  });
  updateStatus(posts.dailyLimit);
}

function updateStatus(limit) {
  $("#api-status").className = "pill good";
  $("#api-status").textContent = "API online";
  $("#openai-status").className = `pill ${state.openai?.configured ? "good" : "warn"}`;
  $("#openai-status").textContent = state.openai?.configured ? "OpenAI live" : "OpenAI local";
  $("#twitch-status").className = `pill ${state.twitch?.configured ? "good" : "warn"}`;
  $("#twitch-status").textContent = state.twitch?.configured ? "Twitch ready" : "Twitch demo";
  $("#limit-status").className = `pill ${limit?.blocked ? "bad" : limit?.warning ? "warn" : "info"}`;
  $("#limit-status").textContent = `${limit?.approvedToday ?? 0}/${limit?.limit ?? 20} approved`;
  renderSidebarOps();
}

function renderNav() {
  $("#nav").innerHTML = navItems
    .map(([id, label, icon]) => {
      const count =
        id === "queue"
          ? countWhere(state.drafts, (draft) => draft.approvalStatus === "pending")
          : id === "gate"
            ? countWhere(state.approvals, (approval) => approval.status === "pending")
            : "";
      return `
        <button class="${state.view === id ? "active" : ""}" data-nav="${id}">
          <span>${esc(icon)}</span>
          <em>${esc(label)}</em>
          ${count ? `<b>${count}</b>` : ""}
        </button>
      `;
    })
    .join("");
  $("#nav").onclick = (event) => {
    const button = event.target.closest("[data-nav]");
    if (!button) return;
    setView(button.dataset.nav);
  };
}

function setView(id) {
  state.view = id;
  const label = navItems.find((item) => item[0] === id)?.[1] || "Dashboard";
  $("#view-title").textContent = label;
  $("#view-subtitle").textContent = subtitleFor(id);
  renderNav();
  render();
}

function subtitleFor(id) {
  return {
    dashboard: "System status and daily queue",
    watchlist: "Streamer permissions and monitoring",
    radar: "Detected moments and scoring",
    builder: "9:16 packages and CapCut handoffs",
    queue: "Draft-only social packages",
    gate: "Approvals for risky actions",
    outputs: "Exported briefs and caption files",
    logs: "System event trail",
    settings: "Backend status and limits"
  }[id];
}

function render() {
  const renderers = {
    dashboard: renderDashboard,
    watchlist: renderWatchlist,
    radar: renderRadar,
    builder: renderBuilder,
    queue: renderQueue,
    gate: renderGate,
    outputs: renderOutputs,
    logs: renderLogs,
    settings: renderSettings
  };
  renderers[state.view]();
}

function renderDashboard() {
  const watched = countWhere(state.streamers, (item) => item.monitorEnabled);
  const approved = countWhere(state.streamers, (item) => item.permissionStatus === "approved");
  const liveNow = countWhere(state.streamers, (item) => String(item.liveStatus || "").includes("live"));
  const pendingCandidates = countWhere(state.candidates, (candidate) => candidate.status === "candidate");
  const highScore = countWhere(state.candidates, (candidate) => Number(candidate.score || 0) >= 60);
  const ready = countWhere(state.candidates, (candidate) => candidate.status === "packaged");
  const queuedToday = countWhere(state.drafts, (draft) => (draft.createdAt || "").slice(0, 10) === todayKey());
  const awaitingApproval = countWhere(state.drafts, (draft) => draft.approvalStatus === "pending");
  const pendingApprovals = countWhere(state.approvals, (approval) => approval.status === "pending");
  const approvedToday = dailyLimitValue().approvedToday;
  view.innerHTML = `
    <div class="dashboard-hero">
      <div>
        <span class="eyebrow">Realtime AI clipping desk</span>
        <h2>StreamClipper Command</h2>
        <p>Monitor approved creators, score moments, build 9:16 packages, and hold every risky external step at Human Gate.</p>
      </div>
      <div class="hero-actions">
        <button class="primary" data-action="run-watch">Run Watch Cycle</button>
        <button data-action="seed-demo">Load Demo Mission</button>
      </div>
    </div>
    <div class="metric-strip">
      ${metric("Watched Streams", watched, `${state.streamers.length} total`, "CAM", "good")}
      ${metric("Approved Streamers", approved, `${liveNow} live now`, "PRO", "violet")}
      ${metric("Clip Candidates", pendingCandidates, `${highScore} high score`, "AI", "info")}
      ${metric("Ready Packages", ready, `${awaitingApproval} for review`, "PKG", "warn")}
      ${metric("Posts Queued Today", queuedToday, `${approvedToday} approved`, "OUT", "good")}
      ${metric("Human Gate", pendingApprovals, "Pending decisions", "GATE", "violet")}
    </div>
    <div class="dashboard-main">
      <section class="panel live-desk">
        <div class="toolbar">
          <div>
            <h2>Live Desk</h2>
            <p class="muted">Realtime stream monitoring</p>
          </div>
          <div class="actions">
            <button class="primary" data-action="run-watch">Run Watch Cycle</button>
            <button data-nav-jump="gate">Open Human Gate</button>
          </div>
        </div>
        ${renderLiveDesk()}
      </section>
      <section class="panel candidate-rail">
        <div class="toolbar">
          <h2>Top Clip Candidates</h2>
          <button data-nav-jump="radar">View all</button>
        </div>
        ${renderTopCandidates()}
      </section>
    </div>
    <div class="dashboard-lower">
      <section class="panel funnel-panel">
        <div class="toolbar">
          <h2>Clip Funnel</h2>
          <span class="pill info">Today</span>
        </div>
        ${renderFunnel({ watched, moments: state.candidates.length, highScore, ready, approved: approvedToday })}
      </section>
      <section class="panel activity-panel">
        <div class="toolbar">
          <h2>Activity Feed</h2>
          <button data-nav-jump="logs">View all</button>
        </div>
        ${renderActivityFeed(5)}
      </section>
      <section class="panel system-panel">
        <div class="toolbar">
          <h2>System Status</h2>
          <span class="pill good">Operational</span>
        </div>
        ${renderSystemTiles()}
      </section>
    </div>
    <section class="panel quick-command">
      <h2>Quick Actions</h2>
      <div class="quick-grid">
        <button data-nav-jump="watchlist"><span>A</span><b>Add Streamer</b><small>Monitor a channel</small></button>
        <button data-action="run-watch"><span>R</span><b>Run Watch Cycle</b><small>Scan approved streams</small></button>
        <button data-nav-jump="builder"><span>P</span><b>Create Clip Package</b><small>Build new package</small></button>
        <button data-nav-jump="gate"><span>G</span><b>Open Human Gate</b><small>Review approvals</small></button>
        <button data-nav-jump="queue"><span>Q</span><b>Posting Queue</b><small>Manage drafts</small></button>
        <button data-nav-jump="outputs"><span>O</span><b>View Outputs</b><small>Browse exports</small></button>
      </div>
    </section>
  `;
}

function metric(label, value, detail = "", icon = "SC", tone = "info") {
  return `
    <section class="panel metric metric-${esc(tone)}">
      <span class="metric-icon">${esc(icon)}</span>
      <div>
        <span>${esc(label)}</span>
        <strong>${esc(value)}</strong>
        <small>${esc(detail)}</small>
      </div>
    </section>
  `;
}

function renderLiveDesk() {
  if (!state.streamers.length) {
    return `
      <div class="empty-mission">
        <strong>No streamers loaded yet</strong>
        <p>Add approved creators manually, or load a local demo mission to test the clipping pipeline without Twitch credentials.</p>
        <button class="primary" data-action="seed-demo">Load Demo Mission</button>
      </div>
    `;
  }
  const cards = state.streamers.slice(0, 4).map((streamer, index) => `
    <article class="stream-card">
      ${miniThumb(streamer.displayName, index)}
      <div class="stream-meta">
        <strong>${esc(streamer.displayName)}</strong>
        ${permissionBadge(streamer.permissionStatus)}
      </div>
      <p>${esc(streamer.liveStatus || "unknown")} · ${esc(streamer.platform)}</p>
      <div class="stream-foot">
        <span>${fmtDate(streamer.lastCheckedAt)}</span>
        <span class="spark">${sparkline(index * 7)}</span>
      </div>
    </article>
  `).join("");
  return `
    <div class="stream-grid">
      ${cards}
      <button class="add-stream-card" data-nav-jump="watchlist"><b>+</b><span>Add Streamer</span><small>Monitor a new channel</small></button>
    </div>
  `;
}

function renderTopCandidates() {
  const candidates = [...state.candidates].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, 5);
  if (!candidates.length) return empty("No candidates yet. Run a watch cycle after adding approved streamers.");
  return `<div class="candidate-list">${candidates.map((candidate, index) => `
    <article class="candidate-row">
      ${miniThumb(candidate.title, index + 2)}
      <span class="candidate-score ${candidateTone(Number(candidate.score || 0))}">${Number(candidate.score || 0)}</span>
      <div>
        <strong>${esc(candidate.title)}</strong>
        <small>${esc(streamerName(candidate.streamerId))} · ${esc(candidate.category || "Clip")}</small>
        <em>${esc(candidate.timestampStart)} · ${esc(candidate.duration || 30)}s</em>
      </div>
      <span class="spark">${sparkline(Number(candidate.score || 0))}</span>
    </article>
  `).join("")}</div>`;
}

function renderFunnel({ watched, moments, highScore, ready, approved }) {
  const rows = [
    ["Streams Watched", watched, "funnel-1"],
    ["Moments Detected", moments, "funnel-2"],
    ["Strong Score (60+)", highScore, "funnel-3"],
    ["Packages Created", ready, "funnel-4"],
    ["Approved", approved, "funnel-5"]
  ];
  return `
    <div class="funnel">
      <div class="funnel-shape">
        ${rows.map((row) => `<i class="${row[2]}"></i>`).join("")}
      </div>
      <div class="funnel-legend">
        ${rows.map(([label, value]) => `<span><b>${esc(label)}</b><em>${esc(value)}</em></span>`).join("")}
      </div>
    </div>
  `;
}

function renderActivityFeed(limit = 5) {
  const logs = state.logs.slice(0, limit);
  if (!logs.length) return empty("No activity yet");
  return `<div class="activity-list">${logs.map((log, index) => `
    <article>
      <span>${esc(log.type?.slice(0, 2).toUpperCase() || "LG")}</span>
      <p>${esc(log.message)}</p>
      <time>${fmtDate(log.createdAt)}</time>
    </article>
  `).join("")}</div>`;
}

function renderSystemTiles() {
  const tiles = [
    ["Twitch API", state.twitch?.configured ? "Connected" : "Demo mode", state.twitch?.configured ? "good" : "warn"],
    ["OpenAI API", state.openai?.configured ? "Connected" : "Local fallback", state.openai?.configured ? "good" : "warn"],
    ["Storage", "Healthy", "good"],
    ["Human Gate", countWhere(state.approvals, (approval) => approval.status === "pending") ? "Reviewing" : "Ready", "info"]
  ];
  return `<div class="system-grid">${tiles.map(([label, value, tone]) => `
    <span class="system-tile ${esc(tone)}"><b>${esc(label)}</b><em>${esc(value)}</em></span>
  `).join("")}</div>`;
}

function renderWatchlist() {
  const liveCount = countWhere(state.streamers, (streamer) => String(streamer.liveStatus || "").includes("live"));
  const monitoringCount = countWhere(state.streamers, (streamer) => streamer.monitorEnabled);
  const offlineCount = countWhere(state.streamers, (streamer) => !String(streamer.liveStatus || "").includes("live"));
  const pendingCount = countWhere(state.streamers, (streamer) => streamer.permissionStatus === "pending");
  const blockedCount = countWhere(state.streamers, (streamer) => streamer.permissionStatus === "blocked");
  const selected = selectedStreamer();
  view.innerHTML = `
    <section class="watchlist-page">
      <div class="watchlist-tabs">
        <button class="active">All Streamers <b>${state.streamers.length}</b></button>
        <button>Live Now <b>${liveCount}</b></button>
        <button>Monitoring <b>${monitoringCount}</b></button>
        <button>Offline <b>${offlineCount}</b></button>
        <button>Pending <b>${pendingCount}</b></button>
      </div>

      <div class="watchlist-actions">
        <button data-action="test-twitch">Import from Twitch</button>
        <button class="primary" data-focus-add-streamer>Add Streamer</button>
      </div>

      <div class="watchlist-stats">
        ${watchStat("Total Streamers", state.streamers.length, "+ local workspace", "TEAM", "warn")}
        ${watchStat("Live Right Now", liveCount, `${state.streamers.length ? Math.round((liveCount / state.streamers.length) * 100) : 0}% of total`, "LIVE", "bad")}
        ${watchStat("Monitoring", monitoringCount, "Actively watching", "EYE", "info")}
        ${watchStat("Pending Approval", pendingCount, "Needs review", "CLK", "warn")}
        ${watchStat("Blocked", blockedCount, "No blocked channels", "SHD", "neutral")}
      </div>

      <div class="watchlist-shell">
        <section class="panel streamer-directory">
          <div class="watchlist-filterbar">
            <label class="stream-search">Search streamers <input placeholder="Search streamers..." aria-label="Search streamers"></label>
            <select aria-label="Platform filter"><option>Platform: All</option><option>Twitch</option><option>YouTube</option><option>Kick</option></select>
            <select aria-label="Status filter"><option>Status: All</option><option>Monitoring</option><option>Paused</option></select>
            <select aria-label="Permission filter"><option>Permission: All</option><option>Approved</option><option>Pending</option></select>
            <select aria-label="Sort filter"><option>Sort: Last Checked</option><option>Sort: Candidates</option><option>Sort: Name</option></select>
          </div>
          ${state.streamers.length ? renderStreamerTable(true) : empty("No streamers added")}
        </section>

        <aside class="panel streamer-inspector">
          ${selected ? renderStreamerInspector(selected) : empty("Select or add a streamer")}
        </aside>
      </div>

      <div class="watchlist-bottom">
        <section class="panel add-streamer-panel" id="add-streamer-panel">
          <div class="section-head">
            <span class="panel-icon">TW</span>
            <div>
              <h2>Add Streamer</h2>
              <p class="muted">Add a new channel to monitor.</p>
            </div>
          </div>
          ${renderCompactStreamerForm()}
        </section>
        <section class="panel monitoring-panel">
          <h2>Monitoring Settings</h2>
          <div class="settings-rows">
            <span><b>Check Interval</b><em>60 seconds</em></span>
            <span><b>Clip Detection</b><em>Enabled</em></span>
            <span><b>Min Clip Score</b><em>60</em></span>
            <span><b>Max Clips / Day</b><em>${state.config?.postDailyLimit || 20}</em></span>
          </div>
        </section>
        <section class="panel watchlist-quick-actions">
          <h2>Quick Actions</h2>
          <button class="primary" data-action="run-watch">Run Watch Cycle Now</button>
          <button data-nav-jump="radar">View Clip Radar</button>
          <button data-action="seed-demo">Load Demo Mission</button>
          <button data-nav-jump="settings">API Connections</button>
        </section>
      </div>
    </section>
  `;
}

function renderStreamerTable(editable) {
  const sortedStreamers = [...state.streamers].sort((a, b) => {
    const liveDelta = Number(String(b.liveStatus || "").includes("live")) - Number(String(a.liveStatus || "").includes("live"));
    if (liveDelta) return liveDelta;
    return String(b.lastCheckedAt || "").localeCompare(String(a.lastCheckedAt || ""));
  });
  return `
    <div class="watch-table-wrap">
      <table class="watch-table">
        <thead>
          <tr>
            <th><span class="select-box"></span></th>
            <th>Streamer</th>
            <th>Platform</th>
            <th>Status</th>
            <th>Permission</th>
            <th>Live Status</th>
            <th>Last Checked</th>
            <th>Clip Candidates</th>
            ${editable ? "<th>Actions</th>" : ""}
          </tr>
        </thead>
        <tbody>
          ${sortedStreamers.map((streamer, index) => `
            <tr class="${selectedStreamer()?.id === streamer.id ? "selected" : ""}" data-select-streamer="${streamer.id}">
              <td><span class="select-box"></span></td>
              <td>
                <div class="streamer-cell">
                  <span class="creator-avatar avatar-${index % 6}">${esc(initials(streamer.displayName))}</span>
                  <div>
                    <strong>${esc(streamer.displayName)} <em>verified</em></strong>
                    <small>${esc(streamer.channelId || streamer.channelUrl || "local channel")}</small>
                  </div>
                </div>
              </td>
              <td>${platformBadge(streamer.platform)}</td>
              <td>${streamer.monitorEnabled ? badge("Monitoring", "good") : badge("Paused", "info")}</td>
              <td>${permissionBadge(streamer.permissionStatus)}</td>
              <td>${liveBadge(streamer)}</td>
              <td>${fmtDate(streamer.lastCheckedAt)}</td>
              <td>
                <div class="candidate-mini">
                  <b>${streamerCandidateCount(streamer.id)}</b>
                  <span class="spark">${sparkline(index * 11)}</span>
                </div>
              </td>
              ${editable ? `<td><div class="actions">
                <button data-toggle-monitor="${streamer.id}">${streamer.monitorEnabled ? "Pause" : "Monitor"}</button>
                <button data-approve-streamer="${streamer.id}">OK</button>
                <button class="danger" data-delete-streamer="${streamer.id}">Del</button>
              </div></td>` : ""}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function watchStat(label, value, detail, icon, tone = "info") {
  return `
    <section class="panel watch-stat watch-stat-${esc(tone)}">
      <span>${esc(icon)}</span>
      <div>
        <small>${esc(label)}</small>
        <strong>${esc(value)}</strong>
        <em>${esc(detail)}</em>
      </div>
    </section>
  `;
}

function renderCompactStreamerForm() {
  return `
    <form id="streamer-form" class="streamer-mini-form">
      <input name="displayName" required placeholder="Twitch channel name or URL">
      <select name="platform">
        <option value="twitch">Twitch</option>
        <option value="youtube_live">YouTube</option>
        <option value="kick">Kick</option>
        <option value="other">Other</option>
      </select>
      <input name="channelId" required placeholder="Channel ID / login">
      <input name="channelUrl" placeholder="Channel URL">
      <select name="permissionStatus">
        <option value="approved">approved</option>
        <option value="pending">pending</option>
        <option value="blocked">blocked</option>
      </select>
      <select name="monitorEnabled">
        <option value="true">monitoring on</option>
        <option value="false">monitoring off</option>
      </select>
      <div class="hidden-checks">
        <label><input type="checkbox" name="allowedUse" value="clips" checked>clips</label>
        <label><input type="checkbox" name="allowedUse" value="edits" checked>edits</label>
        <label><input type="checkbox" name="allowedUse" value="reposts">reposts</label>
      </div>
      <textarea name="notes" placeholder="Permission source, owner notes, highlight style"></textarea>
      <button class="primary" type="submit">Add</button>
    </form>
  `;
}

function selectedStreamer() {
  const selected = state.streamers.find((streamer) => streamer.id === state.selectedStreamerId);
  if (selected) return selected;
  return state.streamers[0] || null;
}

function streamerCandidateCount(streamerId) {
  return countWhere(state.candidates, (candidate) => candidate.streamerId === streamerId);
}

function platformBadge(platform) {
  const label = platform === "youtube_live" ? "YouTube" : platform || "Twitch";
  return `<span class="platform-badge">${esc(label)}</span>`;
}

function liveBadge(streamer) {
  const live = String(streamer.liveStatus || "").includes("live");
  return `<span class="live-badge ${live ? "is-live" : ""}">${live ? "LIVE" : "OFFLINE"}</span>`;
}

function renderStreamerInspector(streamer) {
  const live = String(streamer.liveStatus || "").includes("live");
  return `
    <div class="inspector-profile">
      <span class="creator-avatar large">${esc(initials(streamer.displayName))}</span>
      <div>
        <h2>${esc(streamer.displayName)}</h2>
        <p>${esc(streamer.channelId || "local channel")} · ${streamerCandidateCount(streamer.id)} candidates</p>
      </div>
      <span class="live-badge ${live ? "is-live" : ""}">${live ? "LIVE" : "OFFLINE"}</span>
    </div>
    <div class="inspector-tabs">
      <span class="active">Overview</span>
      <span>Permissions</span>
      <span>History</span>
      <span>Settings</span>
    </div>
    <div class="inspector-section">
      <h3>Channel Info</h3>
      <div class="inspector-kv">
        <span>Channel ID</span><b>${esc(streamer.channelId || "not set")}</b>
        <span>Platform</span><b>${esc(streamer.platform)}</b>
        <span>Partner Status</span><b>${streamer.permissionStatus === "approved" ? "Approved" : "Needs review"}</b>
        <span>Language</span><b>English</b>
      </div>
    </div>
    <div class="inspector-section">
      <h3>Performance</h3>
      <div class="performance-grid">
        <span><b>${streamerCandidateCount(streamer.id)}</b><em>Candidates</em></span>
        <span><b>${streamer.monitorEnabled ? "On" : "Off"}</b><em>Monitor</em></span>
        <span><b>${(streamer.allowedUse || []).length}</b><em>Allowed uses</em></span>
      </div>
      <div class="wide-spark">${sparkline(streamerCandidateCount(streamer.id) * 13)}</div>
    </div>
    <div class="inspector-section">
      <h3>Monitoring Settings</h3>
      <div class="toggle-list">
        <span>Monitor Live Streams <b class="${streamer.monitorEnabled ? "on" : ""}"></b></span>
        <span>Monitor VODs <b class="on"></b></span>
        <span>Detect Clips Automatically <b class="on"></b></span>
      </div>
    </div>
    <div class="inspector-section">
      <h3>Notes</h3>
      <p class="note-box">${esc(streamer.notes || "High energy variety streamer. Good for reaction and highlight clips.")}</p>
    </div>
  `;
}

function permissionBadge(status) {
  if (status === "approved") return badge("approved", "good");
  if (status === "blocked") return badge("blocked", "bad");
  return badge("pending", "warn");
}

function renderRadar() {
  const selected = selectedCandidate();
  const sorted = [...state.candidates].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const highScore = countWhere(state.candidates, (candidate) => Number(candidate.score || 0) >= 70);
  const ready = countWhere(state.candidates, (candidate) => candidate.status === "packaged");
  const reviewed = countWhere(state.candidates, (candidate) => ["reviewed", "packaged", "rejected"].includes(candidate.status));
  const dismissed = countWhere(state.candidates, (candidate) => candidate.status === "rejected");
  view.innerHTML = `
    <section class="radar-page">
      <div class="radar-tabs">
        <button class="active">All Candidates <b>${state.candidates.length}</b></button>
        <button>High Score <b>${highScore}</b></button>
        <button>Ready to Package <b>${ready}</b></button>
        <button>Reviewed <b>${reviewed}</b></button>
        <button>Dismissed <b>${dismissed}</b></button>
      </div>

      <div class="radar-shell">
        <section class="panel radar-board">
          <div class="radar-filterbar">
            <label class="stream-search radar-search">Search clips <input placeholder="Search clips..." aria-label="Search clips"></label>
            <select aria-label="Platform filter"><option>Platform: All</option><option>Twitch</option><option>YouTube</option></select>
            <select aria-label="Streamer filter"><option>Streamer: All</option>${state.streamers.map((streamer) => `<option>${esc(streamer.displayName)}</option>`).join("")}</select>
            <select aria-label="Score filter"><option>Score: All</option><option>70+</option><option>90+</option></select>
            <select aria-label="Duration filter"><option>Duration: All</option><option>Short</option><option>Ideal</option><option>Long</option></select>
            <select aria-label="Status filter"><option>Status: All</option><option>New</option><option>Packaged</option><option>Rejected</option></select>
          </div>

          ${sorted.length ? renderRadarTable(sorted) : empty("No clip candidates yet. Run a watch cycle after adding approved streamers.")}
        </section>

        <aside class="panel radar-inspector">
          ${selected ? renderCandidateInspector(selected) : empty("Select a clip candidate")}
        </aside>
      </div>

      <div class="radar-footer">
        <span>${selected ? `1 selected` : `${state.candidates.length} candidates`}</span>
        <div class="actions">
          <button data-action="run-watch">Run Watch Cycle</button>
          <button data-score-candidate="${selected?.id || ""}" ${selected ? "" : "disabled"}>Mark Reviewed</button>
          <button class="primary" data-package-candidate="${selected?.id || ""}" ${selected ? "" : "disabled"}>Create Package${selected ? " (1)" : ""}</button>
        </div>
      </div>
    </section>
  `;
}

function renderRadarTable(candidates) {
  return `
    <div class="radar-table-wrap">
      <table class="radar-table">
        <thead>
          <tr>
            <th><span class="select-box"></span></th>
            <th>Clip Candidate</th>
            <th>Streamer / Stream</th>
            <th>Score</th>
            <th>Hook Strength</th>
            <th>Engagement</th>
            <th>Duration</th>
            <th>Detected</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${candidates.map((candidate, index) => renderRadarRow(candidate, index)).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderRadarRow(candidate, index) {
  const selected = selectedCandidate()?.id === candidate.id;
  const streamer = state.streamers.find((item) => item.id === candidate.streamerId);
  const score = Number(candidate.score || 0);
  const duration = Number(candidate.duration || 0);
  const hook = Number(candidate.hookScore || 0);
  return `
    <tr class="${selected ? "selected" : ""}" data-select-candidate="${candidate.id}">
      <td><span class="select-box ${selected ? "checked" : ""}"></span></td>
      <td>
        <div class="radar-candidate-cell">
          ${radarThumb(candidate, index)}
          <div>
            <strong>${esc(candidate.title || "Untitled clip")}</strong>
            <span>${candidateTags(candidate, index)}</span>
            <small>${esc(candidate.transcriptSnippet || candidate.reason || "Candidate needs transcript context.").slice(0, 84)}</small>
          </div>
        </div>
      </td>
      <td>
        <div class="radar-streamer-cell">
          <span class="creator-avatar avatar-${index % 6}">${esc(initials(streamer?.displayName || "SC"))}</span>
          <div>
            <strong>${esc(streamer?.displayName || "Unknown streamer")} <em>verified</em></strong>
            <small>${esc(candidate.category || "Demo stream")}${streamer?.liveStatus ? ` · ${liveLabel(streamer.liveStatus)}` : ""}</small>
          </div>
        </div>
      </td>
      <td>${scoreRing(score)}</td>
      <td>
        <div class="hook-cell">
          <b>${hook}</b>
          <span>Hook score</span>
          <i style="width:${Math.max(8, Math.min(100, hook))}%"></i>
        </div>
      </td>
      <td>
        <div class="engagement-cell">
          <b>${formatEngagement(candidate, index)}</b>
          <span>Chat spike</span>
          <em>${sparkline(score + index * 7)}</em>
        </div>
      </td>
      <td><b>${duration || 30}s</b><small class="${durationLabelTone(duration)}">${durationLabel(duration)}</small></td>
      <td><b>${timeAgo(candidate.updatedAt || candidate.createdAt)}</b><small>${candidate.sourceType || "Live"}</small></td>
      <td>${candidateStatusBadge(candidate.status)}</td>
      <td>
        <div class="radar-row-actions">
          <button data-select-candidate="${candidate.id}">Play</button>
          <button data-package-candidate="${candidate.id}">Box</button>
          <button data-reject-candidate="${candidate.id}">...</button>
        </div>
      </td>
    </tr>
  `;
}

function renderCandidateCard(candidate) {
  return `
    <article class="item-card">
      <div class="item-head">
        <div>
          <h3>${esc(candidate.title)}</h3>
          <p>${esc(streamerName(candidate.streamerId))} · ${esc(candidate.category || "Uncategorized")} · ${esc(candidate.timestampStart)}-${esc(candidate.timestampEnd)}</p>
        </div>
        ${badge(candidate.status, candidate.status === "packaged" ? "good" : "info")}
      </div>
      <div class="scorebar"><span style="width:${Number(candidate.score || 0)}%"></span></div>
      <div class="kv">
        <span>Score</span><span>${candidate.score || 0}/100</span>
        <span>Hook strength</span><span>${candidate.hookScore || 0}</span>
        <span>Risk score</span><span>${candidate.riskScore || 0}</span>
        <span>Reason</span><span>${esc(candidate.reason)}</span>
      </div>
      <div class="actions">
        <button data-select-candidate="${candidate.id}">Select</button>
        <button class="primary" data-package-candidate="${candidate.id}">Package</button>
        <button data-score-candidate="${candidate.id}">Rescore</button>
        <button class="danger" data-reject-candidate="${candidate.id}">Reject</button>
      </div>
    </article>
  `;
}

function selectedCandidate() {
  const selected = state.candidates.find((item) => item.id === state.selectedCandidateId);
  if (selected) return selected;
  return [...state.candidates].sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0] || null;
}

function radarThumb(candidate, index = 0) {
  const start = candidate.timestampStart || "00:00";
  const end = candidate.timestampEnd || "00:30";
  return `
    <div class="radar-thumb thumb-${index % 5}">
      <span>LIVE</span>
      <button type="button" data-select-candidate="${candidate.id}">▶</button>
      <small>${esc(start)}</small>
      <em>${esc(end)}</em>
    </div>
  `;
}

function candidateTags(candidate, index = 0) {
  const labels = [
    candidate.category || "Clip",
    Number(candidate.score || 0) >= 85 ? "High Energy" : index % 2 ? "Clean Hook" : "Review"
  ];
  return labels.map((label) => `<em>${esc(label)}</em>`).join("");
}

function liveLabel(value) {
  return String(value || "").includes("live") ? "Live now" : String(value || "Demo");
}

function scoreRing(score) {
  const tone = score >= 90 ? "excellent" : score >= 80 ? "strong" : score >= 70 ? "good" : "watch";
  const label = score >= 90 ? "Exceptional" : score >= 80 ? "Very good" : score >= 70 ? "Good" : "Review";
  return `<div class="score-ring score-${tone}" style="--score:${Math.max(0, Math.min(100, score))}"><b>${score}</b><small>${label}</small></div>`;
}

function formatEngagement(candidate, index = 0) {
  const spike = Number(candidate.chatSignals?.spike || candidate.chatSignals?.messagesPerMinute || 0);
  const fallback = Number(candidate.score || 0) * 94 + index * 730;
  const value = spike ? spike * 420 : fallback;
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 1 : 1)}K` : String(Math.round(value));
}

function durationLabel(duration) {
  if (!duration) return "Ideal";
  if (duration < 20) return "Short";
  if (duration <= 60) return "Ideal";
  return "Long";
}

function durationLabelTone(duration) {
  const label = durationLabel(duration);
  return label === "Ideal" ? "good-text" : label === "Short" ? "info-text" : "warn-text";
}

function timeAgo(value) {
  if (!value) return "Now";
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff) || diff < 0) return "Now";
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function candidateStatusBadge(status) {
  if (status === "packaged") return badge("Packaged", "good");
  if (status === "rejected") return badge("Dismissed", "bad");
  if (status === "reviewed") return badge("Reviewed", "info");
  return badge("New", "warn");
}

function renderCandidateInspector(candidate) {
  const streamer = state.streamers.find((item) => item.id === candidate.streamerId);
  const score = Number(candidate.score || 0);
  const hook = Number(candidate.hookScore || 0);
  const engagement = formatEngagement(candidate, 2);
  return `
    <div class="inspector-head">
      <h2>Selected Clip</h2>
      <button class="ghost" data-nav-jump="builder">Open Builder</button>
    </div>
    ${radarThumb(candidate, 1)}
    <div class="selected-title">
      <div>
        <h3>${esc(candidate.title || "Untitled clip")}</h3>
        <p>${esc(streamer?.displayName || "Unknown streamer")} · ${esc(candidate.category || "Demo")} · ${timeAgo(candidate.updatedAt || candidate.createdAt)}</p>
      </div>
      ${scoreRing(score)}
    </div>
    <div class="inspector-tabs">
      <span class="active">Overview</span>
      <span>Transcript</span>
      <span>Chat Moments</span>
      <span>Analysis</span>
    </div>
    <div class="inspector-section">
      <h3>Why this clip is strong</h3>
      <p>${esc(candidate.reason || "Candidate scored from engagement, transcript energy, hook potential, length, context, and risk.")}</p>
      <div class="clip-metrics">
        <span><b>${hook}</b><em>Hook Strength</em></span>
        <span><b>${esc(engagement)}</b><em>Engagement</em></span>
        <span><b>${candidate.confidence || "medium"}</b><em>Confidence</em></span>
      </div>
    </div>
    <div class="inspector-section">
      <h3>Transcript Preview</h3>
      <p class="transcript-box">${esc(candidate.transcriptSnippet || "Transcript will appear here after the clip has audio or chat context.")}</p>
    </div>
    <div class="inspector-section compact-actions">
      <h3>Quick Actions</h3>
      <button class="primary" data-package-candidate="${candidate.id}">Create Clip Package</button>
      <button data-nav-jump="builder">Preview in Builder</button>
      <button data-score-candidate="${candidate.id}">Rescore</button>
      <button class="danger" data-reject-candidate="${candidate.id}">Dismiss</button>
    </div>
    <div class="inspector-section">
      <h3>Clip Details</h3>
      <div class="inspector-kv">
        <span>Source</span><b>${esc(candidate.sourceType || "demo")}</b>
        <span>Resolution</span><b>1080x1920</b>
        <span>Duration</span><b>${candidate.duration || 30}s</b>
        <span>Risk</span><b>${candidate.riskScore || 0}/100</b>
      </div>
    </div>
  `;
}

function renderBuilder() {
  const candidate = state.candidates.find((item) => item.id === state.selectedCandidateId) || state.candidates[0];
  if (candidate && candidate.id !== state.selectedCandidateId) {
    state.selectedCandidateId = candidate.id;
    localStorage.setItem("selectedCandidateId", candidate.id);
  }
  const relatedPackage = state.drafts.find((draft) => draft.clipPackageId)?.clipPackageId;
  view.innerHTML = `
    <div class="split">
      <section class="panel">
        <h2>Selected Candidate</h2>
        ${candidate ? `
          <div class="kv">
            <span>Streamer</span><span>${esc(streamerName(candidate.streamerId))}</span>
            <span>Title</span><span>${esc(candidate.title)}</span>
            <span>Score</span><span>${candidate.score || 0}/100</span>
            <span>Status</span><span>${esc(candidate.status)}</span>
            <span>Reason</span><span>${esc(candidate.reason)}</span>
          </div>
          <div class="actions" style="margin-top:12px">
            <button class="primary" data-package-candidate="${candidate.id}">Generate Package</button>
            <button data-nav-jump="radar">Clip Radar</button>
          </div>
        ` : empty("Select a candidate from Clip Radar")}
      </section>
      <section class="panel">
        <h2>Latest Draft Package</h2>
        ${state.drafts.length ? renderDraftSummary(state.drafts[0]) : empty("No package generated yet")}
      </section>
    </div>
    <section class="panel">
      <div class="toolbar">
        <h2>CapCut Handoff</h2>
        <button data-action="create-capcut" ${relatedPackage ? "" : "disabled"}>Create Handoff</button>
      </div>
      ${state.artifacts.filter((artifact) => artifact.kind === "capcut_brief").length ? renderArtifacts(state.artifacts.filter((artifact) => artifact.kind === "capcut_brief")) : empty("No CapCut briefs yet")}
    </section>
  `;
}

function renderDraftSummary(draft) {
  return `
    <div class="kv">
      <span>Platform</span><span>${esc(draft.platform)}</span>
      <span>Caption</span><span>${esc(draft.caption)}</span>
      <span>Approval</span><span>${esc(draft.approvalStatus)}</span>
      <span>Upload</span><span>${esc(draft.platformStatus)}</span>
    </div>
  `;
}

function renderQueue() {
  view.innerHTML = `
    <section class="panel">
      <div class="toolbar">
        <h2>Posting Queue</h2>
        <button data-action="refresh">Refresh</button>
      </div>
      <div class="card-list">
        ${state.drafts.length ? state.drafts.map(renderDraftCard).join("") : empty("No posting drafts")}
      </div>
    </section>
  `;
}

function renderDraftCard(draft) {
  return `
    <article class="item-card">
      <div class="item-head">
        <div>
          <h3>${esc(draft.platform)}</h3>
          <p>${esc(draft.caption)}</p>
        </div>
        ${badge(draft.approvalStatus, draft.approvalStatus === "approved" ? "good" : draft.approvalStatus === "rejected" ? "bad" : "warn")}
      </div>
      <div class="kv">
        <span>Status</span><span>${esc(draft.status)}</span>
        <span>Platform</span><span>${esc(draft.platformStatus)}</span>
        <span>Thumbnail</span><span>${esc(draft.thumbnailText)}</span>
        <span>Hashtags</span><span>${esc((draft.hashtags || []).join(" "))}</span>
      </div>
      <div class="actions">
        <button data-request-post="${draft.id}">Request Approval</button>
      </div>
    </article>
  `;
}

function renderGate() {
  view.innerHTML = `
    <section class="panel">
      <div class="toolbar">
        <h2>Human Gate</h2>
        <button data-action="refresh">Refresh</button>
      </div>
      <div class="card-list">
        ${state.approvals.length ? state.approvals.map(renderApprovalCard).join("") : empty("No approval requests")}
      </div>
    </section>
  `;
}

function renderApprovalCard(approval) {
  return `
    <article class="item-card">
      <div class="item-head">
        <div>
          <h3>${esc(approval.title)}</h3>
          <p>${esc(approval.type)} · ${fmtDate(approval.createdAt)}</p>
        </div>
        ${badge(approval.status, approval.status === "approved" ? "good" : approval.status === "rejected" ? "bad" : approval.status === "pending" ? "warn" : "info")}
      </div>
      <div class="kv">
        <span>Risk</span><span>${esc(approval.riskLevel)}</span>
        <span>Linked</span><span>${esc(approval.linkedId)}</span>
      </div>
      <div class="actions">
        <button class="primary" data-gate-approve="${approval.id}" ${approval.status !== "pending" ? "disabled" : ""}>Approve</button>
        <button data-gate-sendback="${approval.id}" ${approval.status !== "pending" ? "disabled" : ""}>Send Back</button>
        <button class="danger" data-gate-reject="${approval.id}" ${approval.status !== "pending" ? "disabled" : ""}>Reject</button>
      </div>
    </article>
  `;
}

function renderOutputs() {
  view.innerHTML = `
    <section class="panel">
      <div class="toolbar">
        <h2>Outputs</h2>
        <button data-action="refresh">Refresh</button>
      </div>
      ${state.artifacts.length ? renderArtifacts(state.artifacts) : empty("No exported artifacts")}
    </section>
  `;
}

function renderArtifacts(artifacts) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Kind</th><th>File</th><th>Created</th><th>Download</th></tr></thead>
        <tbody>
          ${artifacts.map((artifact) => `
            <tr>
              <td>${esc(artifact.kind)}</td>
              <td>${esc(artifact.filename)}</td>
              <td>${fmtDate(artifact.createdAt)}</td>
              <td><a href="${esc(artifact.url)}" download>Download</a></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderLogs() {
  view.innerHTML = `
    <section class="panel">
      <div class="toolbar">
        <h2>Logs</h2>
        <button data-action="refresh">Refresh</button>
      </div>
      ${state.logs.length ? `<div class="codebox">${esc(state.logs.map((log) => `[${log.createdAt}] ${log.type}: ${log.message}`).join("\n"))}</div>` : empty("No log entries")}
    </section>
  `;
}

function renderSettings() {
  const safeConfig = {
    aiProvider: state.config?.aiProvider,
    aiMode: state.config?.aiMode,
    openaiModel: state.config?.openaiModel,
    openaiConfigured: state.config?.openaiConfigured,
    twitchConfigured: state.config?.twitchConfigured,
    twitchRedirectConfigured: state.config?.twitchRedirectConfigured,
    twitchAllowedChannels: state.config?.twitchAllowedChannels,
    postDailyLimit: state.config?.postDailyLimit,
    outputDir: state.config?.outputDir
  };
  view.innerHTML = `
    <div class="grid cols-2">
      <section class="panel">
        <div class="toolbar">
          <h2>Connections</h2>
          <div class="actions">
            <button data-action="test-openai">Test OpenAI</button>
            <button data-action="test-twitch">Test Twitch</button>
          </div>
        </div>
        <div class="kv">
          <span>OpenAI</span><span>${state.openai?.configured ? "configured" : "not configured"}</span>
          <span>Twitch</span><span>${state.twitch?.configured ? "configured" : "not configured"}</span>
          <span>Official API</span><span>${state.twitch?.officialApiOnly ? "yes" : "no"}</span>
          <span>Secrets</span><span>server-side only</span>
        </div>
      </section>
      <section class="panel">
        <h2>Runtime</h2>
        <pre class="codebox">${esc(JSON.stringify(safeConfig, null, 2))}</pre>
      </section>
    </div>
  `;
}

function empty(label) {
  return `<div class="empty">${esc(label)}</div>`;
}

async function refresh() {
  await loadCore();
  render();
}

async function runWatch() {
  const result = await api("/api/watch/run", { method: "POST", body: "{}" });
  toast(`Watch cycle complete: ${result.results.length} streamers checked`, "good");
  await refresh();
}

async function seedDemo() {
  const result = await api("/api/demo/seed", { method: "POST", body: "{}" });
  const seeded = result.seeded || {};
  toast(`Demo mission loaded: ${seeded.streamers || 0} streamers, ${seeded.candidates || 0} candidates`, "good");
  await refresh();
}

async function packageCandidate(id) {
  const result = await api("/api/clips/package", {
    method: "POST",
    body: JSON.stringify({ candidateId: id })
  });
  state.selectedCandidateId = id;
  localStorage.setItem("selectedCandidateId", id);
  toast(`Package created: ${result.packagePlan.title}`, "good");
  await refresh();
  setView("builder");
}

async function createCapCut() {
  const latestDraft = state.drafts[0];
  if (!latestDraft?.clipPackageId) return;
  await api("/api/clips/capcut-brief", {
    method: "POST",
    body: JSON.stringify({ clipPackageId: latestDraft.clipPackageId })
  });
  toast("CapCut handoff created", "good");
  await refresh();
}

async function submitStreamer(form) {
  const data = new FormData(form);
  const allowedUse = data.getAll("allowedUse");
  await api("/api/twitch/streamers", {
    method: "POST",
    body: JSON.stringify({
      displayName: data.get("displayName"),
      platform: data.get("platform"),
      channelId: data.get("channelId"),
      channelUrl: data.get("channelUrl"),
      permissionStatus: data.get("permissionStatus"),
      monitorEnabled: data.get("monitorEnabled") === "true",
      allowedUse,
      notes: data.get("notes")
    })
  });
  form.reset();
  toast("Streamer added", "good");
  await refresh();
}

async function gate(path, id) {
  await api(path, {
    method: "POST",
    body: JSON.stringify({ id })
  });
  toast("Human Gate updated", "good");
  await refresh();
}

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target.closest("#streamer-form");
  if (!form) return;
  try {
    await submitStreamer(form);
  } catch (error) {
    toast(error.message, "bad");
  }
});

document.addEventListener("click", async (event) => {
  const target = event.target;
  const navJump = target.closest("[data-nav-jump]");
  if (navJump) return setView(navJump.dataset.navJump);

  const action = target.closest("[data-action]")?.dataset.action;
  const selectCandidate = target.closest("[data-select-candidate]")?.dataset.selectCandidate;
  const packageId = target.closest("[data-package-candidate]")?.dataset.packageCandidate;
  const scoreId = target.closest("[data-score-candidate]")?.dataset.scoreCandidate;
  const rejectId = target.closest("[data-reject-candidate]")?.dataset.rejectCandidate;
  const toggleId = target.closest("[data-toggle-monitor]")?.dataset.toggleMonitor;
  const approveStreamerId = target.closest("[data-approve-streamer]")?.dataset.approveStreamer;
  const deleteId = target.closest("[data-delete-streamer]")?.dataset.deleteStreamer;
  const requestPost = target.closest("[data-request-post]")?.dataset.requestPost;
  const gateApprove = target.closest("[data-gate-approve]")?.dataset.gateApprove;
  const gateReject = target.closest("[data-gate-reject]")?.dataset.gateReject;
  const gateSendBack = target.closest("[data-gate-sendback]")?.dataset.gateSendback;
  const selectStreamer = target.closest("[data-select-streamer]")?.dataset.selectStreamer;
  const focusAddStreamer = target.closest("[data-focus-add-streamer]");

  try {
    if (focusAddStreamer) {
      document.querySelector("#add-streamer-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
      document.querySelector("#add-streamer-panel input[name='displayName']")?.focus();
      return;
    }
    if (selectStreamer) {
      state.selectedStreamerId = selectStreamer;
      localStorage.setItem("selectedStreamerId", selectStreamer);
      render();
    }
    if (action === "refresh") await refresh();
    if (action === "run-watch") await runWatch();
    if (action === "seed-demo") await seedDemo();
    if (action === "create-capcut") await createCapCut();
    if (action === "test-openai") {
      const result = await api("/api/openai/test", { method: "POST", body: "{}" });
      toast(result.message || "OpenAI test complete", result.live ? "good" : "info");
    }
    if (action === "test-twitch") {
      const result = await api("/api/twitch/test", { method: "POST", body: "{}" });
      toast(result.message || "Twitch test complete", result.live ? "good" : "info");
    }
    if (selectCandidate) {
      state.selectedCandidateId = selectCandidate;
      localStorage.setItem("selectedCandidateId", selectCandidate);
      render();
    }
    if (packageId) await packageCandidate(packageId);
    if (scoreId) {
      await api("/api/clips/candidates/score", { method: "POST", body: JSON.stringify({ id: scoreId }) });
      toast("Candidate rescored", "good");
      await refresh();
    }
    if (rejectId) {
      await api("/api/clips/candidates/score", {
        method: "POST",
        body: JSON.stringify({ id: rejectId, updates: { status: "rejected", riskScore: 75 } })
      });
      toast("Candidate rejected", "info");
      await refresh();
    }
    if (toggleId) {
      const streamer = state.streamers.find((item) => item.id === toggleId);
      await api(`/api/twitch/streamers/${toggleId}`, {
        method: "PATCH",
        body: JSON.stringify({ monitorEnabled: !streamer.monitorEnabled })
      });
      await refresh();
    }
    if (approveStreamerId) {
      await api(`/api/twitch/streamers/${approveStreamerId}`, {
        method: "PATCH",
        body: JSON.stringify({ permissionStatus: "approved" })
      });
      toast("Streamer approved locally", "good");
      await refresh();
    }
    if (deleteId) {
      await api(`/api/twitch/streamers/${deleteId}`, { method: "DELETE" });
      toast("Streamer deleted", "info");
      await refresh();
    }
    if (requestPost) {
      await api(`/api/posts/${requestPost}/request-approval`, { method: "POST", body: "{}" });
      toast("Approval requested", "good");
      await refresh();
    }
    if (gateApprove) await gate("/api/human-gate/approve", gateApprove);
    if (gateReject) await gate("/api/human-gate/reject", gateReject);
    if (gateSendBack) await gate("/api/human-gate/send-back", gateSendBack);
  } catch (error) {
    toast(error.message, "bad");
  }
});

renderNav();
loadCore()
  .then(() => {
    $("#api-status").textContent = "API online";
    render();
  })
  .catch((error) => {
    $("#api-status").className = "pill bad";
    $("#api-status").textContent = "API error";
    view.innerHTML = `<section class="panel">${empty(error.message)}</section>`;
  });

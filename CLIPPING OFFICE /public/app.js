const navItems = [
  { id: "dashboard", label: "Dashboard", icon: "grid", group: "core" },
  { id: "watchlist", label: "Stream Watchlist", icon: "broadcast", group: "core", count: "streamers", tone: "neutral" },
  { id: "radar", label: "Clip Radar", icon: "radar", group: "core", count: "candidates", tone: "info" },
  { id: "builder", label: "Clip Builder", icon: "scissors", group: "core" },
  { id: "browser", label: "Browser Workspace", icon: "browser", group: "core" },
  { id: "queue", label: "Posting Queue", icon: "queue", group: "core", count: "queue", tone: "warn" },
  { id: "gate", label: "Human Gate", icon: "shield", group: "core", count: "gate", tone: "pink" },
  { id: "outputs", label: "Outputs", icon: "folder", group: "records" },
  { id: "analytics", label: "Analytics", icon: "chart", group: "records" },
  { id: "logs", label: "Logs", icon: "document", group: "records" },
  { id: "settings", label: "Settings", icon: "settings", group: "admin" },
  { id: "integrations", label: "Integrations", icon: "plug", group: "admin" }
];

const state = {
  view: "dashboard",
  config: null,
  health: null,
  openai: null,
  twitch: null,
  kick: null,
  streamers: [],
  candidates: [],
  packages: [],
  drafts: [],
  approvals: [],
  artifacts: [],
  logs: [],
  handoffs: [],
  smokeTest: null,
  browser: null,
  capcut: null,
  media: null,
  mediaSources: [],
  studio: null,
  studioTab: localStorage.getItem("studioTab") || "source",
  studioSeek: null,
  studioBusy: false,
  browserBusy: false,
  smokeBusy: false,
  smokeModalOpen: false,
  browserScreenshotStamp: 0,
  recommendations: [],
  recommendationsMessage: "",
  agentRun: null,
  agentRunBusy: false,
  agentChatOpen: false,
  selectedCandidateId: localStorage.getItem("selectedCandidateId") || "",
  previewCandidateId: "",
  selectedStreamerId: localStorage.getItem("selectedStreamerId") || "",
  selectedApprovalId: localStorage.getItem("selectedApprovalId") || ""
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

function isPracticeStreamer(streamer) {
  return Boolean(
    streamer?.isDemo
    || streamer?.permissionStatus === "demo_approved"
    || streamer?.platform === "demo"
    || /^demo_/.test(String(streamer?.liveStatus || ""))
    || /demo|practice/i.test(String(streamer?.channelId || ""))
  );
}

function isPracticeCandidate(candidate) {
  const streamer = state.streamers.find((item) => item.id === candidate?.streamerId);
  return Boolean(
    candidate?.provenance === "DEMO_SOURCE"
    || candidate?.sourceProvenance === "DEMO_SOURCE"
    || /demo|practice|synthetic/i.test(String(candidate?.sourceType || ""))
    || isPracticeStreamer(streamer)
  );
}

function isPracticePackage(clipPackage) {
  const candidate = state.candidates.find((item) => item.id === clipPackage?.candidateId);
  return isPracticeCandidate(candidate);
}

function isPracticeDraft(draft) {
  const clipPackage = state.packages.find((item) => item.id === draft?.clipPackageId);
  return isPracticePackage(clipPackage);
}

function isPracticeApproval(approval) {
  if (!approval) return false;
  if (approval.linkedId === "project_clipping_office_main") return true;
  const draft = state.drafts.find((item) => item.id === approval.linkedId);
  const clipPackage = state.packages.find((item) => item.id === approval.linkedId);
  const candidate = state.candidates.find((item) => item.id === approval.linkedId);
  const streamer = state.streamers.find((item) => item.id === approval.linkedId);
  return isPracticeDraft(draft) || isPracticePackage(clipPackage) || isPracticeCandidate(candidate) || isPracticeStreamer(streamer);
}

function isPracticeArtifact(artifact) {
  const content = artifact?.content || {};
  const candidate = state.candidates.find((item) => item.id === content.candidateId);
  const clipPackage = state.packages.find((item) => item.id === content.clipPackageId);
  return Boolean(
    artifact?.provenance === "DEMO_SOURCE"
    || content.provenance === "DEMO_SOURCE"
    || /demo|practice/i.test(String(artifact?.title || ""))
    || isPracticeCandidate(candidate)
    || isPracticePackage(clipPackage)
  );
}

function realStreamers() {
  return state.streamers.filter((streamer) => !isPracticeStreamer(streamer));
}

function practiceStreamers() {
  return state.streamers.filter(isPracticeStreamer);
}

function realCandidates() {
  return state.candidates.filter((candidate) => !isPracticeCandidate(candidate));
}

function practiceCandidates() {
  return state.candidates.filter(isPracticeCandidate);
}

function realPackages() {
  return state.packages.filter((clipPackage) => !isPracticePackage(clipPackage));
}

function realDrafts() {
  return state.drafts.filter((draft) => !isPracticeDraft(draft));
}

function realApprovals() {
  return state.approvals.filter((approval) => !isPracticeApproval(approval));
}

function realArtifacts() {
  return state.artifacts.filter((artifact) => !isPracticeArtifact(artifact));
}

function practiceArtifacts() {
  return state.artifacts.filter(isPracticeArtifact);
}

function hasPracticeData() {
  return Boolean(
    practiceStreamers().length
    || practiceCandidates().length
    || countWhere(state.packages, isPracticePackage)
    || countWhere(state.drafts, isPracticeDraft)
    || countWhere(state.approvals, isPracticeApproval)
    || practiceArtifacts().length
  );
}

function disabledAttr(disabled, reason = "Unavailable") {
  return disabled ? `disabled aria-disabled="true" title="${esc(reason)}"` : "";
}

function isPermissionReady(streamer) {
  return ["approved", "demo_approved"].includes(streamer?.permissionStatus);
}

function dailyLimitValue() {
  const approvedToday = countWhere(
    realDrafts(),
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

function resolvedThumbnailUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  return url.replaceAll("{width}", "640").replaceAll("{height}", "360");
}

function candidateById(id) {
  return state.candidates.find((candidate) => candidate.id === id) || null;
}

function bestCandidateForStreamer(streamerId) {
  return state.candidates
    .filter((candidate) => candidate.streamerId === streamerId)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0] || null;
}

function candidateThumbnailUrl(candidate) {
  const streamer = state.streamers.find((item) => item.id === candidate?.streamerId);
  return resolvedThumbnailUrl(candidate?.thumbnailUrl || candidate?.thumbnail || streamer?.liveThumbnailUrl || streamer?.thumbnailUrl || streamer?.thumbnail);
}

function streamThumbnailUrl(streamer) {
  return resolvedThumbnailUrl(streamer?.liveThumbnailUrl || streamer?.thumbnailUrl || streamer?.thumbnail);
}

function mediaTitle(value, fallback = "Stream preview") {
  return esc(String(value || fallback).slice(0, 42));
}

function previewFrame({
  label = "LIVE",
  title = "Clip preview",
  subtitle = "",
  timestamp = "00:00",
  end = "00:30",
  index = 0,
  imageUrl = "",
  candidateId = "",
  className = "",
  score = 0
} = {}) {
  const progress = Math.max(14, Math.min(88, Number(score || 0)));
  return `
    <div class="media-frame ${esc(className)} thumb-${index % 5}">
      ${imageUrl ? `<img src="${esc(imageUrl)}" alt="" loading="lazy">` : ""}
      <span class="media-badge">${esc(label)}</span>
      ${candidateId
        ? `<button class="media-play" type="button" data-preview-candidate="${esc(candidateId)}" aria-label="Play ${mediaTitle(title)}">Play</button>`
        : `<span class="media-play locked" aria-hidden="true">Preview</span>`}
      <div class="media-copy">
        <strong>${mediaTitle(title)}</strong>
        ${subtitle ? `<small>${esc(subtitle).slice(0, 58)}</small>` : ""}
      </div>
      <div class="media-timeline">
        <b>${esc(timestamp)}</b>
        <i><span style="width:${progress}%"></span></i>
        <em>${esc(end)}</em>
      </div>
      <div class="media-bars">${sparkline(index * 11 + Number(score || 0))}</div>
    </div>
  `;
}

function miniThumb(label, index = 0) {
  return previewFrame({
    label: "LIVE",
    title: label,
    subtitle: `${(index + 1) * 3}.${index + 7}K watching`,
    index,
    className: "clip-thumb"
  });
}

function renderSidebarOps() {
  $("#sidebar-ops").innerHTML = `
    <button class="sidebar-agent-chat-card" type="button" data-open-agent-chat aria-label="Open Agent 101 chat">
      <span class="agent-chat-mark">A</span>
      <div>
        <strong>Open Agent 101</strong>
        <small>Ask, run, and track work</small>
      </div>
      <span class="agent-chat-arrow" aria-hidden="true">Chat</span>
    </button>
    <a class="sidebar-return-card" href="/" aria-label="Back to Argentum">
      <span class="return-mark">A</span>
      <div>
        <strong>Back to Argentum</strong>
        <small>Return to Control Floor</small>
      </div>
      <span class="return-arrow" aria-hidden="true">Go</span>
    </a>
  `;
}

async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(appUrl(path), {
    ...options,
    headers: isFormData
      ? { ...(options.headers || {}) }
      : {
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
  const [health, config, openai, twitch, kick, browser, capcut, media, mediaSources, handoffs, smoke, studio, streamers, candidates, packages, posts, approvals, artifacts, logs] = await Promise.all([
    api("/api/health"),
    api("/api/config"),
    api("/api/openai/status"),
    api("/api/twitch/status"),
    api("/api/kick/status"),
    api("/api/browser/profile"),
    api("/api/capcut/status"),
    api("/api/media/status"),
    api("/api/media/sources"),
    api("/api/handoffs"),
    api("/api/system/smoke-test"),
    api("/api/clipping-office/project"),
    api("/api/twitch/streamers"),
    api("/api/clips/candidates"),
    api("/api/clips/packages"),
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
    kick,
    browser,
    capcut,
    media,
    mediaSources: mediaSources.sources || [],
    handoffs: handoffs.handoffs || [],
    smokeTest: smoke.latest || null,
    studio,
    streamers: streamers.streamers,
    candidates: candidates.candidates,
    packages: packages.packages,
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
  const streamApisReady = Boolean(state.twitch?.configured || state.kick?.configured);
  $("#twitch-status").className = `pill ${streamApisReady ? "good" : "warn"}`;
  $("#twitch-status").textContent = streamApiStatusLabel();
  $("#limit-status").className = `pill ${limit?.blocked ? "bad" : limit?.warning ? "warn" : "info"}`;
  $("#limit-status").textContent = `${limit?.approvedToday ?? 0}/${limit?.limit ?? 20} approved`;
  renderSidebarOps();
}

function streamApiStatusLabel() {
  const twitchReady = Boolean(state.twitch?.configured);
  const kickReady = Boolean(state.kick?.configured);
  if (twitchReady && kickReady) return "Twitch + Kick ready";
  if (kickReady) return "Kick ready";
  if (twitchReady) return "Twitch ready";
  return "Stream API needed";
}

function renderNav() {
  let lastGroup = "";
  $("#nav").innerHTML = navItems
    .map((item) => {
      const { id, label, icon, group, route = id, tone = "" } = item;
      const count = navCount(item.count);
      const divider = lastGroup && lastGroup !== group ? `<span class="nav-divider"></span>` : "";
      lastGroup = group;
      return `
        ${divider}
        <button class="${state.view === id ? "active" : ""}" data-nav="${route}" data-nav-id="${id}">
          <span class="nav-glyph nav-${esc(icon)}" aria-hidden="true">${navIcon(icon)}</span>
          <em>${esc(label)}</em>
          ${count ? `<b class="${esc(tone)}">${esc(count)}</b>` : ""}
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

function navCount(key) {
  if (key === "streamers") return realStreamers().length || "";
  if (key === "candidates") return realCandidates().length || "";
  if (key === "queue") return countWhere(realDrafts(), (draft) => draft.approvalStatus === "pending") || "";
  if (key === "gate") return countWhere(realApprovals(), (approval) => approval.status === "pending") || "";
  return "";
}

function navIcon(icon) {
  const icons = {
    grid: `<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>`,
    broadcast: `<svg viewBox="0 0 24 24"><path d="M8 8a6 6 0 0 0 0 8"/><path d="M16 8a6 6 0 0 1 0 8"/><circle cx="12" cy="12" r="2"/><path d="M5 5a10 10 0 0 0 0 14"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>`,
    radar: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 12h8"/><path d="M12 4v3"/><path d="M4 12h3"/></svg>`,
    scissors: `<svg viewBox="0 0 24 24"><circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="M8 8.5 20 18"/><path d="M8 15.5 20 6"/></svg>`,
    queue: `<svg viewBox="0 0 24 24"><path d="M4 6h14"/><path d="M4 12h16"/><path d="M4 18h12"/><path d="M19 6v5"/></svg>`,
    shield: `<svg viewBox="0 0 24 24"><path d="M12 3 19 6v5c0 4.5-2.7 7.6-7 10-4.3-2.4-7-5.5-7-10V6l7-3Z"/><rect x="9" y="11" width="6" height="5" rx="1"/><path d="M10 11V9.5a2 2 0 0 1 4 0V11"/></svg>`,
    folder: `<svg viewBox="0 0 24 24"><path d="M3 7.5h7l2 2h9v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>`,
    chart: `<svg viewBox="0 0 24 24"><path d="M5 20V9"/><path d="M12 20V4"/><path d="M19 20v-7"/></svg>`,
    document: `<svg viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6Z"/><path d="M14 3v4h4"/><path d="M9 12h6"/><path d="M9 16h5"/></svg>`,
    settings: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v3"/><path d="M12 18v3"/><path d="m4.8 4.8 2.1 2.1"/><path d="m17.1 17.1 2.1 2.1"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="m4.8 19.2 2.1-2.1"/><path d="m17.1 6.9 2.1-2.1"/></svg>`,
    plug: `<svg viewBox="0 0 24 24"><path d="M9 3v6"/><path d="M15 3v6"/><path d="M7 9h10v3a5 5 0 0 1-10 0Z"/><path d="M12 17v4"/></svg>`,
    browser: `<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/><path d="M7 7h.01"/><path d="M10 7h.01"/><path d="M7 13h5"/><path d="M7 16h8"/></svg>`,
    team: `<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="10" r="2"/><path d="M15 16a5 5 0 0 1 6 4"/></svg>`
  };
  return icons[icon] || icons.grid;
}

function setView(id) {
  state.view = id;
  const label = navItems.find((item) => item.id === id)?.label || "Dashboard";
  $("#view-title").textContent = label;
  $("#view-subtitle").textContent = subtitleFor(id);
  renderNav();
  render();
  if (id === "browser") {
    loadBrowserState()
      .then(() => {
        if (state.view !== "browser") return;
        renderNav();
        render();
      })
      .catch((error) => toast(error.message, "bad"));
  }
}

function subtitleFor(id) {
  return {
    dashboard: "System status and daily queue",
    watchlist: "Streamer permissions and monitoring",
    radar: "Detected moments and scoring",
    builder: "9:16 packages and CapCut handoffs",
    browser: "Supervised browser and manual tool handoffs",
    queue: "Draft-only social packages",
    gate: "Review and approve critical actions before they go live",
    outputs: "Exported briefs and caption files",
    analytics: "Agent and streamer operating intelligence",
    logs: "System event trail",
    settings: "Backend status and limits",
    integrations: "Server-side connectors and manual handoffs"
  }[id];
}

function render() {
  const renderers = {
    dashboard: renderDashboard,
    watchlist: renderWatchlist,
    radar: renderRadar,
    builder: renderBuilder,
    browser: renderBrowserWorkspace,
    queue: renderQueue,
    gate: renderGate,
    outputs: renderOutputs,
    analytics: renderAnalytics,
    logs: renderLogs,
    settings: renderSettings,
    integrations: renderIntegrations
  };
  const renderer = renderers[state.view] || renderDashboard;
  try {
    renderer();
    view.insertAdjacentHTML("beforeend", renderClipPreviewModal());
    view.insertAdjacentHTML("beforeend", renderAgentChatDrawer());
    queueMicrotask(hydrateStudioPlayers);
  } catch (error) {
    console.error(error);
    view.innerHTML = `<section class="panel">${empty(`Could not open ${state.view}: ${error.message}`)}</section>`;
  }
}

function renderAgentChatDrawer() {
  if (!state.agentChatOpen) return "";
  const run = state.agentRun || {};
  const status = state.agentRunBusy ? "running" : run.status || "ready";
  const progress = state.agentRunBusy ? Math.max(8, Number(run.progress || 8)) : Number(run.progress || 0);
  const counts = run.counts || {};
  const recentSteps = (run.steps || []).slice(-5);
  const recentLogs = state.logs.slice(0, 5);
  const statusTone = status === "completed" ? "good" : status === "blocked" || status === "error" ? "bad" : status === "needs_approval" ? "warn" : status === "running" ? "info" : "neutral";
  return `
    <div class="agent-chat-overlay" role="dialog" aria-modal="true" aria-label="Agent 101 chat">
      <section class="agent-chat-drawer">
        <header class="agent-chat-header">
          <div>
            <span class="eyebrow">Agent 101 command chat</span>
            <h2>Ask Agent 101 to run safe work</h2>
            <p>Drafts, clip candidates, packages, CapCut briefs, posting drafts, logs, and Human Gate requests.</p>
          </div>
          <button class="icon-button" type="button" data-close-agent-chat aria-label="Close Agent 101 chat">×</button>
        </header>

        <div class="agent-chat-status">
          ${badge(status, statusTone)}
          <span><b>${esc(run.currentStep || "Ready")}</b><small>Current step</small></span>
          <span><b>${esc(counts.candidates || 0)}</b><small>Candidates</small></span>
          <span><b>${esc(counts.artifacts || 0)}</b><small>Artifacts</small></span>
        </div>
        <div class="agent-chat-progress"><span style="width:${Math.min(100, Math.max(0, progress))}%"></span></div>

        <div class="agent-chat-thread" aria-live="polite">
          <article class="chat-bubble agent">
            <b>Agent 101</b>
            <p>${esc(run.summary || "I am ready. Tell me what clipping work to run. Safe internal draft work can run now; posting and uploads stay behind Human Gate.")}</p>
          </article>
          ${recentSteps.length ? recentSteps.map((step) => `
            <article class="chat-bubble system ${esc(step.status || "")}">
              <b>${esc(step.tool || "Step")}</b>
              <p>${esc(step.message || step.status || "Updated")}</p>
            </article>
          `).join("") : ""}
          ${recentLogs.length ? `
            <div class="agent-chat-log">
              <span>Latest activity</span>
              ${recentLogs.map((log) => `<p><b>${esc(log.module || "System")}</b> ${esc(log.event || log.details || "Updated")}</p>`).join("")}
            </div>
          ` : ""}
        </div>

        <form id="global-agent101-command-form" class="agent-chat-form">
          <textarea name="goal" rows="3" placeholder="Tell Agent 101 what to run, e.g. find 5 practice streams and make clip candidates"></textarea>
          <div>
            <button type="button" data-action="agent101-demo-workflow" ${state.agentRunBusy ? "disabled" : ""}>Run practice workflow</button>
            <button class="primary" type="submit" ${state.agentRunBusy ? "disabled" : ""}>Send</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderDashboard() {
  const streamers = realStreamers();
  const candidates = realCandidates();
  const drafts = realDrafts();
  const approvals = realApprovals();
  const watched = countWhere(streamers, (item) => item.monitorEnabled);
  const approved = countWhere(streamers, (streamer) => streamer.permissionStatus === "approved");
  const liveNow = countWhere(streamers, (item) => String(item.liveStatus || "").includes("live"));
  const pendingCandidates = countWhere(candidates, (candidate) => candidate.status === "candidate");
  const highScore = countWhere(candidates, (candidate) => Number(candidate.score || 0) >= 60);
  const ready = countWhere(candidates, (candidate) => candidate.status === "packaged");
  const queuedToday = countWhere(drafts, (draft) => (draft.createdAt || "").slice(0, 10) === todayKey());
  const awaitingApproval = countWhere(drafts, (draft) => draft.approvalStatus === "pending");
  const pendingApprovals = countWhere(approvals, (approval) => approval.status === "pending");
  const practice = {
    streamers: practiceStreamers().length,
    candidates: practiceCandidates().length,
    drafts: countWhere(state.drafts, isPracticeDraft),
    approvals: countWhere(state.approvals, isPracticeApproval)
  };
  const approvedToday = dailyLimitValue().approvedToday;
  view.innerHTML = `
    <div class="dashboard-hero">
      <div>
        <span class="eyebrow">Realtime AI clipping desk</span>
        <h2>StreamClipper Command</h2>
        <p>Monitor approved creators, score moments, build 9:16 packages, and hold every risky external step at Human Gate.</p>
      </div>
      <div class="hero-actions">
        <button class="primary" data-action="agent101-demo-workflow">Run Practice Workflow</button>
        <button data-action="run-watch">Run Watch Cycle</button>
        <button data-action="seed-demo">Start Practice Project</button>
        ${practice.streamers || practice.candidates ? `<button data-action="clear-demo">Clear Practice Data</button>` : ""}
      </div>
    </div>
    ${practice.streamers || practice.candidates || practice.drafts || practice.approvals ? `
      <section class="practice-banner">
        <strong>PRACTICE MEDIA — NOT A REAL STREAM</strong>
        <span>${practice.streamers} practice streamer(s), ${practice.candidates} practice candidate(s), ${practice.drafts} draft(s), ${practice.approvals} approval item(s). These are excluded from real dashboard counts.</span>
        <button data-action="clear-demo">Clear Practice Data</button>
      </section>
    ` : ""}
    ${renderAgentRunPanel()}
    <div class="metric-strip">
      ${metric("Watched Streams", watched, `${streamers.length} real total`, "CAM", "good")}
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
        ${renderFunnel({ watched, moments: candidates.length, highScore, ready, approved: approvedToday })}
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
        <button data-nav-jump="browser"><span>B</span><b>Browser Workspace</b><small>Open supervised tools</small></button>
        <button data-nav-jump="gate"><span>G</span><b>Open Human Gate</b><small>Review approvals</small></button>
        <button data-nav-jump="queue"><span>Q</span><b>Posting Queue</b><small>Manage drafts</small></button>
        <button data-nav-jump="outputs"><span>O</span><b>View Outputs</b><small>Browse exports</small></button>
      </div>
    </section>
  `;
}

function renderAgentRunPanel() {
  const run = state.agentRun || {};
  const status = state.agentRunBusy ? "running" : run.status || "idle";
  const progress = state.agentRunBusy ? Math.max(8, Number(run.progress || 8)) : Number(run.progress || 0);
  const counts = run.counts || {};
  const steps = run.steps || [];
  const recentSteps = steps.slice(-5);
  const statusTone = status === "completed" ? "good" : status === "blocked" || status === "error" ? "bad" : status === "needs_approval" ? "warn" : status === "running" ? "info" : "neutral";
  return `
    <section class="panel agent-run-panel">
      <div class="agent-run-head">
        <div>
          <span class="eyebrow">Agent 101 Runner</span>
          <h2>Safe internal clipping workflow</h2>
          <p class="muted">${esc(run.summary || "Run explicit Practice Mode tasks without logging in, uploading, publishing, spending, or changing accounts.")}</p>
        </div>
        ${badge(status === "idle" ? "Idle" : status, statusTone)}
      </div>
      <div class="agent-run-bar">
        <span style="width:${Math.min(100, Math.max(0, progress))}%"></span>
      </div>
      <div class="agent-run-grid">
        <span><b>${esc(run.currentStep || "Ready")}</b><em>Current step</em></span>
        <span><b>${esc(counts.candidates || 0)}</b><em>New candidates</em></span>
        <span><b>${esc(counts.packages || 0)}</b><em>New packages</em></span>
        <span><b>${esc(counts.approvals || 0)}</b><em>Human Gate items</em></span>
        <span><b>${esc(counts.artifacts || 0)}</b><em>Artifacts</em></span>
      </div>
      <form id="agent101-command-form" class="agent-run-command">
        <input name="goal" placeholder="Tell Agent 101 what to run, e.g. test the Clips Office and package the top 3 clips">
        <button class="primary" type="submit" ${state.agentRunBusy ? "disabled" : ""}>Run Agent 101</button>
      </form>
      <div class="agent-run-actions">
        <button data-action="agent101-demo-workflow" ${state.agentRunBusy ? "disabled" : ""}>Run practice clipping workflow</button>
        <button data-action="agent101-add-demo-streamers" ${state.agentRunBusy ? "disabled" : ""}>Add 5 practice streamers</button>
        <button data-action="agent101-watch-cycle" ${state.agentRunBusy ? "disabled" : ""}>Run watch cycle</button>
        <button data-action="agent101-create-candidates" ${state.agentRunBusy ? "disabled" : ""}>Generate clip candidates</button>
        <button data-action="agent101-package-top3" ${state.agentRunBusy ? "disabled" : ""}>Package top 3 clips</button>
        <button data-action="agent101-human-gate" ${state.agentRunBusy ? "disabled" : ""}>Send drafts to Human Gate</button>
      </div>
      ${recentSteps.length ? `<div class="agent-run-steps">${recentSteps.map((step) => `
        <span class="${esc(step.status)}"><b>${esc(step.tool)}</b><em>${esc(step.message)}</em></span>
      `).join("")}</div>` : ""}
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
  const streamers = realStreamers();
  const practice = practiceStreamers();
  if (!streamers.length) {
    return `
      <div class="empty-mission">
        <strong>No real streamers loaded yet</strong>
        <p>Add approved creators manually to use Real Mode. Practice Mode is available for safe local testing and is excluded from real metrics.</p>
        <div class="actions">
          <button class="primary" data-nav-jump="watchlist">Add Real Streamer</button>
          <button data-action="seed-demo">Start Practice Project</button>
          ${practice.length ? `<button data-action="clear-demo">Clear Practice Data</button>` : ""}
        </div>
        ${practice.length ? `<small class="practice-inline">PRACTICE MEDIA — NOT A REAL STREAM: ${practice.length} practice streamer(s) currently loaded.</small>` : ""}
      </div>
    `;
  }
  const cards = streamers.slice(0, 5).map((streamer, index) => {
    const relatedCandidate = bestCandidateForStreamer(streamer.id);
    const status = liveStatusMeta(streamer);
    return `
    <article class="stream-card" data-select-streamer="${esc(streamer.id)}">
      ${previewFrame({
        label: streamer.liveStatus === "live" ? "LIVE" : status.label,
        title: streamer.liveTitle || `${streamer.displayName} stream`,
        subtitle: streamer.liveCategory || streamer.notes || "Local monitored source",
        timestamp: relatedCandidate?.timestampStart || "00:00:00",
        end: relatedCandidate?.timestampEnd || `${relatedCandidate?.duration || 30}s`,
        index,
        imageUrl: streamThumbnailUrl(streamer),
        candidateId: relatedCandidate?.id || "",
        className: "clip-thumb stream-thumb",
        score: relatedCandidate?.score || streamer.liveViewerCount || index * 8
      })}
      <div class="stream-meta">
        <strong>${esc(streamer.displayName)}</strong>
        ${permissionBadge(streamer.permissionStatus)}
      </div>
      <p>${esc(status.label)} · ${esc(streamer.platform)}${streamer.liveViewerCount ? ` · ${Number(streamer.liveViewerCount).toLocaleString()} viewers` : ""}</p>
      <div class="stream-foot">
        <span>${fmtDate(streamer.lastCheckedAt)}</span>
        <span class="spark">${sparkline(index * 7)}</span>
      </div>
    </article>
  `;
  }).join("");
  return `
    <div class="stream-grid">
      ${cards}
      <button class="add-stream-card" data-nav-jump="watchlist"><b>+</b><span>Add Streamer</span><small>Monitor a new channel</small></button>
    </div>
    ${practice.length ? `<div class="practice-inline">PRACTICE MEDIA — NOT A REAL STREAM: ${practice.length} practice streamer(s) are available from Practice Mode.</div>` : ""}
  `;
}

function renderTopCandidates() {
  const real = [...realCandidates()].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const practice = [...practiceCandidates()].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const usingPractice = !real.length && practice.length;
  const candidates = (usingPractice ? practice : real).slice(0, 5);
  if (!candidates.length) return empty("No real candidates yet. Add an approved streamer and run a watch cycle, or start a Practice Project.");
  return `<div class="candidate-list">${candidates.map((candidate, index) => `
    <article class="candidate-row" data-select-candidate="${candidate.id}">
      ${radarThumb(candidate, index + 2)}
      <span class="candidate-score ${candidateTone(Number(candidate.score || 0))}">${Number(candidate.score || 0)}</span>
      <div>
        <strong>${esc(candidate.title)}</strong>
        <small>${esc(streamerName(candidate.streamerId))} · ${esc(candidate.category || "Clip")}</small>
        <em>${esc(candidate.timestampStart)} · ${esc(candidate.duration || 30)}s</em>
      </div>
      <span class="spark">${sparkline(Number(candidate.score || 0))}</span>
    </article>
  `).join("")}</div>${usingPractice ? practiceNotice("Practice candidates are shown because no real candidates exist yet.") : ""}`;
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
    ["Twitch API", state.twitch?.configured ? "Connected" : "Needs vars", state.twitch?.configured ? "good" : "warn"],
    ["Kick API", state.kick?.configured ? "Connected" : "Needs vars", state.kick?.configured ? "good" : "warn"],
    ["OpenAI API", state.openai?.configured ? "Connected" : "Local fallback", state.openai?.configured ? "good" : "warn"],
    ["Storage", "Healthy", "good"],
    ["Human Gate", countWhere(realApprovals(), (approval) => approval.status === "pending") ? "Reviewing" : "Ready", "info"]
  ];
  return `<div class="system-grid">${tiles.map(([label, value, tone]) => `
    <span class="system-tile ${esc(tone)}"><b>${esc(label)}</b><em>${esc(value)}</em></span>
  `).join("")}</div>`;
}

function renderWatchlist() {
  const streamers = realStreamers();
  const practice = practiceStreamers();
  const liveCount = countWhere(streamers, isStreamerLive);
  const monitoringCount = countWhere(streamers, (streamer) => streamer.monitorEnabled);
  const offlineCount = countWhere(streamers, isStreamerConfirmedOffline);
  const pendingCount = countWhere(streamers, (streamer) => streamer.permissionStatus === "pending");
  const blockedCount = countWhere(streamers, (streamer) => streamer.permissionStatus === "blocked");
  const selected = selectedStreamer();
  view.innerHTML = `
    <section class="watchlist-page">
      ${practice.length ? practiceNotice(`${practice.length} practice streamer(s) are hidden from the Real Mode table and can be cleared safely.`, true) : ""}
      <div class="watchlist-tabs">
        <button class="active">All Streamers <b>${streamers.length}</b></button>
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
        ${watchStat("Total Streamers", streamers.length, "real records", "TEAM", "warn")}
        ${watchStat("Live Right Now", liveCount, `${streamers.length ? Math.round((liveCount / streamers.length) * 100) : 0}% of real total`, "LIVE", "bad")}
        ${watchStat("Monitoring", monitoringCount, "Actively watching", "EYE", "info")}
        ${watchStat("Pending Approval", pendingCount, "Needs review", "CLK", "warn")}
        ${watchStat("Blocked", blockedCount, "No blocked channels", "SHD", "neutral")}
      </div>

      ${renderStreamerScout()}

      <div class="watchlist-shell">
        <section class="panel streamer-directory">
          <div class="watchlist-filterbar">
            <label class="stream-search">Search streamers <input placeholder="Search streamers..." aria-label="Search streamers"></label>
            <select aria-label="Platform filter"><option>Platform: All</option><option>Twitch</option><option>YouTube</option><option>Kick</option></select>
            <select aria-label="Status filter"><option>Status: All</option><option>Monitoring</option><option>Paused</option></select>
            <select aria-label="Permission filter"><option>Permission: All</option><option>Approved</option><option>Pending</option></select>
            <select aria-label="Sort filter"><option>Sort: Last Checked</option><option>Sort: Candidates</option><option>Sort: Name</option></select>
          </div>
          ${streamers.length ? renderStreamerTable(true, streamers) : empty("No real streamers added. Use Add Streamer for production records or Start Practice Project for local testing.")}
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
          <button data-action="seed-demo">Start Practice Project</button>
          ${practice.length ? `<button data-action="clear-demo">Clear Practice Data</button>` : ""}
          <button data-nav-jump="settings">API Connections</button>
        </section>
      </div>
    </section>
  `;
}

function renderStreamerTable(editable, rows = state.streamers) {
  const sortedStreamers = [...rows].sort((a, b) => {
    const liveDelta = Number(isStreamerLive(b)) - Number(isStreamerLive(a));
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
                    <strong>${esc(streamer.displayName)} ${isPracticeStreamer(streamer) ? "<em>practice</em>" : "<em>verified</em>"}</strong>
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
                <button data-check-streamer="${streamer.id}">Check</button>
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

function renderStreamerScout() {
  const hasRecommendations = state.recommendations.length > 0;
  return `
    <section class="panel streamer-scout-panel">
      <div class="scout-head">
        <div>
          <span class="eyebrow">Agent 101 Streamer Scout</span>
          <h2>Find creators worth monitoring</h2>
          <p class="muted">${esc(state.recommendationsMessage || "Agent 101 can scan configured Kick/Twitch live directories, score streamer fit, and prepare a monitored shortlist for your approval.")}</p>
        </div>
        <div class="scout-actions">
          <select id="scout-platform" aria-label="Scout platform">
            <option value="all">Kick + Twitch</option>
            <option value="kick">Kick only</option>
            <option value="twitch">Twitch only</option>
          </select>
          <button class="primary" data-action="scout-streamers">Scout streamers</button>
        </div>
      </div>
      <div class="scout-provider-row">
        ${badge(state.kick?.configured ? "Kick ready" : "Kick vars needed", state.kick?.configured ? "good" : "warn")}
        ${badge(state.twitch?.configured ? "Twitch ready" : "Twitch vars needed", state.twitch?.configured ? "good" : "warn")}
        ${badge("Human approval before monitoring", "info")}
      </div>
      <div class="scout-recommendations">
        ${hasRecommendations ? state.recommendations.map(renderStreamerRecommendation).join("") : empty("No scout run yet. Click Scout streamers after provider variables finish deploying.")}
      </div>
    </section>
  `;
}

function renderStreamerRecommendation(item, index) {
  return `
    <article class="scout-card">
      <div class="scout-rank">
        <span>${index + 1}</span>
        <b>${esc(item.score || 0)}</b>
      </div>
      <div class="scout-copy">
        <div class="scout-title-row">
          <strong>${esc(item.displayName)}</strong>
          ${platformBadge(item.platform)}
        </div>
        <p>${esc(item.title || item.reason || "Recommended for review")}</p>
        <small>${esc(item.category || "General")} - ${Number(item.viewerCount || 0).toLocaleString()} viewers - ${esc(item.source || "Agent 101")}</small>
        <em>${esc(item.reason || "Good candidate for supervised monitoring.")}</em>
      </div>
      <button data-add-recommendation="${index}">Add to monitoring</button>
    </article>
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
      <input name="channelId" placeholder="Channel login, optional if URL is pasted">
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
  if (selected && !isPracticeStreamer(selected)) return selected;
  return realStreamers()[0] || state.streamers[0] || null;
}

function streamerCandidateCount(streamerId) {
  return countWhere(state.candidates, (candidate) => candidate.streamerId === streamerId);
}

function isStreamerLive(streamer) {
  return streamer?.liveStatus === "live" || streamer?.liveStatus === "demo_live";
}

function isStreamerConfirmedOffline(streamer) {
  return streamer?.liveStatus === "offline" || streamer?.liveStatus === "offline_or_demo" || streamer?.liveStatus === "demo_offline";
}

function liveStatusMeta(streamer) {
  const status = streamer?.liveStatus || "unknown";
  if (status === "live") return { label: "LIVE", className: "is-live" };
  if (status === "demo_live") return { label: "PRACTICE", className: "is-live" };
  if (status === "offline" || status === "offline_or_demo" || status === "demo_offline") return { label: "OFFLINE", className: "is-offline" };
  if (status === "api_not_configured") return { label: "API NEEDED", className: "needs-api" };
  if (status === "api_error") return { label: "CHECK FAILED", className: "has-error" };
  if (status === "blocked") return { label: "BLOCKED", className: "is-blocked" };
  if (status === "unsupported") return { label: "UNSUPPORTED", className: "is-blocked" };
  return { label: "CHECK NEEDED", className: "needs-check" };
}

function liveSourceLabel(streamer) {
  if (streamer?.platform === "kick") return state.kick?.configured ? "Official Kick API" : "Needs Kick API vars";
  if (streamer?.platform === "twitch") return state.twitch?.configured ? "Official Twitch API" : "Needs Twitch API vars";
  return streamer?.isDemo || streamer?.permissionStatus === "demo_approved" ? "Practice source" : "Manual source";
}

function platformBadge(platform) {
  const label = platform === "youtube_live" ? "YouTube" : platform || "Twitch";
  return `<span class="platform-badge">${esc(label)}</span>`;
}

function liveBadge(streamer) {
  const { label, className } = liveStatusMeta(streamer);
  return `<span class="live-badge ${esc(className)}" title="${esc(streamer.liveStatusReason || "")}">${esc(label)}</span>`;
}

function renderStreamerInspector(streamer) {
  const status = liveStatusMeta(streamer);
  return `
    <div class="inspector-profile">
      <span class="creator-avatar large">${esc(initials(streamer.displayName))}</span>
      <div>
        <h2>${esc(streamer.displayName)}</h2>
        <p>${esc(streamer.channelId || "local channel")} · ${streamerCandidateCount(streamer.id)} candidates</p>
      </div>
      <span class="live-badge ${esc(status.className)}" title="${esc(streamer.liveStatusReason || "")}">${esc(status.label)}</span>
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
        <span>Partner Status</span><b>${isPermissionReady(streamer) ? "Ready" : "Needs review"}</b>
        <span>Language</span><b>English</b>
        <span>Live source</span><b>${esc(liveSourceLabel(streamer))}</b>
        <span>Last check</span><b>${esc(fmtDate(streamer.lastCheckedAt))}</b>
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
  if (status === "demo_approved") return badge("practice", "info");
  if (status === "blocked") return badge("blocked", "bad");
  return badge("pending", "warn");
}

function renderRadar() {
  const selected = selectedCandidate();
  const real = realCandidates();
  const practice = practiceCandidates();
  const showingPractice = !real.length && practice.length;
  const visibleCandidates = showingPractice ? practice : real;
  const sorted = [...visibleCandidates].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const highScore = countWhere(visibleCandidates, (candidate) => Number(candidate.score || 0) >= 70);
  const ready = countWhere(visibleCandidates, (candidate) => candidate.status === "packaged");
  const reviewed = countWhere(visibleCandidates, (candidate) => ["reviewed", "packaged", "rejected"].includes(candidate.status));
  const dismissed = countWhere(visibleCandidates, (candidate) => candidate.status === "rejected");
  view.innerHTML = `
    <section class="radar-page">
      ${showingPractice ? practiceNotice("Practice candidates are visible because no real clip candidates exist yet. They are not counted as production clips.", true) : practice.length ? practiceNotice(`${practice.length} practice candidate(s) are hidden from Real Mode counts.`, true) : ""}
      <div class="radar-tabs">
        <button class="active">${showingPractice ? "Practice Candidates" : "All Candidates"} <b>${visibleCandidates.length}</b></button>
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
            <select aria-label="Streamer filter"><option>Streamer: All</option>${(showingPractice ? practiceStreamers() : realStreamers()).map((streamer) => `<option>${esc(streamer.displayName)}</option>`).join("")}</select>
            <select aria-label="Score filter"><option>Score: All</option><option>70+</option><option>90+</option></select>
            <select aria-label="Duration filter"><option>Duration: All</option><option>Short</option><option>Ideal</option><option>Long</option></select>
            <select aria-label="Status filter"><option>Status: All</option><option>New</option><option>Packaged</option><option>Rejected</option></select>
          </div>

          ${sorted.length ? renderRadarTable(sorted) : empty("No real clip candidates yet. Run a watch cycle after adding approved streamers, or start a Practice Project.")}
        </section>

        <aside class="panel radar-inspector">
          ${selected ? renderCandidateInspector(selected) : empty("Select a clip candidate")}
        </aside>
      </div>

      <div class="radar-footer">
        <span>${selected ? `1 selected` : `${visibleCandidates.length} ${showingPractice ? "practice " : ""}candidates`}</span>
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
            <strong>${esc(streamer?.displayName || "Unknown streamer")} <em>${isPracticeCandidate(candidate) ? "practice" : "verified"}</em></strong>
            <small>${esc(candidate.category || (isPracticeCandidate(candidate) ? "Practice stream" : "Clip"))}${streamer?.liveStatus ? ` · ${liveLabel(streamer.liveStatus)}` : ""}</small>
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
          <button data-preview-candidate="${candidate.id}">Play</button>
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
  const real = realCandidates();
  if (selected && (!isPracticeCandidate(selected) || !real.length)) return selected;
  return [...(real.length ? real : practiceCandidates())].sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0] || null;
}

function radarThumb(candidate, index = 0) {
  const start = candidate.timestampStart || "00:00";
  const end = candidate.timestampEnd || "00:30";
  const streamer = state.streamers.find((item) => item.id === candidate.streamerId);
  const isDemo = isPracticeCandidate(candidate);
  return previewFrame({
    label: isDemo ? "PRACTICE" : candidate.sourceProvenance === "UNAVAILABLE" ? "UNAVAILABLE" : "SOURCE",
    title: candidate.title || "Clip preview",
    subtitle: `${streamer?.displayName || "Stream"} · ${candidate.category || "Clip"}`,
    timestamp: start,
    end,
    index,
    imageUrl: candidateThumbnailUrl(candidate),
    candidateId: candidate.id,
    className: "radar-thumb",
    score: candidate.score
  });
}

function candidateTags(candidate, index = 0) {
  const labels = [
    candidate.category || "Clip",
    Number(candidate.score || 0) >= 85 ? "High Energy" : index % 2 ? "Clean Hook" : "Review"
  ];
  return labels.map((label) => `<em>${esc(label)}</em>`).join("");
}

function liveLabel(value) {
  if (value === "live") return "Live now";
  if (value === "offline") return "Offline by Twitch API";
  if (value === "api_not_configured") return "Needs Twitch API";
  if (value === "api_error") return "Twitch check failed";
  if (String(value || "").startsWith("demo")) return "Practice mode";
  return String(value || "Not checked");
}

function scoreRing(score) {
  const tone = score >= 90 ? "excellent" : score >= 80 ? "strong" : score >= 70 ? "good" : "watch";
  const label = score >= 90 ? "Exceptional" : score >= 80 ? "Very good" : score >= 70 ? "Good" : "Review";
  return `<div class="score-ring score-${tone}" style="--score:${Math.max(0, Math.min(100, score))}"><b>${score}</b><small>${label}</small></div>`;
}

function formatEngagement(candidate, index = 0) {
  if (candidate?.chatSignals?.source === "UNAVAILABLE" || (candidate?.viewerCount == null && candidate?.sourceProvenance === "DEMO_SOURCE")) {
    return "Unavailable";
  }
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

function shortTime(value) {
  if (!value) return "now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "now";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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
        <p>${esc(streamer?.displayName || "Unknown streamer")} · ${esc(candidate.category || (isPracticeCandidate(candidate) ? "Practice" : "Clip"))} · ${timeAgo(candidate.updatedAt || candidate.createdAt)}</p>
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
        <span>Source</span><b>${esc(candidate.sourceType || (isPracticeCandidate(candidate) ? "practice" : "unknown"))}</b>
        <span>Resolution</span><b>1080x1920</b>
        <span>Duration</span><b>${candidate.duration || 30}s</b>
        <span>Risk</span><b>${candidate.riskScore || 0}/100</b>
      </div>
    </div>
  `;
}

function renderClipPreviewModal() {
  const candidate = candidateById(state.previewCandidateId);
  if (!candidate) return "";
  const streamer = state.streamers.find((item) => item.id === candidate.streamerId);
  const source = state.studio?.source?.id === candidate.sourceId
    ? state.studio.source
    : (state.mediaSources || []).find((item) => item.id === candidate.sourceId) || null;
  const plan = selectedClipPackage(candidate)?.packagePlan || fallbackPackagePlan(candidate);
  const score = Number(candidate.score || 0);
  const hook = Number(candidate.hookScore || 0);
  return `
    <div class="clip-preview-overlay" role="dialog" aria-modal="true" aria-label="Clip preview">
      <section class="clip-preview-modal">
        <div class="preview-head">
          <div>
            <span class="eyebrow">Local draft preview</span>
            <h2>${esc(candidate.title || "Clip preview")}</h2>
            <p>${esc(streamer?.displayName || "Unknown streamer")} · ${esc(candidate.category || (isPracticeCandidate(candidate) ? "Practice stream" : "Clip"))} · ${esc(candidate.timestampStart || "00:00")} to ${esc(candidate.timestampEnd || `${candidate.duration || 30}s`)}</p>
          </div>
          <button class="icon-button" data-close-preview aria-label="Close preview">×</button>
        </div>
        <div class="preview-body">
          <div class="preview-player">
            ${source?.playbackUrl ? `
              <div class="clip-preview-video-wrap">
                ${source.provenance === "DEMO_SOURCE" ? `<span class="demo-ribbon">PRACTICE MEDIA — NOT A REAL STREAM</span>` : ""}
                <video class="studio-player clip-preview-video" src="${esc(appUrl(source.playbackUrl))}" controls playsinline preload="metadata" data-studio-video data-start="${esc(candidateStartSeconds(candidate))}"></video>
              </div>
            ` : previewFrame({
              label: isPracticeCandidate(candidate) ? "PRACTICE" : "LIVE CLIP",
              title: plan.thumbnailText || plan.hook || candidate.title,
              subtitle: "Source data unavailable. Playable media is required for final clipping.",
              timestamp: candidate.timestampStart || "00:00",
              end: candidate.timestampEnd || `${candidate.duration || 30}s`,
              index: score,
              imageUrl: candidateThumbnailUrl(candidate),
              candidateId: "",
              className: "clip-preview-frame",
              score
            })}
            <div class="preview-transport">
              <button type="button" data-preview-open-builder="${esc(candidate.id)}">Open builder</button>
              <span>${esc(candidate.timestampStart || "00:00")} / ${candidate.duration || 30}s</span>
              <i><b style="width:${Math.max(20, Math.min(92, score))}%"></b></i>
            </div>
          </div>
          <aside class="preview-detail">
            <div class="preview-score-row">
              ${scoreRing(score)}
              <span><b>${hook}</b><em>Hook strength</em></span>
              <span><b>${formatEngagement(candidate, 3)}</b><em>Chat signal</em></span>
            </div>
            <section>
              <h3>What Agent 101 sees</h3>
              <p>${esc(candidate.reason || "This candidate is evaluated from hook strength, chat spike, duration, category fit, title potential, retention potential, and safety risk.")}</p>
            </section>
            <section>
              <h3>Transcript and chat context</h3>
              <p class="transcript-box">${esc(candidate.transcriptSnippet || "No transcript captured yet. Run another watch cycle or add source notes to improve this preview.")}</p>
            </section>
            <section>
              <h3>Draft package target</h3>
              <ul class="preview-checklist">
                <li>9:16 vertical clip</li>
                <li>1080x1920 export handoff</li>
                <li>${candidate.duration || 30}s target duration</li>
                <li>Human Gate before posting</li>
              </ul>
            </section>
            <div class="preview-actions">
              <button class="primary" data-preview-open-builder="${esc(candidate.id)}">Open in Builder</button>
              <button data-package-candidate="${esc(candidate.id)}">Create Package</button>
              <button data-close-preview>Close</button>
            </div>
          </aside>
        </div>
      </section>
    </div>
  `;
}

function renderBuilder() {
  const studio = state.studio || {};
  const source = studio.source;
  const candidates = studio.candidates?.length
    ? studio.candidates
    : state.candidates.filter((candidate) => candidate.sourceId);
  const candidate = studioSelectedCandidate(candidates);
  if (candidate && candidate.id !== state.selectedCandidateId) {
    state.selectedCandidateId = candidate.id;
    localStorage.setItem("selectedCandidateId", candidate.id);
  }
  const project = studio.project || {};
  const renderJobs = studio.renderJobs || [];
  const activeJob = renderJobs.find((job) => job.candidateId === candidate?.id && job.status !== "cancelled");
  const readiness = projectReadiness(project);
  const renderedArtifact = activeJob?.artifactId
    ? state.artifacts.find((artifact) => artifact.id === activeJob.artifactId)
    : candidate?.renderedArtifactId
      ? state.artifacts.find((artifact) => artifact.id === candidate.renderedArtifactId)
      : null;
  const tabs = [
    ["source", "Source"],
    ["candidate", "Candidate"],
    ["vertical", "9:16 Preview"],
    ["rendered", "Rendered Draft"],
    ["capcut", "CapCut Workspace"]
  ];
  view.innerHTML = `
    <section class="builder-page studio-page">
      <div class="studio-topbar panel">
        <div>
          <span class="eyebrow">Clipping Office</span>
          <h2>${esc(project.title || "Clipping Office Main Workspace")}</h2>
          <p>Media-first workspace. Agent 101 can draft, score, package, and prepare handoffs from verified playable source media.</p>
        </div>
        <div class="studio-status">
          ${provenancePill(source?.provenance || "UNAVAILABLE")}
          ${badge(project.mode === "practice" ? "Practice project" : "Real project", project.mode === "practice" ? "warn" : "good")}
          ${badge(state.media?.mode === "local_render_ready" ? "Render ready" : "Render setup needed", state.media?.mode === "local_render_ready" ? "good" : "warn")}
          <button class="primary slim" data-studio-action="render-draft" ${readiness.canRender && !state.studioBusy ? "" : "disabled"}>${state.studioBusy ? "Working..." : "Render draft"}</button>
        </div>
      </div>

      ${source?.playable ? renderStudioProjectSummary(project, source, candidate, activeJob) : renderMediaUploadPanel()}

      <div class="studio-shell">
        <section class="panel studio-main">
          <div class="studio-tabbar">
            ${tabs.map(([id, label]) => `<button class="${state.studioTab === id ? "active" : ""}" data-studio-tab="${id}">${esc(label)}</button>`).join("")}
          </div>
          ${renderStudioStage(source, candidate, renderedArtifact)}
          ${renderSourceTruth(source, studio.unavailable)}
          ${renderStudioTransport(source, candidate, candidates)}
        </section>

        <aside class="panel studio-inspector">
          ${renderStudioInspector(source, candidate, activeJob)}
        </aside>
      </div>

      <section class="panel studio-bottom">
        ${renderStudioTimeline(source, candidate, candidates)}
        ${renderStudioCandidateRail(candidates, candidate)}
        ${renderStudioAssetDock(studio, activeJob)}
      </section>
    </section>
  `;
}

function renderStudioProjectSummary(project = {}, source, candidate, activeJob) {
  const readiness = projectReadiness(project);
  return `
    <section class="panel studio-project-summary">
      <div>
        <span class="eyebrow">${esc(sourceTruthLabel(source))}</span>
        <strong>${esc(source?.title || source?.displayName || "Playable source")}</strong>
        <small>${esc(source?.originalFilename || source?.storagePath || "Verified source")} · ${Math.round(sourceDurationSeconds(source))}s · ${esc(source?.width || "?")}×${esc(source?.height || "?")}</small>
      </div>
      <div>
        <span class="eyebrow">Selected clip</span>
        <strong>${esc(candidate?.title || "No candidate selected")}</strong>
        <small>${esc(candidate?.timestampStart || "00:00")} to ${esc(candidate?.timestampEnd || "00:00")} · ${Math.round(candidateEndSeconds(candidate) - candidateStartSeconds(candidate)) || 0}s</small>
      </div>
      <div>
        <span class="eyebrow">Readiness</span>
        <strong>${readiness.canRender ? "Ready to render" : "Needs setup"}</strong>
        <small>${esc(readiness.canRender ? "Source, range, and candidate are valid." : (readiness.renderReasons || ["Project needs source setup."])[0])}</small>
      </div>
      <div>
        <span class="eyebrow">Project state</span>
        <strong>${esc(project.status || "empty")}</strong>
        <small>${esc(autosaveLabel(project))}${activeJob ? ` · ${esc(activeJob.status)}` : ""}</small>
      </div>
    </section>
  `;
}

function studioSelectedCandidate(candidates = []) {
  return candidates.find((item) => item.id === state.selectedCandidateId)
    || candidates.find((item) => item.id === state.studio?.project?.selectedCandidateId)
    || candidates[0]
    || null;
}

function provenancePill(value) {
  const label = value === "DEMO_SOURCE" ? "PRACTICE MEDIA" : String(value || "UNAVAILABLE").replaceAll("_", " ");
  const tone = value === "DEMO_SOURCE" ? "warn" : value === "VERIFIED_MEDIA" || value === "AUTHORIZED_UPLOAD" ? "good" : "neutral";
  return `<span class="provenance-pill ${tone}">${esc(label)}</span>`;
}

function candidateStartSeconds(candidate) {
  return Number(candidate?.timestampStartSeconds ?? parseTimestamp(candidate?.timestampStart) ?? 0);
}

function parseTimestamp(value) {
  if (typeof value === "number") return value;
  const parts = String(value || "").split(":").map(Number).filter((part) => !Number.isNaN(part));
  if (!parts.length) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

function sourcePlaybackUrl(source) {
  return source?.playbackUrl ? appUrl(source.playbackUrl) : "";
}

function sourceDurationSeconds(source) {
  return Number(source?.durationSeconds ?? source?.duration ?? 0) || 0;
}

function candidateEndSeconds(candidate) {
  return Number(candidate?.timestampEndSeconds ?? candidate?.endSeconds ?? candidateStartSeconds(candidate) + Number(candidate?.durationSeconds ?? candidate?.duration ?? 0)) || 0;
}

function candidateScoreValue(candidate) {
  const value = candidate?.qualityScore ?? candidate?.score;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function candidateScoreBadge(candidate) {
  const score = candidateScoreValue(candidate);
  if (score == null) return `<span class="score-empty">Not scored</span>`;
  return scoreRing(score);
}

function sourceTruthLabel(source) {
  if (!source) return "No source";
  if (source.provenance === "DEMO_SOURCE") return "PRACTICE MEDIA";
  if (source.provenance === "AUTHORIZED_UPLOAD") return "VERIFIED UPLOAD";
  if (source.provenance === "VERIFIED_MEDIA") return "VERIFIED MEDIA";
  return String(source.provenance || "UNAVAILABLE").replaceAll("_", " ");
}

function projectReadiness(project = {}) {
  return project.readiness || {
    canRender: false,
    canPackage: false,
    canCapCut: false,
    canHumanGate: false,
    renderReasons: ["Project is not ready."]
  };
}

function autosaveLabel(project = {}) {
  if (!project.autosavedAt && !project.updatedAt) return "Not saved";
  const value = project.autosavedAt || project.updatedAt;
  return `Saved ${shortTime(value)}`;
}

function renderMediaUploadPanel() {
  return `
    <form id="media-upload-form" class="media-upload-form" enctype="multipart/form-data">
      <div>
        <span class="eyebrow">Real Project</span>
        <h3>Upload approved source media</h3>
        <p>Add a playable MP4/WebM/MOV that you own or are allowed to use. The server verifies it with FFprobe before editing.</p>
      </div>
      <label>
        <span>Project title</span>
        <input name="title" placeholder="e.g. Stream highlight package" autocomplete="off">
      </label>
      <label class="media-file-drop">
        <input name="file" type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" required>
        <strong>Select video file</strong>
        <small>Keys stay server-side. Source path is never exposed.</small>
      </label>
      <button class="primary" type="submit">Upload and verify</button>
    </form>
  `;
}

function studioCandidateThumb(candidate, index = 0) {
  return appUrl(candidate?.thumbnailUrl || `/api/media/sources/${encodeURIComponent(candidate?.sourceId || "media_demo_clipping_source")}/frame?candidateId=${encodeURIComponent(candidate?.id || "")}&v=${index}`);
}

function renderStudioStage(source, candidate, renderedArtifact) {
  if (!source?.playable) {
    return `
      <div class="studio-empty-stage">
        <span class="eyebrow">No verified source</span>
        <h3>Start a Clip Project</h3>
        <p>No playable media source is selected. Add approved media for Real Mode, open a verified Clip Radar candidate, or start Practice Mode deliberately.</p>
        <div class="empty-actions">
          <button class="primary" data-nav-jump="watchlist">Add approved streamer</button>
          <button data-nav-jump="radar">Open Clip Radar</button>
          <button data-action="seed-demo">Start Practice Project</button>
        </div>
      </div>
    `;
  }
  const src = sourcePlaybackUrl(source);
  const mode = state.studioTab || "source";
  if (mode === "rendered") {
    const renderedUrl = renderedArtifact?.playbackUrl || renderedArtifact?.url;
    return renderedUrl ? `
      <div class="studio-stage rendered-stage">
        <video class="studio-player" src="${esc(appUrl(renderedUrl))}" controls playsinline preload="metadata"></video>
      </div>
    ` : `
      <div class="studio-empty-stage">
        <h3>No rendered draft yet</h3>
        <p>Render the selected candidate to create a real MP4 artifact.</p>
        <button class="primary" data-studio-action="render-draft" ${candidate ? "" : "disabled"}>Render selected candidate</button>
      </div>
    `;
  }
  if (mode === "capcut") {
    const readiness = projectReadiness(state.studio?.project || {});
    return `
      <div class="studio-capcut-stage">
        <div>
          <span class="eyebrow">Manual Handoff</span>
          <h3>CapCut Workspace</h3>
          <p>${esc(readiness.canCapCut ? "Verified MP4 is ready for a supervised CapCut handoff. Editing stays operator-controlled." : "Render a verified 9:16 MP4 before preparing the CapCut handoff.")}</p>
        </div>
        <button class="primary" data-action="create-capcut" ${readiness.canCapCut ? "" : "disabled"}>Prepare handoff package</button>
        <button data-studio-action="capcut-open" ${readiness.canCapCut ? "" : "disabled"}>Open CapCut workspace</button>
      </div>
    `;
  }
  const vertical = mode === "vertical";
  const clipLabel = mode === "candidate" && candidate ? `${candidate.timestampStart} - ${candidate.timestampEnd}` : "Full source";
  return `
    <div class="studio-stage ${vertical ? "vertical-mode" : ""}">
      ${source.provenance === "DEMO_SOURCE" ? `<div class="demo-ribbon">PRACTICE MEDIA — NOT A REAL STREAM</div>` : ""}
      <video
        class="studio-player ${vertical ? "studio-vertical-player" : ""}"
        src="${esc(src)}"
        controls
        playsinline
        preload="metadata"
        data-studio-video
        data-start="${esc(candidateStartSeconds(candidate))}"
      ></video>
      <div class="studio-stage-meta">
        <span>${esc(mode === "candidate" ? candidate?.title || "Selected candidate" : source.title || "Source")}</span>
        <b>${esc(clipLabel)}</b>
      </div>
    </div>
  `;
}

function renderSourceTruth(source, unavailable = {}) {
  return `
    <div class="source-truth">
      <span><b>Source</b>${esc(source?.title || "Source data unavailable")}</span>
      <span><b>Provenance</b>${esc(sourceTruthLabel(source))}</span>
      <span><b>Rights</b>${esc(source?.rightsStatus || "unavailable")}</span>
      <span><b>Transcript</b>${esc(source?.transcriptStatus || "UNAVAILABLE")}</span>
      <span><b>Media</b>${source?.playable ? `${Math.round(sourceDurationSeconds(source))}s · ${esc(source.width || "?")}×${esc(source.height || "?")}` : "Not verified"}</span>
      <span><b>Checksum</b>${source?.sha256 ? esc(`${source.sha256.slice(0, 10)}...`) : "Not available"}</span>
      <span><b>Live metrics</b>${esc(unavailable?.liveMetrics || "Source data unavailable")}</span>
    </div>
  `;
}

function renderStudioTransport(source, candidate, candidates = []) {
  const index = candidates.findIndex((item) => item.id === candidate?.id);
  const prev = candidates[index - 1]?.id || "";
  const next = candidates[index + 1]?.id || "";
  return `
    <div class="studio-transport">
      <button data-studio-select-candidate="${esc(prev)}" ${prev ? "" : "disabled"}>Previous</button>
      <button data-studio-action="replay" ${source?.playable ? "" : "disabled"}>Replay</button>
      <button data-studio-action="mark-start" ${candidate ? "" : "disabled"}>Set start</button>
      <button data-studio-action="mark-end" ${candidate ? "" : "disabled"}>Set end</button>
      <button data-studio-action="capture-frame" ${candidate ? "" : "disabled"}>Capture frame</button>
      <button data-studio-select-candidate="${esc(next)}" ${next ? "" : "disabled"}>Next</button>
    </div>
  `;
}

function renderStudioInspector(source, candidate, activeJob) {
  if (!candidate) return empty("Select a playable candidate or start a project with a verified source.");
  const packageReady = state.packages.some((item) => item.candidateId === candidate.id);
  const readiness = projectReadiness(state.studio?.project || {});
  const transcript = candidate.transcriptProvenance === "UNAVAILABLE"
    ? "Source data unavailable. No transcript has been extracted from this media."
    : candidate.transcriptSnippet;
  return `
    <div class="studio-inspector-head">
      <div>
        <span class="eyebrow">Agent 101 Clip Inspector</span>
        <h2>${esc(candidate.title || "Selected candidate")}</h2>
        <p>${esc(candidate.timestampStart || "00:00")} to ${esc(candidate.timestampEnd || "00:00")} · ${esc(candidate.duration || 0)}s</p>
      </div>
      ${candidateScoreBadge(candidate)}
    </div>
    <div class="studio-inspector-grid">
      <span><b>${esc(candidate.sourceProvenance || source?.provenance || "UNAVAILABLE")}</b><em>Source proof</em></span>
      <span><b>${esc(candidate.creativeProvenance || "AI_GENERATED")}</b><em>Creative text</em></span>
      <span><b>${candidate.viewerCount == null ? "Unavailable" : esc(candidate.viewerCount)}</b><em>Viewers</em></span>
      <span><b>${esc(candidate.confidence || (isPracticeCandidate(candidate) ? "practice" : "unknown"))}</b><em>Confidence</em></span>
    </div>
    <section class="studio-inspector-section">
      <h3>Evidence breakdown</h3>
      <p>${esc(candidate.reason || "Candidate has playable media but needs verified context before external use.")}</p>
      <div class="clip-metrics">
        <span><b>${candidate.hookScore == null ? "Not scored" : esc(candidate.hookScore)}</b><em>Hook</em></span>
        <span><b>${esc(candidate.retentionPotential || "Unavailable")}</b><em>Retention</em></span>
        <span><b>${candidate.riskScore == null ? "Unknown" : esc(candidate.riskScore)}</b><em>Risk</em></span>
      </div>
    </section>
    <section class="studio-inspector-section">
      <h3>Transcript</h3>
      <p class="transcript-box">${esc(transcript)}</p>
    </section>
    <section class="studio-inspector-section">
      <h3>AI creative drafts</h3>
      <div class="creative-drafts">
        <span><b>AI title draft</b>${esc(candidate.suggestedTitle || candidate.title)}</span>
        <span><b>AI hook draft</b>${esc(candidate.suggestedHook || candidate.title)}</span>
        <span><b>Caption status</b>${candidate.transcriptProvenance === "UNAVAILABLE" ? "Needs source transcript or notes" : "Draftable"}</span>
      </div>
    </section>
    ${activeJob ? `
      <section class="studio-inspector-section">
        <h3>Render job</h3>
        <p>${esc(activeJob.currentStep || activeJob.status)}</p>
        <div class="progress"><span style="width:${Math.min(100, Number(activeJob.progress || 0))}%"></span></div>
        ${activeJob.error ? `<p class="mini-error">${esc(activeJob.error)}</p>` : ""}
      </section>
    ` : ""}
    <div class="studio-action-stack">
      <button class="primary" data-studio-action="render-draft" ${disabledAttr(!(readiness.canRender && !state.studioBusy), readiness.renderReasons?.[0] || "Select a playable media source first")}>Render 9:16 draft</button>
      <button data-package-candidate="${esc(candidate.id)}" ${readiness.canPackage ? "" : "disabled"}>Create clip package</button>
      <button data-action="create-capcut" ${readiness.canCapCut ? "" : "disabled"}>Prepare CapCut handoff</button>
      <button data-studio-action="capcut-open" ${readiness.canCapCut ? "" : "disabled"}>Open CapCut workspace</button>
      <button data-nav-jump="gate">Human Gate</button>
    </div>
  `;
}

function renderStudioTimeline(source, candidate, candidates = []) {
  const duration = Math.max(1, sourceDurationSeconds(source) || 24);
  return `
    <div class="studio-timeline">
      <div class="studio-section-head">
        <span class="eyebrow">Timeline</span>
        <strong>${esc(source?.displayName || source?.title || "No source")}</strong>
      </div>
      <div class="studio-timebar">
        ${candidates.map((item) => {
          const start = Math.max(0, (candidateStartSeconds(item) / duration) * 100);
          const width = Math.max(2, ((candidateEndSeconds(item) - candidateStartSeconds(item) || Number(item.duration || 4)) / duration) * 100);
          return `<button class="${item.id === candidate?.id ? "active" : ""}" style="left:${start}%;width:${Math.min(100 - start, width)}%" data-studio-select-candidate="${esc(item.id)}" title="${esc(item.title)}"></button>`;
        }).join("")}
      </div>
      <div class="studio-timeline-note">${source?.playable ? `Verified ${Math.round(duration)}s source. Waveform extraction is not generated yet.` : "No playable source loaded."}</div>
    </div>
  `;
}

function renderStudioCandidateRail(candidates = [], selected) {
  return `
    <div class="studio-rail">
      <div class="studio-section-head">
        <span class="eyebrow">Candidate Rail</span>
        <strong>${candidates.length} playable moments</strong>
      </div>
      <div class="studio-candidate-strip">
        ${candidates.map((candidate, index) => `
          <button class="studio-candidate-card ${candidate.id === selected?.id ? "active" : ""}" data-studio-select-candidate="${esc(candidate.id)}">
            <img src="${esc(studioCandidateThumb(candidate, index))}" alt="">
            <span>${provenancePill(candidate.sourceProvenance || candidate.provenance || "UNAVAILABLE")}</span>
            <strong>${esc(candidate.title || "Untitled candidate")}</strong>
            <small>${esc(candidate.timestampStart || "00:00")} · ${esc(candidate.duration || 0)}s</small>
            <em>${candidateScoreValue(candidate) == null ? "Not scored" : `${candidateScoreValue(candidate)} score`}</em>
          </button>
        `).join("") || empty("No playable candidates yet. Add or upload media first.")}
      </div>
    </div>
  `;
}

function renderStudioAssetDock(studio = {}, activeJob) {
  const source = studio.source;
  const artifacts = studio.artifacts || [];
  const readiness = projectReadiness(studio.project || {});
  return `
    <div class="studio-assets">
      <div class="studio-section-head">
        <span class="eyebrow">Assets & Outputs</span>
        <strong>${artifacts.length} saved</strong>
      </div>
      <div class="studio-asset-grid">
        <span><b>Source video</b>${esc(source?.playable ? source.originalFilename || source.title : "Unavailable")}</span>
        <span><b>Transcript</b>${esc(source?.transcriptStatus || "UNAVAILABLE")}</span>
        <span><b>Latest render</b>${esc(activeJob?.status || "No render yet")}</span>
        <span><b>CapCut</b>${readiness.canCapCut ? "Verified MP4 ready" : "Render required"}</span>
        ${artifacts.slice(0, 4).map((artifact) => `<span><b>${esc(artifact.kind || artifact.type)}</b>${esc(artifact.title)}</span>`).join("")}
      </div>
    </div>
  `;
}

function selectedClipPackage(candidate = selectedCandidate()) {
  if (!candidate) return null;
  return state.packages.find((item) => item.candidateId === candidate.id) || null;
}

function fallbackPackagePlan(candidate) {
  const title = candidate?.suggestedTitle || candidate?.title || "Stream clip draft";
  const hook = candidate?.suggestedHook || candidate?.title || "Watch this moment";
  return {
    title,
    hook,
    captionOverlays: [`${hook}?`, "No way.", "Watch the end."],
    cutInstructions: ["Start before the reaction beat.", "Remove dead air.", "End on the payoff."],
    captions: {
      tiktok: `${hook}\n\n${title}\n\n#streamer #clips #gaming`
    },
    hashtags: ["#streamer", "#clips", "#gaming", "#viral"]
  };
}

function builderStep(number, label, active) {
  return `
    <span class="${active ? "active" : ""}">
      <b>${number}</b>
      ${esc(label)}
      ${active && number < 4 ? "<em>OK</em>" : ""}
    </span>
  `;
}

function renderTimeline(candidate) {
  return `
    <div class="timeline-strip">
      <button>‹</button>
      <div class="waveform">${Array.from({ length: 24 }, (_, index) => `<i style="height:${18 + ((index * 17 + Number(candidate.score || 0)) % 58)}%"></i>`).join("")}</div>
      <div class="frame-reel">${Array.from({ length: 7 }, (_, index) => `<span class="thumb-${index % 5}"></span>`).join("")}</div>
      <button>›</button>
    </div>
  `;
}

function renderHookSuggestions(plan, candidate) {
  const choices = [
    plan.hook || candidate.title,
    `${candidate.title || "This moment"} is the save`,
    "When chat realizes what happened",
    "This is why the timing matters",
    "The cleanest moment from the stream"
  ].filter(Boolean);
  return `
    <div class="hook-list">
      ${choices.map((choice, index) => `
        <label class="${index === 0 ? "active" : ""}">
          <input type="radio" ${index === 0 ? "checked" : ""} disabled>
          <span>${esc(choice)}</span>
        </label>
      `).join("")}
    </div>
    <button data-score-candidate="${candidate.id}">Generate More</button>
  `;
}

function renderPhonePreview(candidate, plan, size = "") {
  const title = plan.thumbnailText || plan.hook || candidate.title || "Clip draft";
  const imageUrl = candidateThumbnailUrl(candidate);
  return `
    <div class="phone-preview ${size}">
      <div class="phone-video thumb-${Math.abs(String(candidate.id || "").length) % 5}">
        ${imageUrl ? `<img src="${esc(imageUrl)}" alt="" loading="lazy">` : ""}
        <span>ACE</span>
        <strong>${esc(title.toUpperCase().slice(0, 22))}</strong>
        <button type="button" data-preview-candidate="${esc(candidate.id)}" aria-label="Play ${esc(candidate.title || "clip")}">Play</button>
      </div>
      <div class="phone-controls">
        <span>▶</span>
        <b>${esc(candidate.timestampStart || "0:12")} / ${candidate.duration || 30}s</b>
        <i></i>
        <span>▣</span>
      </div>
    </div>
  `;
}

function nextStep(label, done, status) {
  return `
    <div class="next-step ${done ? "done" : ""}">
      <span>${done ? "✓" : "□"}</span>
      <b>${esc(label)}</b>
      <em>${esc(status)}</em>
    </div>
  `;
}

function renderMomentTile(candidate, index) {
  return `
    <button class="moment-tile ${candidate.id === state.selectedCandidateId ? "active" : ""}" data-select-candidate="${candidate.id}">
      ${radarThumb(candidate, index)}
      <strong>${esc(candidate.title || "Clip moment")}</strong>
      <span>${candidate.score || 0}</span>
    </button>
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
  const real = realDrafts();
  const practice = state.drafts.filter(isPracticeDraft);
  const showingPractice = !real.length && practice.length;
  const drafts = showingPractice ? practice : real;
  const limit = dailyLimitValue();
  const pending = countWhere(drafts, (draft) => draft.approvalStatus === "pending");
  const approved = countWhere(drafts, (draft) => draft.approvalStatus === "approved");
  const rejected = countWhere(drafts, (draft) => draft.approvalStatus === "rejected");
  const sendBack = countWhere(drafts, (draft) => draft.approvalStatus === "send_back");
  const scheduled = countWhere(drafts, (draft) => Boolean(draft.scheduledFor) || draft.status === "queued");
  const visibleApprovals = showingPractice ? state.approvals.filter(isPracticeApproval) : realApprovals();
  const needsApproval = countWhere(visibleApprovals, (approval) => approval.status === "pending" && approval.type === "posting_draft");
  view.innerHTML = `
    <section class="queue-page">
      ${showingPractice ? practiceNotice("Practice posting drafts are shown because no real posting drafts exist. Nothing here has been posted externally.", true) : practice.length ? practiceNotice(`${practice.length} practice posting draft(s) are hidden from Real Mode counts.`, true) : ""}
      <div class="queue-tabs">
        ${queueTab("Queue", pending, true)}
        ${queueTab("Scheduled", scheduled)}
        ${queueTab("Approved", approved)}
        ${queueTab("Needs review", needsApproval)}
        ${queueTab("Returned", sendBack + rejected)}
      </div>

      <div class="queue-shell">
        <section class="panel queue-board">
          <div class="queue-filterbar">
            <select aria-label="All platforms">
              <option>All Platforms</option>
              <option>TikTok</option>
              <option>Instagram Reels</option>
              <option>YouTube Shorts</option>
            </select>
            <select aria-label="All status">
              <option>All Status</option>
              <option>Awaiting approval</option>
              <option>Approved queue</option>
              <option>Returned</option>
            </select>
            <select aria-label="All streamers">
              <option>All Streamers</option>
              ${(showingPractice ? practiceStreamers() : realStreamers()).map((streamer) => `<option>${esc(streamer.displayName)}</option>`).join("")}
            </select>
            <select aria-label="All dates">
              <option>All Dates</option>
              <option>Today</option>
              <option>This week</option>
            </select>
            <input aria-label="Search posts" placeholder="Search posts..." readonly>
            <button data-action="refresh">Refresh</button>
          </div>

          <div class="queue-table-wrap">
            <table class="queue-table">
              <thead>
                <tr>
                  <th>Clip / Title</th>
                  <th>Streamer</th>
                  <th>Platform</th>
                  <th>Scheduled for</th>
                  <th>Status</th>
                  <th>Potential</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${drafts.length ? drafts.map((draft, index) => renderQueueRow(draft, index)).join("") : `<tr><td colspan="7">${empty("No posting drafts yet. Build a clip package first.")}</td></tr>`}
              </tbody>
            </table>
          </div>

          <footer class="queue-footer">
            <span>Showing ${drafts.length ? `1 to ${Math.min(8, drafts.length)} of ${drafts.length}` : "0"} posts</span>
            <div class="pager"><button class="active">1</button><button ${drafts.length > 8 ? "" : "disabled"}>2</button><button ${drafts.length > 16 ? "" : "disabled"}>Next</button></div>
          </footer>
        </section>

        <aside class="queue-side">
          <section class="panel queue-calendar">
            <div class="section-head compact">
              <h2>Post Calendar</h2>
              <button data-action="refresh">Today</button>
            </div>
            ${renderPostCalendar(drafts)}
          </section>

          <section class="panel queue-summary">
            <div class="section-head compact">
              <h2>Queue Overview</h2>
              <span>Today</span>
            </div>
            ${queueSummaryLine("Awaiting approval", pending, "info")}
            ${queueSummaryLine("Approved queue", approved, "good")}
            ${queueSummaryLine("Returned or blocked", sendBack + rejected, "bad")}
            <div class="daily-meter">
              <b>${limit.approvedToday} / ${limit.limit}</b>
              <span>Daily approval limit</span>
              <i><em style="width:${limit.pct}%"></em></i>
              <small>${limit.pct}% used</small>
            </div>
          </section>

          <section class="panel queue-actions">
            <h2>Quick Actions</h2>
            <button class="primary" data-nav-jump="builder">Create New Post</button>
            <button data-nav-jump="builder">Build from Clip Package</button>
            <button data-nav-jump="gate">Open Human Gate</button>
            <button data-nav-jump="outputs">View Outputs</button>
          </section>

          <section class="panel queue-settings">
            <h2>Posting Rules</h2>
            <div class="settings-list">
              <span><b>Daily approvals</b><em>${limit.limit}</em></span>
              <span><b>Auto publish</b><em>Locked</em></span>
              <span><b>Best-time scheduling</b><em>Draft only</em></span>
              <span><b>Human approval</b><em>Required</em></span>
            </div>
          </section>
        </aside>
      </div>
    </section>
  `;
}

function queueTab(label, count, active = false) {
  return `<button class="${active ? "active" : ""}">${esc(label)} <b>${count}</b></button>`;
}

function renderQueueRow(draft, index) {
  const candidate = draftCandidate(draft);
  const streamer = state.streamers.find((item) => item.id === candidate?.streamerId);
  const score = Number(candidate?.score || 68 + ((index * 7) % 28));
  return `
    <tr>
      <td>
        <div class="queue-clip-cell">
          ${queueThumb(draft, candidate, index)}
          <div>
            <strong>${esc(draft.thumbnailText || candidate?.title || "Posting draft")}</strong>
            <p>${esc(draft.caption || candidate?.transcriptSnippet || "Draft caption waiting for approval.")}</p>
            <span>${(draft.hashtags || []).slice(0, 3).map((tag) => `<em>${esc(tag.replace("#", ""))}</em>`).join("")}</span>
          </div>
        </div>
      </td>
      <td>${queueStreamerCell(streamer, index)}</td>
      <td>${queuePlatformCell(draft.platform)}</td>
      <td>${queueScheduleCell(draft, index)}</td>
      <td>${queueApprovalBadge(draft)}</td>
      <td>${scoreRing(score)}<small>${formatEngagement(candidate || {}, index)} est. views</small></td>
      <td>
        <div class="queue-row-actions">
          <button data-request-post="${draft.id}">Request</button>
          <button data-nav-jump="builder">Preview</button>
        </div>
      </td>
    </tr>
  `;
}

function draftPackage(draft) {
  return state.packages.find((item) => item.id === draft.clipPackageId) || null;
}

function draftCandidate(draft) {
  const clipPackage = draftPackage(draft);
  return state.candidates.find((item) => item.id === clipPackage?.candidateId) || null;
}

function queueThumb(draft, candidate, index) {
  const start = candidate?.timestampStart || "00:00";
  const duration = candidate?.duration || 30;
  return `
    <div class="queue-thumb thumb-${index % 5}">
      <span>${esc(start.slice(0, 5))}</span>
      <button data-nav-jump="builder">Play</button>
      <em>${duration}s</em>
    </div>
  `;
}

function queueStreamerCell(streamer, index) {
  return `
    <div class="queue-streamer-cell">
      <span class="creator-avatar avatar-${index % 6}">${esc(initials(streamer?.displayName || "SC"))}</span>
      <div>
        <strong>${esc(streamer?.displayName || "Unknown")}</strong>
        <small>${esc(streamer?.category || streamer?.platform || (isPracticeStreamer(streamer) ? "Practice channel" : "Channel"))}</small>
      </div>
    </div>
  `;
}

function queuePlatformCell(platform) {
  const label = platform === "instagram_reels" ? "Instagram Reels" : platform === "youtube_shorts" ? "YouTube Shorts" : "TikTok";
  const icon = platform === "instagram_reels" ? "IG" : platform === "youtube_shorts" ? "YT" : "TT";
  return `
    <div class="queue-platform-cell">
      <span class="platform-icon">${esc(icon)}</span>
      <div>
        <strong>${esc(label)}</strong>
        <small>@streamclipper</small>
      </div>
    </div>
  `;
}

function queueScheduleCell(draft, index) {
  if (draft.scheduledFor) {
    return `<b>${esc(fmtDate(draft.scheduledFor))}</b><small>Draft schedule</small>`;
  }
  const date = new Date(draft.createdAt || Date.now());
  date.setHours(19 + (index % 3), index % 2 ? 30 : 0, 0, 0);
  return `<b>${esc(date.toLocaleDateString([], { month: "short", day: "numeric" }))}</b><small>${esc(date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</small>`;
}

function queueApprovalBadge(draft) {
  if (draft.approvalStatus === "approved") return `${badge("Approved", "good")}<small>Ready after manual handoff</small>`;
  if (draft.approvalStatus === "rejected") return `${badge("Blocked", "bad")}<small>Stopped by Human Gate</small>`;
  if (draft.approvalStatus === "send_back") return `${badge("Revise", "warn")}<small>Needs edits</small>`;
  return `${badge("Queued", "info")}<small>Approval required</small>`;
}

function renderPostCalendar(drafts) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = first.getDay();
  const buckets = new Map();
  drafts.forEach((draft, index) => {
    const base = new Date(draft.scheduledFor || draft.createdAt || Date.now());
    const day = Number.isFinite(base.getTime()) ? base.getDate() : ((index % daysInMonth) + 1);
    buckets.set(day, (buckets.get(day) || 0) + 1);
  });
  const cells = [];
  for (let i = 0; i < startOffset; i += 1) cells.push(`<span class="muted-day"></span>`);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const count = buckets.get(day) || 0;
    cells.push(`<span class="${count ? "has-posts" : ""} ${day === now.getDate() ? "today" : ""}">${day}${count ? `<em>${count}</em>` : ""}</span>`);
  }
  return `
    <div class="calendar-month">${esc(now.toLocaleDateString([], { month: "long", year: "numeric" }))}</div>
    <div class="calendar-weekdays">${["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((day) => `<b>${day}</b>`).join("")}</div>
    <div class="calendar-grid">${cells.join("")}</div>
    <div class="calendar-legend">
      <span><i class="info-dot"></i>Queued</span>
      <span><i class="good-dot"></i>Approved</span>
      <span><i class="bad-dot"></i>Limit locked</span>
    </div>
  `;
}

function queueSummaryLine(label, value, tone) {
  return `<div class="queue-summary-line ${tone}"><span>${esc(label)}</span><b>${value}</b></div>`;
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
  const real = realApprovals();
  const practice = state.approvals.filter(isPracticeApproval);
  const showingPractice = !real.length && practice.length;
  const approvals = showingPractice ? practice : real;
  const pending = approvals.filter((approval) => approval.status === "pending");
  const selected = selectedApproval(pending);
  const postApprovals = countWhere(pending, (approval) => approval.type === "posting_draft" || approval.type === "clip_package");
  const streamerAccess = countWhere(pending, (approval) => approval.type === "streamer_permission");
  const accountApi = countWhere(pending, (approval) => approval.type === "connector_setup" || approval.type === "account_api");
  const highRisk = countWhere(pending, (approval) => approval.riskLevel === "high");
  const mediumRisk = countWhere(pending, (approval) => approval.riskLevel === "medium");
  const lowRisk = countWhere(pending, (approval) => approval.riskLevel === "low");
  const recentDecisions = approvals.filter((approval) => approval.status !== "pending").slice(0, 4);
  view.innerHTML = `
    <section class="gate-page">
      ${showingPractice ? practiceNotice("Practice approvals are shown because no real Human Gate items exist. They are local review exercises only.", true) : practice.length ? practiceNotice(`${practice.length} practice approval item(s) are hidden from Real Mode counts.`, true) : ""}
      <div class="gate-metrics">
        ${gateMetric("Pending Decisions", pending.length, "Needs your review", "violet")}
        ${gateMetric("High Risk", highRisk, "Requires attention", "amber")}
        ${gateMetric("Posts Awaiting Approval", postApprovals, "Ready to review", "info")}
        ${gateMetric("Auto-Approved", 0, "Low-risk actions", "good")}
      </div>

      <div class="gate-shell">
        <section class="panel gate-board">
          <div class="gate-tabs">
            ${gateTab("All", pending.length, true)}
            ${gateTab("Posts", postApprovals)}
            ${gateTab("Streamer Access", streamerAccess)}
            ${gateTab("Account & API", accountApi)}
            ${gateTab("System Actions", 0)}
          </div>
          <div class="gate-filterbar">
            <input aria-label="Search approvals" placeholder="Search approvals..." readonly>
            <button data-action="refresh">Refresh</button>
            <select aria-label="Newest first">
              <option>Newest First</option>
              <option>Highest Risk</option>
              <option>Oldest First</option>
            </select>
          </div>
          <div class="gate-table-wrap">
            <table class="gate-table">
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Type</th>
                  <th>Risk</th>
                  <th>Requested by</th>
                  <th>Created</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${pending.length ? pending.map((approval, index) => renderGateRow(approval, index, selected?.id)).join("") : `<tr><td colspan="7">${empty("No pending approvals. Human Gate is clear.")}</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>

        <aside class="gate-side">
          <section class="panel gate-summary">
            <h2>Approval Queue Summary</h2>
            <div class="risk-donut" style="--high:${highRisk}; --medium:${mediumRisk}; --low:${lowRisk}; --total:${Math.max(1, pending.length)}">
              <b>${pending.length}</b>
              <small>Total Pending</small>
            </div>
            <div class="risk-list">
              ${riskLine("High Risk", highRisk, "high")}
              ${riskLine("Medium Risk", mediumRisk, "medium")}
              ${riskLine("Low Risk", lowRisk, "low")}
              ${riskLine("Info", Math.max(0, pending.length - highRisk - mediumRisk - lowRisk), "info")}
            </div>
            <div class="risk-breakdown">
              <span>Posting Content <b>${postApprovals}</b></span>
              <span>Streamer Access <b>${streamerAccess}</b></span>
              <span>Account & API <b>${accountApi}</b></span>
              <span>System Actions <b>0</b></span>
            </div>
          </section>

          <section class="panel gate-decisions">
            <h2>Recent Decisions</h2>
            ${recentDecisions.length ? recentDecisions.map(renderDecisionLine).join("") : empty("No decisions recorded yet")}
          </section>
        </aside>
      </div>

      ${selected ? renderApprovalDetail(selected) : ""}
    </section>
  `;
}

function selectedApproval(pending) {
  const selected = pending.find((approval) => approval.id === state.selectedApprovalId && approval.status === "pending");
  if (selected) return selected;
  const fallback = pending[0] || null;
  if (fallback) {
    state.selectedApprovalId = fallback.id;
    localStorage.setItem("selectedApprovalId", fallback.id);
  }
  return fallback;
}

function gateMetric(label, value, sublabel, tone) {
  return `
    <article class="panel gate-metric ${tone}">
      <span>${tone.slice(0, 2).toUpperCase()}</span>
      <strong>${value}</strong>
      <div>
        <b>${esc(label)}</b>
        <small>${esc(sublabel)}</small>
      </div>
    </article>
  `;
}

function gateTab(label, count, active = false) {
  return `<button class="${active ? "active" : ""}">${esc(label)} <b>${count}</b></button>`;
}

function approvalContext(approval) {
  if (!approval) return {};
  if (approval.type === "posting_draft") {
    const draft = state.drafts.find((item) => item.id === approval.linkedId) || approval.evidence?.draft;
    const candidate = draft ? draftCandidate(draft) : null;
    const streamer = state.streamers.find((item) => item.id === candidate?.streamerId);
    return { draft, candidate, streamer, platform: draft?.platform, title: candidate?.title || draft?.thumbnailText || approval.title };
  }
  if (approval.type === "clip_package") {
    const clipPackage = state.packages.find((item) => item.id === approval.linkedId);
    const candidate = state.candidates.find((item) => item.id === (clipPackage?.candidateId || approval.evidence?.candidateId));
    const streamer = state.streamers.find((item) => item.id === (candidate?.streamerId || approval.evidence?.streamerId));
    return { clipPackage, candidate, streamer, platform: "package", title: clipPackage?.packagePlan?.title || candidate?.title || approval.title };
  }
  if (approval.type === "streamer_permission") {
    const streamer = state.streamers.find((item) => item.id === approval.linkedId || item.id === approval.evidence?.streamerId);
    return { streamer, title: streamer?.displayName || approval.title, platform: streamer?.platform };
  }
  return { title: approval.title };
}

function approvalTypeLabel(type) {
  if (type === "posting_draft") return "Post Approval";
  if (type === "clip_package") return "Clip Package";
  if (type === "streamer_permission") return "Streamer Access";
  if (type === "connector_setup") return "Account & API";
  return type.replaceAll("_", " ");
}

function renderGateRow(approval, index, selectedId) {
  const context = approvalContext(approval);
  const score = Number(context.candidate?.score || 72 + ((index * 9) % 24));
  return `
    <tr class="${approval.id === selectedId ? "selected" : ""}">
      <td>
        <button class="gate-request-cell" data-select-approval="${approval.id}">
          ${queueThumb(context.draft || {}, context.candidate, index)}
          <span>
            <strong>${esc(context.title || approval.title)}</strong>
            <small>${esc(approval.type === "posting_draft" ? `Post to ${platformName(context.platform)}` : approval.title)}</small>
          </span>
        </button>
      </td>
      <td>${gateTypeCell(approval, context)}</td>
      <td>${riskBadge(approval.riskLevel)}</td>
      <td>${esc(context.streamer?.displayName || "Agent 101")}</td>
      <td>${timeAgo(approval.createdAt)}</td>
      <td>${badge("Pending", "warn")}<small>Waiting decision</small></td>
      <td>
        <div class="gate-row-actions">
          <button data-select-approval="${approval.id}">Review</button>
          <button data-gate-approve="${approval.id}">Approve</button>
        </div>
      </td>
    </tr>
  `;
}

function gateTypeCell(approval, context) {
  const icon = context.platform === "instagram_reels" ? "IG" : context.platform === "youtube_shorts" ? "YT" : context.platform === "tiktok" ? "TT" : approval.type === "streamer_permission" ? "TW" : "PK";
  return `
    <div class="gate-type-cell">
      <span>${esc(icon)}</span>
      <b>${esc(approvalTypeLabel(approval.type))}</b>
    </div>
  `;
}

function platformName(platform) {
  if (platform === "instagram_reels") return "Instagram Reels";
  if (platform === "youtube_shorts") return "YouTube Shorts";
  if (platform === "tiktok") return "TikTok";
  if (platform === "multi_platform") return "TikTok/Reels/Shorts";
  if (platform === "package") return "Posting Queue";
  return platform || "manual handoff";
}

function riskBadge(risk) {
  const normalized = risk || "medium";
  const tone = normalized === "high" ? "bad" : normalized === "low" ? "good" : "warn";
  return badge(normalized[0].toUpperCase() + normalized.slice(1), tone);
}

function riskLine(label, count, tone) {
  return `<span class="${tone}"><i></i>${esc(label)}<b>${count}</b></span>`;
}

function renderDecisionLine(approval) {
  const good = approval.status === "approved";
  return `
    <article>
      <span class="${good ? "good" : "bad"}">${good ? "✓" : "×"}</span>
      <div>
        <b>${esc(approval.status === "send_back" ? "Sent back" : approval.status)}</b>
        <small>${esc(approval.title)}</small>
      </div>
      <time>${timeAgo(approval.decidedAt || approval.createdAt)}</time>
    </article>
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

function renderApprovalDetail(approval) {
  const context = approvalContext(approval);
  const draft = context.draft;
  const candidate = context.candidate;
  const score = Number(candidate?.score || 86);
  const platform = platformName(context.platform || draft?.platform);
  return `
    <section class="panel gate-detail">
      <div class="gate-detail-head">
        <button data-nav-jump="gate">Back to Human Gate</button>
        <div>
          <h2>${esc(approval.type === "posting_draft" ? "Approve Post" : approvalTypeLabel(approval.type))}</h2>
          <p>${esc(approval.title)} · ${esc(approval.riskLevel || "medium")} risk</p>
        </div>
        ${riskBadge(approval.riskLevel)}
      </div>

      <div class="gate-detail-grid">
        <section class="gate-preview-card">
          <h3>Approval Preview</h3>
          ${renderPhonePreview(candidate || { title: context.title, duration: draft?.duration || 30 }, fallbackPackagePlan(candidate || { title: context.title }), "large")}
          <div class="preview-meta">
            <span><b>Resolution</b>1080x1920</span>
            <span><b>Duration</b>${candidate?.duration || 30}s</span>
            <span><b>Mode</b>Draft only</span>
          </div>
        </section>

        <section class="gate-detail-card">
          <h3>Request Details</h3>
          <div class="detail-kv">
            <span>Title / Hook</span><b>${esc(context.title || approval.title)}</b>
            <span>Platform</span><b>${esc(platform)}</b>
            <span>Created By</span><b>${esc(context.streamer?.displayName || "Agent 101")}</b>
            <span>Scheduled For</span><b>${esc(draft?.scheduledFor ? fmtDate(draft.scheduledFor) : "Manual handoff after approval")}</b>
            <span>Visibility</span><b>Blocked until approved</b>
          </div>
          <h3>Caption & Hashtags</h3>
          <p class="gate-caption">${esc(draft?.caption || candidate?.transcriptSnippet || "No caption draft attached yet.")}</p>
          <div class="hashtag-cloud">${(draft?.hashtags || ["#streamer", "#clips", "#gaming"]).slice(0, 8).map((tag) => `<span>${esc(tag)}</span>`).join("")}</div>
        </section>

        <section class="gate-analysis-card">
          <h3>AI Analysis</h3>
          ${scoreRing(score)}
          <div class="analysis-bars">
            ${analysisBar("Hook Strength", Math.min(100, score + 3))}
            ${analysisBar("Engagement Potential", Math.min(100, score + 1))}
            ${analysisBar("Brand Safety", approval.riskLevel === "high" ? 62 : 88)}
            ${analysisBar("Retention Potential", Math.min(100, score + 2))}
          </div>
          <p>Agent 101 says this can continue only as an approved draft/manual handoff. External posting remains locked.</p>
        </section>

        <section class="gate-risk-card">
          <h3>Risk Assessment</h3>
          ${riskItem("Content Type", approval.riskLevel === "high" ? "Medium" : "Low")}
          ${riskItem("Copyright Risk", "Review")}
          ${riskItem("Community Guidelines", approval.riskLevel === "high" ? "Review" : "Low")}
          ${riskItem("External Action", "Blocked")}
        </section>

        <section class="gate-approval-actions">
          <h3>Approval Actions</h3>
          <button class="primary" data-gate-approve="${approval.id}">Approve & Add to Queue</button>
          <button data-gate-sendback="${approval.id}">Send Back for Changes</button>
          <button class="danger" data-gate-reject="${approval.id}">Reject</button>
          <textarea readonly>Add note about this decision...</textarea>
        </section>
      </div>

      <div class="gate-timeline">
        ${timelineStep("Package created", true)}
        ${timelineStep("AI analysis completed", true)}
        ${timelineStep("Submitted for approval", true)}
        ${timelineStep("Operator decision", false)}
      </div>
    </section>
  `;
}

function analysisBar(label, value) {
  return `<span><b>${esc(label)}</b><i><em style="width:${value}%"></em></i><small>${value}/100</small></span>`;
}

function riskItem(label, value) {
  const tone = value === "Low" ? "good" : value === "Blocked" ? "bad" : "warn";
  return `<span><b>${esc(label)}</b>${badge(value, tone)}</span>`;
}

function timelineStep(label, done) {
  return `<span class="${done ? "done" : ""}"><i>${done ? "✓" : "·"}</i>${esc(label)}</span>`;
}

function renderOutputs() {
  const allOutputs = buildOutputRows();
  const realOutputs = allOutputs.filter((output) => !output.practice);
  const practiceOutputs = allOutputs.filter((output) => output.practice);
  const showingPractice = !realOutputs.length && practiceOutputs.length;
  const outputs = showingPractice ? practiceOutputs : realOutputs;
  const counts = outputCounts(outputs);
  const recent = outputs.slice(0, 4);
  const total = outputs.length;
  const storagePct = Math.min(100, Math.max(0, Math.round((outputs.length / Math.max(1, allOutputs.length || outputs.length || 1)) * 100)));
  view.innerHTML = `
    <div class="outputs-page">
      <section class="outputs-main">
        ${showingPractice ? practiceNotice("Practice outputs are shown because no real outputs exist yet. They are local draft artifacts only.", true) : practiceOutputs.length ? practiceNotice(`${practiceOutputs.length} practice output(s) are hidden from Real Mode counts.`, true) : ""}
        <div class="output-tabs">
          ${outputTab("All Outputs", total, "all", true)}
          ${outputTab("Clip Packages", counts.clipPackage, "clip_package")}
          ${outputTab("Videos", counts.video, "video")}
          ${outputTab("Captions", counts.captions, "captions")}
          ${outputTab("CapCut Briefs", counts.capcutBrief, "capcut")}
          ${outputTab("Post Drafts", counts.postDraft, "draft")}
          ${outputTab("Thumbnails", counts.thumbnail, "thumbnail")}
        </div>

        <div class="outputs-filterbar">
          <input placeholder="Search outputs..." aria-label="Search outputs">
          <select aria-label="Streamer filter"><option>All Streamers</option></select>
          <select aria-label="Type filter"><option>All Types</option></select>
          <select aria-label="Status filter"><option>All Status</option></select>
          <button type="button" ${disabledAttr(true, "Date filtering is not wired yet")}>Date Range</button>
          <select aria-label="Sort outputs"><option>Sort: Newest</option></select>
          <button type="button" aria-label="Grid view" ${disabledAttr(true, "Grid view is not wired yet")}>▦</button>
          <button type="button" aria-label="List view" ${disabledAttr(true, "List view is the current view")}>☰</button>
        </div>

        <div class="outputs-table-wrap">
          ${outputs.length ? renderOutputsTable(outputs.slice(0, 10)) : empty("No exported outputs yet")}
        </div>

        <div class="outputs-footer">
          <span>${total ? `Showing 1 to ${Math.min(10, total)} of ${total} outputs` : "No outputs to show"}</span>
          <div class="outputs-pages"><b>1</b><span>2</span><span>3</span><em>...</em><span>${Math.max(1, Math.ceil(total / 10))}</span><button type="button">›</button></div>
          <label>Show <select><option>10</option><option>25</option></select> per page</label>
        </div>
      </section>

      <aside class="outputs-side">
        <section class="outputs-card output-overview-card">
          <h2>Outputs Overview</h2>
          <div class="outputs-donut" style="--clip:${percent(counts.clipPackage, total)}; --video:${percent(counts.video, total)}; --captions:${percent(counts.captions, total)}; --capcut:${percent(counts.capcutBrief, total)}; --draft:${percent(counts.postDraft, total)}">
            <b>${total}</b>
            <small>Total Outputs</small>
          </div>
          <div class="output-legend">
            ${outputLegend("Clip Packages", counts.clipPackage, "purple")}
            ${outputLegend("Videos", counts.video, "blue")}
            ${outputLegend("Captions", counts.captions, "green")}
            ${outputLegend("CapCut Briefs", counts.capcutBrief, "amber")}
            ${outputLegend("Post Drafts", counts.postDraft, "red")}
            ${outputLegend("Thumbnails", counts.thumbnail, "slate")}
          </div>
        </section>

        <section class="outputs-card storage-card">
          <h2>Storage Usage</h2>
          <div><span>${storagePct}% visible</span><span>${outputs.length} visible artifact rows</span></div>
          <i><em style="width:${storagePct}%"></em></i>
          <button type="button" ${disabledAttr(true, "Storage manager is not wired yet")}>Manage Storage</button>
        </section>

        <section class="outputs-card">
          <h2>Quick Actions</h2>
          <div class="output-actions">
            <button type="button" ${disabledAttr(true, "Bulk export endpoint is not wired yet")}>Export Multiple <span>›</span></button>
            <button type="button" ${disabledAttr(true, "Report generation endpoint is not wired yet")}>Generate Report <span>›</span></button>
            <button type="button" ${disabledAttr(true, "Storage cleanup requires a persisted storage policy first")}>Clean Up Old Files <span>›</span></button>
          </div>
        </section>

        <section class="outputs-card">
          <h2>Recent Exports</h2>
          <div class="recent-exports">
            ${recent.map(renderRecentExport).join("") || empty("No recent exports")}
          </div>
          <button class="ghost" type="button" ${disabledAttr(true, "Export archive view is not wired yet")}>View all exports →</button>
        </section>
      </aside>
    </div>
  `;
}

function buildOutputRows() {
  const rows = [];
  state.packages.forEach((clipPackage, index) => {
    const candidate = state.candidates.find((item) => item.id === clipPackage.candidateId);
    const streamer = state.streamers.find((item) => item.id === candidate?.streamerId);
    rows.push({
      id: clipPackage.id,
      title: clipPackage.packagePlan?.title || candidate?.title || "Clip package",
      subtitle: clipPackage.packagePlan?.hook || candidate?.transcriptSnippet || "9:16 package ready for review.",
      type: "Clip Package",
      typeKey: "clip_package",
      badge: `${clipPackage.format || "9:16"} Vertical`,
      status: clipPackage.approvalStatus === "approved" ? "Completed" : "Pending Review",
      statusTone: clipPackage.approvalStatus === "approved" ? "good" : "warn",
      createdAt: clipPackage.createdAt,
      size: `${clipPackage.artifacts?.length || 0} files`,
      streamer,
      candidate,
      icon: "PKG",
      thumbClass: `thumb-${index % 5}`,
      url: clipPackage.artifacts?.[0]?.url || "",
      practice: isPracticePackage(clipPackage)
    });
  });

  state.drafts.forEach((draft, index) => {
    const clipPackage = draftPackage(draft);
    const candidate = draftCandidate(draft);
    const streamer = state.streamers.find((item) => item.id === candidate?.streamerId);
    rows.push({
      id: draft.id,
      title: draft.thumbnailText || candidate?.title || "Post draft",
      subtitle: draft.caption || "Caption, hashtags, and posting package.",
      type: "Post Draft",
      typeKey: "post_draft",
      badge: platformName(draft.platform),
      status: draft.approvalStatus === "approved" ? "Completed" : draft.approvalStatus === "pending" ? "Queued" : "Draft",
      statusTone: draft.approvalStatus === "approved" ? "good" : draft.approvalStatus === "pending" ? "warn" : "info",
      createdAt: draft.createdAt,
      size: "Draft",
      streamer,
      candidate,
      icon: "TXT",
      thumbClass: `thumb-${(index + 2) % 5}`,
      url: clipPackage?.artifacts?.[0]?.url || "",
      practice: isPracticeDraft(draft)
    });
  });

  state.artifacts.forEach((artifact, index) => {
    const linkedPackage = state.packages.find((item) => (item.artifacts || []).some((entry) => entry.id === artifact.id));
    const candidate = state.candidates.find((item) => item.id === linkedPackage?.candidateId);
    const streamer = state.streamers.find((item) => item.id === candidate?.streamerId);
    const meta = artifactMeta(artifact);
    rows.push({
      id: artifact.id,
      title: meta.title,
      subtitle: meta.subtitle,
      type: meta.type,
      typeKey: artifact.kind,
      badge: meta.badge,
      status: "Completed",
      statusTone: "good",
      createdAt: artifact.createdAt,
      size: artifact.size ? formatBytes(artifact.size) : meta.size,
      streamer,
      candidate,
      icon: meta.icon,
      thumbClass: meta.thumb ? `thumb-${index % 5}` : "",
      url: artifact.url,
      practice: isPracticeArtifact(artifact)
    });
  });

  return rows.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function outputCounts(rows) {
  return {
    clipPackage: countWhere(rows, (row) => row.typeKey === "clip_package"),
    video: countWhere(rows, (row) => row.typeKey === "video_export"),
    captions: countWhere(rows, (row) => row.typeKey === "captions"),
    capcutBrief: countWhere(rows, (row) => row.typeKey === "capcut_brief"),
    postDraft: countWhere(rows, (row) => row.typeKey === "post_draft"),
    thumbnail: countWhere(rows, (row) => row.typeKey === "thumbnail")
  };
}

function renderOutputsTable(outputs) {
  return `
    <table class="outputs-table">
      <thead>
        <tr>
          <th>Output</th>
          <th>Streamer</th>
          <th>Type</th>
          <th>Status</th>
          <th>Created</th>
          <th>Size</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${outputs.map((output, index) => renderOutputRow(output, index)).join("")}
      </tbody>
    </table>
  `;
}

function renderOutputRow(output, index) {
  return `
    <tr>
      <td>
        <div class="output-name-cell">
          ${output.thumbClass ? `<div class="output-thumb ${output.thumbClass}"><span>${esc(output.candidate?.timestampStart?.slice(0, 5) || "00:30")}</span><b>${esc(output.icon)}</b></div>` : `<div class="output-file-icon ${outputTypeClass(output.typeKey)}">${esc(output.icon)}</div>`}
          <div>
            <strong>${esc(output.title)}</strong>
            <p>${esc(output.subtitle)}</p>
            ${output.badge ? `<em>${esc(output.badge)}</em>` : ""}
            ${output.practice ? `<em class="practice-mark">PRACTICE</em>` : ""}
          </div>
        </div>
      </td>
      <td>${queueStreamerCell(output.streamer, index)}</td>
      <td><span class="output-type ${outputTypeClass(output.typeKey)}">${esc(output.type)}</span></td>
      <td><span class="output-status ${output.statusTone}">${esc(output.status)}</span><small>${output.statusTone === "warn" ? "Needs review" : output.statusTone === "info" ? "Editing in progress" : "Ready to use"}</small></td>
      <td>${fmtDate(output.createdAt)}</td>
      <td>${esc(output.size || "Stored")}</td>
      <td>
        <div class="output-row-actions">
          ${output.url ? `<a href="${esc(appUrl(output.url))}" download title="Download">↓</a>` : `<button type="button" title="Download disabled" disabled>↓</button>`}
          <button type="button" data-nav-jump="builder" title="Open in builder">↗</button>
          <button type="button" ${disabledAttr(true, "More output actions are not wired yet")}>...</button>
        </div>
      </td>
    </tr>
  `;
}

function artifactMeta(artifact) {
  const ext = artifact.filename?.split(".").pop()?.toUpperCase() || "FILE";
  const clean = cleanOutputTitle(artifact.filename || "Artifact");
  if (artifact.kind === "captions") return { type: "Captions", title: clean, subtitle: "Auto-generated caption file.", badge: ext, icon: ext, size: "Caption file" };
  if (artifact.kind === "capcut_brief") return { type: "CapCut Brief", title: clean, subtitle: "Editing instructions and timeline handoff.", badge: ext, icon: ext, size: "Brief" };
  if (artifact.kind === "clip_package") return { type: "Clip Package", title: clean, subtitle: "Structured package JSON with hook, cuts, captions, and approval checklist.", badge: ext, icon: "JSON", size: "Package" };
  if (artifact.kind === "thumbnail") return { type: "Thumbnail", title: clean, subtitle: "Thumbnail preview image.", badge: ext, icon: ext, size: "Image", thumb: true };
  if (artifact.kind === "video_export") return { type: "Video Export", title: clean, subtitle: "Rendered video export.", badge: ext, icon: ext, size: "Video", thumb: true };
  return { type: artifact.kind || "Artifact", title: clean, subtitle: "Stored generated output.", badge: ext, icon: ext, size: "Stored" };
}

function cleanOutputTitle(filename) {
  return String(filename || "Output")
    .replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-/, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function outputTab(label, count, icon, active = false) {
  return `
    <button class="${active ? "active" : ""}" type="button">
      <span class="output-tab-icon ${esc(icon)}">${esc(iconLabel(icon))}</span>
      <em>${esc(label)}</em>
      <b>${esc(count)}</b>
    </button>
  `;
}

function iconLabel(icon) {
  return {
    all: "ALL",
    clip_package: "PKG",
    video: "VID",
    captions: "CC",
    capcut: "CC",
    draft: "DR",
    thumbnail: "IMG"
  }[icon] || "OUT";
}

function outputLegend(label, value, tone) {
  return `<span><i class="${esc(tone)}"></i><em>${esc(label)}</em><b>${esc(value)}</b></span>`;
}

function renderRecentExport(output) {
  const inner = `
    <span class="${outputTypeClass(output.typeKey)}">${esc(output.icon)}</span>
    <div>
      <strong>${esc(output.title)}</strong>
      <small>${timeAgo(output.createdAt)} · ${esc(output.size || "Stored")}</small>
    </div>
    <b>✓</b>
  `;
  if (!output.url) return `<article class="recent-export disabled" title="No downloadable file is attached yet">${inner}</article>`;
  return `
    <a class="recent-export" href="${esc(appUrl(output.url))}" download>
      ${inner}
    </a>
  `;
}

function percent(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function renderAnalytics() {
  const stats = analyticsStats();
  const topStreamers = analyticsStreamerRows().slice(0, 6);
  const realApprovalTotal = realApprovals().length;
  const queuePressure = realApprovalTotal ? percent(stats.pendingApprovals, realApprovalTotal) : 0;
  const approvalAccuracy = percent(stats.approvedDecisions, Math.max(1, stats.decidedApprovals));
  view.innerHTML = `
    <section class="analytics-page">
      ${hasPracticeData() ? practiceNotice("Practice rows are excluded from these Real Mode analytics. Use the Dashboard practice banner to clear them.", true) : ""}
      <div class="analytics-tabs">
        <button class="active">Overview</button>
        <button type="button" ${disabledAttr(true, "Detailed analytics tabs are not wired yet")}>Agent 101</button>
        <button type="button" ${disabledAttr(true, "Detailed analytics tabs are not wired yet")}>Streamers</button>
        <button type="button" ${disabledAttr(true, "Detailed analytics tabs are not wired yet")}>Human Gate</button>
        <button type="button" ${disabledAttr(true, "Detailed analytics tabs are not wired yet")}>System</button>
        <button type="button" ${disabledAttr(true, "Custom analytics ranges are not wired yet")}>Custom</button>
      </div>
      <button class="analytics-export" type="button" ${disabledAttr(true, "Report export needs a persisted report endpoint first")}>Export Report</button>

      <div class="analytics-metrics">
        ${analyticsMetric("Agent workload", stats.agentWorkload, `${stats.pendingApprovals} decisions waiting`, "AG", queuePressure > 50 ? "warn" : "good")}
        ${analyticsMetric("Streamers watched", stats.monitoredStreamers, `${stats.approvedStreamers} approved`, "ST", "info")}
        ${analyticsMetric("Agent-created outputs", stats.agentOutputs, `${stats.artifacts} artifacts stored`, "OUT", "violet")}
        ${analyticsMetric("Approval accuracy", `${approvalAccuracy}%`, `${stats.blockedApprovals} blocked / sent back`, "OK", approvalAccuracy >= 80 ? "good" : "warn")}
        ${analyticsMetric("Streamer signal quality", `${stats.averageCandidateScore}/100`, `${stats.highScoreCandidates} high-signal moments`, "QS", stats.averageCandidateScore >= 70 ? "good" : "info")}
        ${analyticsMetric("Safety gate load", `${queuePressure}%`, `${stats.pendingApprovals} of ${state.approvals.length} approvals open`, "HG", queuePressure > 45 ? "warn" : "good")}
      </div>

      <div class="analytics-grid-primary">
        <section class="panel analytics-wide">
          <div class="toolbar">
            <div>
              <h2>Agent 101 Performance Over Time</h2>
              <p class="muted">Work created, approvals received, and streamer checks from real local activity.</p>
            </div>
            <select aria-label="Analytics range"><option>7D</option><option>30D</option></select>
          </div>
          ${renderAgentTimeline()}
        </section>
        <section class="panel analytics-donut-card">
          <h2>Agent Work Mix</h2>
          ${renderAnalyticsDonut([
            ["Tasks", realDrafts().length, "#38bdf8"],
            ["Approvals", realApprovalTotal, "#a855f7"],
            ["Outputs", realArtifacts().length, "#22c55e"],
            ["Logs", Math.min(state.logs.length, 250), "#f59e0b"]
          ], "Agent Work")}
        </section>
        <section class="panel analytics-time-card">
          <h2>Operator Time Saved</h2>
          <strong>${stats.savedHours}h ${stats.savedMinutes}m</strong>
          <p class="muted">Estimated from draft packages, generated files, and monitored stream checks.</p>
          ${analyticsMiniChart("time", [32, 38, 45, 40, 52, 56, 61, 58, 67, 72, 69, 78])}
        </section>
      </div>

      <div class="analytics-grid-secondary">
        <section class="panel top-streamers-card">
          <div class="toolbar">
            <h2>Top Streamers For Agent 101</h2>
            <button data-nav-jump="watchlist">View streamers</button>
          </div>
          ${renderAnalyticsStreamerTable(topStreamers)}
        </section>
        <section class="panel decision-card">
          <h2>Human Gate Decisions</h2>
          ${renderAnalyticsDonut([
            ["Pending", stats.pendingApprovals, "#a855f7"],
            ["Approved", stats.approvedApprovals, "#22c55e"],
            ["Blocked", stats.blockedApprovals, "#ef4444"],
            ["Other", Math.max(0, realApprovalTotal - stats.pendingApprovals - stats.approvedApprovals - stats.blockedApprovals), "#64748b"]
          ], "Decisions")}
        </section>
        <section class="panel quality-card">
          <h2>Agent And Streamer Quality</h2>
          <div class="quality-ring" style="--score:${stats.averageCandidateScore}">
            <strong>${stats.averageCandidateScore}</strong>
            <span>/100</span>
          </div>
          <div class="quality-bars">
            ${qualityBar("Streamer permission coverage", percent(stats.approvedStreamers, realStreamers().length))}
            ${qualityBar("Monitoring coverage", percent(stats.monitoredStreamers, realStreamers().length))}
            ${qualityBar("High-signal candidate rate", percent(stats.highScoreCandidates, realCandidates().length))}
            ${qualityBar("Approval completion", percent(stats.decidedApprovals, realApprovalTotal))}
          </div>
        </section>
      </div>

      <div class="analytics-grid-tertiary">
        <section class="panel system-health-card">
          <h2>Agent System Health</h2>
          <div class="analytics-health-grid">
            ${healthTile("Provider", state.openai?.configured ? "OpenAI live" : "Local fallback", state.openai?.configured ? "good" : "warn")}
            ${healthTile("Stream API", state.twitch?.configured || state.kick?.configured ? streamApiStatusLabel() : "API needed", state.twitch?.configured || state.kick?.configured ? "good" : "warn")}
            ${healthTile("Queue health", stats.pendingApprovals ? "Review needed" : "Clear", stats.pendingApprovals ? "warn" : "good")}
            ${healthTile("Agent safety", "Approval gated", "good")}
          </div>
        </section>
        <section class="panel feature-card">
          <h2>Agent Capability Usage</h2>
          ${usageBar("Stream monitoring", percent(stats.monitoredStreamers, Math.max(1, realStreamers().length)))}
          ${usageBar("Clip scoring", percent(realCandidates().length, Math.max(1, realCandidates().length + 20)))}
          ${usageBar("Approval packaging", percent(realApprovalTotal, Math.max(1, realApprovalTotal + 15)))}
          ${usageBar("Output generation", percent(realArtifacts().length, Math.max(1, realArtifacts().length + 25)))}
        </section>
        <section class="panel insight-card">
          <h2>Insights</h2>
          ${analyticsInsight("Agent 101 is busiest at Human Gate", `${stats.pendingApprovals} items need a decision before external posting can move.`)}
          ${analyticsInsight("Streamer data is the main signal source", `${stats.monitoredStreamers} monitored streamers are feeding the agent's candidate radar.`)}
          ${analyticsInsight("Safety is holding correctly", "Publishing and account changes remain blocked until an operator approves them.")}
        </section>
      </div>
    </section>
  `;
}

function analyticsStats() {
  const streamers = realStreamers();
  const candidates = realCandidates();
  const packages = realPackages();
  const drafts = realDrafts();
  const approvals = realApprovals();
  const artifacts = realArtifacts();
  const monitoredStreamers = countWhere(streamers, (streamer) => streamer.monitorEnabled);
  const approvedStreamers = countWhere(streamers, (streamer) => streamer.permissionStatus === "approved");
  const pendingApprovals = countWhere(approvals, (approval) => approval.status === "pending");
  const approvedApprovals = countWhere(approvals, (approval) => approval.status === "approved");
  const blockedApprovals = countWhere(approvals, (approval) => ["blocked", "rejected", "sent_back"].includes(approval.status));
  const decidedApprovals = approvals.length - pendingApprovals;
  const scores = candidates.map((candidate) => Number(candidate.score || 0)).filter(Boolean);
  const averageCandidateScore = scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0;
  const highScoreCandidates = countWhere(candidates, (candidate) => Number(candidate.score || 0) >= 70);
  const agentWorkload = drafts.length + approvals.length + packages.length;
  const agentOutputs = packages.length + artifacts.length;
  const savedMinutesTotal = Math.max(0, packages.length * 18 + artifacts.length * 6 + monitoredStreamers * 4);
  return {
    monitoredStreamers,
    approvedStreamers,
    pendingApprovals,
    approvedApprovals,
    blockedApprovals,
    decidedApprovals,
    approvedDecisions: approvedApprovals,
    averageCandidateScore,
    highScoreCandidates,
    agentWorkload,
    agentOutputs,
    artifacts: artifacts.length,
    savedHours: Math.floor(savedMinutesTotal / 60),
    savedMinutes: savedMinutesTotal % 60
  };
}

function analyticsMetric(label, value, detail, icon, tone = "info") {
  return `
    <section class="panel analytics-metric analytics-metric-${esc(tone)}">
      <span>${esc(icon)}</span>
      <div>
        <em>${esc(label)}</em>
        <strong>${esc(value)}</strong>
        <small>${esc(detail)}</small>
      </div>
    </section>
  `;
}

function analyticsStreamerRows() {
  const candidates = realCandidates();
  const approvals = realApprovals();
  return realStreamers()
    .map((streamer, index) => {
      const streamerCandidates = candidates.filter((candidate) => candidate.streamerId === streamer.id);
      const streamerApprovals = approvals.filter((approval) => approval.evidence?.streamerId === streamer.id);
      const avgScore = streamerCandidates.length
        ? Math.round(streamerCandidates.reduce((sum, candidate) => sum + Number(candidate.score || 0), 0) / streamerCandidates.length)
        : 0;
      return {
        streamer,
        index,
        candidates: streamerCandidates.length,
        avgScore,
        approvals: streamerApprovals.length,
        approved: isPermissionReady(streamer),
        monitored: streamer.monitorEnabled,
        lastCheckedAt: streamer.lastCheckedAt
      };
    })
    .sort((a, b) => (b.avgScore + b.candidates * 2 + b.approvals) - (a.avgScore + a.candidates * 2 + a.approvals));
}

function renderAnalyticsStreamerTable(rows) {
  if (!rows.length) return empty("No streamer analytics yet");
  return `
    <table class="analytics-streamer-table">
      <thead>
        <tr>
          <th>Streamer</th>
          <th>Agent signal</th>
          <th>Permission</th>
          <th>Checks</th>
          <th>Quality</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${queueStreamerCell(row.streamer, row.index)}</td>
            <td><strong>${esc(row.candidates)}</strong><small>candidate signals</small></td>
            <td>${badge(row.approved ? "Approved" : "Needs review", row.approved ? "good" : "warn")}</td>
            <td><strong>${esc(row.lastCheckedAt ? timeAgo(row.lastCheckedAt) : "Never")}</strong><small>${row.monitored ? "Monitoring" : "Paused"}</small></td>
            <td><span class="signal-bar"><i style="width:${Math.min(100, row.avgScore)}%"></i></span><b>${esc(row.avgScore || 0)}</b></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderAgentTimeline() {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const key = date.toISOString().slice(0, 10);
    return {
      label: date.toLocaleDateString([], { month: "short", day: "numeric" }),
      drafts: countWhere(state.drafts, (item) => (item.createdAt || "").slice(0, 10) === key),
      approvals: countWhere(state.approvals, (item) => (item.createdAt || "").slice(0, 10) === key),
      logs: countWhere(state.logs, (item) => (item.createdAt || "").slice(0, 10) === key)
    };
  });
  const max = Math.max(1, ...days.flatMap((day) => [day.drafts, day.approvals, Math.round(day.logs / 4)]));
  const path = (key, yBase) => days.map((day, index) => {
    const value = key === "logs" ? Math.round(day.logs / 4) : day[key];
    const x = Math.round((index / (days.length - 1)) * 100);
    const y = Math.round(yBase - (value / max) * 54);
    return `${x},${y}`;
  }).join(" ");
  return `
    <div class="agent-timeline">
      <svg viewBox="0 0 100 80" preserveAspectRatio="none" aria-hidden="true">
        <polyline points="${path("approvals", 66)}" fill="none" stroke="#a855f7" stroke-width="2.2" vector-effect="non-scaling-stroke"></polyline>
        <polyline points="${path("drafts", 66)}" fill="none" stroke="#38bdf8" stroke-width="2.2" vector-effect="non-scaling-stroke"></polyline>
        <polyline points="${path("logs", 66)}" fill="none" stroke="#22c55e" stroke-width="2.2" vector-effect="non-scaling-stroke"></polyline>
      </svg>
      <div class="timeline-legend"><span><i class="cyan"></i>Drafts</span><span><i class="violet"></i>Approvals</span><span><i class="green"></i>Agent events</span></div>
      <div class="timeline-days">${days.map((day) => `<span>${esc(day.label)}</span>`).join("")}</div>
    </div>
  `;
}

function renderAnalyticsDonut(items, centerLabel) {
  const total = Math.max(1, items.reduce((sum, item) => sum + item[1], 0));
  let running = 0;
  const stops = items.map(([label, value, color]) => {
    const start = running;
    running += percent(value, total);
    return `${color} ${start}% ${Math.min(100, running)}%`;
  }).join(", ");
  return `
    <div class="analytics-donut-wrap">
      <div class="analytics-donut" style="background: radial-gradient(circle, #06101b 0 52%, transparent 53%), conic-gradient(${esc(stops)});">
        <strong>${items.reduce((sum, item) => sum + item[1], 0)}</strong>
        <span>${esc(centerLabel)}</span>
      </div>
      <div class="analytics-legend">
        ${items.map(([label, value, color]) => `<span><i style="background:${esc(color)}"></i><b>${esc(label)}</b><em>${esc(value)}</em></span>`).join("")}
      </div>
    </div>
  `;
}

function analyticsMiniChart(id, values) {
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => `${Math.round((index / (values.length - 1)) * 100)},${Math.round(50 - (value / max) * 42)}`).join(" ");
  return `
    <svg class="analytics-mini-chart" viewBox="0 0 100 54" preserveAspectRatio="none" aria-labelledby="${esc(id)}">
      <polyline points="${points}" fill="none" stroke="#a855f7" stroke-width="2.2" vector-effect="non-scaling-stroke"></polyline>
    </svg>
  `;
}

function qualityBar(label, value) {
  return `<span><b>${esc(label)}</b><i><em style="width:${Math.min(100, Math.max(0, value))}%"></em></i><strong>${esc(value)}%</strong></span>`;
}

function healthTile(label, value, tone) {
  return `<span class="analytics-health ${esc(tone)}"><b>${esc(label)}</b><strong>${esc(value)}</strong></span>`;
}

function usageBar(label, value) {
  return `<span class="usage-row"><b>${esc(label)}</b><i><em style="width:${Math.min(100, Math.max(0, value))}%"></em></i><strong>${esc(value)}%</strong></span>`;
}

function analyticsInsight(title, body) {
  return `<article><span>AI</span><div><strong>${esc(title)}</strong><p>${esc(body)}</p></div></article>`;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "Stored";
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function outputTypeClass(type) {
  if (type === "captions") return "captions";
  if (type === "capcut_brief") return "capcut";
  if (type === "post_draft") return "draft";
  if (type === "thumbnail") return "thumbnail";
  if (type === "video_export") return "video";
  return "package";
}

function renderLogs() {
  const rows = buildLogRows();
  const stats = logStats(rows);
  const total = rows.length;
  view.innerHTML = `
    <div class="logs-page">
      <section class="logs-main">
        <div class="logs-metrics">
          ${logMetric("All Events", total, `${Math.max(0, Math.round((stats.success / Math.max(1, total)) * 100))}% successful`, "all", "violet")}
          ${logMetric("Info", stats.info, `${percent(stats.info, total)}%`, "info", "info")}
          ${logMetric("Success", stats.success, `${percent(stats.success, total)}%`, "success", "good")}
          ${logMetric("Warning", stats.warning, `${percent(stats.warning, total)}%`, "warning", "warn")}
          ${logMetric("Error", stats.error, `${percent(stats.error, total)}%`, "error", "bad")}
          ${logMetric("Critical", stats.critical, `${percent(stats.critical, total)}%`, "critical", "critical")}
        </div>

        <div class="logs-filterbar">
          <label class="logs-search">Search logs <input placeholder="Search logs, events, or details..." aria-label="Search logs"></label>
          <select aria-label="Log type filter"><option>All Types</option><option>Info</option><option>Success</option><option>Warning</option><option>Error</option></select>
          <select aria-label="Module filter"><option>All Modules</option><option>Stream Watchlist</option><option>Clip Radar</option><option>Clip Builder</option><option>Posting Queue</option><option>Human Gate</option></select>
          <select aria-label="Streamer filter"><option>All Streamers</option></select>
          <select aria-label="Status filter"><option>All Status</option><option>Resolved</option><option>Needs review</option></select>
          <button type="button">${esc(logDateRange(rows))}</button>
          <button type="button">Export</button>
        </div>

        <section class="panel logs-table-panel">
          ${rows.length ? renderLogsTable(rows.slice(0, 10)) : empty("No log entries")}
        </section>

        <div class="logs-footer">
          <span>Showing 1 to ${Math.min(10, total)} of ${total} logs</span>
          <div class="logs-pages"><b>1</b><span>2</span><span>3</span><em>...</em><span>${Math.max(1, Math.ceil(total / 10))}</span><button type="button">›</button></div>
          <label>Show <select><option>10</option><option>25</option></select> per page</label>
        </div>
      </section>

      <aside class="logs-side">
        <section class="outputs-card logs-level-card">
          <h2>Logs by Level</h2>
          <div class="logs-donut" style="--info-end:${percent(stats.info, total)}; --success-end:${percent(stats.info + stats.success, total)}; --warning-end:${percent(stats.info + stats.success + stats.warning, total)}; --error-end:${percent(stats.info + stats.success + stats.warning + stats.error, total)}">
            <b>${total}</b>
            <small>Total Logs</small>
          </div>
          <div class="output-legend">
            ${outputLegend("Info", stats.info, "blue")}
            ${outputLegend("Success", stats.success, "green")}
            ${outputLegend("Warning", stats.warning, "amber")}
            ${outputLegend("Error", stats.error, "red")}
            ${outputLegend("Critical", stats.critical, "purple")}
          </div>
        </section>

        <section class="outputs-card logs-chart-card">
          <div class="toolbar">
            <h2>Activity Timeline</h2>
            <select aria-label="Activity timeline range"><option>Events</option><option>Warnings</option><option>Errors</option></select>
          </div>
          ${renderLogTimeline(rows)}
        </section>

        <section class="outputs-card logs-filter-card">
          <div class="toolbar">
            <h2>Log Filters</h2>
            <button class="ghost" type="button">Clear All</button>
          </div>
          <label>Search <input placeholder="Search logs..."></label>
          <label>Type <select><option>All Types</option><option>Info</option><option>Success</option><option>Warning</option><option>Error</option></select></label>
          <label>Module <select><option>All Modules</option><option>Clip Builder</option><option>Human Gate</option><option>System</option></select></label>
          <label>Status <select><option>All Status</option><option>Resolved</option><option>Needs review</option></select></label>
          <label>Date Range <input value="${esc(logDateRange(rows))}" readonly></label>
          <button class="primary" type="button">Apply Filters</button>
        </section>
      </aside>
    </div>
  `;
}

function renderIntegrations() {
  const openaiReady = Boolean(state.openai?.configured);
  const twitchReady = Boolean(state.twitch?.configured);
  const kickReady = Boolean(state.kick?.configured);
  const connectors = [
    {
      name: "OpenAI",
      label: openaiReady ? "Live API" : "Local fallback",
      tone: openaiReady ? "good" : "warn",
      body: openaiReady
        ? `Server can use ${state.openai?.model || state.config?.openaiModel || "the configured model"} without exposing keys to the browser.`
        : "OpenAI key is not active here. StreamClipper stays usable through local/demo planning.",
      action: "test-openai",
      actionLabel: "Test OpenAI"
    },
    {
      name: "Twitch",
      label: twitchReady ? "Official API ready" : "API needed",
      tone: twitchReady ? "good" : "warn",
      body: twitchReady
        ? "Streamer live checks can use the official Twitch API from the server."
        : "Add Twitch Client ID and Client Secret or OAuth token in environment variables for real live checks.",
      action: "test-twitch",
      actionLabel: "Test Twitch"
    },
    {
      name: "Kick",
      label: kickReady ? "Official API ready" : "API needed",
      tone: kickReady ? "good" : "warn",
      body: kickReady
        ? "Kick live checks can use the official Kick public API from the server."
        : "Add Kick Client ID and Client Secret in environment variables for real Kick live checks.",
      action: "test-kick",
      actionLabel: "Test Kick"
    },
    {
      name: "Browser handoff",
      label: "Manual",
      tone: "info",
      body: "Agent 101 can prepare instructions and checklists. Login, account setup, and keys stay operator-controlled.",
      jump: "watchlist",
      actionLabel: "Streamer setup"
    },
    {
      name: "CapCut",
      label: "Manual handoff",
      tone: "info",
      body: "StreamClipper creates edit briefs, captions, cut lists, and export settings for you to run in CapCut.",
      jump: "builder",
      actionLabel: "Open builder"
    },
    {
      name: "TikTok / YouTube",
      label: "Human Gate",
      tone: "warn",
      body: "Posting packages can be drafted, but publishing remains blocked until you approve it.",
      jump: "gate",
      actionLabel: "Review gate"
    },
    {
      name: "Local storage",
      label: "Ready",
      tone: "good",
      body: `Outputs are written server-side. Current output folder: ${state.config?.outputDir || "configured local folder"}.`,
      jump: "outputs",
      actionLabel: "View outputs"
    }
  ];

  view.innerHTML = `
    <section class="integrations-page">
      <div class="integration-hero panel">
        <div>
          <span class="eyebrow">Connector control</span>
          <h2>Integrations</h2>
          <p>Everything sensitive stays server-side. External actions stay manual or Human Gate controlled until you approve a real connector.</p>
        </div>
        <div class="integration-summary">
          ${integrationSummary("Live", Number(openaiReady) + Number(twitchReady) + Number(kickReady), "good")}
          ${integrationSummary("Manual", 3, "info")}
          ${integrationSummary("Gated", 1, "warn")}
        </div>
      </div>

      <div class="integration-grid">
        ${connectors.map(renderIntegrationCard).join("")}
      </div>

      <section class="panel integration-rules">
        <div class="toolbar">
          <div>
            <h2>Safety Rules</h2>
            <p class="muted">Agent 101 can prepare work, but these actions do not run without you.</p>
          </div>
          ${badge("Human Gate required", "warn")}
        </div>
        <div class="integration-rule-grid">
          ${integrationRule("Allowed locally", "Research, organize clips, draft captions, create CapCut briefs, and package approvals.", "good")}
          ${integrationRule("Never automatic", "Login, API key creation, account changes, posting, spending, or customer contact.", "bad")}
          ${integrationRule("Where to configure", "Use Railway or local environment variables. No API keys belong in frontend JavaScript.", "info")}
        </div>
      </section>
    </section>
  `;
}

function renderIntegrationCard(connector) {
  const button = connector.action
    ? `<button type="button" data-action="${esc(connector.action)}">${esc(connector.actionLabel)}</button>`
    : `<button type="button" data-nav-jump="${esc(connector.jump)}">${esc(connector.actionLabel)}</button>`;
  return `
    <section class="panel integration-card integration-card-${esc(connector.tone)}">
      <div>
        <span>${esc(initials(connector.name))}</span>
        ${badge(connector.label, connector.tone)}
      </div>
      <h3>${esc(connector.name)}</h3>
      <p>${esc(connector.body)}</p>
      ${button}
    </section>
  `;
}

function integrationSummary(label, value, tone) {
  return `<span class="integration-summary-card ${esc(tone)}"><b>${esc(value)}</b><small>${esc(label)}</small></span>`;
}

function integrationRule(title, body, tone) {
  return `<article class="integration-rule ${esc(tone)}"><b>${esc(title)}</b><p>${esc(body)}</p></article>`;
}

function buildLogRows() {
  return state.logs.map((log, index) => {
    const meta = logMeta(log);
    const linked = linkedLogEntity(log);
    return {
      ...log,
      ...meta,
      detailsLabel: detailLabel(log, linked),
      streamer: linked.streamer,
      user: linked.user || "System",
      index
    };
  });
}

function logStats(rows) {
  return {
    info: countWhere(rows, (row) => row.level === "info"),
    success: countWhere(rows, (row) => row.level === "success"),
    warning: countWhere(rows, (row) => row.level === "warning"),
    error: countWhere(rows, (row) => row.level === "error"),
    critical: countWhere(rows, (row) => row.level === "critical")
  };
}

function logMeta(log) {
  const type = String(log.type || "info");
  const message = `${type} ${log.message || ""}`.toLowerCase();
  let level = "info";
  if (/critical|fatal|breach|panic/.test(message)) level = "critical";
  else if (/error|fail|exceeded|invalid|denied/.test(message)) level = "error";
  else if (/warning|warn|retry|pending|approval_requested|blocked|low/.test(message)) level = "warning";
  else if (/created|completed|approved|captions|capcut|package|saved|export/.test(message)) level = "success";

  let module = "System";
  let icon = "SYS";
  if (/watch|streamer|stream|twitch/.test(message)) {
    module = type.includes("twitch") ? "Twitch API" : "Stream Watchlist";
    icon = type.includes("twitch") ? "TW" : "SW";
  } else if (/candidate|score|clip_detect|moment|radar/.test(message)) {
    module = "Clip Radar";
    icon = "RD";
  } else if (/clip|package|caption|capcut|builder/.test(message)) {
    module = "Clip Builder";
    icon = "CB";
  } else if (/post|draft|queue/.test(message)) {
    module = "Posting Queue";
    icon = "PQ";
  } else if (/approval|gate|review/.test(message)) {
    module = "Human Gate";
    icon = "HG";
  } else if (/artifact|output|export/.test(message)) {
    module = "Outputs";
    icon = "OUT";
  } else if (/openai|ai/.test(message)) {
    module = "OpenAI";
    icon = "AI";
  }

  return {
    level,
    module,
    icon,
    event: eventTitle(type, log.message)
  };
}

function eventTitle(type, message) {
  if (message) return message;
  return String(type || "event")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function linkedLogEntity(log) {
  const details = log.details || {};
  const candidate = state.candidates.find((item) => item.id === details.candidateId);
  const clipPackage = state.packages.find((item) => item.id === details.clipPackageId || item.id === details.packageId);
  const draft = state.drafts.find((item) => item.id === details.draftId);
  const approval = state.approvals.find((item) => item.id === details.approvalId);
  const draftCandidateRef = draft ? draftCandidate(draft) : null;
  const packageCandidate = clipPackage ? state.candidates.find((item) => item.id === clipPackage.candidateId) : null;
  const streamerId = details.streamerId || candidate?.streamerId || draftCandidateRef?.streamerId || packageCandidate?.streamerId;
  const streamer = state.streamers.find((item) => item.id === streamerId);
  return {
    candidate,
    clipPackage,
    draft,
    approval,
    streamer,
    user: details.operator || details.user
  };
}

function detailLabel(log, linked) {
  const details = log.details || {};
  if (linked.candidate?.title) return linked.candidate.title;
  if (linked.clipPackage?.packagePlan?.title) return linked.clipPackage.packagePlan.title;
  if (linked.draft?.platform) return `Post draft: ${platformName(linked.draft.platform)}`;
  if (linked.approval?.title) return linked.approval.title;
  const first = Object.entries(details)[0];
  if (first) return `${first[0]}: ${first[1]}`;
  return "System event";
}

function logMetric(label, value, detail, icon, tone) {
  return `
    <section class="panel log-metric log-metric-${esc(tone)}">
      <span>${esc(iconLabelForLog(icon))}</span>
      <div>
        <em>${esc(label)}</em>
        <strong>${esc(value)}</strong>
        <small>${esc(detail)}</small>
      </div>
    </section>
  `;
}

function iconLabelForLog(icon) {
  return {
    all: "ALL",
    info: "i",
    success: "✓",
    warning: "!",
    error: "!",
    critical: "C"
  }[icon] || "LG";
}

function renderLogsTable(rows) {
  return `
    <table class="logs-table">
      <thead>
        <tr>
          <th>Time (local)</th>
          <th>Type</th>
          <th>Module</th>
          <th>Event</th>
          <th>Details</th>
          <th>Streamer</th>
          <th>User / System</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(renderLogRow).join("")}
      </tbody>
    </table>
  `;
}

function renderLogRow(row) {
  return `
    <tr>
      <td><strong>${esc(new Date(row.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }))}</strong><small>${esc(new Date(row.createdAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }))}</small></td>
      <td>${logLevelBadge(row.level)}</td>
      <td><span class="log-module ${esc(row.level)}"><b>${esc(row.icon)}</b>${esc(row.module)}</span></td>
      <td><strong>${esc(row.event)}</strong><small>${esc(String(row.type || "event").replaceAll("_", " "))}</small></td>
      <td><span class="log-detail-chip">${esc(row.detailsLabel)}</span></td>
      <td>${row.streamer ? queueStreamerCell(row.streamer, row.index) : `<span class="muted">-</span>`}</td>
      <td>${esc(row.user || "System")}</td>
    </tr>
  `;
}

function logLevelBadge(level) {
  const labels = {
    info: "Info",
    success: "Success",
    warning: "Warning",
    error: "Error",
    critical: "Critical"
  };
  return `<span class="log-level ${esc(level)}">${esc(labels[level] || "Info")}</span>`;
}

function logDateRange(rows) {
  if (!rows.length) return "No dates";
  const dates = rows.map((row) => new Date(row.createdAt)).filter((date) => !Number.isNaN(date.getTime()));
  if (!dates.length) return "No dates";
  const timestamps = dates.map((date) => date.getTime());
  const newest = new Date(Math.max(...timestamps));
  const oldest = new Date(Math.min(...timestamps));
  const options = { month: "short", day: "numeric", year: "numeric" };
  return `${oldest.toLocaleDateString([], options)} - ${newest.toLocaleDateString([], options)}`;
}

function renderLogTimeline(rows) {
  const buckets = Array.from({ length: 18 }, (_, index) => {
    const count = rows.filter((row) => (row.index + index) % 18 === index).length;
    return Math.max(8, Math.min(96, 18 + count * 5 + ((index * 17) % 34)));
  });
  const points = buckets.map((value, index) => `${Math.round((index / (buckets.length - 1)) * 100)},${100 - value}`).join(" ");
  return `
    <div class="logs-chart">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="logAreaGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#a855f7" stop-opacity="0.55"/>
            <stop offset="100%" stop-color="#a855f7" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <polygon points="0,100 ${points} 100,100" fill="url(#logAreaGradient)"></polygon>
        <polyline points="${points}" fill="none" stroke="#a855f7" stroke-width="2.4" vector-effect="non-scaling-stroke"></polyline>
      </svg>
      <div><span>${esc(logDateRange(rows).split(" - ")[0] || "")}</span><span>${esc(logDateRange(rows).split(" - ")[1] || "")}</span></div>
    </div>
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
    kickConfigured: state.config?.kickConfigured,
    kickOAuthTokenConfigured: state.config?.kickOAuthTokenConfigured,
    postDailyLimit: state.config?.postDailyLimit,
    browserEnabled: state.config?.browserEnabled,
    browserMode: state.config?.browserMode,
    browserViewport: state.config?.browserViewport,
    capcutManualHandoff: state.config?.capcutManualHandoff,
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
            <button data-action="test-kick">Test Kick</button>
          </div>
        </div>
        <div class="kv">
          <span>OpenAI</span><span>${state.openai?.configured ? "configured" : "not configured"}</span>
          <span>Twitch</span><span>${state.twitch?.configured ? "configured" : "not configured"}</span>
          <span>Kick</span><span>${state.kick?.configured ? "configured" : "not configured"}</span>
          <span>Browser</span><span>${state.browser?.enabled ? "enabled" : "disabled"}</span>
          <span>Official API</span><span>${state.twitch?.officialApiOnly ? "yes" : "no"}</span>
          <span>Secrets</span><span>server-side only</span>
        </div>
      </section>
      <section class="panel">
        <div class="toolbar">
          <h2>Browser & Tools</h2>
          <div class="actions">
            <button data-nav-jump="browser">Open Browser Workspace</button>
            <button data-browser-action="reset-profile">Reset Browser Profile</button>
          </div>
        </div>
        <div class="kv">
          <span>Browser mode</span><span>${esc(state.browser?.mode || "headless_screenshot")}</span>
          <span>CapCut</span><span>${esc(state.capcut?.status || "manual_handoff")}</span>
          <span>FFmpeg</span><span>${state.media?.ffmpeg?.configured ? "available" : "not available"}</span>
          <span>FFprobe</span><span>${state.media?.ffprobe?.configured ? "available" : "not available"}</span>
          <span>Policy</span><span>${esc((state.browser?.policies || []).length)} allowlisted domains</span>
        </div>
      </section>
      <section class="panel">
        <h2>Runtime</h2>
        <pre class="codebox">${esc(JSON.stringify(safeConfig, null, 2))}</pre>
      </section>
    </div>
  `;
}

function labelize(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(value) {
  const text = String(value || "").toLowerCase();
  if (/ready|passed|connected|human_review|package_ready|capcut_open|completed/.test(text)) return "good";
  if (/warning|pending|manual|human|paused|draft|preparing/.test(text)) return "warn";
  if (/failed|error|blocked|cancelled|missing|rejected/.test(text)) return "bad";
  return "neutral";
}

function getActiveHandoff() {
  return (state.handoffs || []).find((handoff) => handoff.active) || (state.handoffs || [])[0] || null;
}

function renderPreflightList(handoff) {
  const checks = handoff?.preflight?.checks || [];
  return `
    <div class="handoff-check-list">
      ${checks.slice(0, 8).map((check) => `
        <span class="${check.passed ? "ok" : "warn"}">
          <b>${check.passed ? "OK" : "!"}</b>
          <em>${esc(check.label)}</em>
        </span>
      `).join("") || empty("No preflight checks yet")}
    </div>
  `;
}

function renderActiveHandoff(handoff) {
  if (!handoff) {
    return `
      <section class="panel browser-card active-handoff-card">
        <h2>Active Handoff</h2>
        ${empty("Select or package a clip to prepare a supervised CapCut handoff.")}
        <button class="stretch" data-browser-action="prepare-handoff" ${state.browserBusy ? "disabled" : ""}>Prepare latest package</button>
      </section>
    `;
  }
  return `
    <section class="panel browser-card active-handoff-card">
      <div class="browser-card-title">
        <h2>Active Handoff</h2>
        ${badge(labelize(handoff.status), statusTone(handoff.status))}
      </div>
      <article class="active-handoff-summary">
        <div class="handoff-thumb ${handoff.thumbnail ? "" : "blank"}">
          ${handoff.thumbnail ? `<img src="${esc(handoff.thumbnail)}" alt="">` : `<span>SC</span>`}
        </div>
        <div>
          <strong>${esc(handoff.clipPackage?.title || "CapCut handoff")}</strong>
          <p>${esc(handoff.creator?.displayName || "Creator pending")} · ${esc(handoff.outputDuration || 0)}s output</p>
        </div>
      </article>
      <div class="kv compact">
        <span>Render</span><span>${esc(handoff.renderStatus)}</span>
        <span>Captions</span><span>${esc(handoff.captionStatus)}</span>
        <span>Package</span><span>${esc(handoff.packageStatus)}</span>
        <span>Expires</span><span>${fmtDate(handoff.expiresAt)}</span>
      </div>
      ${renderPreflightList(handoff)}
      <div class="browser-card-actions">
        <button data-browser-action="prepare-handoff" ${state.browserBusy ? "disabled" : ""}>Prepare package</button>
        <button class="primary" data-browser-action="open-capcut" ${state.browserBusy ? "disabled" : ""}>Open CapCut</button>
        <button data-browser-action="cancel-handoff" ${state.browserBusy ? "disabled" : ""}>Cancel</button>
      </div>
    </section>
  `;
}

function renderSmokeModal() {
  if (!state.smokeModalOpen) return "";
  const smoke = state.smokeTest;
  const checks = smoke?.checks || [];
  return `
    <div class="modal-backdrop smoke-backdrop" role="presentation">
      <section class="smoke-modal" role="dialog" aria-modal="true" aria-label="System smoke test">
        <header>
          <div>
            <span class="eyebrow">System diagnostics</span>
            <h2>Smoke Test</h2>
            <p>Real checks for the API, media tools, supervised browser, CapCut DNS, and state storage. Warnings stay warnings.</p>
          </div>
          <button aria-label="Close smoke test" data-smoke-close>×</button>
        </header>
        <div class="smoke-summary">
          ${badge(state.smokeBusy ? "Running" : labelize(smoke?.status || "Not run"), state.smokeBusy ? "warn" : statusTone(smoke?.status))}
          <span><b>${esc(smoke?.durationMs ?? "--")}ms</b><small>Duration</small></span>
          <span><b>${esc(checks.filter((check) => check.status === "failed").length)}</b><small>Failed</small></span>
          <span><b>${esc(checks.filter((check) => check.status === "warning").length)}</b><small>Warnings</small></span>
        </div>
        <div class="smoke-checks">
          ${state.smokeBusy && !checks.length ? `
            ${["API", "FFmpeg", "Chromium", "CapCut DNS"].map((label) => `
              <article class="running"><span></span><strong>${label}</strong><p>Running...</p></article>
            `).join("")}
          ` : checks.map((check) => `
            <article class="${esc(check.status)}">
              <span></span>
              <div>
                <strong>${esc(check.label)}</strong>
                <p>${esc(check.message)}</p>
                ${check.technical ? `<code>${esc(check.technical).slice(0, 280)}</code>` : ""}
              </div>
              <em>${esc(check.durationMs)}ms</em>
            </article>
          `).join("") || empty("Run the smoke test to see diagnostics.")}
        </div>
        <footer>
          <button data-smoke-copy ${smoke ? "" : "disabled"}>Copy diagnostic report</button>
          <button class="primary" data-smoke-retry ${state.smokeBusy ? "disabled" : ""}>${state.smokeBusy ? "Running..." : "Retry smoke test"}</button>
        </footer>
      </section>
    </div>
  `;
}

function renderBrowserTabs(active) {
  const tabs = active?.tabs || [];
  if (!tabs.length) {
    return `<div class="browser-tab-strip empty-tabs"><span>No tabs yet</span><button data-browser-action="new-tab" ${active ? "" : "disabled"}>+ New tab</button></div>`;
  }
  return `
    <div class="browser-tab-strip" role="tablist" aria-label="Browser tabs">
      ${tabs.map((tab) => `
        <button class="browser-tab ${tab.active ? "active" : ""}" data-browser-tab="${esc(tab.id)}" title="${esc(tab.url || tab.title)}">
          <span class="tab-dot ${tab.loading ? "loading" : ""}"></span>
          <b>${esc(tab.title || tab.hostname || "New tab")}</b>
          <small>${esc(tab.hostname || "blank")}</small>
        </button>
      `).join("")}
      <button class="browser-tab-add" data-browser-action="new-tab" aria-label="New browser tab">+</button>
    </div>
  `;
}

function renderBrowserTaskRail(active, handoff) {
  const browser = state.browser || {};
  const actions = browser.actions || [];
  const currentStep = active?.privacyShield?.active
    ? "Human sign-in or sensitive step"
    : active?.controlMode === "agent_assisted"
      ? "Agent assisted observation"
      : active
        ? "Human controlled browser"
        : "No active browser";
  const nextAction = active?.privacyShield?.active
    ? "Complete the sensitive step manually, then take human control again."
    : handoff?.status === "PACKAGE_READY"
      ? "Open CapCut and use the prepared handoff files."
      : handoff
        ? "Prepare the handoff package before opening CapCut."
        : "Start a browser session or package a clip for CapCut.";
  const activeTask = browser.tasks?.[0];
  return `
    <aside class="browser-side browser-task-rail">
      <section class="panel browser-card browser-task-card">
        <div class="browser-card-title">
          <h2>Current Task</h2>
          ${badge(active?.state || "Offline", statusTone(active?.state || "offline"))}
        </div>
        <div class="browser-task-hero">
          <strong>${esc(activeTask?.goal || handoff?.clipPackage?.title || "Supervised browser workspace")}</strong>
          <p>${esc(currentStep)}</p>
        </div>
        <div class="kv">
          <span>Controller</span><span>${esc(active?.controlMode || "offline")}</span>
          <span>Policy</span><span>${esc(active?.policyMode || "none")}</span>
          <span>Domain</span><span>${esc(active?.currentHostname || "No domain")}</span>
          <span>Linked handoff</span><span>${esc(handoff?.id ? handoff.status : "None")}</span>
          <span>Last activity</span><span>${fmtDate(active?.lastActivityAt)}</span>
        </div>
        ${active?.lastError ? `<p class="browser-error">${esc(active.lastError)}</p>` : ""}
      </section>

      <section class="panel browser-card browser-next-action">
        <h2>Next Action</h2>
        <p>${esc(nextAction)}</p>
        <div class="browser-card-actions two">
          <button data-browser-action="take-control" ${active ? "" : "disabled"}>Take control</button>
          <button data-browser-action="${active?.controlMode === "paused" ? "resume" : "pause"}" ${active ? "" : "disabled"}>${active?.controlMode === "paused" ? "Resume" : "Pause"}</button>
        </div>
      </section>

      ${renderActiveHandoff(handoff)}

      <section class="panel browser-card compact-card">
        <div class="browser-card-title">
          <h2>Action Timeline</h2>
          <button data-browser-action="run-diagnostics">Diagnostics</button>
        </div>
        <div class="activity-list browser-activity-list">
          ${actions.slice(0, 8).map((action) => `
            <article>
              <span>BR</span>
              <p>${esc((action.action || action.actionType || "browser event").replaceAll("_", " "))}</p>
              <time>${fmtDate(action.createdAt)}</time>
            </article>
          `).join("") || empty("No browser actions yet")}
        </div>
      </section>
    </aside>
  `;
}

function renderBrowserAssetDock(handoff, downloads) {
  const artifactIds = new Set(handoff?.artifactIds || []);
  const handoffArtifacts = state.artifacts.filter((artifact) => artifactIds.has(artifact.id));
  return `
    <section class="panel browser-asset-dock">
      <div class="browser-dock-header">
        <div>
          <span class="eyebrow">Project asset dock</span>
          <h2>CapCut Handoff Files</h2>
        </div>
        <div class="browser-dock-actions">
          <button data-browser-action="prepare-handoff" ${state.browserBusy ? "disabled" : ""}>Prepare handoff</button>
          <button class="primary" data-browser-action="open-capcut" ${state.browserBusy ? "disabled" : ""}>Open CapCut</button>
        </div>
      </div>
      <div class="browser-asset-grid">
        ${handoffArtifacts.map((artifact) => `
          <article class="browser-asset">
            <span>${esc((artifact.format || artifact.type || "file").toUpperCase())}</span>
            <strong>${esc(artifact.title || artifact.filename || artifact.id)}</strong>
            <small>${esc(artifact.fileSizeBytes ? `${Math.round(artifact.fileSizeBytes / 1024)} KB` : artifact.status || "artifact")}</small>
            ${artifact.url ? `<a href="${esc(appUrl(artifact.url))}" download>Download</a>` : `<em>Saved</em>`}
          </article>
        `).join("") || empty("No prepared handoff files yet. Package a verified clip, then prepare the handoff.")}
      </div>
      <div class="browser-download-row">
        <strong>Recent downloads</strong>
        ${downloads.slice(0, 4).map((download) => `<span>${esc(download.suggestedFilename || download.filename)} <em>${fmtDate(download.createdAt)}</em></span>`).join("") || `<span>No browser downloads detected yet.</span>`}
      </div>
    </section>
  `;
}

function renderBrowserWorkspace() {
  const browser = state.browser || {};
  const active = browser.activeSession || (browser.sessions || []).find((session) => !["closed", "stopped"].includes(session.status)) || null;
  const policies = browser.policies || [];
  const downloads = browser.downloads || [];
  const handoff = getActiveHandoff();
  const screenshotUrl = active
    ? appUrl(`/api/browser/sessions/${active.id}/screenshot?stamp=${state.browserScreenshotStamp || Date.now()}`)
    : "";
  const mediaReady = state.media?.ffmpeg?.configured && state.media?.ffprobe?.configured;
  const sessionStatus = active?.state || (active?.status ? labelize(active.status).toUpperCase() : "NOT_STARTED");
  view.innerHTML = `
    <section class="browser-workspace browser-workspace-v2">
      <header class="browser-topbar">
        <div>
          <span class="eyebrow">Browser Workspace</span>
          <h2>Supervised tool browser</h2>
          <p>Real server-side Chromium, persistent profile, human handoff for sensitive pages, and CapCut-ready assets.</p>
        </div>
        <div class="browser-status-chips">
          ${badge(`Worker ${browser.enabled ? "on" : "off"}`, browser.enabled ? "good" : "bad")}
          ${badge(sessionStatus, statusTone(sessionStatus))}
          ${badge(`Controller ${active?.controlMode || "offline"}`, active?.controlMode === "paused" ? "warn" : "info")}
          ${badge(`CapCut ${state.capcut?.status || "manual"}`, "neutral")}
          ${badge(mediaReady ? "Media ready" : "Media check", mediaReady ? "good" : "warn")}
        </div>
      </header>

      <div class="browser-layout">
        <section class="panel browser-stage browser-stage-v2">
          ${renderBrowserTabs(active)}
          <form id="browser-url-form" class="browser-toolbar browser-toolbar-v2">
            <button type="button" data-browser-action="back" ${active ? "" : "disabled"} title="Back">‹</button>
            <button type="button" data-browser-action="forward" ${active ? "" : "disabled"} title="Forward">›</button>
            <button type="button" data-browser-action="refresh" ${active ? "" : "disabled"} title="Refresh">↻</button>
            <button type="button" data-browser-action="stop-loading" ${active ? "" : "disabled"} title="Stop loading">×</button>
            <input name="url" value="${esc(active?.currentUrl || "")}" placeholder="https://www.twitch.tv/directory or https://kick.com">
            <span class="browser-domain-chip ${active?.policyMode || "none"}">${esc(active?.currentHostname || "No domain")}</span>
            <button class="primary" type="submit" ${active ? "" : "disabled"}>Go</button>
          </form>

          <div class="browser-viewport-shell">
            <div class="browser-viewport ${active ? "" : "empty"}" data-browser-viewport>
              ${active ? `
                <img src="${esc(screenshotUrl)}" alt="Live browser screenshot for ${esc(active.title || "workspace")}" data-browser-shot draggable="false">
                <span class="browser-controller-badge">${esc(active.controlMode || "human_control")}</span>
                ${active.privacyShield?.active ? `
                  <div class="browser-privacy-shield">
                    <strong>Sensitive page detected</strong>
                    <p>${esc(active.privacyShield.reason || "Agent 101 is paused. Human control is required.")}</p>
                  </div>
                ` : ""}
              ` : `
                <div class="browser-empty-state">
                  <strong>No browser session</strong>
                  <p>Start an isolated Chromium workspace to use approved web tools. No fake browser is displayed here.</p>
                  <div>
                    <button class="primary" data-browser-action="start-session" ${state.browserBusy ? "disabled" : ""}>Start Browser</button>
                    <button data-browser-action="run-diagnostics">Run Diagnostics</button>
                  </div>
                </div>
              `}
            </div>
          </div>

          <div class="browser-input-bridge">
            <form id="browser-type-form">
              <input name="text" placeholder="Type into the focused browser field..." ${active?.controlMode === "human_control" ? "" : "disabled"}>
              <button type="submit" ${active?.controlMode === "human_control" ? "" : "disabled"}>Type</button>
              <button type="button" data-browser-action="browser-enter" ${active?.controlMode === "human_control" ? "" : "disabled"}>Enter</button>
              <button type="button" data-browser-action="browser-scroll" ${active?.controlMode === "human_control" ? "" : "disabled"}>Scroll</button>
            </form>
            <div class="browser-control-buttons">
              <button data-browser-action="start-session" ${state.browserBusy ? "disabled" : ""}>${active ? "Restore" : "Start"}</button>
              <button data-browser-action="new-tab" ${active ? "" : "disabled"}>New tab</button>
              <button data-browser-action="close-tab" ${active?.activeTabId ? "" : "disabled"}>Close tab</button>
              <button data-browser-action="take-control" ${active ? "" : "disabled"}>Take control</button>
              <button data-browser-action="give-agent-control" ${active && !active.privacyShield?.active ? "" : "disabled"}>Agent assisted</button>
              <button data-browser-action="restart-session" ${active ? "" : "disabled"}>Restart</button>
              <button data-browser-action="end-session" ${active ? "" : "disabled"}>End</button>
            </div>
          </div>
        </section>

        ${renderBrowserTaskRail(active, handoff)}
      </div>

      ${renderBrowserAssetDock(handoff, downloads)}

      <section class="panel browser-policy-dock">
        <div class="browser-card-title">
          <h2>Domain Policies</h2>
          <span>${esc(policies.length)} reviewed</span>
        </div>
        <div class="browser-policy-list horizontal">
          ${policies.slice(0, 10).map((policy) => `
            <span>
              <b>${esc(policy.domain)}</b>
              <em>${esc(policy.mode)}</em>
            </span>
          `).join("") || empty("No browser policies loaded")}
        </div>
      </section>
    </section>
    ${renderSmokeModal()}
  `;
}

function empty(label) {
  return `<div class="empty">${esc(label)}</div>`;
}

function practiceNotice(message, includeClear = false) {
  return `
    <div class="practice-inline">
      <strong>PRACTICE MEDIA — NOT A REAL STREAM</strong>
      <span>${esc(message)}</span>
      ${includeClear ? `<button data-action="clear-demo">Clear Practice Data</button>` : ""}
    </div>
  `;
}

async function refresh() {
  await loadCore();
  renderNav();
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
  toast(`Practice project started: ${seeded.streamers || 0} streamers, ${seeded.candidates || 0} candidates`, "good");
  await refresh();
}

async function clearDemo() {
  const result = await api("/api/demo/clear", { method: "POST", body: "{}" });
  toast(result.message || "Practice data cleared", "good");
  await refresh();
}

async function uploadMediaSource(form) {
  const data = new FormData(form);
  const file = data.get("file");
  if (!file || !file.size) {
    toast("Choose a video file first.", "bad");
    return;
  }
  toast("Uploading and verifying source media...", "info");
  const result = await api("/api/media/sources/upload", {
    method: "POST",
    body: data
  });
  state.selectedCandidateId = result.candidate?.id || state.selectedCandidateId;
  if (result.candidate?.id) localStorage.setItem("selectedCandidateId", result.candidate.id);
  state.studioTab = "source";
  localStorage.setItem("studioTab", state.studioTab);
  toast(`Source verified: ${result.source?.title || result.source?.originalFilename || "media loaded"}`, "good");
  form.reset();
  await refresh();
}

const agent101Goals = {
  "agent101-demo-workflow": "Start Practice Mode, add 5 practice streamers, run a watch cycle, generate clip candidates, score them, create packages for the top 3, create CapCut briefs, create draft posting packages, and send them to Human Gate. Mark every record as practice.",
  "agent101-add-demo-streamers": "Add 5 practice streamers for internal StreamClipper sandbox testing.",
  "agent101-watch-cycle": "Run a safe watch cycle across practice-approved streamers and create practice sessions.",
  "agent101-create-candidates": "Find 5 practice streams and make clip candidates.",
  "agent101-package-top3": "Package the top 3 clip candidates, create CapCut handoffs, and create draft posting packages.",
  "agent101-human-gate": "Send current draft posting packages to Human Gate without publishing anything."
};

function inferAgentRunMode(goal, mode = "auto") {
  if (mode && mode !== "auto") return mode;
  return /\b(demo|practice|sample|synthetic|local)\b/i.test(goal) ? "demo" : "real";
}

async function runAgent101(goal, mode = "auto") {
  const runMode = inferAgentRunMode(goal, mode);
  state.agentRunBusy = true;
  state.agentRun = {
    status: "running",
    goal,
    currentStep: "Starting Agent 101",
    progress: 8,
    steps: [],
    counts: {}
  };
  render();
  try {
    const result = await api("/api/agent101/run", {
      method: "POST",
      body: JSON.stringify({ goal, mode: runMode, maxSteps: 10 })
    });
    state.agentRun = result;
    state.agentRunBusy = false;
    await loadCore();
    const externalStatus = result.externalStatus || String(result.status || "").toLowerCase();
    toast(
      externalStatus === "blocked" || externalStatus === "needs_approval" ? result.summary : result.summary || "Agent 101 run complete",
      externalStatus === "completed" ? "good" : externalStatus === "blocked" || externalStatus === "needs_approval" ? "info" : "bad"
    );
    renderNav();
    render();
  } catch (error) {
    state.agentRunBusy = false;
    state.agentRun = {
      status: "error",
      goal,
      currentStep: "Run failed",
      progress: 100,
      summary: error.message,
      steps: [],
      counts: {}
    };
    toast(error.message, "bad");
    render();
  }
}

async function runAgentCommand(form) {
  const goal = cleanCommand(form.elements.goal?.value) || agent101Goals["agent101-demo-workflow"];
  state.agentChatOpen = true;
  form.reset();
  await runAgent101(goal, "auto");
}

function cleanCommand(value) {
  return String(value || "").trim();
}

async function loadBrowserState() {
  const [browser, capcut, media, handoffs, smoke] = await Promise.all([
    api("/api/browser/profile"),
    api("/api/capcut/status"),
    api("/api/media/status"),
    api("/api/handoffs"),
    api("/api/system/smoke-test")
  ]);
  Object.assign(state, {
    browser,
    capcut,
    media,
    handoffs: handoffs.handoffs || [],
    smokeTest: smoke.latest || state.smokeTest
  });
}

async function ensureBrowserSession() {
  const active = state.browser?.activeSession || (state.browser?.sessions || []).find((session) => session.status !== "closed");
  if (active?.id) return active.id;
  const result = await api("/api/browser/sessions", {
    method: "POST",
    body: JSON.stringify({ purpose: "Operator browser workspace" })
  });
  await loadBrowserState();
  return result.session.id;
}

async function navigateBrowser(form) {
  const url = cleanCommand(form.elements.url?.value);
  if (!url) return;
  state.browserBusy = true;
  render();
  try {
    const sessionId = await ensureBrowserSession();
    const result = await api(`/api/browser/sessions/${sessionId}/navigate`, {
      method: "POST",
      body: JSON.stringify({ url })
    });
    state.browserScreenshotStamp = Date.now();
    await loadBrowserState();
    toast(result.allowed ? "Browser loaded" : result.reason || "Navigation blocked", result.allowed ? "good" : "bad");
  } finally {
    state.browserBusy = false;
    renderNav();
    render();
  }
}

async function ensureHandoffPackage({ prepare = false } = {}) {
  let handoff = getActiveHandoff();
  if (!handoff) {
    const clipPackage = state.packages?.[0];
    if (!clipPackage?.id) throw new Error("Create a clip package before preparing a CapCut handoff.");
    const created = await api("/api/handoffs", {
      method: "POST",
      body: JSON.stringify({ clipPackageId: clipPackage.id })
    });
    handoff = created.handoff;
  }
  if (prepare && handoff?.id) {
    const prepared = await api(`/api/handoffs/${handoff.id}/prepare`, { method: "POST", body: "{}" });
    handoff = prepared.handoff;
  }
  await loadBrowserState();
  return handoff;
}

async function runSystemSmoke() {
  state.smokeModalOpen = true;
  state.smokeBusy = true;
  render();
  try {
    const result = await api("/api/browser/smoke-test", { method: "POST", body: "{}" });
    state.smokeTest = {
      ...result.smokeTest,
      checks: (result.smokeTest?.checks || []).map((check) => ({
        ...check,
        status: check.status === "passed" ? "passed" : "failed",
        technical: check.details ? JSON.stringify(check.details) : ""
      }))
    };
    toast(`Smoke test ${result.smokeTest.status}`, statusTone(result.smokeTest.status));
    await loadBrowserState();
  } catch (error) {
    toast(error.message, "bad");
  } finally {
    state.smokeBusy = false;
    renderNav();
    render();
  }
}

async function sendBrowserInput(input) {
  const active = state.browser?.activeSession || (state.browser?.sessions || []).find((session) => session.status !== "closed");
  if (!active?.id) throw new Error("Start the browser before sending input.");
  const result = await api(`/api/browser/sessions/${active.id}/input`, {
    method: "POST",
    body: JSON.stringify(input)
  });
  state.browserScreenshotStamp = Date.now();
  await loadBrowserState();
  return result;
}

async function handleBrowserAction(action) {
  const active = state.browser?.activeSession || (state.browser?.sessions || []).find((session) => session.status !== "closed");
  state.browserBusy = true;
  render();
  try {
    if (action === "start-session") {
      await api("/api/browser/sessions", {
        method: "POST",
        body: JSON.stringify({ purpose: "StreamClipper supervised browser" })
      });
      toast("Browser session started", "good");
    } else if (action === "test-example" || action === "run-diagnostics") {
      state.browserBusy = false;
      await runSystemSmoke();
      return;
    } else if (action === "new-tab") {
      if (!active?.id) return;
      await api(`/api/browser/sessions/${active.id}/tabs`, { method: "POST", body: "{}" });
      toast("New browser tab opened", "good");
    } else if (action === "close-tab") {
      if (!active?.id || !active.activeTabId) return;
      await api(`/api/browser/sessions/${active.id}/tabs/${active.activeTabId}`, { method: "DELETE" });
      toast("Browser tab closed", "info");
    } else if (action === "restart-session") {
      if (!active?.id) return;
      await api(`/api/browser/sessions/${active.id}/restart`, { method: "POST", body: "{}" });
      toast("Browser session restarted", "good");
    } else if (action === "end-session") {
      if (!active?.id) return;
      await api(`/api/browser/sessions/${active.id}`, { method: "DELETE" });
      toast("Browser session ended", "info");
    } else if (action === "browser-enter") {
      await sendBrowserInput({ action: "keypress", key: "Enter" });
      toast("Enter sent to browser", "good");
    } else if (action === "browser-scroll") {
      await sendBrowserInput({ action: "scroll", deltaY: 560 });
      toast("Scrolled browser", "info");
    } else if (action === "prepare-handoff") {
      await ensureHandoffPackage({ prepare: true });
      toast("CapCut handoff package prepared", "good");
    } else if (action === "cancel-handoff") {
      const handoff = getActiveHandoff();
      if (!handoff?.id) return;
      if (!window.confirm("Cancel this CapCut handoff? The generated artifacts stay saved.")) return;
      await api(`/api/handoffs/${handoff.id}/cancel`, { method: "POST", body: "{}" });
      toast("CapCut handoff cancelled", "info");
    } else if (action === "open-capcut") {
      const handoff = await ensureHandoffPackage({ prepare: false }).catch(() => null);
      const body = active?.id ? { sessionId: active.id } : {};
      if (handoff?.id) {
        await api(`/api/handoffs/${handoff.id}/open-capcut`, { method: "POST", body: JSON.stringify(body) });
      } else {
        await api("/api/capcut/open", { method: "POST", body: JSON.stringify(body) });
      }
      state.browserScreenshotStamp = Date.now();
      toast("CapCut handoff opened in human-control mode", "good");
    } else if (action === "refresh-shot") {
      state.browserScreenshotStamp = Date.now();
      toast("Browser screen refreshed", "info");
    } else if (action === "reset-profile") {
      if (!window.confirm("Reset the browser profile and close active sessions?")) return;
      await api("/api/browser/profile", { method: "DELETE" });
      toast("Browser profile reset", "info");
    } else if (["back", "forward", "refresh", "stop-loading", "take-control", "give-agent-control", "pause"].includes(action)) {
      if (!active?.id) return;
      if (action === "give-agent-control" && !window.confirm("Agent Assisted only allows approved, reversible actions. Login, CAPTCHA, payments, uploads, publishing, and destructive actions stay blocked. Continue?")) return;
      await api(`/api/browser/sessions/${active.id}/${action}`, { method: "POST", body: "{}" });
      state.browserScreenshotStamp = Date.now();
      toast("Browser control updated", "good");
    } else if (action === "resume") {
      if (!active?.id) return;
      await api(`/api/browser/sessions/${active.id}/resume`, { method: "POST", body: "{}" });
      toast("Browser session resumed in human-control mode", "good");
    }
    await loadBrowserState();
  } catch (error) {
    toast(error.message, "bad");
  } finally {
    state.browserBusy = false;
    renderNav();
    render();
  }
}

async function scoutStreamers() {
  const platform = document.querySelector("#scout-platform")?.value || "all";
  const result = await api(`/api/streamers/recommendations?platform=${encodeURIComponent(platform)}&limit=8`);
  state.recommendations = result.recommendations || [];
  state.recommendationsMessage = result.message || "";
  toast(`Agent 101 found ${state.recommendations.length} streamer recommendations`, "good");
  render();
}

async function addRecommendedStreamer(index) {
  const item = state.recommendations[Number(index)];
  if (!item) return;
  const result = await api("/api/twitch/streamers", {
    method: "POST",
    body: JSON.stringify({
      platform: item.platform,
      displayName: item.displayName,
      channelId: item.channelId,
      channelUrl: item.channelUrl,
      permissionStatus: "approved",
      monitorEnabled: true,
      allowedUse: item.suggestedUse || ["clips", "edits", "reposts"],
      notes: `Added from Agent 101 Streamer Scout. ${item.reason || ""}`.trim()
    })
  });
  state.selectedStreamerId = result.streamer?.id || state.selectedStreamerId;
  localStorage.setItem("selectedStreamerId", state.selectedStreamerId);
  toast(`${item.displayName} added to monitoring`, "good");
  state.recommendations = state.recommendations.filter((_, itemIndex) => itemIndex !== Number(index));
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

async function saveBuilderDraft(id) {
  await api("/api/clips/draft", {
    method: "POST",
    body: JSON.stringify({ candidateId: id })
  });
  toast("Clip builder draft saved", "good");
  await refresh();
  setView("builder");
}

async function createCapCut() {
  const projectId = state.studio?.project?.id;
  if (!projectId) return toast("Open a Clip Project first.", "bad");
  if (!projectReadiness(state.studio.project).canCapCut) {
    toast("Render a verified MP4 before preparing a CapCut handoff.", "bad");
    return;
  }
  await api(`/api/clip-projects/${encodeURIComponent(projectId)}/capcut-handoff`, {
    method: "POST",
    body: JSON.stringify({
      renderId: state.studio.project.readiness?.latestArtifactId,
      clipPackageId: selectedClipPackage()?.id || state.drafts[0]?.clipPackageId || ""
    })
  });
  toast("CapCut handoff created", "good");
  await refresh();
}

async function createCaptions() {
  const packageId = selectedClipPackage()?.id || state.drafts[0]?.clipPackageId;
  if (!packageId) return;
  await api("/api/clips/captions", {
    method: "POST",
    body: JSON.stringify({ clipPackageId: packageId })
  });
  toast("Caption files created", "good");
  await refresh();
}

function hydrateStudioPlayers() {
  if (state.view !== "builder" && !state.previewCandidateId) return;
  const videos = document.querySelectorAll("[data-studio-video]");
  videos.forEach((video) => {
    const start = Number(video.dataset.start || 0);
    const seek = state.studioSeek ?? start;
    const applySeek = () => {
      if (!Number.isFinite(seek)) return;
      try {
        if (Math.abs(video.currentTime - seek) > 0.2) video.currentTime = seek;
      } catch {
        // Browser may reject seeking before metadata loads; loadedmetadata will retry.
      }
    };
    if (video.readyState >= 1) applySeek();
    video.addEventListener("loadedmetadata", applySeek, { once: true });
  });
  state.studioSeek = null;
}

function setStudioTab(tab) {
  state.studioTab = tab || "source";
  localStorage.setItem("studioTab", state.studioTab);
  render();
}

function selectStudioCandidate(id) {
  if (!id) return;
  const candidate = (state.studio?.candidates || state.candidates).find((item) => item.id === id);
  if (!candidate) return;
  state.selectedCandidateId = id;
  state.studioSeek = candidateStartSeconds(candidate);
  localStorage.setItem("selectedCandidateId", id);
  if (state.view === "builder" && state.studioTab === "source") setStudioTab("candidate");
  else render();
}

async function runStudioAction(action) {
  const candidates = state.studio?.candidates || [];
  const candidate = studioSelectedCandidate(candidates);
  const projectId = state.studio?.project?.id;
  if (action === "replay") {
    state.studioSeek = candidateStartSeconds(candidate);
    render();
    return;
  }
  if (["mark-start", "mark-end", "capture-frame"].includes(action)) {
    const video = document.querySelector("[data-studio-video]");
    const current = video ? Number(video.currentTime || 0) : candidateStartSeconds(candidate);
    if (action === "capture-frame") {
      const frameUrl = `/api/media/sources/${encodeURIComponent(state.studio?.source?.id || "")}/frame?candidateId=${encodeURIComponent(candidate?.id || "")}&t=${encodeURIComponent(current)}`;
      window.open(appUrl(frameUrl), "_blank", "noopener,noreferrer");
      toast("Opened a real source frame from the current timestamp.", "good");
      return;
    }
    if (!projectId || !candidate) return toast("Open a Clip Project and select a candidate first.", "bad");
    const start = action === "mark-start" ? current : candidateStartSeconds(candidate);
    const end = action === "mark-end" ? current : candidateEndSeconds(candidate);
    if (!(end > start)) return toast("End time must be after start time.", "bad");
    await api(`/api/clip-projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        candidateId: candidate.id,
        clipStartSeconds: start,
        clipEndSeconds: end
      })
    });
    toast(action === "mark-start" ? "Start marker saved" : "End marker saved", "good");
    await refresh();
    return;
  }
  if (action === "capcut-open") {
    if (!projectReadiness(state.studio?.project || {}).canCapCut) {
      toast("Prepare a verified CapCut handoff before opening the workspace.", "bad");
      return;
    }
    await handleBrowserAction("open-capcut");
    return;
  }
  if (action === "render-draft") {
    if (!candidate) return toast("Select a playable candidate first", "bad");
    if (!projectId) return toast("Open or create a Clip Project first.", "bad");
    state.studioBusy = true;
    render();
    try {
      const result = await api(`/api/clip-projects/${encodeURIComponent(projectId || state.studio?.project?.id || "")}/render`, {
        method: "POST",
        body: JSON.stringify({
          projectId: state.studio?.project?.id,
          sourceId: state.studio?.source?.id,
          candidateId: candidate.id,
          format: "9:16"
        })
      });
      toast(result.job?.status === "completed" ? "Rendered MP4 draft created" : "Render job updated", "good");
      state.studioTab = "rendered";
      localStorage.setItem("studioTab", state.studioTab);
      await refresh();
    } finally {
      state.studioBusy = false;
      render();
    }
  }
}

async function submitStreamer(form) {
  const data = new FormData(form);
  const allowedUse = data.getAll("allowedUse");
  const result = await api("/api/twitch/streamers", {
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
  const status = liveStatusMeta(result.streamer);
  toast(`Streamer added: ${status.label}`, result.streamer?.liveStatus === "api_not_configured" ? "info" : "good");
  await refresh();
}

async function checkStreamer(id) {
  const result = await api(`/api/twitch/streamers/${id}/check`, { method: "POST", body: "{}" });
  const status = liveStatusMeta(result.streamer);
  toast(`Twitch check: ${status.label}`, result.streamer?.liveStatus === "live" ? "good" : result.streamer?.liveStatus === "api_error" ? "bad" : "info");
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
  const agentForm = event.target.closest("#agent101-command-form, #global-agent101-command-form");
  const browserForm = event.target.closest("#browser-url-form");
  const browserTypeForm = event.target.closest("#browser-type-form");
  const mediaUploadForm = event.target.closest("#media-upload-form");
  const form = event.target.closest("#streamer-form");
  if (!agentForm && !browserForm && !browserTypeForm && !mediaUploadForm && !form) return;
  event.preventDefault();
  try {
    if (agentForm) {
      await runAgentCommand(agentForm);
      return;
    }
    if (browserForm) {
      await navigateBrowser(browserForm);
      return;
    }
    if (browserTypeForm) {
      const text = cleanCommand(browserTypeForm.elements.text?.value);
      if (!text) return;
      await sendBrowserInput({ action: "type", text });
      browserTypeForm.reset();
      toast("Text sent to browser", "good");
      renderNav();
      render();
      return;
    }
    if (mediaUploadForm) {
      await uploadMediaSource(mediaUploadForm);
      return;
    }
    await submitStreamer(form);
  } catch (error) {
    toast(error.message, "bad");
  }
});

document.addEventListener("click", async (event) => {
  const target = event.target;
  const navJump = target.closest("[data-nav-jump]");
  if (navJump) return setView(navJump.dataset.navJump);

  const openAgentChat = target.closest("[data-open-agent-chat]");
  const closeAgentChat = target.closest("[data-close-agent-chat]");
  const action = target.closest("[data-action]")?.dataset.action;
  const browserAction = target.closest("[data-browser-action]")?.dataset.browserAction;
  const browserTab = target.closest("[data-browser-tab]")?.dataset.browserTab;
  const browserShot = target.closest("[data-browser-shot]");
  const smokeClose = target.closest("[data-smoke-close]");
  const smokeRetry = target.closest("[data-smoke-retry]");
  const smokeCopy = target.closest("[data-smoke-copy]");
  const studioTab = target.closest("[data-studio-tab]")?.dataset.studioTab;
  const studioAction = target.closest("[data-studio-action]")?.dataset.studioAction;
  const studioCandidate = target.closest("[data-studio-select-candidate]")?.dataset.studioSelectCandidate;
  const previewCandidate = target.closest("[data-preview-candidate]")?.dataset.previewCandidate;
  const closePreview = target.closest("[data-close-preview]");
  const previewOpenBuilder = target.closest("[data-preview-open-builder]")?.dataset.previewOpenBuilder;
  const selectCandidate = target.closest("[data-select-candidate]")?.dataset.selectCandidate;
  const packageId = target.closest("[data-package-candidate]")?.dataset.packageCandidate;
  const saveDraftId = target.closest("[data-save-builder-draft]")?.dataset.saveBuilderDraft;
  const selectApproval = target.closest("[data-select-approval]")?.dataset.selectApproval;
  const scoreId = target.closest("[data-score-candidate]")?.dataset.scoreCandidate;
  const rejectId = target.closest("[data-reject-candidate]")?.dataset.rejectCandidate;
  const toggleId = target.closest("[data-toggle-monitor]")?.dataset.toggleMonitor;
  const approveStreamerId = target.closest("[data-approve-streamer]")?.dataset.approveStreamer;
  const checkStreamerId = target.closest("[data-check-streamer]")?.dataset.checkStreamer;
  const deleteId = target.closest("[data-delete-streamer]")?.dataset.deleteStreamer;
  const addRecommendation = target.closest("[data-add-recommendation]")?.dataset.addRecommendation;
  const requestPost = target.closest("[data-request-post]")?.dataset.requestPost;
  const gateApprove = target.closest("[data-gate-approve]")?.dataset.gateApprove;
  const gateReject = target.closest("[data-gate-reject]")?.dataset.gateReject;
  const gateSendBack = target.closest("[data-gate-sendback]")?.dataset.gateSendback;
  const selectStreamer = target.closest("[data-select-streamer]")?.dataset.selectStreamer;
  const focusAddStreamer = target.closest("[data-focus-add-streamer]");

  try {
    if (openAgentChat) {
      state.agentChatOpen = true;
      render();
      return;
    }
    if (closeAgentChat) {
      state.agentChatOpen = false;
      render();
      return;
    }
    if (closePreview) {
      state.previewCandidateId = "";
      render();
      return;
    }
    if (browserTab) {
      const active = state.browser?.activeSession || (state.browser?.sessions || []).find((session) => session.status !== "closed");
      if (active?.id) {
        await api(`/api/browser/sessions/${active.id}/tabs/${browserTab}`, { method: "PATCH", body: "{}" });
        state.browserScreenshotStamp = Date.now();
        await loadBrowserState();
        renderNav();
        render();
      }
      return;
    }
    if (browserShot && state.browser?.activeSession?.controlMode === "human_control") {
      const rect = browserShot.getBoundingClientRect();
      const naturalWidth = browserShot.naturalWidth || state.browser.activeSession.viewport?.width || 1440;
      const naturalHeight = browserShot.naturalHeight || state.browser.activeSession.viewport?.height || 900;
      const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * naturalWidth;
      const y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * naturalHeight;
      await sendBrowserInput({ action: "click", x, y });
      renderNav();
      render();
      return;
    }
    if (browserAction) {
      await handleBrowserAction(browserAction);
      return;
    }
    if (smokeClose) {
      state.smokeModalOpen = false;
      render();
      return;
    }
    if (smokeRetry) {
      await runSystemSmoke();
      return;
    }
    if (smokeCopy) {
      await navigator.clipboard?.writeText(JSON.stringify(state.smokeTest || {}, null, 2));
      toast("Smoke diagnostic report copied", "good");
      return;
    }
    if (studioTab) {
      setStudioTab(studioTab);
      return;
    }
    if (studioCandidate) {
      selectStudioCandidate(studioCandidate);
      return;
    }
    if (studioAction) {
      await runStudioAction(studioAction);
      return;
    }
    if (previewOpenBuilder) {
      state.selectedCandidateId = previewOpenBuilder;
      state.previewCandidateId = "";
      localStorage.setItem("selectedCandidateId", previewOpenBuilder);
      setView("builder");
      return;
    }
    if (previewCandidate) {
      state.selectedCandidateId = previewCandidate;
      state.previewCandidateId = previewCandidate;
      localStorage.setItem("selectedCandidateId", previewCandidate);
      render();
      return;
    }
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
    if (action === "scout-streamers") await scoutStreamers();
    if (action === "seed-demo") await seedDemo();
    if (action === "clear-demo") await clearDemo();
    if (agent101Goals[action]) await runAgent101(agent101Goals[action], "demo");
    if (action === "create-capcut") await createCapCut();
    if (action === "create-captions") await createCaptions();
    if (action === "test-openai") {
      const result = await api("/api/openai/test", { method: "POST", body: "{}" });
      toast(result.message || "OpenAI test complete", result.live ? "good" : "info");
    }
    if (action === "test-twitch") {
      const result = await api("/api/twitch/test", { method: "POST", body: "{}" });
      toast(result.message || "Twitch test complete", result.live ? "good" : "info");
    }
    if (action === "test-kick") {
      const result = await api("/api/kick/test", { method: "POST", body: "{}" });
      toast(result.message || "Kick test complete", result.live ? "good" : "info");
    }
    if (selectCandidate) {
      state.selectedCandidateId = selectCandidate;
      localStorage.setItem("selectedCandidateId", selectCandidate);
      render();
    }
    if (saveDraftId) await saveBuilderDraft(saveDraftId);
    if (selectApproval) {
      state.selectedApprovalId = selectApproval;
      localStorage.setItem("selectedApprovalId", selectApproval);
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
    if (checkStreamerId) await checkStreamer(checkStreamerId);
    if (deleteId) {
      await api(`/api/twitch/streamers/${deleteId}`, { method: "DELETE" });
      toast("Streamer deleted", "info");
      await refresh();
    }
    if (addRecommendation !== undefined) await addRecommendedStreamer(addRecommendation);
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
    renderNav();
    render();
  })
  .catch((error) => {
    $("#api-status").className = "pill bad";
    $("#api-status").textContent = "API error";
    view.innerHTML = `<section class="panel">${empty(error.message)}</section>`;
  });

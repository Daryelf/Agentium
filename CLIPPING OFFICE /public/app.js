const navItems = [
  ["dashboard", "Dashboard"],
  ["watchlist", "Stream Watchlist"],
  ["radar", "Clip Radar"],
  ["builder", "Clip Builder"],
  ["queue", "Posting Queue"],
  ["gate", "Human Gate"],
  ["outputs", "Outputs"],
  ["logs", "Logs"],
  ["settings", "Settings"]
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
  selectedCandidateId: localStorage.getItem("selectedCandidateId") || ""
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
}

function renderNav() {
  $("#nav").innerHTML = navItems
    .map(([id, label]) => `<button class="${state.view === id ? "active" : ""}" data-nav="${id}">${label}</button>`)
    .join("");
  $("#nav").addEventListener("click", (event) => {
    const button = event.target.closest("[data-nav]");
    if (!button) return;
    setView(button.dataset.nav);
  });
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
  const pendingCandidates = state.candidates.filter((candidate) => candidate.status === "candidate").length;
  const ready = state.candidates.filter((candidate) => candidate.status === "packaged").length;
  const queuedToday = state.drafts.filter((draft) => (draft.createdAt || "").slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
  const pendingApprovals = state.approvals.filter((approval) => approval.status === "pending").length;
  view.innerHTML = `
    <div class="grid cols-4">
      ${metric("Watched Streams", state.streamers.filter((item) => item.monitorEnabled).length)}
      ${metric("Approved Streamers", state.streamers.filter((item) => item.permissionStatus === "approved").length)}
      ${metric("Clip Candidates", pendingCandidates)}
      ${metric("Human Gate", pendingApprovals)}
    </div>
    <div class="grid cols-3">
      ${metric("Ready Packages", ready)}
      ${metric("Posts Queued Today", queuedToday)}
      ${metric("Daily Limit", `${state.drafts.filter((draft) => draft.approvalStatus === "approved").length}/${state.config?.postDailyLimit || 20}`)}
    </div>
    <section class="panel">
      <div class="toolbar">
        <h2>Live Desk</h2>
        <div class="actions">
          <button class="primary" data-action="run-watch">Run Watch Cycle</button>
          <button data-nav-jump="gate">Open Human Gate</button>
        </div>
      </div>
      ${state.streamers.length ? renderStreamerTable(false) : empty("No streamers yet")}
    </section>
  `;
}

function metric(label, value) {
  return `<section class="panel metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></section>`;
}

function renderWatchlist() {
  view.innerHTML = `
    <section class="panel">
      <h2>Add Streamer</h2>
      <form id="streamer-form" class="form-grid">
        <label>Name <input name="displayName" required placeholder="creatorname"></label>
        <label>Platform
          <select name="platform">
            <option value="twitch">Twitch</option>
            <option value="youtube_live">YouTube Live</option>
            <option value="kick">Kick</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>Channel ID / Login <input name="channelId" required placeholder="creatorname"></label>
        <label>Channel URL <input name="channelUrl" placeholder="https://www.twitch.tv/creatorname"></label>
        <label>Permission
          <select name="permissionStatus">
            <option value="approved">approved</option>
            <option value="pending">pending</option>
            <option value="blocked">blocked</option>
          </select>
        </label>
        <label>Monitor
          <select name="monitorEnabled">
            <option value="true">on</option>
            <option value="false">off</option>
          </select>
        </label>
        <div class="wide">
          <span class="muted">Allowed use</span>
          <div class="check-row">
            ${["clips", "reposts", "edits", "monetized"].map((use) => `<label><input type="checkbox" name="allowedUse" value="${use}" ${use === "clips" ? "checked" : ""}>${use}</label>`).join("")}
          </div>
        </div>
        <label class="wide">Notes <textarea name="notes" placeholder="Permission source, contract note, owner note"></textarea></label>
        <div class="actions wide">
          <button class="primary" type="submit">Add Streamer</button>
        </div>
      </form>
    </section>
    <section class="panel">
      <div class="toolbar">
        <h2>Watchlist</h2>
        <button data-action="run-watch">Run Watch Cycle</button>
      </div>
      ${state.streamers.length ? renderStreamerTable(true) : empty("No streamers added")}
    </section>
  `;
}

function renderStreamerTable(editable) {
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Streamer</th>
            <th>Platform</th>
            <th>Permission</th>
            <th>Allowed Use</th>
            <th>Monitor</th>
            <th>Live</th>
            <th>Last Checked</th>
            ${editable ? "<th>Actions</th>" : ""}
          </tr>
        </thead>
        <tbody>
          ${state.streamers.map((streamer) => `
            <tr>
              <td><strong>${esc(streamer.displayName)}</strong><br><span class="muted">${esc(streamer.channelId || streamer.channelUrl)}</span></td>
              <td>${esc(streamer.platform)}</td>
              <td>${permissionBadge(streamer.permissionStatus)}</td>
              <td>${esc((streamer.allowedUse || []).join(", "))}</td>
              <td>${streamer.monitorEnabled ? badge("on", "good") : badge("off", "neutral")}</td>
              <td>${esc(streamer.liveStatus || "unknown")}</td>
              <td>${fmtDate(streamer.lastCheckedAt)}</td>
              ${editable ? `<td><div class="actions">
                <button data-toggle-monitor="${streamer.id}">${streamer.monitorEnabled ? "Pause" : "Monitor"}</button>
                <button data-approve-streamer="${streamer.id}">Approve</button>
                <button class="danger" data-delete-streamer="${streamer.id}">Delete</button>
              </div></td>` : ""}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function permissionBadge(status) {
  if (status === "approved") return badge("approved", "good");
  if (status === "blocked") return badge("blocked", "bad");
  return badge("pending", "warn");
}

function renderRadar() {
  view.innerHTML = `
    <section class="panel">
      <div class="toolbar">
        <h2>Clip Radar</h2>
        <div class="actions">
          <button class="primary" data-action="run-watch">Run Watch Cycle</button>
          <button data-action="refresh">Refresh</button>
        </div>
      </div>
      <div class="card-list">
        ${state.candidates.length ? state.candidates.map(renderCandidateCard).join("") : empty("No candidates yet")}
      </div>
    </section>
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

  try {
    if (action === "refresh") await refresh();
    if (action === "run-watch") await runWatch();
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
      setView("builder");
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

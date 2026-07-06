const apiBasePath = window.location.pathname.startsWith("/apps/clipping-office")
  ? "/apps/clipping-office"
  : "";
const verticalShortWorkflowId = "vertical_916_auto_frame_blur_background_bottom_sticker";

function loadSavedWorkflowInputs() {
  try {
    const parsed = JSON.parse(localStorage.getItem("capcutWorkflowInputs") || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const state = {
  config: null,
  twitch: { configured: false, status: "checking" },
  kick: { configured: false, status: "checking" },
  streams: [],
  clips: [],
  lastQuery: "",
  visibleCount: 5,
  selectedStreamKey: "",
  loading: false,
  capcut: {
    status: null,
    teach: null,
    macros: [],
    workflows: [],
    planner: null,
    replay: null,
    macroName: localStorage.getItem("capcutMacroName") || "vertical_916_blur_background_sticker",
    workflowInputs: loadSavedWorkflowInputs(),
    selectedBuilderClipId: localStorage.getItem("capcutSelectedBuilderClipId") || "",
    selectedBuilderClip: null,
    workflowInputStatus: null,
    agentStatus: null,
    snapshotBusy: false,
    lastTeachSnapshotAt: 0,
    loading: false,
    dragMacroId: "",
    // Macro Library starts collapsed so the Determinism Monitor gets focus;
    // both remember the operator's last choice.
    macroLibraryCollapsed: localStorage.getItem("capcutMacroLibraryCollapsed") !== "false",
    monitorCollapsed: localStorage.getItem("capcutMonitorCollapsed") === "true",
    error: ""
  },
  watch: {
    stream: null,
    streamer: null,
    session: null,
    events: [],
    detailOpen: false,
    keywordOpen: false,
    loading: false,
    error: ""
  },
  watchPollTimer: null
};

const $ = (selector) => document.querySelector(selector);

function apiUrl(path) {
  return `${apiBasePath}${path.startsWith("/") ? path : `/${path}`}`;
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return new Intl.NumberFormat().format(number);
}

function formatSeconds(value) {
  const seconds = Math.max(0, Math.round(Number(value || 0)));
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return mins ? `${mins}:${String(rem).padStart(2, "0")}` : `${rem}s`;
}

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs || 15000);
  try {
    const response = await fetch(apiUrl(path), {
      ...options,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {})
      }
    });
    const contentType = response.headers.get("content-type") || "";
    const json = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : {};
    if (!response.ok) throw new Error(json.error || json.message || `${response.status} ${response.statusText}`);
    return json;
  } finally {
    window.clearTimeout(timeout);
  }
}

function normalizeTwitchStream(stream) {
  return {
    id: stream.id || stream.streamId || `twitch:${stream.userLogin || stream.channelId || stream.displayName}`,
    platform: "twitch",
    displayName: stream.displayName || stream.userName || stream.userLogin || "Twitch streamer",
    channelId: stream.userLogin || stream.channelId || stream.providerUserId || "",
    channelUrl: stream.userLogin ? `https://www.twitch.tv/${stream.userLogin}` : stream.channelUrl || "",
    title: stream.title || "Live on Twitch",
    category: stream.gameName || stream.category || "Twitch",
    viewerCount: Number(stream.viewerCount || 0),
    thumbnail: stream.thumbnailUrl || stream.thumbnail || "",
    startedAt: stream.startedAt || "",
    source: "Official Twitch API",
    liveVerified: true
  };
}

function normalizeRecommendation(item) {
  return {
    id: `${item.platform}:${item.channelId || item.displayName}`,
    platform: item.platform || "twitch",
    displayName: item.displayName || item.channelId || "Live streamer",
    channelId: item.channelId || "",
    channelUrl: item.channelUrl || "",
    title: item.title || `Live on ${item.platform || "stream"}`,
    category: item.category || item.gameName || item.platform || "Live",
    viewerCount: Number(item.viewerCount || 0),
    thumbnail: item.thumbnail || item.thumbnailUrl || "",
    startedAt: item.startedAt || "",
    source: item.source || "Official provider API",
    liveVerified: item.liveVerified !== false && item.sourceType === "official_live"
  };
}

function mergeStreams(...groups) {
  const seen = new Set();
  return groups
    .flat()
    .filter(Boolean)
    .filter((stream) => {
      const key = `${stream.platform}:${String(stream.channelId || stream.displayName).toLowerCase()}`;
      if (!stream.liveVerified || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Number(b.viewerCount || 0) - Number(a.viewerCount || 0));
}

function matchesQuery(stream, query) {
  if (!query) return true;
  const haystack = [
    stream.displayName,
    stream.channelId,
    stream.title,
    stream.category,
    stream.platform
  ].join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function streamKey(stream = {}) {
  return `${stream.platform}:${stream.channelId || stream.displayName}`.toLowerCase();
}

function streamFromWatchSession(session = {}, streamer = {}) {
  const thumbnail = String(streamer.liveThumbnailUrl || streamer.thumbnail || "")
    .replace("{width}", "480")
    .replace("{height}", "270");
  return {
    id: session.id || streamer.id || "",
    platform: streamer.platform || "twitch",
    displayName: streamer.displayName || session.streamerName || "Watched stream",
    channelId: streamer.channelId || streamer.displayName || session.streamerName || "",
    channelUrl: streamer.channelUrl || "",
    title: streamer.liveTitle || session.title || session.currentStage || "Live stream",
    category: streamer.liveCategory || session.category || "Live",
    viewerCount: Number(streamer.liveViewerCount || session.viewerCount || 0),
    thumbnail,
    source: "Active backend watcher",
    liveVerified: true
  };
}

function setPill(provider, status) {
  const pill = $(`#${provider}-pill`);
  const count = $(`#${provider}-live-count`);
  const label = $(`#${provider}-connection-status`);
  if (!pill || !count || !label) return;

  const providerStreams = state.streams.filter((stream) => stream.platform === provider);
  count.textContent = String(providerStreams.length);
  if (status.configured) {
    pill.dataset.state = providerStreams.length ? "live" : "configured";
    label.textContent = providerStreams.length ? "live" : "ready";
  } else if (status.error) {
    pill.dataset.state = "error";
    label.textContent = "error";
  } else {
    pill.dataset.state = "offline";
    label.textContent = "not configured";
  }
}

function renderStatus(message = "") {
  const node = $("#search-status");
  if (!node) return;
  node.textContent = message;
}

function thumbnailUrl(stream) {
  return String(stream.thumbnail || "")
    .replaceAll("{width}", "640")
    .replaceAll("{height}", "360");
}

function streamCard(stream) {
  const thumb = thumbnailUrl(stream);
  const initials = String(stream.displayName || "S").slice(0, 2).toUpperCase();
  const key = streamKey(stream);
  const selected = state.selectedStreamKey === key;
  return `
    <article class="stream-card ${selected ? "selected" : ""}">
      <div class="stream-thumb">
        ${thumb ? `<img src="${esc(thumb)}" alt="">` : `<span>${esc(initials)}</span>`}
      </div>
      <div class="stream-card-body">
        <div class="stream-card-top">
          <span class="platform-badge ${esc(stream.platform)}">${esc(stream.platform.toUpperCase())}</span>
          <strong>${formatNumber(stream.viewerCount)} watching</strong>
        </div>
        <h2>${esc(stream.displayName)}</h2>
        <p>${esc(stream.title)}</p>
        <div class="stream-meta">
          <span>${esc(stream.category)}</span>
          <span>${esc(stream.source)}</span>
        </div>
        <div class="stream-actions">
          ${stream.channelUrl ? `<a href="${esc(stream.channelUrl)}" target="_blank" rel="noreferrer">Open</a>` : ""}
          <button type="button" data-watch-streamer="${esc(key)}">${selected ? "Watching" : "Watch"}</button>
        </div>
      </div>
    </article>
  `;
}

function renderStreams() {
  const query = state.lastQuery.trim();
  const rows = state.streams.filter((stream) => matchesQuery(stream, query));
  const visibleRows = rows.slice(0, state.visibleCount);
  const grid = $("#stream-results");
  if (!grid) return;

  setPill("twitch", state.twitch);
  setPill("kick", state.kick);

  if (state.loading) {
    grid.innerHTML = `<div class="empty-state">Searching live streams...</div>`;
    return;
  }

  if (!rows.length) {
    const providerText = state.twitch.configured || state.kick.configured
      ? "No live streams matched that search. Try a creator, category, or leave search blank."
      : "Twitch/Kick credentials are not configured in this runtime.";
    grid.innerHTML = `<div class="empty-state">${esc(providerText)}</div>`;
    return;
  }

  grid.innerHTML = `
    ${visibleRows.map(streamCard).join("")}
    ${state.visibleCount < rows.length ? `
      <div class="more-row">
        <button type="button" data-more-streams>More</button>
        <span>${visibleRows.length} of ${rows.length} shown</span>
      </div>
    ` : ""}
  `;
  renderStatus(`${visibleRows.length} of ${rows.length} live stream${rows.length === 1 ? "" : "s"} shown`);
  renderWatchArea();
  renderClipsArea();
}

async function loadProviderStatus() {
  const [config, twitch, kick] = await Promise.all([
    api("/api/config").catch(() => null),
    api("/api/twitch/status?validate=false").catch((error) => ({ configured: false, error: error.message })),
    api("/api/kick/status").catch((error) => ({ configured: false, error: error.message }))
  ]);
  state.config = config;
  state.twitch = twitch;
  state.kick = kick;
  setPill("twitch", twitch);
  setPill("kick", kick);
}

async function searchStreams() {
  const input = $("#stream-search-input");
  const button = $("#stream-search-button");
  state.lastQuery = input?.value || "";
  state.visibleCount = 5;
  state.loading = true;
  if (button) {
    button.disabled = true;
    button.textContent = "Searching";
  }
  renderStatus("Searching official provider APIs...");
  renderStreams();

  try {
    await loadProviderStatus();
    const requests = [];
    if (state.twitch.configured) {
      requests.push(
        api("/api/twitch/live-streams?count=30")
          .then((result) => (result.streams || []).map(normalizeTwitchStream))
      );
    }
    if (state.kick.configured || state.twitch.configured) {
      requests.push(
        api("/api/streamers/recommendations?platform=all&limit=30")
          .then((result) => (result.recommendations || []).map(normalizeRecommendation))
      );
    }

    const settled = await Promise.allSettled(requests);
    const streams = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const errors = settled.filter((result) => result.status === "rejected").map((result) => result.reason?.message).filter(Boolean);
    state.streams = mergeStreams(streams);
    if (errors.length && !state.streams.length) {
      renderStatus(errors[0]);
    } else {
      renderStatus(`${state.streams.length} live stream${state.streams.length === 1 ? "" : "s"} found`);
    }
  } catch (error) {
    state.streams = [];
    renderStatus(error.message || "Search failed");
  } finally {
    state.loading = false;
    if (button) {
      button.disabled = false;
      button.textContent = "Search";
    }
    renderStreams();
  }
}

function findStreamByKey(key) {
  return state.streams.find((stream) => streamKey(stream) === String(key || "").toLowerCase()) || null;
}

async function upsertStreamer(stream, { monitorEnabled = false } = {}) {
  return api("/api/twitch/streamers", {
    method: "POST",
    body: JSON.stringify({
      platform: stream.platform,
      displayName: stream.displayName,
      channelId: stream.channelId,
      channelUrl: stream.channelUrl,
      liveStatus: "live",
      permissionStatus: "approved",
      monitorEnabled,
      allowedUse: ["clips", "edits", "reposts"],
      notes: `Added from live stream search. ${stream.viewerCount} viewers.`
    })
  });
}

function latestSignalEvents() {
  return (state.watch.events || []).filter((event) =>
    ["chat_spike_detected", "chat_keyword_detected", "tension_emote_spike", "recording_window_low_score", "recording_window_created", "candidate_review", "source_capture_completed", "source_connected", "source_capability_degraded"].includes(event.type)
  ).slice(-10).reverse();
}

function watchEventLabel(event = {}) {
  return String(event.type || "signal").replaceAll("_", " ");
}

function watchEventMessage(event = {}) {
  const payload = event.payload || {};
  return payload.message
    || payload.reason
    || payload.matchedKeywords?.join(", ")
    || payload.keywords?.join(", ")
    || "Signal logged";
}

function watchStatusText(session, stage) {
  if (state.watch.error) return "Needs attention";
  if (!session) return stage;
  if (session.status === "watching") return "Watching";
  return session.status || stage;
}

function watchMediaStatus(capabilities = {}) {
  if (capabilities.hasLiveVideo && capabilities.hasAudio) return "Verified video + audio";
  if (capabilities.hasLiveVideo) return "Verified video";
  return "Recorder waiting";
}

function uniqueKeywords(items = []) {
  const seen = new Set();
  return items
    .flatMap((item) => Array.isArray(item) ? item : [item])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function detectedWatchKeywords(session, events = []) {
  const eventKeywords = (events || []).flatMap((event) => {
    const payload = event.payload || {};
    return [
      payload.keyword,
      payload.matchedKeyword,
      payload.matchedKeywords,
      payload.keywords
    ];
  });
  return uniqueKeywords([session?.lastChatKeyword, eventKeywords]);
}

function allWatchKeywords(session, keywords = [], events = []) {
  return uniqueKeywords([detectedWatchKeywords(session, events), keywords]);
}

function topWatchKeywords(session, keywords = [], events = [], limit = 5) {
  return allWatchKeywords(session, keywords, events).slice(0, limit);
}

function watchKeywordStatus(session, keywords = [], events = []) {
  const topKeywords = topWatchKeywords(session, keywords, events, 5);
  return topKeywords.length ? topKeywords.join(", ") : "No keywords armed";
}

function renderKeywordModal({ session, events, keywords }) {
  if (!state.watch.keywordOpen) return "";
  const detected = detectedWatchKeywords(session, events);
  const topKeywords = topWatchKeywords(session, keywords, events, 5);
  const allKeywords = allWatchKeywords(session, keywords, events);
  return `
    <div class="watch-modal" data-keywords-modal>
      <div class="watch-modal-card keyword-card" role="dialog" aria-modal="true" aria-label="Watch keywords">
        <div class="watch-modal-head">
          <div>
            <span class="watch-kicker">Keyword Intelligence</span>
            <h3>Watch triggers</h3>
            <p>Top triggers are shown in the watch bar. The full armed list stays available here.</p>
          </div>
          <button type="button" class="icon-close" data-close-keywords aria-label="Close keywords">&times;</button>
        </div>
        <div class="keyword-section">
          <h4>Top 5 now</h4>
          <div class="keyword-cloud hot">
            ${topKeywords.length ? topKeywords.map((keyword) => `<span>${esc(keyword)}</span>`).join("") : `<span>No keywords armed</span>`}
          </div>
        </div>
        <div class="keyword-section">
          <h4>Detected in this watch</h4>
          <div class="keyword-cloud detected">
            ${detected.length ? detected.map((keyword) => `<span>${esc(keyword)}</span>`).join("") : `<span>No live keyword hits yet</span>`}
          </div>
        </div>
        <div class="keyword-section">
          <h4>All armed keywords</h4>
          <div class="keyword-cloud">
            ${allKeywords.length ? allKeywords.map((keyword) => `<span>${esc(keyword)}</span>`).join("") : `<span>No configured keyword list found</span>`}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderWatchDetailModal({ stream, session, events, score, chatPpm, keywords, capabilities }) {
  if (!state.watch.detailOpen) return "";
  const recentClips = currentClips().slice(0, 5);
  return `
    <div class="watch-modal" data-watch-detail-modal>
      <div class="watch-modal-card" role="dialog" aria-modal="true" aria-label="Watch details">
        <div class="watch-modal-head">
          <div>
            <span class="watch-kicker">Signal Detail</span>
            <h3>${esc(stream.displayName)}</h3>
            <p>${esc(stream.title || "Live stream")}</p>
          </div>
          <button type="button" class="icon-close" data-close-watch-detail aria-label="Close details">&times;</button>
        </div>
        <div class="watch-modal-grid">
          <div>
            <small>Status</small>
            <strong>${esc(watchStatusText(session, session?.currentStage || "Ready"))}</strong>
            <span>${esc(session?.currentStage || "Waiting for watcher")}</span>
          </div>
          <div>
            <small>Clip signal</small>
            <strong>${score}%</strong>
            ${renderSignalMeter(score)}
          </div>
          <div>
            <small>Chat velocity</small>
            <strong>${formatNumber(chatPpm)}/min</strong>
            <span>${esc(watchKeywordStatus(session, keywords, events))}</span>
          </div>
          <div>
            <small>Video/audio</small>
            <strong>${esc(watchMediaStatus(capabilities))}</strong>
            <span>${capabilities.hasLiveVideo ? "Local MP4 source ready" : "Waiting for recorder buffer"}</span>
          </div>
        </div>
        <div class="watch-modal-section">
          <h4>Chat + Capture Signals</h4>
          <div class="watch-events detail">
            ${events.length ? events.map((event) => `
              <span>
                <b>${esc(watchEventLabel(event))}</b>
                <em>${esc(watchEventMessage(event))}</em>
              </span>
            `).join("") : `<span><b>Waiting</b><em>No chat spike or capture signal has been logged yet.</em></span>`}
          </div>
        </div>
        <div class="watch-modal-section">
          <h4>Saved Clip Windows</h4>
          <div class="watch-mini-clips">
            ${recentClips.length ? recentClips.map((clip) => `
              <span>
                <b>${esc(clip.title || "Clip window")}</b>
                <em>${esc(clipStatusLabel(clip))} · ${formatSeconds(clip.durationSeconds || clip.duration || 30)} · ${Number(clip.score || 0) || 0}%</em>
              </span>
            `).join("") : `<span><b>No MP4 yet</b><em>Capture is armed for the next qualifying window.</em></span>`}
          </div>
        </div>
      </div>
    </div>
  `;
}

function currentClips() {
  const sessionId = state.watch.session?.id || "";
  const streamerId = state.watch.streamer?.id || "";
  if (!sessionId && !streamerId) return [];
  return (state.clips || [])
    .filter((clip) => {
      if (clipApprovedForBuilder(clip) || clipDeclined(clip)) return false;
      if (sessionId && clip.watchSessionId === sessionId) return true;
      if (streamerId && clip.streamerId === streamerId) return true;
      return false;
    })
    .sort((a, b) => String(b.createdAt || b.updatedAt || "").localeCompare(String(a.createdAt || a.updatedAt || "")))
    .slice(0, 10);
}

function clipPlaybackUrl(clip = {}) {
  if (clip.mediaPlayable && clip.sourceId) return apiUrl(`/api/media/sources/${encodeURIComponent(clip.sourceId)}/playback`);
  if (clip.playbackUrl) return apiUrl(clip.playbackUrl);
  return "";
}

function clipStatusLabel(clip = {}) {
  if (clip.builderApproved || clip.builderStatus === "approved" || clip.status === "builder_ready") return "Builder ready";
  if (clip.mediaPlayable || clip.bufferStatus === "verified_media_window") return "MP4 saved";
  if (clip.bufferStatus === "source_pending") return "Waiting for MP4";
  return clip.status || clip.decision || "Tracking";
}

function clipApprovedForBuilder(clip = {}) {
  return Boolean(clip.builderApproved || clip.builderStatus === "approved" || clip.status === "builder_ready");
}

function clipDeclined(clip = {}) {
  return Boolean(clip.operatorDeclined || clip.declinedAt || clip.status === "rejected" || clip.decision === "rejected");
}

function renderClipItem(clip) {
  const playback = clipPlaybackUrl(clip);
  const score = Number(clip.score || clip.qualityScore || 0);
  const approved = clipApprovedForBuilder(clip);
  return `
    <article class="clip-item ${playback ? "ready" : "pending"} ${approved ? "approved" : ""}">
      <div>
        <span>${esc(clipStatusLabel(clip))}</span>
        <strong>${esc(clip.title || "Clip window")}</strong>
        <small>${esc(clip.streamerName || "Watched stream")} · ${formatSeconds(clip.durationSeconds || clip.duration || state.config?.recordingWindowSeconds || 30)} · ${score ? `${score}% signal` : "scoring pending"} · target 9:16</small>
      </div>
      <div class="clip-actions">
        ${playback ? `<a href="${esc(playback)}" target="_blank" rel="noreferrer">View MP4</a>` : `<button type="button" disabled>Pending</button>`}
        ${playback ? `<button type="button" data-approve-clip="${esc(clip.id)}" ${approved ? "disabled" : ""}>${approved ? "Approved" : "Approve"}</button>` : ""}
        <button type="button" class="decline" data-decline-clip="${esc(clip.id)}">Decline</button>
      </div>
    </article>
  `;
}

function builderClips() {
  return (state.clips || []).filter((clip) => clipApprovedForBuilder(clip) && !clipDeclined(clip));
}

function selectedBuilderClip() {
  const clips = builderClips();
  return clips.find((clip) => clip.id === state.capcut.selectedBuilderClipId)
    || state.capcut.selectedBuilderClip
    || clips[0]
    || null;
}

function fileNameFromPath(value = "") {
  const clean = String(value || "").split(/[?#]/)[0];
  return clean.split(/[\\/]/).filter(Boolean).pop() || clean || "";
}

function workflowInputReady(inputs = state.capcut.workflowInputs || {}) {
  return Boolean(inputs.projectName && inputs.outputProjectFolder);
}

function boolLabel(value) {
  return value ? "yes" : "no";
}

function renderCapCutStatusValue(label, value, detail = "", displayValue = null) {
  const normalized = String(displayValue ?? boolLabel(value)).toLowerCase();
  const statusClass = normalized === "yes" || normalized === "granted" || normalized === "running" ? "good" : (normalized === "unknown" ? "unknown" : "bad");
  return `
    <span class="${statusClass}">
      <small>${esc(label)}</small>
      <b>${esc(displayValue ?? boolLabel(value))}</b>
      ${detail ? `<em>${esc(detail)}</em>` : ""}
    </span>
  `;
}

function macroStepTitle(step = {}) {
  if (step.type === "capcut/importSourceVideo") return "Legacy system import";
  if (step.type === "scroll") return "Scroll inside CapCut";
  if (step.type === "wait") {
    const waitMs = Number.isFinite(Number(step.ms)) ? Math.max(0, Math.min(120000, Math.round(Number(step.ms)))) : 0;
    return `Wait ${waitMs}ms`;
  }
  return step.description || step.type || "Macro step";
}

function macroStepDetail(step = {}) {
  if (step.type === "capcut/importSourceVideo") {
    return "Legacy import step. New training records clip selection manually instead.";
  }
  const phasePrefix = step.phaseLabel ? `${step.phaseLabel} · ` : "";
  const semantic = step.semanticTarget || {};
  const semanticDetail = semantic.label
    ? `target "${semantic.label}"${semantic.region ? ` in ${semantic.region.replace(/_/g, " ")}` : ""}`
    : semantic.region
      ? `target region ${semantic.region.replace(/_/g, " ")}`
      : "";
  if (step.type === "scroll") {
    const target = Number.isFinite(Number(step.xRatio)) && Number.isFinite(Number(step.yRatio))
      ? `CapCut ${Math.round(Number(step.xRatio) * 100)}%, ${Math.round(Number(step.yRatio) * 100)}%`
      : `${Math.round(Number(step.x || 0))}, ${Math.round(Number(step.y || 0))}`;
    return `${phasePrefix}${[semanticDetail, `scroll ${Math.round(Number(step.deltaX || 0))}, ${Math.round(Number(step.deltaY || 0))} at ${target}`].filter(Boolean).join(" · ")}`;
  }
  const relativePoint = Number.isFinite(Number(step.xRatio)) && Number.isFinite(Number(step.yRatio))
    ? `CapCut ${Math.round(Number(step.xRatio) * 100)}%, ${Math.round(Number(step.yRatio) * 100)}%`
    : "";
  const relativeDrag = Number.isFinite(Number(step.fromXRatio)) && Number.isFinite(Number(step.toXRatio))
    ? `CapCut ${Math.round(Number(step.fromXRatio) * 100)}% -> ${Math.round(Number(step.toXRatio) * 100)}%`
    : "";
  const detail = [
    semanticDetail,
    step.type,
    step.keys?.length ? step.keys.join("+") : "",
    step.type === "wait" && Number.isFinite(Number(step.ms)) ? `${Math.max(0, Math.min(120000, Math.round(Number(step.ms))))}ms` : "",
    relativePoint || relativeDrag || (Number.isFinite(Number(step.x)) ? `${Math.round(step.x)}, ${Math.round(step.y || 0)}` : ""),
    step.activeWindowTitle || step.activeApp || ""
  ].filter(Boolean).join(" · ");
  return `${phasePrefix}${detail}`;
}

function macroStepScreenshot(step = {}, key = "screenshotBefore", label = "Before") {
  const screenshot = step[key] || {};
  return screenshot.url ? `
    <figure>
      <img src="${esc(apiUrl(screenshot.url))}" alt="${esc(label)} step screenshot">
      <figcaption>${esc(label)}</figcaption>
    </figure>
  ` : `
    <div class="step-shot-empty">${esc(label)} screenshot missing</div>
  `;
}

function teachVisionShots(teach = {}, steps = []) {
  const shots = [];
  for (const snapshot of teach.liveSnapshots || []) {
    if (snapshot?.screenshot?.url) {
      shots.push({
        id: snapshot.id || snapshot.screenshot.id,
        label: snapshot.phaseLabel || snapshot.label || "Teaching",
        detail: `${snapshot.reason || "snapshot"} · ${Number(snapshot.stepCount || 0)} steps`,
        createdAt: snapshot.createdAt || snapshot.screenshot.createdAt || "",
        screenshot: snapshot.screenshot
      });
    }
  }
  for (const [index, step] of steps.entries()) {
    const screenshot = step.screenshotAfter || step.screenshotBefore || null;
    if (screenshot?.url) {
      shots.push({
        id: `${index}-${screenshot.id || "step"}`,
        label: `Step ${index + 1}`,
        detail: macroStepTitle(step),
        createdAt: screenshot.createdAt || step.timestamp || "",
        screenshot
      });
    }
  }
  const unique = new Map();
  for (const shot of shots) unique.set(shot.screenshot.url, shot);
  return Array.from(unique.values())
    .sort((a, b) => Date.parse(a.createdAt || "") - Date.parse(b.createdAt || ""))
    .slice(-12);
}

function renderTeachingVisionPanel(teach = {}, steps = [], recording = false) {
  const shots = teachVisionShots(teach, steps);
  const latest = shots.at(-1);
  return `
    <section class="teaching-vision">
      <div class="teaching-vision-head">
        <div>
          <span class="watch-kicker">Teaching Vision</span>
          <h3>${latest ? "Latest CapCut frame" : "No teaching frames yet"}</h3>
        </div>
        <button type="button" data-teach-snapshot ${state.capcut.snapshotBusy ? "disabled" : ""}>Capture now</button>
      </div>
      <div class="teaching-vision-main">
        ${latest?.screenshot?.url ? `
          <figure>
            <img src="${esc(apiUrl(latest.screenshot.url))}" alt="Latest CapCut teaching screenshot">
            <figcaption>
              <strong>${esc(latest.label)}</strong>
              <span>${esc(latest.detail)}${recording ? " · recording" : ""}</span>
            </figcaption>
          </figure>
        ` : `
          <div class="capcut-shot-empty">Start recording or capture the CapCut screen.</div>
        `}
        <div class="vision-strip">
          ${shots.length ? shots.map((shot) => `
            <span title="${esc(`${shot.label} · ${shot.detail}`)}">
              <img src="${esc(apiUrl(shot.screenshot.url))}" alt="${esc(shot.label)}">
              <small>${esc(shot.label)}</small>
            </span>
          `).join("") : `
            <span class="vision-empty">Waiting for CapCut frames</span>
          `}
        </div>
      </div>
    </section>
  `;
}

function renderMacroStep(step, index) {
  const title = macroStepTitle(step);
  const recording = Boolean(state.capcut.teach?.recording);
  const replay = activeReplayForTeach();
  const stepNumber = index + 1;
  const statusClass = macroStepStatusClass(stepNumber, replay);
  const detail = macroStepDetail(step);
  const waitMs = Number.isFinite(Number(step.ms)) ? Math.max(0, Math.min(120000, Math.round(Number(step.ms)))) : 0;
  return `
    <li class="${statusClass}">
      <b>${index + 1}</b>
      <span>
        <strong>${esc(title)}</strong>
        <small>${esc(detail)}</small>
        ${step.type === "wait" ? `
          <span class="macro-step-wait">
            <small>Wait ms</small>
            <input type="number" min="0" max="120000" step="100" value="${waitMs}" data-wait-step-ms="${index}" ${recording ? "disabled" : ""} />
            <button type="button" data-update-wait-step="${index}" ${recording ? "disabled" : ""}>Save wait</button>
          </span>
        ` : ""}
        <span class="macro-step-actions">
          ${["click", "doubleClick"].includes(step.type) ? `<button type="button" data-target-teach-step="${index}" ${recording ? "disabled" : ""}>Set target</button>` : ""}
          <button type="button" data-delete-teach-step="${index}" ${recording ? "disabled" : ""}>Delete</button>
          <button type="button" class="danger" data-trim-teach-step="${index}" ${recording ? "disabled" : ""}>Delete from here</button>
        </span>
      </span>
    </li>
  `;
}

function activeReplayForTeach() {
  const replay = state.capcut.replay || null;
  const teach = state.capcut.teach || {};
  if (!replay) return null;
  if (!replay.running && !["failed", "cancelled", "complete", "needs_review"].includes(replay.status)) return null;
  if (!teach.savedMacroId && !teach.name) return replay;
  if (teach.savedMacroId && replay.macroId && teach.savedMacroId !== replay.macroId) return null;
  if (!teach.savedMacroId && teach.name && replay.macroName && teach.name !== replay.macroName) return null;
  return replay;
}

function macroStepStatusClass(stepNumber, replay = null) {
  if (!replay) return "";
  if (Number(replay.failedStepIndex || 0) === stepNumber) return "failed";
  if (replay.running && Number(replay.currentStepIndex || 0) === stepNumber) return "running";
  const log = Array.isArray(replay.log) ? replay.log : [];
  const event = log.find((item) => Number(item.index) + 1 === stepNumber);
  if (event?.status?.includes?.("failed")) return "failed";
  if (event?.status) return "done";
  if (replay.running && Number(replay.currentStepIndex || 0) > stepNumber) return "done";
  return "";
}

function renderReplayStepStrip() {
  const replay = activeReplayForTeach();
  if (!replay) return "";
  const current = Math.max(0, Number(replay.currentStepIndex || 0));
  const total = Math.max(0, Number(replay.totalSteps || 0));
  const failed = Number(replay.failedStepIndex || 0);
  const title = failed
    ? `Stopped at step ${failed}${total ? ` of ${total}` : ""}`
    : replay.running
      ? `Running step ${current || 1}${total ? ` of ${total}` : ""}`
      : `${replay.status || "Replay"}${current ? ` at step ${current}` : ""}${total ? ` of ${total}` : ""}`;
  const detail = failed
    ? `${replay.failedStepDescription || replay.currentStepDescription || "Step failed"}${replay.failedStepError ? `: ${replay.failedStepError}` : ""}`
    : replay.currentStepDescription || replay.stopReason || "Waiting for the next macro action";
  return `
    <div class="replay-step-strip ${failed ? "failed" : replay.running ? "running" : "idle"}">
      <div>
        <small>${esc(replay.macroName || "CapCut macro")}</small>
        <strong>${esc(title)}</strong>
        <span>${esc(detail)}</span>
      </div>
      <b>${esc(replay.currentStepStatus || replay.status || "idle")}</b>
    </div>
  `;
}

function renderStepInspector(steps = []) {
  const replay = activeReplayForTeach();
  if (!replay || !steps.length) return "";
  const failed = Number(replay.failedStepIndex || 0);
  const current = Number(replay.currentStepIndex || 0);
  const stepNumber = failed || current;
  if (!stepNumber) return "";
  const step = steps[stepNumber - 1];
  if (!step) return "";
  const context = steps
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => Math.abs(index - (stepNumber - 1)) <= 2);
  return `
    <div class="step-inspector ${failed ? "failed" : "running"}">
      <div class="step-inspector-head">
        <div>
          <small>${failed ? "Stopped step" : "Current step"}</small>
          <strong>Step ${stepNumber}: ${esc(macroStepTitle(step))}</strong>
          <span>${esc(macroStepDetail(step) || "No extra metadata saved for this step")}</span>
        </div>
        <div class="step-inspector-actions">
          <button type="button" data-retry-macro-step="${stepNumber - 1}">${failed ? "Retry from this step" : "Run from here"}</button>
          <button type="button" data-delete-teach-step="${stepNumber - 1}">Delete step</button>
          <button type="button" class="danger" data-trim-teach-step="${stepNumber - 1}">Delete from here</button>
        </div>
      </div>
      <div class="step-shots">
        ${macroStepScreenshot(step, "screenshotBefore", "Before step")}
        ${macroStepScreenshot(step, "screenshotAfter", "After step")}
      </div>
      <div class="step-context">
        ${context.map(({ item, index }) => `
          <span class="${index + 1 === stepNumber ? "active" : ""}">
            <b>${index + 1}</b>
            <em>${esc(macroStepTitle(item))}</em>
          </span>
        `).join("")}
      </div>
    </div>
  `;
}

function teachPhaseStatusLabel(phase = {}) {
  if (phase.status === "complete") return "Complete";
  if (phase.status === "recording") return "Recording";
  if (phase.status === "skipped") return "Skipped";
  if (phase.stepCount) return "Draft";
  return phase.mode === "system" ? "Ready" : "Not taught";
}

function renderTeachPhaseCoach(teach = {}, steps = [], recording = false) {
  const phases = teach.teachPlan || [];
  if (!phases.length) return "";
  const activePhaseId = teach.activePhaseId || "";
  const unassignedCount = steps.filter((step) => !step.phaseId).length;
  return `
    <div class="phase-coach">
      <div class="phase-coach-head">
        <div>
          <strong>Teach in phases</strong>
          <span>Record one clean section at a time. If one section breaks, re-record only that section.</span>
        </div>
        ${activePhaseId ? `<b>Current: ${esc(phases.find((phase) => phase.id === activePhaseId)?.label || activePhaseId)}</b>` : `<b>Ready</b>`}
      </div>
      <div class="phase-grid">
        ${phases.map((phase, index) => {
          const status = teachPhaseStatusLabel(phase);
          const isActive = activePhaseId === phase.id;
          const isRecording = recording && isActive;
          const hasSteps = Number(phase.stepCount || 0) > 0;
          const disabledByOtherRecording = recording && !isActive;
          return `
            <article class="phase-card ${isActive ? "active" : ""} ${phase.status || "pending"}">
              <div class="phase-title">
                <b>${index + 1}</b>
                <span>
                  <strong>${esc(phase.label)}</strong>
                  <small>${esc(status)}${phase.required ? " · required" : " · optional"}${hasSteps ? ` · ${Number(phase.stepCount)} steps` : ""}</small>
                </span>
              </div>
              <p>${esc(phase.goal || phase.operatorPrompt || "")}</p>
              <div class="phase-actions">
                ${phase.mode === "system" ? `
                  <button type="button" data-teach-phase-action="start" data-teach-phase-id="${esc(phase.id)}" ${recording ? "disabled" : ""}>${phase.status === "complete" ? "Run Again" : "Run Step"}</button>
                ` : isRecording ? `
                  <button type="button" data-teach-phase-action="complete" data-teach-phase-id="${esc(phase.id)}">Finish Phase</button>
                ` : `
                  <button type="button" data-teach-phase-action="start" data-teach-phase-id="${esc(phase.id)}" ${disabledByOtherRecording ? "disabled" : ""}>${hasSteps ? "Record More" : "Record Phase"}</button>
                `}
                ${hasSteps && !isRecording ? `<button type="button" data-teach-phase-action="retry" data-teach-phase-id="${esc(phase.id)}" ${recording ? "disabled" : ""}>Re-record</button>` : ""}
                ${!phase.required && phase.status !== "skipped" && !isRecording ? `<button type="button" data-teach-phase-action="skip" data-teach-phase-id="${esc(phase.id)}" ${recording ? "disabled" : ""}>Skip</button>` : ""}
              </div>
            </article>
          `;
        }).join("")}
      </div>
      ${unassignedCount ? `
        <div class="phase-warning">
          <strong>${unassignedCount} older unassigned step${unassignedCount === 1 ? "" : "s"}</strong>
          <span>These came from the old flat recorder. Use phase Re-record to replace them with clean sections.</span>
        </div>
      ` : ""}
    </div>
  `;
}

function workflowInputValue(key) {
  return state.capcut.workflowInputs?.[key] || "";
}

function workflowById(id) {
  return (state.capcut.workflows || []).find((workflow) => workflow.id === id) || {
    id,
    name: id,
    inputs: ["projectName", "outputProjectFolder"],
    optionalInputs: ["stickerPath"],
    trainingInstructions: [],
    checkpoints: [],
    trainedMacro: null,
    lastRun: null
  };
}

function workflowInputLabel(key) {
  return ({
    sourceVideoPath: "Optional clip context",
    stickerPath: "Optional sticker image",
    projectName: "CapCut project name",
    outputProjectFolder: "Save project folder"
  })[key] || key;
}

function workflowInputPlaceholder(key) {
  return ({
    sourceVideoPath: "Optional Builder clip reference",
    stickerPath: "Leave blank unless you want a PNG/JPG sticker",
    projectName: "Auto-filled project name",
    outputProjectFolder: "Auto-filled CapCut projects folder"
  })[key] || `{{${key}}}`;
}

function renderTrainingCoach() {
  const workflow = workflowById(verticalShortWorkflowId);
  const trained = Boolean(workflow.trainedMacro);
  const recording = Boolean(state.capcut.teach?.recording);
  const connected = state.capcut.status?.latestScreenshot?.target === "capcut_window";
  const clip = selectedBuilderClip();
  const inputsReady = workflowInputReady();
  const missing = state.capcut.workflowInputStatus?.missingInputs || [];
  const steps = [
    { label: "Pick training clip", done: Boolean(clip), detail: clip?.title || "Choose a Builder clip, then click it manually in CapCut" },
    { label: "Connect CapCut", done: connected, detail: connected ? "Native window observed" : "Open and capture the native CapCut window" },
    { label: "Record Choose Clip", done: recording || Boolean(state.capcut.teach?.steps?.length), detail: recording ? "Recording actions now" : "Click the clip/media item in CapCut while recording" },
    { label: "Edit once in CapCut", done: Boolean(state.capcut.teach?.steps?.length), detail: "Set 9:16, blur background, auto frame, optional sticker" },
    { label: "Stop and save macro", done: trained, detail: trained ? "Reusable workflow saved" : "Save the workflow after recording" }
  ];
  return `
    <section class="training-coach">
      <div class="clips-head">
        <div>
          <span class="watch-kicker">Teach This Clip</span>
          <h2>${esc(clip?.title || "No Builder clip selected")}</h2>
        </div>
        <div class="workflow-badge ${trained ? "trained" : ""}">${trained ? "Macro trained" : recording ? "Recording" : "Ready to teach"}</div>
      </div>
      <div class="coach-grid">
        <div class="coach-steps">
          ${steps.map((step, index) => `
            <span class="${step.done ? "done" : ""}">
              <b>${index + 1}</b>
              <strong>${esc(step.label)}</strong>
              <em>${esc(step.detail)}</em>
            </span>
          `).join("")}
        </div>
        <div class="coach-actions">
          <p>${esc(clip
            ? "Teach Mode records your real CapCut actions: choose the clip, edit it, and save. Later the agent replays the same learned path."
            : "Approve a clip first, then use it here to train the CapCut workflow.")}</p>
          ${missing.length ? `<small>Still needed before running full workflow: ${esc(missing.map(workflowInputLabel).join(", "))}</small>` : ""}
          <div>
            ${clip ? `<button type="button" data-builder-teach-clip="${esc(clip.id)}">Load Clip Inputs</button>` : ""}
            ${clip ? `<button type="button" data-builder-teach-start="${esc(clip.id)}" ${inputsReady ? "" : ""}>Start Teaching</button>` : ""}
            <button type="button" data-teach-action="stop" ${recording ? "" : "disabled"}>Stop Recording</button>
            <button type="button" data-workflow-action="save" ${state.capcut.teach?.workflowId === verticalShortWorkflowId && !recording ? "" : "disabled"}>Save Workflow</button>
            <button type="button" data-workflow-action="run" ${trained && !recording ? "" : "disabled"}>Run Trained Edit</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderWorkflowPanel() {
  const workflow = workflowById(verticalShortWorkflowId);
  const lastRun = workflow.lastRun || {};
  const trained = workflow.trainedMacro;
  const running = Boolean(state.capcut.replay?.running && state.capcut.replay?.workflowId === workflow.id);
  return `
    <section class="workflow-panel">
      <div class="clips-head">
        <div>
          <span class="watch-kicker">CapCut Workflow</span>
          <h2>Vertical 9:16 auto frame workflow</h2>
        </div>
        <div class="workflow-badge ${trained ? "trained" : ""}">
          ${trained ? `${Number(trained.stepCount || 0)} trained steps` : "Needs training"}
        </div>
      </div>
      <div class="workflow-name">${esc(workflow.name)}</div>
      <div class="workflow-inputs">
        ${["projectName", "outputProjectFolder", "stickerPath"].map((key) => `
          <label>
            <small>${esc(workflowInputLabel(key))}</small>
            <input type="text" data-workflow-input="${esc(key)}" value="${esc(workflowInputValue(key))}" placeholder="${esc(workflowInputPlaceholder(key))}" />
          </label>
        `).join("")}
      </div>
      <div class="workflow-actions">
        <button type="button" data-workflow-action="train">Train This Workflow</button>
        <button type="button" data-workflow-action="save" ${state.capcut.teach?.workflowId === workflow.id ? "" : "disabled"}>Save Trained Workflow</button>
        <button type="button" data-workflow-action="run" ${trained && !running ? "" : "disabled"}>Run This Workflow</button>
        ${running ? `<button type="button" class="danger" data-replay-cancel>Stop Workflow</button>` : ""}
      </div>
      <div class="workflow-grid">
        <div>
          <strong>Training order</strong>
          <ol>
            ${(workflow.trainingInstructions || [
              "Open or create a CapCut project.",
              "Choose the clip manually in CapCut.",
              "Set 9:16 vertical canvas.",
              "Apply blurred background and auto frame.",
              "Optional: add a sticker near the bottom center.",
              "Save as {{projectName}} without exporting."
            ]).map((item) => `<li>${esc(item)}</li>`).join("")}
          </ol>
        </div>
        <div>
          <strong>Run validation</strong>
          ${lastRun?.validation ? `
            <ul>
              <li>CapCut open: ${lastRun.validation.capcutStillOpen ? "yes" : "no"}</li>
              <li>Timeline media likely: ${lastRun.validation.timelineAppearsToHaveMedia ? "yes" : "no"}</li>
              <li>Final screenshot: ${lastRun.validation.finalScreenshotExists ? "yes" : "no"}</li>
              <li>Error dialog: ${lastRun.validation.noObviousErrorDialog ? "none detected" : "needs review"}</li>
            </ul>
          ` : `<span>No workflow run yet.</span>`}
        </div>
      </div>
      ${lastRun?.checkpoints?.length ? `
        <div class="workflow-checkpoints">
          ${lastRun.checkpoints.map((checkpoint) => `
            <span>${esc(checkpoint.label)} · ${checkpoint.screenshot?.sizeBytes ? "screenshot saved" : "missing"}</span>
          `).join("")}
        </div>
      ` : ""}
    </section>
  `;
}

function renderHybridAgentPanel() {
  const planner = state.capcut.planner || {};
  const logs = planner.logs || [];
  const screenshot = planner.screenshot || {};
  return `
    <section class="hybrid-agent-panel">
      <div class="clips-head">
        <div>
          <span class="watch-kicker">CapCut Editing Agent</span>
          <h2>${esc(planner.workflowName || "Hybrid AI + Macro Recovery")}</h2>
        </div>
        <button type="button" class="danger" data-replay-cancel ${state.capcut.replay?.running ? "" : "disabled"}>Stop</button>
      </div>
      <div class="agent-status-grid">
        <span>
          <small>Current step</small>
          <b>${esc(planner.currentStep || "Idle")}</b>
        </span>
        <span>
          <small>Last action</small>
          <b>${esc(planner.lastAction || "No action yet")}</b>
        </span>
        <span>
          <small>Macro replay</small>
          <b>${esc(planner.macroReplayStatus || state.capcut.replay?.status || "idle")}</b>
        </span>
        <span>
          <small>Recovery</small>
          <b>${esc(planner.recoveryStatus || "idle")}</b>
        </span>
      </div>
      <div class="agent-live">
        ${screenshot.url ? `<img src="${esc(apiUrl(screenshot.url))}" alt="Latest CapCut agent screenshot">` : `<div class="capcut-shot-empty">No workflow screenshot yet</div>`}
        <div class="agent-logs">
          <strong>Logs</strong>
          ${logs.length ? logs.slice(-10).reverse().map((log) => `
            <p>
              <b>${esc(log.label || "Action")}</b>
              <span>${esc(log.status || "logged")} ${log.createdAt ? `· ${esc(log.createdAt)}` : ""}</span>
            </p>
          `).join("") : `<p><span>No hybrid workflow logs yet.</span></p>`}
        </div>
      </div>
    </section>
  `;
}

function renderTeachModePanel() {
  const teach = state.capcut.teach || {};
  const replay = state.capcut.replay || {};
  const recording = Boolean(teach.recording);
  const steps = teach.steps || [];
  const selectedClip = selectedBuilderClip();
  return `
    <section class="teach-panel">
      <div class="clips-head">
        <div>
          <span class="watch-kicker">CapCut Recipe Builder</span>
          <h2>${recording ? "Recording edit moves" : "Teach one reusable edit"}</h2>
        </div>
        <div class="teach-status ${recording ? "recording" : ""}">
          ${recording ? "Recording" : teach.status || "Idle"}
        </div>
      </div>
      <label class="macro-name">
        <small>Macro Name</small>
        <input id="capcut-macro-name" type="text" value="${esc(state.capcut.macroName)}" placeholder="vertical_916_blur_background_sticker" />
      </label>
      <div class="recipe-guide ready">
        <div>
          <strong>Choose the clip</strong>
          <span>Record the exact click path you use in CapCut.</span>
          <small>${selectedClip?.title ? `Builder context: ${selectedClip.title}` : "Use the clip already visible in CapCut"}</small>
        </div>
        <div>
          <strong>Teach by doing</strong>
          <span>Record one clean section at a time, then replay only what worked.</span>
          <small>Use phase Re-record when one section is wrong.</small>
        </div>
      </div>
      ${renderTeachPhaseCoach(teach, steps, recording)}
      ${renderReplayStepStrip()}
      ${renderStepInspector(steps)}
      <div class="teach-actions">
        <button type="button" data-teach-action="start" ${recording ? "disabled" : ""}>Start Recording</button>
        <button type="button" data-teach-action="continue" ${recording || !steps.length ? "disabled" : ""}>Continue Recording</button>
        <button type="button" data-teach-action="stop" ${recording ? "" : "disabled"}>Stop Recording</button>
        <button type="button" data-teach-action="save" ${recording || !steps.length ? "disabled" : ""}>Save Macro</button>
        <button type="button" data-teach-action="cancel">Cancel</button>
        ${replay?.running ? `<button type="button" class="danger" data-replay-cancel>Stop Replay</button>` : ""}
      </div>
      <div class="teach-guide">
        <span>
          <small>Mode</small>
          <strong>${esc(teach.automationMode === "capcut_window_relative" ? "CapCut window only" : teach.automationMode || "CapCut window only")}</strong>
        </span>
        <span>
          <small>Accepted</small>
          <strong>${Number(teach.acceptedEventCount || steps.length || 0)} actions</strong>
        </span>
        <span>
          <small>Ignored outside CapCut</small>
          <strong>${Number(teach.ignoredEventCount || 0)} events</strong>
        </span>
      </div>
      <div class="teach-meta">
        <span>${steps.length} step${steps.length === 1 ? "" : "s"} recorded</span>
        <span>Emergency stop: command + option + escape</span>
        <span>Mouse is restored after replay actions</span>
        ${teach.stopReason ? `<span>${esc(teach.stopReason)}</span>` : ""}
      </div>
      ${renderTeachingVisionPanel(teach, steps, recording)}
      <ol class="macro-steps">
        ${steps.length ? steps.map(renderMacroStep).join("") : `
          <li class="empty-step">
            <span>
              <strong>No steps recorded yet</strong>
              <small>Start recording, edit in CapCut, then stop and save the macro.</small>
            </span>
          </li>
        `}
      </ol>
    </section>
  `;
}

function renderMacroLibraryPanel() {
  const macros = state.capcut.macros || [];
  const replay = state.capcut.replay || {};
  const replayPaused = Boolean(replay.paused || replay.pauseRequested || replay.status === "paused");
  const activeMacroId = replay.activeMacroId || "";
  const macroProgress = Number(replay.currentMacroCount || 0) > 0
    ? `Macro ${Number(replay.currentMacroIndex || 0)} of ${Number(replay.currentMacroCount || 0)}`
    : "";
  const macroStepProgress = Number(replay.currentMacroStepCount || 0) > 0
    ? `macro step ${Number(replay.currentMacroStepIndex || 0)} / ${Number(replay.currentMacroStepCount || 0)}`
    : "";
  const collapsed = Boolean(state.capcut.macroLibraryCollapsed);
  return `
    <section class="macro-library ${collapsed ? "panel-collapsed" : ""}">
      <div class="clips-head">
        <div>
          <span class="watch-kicker">Macro Library</span>
          <h2>Saved CapCut workflows${collapsed ? ` <small class="collapsed-count">(${macros.length} saved)</small>` : ""}</h2>
        </div>
        <div class="macro-library-actions">
          ${collapsed ? "" : `
            <button type="button" data-run-all-macros ${macros.length && !replay?.running ? "" : "disabled"}>Run All</button>
            <button type="button" data-macro-refresh>Refresh</button>
          `}
          <button type="button" class="panel-toggle" data-toggle-macro-library>${collapsed ? "▸ Expand" : "▾ Collapse"}</button>
        </div>
      </div>
      ${collapsed ? "" : `
      ${replay?.status ? `
        <div class="replay-status ${replay.running ? "running" : ""} ${replayPaused ? "paused" : ""}">
          <div class="macro-card-copy">
            <strong>${esc(replay.macroName || "Replay")}</strong>
            <span>${esc(replayPaused ? "paused" : replay.status)} · ${Number(replay.currentStepIndex || 0)} / ${Number(replay.totalSteps || 0)}</span>
            ${macroProgress ? `
              <div class="replay-sequence">
                <b>${esc(macroProgress)}</b>
                <span>${esc(replay.activeMacroName || replay.macroName || "Macro")}${macroStepProgress ? ` · ${esc(macroStepProgress)}` : ""}</span>
              </div>
            ` : ""}
            ${replay.currentStepDescription ? `<small>${esc(replay.currentStepDescription)}</small>` : ""}
          </div>
          ${replay.running ? `
            <div class="macro-card-actions">
              ${replayPaused
                ? `<button type="button" data-replay-resume>Resume</button>`
                : `<button type="button" data-replay-pause>Pause</button>`}
              <button type="button" class="danger" data-replay-cancel>Stop</button>
            </div>
          ` : ""}
        </div>
      ` : ""}
      <div class="macro-list">
        ${macros.length ? macros.map((macro) => `
          <article class="macro-card ${activeMacroId === macro.id ? "active" : ""}" draggable="${replay?.running ? "false" : "true"}" data-macro-card data-macro-id="${esc(macro.id)}">
            <div class="macro-card-copy">
              <strong>${esc(macro.name)}</strong>
              <small>#${Number(macro.orderIndex || 0) + 1} · ${Number(macro.stepCount || 0)} steps · ${esc(macro.updatedAt || macro.createdAt || "saved")}</small>
              ${activeMacroId === macro.id ? `<em>Running now · ${macroStepProgress ? esc(macroStepProgress) : "active macro"}</em>` : ""}
            </div>
            <div class="macro-card-actions">
              <button type="button" data-rename-macro="${esc(macro.id)}" ${replay?.running ? "disabled" : ""}>Rename</button>
              <button type="button" data-edit-macro="${esc(macro.id)}" ${replay?.running ? "disabled" : ""}>Edit Steps</button>
              <button type="button" data-replay-macro="${esc(macro.id)}" ${replay?.running ? "disabled" : ""}>Replay Macro</button>
              <button type="button" class="danger" data-delete-macro="${esc(macro.id)}" ${replay?.running ? "disabled" : ""}>Delete</button>
            </div>
          </article>
        `).join("") : `
          <div class="clips-empty">
            <strong>No macros saved yet</strong>
            <span>Record one workflow in Teach Mode, then save it here.</span>
            <button type="button" disabled>Replay Macro</button>
          </div>
        `}
      </div>
      `}
    </section>
  `;
}

const DETERMINISM_PHASES = [
  { id: "choose_clip", label: "Choose Clip" },
  { id: "canvas_916", label: "9:16 Canvas" },
  { id: "blur_background", label: "Blur BG" },
  { id: "auto_frame", label: "Auto Reframe 3:4" },
  { id: "bottom_sticker", label: "Sticker" },
  { id: "save_project", label: "Save" }
];

const GATE_STATUS_LABELS = {
  passed: "verified",
  passed_after_retry: "verified · retried once",
  passed_after_human: "verified · after your fix",
  failed: "FAILED — replay stopped"
};

const RESOLUTION_SOURCE_LABELS = {
  visual_anchor: "Visual anchor",
  semantic_exact_label: "Semantic label",
  semantic_label: "Semantic label",
  stored_ratio: "Ratio fallback",
  stored_window_offset: "Ratio fallback",
  legacy_screenshot_window: "Ratio fallback",
  capcut_window: "Ratio fallback",
  raw_recorded: "Raw coords"
};

function determinismPhaseStates(replay) {
  const gates = Array.isArray(replay?.gates) ? replay.gates : [];
  const byPhase = {};
  for (const gate of gates) byPhase[gate.phaseId] = gate;
  const paused = Boolean(replay?.paused || replay?.pauseRequested || replay?.status === "paused");
  const anyFailed = gates.some((gate) => gate.status === "failed");
  let runningMarked = false;
  return DETERMINISM_PHASES.map((phase) => {
    const gate = byPhase[phase.id];
    if (gate) {
      const cls = gate.status === "failed" ? "failed" : (gate.status === "passed" ? "passed" : "passed-soft");
      return { ...phase, cls, note: GATE_STATUS_LABELS[gate.status] || gate.status };
    }
    if (replay?.running && !paused && !anyFailed && !runningMarked) {
      runningMarked = true;
      return { ...phase, cls: "running", note: "running now" };
    }
    const stopped = anyFailed || (replay?.status && !replay?.running);
    return { ...phase, cls: "pending", note: stopped ? "not reached" : "waiting" };
  });
}

function renderDeterminismMonitorPanel() {
  const replay = state.capcut.replay || null;
  const collapsed = Boolean(state.capcut.monitorCollapsed);
  const warnings = Array.isArray(replay?.warnings) ? replay.warnings : [];
  const humanGate = replay?.humanGate || null;
  const waits = replay?.waits || null;
  const waitSavedSeconds = waits ? Math.max(0, Math.round((Number(waits.recordedMs || 0) - Number(waits.actualMs || 0)) / 1000)) : 0;
  const sources = replay?.resolutionSources || {};
  const sourceCounts = {};
  for (const [key, count] of Object.entries(sources)) {
    const label = RESOLUTION_SOURCE_LABELS[key] || key;
    sourceCounts[label] = (sourceCounts[label] || 0) + Number(count || 0);
  }
  const heals = Array.isArray(replay?.heals) ? replay.heals.length : 0;
  const phases = determinismPhaseStates(replay);
  const finished = replay?.status && !replay.running;
  return `
    <section class="determinism-panel ${collapsed ? "panel-collapsed" : ""}">
      <div class="clips-head">
        <div>
          <span class="watch-kicker">Determinism Monitor</span>
          <h2>Watch every phase get verified</h2>
        </div>
        <div class="macro-library-actions">
          <button type="button" class="panel-toggle" data-toggle-determinism>${collapsed ? "▸ Expand" : "▾ Collapse"}</button>
        </div>
      </div>
      ${collapsed ? "" : `
        ${humanGate ? `
          <div class="determinism-human-gate">
            <div>
              <strong>⛔ Needs you: ${esc(humanGate.reason || `Phase ${humanGate.phaseId} failed`)}</strong>
              <span>The replay is paused. Fix CapCut manually, then press Resume — the system re-verifies the phase before continuing. It will never continue past a failed check on its own.</span>
            </div>
            <div class="macro-card-actions">
              <button type="button" data-replay-resume>Resume &amp; Re-verify</button>
              <button type="button" class="danger" data-replay-cancel>Stop Replay</button>
            </div>
          </div>
        ` : ""}
        ${replay ? `
          <div class="determinism-phases">
            ${phases.map((phase) => `
              <div class="determinism-phase ${phase.cls}">
                <b>${esc(phase.label)}</b>
                <span>${esc(phase.note)}</span>
              </div>
            `).join("<i class=\"determinism-arrow\">→</i>")}
          </div>
          ${replay.running ? `
            <div class="determinism-live">
              <span class="pulse-dot"></span>
              <span>Step ${Number(replay.currentStepIndex || 0)} / ${Number(replay.totalSteps || 0)} — ${esc(replay.currentStepDescription || "working…")}</span>
            </div>
          ` : ""}
          <div class="determinism-stats">
            <span>
              <small>Click resolution</small>
              <b>${Object.keys(sourceCounts).length
                ? Object.entries(sourceCounts).map(([label, count]) => `${esc(label)} ×${count}`).join(" · ")
                : "no clicks resolved yet"}</b>
              <em>Visual anchor = pixel-verified. Ratio fallback should stay rare.</em>
            </span>
            <span>
              <small>Wait time saved</small>
              <b>${waits ? `${waitSavedSeconds}s faster` : "—"}</b>
              <em>${waits ? `${Math.round(Number(waits.recordedMs || 0) / 1000)}s of taught pauses → ${Math.round(Number(waits.actualMs || 0) / 1000)}s replayed` : "Recorded pauses clamp; processing is awaited by polling"}</em>
            </span>
            <span>
              <small>Self-heals</small>
              <b>${heals}</b>
              <em>Drifted clicks corrected and written back to the macro</em>
            </span>
            <span class="${warnings.length ? "warn" : ""}">
              <small>Warnings</small>
              <b>${warnings.length}</b>
              <em>${warnings.length ? "See below — these mean a fallback was used" : "Zero warnings = fully deterministic run"}</em>
            </span>
          </div>
          ${warnings.length ? `
            <div class="determinism-warnings">
              ${warnings.slice(-6).map((warning) => `
                <div class="determinism-warning">
                  <b>${esc(warning.kind)}</b>
                  <span>step ${Number(warning.stepIndex || 0)} · ${esc(warning.description || warning.type || "")}</span>
                </div>
              `).join("")}
            </div>
          ` : ""}
          ${finished ? `
            <div class="determinism-lastrun ${replay.status === "complete" ? "good" : "bad"}">
              <strong>Last run: ${esc(replay.status)}</strong>
              <span>${esc(replay.macroName || "")}${replay.finishedAt ? ` · finished ${esc(replay.finishedAt)}` : ""}${replay.stopReason && replay.status !== "complete" ? ` · ${esc(replay.stopReason)}` : ""}</span>
              ${replay.runReportPath ? `<small>Full report: ${esc(replay.runReportPath)}</small>` : ""}
            </div>
          ` : ""}
        ` : `
          <div class="clips-empty">
            <strong>No replay watched yet</strong>
            <span>Replay a macro (or Run All) and this panel shows each phase — Choose Clip → 9:16 → Blur → Auto Reframe → Sticker → Save — turning green as the system verifies it on screen. A failed check stops the replay and asks for you.</span>
          </div>
        `}
      `}
    </section>
  `;
}

function renderBuilderArea() {
  const clips = builderClips();
  return `
    <section class="builder-panel">
      <div class="clips-head">
        <div>
          <span class="watch-kicker">Clip Builder</span>
          <h2>Approved 9:16 prep queue</h2>
        </div>
        <div class="builder-count">${clips.length} approved</div>
      </div>
      <div class="builder-row">
        ${clips.length ? clips.map((clip) => `
          <article class="builder-item ${state.capcut.selectedBuilderClipId === clip.id ? "selected" : ""}">
            <span>9:16 auto-frame target</span>
            <strong>${esc(clip.title || "Approved clip")}</strong>
            <small>${esc(clip.streamerName || "Watched stream")} · ${formatSeconds(clip.durationSeconds || clip.duration || 30)} · ${Number(clip.score || 0) || 0}% signal</small>
            <em>${esc(clip.capcutTarget?.instruction || "Open in CapCut Workspace, set 9:16, then train macro steps.")}</em>
            <div class="builder-actions">
              <button type="button" data-builder-teach-clip="${esc(clip.id)}">Load for CapCut</button>
              <button type="button" data-builder-teach-start="${esc(clip.id)}">Start Teaching</button>
            </div>
          </article>
        `).join("") : `
          <div class="clips-empty">
            <strong>No approved clips yet</strong>
            <span>Use Approve under a verified MP4 to move it here for CapCut prep.</span>
          </div>
        `}
      </div>
    </section>
  `;
}

function renderCapCutWorkspace() {
  const status = state.capcut.status || {};
  const latest = status.latestScreenshot || {};
  const lastAction = status.lastAction || {};
  const lastError = status.lastError || {};
  const workspace = status.workspace || {};
  const connected = latest.target === "capcut_window";
  const workspaceBounds = workspace.bounds
    ? `${workspace.bounds.width}x${workspace.bounds.height} at ${workspace.bounds.x},${workspace.bounds.y}`
    : "Connect CapCut to reserve a native workspace";
  return `
    <section class="capcut-panel">
      <div class="clips-head">
        <div>
          <span class="watch-kicker">CapCut Workspace</span>
          <h2>Native Mac control layer</h2>
        </div>
        <div class="capcut-actions">
          <button type="button" data-capcut-action="connect">Connect CapCut</button>
          <button type="button" data-capcut-action="screenshot">Refresh Preview</button>
          <button type="button" data-capcut-action="focus">Focus CapCut</button>
          <button type="button" data-capcut-action="park">Reposition</button>
          <button type="button" data-capcut-action="refresh">Reload Status</button>
        </div>
      </div>
      ${state.capcut.error ? `<div class="capcut-error">${esc(state.capcut.error)}</div>` : ""}
      <div class="capcut-operating-strip ${connected ? "ready" : "warn"}">
        <strong>${connected ? "CapCut connected" : "CapCut preview not connected"}</strong>
        <span>${connected
          ? "Argentum is observing the native CapCut window and can run Teach Mode or replay against it."
          : "Use Connect CapCut once. Argentum will open CapCut, place it in a native side workspace, and capture the live preview."}</span>
      </div>
      ${renderTrainingCoach()}
      <div class="capcut-status-grid">
        ${renderCapCutStatusValue("CapCut installed", Boolean(status.installed), status.appPath || "", status.installedStatus || null)}
        ${renderCapCutStatusValue("CapCut running", Boolean(status.running), "", status.runningStatus || null)}
        ${renderCapCutStatusValue("Accessibility", Boolean(status.accessibilityPermission), status.accessibilityMessage || "", status.accessibilityStatus || null)}
        ${renderCapCutStatusValue("Screen recording", Boolean(status.screenRecordingPermission), status.screenRecordingMessage || "", status.screenRecordingStatus || null)}
        ${renderCapCutStatusValue("Automation", Boolean(status.automationPermission), status.automationMessage || "", status.automationStatus || null)}
        <span>
          <small>Current active app</small>
          <b>${esc(status.activeApp || "unknown")}</b>
          <em>${esc(status.checkedAt || "not checked")}</em>
        </span>
        <span class="${lastError.message ? "bad" : "good"}">
          <small>Last error</small>
          <b>${esc(lastError.message ? "needs attention" : "none")}</b>
          <em>${esc(lastError.message || "No automation error recorded")}</em>
        </span>
        <span class="good">
          <small>Automation mode</small>
          <b>${esc(status.automationMode === "capcut_window_relative" ? "window-relative" : status.automationMode || "native")}</b>
          <em>${esc(status.cursorBehavior === "restore_after_action" ? "Restores your cursor after clicks/drags" : "Native Mac control")}</em>
        </span>
        <span class="${workspace.parked ? "good" : "unknown"}">
          <small>CapCut workspace</small>
          <b>${esc(workspace.parked ? `connected: ${workspace.mode || "compact"}` : "not connected")}</b>
          <em>${esc(workspaceBounds)}</em>
        </span>
      </div>
      <div class="capcut-help">
        CapCut runs as a native companion window beside Argentum. Connect CapCut opens it, keeps it in a fixed workspace, and captures a real CapCut window preview. Teach Mode records only the CapCut window, ignores outside desktop clicks, and replays saved positions relative to the current CapCut window.
      </div>
      <div class="capcut-permissions">
        <button type="button" data-open-permission="accessibility">Open Accessibility</button>
        <button type="button" data-open-permission="screenRecording">Open Screen Recording</button>
        <button type="button" data-open-permission="automation">Open Automation</button>
      </div>
      <div class="capcut-live">
        <div>
          <small>Last automation action</small>
          <strong>${esc(lastAction.action || "none")}</strong>
          <span>${esc(lastAction.status || "idle")} ${lastAction.createdAt ? `· ${lastAction.createdAt}` : ""}</span>
        </div>
        ${latest.url ? `
          <figure>
            <img src="${esc(apiUrl(latest.url))}" alt="Latest CapCut workspace screenshot">
            <figcaption>${esc(connected ? "CapCut window preview" : "Preview not connected")}</figcaption>
          </figure>
        ` : `<div class="capcut-shot-empty">Connect CapCut to show the native window preview</div>`}
      </div>
      ${renderWorkflowPanel()}
      ${renderHybridAgentPanel()}
      ${renderTeachModePanel()}
      ${renderMacroLibraryPanel()}
      ${renderDeterminismMonitorPanel()}
    </section>
  `;
}

function renderClipsArea() {
  const area = $("#clips-area");
  if (!area) return;
  const previousMacroScroll = area.querySelector(".macro-steps")?.scrollTop ?? state.capcut.macroStepsScrollTop ?? 0;
  const macroNameInput = $("#capcut-macro-name");
  const macroNameFocus = macroNameInput && document.activeElement === macroNameInput
    ? {
      value: macroNameInput.value,
      start: macroNameInput.selectionStart,
      end: macroNameInput.selectionEnd
    }
    : null;
  if (macroNameFocus) {
    state.capcut.macroName = macroNameFocus.value;
    localStorage.setItem("capcutMacroName", state.capcut.macroName);
  }
  const clips = currentClips();
  const scopedToWatcher = Boolean(state.watch.session?.id || state.watch.streamer?.id);
  const folder = state.config?.clipsFolder || state.config?.watchBufferDir || state.config?.outputDir || "Local clip folder";
  area.innerHTML = `
    <section class="clips-panel">
      <div class="clips-head">
        <div>
          <span class="watch-kicker">Clips</span>
          <h2>Tracked clip windows</h2>
        </div>
        <div class="clip-folder">
          <small>MP4 folder</small>
          <strong>${esc(folder)}</strong>
        </div>
      </div>
      <div class="clips-row">
        ${clips.length ? clips.map(renderClipItem).join("") : `
          <div class="clips-empty">
            <strong>${scopedToWatcher ? "No clips yet" : "No selected watcher"}</strong>
            <span>${scopedToWatcher
              ? "When this watcher saves a clip window, it appears here and the MP4 is stored in the folder above."
              : "Clips stay locked to the selected stream. Pick a live stream to start the single-agent watch loop."}</span>
          </div>
        `}
      </div>
    </section>
    ${renderBuilderArea()}
    ${renderCapCutWorkspace()}
  `;
  const macroSteps = area.querySelector(".macro-steps");
  if (macroSteps) {
    macroSteps.scrollTop = previousMacroScroll;
    state.capcut.macroStepsScrollTop = previousMacroScroll;
    macroSteps.addEventListener("scroll", () => {
      state.capcut.macroStepsScrollTop = macroSteps.scrollTop;
    }, { passive: true });
  }
  if (macroNameFocus) {
    const restoredInput = $("#capcut-macro-name");
    if (restoredInput) {
      restoredInput.focus();
      restoredInput.setSelectionRange(macroNameFocus.start ?? restoredInput.value.length, macroNameFocus.end ?? restoredInput.value.length);
    }
  }
}

function signalScore(stream, session) {
  const viewerBase = Math.min(35, Math.round(Math.log10(Math.max(1, Number(stream?.viewerCount || 0))) * 11));
  const chat = Math.min(30, Math.round(Number(session?.lastChatMessagesPerMinute || 0) / 4));
  const keywords = Array.isArray(session?.lastChatKeyword) && session.lastChatKeyword.length ? 18 : 0;
  const titleBoost = /irl|reaction|challenge|fight|crazy|insane|ranked|clutch|final|drama|funny|rage|hype/i.test(`${stream?.title || ""} ${stream?.category || ""}`) ? 12 : 4;
  return Math.max(1, Math.min(100, viewerBase + chat + keywords + titleBoost));
}

function renderSignalMeter(score) {
  return `
    <div class="signal-meter" style="--score:${score}%">
      <span></span>
    </div>
  `;
}

function renderWatchArea() {
  const area = $("#watch-area");
  if (!area) return;
  const stream = state.watch.stream;
  if (!stream) {
    area.innerHTML = `
      <div class="watch-empty">
        <strong>No stream selected</strong>
        <span>Select one live stream to start the single-agent watch loop.</span>
      </div>
    `;
    renderClipsArea();
    return;
  }

  const session = state.watch.session;
  const events = latestSignalEvents();
  const keywords = state.config?.watchTriggerKeywords || ["holy shit", "wow", "wtf", "bro", "insane", "clip this"];
  const score = signalScore(stream, session);
  const chatPpm = Number(session?.lastChatMessagesPerMinute || 0);
  const capabilities = session?.capabilities || {};
  const stage = session?.currentStage || (state.watch.loading ? "Starting watcher" : "Ready");
  const statusText = watchStatusText(session, stage);
  const viewerCount = Number(stream.viewerCount || session?.viewerCount || 0);
  const keywordSummary = watchKeywordStatus(session, keywords, events);
  const canControl = Boolean(session?.id);
  const pauseLabel = session?.status === "paused" ? "Paused" : "Pause";
  area.innerHTML = `
    <section class="watch-panel">
      <div class="watch-command">
        <div>
          <span class="watch-kicker">Agent Watch Area</span>
          <h2>${esc(statusText)}</h2>
        </div>
        <span class="watch-chip ${state.watch.error ? "bad" : session ? "good" : "idle"}">${esc(stage)}</span>
        <span class="watch-chip ${capabilities.hasLiveVideo ? "good" : "idle"}">${esc(watchMediaStatus(capabilities))}</span>
        <button type="button" class="watch-chip keyword" data-open-keywords title="Open all watch keywords">
          <span>Top keys</span>
          <b>${esc(keywordSummary)}</b>
        </button>
      </div>
      <div class="watch-card-row">
        <article class="watch-stream-card" data-open-watch-detail role="button" tabindex="0" aria-label="Open watch details for ${esc(stream.displayName)}">
          <div class="watch-card-actions">
            <button type="button" data-pause-watch="${esc(session?.id || "")}" ${canControl && session?.status !== "paused" ? "" : "disabled"}>${pauseLabel}</button>
            <button type="button" data-stop-watch="${esc(session?.id || "")}" ${canControl ? "" : "disabled"}>Stop</button>
          </div>
          <div class="watch-card-poster" style="background-image:url('${esc(stream.thumbnail || "")}')">
            <span>${esc(stream.platform || "stream")}</span>
          </div>
          <div class="watch-card-body">
            <div class="watch-card-title">
              <span>${esc(stream.platform || "stream")}</span>
              <strong>${esc(stream.displayName)}</strong>
            </div>
            <div class="watch-card-metrics">
              <span><small>Viewers</small><b>${formatNumber(viewerCount)}</b></span>
              <span><small>Signal</small><b>${score}%</b></span>
              <span><small>Chat</small><b>${formatNumber(chatPpm)}/min</b></span>
            </div>
            ${renderSignalMeter(score)}
          </div>
        </article>
      </div>
    </section>
    ${renderWatchDetailModal({ stream, session, events, score, chatPpm, keywords, capabilities })}
    ${renderKeywordModal({ session, events, keywords })}
  `;
  renderClipsArea();
}

async function refreshWatchState(streamerId = state.watch.streamer?.id || "") {
  const active = await api("/api/watch-sessions/active");
  const sessions = active.sessions || [];
  const session = sessions.find((item) => item.streamerId === streamerId) || sessions[0] || null;
  const clipParams = new URLSearchParams();
  if (session?.id) clipParams.set("watchSessionId", session.id);
  else if (streamerId) clipParams.set("streamerId", streamerId);
  const clips = await api(`/api/clips/candidates${clipParams.toString() ? `?${clipParams}` : ""}`).catch(() => ({ candidates: [], streamers: [] }));
  const streamer = session
    ? (clips.streamers || []).find((item) => item.id === session.streamerId) || state.watch.streamer || null
    : null;
  state.watch.session = session;
  if (session) {
    state.watch.streamer = streamer;
    state.watch.stream = streamFromWatchSession(session, streamer || {});
    state.selectedStreamKey = streamKey(state.watch.stream);
  } else if (!state.watch.loading) {
    state.watch.streamer = null;
    state.watch.stream = null;
    state.selectedStreamKey = "";
  }
  state.watch.events = session
    ? (active.events || []).filter((event) => event.sessionId === session.id)
    : active.events || [];
  state.clips = clips.candidates || [];
  renderWatchArea();
}

function startWatchPolling() {
  window.clearInterval(state.watchPollTimer);
  state.watchPollTimer = window.setInterval(() => {
    refreshWatchState().catch((error) => {
      state.watch.error = error.message || "Watch refresh failed";
      renderWatchArea();
    });
  }, 5000);
}

async function watchStreamer(key) {
  const stream = findStreamByKey(key);
  if (!stream) return;
  state.selectedStreamKey = streamKey(stream);
  state.watch = { ...state.watch, stream, streamer: null, session: null, events: [], detailOpen: false, keywordOpen: false, loading: true, error: "" };
  renderStreams();
  renderWatchArea();

  const button = document.querySelector(`[data-watch-streamer="${CSS.escape(state.selectedStreamKey)}"]`);
  if (button) {
    button.disabled = true;
    button.textContent = "Starting";
  }
  try {
    const upsert = await upsertStreamer(stream, { monitorEnabled: true });
    const streamer = upsert.streamer;
    state.watch.streamer = streamer;
    state.watch.session = upsert.watchSession || null;
    const run = await api("/api/watch/run", {
      method: "POST",
      body: JSON.stringify({
        mode: "real",
        streamerId: streamer.id,
        idempotencyKey: `watch:${streamer.id}:default`
      })
    });
    state.watch.session = run.session || run.results?.[0]?.session || state.watch.session;
    state.watch.loading = false;
    renderStatus(`${stream.displayName} is now in the watch area`);
    await refreshWatchState(streamer.id);
    startWatchPolling();
  } catch (error) {
    state.watch.loading = false;
    state.watch.error = error.message || "Could not start watcher";
    renderStatus(state.watch.error);
    renderWatchArea();
  } finally {
    if (button) button.disabled = false;
    renderStreams();
  }
}

async function pauseWatchSession(sessionId = state.watch.session?.id || "") {
  if (!sessionId) return;
  state.watch.error = "";
  try {
    const result = await api(`/api/watch-sessions/${encodeURIComponent(sessionId)}/pause`, { method: "POST" });
    state.watch.session = result.session || state.watch.session;
    renderStatus("Watcher paused");
    await refreshWatchState();
  } catch (error) {
    state.watch.error = error.message || "Could not pause watcher";
    renderStatus(state.watch.error);
    renderWatchArea();
  }
}

async function stopWatchSession(sessionId = state.watch.session?.id || "") {
  if (!sessionId) return;
  state.watch.error = "";
  try {
    await api(`/api/watch-sessions/${encodeURIComponent(sessionId)}/stop`, {
      method: "POST",
      body: JSON.stringify({ stopAll: true })
    });
    state.watch = {
      ...state.watch,
      stream: null,
      streamer: null,
      session: null,
      events: [],
      detailOpen: false,
      keywordOpen: false,
      loading: false
    };
    state.selectedStreamKey = "";
    state.clips = [];
    renderStatus("Watcher stopped");
    renderWatchArea();
  } catch (error) {
    state.watch.error = error.message || "Could not stop watcher";
    renderStatus(state.watch.error);
    renderWatchArea();
  }
}

async function approveClipForBuilder(candidateId) {
  if (!candidateId) return;
  try {
    const result = await api(`/api/clips/candidates/${encodeURIComponent(candidateId)}/approve-builder`, {
      method: "POST",
      body: JSON.stringify({})
    });
    state.clips = (state.clips || []).map((clip) => clip.id === candidateId ? result.candidate : clip);
    renderStatus("Clip approved for Builder and 9:16 CapCut prep");
    renderClipsArea();
  } catch (error) {
    renderStatus(error.message || "Could not approve clip");
  }
}

async function declineClip(candidateId) {
  if (!candidateId) return;
  try {
    await api(`/api/clips/candidates/${encodeURIComponent(candidateId)}/decline`, {
      method: "POST",
      body: JSON.stringify({ reason: "Declined from Clips by operator." })
    });
    state.clips = (state.clips || []).filter((clip) => clip.id !== candidateId);
    renderStatus("Clip declined and removed from Clips");
    renderClipsArea();
  } catch (error) {
    renderStatus(error.message || "Could not decline clip");
  }
}

async function loadBuilderClipForCapCut(candidateId) {
  if (!candidateId) throw new Error("No Builder clip selected");
  const result = await api(`/api/clips/candidates/${encodeURIComponent(candidateId)}/capcut-workflow-inputs`, {
    timeoutMs: 25000
  });
  state.capcut.selectedBuilderClipId = candidateId;
  state.capcut.selectedBuilderClip = result.candidate || null;
  state.capcut.workflowInputs = {
    ...(state.capcut.workflowInputs || {}),
    ...(result.inputs || {})
  };
  state.capcut.workflowInputStatus = {
    missingInputs: result.missingInputs || [],
    loadedAt: new Date().toISOString()
  };
  localStorage.setItem("capcutSelectedBuilderClipId", candidateId);
  localStorage.setItem("capcutWorkflowInputs", JSON.stringify(state.capcut.workflowInputs));
  return result;
}

async function prepareBuilderClipForCapCut(candidateId, options = {}) {
  if (!candidateId) return;
  state.capcut.loading = true;
  state.capcut.error = "";
  let poll = null;
  renderClipsArea();
  try {
    const result = await loadBuilderClipForCapCut(candidateId);
    if (options.startTeaching) {
      await runCapCutPanelAction("connect");
      await runWorkflowAction("train");
      return;
    }
    renderStatus("Builder clip loaded into CapCut workflow inputs");
  } catch (error) {
    state.capcut.error = error.message || "Could not load Builder clip for CapCut";
    renderStatus(state.capcut.error);
  } finally {
    state.capcut.loading = false;
    renderClipsArea();
  }
}

async function loadCapCutStatus() {
  state.capcut.loading = true;
  state.capcut.error = "";
  renderClipsArea();
  try {
    const [status, teach] = await Promise.all([
      api("/api/capcut-control/status", { timeoutMs: 25000 }),
      api("/api/capcut-control/teach", { timeoutMs: 25000 }).catch(() => null)
    ]);
    state.capcut.status = status;
    state.capcut.agentStatus = {
      ...(state.capcut.agentStatus || {}),
      mode: "desktop_app",
      capcutInstalled: status.installed,
      capcutRunning: status.running
    };
    if (teach) {
      state.capcut.teach = teach.teach;
      state.capcut.macros = teach.macros || [];
      state.capcut.workflows = teach.workflows || [];
      state.capcut.planner = teach.planner || null;
      state.capcut.replay = teach.replay;
    }
  } catch (error) {
    state.capcut.error = error.message || "Could not read CapCut status";
  } finally {
    state.capcut.loading = false;
    renderClipsArea();
    api("/api/capcut/status", { timeoutMs: 5000 })
      .then((agentStatus) => {
        state.capcut.agentStatus = agentStatus;
        renderClipsArea();
      })
      .catch(() => {});
  }
}

async function runCapCutPanelAction(action) {
  state.capcut.loading = true;
  state.capcut.error = "";
  renderClipsArea();
  try {
    let result = null;
    if (action === "connect") result = await api("/api/capcut-control/park", { method: "POST", body: JSON.stringify({ mode: "compact" }), timeoutMs: 30000 });
    if (action === "open") result = await api("/api/capcut-control/open", { method: "POST", body: JSON.stringify({}), timeoutMs: 30000 });
    if (action === "park") result = await api("/api/capcut-control/park", { method: "POST", body: JSON.stringify({ mode: "compact" }), timeoutMs: 30000 });
    if (action === "focus") result = await api("/api/capcut-control/focus", { method: "POST", body: JSON.stringify({}), timeoutMs: 30000 });
    if (action === "screenshot") result = await api("/api/capcut-control/screenshot", { method: "POST", body: JSON.stringify({}), timeoutMs: 30000 });
    if (action === "refresh") result = await api("/api/capcut-control/status", { timeoutMs: 25000 });
    state.capcut.status = result?.status || result;
    renderStatus(action === "screenshot" ? "CapCut screenshot captured" : action === "park" ? "CapCut parked in automation workspace" : "CapCut workspace updated");
  } catch (error) {
    state.capcut.error = error.message || "CapCut action failed";
    renderStatus(state.capcut.error);
  } finally {
    state.capcut.loading = false;
    renderClipsArea();
  }
}

async function openCapCutPermission(permission) {
  try {
    state.capcut.status = await api(`/api/capcut-control/permissions/${encodeURIComponent(permission)}`, {
      method: "POST",
      body: JSON.stringify({}),
      timeoutMs: 20000
    });
    renderStatus("Opened macOS permission settings");
  } catch (error) {
    state.capcut.error = error.message || "Could not open permission settings";
    renderStatus(state.capcut.error);
  } finally {
    renderClipsArea();
  }
}

function syncMacroNameFromInput() {
  const input = $("#capcut-macro-name");
  if (input) {
    state.capcut.macroName = input.value.trim() || "vertical_916_capcut_workflow";
    localStorage.setItem("capcutMacroName", state.capcut.macroName);
  }
}

async function loadTeachState() {
  try {
    const result = await api("/api/capcut-control/teach", { timeoutMs: 25000 });
    state.capcut.teach = result.teach;
    state.capcut.macros = result.macros || [];
    state.capcut.workflows = result.workflows || [];
    state.capcut.planner = result.planner || null;
    state.capcut.replay = result.replay;
    await maybeAutoTeachSnapshot();
  } catch (error) {
    state.capcut.error = error.message || "Could not load Teach Mode";
  } finally {
    renderClipsArea();
  }
}

async function captureTeachSnapshot(reason = "manual") {
  if (state.capcut.snapshotBusy) return;
  state.capcut.snapshotBusy = true;
  renderClipsArea();
  try {
    const result = await api("/api/capcut-control/teach/snapshot", {
      method: "POST",
      body: JSON.stringify({ reason }),
      timeoutMs: 18000
    });
    state.capcut.teach = result.teach;
    state.capcut.macros = result.macros || state.capcut.macros || [];
    state.capcut.workflows = result.workflows || state.capcut.workflows || [];
    state.capcut.replay = result.replay || state.capcut.replay;
    state.capcut.lastTeachSnapshotAt = Date.now();
    if (reason !== "auto") renderStatus("Teaching frame captured");
  } catch (error) {
    if (reason !== "auto") {
      state.capcut.error = error.message || "Could not capture teaching frame";
      renderStatus(state.capcut.error);
    }
  } finally {
    state.capcut.snapshotBusy = false;
    renderClipsArea();
  }
}

async function maybeAutoTeachSnapshot() {
  const teach = state.capcut.teach || {};
  if (!teach.recording || state.capcut.snapshotBusy) return;
  const nowMs = Date.now();
  const lastLocal = Number(state.capcut.lastTeachSnapshotAt || 0);
  const lastRemote = Date.parse(teach.lastSnapshotAt || "") || 0;
  if (nowMs - Math.max(lastLocal, lastRemote) < 4500) return;
  await captureTeachSnapshot("auto");
}

async function runTeachAction(action) {
  syncMacroNameFromInput();
  state.capcut.loading = true;
  state.capcut.error = "";
  renderClipsArea();
  try {
    let result = null;
    if (action === "start") {
      result = await api("/api/capcut-control/teach/start", {
        method: "POST",
        body: JSON.stringify({ name: state.capcut.macroName }),
        timeoutMs: 45000
      });
      renderStatus("Teach Mode recording started");
    }
    if (action === "continue") {
      result = await api("/api/capcut-control/teach/start", {
        method: "POST",
        body: JSON.stringify({ name: state.capcut.macroName, appendToCurrent: true }),
        timeoutMs: 45000
      });
      renderStatus("Teach Mode recording continued");
    }
    if (action === "stop") {
      result = await api("/api/capcut-control/teach/stop", {
        method: "POST",
        body: JSON.stringify({ reason: "operator_stop" }),
        timeoutMs: 30000
      });
      renderStatus("Teach Mode recording stopped");
    }
    if (action === "save") {
      result = await api("/api/capcut-control/teach/save", {
        method: "POST",
        body: JSON.stringify({ name: state.capcut.macroName }),
        timeoutMs: 30000
      });
      renderStatus("CapCut macro saved");
    }
    if (action === "cancel") {
      result = await api("/api/capcut-control/teach/cancel", {
        method: "POST",
        body: JSON.stringify({}),
        timeoutMs: 30000
      });
      renderStatus("Teach Mode cancelled");
    }
    if (result) {
      state.capcut.teach = result.teach;
      state.capcut.macros = result.macros || state.capcut.macros || [];
      state.capcut.replay = result.replay || state.capcut.replay;
    }
  } catch (error) {
    state.capcut.error = error.message || "Teach Mode action failed";
    renderStatus(state.capcut.error);
  } finally {
    state.capcut.loading = false;
    await loadTeachState();
  }
}

async function runTeachPhaseAction(phaseId, action) {
  if (!phaseId || !action) return;
  syncMacroNameFromInput();
  const inputs = workflowInputsFromDom();
  state.capcut.loading = true;
  state.capcut.error = "";
  renderClipsArea();
  try {
    const result = await api(`/api/capcut-control/teach/phases/${encodeURIComponent(phaseId)}/${encodeURIComponent(action)}`, {
      method: "POST",
      body: JSON.stringify({ inputs, name: state.capcut.macroName, workflowId: verticalShortWorkflowId }),
      timeoutMs: action === "start" || action === "retry" ? 45000 : 30000
    });
    state.capcut.teach = result.teach;
    state.capcut.macros = result.macros || state.capcut.macros || [];
    state.capcut.workflows = result.workflows || state.capcut.workflows || [];
    state.capcut.replay = result.replay || state.capcut.replay;
    renderStatus({
      start: "Phase recording started",
      complete: "Phase finished",
      skip: "Optional phase skipped",
      retry: "Phase cleared and recording restarted"
    }[action] || "Teach phase updated");
  } catch (error) {
    state.capcut.error = error.message || "Teach phase action failed";
    renderStatus(state.capcut.error);
  } finally {
    state.capcut.loading = false;
    await loadTeachState();
  }
}

async function replayMacro(macroId, options = {}) {
  if (!macroId) return;
  const macro = (state.capcut.macros || []).find((item) => item.id === macroId || item.name === macroId) || {};
  const startIndex = Math.max(0, Number(options.startIndex || 0));
  const inputs = workflowInputsFromDom();
  state.capcut.loading = true;
  state.capcut.error = "";
  state.capcut.replay = {
    ...(state.capcut.replay || {}),
    macroId,
    macroName: macro.name || macroId,
    running: true,
    status: "starting",
    currentStepIndex: startIndex,
    totalSteps: Number(macro.stepCount || 0),
    startIndex,
    currentStepDescription: startIndex ? `Retrying from step ${startIndex + 1}` : "Starting CapCut macro replay",
    currentStepStatus: "starting",
    log: []
  };
  renderClipsArea();
  const poll = window.setInterval(() => loadTeachState(), 900);
  try {
    const result = await api(`/api/capcut-control/macros/${encodeURIComponent(macroId)}/replay`, {
      method: "POST",
      body: JSON.stringify({ startIndex, inputs }),
      timeoutMs: 120000
    });
    state.capcut.replay = result.replay;
    renderStatus("Macro replay finished");
  } catch (error) {
    state.capcut.error = error.message || "Macro replay failed";
    renderStatus(state.capcut.error);
  } finally {
    window.clearInterval(poll);
    state.capcut.loading = false;
    await loadTeachState();
  }
}

async function runAllMacros() {
  const macros = state.capcut.macros || [];
  if (!macros.length) return;
  const totalSteps = macros.reduce((sum, macro) => sum + Number(macro.stepCount || 0), 0);
  const inputs = workflowInputsFromDom();
  state.capcut.loading = true;
  state.capcut.error = "";
  state.capcut.replay = {
    ...(state.capcut.replay || {}),
    macroId: "capcut_macro_sequence_all",
    macroName: "Run All Macros",
    running: true,
    status: "starting",
    currentStepIndex: 0,
    totalSteps,
    currentStepDescription: `Starting ${macros.length} saved macros in order`,
    currentStepStatus: "starting",
    sequence: macros.map((macro, index) => ({
      macroId: macro.id,
      macroName: macro.name,
      orderIndex: index,
      stepCount: Number(macro.stepCount || 0)
    })),
    log: []
  };
  renderClipsArea();
  const poll = window.setInterval(() => loadTeachState(), 900);
  try {
    const result = await api("/api/capcut-control/macros/run-all", {
      method: "POST",
      body: JSON.stringify({ inputs }),
      timeoutMs: 300000
    });
    state.capcut.replay = result.replay;
    renderStatus("All macros finished");
  } catch (error) {
    state.capcut.error = error.message || "Run All failed";
    renderStatus(state.capcut.error);
  } finally {
    window.clearInterval(poll);
    state.capcut.loading = false;
    await loadTeachState();
  }
}

function retryMacroFromStep(stepIndex) {
  const replay = activeReplayForTeach() || state.capcut.replay || {};
  const teach = state.capcut.teach || {};
  const macroId = teach.savedMacroId || replay.macroId || (state.capcut.macros || []).find((macro) => macro.name === teach.name)?.id || "";
  replayMacro(macroId, { startIndex: Number(stepIndex || 0) });
}

async function editMacro(macroId) {
  if (!macroId) return;
  state.capcut.loading = true;
  state.capcut.error = "";
  renderClipsArea();
  try {
    const result = await api(`/api/capcut-control/macros/${encodeURIComponent(macroId)}/edit`, {
      method: "POST",
      body: JSON.stringify({}),
      timeoutMs: 30000
    });
    state.capcut.teach = result.teach;
    state.capcut.macros = result.macros || state.capcut.macros || [];
    state.capcut.replay = result.replay || state.capcut.replay;
    state.capcut.macroName = result.teach?.name || state.capcut.macroName;
    localStorage.setItem("capcutMacroName", state.capcut.macroName);
    renderStatus("Macro loaded for step editing");
  } catch (error) {
    state.capcut.error = error.message || "Could not load macro for editing";
    renderStatus(state.capcut.error);
  } finally {
    state.capcut.loading = false;
    await loadTeachState();
  }
}

async function renameMacro(macroId) {
  if (!macroId) return;
  const macro = (state.capcut.macros || []).find((item) => item.id === macroId || item.name === macroId);
  const currentName = macro?.name || macroId;
  const nextName = window.prompt("Rename CapCut macro", currentName);
  if (nextName === null) return;
  const cleanName = nextName.trim();
  if (!cleanName || cleanName === currentName) return;
  state.capcut.loading = true;
  state.capcut.error = "";
  renderClipsArea();
  try {
    const result = await api(`/api/capcut-control/macros/${encodeURIComponent(macroId)}/rename`, {
      method: "POST",
      body: JSON.stringify({ name: cleanName }),
      timeoutMs: 30000
    });
    state.capcut.teach = result.teach || state.capcut.teach;
    state.capcut.macros = result.macros || state.capcut.macros || [];
    state.capcut.workflows = result.workflows || state.capcut.workflows || [];
    state.capcut.replay = result.replay || state.capcut.replay;
    renderStatus("CapCut macro renamed");
  } catch (error) {
    state.capcut.error = error.message || "Could not rename macro";
    renderStatus(state.capcut.error);
  } finally {
    state.capcut.loading = false;
    await loadTeachState();
  }
}

async function reorderMacros(ids = []) {
  const macroIds = ids.filter(Boolean);
  if (!macroIds.length) return;
  state.capcut.error = "";
  try {
    const result = await api("/api/capcut-control/macros/order", {
      method: "POST",
      body: JSON.stringify({ ids: macroIds }),
      timeoutMs: 30000
    });
    state.capcut.teach = result.teach || state.capcut.teach;
    state.capcut.macros = result.macros || state.capcut.macros || [];
    state.capcut.workflows = result.workflows || state.capcut.workflows || [];
    state.capcut.replay = result.replay || state.capcut.replay;
    renderStatus("Macro order saved");
  } catch (error) {
    state.capcut.error = error.message || "Could not save macro order";
    renderStatus(state.capcut.error);
  } finally {
    await loadTeachState();
  }
}

async function deleteMacro(macroId) {
  if (!macroId) return;
  const macro = (state.capcut.macros || []).find((item) => item.id === macroId || item.name === macroId);
  const label = macro?.name || macroId;
  if (!window.confirm(`Delete saved CapCut macro "${label}"? A backup copy will be kept in the macro folder.`)) return;
  state.capcut.loading = true;
  state.capcut.error = "";
  renderClipsArea();
  try {
    const result = await api(`/api/capcut-control/macros/${encodeURIComponent(macroId)}`, {
      method: "DELETE",
      timeoutMs: 30000
    });
    state.capcut.teach = result.teach || null;
    state.capcut.macros = result.macros || [];
    state.capcut.workflows = result.workflows || state.capcut.workflows || [];
    state.capcut.replay = result.replay || state.capcut.replay;
    renderStatus("CapCut macro deleted");
  } catch (error) {
    state.capcut.error = error.message || "Could not delete macro";
    renderStatus(state.capcut.error);
  } finally {
    state.capcut.loading = false;
    await loadTeachState();
  }
}

async function editTeachStep(index, action) {
  const stepIndex = Number(index);
  if (!Number.isInteger(stepIndex)) return;
  state.capcut.loading = true;
  state.capcut.error = "";
  renderClipsArea();
  try {
    const result = await api(`/api/capcut-control/teach/steps/${stepIndex}/${action}`, {
      method: "POST",
      body: JSON.stringify({}),
      timeoutMs: 30000
    });
    state.capcut.teach = result.teach;
    state.capcut.macros = result.macros || state.capcut.macros || [];
    renderStatus(action === "trim" ? "Macro tail removed from selected step" : "Macro step deleted");
  } catch (error) {
    state.capcut.error = error.message || "Could not edit macro step";
    renderStatus(state.capcut.error);
  } finally {
    state.capcut.loading = false;
    await loadTeachState();
  }
}

async function setTeachStepTarget(index) {
  const stepIndex = Number(index);
  if (!Number.isInteger(stepIndex)) return;
  const step = state.capcut.teach?.steps?.[stepIndex] || {};
  const current = step.semanticTarget?.label || "";
  const label = window.prompt("What should this click target?", current);
  if (label === null) return;
  const cleanLabel = label.trim();
  if (!cleanLabel) {
    renderStatus("Target label was empty");
    return;
  }
  state.capcut.loading = true;
  state.capcut.error = "";
  renderClipsArea();
  try {
    const result = await api(`/api/capcut-control/teach/steps/${stepIndex}/target`, {
      method: "POST",
      body: JSON.stringify({ label: cleanLabel }),
      timeoutMs: 30000
    });
    state.capcut.teach = result.teach;
    state.capcut.macros = result.macros || state.capcut.macros || [];
    renderStatus(`Step ${stepIndex + 1} target set to ${cleanLabel}`);
  } catch (error) {
    state.capcut.error = error.message || "Could not set macro target";
    renderStatus(state.capcut.error);
  } finally {
    state.capcut.loading = false;
    await loadTeachState();
  }
}

async function updateTeachStepWait(index) {
  const stepIndex = Number(index);
  if (!Number.isInteger(stepIndex)) return;
  const input = document.querySelector(`[data-wait-step-ms="${stepIndex}"]`);
  const rawValue = String(input?.value ?? "").trim();
  const parsedMs = rawValue === "" ? 0 : Number(rawValue);
  if (!Number.isFinite(parsedMs)) {
    renderStatus("Wait time must be a number");
    return;
  }
  const ms = Math.max(0, Math.min(120000, Math.round(parsedMs)));
  state.capcut.loading = true;
  state.capcut.error = "";
  renderClipsArea();
  try {
    const result = await api(`/api/capcut-control/teach/steps/${stepIndex}/wait`, {
      method: "POST",
      body: JSON.stringify({ ms }),
      timeoutMs: 30000
    });
    state.capcut.teach = result.teach;
    state.capcut.macros = result.macros || state.capcut.macros || [];
    state.capcut.replay = result.replay || state.capcut.replay;
    renderStatus(`Step ${stepIndex + 1} wait set to ${ms}ms`);
  } catch (error) {
    state.capcut.error = error.message || "Could not update wait step";
    renderStatus(state.capcut.error);
  } finally {
    state.capcut.loading = false;
    await loadTeachState();
  }
}

async function cancelReplay() {
  try {
    const result = await api("/api/capcut-control/replay/cancel", {
      method: "POST",
      body: JSON.stringify({ reason: "operator_cancel" }),
      timeoutMs: 15000
    });
    state.capcut.replay = result.replay;
    renderStatus("Replay stop requested");
  } catch (error) {
    state.capcut.error = error.message || "Could not stop replay";
    renderStatus(state.capcut.error);
  } finally {
    renderClipsArea();
  }
}

async function pauseReplay() {
  try {
    const result = await api("/api/capcut-control/replay/pause", {
      method: "POST",
      body: JSON.stringify({ reason: "operator_pause" }),
      timeoutMs: 15000
    });
    state.capcut.replay = result.replay;
    renderStatus("Replay paused");
  } catch (error) {
    state.capcut.error = error.message || "Could not pause replay";
    renderStatus(state.capcut.error);
  } finally {
    renderClipsArea();
  }
}

async function resumeReplay() {
  try {
    const result = await api("/api/capcut-control/replay/resume", {
      method: "POST",
      body: JSON.stringify({}),
      timeoutMs: 15000
    });
    state.capcut.replay = result.replay;
    renderStatus("Replay resumed");
  } catch (error) {
    state.capcut.error = error.message || "Could not resume replay";
    renderStatus(state.capcut.error);
  } finally {
    renderClipsArea();
  }
}

function workflowInputsFromDom() {
  const inputs = { ...(state.capcut.workflowInputs || {}) };
  document.querySelectorAll("[data-workflow-input]").forEach((input) => {
    inputs[input.dataset.workflowInput] = input.value.trim();
  });
  state.capcut.workflowInputs = inputs;
  localStorage.setItem("capcutWorkflowInputs", JSON.stringify(inputs));
  return inputs;
}

async function runWorkflowAction(action) {
  const inputs = workflowInputsFromDom();
  state.capcut.loading = true;
  state.capcut.error = "";
  renderClipsArea();
  try {
    let result = null;
    if (action === "train") {
      state.capcut.macroName = verticalShortWorkflowId;
      localStorage.setItem("capcutMacroName", state.capcut.macroName);
      result = await api(`/api/capcut-control/workflows/${encodeURIComponent(verticalShortWorkflowId)}/train`, {
        method: "POST",
        body: JSON.stringify({ inputs }),
        timeoutMs: 45000
      });
      renderStatus("Workflow training started. Perform the edit once in CapCut, then save the trained workflow.");
    }
    if (action === "save") {
      result = await api(`/api/capcut-control/workflows/${encodeURIComponent(verticalShortWorkflowId)}/save`, {
        method: "POST",
        body: JSON.stringify({ inputs }),
        timeoutMs: 30000
      });
      renderStatus("Trained CapCut workflow saved with placeholders");
    }
    if (action === "run") {
      const workflow = workflowById(verticalShortWorkflowId);
      state.capcut.replay = {
        ...(state.capcut.replay || {}),
        workflowId: verticalShortWorkflowId,
        macroId: workflow.trainedMacro?.id || "",
        macroName: workflow.trainedMacro?.name || workflow.name,
        running: true,
        status: "starting",
        currentStepIndex: 0,
        totalSteps: Number(workflow.trainedMacro?.stepCount || 0),
        currentStepDescription: "Starting trained CapCut workflow",
        currentStepStatus: "starting",
        log: []
      };
      renderClipsArea();
      poll = window.setInterval(() => loadTeachState(), 900);
      result = await api(`/api/capcut-control/workflows/${encodeURIComponent(verticalShortWorkflowId)}/run`, {
        method: "POST",
        body: JSON.stringify({ inputs }),
        timeoutMs: 180000
      });
      renderStatus(`Workflow run ${result.run?.status || "finished"}`);
    }
    if (result?.teach) state.capcut.teach = result.teach;
    if (result?.macros) state.capcut.macros = result.macros;
    if (result?.replay) state.capcut.replay = result.replay;
  } catch (error) {
    state.capcut.error = error.message || "Workflow action failed";
    renderStatus(state.capcut.error);
  } finally {
    if (poll) window.clearInterval(poll);
    state.capcut.loading = false;
    await loadTeachState();
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  $("#stream-search-button")?.addEventListener("click", searchStreams);
  $("#stream-search-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchStreams();
  });
  document.addEventListener("click", (event) => {
    const watchButton = event.target.closest("[data-watch-streamer]");
    const moreButton = event.target.closest("[data-more-streams]");
    const pauseButton = event.target.closest("[data-pause-watch]");
    const stopButton = event.target.closest("[data-stop-watch]");
    const keywordsButton = event.target.closest("[data-open-keywords]");
    const closeKeywords = event.target.closest("[data-close-keywords]");
    const keywordsBackdrop = event.target.matches("[data-keywords-modal]");
    const watchDetailButton = event.target.closest("[data-open-watch-detail]");
    const closeWatchDetail = event.target.closest("[data-close-watch-detail]");
    const watchDetailBackdrop = event.target.matches("[data-watch-detail-modal]");
    const approveClipButton = event.target.closest("[data-approve-clip]");
    const declineClipButton = event.target.closest("[data-decline-clip]");
    const builderTeachClipButton = event.target.closest("[data-builder-teach-clip]");
    const builderTeachStartButton = event.target.closest("[data-builder-teach-start]");
    const capcutActionButton = event.target.closest("[data-capcut-action]");
    const permissionButton = event.target.closest("[data-open-permission]");
    const teachButton = event.target.closest("[data-teach-action]");
    const teachSnapshotButton = event.target.closest("[data-teach-snapshot]");
    const teachPhaseButton = event.target.closest("[data-teach-phase-action]");
    const macroRefreshButton = event.target.closest("[data-macro-refresh]");
    const runAllMacrosButton = event.target.closest("[data-run-all-macros]");
    const toggleMacroLibraryButton = event.target.closest("[data-toggle-macro-library]");
    const toggleDeterminismButton = event.target.closest("[data-toggle-determinism]");
    const editMacroButton = event.target.closest("[data-edit-macro]");
    const renameMacroButton = event.target.closest("[data-rename-macro]");
    const deleteMacroButton = event.target.closest("[data-delete-macro]");
    const replayButton = event.target.closest("[data-replay-macro]");
    const retryMacroStepButton = event.target.closest("[data-retry-macro-step]");
    const targetTeachStepButton = event.target.closest("[data-target-teach-step]");
    const updateWaitStepButton = event.target.closest("[data-update-wait-step]");
    const deleteTeachStepButton = event.target.closest("[data-delete-teach-step]");
    const trimTeachStepButton = event.target.closest("[data-trim-teach-step]");
    const replayPauseButton = event.target.closest("[data-replay-pause]");
    const replayResumeButton = event.target.closest("[data-replay-resume]");
    const replayCancelButton = event.target.closest("[data-replay-cancel]");
    const workflowButton = event.target.closest("[data-workflow-action]");
    if (approveClipButton) {
      approveClipForBuilder(approveClipButton.dataset.approveClip);
      return;
    }
    if (declineClipButton) {
      declineClip(declineClipButton.dataset.declineClip);
      return;
    }
    if (builderTeachStartButton) {
      prepareBuilderClipForCapCut(builderTeachStartButton.dataset.builderTeachStart, { startTeaching: true });
      return;
    }
    if (builderTeachClipButton) {
      prepareBuilderClipForCapCut(builderTeachClipButton.dataset.builderTeachClip);
      return;
    }
    if (capcutActionButton) {
      runCapCutPanelAction(capcutActionButton.dataset.capcutAction);
      return;
    }
    if (permissionButton) {
      openCapCutPermission(permissionButton.dataset.openPermission);
      return;
    }
    if (teachButton) {
      runTeachAction(teachButton.dataset.teachAction);
      return;
    }
    if (teachSnapshotButton) {
      captureTeachSnapshot("manual");
      return;
    }
    if (teachPhaseButton) {
      runTeachPhaseAction(teachPhaseButton.dataset.teachPhaseId, teachPhaseButton.dataset.teachPhaseAction);
      return;
    }
    if (macroRefreshButton) {
      loadTeachState();
      return;
    }
    if (toggleMacroLibraryButton) {
      state.capcut.macroLibraryCollapsed = !state.capcut.macroLibraryCollapsed;
      localStorage.setItem("capcutMacroLibraryCollapsed", String(state.capcut.macroLibraryCollapsed));
      renderClipsArea();
      return;
    }
    if (toggleDeterminismButton) {
      state.capcut.monitorCollapsed = !state.capcut.monitorCollapsed;
      localStorage.setItem("capcutMonitorCollapsed", String(state.capcut.monitorCollapsed));
      renderClipsArea();
      return;
    }
    if (runAllMacrosButton) {
      runAllMacros();
      return;
    }
    if (renameMacroButton) {
      renameMacro(renameMacroButton.dataset.renameMacro);
      return;
    }
    if (editMacroButton) {
      editMacro(editMacroButton.dataset.editMacro);
      return;
    }
    if (deleteMacroButton) {
      deleteMacro(deleteMacroButton.dataset.deleteMacro);
      return;
    }
    if (replayButton) {
      replayMacro(replayButton.dataset.replayMacro);
      return;
    }
    if (retryMacroStepButton) {
      retryMacroFromStep(retryMacroStepButton.dataset.retryMacroStep);
      return;
    }
    if (targetTeachStepButton) {
      setTeachStepTarget(targetTeachStepButton.dataset.targetTeachStep);
      return;
    }
    if (updateWaitStepButton) {
      updateTeachStepWait(updateWaitStepButton.dataset.updateWaitStep);
      return;
    }
    if (deleteTeachStepButton) {
      editTeachStep(deleteTeachStepButton.dataset.deleteTeachStep, "delete");
      return;
    }
    if (trimTeachStepButton) {
      editTeachStep(trimTeachStepButton.dataset.trimTeachStep, "trim");
      return;
    }
    if (replayPauseButton) {
      pauseReplay();
      return;
    }
    if (replayResumeButton) {
      resumeReplay();
      return;
    }
    if (replayCancelButton) {
      cancelReplay();
      return;
    }
    if (workflowButton) {
      runWorkflowAction(workflowButton.dataset.workflowAction);
      return;
    }
    if (pauseButton) {
      event.preventDefault();
      event.stopPropagation();
      pauseWatchSession(pauseButton.dataset.pauseWatch);
      return;
    }
    if (stopButton) {
      event.preventDefault();
      event.stopPropagation();
      stopWatchSession(stopButton.dataset.stopWatch);
      return;
    }
    if (watchButton) watchStreamer(watchButton.dataset.watchStreamer);
    if (moreButton) {
      state.visibleCount += 5;
      renderStreams();
    }
    if (keywordsButton) {
      state.watch.keywordOpen = true;
      renderWatchArea();
    }
    if (closeKeywords || keywordsBackdrop) {
      state.watch.keywordOpen = false;
      renderWatchArea();
    }
    if (watchDetailButton) {
      state.watch.detailOpen = true;
      renderWatchArea();
    }
    if (closeWatchDetail || watchDetailBackdrop) {
      state.watch.detailOpen = false;
      renderWatchArea();
    }
  });
  document.addEventListener("dragstart", (event) => {
    const card = event.target.closest?.("[data-macro-card]");
    if (!card || state.capcut.replay?.running || event.target.closest?.("button")) return;
    state.capcut.dragMacroId = card.dataset.macroId || "";
    card.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", state.capcut.dragMacroId);
  });
  document.addEventListener("dragover", (event) => {
    const list = event.target.closest?.(".macro-list");
    const dragging = document.querySelector(".macro-card.dragging");
    if (!list || !dragging) return;
    event.preventDefault();
    const cards = [...list.querySelectorAll("[data-macro-card]:not(.dragging)")];
    const after = cards.find((card) => event.clientY < card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2);
    if (after) list.insertBefore(dragging, after);
    else list.appendChild(dragging);
  });
  document.addEventListener("drop", async (event) => {
    const list = event.target.closest?.(".macro-list");
    const dragging = document.querySelector(".macro-card.dragging");
    if (!list || !dragging) return;
    event.preventDefault();
    dragging.classList.remove("dragging");
    const ids = [...list.querySelectorAll("[data-macro-card]")]
      .map((card) => card.dataset.macroId)
      .filter(Boolean);
    state.capcut.dragMacroId = "";
    await reorderMacros(ids);
  });
  document.addEventListener("dragend", (event) => {
    event.target.closest?.("[data-macro-card]")?.classList.remove("dragging");
    state.capcut.dragMacroId = "";
  });
  document.addEventListener("input", (event) => {
    if (event.target?.id === "capcut-macro-name") {
      state.capcut.macroName = event.target.value;
      localStorage.setItem("capcutMacroName", state.capcut.macroName);
    }
    if (event.target?.matches?.("[data-workflow-input]")) {
      workflowInputsFromDom();
    }
  });
  document.addEventListener("keydown", (event) => {
    const detailCard = event.target.closest?.("[data-open-watch-detail]");
    if (event.key === "Enter" && event.target?.matches?.("[data-wait-step-ms]")) {
      event.preventDefault();
      updateTeachStepWait(event.target.dataset.waitStepMs);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && detailCard) {
      event.preventDefault();
      state.watch.detailOpen = true;
      renderWatchArea();
    }
    if (event.key === "Escape" && (state.watch.detailOpen || state.watch.keywordOpen)) {
      state.watch.detailOpen = false;
      state.watch.keywordOpen = false;
      renderWatchArea();
    }
  });
  renderStatus("Ready");
  await loadProviderStatus();
  await refreshWatchState().catch(() => {
    renderWatchArea();
  });
  await loadCapCutStatus();
  window.setInterval(() => {
    if (state.capcut.teach?.recording || state.capcut.replay?.running) {
      loadTeachState();
    }
  }, 2000);
  startWatchPolling();
  renderClipsArea();
});

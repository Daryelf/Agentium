const apiBasePath = window.location.pathname.startsWith("/apps/clipping-office")
  ? "/apps/clipping-office"
  : "";
const isAutomationWorker = new URLSearchParams(window.location.search).get("automation-worker") === "1";
const verticalShortWorkflowId = "vertical_916_auto_frame_blur_background_bottom_sticker";

function loadSavedWorkflowInputs() {
  try {
    const parsed = JSON.parse(localStorage.getItem("capcutWorkflowInputs") || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const editorStickerLibraryStorageKey = "argentumEditorStickerLibrary";
const editorDefaultStickerStorageKey = "argentumEditorDefaultSticker";
const editorSelectedTimelineLayerStorageKey = "argentumEditorSelectedTimelineLayer";
const editorBuilderOrderStorageKey = "argentumEditorBuilderOrder";
const watchSessionIdsStorageKey = "argentumClippingOfficeWatchSessionIds";
const appViewStorageKey = "argentumClippingOfficeView";
const clipFormatStorageKey = "argentumClippingOfficeClipFormat";
const autoPipelineStorageKey = "argentumClippingOfficeAutoPipeline";
const autoPipelineStageStorageKey = "argentumClippingOfficeAutoPipelineStage";
const argentumCommandBarStorageKey = "argentumClippingOfficeCommandBarCollapsed";
const argentumAgentThreadStorageKey = "argentumClippingOfficeAgent101Thread";
const AUTOMATION_STAGES = [
  {
    level: 0,
    id: "discovery",
    label: "Discovery",
    automatic: "Capture and score moments",
    gate: "You choose which clips enter Studio."
  },
  {
    level: 1,
    id: "studio",
    label: "Studio",
    automatic: "Approve captures and prepare the Studio edit",
    gate: "You finish the edit and send it to Precheck."
  },
  {
    level: 2,
    id: "precheck",
    label: "Precheck",
    automatic: "Prepare, edit, caption, reframe, and render",
    gate: "You validate the rendered clip in Review."
  },
  {
    level: 3,
    id: "product_ready",
    label: "Product Ready",
    automatic: "Run Precheck and approve the verified render",
    gate: "The finished clip waits locally and remains unposted."
  },
  {
    level: 4,
    id: "library",
    label: "Library",
    automatic: "Complete the entire local clip workflow",
    gate: "Save to your selected folder. Publishing stays off."
  }
];
const CLIP_FORMATS = {
  vertical: { id: "9:16", label: "9:16", className: "format-vertical", description: "Vertical short-form video" },
  fullscreen: { id: "16:9", label: "Full screen", className: "format-fullscreen", description: "Landscape full-screen video" },
  portrait: { id: "3:4", label: "3:4", className: "format-portrait", description: "Portrait feed video" }
};
const APP_VIEWS = new Set(["discover", "studio", "review", "library", "settings"]);

function loadSavedClipFormat() {
  const saved = localStorage.getItem(clipFormatStorageKey) || "9:16";
  return Object.values(CLIP_FORMATS).some((format) => format.id === saved) ? saved : "9:16";
}

function loadSavedAutoPipelineStage() {
  const savedValue = localStorage.getItem(autoPipelineStageStorageKey);
  const saved = Number(savedValue);
  if (savedValue !== null && Number.isInteger(saved) && saved >= 0 && saved < AUTOMATION_STAGES.length) return saved;
  return localStorage.getItem(autoPipelineStorageKey) === "false" ? 0 : AUTOMATION_STAGES.length - 1;
}

function automationStage(level = state.settings.autoPipelineStage) {
  const normalized = Math.max(0, Math.min(AUTOMATION_STAGES.length - 1, Math.round(Number(level) || 0)));
  return AUTOMATION_STAGES[normalized];
}

function selectedClipFormat() {
  return Object.values(CLIP_FORMATS).find((format) => format.id === state.settings.outputFormat) || CLIP_FORMATS.vertical;
}

function initialAppView() {
  return "discover";
}

function loadSavedWatchSessionIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(watchSessionIdsStorageKey) || "[]");
    return Array.isArray(parsed) ? parsed.map((value) => String(value || "")).filter(Boolean).slice(-200) : [];
  } catch {
    return [];
  }
}

function saveWatchSessionIds() {
  try {
    localStorage.setItem(watchSessionIdsStorageKey, JSON.stringify((state.watch.knownSessionIds || []).slice(-200)));
  } catch {
    // The live watch list remains usable if storage is unavailable.
  }
}

function reconcileEditorWithVisibleClips() {
  const visibleIds = new Set((state.clips || []).map((clip) => clip.id).filter(Boolean));
  const approvedIds = new Set((state.clips || []).filter(clipApprovedForBuilder).map((clip) => clip.id).filter(Boolean));
  const editorRecords = [
    state.editor.autoReframePlans,
    state.editor.captions,
    state.editor.stickers,
    state.editor.captionNotes,
    state.editor.transcriptChats,
    state.editor.stickerPreviews,
    state.editor.timelineLayers
  ];
  editorRecords.forEach((record) => {
    Object.keys(record || {}).forEach((clipId) => {
      if (!visibleIds.has(clipId)) delete record[clipId];
    });
  });
  Object.keys(state.editor.draftSaveTimers || {}).forEach((clipId) => {
    if (visibleIds.has(clipId)) return;
    window.clearTimeout(state.editor.draftSaveTimers[clipId]);
    delete state.editor.draftSaveTimers[clipId];
  });
  state.openJourneys = new Set([...state.openJourneys].filter((clipId) => visibleIds.has(clipId)));
  state.editor.preparationAttemptedClipIds = new Set(
    [...state.editor.preparationAttemptedClipIds].filter((clipId) => visibleIds.has(clipId))
  );
  state.editor.autoPipelineFailedClipIds = new Set(
    [...state.editor.autoPipelineFailedClipIds].filter((clipId) => visibleIds.has(clipId))
  );
  [...hydratedEditorStickerPreviewClipIds].forEach((clipId) => {
    if (!visibleIds.has(clipId)) hydratedEditorStickerPreviewClipIds.delete(clipId);
  });
  if (state.editor.playback?.clipId && !visibleIds.has(state.editor.playback.clipId)) state.editor.playback = null;
  state.editor.builderOrder = (state.editor.builderOrder || []).filter((id) => approvedIds.has(id));
  saveEditorBuilderOrder();
  if (state.editor.selectedBuilderClipId && !visibleIds.has(state.editor.selectedBuilderClipId)) {
    state.editor.selectedBuilderClipId = "";
    localStorage.removeItem("argentumEditorSelectedBuilderClipId");
  }
  if (state.capcut.selectedBuilderClipId && !visibleIds.has(state.capcut.selectedBuilderClipId)) {
    state.capcut.selectedBuilderClipId = "";
    state.capcut.selectedBuilderClip = null;
    localStorage.removeItem("capcutSelectedBuilderClipId");
  }
}

function loadSavedEditorBuilderOrder() {
  try {
    const parsed = JSON.parse(localStorage.getItem(editorBuilderOrderStorageKey) || "[]");
    return Array.isArray(parsed) ? parsed.map((value) => String(value || "")).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function loadSavedEditorStickerLibrary() {
  try {
    const parsed = JSON.parse(localStorage.getItem(editorStickerLibraryStorageKey) || "[]");
    return Array.isArray(parsed)
      ? parsed.map((entry, index) => normalizeEditorStickerLibraryEntry(entry, index)).filter(Boolean).slice(0, 24)
      : [];
  } catch {
    return [];
  }
}

function loadSavedEditorDefaultSticker() {
  try {
    const parsed = JSON.parse(localStorage.getItem(editorDefaultStickerStorageKey) || "null");
    return parsed && typeof parsed === "object" ? normalizeEditorSticker(parsed) : null;
  } catch {
    return null;
  }
}

const initialAutoPipelineStage = loadSavedAutoPipelineStage();

const state = {
  activeView: initialAppView(),
  config: null,
  twitch: { configured: false, status: "checking" },
  kick: { configured: false, status: "checking" },
  streams: [],
  clips: [],
  openJourneys: new Set(),
  lastQuery: "",
  categoryFilter: "all",
  visibleCount: 20,
  streamDiscovery: {
    twitchAfter: "",
    kickCursor: "",
    twitchHasMore: false,
    kickHasMore: false,
    loadingMore: false
  },
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
  editor: {
    selectedBuilderClipId: localStorage.getItem("argentumEditorSelectedBuilderClipId") || "",
    builderOrder: loadSavedEditorBuilderOrder(),
    autoReframePlans: {},
    captions: {},
    stickers: {},
    captionGeneratingClipId: "",
    captionNotes: {},
    transcriptModalClipId: "",
    transcriptChats: {},
    transcriptChatPendingClipId: "",
    preparation: null,
    stickerPreviews: {},
    stickerLibrary: loadSavedEditorStickerLibrary(),
    defaultSticker: loadSavedEditorDefaultSticker(),
    preparationAttemptedClipIds: new Set(),
    autoPipelineRunningClipId: "",
    autoPipelineTimer: null,
    autoPipelineError: "",
    autoPipelineFailedClipIds: new Set(),
    exportingClipId: "",
    compileProgress: null,
    uploadingSource: false,
    productionBusyClipId: "",
    expandedProductionClipId: "",
    productionPages: { precheck: 0, product_ready: 0 },
    toolTab: localStorage.getItem("argentumEditorToolTab") === "sticker" ? "sticker" : "captions",
    timelineExpanded: localStorage.getItem("argentumEditorTimelineExpanded") === "true",
    selectedTimelineLayerId: localStorage.getItem(editorSelectedTimelineLayerStorageKey) || "video",
    timelineLayers: {},
    timelineDrag: null,
    lastRenderSignature: "",
    draftSaveTimers: {},
    playback: null
  },
  library: {
    query: "",
    filter: "all",
    page: 0,
    removalClipId: "",
    removalBusy: false,
    removalError: ""
  },
  settings: {
    outputFormat: loadSavedClipFormat(),
    autoPipelineStage: initialAutoPipelineStage,
    autoPipelineEnabled: initialAutoPipelineStage > 0,
    outputFolder: { configured: false, path: "", name: "" },
    serverManagedAutomation: false
  },
  automation: {
    enabled: true,
    pipelineStage: "library",
    focus: "streamer_university",
    focusLabel: "Streamer University",
    status: "starting",
    workerStatus: "starting",
    workerClipId: "",
    workerProgress: 0,
    workerStage: "",
    workerDetail: "",
    scannedStreams: 0,
    matchedStreams: 0,
    activeFocusedStreams: 0,
    providerPages: { twitch: 0, kick: 0 },
    providerErrors: [],
    focusOptions: [],
    busy: false,
    error: ""
  },
  buffer: {
    configured: false,
    status: "not_configured",
    mode: "manual_draft_only",
    autoPostingEnabled: false,
    schedulingEnabled: false,
    channels: [],
    lastCheckedAt: null,
    lastSuccessAt: null,
    message: "Buffer has not been checked.",
    loading: false,
    activeClipId: "",
    error: ""
  },
  watch: {
    stream: null,
    streamer: null,
    session: null,
    sessions: [],
    streams: [],
    streamers: [],
    events: [],
    allEvents: [],
    knownSessionIds: loadSavedWatchSessionIds(),
    detailOpen: false,
    keywordOpen: false,
    loading: false,
    polling: false,
    error: ""
  },
  watchPollTimer: null
};

const PRODUCTION_QUEUE_LIMIT = 50;
const WORKFLOW_RAIL_STAGES = [
  { id: "studio", label: "Studio", position: 0 },
  { id: "review", label: "Review", position: 25 },
  { id: "precheck", label: "Precheck", position: 50 },
  { id: "ready", label: "Ready", position: 75 },
  { id: "library", label: "Library", position: 100 }
];

const $ = (selector) => document.querySelector(selector);
const editorReframeSamplers = new WeakMap();
const EDITOR_STICKER_SOURCE_CACHE_LIMIT = 3;
const editorStickerSourceCache = new Map();
const hydratedEditorStickerPreviewClipIds = new Set();
let clipRemovalReturnFocus = null;
const argentumAgentChatState = {
  collapsed: localStorage.getItem(argentumCommandBarStorageKey) === "true",
  panelOpen: false,
  threadId: localStorage.getItem(argentumAgentThreadStorageKey) || "",
  thread: null,
  threadRequest: null,
  loading: false,
  sending: false,
  error: ""
};

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

function formatEditorTime(value) {
  const seconds = Math.max(0, Number(value || 0));
  const mins = Math.floor(seconds / 60);
  const rem = Math.floor(seconds % 60);
  return `${mins}:${String(rem).padStart(2, "0")}`;
}

async function api(path, options = {}) {
  const controller = new AbortController();
  const { timeoutMs = 15000, timeoutMessage = "", ...fetchOptions } = options;
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(apiUrl(path), {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(fetchOptions.headers || {})
      }
    });
    const contentType = response.headers.get("content-type") || "";
    const json = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : {};
    if (!response.ok) throw new Error(json.error || json.message || `${response.status} ${response.statusText}`);
    return json;
  } catch (error) {
    if (error?.name === "AbortError" || /signal is aborted/i.test(String(error?.message || ""))) {
      throw new Error(timeoutMessage || "The request took too long. The office will keep running; try that action again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function storeArgentumAgentThread(thread = null) {
  if (!thread?.id) return null;
  argentumAgentChatState.thread = thread;
  argentumAgentChatState.threadId = thread.id;
  try {
    localStorage.setItem(argentumAgentThreadStorageKey, thread.id);
  } catch {
    // The server thread remains available if browser storage is unavailable.
  }
  return thread;
}

function clearArgentumAgentThread() {
  argentumAgentChatState.thread = null;
  argentumAgentChatState.threadId = "";
  try {
    localStorage.removeItem(argentumAgentThreadStorageKey);
  } catch {
    // Nothing else is required when browser storage is unavailable.
  }
}

function argentumAgentConversation(thread = argentumAgentChatState.thread) {
  const visible = (thread?.messages || []).filter((message) => ["user", "agent", "system"].includes(message.role));
  const firstOperatorMessage = visible.findIndex((message) => message.role === "user");
  return firstOperatorMessage < 0 ? [] : visible.slice(firstOperatorMessage).slice(-10);
}

function argentumAgentMessagePreview(message = "") {
  const compact = String(message || "").replace(/\s+/g, " ").trim();
  return compact.length > 110 ? `${compact.slice(0, 107)}...` : compact;
}

function renderArgentumAgentChat() {
  const input = $("[data-agent101-chat-input]");
  const form = $("[data-agent101-chat-form]");
  const sendButton = $("[data-agent101-chat-send]");
  const status = $("[data-agent101-chat-status]");
  const panel = $("[data-agent101-chat-panel]");
  const panelToggle = $("[data-agent101-panel-toggle]");
  const messagesNode = $("[data-agent101-chat-messages]");
  const conversation = argentumAgentConversation();
  const latestAgentMessage = [...conversation].reverse().find((message) => message.role !== "user");

  if (input) input.disabled = argentumAgentChatState.sending;
  if (sendButton) sendButton.disabled = argentumAgentChatState.sending;
  form?.setAttribute("aria-busy", String(argentumAgentChatState.sending));
  if (panel) panel.hidden = !argentumAgentChatState.panelOpen;
  if (panelToggle) {
    panelToggle.setAttribute("aria-expanded", String(argentumAgentChatState.panelOpen));
    panelToggle.setAttribute("aria-label", argentumAgentChatState.panelOpen ? "Hide Agent 101 conversation" : "Show Agent 101 conversation");
    panelToggle.title = argentumAgentChatState.panelOpen ? "Hide conversation" : "Show conversation";
  }

  if (status) {
    status.classList.toggle("is-error", Boolean(argentumAgentChatState.error));
    status.textContent = argentumAgentChatState.sending
      ? "Agent 101 is responding"
      : argentumAgentChatState.loading
        ? "Loading Agent 101 thread"
        : argentumAgentChatState.error
          ? argentumAgentChatState.error
          : argentumAgentMessagePreview(latestAgentMessage?.content) || "Clipping Office context";
  }

  if (!messagesNode) return;
  messagesNode.replaceChildren();
  if (!conversation.length) {
    const empty = document.createElement("p");
    empty.className = "argentum-agent-empty";
    empty.textContent = "Clipping Office thread";
    messagesNode.append(empty);
    return;
  }
  conversation.forEach((message) => {
    const row = document.createElement("article");
    const label = document.createElement("strong");
    const body = document.createElement("p");
    row.className = `argentum-agent-message ${message.role === "user" ? "is-operator" : "is-agent"}`;
    label.textContent = message.role === "user" ? "You" : "Agent 101";
    body.textContent = String(message.content || "");
    row.append(label, body);
    messagesNode.append(row);
  });
  if (argentumAgentChatState.panelOpen) messagesNode.scrollTop = messagesNode.scrollHeight;
}

function setArgentumAgentPanelOpen(open, options = {}) {
  const next = Boolean(open) && !argentumAgentChatState.collapsed;
  argentumAgentChatState.panelOpen = next;
  renderArgentumAgentChat();
  if (next && options.load !== false && argentumAgentChatState.threadId && !argentumAgentChatState.thread) {
    loadArgentumAgentThread().catch(() => {});
  }
}

function setArgentumCommandBarCollapsed(collapsed, options = {}) {
  const next = Boolean(collapsed);
  const shell = $(".product-shell");
  const button = $("[data-argentum-command-toggle]");
  const glyph = $("[data-argentum-command-glyph]");
  argentumAgentChatState.collapsed = next;
  if (next) argentumAgentChatState.panelOpen = false;
  shell?.classList.toggle("is-argentum-command-collapsed", next);
  if (button) {
    button.setAttribute("aria-expanded", String(!next));
    button.setAttribute("aria-label", next ? "Restore Argentum bar" : "Minimize Argentum bar");
    button.title = next ? "Restore Argentum bar" : "Minimize Argentum bar";
  }
  if (glyph) glyph.textContent = next ? "+" : "\u2212";
  if (options.persist !== false) {
    try {
      localStorage.setItem(argentumCommandBarStorageKey, String(next));
    } catch {
      // The bar still works for the current session without browser storage.
    }
  }
  renderArgentumAgentChat();
}

async function loadArgentumAgentThread() {
  if (argentumAgentChatState.thread?.id) return argentumAgentChatState.thread;
  if (argentumAgentChatState.threadRequest) return argentumAgentChatState.threadRequest;
  if (!argentumAgentChatState.threadId) return null;
  argentumAgentChatState.loading = true;
  argentumAgentChatState.error = "";
  renderArgentumAgentChat();
  const request = api(`/api/argentum/agent101/chats/${encodeURIComponent(argentumAgentChatState.threadId)}`, {
    timeoutMs: 15000,
    timeoutMessage: "Agent 101 thread did not load in time"
  }).then((payload) => storeArgentumAgentThread(payload.thread));
  argentumAgentChatState.threadRequest = request;
  try {
    return await request;
  } catch (error) {
    if (/chat thread not found/i.test(String(error?.message || ""))) {
      clearArgentumAgentThread();
      return null;
    }
    argentumAgentChatState.error = error.message || "Agent 101 thread could not be loaded";
    throw error;
  } finally {
    argentumAgentChatState.threadRequest = null;
    argentumAgentChatState.loading = false;
    renderArgentumAgentChat();
  }
}

async function ensureArgentumAgentThread() {
  const saved = await loadArgentumAgentThread();
  if (saved?.id) return saved;
  const payload = await api("/api/argentum/agent101/chats", {
    method: "POST",
    body: JSON.stringify({ title: "Clipping Office Command", roomId: "clips-office" }),
    timeoutMs: 15000,
    timeoutMessage: "Agent 101 thread could not be created in time"
  });
  const thread = storeArgentumAgentThread(payload.thread);
  if (!thread) throw new Error("Agent 101 did not return a saved thread");
  return thread;
}

async function sendArgentumAgentMessage(message = "") {
  const content = String(message || "").trim();
  if (!content || argentumAgentChatState.sending) return;
  argentumAgentChatState.sending = true;
  argentumAgentChatState.error = "";
  setArgentumAgentPanelOpen(true, { load: false });
  try {
    const thread = await ensureArgentumAgentThread();
    const clientMessageId = `clipping-office-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = await api(`/api/argentum/agent101/chats/${encodeURIComponent(thread.id)}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content,
        roomId: "clips-office",
        clientMessageId,
        mode: "demo",
        maxSteps: 10
      }),
      timeoutMs: 120000,
      timeoutMessage: "Agent 101 is still working. The request was not marked complete."
    });
    const saved = storeArgentumAgentThread(payload.thread);
    if (!saved) throw new Error("Agent 101 response was not saved to the thread");
    const input = $("[data-agent101-chat-input]");
    if (input) input.value = "";
  } catch (error) {
    argentumAgentChatState.error = error.message || "Agent 101 could not answer this request";
  } finally {
    argentumAgentChatState.sending = false;
    renderArgentumAgentChat();
    $("[data-agent101-chat-input]")?.focus();
  }
}

function automationLevelForStage(stage = "library", enabled = true) {
  if (!enabled) return 0;
  return AUTOMATION_STAGES.find((item) => item.id === stage)?.level ?? AUTOMATION_STAGES.length - 1;
}

function applyServerAutomation(automation = {}) {
  state.automation = {
    ...state.automation,
    ...automation,
    providerPages: { ...state.automation.providerPages, ...(automation.providerPages || {}) },
    providerErrors: Array.isArray(automation.providerErrors) ? automation.providerErrors : [],
    focusOptions: Array.isArray(automation.focusOptions) ? automation.focusOptions : state.automation.focusOptions,
    busy: false,
    error: ""
  };
  const level = automationLevelForStage(state.automation.pipelineStage, state.automation.enabled);
  state.settings.autoPipelineStage = level;
  state.settings.autoPipelineEnabled = Boolean(state.automation.enabled && level > 0);
  state.settings.serverManagedAutomation = Boolean(state.automation.serverManaged);
  localStorage.setItem(autoPipelineStageStorageKey, String(level));
  localStorage.setItem(autoPipelineStorageKey, String(state.settings.autoPipelineEnabled));
  return state.automation;
}

async function loadServerAutomationSettings() {
  const result = await api("/api/automation/settings", {
    timeoutMs: 15000,
    timeoutMessage: "Automation settings are still loading. The office will retry in the background."
  });
  return applyServerAutomation(result.automation || {});
}

async function saveServerAutomationSettings(changes = {}) {
  state.automation.busy = true;
  state.automation.error = "";
  renderClipsArea({ force: true });
  try {
    const result = await api("/api/automation/settings", {
      method: "PATCH",
      body: JSON.stringify(changes),
      timeoutMs: 30000
    });
    applyServerAutomation(result.automation || {});
    renderClipsArea({ force: true });
    scheduleAutomaticPipeline(100);
    return state.automation;
  } catch (error) {
    state.automation.busy = false;
    state.automation.error = error.message || "Automation settings could not be saved.";
    renderStatus(state.automation.error);
    renderClipsArea({ force: true });
    throw error;
  }
}

async function runFocusedAutomationScan() {
  if (state.automation.busy) return;
  state.automation.busy = true;
  state.automation.error = "";
  renderClipsArea({ force: true });
  try {
    const result = await api("/api/automation/run", {
      method: "POST",
      body: JSON.stringify({}),
      timeoutMs: 180000,
      timeoutMessage: "The official provider scan is still running. It will finish in the background."
    });
    applyServerAutomation(result.automation || {});
    renderStatus(`Automation scan complete: ${formatNumber(state.automation.matchedStreams)} matching live streams.`);
  } catch (error) {
    state.automation.error = error.message || "The focused scan could not finish.";
    renderStatus(state.automation.error);
  } finally {
    state.automation.busy = false;
    renderClipsArea({ force: true });
  }
}

let lastAutomationWorkerReport = "";
let lastAutomationCompileReport = { clipId: "", percent: -10, stage: "" };
let automationWorkerRuntimeStarted = false;
let automationWorkerLockHeld = false;
let automationWorkerLockRequestInFlight = false;
let automationWorkerLockAttempt = 0;
let automationWorkerLockRetryTimer = null;
let automationWorkerFallbackStartPromise = null;
const AUTOMATION_WORKER_LOCK_NAME = "argentum-clipping-office-editor-worker";
const AUTOMATION_WORKER_LOCK_MAX_ATTEMPTS = 8;
const AUTOMATION_WORKER_LOCK_RETRY_BASE_MS = 1000;
const AUTOMATION_WORKER_LOCK_RETRY_MAX_MS = 15000;

function reportAutomationWorkerStatus(status = "ready", details = {}) {
  if (!isAutomationWorker) return;
  const signature = JSON.stringify([
    status,
    details.clipId || "",
    details.message || "",
    details.error || "",
    Number(details.progress || 0),
    details.stage || "",
    details.detail || ""
  ]);
  if (signature === lastAutomationWorkerReport) return;
  lastAutomationWorkerReport = signature;
  api("/api/automation/worker-status", {
    method: "POST",
    body: JSON.stringify({ status, ...details }),
    timeoutMs: 15000
  }).then((result) => applyServerAutomation(result.automation || {})).catch(() => {});
}

function reportAutomationCompileProgress(progress = {}) {
  if (!isAutomationWorker || !progress.clipId) return;
  const percent = Math.max(0, Math.min(100, Math.round(Number(progress.percent) || 0)));
  const stage = String(progress.stage || "Rendering video");
  const clipChanged = progress.clipId !== lastAutomationCompileReport.clipId;
  const stageChanged = stage !== lastAutomationCompileReport.stage;
  if (!clipChanged && !stageChanged && percent < 100 && percent - lastAutomationCompileReport.percent < 5) return;
  lastAutomationCompileReport = { clipId: progress.clipId, percent, stage };
  reportAutomationWorkerStatus("processing", {
    clipId: progress.clipId,
    progress: percent,
    stage,
    detail: String(progress.detail || ""),
    message: `${stage} · ${percent}%`
  });
}

function activateAutomationWorkerRuntime() {
  if (automationWorkerRuntimeStarted) return;
  automationWorkerRuntimeStarted = true;
  reportAutomationWorkerStatus(state.settings.autoPipelineEnabled ? "ready" : "paused", {
    message: state.settings.autoPipelineEnabled
      ? "Background editor is ready for verified clips."
      : "Background editor is paused by Automation settings."
  });
  scheduleAutomaticPipeline(250);
}

function stopAutomationWorkerRuntimeTimers() {
  window.clearInterval(state.watchPollTimer);
  state.watchPollTimer = null;
  window.clearTimeout(state.editor.autoPipelineTimer);
  state.editor.autoPipelineTimer = null;
}

function holdAutomationWorkerLockUntilUnload() {
  return new Promise((resolve) => {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      window.removeEventListener("beforeunload", release);
      window.removeEventListener("pagehide", release);
      resolve();
    };
    window.addEventListener("beforeunload", release, { once: true });
    window.addEventListener("pagehide", release, { once: true });
  });
}

async function initializeOwnedAutomationWorkerRuntime({ requireLock = true } = {}) {
  await initializeAutomationWorker();
  await loadClipOutputFolder().catch(() => {});
  if (requireLock && !automationWorkerLockHeld) {
    throw new Error("Automation worker lock was released before startup completed.");
  }
  startWatchPolling();
  activateAutomationWorkerRuntime();
}

function scheduleAutomationWorkerLockRetry() {
  if (!isAutomationWorker || automationWorkerRuntimeStarted || automationWorkerLockHeld || automationWorkerLockRequestInFlight) return false;
  if (automationWorkerLockAttempt >= AUTOMATION_WORKER_LOCK_MAX_ATTEMPTS) return false;
  window.clearTimeout(automationWorkerLockRetryTimer);
  const delayMs = Math.min(
    AUTOMATION_WORKER_LOCK_RETRY_MAX_MS,
    AUTOMATION_WORKER_LOCK_RETRY_BASE_MS * (2 ** Math.max(0, automationWorkerLockAttempt - 1))
  );
  automationWorkerLockRetryTimer = window.setTimeout(() => {
    automationWorkerLockRetryTimer = null;
    startAutomationWorkerRuntime();
  }, delayMs);
  return true;
}

function startAutomationWorkerRuntime() {
  if (!isAutomationWorker || automationWorkerRuntimeStarted || automationWorkerLockHeld || automationWorkerLockRequestInFlight) return;

  let lockManager = null;
  try {
    lockManager = navigator.locks;
  } catch (error) {
    state.watch.error = error?.message || "Automation worker lock API could not be read.";
    automationWorkerLockAttempt += 1;
    scheduleAutomationWorkerLockRetry();
    return;
  }

  if (!lockManager || typeof lockManager.request !== "function") {
    if (automationWorkerFallbackStartPromise) return;
    automationWorkerFallbackStartPromise = initializeOwnedAutomationWorkerRuntime({ requireLock: false })
      .catch((error) => {
        stopAutomationWorkerRuntimeTimers();
        state.watch.error = error?.message || "Automation worker startup failed.";
      })
      .finally(() => {
        automationWorkerFallbackStartPromise = null;
      });
    return;
  }

  if (automationWorkerLockAttempt >= AUTOMATION_WORKER_LOCK_MAX_ATTEMPTS) return;
  automationWorkerLockAttempt += 1;
  automationWorkerLockRequestInFlight = true;
  let request = null;
  try {
    request = lockManager.request(AUTOMATION_WORKER_LOCK_NAME, {
      mode: "exclusive",
      ifAvailable: true
    }, async (lock) => {
      if (!lock) {
        stopAutomationWorkerRuntimeTimers();
        return false;
      }
      automationWorkerLockHeld = true;
      try {
        await initializeOwnedAutomationWorkerRuntime({ requireLock: true });
        automationWorkerLockAttempt = 0;
        await holdAutomationWorkerLockUntilUnload();
        return true;
      } finally {
        automationWorkerLockHeld = false;
        stopAutomationWorkerRuntimeTimers();
      }
    });
  } catch (error) {
    automationWorkerLockRequestInFlight = false;
    state.watch.error = error?.message || "Automation worker lock request failed.";
    stopAutomationWorkerRuntimeTimers();
    scheduleAutomationWorkerLockRetry();
    return;
  }

  Promise.resolve(request)
    .catch((error) => {
      state.watch.error = error?.message || "Automation worker lock request failed.";
      stopAutomationWorkerRuntimeTimers();
      return false;
    })
    .finally(() => {
      automationWorkerLockRequestInFlight = false;
      if (!automationWorkerRuntimeStarted && !automationWorkerLockHeld) scheduleAutomationWorkerLockRetry();
    });
}

function formatAutomationTimestamp(value = "") {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "Not scanned yet";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(parsed));
}

async function apiFormData(path, formData, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs || 300000);
  try {
    const response = await fetch(apiUrl(path), {
      method: options.method || "POST",
      body: formData,
      signal: controller.signal
    });
    const contentType = response.headers.get("content-type") || "";
    const json = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : {};
    if (!response.ok) throw new Error(json.error || json.message || `${response.status} ${response.statusText}`);
    return json;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("The video operation timed out before it could finish.");
    throw error;
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

function streamCategoryGroup(stream = {}) {
  const category = String(stream.category || "").toLowerCase();
  const context = `${category} ${stream.title || ""}`.toLowerCase();
  if (/just chatting|irl|travel|outdoors|pools|hot tubs|special events|talk shows|podcast|reaction/.test(context)) return "irl";
  if (/sports|football|basketball|baseball|soccer|mma|boxing|wrestling|fitness|racing/.test(context)) return "sports";
  if (/music|dj|concert|singing|songwriting|instruments|performance/.test(context)) return "music";
  if (/art|creative|makers|crafting|software and game development|food & drink|beauty/.test(context)) return "creative";
  if (category && !/^(live|twitch|kick|unknown|other)$/.test(category)) return "gaming";
  return "other";
}

function matchesCategoryFilter(stream, filter) {
  return !filter || filter === "all" || streamCategoryGroup(stream) === filter;
}

function streamKey(stream = {}) {
  return `${stream.platform}:${stream.channelId || stream.displayName}`.toLowerCase();
}

function streamFromWatchSession(session = {}, streamer = {}) {
  const thumbnail = String(streamer.liveThumbnailUrl || streamer.thumbnail || "")
    .replace("{width}", "480")
    .replace("{height}", "270");
  return {
    id: streamer.id || session.streamerId || session.id || "",
    sessionId: session.id || "",
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

function watchPreviewUrl(stream = {}, tick = state.watch.previewTick || Date.now()) {
  const source = thumbnailUrl(stream);
  if (!source) return "";
  const separator = source.includes("?") ? "&" : "?";
  return `${source}${separator}argentum_snapshot=${encodeURIComponent(tick)}`;
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
  const value = message || "Ready";
  const searchNode = $("#search-status");
  const workspaceNode = $("#workspace-status");
  if (searchNode) searchNode.textContent = value;
  if (workspaceNode) workspaceNode.textContent = value;
}

function appViewCopy(view = state.activeView) {
  const copy = {
    discover: ["Discover", "Find live moments worth clipping"],
    studio: ["Studio", "Create a finished vertical clip"],
    review: ["Review", "Verify completed videos before handoff"],
    library: ["Library", "Finished edits, organized in one place"],
    settings: ["Settings", "Shape your clip workspace"]
  };
  return copy[view] || copy.studio;
}

function workflowRailStage(id = "studio") {
  return WORKFLOW_RAIL_STAGES.find((stage) => stage.id === id) || WORKFLOW_RAIL_STAGES[0];
}

function workflowRailStageForClip(clip = {}) {
  const stage = productionStage(clip);
  if (clip.productionWorkflow?.localLibraryPath || stage === "library") return workflowRailStage("library");
  if (stage === "product_ready") return workflowRailStage("ready");
  if (stage === "precheck") return workflowRailStage("precheck");
  const activeClipIds = new Set([
    state.editor.exportingClipId,
    state.editor.productionBusyClipId,
    state.editor.autoPipelineRunningClipId
  ].filter(Boolean));
  if (state.automation.workerStatus === "processing" && state.automation.workerClipId) {
    activeClipIds.add(state.automation.workerClipId);
  }
  return activeClipIds.has(clip.id) ? workflowRailStage("review") : workflowRailStage("studio");
}

function workflowRailTimestamp(clip = {}) {
  const parsed = Date.parse(clip.productionWorkflow?.updatedAt || clip.updatedAt || clip.createdAt || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function workflowRailClipTitle(clip = {}) {
  return String(
    clip.streamerName
    || clip.creatorName
    || clip.channelName
    || clip.title
    || "Untitled clip"
  ).trim();
}

function workflowRailClips() {
  const activeWorkerClipId = state.automation.workerStatus === "processing"
    ? state.automation.workerClipId
    : "";
  const eligible = (state.clips || [])
    .filter((clip) => !clipDeclined(clip))
    .filter((clip) => (
      clipApprovedForBuilder(clip)
      || productionStage(clip) !== "editing"
      || clip.id === activeWorkerClipId
      || clip.id === state.editor.exportingClipId
      || clip.id === state.editor.productionBusyClipId
      || clip.id === state.editor.autoPipelineRunningClipId
    ))
    .sort((a, b) => workflowRailTimestamp(b) - workflowRailTimestamp(a));
  const clipsByStage = new Map();
  eligible.forEach((clip) => {
    const stage = workflowRailStageForClip(clip);
    if (!clipsByStage.has(stage.id)) clipsByStage.set(stage.id, { clip, stage });
  });
  return WORKFLOW_RAIL_STAGES.map((stage) => clipsByStage.get(stage.id)).filter(Boolean);
}

function renderWorkflowRail() {
  const container = $("[data-workflow-clips]");
  const status = $("[data-workflow-status]");
  if (!container) return;
  const entries = workflowRailClips();
  const visibleIds = new Set(entries.map(({ clip }) => clip.id));

  Array.from(container.querySelectorAll("[data-workflow-clip]")).forEach((node) => {
    if (visibleIds.has(node.dataset.workflowClip)) {
      node.classList.remove("is-leaving");
      return;
    }
    node.classList.add("is-leaving");
    window.setTimeout(() => {
      if (node.classList.contains("is-leaving")) node.remove();
    }, 220);
  });

  entries.forEach(({ clip, stage }) => {
    let node = Array.from(container.querySelectorAll("[data-workflow-clip]"))
      .find((item) => item.dataset.workflowClip === clip.id);
    const isNew = !node;
    if (!node) {
      node = document.createElement("button");
      node.type = "button";
      node.className = "workflow-clip";
      node.dataset.workflowClip = clip.id;
      container.append(node);
    }

    const previousStage = node.dataset.workflowStage || "";
    const title = workflowRailClipTitle(clip);
    const thumbnail = clipThumbnailUrl(clip);
    const initials = title.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "CL";
    const contentSignature = JSON.stringify([title, thumbnail]);
    if (node.dataset.contentSignature !== contentSignature) {
      node.dataset.contentSignature = contentSignature;
      node.innerHTML = `
        <span class="workflow-clip-thumb">
          <span aria-hidden="true">${esc(initials)}</span>
          ${thumbnail ? `<img src="${esc(thumbnail)}" alt="" loading="eager">` : ""}
        </span>
        <span class="workflow-clip-copy"><strong>${esc(title)}</strong><small data-workflow-clip-stage></small></span>
      `;
      node.querySelector("img")?.addEventListener("error", (event) => event.currentTarget.remove(), { once: true });
    }
    node.dataset.workflowStage = stage.id;
    node.style.setProperty("--workflow-position", `${stage.position}%`);
    node.setAttribute("aria-label", `Open ${title} in ${stage.label}`);
    node.title = `${title} · ${stage.label}`;
    const stageLabel = node.querySelector("[data-workflow-clip-stage]");
    if (stageLabel) stageLabel.textContent = stage.label;
    node.classList.remove("is-leaving");

    if (isNew) {
      window.requestAnimationFrame(() => node.classList.add("is-visible"));
    } else {
      node.classList.add("is-visible");
    }
    if (previousStage && previousStage !== stage.id) {
      window.clearTimeout(node.workflowMoveTimer);
      node.classList.add("is-moving");
      node.workflowMoveTimer = window.setTimeout(() => node.classList.remove("is-moving"), 900);
    }
  });

  if (!status) return;
  const activeEntry = entries.find(({ clip }) => clip.id === state.automation.workerClipId);
  if (state.automation.workerStatus === "processing" && activeEntry) {
    status.textContent = `${workflowRailClipTitle(activeEntry.clip)} · ${state.automation.workerStage || "Moving through Review"}`;
    return;
  }
  const latest = [...entries].sort((a, b) => workflowRailTimestamp(b.clip) - workflowRailTimestamp(a.clip))[0];
  status.textContent = latest ? `${workflowRailClipTitle(latest.clip)} · ${latest.stage.label}` : "Standing by";
}

function openWorkflowClip(clipId = "") {
  const clip = (state.clips || []).find((candidate) => candidate.id === clipId);
  if (!clip) return;
  const stage = workflowRailStageForClip(clip);
  if (stage.id === "library") {
    setAppView("library");
    return;
  }
  if (["precheck", "ready"].includes(stage.id)) {
    state.editor.expandedProductionClipId = clip.id;
    setAppView("review");
    return;
  }
  state.editor.selectedBuilderClipId = clip.id;
  localStorage.setItem("argentumEditorSelectedBuilderClipId", clip.id);
  if (maybeAutoApplyEditorSticker(clip.id)) scheduleEditorDraftSave(clip.id);
  setAppView("studio");
}

function syncAppShell() {
  const [title, subtitle] = appViewCopy();
  const head = $("#product-view-head");
  if (head) {
    head.innerHTML = `<div><span>${esc(title)}</span><h1>${esc(subtitle)}</h1></div>`;
  }
  document.querySelectorAll("[data-app-view]").forEach((button) => {
    const active = button.dataset.appView === state.activeView;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  document.querySelectorAll("[data-app-surface]").forEach((surface) => {
    surface.hidden = surface.dataset.appSurface !== state.activeView;
  });
  const clipsArea = $("#clips-area");
  if (clipsArea) clipsArea.hidden = state.activeView === "discover";
  renderWorkflowRail();
}

function updateStartupStep(id, status, detail) {
  const step = document.querySelector(`[data-startup-step="${id}"]`);
  if (!step) return;
  step.classList.remove("is-active", "is-passed", "is-warning");
  if (status) step.classList.add(`is-${status}`);
  const indicator = step.querySelector("i");
  const label = step.querySelector("small");
  if (indicator && status === "passed") indicator.textContent = "✓";
  if (indicator && status === "warning") indicator.textContent = "!";
  if (label && detail) label.textContent = detail;
}

function updateStartupProgress(completed, message) {
  const progress = document.querySelector("[data-startup-progress]");
  const status = document.querySelector("[data-startup-message]");
  if (progress) progress.style.width = `${Math.max(6, Math.min(100, completed * 20))}%`;
  if (status && message) status.textContent = message;
}

async function runStartupStep(id, completedBefore, activeMessage, action) {
  updateStartupStep(id, "active", "Checking");
  updateStartupProgress(completedBefore, activeMessage);
  try {
    const result = await action();
    const warning = Boolean(result?.warning);
    updateStartupStep(id, warning ? "warning" : "passed", result?.detail || (warning ? "Limited" : "Ready"));
    updateStartupProgress(completedBefore + 1, result?.message || activeMessage);
    return result?.value ?? result;
  } catch (error) {
    updateStartupStep(id, "warning", "Retry available");
    updateStartupProgress(completedBefore + 1, error.message || `${activeMessage} could not finish.`);
    return null;
  }
}

async function finishStartupScreen(message = "Workspace ready") {
  updateStartupProgress(5, message);
  await new Promise((resolve) => window.setTimeout(resolve, 280));
  const startup = $("#office-startup");
  startup?.classList.add("is-complete");
  document.body.classList.remove("office-starting");
  window.setTimeout(() => {
    if (startup) startup.hidden = true;
  }, 240);
}

function watchMemoryStatus(session = {}) {
  const memory = session.rollingBuffer || {};
  if (memory.running) {
    const retention = Number(memory.retentionSeconds || state.config?.rollingBufferRetentionSeconds || 180);
    const buffered = Math.max(0, Math.min(retention, Number(memory.bufferedSeconds || 0)));
    return buffered > 0
      ? `AI listening + viewing · ${formatNumber(buffered)}s remembered`
      : "AI listening + viewing · first segment starting";
  }
  if (memory.lastError) return "Media memory retrying automatically";
  if (session.captureStatus === "capturing") return "Building first playable window";
  return "Starting live media memory";
}

function setAppView(view = "studio", { updateHash = true } = {}) {
  const next = APP_VIEWS.has(view) ? view : "studio";
  state.activeView = next;
  localStorage.setItem(appViewStorageKey, next);
  if (updateHash && window.location.hash !== `#${next}`) {
    window.history.replaceState(null, "", `#${next}`);
  }
  state.editor.lastRenderSignature = "";
  syncAppShell();
  renderClipsArea({ force: true });
  const resetScroll = () => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo(0, 0);
  };
  resetScroll();
  window.requestAnimationFrame(resetScroll);
  if (next === "studio") window.setTimeout(() => resumeIncompleteSelectedEditorClip(), 0);
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

function matchingDiscoveryStreams() {
  const query = state.lastQuery.trim();
  return state.streams
    .filter((stream) => matchesQuery(stream, query))
    .filter((stream) => matchesCategoryFilter(stream, state.categoryFilter))
    .sort((a, b) => Number(b.viewerCount || 0) - Number(a.viewerCount || 0));
}

function discoveryProvidersHaveMore() {
  return Boolean(state.streamDiscovery.twitchHasMore || state.streamDiscovery.kickHasMore);
}

function renderStreams() {
  const rows = matchingDiscoveryStreams();
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
    grid.innerHTML = `
      <div class="empty-state">${esc(providerText)}</div>
      ${discoveryProvidersHaveMore() ? `<div class="more-row"><button type="button" data-more-streams ${state.streamDiscovery.loadingMore ? "disabled" : ""}>${state.streamDiscovery.loadingMore ? "Loading streams..." : "Search more live streams"}</button></div>` : ""}
    `;
    return;
  }

  const canShowMore = state.visibleCount < rows.length || discoveryProvidersHaveMore();
  grid.innerHTML = `
    ${visibleRows.map(streamCard).join("")}
    ${canShowMore ? `
      <div class="more-row">
        <button type="button" data-more-streams ${state.streamDiscovery.loadingMore ? "disabled" : ""}>${state.streamDiscovery.loadingMore ? "Loading streams..." : "Show more streams"}</button>
        <span>${visibleRows.length} shown · ${state.streams.length} loaded${discoveryProvidersHaveMore() ? " · more available" : ""}</span>
      </div>
    ` : ""}
  `;
  const filterLabel = $("#stream-category-filter")?.selectedOptions?.[0]?.textContent || "All categories";
  renderStatus(`${visibleRows.length} shown · ${rows.length} matching · ${state.streams.length} live streams loaded · highest viewers first · ${filterLabel}`);
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

async function loadDiscoveryStreamPage({ reset = false } = {}) {
  if (reset) {
    state.streams = [];
    state.streamDiscovery = {
      twitchAfter: "",
      kickCursor: "",
      twitchHasMore: Boolean(state.twitch.configured),
      kickHasMore: Boolean(state.kick.configured),
      loadingMore: false
    };
  }
  const includeTwitch = reset ? Boolean(state.twitch.configured) : state.streamDiscovery.twitchHasMore;
  const includeKick = reset ? Boolean(state.kick.configured) : state.streamDiscovery.kickHasMore;
  if (!includeTwitch && !includeKick) return { streams: [], errors: [] };
  const platform = includeTwitch && includeKick ? "all" : includeTwitch ? "twitch" : "kick";
  const params = new URLSearchParams({ platform, limit: "100" });
  if (!reset && includeTwitch && state.streamDiscovery.twitchAfter) params.set("twitch_after", state.streamDiscovery.twitchAfter);
  if (!reset && includeKick && state.streamDiscovery.kickCursor) params.set("kick_cursor", state.streamDiscovery.kickCursor);
  const result = await api(`/api/streams/discovery?${params}`, {
    timeoutMs: 35000,
    timeoutMessage: "Live stream discovery is taking longer than expected. You can retry Search without restarting the office."
  });
  const beforeCount = state.streams.length;
  state.streams = mergeStreams(state.streams, (result.streams || []).map(normalizeRecommendation));
  const addedCount = state.streams.length - beforeCount;
  const requested = new Set(result.requestedProviders || []);
  if (requested.has("twitch")) {
    state.streamDiscovery.twitchAfter = result.pagination?.twitch?.nextCursor || "";
    state.streamDiscovery.twitchHasMore = Boolean(result.pagination?.twitch?.hasMore);
  }
  if (requested.has("kick")) {
    state.streamDiscovery.kickCursor = result.pagination?.kick?.nextCursor || "";
    state.streamDiscovery.kickHasMore = Boolean(result.pagination?.kick?.hasMore);
  }
  if (!reset && addedCount === 0) {
    if (requested.has("twitch")) state.streamDiscovery.twitchHasMore = false;
    if (requested.has("kick")) state.streamDiscovery.kickHasMore = false;
  }
  return { ...result, addedCount };
}

async function showMoreStreams() {
  if (state.streamDiscovery.loadingMore) return;
  const rows = matchingDiscoveryStreams();
  if (state.visibleCount < rows.length) {
    state.visibleCount += 20;
    renderStreams();
    return;
  }
  if (!discoveryProvidersHaveMore()) return;
  state.streamDiscovery.loadingMore = true;
  renderStreams();
  try {
    const result = await loadDiscoveryStreamPage();
    state.visibleCount += 20;
    if (result.errors?.length && !result.addedCount) renderStatus(result.errors[0].message || "A live provider could not load more streams.");
  } catch (error) {
    renderStatus(error.message || "More live streams could not be loaded.");
  } finally {
    state.streamDiscovery.loadingMore = false;
    renderStreams();
  }
}

async function searchStreams() {
  const input = $("#stream-search-input");
  const categoryFilter = $("#stream-category-filter");
  const button = $("#stream-search-button");
  state.lastQuery = input?.value || "";
  state.categoryFilter = categoryFilter?.value || "all";
  state.visibleCount = 20;
  state.loading = true;
  if (button) {
    button.disabled = true;
    button.textContent = "Searching";
  }
  renderStatus("Searching official provider APIs...");
  renderStreams();

  try {
    await loadProviderStatus();
    const result = await loadDiscoveryStreamPage({ reset: true });
    if (result.errors?.length && !state.streams.length) {
      renderStatus(result.errors[0].message || "Live stream discovery failed");
    } else {
      renderStatus(`${state.streams.length} live stream${state.streams.length === 1 ? "" : "s"} loaded${discoveryProvidersHaveMore() ? " · more available" : ""}`);
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
    timeoutMs: 20000,
    timeoutMessage: `Starting ${stream.displayName || "this stream"} took too long. The existing watch pool is still active.`,
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
    ["chat_spike_detected", "chat_keyword_detected", "tension_emote_spike", "chat_signal_dead", "rolling_buffer_started", "rolling_buffer_unavailable", "capture_triggered", "content_moment_verified", "content_moment_review", "content_moment_filtered", "recording_window_low_score", "recording_window_created", "candidate_review", "source_capture_completed", "source_connected", "source_capability_degraded"].includes(event.type)
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
  const preview = watchPreviewUrl(stream);
  const mediaFallback = ["unavailable", "dead"].includes(String(session?.chatSignalState || "")) || session?.mediaFallbackState === "active";
  const mediaScore = Number(session?.lastMediaSignalScore || 0);
  const rollingBuffer = session?.rollingBuffer || {};
  const emergingTopics = Array.isArray(session?.trendingChatPhrases) ? session.trendingChatPhrases.slice(0, 4) : [];
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
          <div class="watch-modal-live">
            <small>Live snapshot · refreshes every 5 seconds</small>
            ${preview
              ? `<img src="${esc(preview)}" alt="Current snapshot of ${esc(stream.displayName)}" loading="eager" />`
              : `<strong>Preview image unavailable</strong><span>The watcher is still active; the next verified provider snapshot will appear here.</span>`}
          </div>
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
            <small>${mediaFallback ? "Media detector" : "Chat velocity"}</small>
            <strong>${mediaFallback ? (mediaScore ? `${mediaScore}%` : "Armed") : `${formatNumber(chatPpm)}/min`}</strong>
            <span>${mediaFallback ? "Audio + speech + visual scoring" : esc(watchKeywordStatus(session, keywords, events))}</span>
          </div>
          <div>
            <small>Video/audio</small>
            <strong>${esc(watchMediaStatus(capabilities))}</strong>
            <span>${capabilities.hasLiveVideo ? "Live frames and audio are available to the observer" : "Waiting for recorder buffer"}</span>
          </div>
          <div>
            <small>Live media memory</small>
            <strong>${rollingBuffer.running ? `${formatNumber(rollingBuffer.bufferedSeconds || 0)}s remembered` : "Warming up"}</strong>
            <span>${rollingBuffer.running ? `Listening and viewing · ${formatNumber(rollingBuffer.retentionSeconds || state.config?.rollingBufferRetentionSeconds || 0)}s bounded storage` : "Direct capture fallback remains armed"}</span>
          </div>
          <div>
            <small>Emerging human topics</small>
            <strong>${emergingTopics.length ? esc(emergingTopics.map((entry) => entry.phrase).join(" · ")) : "Learning live context"}</strong>
            <span>${session?.lastHumanInterest?.score ? `${Number(session.lastHumanInterest.score)}% human-interest signal` : "Names, receipts, conflict, relationships, stakes, and reveals"}</span>
          </div>
        </div>
        <div class="watch-modal-section">
          <h4>Live AI Detection Signals</h4>
          <div class="watch-events detail">
            ${events.length ? events.map((event) => `
              <span>
                <b>${esc(watchEventLabel(event))}</b>
                <em>${esc(watchEventMessage(event))}</em>
              </span>
            `).join("") : `<span><b>Observing</b><em>The agent is building rolling context from audio, speech, visual chronology, and chat.</em></span>`}
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

function renderEditorTranscriptModal() {
  const clipId = state.editor.transcriptModalClipId || "";
  if (!clipId) return "";
  const clip = builderClipById(clipId);
  const detail = editorTranscriptDetailForClip(clip);
  const title = clip ? editorAssetName(clip) : "Transcript";
  const storedFrames = (clip?.editorFrameCapture?.frames || []).map((frame) => ({
    ...frame,
    dataUrl: frame.previewUrl ? apiUrl(frame.previewUrl) : ""
  })).filter((frame) => frame.dataUrl);
  const restoredMessages = storedFrames.length ? [
    {
      role: "user",
      kind: "auto-caption-request",
      text: automaticCaptionRequestText(clip),
      frames: storedFrames
    },
    ...(detail.currentCaption ? [{ role: "assistant", kind: "auto-caption-answer", text: detail.currentCaption }] : [])
  ] : [];
  const chat = state.editor.transcriptChats[clipId] || { messages: restoredMessages, error: "" };
  const pending = state.editor.transcriptChatPendingClipId === clipId;
  return `
    <div class="watch-modal" data-editor-transcript-modal>
      <div class="watch-modal-card editor-transcript-modal-card" role="dialog" aria-modal="true" aria-label="Clip transcript">
        <div class="watch-modal-head">
          <div>
            <span class="watch-kicker">Transcript View</span>
            <h3>${esc(title)}</h3>
            <p>${esc(detail.note)}</p>
          </div>
          <button type="button" class="icon-close" data-close-editor-transcript aria-label="Close transcript">&times;</button>
        </div>
        <div class="editor-transcript-grid">
          <section>
            <small>Source</small>
            <strong>${esc(detail.source)}</strong>
          </section>
          <section>
            <small>Current caption</small>
            <strong>${esc(detail.currentCaption || "No caption generated yet")}</strong>
          </section>
          <section>
            <small>Transcription pass</small>
            <strong>${esc(detail.model || "Not transcribed")}</strong>
            <span>${esc(`${detail.quality || "Quality unavailable"} · ${detail.segments || 0} timed segments`)}</span>
            <span>${esc(detail.fullClipStatus)}</span>
          </section>
        </div>
        <div class="editor-transcript-body">
          <small>What the AI heard</small>
          <pre>${esc(detail.transcript || "No transcript captured yet.")}</pre>
        </div>
        <section class="editor-clip-chat" data-clip-chat-for="${esc(clipId)}">
          <header>
            <div><small>GPT</small><strong>Ask about this clip</strong></div>
            <span>${pending ? "Thinking" : "Ready"}</span>
          </header>
          <div class="editor-clip-chat-messages" aria-live="polite">
            ${chat.messages.length ? chat.messages.map((message) => `
              <article class="${message.role === "user" ? "user" : "assistant"}">
                <small>${message.role === "user" ? (message.kind === "auto-caption-request" ? "Argentum Auto Message" : "You") : "GPT"}</small>
                <p>${esc(message.text)}</p>
                ${Array.isArray(message.frames) && message.frames.length ? `
                  <div class="editor-clip-chat-frames">
                    ${message.frames.map((frame) => `
                      <figure>
                        <img src="${esc(frame.dataUrl)}" alt="${esc(frame.label || frame.position || "Clip frame")}">
                        <figcaption>${esc(frame.label || frame.position || "Frame")} · ${Number(frame.timestampSeconds || 0).toFixed(1)}s</figcaption>
                      </figure>
                    `).join("")}
                  </div>
                ` : ""}
              </article>
            `).join("") : `<div class="editor-clip-chat-empty">Ask anything about the transcript, caption, or clip.</div>`}
            ${pending ? `<article class="assistant pending"><small>GPT</small><p>Thinking...</p></article>` : ""}
            ${chat.error ? `<div class="editor-clip-chat-error">${esc(chat.error)}</div>` : ""}
          </div>
          <form class="editor-clip-chat-composer" data-clip-chat-form data-clip-chat-id="${esc(clipId)}">
            <textarea rows="2" maxlength="3000" placeholder="Ask GPT..." data-clip-chat-input ${pending ? "disabled" : ""}></textarea>
            <button type="submit" ${pending ? "disabled" : ""}>Send</button>
          </form>
        </section>
      </div>
    </div>
  `;
}

function automaticCaptionRequestText(clip = {}) {
  const transcript = editorTranscriptTextForClip(clip);
  const visualContext = [
    ...(clip?.editorFrameAnalysis?.observations || []),
    ...(clip?.editorFrameAnalysis?.visualStory ? [clip.editorFrameAnalysis.visualStory] : []),
    ...(clip?.visionGate?.observations || []),
    ...(clip?.visualAnalysis?.observations || [])
  ].map((value) => String(value || "").trim()).filter(Boolean);
  return `Use this full transcript and the attached first, middle, and ending frames to write the best caption for ${editorAssetName(clip)}.

Identify the main emotion or moment. Never summarize. Make viewers curious. Sound like a real TikTok clip page, keep it under 12 words, and use 1-2 relevant emojis naturally. Return only the strongest accurate caption.

FRAME OBSERVATIONS:
${visualContext.length ? visualContext.map((value, index) => `${index + 1}. ${value}`).join("\n") : "No verified visual observations were captured. Stop and request another frame-analysis pass."}

FULL TRANSCRIPT:
${transcript || "No reliable speech transcript was captured. Do not invent dialogue or a caption."}`;
}

function setAutomaticCaptionChatRequest(clipId = "", frames = []) {
  const clip = builderClipById(clipId);
  const existing = state.editor.transcriptChats[clipId] || { messages: [], error: "" };
  const retained = existing.messages.filter((message) => message.kind !== "auto-caption-request" && message.kind !== "auto-caption-answer");
  state.editor.transcriptChats[clipId] = {
    messages: [...retained, {
      role: "user",
      kind: "auto-caption-request",
      text: automaticCaptionRequestText(clip),
      frames
    }].slice(-20),
    error: ""
  };
}

function setAutomaticCaptionChatAnswer(clipId = "", caption = "", analysis = {}) {
  const existing = state.editor.transcriptChats[clipId] || { messages: [], error: "" };
  const messages = existing.messages.filter((message) => message.kind !== "auto-caption-answer");
  const visualNote = String(analysis?.visualStory || "").trim();
  state.editor.transcriptChats[clipId] = {
    messages: [...messages, {
      role: "assistant",
      kind: "auto-caption-answer",
      text: visualNote ? `${caption}\n\nVisual read: ${visualNote}` : caption
    }].slice(-20),
    error: ""
  };
}

async function analyzeEditorFramesForCaption(clipId = "", options = {}) {
  const result = await api(`/api/clips/candidates/${encodeURIComponent(clipId)}/editor-frames`, {
    method: "POST",
    body: JSON.stringify({ force: options.force === true }),
    timeoutMs: 120000
  });
  if (result?.candidate) {
    state.clips = (state.clips || []).map((clip) => clip.id === clipId ? result.candidate : clip);
  }
  setAutomaticCaptionChatRequest(clipId, (result.frames || []).map((frame) => ({
    ...frame,
    dataUrl: frame.dataUrl || (frame.previewUrl ? apiUrl(frame.previewUrl) : "")
  })));
  return result;
}

async function sendEditorClipChat(clipId = "", message = "") {
  const text = String(message || "").trim();
  if (!clipId || !text || state.editor.transcriptChatPendingClipId) return;
  const existing = state.editor.transcriptChats[clipId] || { messages: [], error: "" };
  const messages = [...existing.messages, { role: "user", text }].slice(-20);
  state.editor.transcriptChats[clipId] = { messages, error: "" };
  state.editor.transcriptChatPendingClipId = clipId;
  state.editor.lastRenderSignature = "";
  renderClipsArea({ force: true });
  try {
    const result = await api(`/api/clips/candidates/${encodeURIComponent(clipId)}/chat`, {
      method: "POST",
      body: JSON.stringify({ message: text, history: messages.slice(0, -1) }),
      timeoutMs: 70000
    });
    state.editor.transcriptChats[clipId] = {
      messages: [...messages, { role: "assistant", text: result.answer || "No answer returned." }].slice(-20),
      error: ""
    };
  } catch (error) {
    state.editor.transcriptChats[clipId] = { messages, error: error.message || "GPT could not answer." };
  } finally {
    state.editor.transcriptChatPendingClipId = "";
    state.editor.lastRenderSignature = "";
    renderClipsArea({ force: true });
  }
}

function currentClips() {
  const sessionId = state.watch.session?.id || "";
  const streamerId = state.watch.streamer?.id || "";
  const multiWatchPool = (state.watch.sessions || []).length > 1;
  const clips = (state.clips || [])
    .filter((clip) => {
      if (clipApprovedForBuilder(clip) || clipDeclined(clip)) return false;
      if (multiWatchPool || (!sessionId && !streamerId)) return true;
      if (sessionId && clip.watchSessionId === sessionId) return true;
      if (streamerId && clip.streamerId === streamerId) return true;
      return false;
    })
    .sort((a, b) => String(b.createdAt || b.updatedAt || "").localeCompare(String(a.createdAt || a.updatedAt || "")))
    .slice(0, 50);
  return clips;
}

function clipPlaybackUrl(clip = {}) {
  if (clip.mediaPlayable && clip.sourceId) return apiUrl(`/api/media/sources/${encodeURIComponent(clip.sourceId)}/playback`);
  if (clip.playbackUrl) {
    const url = String(clip.playbackUrl || "");
    if (/^(blob:|data:|https?:)/.test(url)) return url;
    return apiUrl(url);
  }
  return "";
}

function clipThumbnailUrl(clip = {}) {
  const configured = String(clip.thumbnailUrl || clip.frameUrl || "").trim();
  if (configured) {
    if (/^(blob:|data:|https?:)/.test(configured)) return configured;
    return apiUrl(configured);
  }
  if (!clip.sourceId || !clip.id || !clip.mediaPlayable) return "";
  return apiUrl(`/api/media/sources/${encodeURIComponent(clip.sourceId)}/frame?candidateId=${encodeURIComponent(clip.id)}`);
}

function clipStatusLabel(clip = {}) {
  if (clip.builderApproved || clip.builderStatus === "approved" || clip.status === "builder_ready") return "Builder ready";
  if (clip.mediaPlayable || clip.bufferStatus === "verified_media_window") return "MP4 saved";
  if (clip.bufferStatus === "source_pending") return "Waiting for MP4";
  return clip.status || clip.decision || "Tracking";
}

function clipApprovedForBuilder(clip = {}) {
  return Boolean(
    clip.builderApproved
    || clip.builderStatus === "approved"
    || ["builder_ready", "in_builder"].includes(clip.status)
    || clip.builderDraft
  );
}

function clipDeclined(clip = {}) {
  return Boolean(clip.operatorDeclined || clip.declinedAt || clip.status === "rejected" || clip.decision === "rejected");
}

function clipUsesPracticeEvidence(clip = {}) {
  const sourceType = String(clip.sourceType || "").trim().toLowerCase();
  const provenance = [clip.sourceProvenance, clip.provenance]
    .map((value) => String(value || "").trim().toLowerCase());
  return provenance.includes("demo_source")
    || ["demo", "practice", "agent101_demo"].includes(sourceType);
}

function automaticClipMatchesFocus(clip = {}) {
  if (clipUsesPracticeEvidence(clip)) return false;
  const focus = String(state.automation.focus || "streamer_university").trim().toLowerCase();
  if (focus === "all") return true;
  const streamer = (state.watch.streamers || []).find((item) => item.id === clip.streamerId) || {};
  const session = (state.watch.sessions || []).find((item) => item.id === clip.watchSessionId) || {};
  const clipFocus = String(clip.automationFocus || session.automationFocus || "").trim().toLowerCase();
  const streamerFocus = String(streamer.automationFocus || "").trim().toLowerCase();
  if (clipFocus === focus) return true;
  if (
    streamerFocus === focus
    && streamer.automationManaged === true
    && (streamer.monitorEnabled === true || Boolean(session.id))
  ) return true;
  const tags = Array.isArray(streamer.officialLiveMetadata?.tags)
    ? streamer.officialLiveMetadata.tags.join(" ")
    : streamer.officialLiveMetadata?.tags;
  const text = [
    clip.streamerName,
    clip.creatorName,
    clip.title,
    clip.category,
    streamer.displayName,
    streamer.channelId,
    streamer.officialLiveMetadata?.title,
    streamer.officialLiveMetadata?.category,
    tags,
    session.title,
    session.category
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean).join(" | ");
  if (focus === "irl") return /\birl\b|\bjust chatting\b|\btalk shows?\b|\boutdoors?\b|\bspecial events?\b/i.test(text);
  return /\bstreamer\s*(?:university|u|uni)\b|\bstreameruniversity\b|\bstreameruni\b/i.test(text);
}

function productionStage(clip = {}) {
  return String(clip.productionWorkflow?.stage || "editing");
}

function productionClips(stage = "precheck") {
  return (state.clips || [])
    .filter((clip) => productionStage(clip) === stage && !clipDeclined(clip))
    .sort((a, b) => String(b.productionWorkflow?.updatedAt || b.updatedAt || "").localeCompare(String(a.productionWorkflow?.updatedAt || a.updatedAt || "")))
    .slice(0, PRODUCTION_QUEUE_LIMIT);
}

function productionPlaybackUrl(clip = {}) {
  const value = String(clip.productionWorkflow?.playbackUrl || "");
  if (!value) return "";
  return /^(blob:|data:|https?:)/.test(value) ? value : apiUrl(value);
}

function replaceClipInState(candidate = null) {
  if (!candidate?.id) return;
  const existing = (state.clips || []).some((clip) => clip.id === candidate.id);
  state.clips = existing
    ? state.clips.map((clip) => clip.id === candidate.id ? candidate : clip)
    : [candidate, ...(state.clips || [])];
}

function saveEditorBuilderOrder() {
  try {
    localStorage.setItem(editorBuilderOrderStorageKey, JSON.stringify(state.editor.builderOrder || []));
  } catch {
    // Local ordering remains available for the current session if storage is unavailable.
  }
}

function syncEditorBuilderOrder(clips = []) {
  const ids = clips.map((clip) => clip.id).filter(Boolean);
  const known = new Set(ids);
  const current = Array.isArray(state.editor.builderOrder) ? state.editor.builderOrder : [];
  const next = current.filter((id) => known.has(id));
  ids.forEach((id) => {
    if (!next.includes(id)) next.push(id);
  });
  if (next.length !== current.length || next.some((id, index) => id !== current[index])) {
    state.editor.builderOrder = next;
    saveEditorBuilderOrder();
  }
  return next;
}

function renderClipJourney(clip) {
  const journey = Array.isArray(clip.journey) ? clip.journey : [];
  if (!journey.length) return "";
  const open = state.openJourneys.has(clip.id);
  const doneCount = journey.filter((step) => step.status === "done").length;
  const failed = journey.some((step) => step.status === "failed");
  return `
    <div class="clip-journey">
      <button type="button" class="clip-journey-toggle ${failed ? "failed" : ""}" data-journey-toggle="${esc(clip.id)}">
        ${open ? "▾" : "▸"} Journey · ${doneCount}/${journey.length} stages${failed ? " · needs attention" : ""}
      </button>
      ${open ? `
        <ol class="clip-journey-steps">
          ${journey.map((step) => `
            <li class="${esc(step.status)}">
              <i></i>
              <div>
                <b>${esc(step.label)}</b>
                <span>${esc(step.detail || "")}</span>
                ${step.at ? `<small>${esc(step.at)}</small>` : ""}
              </div>
            </li>
          `).join("")}
        </ol>
      ` : ""}
    </div>
  `;
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
        ${renderClipJourney(clip)}
      </div>
      <div class="clip-actions">
        ${playback ? `<a href="${esc(playback)}" target="_blank" rel="noreferrer">View MP4</a>` : `<button type="button" disabled>Pending</button>`}
        ${playback ? `<button type="button" data-approve-clip="${esc(clip.id)}" ${approved ? "disabled" : ""}>${approved ? "Approved" : "Approve"}</button>` : ""}
        <button type="button" class="decline" data-decline-clip="${esc(clip.id)}">Decline</button>
        <button type="button" class="danger" data-remove-clip="${esc(clip.id)}">Remove</button>
      </div>
    </article>
  `;
}

function builderClips() {
  const clips = (state.clips || []).filter((clip) => (
    clipApprovedForBuilder(clip) && !clipDeclined(clip)
    && !["precheck", "product_ready"].includes(productionStage(clip))
  ));
  const order = syncEditorBuilderOrder(clips);
  const rank = new Map(order.map((id, index) => [id, index]));
  return clips.sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}

function selectedBuilderClip() {
  const clips = builderClips();
  return clips.find((clip) => clip.id === state.editor.selectedBuilderClipId)
    || clips.find((clip) => clip.id === state.capcut.selectedBuilderClipId)
    || state.capcut.selectedBuilderClip
    || clips[0]
    || null;
}

function builderClipById(clipId = "") {
  return builderClips().find((clip) => clip.id === clipId) || null;
}

function unloadEditorClip(clipId = "") {
  const activeId = selectedBuilderClip()?.id || state.editor.selectedBuilderClipId || "";
  if (clipId && activeId && clipId !== activeId) return;
  state.editor.selectedBuilderClipId = "";
  state.capcut.selectedBuilderClipId = "";
  state.capcut.selectedBuilderClip = null;
  state.editor.preparation = null;
  localStorage.removeItem("argentumEditorSelectedBuilderClipId");
  localStorage.removeItem("capcutSelectedBuilderClipId");
  state.editor.lastRenderSignature = "";
  renderClipsArea({ force: true });
  renderStatus("Clip unloaded from Argentum Editor");
}

function moveEditorBuilderClip(clipId = "", direction = 0) {
  const ids = builderClips().map((clip) => clip.id);
  const index = ids.indexOf(clipId);
  const nextIndex = index + Number(direction || 0);
  if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return;
  [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
  state.editor.builderOrder = ids;
  saveEditorBuilderOrder();
  renderClipsArea({ force: true });
  renderStatus(`Editor queue order updated · ${nextIndex + 1} of ${ids.length}`);
}

function moveEditorBuilderClipBefore(sourceId = "", targetId = "") {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const ids = builderClips().map((clip) => clip.id);
  const sourceIndex = ids.indexOf(sourceId);
  const targetIndex = ids.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0) return;
  ids.splice(sourceIndex, 1);
  ids.splice(ids.indexOf(targetId), 0, sourceId);
  state.editor.builderOrder = ids;
  saveEditorBuilderOrder();
  renderClipsArea({ force: true });
  renderStatus(`Editor queue order updated · ${ids.indexOf(sourceId) + 1} of ${ids.length}`);
}

const editorPreparationSteps = [
  { id: "media", label: "Load media", detail: "Verify the local MP4 and editor source" },
  { id: "audio", label: "Listen to audio", detail: "Analyze speech, volume, and transcript" },
  { id: "frames", label: "Capture frames", detail: "Save the first, middle, and ending frames" },
  { id: "vision", label: "Read the moment", detail: "Compare the frames with the full transcript" },
  { id: "captions", label: "Build captions", detail: "Create short text with context-matched emoji" },
  { id: "reframe", label: "Auto reframe", detail: "Map the moving subject inside the 3:4 frame" },
  { id: "ready", label: "Ready to review", detail: "Open the prepared edit in Argentum Editor" }
];

function editorPreparationStepStatus(preparation, step, index) {
  if (preparation?.status === "error" && step.id === preparation.step) return "error";
  if (preparation?.audioWarning && step.id === "audio") return "warning";
  if (preparation?.visualWarning && step.id === "vision") return "warning";
  if (preparation?.captionWarning && step.id === "captions") return "warning";
  if (preparation?.status === "complete") return "complete";
  const currentIndex = editorPreparationSteps.findIndex((item) => item.id === preparation?.step);
  if (currentIndex >= 0 && index < currentIndex) return "complete";
  if (step.id === preparation?.step) return "running";
  return "pending";
}

function updateEditorPreparationDom() {
  const preparation = state.editor.preparation;
  const bar = document.querySelector("[data-editor-preparation]");
  if (!preparation || !bar) return;
  const fill = bar.querySelector("[data-editor-preparation-fill]");
  const progress = bar.querySelector("[data-editor-preparation-progress]");
  const message = bar.querySelector("[data-editor-preparation-message]");
  if (fill) fill.style.width = `${Math.max(0, Math.min(100, Number(preparation.progress || 0)))}%`;
  if (progress) progress.textContent = `${Math.round(Number(preparation.progress || 0))}%`;
  if (message) message.textContent = preparation.message || "Preparing editor";
}

function setEditorPreparation(next = {}, { render = true } = {}) {
  state.editor.preparation = {
    ...(state.editor.preparation || {}),
    ...next,
    updatedAt: Date.now()
  };
  if (isAutomationWorker && state.editor.preparation.clipId && state.editor.preparation.status === "running") {
    const currentStep = editorPreparationSteps.find((step) => step.id === state.editor.preparation.step);
    reportAutomationWorkerStatus("processing", {
      clipId: state.editor.preparation.clipId,
      progress: Math.max(0, Math.min(100, Number(state.editor.preparation.progress || 0))),
      stage: currentStep?.label || state.editor.preparation.step || "Preparing clip",
      detail: state.editor.preparation.message || currentStep?.detail || "Preparing the verified local clip.",
      message: state.editor.preparation.message || "Preparing the verified local clip."
    });
  }
  if (render) {
    state.editor.lastRenderSignature = "";
    renderClipsArea({ force: true });
  } else {
    updateEditorPreparationDom();
  }
}

function renderEditorPreparationBar() {
  const preparation = state.editor.preparation;
  if (!preparation?.clipId) return "";
  const currentStep = editorPreparationSteps.find((step) => step.id === preparation.step) || editorPreparationSteps[0];
  const headline = preparation.status === "complete"
    ? "Editor preparation complete"
    : preparation.status === "error"
      ? "Editor preparation needs attention"
      : currentStep.label;
  const statusClass = preparation.status === "error" ? "error" : preparation.status === "complete" ? "complete" : "running";
  return `
    <section class="editor-preparation preview-handoff ${statusClass}" data-editor-preparation aria-live="polite">
      <div class="editor-preparation-head">
        <div>
          <span class="watch-kicker">Editor preparation</span>
          <strong>${esc(preparation.title || "Approved clip")}</strong>
          <span data-editor-preparation-message>${esc(preparation.message || currentStep.detail)}</span>
        </div>
        <div class="editor-preparation-status">
          <b>${esc(headline)}</b>
          <em data-editor-preparation-progress>${Math.round(Number(preparation.progress || 0))}%</em>
        </div>
      </div>
      <div class="editor-preparation-meter" aria-hidden="true"><span data-editor-preparation-fill style="width:${Math.max(0, Math.min(100, Number(preparation.progress || 0)))}%"></span></div>
      <div class="editor-preparation-steps">
        ${editorPreparationSteps.map((step, index) => {
          const stepStatus = editorPreparationStepStatus(preparation, step, index);
          const detail = step.id === "audio" && preparation.audioWarning
            ? preparation.audioWarning
            : step.id === "vision" && preparation.visualWarning
              ? preparation.visualWarning
            : step.id === "captions" && preparation.captionWarning
              ? preparation.captionWarning
            : step.id === preparation.step && preparation.message
              ? preparation.message
              : step.detail;
          return `
            <span class="${stepStatus}">
              <b>${index + 1}</b>
              <strong>${esc(step.label)}</strong>
              <em>${esc(detail)}</em>
            </span>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function editorReframePlanForClip(clip = null) {
  if (!clip?.id) return null;
  return state.editor.autoReframePlans[clip.id]
    || clip.builderDraft?.editorState?.autoReframe
    || clip.editorState?.autoReframe
    || null;
}

function editorDefaultVideoLayout() {
  return {
    canvas: { width: 1080, height: 1920, aspectRatio: "9:16" },
    subjectFrame: {
      width: 1080,
      height: 1440,
      aspectRatio: "3:4",
      xPercent: 50,
      yPercent: 50,
      widthPercent: 100,
      heightPercent: 75
    },
    background: { mode: "edge_fill", source: "video", blur: 18, opacity: 0.82 },
    controls: "external"
  };
}

function editorDefaultSticker() {
  return {
    enabled: false,
    type: "text",
    label: "Sticker",
    assetName: "",
    sourcePath: "",
    previewDataUrl: "",
    xPercent: 50,
    yPercent: 84,
    sizePercent: 24
  };
}

function persistableEditorStickerPreview(dataUrl = "") {
  const value = String(dataUrl || "");
  return value.startsWith("data:image/") && value.length < 650000 ? value : "";
}

function normalizeEditorSticker(sticker = {}) {
  const base = editorDefaultSticker();
  const xPercent = Math.min(92, Math.max(8, Number(sticker.xPercent ?? base.xPercent)));
  const yPercent = Math.min(94, Math.max(58, Number(sticker.yPercent ?? base.yPercent)));
  const sizePercent = Math.min(44, Math.max(8, Number(sticker.sizePercent ?? base.sizePercent)));
  return {
    ...base,
    ...sticker,
    enabled: Boolean(sticker.enabled),
    type: sticker.type === "image" ? "image" : "text",
    label: cleanEditorText(sticker.label || base.label),
    assetName: cleanEditorText(sticker.assetName || ""),
    sourcePath: String(sticker.sourcePath || ""),
    previewDataUrl: persistableEditorStickerPreview(sticker.previewDataUrl || ""),
    xPercent,
    yPercent,
    sizePercent
  };
}

function editorStickerSliderValue(field = "", value = 0) {
  const number = Math.round(Number(value || 0));
  if (field === "sizePercent") return `${number}%`;
  const offset = number - 50;
  return offset > 0 ? `+${offset}` : String(offset);
}

function cleanEditorText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function editorClipDuration(clip = null) {
  return Math.max(1, Number(clip?.durationSeconds || clip?.duration || state.config?.recordingWindowSeconds || 30));
}

function normalizeEditorStickerLibraryEntry(entry = {}, index = 0) {
  const rawSticker = entry.sticker && typeof entry.sticker === "object" ? entry.sticker : entry;
  const sticker = normalizeEditorSticker({ ...rawSticker, enabled: true });
  const id = String(entry.id || `sticker-${Date.now()}-${index}`).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
  const previewDataUrl = persistableEditorStickerPreview(entry.previewDataUrl || entry.dataUrl || sticker.previewDataUrl || "");
  return {
    id,
    name: cleanEditorText(entry.name || sticker.assetName || sticker.label || `Sticker ${index + 1}`) || `Sticker ${index + 1}`,
    sticker,
    placement: {
      xPercent: Number(entry.placement?.xPercent ?? sticker.xPercent),
      yPercent: Number(entry.placement?.yPercent ?? sticker.yPercent),
      sizePercent: Number(entry.placement?.sizePercent ?? sticker.sizePercent)
    },
    previewDataUrl,
    updatedAt: entry.updatedAt || new Date().toISOString()
  };
}

function saveEditorStickerLibrary() {
  const library = (state.editor.stickerLibrary || []).slice(0, 24);
  state.editor.stickerLibrary = library;
  localStorage.setItem(editorStickerLibraryStorageKey, JSON.stringify(library));
}

function saveEditorDefaultSticker(sticker = null) {
  const normalized = sticker ? normalizeEditorSticker(sticker) : null;
  if (!normalized?.enabled) return;
  state.editor.defaultSticker = normalized;
  try {
    localStorage.setItem(editorDefaultStickerStorageKey, JSON.stringify(normalized));
  } catch {
    // The active edit still keeps the sticker if local storage is unavailable.
  }
}

function saveCurrentStickerPreset(clipId = "") {
  const clip = builderClipById(clipId);
  const sticker = editorStickerForClip(clip);
  if (!clipId || !sticker.enabled) {
    renderStatus("Add a sticker first, then save it as a preset");
    return;
  }
  const previewDataUrl = persistableEditorStickerPreview(state.editor.stickerPreviews[clipId] || sticker.previewDataUrl || "");
  const name = cleanEditorText(sticker.assetName || sticker.label || "Sticker preset") || "Sticker preset";
  const existingIndex = (state.editor.stickerLibrary || []).findIndex((entry) => entry.name.toLowerCase() === name.toLowerCase());
  const existing = existingIndex >= 0 ? state.editor.stickerLibrary[existingIndex] : null;
  const entry = normalizeEditorStickerLibraryEntry({
    id: existing?.id || `sticker-${Date.now()}`,
    name,
    sticker: { ...sticker, enabled: true },
    placement: {
      xPercent: sticker.xPercent,
      yPercent: sticker.yPercent,
      sizePercent: sticker.sizePercent
    },
    previewDataUrl,
    updatedAt: new Date().toISOString()
  });
  const next = [...(state.editor.stickerLibrary || [])];
  if (existingIndex >= 0) next.splice(existingIndex, 1);
  next.unshift(entry);
  state.editor.stickerLibrary = next.slice(0, 24);
  saveEditorStickerLibrary();
  renderClipsArea();
  renderStatus(`Sticker preset saved: ${entry.name}`);
}

function applyEditorStickerPreset(clipId = "", presetId = "") {
  const entry = (state.editor.stickerLibrary || []).find((item) => item.id === presetId);
  if (!clipId || !entry) {
    renderStatus("Choose a saved sticker preset first");
    return;
  }
  hydratedEditorStickerPreviewClipIds.delete(clipId);
  if (entry.previewDataUrl) state.editor.stickerPreviews[clipId] = entry.previewDataUrl;
  else delete state.editor.stickerPreviews[clipId];
  setEditorSticker(clipId, {
    ...entry.sticker,
    ...(entry.placement || {}),
    enabled: true,
    previewDataUrl: entry.previewDataUrl || entry.sticker.previewDataUrl || ""
  });
  scheduleEditorDraftSave(clipId);
  renderClipsArea();
  renderStatus(`Sticker preset loaded: ${entry.name}`);
}

function editorStickerForClip(clip = null) {
  if (!clip?.id) return editorDefaultSticker();
  const saved = state.editor.stickers[clip.id]
    || clip.builderDraft?.editorState?.sticker
    || clip.editorState?.sticker
    || {};
  return normalizeEditorSticker(saved);
}

function setEditorSticker(clipId = "", nextSticker = {}, options = {}) {
  if (!clipId) return;
  const sticker = normalizeEditorSticker(nextSticker);
  if (sticker.enabled && options.remember !== false) saveEditorDefaultSticker(sticker);
  state.editor.stickers[clipId] = sticker;
  state.clips = (state.clips || []).map((clip) => {
    if (clip.id !== clipId) return clip;
    return {
      ...clip,
      builderDraft: {
        ...(clip.builderDraft || {}),
        editorState: {
          ...(clip.builderDraft?.editorState || {}),
          sticker
        }
      }
    };
  });
}

function maybeAutoApplyEditorSticker(clipId = "") {
  const clip = builderClipById(clipId);
  if (!clip || editorStickerForClip(clip).enabled) return false;
  const preset = state.editor.defaultSticker
    || state.editor.stickerLibrary?.[0]?.sticker
    || {
      ...editorDefaultSticker(),
      enabled: true,
      label: clip.streamerName || clip.creatorName || clip.channelName || "Watch now"
    };
  const sticker = normalizeEditorSticker({ ...preset, enabled: true });
  if (sticker.previewDataUrl) state.editor.stickerPreviews[clipId] = sticker.previewDataUrl;
  setEditorSticker(clipId, sticker, { remember: false });
  return true;
}

function editorDefaultCaptions() {
  return {
    enabled: false,
    source: "none",
    transcript: "",
    segments: [],
    style: {
      xPercent: 50,
      yPercent: 18,
      maxWords: 9,
      theme: "story"
    },
    updatedAt: ""
  };
}

function captionTextClean(value = "") {
  return String(value || "")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function captionDisplayText(value = "") {
  return captionTextClean(value)
    .replace(/[.!?]+$/g, "")
    .replace(/\s+([,;:])/g, "$1")
    .trim();
}

function isUnavailableTranscript(value = "") {
  return /transcript unavailable|no speech transcript|source data unavailable|until extraction|pending until/i.test(String(value || ""));
}

function isOperationalTranscript(value = "") {
  return /saved \d+s watcher buffer|watcher buffer from|agent 101 logged|live watch window|transcript and video scoring|no spike signal|review the playback|playable buffer|keyword appeared in chat|chat spiked during this window|audio energy peaked|voice energy spiked/i.test(String(value || ""));
}

function normalizeEditorCaptionSegment(segment = {}, index = 0, durationSeconds = 30) {
  const duration = Math.max(1, Number(durationSeconds || 30));
  const fallbackStart = Math.min(duration - 0.1, index * 2.6);
  const start = Math.min(duration, Math.max(0, Number(segment.startSeconds ?? segment.start ?? fallbackStart)));
  const rawEnd = Number(segment.endSeconds ?? segment.end ?? start + 2.6);
  const end = Math.min(duration, Math.max(start + 0.35, rawEnd));
  return {
    id: String(segment.id || `cap-${index + 1}`),
    startSeconds: Number(start.toFixed(2)),
    endSeconds: Number(end.toFixed(2)),
    text: captionDisplayText(segment.text || "").slice(0, 90)
  };
}

function normalizeEditorCaptions(captions = {}, durationSeconds = 30) {
  const base = editorDefaultCaptions();
  const style = {
    ...base.style,
    ...(captions.style || {})
  };
  const segments = (Array.isArray(captions.segments) ? captions.segments : [])
    .map((segment, index) => normalizeEditorCaptionSegment(segment, index, durationSeconds))
    .filter((segment) => segment.text && !isOperationalTranscript(segment.text));
  return {
    ...base,
    ...captions,
    enabled: Boolean(captions.enabled && segments.length),
    source: captions.source || (segments.length ? "clip_transcript" : "none"),
    transcript: captionTextClean(captions.transcript || ""),
    segments,
    style: {
      xPercent: Math.min(84, Math.max(16, Number(style.xPercent ?? base.style.xPercent))),
      yPercent: Math.min(82, Math.max(16, Number(style.yPercent ?? base.style.yPercent))),
      maxWords: Math.min(12, Math.max(5, Number(style.maxWords ?? base.style.maxWords))),
      theme: ["story", "reaction", "gaming"].includes(style.theme) ? style.theme : base.style.theme
    },
    updatedAt: captions.updatedAt || ""
  };
}

const verifiedEditorCaptionSources = new Set([
  "caption_intelligence_model",
  "caption_intelligence_local",
  "operator_edit"
]);
const verifiedEditorCaptionStatuses = new Set(["complete", "operator_approved", "review_required"]);

function editorCaptionVisualObservations(clip = null) {
  return [
    ...(clip?.editorFrameAnalysis?.observations || []),
    ...(clip?.editorFrameAnalysis?.visualStory ? [clip.editorFrameAnalysis.visualStory] : []),
    ...(clip?.visionGate?.observations || []),
    ...(clip?.visionGate?.analysisStatus === "completed" && clip?.visionGate?.skipped !== true && clip?.visionGate?.momentDescription
      ? [clip.visionGate.momentDescription]
      : []),
    ...(clip?.visualAnalysis?.observations || [])
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

function editorCaptionLooksInternal(clip = null, captions = {}) {
  const text = (captions.segments || []).map((segment) => captionDisplayText(segment?.text || "")).filter(Boolean).join(" ");
  const title = captionDisplayText(clip?.title || "");
  return /^\s*(?:\d+s\s+)?clip window \d+\s*:/i.test(text)
    || Boolean(title && text.toLowerCase() === title.toLowerCase());
}

function editorCaptionEvidenceForClip(clip = null, captions = {}) {
  const duration = editorClipDuration(clip);
  const transcript = captionTextClean(captions.transcript || editorTranscriptTextForClip(clip));
  const frames = Array.isArray(clip?.editorFrameCapture?.frames) ? clip.editorFrameCapture.frames : [];
  const observations = editorCaptionVisualObservations(clip);
  const evidence = captions.evidence || {};
  const source = String(captions.source || "");
  const generationStatus = String(clip?.captionGeneration?.status || evidence.generationStatus || "");
  const transcriptReady = Boolean(
    transcript
    && clip?.transcriptStatus === "transcribed"
    && clip?.transcriptSummary?.usableForCaption !== false
    && (duration < 10 || clip?.transcriptSummary?.fullClipProcessed === true)
  );
  const segmentsReady = Boolean(
    captions.enabled
    && captions.segments?.length
    && captions.segments.every((segment) => String(segment?.text || "").trim() && Number(segment?.endSeconds) > Number(segment?.startSeconds))
  );
  const ready = Boolean(
    segmentsReady
    && verifiedEditorCaptionSources.has(source)
    && verifiedEditorCaptionStatuses.has(generationStatus)
    && transcriptReady
    && frames.length >= 3
    && observations.length > 0
    && (evidence.automaticCaptionRequestHash || clip?.captionGeneration?.automaticCaptionRequestHash)
    && !editorCaptionLooksInternal(clip, captions)
  );
  return {
    ready,
    transcriptReady,
    framesReady: frames.length >= 3,
    visualReady: observations.length > 0,
    sourceReady: verifiedEditorCaptionSources.has(source),
    generationReady: verifiedEditorCaptionStatuses.has(generationStatus),
    requestReady: Boolean(evidence.automaticCaptionRequestHash || clip?.captionGeneration?.automaticCaptionRequestHash),
    generic: editorCaptionLooksInternal(clip, captions)
  };
}

function editorCaptionsForClip(clip = null) {
  if (!clip?.id) return editorDefaultCaptions();
  const saved = state.editor.captions[clip.id]
    || clip.builderDraft?.editorState?.captions
    || clip.editorState?.captions
    || {};
  const savedCaptionText = (saved.segments || []).map((segment) => segment.text || "").join(" ");
  const unsupportedCaption = ["verified_clip_metadata", "verified_speech_transcript"].includes(String(saved.source || ""))
    || editorCaptionLooksInternal(clip, saved);
  if (unsupportedCaption) {
    return normalizeEditorCaptions({
      ...saved,
      enabled: false,
      source: "caption_evidence_required",
      segments: [],
      evidence: {
        ...(saved.evidence || {}),
        status: "rejected_generic_caption"
      }
    }, editorClipDuration(clip));
  }
  const staleGenericCaption = /shares a wild take|chat was waiting on that|chat knew something was coming|this moment was too good to miss|chat started roasting the gameplay|sets up .*play|chat reacts during .*stream|plays .*while chat watches|has a moment during|about to try something|does something unexpected/i.test(savedCaptionText);
  const editorialCaption = clip.editorialCaption?.primary_caption || clip.editorialCaption?.text || "";
  if (staleGenericCaption && editorialCaption) {
    return normalizeEditorCaptions({
      ...saved,
      enabled: true,
      source: clip.editorialCaption.source || "local_editorial_evidence",
      transcript: saved.transcript || clip.editorialCaption.evidence?.transcript || "",
      segments: buildEditorEditorialCaptionSegment(editorialCaption, editorClipDuration(clip))
    }, editorClipDuration(clip));
  }
  return normalizeEditorCaptions(saved, editorClipDuration(clip));
}

function setEditorCaptions(clipId = "", nextCaptions = {}) {
  if (!clipId) return;
  const clip = builderClipById(clipId);
  const captions = normalizeEditorCaptions(nextCaptions, editorClipDuration(clip));
  state.editor.captions[clipId] = captions;
  state.clips = (state.clips || []).map((item) => {
    if (item.id !== clipId) return item;
    return {
      ...item,
      builderDraft: {
        ...(item.builderDraft || {}),
        editorState: {
          ...(item.builderDraft?.editorState || {}),
          captions
        }
      }
    };
  });
}

function editorTranscriptTextForClip(clip = null) {
  const transcriptStatus = String(clip?.transcriptStatus || "").toLowerCase();
  if (clip?.transcriptSummary?.usableForCaption === false || /incomplete|unavailable|error/.test(transcriptStatus)) {
    return "";
  }
  const candidates = [
    clip?.transcriptSummary?.text,
    clip?.analysis?.transcript,
    clip?.metadata?.transcript,
    clip?.builderDraft?.editorState?.captions?.transcript,
    clip?.editorState?.captions?.transcript,
    clip?.transcriptSnippet
  ];
  return candidates
    .map(captionTextClean)
    .find((value) => value && !isUnavailableTranscript(value) && !isOperationalTranscript(value)) || "";
}

function editorTranscriptDetailForClip(clip = null) {
  if (!clip?.id) {
    return {
      source: "No clip loaded",
      transcript: "",
      currentCaption: "",
      model: "",
      quality: "",
      segments: 0,
      note: "Load a clip into Argentum Editor first."
    };
  }
  const captions = editorCaptionsForClip(clip);
  const checks = [
    { source: "MP4 speech transcript", value: clip?.transcriptSummary?.text },
    { source: "Clip analysis transcript", value: clip?.analysis?.transcript },
    { source: "Provider metadata transcript", value: clip?.metadata?.transcript },
    { source: "Saved caption transcript", value: captions.transcript },
    { source: "Builder draft transcript", value: clip?.builderDraft?.editorState?.captions?.transcript },
    { source: "Editor draft transcript", value: clip?.editorState?.captions?.transcript },
    { source: "Transcript snippet", value: clip?.transcriptSnippet }
  ];
  const match = checks
    .map((entry) => ({ ...entry, value: captionTextClean(entry.value || "") }))
    .find((entry) => entry.value && !isUnavailableTranscript(entry.value) && !isOperationalTranscript(entry.value));
  const currentCaption = captions.enabled
    ? captions.segments.map((segment) => segment.text).filter(Boolean).join("\n")
    : "";
  const summary = clip?.transcriptSummary || {};
  const intelligence = clip?.editorialCaption || {};
  const analysis = intelligence.analysis || {};
  return {
    source: match?.source || "No speech transcript captured",
    transcript: match?.value || "",
    currentCaption,
    model: [summary.model || summary.provider || "", summary.timingModel ? `timing: ${summary.timingModel}` : ""].filter(Boolean).join(" · "),
    quality: Number.isFinite(Number(summary.qualityScore))
      ? `${Math.round(Number(summary.qualityScore))}% quality`
      : summary.quality || "quality not scored",
    segments: Array.isArray(summary.segments) ? summary.segments.length : Number(summary.segmentCount || 0),
    fullClipStatus: summary.fullClipProcessed
      ? `${Math.round(Number(summary.processedDuration || summary.audioDuration || 0))}s of ${Math.round(Number(summary.audioDuration || summary.duration || 0))}s processed · ${Number(summary.processedWindowCount || 0)}/${Number(summary.expectedWindowCount || 0)} windows`
      : "Full clip has not been verified",
    cleanedTranscript: analysis.cleanedTranscript || match?.value || "",
    primaryEvent: analysis.primaryEvent || "Not analyzed yet",
    hookableDetails: Array.isArray(analysis.hookableDetails) ? analysis.hookableDetails : [],
    clipTypes: Array.isArray(analysis.clipTypes) ? analysis.clipTypes : [],
    viewerPromise: analysis.viewerPromise || "",
    selectedAngle: intelligence.selected_angle || "",
    candidates: Array.isArray(intelligence.candidates) ? intelligence.candidates : [],
    confidence: Number(intelligence.confidence || 0),
    qualityScore: Number(intelligence.quality_score || 0),
    accuracyScore: Number(intelligence.accuracy_score || 0),
    requiresHumanReview: Boolean(intelligence.requires_human_review),
    reviewReason: intelligence.review_reason || "",
    duplicateSimilarity: Number(intelligence.duplicate_similarity || 0),
    promptVersion: intelligence.prompt_version || "",
    modelVersion: intelligence.model_version || "",
    scoringVersion: intelligence.scoring_version || "",
    usedSegments: Array.isArray(intelligence.used_transcript_segments) ? intelligence.used_transcript_segments : [],
    reviewStatus: intelligence.reviewStatus || "",
    note: match?.value
      ? "This is the transcript Argentum used before writing the caption hook."
      : "No real speech transcript is attached to this clip yet. Generate will try to read the MP4 audio."
  };
}

function editorCaptionThemeForClip(clip = null, transcript = "") {
  const context = `${clip?.category || ""} ${clip?.title || ""} ${clip?.reason || ""} ${transcript}`.toLowerCase();
  if (/valorant|fortnite|call of duty|league of legends|minecraft|gaming|esports|ranked|clutch|gameplay/.test(context)) return "gaming";
  if (/laugh|funny|joke|crazy|wild|reaction|no way|bro/.test(context)) return "reaction";
  return "story";
}

function editorCaptionEmoji(text = "", clip = null) {
  const context = `${text} ${clip?.category || ""} ${clip?.title || ""}`.toLowerCase();
  if (/shav(?:e|ing)|razor|beard|mouth|awkward|weird/.test(context)) return "😭";
  if (/laugh|funny|joke|lmao|lol/.test(context)) return "😂";
  if (/cry|tears|sad|hurt|heartbreak/.test(context)) return "😭";
  if (/love|heart|beautiful|proud/.test(context)) return "❤️";
  if (/warning|careful|watch out|danger/.test(context)) return "⚠️";
  if (/win|clutch|kill|ace|ranked|game|valorant|fortnite/.test(context)) return "🔥";
  if (/crazy|wild|insane|no way|shocked|what/.test(context)) return "😳";
  return "👀";
}

function buildEditorEditorialCaptionSegment(text = "", durationSeconds = 30) {
  const duration = Math.max(1, Number(durationSeconds || 30));
  const value = captionDisplayText(text);
  if (!value) return [];
  return [{
    id: "caption-hook",
    startSeconds: 0,
    endSeconds: Number(duration.toFixed(2)),
    text: value
  }];
}

function buildEditorCaptionSegments(text = "", durationSeconds = 30, maxWords = 9, clip = null) {
  const words = captionTextClean(text)
    .replace(/\b(?:um+|uh+|erm|hmm)\b/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return [];
  const chunkSize = Math.min(12, Math.max(5, Number(maxWords || 9)));
  const chunks = [];
  for (let index = 0; index < words.length; index += chunkSize) {
    chunks.push(words.slice(index, index + chunkSize).join(" "));
  }
  const duration = Math.max(1, Number(durationSeconds || 30));
  const usable = chunks.slice(0, Math.max(1, Math.min(10, Math.ceil(duration / 2.2))));
  const segmentLength = Math.max(1.8, Math.min(3.4, duration / usable.length));
  return usable.map((chunk, index) => {
    const start = Math.min(duration - 0.25, index * segmentLength);
    const hasEmoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(chunk);
    const decorated = !hasEmoji && (index === 0 || /laugh|crazy|wild|love|warning|clutch|win|cry|no way/i.test(chunk))
      ? `${chunk} ${editorCaptionEmoji(chunk, clip)}`
      : chunk;
    return {
      id: `caption-${index + 1}`,
      startSeconds: Number(start.toFixed(2)),
      endSeconds: Number(Math.min(duration, start + segmentLength).toFixed(2)),
      text: decorated
    };
  });
}

async function generateEditorCaptions(clipId = "", options = {}) {
  let clip = builderClipById(clipId);
  if (!clip) return { ok: false, error: "Clip not found" };
  state.editor.captionGeneratingClipId = clipId;
  delete state.editor.captionNotes[clipId];
  state.editor.lastRenderSignature = "";
  renderClipsArea({ force: true });
  let transcript = editorTranscriptTextForClip(clip);
  const requiresFullClipTranscript = editorClipDuration(clip) >= 10;
  const fullClipTranscriptVerified = clip?.transcriptSummary?.fullClipProcessed === true;
  if (requiresFullClipTranscript && !fullClipTranscriptVerified) transcript = "";
  let captionSource = transcript ? "speech_transcript" : "";
  let fallbackReason = "";
  if ((!transcript || options.forceTranscription || (requiresFullClipTranscript && !fullClipTranscriptVerified)) && !options.skipTranscription) {
    renderStatus("Transcribing the loaded MP4 for captions...");
    try {
      const result = await api(`/api/clips/candidates/${encodeURIComponent(clipId)}/transcribe`, {
        method: "POST",
        body: JSON.stringify({ force: Boolean(options.forceTranscription) }),
        timeoutMs: 360000,
        timeoutMessage: "On-device transcription is still reading the full clip. Argentum will keep the result when it completes."
      });
      state.clips = (state.clips || []).map((item) => item.id === clipId ? result.candidate : item);
      clip = builderClipById(clipId);
      transcript = editorTranscriptTextForClip(clip);
      captionSource = transcript ? "speech_transcript" : "";
    } catch (error) {
      fallbackReason = error.message || "Audio transcription was unavailable";
    }
  }
  const transcriptIncomplete = clip?.transcriptSummary?.usableForCaption === false
    || String(clip?.transcriptStatus || "").toLowerCase() === "transcript_incomplete";
  if (!transcript && transcriptIncomplete) {
    state.editor.captionNotes[clipId] = clip?.transcriptError || "The audio pass was incomplete. Re-read audio before generating a caption.";
    state.editor.captionGeneratingClipId = "";
    state.editor.lastRenderSignature = "";
    renderClipsArea({ force: true });
    renderStatus("Transcript incomplete. Argentum stopped before writing a weak caption; use Re-read audio to retry.");
    return { ok: false, error: state.editor.captionNotes[clipId] };
  }
  if (!transcript) {
    state.editor.captionNotes[clipId] = fallbackReason || "No reliable speech transcript was available. Argentum stopped instead of inventing a generic caption.";
    state.editor.captionGeneratingClipId = "";
    state.editor.lastRenderSignature = "";
    renderClipsArea({ force: true });
    renderStatus("Caption stopped: re-read the MP4 audio before generating a hook.");
    return { ok: false, error: state.editor.captionNotes[clipId] };
  }
  const duration = editorClipDuration(clip);
  let editorialCaption = null;
  try {
    editorialCaption = await api(`/api/clips/candidates/${encodeURIComponent(clipId)}/editorial-caption`, {
      method: "POST",
      // Do not send our fallback hook as if it were speech evidence.
      body: JSON.stringify({
        transcript: captionSource === "speech_transcript" ? transcript : "",
        automaticCaptionRequest: automaticCaptionRequestText(clip)
      }),
      timeoutMs: 45000
    });
    if (editorialCaption?.candidate) {
      state.clips = (state.clips || []).map((item) => item.id === clipId ? editorialCaption.candidate : item);
      clip = builderClipById(clipId);
    }
  } catch (error) {
    state.editor.captionNotes[clipId] = error.message || "Caption intelligence did not find an accurate specific hook.";
    state.editor.captionGeneratingClipId = "";
    state.editor.lastRenderSignature = "";
    renderClipsArea({ force: true });
    renderStatus("Caption stopped: no candidate passed the quality gate.");
    return { ok: false, error: state.editor.captionNotes[clipId] };
  }
  const editorialText = captionDisplayText(editorialCaption?.caption?.primary_caption || editorialCaption?.caption?.text || "");
  const theme = ["gaming", "reaction", "story"].includes(editorialCaption?.caption?.theme)
    ? editorialCaption.caption.theme
    : editorCaptionThemeForClip(clip, `${transcript} ${editorialText}`);
  const segments = buildEditorEditorialCaptionSegment(editorialText, duration);
  if (!segments.length) {
    renderStatus("Transcript was too short to build captions");
    state.editor.captionGeneratingClipId = "";
    state.editor.lastRenderSignature = "";
    renderClipsArea({ force: true });
    return { ok: false, error: "Transcript was too short to build captions" };
  }
  const generatedCaptionEvidence = clip?.builderDraft?.editorState?.captions?.evidence || {};
  setEditorCaptions(clipId, {
    enabled: true,
    source: editorialCaption?.caption?.source || "editorial_hook",
    transcript,
    segments,
    evidence: generatedCaptionEvidence,
    style: {
      ...editorCaptionsForClip(clip).style,
      theme,
      yPercent: 18,
      maxWords: 7
    },
    updatedAt: new Date().toISOString()
  });
  scheduleEditorDraftSave(clipId);
  state.editor.captionGeneratingClipId = "";
  state.editor.lastRenderSignature = "";
  renderClipsArea({ force: true });
  renderStatus(fallbackReason
    ? `Caption hook created from clip context: ${editorialText}`
    : `Caption hook created from speech and clip context: ${editorialText}`);
  return { ok: true, caption: editorialText, candidate: clip, response: editorialCaption };
}

async function handleCaptionDebugAction(button) {
  const clipId = button?.dataset?.captionDebugClip || "";
  const action = button?.dataset?.captionDebugAction || "";
  if (!clipId || !action) return;
  const panel = button.closest("[data-caption-review-for]");
  const editInput = panel?.querySelector?.("[data-caption-debug-edit]");
  const reasonSelect = panel?.querySelector?.("[data-caption-debug-reason]");
  if (action === "regenerate") {
    state.editor.transcriptModalClipId = "";
    renderClipsArea({ force: true });
    generateEditorCaptions(clipId);
    return;
  }
  button.disabled = true;
  try {
    if (action === "save") {
      const caption = captionDisplayText(editInput?.value || "");
      if (!caption) throw new Error("Enter a caption before saving.");
      const result = await api(`/api/clips/candidates/${encodeURIComponent(clipId)}/editorial-caption/edit`, {
        method: "POST",
        body: JSON.stringify({ caption })
      });
      state.clips = (state.clips || []).map((item) => item.id === clipId ? result.candidate : item);
      const current = editorCaptionsForClip(result.candidate);
      setEditorCaptions(clipId, {
        ...current,
        enabled: true,
        source: "operator_edit",
        segments: buildEditorEditorialCaptionSegment(caption, editorClipDuration(result.candidate)),
        updatedAt: new Date().toISOString()
      });
      scheduleEditorDraftSave(clipId);
      renderStatus("Caption edit saved and protected from automatic overwrite.");
    } else {
      const result = await api(`/api/clips/candidates/${encodeURIComponent(clipId)}/editorial-caption/feedback`, {
        method: "POST",
        body: JSON.stringify({
          action: action === "approve" ? "approved" : "rejected",
          reason: reasonSelect?.value || "other"
        })
      });
      state.clips = (state.clips || []).map((item) => item.id === clipId ? result.candidate : item);
      renderStatus(action === "approve" ? "Caption approved" : "Caption rejection saved for quality tracking");
    }
    state.editor.lastRenderSignature = "";
    renderClipsArea({ force: true });
  } catch (error) {
    renderStatus(error.message || "Caption action failed");
  } finally {
    button.disabled = false;
  }
}

function clearEditorCaptions(clipId = "") {
  if (!clipId) return;
  setEditorCaptions(clipId, editorDefaultCaptions());
  scheduleEditorDraftSave(clipId);
  state.editor.lastRenderSignature = "";
  renderClipsArea({ force: true });
  renderStatus("Caption track removed");
}

function editorCaptionAtTime(captions = editorDefaultCaptions(), timeSeconds = 0) {
  if (!captions.enabled || !Array.isArray(captions.segments)) return null;
  const time = Number(timeSeconds || 0);
  return captions.segments.find((segment) => time >= Number(segment.startSeconds || 0) && time <= Number(segment.endSeconds || 0)) || null;
}

function editorDefaultTimelineLayers(durationSeconds = 30) {
  const duration = Math.max(1, Number(durationSeconds || 30));
  return [
    {
      id: "video",
      label: "VID",
      name: "3:4 subject video",
      detail: "Locked subject layer inside 9:16 canvas",
      startSeconds: 0,
      endSeconds: duration,
      locked: true
    },
    {
      id: "reframe",
      label: "MOVE",
      name: "Auto reframe keyframes",
      detail: "Motion crop follows the action",
      startSeconds: 0,
      endSeconds: duration
    },
    {
      id: "captions",
      label: "CAP",
      name: "Captions",
      detail: "Timed caption layer",
      startSeconds: 0,
      endSeconds: duration
    },
    {
      id: "sticker",
      label: "STK",
      name: "Sticker overlay",
      detail: "Reusable bottom sticker placement",
      startSeconds: 0,
      endSeconds: duration
    }
  ];
}

function normalizeEditorTimelineLayer(layer = {}, fallback = {}, durationSeconds = 30) {
  const duration = Math.max(1, Number(durationSeconds || 30));
  const start = Math.min(duration, Math.max(0, Number(layer.startSeconds ?? fallback.startSeconds ?? 0)));
  const rawEnd = Number(layer.endSeconds ?? fallback.endSeconds ?? duration);
  const minEnd = Math.min(duration, start + 0.1);
  const end = Math.min(duration, Math.max(minEnd, rawEnd));
  return {
    ...fallback,
    ...layer,
    id: fallback.id || layer.id,
    label: fallback.label || layer.label || "LAY",
    name: cleanEditorText(layer.name || fallback.name || "Layer"),
    detail: cleanEditorText(layer.detail || fallback.detail || ""),
    startSeconds: Number(start.toFixed(2)),
    endSeconds: Number(end.toFixed(2)),
    locked: Boolean(fallback.locked || layer.locked)
  };
}

function editorTimelineForClip(clip = null, durationSeconds = editorClipDuration(clip)) {
  const duration = Math.max(1, Number(durationSeconds || 30));
  const defaults = editorDefaultTimelineLayers(duration);
  const savedLayers = state.editor.timelineLayers[clip?.id || ""]
    || clip?.builderDraft?.editorState?.timeline?.layers
    || clip?.editorState?.timeline?.layers
    || [];
  const savedById = new Map((Array.isArray(savedLayers) ? savedLayers : []).map((layer) => [layer.id, layer]));
  return defaults.map((fallback) => normalizeEditorTimelineLayer(savedById.get(fallback.id) || {}, fallback, duration));
}

function editorSelectedTimelineLayer(layers = []) {
  return layers.find((layer) => layer.id === state.editor.selectedTimelineLayerId) || layers[0] || null;
}

function setEditorSelectedTimelineLayer(layerId = "video") {
  state.editor.selectedTimelineLayerId = layerId || "video";
  localStorage.setItem(editorSelectedTimelineLayerStorageKey, state.editor.selectedTimelineLayerId);
}

function persistEditorTimelineLayers(clipId = "", durationSeconds = 30, layers = []) {
  if (!clipId) return;
  const duration = Math.max(1, Number(durationSeconds || 30));
  state.editor.timelineLayers[clipId] = layers;
  state.clips = (state.clips || []).map((clip) => {
    if (clip.id !== clipId) return clip;
    return {
      ...clip,
      builderDraft: {
        ...(clip.builderDraft || {}),
        editorState: {
          ...(clip.builderDraft?.editorState || {}),
          timeline: {
            durationSeconds: duration,
            selectedLayerId: state.editor.selectedTimelineLayerId,
            layers
          }
        }
      }
    };
  });
}

function setEditorTimelineLayer(clipId = "", layerId = "", updates = {}) {
  const clip = builderClipById(clipId);
  if (!clip || !layerId) return null;
  const duration = editorClipDuration(clip);
  const layers = editorTimelineForClip(clip, duration);
  const nextLayers = layers.map((layer) => {
    if (layer.id !== layerId) return layer;
    const next = normalizeEditorTimelineLayer({ ...layer, ...updates }, layer, duration);
    const length = Math.max(0.1, Number(layer.endSeconds || 0) - Number(layer.startSeconds || 0));
    if (updates.moveTo != null) {
      const start = Math.min(Math.max(0, Number(updates.moveTo || 0)), Math.max(0, duration - length));
      return normalizeEditorTimelineLayer({ ...layer, startSeconds: start, endSeconds: start + length }, layer, duration);
    }
    return next;
  });
  setEditorSelectedTimelineLayer(layerId);
  persistEditorTimelineLayers(clipId, duration, nextLayers);
  return nextLayers.find((layer) => layer.id === layerId) || null;
}

function editorTimelineLayerPercent(layer = {}, durationSeconds = 30) {
  const duration = Math.max(1, Number(durationSeconds || 30));
  const start = Math.min(duration, Math.max(0, Number(layer.startSeconds || 0)));
  const end = Math.min(duration, Math.max(start, Number(layer.endSeconds || duration)));
  return {
    offset: (start / duration) * 100,
    width: Math.max(1.2, ((end - start) / duration) * 100)
  };
}

function editorLayerTimeLabel(layer = {}) {
  return `${formatEditorTime(layer.startSeconds)} to ${formatEditorTime(layer.endSeconds)}`;
}

function editorDraftStateForClip(clipId = "") {
  const clip = builderClipById(clipId);
  const existing = clip?.builderDraft?.editorState || clip?.editorState || {};
  const sticker = editorStickerForClip(clip);
  const captions = editorCaptionsForClip(clip);
  const duration = editorClipDuration(clip);
  const layers = editorTimelineForClip(clip, duration);
  return {
    ...existing,
    videoLayout: editorDefaultVideoLayout(),
    autoReframe: state.editor.autoReframePlans[clipId] || existing.autoReframe || null,
    background: editorDefaultVideoLayout().background,
    sticker,
    captions,
    timeline: {
      durationSeconds: duration,
      selectedLayerId: state.editor.selectedTimelineLayerId,
      layers
    },
    previewControls: "external",
    updatedAt: new Date().toISOString()
  };
}

function editorPrecheckForClip(clip = null, editorState = null) {
  const draft = editorState || (clip?.id ? editorDraftStateForClip(clip.id) : {});
  const canvas = draft.videoLayout?.canvas || {};
  const subject = draft.videoLayout?.subjectFrame || {};
  const sticker = draft.sticker || {};
  const captions = draft.captions || {};
  const captionEvidence = editorCaptionEvidenceForClip(clip, captions);
  const layers = Array.isArray(draft.timeline?.layers) ? draft.timeline.layers : [];
  const requiredLayers = ["video", "reframe", "captions", "sticker"];
  const checks = [
    { id: "source", label: "Verified source", passed: Boolean(clip?.sourceId && clip?.mediaPlayable !== false && clipPlaybackUrl(clip)), detail: "Persisted and playable MP4 source" },
    { id: "canvas", label: "9:16 canvas", passed: Number(canvas.width) === 1080 && Number(canvas.height) === 1920 && canvas.aspectRatio === "9:16", detail: "1080x1920 output canvas" },
    { id: "subject", label: "3:4 subject video", passed: Number(subject.width) === 1080 && Number(subject.height) === 1440 && subject.aspectRatio === "3:4", detail: "1080x1440 subject frame" },
    { id: "reframe", label: "Auto reframe", passed: Boolean(draft.autoReframe?.keyframes?.length), detail: `${draft.autoReframe?.keyframes?.length || 0} motion points` },
    { id: "sticker", label: "Sticker", passed: Boolean(sticker.enabled && (sticker.type === "image" ? sticker.sourcePath || sticker.previewDataUrl || sticker.assetName : String(sticker.label || "").trim())), detail: "Enabled and positioned" },
    { id: "captions", label: "Captions", passed: Boolean(captions.enabled && captions.segments?.length && captions.segments.every((segment) => String(segment?.text || "").trim() && Number(segment?.endSeconds) > Number(segment?.startSeconds))), detail: `${captions.segments?.length || 0} timed lines` },
    { id: "caption_evidence", label: "Caption evidence", passed: captionEvidence.ready, detail: captionEvidence.ready ? "Transcript + 3 frames + visual analysis + Argentum Auto Message" : "Waiting for the complete caption-intelligence evidence pass" },
    { id: "timeline", label: "Complete timeline", passed: requiredLayers.every((id) => {
      const layer = layers.find((item) => item?.id === id);
      return Boolean(layer && Number(layer.endSeconds) > Number(layer.startSeconds));
    }), detail: "Video, reframe, captions, and sticker layers" }
  ];
  const missing = checks.filter((check) => !check.passed).map((check) => check.label);
  return { ready: missing.length === 0, checks, missing, editorState: draft };
}

function setEditorReframePlan(clipId = "", plan = {}) {
  if (!clipId) return;
  state.editor.autoReframePlans[clipId] = plan;
  state.clips = (state.clips || []).map((clip) => {
    if (clip.id !== clipId) return clip;
    return {
      ...clip,
      builderDraft: {
        ...(clip.builderDraft || {}),
        editorState: {
          ...(clip.builderDraft?.editorState || {}),
          autoReframe: plan
        }
      }
    };
  });
}

function scheduleEditorDraftSave(clipId = "") {
  if (!clipId) return;
  clearTimeout(state.editor.draftSaveTimers[clipId]);
  state.editor.draftSaveTimers[clipId] = setTimeout(() => saveEditorDraft(clipId), 1800);
}

function flushEditorDraftSave(clipId = "") {
  if (!clipId) return;
  clearTimeout(state.editor.draftSaveTimers[clipId]);
  delete state.editor.draftSaveTimers[clipId];
  return saveEditorDraft(clipId);
}

function persistEditorDraftNow(clipId = "") {
  if (!clipId) return Promise.resolve(null);
  clearTimeout(state.editor.draftSaveTimers[clipId]);
  delete state.editor.draftSaveTimers[clipId];
  return saveEditorDraft(clipId);
}

async function saveEditorDraft(clipId = "", editorStateOverride = null, { throwOnError = false } = {}) {
  const clip = builderClipById(clipId);
  if (!clip) return null;
  try {
    const result = await api("/api/clips/draft", {
      method: "POST",
      timeoutMs: 120000,
      timeoutMessage: "The local project save is still finishing. Argentum will retry this clip automatically.",
      body: JSON.stringify({
        candidateId: clipId,
        format: "9:16",
        resolution: "1080x1920",
        duration: Number(clip.durationSeconds || clip.duration || state.config?.recordingWindowSeconds || 30),
        editorState: editorStateOverride || editorDraftStateForClip(clipId)
      })
    });
    if (result?.candidate) replaceClipInState(result.candidate);
    return result;
  } catch (error) {
    console.warn("Editor draft autosave failed", error.message || error);
    if (throwOnError) throw error;
    return null;
  }
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
  const recorderMessages = Array.isArray(teach.recorderMessages) ? teach.recorderMessages : [];
  const latestRecorderMessage = recorderMessages.at(-1);
  const recorderStatusText = recording
    ? (teach.recorderReady ? "Recorder ready" : "Starting native recorder")
    : (teach.stopReason || latestRecorderMessage?.message || "");
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
        ${recorderStatusText ? `<span>${esc(recorderStatusText)}</span>` : ""}
        ${latestRecorderMessage?.message && latestRecorderMessage.message !== recorderStatusText ? `<span>${esc(latestRecorderMessage.message)}</span>` : ""}
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

function renderProductionChecklist(clip = {}) {
  const checks = Array.isArray(clip.productionWorkflow?.readiness?.checks)
    ? clip.productionWorkflow.readiness.checks
    : [];
  return `
    <div class="production-checklist" aria-label="Production readiness checklist">
      ${checks.map((check) => `
        <span class="${check.passed ? "passed" : "missing"}">
          <b>${check.passed ? "Pass" : "Missing"}</b>
          <em>${esc(check.label || check.id || "Check")}</em>
        </span>
      `).join("")}
    </div>
  `;
}

function renderBufferProductReadyControls(clip = {}) {
  const workflow = clip.productionWorkflow?.buffer || {};
  const status = workflow.status || "not_prepared";
  const channels = Array.isArray(state.buffer.channels) ? state.buffer.channels : [];
  const selectedChannelId = workflow.channelId || channels[0]?.id || "";
  const busy = state.buffer.activeClipId === clip.id;
  const locked = ["approval_pending", "approved", "dispatching", "buffer_draft_created", "manual_review"].includes(status);
  const selectedChannel = channels.find((channel) => channel.id === selectedChannelId);
  const statusCopy = {
    not_prepared: "Choose a channel and prepare one exact manual draft.",
    approval_pending: "Human Gate is waiting. Buffer has not been contacted.",
    approved: "Approved once. Create the draft when you are ready to contact Buffer.",
    dispatching: "Buffer request in progress. Automatic retry is disabled.",
    buffer_draft_created: "Draft created in Buffer. It is not scheduled or published.",
    rejected: "Human Gate rejected this draft. Prepare a fresh scope when ready.",
    send_back: "Human Gate sent this draft back. Prepare a fresh scope after changes.",
    failed: "Buffer rejected the request. A fresh Human Gate approval is required to try again.",
    manual_review: "Buffer status is uncertain. Inspect Buffer before any fresh attempt."
  }[status] || "Manual Buffer draft only.";
  const prepareLabel = ["failed", "rejected", "send_back"].includes(status) ? "Prepare fresh approval" : "Prepare Buffer draft";
  return `
    <div class="buffer-draft-control ${esc(status)}">
      <div class="buffer-draft-head">
        <div><span>Buffer handoff</span><strong>${selectedChannel ? `${selectedChannel.service === "tiktok" ? "TikTok" : "Instagram"} · ${esc(selectedChannel.name)}` : "Manual draft"}</strong></div>
        <b>Auto-post OFF</b>
      </div>
      ${channels.length ? `
        <label class="buffer-channel-select">
          <span>Destination channel</span>
          <select data-buffer-channel-select="${esc(clip.id)}" ${locked || busy ? "disabled" : ""}>
            ${channels.map((channel) => `<option value="${esc(channel.id)}" ${channel.id === selectedChannelId ? "selected" : ""}>${channel.service === "tiktok" ? "TikTok" : "Instagram"} · ${esc(channel.name)}${channel.organizationName ? ` · ${esc(channel.organizationName)}` : ""}</option>`).join("")}
          </select>
        </label>
      ` : `<p class="buffer-channel-empty">${state.buffer.configured ? "Test Buffer in Settings to load connected TikTok or Instagram channels." : "Add BUFFER_API_KEY in Railway, then test Buffer in Settings."}</p>`}
      <p>${esc(statusCopy)}</p>
      <div class="buffer-draft-actions">
        ${["not_prepared", "failed", "rejected", "send_back"].includes(status) ? `<button type="button" data-buffer-prepare="${esc(clip.id)}" ${busy || !channels.length ? "disabled" : ""}>${busy ? "Working..." : prepareLabel}</button>` : ""}
        ${status === "approval_pending" ? `<button type="button" class="primary" data-buffer-approve="${esc(clip.id)}" data-buffer-approval-id="${esc(workflow.approvalId)}" ${busy ? "disabled" : ""}>${busy ? "Working..." : "Approve exact draft"}</button>` : ""}
        ${status === "approved" ? `<button type="button" class="primary" data-buffer-create="${esc(clip.id)}" data-buffer-draft-id="${esc(workflow.draftId)}" data-buffer-approval-id="${esc(workflow.approvalId)}" ${busy ? "disabled" : ""}>${busy ? "Contacting Buffer..." : "Create draft in Buffer"}</button>` : ""}
        ${status === "dispatching" ? `<button type="button" disabled>Waiting for Buffer...</button>` : ""}
        ${status === "buffer_draft_created" && !workflow.mediaGrantRevokedAt ? `<button type="button" data-buffer-revoke-media="${esc(clip.id)}" data-buffer-draft-id="${esc(workflow.draftId)}" ${busy ? "disabled" : ""}>Revoke media link after publishing</button>` : ""}
        ${status === "buffer_draft_created" && workflow.mediaGrantRevokedAt ? `<span class="buffer-media-revoked">Media link revoked · local MP4 kept</span>` : ""}
      </div>
    </div>
  `;
}

function renderProductionCard(clip = {}, stage = "precheck") {
  const playback = productionPlaybackUrl(clip);
  const workflow = clip.productionWorkflow || {};
  const busy = state.editor.productionBusyClipId === clip.id;
  const ready = Boolean(workflow.readiness?.ready);
  const expanded = state.editor.expandedProductionClipId === clip.id;
  return `
    <article class="production-card ${esc(stage)} ${expanded ? "is-expanded" : ""}" data-production-clip="${esc(clip.id)}">
      <button type="button" class="production-card-summary" data-toggle-production-clip="${esc(clip.id)}" aria-expanded="${expanded}">
        <span class="production-row-thumb">
          ${playback ? `<video src="${esc(playback)}" muted playsinline preload="metadata" aria-hidden="true"></video>` : `<i>MP4</i>`}
        </span>
        <span class="production-row-copy">
          <strong>${esc(clip.title || "Edited vertical clip")}</strong>
          <small>1080x1920 MP4 · ${formatSeconds(workflow.readiness?.probe?.durationSeconds || clip.durationSeconds || clip.duration || 0)}</small>
        </span>
        <span class="production-badge ${ready ? "ready" : "blocked"}">${ready ? "Checks passed" : "Blocked"}</span>
        <span class="production-expand-label">${expanded ? "Close" : "Review"}</span>
      </button>
      <div class="production-card-details" ${expanded ? "" : "hidden"}>
        <div class="production-video-wrap">
          ${playback
            ? `<video src="${esc(playback)}" controls playsinline preload="metadata" aria-label="${esc(clip.title || "Edited vertical clip")}"></video>`
            : `<div class="production-video-missing">MP4 unavailable</div>`}
        </div>
        <div class="production-card-body">
        <div class="production-card-heading">
          <strong>${esc(clip.title || "Edited vertical clip")}</strong>
          <small>1080x1920 MP4 · ${formatSeconds(workflow.readiness?.probe?.durationSeconds || clip.durationSeconds || clip.duration || 0)}</small>
        </div>
        ${renderProductionChecklist(clip)}
        <div class="production-actions">
          ${stage === "precheck" ? `<button type="button" class="primary" data-product-ready-action="approve" data-product-ready-clip="${esc(clip.id)}" ${busy || !ready ? "disabled" : ""}>${busy ? "Working" : "Approve Product Ready"}</button>` : ""}
          ${playback ? `<a href="${esc(playback)}" download="${esc(workflow.outputFilename || "product-ready.mp4")}">Download MP4</a>` : ""}
          <button type="button" class="danger" data-product-ready-action="changes" data-product-ready-clip="${esc(clip.id)}" ${busy ? "disabled" : ""}>Needs changes</button>
        </div>
        ${stage === "product_ready" ? renderBufferProductReadyControls(clip) : `<small class="production-posting-state">Awaiting operator approval</small>`}
        </div>
      </div>
    </article>
  `;
}

function renderProductionLane(clips = [], stage = "precheck") {
  const pageSize = 5;
  const pageCount = Math.max(1, Math.ceil(clips.length / pageSize));
  const requestedPage = Number(state.editor.productionPages?.[stage] || 0);
  const page = Math.max(0, Math.min(pageCount - 1, requestedPage));
  state.editor.productionPages[stage] = page;
  const visible = clips.slice(page * pageSize, (page + 1) * pageSize);
  const isPrecheck = stage === "precheck";
  return `
    <section class="production-lane ${isPrecheck ? "precheck-lane" : "ready-lane"}">
      <div class="production-lane-head">
        <div><span>${isPrecheck ? "Precheck" : "Product Ready"}</span><strong>${isPrecheck ? "Needs your approval" : "Ready-to-post handoff"}</strong></div>
        <b>${clips.length}/${PRODUCTION_QUEUE_LIMIT}</b>
      </div>
      <div class="production-card-list">
        ${visible.length
          ? visible.map((clip) => renderProductionCard(clip, stage)).join("")
          : `<div class="production-empty"><strong>${isPrecheck ? "No clips waiting" : "No approved clips"}</strong><span>${isPrecheck ? "Completed editor renders appear here." : "Only operator-approved videos appear here."}</span></div>`}
      </div>
      ${clips.length > pageSize ? `
        <div class="production-pagination">
          <button type="button" data-production-page="${esc(stage)}" data-production-page-direction="-1" ${page === 0 ? "disabled" : ""} aria-label="Previous ${esc(stage)} clips">Previous</button>
          <span>${page * pageSize + 1}-${Math.min((page + 1) * pageSize, clips.length)} of ${clips.length}</span>
          <button type="button" data-production-page="${esc(stage)}" data-production-page-direction="1" ${page >= pageCount - 1 ? "disabled" : ""} aria-label="Next ${esc(stage)} clips">Next</button>
        </div>` : ""}
    </section>
  `;
}

function renderProductionReviewArea() {
  const precheck = productionClips("precheck");
  const productReady = productionClips("product_ready");
  const automation = state.automation || {};
  const focusOptions = automation.focusOptions?.length
    ? automation.focusOptions
    : [
        { id: "streamer_university", label: "Streamer University" },
        { id: "irl", label: "IRL & Chatting" },
        { id: "all", label: "All live" }
      ];
  const providerErrors = Array.isArray(automation.providerErrors) ? automation.providerErrors : [];
  const scanCoverage = [
    Number(automation.providerPages?.twitch || 0) ? `${formatNumber(automation.providerPages.twitch)} Twitch page${Number(automation.providerPages.twitch) === 1 ? "" : "s"}` : "",
    Number(automation.providerPages?.kick || 0) ? `${formatNumber(automation.providerPages.kick)} Kick page${Number(automation.providerPages.kick) === 1 ? "" : "s"}` : ""
  ].filter(Boolean).join(" · ") || "Awaiting provider scan";
  const workerProgress = Math.max(0, Math.min(100, Math.round(Number(automation.workerProgress || 0))));
  const workerProcessing = automation.workerStatus === "processing";
  const missingProductionSources = Math.max(0, Number(automation.sourceIntegrity?.missingProductionSources || 0));
  const focusedStreamDetail = [
    Number(automation.recordingFocusedStreams || 0) ? `${formatNumber(automation.recordingFocusedStreams)} recording` : "",
    Number(automation.connectingFocusedStreams || 0) ? `${formatNumber(automation.connectingFocusedStreams)} connecting` : "",
    Number(automation.metadataOnlyFocusedStreams || 0) ? `${formatNumber(automation.metadataOnlyFocusedStreams)} metadata-only` : ""
  ].filter(Boolean).join(" · ") || "No active media workers";
  const workerLastFailure = automation.workerLastFailure && typeof automation.workerLastFailure === "object"
    ? automation.workerLastFailure
    : null;
  return `
    <section class="production-review" aria-label="Production review">
      <section class="review-automation-panel ${automation.enabled ? "is-running" : "is-paused"}" aria-label="Automatic stream focus">
        <header class="review-automation-head">
          <div>
            <span class="watch-kicker">Automation mission</span>
            <h2>${automation.enabled ? `Finding ${esc(automation.focusLabel || "Streamer University")} moments` : "Automation paused"}</h2>
            <p>Official provider data only. Captures move through Studio, Precheck, Product Ready, and your local Library automatically. Posting stays off.</p>
          </div>
          <div class="review-automation-state">
            <span class="review-live-dot" aria-hidden="true"></span>
            <strong>${esc(automation.status || "starting")}</strong>
            <small>${automation.scanTruncated ? "Page limit reached and disclosed" : "Measured, no estimates"}</small>
          </div>
        </header>
        <div class="review-focus-row">
          <div class="review-focus-control" role="group" aria-label="Stream focus">
            ${focusOptions.map((option) => `
              <button type="button" data-automation-focus="${esc(option.id)}" class="${option.id === automation.focus ? "is-active" : ""}" aria-pressed="${option.id === automation.focus}" ${automation.busy ? "disabled" : ""}>${esc(option.label)}</button>
            `).join("")}
          </div>
          <button type="button" class="review-scan-button" data-run-automation-scan ${automation.busy || !automation.enabled ? "disabled" : ""}>${automation.busy ? "Scanning..." : "Scan now"}</button>
        </div>
        ${workerProcessing ? `
          <div class="review-worker-progress" aria-live="polite">
            <div class="review-worker-progress-head">
              <div><span>Background editor</span><strong>${esc(automation.workerStage || automation.workerMessage || "Preparing clip")}</strong></div>
              <b>${workerProgress}%</b>
            </div>
            <div class="review-worker-progress-track" role="progressbar" aria-label="Background editor progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${workerProgress}">
              <span style="width:${workerProgress}%"></span>
            </div>
            <small>${esc(automation.workerDetail || automation.workerMessage || "Processing the next verified clip.")}</small>
          </div>
        ` : ""}
        <div class="review-automation-metrics">
          <div><span>Official live records scanned</span><strong>${formatNumber(automation.scannedStreams)}</strong><small>${esc(scanCoverage)}</small></div>
          <div><span>Focus matches</span><strong>${formatNumber(automation.matchedStreams)}</strong><small>${esc(automation.focusLabel || "Selected focus")}</small></div>
          <div><span>Focused streams active</span><strong>${formatNumber(automation.activeFocusedStreams)}</strong><small>${esc(focusedStreamDetail)}</small></div>
          <div><span>Last provider scan</span><strong>${esc(formatAutomationTimestamp(automation.lastScanAt))}</strong><small>${automation.nextScanAt ? `Next ${esc(formatAutomationTimestamp(automation.nextScanAt))}` : "Waiting for automation"}</small></div>
        </div>
        ${missingProductionSources ? `
          <div class="review-automation-warning" role="status">${esc(automation.sourceIntegrity?.detail || `${formatNumber(missingProductionSources)} older Studio records were excluded because their source MP4 files are missing.`)}</div>
        ` : ""}
        ${workerLastFailure?.error ? `
          <div class="review-automation-warning" role="status">Last editor retry: ${esc(workerLastFailure.error)}${workerLastFailure.at ? ` · ${esc(formatAutomationTimestamp(workerLastFailure.at))}` : ""}</div>
        ` : ""}
        ${providerErrors.length || automation.error || automation.lastError ? `
          <div class="review-automation-warning" role="status">${esc(automation.error || automation.lastError || providerErrors.map((item) => `${item.provider}: ${item.message}`).join(" · "))}</div>
        ` : ""}
      </section>
      <div class="production-review-head">
        <div>
          <span class="watch-kicker">Production review</span>
          <h2>Precheck and Product Ready</h2>
        </div>
        <div class="production-totals"><b>${precheck.length}</b> review · <b>${productReady.length}</b> ready</div>
      </div>
      <div class="production-lane-grid">
        ${renderProductionLane(precheck, "precheck")}
        ${renderProductionLane(productReady, "product_ready")}
      </div>
    </section>
  `;
}

function libraryClipStatus(clip = {}) {
  const stage = productionStage(clip);
  if (stage === "product_ready") return { id: "ready", label: "Product Ready" };
  if (stage === "precheck") return { id: "review", label: "In review" };
  if (clipApprovedForBuilder(clip)) return { id: "editing", label: "Editing" };
  if (clipPlaybackUrl(clip)) return { id: "saved", label: "Saved clip" };
  return { id: "processing", label: "Processing" };
}

function clipHasFinishedStudioEdit(clip = {}) {
  const stage = productionStage(clip);
  return ["precheck", "product_ready"].includes(stage) && Boolean(productionPlaybackUrl(clip));
}

function libraryPlaybackUrl(clip = {}) {
  return productionPlaybackUrl(clip) || clipPlaybackUrl(clip);
}

function libraryClips() {
  const query = String(state.library.query || "").trim().toLowerCase();
  const filter = state.library.filter || "all";
  return (state.clips || [])
    .filter((clip) => !clipDeclined(clip))
    .filter(clipHasFinishedStudioEdit)
    .filter((clip) => filter === "all" || libraryClipStatus(clip).id === filter)
    .filter((clip) => {
      if (!query) return true;
      return `${clip.title || ""} ${clip.streamerName || ""} ${clipStatusLabel(clip) || ""}`.toLowerCase().includes(query);
    })
    .sort((a, b) => String(b.productionWorkflow?.updatedAt || b.updatedAt || b.createdAt || "").localeCompare(String(a.productionWorkflow?.updatedAt || a.updatedAt || a.createdAt || "")));
}

function renderLibraryCard(clip = {}) {
  const playback = libraryPlaybackUrl(clip);
  const status = libraryClipStatus(clip);
  const duration = clip.productionWorkflow?.readiness?.probe?.durationSeconds || clip.durationSeconds || clip.duration || 0;
  const format = selectedClipFormat();
  const quality = Number(clip.score || clip.qualityScore || 0);
  const localPath = String(clip.productionWorkflow?.localLibraryPath || "");
  return `
    <article class="library-card ${esc(status.id)} ${esc(format.className)}">
      <div class="library-card-media">
        ${playback
          ? `<video src="${esc(playback)}" muted playsinline preload="metadata" aria-label="${esc(clip.streamerName || clip.title || "Saved clip")}"></video>`
          : `<div class="library-card-placeholder"><small>Video processing</small></div>`}
        <span class="library-status">${esc(status.label)}</span>
      </div>
      <div class="library-card-body">
        <div>
          <strong>${esc(clip.streamerName || clip.title || "Untitled clip")}</strong>
          <small>${formatSeconds(duration || 30)} · ${quality ? `${quality}% quality` : "Quality pending"} · ${esc(format.label)}</small>
          ${localPath ? `<small class="library-local-state">Saved locally · ${esc(fileNameFromPath(localPath))}</small>` : ""}
        </div>
        <div class="library-card-actions">
          ${playback ? `<a href="${esc(playback)}" target="_blank" rel="noreferrer">View clip</a>` : ""}
          ${status.id === "saved" ? `<button type="button" class="primary" data-approve-clip="${esc(clip.id)}">Prepare</button>` : ""}
          ${status.id === "editing" ? `<button type="button" class="primary" data-library-open-editor="${esc(clip.id)}">Edit</button>` : ""}
          ${["review", "ready"].includes(status.id) ? `<button type="button" class="primary" data-library-open-review="${esc(clip.id)}">Review</button>` : ""}
          ${localPath ? `<button type="button" data-open-local-path="${esc(localPath)}">Show file</button>` : ""}
          <button type="button" class="danger library-remove" data-remove-clip="${esc(clip.id)}" aria-label="Remove ${esc(clip.streamerName || clip.title || "clip")} from Library">Remove</button>
        </div>
      </div>
    </article>
  `;
}

function renderDiscoverClipCard(clip = {}) {
  const playback = clipPlaybackUrl(clip);
  const thumbnail = clipThumbnailUrl(clip);
  const duration = clip.durationSeconds || clip.duration || state.config?.recordingWindowSeconds || 30;
  const quality = Number(clip.score || clip.qualityScore || 0);
  const format = selectedClipFormat();
  return `
    <article class="discover-clip-card ${esc(format.className)}">
      <div class="discover-clip-media ${thumbnail ? "has-thumbnail" : "is-error"}" data-discover-thumbnail-frame>
        <div class="discover-clip-placeholder"><span>${thumbnail ? "Loading preview" : "Preparing clip"}</span></div>
        ${thumbnail
          ? `<img src="${esc(thumbnail)}" alt="First frame of ${esc(clip.streamerName || "captured clip")}" loading="lazy" decoding="async" data-discover-thumbnail>`
          : ""}
      </div>
      <div class="discover-clip-body">
        <strong>${esc(clip.streamerName || "Local upload")}</strong>
        <small>${formatSeconds(duration)} · ${quality ? `${quality}% quality` : "Quality pending"} · ${esc(format.label)}</small>
        <div class="discover-clip-actions">
          ${playback ? `<a href="${esc(playback)}" target="_blank" rel="noreferrer">View clip</a>` : `<button type="button" disabled>Preparing</button>`}
          ${playback ? `<button type="button" class="primary" data-approve-clip="${esc(clip.id)}">Approve</button>` : ""}
          <button type="button" class="decline" data-decline-clip="${esc(clip.id)}">Decline</button>
          <button type="button" class="danger" data-remove-clip="${esc(clip.id)}">Remove</button>
        </div>
      </div>
    </article>
  `;
}

function renderLibraryArea() {
  const allClips = (state.clips || []).filter((clip) => !clipDeclined(clip) && clipHasFinishedStudioEdit(clip));
  const clips = libraryClips();
  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(clips.length / pageSize));
  const page = Math.max(0, Math.min(pageCount - 1, Number(state.library.page || 0)));
  state.library.page = page;
  const visible = clips.slice(page * pageSize, (page + 1) * pageSize);
  const counts = allClips.reduce((result, clip) => {
    const status = libraryClipStatus(clip).id;
    result[status] = (result[status] || 0) + 1;
    return result;
  }, {});
  const runningClip = (state.clips || []).find((clip) => clip.id === state.editor.autoPipelineRunningClipId);
  const folder = state.settings.outputFolder || {};
  const activeAutomationStage = automationStage();
  return `
    <section class="library-page">
      <section class="library-automation-bar ${state.settings.autoPipelineEnabled ? "is-on" : "is-off"}">
        <div class="library-automation-copy">
          <span>Automatic pipeline</span>
          <strong>${state.settings.autoPipelineEnabled ? (runningClip ? `Processing ${esc(runningClip.streamerName || runningClip.title || "clip")}` : `Automatic through ${esc(activeAutomationStage.label)}`) : "Manual after Discovery"}</strong>
          <small>${state.editor.autoPipelineError ? esc(state.editor.autoPipelineError) : esc(activeAutomationStage.gate)}</small>
        </div>
        <label class="library-automation-toggle">
          <input type="checkbox" data-auto-pipeline-toggle ${state.settings.autoPipelineEnabled ? "checked" : ""}>
          <span>Auto</span>
        </label>
        <div class="library-folder-copy">
          <span>Local folder</span>
          <strong>${folder.configured ? esc(folder.name || "Finished clips") : "Not selected"}</strong>
          <small>${folder.configured ? esc(folder.path) : "Choose where finished MP4 files are saved on this Mac."}</small>
        </div>
        <div class="library-folder-actions">
          <button type="button" data-choose-output-folder>${folder.configured ? "Change folder" : "Choose folder"}</button>
          ${folder.configured ? `<button type="button" data-open-output-folder>Open folder</button>` : ""}
        </div>
      </section>
      <div class="library-toolbar">
        <label class="library-search">
          <span>Search library</span>
          <input type="search" value="${esc(state.library.query)}" placeholder="Search clips or creators" data-library-search>
        </label>
        <div class="library-filters" role="tablist" aria-label="Library filters">
          ${[
            ["all", "All", allClips.length],
            ["review", "In Review", counts.review || 0],
            ["ready", "Product Ready", counts.ready || 0]
          ].map(([id, label, count]) => `<button type="button" role="tab" class="${state.library.filter === id ? "is-active" : ""}" data-library-filter="${id}" aria-selected="${state.library.filter === id}">${label}<b>${count}</b></button>`).join("")}
        </div>
      </div>
      <div class="library-grid">
        ${visible.length ? visible.map(renderLibraryCard).join("") : `
          <div class="library-empty">
            <strong>${state.library.query ? "No edited clips match that search" : "No finished edits yet"}</strong>
            <small>${state.library.query ? "Try a creator name or clear the current filter." : "Finish a clip in Studio and send it to Review. The rendered edit will appear here automatically."}</small>
            <button type="button" data-app-view="studio">Open Studio</button>
          </div>`}
      </div>
      ${clips.length > pageSize ? `
        <div class="library-pagination">
          <button type="button" data-library-page="-1" ${page === 0 ? "disabled" : ""}>Previous</button>
          <span>${page * pageSize + 1}-${Math.min((page + 1) * pageSize, clips.length)} of ${clips.length}</span>
          <button type="button" data-library-page="1" ${page >= pageCount - 1 ? "disabled" : ""}>Next</button>
        </div>` : ""}
    </section>
  `;
}

function applyBufferStatus(payload = {}) {
  state.buffer = {
    ...state.buffer,
    ...payload,
    configured: payload.configured === true,
    autoPostingEnabled: false,
    schedulingEnabled: false,
    channels: Array.isArray(payload.channels) ? payload.channels : state.buffer.channels || [],
    loading: false,
    error: payload.status === "error" ? (payload.message || "Buffer needs attention.") : ""
  };
  return state.buffer;
}

async function loadBufferStatus(options = {}) {
  if (state.buffer.loading) return state.buffer;
  state.buffer.loading = true;
  state.buffer.error = "";
  state.editor.lastRenderSignature = "";
  renderClipsArea({ force: true });
  try {
    if (options.test === true) {
      await api("/api/integrations/buffer/test", {
        method: "POST",
        body: JSON.stringify({}),
        timeoutMs: 30000,
        timeoutMessage: "Buffer did not finish the connection check. No draft was created."
      });
    }
    const status = await api("/api/buffer/status", {
      timeoutMs: 15000,
      timeoutMessage: "Buffer status did not answer. No draft was created."
    });
    applyBufferStatus(status);
    if (options.test === true) {
      renderStatus(status.status === "connected"
        ? `Buffer connected — ${status.channels?.length || 0} TikTok/Instagram channel${status.channels?.length === 1 ? "" : "s"} available`
        : status.message || "Buffer connection needs attention");
    }
    return state.buffer;
  } catch (error) {
    state.buffer.loading = false;
    state.buffer.error = error.message || "Buffer connection failed";
    state.buffer.status = "error";
    if (options.test === true) renderStatus(state.buffer.error);
    throw error;
  } finally {
    state.editor.lastRenderSignature = "";
    renderClipsArea({ force: true });
  }
}

function bufferChannelSelectForClip(clipId = "") {
  return [...document.querySelectorAll("[data-buffer-channel-select]")]
    .find((select) => select.dataset.bufferChannelSelect === clipId) || null;
}

async function prepareClipForBuffer(clipId = "") {
  const channelId = bufferChannelSelectForClip(clipId)?.value || "";
  if (!clipId || !channelId || state.buffer.activeClipId) return;
  state.buffer.activeClipId = clipId;
  state.buffer.error = "";
  state.editor.lastRenderSignature = "";
  renderClipsArea({ force: true });
  try {
    const result = await api("/api/buffer/drafts/prepare", {
      method: "POST",
      body: JSON.stringify({ candidateId: clipId, channelId }),
      timeoutMs: 30000,
      timeoutMessage: "Buffer preparation did not finish. Nothing was posted."
    });
    if (result.candidate) replaceClipInState(result.candidate);
    if (result.buffer) applyBufferStatus(result.buffer);
    renderStatus("Buffer draft prepared — review the exact Human Gate approval next");
  } catch (error) {
    state.buffer.error = error.message || "Buffer draft preparation failed";
    renderStatus(state.buffer.error);
  } finally {
    state.buffer.activeClipId = "";
    state.editor.lastRenderSignature = "";
    renderClipsArea({ force: true });
  }
}

async function approveClipBufferDraft(clipId = "", approvalId = "") {
  if (!clipId || !approvalId || state.buffer.activeClipId) return;
  state.buffer.activeClipId = clipId;
  state.editor.lastRenderSignature = "";
  renderClipsArea({ force: true });
  try {
    await api("/api/human-gate/approve", {
      method: "POST",
      body: JSON.stringify({
        id: approvalId,
        notes: "Operator approved one exact Buffer video draft. Automatic scheduling and public posting remain off."
      }),
      timeoutMs: 20000
    });
    await refreshWatchState();
    renderStatus("Human Gate approved this exact draft — Buffer has not been contacted yet");
  } catch (error) {
    state.buffer.error = error.message || "Buffer draft approval failed";
    renderStatus(state.buffer.error);
  } finally {
    state.buffer.activeClipId = "";
    state.editor.lastRenderSignature = "";
    renderClipsArea({ force: true });
  }
}

async function createApprovedBufferDraft(clipId = "", draftId = "", approvalId = "") {
  if (!clipId || !draftId || !approvalId || state.buffer.activeClipId) return;
  state.buffer.activeClipId = clipId;
  state.editor.lastRenderSignature = "";
  renderClipsArea({ force: true });
  try {
    const result = await api(`/api/buffer/posts/${encodeURIComponent(draftId)}/create-draft`, {
      method: "POST",
      body: JSON.stringify({ approvalId }),
      timeoutMs: 45000,
      timeoutMessage: "Buffer did not confirm the draft. Inspect Buffer before attempting anything again."
    });
    if (result.candidate) replaceClipInState(result.candidate);
    if (result.buffer) applyBufferStatus(result.buffer);
    renderStatus("Buffer draft created — it is not scheduled or published");
  } catch (error) {
    state.buffer.error = error.message || "Buffer draft creation failed";
    await refreshWatchState().catch(() => {});
    renderStatus(state.buffer.error);
  } finally {
    state.buffer.activeClipId = "";
    state.editor.lastRenderSignature = "";
    renderClipsArea({ force: true });
  }
}

async function revokeClipBufferMedia(clipId = "", draftId = "") {
  if (!clipId || !draftId || state.buffer.activeClipId) return;
  state.buffer.activeClipId = clipId;
  state.editor.lastRenderSignature = "";
  renderClipsArea({ force: true });
  try {
    const result = await api(`/api/buffer/posts/${encodeURIComponent(draftId)}/revoke-media`, {
      method: "POST",
      body: JSON.stringify({}),
      timeoutMs: 15000
    });
    if (result.candidate) replaceClipInState(result.candidate);
    renderStatus("Buffer media link revoked. The local Product Ready MP4 was not deleted.");
  } catch (error) {
    state.buffer.error = error.message || "Buffer media link could not be revoked";
    renderStatus(state.buffer.error);
  } finally {
    state.buffer.activeClipId = "";
    state.editor.lastRenderSignature = "";
    renderClipsArea({ force: true });
  }
}

function renderBufferSettings() {
  const buffer = state.buffer || {};
  const connected = buffer.status === "connected";
  const channelSummary = (buffer.channels || []).map((channel) => (
    `${channel.service === "tiktok" ? "TikTok" : "Instagram"}: ${channel.name}`
  ));
  return `
    <section class="settings-buffer-section ${connected ? "is-connected" : "needs-attention"}">
      <header>
        <div>
          <span>Publishing connector</span>
          <strong>Buffer · manual drafts</strong>
          <small>${esc(buffer.message || "Test the Railway BUFFER_API_KEY and load connected channels.")}</small>
        </div>
        <div class="buffer-mode-lock"><b>Auto-post OFF</b><small>No schedule · no share now</small></div>
      </header>
      <div class="settings-buffer-flow" aria-label="Buffer manual workflow">
        <span><b>1</b> Choose Product Ready clip</span>
        <span><b>2</b> Human Gate approval</span>
        <span><b>3</b> Create Buffer draft</span>
        <span><b>4</b> Publish manually in Buffer</span>
      </div>
      ${channelSummary.length ? `<p class="settings-buffer-channels">${channelSummary.map(esc).join(" · ")}</p>` : ""}
      ${buffer.error ? `<p class="settings-buffer-error">${esc(buffer.error)}</p>` : ""}
      <button type="button" data-buffer-test ${buffer.loading ? "disabled" : ""}>${buffer.loading ? "Checking Buffer..." : connected ? "Refresh Buffer channels" : "Test Buffer connection"}</button>
      <p class="settings-buffer-note">The API key stays server-side. Creating a Buffer draft requires a separate exact approval and still does not publish the video.</p>
    </section>
  `;
}

function renderSettingsArea() {
  const format = selectedClipFormat();
  const selectedStage = automationStage();
  const automationProgress = `${selectedStage.level * 25}%`;
  return `
    <section class="settings-page">
      <div class="settings-page-head">
        <span class="watch-kicker">Workspace settings</span>
        <h2>Automation & output</h2>
        <p>Choose exactly where Argentum works automatically and where your approval takes over.</p>
      </div>
      <section class="settings-automation-section">
        <header class="settings-automation-head">
          <div>
            <span>Automation depth</span>
            <strong>Stop at ${esc(selectedStage.label)}</strong>
            <small>Move the control to set the last workflow stage Argentum may complete automatically.</small>
          </div>
          <output data-automation-stage-output for="automation-stage-range">${selectedStage.level ? `Auto through ${esc(selectedStage.label)}` : "Manual review"}</output>
        </header>
        <div class="settings-automation-summary">
          <div>
            <span>Argentum handles</span>
            <strong data-automation-auto-copy>${esc(selectedStage.automatic)}</strong>
          </div>
          <div>
            <span>Your checkpoint</span>
            <strong data-automation-gate-copy>${esc(selectedStage.gate)}</strong>
          </div>
        </div>
        <div class="settings-automation-control" style="--automation-progress: ${automationProgress}">
          <div class="settings-automation-track" aria-hidden="true"><i></i></div>
          <input id="automation-stage-range" type="range" min="0" max="4" step="1" value="${selectedStage.level}" data-automation-stage-range aria-label="Automatic workflow stopping point" aria-valuetext="Stop at ${esc(selectedStage.label)}">
          <div class="settings-automation-milestones" aria-label="Automation stopping points">
            ${AUTOMATION_STAGES.map((stage) => `
              <button type="button" class="${stage.level === selectedStage.level ? "is-active" : ""} ${stage.level < selectedStage.level ? "is-complete" : ""}" data-automation-stage="${stage.level}" aria-pressed="${stage.level === selectedStage.level}">
                <i aria-hidden="true"></i>
                <span>${esc(stage.label)}</span>
              </button>
            `).join("")}
          </div>
        </div>
        <p class="settings-automation-note">Changing this setting never publishes a clip. Product Ready videos remain local until you choose what happens next.</p>
      </section>
      <div class="settings-format-section">
        <div>
          <strong>Output format</strong>
          <small>Choose how clips are framed across Discover, Studio, Review, and Library.</small>
        </div>
        <div class="settings-format-grid" role="radiogroup" aria-label="Clip format">
          ${Object.values(CLIP_FORMATS).map((option) => `
            <button type="button" class="settings-format-option ${option.id === format.id ? "is-active" : ""}" data-setting-format="${esc(option.id)}" role="radio" aria-checked="${option.id === format.id}">
              <span class="settings-format-frame ${esc(option.className)}"><i></i></span>
              <span><b>${esc(option.label)}</b><small>${esc(option.description)}</small></span>
            </button>
          `).join("")}
        </div>
      </div>
      ${renderBufferSettings()}
    </section>
  `;
}

function renderBuilderArea() {
  const clips = builderClips();
  const selectedClipId = selectedBuilderClip()?.id || "";
  return `
    <section class="builder-panel studio-projects">
      <div class="clips-head">
        <div>
          <span class="watch-kicker">Projects</span>
          <h2>Ready to edit</h2>
          <small class="builder-order-help">Select a clip to continue editing</small>
        </div>
        <div class="builder-count">${clips.length}/${PRODUCTION_QUEUE_LIMIT} active</div>
      </div>
      <div class="builder-row">
        ${clips.length ? clips.map((clip, index) => `
          <article class="builder-item ${selectedClipId === clip.id ? "selected" : ""}" data-select-builder-clip="${esc(clip.id)}" data-builder-drag-clip="${esc(clip.id)}" draggable="true" tabindex="0">
            <div class="builder-item-head">
              <span>Queue ${index + 1}</span>
              <span class="builder-drag-label">Drag</span>
            </div>
            <strong>${esc(editorProjectName(clip))}</strong>
            <p>${esc(editorProjectDescription(clip))}</p>
            <small>${formatSeconds(clip.durationSeconds || clip.duration || 30)} · ${Number(clip.score || 0) || 0}% quality</small>
            <em>${selectedClipId === clip.id ? "Open in Studio" : "Select to edit"}</em>
            <div class="builder-actions">
              <button type="button" data-builder-move-up="${esc(clip.id)}" ${index === 0 ? "disabled" : ""} aria-label="Move clip up">Up</button>
              <button type="button" data-builder-move-down="${esc(clip.id)}" ${index === clips.length - 1 ? "disabled" : ""} aria-label="Move clip down">Down</button>
              ${selectedClipId === clip.id ? `<button type="button" class="danger" data-unload-builder-clip="${esc(clip.id)}">Unload</button>` : ""}
            </div>
          </article>
        `).join("") : `
          <div class="clips-empty">
            <strong>No projects yet</strong>
            <span>Prepare a saved clip from Discover or your Library.</span>
          </div>
        `}
      </div>
    </section>
    ${renderArgentumEditorWorkspace(clips)}
  `;
}

function editorProjectName(clip = {}) {
  const streamer = String(clip.streamerName || "").trim();
  if (streamer) return `${streamer} clip`;
  const rawTitle = String(clip.title || "").trim();
  const creatorFromWindowTitle = rawTitle.match(/clip window \d+\s*:\s*(.+)$/i)?.[1]?.trim();
  if (creatorFromWindowTitle) return `${creatorFromWindowTitle} clip`;
  return rawTitle || "Untitled clip";
}

function editorProjectDescription(clip = {}) {
  const category = String(clip.category || clip.gameName || "").trim();
  const caption = editorCaptionsForClip(clip).segments?.[0]?.text
    || clip.editorialCaption?.primary_caption
    || clip.editorialCaption?.text
    || "";
  const event = String(clip.editorialCaption?.analysis?.primaryEvent || clip.analysis?.primaryEvent || "").trim();
  const genericCategory = /^(live|twitch|kick|source review|unknown category)$/i.test(category);
  const meaningfulEvent = event && !/^(review|media ai found|chat popped|stream highlight)\b/i.test(event);
  const source = caption
    ? caption
    : meaningfulEvent
      ? event
    : !genericCategory && category
      ? `${category} gameplay moment ready to edit`
      : "Stream highlight ready for final edit";
  const words = source
    .replace(/[\r\n]+/g, " ")
    .replace(/[^a-z0-9'&+\- ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 6);
  return words.join(" ") || "Stream highlight ready for final edit";
}

function editorAssetName(clip = {}) {
  return fileNameFromPath(clip.outputPath || clip.filePath || clip.sourcePath || clip.mediaPath || clip.videoPath || clip.playbackUrl || clip.title || "approved-clip.mp4");
}

function editorClipSelectValue(clips = builderClips(), selectedId = selectedBuilderClip()?.id || "") {
  return `
    <select data-editor-load-select ${clips.length ? "" : "disabled"}>
      ${clips.map((clip) => `<option value="${esc(clip.id)}" ${clip.id === selectedId ? "selected" : ""}>${esc(clip.title || editorAssetName(clip))}</option>`).join("")}
    </select>
  `;
}

function renderEditorSourceControls(clip = null, clips = builderClips()) {
  if (!clip && !clips.length) return "";
  return `
    <div class="editor-project-bar">
      <div class="editor-project-source">
        <small>Current project</small>
        <strong>${esc(clip ? editorProjectName(clip) : "Choose a project above")}</strong>
        <span>${clip ? `${esc(editorProjectDescription(clip))} · ${formatSeconds(editorClipDuration(clip))}` : "Select a ready-to-edit project to begin."}</span>
      </div>
    </div>
  `;
}

function setEditorCompileProgress(clipId, percent, stage, detail) {
  state.editor.compileProgress = {
    clipId,
    percent: Math.max(0, Math.min(100, Math.round(Number(percent) || 0))),
    stage: String(stage || "Compiling video"),
    detail: String(detail || "Please keep Argentum open while this finishes.")
  };
  const progress = state.editor.compileProgress;
  document.querySelectorAll("[data-editor-compile-progress]").forEach((panel) => {
    panel.hidden = false;
    panel.classList.toggle("is-complete", progress.percent === 100);
    const stageNode = panel.querySelector("[data-editor-compile-stage]");
    const detailNode = panel.querySelector("[data-editor-compile-detail]");
    const valueNode = panel.querySelector("[data-editor-compile-value]");
    const barNode = panel.querySelector("[data-editor-compile-bar]");
    if (stageNode) stageNode.textContent = progress.stage;
    if (detailNode) detailNode.textContent = progress.detail;
    if (valueNode) valueNode.textContent = `${progress.percent}%`;
    if (barNode) {
      barNode.style.width = `${progress.percent}%`;
      barNode.closest("[role='progressbar']")?.setAttribute("aria-valuenow", String(progress.percent));
    }
  });
  document.querySelectorAll("button.editor-compile-button[data-editor-export]").forEach((button) => {
    button.textContent = progress.percent === 100 ? "Moved to Precheck" : `Compiling ${progress.percent}%`;
  });
  reportAutomationCompileProgress(progress);
}

function renderEditorCompileProgress(clip = null) {
  const progress = state.editor.compileProgress?.clipId === clip?.id ? state.editor.compileProgress : null;
  return `
    <div class="editor-compile-progress ${progress?.percent === 100 ? "is-complete" : ""}" data-editor-compile-progress ${progress ? "" : "hidden"}>
      <div class="editor-compile-progress-head">
        <div>
          <small>Compile progress</small>
          <strong data-editor-compile-stage>${esc(progress?.stage || "Preparing video")}</strong>
        </div>
        <b data-editor-compile-value>${Math.round(progress?.percent || 0)}%</b>
      </div>
      <div class="editor-compile-progress-track" role="progressbar" aria-label="Video compile progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress?.percent || 0)}">
        <span data-editor-compile-bar style="width:${Math.round(progress?.percent || 0)}%"></span>
      </div>
      <span data-editor-compile-detail>${esc(progress?.detail || "Please keep Argentum open while this finishes.")}</span>
    </div>
  `;
}

function renderEditorStickerLayer(clip = null) {
  if (!clip?.id) return "";
  const sticker = editorStickerForClip(clip);
  const previewUrl = state.editor.stickerPreviews[clip.id] || sticker.previewDataUrl || "";
  const label = sticker.label || sticker.assetName || "Sticker";
  const style = `--sticker-x:${sticker.xPercent}%;--sticker-y:${sticker.yPercent}%;--sticker-size:${sticker.sizePercent}%;`;
  const content = sticker.type === "image"
    ? (previewUrl ? `<img src="${esc(previewUrl)}" alt="${esc(label)}">` : "")
    : `<span>${esc(label)}</span>`;
  return `<div class="editor-sticker-overlay ${esc(sticker.type)} ${sticker.enabled ? "" : "is-disabled"} ${sticker.type === "image" && !previewUrl ? "is-loading" : ""}" style="${esc(style)}" data-editor-sticker-overlay>${content}</div>`;
}

function renderEditorCaptionLayer(clip = null) {
  if (!clip?.id) return "";
  const captions = editorCaptionsForClip(clip);
  const initial = editorCaptionAtTime(captions, 0) || (captions.enabled ? captions.segments[0] : null);
  const style = captions.style || editorDefaultCaptions().style;
  return `
    <div class="editor-caption-overlay theme-${esc(style.theme || "story")} ${captions.enabled && initial ? "" : "is-empty"}" style="--caption-x:${style.xPercent}%;--caption-y:${style.yPercent}%;" data-editor-caption-overlay>
      ${initial ? `<span>${esc(initial.text)}</span>` : ""}
    </div>
  `;
}

function renderEditorCaptionControls(clip = null) {
  const disabled = !clip?.id;
  const noTranscriptMessage = "No real transcript found for this clip yet.";
  const captions = editorCaptionsForClip(clip);
  const transcriptReady = Boolean(editorTranscriptTextForClip(clip));
  const generating = Boolean(clip?.id && state.editor.captionGeneratingClipId === clip.id);
  const previewCaption = captions.enabled
    ? (captions.segments?.[0]?.text || "Caption preview ready")
    : (transcriptReady ? (editorTranscriptTextForClip(clip)?.slice(0, 120) || "Transcript ready") : "");
  const captionNote = state.editor.captionNotes[clip?.id]
    || (!captions.enabled && !transcriptReady && clip?.id ? noTranscriptMessage : "");
  return `
    <div class="editor-caption-card">
      <small>Captions</small>
      <strong>${generating ? "Listening to MP4 audio" : captions.enabled ? "Context hook ready" : transcriptReady ? "Speech ready" : "Ready to transcribe"}</strong>
      <span>${generating ? "Reading speech and timing before writing the hook." : captions.enabled ? "Speech, chat, and clip context shape the caption on the preview and export." : transcriptReady ? "Generate a short hook from the actual speech and clip evidence." : "Generate will transcribe the loaded MP4 before writing the caption."}</span>
      ${previewCaption ? `<em class="editor-caption-preview">${esc(previewCaption)}</em>` : ""}
      ${captionNote ? `<em class="editor-caption-note">${esc(captionNote)}</em>` : ""}
      <div class="editor-caption-actions">
        <button type="button" data-editor-caption-action="view" data-editor-caption-clip="${esc(clip?.id || "")}" ${disabled ? "disabled" : ""}>View</button>
        <button type="button" data-editor-caption-action="reread" data-editor-caption-clip="${esc(clip?.id || "")}" ${disabled || generating ? "disabled" : ""}>Read full clip</button>
        <button type="button" data-editor-caption-action="generate" data-editor-caption-clip="${esc(clip?.id || "")}" ${disabled || generating ? "disabled" : ""}>${generating ? "Transcribing" : "Generate"}</button>
        <button type="button" class="danger" data-editor-caption-action="clear" data-editor-caption-clip="${esc(clip?.id || "")}" ${disabled || !captions.enabled ? "disabled" : ""}>Clear</button>
      </div>
    </div>
  `;
}

function renderEditorStickerControls(clip = null) {
  const disabled = !clip?.id;
  const sticker = editorStickerForClip(clip);
  const clipId = clip?.id || "";
  const library = state.editor.stickerLibrary || [];
  return `
    <div class="editor-sticker-card">
      <small>Sticker</small>
      <strong>${sticker.enabled ? esc(sticker.assetName || sticker.label || "Sticker loaded") : "Add bottom sticker"}</strong>
      <span data-editor-sticker-summary>${sticker.enabled ? `X ${editorStickerSliderValue("xPercent", sticker.xPercent)} · Y ${editorStickerSliderValue("yPercent", sticker.yPercent)} · Size ${editorStickerSliderValue("sizePercent", sticker.sizePercent)}` : "Choose an image or type a sticker label, then place it on the 9:16 canvas."}</span>
      <div class="editor-sticker-actions">
        <button type="button" data-editor-sticker-pick="${esc(clipId)}" ${disabled ? "disabled" : ""}>Choose</button>
        <label class="${disabled ? "disabled" : ""}">
          Upload
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-editor-sticker-upload="${esc(clipId)}" ${disabled ? "disabled" : ""}>
        </label>
        <button type="button" class="danger" data-editor-sticker-clear="${esc(clipId)}" ${disabled || !sticker.enabled ? "disabled" : ""}>Remove</button>
      </div>
      <label class="editor-sticker-field">
        <span>Text sticker</span>
        <input type="text" value="${esc(sticker.type === "text" ? sticker.label : "")}" placeholder="Stake" data-editor-sticker-field="label" data-editor-sticker-clip="${esc(clipId)}" ${disabled ? "disabled" : ""}>
      </label>
      <div class="editor-sticker-sliders">
        <label>
          <span>X</span>
          <input type="range" min="8" max="92" value="${esc(sticker.xPercent)}" aria-label="Sticker X position" data-editor-sticker-field="xPercent" data-editor-sticker-clip="${esc(clipId)}" ${disabled ? "disabled" : ""}>
          <output data-editor-sticker-value="xPercent">${esc(editorStickerSliderValue("xPercent", sticker.xPercent))}</output>
        </label>
        <label>
          <span>Y</span>
          <input type="range" min="58" max="94" value="${esc(sticker.yPercent)}" aria-label="Sticker Y position" data-editor-sticker-field="yPercent" data-editor-sticker-clip="${esc(clipId)}" ${disabled ? "disabled" : ""}>
          <output data-editor-sticker-value="yPercent">${esc(editorStickerSliderValue("yPercent", sticker.yPercent))}</output>
        </label>
        <label>
          <span>Size</span>
          <input type="range" min="8" max="44" value="${esc(sticker.sizePercent)}" aria-label="Sticker size" data-editor-sticker-field="sizePercent" data-editor-sticker-clip="${esc(clipId)}" ${disabled ? "disabled" : ""}>
          <output data-editor-sticker-value="sizePercent">${esc(editorStickerSliderValue("sizePercent", sticker.sizePercent))}</output>
        </label>
      </div>
      <div class="editor-sticker-library">
        <div class="editor-sticker-library-head">
          <span>Preset library</span>
          <button type="button" data-editor-sticker-save-preset="${esc(clipId)}" ${disabled || !sticker.enabled ? "disabled" : ""}>Save current</button>
        </div>
        <div class="editor-sticker-preset-row">
          <select data-editor-sticker-library="${esc(clipId)}" ${disabled || !library.length ? "disabled" : ""}>
            <option value="">${library.length ? "Choose saved sticker" : "No saved stickers yet"}</option>
            ${library.map((entry) => `<option value="${esc(entry.id)}">${esc(entry.name)}</option>`).join("")}
          </select>
          <button type="button" data-editor-sticker-use-preset="${esc(clipId)}" ${disabled || !library.length ? "disabled" : ""}>Use</button>
        </div>
      </div>
    </div>
  `;
}

function renderEditorTimeline(clip = null, durationSeconds = 30) {
  const duration = Math.max(1, Math.round(Number(durationSeconds || 30)));
  const marks = [0, Math.round(duration * 0.25), Math.round(duration * 0.5), Math.round(duration * 0.75), duration];
  const clipId = clip?.id || "";
  const tracks = editorTimelineForClip(clip, duration);
  const selectedLayer = editorSelectedTimelineLayer(tracks);
  return `
    <div class="editor-timeline ${clipId ? "" : "is-disabled"}" data-editor-timeline-clip="${esc(clipId)}" data-editor-timeline-duration="${esc(duration)}" aria-disabled="${clipId ? "false" : "true"}">
      <div class="editor-timeline-toolbar">
        <div>
          <small>Timeline</small>
          <strong data-editor-layer-title>${esc(selectedLayer?.name || "Layer controls")}</strong>
          <span data-editor-layer-range>${selectedLayer ? esc(editorLayerTimeLabel(selectedLayer)) : "Select a layer to edit timing"}</span>
        </div>
        <div class="editor-timeline-actions">
          <button type="button" data-editor-layer-full="${esc(selectedLayer?.id || "")}" data-editor-layer-clip="${esc(clipId)}" ${!selectedLayer || !clipId ? "disabled" : ""}>Full clip</button>
          <button type="button" data-editor-layer-at-playhead="start" data-editor-layer-id="${esc(selectedLayer?.id || "")}" data-editor-layer-clip="${esc(clipId)}" ${!selectedLayer || !clipId ? "disabled" : ""}>Start at playhead</button>
          <button type="button" data-editor-layer-at-playhead="end" data-editor-layer-id="${esc(selectedLayer?.id || "")}" data-editor-layer-clip="${esc(clipId)}" ${!selectedLayer || !clipId ? "disabled" : ""}>End at playhead</button>
        </div>
      </div>
      <div class="editor-ruler">
        ${marks.map((mark) => `<span>${formatSeconds(mark)}</span>`).join("")}
      </div>
      <div class="editor-tracks">
        ${tracks.map((track) => {
          const percent = editorTimelineLayerPercent(track, duration);
          return `
          <div class="editor-track ${selectedLayer?.id === track.id ? "selected" : ""}" data-editor-track="${esc(track.id)}">
            <b>${esc(track.label)}</b>
            <div class="editor-track-rail">
              <div class="editor-layer-block ${selectedLayer?.id === track.id ? "selected" : ""}" style="--track-width:${percent.width}%;--track-offset:${percent.offset}%;" data-editor-layer-block data-editor-layer-id="${esc(track.id)}" data-editor-layer-clip="${esc(clipId)}" data-editor-layer-duration="${esc(duration)}">
                <button type="button" class="editor-layer-handle start" data-editor-layer-handle="start" data-editor-layer-id="${esc(track.id)}" data-editor-layer-clip="${esc(clipId)}" aria-label="Trim layer start" ${clipId ? "" : "disabled"}></button>
                <button type="button" class="editor-layer-body" data-editor-layer-body data-editor-layer-id="${esc(track.id)}" data-editor-layer-clip="${esc(clipId)}" ${clipId ? "" : "disabled"}>
                  <i>${esc(track.name)}</i>
                  <em data-editor-layer-time>${esc(editorLayerTimeLabel(track))}</em>
                </button>
                <button type="button" class="editor-layer-handle end" data-editor-layer-handle="end" data-editor-layer-id="${esc(track.id)}" data-editor-layer-clip="${esc(clipId)}" aria-label="Trim layer end" ${clipId ? "" : "disabled"}></button>
              </div>
            </div>
          </div>
        `;
        }).join("")}
      </div>
      ${selectedLayer ? `
        <div class="editor-layer-control-panel" data-editor-layer-controls="${esc(selectedLayer.id)}">
          <div>
            <small>Selected layer</small>
            <strong>${esc(selectedLayer.name)}</strong>
            <span>${esc(selectedLayer.detail || "Move or extend this layer without changing the preview canvas.")}</span>
          </div>
          <label>
            <span>Start</span>
            <input type="number" min="0" max="${esc(duration)}" step="0.1" value="${esc(selectedLayer.startSeconds)}" data-editor-layer-field="startSeconds" data-editor-layer-id="${esc(selectedLayer.id)}" data-editor-layer-clip="${esc(clipId)}" ${clipId ? "" : "disabled"}>
          </label>
          <label>
            <span>End</span>
            <input type="number" min="0.1" max="${esc(duration)}" step="0.1" value="${esc(selectedLayer.endSeconds)}" data-editor-layer-field="endSeconds" data-editor-layer-id="${esc(selectedLayer.id)}" data-editor-layer-clip="${esc(clipId)}" ${clipId ? "" : "disabled"}>
          </label>
          <label class="wide">
            <span>Move start</span>
            <input type="range" min="0" max="${esc(duration)}" step="0.1" value="${esc(selectedLayer.startSeconds)}" data-editor-layer-field="moveTo" data-editor-layer-id="${esc(selectedLayer.id)}" data-editor-layer-clip="${esc(clipId)}" ${clipId ? "" : "disabled"}>
          </label>
        </div>
      ` : ""}
    </div>
  `;
}

function renderEditorPipeline(clip = null) {
  const hasClip = Boolean(clip);
  const hasPlayback = Boolean(clip && clipPlaybackUrl(clip));
  const preflight = clip ? editorPrecheckForClip(clip) : { checks: [] };
  const checks = new Map(preflight.checks.map((check) => [check.id, check]));
  const stage = productionStage(clip || {});
  const steps = [
    { label: "Import", status: checks.get("source")?.passed ? "ready" : "waiting", detail: hasClip ? editorAssetName(clip) : "No approved source" },
    { label: "Canvas", status: checks.get("canvas")?.passed ? "ready" : "waiting", detail: "1080x1920 · 9:16" },
    { label: "3:4 Video", status: checks.get("subject")?.passed ? "ready" : "waiting", detail: "1080x1440 subject frame" },
    { label: "Reframe", status: checks.get("reframe")?.passed ? "ready" : hasPlayback ? "active" : "waiting", detail: checks.get("reframe")?.detail || "Motion keyframes required" },
    { label: "Sticker", status: checks.get("sticker")?.passed ? "ready" : hasPlayback ? "active" : "waiting", detail: checks.get("sticker")?.passed ? "Overlay positioned" : "Sticker required" },
    { label: "Captions", status: checks.get("captions")?.passed ? "ready" : hasPlayback ? "active" : "waiting", detail: checks.get("captions")?.detail || "Timed captions required" },
    { label: "Render", status: preflight.ready ? "active" : "queued", detail: "Verified 1080x1920 MP4" },
    { label: "Precheck", status: ["precheck", "product_ready"].includes(stage) ? "ready" : "queued", detail: "Technical verification" },
    { label: "Product Ready", status: stage === "product_ready" ? "ready" : "queued", detail: "Operator approval" }
  ];
  return `
    <div class="editor-pipeline">
      <div class="editor-pipeline-title">
        <small>Edit flow</small>
        <strong>Vertical short</strong>
      </div>
      ${steps.map((step, index) => `
        <span class="${esc(step.status)}">
          <b>${index + 1}</b>
          <strong>${esc(step.label)}</strong>
          <em>${esc(step.detail)}</em>
        </span>
      `).join("")}
    </div>
  `;
}

function renderArgentumEditorWorkspace(clips = builderClips()) {
  const clip = selectedBuilderClip();
  const format = selectedClipFormat();
  const playback = clip ? clipPlaybackUrl(clip) : "";
  const duration = Number(clip?.durationSeconds || clip?.duration || state.config?.recordingWindowSeconds || 30);
  const reframePlan = editorReframePlanForClip(clip);
  const reframeCount = reframePlan?.keyframes?.length || 0;
  const sticker = editorStickerForClip(clip);
  const captions = editorCaptionsForClip(clip);
  const exporting = Boolean(clip?.id && state.editor.exportingClipId === clip.id);
  const uploading = Boolean(state.editor.uploadingSource);
  return `
    <section class="argentum-editor-panel consumer-editor ${esc(format.className)}" data-editor-clip-id="${esc(clip?.id || "")}" data-editor-format="${esc(format.id)}">
      <div class="studio-editor-head">
        <div>
          <span class="watch-kicker">AI Editor</span>
          <h2>${clip ? esc(editorProjectName(clip)) : "New project"}</h2>
          <p>${clip ? esc(editorProjectDescription(clip)) : "Choose a project above to begin editing."}</p>
        </div>
        ${playback ? `<div class="editor-head-actions">
          <button type="button" class="primary editor-compile-button" data-editor-export="${esc(clip.id)}" ${exporting ? "disabled" : ""}>${exporting ? `Compiling ${Math.round(state.editor.compileProgress?.percent || 0)}%` : "Finish & Send to Review"}</button>
        </div>` : ""}
      </div>
      ${renderEditorPreparationBar()}
      ${renderEditorCompileProgress(clip)}
      ${renderEditorSourceControls(clip, clips)}
      ${clip ? `
        <div class="editor-automation-strip" aria-label="AI edit status">
          <span class="ready"><i></i>9:16 canvas</span>
          <span class="${reframeCount ? "ready" : "working"}"><i></i>${reframeCount ? `Auto reframed · ${reframeCount} points` : "Auto reframe working"}</span>
          <span class="${captions.enabled ? "ready" : "waiting"}"><i></i>${captions.enabled ? "Captions ready" : "Captions optional"}</span>
          <span class="${sticker.enabled ? "ready" : "waiting"}"><i></i>${sticker.enabled ? "Sticker ready" : "Sticker optional"}</span>
        </div>` : ""}
      <div class="editor-studio-layout ${clip ? "has-tools" : "is-empty"}">
        <main class="editor-preview-stage">
          <div class="editor-preview-shell">
            <div class="editor-preview-frame" data-editor-preview data-editor-drop-zone>
              ${playback ? `
                <video class="editor-fill-video" src="${esc(playback)}" playsinline muted preload="metadata" data-editor-fill-video aria-hidden="true"></video>
                <div class="editor-subject-frame" data-editor-subject-frame>
                  <video class="editor-preview-video" src="${esc(playback)}" playsinline preload="metadata" data-editor-video data-editor-clip-id="${esc(clip?.id || "")}"></video>
                </div>
                ${renderEditorStickerLayer(clip)}
                ${renderEditorCaptionLayer(clip)}
              ` : `
                <div class="editor-preview-empty">
                  <span class="editor-preview-format">${esc(format.label)} preview</span>
                  <strong>${clip ? "Preparing your preview" : "Drop a video here"}</strong>
                  <span>${clip ? "The preview will appear when processing finishes." : "or choose a file from your computer"}</span>
                  <label class="editor-empty-upload ${uploading ? "disabled" : ""}">
                    ${uploading ? "Uploading video" : "Choose video"}
                    <input type="file" accept="video/mp4,video/webm,video/quicktime,video/*" data-editor-upload-clip ${uploading ? "disabled" : ""}>
                  </label>
                </div>
              `}
            </div>
            ${playback ? `
              <div class="editor-transport" data-editor-transport>
                <button type="button" data-editor-play>Play</button>
                <span><b data-editor-current>0:00</b> / <b data-editor-duration>${formatEditorTime(duration)}</b></span>
                <input type="range" min="0" max="${Math.max(1, Math.round(duration))}" value="0" step="0.05" data-editor-scrub aria-label="Scrub editor preview">
                <em data-editor-focus-label>Auto reframe ready</em>
              </div>
            ` : ""}
          </div>
        </main>
        ${clip ? `
          <aside class="editor-tool-panel">
            <div class="editor-tool-tabs" role="tablist" aria-label="Editor tools">
              <button type="button" role="tab" data-editor-tool-tab="captions" class="${state.editor.toolTab === "captions" ? "is-active" : ""}" aria-selected="${state.editor.toolTab === "captions"}">Captions</button>
              <button type="button" role="tab" data-editor-tool-tab="sticker" class="${state.editor.toolTab === "sticker" ? "is-active" : ""}" aria-selected="${state.editor.toolTab === "sticker"}">Sticker</button>
            </div>
            <div class="editor-tool-content">
              ${state.editor.toolTab === "sticker" ? renderEditorStickerControls(clip) : renderEditorCaptionControls(clip)}
            </div>
          </aside>` : ""}
      </div>
      ${clip ? `
        <div class="editor-advanced-row">
          <div><strong>Fine tune timing</strong><span>Adjust layer timing only when you need more control.</span></div>
          <button type="button" data-editor-timeline-toggle aria-expanded="${state.editor.timelineExpanded}">${state.editor.timelineExpanded ? "Hide timeline" : "Open timeline"}</button>
        </div>
        ${state.editor.timelineExpanded ? renderEditorTimeline(clip, duration) : ""}` : ""}
    </section>
  `;
}

function editorPreviewPanelFor(element) {
  return element?.closest?.(".argentum-editor-panel") || null;
}

function editorVideoFor(element) {
  return editorPreviewPanelFor(element)?.querySelector("[data-editor-video]") || null;
}

function editorFillVideoFor(element) {
  return editorPreviewPanelFor(element)?.querySelector("[data-editor-fill-video]") || null;
}

function clampEditorFocus(value, fallback = 50) {
  const number = Number.parseFloat(String(value ?? "").replace("%", ""));
  const safe = Number.isFinite(number) ? number : fallback;
  return Math.min(88, Math.max(12, safe));
}

function applyEditorReframeFocus(video, focusX = 50) {
  if (!video) return "50%";
  const safeFocus = clampEditorFocus(focusX);
  const focusValue = `${safeFocus.toFixed(2)}%`;
  const panel = editorPreviewPanelFor(video);
  video.style.setProperty("--editor-focus-x", focusValue);
  panel?.style.setProperty("--editor-focus-x", focusValue);
  panel?.style.setProperty("--editor-focus-y", "50%");
  return focusValue;
}

function stabilizeEditorReframeKeyframes(items = [], fallback = 50) {
  const sorted = (Array.isArray(items) ? items : [])
    .map((item) => ({ ...item, timeSeconds: Number(item.timeSeconds || 0), focusX: clampEditorFocus(item.focusX, fallback) }))
    .filter((item) => Number.isFinite(item.timeSeconds))
    .sort((a, b) => a.timeSeconds - b.timeSeconds);
  let focus = clampEditorFocus(sorted[0]?.focusX, fallback);
  let previousTime = Number(sorted[0]?.timeSeconds || 0);
  return sorted.map((item, index) => {
    if (index === 0) return { ...item, focusX: focus };
    const elapsed = Math.max(0.2, item.timeSeconds - previousTime);
    const delta = item.focusX - focus;
    const deadZone = 3.25;
    if (Math.abs(delta) > deadZone) {
      const maxMove = Math.max(0.8, Math.min(5, elapsed * 3.5));
      focus += Math.max(-maxMove, Math.min(maxMove, delta * 0.34));
    }
    previousTime = item.timeSeconds;
    return { ...item, focusX: Number(clampEditorFocus(focus).toFixed(2)) };
  });
}

function editorReframeFocusAtTime(plan = {}, timeSeconds = 0, fallback = 50) {
  const keyframes = Number(plan?.version || 0) >= 2
    ? (Array.isArray(plan?.keyframes) ? plan.keyframes : [])
      .map((item) => ({ ...item, timeSeconds: Number(item.timeSeconds || 0), focusX: clampEditorFocus(item.focusX, fallback) }))
      .filter((item) => Number.isFinite(item.timeSeconds))
      .sort((a, b) => a.timeSeconds - b.timeSeconds)
    : stabilizeEditorReframeKeyframes(plan?.keyframes, fallback);
  if (!keyframes.length) return clampEditorFocus(fallback);
  const time = Number(timeSeconds || 0);
  if (time <= keyframes[0].timeSeconds) return keyframes[0].focusX;
  const last = keyframes[keyframes.length - 1];
  if (time >= last.timeSeconds) return last.focusX;
  for (let index = 1; index < keyframes.length; index += 1) {
    const previous = keyframes[index - 1];
    const next = keyframes[index];
    if (time <= next.timeSeconds) {
      const span = Math.max(0.001, next.timeSeconds - previous.timeSeconds);
      const progress = Math.min(1, Math.max(0, (time - previous.timeSeconds) / span));
      return previous.focusX + ((next.focusX - previous.focusX) * progress);
    }
  }
  return clampEditorFocus(fallback);
}

function syncEditorFillVideo(video) {
  const fill = editorFillVideoFor(video);
  if (!fill || fill === video) return;
  const durationReady = Number.isFinite(video.duration) && video.duration > 0;
  const drift = Number(video.currentTime || 0) - Number(fill.currentTime || 0);
  if (durationReady && fill.readyState >= 2 && !fill.seeking && Math.abs(drift) > 0.85) {
    try {
      fill.currentTime = video.currentTime;
    } catch {}
  } else if (Math.abs(drift) <= 0.85) {
    fill.playbackRate = Math.min(1.03, Math.max(0.97, 1 + (drift * 0.025)));
  }
  if (video.paused || video.ended) {
    fill.pause();
  } else {
    fill.play().catch(() => {});
  }
}

function captureEditorPlaybackState(area = $("#clips-area")) {
  const video = area?.querySelector?.("[data-editor-video]");
  if (!video) return state.editor.playback;
  const panel = editorPreviewPanelFor(video);
  const clipId = video.dataset.editorClipId || panel?.dataset.editorClipId || "";
  if (!clipId) return state.editor.playback;
  const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  const focusX = video.style.getPropertyValue("--editor-focus-x")
    || panel?.style.getPropertyValue("--editor-focus-x")
    || "50%";
  state.editor.playback = {
    clipId,
    currentTime,
    playing: Boolean(!video.paused && !video.ended),
    focusX,
    capturedAt: Date.now()
  };
  return state.editor.playback;
}

function restoreEditorPlaybackState(snapshot = state.editor.playback, area = $("#clips-area")) {
  if (!snapshot?.clipId || !area) return;
  const video = [...area.querySelectorAll("[data-editor-video]")]
    .find((candidate) => candidate.dataset.editorClipId === snapshot.clipId);
  if (!video) return;
  const restore = () => {
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const safeTime = duration
      ? Math.min(Math.max(0, Number(snapshot.currentTime || 0)), Math.max(0, duration - 0.05))
      : Math.max(0, Number(snapshot.currentTime || 0));
    if (safeTime > 0 && Math.abs(Number(video.currentTime || 0) - safeTime) > 0.18) {
      try {
        video.currentTime = safeTime;
      } catch {}
    }
    const panel = editorPreviewPanelFor(video);
    if (snapshot.focusX) {
      const plan = editorReframePlanForClip(builderClipById(snapshot.clipId)) || {};
      const focus = editorReframeFocusAtTime(plan, safeTime, snapshot.focusX);
      applyEditorReframeFocus(video, focus);
    }
    updateEditorTransport(video);
    if (snapshot.playing) {
      video.play()
        .then(() => startEditorAutoReframeLoop(video))
        .catch(() => {});
    }
  };
  if (video.readyState >= 1) restore();
  else video.addEventListener("loadedmetadata", restore, { once: true });
}

function updateEditorTransport(video) {
  const panel = editorPreviewPanelFor(video);
  if (!panel) return;
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
  const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  const currentEl = panel.querySelector("[data-editor-current]");
  const durationEl = panel.querySelector("[data-editor-duration]");
  const scrub = panel.querySelector("[data-editor-scrub]");
  const play = panel.querySelector("[data-editor-play]");
  if (currentEl) currentEl.textContent = formatEditorTime(current);
  if (durationEl && duration) durationEl.textContent = formatEditorTime(duration);
  if (scrub) {
    if (duration) scrub.max = String(duration);
    if (document.activeElement !== scrub) scrub.value = String(current);
  }
  if (play) play.textContent = video.paused ? "Play" : "Pause";
  const clipId = video.dataset.editorClipId || panel?.dataset.editorClipId || "";
  if (clipId) {
    state.editor.playback = {
      clipId,
      currentTime: current,
      playing: Boolean(!video.paused && !video.ended),
      focusX: video.style.getPropertyValue("--editor-focus-x") || panel?.style.getPropertyValue("--editor-focus-x") || "50%",
      capturedAt: Date.now()
    };
  }
  applyEditorCaptionOverlay(video, current);
  syncEditorFillVideo(video);
}

function editorReframeSamplerFor(video) {
  let sampler = editorReframeSamplers.get(video);
  if (!sampler) {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 54;
    sampler = {
      canvas,
      context: canvas.getContext("2d", { willReadFrequently: true }),
      previousLuma: null,
      smoothFocus: 50,
      stableTarget: 50,
      candidateFocus: 50,
      candidateHits: 0,
      keyframes: [],
      lastKeyframeSecond: -1,
      lastKeyframeFocus: 50,
      lastSampleAt: 0,
      lastAppliedAt: 0,
      faceDetector: typeof globalThis.FaceDetector === "function"
        ? new globalThis.FaceDetector({ fastMode: true, maxDetectedFaces: 4 })
        : null,
      faceDetectionPending: false,
      lastFaceDetectionAt: 0,
      faceFocus: null,
      faceFocusExpiresAt: 0,
      raf: 0
    };
    editorReframeSamplers.set(video, sampler);
  }
  return sampler;
}

function updateEditorFaceTarget(video, sampler, nowMs) {
  if (!sampler.faceDetector || sampler.faceDetectionPending || nowMs - sampler.lastFaceDetectionAt < 700) return;
  sampler.faceDetectionPending = true;
  sampler.lastFaceDetectionAt = nowMs;
  sampler.faceDetector.detect(video)
    .then((faces) => {
      const videoArea = Math.max(1, Number(video.videoWidth || 0) * Number(video.videoHeight || 0));
      const candidates = (Array.isArray(faces) ? faces : [])
        .map((face) => face?.boundingBox)
        .filter(Boolean)
        .map((box) => ({ box, area: Number(box.width || 0) * Number(box.height || 0) }))
        .filter((entry) => entry.area / videoArea >= 0.012)
        .sort((a, b) => b.area - a.area);
      const subject = candidates[0]?.box;
      if (!subject || !video.videoWidth) return;
      const centerX = Number(subject.x || 0) + (Number(subject.width || 0) / 2);
      sampler.faceFocus = Math.min(82, Math.max(18, (centerX / video.videoWidth) * 100));
      sampler.faceFocusExpiresAt = performance.now() + 1600;
    })
    .catch(() => {
      sampler.faceDetector = null;
    })
    .finally(() => {
      sampler.faceDetectionPending = false;
    });
}

function updateEditorAutoReframe(video, force = false, options = {}) {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
  const sampler = editorReframeSamplerFor(video);
  const clipId = video.dataset.editorClipId || editorPreviewPanelFor(video)?.dataset.editorClipId || "";
  const plan = editorReframePlanForClip(builderClipById(clipId)) || {};
  const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  if ((video.paused || video.ended) && !options.allowPaused) {
    const focus = editorReframeFocusAtTime(plan, currentTime, sampler.smoothFocus);
    sampler.smoothFocus = focus;
    const focusValue = applyEditorReframeFocus(video, focus);
    const panel = editorPreviewPanelFor(video);
    const label = panel?.querySelector("[data-editor-focus-label]");
    if (label) label.textContent = `Auto reframe locked ${Math.round(clampEditorFocus(focusValue))}%${sampler.keyframes.length ? ` · ${sampler.keyframes.length} keyframes` : ""}`;
    return;
  }
  const nowMs = performance.now();
  if (!force && nowMs - sampler.lastSampleAt < 260) return;
  const elapsedMs = sampler.lastAppliedAt ? nowMs - sampler.lastAppliedAt : 260;
  sampler.lastSampleAt = nowMs;
  updateEditorFaceTarget(video, sampler, nowMs);
  const { canvas, context } = sampler;
  if (!context) return;
  try {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const columnScores = new Float32Array(canvas.width);
    const luma = new Float32Array(canvas.width * canvas.height);
    let totalScore = 0;
    let weightedX = 0;
    for (let y = 4; y < canvas.height - 4; y += 1) {
      const yCenterWeight = 1 - Math.min(0.78, Math.abs((y / canvas.height) - 0.48) * 1.15);
      for (let x = 0; x < canvas.width; x += 1) {
        const pixelIndex = (y * canvas.width + x) * 4;
        const r = frame[pixelIndex];
        const g = frame[pixelIndex + 1];
        const b = frame[pixelIndex + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const value = (r * 0.2126) + (g * 0.7152) + (b * 0.0722);
        const lumaIndex = y * canvas.width + x;
        const motion = sampler.previousLuma ? Math.abs(value - sampler.previousLuma[lumaIndex]) : 0;
        luma[lumaIndex] = value;
        const saturation = max - min;
        const contrast = Math.max(0, value - 42);
        const score = ((motion * 0.9) + (saturation * 0.2) + (contrast * 0.02)) * yCenterWeight;
        columnScores[x] += score;
      }
    }
    sampler.previousLuma = luma;
    for (let x = 0; x < columnScores.length; x += 1) {
      const edgePenalty = 1 - Math.min(0.45, Math.abs((x / (columnScores.length - 1)) - 0.5) * 0.62);
      const score = columnScores[x] * edgePenalty;
      totalScore += score;
      weightedX += score * x;
    }
    const saliencyFocus = totalScore > 80
      ? Math.min(82, Math.max(18, (weightedX / totalScore / (columnScores.length - 1)) * 100))
      : sampler.stableTarget;
    const hasFreshFace = Number.isFinite(sampler.faceFocus) && sampler.faceFocusExpiresAt > nowMs;
    const rawTarget = hasFreshFace ? sampler.faceFocus : 50 + ((saliencyFocus - 50) * 0.82);
    if (Math.abs(rawTarget - sampler.candidateFocus) <= 8) {
      sampler.candidateFocus = (sampler.candidateFocus * 0.62) + (rawTarget * 0.38);
      sampler.candidateHits += 1;
    } else {
      sampler.candidateFocus = rawTarget;
      sampler.candidateHits = 1;
    }
    if (sampler.candidateHits >= 2) {
      sampler.stableTarget = (sampler.stableTarget * 0.72) + (sampler.candidateFocus * 0.28);
    }
    const focusDelta = sampler.stableTarget - sampler.smoothFocus;
    if (Math.abs(focusDelta) > 1.5) {
      const maxStep = Math.max(0.6, Math.min(2, (elapsedMs / 1000) * 5.5));
      sampler.smoothFocus += Math.max(-maxStep, Math.min(maxStep, focusDelta * 0.32));
    }
    sampler.lastAppliedAt = nowMs;
    const focusX = Number(sampler.smoothFocus.toFixed(2));
    const panel = editorPreviewPanelFor(video);
    applyEditorReframeFocus(video, focusX);
    const timeSeconds = Number.isFinite(video.currentTime) ? Number(video.currentTime.toFixed(2)) : 0;
    const keyframeMovement = Math.abs(focusX - sampler.lastKeyframeFocus);
    if (clipId && totalScore > 80 && (force || (Math.abs(timeSeconds - sampler.lastKeyframeSecond) >= 1.1 && keyframeMovement >= 1))) {
      const confidence = Math.min(1, Math.max(0.18, totalScore / 22000));
      const existingPlan = editorReframePlanForClip(builderClipById(clipId)) || {};
      const existingKeyframes = Number(existingPlan.version || 0) >= 2
        ? (Array.isArray(existingPlan.keyframes) ? existingPlan.keyframes : sampler.keyframes)
        : stabilizeEditorReframeKeyframes(
          Array.isArray(existingPlan.keyframes) ? existingPlan.keyframes : sampler.keyframes,
          sampler.smoothFocus
        );
      const keyframes = existingKeyframes
        .filter((item) => Math.abs(Number(item.timeSeconds || 0) - timeSeconds) > 0.35)
        .concat({
          timeSeconds,
          focusX,
          focusY: 50,
          scale: 1.34,
          subjectAspectRatio: "3:4",
          confidence: Number(confidence.toFixed(3)),
          reason: hasFreshFace ? "face_subject_lock" : "stabilized_subject_saliency"
        })
        .sort((a, b) => Number(a.timeSeconds || 0) - Number(b.timeSeconds || 0))
        .slice(-160);
      sampler.keyframes = keyframes;
      sampler.lastKeyframeSecond = timeSeconds;
      sampler.lastKeyframeFocus = focusX;
      setEditorReframePlan(clipId, {
        version: 2,
        mode: "stabilized_subject_follow_3_4_inside_9_16",
        compatibilityMode: "motion_follow_3_4_inside_9_16",
        ...editorDefaultVideoLayout(),
        sourceFit: "cover_subject_3_4",
        keyframes,
        updatedAt: new Date().toISOString()
      });
      scheduleEditorDraftSave(clipId);
    }
    const label = panel?.querySelector("[data-editor-focus-label]");
    if (label) label.textContent = `Reframe ${hasFreshFace ? "subject locked" : "stabilized"}${sampler.keyframes.length ? ` · ${sampler.keyframes.length}` : ""}`;
    const count = panel?.querySelector("[data-editor-reframe-count]");
    if (count) count.textContent = `${sampler.keyframes.length} keyframes`;
  } catch {
    const panel = editorPreviewPanelFor(video);
    const label = panel?.querySelector("[data-editor-focus-label]");
    if (label) label.textContent = "Auto reframe unavailable";
  }
}

function startEditorAutoReframeLoop(video) {
  const sampler = editorReframeSamplerFor(video);
  if (sampler.raf) return;
  const tick = () => {
    if (!video.isConnected || video.paused || video.ended) {
      sampler.raf = 0;
      return;
    }
    updateEditorAutoReframe(video);
    updateEditorTransport(video);
    sampler.raf = requestAnimationFrame(tick);
  };
  sampler.raf = requestAnimationFrame(tick);
}

function setupEditorVideoPreviews() {
  document.querySelectorAll("[data-editor-video]").forEach((video) => {
    if (video.dataset.editorBound === "true") {
      updateEditorTransport(video);
      return;
    }
    video.dataset.editorBound = "true";
    video.style.setProperty("--editor-focus-x", "50%");
    const savedPlan = editorReframePlanForClip(builderClipById(video.dataset.editorClipId || ""));
    if (Array.isArray(savedPlan?.keyframes) && savedPlan.keyframes.length) {
      const sampler = editorReframeSamplerFor(video);
      sampler.keyframes = Number(savedPlan.version || 0) >= 2
        ? savedPlan.keyframes
        : stabilizeEditorReframeKeyframes(savedPlan.keyframes, 50);
      sampler.lastKeyframeSecond = Number(sampler.keyframes.at(-1)?.timeSeconds || -1);
      sampler.lastKeyframeFocus = Number(sampler.keyframes.at(-1)?.focusX || 50);
      const restoreTime = state.editor.playback?.clipId === video.dataset.editorClipId
        ? Number(state.editor.playback.currentTime || 0)
        : Number(video.currentTime || 0);
      const focus = editorReframeFocusAtTime(savedPlan, restoreTime, 50);
      sampler.smoothFocus = focus;
      sampler.stableTarget = focus;
      sampler.candidateFocus = focus;
      applyEditorReframeFocus(video, focus);
    }
    video.addEventListener("loadedmetadata", () => {
      updateEditorTransport(video);
      const plan = editorReframePlanForClip(builderClipById(video.dataset.editorClipId || "")) || {};
      const focus = editorReframeFocusAtTime(plan, video.currentTime || 0, editorReframeSamplerFor(video).smoothFocus);
      editorReframeSamplerFor(video).smoothFocus = focus;
      applyEditorReframeFocus(video, focus);
    });
    video.addEventListener("timeupdate", () => {
      updateEditorTransport(video);
      if (!video.paused && !video.ended) updateEditorAutoReframe(video);
      else {
        const plan = editorReframePlanForClip(builderClipById(video.dataset.editorClipId || "")) || {};
        applyEditorReframeFocus(video, editorReframeFocusAtTime(plan, video.currentTime || 0, editorReframeSamplerFor(video).smoothFocus));
      }
    });
    video.addEventListener("play", () => {
      editorReframeSamplerFor(video).previousLuma = null;
      updateEditorTransport(video);
      startEditorAutoReframeLoop(video);
    });
    video.addEventListener("pause", () => {
      updateEditorTransport(video);
      flushEditorDraftSave(video.dataset.editorClipId || "");
    });
    video.addEventListener("ended", () => {
      updateEditorTransport(video);
      flushEditorDraftSave(video.dataset.editorClipId || "");
    });
    updateEditorTransport(video);
  });
}

async function precomputeEditorReframe(clipId = "") {
  const clip = builderClipById(clipId);
  const playback = clip ? clipPlaybackUrl(clip) : "";
  if (!clip || !playback) return { ok: false, detail: "Playable MP4 is required for auto reframe." };

  const video = document.createElement("video");
  video.dataset.editorClipId = clipId;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.style.position = "fixed";
  video.style.left = "-2px";
  video.style.top = "-2px";
  video.style.width = "2px";
  video.style.height = "2px";
  video.style.opacity = "0.01";
  video.style.pointerEvents = "none";
  video.setAttribute("aria-hidden", "true");
  document.body.appendChild(video);

  let raf = 0;
  let finished = false;
  const finish = (result) => {
    if (finished) return;
    finished = true;
    if (raf) cancelAnimationFrame(raf);
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    return result;
  };

  try {
    video.src = playback;
    await new Promise((resolve) => {
      if (video.readyState >= 2 && video.videoWidth) return resolve();
      const done = () => {
        video.removeEventListener("loadeddata", done);
        video.removeEventListener("canplay", done);
        video.removeEventListener("error", done);
        resolve();
      };
      video.addEventListener("loadeddata", done, { once: true });
      video.addEventListener("canplay", done, { once: true });
      video.addEventListener("error", done, { once: true });
      window.setTimeout(done, 12000);
    });
    if (!video.videoWidth || !video.duration) return finish({ ok: false, detail: "The MP4 could not be decoded for reframe analysis." });

    const duration = Number(video.duration || editorClipDuration(clip));
    const sampler = editorReframeSamplerFor(video);
    const tick = () => {
      if (finished) return;
      updateEditorAutoReframe(video);
      const progress = 70 + Math.min(20, (Number(video.currentTime || 0) / Math.max(1, duration)) * 20);
      setEditorPreparation({
        progress,
        message: `Mapping the moving subject · ${formatEditorTime(video.currentTime)} / ${formatEditorTime(duration)}`
      }, { render: false });
      raf = requestAnimationFrame(tick);
    };
    const timeout = Math.min(65000, Math.max(10000, (duration * 1000) + 4000));
    const result = await new Promise((resolve) => {
      let timer = window.setTimeout(() => resolve(finish({ ok: true, keyframeCount: sampler.keyframes.length })), timeout);
      const complete = (value) => {
        window.clearTimeout(timer);
        resolve(finish(value));
      };
      video.addEventListener("ended", () => complete({ ok: true, keyframeCount: sampler.keyframes.length }), { once: true });
      video.addEventListener("error", () => complete({ ok: false, detail: "Reframe analysis stopped because the MP4 could not be read." }), { once: true });
      raf = requestAnimationFrame(tick);
      video.play().catch(() => complete({ ok: false, detail: "The MP4 could not start for reframe analysis." }));
    });
    return result;
  } catch (error) {
    return finish({ ok: false, detail: error.message || "Auto reframe analysis failed." });
  }
}

function applyEditorStickerOverlay(panel, sticker) {
  if (!panel) return;
  const overlay = panel.querySelector("[data-editor-sticker-overlay]");
  if (!overlay) return;
  const clipId = panel.dataset.editorClipId || "";
  const previewUrl = clipId ? (state.editor.stickerPreviews[clipId] || sticker.previewDataUrl || "") : (sticker.previewDataUrl || "");
  overlay.style.setProperty("--sticker-x", `${sticker.xPercent}%`);
  overlay.style.setProperty("--sticker-y", `${sticker.yPercent}%`);
  overlay.style.setProperty("--sticker-size", `${sticker.sizePercent}%`);
  overlay.classList.toggle("is-disabled", !sticker.enabled);
  overlay.classList.toggle("image", sticker.type === "image");
  overlay.classList.toggle("text", sticker.type !== "image");
  overlay.classList.toggle("is-loading", sticker.type === "image" && !previewUrl);
  if (sticker.type === "image") {
    if (previewUrl) {
      let image = overlay.querySelector("img");
      if (!image) {
        overlay.innerHTML = "<img alt=\"\">";
        image = overlay.querySelector("img");
      }
      if (image) {
        image.src = previewUrl;
        image.alt = sticker.assetName || sticker.label || "Sticker";
      }
    } else {
      overlay.innerHTML = "";
    }
  } else {
    let text = overlay.querySelector("span");
    if (!text) {
      overlay.innerHTML = "<span></span>";
      text = overlay.querySelector("span");
    }
    if (text) text.textContent = sticker.label || "Sticker";
  }
}

function applyEditorCaptionOverlay(panelOrVideo, timeSeconds = null) {
  const panel = panelOrVideo?.matches?.("[data-editor-clip-id]")
    ? panelOrVideo
    : editorPreviewPanelFor(panelOrVideo);
  if (!panel) return;
  const clip = builderClipById(panel.dataset.editorClipId || "");
  const overlay = panel.querySelector("[data-editor-caption-overlay]");
  if (!clip || !overlay) return;
  const video = panel.querySelector("[data-editor-video]");
  const time = timeSeconds == null ? Number(video?.currentTime || 0) : Number(timeSeconds || 0);
  const captions = editorCaptionsForClip(clip);
  const active = editorCaptionAtTime(captions, time) || ((video?.paused || video?.ended || time <= 0.25) && captions.enabled ? captions.segments[0] : null);
  const style = captions.style || editorDefaultCaptions().style;
  overlay.style.setProperty("--caption-x", `${style.xPercent}%`);
  overlay.style.setProperty("--caption-y", `${style.yPercent}%`);
  overlay.classList.remove("theme-story", "theme-reaction", "theme-gaming");
  overlay.classList.add(`theme-${style.theme || "story"}`);
  overlay.classList.toggle("is-empty", !active);
  overlay.innerHTML = active ? `<span>${esc(active.text)}</span>` : "";
}

function cacheEditorStickerSourceResult(sourcePath = "", result = null) {
  const key = String(sourcePath || "").trim();
  if (!key || !result?.dataUrl) return null;
  const request = Promise.resolve(result);
  editorStickerSourceCache.delete(key);
  editorStickerSourceCache.set(key, request);
  while (editorStickerSourceCache.size > EDITOR_STICKER_SOURCE_CACHE_LIMIT) {
    editorStickerSourceCache.delete(editorStickerSourceCache.keys().next().value);
  }
  return request;
}

function readCachedEditorStickerSource(sourcePath = "") {
  const key = String(sourcePath || "").trim();
  if (!key || !window.argentumDesktop?.readImageFile) return Promise.resolve(null);
  const cached = editorStickerSourceCache.get(key);
  if (cached) {
    editorStickerSourceCache.delete(key);
    editorStickerSourceCache.set(key, cached);
    return cached;
  }
  const request = window.argentumDesktop.readImageFile(key)
    .then((result) => result?.dataUrl ? result : null)
    .catch(() => null);
  editorStickerSourceCache.set(key, request);
  while (editorStickerSourceCache.size > EDITOR_STICKER_SOURCE_CACHE_LIMIT) {
    editorStickerSourceCache.delete(editorStickerSourceCache.keys().next().value);
  }
  request.then((result) => {
    if (!result && editorStickerSourceCache.get(key) === request) editorStickerSourceCache.delete(key);
  });
  return request;
}

function releaseHydratedEditorStickerPreviewsExcept(clipId = "") {
  [...hydratedEditorStickerPreviewClipIds].forEach((cachedClipId) => {
    if (cachedClipId === clipId) return;
    delete state.editor.stickerPreviews[cachedClipId];
    hydratedEditorStickerPreviewClipIds.delete(cachedClipId);
  });
}

async function hydrateEditorStickerImages() {
  if (isAutomationWorker) return;
  if (state.activeView !== "studio") {
    releaseHydratedEditorStickerPreviewsExcept("");
    return;
  }
  if (!window.argentumDesktop?.readImageFile) return;
  const panel = document.querySelector(".argentum-editor-panel[data-editor-clip-id]");
  const clipId = panel?.dataset?.editorClipId || "";
  const clip = selectedBuilderClip();
  if (!panel?.isConnected || !clipId || clip?.id !== clipId) return;
  releaseHydratedEditorStickerPreviewsExcept(clipId);
  const sticker = editorStickerForClip(clip);
  if (!sticker.enabled || sticker.type !== "image") return;
  if (state.editor.stickerPreviews[clipId] || sticker.previewDataUrl || !sticker.sourcePath) return;
  const result = await readCachedEditorStickerSource(sticker.sourcePath);
  const activePanel = document.querySelector(".argentum-editor-panel[data-editor-clip-id]");
  if (
    !result?.dataUrl
    || state.activeView !== "studio"
    || activePanel?.dataset?.editorClipId !== clipId
    || selectedBuilderClip()?.id !== clipId
  ) return;
  state.editor.stickerPreviews[clipId] = result.dataUrl;
  hydratedEditorStickerPreviewClipIds.add(clipId);
  const previewDataUrl = persistableEditorStickerPreview(result.dataUrl);
  if (previewDataUrl) {
    setEditorSticker(clipId, {
      ...sticker,
      previewDataUrl,
      assetName: sticker.assetName || result.name || "",
      label: sticker.label || result.name || "Sticker"
    });
    scheduleEditorDraftSave(clipId);
  }
  applyEditorStickerOverlay(activePanel, { ...sticker, previewDataUrl });
  state.editor.lastRenderSignature = editorRenderSignature();
}

async function pickEditorSticker(clipId = "") {
  if (!clipId) return;
  if (window.argentumDesktop?.chooseFile) {
    const picked = await window.argentumDesktop.chooseFile({
      title: "Choose sticker image",
      filters: [{ name: "Sticker images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }]
    }).catch(() => null);
    if (picked?.path || picked?.dataUrl) {
      hydratedEditorStickerPreviewClipIds.delete(clipId);
      if (picked.path && picked.dataUrl) {
        cacheEditorStickerSourceResult(picked.path, picked);
        hydratedEditorStickerPreviewClipIds.add(clipId);
      }
      if (picked.dataUrl) state.editor.stickerPreviews[clipId] = picked.dataUrl;
      const previewDataUrl = persistableEditorStickerPreview(picked.dataUrl || "");
      const current = editorStickerForClip(builderClipById(clipId));
      setEditorSticker(clipId, {
        ...current,
        enabled: true,
        type: "image",
        label: picked.name || current.label || "Sticker",
        assetName: picked.name || "",
        sourcePath: picked.path || "",
        previewDataUrl
      });
      scheduleEditorDraftSave(clipId);
      renderClipsArea();
      renderStatus("Sticker added to editor draft");
      return;
    }
  }
  [...document.querySelectorAll("[data-editor-sticker-upload]")]
    .find((input) => input.dataset.editorStickerUpload === clipId)
    ?.click();
}

async function readEditorStickerFile(input) {
  const clipId = input?.dataset?.editorStickerUpload || "";
  const file = input?.files?.[0];
  if (!clipId || !file) return;
  if (file.size > 8 * 1024 * 1024) {
    renderStatus("Sticker is too large. Use an image under 8 MB.");
    return;
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read sticker"));
    reader.readAsDataURL(file);
  }).catch((error) => {
    renderStatus(error.message || "Could not read sticker");
    return "";
  });
  if (!dataUrl) return;
  hydratedEditorStickerPreviewClipIds.delete(clipId);
  if (file.path) {
    cacheEditorStickerSourceResult(file.path, { dataUrl, name: file.name || "Sticker" });
    hydratedEditorStickerPreviewClipIds.add(clipId);
  }
  state.editor.stickerPreviews[clipId] = dataUrl;
  const previewDataUrl = persistableEditorStickerPreview(dataUrl);
  const current = editorStickerForClip(builderClipById(clipId));
  setEditorSticker(clipId, {
    ...current,
    enabled: true,
    type: "image",
    label: file.name || "Sticker",
    assetName: file.name || "",
    sourcePath: file.path || "",
    previewDataUrl
  });
  scheduleEditorDraftSave(clipId);
  renderClipsArea();
  renderStatus("Sticker added to editor draft");
}

function updateEditorStickerFromControl(input) {
  const clipId = input?.dataset?.editorStickerClip || editorPreviewPanelFor(input)?.dataset.editorClipId || "";
  const field = input?.dataset?.editorStickerField || "";
  if (!clipId || !field) return;
  const clip = builderClipById(clipId);
  const current = editorStickerForClip(clip);
  const next = { ...current, enabled: true };
  if (field === "label") {
    next.type = "text";
    next.label = cleanEditorText(input.value || "Sticker") || "Sticker";
    next.assetName = "";
    next.sourcePath = "";
    delete state.editor.stickerPreviews[clipId];
    hydratedEditorStickerPreviewClipIds.delete(clipId);
  } else {
    next[field] = Number(input.value || current[field] || 0);
    const output = input.closest("label")?.querySelector(`[data-editor-sticker-value="${field}"]`);
    if (output) output.textContent = editorStickerSliderValue(field, next[field]);
  }
  setEditorSticker(clipId, next);
  applyEditorStickerOverlay(editorPreviewPanelFor(input), normalizeEditorSticker(next));
  const summary = input.closest(".editor-sticker-card")?.querySelector("[data-editor-sticker-summary]");
  if (summary) {
    summary.textContent = `X ${editorStickerSliderValue("xPercent", next.xPercent)} · Y ${editorStickerSliderValue("yPercent", next.yPercent)} · Size ${editorStickerSliderValue("sizePercent", next.sizePercent)}`;
  }
  state.editor.lastRenderSignature = editorRenderSignature();
  scheduleEditorDraftSave(clipId);
}

function clearEditorSticker(clipId = "") {
  if (!clipId) return;
  delete state.editor.stickerPreviews[clipId];
  hydratedEditorStickerPreviewClipIds.delete(clipId);
  setEditorSticker(clipId, { ...editorDefaultSticker(), enabled: false });
  scheduleEditorDraftSave(clipId);
  renderClipsArea();
  renderStatus("Sticker removed from editor draft");
}

function editorExportFileBase(clip = {}) {
  const name = String(clip.title || editorAssetName(clip) || "argentum-edited-clip")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return name || "argentum-edited-clip";
}

function bestEditorExportMimeType() {
  const candidates = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4"
  ];
  return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || "";
}

function waitForEditorVideoReady(video) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      resolve();
      return;
    }
    const cleanup = () => {
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("error", onError);
    };
    const onReady = () => {
      if (video.readyState < 1) return;
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Could not load the source video for edited export."));
    };
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("error", onError);
  });
}

function loadEditorImage(src = "") {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

async function loadEditorStickerImageForExport(clipId = "", sticker = editorDefaultSticker()) {
  const inlineSource = state.editor.stickerPreviews[clipId] || sticker.previewDataUrl || "";
  const inlineImage = await loadEditorImage(inlineSource);
  if (inlineImage || sticker.type !== "image" || !sticker.sourcePath) return inlineImage;
  const sourceResult = await readCachedEditorStickerSource(sticker.sourcePath);
  return loadEditorImage(sourceResult?.dataUrl || "");
}

function editorCoverSourceRect(sourceWidth, sourceHeight, targetWidth, targetHeight, focusX = 50, focusY = 50) {
  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = targetWidth / targetHeight;
  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;
  if (sourceAspect > targetAspect) {
    cropWidth = sourceHeight * targetAspect;
  } else {
    cropHeight = sourceWidth / targetAspect;
  }
  const xRatio = Math.min(1, Math.max(0, Number(focusX || 50) / 100));
  const yRatio = Math.min(1, Math.max(0, Number(focusY || 50) / 100));
  const sx = Math.min(sourceWidth - cropWidth, Math.max(0, (sourceWidth - cropWidth) * xRatio));
  const sy = Math.min(sourceHeight - cropHeight, Math.max(0, (sourceHeight - cropHeight) * yRatio));
  return { sx, sy, sw: cropWidth, sh: cropHeight };
}

function drawEditorVideoCover(ctx, video, dx, dy, dw, dh, focusX = 50, focusY = 50) {
  const sourceWidth = video.videoWidth || 1;
  const sourceHeight = video.videoHeight || 1;
  const rect = editorCoverSourceRect(sourceWidth, sourceHeight, dw, dh, focusX, focusY);
  ctx.drawImage(video, rect.sx, rect.sy, rect.sw, rect.sh, dx, dy, dw, dh);
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
  ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
  ctx.arcTo(x, y + height, x, y, safeRadius);
  ctx.arcTo(x, y, x + width, y, safeRadius);
  ctx.closePath();
}

function drawEditorCaption(ctx, text = "", canvasWidth = 1080, canvasHeight = 1920, style = {}) {
  const value = captionTextClean(text);
  if (!value) return;
  const theme = style.theme || "story";
  const maxWidth = canvasWidth * 0.86;
  const fontSize = theme === "gaming" ? 70 : 62;
  ctx.save();
  ctx.font = `800 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const words = value.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth - 88) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  const lineHeight = fontSize * 1.08;
  const textWidth = Math.max(...lines.map((item) => ctx.measureText(item).width));
  // Keep the white card fitted to the headline while preserving a stable max width.
  const boxWidth = Math.min(maxWidth, textWidth + 88);
  const boxHeight = (lines.length * lineHeight) + 52;
  const x = canvasWidth / 2;
  const y = canvasHeight * (Number(style.yPercent ?? (theme === "gaming" ? 68 : 24)) / 100);
  drawRoundedRect(ctx, x - (boxWidth / 2), y - (boxHeight / 2), boxWidth, boxHeight, 22);
  // Keep the rendered caption identical to the light TikTok-style preview.
  ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
  ctx.fill();
  ctx.fillStyle = "#050505";
  lines.forEach((item, index) => {
    const lineY = y - ((lines.length - 1) * lineHeight / 2) + (index * lineHeight);
    ctx.fillText(item, x, lineY);
  });
  ctx.restore();
}

function drawEditorSticker(ctx, sticker = editorDefaultSticker(), image = null, canvasWidth = 1080, canvasHeight = 1920) {
  if (!sticker.enabled) return;
  const x = (Number(sticker.xPercent || 50) / 100) * canvasWidth;
  const y = (Number(sticker.yPercent || 84) / 100) * canvasHeight;
  const width = (Number(sticker.sizePercent || 24) / 100) * canvasWidth;
  ctx.save();
  if (sticker.type === "image" && image) {
    const ratio = image.naturalHeight && image.naturalWidth ? image.naturalHeight / image.naturalWidth : 1;
    const height = width * ratio;
    ctx.shadowColor = "rgba(0, 0, 0, 0.36)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 12;
    ctx.drawImage(image, x - (width / 2), y - (height / 2), width, height);
  } else {
    const label = cleanEditorText(sticker.label || "Sticker");
    ctx.font = "900 72px Inter, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const metrics = ctx.measureText(label);
    const boxWidth = Math.max(width, metrics.width + 72);
    const boxHeight = 102;
    drawRoundedRect(ctx, x - (boxWidth / 2), y - (boxHeight / 2), boxWidth, boxHeight, 44);
    ctx.fillStyle = "#f8fafc";
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = "#020617";
    ctx.stroke();
    ctx.fillStyle = "#020617";
    ctx.fillText(label, x, y + 2);
  }
  ctx.restore();
}

function downloadEditorBlob(blob, fileName = "argentum-edited-clip.webm") {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function stopEditorMediaStream(stream = null) {
  stream?.getTracks?.().forEach((track) => {
    try {
      track.stop();
    } catch {}
  });
}

async function exportEditedClip(clipId = "") {
  const clip = builderClipById(clipId);
  const playback = clip ? clipPlaybackUrl(clip) : "";
  if (!clip || !playback) {
    const message = "No playable clip loaded for edited export";
    renderStatus(message);
    if (isAutomationWorker) throw new Error(message);
    return null;
  }
  if (!window.MediaRecorder) {
    const message = "Edited export needs MediaRecorder support in Electron";
    renderStatus(message);
    if (isAutomationWorker) throw new Error(message);
    return null;
  }
  const preflight = editorPrecheckForClip(clip);
  if (!preflight.ready) {
    const message = `Precheck blocked. Finish: ${preflight.missing.join(", ")}.`;
    renderStatus(message);
    if (isAutomationWorker) throw new Error(message);
    return null;
  }

  clearTimeout(state.editor.draftSaveTimers[clipId]);
  delete state.editor.draftSaveTimers[clipId];
  state.editor.exportingClipId = clipId;
  state.editor.compileProgress = { clipId, percent: 2, stage: "Preparing project", detail: "Saving the latest edit settings before rendering." };
  state.editor.lastRenderSignature = "";
  renderClipsArea({ force: true });
  renderStatus("Compiling the edited clip for Precheck...");

  const sourceVideo = document.createElement("video");
  sourceVideo.crossOrigin = "anonymous";
  sourceVideo.preload = "auto";
  sourceVideo.playsInline = true;
  sourceVideo.muted = false;
  sourceVideo.src = playback;

  let canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  let ctx = canvas.getContext("2d");
  const mimeType = bestEditorExportMimeType();
  const chunks = [];
  let recorder = null;
  let renderStream = null;
  let sourceAudioStream = null;
  let canvasVideoTrack = null;
  let stickerImage = null;
  let renderedBlob = null;
  let renderedExtension = "webm";
  let queuedCandidate = null;
  try {
    setEditorCompileProgress(clipId, 4, "Saving project", "Locking captions, sticker placement, and reframe points.");
    const savedDraft = await saveEditorDraft(clipId, preflight.editorState, { throwOnError: true });
    if (!savedDraft?.candidate) throw new Error("The editor draft could not be saved before rendering.");
    setEditorCompileProgress(clipId, 8, "Loading source video", "Preparing the source video and audio tracks.");
    await waitForEditorVideoReady(sourceVideo);
    const duration = Math.min(editorClipDuration(clip), Number.isFinite(sourceVideo.duration) && sourceVideo.duration > 0 ? sourceVideo.duration : editorClipDuration(clip));
    // Hidden Electron windows can suspend captureStream's automatic frame
    // cadence. Request each rendered frame explicitly so background exports
    // contain the same video frames shown by the editor progress.
    renderStream = canvas.captureStream(0);
    canvasVideoTrack = renderStream.getVideoTracks()[0];
    sourceAudioStream = sourceVideo.captureStream?.() || null;
    sourceAudioStream?.getAudioTracks?.().forEach((track) => renderStream.addTrack(track));
    recorder = new MediaRecorder(renderStream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 4_000_000,
      audioBitsPerSecond: 128_000
    });
    let failRenderLoop = null;
    let recorderRenderingComplete = false;
    const recorderCompletion = new Promise((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunks.push(event.data);
      };
      recorder.onstop = resolve;
      recorder.onerror = (event) => {
        const error = event?.error instanceof Error
          ? event.error
          : new Error(event?.error?.message || "Edited export recorder failed");
        failRenderLoop?.(error);
        reject(error);
      };
    });
    const recorderFailure = recorderCompletion.then(
      () => {
        if (recorderRenderingComplete) return;
        const error = new Error("Edited export recorder stopped before video rendering completed.");
        failRenderLoop?.(error);
        throw error;
      },
      (error) => {
        failRenderLoop?.(error);
        throw error;
      }
    );
    // Attach a rejection observer immediately because recorder startup happens
    // before the canvas loop is constructed.
    recorderFailure.catch(() => {});

    const sticker = editorStickerForClip(clip);
    stickerImage = await loadEditorStickerImageForExport(clipId, sticker);
    const captions = editorCaptionsForClip(clip);
    const reframePlan = editorReframePlanForClip(clip) || {};
    sourceVideo.currentTime = 0;
    await new Promise((resolve) => {
      if (sourceVideo.readyState >= 2) resolve();
      else sourceVideo.addEventListener("canplay", resolve, { once: true });
    });
    recorder.start(500);
    await Promise.race([sourceVideo.play(), recorderFailure]);
    setEditorCompileProgress(clipId, 10, "Rendering video", `Rendering 0:00 of ${formatSeconds(duration)}.`);

    const renderLoop = new Promise((resolve, reject) => {
      let lastReportedPercent = -1;
      let lastPlaybackTime = -1;
      let lastPlaybackAdvanceAt = Date.now();
      let settled = false;
      let fallbackFrameHandle = null;
      let watchdogHandle = null;
      const cleanup = () => {
        if (fallbackFrameHandle !== null) window.clearTimeout(fallbackFrameHandle);
        if (watchdogHandle !== null) window.clearInterval(watchdogHandle);
        sourceVideo.removeEventListener("ended", finishRender);
      };
      const settle = (callback) => {
        if (settled) return;
        settled = true;
        try {
          cleanup();
        } finally {
          callback();
        }
      };
      const failRender = (error) => settle(() => reject(
        error instanceof Error ? error : new Error(String(error || "Edited export rendering failed"))
      ));
      failRenderLoop = failRender;
      const reportPlayback = () => {
        const time = Number(sourceVideo.currentTime || 0);
        if (time > lastPlaybackTime + 0.04) {
          lastPlaybackTime = time;
          lastPlaybackAdvanceAt = Date.now();
        }
        const renderPercent = Math.min(80, 10 + ((time / Math.max(duration, 0.1)) * 70));
        if (Math.floor(renderPercent) !== lastReportedPercent) {
          lastReportedPercent = Math.floor(renderPercent);
          setEditorCompileProgress(clipId, renderPercent, "Rendering video", `Rendering ${formatSeconds(time)} of ${formatSeconds(duration)}.`);
        }
        return time;
      };
      const finishRender = () => settle(resolve);
      const scheduleDraw = () => {
        if (settled) return;
        // Chromium can stop video-frame callbacks in an offscreen Electron
        // window even when playback continues. A fixed clock keeps hidden
        // production renders emitting every canvas frame.
        fallbackFrameHandle = window.setTimeout(draw, 1000 / 30);
      };
      const draw = () => {
        if (settled) return;
        try {
          const time = reportPlayback();
          const focusX = editorReframeFocusAtTime(reframePlan, time, 50);
          ctx.save();
          ctx.fillStyle = "#020617";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.filter = "blur(38px) saturate(1.08)";
          ctx.globalAlpha = 0.84;
          drawEditorVideoCover(ctx, sourceVideo, -54, -96, canvas.width + 108, canvas.height + 192, focusX, 50);
          ctx.restore();
          const subjectHeight = 1440;
          const subjectY = (canvas.height - subjectHeight) / 2;
          drawEditorVideoCover(ctx, sourceVideo, 0, subjectY, canvas.width, subjectHeight, focusX, 50);
          drawEditorSticker(ctx, sticker, stickerImage, canvas.width, canvas.height);
          const activeCaption = editorCaptionAtTime(captions, time);
          if (activeCaption) drawEditorCaption(ctx, activeCaption.text, canvas.width, canvas.height, captions.style);
          canvasVideoTrack?.requestFrame?.();
          if (time >= duration || sourceVideo.ended) {
            finishRender();
            return;
          }
          scheduleDraw();
        } catch (error) {
          failRender(error);
        }
      };
      sourceVideo.addEventListener("ended", finishRender, { once: true });
      watchdogHandle = window.setInterval(() => {
        try {
          const time = reportPlayback();
          if (time >= duration || sourceVideo.ended) {
            finishRender();
            return;
          }
          if (Date.now() - lastPlaybackAdvanceAt > 30000) {
            failRender(new Error("Edited export stopped because source playback did not advance for 30 seconds."));
          }
        } catch (error) {
          failRender(error);
        }
      }, 1000);
      draw();
    });

    await Promise.race([renderLoop, recorderFailure]);
    recorderRenderingComplete = true;
    failRenderLoop = null;

    if (recorder.state === "recording") recorder.requestData();
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    if (recorder.state !== "inactive") recorder.stop();
    await recorderCompletion;
    sourceVideo.pause();
    stopEditorMediaStream(renderStream);
    stopEditorMediaStream(sourceAudioStream);
    setEditorCompileProgress(clipId, 84, "Finalizing render", "Packaging the rendered frames and audio into a video file.");
    const outputMime = recorder.mimeType || mimeType || "video/webm";
    const extension = outputMime.includes("mp4") ? "mp4" : "webm";
    const blob = new Blob(chunks, { type: outputMime });
    if (!blob.size) throw new Error("Edited export produced an empty file.");
    renderedBlob = blob;
    renderedExtension = extension;
    setEditorCompileProgress(clipId, 88, "Uploading for Precheck", "Sending the completed render to the local verification engine.");
    renderStatus("Render complete. Verifying the standardized MP4...");
    const formData = new FormData();
    formData.append("file", blob, `${editorExportFileBase(clip)}-edited.${extension}`);
    formData.append("editorState", JSON.stringify(preflight.editorState));
    setEditorCompileProgress(clipId, 92, "Standardizing MP4", "Converting to 1080x1920 and checking video, audio, duration, and file integrity.");
    const queued = await apiFormData(`/api/clips/candidates/${encodeURIComponent(clipId)}/editor-export`, formData, { timeoutMs: 300000 });
    if (!queued?.candidate || !queued?.readiness?.ready) {
      throw new Error("The render did not pass every server Precheck.");
    }
    replaceClipInState(queued.candidate);
    queuedCandidate = queued.candidate;
    state.editor.selectedBuilderClipId = "";
    localStorage.removeItem("argentumEditorSelectedBuilderClipId");
    setEditorCompileProgress(clipId, 100, "Moved to Precheck", "All technical checks passed. The video is ready for your approval.");
    renderStatus("All technical checks passed. The video is waiting in Precheck.");
    await new Promise((resolve) => window.setTimeout(resolve, 900));
  } catch (error) {
    if (renderedBlob?.size && !isAutomationWorker) {
      downloadEditorBlob(renderedBlob, `${editorExportFileBase(clip)}-precheck-backup.${renderedExtension}`);
      renderStatus(`${error.message || "Precheck failed"} A local render backup was downloaded.`);
    } else {
      renderStatus(error.message || "Edited export failed");
    }
    if (isAutomationWorker) throw error;
  } finally {
    try {
      sourceVideo.pause();
    } catch {}
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {}
    }
    stopEditorMediaStream(renderStream);
    stopEditorMediaStream(sourceAudioStream);
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
    }
    chunks.length = 0;
    renderedBlob = null;
    stickerImage = null;
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
    ctx = null;
    canvasVideoTrack = null;
    renderStream = null;
    sourceAudioStream = null;
    recorder = null;
    canvas = null;
    sourceVideo.removeAttribute("src");
    sourceVideo.srcObject = null;
    sourceVideo.load();
    state.editor.exportingClipId = "";
    state.editor.compileProgress = null;
    state.editor.lastRenderSignature = "";
    renderClipsArea({ force: true });
  }
  return queuedCandidate;
}

function readVideoDurationFromObjectUrl(url = "") {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      video.removeAttribute("src");
      video.load();
      resolve(value);
    };
    window.setTimeout(() => finish(30), 1800);
    video.preload = "metadata";
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 30);
    video.onerror = () => finish(30);
    video.src = url;
  });
}

async function loadEditorVideoFile(file, input = null) {
  if (!file) return;
  if (!file.type.startsWith("video/") && !/\.(mp4|mov|webm|m4v)$/i.test(file.name || "")) {
    renderStatus("Choose a video file for the editor");
    return;
  }
  state.editor.uploadingSource = true;
  state.editor.lastRenderSignature = "";
  renderClipsArea({ force: true });
  renderStatus(`Uploading and verifying ${file.name || "video"}...`);
  try {
    const formData = new FormData();
    formData.append("file", file, file.name || "editor-upload.mp4");
    formData.append("title", file.name || "Uploaded editor clip");
    formData.append("permissionStatus", "uploaded");
    formData.append("rightsStatus", "operator_review_required");
    const result = await apiFormData("/api/media/sources/upload", formData, { timeoutMs: 300000 });
    if (!result?.candidate?.id) throw new Error("The upload completed without a clip candidate.");
    replaceClipInState(result.candidate);
    state.editor.selectedBuilderClipId = result.candidate.id;
    localStorage.setItem("argentumEditorSelectedBuilderClipId", result.candidate.id);
    renderStatus("Upload verified. Preparing captions, frames, and auto reframe...");
    await approveClipForBuilder(result.candidate.id);
  } catch (error) {
    renderStatus(error.message || "The editor upload could not be verified");
  } finally {
    state.editor.uploadingSource = false;
    state.editor.lastRenderSignature = "";
    if (input) input.value = "";
    renderClipsArea({ force: true });
  }
}

async function loadEditorUploadedClip(input) {
  return loadEditorVideoFile(input?.files?.[0], input);
}

async function updateProductReadyStatus(clipId = "", action = "", options = {}) {
  if (!clipId || !["approve", "changes"].includes(action)) return null;
  let updatedCandidate = null;
  state.editor.productionBusyClipId = clipId;
  state.editor.lastRenderSignature = "";
  renderClipsArea({ force: true });
  renderStatus(action === "approve" ? "Confirming every Product Ready check..." : "Returning the clip to the editor...");
  try {
    const result = await api(`/api/clips/candidates/${encodeURIComponent(clipId)}/product-ready`, {
      method: "POST",
      body: JSON.stringify({ action, approvedBy: options.approvedBy || "operator" }),
      timeoutMs: 60000
    });
    if (!result?.candidate) throw new Error("The production status did not update.");
    replaceClipInState(result.candidate);
    updatedCandidate = result.candidate;
    if (action === "changes") {
      state.editor.selectedBuilderClipId = clipId;
      localStorage.setItem("argentumEditorSelectedBuilderClipId", clipId);
      setAppView("studio");
      renderStatus("Clip returned to Argentum Editor for changes");
    } else {
      renderStatus("Approved. The video is now Product Ready and remains unposted.");
    }
  } catch (error) {
    renderStatus(error.message || "The Product Ready decision could not be saved");
  } finally {
    state.editor.productionBusyClipId = "";
    state.editor.lastRenderSignature = "";
    renderClipsArea({ force: true });
  }
  return updatedCandidate;
}

async function loadClipOutputFolder() {
  if (!window.argentumDesktop?.getClipOutputFolder) return state.settings.outputFolder;
  const result = await window.argentumDesktop.getClipOutputFolder().catch(() => null);
  state.settings.outputFolder = result?.configured
    ? { configured: true, path: String(result.path || ""), name: String(result.name || "Finished clips") }
    : { configured: false, path: "", name: "" };
  state.editor.lastRenderSignature = "";
  renderClipsArea({ force: true });
  return state.settings.outputFolder;
}

async function chooseClipOutputFolder() {
  if (!window.argentumDesktop?.chooseClipOutputFolder) {
    renderStatus("Choose the finished clips folder from the Electron app");
    return null;
  }
  const result = await window.argentumDesktop.chooseClipOutputFolder().catch((error) => {
    renderStatus(error.message || "Could not choose the finished clips folder");
    return null;
  });
  if (!result?.configured) return null;
  state.settings.outputFolder = { configured: true, path: String(result.path || ""), name: String(result.name || "Finished clips") };
  state.editor.lastRenderSignature = "";
  renderClipsArea({ force: true });
  renderStatus(`Finished clips will save to ${state.settings.outputFolder.name}`);
  scheduleAutomaticPipeline(100);
  return state.settings.outputFolder;
}

async function openClipOutputFolder() {
  const folderPath = state.settings.outputFolder?.path || "";
  if (!folderPath || !window.argentumDesktop?.openPath) return;
  const result = await window.argentumDesktop.openPath(folderPath).catch(() => null);
  if (result && result.opened === false) renderStatus(result.error || "Could not open the finished clips folder");
}

async function saveProductReadyClipLocally(clip = null) {
  if (!clip?.id || productionStage(clip) !== "product_ready") return clip;
  if (clip.productionWorkflow?.localLibraryPath || !state.settings.outputFolder?.configured) return clip;
  if (!window.argentumDesktop?.saveClipToOutputFolder) return clip;
  const playback = productionPlaybackUrl(clip);
  if (!playback) throw new Error("The Product Ready video is missing its verified playback file.");
  renderStatus(`Saving ${clip.streamerName || clip.title || "finished clip"} to ${state.settings.outputFolder.name}...`);
  const saved = await window.argentumDesktop.saveClipToOutputFolder({
    url: new URL(playback, window.location.href).href,
    fileName: clip.productionWorkflow?.outputFilename || `${editorExportFileBase(clip)}.mp4`
  });
  if (!saved?.saved || !saved.path) throw new Error("The finished clip could not be saved to the selected folder.");
  const recorded = await api(`/api/clips/candidates/${encodeURIComponent(clip.id)}/local-save`, {
    method: "POST",
    body: JSON.stringify({ path: saved.path }),
    timeoutMs: 60000
  });
  if (recorded?.candidate) replaceClipInState(recorded.candidate);
  renderStatus(`Saved locally: ${saved.fileName}`);
  return recorded?.candidate || clip;
}

function setAutomaticPipelineStage(level, { announce = true } = {}) {
  const nextStage = automationStage(level);
  state.settings.autoPipelineStage = nextStage.level;
  state.settings.autoPipelineEnabled = nextStage.level > 0;
  localStorage.setItem(autoPipelineStageStorageKey, String(nextStage.level));
  localStorage.setItem(autoPipelineStorageKey, String(state.settings.autoPipelineEnabled));
  state.editor.autoPipelineError = "";
  state.editor.autoPipelineFailedClipIds.clear();
  window.clearTimeout(state.editor.autoPipelineTimer);
  state.editor.lastRenderSignature = "";
  renderClipsArea({ force: true });
  if (announce) {
    renderStatus(nextStage.level
      ? `Automation will stop at ${nextStage.label}`
      : "Automation will stop after Discovery for manual approval");
  }
  if (state.settings.serverManagedAutomation) {
    saveServerAutomationSettings({
      enabled: nextStage.level > 0,
      pipelineStage: nextStage.id
    }).catch(() => {});
  }
  if (state.settings.autoPipelineEnabled) scheduleAutomaticPipeline(100);
  return nextStage;
}

function previewAutomaticPipelineStage(input) {
  const nextStage = automationStage(input?.value);
  const section = input?.closest(".settings-automation-section");
  const control = input?.closest(".settings-automation-control");
  if (!section || !control) return;
  control.style.setProperty("--automation-progress", `${nextStage.level * 25}%`);
  input.setAttribute("aria-valuetext", `Stop at ${nextStage.label}`);
  const output = section.querySelector("[data-automation-stage-output]");
  if (output) output.textContent = nextStage.level ? `Auto through ${nextStage.label}` : "Manual review";
  const automatic = section.querySelector("[data-automation-auto-copy]");
  if (automatic) automatic.textContent = nextStage.automatic;
  const gate = section.querySelector("[data-automation-gate-copy]");
  if (gate) gate.textContent = nextStage.gate;
  const title = section.querySelector(".settings-automation-head strong");
  if (title) title.textContent = `Stop at ${nextStage.label}`;
  section.querySelectorAll("[data-automation-stage]").forEach((button) => {
    const buttonLevel = Number(button.dataset.automationStage || 0);
    button.classList.toggle("is-active", buttonLevel === nextStage.level);
    button.classList.toggle("is-complete", buttonLevel < nextStage.level);
    button.setAttribute("aria-pressed", String(buttonLevel === nextStage.level));
  });
}

function automaticPipelineCandidate() {
  const level = Number(state.settings.autoPipelineStage || 0);
  const clips = (state.clips || [])
    .filter((clip) => !clipDeclined(clip))
    .filter((clip) => {
      if (clipApprovedForBuilder(clip) || ["precheck", "product_ready"].includes(productionStage(clip))) return true;
      return automaticClipMatchesFocus(clip);
    })
    .filter((clip) => !clipUsesPracticeEvidence(clip))
    .filter((clip) => !state.editor.autoPipelineFailedClipIds.has(clip.id))
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
  if (level >= 4 && state.settings.outputFolder?.configured) {
    const unsavedReady = clips.find((clip) => productionStage(clip) === "product_ready" && !clip.productionWorkflow?.localLibraryPath);
    if (unsavedReady) return unsavedReady;
  }
  if (level >= 3) {
    const precheck = clips.find((clip) => (
      productionStage(clip) === "precheck"
      && clip.productionWorkflow?.readiness?.ready
      && clip.captionGeneration?.status !== "review_required"
    ));
    if (precheck) return precheck;
  }
  if (level >= 2) {
    const editing = clips.find((clip) => clipApprovedForBuilder(clip) && productionStage(clip) === "editing");
    if (editing) return editing;
  }
  return level >= 1
    ? clips.find((clip) => !clipApprovedForBuilder(clip) && clipPlaybackUrl(clip)) || null
    : null;
}

function scheduleAutomaticPipeline(delayMs = 500) {
  window.clearTimeout(state.editor.autoPipelineTimer);
  if (state.settings.serverManagedAutomation && !isAutomationWorker) return;
  if (isAutomationWorker && !automationWorkerRuntimeStarted) return;
  if (!state.settings.autoPipelineEnabled || state.editor.autoPipelineRunningClipId) return;
  state.editor.autoPipelineTimer = window.setTimeout(() => runAutomaticClipPipeline(), delayMs);
}

async function runAutomaticClipPipeline() {
  if (!state.settings.autoPipelineEnabled || state.editor.autoPipelineRunningClipId || state.editor.uploadingSource || state.editor.exportingClipId) return;
  const target = automaticPipelineCandidate();
  if (!target?.id) return;
  const clipId = target.id;
  state.editor.autoPipelineRunningClipId = clipId;
    reportAutomationWorkerStatus("processing", {
      clipId,
      progress: 0,
      stage: "Preparing clip",
      detail: `Loading ${target.streamerName || target.title || "the next clip"} into the local editor.`,
      message: `Processing ${target.streamerName || target.title || "clip"} through the local workflow.`
    });
  state.editor.autoPipelineError = "";
  state.editor.lastRenderSignature = "";
  renderClipsArea({ force: true });
  try {
    let clip = (state.clips || []).find((item) => item.id === clipId) || target;
    if (productionStage(clip) === "product_ready") {
      if (Number(state.settings.autoPipelineStage || 0) >= 4) await saveProductReadyClipLocally(clip);
      return;
    }
    if (productionStage(clip) === "precheck") {
      if (Number(state.settings.autoPipelineStage || 0) < 3) return;
      clip = await updateProductReadyStatus(clipId, "approve", { approvedBy: "automatic_pipeline" });
      if (!clip) throw new Error("Automatic Product Ready approval did not complete.");
      if (Number(state.settings.autoPipelineStage || 0) >= 4) await saveProductReadyClipLocally(clip);
      return;
    }
    if (!clipApprovedForBuilder(clip) || !editorPrecheckForClip(clip).ready) {
      const prepared = await approveClipForBuilder(clipId, { navigate: false });
      if (!prepared) throw new Error("Automatic Studio preparation needs attention.");
      clip = (state.clips || []).find((item) => item.id === clipId) || clip;
    }
    if (Number(state.settings.autoPipelineStage || 0) < 2) return;
    if (!editorPrecheckForClip(clip).ready) {
      throw new Error(`Automatic Studio checklist is incomplete: ${editorPrecheckForClip(clip).missing.join(", ")}.`);
    }
    const queued = await exportEditedClip(clipId);
    if (!queued || productionStage(queued) !== "precheck") throw new Error("Automatic render did not reach Precheck.");
    if (queued.captionGeneration?.status === "review_required") {
      renderStatus("Clip rendered into Precheck and is waiting for caption approval.");
      return;
    }
    if (Number(state.settings.autoPipelineStage || 0) < 3) return;
    const ready = await updateProductReadyStatus(clipId, "approve", { approvedBy: "automatic_pipeline" });
    if (!ready) throw new Error("Automatic Product Ready approval did not complete.");
    if (Number(state.settings.autoPipelineStage || 0) >= 4) await saveProductReadyClipLocally(ready);
  } catch (error) {
    state.editor.autoPipelineError = error.message || "Automatic clip processing stopped";
    state.editor.autoPipelineFailedClipIds.add(clipId);
    window.setTimeout(() => {
      state.editor.autoPipelineFailedClipIds.delete(clipId);
      scheduleAutomaticPipeline(100);
    }, 120000);
    renderStatus(state.editor.autoPipelineError);
    reportAutomationWorkerStatus("retrying", { clipId, error: state.editor.autoPipelineError });
  } finally {
    state.editor.autoPipelineRunningClipId = "";
    state.editor.lastRenderSignature = "";
    renderWatchArea();
    renderClipsArea({ force: true });
    if (!state.editor.autoPipelineError) reportAutomationWorkerStatus("ready", { message: "Background editor is ready for the next verified clip." });
    scheduleAutomaticPipeline(state.editor.autoPipelineError ? 15000 : 1200);
  }
}

async function loadSelectedEditorClip() {
  const select = document.querySelector("[data-editor-load-select]");
  const clipId = select?.value || "";
  if (!clipId) return;
  state.editor.selectedBuilderClipId = clipId;
  localStorage.setItem("argentumEditorSelectedBuilderClipId", clipId);
  const stickerApplied = maybeAutoApplyEditorSticker(clipId);
  if (stickerApplied) scheduleEditorDraftSave(clipId);
  state.editor.lastRenderSignature = "";
  renderClipsArea({ force: true });
  renderStatus("Clip loaded in Argentum Editor");
  const clip = builderClipById(clipId);
  if (!clip?.editorFrameAnalysis?.observations?.length) {
    setEditorPreparation({
      clipId,
      title: editorAssetName(clip),
      status: "running",
      step: "frames",
      progress: 40,
      message: "Capturing the first, middle, and ending frames for GPT.",
      visualWarning: ""
    });
    const contextResult = await prepareEditorCaptionContext(clipId);
    setEditorPreparation({
      status: "complete",
      step: "ready",
      progress: 100,
      message: contextResult.captionResult?.ok
        ? "Three-frame GPT context and the caption are ready for review."
        : "Three-frame context is ready; captioning needs the warning shown below."
    });
  }
}

function editorTimelineElementForClip(clipId = "") {
  return [...document.querySelectorAll("[data-editor-timeline-clip]")]
    .find((timeline) => timeline.dataset.editorTimelineClip === clipId) || null;
}

function editorTimelineLayerById(clipId = "", layerId = "") {
  const clip = builderClipById(clipId);
  if (!clip) return null;
  return editorTimelineForClip(clip, editorClipDuration(clip)).find((layer) => layer.id === layerId) || null;
}

function updateEditorTimelineLayerDom(clipId = "", layer = null) {
  if (!clipId || !layer) return;
  const clip = builderClipById(clipId);
  const duration = editorClipDuration(clip);
  const timeline = editorTimelineElementForClip(clipId);
  if (!timeline) return;
  const percent = editorTimelineLayerPercent(layer, duration);
  const rangeLabel = editorLayerTimeLabel(layer);
  timeline.querySelectorAll("[data-editor-layer-block]").forEach((block) => {
    const selected = block.dataset.editorLayerId === layer.id;
    block.classList.toggle("selected", selected);
    block.closest(".editor-track")?.classList.toggle("selected", selected);
    if (!selected) return;
    block.style.setProperty("--track-offset", `${percent.offset}%`);
    block.style.setProperty("--track-width", `${percent.width}%`);
    const time = block.querySelector("[data-editor-layer-time]");
    if (time) time.textContent = rangeLabel;
  });
  const title = timeline.querySelector("[data-editor-layer-title]");
  const range = timeline.querySelector("[data-editor-layer-range]");
  if (title) title.textContent = layer.name;
  if (range) range.textContent = rangeLabel;
  timeline.querySelectorAll("[data-editor-layer-field]").forEach((input) => {
    const matches = input.dataset.editorLayerId === layer.id;
    input.closest("label")?.classList.toggle("selected", matches);
    if (!matches || document.activeElement === input) return;
    const field = input.dataset.editorLayerField;
    const value = field === "moveTo" ? layer.startSeconds : layer[field];
    input.value = String(value ?? 0);
  });
  timeline.querySelectorAll("[data-editor-layer-full], [data-editor-layer-at-playhead]").forEach((button) => {
    if (button.dataset.editorLayerFull != null) button.dataset.editorLayerFull = layer.id;
    if (button.dataset.editorLayerId != null) button.dataset.editorLayerId = layer.id;
  });
  state.editor.lastRenderSignature = editorRenderSignature();
}

function updateEditorTimelineLayerFromControl(input) {
  const clipId = input?.dataset?.editorLayerClip || editorPreviewPanelFor(input)?.dataset.editorClipId || "";
  const layerId = input?.dataset?.editorLayerId || state.editor.selectedTimelineLayerId || "";
  const field = input?.dataset?.editorLayerField || "";
  if (!clipId || !layerId || !field) return;
  const value = Number(input.value || 0);
  const layer = setEditorTimelineLayer(clipId, layerId, { [field]: value });
  if (!layer) return;
  updateEditorTimelineLayerDom(clipId, layer);
  scheduleEditorDraftSave(clipId);
}

function setEditorTimelineLayerFull(clipId = "", layerId = "") {
  const clip = builderClipById(clipId);
  if (!clip || !layerId) return;
  const duration = editorClipDuration(clip);
  const layer = setEditorTimelineLayer(clipId, layerId, { startSeconds: 0, endSeconds: duration });
  updateEditorTimelineLayerDom(clipId, layer);
  scheduleEditorDraftSave(clipId);
  renderStatus("Layer extended to the full clip");
}

function setEditorTimelineLayerAtPlayhead(button) {
  const clipId = button?.dataset?.editorLayerClip || "";
  const layerId = button?.dataset?.editorLayerId || state.editor.selectedTimelineLayerId || "";
  const edge = button?.dataset?.editorLayerAtPlayhead || "";
  const video = editorVideoFor(button);
  const playhead = Number(video?.currentTime || state.editor.playback?.currentTime || 0);
  const current = editorTimelineLayerById(clipId, layerId);
  if (!current) return;
  const updates = edge === "end"
    ? { endSeconds: Math.max(current.startSeconds + 0.1, playhead) }
    : { startSeconds: Math.min(current.endSeconds - 0.1, playhead) };
  const layer = setEditorTimelineLayer(clipId, layerId, updates);
  updateEditorTimelineLayerDom(clipId, layer);
  scheduleEditorDraftSave(clipId);
  renderStatus(`${edge === "end" ? "Layer end" : "Layer start"} set to playhead`);
}

function startEditorTimelineDrag(target, event) {
  const clipId = target?.dataset?.editorLayerClip || "";
  const layerId = target?.dataset?.editorLayerId || "";
  const clip = builderClipById(clipId);
  const layer = editorTimelineLayerById(clipId, layerId);
  const rail = target?.closest?.(".editor-track")?.querySelector?.(".editor-track-rail");
  if (!clip || !layer || !rail) return;
  const rect = rail.getBoundingClientRect();
  if (!rect.width) return;
  setEditorSelectedTimelineLayer(layerId);
  updateEditorTimelineLayerDom(clipId, layer);
  state.editor.timelineDrag = {
    clipId,
    layerId,
    mode: target.dataset.editorLayerHandle || "move",
    duration: editorClipDuration(clip),
    startX: event.clientX,
    railWidth: rect.width,
    originalStart: Number(layer.startSeconds || 0),
    originalEnd: Number(layer.endSeconds || editorClipDuration(clip))
  };
  event.preventDefault();
}

function updateEditorTimelineDrag(event) {
  const drag = state.editor.timelineDrag;
  if (!drag) return;
  const deltaSeconds = ((event.clientX - drag.startX) / drag.railWidth) * drag.duration;
  const length = Math.max(0.1, drag.originalEnd - drag.originalStart);
  let updates = {};
  if (drag.mode === "start") {
    updates = { startSeconds: Math.min(drag.originalEnd - 0.1, Math.max(0, drag.originalStart + deltaSeconds)) };
  } else if (drag.mode === "end") {
    updates = { endSeconds: Math.max(drag.originalStart + 0.1, Math.min(drag.duration, drag.originalEnd + deltaSeconds)) };
  } else {
    const start = Math.min(Math.max(0, drag.originalStart + deltaSeconds), Math.max(0, drag.duration - length));
    updates = { startSeconds: start, endSeconds: start + length };
  }
  const layer = setEditorTimelineLayer(drag.clipId, drag.layerId, updates);
  updateEditorTimelineLayerDom(drag.clipId, layer);
  event.preventDefault();
}

function finishEditorTimelineDrag() {
  const drag = state.editor.timelineDrag;
  if (!drag) return;
  scheduleEditorDraftSave(drag.clipId);
  state.editor.timelineDrag = null;
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

function editorRenderSignature() {
  const activeClip = selectedBuilderClip();
  const stickerSignature = (sticker = null) => sticker ? {
    enabled: Boolean(sticker.enabled),
    type: sticker.type || "",
    label: sticker.label || "",
    assetName: sticker.assetName || "",
    sourcePath: sticker.sourcePath || "",
    previewBytes: String(sticker.previewDataUrl || "").length,
    xPercent: sticker.xPercent,
    yPercent: sticker.yPercent,
    sizePercent: sticker.sizePercent
  } : null;
  const builder = builderClips().map((clip) => ({
    id: clip.id,
    title: clip.title,
    score: clip.score || clip.qualityScore || 0,
    duration: clip.durationSeconds || clip.duration || 0,
    playback: clipPlaybackUrl(clip)
  }));
  const clips = currentClips().map((clip) => ({
    id: clip.id,
    title: clip.title,
    status: clip.status || clip.decision || "",
    playback: clipPlaybackUrl(clip),
    score: clip.score || clip.qualityScore || 0
  }));
  const production = (state.clips || [])
    .filter((clip) => ["precheck", "product_ready"].includes(productionStage(clip)))
    .map((clip) => ({
      id: clip.id,
      stage: productionStage(clip),
      status: clip.productionWorkflow?.status || "",
      ready: Boolean(clip.productionWorkflow?.readiness?.ready),
      playback: productionPlaybackUrl(clip),
      updatedAt: clip.productionWorkflow?.updatedAt || ""
    }));
  const activeId = activeClip?.id || "";
  const activeCaptions = activeId
    ? state.editor.captions[activeId] || activeClip?.builderDraft?.editorState?.captions || activeClip?.editorState?.captions || null
    : null;
  return JSON.stringify({
    view: state.activeView,
    outputFormat: state.settings.outputFormat,
    library: `${state.library.filter}:${state.library.query}:${state.library.page}`,
    folder: state.config?.clipsFolder || state.config?.watchBufferDir || state.config?.outputDir || "",
    watchSession: state.watch.session?.id || "",
    streamer: state.watch.streamer?.id || "",
    selected: activeId,
    activePlayback: activeClip ? clipPlaybackUrl(activeClip) : "",
    activeSticker: activeId ? stickerSignature(state.editor.stickers[activeId] || activeClip?.builderDraft?.editorState?.sticker || null) : null,
    activeCaptions: activeCaptions ? {
      enabled: Boolean(activeCaptions.enabled),
      segmentCount: Array.isArray(activeCaptions.segments) ? activeCaptions.segments.length : 0,
      updatedAt: activeCaptions.updatedAt || ""
    } : null,
    activeTimeline: activeId ? state.editor.timelineLayers[activeId] || activeClip?.builderDraft?.editorState?.timeline?.layers || null : null,
    selectedLayer: state.editor.selectedTimelineLayerId,
    toolTab: state.editor.toolTab,
    timelineExpanded: state.editor.timelineExpanded,
    exporting: state.editor.exportingClipId || "",
    uploadingSource: Boolean(state.editor.uploadingSource),
    productionBusy: state.editor.productionBusyClipId || "",
    buffer: `${state.buffer.status}:${state.buffer.loading}:${state.buffer.activeClipId}:${(state.buffer.channels || []).map((channel) => channel.id).join(",")}`,
    stickerLibrary: (state.editor.stickerLibrary || []).map((entry) => `${entry.id}:${entry.updatedAt}`).join("|"),
    clips,
    builder,
    production
  });
}

function renderClipsArea(options = {}) {
  if (isAutomationWorker) {
    const workerArea = $("#clips-area");
    if (workerArea?.childElementCount) workerArea.replaceChildren();
    return;
  }
  const area = $("#clips-area");
  if (!area) return;
  syncAppShell();
  const nextSignature = editorRenderSignature();
  if (!options.force && state.editor.lastRenderSignature === nextSignature && area.dataset.rendered === "true") {
    setupEditorVideoPreviews();
    hydrateEditorStickerImages();
    return;
  }
  state.editor.lastRenderSignature = nextSignature;
  const playbackSnapshot = captureEditorPlaybackState(area);
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
  area.dataset.rendered = "true";
  if (state.activeView === "studio") {
    area.innerHTML = `${renderBuilderArea()}${renderEditorTranscriptModal()}`;
  } else if (state.activeView === "review") {
    area.innerHTML = renderProductionReviewArea();
  } else if (state.activeView === "library") {
    area.innerHTML = renderLibraryArea();
  } else if (state.activeView === "settings") {
    area.innerHTML = renderSettingsArea();
  } else {
    area.innerHTML = "";
  }
  setupEditorVideoPreviews();
  hydrateEditorStickerImages();
  restoreEditorPlaybackState(playbackSnapshot, area);
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
  const mediaFallback = ["unavailable", "dead"].includes(String(session?.chatSignalState || "")) || session?.mediaFallbackState === "active";
  const mediaScore = Number(session?.lastMediaSignalScore || 0);
  if (mediaFallback && mediaScore > 0) {
    return Math.max(1, Math.min(100, Math.round(mediaScore)));
  }
  return Math.max(1, Math.min(100, viewerBase + chat + keywords + titleBoost));
}

function renderSignalMeter(score) {
  return `
    <div class="signal-meter" style="--score:${score}%">
      <span></span>
    </div>
  `;
}

function discoveryClips() {
  const sessionId = state.watch.session?.id || "";
  const streamerId = state.watch.streamer?.id || "";
  const multiWatchPool = (state.watch.sessions || []).length > 1;
  const seenMoments = new Set();
  return (state.clips || [])
    .filter((clip) => !clipDeclined(clip))
    .filter((clip) => {
      if (multiWatchPool || (!sessionId && !streamerId)) return true;
      if (sessionId && clip.watchSessionId === sessionId) return true;
      if (streamerId && clip.streamerId === streamerId) return true;
      return false;
    })
    .sort((a, b) => String(b.createdAt || b.updatedAt || "").localeCompare(String(a.createdAt || a.updatedAt || "")))
    .filter((clip) => {
      if (!clip.sourceId) return true;
      const start = Math.round(Number(clip.timestampStartSeconds ?? clip.startSeconds ?? 0) * 1000);
      const end = Math.round(Number(clip.timestampEndSeconds ?? clip.endSeconds ?? start) * 1000);
      const momentKey = `${clip.sourceId}:${start}:${end}`;
      if (seenMoments.has(momentKey)) return false;
      seenMoments.add(momentKey);
      return true;
    })
    .slice(0, 50);
}

function renderDiscoverClips() {
  const area = $("#discover-clips");
  if (!area) return;
  const clips = discoveryClips();
  area.innerHTML = `
    <section class="discover-clips-panel">
      <div class="discover-clips-head">
        <div>
          <span class="watch-kicker">Captured moments</span>
          <h2>Clips from this discovery</h2>
          <small>${clips.length ? `${clips.length} captured moment${clips.length === 1 ? "" : "s"}` : "Your saved moments will appear here"}</small>
        </div>
        <button type="button" class="discover-clips-library" data-app-view="library">Open Library</button>
      </div>
      <div class="discover-clips-grid">
        ${clips.length
          ? clips.slice(0, 6).map(renderDiscoverClipCard).join("")
          : `<div class="discover-clips-empty"><strong>No clips from this watch yet</strong><span>When Agent Watch finds a moment worth saving, it will appear here.</span></div>`}
      </div>
    </section>
  `;
  area.querySelectorAll("[data-discover-thumbnail]").forEach((image) => {
    const frame = image.closest("[data-discover-thumbnail-frame]");
    const markLoaded = () => frame?.classList.add("is-loaded");
    const markFailed = () => frame?.classList.add("is-error");
    image.addEventListener("load", markLoaded, { once: true });
    image.addEventListener("error", markFailed, { once: true });
    if (image.complete) {
      if (image.naturalWidth > 0) markLoaded();
      else markFailed();
    }
  });
}

function renderWatchArea() {
  const area = $("#watch-area");
  if (!area) return;
  const rows = (state.watch.sessions || []).map((session) => ({
    session,
    stream: (state.watch.streams || []).find((item) => item.sessionId === session.id || item.id === session.streamerId)
      || streamFromWatchSession(session, state.watch.streamer || {})
  }));
  const selectedRow = rows.find((row) => row.session.id === state.watch.session?.id)
    || (state.watch.session && state.watch.stream ? { session: state.watch.session, stream: state.watch.stream } : null)
    || rows[0]
    || null;
  if (!rows.length) {
    area.innerHTML = `
      <div class="watch-empty">
        <strong>No streams being watched</strong>
        <span>Search live streams and add up to ${Number(state.config?.maxWatchedStreamers || 50)} streams to the watch pool.</span>
      </div>
    `;
    renderDiscoverClips();
    renderClipsArea();
    return;
  }

  const session = selectedRow?.session || null;
  const stream = selectedRow?.stream || null;
  const events = latestSignalEvents();
  const keywords = state.config?.watchTriggerKeywords || ["holy shit", "wow", "wtf", "bro", "insane", "clip this"];
  const selectedScore = signalScore(stream, session);
  const chatPpm = Number(session?.lastChatMessagesPerMinute || 0);
  const capabilities = session?.capabilities || {};
  const keywordSummary = watchKeywordStatus(session, keywords, events);
  const capacityLabel = `${rows.length}/${Number(state.config?.maxWatchedStreamers || 50)} streams`;
  const anyMediaObserver = Boolean(state.config?.continuousMediaObservation) || rows.some(({ session: rowSession }) => rowSession?.rollingBuffer?.running);
  area.innerHTML = `
    <section class="watch-panel">
      <div class="watch-command">
        <div>
          <span class="watch-kicker">Agent Watch Area</span>
          <h2>${esc(capacityLabel)} being watched</h2>
        </div>
        <span class="watch-chip ${state.watch.error ? "bad" : "good"}">${esc(session ? watchStatusText(session, session.currentStage || "Ready") : "Pool active")}</span>
        <span class="watch-chip ${capabilities.hasLiveVideo ? "good" : "idle"}">${esc(session ? watchMediaStatus(capabilities) : "Multi-stream pool")}</span>
        <button type="button" class="watch-chip keyword" data-open-keywords title="Open all watch keywords">
          <span>Top keys</span>
          <b>${esc(keywordSummary)}</b>
        </button>
        ${anyMediaObserver ? `<span class="watch-chip good"><span>Live AI</span><b>Listening · viewing · ${formatNumber(state.config?.rollingBufferLookbackSeconds || 135)}s memory</b></span>` : ""}
        <button type="button" class="watch-refresh" data-refresh-office ${state.watch.refreshing ? "disabled" : ""}>${state.watch.refreshing ? "Refreshing..." : "Refresh office"}</button>
      </div>
      <div class="watch-card-row">
        ${rows.map(({ session: rowSession, stream: rowStream }) => {
          const score = signalScore(rowStream, rowSession);
          const viewerCount = Number(rowStream.viewerCount || rowSession?.viewerCount || 0);
          const rowChatPpm = Number(rowSession?.lastChatMessagesPerMinute || 0);
          const rowMediaFallback = ["unavailable", "dead"].includes(String(rowSession?.chatSignalState || "")) || rowSession?.mediaFallbackState === "active";
          const rowMediaScore = Number(rowSession?.lastMediaSignalScore || 0);
          const rowChatLabel = rowMediaFallback ? (rowMediaScore ? "Active" : "Armed") : `${formatNumber(rowChatPpm)}/min`;
          const paused = rowSession?.status === "paused";
          const preview = watchPreviewUrl(rowStream);
          return `
            <article class="watch-stream-card ${paused ? "is-paused" : ""}" data-open-watch-detail="${esc(rowSession.id)}" role="button" tabindex="0" aria-label="Open watch details for ${esc(rowStream.displayName)}">
              <div class="watch-card-actions">
                <button type="button" data-pause-watch="${esc(rowSession.id)}">${paused ? "Resume" : "Pause"}</button>
                <button type="button" class="danger" data-remove-watch="${esc(rowSession.id)}">Remove</button>
              </div>
              <div class="watch-card-poster ${preview ? "has-snapshot" : "no-snapshot"}">
                ${preview ? `<img src="${esc(preview)}" alt="Current snapshot of ${esc(rowStream.displayName)}" loading="eager" />` : `<span class="watch-card-placeholder">${esc(String(rowStream.displayName || "S").slice(0, 2).toUpperCase())}</span>`}
                <b class="watch-live-badge">${paused ? "PAUSED" : "LIVE · 5S SNAPSHOT"}</b>
                <span>${esc(rowStream.platform || "stream")}</span>
              </div>
              <div class="watch-card-body">
                <div class="watch-card-title">
                  <strong>${esc(rowStream.displayName)}</strong>
                </div>
                <div class="watch-card-metrics">
                  <span><small>Viewers</small><b>${formatNumber(viewerCount)}</b></span>
                  <span><small>Signal</small><b>${score}%</b></span>
                  <span><small>${rowMediaFallback ? "Media AI" : "Chat"}</small><b>${esc(rowChatLabel)}</b></span>
                </div>
                <small class="watch-memory-state">${esc(watchMemoryStatus(rowSession))}</small>
                ${renderSignalMeter(score)}
              </div>
            </article>
          `;
        }).join("")}
      </div>
    </section>
    ${selectedRow ? renderWatchDetailModal({ stream, session, events, score: selectedScore, chatPpm, keywords, capabilities }) : ""}
    ${renderKeywordModal({ session, events, keywords })}
  `;
  renderDiscoverClips();
  renderClipsArea();
}

async function refreshWatchState(streamerId = state.watch.streamer?.id || "") {
  const [active, clips, automation] = await Promise.all([
    api("/api/watch-sessions/active", {
      timeoutMs: 10000,
      timeoutMessage: "Watch status did not answer in time. The background watchers are still running."
    }),
    api("/api/clips/candidates", {
      timeoutMs: 10000,
      timeoutMessage: "Clip Radar did not answer in time. Captures will continue in the background."
    }).catch(() => ({ candidates: null, streamers: null })),
    api("/api/automation", {
      timeoutMs: 10000,
      timeoutMessage: "Workflow status did not answer in time. The rail will refresh on the next pass."
    }).catch(() => null)
  ]);
  if (automation?.automation) applyServerAutomation(automation.automation);
  const sessions = active.sessions || [];
  const streamers = Array.isArray(clips.streamers) ? clips.streamers : (state.watch.streamers || []);
  const activeSessionIds = sessions.map((item) => item.id).filter(Boolean);
  if (!isAutomationWorker) state.watch.previewTick = Date.now();
  const knownBeforeRefresh = state.watch.knownSessionIds || [];
  const knownSessionIds = knownBeforeRefresh.length
    ? Array.from(new Set([...knownBeforeRefresh, ...activeSessionIds]))
    : activeSessionIds;
  state.watch.knownSessionIds = knownSessionIds;
  saveWatchSessionIds();
  const session = sessions.find((item) => item.streamerId === streamerId)
    || sessions.find((item) => item.id === state.watch.session?.id)
    || sessions[0]
    || null;
  const streamer = session
    ? streamers.find((item) => item.id === session.streamerId) || state.watch.streamer || null
    : null;
  state.watch.session = session;
  state.watch.sessions = sessions;
  state.watch.streams = sessions.map((item) => streamFromWatchSession(item, streamers.find((streamerItem) => streamerItem.id === item.streamerId) || {}));
  state.watch.streamers = streamers;
  if (session) {
    state.watch.streamer = streamer;
    state.watch.stream = streamFromWatchSession(session, streamer || {});
    state.selectedStreamKey = streamKey(state.watch.stream);
  } else if (!state.watch.loading) {
    state.watch.streamer = null;
    state.watch.stream = null;
    state.selectedStreamKey = "";
  }
  state.watch.allEvents = active.events || [];
  state.watch.events = session
    ? state.watch.allEvents.filter((event) => event.sessionId === session.id)
    : state.watch.allEvents;
  if (Array.isArray(clips.candidates)) {
    state.clips = clips.candidates
      .filter((candidate) => !clipUsesPracticeEvidence(candidate))
      .filter((candidate) => (
        !candidate?.watchSessionId
          || knownSessionIds.includes(candidate.watchSessionId)
          || clipApprovedForBuilder(candidate)
      ));
    reconcileEditorWithVisibleClips();
  }
  if (!isAutomationWorker) {
    renderWorkflowRail();
    renderWatchArea();
  }
  scheduleAutomaticPipeline();
}

async function refreshOffice() {
  if (state.watch.refreshing) return;
  state.watch.refreshing = true;
  renderWatchArea();
  try {
    await refreshWatchState();
    await new Promise((resolve) => window.setTimeout(resolve, 220));
    await refreshWatchState();
    renderStatus(`Office refreshed and verified — ${state.watch.sessions.length} watchers, ${currentClips().length} Radar clips`);
  } catch (error) {
    state.watch.error = error.message || "Office refresh failed";
    renderStatus(state.watch.error);
  } finally {
    state.watch.refreshing = false;
    renderWatchArea();
  }
}

function startWatchPolling() {
  window.clearInterval(state.watchPollTimer);
  const refreshIntervalMs = isAutomationWorker ? 10000 : 5000;
  state.watchPollTimer = window.setInterval(() => pollWatchStateOnce(), refreshIntervalMs);
}

function pollWatchStateOnce() {
  if (state.watch.polling) return;
  if (!isAutomationWorker && document.hidden) return;
  state.watch.polling = true;
  refreshWatchState()
    .catch((error) => {
      state.watch.error = error.message || "Watch refresh failed";
      if (!isAutomationWorker) renderWatchArea();
    })
    .finally(() => {
      state.watch.polling = false;
    });
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
      timeoutMs: 20000,
      timeoutMessage: `${stream.displayName} is taking longer to connect. The office remains usable while you retry.`,
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
    const current = (state.watch.sessions || []).find((item) => item.id === sessionId) || state.watch.session;
    const action = current?.status === "paused" ? "resume" : "pause";
    const result = await api(`/api/watch-sessions/${encodeURIComponent(sessionId)}/${action}`, { method: "POST" });
    state.watch.session = result.session || state.watch.session;
    renderStatus(action === "resume" ? "Watcher resumed" : "Watcher paused — saved clips were kept");
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
      body: JSON.stringify({ stopAll: false, keepResumable: true, reason: "operator_stop_resumable" })
    });
    state.watch.detailOpen = false;
    state.watch.keywordOpen = false;
    renderStatus("Watcher stopped — saved clips were kept");
    await refreshWatchState();
  } catch (error) {
    state.watch.error = error.message || "Could not stop watcher";
    renderStatus(state.watch.error);
    renderWatchArea();
  }
}

async function removeWatchSession(sessionId = state.watch.session?.id || "") {
  if (!sessionId) return;
  state.watch.error = "";
  state.watch.knownSessionIds = Array.from(new Set([...(state.watch.knownSessionIds || []), sessionId]));
  saveWatchSessionIds();
  try {
    await api(`/api/watch-sessions/${encodeURIComponent(sessionId)}/stop`, {
      method: "POST",
      body: JSON.stringify({ stopAll: false, keepResumable: false, remove: true, reason: "operator_remove_watch" })
    });
    state.watch.detailOpen = false;
    state.watch.keywordOpen = false;
    renderStatus("Watcher removed — saved clips were kept");
    await refreshWatchState();
  } catch (error) {
    state.watch.error = error.message || "Could not remove watcher";
    renderStatus(state.watch.error);
    renderWatchArea();
  }
}

function closeClipRemovalModal({ restoreFocus = true, force = false } = {}) {
  if (state.library.removalBusy && !force) return;
  state.library.removalClipId = "";
  state.library.removalBusy = false;
  state.library.removalError = "";
  document.body.classList.remove("clip-removal-open");
  $("#clip-removal-modal")?.remove();
  if (restoreFocus && clipRemovalReturnFocus?.isConnected) clipRemovalReturnFocus.focus();
  clipRemovalReturnFocus = null;
}

function renderClipRemovalModal() {
  $("#clip-removal-modal")?.remove();
  const candidateId = state.library.removalClipId;
  if (!candidateId) return;
  const clip = (state.clips || []).find((item) => item.id === candidateId);
  if (!clip) {
    closeClipRemovalModal({ restoreFocus: false, force: true });
    return;
  }
  const label = clip.streamerName || clip.title || "this clip";
  document.body.insertAdjacentHTML("beforeend", `
    <div class="clip-remove-modal" id="clip-removal-modal" data-clip-removal-modal>
      <section class="clip-remove-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clip-remove-title" aria-describedby="clip-remove-description" aria-busy="${state.library.removalBusy}" tabindex="-1">
        <header class="clip-remove-head">
          <div>
            <span>Remove clip</span>
            <h2 id="clip-remove-title">Remove ${esc(label)}?</h2>
          </div>
          <button type="button" class="clip-remove-close" data-close-clip-removal aria-label="Close removal confirmation" ${state.library.removalBusy ? "disabled" : ""}>&times;</button>
        </header>
        <p id="clip-remove-description">This clip will be removed from Discover, Studio, Review, and Library.</p>
        <div class="clip-remove-preservation">
          <span>Original video file</span>
          <strong>Kept on this Mac</strong>
        </div>
        ${state.library.removalError ? `<p class="clip-remove-error" role="alert">${esc(state.library.removalError)}</p>` : ""}
        <footer class="clip-remove-actions">
          <button type="button" data-close-clip-removal data-cancel-clip-removal ${state.library.removalBusy ? "disabled" : ""}>Cancel</button>
          <button type="button" class="danger" data-confirm-clip-removal ${state.library.removalBusy ? "disabled" : ""}>
            ${state.library.removalBusy ? "Removing..." : "Remove clip"}
          </button>
        </footer>
      </section>
    </div>
  `);
  document.body.classList.add("clip-removal-open");
  window.requestAnimationFrame(() => {
    const target = state.library.removalBusy
      ? $("#clip-removal-modal .clip-remove-dialog")
      : $("[data-cancel-clip-removal]");
    target?.focus();
  });
}

function requestClipCandidateRemoval(candidateId = "", trigger = null) {
  if (!candidateId) return;
  const clip = (state.clips || []).find((item) => item.id === candidateId);
  if (!clip) return;
  clipRemovalReturnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
  state.library.removalClipId = candidateId;
  state.library.removalBusy = false;
  state.library.removalError = "";
  renderClipRemovalModal();
}

async function confirmClipCandidateRemoval() {
  const candidateId = state.library.removalClipId;
  if (!candidateId || state.library.removalBusy) return;
  state.library.removalBusy = true;
  state.library.removalError = "";
  renderClipRemovalModal();
  try {
    await api(`/api/clips/candidates/${encodeURIComponent(candidateId)}`, {
      method: "DELETE"
    });
    state.clips = (state.clips || []).filter((clip) => clip.id !== candidateId);
    if (state.editor.selectedBuilderClipId === candidateId) {
      state.editor.selectedBuilderClipId = "";
      localStorage.removeItem("argentumEditorSelectedBuilderClipId");
    }
    if (state.editor.expandedProductionClipId === candidateId) state.editor.expandedProductionClipId = "";
    state.editor.lastRenderSignature = "";
    closeClipRemovalModal({ restoreFocus: false, force: true });
    renderStatus("Clip removed from Clipping Office. The original video file was kept.");
    renderWatchArea();
    renderClipsArea({ force: true });
  } catch (error) {
    state.library.removalBusy = false;
    state.library.removalError = error.message || "The clip could not be removed. Please try again.";
    renderClipRemovalModal();
  }
}

async function prepareEditorCaptionContext(candidateId = "") {
  let frameResult = null;
  let visionStageTimer = null;
  setEditorPreparation({
    step: "frames",
    progress: 40,
    message: "Capturing the first, middle, and ending frames from the saved MP4.",
    visualWarning: "",
    captionWarning: ""
  });
  try {
    visionStageTimer = window.setTimeout(() => {
      setEditorPreparation({
        step: "vision",
        progress: 51,
        message: "GPT is comparing all three frames with the full transcript."
      });
    }, 1200);
    frameResult = await analyzeEditorFramesForCaption(candidateId);
    window.clearTimeout(visionStageTimer);
    visionStageTimer = null;
    setEditorPreparation({
      step: "vision",
      progress: 59,
      message: frameResult?.analysisError
        ? "Frames captured; GPT visual reading returned a warning, so verified speech will remain primary."
        : "Visual sequence understood and attached to the caption evidence.",
      visualWarning: frameResult?.analysisError || ""
    });
  } catch (error) {
    if (visionStageTimer) window.clearTimeout(visionStageTimer);
    setEditorPreparation({
      step: "vision",
      progress: 59,
      message: "Frame analysis returned a warning; captioning will continue from verified speech.",
      visualWarning: error.message || "GPT could not read the three editor frames."
    });
  }

  const contextClip = builderClipById(candidateId);
  const capturedFrameCount = contextClip?.editorFrameCapture?.frames?.length || 0;
  const visualObservationCount = editorCaptionVisualObservations(contextClip).length;
  if (capturedFrameCount < 3 || visualObservationCount < 1) {
    const captionResult = {
      ok: false,
      error: frameResult?.analysisError || "Caption evidence is incomplete. Argentum needs the first, middle, and ending frames plus a verified visual reading before writing the hook."
    };
    setEditorPreparation({ captionWarning: captionResult.error });
    return { frameResult, captionResult };
  }

  setEditorPreparation({
    step: "captions",
    progress: 66,
    message: "Writing one short human caption from the transcript and visual evidence."
  });
  const captionResult = await generateEditorCaptions(candidateId, { skipTranscription: true });
  if (captionResult?.ok && captionResult.caption) {
    setAutomaticCaptionChatAnswer(candidateId, captionResult.caption, frameResult?.analysis || {});
  } else {
    setEditorPreparation({
      captionWarning: captionResult?.error || "No caption passed the accuracy gate."
    });
  }
  return { frameResult, captionResult };
}

async function approveClipForBuilder(candidateId, options = {}) {
  if (!candidateId) return;
  const sourceClip = (state.clips || []).find((clip) => clip.id === candidateId) || {};
  if (!clipApprovedForBuilder(sourceClip) && builderClips().length >= PRODUCTION_QUEUE_LIMIT) {
    const message = `Studio is full. Finish or remove a project before adding more than ${PRODUCTION_QUEUE_LIMIT} active clips.`;
    state.editor.autoPipelineError = options.navigate === false ? message : state.editor.autoPipelineError;
    renderStatus(message);
    if (isAutomationWorker) throw new Error(message);
    return null;
  }
  setEditorPreparation({
    clipId: candidateId,
    title: sourceClip.title || "Approved clip",
    status: "running",
    step: "media",
    progress: 6,
    message: "Verifying the saved MP4 and preparing the editor source.",
    audioWarning: "",
    visualWarning: "",
    captionWarning: ""
  });
  try {
    const result = await api(`/api/clips/candidates/${encodeURIComponent(candidateId)}/approve-builder`, {
      method: "POST",
      body: JSON.stringify({}),
      timeoutMs: 120000
    });
    replaceClipInState(result.candidate);
    state.editor.selectedBuilderClipId = candidateId;
    localStorage.setItem("argentumEditorSelectedBuilderClipId", candidateId);
    const defaultStickerApplied = maybeAutoApplyEditorSticker(candidateId);
    if (defaultStickerApplied && !(await persistEditorDraftNow(candidateId))?.candidate) {
      throw new Error("The automatic sticker could not be saved to the Studio project.");
    }
    if (options.navigate !== false && state.activeView !== "studio") setAppView("studio");
    setEditorPreparation({
      step: "audio",
      progress: 18,
      message: "Listening to the clip audio and building a speech transcript."
    });

    let transcription = null;
    let transcriptionProgressTimer = null;
    try {
      transcriptionProgressTimer = window.setTimeout(() => {
        setEditorPreparation({
          step: "audio",
          progress: 26,
          message: "On-device Whisper is reading the complete clip and preserving timed speech."
        }, { render: false });
      }, 4000);
      transcription = await api(`/api/clips/candidates/${encodeURIComponent(candidateId)}/transcribe`, {
        method: "POST",
        body: JSON.stringify({}),
        timeoutMs: 360000,
        timeoutMessage: "On-device transcription is still reading the full clip. Argentum will keep the result when it completes."
      });
      if (transcription?.candidate) {
        state.clips = (state.clips || []).map((clip) => clip.id === candidateId ? transcription.candidate : clip);
      }
      setEditorPreparation({
        progress: 34,
        message: transcription?.transcriptSummary?.text
          ? "Speech found and transcript saved for captions."
          : "Audio analyzed; no clear speech was detected in this clip.",
        audioWarning: transcription?.transcriptSummary?.text ? "" : (transcription?.transcriptError || "No clear speech detected")
      });
    } catch (error) {
      setEditorPreparation({
        progress: 34,
        message: "Audio analysis returned a warning; the editor will keep the result visible.",
        audioWarning: error.message || "Audio transcription was unavailable"
      });
    } finally {
      if (transcriptionProgressTimer) window.clearTimeout(transcriptionProgressTimer);
    }

    const contextResult = await prepareEditorCaptionContext(candidateId);
    if (!(await persistEditorDraftNow(candidateId))?.candidate) {
      throw new Error("The automatic captions could not be saved to the Studio project.");
    }

    setEditorPreparation({
      step: "reframe",
      progress: 76,
      message: "Analyzing the full MP4 and mapping the subject inside the 3:4 frame."
    });
    const reframe = await precomputeEditorReframe(candidateId);
    if (!reframe.ok) {
      if (isAutomationWorker) {
        const duration = editorClipDuration(builderClipById(candidateId));
        setEditorReframePlan(candidateId, {
          version: 2,
          mode: "verified_static_center_3_4_inside_9_16",
          compatibilityMode: "static_center_3_4_inside_9_16",
          ...editorDefaultVideoLayout(),
          sourceFit: "cover_subject_3_4",
          keyframes: [0, duration].map((timeSeconds) => ({
            timeSeconds,
            focusX: 50,
            focusY: 50,
            scale: 1.34,
            subjectAspectRatio: "3:4",
            confidence: 0.5,
            reason: "deterministic_center_fallback"
          })),
          fallbackReason: reframe.detail || "Live subject tracking was unavailable.",
          updatedAt: new Date().toISOString()
        });
        if (!(await persistEditorDraftNow(candidateId))?.candidate) {
          throw new Error("The centered auto-reframe fallback could not be saved.");
        }
      } else {
        setEditorPreparation({
          status: "error",
          message: reframe.detail || "Auto reframe analysis needs another pass."
        });
        renderStatus("Clip approved, but auto reframe needs attention");
        return false;
      }
    }
    if (!(await persistEditorDraftNow(candidateId))?.candidate) {
      throw new Error("The completed Studio preparation could not be saved.");
    }
    const preparedClip = builderClipById(candidateId);
    const readiness = editorPrecheckForClip(preparedClip);
    if (!readiness.ready) {
      const message = `Studio preparation is incomplete: ${readiness.missing.join(", ")}.`;
      setEditorPreparation({
        status: "error",
        message
      });
      renderStatus("Clip preparation needs attention before Studio is ready");
      if (isAutomationWorker) throw new Error(message);
      return false;
    }
    setEditorPreparation({
      status: "complete",
      step: "ready",
      progress: 100,
      message: `${contextResult.captionResult?.ok ? "Audio, three-frame GPT context, captions" : "Audio and three-frame context"}, and 3:4 auto reframe are ready${reframe.keyframeCount ? ` · ${reframe.keyframeCount} motion points` : ""}.`
    });
    renderStatus(defaultStickerApplied
      ? "Clip prepared in Argentum Editor with the saved sticker applied"
      : "Clip prepared and ready in Argentum Editor");
    return true;
  } catch (error) {
    setEditorPreparation({
      status: "error",
      message: error.message || "Could not prepare this clip"
    });
    renderStatus(error.message || "Could not approve clip");
    if (isAutomationWorker) throw error;
    return false;
  }
}

async function resumeIncompleteSelectedEditorClip() {
  if (state.activeView !== "studio" || state.editor.uploadingSource || state.editor.autoPipelineRunningClipId) return;
  const clip = selectedBuilderClip();
  if (!clip?.id || state.editor.preparationAttemptedClipIds.has(clip.id)) return;
  const reframeReady = Boolean(editorReframePlanForClip(clip)?.keyframes?.length);
  const captionsReady = Boolean(editorCaptionsForClip(clip).enabled);
  const stickerReady = Boolean(editorStickerForClip(clip).enabled);
  if (reframeReady && captionsReady && stickerReady) return;
  if (state.editor.preparation?.clipId === clip.id && state.editor.preparation?.status === "running") return;
  state.editor.preparationAttemptedClipIds.add(clip.id);
  await approveClipForBuilder(clip.id);
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
  if (action === "start" || action === "continue") {
    const existingSteps = action === "continue" ? (state.capcut.teach?.steps || []) : [];
    state.capcut.teach = {
      ...(state.capcut.teach || {}),
      name: state.capcut.macroName,
      recording: true,
      status: "starting",
      recorderReady: false,
      stopReason: "Opening CapCut and starting native recorder",
      steps: existingSteps,
      recorderMessages: [
        ...(state.capcut.teach?.recorderMessages || []).slice(-3),
        { type: "starting", message: "Starting native recorder", createdAt: new Date().toISOString() }
      ]
    };
  }
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

/**
 * One button, whole pipeline: send the approved clip to the taught CapCut
 * workflow and watch it live in the Determinism Monitor. The server resolves
 * the MP4, stages it, and runs the gated replay — the UI just follows along.
 */
async function autoEditClipInCapCut(candidateId) {
  if (!candidateId) return;
  if (state.capcut.replay?.running) {
    renderStatus("A CapCut edit is already running — watch the Determinism Monitor below.");
    return;
  }
  state.capcut.error = "";
  state.capcut.monitorCollapsed = false;
  localStorage.setItem("capcutMonitorCollapsed", "false");
  state.capcut.replay = {
    ...(state.capcut.replay || {}),
    running: true,
    status: "starting",
    macroName: "Auto-Edit",
    currentStepIndex: 0,
    currentStepDescription: "Staging the clip and opening CapCut…",
    currentStepStatus: "starting",
    gates: [],
    warnings: [],
    log: []
  };
  renderClipsArea();
  document.querySelector(".determinism-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
  const poll = window.setInterval(() => loadTeachState(), 900);
  try {
    const result = await api(`/api/clip-candidates/${encodeURIComponent(candidateId)}/auto-edit`, {
      method: "POST",
      body: JSON.stringify({}),
      timeoutMs: 600000
    });
    if (result.replay) state.capcut.replay = result.replay;
    renderStatus(result.replay?.status === "complete"
      ? `Auto-edit complete — CapCut project "${result.projectName || "saved"}" is ready.`
      : `Auto-edit ${result.replay?.status || "finished"} — see the Determinism Monitor for the phase that stopped it.`);
  } catch (error) {
    state.capcut.error = error.message || "Auto-edit failed";
    renderStatus(state.capcut.error);
  } finally {
    window.clearInterval(poll);
    await loadTeachState();
    refreshWatchState().catch(() => {});
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

async function initializeAutomationWorker() {
  document.body.className = "automation-worker-runtime";
  document.body.replaceChildren();
  await Promise.all([
    api("/api/health", {
      timeoutMs: 20000,
      timeoutMessage: "The local engine is still starting."
    }).catch((error) => {
      state.watch.error = error.message || "Local engine health check failed";
      return null;
    }),
    api("/api/config").then((config) => {
      state.config = config;
      return config;
    }).catch(() => null),
    loadServerAutomationSettings().catch((error) => {
      state.watch.error = error.message || "Automation settings did not load";
      return null;
    })
  ]);
  await refreshWatchState().catch((error) => {
    state.watch.error = error.message || "Automation candidates did not load";
  });
}

async function initializeClippingOffice() {
  const startedAt = Date.now();
  localStorage.setItem(appViewStorageKey, "discover");
  const initialView = isAutomationWorker ? "review" : "discover";
  if (isAutomationWorker) localStorage.setItem(appViewStorageKey, initialView);
  setAppView(initialView);
  renderStatus("Running startup checks...");
  renderStreams();
  renderWatchArea();

  try {
    await runStartupStep("engine", 0, "Connecting to the local engine...", async () => {
      const health = await api("/api/health", {
        timeoutMs: 20000,
        timeoutMessage: "The local engine is still starting. Remaining checks will continue."
      });
      return {
        value: health,
        warning: health.readiness === "BLOCKED",
        detail: health.readiness === "READY" ? "Connected" : String(health.readiness || "Limited"),
        message: "Local engine connected"
      };
    });

    await runStartupStep("media", 1, "Checking video and recorder tools...", async () => {
      const media = await api("/api/media/status", {
        timeoutMs: 12000,
        timeoutMessage: "Media tools are still initializing. The office can open in limited mode."
      });
      return {
        value: media,
        warning: media.mode !== "local_capture_render_ready",
        detail: media.recorder?.ready ? "Capture ready" : "Render only",
        message: media.recorder?.ready ? "Live capture tools verified" : "Live capture needs attention"
      };
    });

    await runStartupStep("providers", 2, "Connecting to Twitch, Kick, and Buffer status...", async () => {
      await loadProviderStatus();
      await loadBufferStatus().catch(() => null);
      await loadServerAutomationSettings().catch(() => null);
      const connected = [state.twitch.configured && "Twitch", state.kick.configured && "Kick"].filter(Boolean);
      return {
        warning: !connected.length,
        detail: connected.length ? connected.join(" + ") : "Not connected",
        message: connected.length ? `${connected.join(" and ")} connected` : "Provider setup can be retried in Settings"
      };
    });

    await runStartupStep("watchers", 3, "Restoring the multi-stream watch pool...", async () => {
      await refreshWatchState();
      return {
        detail: `${state.watch.sessions.length} active`,
        message: `${state.watch.sessions.length} watcher${state.watch.sessions.length === 1 ? "" : "s"} restored`
      };
    });

    await runStartupStep("discovery", 4, "Loading the live Discovery directory...", async () => {
      state.loading = true;
      const result = await loadDiscoveryStreamPage({ reset: true });
      return {
        value: result,
        warning: !state.streams.length,
        detail: state.streams.length ? `${state.streams.length} live` : "Retry Search",
        message: state.streams.length ? `${state.streams.length} live streams loaded` : "Discovery can be retried without restarting"
      };
    });
  } finally {
    state.loading = false;
    renderStreams();
    renderWatchArea();
    renderClipsArea();
    const elapsed = Date.now() - startedAt;
    if (elapsed < 900) await new Promise((resolve) => window.setTimeout(resolve, 900 - elapsed));
    await finishStartupScreen(state.streams.length ? "Discovery ready" : "Workspace ready - Search to refresh live streams");
    if (isAutomationWorker) setAppView("review");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  if (isAutomationWorker) {
    startAutomationWorkerRuntime();
    return;
  }
  setArgentumCommandBarCollapsed(argentumAgentChatState.collapsed, { persist: false });
  $("[data-argentum-command-toggle]")?.addEventListener("click", () => {
    setArgentumCommandBarCollapsed(!argentumAgentChatState.collapsed);
  });
  $("[data-agent101-panel-toggle]")?.addEventListener("click", () => {
    setArgentumAgentPanelOpen(!argentumAgentChatState.panelOpen);
  });
  $("[data-agent101-panel-close]")?.addEventListener("click", () => {
    setArgentumAgentPanelOpen(false);
    $("[data-agent101-chat-input]")?.focus();
  });
  $("[data-agent101-chat-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    sendArgentumAgentMessage($("[data-agent101-chat-input]")?.value || "");
  });
  document.addEventListener("click", (event) => {
    if (argentumAgentChatState.panelOpen && !event.target.closest?.(".argentum-command-bar")) {
      setArgentumAgentPanelOpen(false);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !argentumAgentChatState.panelOpen) return;
    event.preventDefault();
    setArgentumAgentPanelOpen(false);
    $("[data-agent101-chat-input]")?.focus();
  });
  $("#stream-search-button")?.addEventListener("click", searchStreams);
  $("#stream-category-filter")?.addEventListener("change", () => {
    state.categoryFilter = $("#stream-category-filter")?.value || "all";
    state.visibleCount = 20;
    renderStreams();
  });
  $("#stream-search-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchStreams();
  });
  document.addEventListener("submit", (event) => {
    const form = event.target.closest?.("[data-clip-chat-form]");
    if (!form) return;
    event.preventDefault();
    const input = form.querySelector("[data-clip-chat-input]");
    const message = input?.value || "";
    if (input) input.value = "";
    sendEditorClipChat(form.dataset.clipChatId || "", message);
  });
  document.addEventListener("keydown", (event) => {
    if (state.library.removalClipId && event.key === "Escape") {
      event.preventDefault();
      closeClipRemovalModal();
      return;
    }
    if (state.library.removalClipId && event.key === "Tab") {
      const dialog = $("#clip-removal-modal .clip-remove-dialog");
      const controls = Array.from(dialog?.querySelectorAll("button:not(:disabled)") || []);
      if (controls.length) {
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
      return;
    }
    const agentInput = event.target.closest?.("[data-agent101-chat-input]");
    if (agentInput && event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      agentInput.closest("[data-agent101-chat-form]")?.querySelector("[data-agent101-chat-send]")?.click();
      return;
    }
    const input = event.target.closest?.("[data-clip-chat-input]");
    if (!input || event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    input.closest("[data-clip-chat-form]")?.requestSubmit();
  });
  document.addEventListener("click", (event) => {
    const appViewButton = event.target.closest("[data-app-view]");
    const workflowClipButton = event.target.closest("[data-workflow-clip]");
    const libraryFilterButton = event.target.closest("[data-library-filter]");
    const libraryPageButton = event.target.closest("[data-library-page]");
    const settingsFormatButton = event.target.closest("[data-setting-format]");
    const automationStageButton = event.target.closest("[data-automation-stage]");
    const automationFocusButton = event.target.closest("[data-automation-focus]");
    const automationScanButton = event.target.closest("[data-run-automation-scan]");
    const chooseOutputFolderButton = event.target.closest("[data-choose-output-folder]");
    const openOutputFolderButton = event.target.closest("[data-open-output-folder]");
    const openLocalPathButton = event.target.closest("[data-open-local-path]");
    const libraryOpenEditorButton = event.target.closest("[data-library-open-editor]");
    const libraryOpenReviewButton = event.target.closest("[data-library-open-review]");
    const bufferTestButton = event.target.closest("[data-buffer-test]");
    const bufferPrepareButton = event.target.closest("[data-buffer-prepare]");
    const bufferApproveButton = event.target.closest("[data-buffer-approve]");
    const bufferCreateButton = event.target.closest("[data-buffer-create]");
    const bufferRevokeMediaButton = event.target.closest("[data-buffer-revoke-media]");
    const editorToolTabButton = event.target.closest("[data-editor-tool-tab]");
    const editorTimelineToggleButton = event.target.closest("[data-editor-timeline-toggle]");
    const watchButton = event.target.closest("[data-watch-streamer]");
    const moreButton = event.target.closest("[data-more-streams]");
    const pauseButton = event.target.closest("[data-pause-watch]");
    const stopButton = event.target.closest("[data-stop-watch]");
    const removeWatchButton = event.target.closest("[data-remove-watch]");
    const removeClipButton = event.target.closest("[data-remove-clip]");
    const closeClipRemovalButton = event.target.closest("[data-close-clip-removal]");
    const confirmClipRemovalButton = event.target.closest("[data-confirm-clip-removal]");
    const clipRemovalBackdrop = event.target.matches("[data-clip-removal-modal]");
    const refreshOfficeButton = event.target.closest("[data-refresh-office]");
    const keywordsButton = event.target.closest("[data-open-keywords]");
    const closeKeywords = event.target.closest("[data-close-keywords]");
    const keywordsBackdrop = event.target.matches("[data-keywords-modal]");
    const watchDetailButton = event.target.closest("[data-open-watch-detail]");
    const closeWatchDetail = event.target.closest("[data-close-watch-detail]");
    const watchDetailBackdrop = event.target.matches("[data-watch-detail-modal]");
    const closeEditorTranscript = event.target.closest("[data-close-editor-transcript]");
    const editorTranscriptBackdrop = event.target.matches("[data-editor-transcript-modal]");
    const approveClipButton = event.target.closest("[data-approve-clip]");
    const declineClipButton = event.target.closest("[data-decline-clip]");
    const selectBuilderClipButton = event.target.closest("[data-select-builder-clip]");
    const unloadBuilderClipButton = event.target.closest("[data-unload-builder-clip]");
    const unloadEditorClipButton = event.target.closest("[data-unload-editor-clip]");
    const moveBuilderUpButton = event.target.closest("[data-builder-move-up]");
    const moveBuilderDownButton = event.target.closest("[data-builder-move-down]");
    const editorPlayButton = event.target.closest("[data-editor-play]");
    const editorExportButton = event.target.closest("[data-editor-export]");
    const productReadyActionButton = event.target.closest("[data-product-ready-action]");
    const toggleProductionClipButton = event.target.closest("[data-toggle-production-clip]");
    const productionPageButton = event.target.closest("[data-production-page]");
    const editorCaptionActionButton = event.target.closest("[data-editor-caption-action]");
    const captionDebugActionButton = event.target.closest("[data-caption-debug-action]");
    const editorStickerPickButton = event.target.closest("[data-editor-sticker-pick]");
    const editorStickerClearButton = event.target.closest("[data-editor-sticker-clear]");
    const editorStickerSavePresetButton = event.target.closest("[data-editor-sticker-save-preset]");
    const editorStickerUsePresetButton = event.target.closest("[data-editor-sticker-use-preset]");
    const editorLayerBodyButton = event.target.closest("[data-editor-layer-body]");
    const editorLayerFullButton = event.target.closest("[data-editor-layer-full]");
    const editorLayerAtPlayheadButton = event.target.closest("[data-editor-layer-at-playhead]");
    const editorLoadSelectedButton = event.target.closest("[data-editor-load-selected]");
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
    if (workflowClipButton) {
      openWorkflowClip(workflowClipButton.dataset.workflowClip || "");
      return;
    }
    if (chooseOutputFolderButton) {
      chooseClipOutputFolder();
      return;
    }
    if (openOutputFolderButton) {
      openClipOutputFolder();
      return;
    }
    if (openLocalPathButton) {
      window.argentumDesktop?.openPath?.(openLocalPathButton.dataset.openLocalPath || "");
      return;
    }
    if (appViewButton) {
      setAppView(appViewButton.dataset.appView || "studio");
      return;
    }
    if (bufferTestButton) {
      loadBufferStatus({ test: true }).catch(() => {});
      return;
    }
    if (bufferPrepareButton) {
      prepareClipForBuffer(bufferPrepareButton.dataset.bufferPrepare || "");
      return;
    }
    if (bufferApproveButton) {
      approveClipBufferDraft(
        bufferApproveButton.dataset.bufferApprove || "",
        bufferApproveButton.dataset.bufferApprovalId || ""
      );
      return;
    }
    if (bufferCreateButton) {
      createApprovedBufferDraft(
        bufferCreateButton.dataset.bufferCreate || "",
        bufferCreateButton.dataset.bufferDraftId || "",
        bufferCreateButton.dataset.bufferApprovalId || ""
      );
      return;
    }
    if (bufferRevokeMediaButton) {
      revokeClipBufferMedia(
        bufferRevokeMediaButton.dataset.bufferRevokeMedia || "",
        bufferRevokeMediaButton.dataset.bufferDraftId || ""
      );
      return;
    }
    if (libraryFilterButton) {
      state.library.filter = libraryFilterButton.dataset.libraryFilter || "all";
      state.library.page = 0;
      state.editor.lastRenderSignature = "";
      renderClipsArea({ force: true });
      return;
    }
    if (libraryPageButton) {
      state.library.page = Math.max(0, Number(state.library.page || 0) + Number(libraryPageButton.dataset.libraryPage || 0));
      state.editor.lastRenderSignature = "";
      renderClipsArea({ force: true });
      return;
    }
    if (automationStageButton) {
      setAutomaticPipelineStage(Number(automationStageButton.dataset.automationStage || 0));
      return;
    }
    if (automationFocusButton) {
      saveServerAutomationSettings({
        enabled: true,
        focus: automationFocusButton.dataset.automationFocus,
        pipelineStage: "library"
      }).then(() => runFocusedAutomationScan()).catch(() => {});
      return;
    }
    if (automationScanButton) {
      runFocusedAutomationScan();
      return;
    }
    if (settingsFormatButton) {
      const nextFormat = settingsFormatButton.dataset.settingFormat || "9:16";
      if (Object.values(CLIP_FORMATS).some((format) => format.id === nextFormat)) {
        state.settings.outputFormat = nextFormat;
        localStorage.setItem(clipFormatStorageKey, nextFormat);
        state.editor.lastRenderSignature = "";
        renderDiscoverClips();
        renderClipsArea({ force: true });
        renderStatus(`Clip format set to ${nextFormat}`);
      }
      return;
    }
    if (libraryOpenEditorButton) {
      const clipId = libraryOpenEditorButton.dataset.libraryOpenEditor || "";
      state.editor.selectedBuilderClipId = clipId;
      localStorage.setItem("argentumEditorSelectedBuilderClipId", clipId);
      if (maybeAutoApplyEditorSticker(clipId)) scheduleEditorDraftSave(clipId);
      setAppView("studio");
      return;
    }
    if (libraryOpenReviewButton) {
      state.editor.expandedProductionClipId = libraryOpenReviewButton.dataset.libraryOpenReview || "";
      setAppView("review");
      return;
    }
    if (editorToolTabButton) {
      state.editor.toolTab = editorToolTabButton.dataset.editorToolTab === "sticker" ? "sticker" : "captions";
      localStorage.setItem("argentumEditorToolTab", state.editor.toolTab);
      state.editor.lastRenderSignature = "";
      renderClipsArea({ force: true });
      return;
    }
    if (editorTimelineToggleButton) {
      state.editor.timelineExpanded = !state.editor.timelineExpanded;
      localStorage.setItem("argentumEditorTimelineExpanded", String(state.editor.timelineExpanded));
      state.editor.lastRenderSignature = "";
      renderClipsArea({ force: true });
      return;
    }
    if (approveClipButton) {
      approveClipForBuilder(approveClipButton.dataset.approveClip);
      return;
    }
    if (declineClipButton) {
      declineClip(declineClipButton.dataset.declineClip);
      return;
    }
    if (unloadBuilderClipButton) {
      unloadEditorClip(unloadBuilderClipButton.dataset.unloadBuilderClip || "");
      return;
    }
    if (unloadEditorClipButton) {
      unloadEditorClip(unloadEditorClipButton.dataset.unloadEditorClip || "");
      return;
    }
    if (moveBuilderUpButton) {
      moveEditorBuilderClip(moveBuilderUpButton.dataset.builderMoveUp || "", -1);
      return;
    }
    if (moveBuilderDownButton) {
      moveEditorBuilderClip(moveBuilderDownButton.dataset.builderMoveDown || "", 1);
      return;
    }
    if (selectBuilderClipButton) {
      const clipId = selectBuilderClipButton.dataset.selectBuilderClip || "";
      state.editor.selectedBuilderClipId = clipId;
      localStorage.setItem("argentumEditorSelectedBuilderClipId", clipId);
      if (maybeAutoApplyEditorSticker(clipId)) scheduleEditorDraftSave(clipId);
      renderClipsArea();
      return;
    }
    if (editorPlayButton) {
      const video = editorVideoFor(editorPlayButton);
      if (!video) return;
      if (video.paused) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
      updateEditorTransport(video);
      return;
    }
    if (editorExportButton) {
      exportEditedClip(editorExportButton.dataset.editorExport);
      return;
    }
    if (productReadyActionButton) {
      updateProductReadyStatus(
        productReadyActionButton.dataset.productReadyClip || "",
        productReadyActionButton.dataset.productReadyAction || ""
      );
      return;
    }
    if (toggleProductionClipButton) {
      const clipId = toggleProductionClipButton.dataset.toggleProductionClip || "";
      state.editor.expandedProductionClipId = state.editor.expandedProductionClipId === clipId ? "" : clipId;
      renderClipsArea({ force: true });
      return;
    }
    if (productionPageButton) {
      const stage = productionPageButton.dataset.productionPage || "precheck";
      const direction = Number(productionPageButton.dataset.productionPageDirection || 0);
      state.editor.productionPages[stage] = Math.max(0, Number(state.editor.productionPages[stage] || 0) + direction);
      state.editor.expandedProductionClipId = "";
      renderClipsArea({ force: true });
      return;
    }
    if (editorCaptionActionButton) {
      const clipId = editorCaptionActionButton.dataset.editorCaptionClip || "";
      const action = editorCaptionActionButton.dataset.editorCaptionAction || "";
      if (action === "view") {
        state.editor.transcriptModalClipId = clipId;
        renderClipsArea({ force: true });
      }
      if (action === "reread") generateEditorCaptions(clipId, { forceTranscription: true });
      if (action === "generate") generateEditorCaptions(clipId);
      if (action === "clear") clearEditorCaptions(clipId);
      return;
    }
    if (captionDebugActionButton) {
      handleCaptionDebugAction(captionDebugActionButton);
      return;
    }
    if (closeEditorTranscript || editorTranscriptBackdrop) {
      state.editor.transcriptModalClipId = "";
      renderClipsArea({ force: true });
      return;
    }
    if (editorStickerPickButton) {
      pickEditorSticker(editorStickerPickButton.dataset.editorStickerPick);
      return;
    }
    if (editorStickerClearButton) {
      clearEditorSticker(editorStickerClearButton.dataset.editorStickerClear);
      return;
    }
    if (editorStickerSavePresetButton) {
      saveCurrentStickerPreset(editorStickerSavePresetButton.dataset.editorStickerSavePreset);
      return;
    }
    if (editorStickerUsePresetButton) {
      const card = editorStickerUsePresetButton.closest(".editor-sticker-card");
      const select = card?.querySelector?.("[data-editor-sticker-library]");
      applyEditorStickerPreset(editorStickerUsePresetButton.dataset.editorStickerUsePreset, select?.value || "");
      return;
    }
    if (editorLayerFullButton) {
      setEditorTimelineLayerFull(editorLayerFullButton.dataset.editorLayerClip, editorLayerFullButton.dataset.editorLayerFull);
      return;
    }
    if (editorLayerAtPlayheadButton) {
      setEditorTimelineLayerAtPlayhead(editorLayerAtPlayheadButton);
      return;
    }
    if (editorLayerBodyButton) {
      setEditorSelectedTimelineLayer(editorLayerBodyButton.dataset.editorLayerId);
      const layer = editorTimelineLayerById(editorLayerBodyButton.dataset.editorLayerClip, editorLayerBodyButton.dataset.editorLayerId);
      updateEditorTimelineLayerDom(editorLayerBodyButton.dataset.editorLayerClip, layer);
      return;
    }
    if (editorLoadSelectedButton) {
      loadSelectedEditorClip();
      return;
    }
    const autoEditClipButton = event.target.closest("[data-auto-edit-clip]");
    if (autoEditClipButton) {
      autoEditClipInCapCut(autoEditClipButton.dataset.autoEditClip);
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
    const journeyToggleButton = event.target.closest("[data-journey-toggle]");
    if (journeyToggleButton) {
      const clipId = journeyToggleButton.dataset.journeyToggle;
      if (state.openJourneys.has(clipId)) state.openJourneys.delete(clipId);
      else state.openJourneys.add(clipId);
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
    if (removeWatchButton) {
      event.preventDefault();
      event.stopPropagation();
      removeWatchSession(removeWatchButton.dataset.removeWatch);
      return;
    }
    if (removeClipButton) {
      event.preventDefault();
      event.stopPropagation();
      requestClipCandidateRemoval(removeClipButton.dataset.removeClip, removeClipButton);
      return;
    }
    if (closeClipRemovalButton || clipRemovalBackdrop) {
      closeClipRemovalModal();
      return;
    }
    if (confirmClipRemovalButton) {
      confirmClipCandidateRemoval();
      return;
    }
    if (refreshOfficeButton) {
      event.preventDefault();
      event.stopPropagation();
      refreshOffice();
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
      showMoreStreams();
      return;
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
      const detailSessionId = watchDetailButton.dataset.openWatchDetail || "";
      const selected = (state.watch.sessions || []).find((item) => item.id === detailSessionId);
      if (selected) {
        const selectedStream = (state.watch.streams || []).find((item) => item.sessionId === selected.id || item.id === selected.streamerId)
          || streamFromWatchSession(selected, {});
        state.watch.session = selected;
        state.watch.stream = selectedStream;
        state.watch.streamer = (state.watch.streamers || []).find((item) => item.id === selected.streamerId) || state.watch.streamer;
        state.watch.events = (state.watch.allEvents || []).filter((event) => event.sessionId === selected.id);
      }
      state.watch.detailOpen = true;
      renderWatchArea();
    }
    if (closeWatchDetail || watchDetailBackdrop) {
      state.watch.detailOpen = false;
      renderWatchArea();
    }
  });
  document.addEventListener("input", (event) => {
    const input = event.target.closest?.("[data-library-search]");
    if (!input) return;
    const value = input.value;
    state.library.query = value;
    state.library.page = 0;
    state.editor.lastRenderSignature = "";
    renderClipsArea({ force: true });
    const restored = document.querySelector("[data-library-search]");
    if (restored) {
      restored.focus();
      restored.setSelectionRange(value.length, value.length);
    }
  });
  document.addEventListener("dragstart", (event) => {
    const builderCard = event.target.closest?.("[data-builder-drag-clip]");
    if (builderCard && !event.target.closest?.("button")) {
      builderCard.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", builderCard.dataset.builderDragClip || "");
      return;
    }
    const card = event.target.closest?.("[data-macro-card]");
    if (!card || state.capcut.replay?.running || event.target.closest?.("button")) return;
    state.capcut.dragMacroId = card.dataset.macroId || "";
    card.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", state.capcut.dragMacroId);
  });
  document.addEventListener("dragover", (event) => {
    const editorDropZone = event.target.closest?.("[data-editor-drop-zone]");
    const carriesFiles = Array.from(event.dataTransfer?.types || []).includes("Files");
    if (editorDropZone && carriesFiles) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      editorDropZone.classList.add("is-dragging-file");
      return;
    }
    const builderTarget = event.target.closest?.("[data-builder-drag-clip]");
    const builderDragging = document.querySelector("[data-builder-drag-clip].dragging");
    if (builderTarget && builderDragging && builderTarget !== builderDragging) {
      event.preventDefault();
      builderTarget.classList.add("drop-target");
      return;
    }
    const list = event.target.closest?.(".macro-list");
    const dragging = document.querySelector(".macro-card.dragging");
    if (!list || !dragging) return;
    event.preventDefault();
    const cards = [...list.querySelectorAll("[data-macro-card]:not(.dragging)")];
    const after = cards.find((card) => event.clientY < card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2);
    if (after) list.insertBefore(dragging, after);
    else list.appendChild(dragging);
  });
  document.addEventListener("dragleave", (event) => {
    const editorDropZone = event.target.closest?.("[data-editor-drop-zone]");
    if (editorDropZone && !editorDropZone.contains(event.relatedTarget)) {
      editorDropZone.classList.remove("is-dragging-file");
    }
  });
  document.addEventListener("drop", async (event) => {
    const editorDropZone = event.target.closest?.("[data-editor-drop-zone]");
    const editorVideoFile = event.dataTransfer?.files?.[0];
    if (editorDropZone && editorVideoFile) {
      event.preventDefault();
      editorDropZone.classList.remove("is-dragging-file");
      await loadEditorVideoFile(editorVideoFile);
      return;
    }
    const builderTarget = event.target.closest?.("[data-builder-drag-clip]");
    const builderDragging = document.querySelector("[data-builder-drag-clip].dragging");
    if (builderTarget && builderDragging && builderTarget !== builderDragging) {
      event.preventDefault();
      moveEditorBuilderClipBefore(
        builderDragging.dataset.builderDragClip || "",
        builderTarget.dataset.builderDragClip || ""
      );
      builderDragging.classList.remove("dragging");
      document.querySelectorAll("[data-builder-drag-clip].drop-target").forEach((item) => item.classList.remove("drop-target"));
      return;
    }
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
    event.target.closest?.("[data-builder-drag-clip]")?.classList.remove("dragging", "drop-target");
    document.querySelectorAll("[data-builder-drag-clip].drop-target").forEach((item) => item.classList.remove("drop-target"));
    event.target.closest?.("[data-macro-card]")?.classList.remove("dragging");
    state.capcut.dragMacroId = "";
  });
  document.addEventListener("pointerdown", (event) => {
    const target = event.target.closest?.("[data-editor-layer-handle], [data-editor-layer-body]");
    if (!target) return;
    startEditorTimelineDrag(target, event);
  });
  document.addEventListener("pointermove", (event) => {
    if (!state.editor.timelineDrag) return;
    updateEditorTimelineDrag(event);
  });
  document.addEventListener("pointerup", () => finishEditorTimelineDrag());
  document.addEventListener("pointercancel", () => finishEditorTimelineDrag());
  document.addEventListener("input", (event) => {
    const editorScrub = event.target?.closest?.("[data-editor-scrub]");
    if (editorScrub) {
      const video = editorVideoFor(editorScrub);
      if (video) {
        video.currentTime = Number(editorScrub.value || 0);
        updateEditorTransport(video);
        updateEditorAutoReframe(video, true, { allowPaused: true });
      }
      return;
    }
    const editorLayerInput = event.target?.closest?.("[data-editor-layer-field]");
    if (editorLayerInput) {
      updateEditorTimelineLayerFromControl(editorLayerInput);
      return;
    }
    const editorStickerInput = event.target?.closest?.("[data-editor-sticker-field]");
    if (editorStickerInput) {
      updateEditorStickerFromControl(editorStickerInput);
      return;
    }
    if (event.target?.id === "capcut-macro-name") {
      state.capcut.macroName = event.target.value;
      localStorage.setItem("capcutMacroName", state.capcut.macroName);
    }
    if (event.target?.matches?.("[data-workflow-input]")) {
      workflowInputsFromDom();
    }
  });
  document.addEventListener("input", (event) => {
    const automationStageRange = event.target?.closest?.("[data-automation-stage-range]");
    if (automationStageRange) previewAutomaticPipelineStage(automationStageRange);
  });
  document.addEventListener("change", (event) => {
    const automationStageRange = event.target?.closest?.("[data-automation-stage-range]");
    if (automationStageRange) {
      setAutomaticPipelineStage(Number(automationStageRange.value || 0));
      return;
    }
    const autoPipelineToggle = event.target?.closest?.("[data-auto-pipeline-toggle]");
    if (autoPipelineToggle) {
      setAutomaticPipelineStage(autoPipelineToggle.checked ? AUTOMATION_STAGES.length - 1 : 0);
      return;
    }
    const editorStickerUpload = event.target?.closest?.("[data-editor-sticker-upload]");
    if (editorStickerUpload) {
      readEditorStickerFile(editorStickerUpload);
    }
    const editorClipUpload = event.target?.closest?.("[data-editor-upload-clip]");
    if (editorClipUpload) {
      if (editorClipUpload.closest(".product-create") && state.activeView !== "studio") {
        setAppView("studio");
      }
      loadEditorUploadedClip(editorClipUpload);
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
  syncAppShell();
  await initializeClippingOffice();
  await loadClipOutputFolder().catch(() => {});
  window.setInterval(() => {
    if (state.capcut.teach?.recording || state.capcut.replay?.running) {
      loadTeachState();
    }
  }, 2000);
  startWatchPolling();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) pollWatchStateOnce();
  });
  renderClipsArea();
});

window.addEventListener("hashchange", () => {
  const view = String(window.location.hash || "").replace(/^#/, "");
  if (APP_VIEWS.has(view) && view !== state.activeView) setAppView(view, { updateHash: false });
});

const DEFAULT_SIGNAL_LIMIT = 3;
const DEFAULT_RECORDING_WINDOW_LIMIT = 60;
const DEFAULT_OVERVIEW_MAX_BYTES = 1024 * 1024;
const OVERVIEW_SCHEMA_VERSION = 1;
const ACTIVE_WATCH_STATUSES = new Set(["queued", "starting", "connecting", "watching", "degraded", "reconnecting"]);

function boundedInteger(value, fallback, minimum = 1, maximum = 2000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

function keepNewest(value, limit) {
  return Array.isArray(value) ? value.slice(-limit) : [];
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, limit = 300) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, limit);
}

function recordTimestamp(value = {}) {
  return Date.parse(value.heartbeatAt || value.updatedAt || value.startedAt || value.createdAt || "") || 0;
}

function prioritizedWatchSessions(value) {
  return [...list(value)].sort((left, right) => {
    const activeDifference = Number(ACTIVE_WATCH_STATUSES.has(text(right?.status, 60).toLowerCase()))
      - Number(ACTIVE_WATCH_STATUSES.has(text(left?.status, 60).toLowerCase()));
    return activeDifference || recordTimestamp(right) - recordTimestamp(left);
  });
}

function prioritizedStreamers(value, sessions) {
  const activeStreamerIds = new Set(sessions
    .filter((session) => ACTIVE_WATCH_STATUSES.has(text(session?.status, 60).toLowerCase()))
    .map((session) => text(session?.streamerId, 180))
    .filter(Boolean));
  return [...list(value)].sort((left, right) => {
    const leftPriority = (activeStreamerIds.has(text(left?.id, 180)) ? 2 : 0) + (left?.monitorEnabled === true ? 1 : 0);
    const rightPriority = (activeStreamerIds.has(text(right?.id, 180)) ? 2 : 0) + (right?.monitorEnabled === true ? 1 : 0);
    return rightPriority - leftPriority || recordTimestamp(right) - recordTimestamp(left);
  });
}

function projectAutomation(value = {}) {
  const sourceIntegrity = value.sourceIntegrity && typeof value.sourceIntegrity === "object"
    ? value.sourceIntegrity
    : {};
  return {
    enabled: value.enabled === true,
    pipelineStage: text(value.pipelineStage, 40),
    focus: text(value.focus, 80),
    focusLabel: text(value.focusLabel, 120),
    scanIntervalSeconds: Number(value.scanIntervalSeconds || 0),
    maxAutoStreams: Number(value.maxAutoStreams || 0),
    maxProviderPages: Number(value.maxProviderPages || 0),
    status: text(value.status, 80),
    workerStatus: text(value.workerStatus, 80),
    workerClipId: text(value.workerClipId, 180),
    workerProgress: Number(value.workerProgress || 0),
    workerStage: text(value.workerStage, 120),
    workerDetail: text(value.workerDetail, 300),
    workerLastFailure: value.workerLastFailure && typeof value.workerLastFailure === "object"
      ? {
        clipId: text(value.workerLastFailure.clipId, 160),
        error: text(value.workerLastFailure.error, 300),
        at: value.workerLastFailure.at || null
      }
      : null,
    lastScanAt: value.lastScanAt || null,
    nextScanAt: value.nextScanAt || null,
    scannedStreams: Number(value.scannedStreams || 0),
    matchedStreams: Number(value.matchedStreams || 0),
    activeFocusedStreams: Number(value.activeFocusedStreams || 0),
    lastError: text(value.lastError, 300),
    providerPages: value.providerPages && typeof value.providerPages === "object" ? value.providerPages : {},
    providerErrors: list(value.providerErrors).slice(0, 10).map((entry) => text(entry, 200)),
    scanTruncated: value.scanTruncated === true,
    sourceIntegrity: {
      status: text(sourceIntegrity.status, 40),
      missingProductionSources: Number(sourceIntegrity.missingProductionSources || 0),
      checkedAt: sourceIntegrity.checkedAt || null,
      detail: text(sourceIntegrity.detail, 300)
    },
    updatedAt: value.updatedAt || null
  };
}

function projectStreamer(value = {}) {
  const metadata = value.officialLiveMetadata && typeof value.officialLiveMetadata === "object"
    ? value.officialLiveMetadata
    : null;
  return {
    id: text(value.id, 180),
    displayName: text(value.displayName, 160),
    name: text(value.name, 160),
    login: text(value.login, 160),
    channelId: text(value.channelId, 180),
    channelUrl: text(value.channelUrl, 500),
    platform: text(value.platform, 40),
    permissionStatus: text(value.permissionStatus, 60),
    monitorEnabled: value.monitorEnabled === true,
    monitorPausedAt: value.monitorPausedAt || null,
    isDemo: value.isDemo === true,
    sourceMode: text(value.sourceMode, 60),
    allowedUse: list(value.allowedUse).slice(0, 8).map((entry) => text(entry, 60)),
    liveStatus: text(value.liveStatus, 60),
    liveTitle: text(value.liveTitle, 240),
    liveCategory: text(value.liveCategory, 120),
    liveViewerCount: Number(value.liveViewerCount || value.viewers || 0),
    viewers: Number(value.viewers || value.liveViewerCount || 0),
    thumbnailUrl: text(value.thumbnailUrl, 600),
    lastCheckedAt: value.lastCheckedAt || null,
    updatedAt: value.updatedAt || null,
    officialLiveMetadata: metadata ? {
      title: text(metadata.title, 240),
      category: text(metadata.category, 120),
      viewerCount: Number(metadata.viewerCount || 0),
      thumbnail: text(metadata.thumbnail, 600),
      source: text(metadata.source, 80),
      verifiedAt: metadata.verifiedAt || null
    } : null
  };
}

function projectWatchSession(value = {}) {
  const rollingBuffer = value.rollingBuffer && typeof value.rollingBuffer === "object" ? value.rollingBuffer : {};
  return {
    id: text(value.id, 180),
    streamerId: text(value.streamerId, 180),
    streamerName: text(value.streamerName, 160),
    platform: text(value.platform, 40),
    status: text(value.status, 60),
    mode: text(value.mode, 40),
    sourceId: text(value.sourceId, 180),
    workerId: text(value.workerId, 180),
    heartbeatAt: value.heartbeatAt || null,
    leaseExpiresAt: value.leaseExpiresAt || null,
    startedAt: value.startedAt || null,
    connectedAt: value.connectedAt || null,
    lastMediaAt: value.lastMediaAt || null,
    updatedAt: value.updatedAt || null,
    currentStage: text(value.currentStage, 240),
    streamTitle: text(value.streamTitle, 240),
    category: text(value.category, 120),
    viewerCount: Number(value.viewerCount || 0),
    lastChatMessagesPerMinute: Number(value.lastChatMessagesPerMinute || 0),
    captureStatus: text(value.captureStatus, 60),
    errorCode: text(value.errorCode, 80),
    errorMessage: text(value.errorMessage, 300),
    rollingBuffer: {
      running: rollingBuffer.running === true,
      bufferedSeconds: Number(rollingBuffer.bufferedSeconds || 0),
      retentionSeconds: Number(rollingBuffer.retentionSeconds || 0),
      updatedAt: rollingBuffer.updatedAt || null
    }
  };
}

function projectCandidate(value = {}) {
  const draft = value.builderDraft && typeof value.builderDraft === "object" ? value.builderDraft : null;
  const editorState = draft?.editorState && typeof draft.editorState === "object" ? draft.editorState : {};
  const workflow = value.productionWorkflow && typeof value.productionWorkflow === "object" ? value.productionWorkflow : null;
  const caption = value.editorialCaption && typeof value.editorialCaption === "object" ? value.editorialCaption : null;
  const sourceIntegrity = value.sourceIntegrity && typeof value.sourceIntegrity === "object" ? value.sourceIntegrity : null;
  return {
    id: text(value.id, 180),
    watchSessionId: text(value.watchSessionId, 180),
    streamerId: text(value.streamerId, 180),
    streamerName: text(value.streamerName, 160),
    creatorName: text(value.creatorName, 160),
    sourceId: text(value.sourceId, 180),
    sourceType: text(value.sourceType, 80),
    sourceProvenance: text(value.sourceProvenance, 80),
    provenance: text(value.provenance, 80),
    title: text(value.title, 300),
    status: text(value.status, 80),
    decision: text(value.decision, 80),
    qualityScore: value.qualityScore !== null && value.qualityScore !== undefined && value.qualityScore !== "" && Number.isFinite(Number(value.qualityScore))
      ? Number(value.qualityScore)
      : null,
    score: value.score !== null && value.score !== undefined && value.score !== "" && Number.isFinite(Number(value.score))
      ? Number(value.score)
      : null,
    durationSeconds: value.durationSeconds !== null && value.durationSeconds !== undefined && value.durationSeconds !== "" && Number.isFinite(Number(value.durationSeconds))
      ? Number(value.durationSeconds)
      : null,
    duration: value.duration !== null && value.duration !== undefined && value.duration !== "" && Number.isFinite(Number(value.duration))
      ? Number(value.duration)
      : null,
    operatorDeclined: value.operatorDeclined === true,
    declinedAt: value.declinedAt || null,
    builderApproved: value.builderApproved === true,
    builderStatus: text(value.builderStatus, 80),
    builderDraft: draft ? {
      updatedAt: draft.updatedAt || null,
      editorState: {
        captions: { enabled: editorState.captions?.enabled === true },
        sticker: { enabled: editorState.sticker?.enabled === true }
      }
    } : null,
    productionWorkflow: workflow ? {
      stage: text(workflow.stage, 80),
      status: text(workflow.status, 80),
      localLibraryPath: text(workflow.localLibraryPath, 700),
      playbackUrl: text(workflow.playbackUrl, 700),
      postingStatus: text(workflow.postingStatus, 80),
      updatedAt: workflow.updatedAt || null
    } : null,
    editorialCaption: caption ? {
      primary_caption: text(caption.primary_caption, 300),
      text: text(caption.text, 300)
    } : null,
    thumbnailUrl: text(value.thumbnailUrl, 700),
    playbackUrl: text(value.playbackUrl, 700),
    sourceIntegrity: sourceIntegrity ? { status: text(sourceIntegrity.status, 60) } : null,
    createdAt: value.createdAt || null,
    updatedAt: value.updatedAt || null
  };
}

function projectStatusRecord(value = {}) {
  return {
    id: text(value.id, 180),
    candidateId: text(value.candidateId, 180),
    projectId: text(value.projectId, 180),
    type: text(value.type, 100),
    kind: text(value.kind, 100),
    status: text(value.status, 80),
    approvalStatus: text(value.approvalStatus, 80),
    playbackUrl: text(value.playbackUrl, 700),
    localPath: text(value.localPath, 700),
    filePath: text(value.filePath, 700),
    error: text(value.error, 300),
    createdAt: value.createdAt || null,
    updatedAt: value.updatedAt || null
  };
}

function projectWatchEvent(value = {}) {
  const payload = value.payload && typeof value.payload === "object" ? value.payload : {};
  return {
    id: text(value.id, 180),
    sessionId: text(value.sessionId, 180),
    sequence: Number(value.sequence || 0),
    type: text(value.type, 100),
    payload: {
      channel: text(payload.channel, 160),
      message: text(payload.message, 300),
      messagesPerMinute: Number(payload.messagesPerMinute || 0),
      matchedKeywords: list(payload.matchedKeywords).slice(0, 12).map((entry) => text(entry, 80))
    },
    createdAt: value.createdAt || null
  };
}

function trimOverviewToBudget(overview, maxBytes) {
  const budget = boundedInteger(maxBytes, DEFAULT_OVERVIEW_MAX_BYTES, 64 * 1024, 4 * 1024 * 1024);
  const trimOrder = [
    "watchEvents",
    "artifacts",
    "mediaJobs",
    "approvalRequests",
    "postingDrafts",
    "clipPackages",
    "clipCandidates",
    "watchSessions",
    "streamers"
  ];
  let encodedBytes = Buffer.byteLength(JSON.stringify(overview), "utf8");
  while (encodedBytes > budget) {
    const populated = trimOrder
      .map((key) => ({ key, length: overview[key].length }))
      .filter((entry) => entry.length > 0)
      .sort((left, right) => right.length - left.length)[0];
    if (!populated) break;
    const pressure = Math.max(0.05, Math.min(0.5, 1 - (budget / encodedBytes)));
    const removeCount = Math.max(1, Math.ceil(populated.length * pressure));
    if (populated.key === "watchEvents") overview[populated.key].splice(0, removeCount);
    else overview[populated.key].splice(Math.max(0, populated.length - removeCount), removeCount);
    encodedBytes = Buffer.byteLength(JSON.stringify(overview), "utf8");
  }
  return overview;
}

export function compactWatchWindowSignals(value, signalLimit = DEFAULT_SIGNAL_LIMIT) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const limit = boundedInteger(signalLimit, DEFAULT_SIGNAL_LIMIT, 1, 20);
  return {
    ...value,
    chatSpikes: keepNewest(value.chatSpikes, limit),
    chatKeywords: keepNewest(value.chatKeywords, limit)
  };
}

// Mutates and returns the supplied parsed state object. It has no filesystem,
// process, timer, or network side effects so backup-first offline tools can use
// it without importing the Clipping Office runtime.
export function compactStateForMemory(targetState, {
  maxRecordingWindows = DEFAULT_RECORDING_WINDOW_LIMIT,
  watchSignalLimit = DEFAULT_SIGNAL_LIMIT
} = {}) {
  if (!targetState || typeof targetState !== "object" || Array.isArray(targetState)) return targetState;
  const recordingWindowLimit = boundedInteger(maxRecordingWindows, DEFAULT_RECORDING_WINDOW_LIMIT);
  const signalLimit = boundedInteger(watchSignalLimit, DEFAULT_SIGNAL_LIMIT, 1, 20);

  for (const source of Array.isArray(targetState.mediaSources) ? targetState.mediaSources : []) {
    if (!source || typeof source !== "object" || !source.watchWindowSignals) continue;
    source.watchWindowSignals = compactWatchWindowSignals(source.watchWindowSignals, signalLimit);
  }

  for (const session of Array.isArray(targetState.watchSessions) ? targetState.watchSessions : []) {
    if (!session || typeof session !== "object") continue;
    if (Array.isArray(session.recordingWindows)) {
      session.recordingWindows = [...session.recordingWindows]
        .sort((left, right) => Number(right?.index ?? right?.recordingWindowIndex ?? -1) - Number(left?.index ?? left?.recordingWindowIndex ?? -1))
        .slice(0, recordingWindowLimit);
    }
    if (Array.isArray(session.deletedRecordingWindows)) {
      session.deletedRecordingWindows = session.deletedRecordingWindows.slice(-recordingWindowLimit);
    }
    if (session.watchWindowSignals) {
      session.watchWindowSignals = compactWatchWindowSignals(session.watchWindowSignals, signalLimit);
    }
    if (Array.isArray(session.chatSpikes)) session.chatSpikes = keepNewest(session.chatSpikes, signalLimit);
    if (Array.isArray(session.chatKeywords)) session.chatKeywords = keepNewest(session.chatKeywords, signalLimit);
    if (Array.isArray(session.trendingChatPhrases)) {
      session.trendingChatPhrases = session.trendingChatPhrases.slice(0, 8);
    }
  }

  return targetState;
}

// Dashboard-only projection. Automation and media processing must continue to
// use the authoritative state.json payload rather than this size-limited view.
export function createStateOverview(targetState, {
  sourceUpdatedAt = new Date().toISOString(),
  maxBytes = DEFAULT_OVERVIEW_MAX_BYTES
} = {}) {
  const source = targetState && typeof targetState === "object" && !Array.isArray(targetState)
    ? targetState
    : {};
  const prioritizedSessions = prioritizedWatchSessions(source.watchSessions);
  const prioritizedStreamerRecords = prioritizedStreamers(source.streamers, prioritizedSessions);
  const overview = {
    schemaVersion: OVERVIEW_SCHEMA_VERSION,
    sourceUpdatedAt,
    automation: projectAutomation(source.automation),
    streamers: prioritizedStreamerRecords.map(projectStreamer),
    watchSessions: prioritizedSessions.map(projectWatchSession),
    clipCandidates: list(source.clipCandidates).map(projectCandidate),
    clipPackages: list(source.clipPackages).map(projectStatusRecord),
    postingDrafts: list(source.postingDrafts).map(projectStatusRecord),
    approvalRequests: list(source.approvalRequests).map(projectStatusRecord),
    mediaJobs: list(source.mediaJobs).map(projectStatusRecord),
    artifacts: list(source.artifacts).map(projectStatusRecord),
    watchEvents: list(source.watchEvents).slice(-100).map(projectWatchEvent),
    sourceCounts: {
      streamers: list(source.streamers).length,
      watchSessions: list(source.watchSessions).length,
      clipCandidates: list(source.clipCandidates).length,
      clipPackages: list(source.clipPackages).length,
      postingDrafts: list(source.postingDrafts).length,
      approvalRequests: list(source.approvalRequests).length,
      mediaJobs: list(source.mediaJobs).length,
      artifacts: list(source.artifacts).length,
      watchEvents: list(source.watchEvents).length
    }
  };
  return trimOverviewToBudget(overview, maxBytes);
}

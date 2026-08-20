const crypto = require("node:crypto");

const ACTIVE_STATUSES = new Set(["queued", "running", "verifying", "waiting_approval", "recovering"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "blocked"]);

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
}

function cleanText(value, limit = 4000) {
  return String(value ?? "").trim().slice(0, limit);
}

function normalizeMission(mission = {}) {
  const createdAt = mission.createdAt && !Number.isNaN(Date.parse(mission.createdAt)) ? mission.createdAt : now();
  const status = [...ACTIVE_STATUSES, ...TERMINAL_STATUSES, "paused"].includes(mission.status) ? mission.status : "queued";
  return {
    id: cleanText(mission.id || id("agent101-mission"), 180),
    sessionId: cleanText(mission.sessionId || id("agent101-session"), 180),
    runId: mission.runId ? cleanText(mission.runId, 180) : null,
    threadId: mission.threadId ? cleanText(mission.threadId, 180) : null,
    title: cleanText(mission.title || mission.goal || "Agent 101 mission", 160),
    goal: cleanText(mission.goal || "", 12_000),
    status,
    stage: cleanText(mission.stage || status, 120),
    provider: cleanText(mission.provider || "pending", 80),
    model: cleanText(mission.model || "pending", 120),
    progress: Math.max(0, Math.min(100, Number(mission.progress || 0))),
    iteration: Math.max(0, Number(mission.iteration || 0)),
    maxIterations: Math.max(1, Math.min(100, Number(mission.maxIterations || 25))),
    attempts: Math.max(0, Number(mission.attempts || 0)),
    autoResume: mission.autoResume !== false,
    cancellable: !TERMINAL_STATUSES.has(status),
    events: Array.isArray(mission.events) ? mission.events.slice(-500) : [],
    checkpoints: Array.isArray(mission.checkpoints) ? mission.checkpoints.slice(-100) : [],
    outputFiles: Array.isArray(mission.outputFiles) ? mission.outputFiles.slice(0, 500) : [],
    toolCallCount: Math.max(0, Number(mission.toolCallCount || 0)),
    costEstimateUsd: Math.max(0, Number(mission.costEstimateUsd || 0)),
    response: cleanText(mission.response || "", 60_000),
    error: mission.error ? cleanText(mission.error, 8000) : null,
    approvalIds: Array.isArray(mission.approvalIds) ? [...new Set(mission.approvalIds.map((item) => cleanText(item, 180)).filter(Boolean))] : [],
    createdAt,
    queuedAt: mission.queuedAt || createdAt,
    startedAt: mission.startedAt || null,
    updatedAt: mission.updatedAt || createdAt,
    completedAt: mission.completedAt || null,
  };
}

function normalizeMissionState(state) {
  const normalized = (Array.isArray(state.agent101Missions) ? state.agent101Missions : [])
    .map(normalizeMission)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const active = normalized.filter((mission) => !TERMINAL_STATUSES.has(mission.status));
  const terminal = normalized.filter((mission) => TERMINAL_STATUSES.has(mission.status)).slice(0, Math.max(0, 200 - active.length));
  state.agent101Missions = [...active, ...terminal].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return state.agent101Missions;
}

function createMission(state, payload = {}) {
  const goal = cleanText(payload.goal || payload.message, 12_000);
  if (!goal) throw new Error("Agent 101 mission goal is required.");
  const mission = normalizeMission({
    id: payload.id || id("agent101-mission"),
    sessionId: payload.sessionId || id("agent101-session"),
    threadId: payload.threadId || null,
    title: payload.title || goal.split(/\s+/).slice(0, 9).join(" "),
    goal,
    status: "queued",
    stage: "intake",
    maxIterations: payload.maxIterations || 25,
    autoResume: payload.autoResume !== false,
    createdAt: now(),
  });
  appendEvent(mission, "mission_queued", "Mission queued for Agent 101 Studio.", { status: "queued" });
  const existing = normalizeMissionState(state);
  const combined = [mission, ...existing.filter((item) => item.id !== mission.id)];
  const active = combined.filter((item) => !TERMINAL_STATUSES.has(item.status));
  const terminal = combined.filter((item) => TERMINAL_STATUSES.has(item.status)).slice(0, Math.max(0, 200 - active.length));
  state.agent101Missions = [...active, ...terminal].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return mission;
}

function appendEvent(mission, type, message, details = {}) {
  const event = {
    id: id("agent101-mission-event"),
    sequence: (mission.events?.at(-1)?.sequence || 0) + 1,
    type: cleanText(type, 100),
    message: cleanText(message, 2000),
    details: details && typeof details === "object" ? details : {},
    createdAt: now(),
  };
  mission.events = Array.isArray(mission.events) ? mission.events : [];
  mission.events.push(event);
  mission.events = mission.events.slice(-500);
  mission.updatedAt = event.createdAt;
  if (Number.isFinite(Number(details.iteration))) mission.iteration = Number(details.iteration) + 1;
  if (details.stage) mission.stage = cleanText(details.stage, 120);
  const iterationProgress = mission.maxIterations ? (mission.iteration / mission.maxIterations) * 90 : 0;
  if (!TERMINAL_STATUSES.has(mission.status)) mission.progress = Math.max(mission.progress || 0, Math.min(94, Math.round(iterationProgress)));
  return event;
}

function checkpoint(mission, payload = {}) {
  const point = {
    id: id("agent101-checkpoint"),
    stage: cleanText(payload.stage || mission.stage || mission.status, 120),
    eventSequence: mission.events?.at(-1)?.sequence || 0,
    toolCallCount: Math.max(0, Number(payload.toolCallCount || mission.toolCallCount || 0)),
    outputFileCount: Math.max(0, Number(payload.outputFileCount || mission.outputFiles?.length || 0)),
    summary: cleanText(payload.summary || "Durable mission checkpoint.", 2000),
    createdAt: now(),
  };
  mission.checkpoints = Array.isArray(mission.checkpoints) ? mission.checkpoints : [];
  mission.checkpoints.push(point);
  mission.checkpoints = mission.checkpoints.slice(-100);
  mission.updatedAt = point.createdAt;
  return point;
}

function transition(mission, status, payload = {}) {
  if (![...ACTIVE_STATUSES, ...TERMINAL_STATUSES, "paused"].includes(status)) throw new Error(`Unsupported mission status: ${status}`);
  if (TERMINAL_STATUSES.has(mission.status) && mission.status !== status) throw new Error("A completed Agent 101 mission cannot transition to a new state.");
  mission.status = status;
  mission.stage = cleanText(payload.stage || status, 120);
  mission.updatedAt = now();
  mission.cancellable = !TERMINAL_STATUSES.has(status);
  if (status === "running" || status === "recovering") {
    mission.startedAt ||= mission.updatedAt;
    mission.attempts = Math.max(1, Number(mission.attempts || 0) + (status === "running" ? 1 : 0));
  }
  if (TERMINAL_STATUSES.has(status)) {
    mission.completedAt = mission.updatedAt;
    mission.progress = status === "completed" ? 100 : mission.progress;
  }
  if (payload.error !== undefined) mission.error = payload.error ? cleanText(payload.error, 8000) : null;
  if (payload.response !== undefined) mission.response = cleanText(payload.response, 60_000);
  appendEvent(mission, `mission_${status}`, payload.message || `Mission ${status}.`, { ...payload, status });
  checkpoint(mission, { stage: mission.stage, summary: payload.message || `Mission ${status}.` });
  return mission;
}

function resumable(mission, approvals = []) {
  if (["queued", "paused", "recovering"].includes(mission.status)) return true;
  if (mission.status !== "waiting_approval") return false;
  const byId = new Map((approvals || []).map((approval) => [approval.id, approval]));
  return mission.approvalIds.length > 0 && mission.approvalIds.every((approvalId) => byId.get(approvalId)?.status === "approved");
}

function publicMission(mission, options = {}) {
  const includeEvents = options.includeEvents !== false;
  const approvals = Array.isArray(options.approvals) ? options.approvals : [];
  const linked = approvals.filter((approval) => mission.approvalIds.includes(approval.id));
  return {
    ...mission,
    events: includeEvents ? mission.events : undefined,
    latestEvent: mission.events?.at(-1) || null,
    active: ACTIVE_STATUSES.has(mission.status),
    terminal: TERMINAL_STATUSES.has(mission.status),
    resumable: resumable(mission, approvals),
    approvalSummary: {
      total: linked.length,
      pending: linked.filter((approval) => approval.status === "pending").length,
      approved: linked.filter((approval) => approval.status === "approved").length,
      needsRevision: linked.filter((approval) => approval.status === "needs_revision").length,
      blocked: linked.filter((approval) => ["blocked", "rejected"].includes(approval.status)).length,
    },
  };
}

module.exports = {
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  normalizeMission,
  normalizeMissionState,
  createMission,
  appendEvent,
  checkpoint,
  transition,
  resumable,
  publicMission,
};

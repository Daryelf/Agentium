import http from "node:http";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { createBrowserWorkspace } from "./services/browser-workspace.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "data", "state.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const execFileAsync = promisify(execFile);
const ffmpegExecutable = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";
const ffprobeExecutable = process.env.FFPROBE_PATH || ffprobeStatic?.path || "ffprobe";
const DEMO_MEDIA_SOURCE_ID = "media_demo_clipping_source";
const DEMO_PROJECT_ID = "project_clipping_office_main";
const DEMO_STREAMER_ID = "streamer_demo_media_source";
const DEMO_MEDIA_FILE = path.join(PUBLIC_DIR, "demo", "demo-source.mp4");
const DEMO_FRAME_DIR = path.join(PUBLIC_DIR, "demo");

const PROVENANCE = {
  VERIFIED_API: "VERIFIED_API",
  AUTHORIZED_UPLOAD: "AUTHORIZED_UPLOAD",
  VERIFIED_MEDIA: "VERIFIED_MEDIA",
  LIVE_SOURCE: "LIVE_SOURCE",
  VOD_SOURCE: "VOD_SOURCE",
  DEMO_SOURCE: "DEMO_SOURCE",
  AI_GENERATED: "AI_GENERATED",
  USER_ENTERED: "USER_ENTERED",
  UNAVAILABLE: "UNAVAILABLE"
};

const config = {
  port: Number(process.env.PORT || 4177),
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  aiProvider: process.env.AI_PROVIDER || "openai",
  aiMode: process.env.AI_MODE || "live",
  twitchClientId: process.env.TWITCH_CLIENT_ID || "",
  twitchClientSecret: process.env.TWITCH_CLIENT_SECRET || "",
  twitchRedirectUri: process.env.TWITCH_REDIRECT_URI || "",
  twitchOAuthToken: process.env.TWITCH_OAUTH_TOKEN || "",
  twitchAppAccessToken: process.env.TWITCH_APP_ACCESS_TOKEN || "",
  twitchUserAccessToken: process.env.TWITCH_USER_ACCESS_TOKEN || "",
  twitchRefreshToken: process.env.TWITCH_REFRESH_TOKEN || "",
  twitchAllowedChannels: (process.env.TWITCH_ALLOWED_CHANNELS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
  kickClientId: process.env.KICK_CLIENT_ID || "",
  kickClientSecret: process.env.KICK_CLIENT_SECRET || "",
  kickOAuthToken: process.env.KICK_OAUTH_TOKEN || "",
  databaseUrl: process.env.DATABASE_URL || "",
  redisUrl: process.env.REDIS_URL || "",
  objectStorageBucket: process.env.S3_BUCKET || process.env.AWS_BUCKET || process.env.MINIO_BUCKET || "",
  uploadDir: path.resolve(__dirname, process.env.CLIPPER_UPLOAD_DIR || "./uploads"),
  outputDir: path.resolve(__dirname, process.env.CLIPPER_OUTPUT_DIR || "./outputs"),
  browserEnabled: process.env.BROWSER_ENABLED !== "false",
  browserHeadless: process.env.BROWSER_HEADLESS !== "false",
  browserAllowLocalhost: process.env.BROWSER_ALLOW_LOCALHOST !== "false",
  browserProfileDir: path.resolve(__dirname, process.env.BROWSER_PROFILE_DIR || "./data/browser-profile"),
  browserDownloadsDir: path.resolve(__dirname, process.env.BROWSER_DOWNLOAD_DIR || "./downloads/browser"),
  browserViewport: {
    width: Number(process.env.BROWSER_VIEWPORT_WIDTH || 1440),
    height: Number(process.env.BROWSER_VIEWPORT_HEIGHT || 900)
  },
  browserNavigationTimeoutMs: Number(process.env.BROWSER_NAVIGATION_TIMEOUT_MS || 30000),
  capcutHandoffUrl: process.env.CAPCUT_HANDOFF_URL || "https://www.capcut.com/editor",
  postDailyLimit: Number(process.env.POST_DAILY_LIMIT || 20),
  openaiTestBudgetUsd: Number(process.env.OPENAI_TEST_BUDGET_USD || 10)
};

const stateDefaults = {
  streamers: [],
  streamSessions: [],
  clipCandidates: [],
  clipPackages: [],
  postingDrafts: [],
  approvalRequests: [],
  artifacts: [],
  mediaSources: [],
  mediaProjects: [],
  mediaJobs: [],
  discoveredStreamers: [],
  executionContracts: [],
  agentRuns: [],
  handoffPackages: [],
  smokeTests: [],
  twitchValidation: null,
  logs: [],
  browser: {
    profile: null,
    sessions: [],
    actions: [],
    downloads: [],
    policies: []
  }
};

let state = structuredClone(stateDefaults);
let twitchAppToken = null;
let kickAppToken = null;
let browserWorkspaceInstance = null;

function now() {
  return new Date().toISOString();
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function cleanText(value) {
  return String(value || "").trim();
}

function twitchApiConfigured() {
  return Boolean(config.twitchClientId && (config.twitchClientSecret || config.twitchOAuthToken || config.twitchAppAccessToken || config.twitchUserAccessToken));
}

function kickApiConfigured() {
  return Boolean(config.kickOAuthToken || (config.kickClientId && config.kickClientSecret));
}

function normalizeTwitchLogin(value) {
  const raw = cleanText(value).replace(/^@/, "");
  if (!raw) return "";
  try {
    const parsed = raw.startsWith("http") ? new URL(raw) : new URL(`https://${raw}`);
    if (parsed.hostname.includes("twitch.tv")) {
      return cleanText(parsed.pathname.split("/").filter(Boolean)[0] || "").replace(/^@/, "").toLowerCase();
    }
  } catch {
    // Fall through to plain login cleanup.
  }
  return raw
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/^twitch\.tv\//i, "")
    .split(/[/?#]/)[0]
    .replace(/^@/, "")
    .toLowerCase();
}

function normalizeKickSlug(value) {
  const raw = cleanText(value).replace(/^@/, "");
  if (!raw) return "";
  try {
    const parsed = raw.startsWith("http") ? new URL(raw) : new URL(`https://${raw}`);
    if (parsed.hostname.includes("kick.com")) {
      return cleanText(parsed.pathname.split("/").filter(Boolean)[0] || "").replace(/^@/, "").toLowerCase();
    }
  } catch {
    // Fall through to plain slug cleanup.
  }
  return raw
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/^kick\.com\//i, "")
    .split(/[/?#]/)[0]
    .replace(/^@/, "")
    .toLowerCase();
}

function normalizeStreamerInput(body = {}) {
  const channelUrl = cleanText(body.channelUrl);
  const platform = normalizeStatus(body.platform || "twitch", ["twitch", "youtube_live", "kick", "other"], "twitch");
  const rawIdentity = body.channelId || body.displayName || body.streamerName || channelUrl;
  const login = platform === "kick" ? normalizeKickSlug(rawIdentity) : normalizeTwitchLogin(rawIdentity);
  const rawDisplay = cleanText(body.displayName || body.streamerName);
  const displayName = rawDisplay && !/(twitch\.tv|kick\.com)/i.test(rawDisplay) ? rawDisplay : login || "Untitled streamer";
  const defaultUrl = platform === "kick" ? `https://kick.com/${login}` : `https://www.twitch.tv/${login}`;
  return {
    displayName,
    channelId: login,
    channelUrl: channelUrl || (login ? defaultUrl : "")
  };
}

function normalizeStatus(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

async function ensureStorage() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.mkdir(config.uploadDir, { recursive: true });
  await fs.mkdir(config.outputDir, { recursive: true });
  await fs.mkdir(config.browserProfileDir, { recursive: true });
  await fs.mkdir(config.browserDownloadsDir, { recursive: true });
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    state = { ...structuredClone(stateDefaults), ...JSON.parse(raw) };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await saveState();
  }
}

async function saveState() {
  await fs.writeFile(DATA_FILE, JSON.stringify(state, null, 2));
}

function addStateLog(type, message, details = {}) {
  const entry = {
    id: newId("log"),
    type,
    message,
    details,
    createdAt: now()
  };
  state.logs.unshift(entry);
  state.logs = state.logs.slice(0, 500);
  return entry;
}

async function logEvent(type, message, details = {}) {
  addStateLog(type, message, details);
  await saveState();
}

function browserWorkspace() {
  if (!browserWorkspaceInstance) {
    browserWorkspaceInstance = createBrowserWorkspace({
      config,
      state,
      helpers: {
        newId,
        saveState,
        addStateLog,
        logEvent
      }
    });
  }
  return browserWorkspaceInstance;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendError(res, statusCode, message, details = {}) {
  sendJson(res, statusCode, { error: message, details });
}

function sendPng(res, buffer) {
  res.writeHead(200, {
    "content-type": "image/png",
    "cache-control": "no-store"
  });
  res.end(buffer);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Invalid JSON body");
    error.statusCode = 400;
    throw error;
  }
}

function publicConfig() {
  return {
    aiProvider: config.aiProvider,
    aiMode: config.aiMode,
    openaiModel: config.openaiModel,
    openaiConfigured: Boolean(config.openaiApiKey),
    openaiTestBudgetUsd: config.openaiTestBudgetUsd,
    twitchConfigured: twitchApiConfigured(),
    twitchRedirectConfigured: Boolean(config.twitchRedirectUri),
    twitchOAuthTokenConfigured: Boolean(config.twitchOAuthToken),
    twitchAllowedChannels: config.twitchAllowedChannels,
    kickConfigured: kickApiConfigured(),
    kickOAuthTokenConfigured: Boolean(config.kickOAuthToken),
    postDailyLimit: config.postDailyLimit,
    browserEnabled: config.browserEnabled,
    browserMode: config.browserHeadless ? "headless_screenshot" : "headed_local",
    browserViewport: config.browserViewport,
    capcutManualHandoff: Boolean(config.capcutHandoffUrl),
    objectStorageConfigured: Boolean(config.objectStorageBucket),
    uploadDir: config.uploadDir,
    outputDir: config.outputDir
  };
}

function findStreamer(id) {
  return state.streamers.find((streamer) => streamer.id === id);
}

function isApprovedStreamer(streamer) {
  return ["approved", "demo_approved"].includes(streamer?.permissionStatus);
}

function isRealApprovedStreamer(streamer) {
  if (!streamer || streamer.isDemo || streamer.permissionStatus !== "approved") return false;
  if (!["twitch", "kick"].includes(streamer.platform)) return false;
  const allowed = streamer.allowedUse;
  if (Array.isArray(allowed)) return allowed.includes("clips") || allowed.includes("createOfficialClip") || allowed.includes("editClip");
  return Boolean(allowed?.createOfficialClip || allowed?.downloadClip || allowed?.editClip || allowed?.repostClip);
}

function channelAllowed(streamer) {
  if (streamer?.platform !== "twitch") return true;
  if (!config.twitchAllowedChannels.length) return true;
  const identities = [streamer.channelId, streamer.displayName, streamer.channelUrl, normalizeTwitchLogin(streamer.channelUrl)]
    .map((value) => cleanText(value).toLowerCase())
    .filter(Boolean);
  return identities.some((identity) => config.twitchAllowedChannels.includes(identity));
}

function dailyApprovedCount() {
  const today = todayKey();
  return state.postingDrafts.filter((draft) => {
    const date = (draft.approvedAt || draft.updatedAt || draft.createdAt || "").slice(0, 10);
    return draft.approvalStatus === "approved" && date === today;
  }).length;
}

function dailyLimitStatus() {
  const approvedToday = dailyApprovedCount();
  const ratio = config.postDailyLimit > 0 ? approvedToday / config.postDailyLimit : 1;
  return {
    approvedToday,
    limit: config.postDailyLimit,
    warning: ratio >= 0.75 && ratio < 1,
    blocked: approvedToday >= config.postDailyLimit
  };
}

function createApprovalRequest({ type, actionType, title, riskLevel = "medium", evidence = {}, linkedId, createdBy = "agent101" }) {
  const existing = state.approvalRequests.find(
    (request) => request.linkedId === linkedId && request.type === type && request.status === "pending"
  );
  if (existing) return existing;
  const request = {
    id: newId("approval"),
    type,
    actionType: actionType || type,
    title,
    riskLevel,
    evidence,
    linkedId,
    status: "pending",
    createdBy,
    actor: createdBy === "agent101" ? "Agent 101" : createdBy,
    createdAt: now(),
    decidedAt: null,
    decisionNotes: ""
  };
  state.approvalRequests.unshift(request);
  return request;
}

const RUN_STAGES = [
  "REQUEST_RECEIVED",
  "CONTRACT_CONFIRMED",
  "INTEGRATION_CHECK",
  "STREAM_DISCOVERY",
  "RESULTS_VALIDATED",
  "RIGHTS_VERIFICATION",
  "SOURCE_ACQUISITION",
  "SOURCE_VERIFICATION",
  "TRANSCRIPTION",
  "CANDIDATE_ANALYSIS",
  "CANDIDATE_SELECTION",
  "CLIP_CREATION",
  "RENDER_VERIFICATION",
  "CAPTION_GENERATION",
  "CAPCUT_HANDOFF",
  "POSTING_DRAFT",
  "HUMAN_GATE",
  "READY_FOR_PUBLISHING",
  "COMPLETED",
  "FAILED",
  "CANCELLED"
];

function safeHash(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload || {})).digest("hex");
}

async function fileSha256(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function parseRequestedCount(goal, explicit) {
  const direct = Number(explicit);
  if (Number.isFinite(direct) && direct > 0) return Math.min(50, Math.floor(direct));
  const text = cleanText(goal).toLowerCase();
  const match = text.match(/\b(?:top|find|get|return|show|give)\s+(\d{1,2})\b/) || text.match(/\b(\d{1,2})\s+(?:streamers|streams|clips|candidates)\b/);
  if (match) return Math.min(50, Math.max(1, Number(match[1])));
  return 2;
}

function inferRunMode(body = {}, goal = "") {
  const requested = cleanText(body.mode || body.sourceMode).toLowerCase();
  if (requested === "demo" || requested === "local_demo") return "demo";
  if (/\b(demo|practice|sample|synthetic)\b/i.test(goal)) return "demo";
  return "real";
}

function inferExecutionContract(body = {}) {
  const goal = cleanText(body.goal || body.message || "Find the top 2 streamers.");
  const sourceMode = inferRunMode(body, goal);
  const requestedCount = parseRequestedCount(goal, body.requestedCount || body.count);
  const lowered = goal.toLowerCase();
  const wantsClip = /\b(clip|clips|candidate|candidates|package|render|caption|posting)\b/.test(lowered);
  const wantsApproved = /\bapproved|watchlist|permission\b/.test(lowered);
  const operation = wantsClip ? "discover_and_clip" : "discover_streamers";
  const sourceScope = cleanText(body.scope) || (wantsApproved || wantsClip ? "approved_watchlist" : "twitch_live_global");
  return {
    id: newId("contract"),
    threadId: cleanText(body.threadId || body.chatId || "agent101-main"),
    runId: "",
    originalUserRequest: goal,
    operation,
    requestedCount,
    sourceScope,
    sourceMode,
    clippingMode: wantsClip ? (sourceMode === "demo" ? "demo" : "real") : "none",
    postingMode: "none",
    approvalMode: "human_gate_for_external_actions",
    constraints: [
      "Honor requestedCount exactly.",
      "Real mode never uses demo or synthetic records.",
      "Discovery does not create clips, posting drafts, or approvals.",
      "Posting drafts require verified rendered clip artifacts."
    ],
    createdAt: now()
  };
}

function contractSummary(contract) {
  if (contract.operation === "discover_streamers") {
    return `I interpreted this as ${contract.requestedCount} ${contract.sourceMode === "real" ? "real currently-live Twitch" : "DEMO / SYNTHETIC"} stream${contract.requestedCount === 1 ? "" : "s"}. This is discovery only; no clipping or posting will occur.`;
  }
  if (contract.sourceScope === "approved_watchlist") {
    return `I will check the approved watchlist for up to ${contract.requestedCount} eligible live streamer${contract.requestedCount === 1 ? "" : "s"}, then continue only if rights and playable source media are verified.`;
  }
  return `I interpreted this as a ${contract.sourceMode} StreamClipper run for ${contract.requestedCount} item${contract.requestedCount === 1 ? "" : "s"}.`;
}

function toExternalRunStatus(status) {
  if (status === "COMPLETED") return "completed";
  if (status === "FAILED") return "error";
  if (status === "CANCELLED") return "cancelled";
  if (status === "NEEDS_APPROVAL") return "needs_approval";
  if (status === "BLOCKED") return "blocked";
  return "running";
}

function persistAgentRun(run) {
  state.agentRuns ||= [];
  const index = state.agentRuns.findIndex((item) => item.runId === run.runId);
  if (index >= 0) state.agentRuns[index] = run;
  else state.agentRuns.unshift(run);
  state.agentRuns = state.agentRuns.slice(0, 80);
}

function addRunEvent(run, stage, status, message, details = {}) {
  if (!RUN_STAGES.includes(stage)) throw new Error(`Unknown Agent 101 stage: ${stage}`);
  const entry = {
    id: newId("stage"),
    runId: run.runId,
    contractId: run.contract?.id,
    stage,
    status,
    message,
    details,
    startedAt: details.startedAt || now(),
    completedAt: status === "running" ? null : now()
  };
  run.events.push(entry);
  run.steps.push({
    id: entry.id,
    name: stage.toLowerCase(),
    status: status === "succeeded" || status === "not_required" ? "completed" : status === "failed" ? "error" : status,
    message,
    details
  });
  run.currentStage = stage;
  run.currentStep = message;
  const completeCount = run.events.filter((event) => ["succeeded", "not_required"].includes(event.status)).length;
  run.progress = Math.min(99, Math.round((completeCount / 18) * 100));
  addStateLog("agent_stage", message, {
    runId: run.runId,
    contractId: run.contract?.id,
    stage,
    status,
    operation: run.contract?.operation,
    requestedCount: run.contract?.requestedCount,
    returnedCount: details.returnedCount,
    mode: run.contract?.sourceMode,
    providerIds: details.providerIds,
    error: details.error
  });
  run.logs.unshift(state.logs[0]);
  persistAgentRun(run);
  return entry;
}

async function saveRunState(run) {
  persistAgentRun(run);
  await saveState();
}

async function failAgentRun(run, stage, message, details = {}) {
  addRunEvent(run, stage, "failed", message, details);
  run.status = "FAILED";
  run.externalStatus = "error";
  run.progress = 100;
  run.completedAt = now();
  run.summary = message;
  addRunEvent(run, "FAILED", "failed", message, details);
  await saveRunState(run);
  return run;
}

function assertRequestedCount(run) {
  const count = Number(run.contract?.requestedCount || 0);
  const records = run.results?.streamers || [];
  if (records.length > count) throw new Error(`Requested ${count} streamer${count === 1 ? "" : "s"} but run produced ${records.length}.`);
}

function assertStreamerHasProviderId(streamer) {
  if (!streamer?.providerUserId) throw new Error("Real streamer record is missing Twitch broadcaster/provider ID.");
}

function assertRealModeContainsNoDemoData(run) {
  if (run.contract?.sourceMode !== "real") return;
  const payload = JSON.stringify(run.results || {});
  if (/DEMO_SOURCE|demo_approved|synthetic|practice/i.test(payload)) {
    throw new Error("Real mode output contains demo/synthetic data.");
  }
}

function assertStreamerResultCountDoesNotExceedRequested(run) {
  assertRequestedCount(run);
}

function assertClippingPermission(streamer) {
  if (!isRealApprovedStreamer(streamer)) throw new Error("Clipping blocked: permission has not been approved.");
}

async function assertSourceExists(source) {
  if (!source?.filePath) throw new Error("Source data unavailable. No verified media source exists.");
  await fs.stat(source.filePath);
}

async function assertSourceIsPlayable(source) {
  await assertSourceExists(source);
  const metadata = await ffprobeMetadata(source.filePath);
  if (!metadata.duration || !metadata.width || !metadata.height) throw new Error("Source verification failed. FFprobe did not find a playable video stream.");
  return metadata;
}

function assertCandidateReferencesSource(candidate, source) {
  if (!candidate?.sourceId || candidate.sourceId !== source?.id) throw new Error("Candidate generation blocked: no verified playable media.");
}

function assertCandidateTimesValid(candidate, source) {
  const start = Number(candidate?.timestampStartSeconds ?? 0);
  const end = Number(candidate?.timestampEndSeconds ?? start + Number(candidate?.duration || 0));
  const sourceDuration = Number(source?.duration || 0);
  if (!(end > start)) throw new Error("Candidate timestamps are invalid.");
  if (sourceDuration && end > sourceDuration + 0.5) throw new Error("Candidate timestamps exceed source duration.");
}

async function assertClipFileExists(clip) {
  if (!clip?.path) throw new Error("Clip file path is missing.");
  const stat = await fs.stat(clip.path);
  if (!stat.isFile() || stat.size <= 0) throw new Error("Clip file is missing or empty.");
  return stat;
}

function assertClipChecksumExists(clip) {
  if (!clip?.content?.sha256 && !clip?.sha256) throw new Error("Clip checksum is missing.");
}

function assertClipProbePassed(clip) {
  const content = clip?.content || clip || {};
  if (content.probeStatus !== "passed" && content.probeStatus !== "verified") throw new Error("Clip FFprobe verification did not pass.");
}

function verifiedClipArtifactForDraftInput(body = {}) {
  const byId = cleanText(body.clipArtifactId || body.artifactId);
  const byVideoRef = cleanText(body.videoRef);
  return state.artifacts.find((artifact) => {
    if (byId && artifact.id === byId) return true;
    if (byVideoRef && [artifact.id, artifact.url, artifact.playbackUrl, artifact.filename].includes(byVideoRef)) return true;
    return false;
  });
}

async function createVerifiedPostingDraft(body = {}) {
  if (body.approvalStatus === "approved" && dailyLimitStatus().blocked) {
    const error = new Error("Daily approved post limit reached");
    error.statusCode = 429;
    error.details = dailyLimitStatus();
    throw error;
  }
  const clipArtifact = verifiedClipArtifactForDraftInput(body);
  if (!artifactIsVerifiedClip(clipArtifact)) {
    await logEvent("posting_blocked", "Posting draft blocked without verified rendered clip", {
      clipArtifactId: cleanText(body.clipArtifactId || body.artifactId || body.videoRef),
      clipPackageId: cleanText(body.clipPackageId)
    });
    const error = new Error("Posting preparation stopped because no verified clip was produced.");
    error.statusCode = 422;
    throw error;
  }
  const draft = {
    id: newId("post"),
    clipPackageId: cleanText(body.clipPackageId),
    clipArtifactId: clipArtifact.id,
    platform: normalizeStatus(body.platform, ["tiktok", "instagram_reels", "youtube_shorts"], "tiktok"),
    videoRef: clipArtifact.playbackUrl || clipArtifact.url || clipArtifact.id,
    caption: cleanText(body.caption),
    hashtags: Array.isArray(body.hashtags) ? body.hashtags : [],
    thumbnailText: cleanText(body.thumbnailText),
    scheduledFor: cleanText(body.scheduledFor),
    status: "draft",
    platformStatus: "not_uploaded",
    approvalStatus: normalizeStatus(body.approvalStatus, ["pending", "approved", "rejected", "send_back"], "pending"),
    requiresApproval: true,
    riskNotes: Array.isArray(body.riskNotes) ? body.riskNotes : ["Human Gate approval required."],
    provenance: {
      clipArtifactId: clipArtifact.id,
      clipSha256: clipArtifact.content?.sha256,
      source: "verified_rendered_clip"
    },
    createdAt: now(),
    updatedAt: now(),
    approvedAt: body.approvalStatus === "approved" ? now() : null
  };
  state.postingDrafts.unshift(draft);
  await logEvent("post_queued", "Posting draft queued", { draftId: draft.id, platform: draft.platform });
  await saveState();
  return { draft, dailyLimit: dailyLimitStatus() };
}

function artifactIsVerifiedClip(artifact) {
  if (!artifact || artifact.type !== "rendered_clip") return false;
  const content = artifact.content || {};
  return Boolean(artifact.path && content.sha256 && ["passed", "verified"].includes(content.probeStatus));
}

function assertPostingDraftHasRealClip(draft) {
  const artifact = state.artifacts.find((item) => item.id === draft?.clipArtifactId || item.id === draft?.videoRef);
  if (!artifactIsVerifiedClip(artifact)) throw new Error("Posting draft blocked: verified rendered clip artifact is required.");
}

function assertApprovalHasPostingDraft(approval) {
  if (!state.postingDrafts.some((draft) => draft.id === approval?.linkedId)) {
    throw new Error("Approval request blocked: posting draft is missing.");
  }
}

function scoreClipMoment(input = {}) {
  const text = `${input.transcriptSnippet || ""} ${input.reason || ""} ${input.title || ""}`.toLowerCase();
  const excitementWords = [
    "insane",
    "crazy",
    "unreal",
    "clutch",
    "no way",
    "wild",
    "perfect",
    "rage",
    "laugh",
    "caught",
    "reaction",
    "final",
    "win",
    "fail"
  ];
  const excitementHits = excitementWords.filter((word) => text.includes(word)).length;
  const chatSpike = Number(input.chatSignals?.spike || input.chatSignals?.messagesPerMinute || 0);
  const duration = Number(input.duration || 30);
  const lengthScore = duration >= 15 && duration <= 60 ? 18 : duration < 10 || duration > 90 ? 4 : 10;
  const chatScore = Math.min(22, Math.round(chatSpike / 2));
  const transcriptScore = Math.min(20, excitementHits * 5);
  const hookScore = Math.min(20, Number(input.hookScore || 8 + excitementHits * 3));
  const contextScore = input.category || input.title ? 10 : 4;
  const riskScore = Math.min(100, Number(input.riskScore || (text.includes("copyright") ? 60 : 15)));
  const riskPenalty = Math.round(riskScore / 5);
  const raw = chatScore + transcriptScore + lengthScore + hookScore + contextScore - riskPenalty;
  const score = Math.max(0, Math.min(100, raw));
  const confidence = input.transcriptSnippet || chatSpike ? "medium" : "low";
  const suggestedHook = input.suggestedHook || makeHook(input.title || input.reason || "Stream moment");
  const suggestedTitle = input.suggestedTitle || makeTitle(input.title || input.reason || "Clip moment");

  return {
    score,
    hookScore,
    riskScore,
    confidence,
    reason:
      confidence === "low"
        ? "Manual/demo candidate: add transcript, chat notes, or visual context for a stronger score."
        : "Candidate scored from engagement, transcript energy, hook potential, length, context, and risk.",
    suggestedHook,
    suggestedTitle,
    riskNotes:
      riskScore >= 50
        ? ["Review rights, music, claims, and streamer permission before any external use."]
        : ["Low initial risk, still requires Human Gate before external posting."]
  };
}

function makeHook(seed) {
  const base = cleanText(seed).replace(/\s+/g, " ");
  if (!base) return "Wait for this";
  const words = base.split(" ").slice(0, 6).join(" ");
  return words.length > 28 ? `${words.slice(0, 28).trim()}...` : words;
}

function makeTitle(seed) {
  const base = cleanText(seed).replace(/\s+/g, " ");
  if (!base) return "Best Stream Moment";
  return base.length > 72 ? `${base.slice(0, 69).trim()}...` : base;
}

function buildPackage(candidate) {
  const streamer = findStreamer(candidate.streamerId);
  const score = scoreClipMoment(candidate);
  const streamerName = streamer?.displayName || "Approved streamer";
  const hook = score.suggestedHook;
  const title = score.suggestedTitle;
  const hashtags = [
    "#streamer",
    "#gaming",
    "#twitchclips",
    "#viralclips",
    `#${streamerName.replace(/[^a-z0-9]/gi, "").slice(0, 18) || "creator"}`
  ];
  return {
    title,
    hook,
    captionOverlays: [
      `${hook}?`,
      "No way.",
      "Watch the end."
    ],
    cropGuidance: [
      "Frame the streamer reaction in the upper safe zone.",
      "Keep gameplay/action centered with room for TikTok UI on the right.",
      "Use quick punch-in zooms only on reaction beats."
    ],
    cutInstructions: [
      "Start 1-3 seconds before the reaction beat.",
      "Cut dead air and menu pauses.",
      "End immediately after the payoff or strongest reaction."
    ],
    capcutInstructions: [
      "Canvas: 9:16, 1080x1920.",
      "Target length: 15-60 seconds.",
      "Use punchy captions with 1-6 words per line.",
      "Keep captions out of bottom and right platform UI safe areas."
    ],
    captions: {
      tiktok: `${hook}. ${title}`,
      reels: `${title}. ${hook}`,
      shorts: `${hook} | ${title}`
    },
    hashtags,
    thumbnailText: hook.toUpperCase().slice(0, 32),
    approvalChecklist: [
      "Streamer permission is approved.",
      "No visible private info.",
      "No unlicensed music issue flagged.",
      "Caption and title are accurate.",
      "External upload remains draft-only until approved."
    ]
  };
}

async function writeArtifact(kind, name, payload, extension = "json") {
  const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || kind;
  const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}-${safeName}.${extension}`;
  const filePath = path.join(config.outputDir, filename);
  const body = extension === "json" ? JSON.stringify(payload, null, 2) : String(payload);
  await fs.writeFile(filePath, body);
  const artifact = {
    id: newId("artifact"),
    kind,
    type: kind,
    title: name,
    content: payload,
    status: "ready",
    filename,
    path: filePath,
    url: `/outputs/${encodeURIComponent(filename)}`,
    fileRefs: [{ filename, path: filePath, url: `/outputs/${encodeURIComponent(filename)}` }],
    createdBy: "agent101",
    createdAt: now()
  };
  state.artifacts.unshift(artifact);
  return artifact;
}

function outputArtifactForFile(kind, title, filePath, metadata = {}) {
  const filename = path.basename(filePath);
  const artifact = {
    id: newId("artifact"),
    kind,
    type: kind,
    title,
    content: metadata,
    status: "ready",
    filename,
    path: filePath,
    url: `/outputs/${encodeURIComponent(filename)}`,
    playbackUrl: `/outputs/${encodeURIComponent(filename)}`,
    fileRefs: [{ filename, path: filePath, url: `/outputs/${encodeURIComponent(filename)}` }],
    createdBy: "agent101",
    provenance: metadata.provenance || PROVENANCE.VERIFIED_MEDIA,
    createdAt: now()
  };
  state.artifacts.unshift(artifact);
  return artifact;
}

function publicMediaSource(source) {
  if (!source) return null;
  return {
    ...source,
    filePath: undefined,
    playbackUrl: `/api/media/sources/${encodeURIComponent(source.id)}/playback`,
    metadataUrl: `/api/media/sources/${encodeURIComponent(source.id)}/metadata`,
    thumbnailsUrl: `/api/media/sources/${encodeURIComponent(source.id)}/thumbnails`
  };
}

function findMediaSource(id) {
  ensureClippingStudioProject();
  return state.mediaSources.find((source) => source.id === id);
}

function findExistingMediaSource(id) {
  return (state.mediaSources || []).find((source) => source.id === id);
}

function demoFrameUrl(index) {
  return `/demo/frame-${(index % 5) + 1}.jpg`;
}

function demoCandidateDefinitions(sourceId = DEMO_MEDIA_SOURCE_ID) {
  const base = [
    ["candidate_demo_source_001", "Practice motion test", "VALORANT", 2, 7, 82, "AI suggestion based on demo media timing. Source transcript is unavailable."],
    ["candidate_demo_source_002", "Perfect timing beat", "Gaming", 7, 12, 76, "AI suggestion for testing a clean reaction-style crop. Source transcript is unavailable."],
    ["candidate_demo_source_003", "Fast transition moment", "Just Chatting", 12, 17, 71, "AI suggestion for testing captions and 9:16 preview. Source transcript is unavailable."],
    ["candidate_demo_source_004", "Clean replay cut", "Apex Legends", 17, 22, 68, "AI suggestion for testing render output. Source transcript is unavailable."]
  ];
  return base.map(([id, title, category, startSec, endSec, score, reason], index) => ({
    id,
    streamerId: DEMO_STREAMER_ID,
    streamerName: "Demo Media Source",
    title,
    category,
    sourceType: "demo_media",
    sourceId,
    sourceProvenance: PROVENANCE.DEMO_SOURCE,
    provenance: PROVENANCE.DEMO_SOURCE,
    creativeProvenance: PROVENANCE.AI_GENERATED,
    mediaPlayable: true,
    timestampStart: secondsToTimestamp(startSec),
    timestampEnd: secondsToTimestamp(endSec),
    timestampStartSeconds: startSec,
    timestampEndSeconds: endSec,
    duration: endSec - startSec,
    transcriptSnippet: "Source data unavailable: bundled demo media has no speech transcript.",
    transcriptProvenance: PROVENANCE.UNAVAILABLE,
    chatSignals: { source: PROVENANCE.UNAVAILABLE, label: "Source data unavailable" },
    viewerCount: null,
    engagementPotential: null,
    score,
    hookScore: Math.max(12, Math.round(score / 5)),
    retentionPotential: Math.max(50, score - 8),
    riskScore: 8,
    confidence: "demo",
    reason,
    suggestedHook: title,
    suggestedTitle: title,
    thumbnailUrl: demoFrameUrl(index),
    status: index < 3 ? "candidate" : "reviewed",
    createdBy: "agent101",
    createdAt: now(),
    updatedAt: now()
  }));
}

function ensureClippingStudioProject() {
  state.mediaSources ||= [];
  state.mediaProjects ||= [];
  state.mediaJobs ||= [];

  if (!state.streamers.some((streamer) => streamer.id === DEMO_STREAMER_ID)) {
    state.streamers.unshift({
      id: DEMO_STREAMER_ID,
      displayName: "Demo Media Source",
      platform: "demo",
      channelId: "demo-media-source",
      channelUrl: "",
      permissionStatus: "demo_approved",
      monitorEnabled: true,
      isDemo: true,
      liveStatus: "demo_source",
      notes: "Bundled playable demo media for local clipping workflow testing. Not a real live stream.",
      createdAt: now(),
      updatedAt: now()
    });
  }

  let source = state.mediaSources.find((item) => item.id === DEMO_MEDIA_SOURCE_ID);
  if (!source) {
    source = {
      id: DEMO_MEDIA_SOURCE_ID,
      title: "StreamClipper Practice Media",
      displayName: "Demo practice video",
      type: "video/mp4",
      mimeType: "video/mp4",
      provenance: PROVENANCE.DEMO_SOURCE,
      sourceKind: "demo_media",
      filePath: DEMO_MEDIA_FILE,
      originalFilename: "demo-source.mp4",
      duration: 24,
      width: 1280,
      height: 720,
      fps: 30,
      hasAudio: true,
      playable: true,
      transcriptStatus: PROVENANCE.UNAVAILABLE,
      rightsStatus: "demo_only",
      label: "DEMO MEDIA — NOT A REAL LIVE STREAM",
      warning: "Demo media is for workflow testing only. Do not treat it as a real live stream or public posting source.",
      createdAt: now(),
      updatedAt: now()
    };
    state.mediaSources.unshift(source);
  }

  const demoCandidates = demoCandidateDefinitions(source.id);
  for (const candidate of demoCandidates) {
    const existing = state.clipCandidates.find((item) => item.id === candidate.id);
    if (!existing) state.clipCandidates.unshift(candidate);
    else Object.assign(existing, {
      sourceId: candidate.sourceId,
      sourceProvenance: candidate.sourceProvenance,
      provenance: candidate.provenance,
      creativeProvenance: candidate.creativeProvenance,
      mediaPlayable: true,
      thumbnailUrl: candidate.thumbnailUrl,
      transcriptProvenance: PROVENANCE.UNAVAILABLE,
      viewerCount: null,
      chatSignals: candidate.chatSignals
    });
  }

  let project = state.mediaProjects.find((item) => item.id === DEMO_PROJECT_ID);
  if (!project) {
    project = {
      id: DEMO_PROJECT_ID,
      officeId: "clips",
      title: "Clipping Office Main Workspace",
      activeSourceId: source.id,
      selectedCandidateId: demoCandidates[0]?.id || "",
      stage: "media_review",
      status: "ready",
      createdAt: now(),
      updatedAt: now()
    };
    state.mediaProjects.unshift(project);
  }
  return project;
}

function secondsToTimestamp(value) {
  const seconds = Math.max(0, Number(value || 0));
  const whole = Math.floor(seconds);
  const hrs = Math.floor(whole / 3600);
  const mins = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  return hrs > 0
    ? `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function studioProjectPayload(projectId = DEMO_PROJECT_ID) {
  const project = ensureClippingStudioProject();
  const activeProject = state.mediaProjects.find((item) => item.id === projectId) || project;
  const source = findMediaSource(activeProject.activeSourceId);
  const candidates = state.clipCandidates
    .filter((candidate) => candidate.sourceId === activeProject.activeSourceId)
    .sort((a, b) => Number(a.timestampStartSeconds || 0) - Number(b.timestampStartSeconds || 0));
  const renderJobs = state.mediaJobs
    .filter((job) => job.projectId === activeProject.id)
    .slice(0, 12);
  const projectArtifacts = state.artifacts
    .filter((artifact) => artifact.content?.projectId === activeProject.id || artifact.content?.sourceId === activeProject.activeSourceId)
    .slice(0, 20);
  return {
    project: {
      ...activeProject,
      sourceTruth: {
        provenance: source?.provenance || PROVENANCE.UNAVAILABLE,
        label: source?.label || "Source data unavailable",
        rightsStatus: source?.rightsStatus || "unavailable",
        transcriptStatus: source?.transcriptStatus || PROVENANCE.UNAVAILABLE,
        viewerCount: PROVENANCE.UNAVAILABLE,
        chatSignals: PROVENANCE.UNAVAILABLE
      }
    },
    source: publicMediaSource(source),
    candidates,
    renderJobs,
    artifacts: projectArtifacts,
    capcut: {
      status: "manual_handoff",
      workspaceUrl: config.capcutHandoffUrl,
      browserReady: config.browserEnabled
    },
    unavailable: {
      transcript: "Source data unavailable. No speech transcript has been extracted for this demo media.",
      liveMetrics: "Source data unavailable. Demo media does not contain verified viewer counts, live status, or chat spikes."
    }
  };
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".srt": "text/plain; charset=utf-8",
    ".vtt": "text/vtt; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".mp4": "video/mp4",
    ".webm": "video/webm"
  }[ext] || "application/octet-stream";
}

async function ffprobeMetadata(filePath) {
  const { stdout } = await execFileAsync(ffprobeExecutable, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath
  ], { timeout: 8000, maxBuffer: 1024 * 1024 });
  const parsed = JSON.parse(stdout);
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
  return {
    duration: Number(parsed.format?.duration || 0),
    width: Number(video?.width || 0),
    height: Number(video?.height || 0),
    fps: video?.avg_frame_rate || video?.r_frame_rate || "",
    hasAudio: Boolean(audio),
    formatName: parsed.format?.format_name || "",
    size: Number(parsed.format?.size || 0),
    provenance: PROVENANCE.VERIFIED_MEDIA
  };
}

async function createRenderJob(body = {}) {
  const payload = studioProjectPayload(body.projectId || DEMO_PROJECT_ID);
  const candidate = payload.candidates.find((item) => item.id === body.candidateId) || payload.candidates[0];
  const source = findMediaSource(candidate?.sourceId || payload.source?.id);
  if (!candidate) throw Object.assign(new Error("No playable candidate is selected."), { statusCode: 404 });
  if (!source?.filePath) throw Object.assign(new Error("Source data unavailable. Upload or select playable media first."), { statusCode: 400 });
  const sourcePath = source.filePath;
  await fs.stat(sourcePath);
  const safeTitle = (candidate.suggestedTitle || candidate.title || "clip-render").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "clip-render";
  const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}-${safeTitle}-9x16.mp4`;
  const outputPath = path.join(config.outputDir, filename);
  const start = Math.max(0, Number(candidate.timestampStartSeconds || 0));
  const duration = Math.max(1, Math.min(90, Number(candidate.duration || 8)));
  const job = {
    id: newId("render_job"),
    projectId: payload.project.id,
    candidateId: candidate.id,
    sourceId: source.id,
    status: "running",
    progress: 10,
    currentStep: "Validating source media",
    steps: [
      { label: "Validate source media", status: "completed", at: now() },
      { label: "Cut selected timestamp window", status: "running", at: now() },
      { label: "Reframe to 9:16", status: "pending" },
      { label: "Save MP4 artifact", status: "pending" }
    ],
    outputFilename: filename,
    outputPath,
    artifactId: null,
    error: "",
    createdAt: now(),
    updatedAt: now()
  };
  state.mediaJobs.unshift(job);
  await saveState();
  await logEvent("render_started", "Clip render started", { jobId: job.id, candidateId: candidate.id, sourceId: source.id });

  try {
    job.currentStep = "Rendering 9:16 draft MP4";
    job.progress = 55;
    job.steps[1].status = "completed";
    job.steps[2].status = "running";
    job.updatedAt = now();
    await saveState();

    await execFileAsync(ffmpegExecutable, [
      "-y",
      "-ss",
      String(start),
      "-i",
      sourcePath,
      "-t",
      String(duration),
      "-vf",
      "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      outputPath
    ], { timeout: 120000, maxBuffer: 1024 * 1024 * 4 });

    const [probe, stat, sha256] = await Promise.all([
      ffprobeMetadata(outputPath),
      fs.stat(outputPath),
      fileSha256(outputPath)
    ]);
    if (!stat.isFile() || stat.size <= 0 || !probe.width || !probe.height || !probe.duration) {
      throw new Error("Render verification failed. Output file did not pass size/probe checks.");
    }
    const artifact = outputArtifactForFile("rendered_clip", `${candidate.title} 9:16 Draft`, outputPath, {
      projectId: payload.project.id,
      sourceId: source.id,
      candidateId: candidate.id,
      provenance: PROVENANCE.VERIFIED_MEDIA,
      sourceProvenance: source.provenance,
      format: "9:16",
      resolution: "1080x1920",
      duration,
      fileSizeBytes: stat.size,
      sha256,
      durationSeconds: probe.duration,
      width: probe.width,
      height: probe.height,
      frameRate: probe.fps,
      hasAudio: probe.hasAudio,
      probeStatus: "passed",
      renderStatus: "completed",
      note: source.provenance === PROVENANCE.DEMO_SOURCE
        ? "Rendered from bundled demo media. Not a real live stream."
        : "Rendered from selected playable source media."
    });
    artifact.fileSizeBytes = stat.size;
    artifact.sha256 = sha256;
    artifact.durationSeconds = probe.duration;
    artifact.width = probe.width;
    artifact.height = probe.height;
    artifact.probeStatus = "passed";
    job.status = "completed";
    job.progress = 100;
    job.currentStep = "Rendered draft saved";
    job.artifactId = artifact.id;
    job.playbackUrl = artifact.playbackUrl;
    job.fileSizeBytes = stat.size;
    job.sha256 = sha256;
    job.probeStatus = "passed";
    job.steps[2].status = "completed";
    job.steps[3].status = "completed";
    job.updatedAt = now();
    candidate.renderedArtifactId = artifact.id;
    candidate.status = "packaged";
    candidate.updatedAt = now();
    await logEvent("render_completed", "Rendered clip artifact saved", { jobId: job.id, artifactId: artifact.id });
    await saveState();
    return { job, artifact };
  } catch (error) {
    job.status = "error";
    job.progress = 100;
    job.currentStep = "Render failed";
    job.error = error.message;
    job.steps = job.steps.map((step) => step.status === "running" ? { ...step, status: "error", error: error.message } : step);
    job.updatedAt = now();
    await logEvent("render_failed", "Clip render failed", { jobId: job.id, error: error.message });
    await saveState();
    throw error;
  }
}

async function getTwitchAppToken() {
  if (twitchAppToken?.expiresAt > Date.now() + 60_000) return twitchAppToken.accessToken;
  if (config.twitchAppAccessToken) {
    twitchAppToken = {
      accessToken: config.twitchAppAccessToken,
      expiresAt: Date.now() + 55 * 60 * 1000
    };
    return twitchAppToken.accessToken;
  }
  if (!(config.twitchClientId && config.twitchClientSecret)) {
    throw new Error("Twitch client credentials are not configured");
  }
  const params = new URLSearchParams({
    client_id: config.twitchClientId,
    client_secret: config.twitchClientSecret,
    grant_type: "client_credentials"
  });
  const response = await fetch(`https://id.twitch.tv/oauth2/token?${params}`, { method: "POST" });
  if (!response.ok) throw new Error(`Twitch token request failed: ${response.status}`);
  const json = await response.json();
  twitchAppToken = {
    accessToken: json.access_token,
    expiresAt: Date.now() + Number(json.expires_in || 3600) * 1000
  };
  return twitchAppToken.accessToken;
}

function twitchUserToken() {
  return config.twitchUserAccessToken || config.twitchOAuthToken || "";
}

async function validateTwitchToken(token) {
  if (!token) {
    return {
      valid: false,
      status: "not_configured",
      scopes: [],
      userId: null,
      expiresAt: null,
      message: "No Twitch OAuth token is configured."
    };
  }
  const response = await fetch("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: `OAuth ${token}` }
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      valid: false,
      status: response.status === 401 ? "invalid" : "error",
      scopes: [],
      userId: null,
      expiresAt: null,
      message: json.message || `Twitch token validation failed with HTTP ${response.status}`
    };
  }
  const expiresIn = Number(json.expires_in || 0);
  return {
    valid: true,
    status: "valid",
    clientId: json.client_id || null,
    login: json.login || null,
    userId: json.user_id || null,
    scopes: Array.isArray(json.scopes) ? json.scopes : [],
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    message: "Twitch token validated."
  };
}

async function twitchIntegrationStatus({ validate = true } = {}) {
  const status = {
    configured: twitchApiConfigured(),
    clientIdConfigured: Boolean(config.twitchClientId),
    clientSecretConfigured: Boolean(config.twitchClientSecret),
    redirectUriConfigured: Boolean(config.twitchRedirectUri),
    appTokenConfigured: Boolean(config.twitchAppAccessToken || (config.twitchClientId && config.twitchClientSecret)),
    userTokenConfigured: Boolean(twitchUserToken()),
    appTokenValid: false,
    userTokenValid: false,
    scopes: [],
    userId: null,
    expiresAt: null,
    lastValidatedAt: null,
    officialApiOnly: true,
    status: "not_configured",
    message: "Twitch credentials are not configured."
  };
  if (!status.configured) {
    state.twitchValidation = status;
    return status;
  }
  try {
    const appToken = await getTwitchAppToken();
    let appValidation = { valid: Boolean(appToken), scopes: [] };
    if (validate && appToken) appValidation = await validateTwitchToken(appToken);
    status.appTokenValid = Boolean(appToken && appValidation.valid);
    status.status = status.appTokenValid ? "ready" : "error";
    status.message = status.appTokenValid
      ? "Twitch app access is ready for official Helix discovery."
      : appValidation.message || "Twitch app token validation failed.";
  } catch (error) {
    status.status = "error";
    status.message = error.message;
  }
  if (validate && twitchUserToken()) {
    try {
      const userValidation = await validateTwitchToken(twitchUserToken());
      status.userTokenValid = userValidation.valid;
      status.scopes = userValidation.scopes || [];
      status.userId = userValidation.userId || null;
      status.expiresAt = userValidation.expiresAt || null;
      if (!userValidation.valid && status.status === "ready") {
        status.message = "Twitch app access works, but the user token is not valid.";
      }
    } catch (error) {
      if (status.status === "ready") status.message = "Twitch app access works, but user token validation failed.";
      status.userTokenValid = false;
      status.userTokenError = error.message;
    }
  }
  status.lastValidatedAt = now();
  state.twitchValidation = status;
  return status;
}

async function twitchFetch(endpoint) {
  const token = twitchUserToken() || (await getTwitchAppToken());
  const response = await fetch(`https://api.twitch.tv/helix${endpoint}`, {
    headers: {
      "Client-Id": config.twitchClientId,
      Authorization: `Bearer ${token}`
    }
  });
  const remaining = response.headers.get("ratelimit-remaining");
  if (remaining !== null && Number(remaining) < 10) {
    await logEvent("rate_limit", "Twitch rate limit is getting low", { remaining });
  }
  if (!response.ok) throw new Error(`Twitch API failed: ${response.status}`);
  return response.json();
}

function mapTwitchSourceRecord(stream, run, contract) {
  const rawResponseHash = safeHash(stream);
  return {
    id: `twitch_${stream.user_id || stream.id || newId("stream")}_${run.runId}`,
    runId: run.runId,
    contractId: contract.id,
    provider: "twitch",
    providerUserId: cleanText(stream.user_id),
    streamId: cleanText(stream.id),
    userLogin: cleanText(stream.user_login),
    displayName: cleanText(stream.user_name || stream.user_login),
    title: cleanText(stream.title),
    gameId: cleanText(stream.game_id),
    gameName: cleanText(stream.game_name),
    viewerCount: Number(stream.viewer_count || 0),
    startedAt: cleanText(stream.started_at),
    thumbnailUrl: cleanText(stream.thumbnail_url),
    language: cleanText(stream.language),
    tags: Array.isArray(stream.tags) ? stream.tags : [],
    sourceMode: "real",
    apiEndpoint: "helix/streams",
    fetchedAt: now(),
    rawResponseHash,
    rightsStatus: "unknown",
    permissionStatus: "unknown",
    clippingEligibility: "not_verified"
  };
}

function assertTwitchRecordReal(record) {
  if (record.provider !== "twitch" || record.sourceMode !== "real") throw new Error("Real mode may only return real Twitch records.");
  assertStreamerHasProviderId(record);
  if (!record.fetchedAt || !record.rawResponseHash) throw new Error("Real Twitch record is missing fetchedAt or response hash.");
}

async function fetchTopTwitchLiveStreams(count, run, contract) {
  const requestedCount = Math.max(1, Math.min(100, Number(count) || 1));
  const params = new URLSearchParams({ first: String(requestedCount) });
  const json = await twitchFetch(`/streams?${params}`);
  return (json.data || [])
    .slice(0, requestedCount)
    .map((stream) => mapTwitchSourceRecord(stream, run, contract));
}

function approvedTwitchWatchlist() {
  return state.streamers.filter((streamer) => {
    if (!isRealApprovedStreamer(streamer)) return false;
    if (streamer.platform !== "twitch") return false;
    return Boolean(normalizeTwitchLogin(streamer.channelId || streamer.channelUrl || streamer.displayName) || streamer.providerUserId);
  });
}

async function fetchApprovedTwitchLiveStreams(count, run, contract) {
  const requestedCount = Math.max(1, Math.min(100, Number(count) || 1));
  const approved = approvedTwitchWatchlist();
  if (!approved.length) return [];
  const params = new URLSearchParams();
  for (const streamer of approved.slice(0, 100)) {
    const providerId = cleanText(streamer.providerUserId);
    const login = normalizeTwitchLogin(streamer.channelId || streamer.channelUrl || streamer.displayName);
    if (providerId && /^\d+$/.test(providerId)) params.append("user_id", providerId);
    else if (login) params.append("user_login", login);
  }
  if (!params.toString()) return [];
  const json = await twitchFetch(`/streams?${params}`);
  const byLogin = new Map(approved.map((streamer) => [normalizeTwitchLogin(streamer.channelId || streamer.channelUrl || streamer.displayName), streamer]));
  const byId = new Map(approved.map((streamer) => [cleanText(streamer.providerUserId), streamer]));
  return (json.data || []).slice(0, requestedCount).map((stream) => {
    const record = mapTwitchSourceRecord(stream, run, contract);
    const approvedRecord = byId.get(record.providerUserId) || byLogin.get(record.userLogin);
    record.permissionStatus = approvedRecord?.permissionStatus || "unknown";
    record.allowedUse = approvedRecord?.allowedUse || [];
    record.watchlistStreamerId = approvedRecord?.id || "";
    record.rightsStatus = approvedRecord?.rightsStatus || "permission_recorded";
    record.clippingEligibility = "permission_recorded_source_not_verified";
    return record;
  });
}

async function getKickAppToken() {
  if (kickAppToken?.expiresAt > Date.now() + 60_000) return kickAppToken.accessToken;
  if (!(config.kickClientId && config.kickClientSecret)) {
    throw new Error("Kick client credentials are not configured");
  }
  const params = new URLSearchParams({
    client_id: config.kickClientId,
    client_secret: config.kickClientSecret,
    grant_type: "client_credentials"
  });
  const response = await fetch("https://id.kick.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params
  });
  if (!response.ok) throw new Error(`Kick token request failed: ${response.status}`);
  const json = await response.json();
  kickAppToken = {
    accessToken: json.access_token,
    expiresAt: Date.now() + Number(json.expires_in || 3600) * 1000
  };
  return kickAppToken.accessToken;
}

async function kickFetch(endpoint) {
  const token = config.kickOAuthToken || (await getKickAppToken());
  const response = await fetch(`https://api.kick.com${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });
  if (!response.ok) throw new Error(`Kick API failed: ${response.status}`);
  return response.json();
}

async function fetchTwitchStream(streamer) {
  const channelId = normalizeTwitchLogin(streamer.channelId || streamer.channelUrl || streamer.displayName);
  if (!channelId) return null;
  const params = new URLSearchParams();
  if (/^\d+$/.test(channelId)) params.set("user_id", channelId);
  else params.set("user_login", channelId.toLowerCase());
  const json = await twitchFetch(`/streams?${params}`);
  return json.data?.[0] || null;
}

async function fetchKickStream(streamer) {
  const slug = normalizeKickSlug(streamer.channelId || streamer.channelUrl || streamer.displayName);
  if (!slug) return null;
  const params = new URLSearchParams();
  if (/^\d+$/.test(slug)) params.append("broadcaster_user_id", slug);
  else params.append("slug", slug);
  const json = await kickFetch(`/public/v1/channels?${params}`);
  const channel = json.data?.[0] || null;
  if (!channel) return null;
  streamer.channelId = channel.slug || slug;
  streamer.channelUrl = `https://kick.com/${streamer.channelId}`;
  const stream = channel.stream?.is_live ? channel.stream : null;
  if (!stream) return null;
  return {
    id: `kick_${channel.broadcaster_user_id || streamer.channelId}`,
    title: channel.stream_title || `${streamer.displayName} live on Kick`,
    game_name: channel.category?.name || "Kick",
    started_at: stream.start_time || now(),
    viewer_count: stream.viewer_count || 0,
    thumbnail_url: stream.thumbnail || "",
    platform: "kick",
    channel
  };
}

function streamerIdentityKey(streamer = {}) {
  return `${cleanText(streamer.platform || "twitch").toLowerCase()}:${cleanText(streamer.channelId || streamer.displayName).toLowerCase()}`;
}

function knownStreamerKeys() {
  return new Set(state.streamers.map(streamerIdentityKey));
}

function recommendationScore({ platform, viewerCount = 0, category = "", title = "" }) {
  let score = 58;
  score += Math.min(26, Math.floor(Math.log10(Math.max(1, Number(viewerCount))) * 8));
  if (/valorant|fortnite|warzone|minecraft|gta|just chatting|irl|sports|music/i.test(category)) score += 8;
  if (/reaction|challenge|ranked|tournament|live|new|clutch|hype/i.test(title)) score += 6;
  if (platform === "kick") score += 2;
  return Math.max(45, Math.min(98, score));
}

function streamerRecommendationReason(item) {
  const viewers = Number(item.viewerCount || 0).toLocaleString();
  const parts = [];
  if (item.category) parts.push(`${item.category} audience`);
  if (item.viewerCount) parts.push(`${viewers} live viewers`);
  if (item.title) parts.push("active stream title gives Agent 101 clip context");
  return parts.length ? parts.join(" - ") : "Public live data suggests this channel is worth reviewing.";
}

function mapTwitchRecommendation(stream) {
  const category = stream.game_name || "Twitch";
  const item = {
    platform: "twitch",
    displayName: stream.user_name || stream.user_login || "Twitch streamer",
    channelId: stream.user_login || stream.user_id || "",
    channelUrl: stream.user_login ? `https://www.twitch.tv/${stream.user_login}` : "",
    title: stream.title || "",
    category,
    viewerCount: Number(stream.viewer_count || 0),
    thumbnail: stream.thumbnail_url || "",
    startedAt: stream.started_at || "",
    source: "Official Twitch Helix live directory"
  };
  return {
    ...item,
    score: recommendationScore(item),
    reason: streamerRecommendationReason(item),
    suggestedUse: ["clips", "edits", "reposts"]
  };
}

function mapKickRecommendation(stream) {
  const category = stream.category?.name || "Kick";
  const item = {
    platform: "kick",
    displayName: stream.slug || "Kick streamer",
    channelId: stream.slug || "",
    channelUrl: stream.slug ? `https://kick.com/${stream.slug}` : "",
    title: stream.stream_title || "",
    category,
    viewerCount: Number(stream.viewer_count || 0),
    thumbnail: stream.thumbnail || stream.profile_picture || "",
    startedAt: stream.started_at || "",
    source: "Official Kick public live directory"
  };
  return {
    ...item,
    score: recommendationScore(item),
    reason: streamerRecommendationReason(item),
    suggestedUse: ["clips", "edits", "reposts"]
  };
}

async function fetchTwitchRecommendations(limit) {
  if (!twitchApiConfigured()) return [];
  const params = new URLSearchParams({ first: String(Math.min(100, Math.max(1, limit))) });
  const json = await twitchFetch(`/streams?${params}`);
  return (json.data || []).map(mapTwitchRecommendation);
}

async function fetchKickRecommendations(limit) {
  if (!kickApiConfigured()) return [];
  const params = new URLSearchParams({ limit: String(Math.min(100, Math.max(1, limit))), sort: "viewer_count" });
  const json = await kickFetch(`/public/v1/livestreams?${params}`);
  return (json.data || []).map(mapKickRecommendation);
}

function fallbackStreamerRecommendations(limit) {
  return [
    ["kick", "xqc", "xQc", "High-volume live audience with strong reaction potential.", "Just Chatting", 96],
    ["kick", "adinross", "Adin Ross", "Large Kick-native audience; needs brand-safety review before monitoring.", "Just Chatting", 88],
    ["twitch", "kaicenat", "KaiCenat", "High-energy creator with frequent clip-worthy moments.", "Just Chatting", 91],
    ["twitch", "tarik", "tarik", "Esports creator with repeatable VALORANT clip potential.", "VALORANT", 86],
    ["twitch", "hasanabi", "HasanAbi", "Long-form commentary creates many possible reaction clips.", "Just Chatting", 82]
  ].slice(0, limit).map(([platform, channelId, displayName, reason, category, score]) => ({
    platform,
    channelId,
    displayName,
    channelUrl: platform === "kick" ? `https://kick.com/${channelId}` : `https://www.twitch.tv/${channelId}`,
    title: "Manual review recommendation",
    category,
    viewerCount: 0,
    thumbnail: "",
    score,
    reason,
    suggestedUse: ["clips", "edits", "reposts"],
    source: "Agent 101 fallback shortlist"
  }));
}

async function recommendStreamers({ platform = "all", limit = 12 } = {}) {
  const max = Math.min(24, Math.max(1, Number(limit) || 12));
  const providers = platform === "all" ? ["kick", "twitch"] : [platform];
  const rows = [];
  const errors = [];
  if (providers.includes("kick")) {
    try {
      rows.push(...await fetchKickRecommendations(max));
    } catch (error) {
      errors.push({ provider: "kick", message: error.message });
      await logEvent("api_error", "Kick streamer scout failed", { error: error.message });
    }
  }
  if (providers.includes("twitch")) {
    try {
      rows.push(...await fetchTwitchRecommendations(max));
    } catch (error) {
      errors.push({ provider: "twitch", message: error.message });
      await logEvent("api_error", "Twitch streamer scout failed", { error: error.message });
    }
  }

  const existing = knownStreamerKeys();
  const seen = new Set();
  let recommendations = rows
    .filter((row) => row.channelId)
    .filter((row) => {
      const key = streamerIdentityKey(row);
      if (existing.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.score - a.score || b.viewerCount - a.viewerCount)
    .slice(0, max);

  return {
    recommendations,
    errors,
    providers: {
      kickConfigured: kickApiConfigured(),
      twitchConfigured: twitchApiConfigured()
    },
    generatedBy: "Agent 101 Streamer Scout",
    message: recommendations.some((row) => row.source?.includes("Official"))
      ? "Agent 101 found live streamer recommendations from configured provider APIs."
      : "No live provider recommendations were returned. No synthetic streamer recommendations were substituted."
  };
}

async function checkStreamerLive(streamer) {
  streamer.lastCheckedAt = now();
  streamer.channelId = streamer.platform === "kick"
    ? normalizeKickSlug(streamer.channelId || streamer.channelUrl || streamer.displayName) || streamer.channelId
    : normalizeTwitchLogin(streamer.channelId || streamer.channelUrl || streamer.displayName) || streamer.channelId;
  if (streamer.platform === "twitch" && streamer.channelId && !streamer.channelUrl) {
    streamer.channelUrl = `https://www.twitch.tv/${streamer.channelId}`;
  }
  if (streamer.platform === "kick" && streamer.channelId && !streamer.channelUrl) {
    streamer.channelUrl = `https://kick.com/${streamer.channelId}`;
  }

  if (!isApprovedStreamer(streamer)) {
    streamer.liveStatus = "blocked";
    streamer.liveStatusReason = "Streamer permission is not approved";
    return { streamerId: streamer.id, live: false, skipped: true, official: false, reason: streamer.liveStatusReason };
  }

  if (!channelAllowed(streamer)) {
    streamer.liveStatus = "blocked";
    streamer.liveStatusReason = "Streamer is not in TWITCH_ALLOWED_CHANNELS";
    return { streamerId: streamer.id, live: false, skipped: true, official: false, reason: streamer.liveStatusReason };
  }

  if (!["twitch", "kick"].includes(streamer.platform)) {
    streamer.liveStatus = "unsupported";
    streamer.liveStatusReason = "Official live checks are wired for Twitch and Kick only";
    return { streamerId: streamer.id, live: null, skipped: true, official: false, reason: streamer.liveStatusReason };
  }

  if (streamer.platform === "twitch" && !twitchApiConfigured()) {
    streamer.liveStatus = "api_not_configured";
    streamer.liveStatusReason = "Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET for official live checks";
    return { streamerId: streamer.id, live: null, skipped: true, official: false, reason: streamer.liveStatusReason };
  }
  if (streamer.platform === "kick" && !kickApiConfigured()) {
    streamer.liveStatus = "api_not_configured";
    streamer.liveStatusReason = "Set KICK_CLIENT_ID and KICK_CLIENT_SECRET for official Kick live checks";
    return { streamerId: streamer.id, live: null, skipped: true, official: false, reason: streamer.liveStatusReason };
  }

  const stream = streamer.platform === "kick" ? await fetchKickStream(streamer) : await fetchTwitchStream(streamer);
  streamer.liveStatus = stream ? "live" : "offline";
  streamer.liveStatusReason = stream
    ? `Official ${streamer.platform === "kick" ? "Kick" : "Twitch Helix"} stream is live`
    : `Official ${streamer.platform === "kick" ? "Kick" : "Twitch Helix"} API returned no active stream`;
  streamer.liveTitle = stream?.title || "";
  streamer.liveCategory = stream?.game_name || "";
  streamer.liveViewerCount = stream?.viewer_count || 0;
  streamer.liveThumbnailUrl = stream?.thumbnail_url || stream?.thumbnail || "";
  streamer.lastLiveAt = stream ? now() : streamer.lastLiveAt;
  return { streamerId: streamer.id, live: Boolean(stream), official: true, provider: streamer.platform, stream };
}

async function testOpenAI() {
  if (!config.openaiApiKey) {
    return {
      configured: false,
      live: false,
      message: "OPENAI_API_KEY is not configured. Local fallback generation is active."
    };
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.openaiApiKey}`
    },
    body: JSON.stringify({
      model: config.openaiModel,
      input: "Return one short sentence confirming StreamClipper Agent backend connectivity."
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI test failed: ${response.status} ${text.slice(0, 180)}`);
  }
  const json = await response.json();
  return {
    configured: true,
    live: true,
    model: config.openaiModel,
    message: json.output_text || "OpenAI backend connectivity confirmed."
  };
}

function createPostingDraftsForPackage(clipPackage, packagePlan) {
  const renderedArtifact = state.artifacts.find((artifact) => artifact.id === clipPackage.renderedArtifactId);
  if (!artifactIsVerifiedClip(renderedArtifact)) {
    throw new Error("Posting preparation stopped because no verified clip was produced.");
  }
  const platforms = ["tiktok", "instagram_reels", "youtube_shorts"];
  return platforms.map((platform) => {
    const draft = {
      id: newId("post"),
      clipPackageId: clipPackage.id,
      clipArtifactId: renderedArtifact.id,
      platform,
      videoRef: renderedArtifact.playbackUrl || renderedArtifact.url || renderedArtifact.id,
      caption:
        platform === "tiktok"
          ? packagePlan.captions.tiktok
          : platform === "instagram_reels"
            ? packagePlan.captions.reels
            : packagePlan.captions.shorts,
      hashtags: packagePlan.hashtags,
      thumbnailText: packagePlan.thumbnailText,
      scheduledFor: "",
      status: "draft",
      platformStatus: "not_uploaded",
      approvalStatus: "pending",
      requiresApproval: true,
      riskNotes: ["Draft only. Human Gate approval is required before external upload or publish."],
      createdAt: now(),
      updatedAt: now()
    };
    state.postingDrafts.unshift(draft);
    createApprovalRequest({
      type: "posting_draft",
      title: `${platform.replace("_", " ")} draft: ${packagePlan.title}`,
      riskLevel: "medium",
      linkedId: draft.id,
      evidence: { clipPackageId: clipPackage.id, platform }
    });
    return draft;
  });
}

const AGENT101_SYSTEM_PROMPT = `You are Agent 101, a truthful supervised clipping agent inside StreamClipper. Never claim you found, watched, clipped, rendered, queued, or posted media unless the corresponding verified record or file exists. Honor requested quantities exactly. If the user requests two streamers, return no more than two. Do not silently expand scope. Real mode may only use real Twitch records from official APIs with provider IDs, fetch timestamps, and response hashes. Demo mode must be explicitly requested and clearly labeled DEMO / SYNTHETIC — NOT REAL TWITCH DATA. Follow the workflow in order: discovery, validation, rights, source, analysis, candidate, clip, verify, posting draft, approval. Do not create downstream artifacts before prerequisites are complete. If a real integration, right, or media source is unavailable, explain the exact blocker and stop. Do not replace a failed real action with a simulation.`;

const AGENT101_DEMO_STREAMERS = [
  {
    displayName: "xQc Demo",
    channelId: "xqc-demo",
    category: "VALORANT",
    title: "Insane 1v4 clutch pulls the lobby back"
  },
  {
    displayName: "HasanAbi Demo",
    channelId: "hasanabi-demo",
    category: "Just Chatting",
    title: "Hilarious bait and switch catches chat"
  },
  {
    displayName: "KaiCenat Demo",
    channelId: "kaicenat-demo",
    category: "Just Chatting",
    title: "Crazy reaction turns into a perfect clip"
  },
  {
    displayName: "Tarik Demo",
    channelId: "tarik-demo",
    category: "VALORANT",
    title: "Perfect timing wins the round"
  },
  {
    displayName: "Ludwig Demo",
    channelId: "ludwig-demo",
    category: "Variety",
    title: "Unexpected ending becomes the hook"
  }
];

const AGENT101_CLIP_IDEAS = [
  ["Insane 1v4 Clutch", "I can't believe he pulled this off. Chat went wild at the final shot.", 42, 96],
  ["Hilarious Bait & Switch", "Chat was not ready for that response. Perfect reaction beat.", 28, 93],
  ["Crazy Reaction", "His face says everything. No way that just happened.", 31, 89],
  ["Perfect Timing", "The timing on this was perfect. Set up, pause, payoff.", 35, 87],
  ["Epic Save", "He saved the round single-handedly and chat exploded.", 29, 83],
  ["Unexpected End", "Nobody saw that ending coming. Strong twist in the last two seconds.", 33, 78],
  ["Strategic Play", "This move looked risky but it paid off cleanly.", 44, 74],
  ["Wild Chat Moment", "The chat spike happens right as the streamer realizes what happened.", 26, 82],
  ["Clean Ace", "Every cut lands on action and the payoff is easy to understand.", 36, 91],
  ["Rage Moment", "Big emotion, fast setup, and a clear ending for a short-form edit.", 24, 76],
  ["Perfect Callout", "The callout looks impossible until the replay makes it obvious.", 38, 85],
  ["Clutch Reaction Combo", "Gameplay and face-cam reaction peak at the same time.", 30, 94]
];

const AGENT101_BLOCKED_ACTIONS = [
  {
    pattern: /\b(publish|upload|direct[- ]?post|auto[- ]?post|post publicly|post this video|go live|push live|release externally)\b/i,
    reason: "Publishing or uploading externally requires Human Gate approval."
  },
  {
    pattern: /\b(spend|buy|pay|purchase|move money|payment)\b/i,
    reason: "Money movement and purchases require Human Gate approval."
  },
  {
    pattern: /\b(change account|modify account|connect account|connect social|log in|login|create api key|rotate api key|set credential)\b/i,
    reason: "Account, login, and credential changes require Human Gate approval."
  },
  {
    pattern: /\b(delete|remove live content|use real streamer content|claim permission|impersonat)/i,
    reason: "Deleting content, claiming permission, or using unapproved real streamer content requires Human Gate approval."
  },
  {
    pattern: /\b(bypass human gate|skip approval|ignore daily limit|disable approval)\b/i,
    reason: "Approval gates and daily limits cannot be bypassed."
  }
];

const AGENT101_RISKY_ACTION_TYPES = new Set([
  "publish",
  "publish_video",
  "upload_to_tiktok",
  "upload_to_instagram",
  "upload_to_youtube",
  "direct_post",
  "spend_money",
  "move_money",
  "change_account",
  "connect_social_account",
  "delete_content",
  "use_unapproved_streamer_content",
  "external_api_action"
]);

const AGENT101_SAFE_INTERNAL_ACTION_TYPES = new Set([
  "add_demo_streamers",
  "run_demo_watch_cycle",
  "create_demo_candidates",
  "score_candidates",
  "create_clip_package",
  "create_capcut_brief",
  "create_posting_draft",
  "create_approval_request",
  "save_artifact",
  "add_log"
]);

function requiresHumanGate(actionType) {
  const normalized = cleanText(actionType).toLowerCase();
  if (!normalized) return false;
  if (AGENT101_SAFE_INTERNAL_ACTION_TYPES.has(normalized)) return false;
  return AGENT101_RISKY_ACTION_TYPES.has(normalized);
}

function agentToolLabel(name) {
  return cleanText(name)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .toLowerCase();
}

function agentCountsSnapshot() {
  return {
    streamers: state.streamers.length,
    sessions: state.streamSessions.length,
    candidates: state.clipCandidates.length,
    packages: state.clipPackages.length,
    drafts: state.postingDrafts.length,
    approvals: state.approvalRequests.length,
    artifacts: state.artifacts.length,
    logs: state.logs.length
  };
}

function agentCountsDelta(before) {
  const after = agentCountsSnapshot();
  return Object.fromEntries(Object.entries(after).map(([key, value]) => [key, value - Number(before[key] || 0)]));
}

function addAgentLog(run, type, message, details = {}) {
  const entry = addStateLog(type, message, {
    agent: "Agent 101",
    runId: run.runId,
    ...details
  });
  run.logs.push(entry);
  return entry;
}

function addAgentStep(run, tool, status, message, details = {}) {
  const step = {
    index: run.steps.length + 1,
    tool,
    status,
    message,
    details,
    createdAt: now()
  };
  run.steps.push(step);
  run.currentStep = message;
  return step;
}

function blockedAgentAction(goal) {
  const text = cleanText(goal);
  const lower = text.toLowerCase();
  const match = AGENT101_BLOCKED_ACTIONS.find((item) => item.pattern.test(text));
  if (!match) return null;
  const isSafeInternalRun = shouldRunFullInternalWorkflow(text);
  const hasExternalSafetyBoundary =
    /\b(do not|don't|never)\s+(post|upload|publish|push live|release externally)\b/.test(lower) ||
    /\b(no|nothing)\s+(external|externally|publicly)\b/.test(lower) ||
    /\b(posting|uploads?|publishing)\s+(remain|stays?|stay)\s+blocked\b/.test(lower);
  if (isSafeInternalRun && hasExternalSafetyBoundary && match.reason.includes("Publishing or uploading")) {
    return null;
  }
  return match;
}

async function agentOpenAIPlan(goal) {
  if (!config.openaiApiKey) {
    return {
      used: false,
      mode: "local",
      message: "OpenAI is not configured. Agent 101 used local deterministic planning."
    };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.openaiApiKey}`
      },
      body: JSON.stringify({
        model: config.openaiModel,
        input: `${AGENT101_SYSTEM_PROMPT}

Goal: ${goal}

Return a compact JSON object with keys: summary, riskLevel, suggestedActions, followUpQuestions. Keep it specific to a supervised internal StreamClipper workflow.`
      })
    });
    if (!response.ok) throw new Error(`OpenAI planning failed: ${response.status}`);
    const json = await response.json();
    return {
      used: true,
      mode: "openai",
      model: config.openaiModel,
      message: json.output_text || "OpenAI planning completed."
    };
  } catch (error) {
    return {
      used: false,
      mode: "local_fallback",
      message: "OpenAI was unavailable, so Agent 101 used local deterministic planning.",
      error: error.message
    };
  }
}

function parseJsonObject(text) {
  const raw = cleanText(text);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function agentOpenAIScoreCandidates(run, candidates) {
  if (!config.openaiApiKey || !candidates.length) {
    return { used: false, scores: [], reason: "OpenAI unavailable; local scoring fallback used." };
  }
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.openaiApiKey}`
      },
      body: JSON.stringify({
        model: config.openaiModel,
        input: `${AGENT101_SYSTEM_PROMPT}

Score these safe internal demo clip candidates as one batch. Return only JSON:
{
  "scores": [
    {
      "id": "candidate id",
      "score": 0-100,
      "hookScore": 0-100,
      "engagementPotential": 0-100,
      "retentionPotential": 0-100,
      "riskScore": 0-100,
      "reason": "short reason",
      "suggestedHook": "short hook",
      "suggestedTitle": "short title"
    }
  ]
}

Candidates:
${JSON.stringify(candidates.map((candidate) => ({
  id: candidate.id,
  streamerName: candidate.streamerName,
  title: candidate.title,
  category: candidate.category,
  duration: candidate.duration,
  transcriptSnippet: candidate.transcriptSnippet,
  chatSignals: candidate.chatSignals,
  reason: candidate.reason
})), null, 2)}`
      })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI candidate scoring failed: ${response.status} ${text.slice(0, 160)}`);
    }
    const json = await response.json();
    const parsed = parseJsonObject(json.output_text || "");
    const scores = Array.isArray(parsed?.scores) ? parsed.scores : [];
    if (!scores.length) throw new Error("OpenAI scoring response did not include scores array");
    addAgentLog(run, "openai_call", "OpenAI scored clip candidates in one batch", {
      count: scores.length,
      model: config.openaiModel
    });
    return { used: true, scores };
  } catch (error) {
    addAgentLog(run, "openai_fallback", "OpenAI scoring failed; local scoring fallback used", { error: error.message });
    return { used: false, scores: [], reason: error.message };
  }
}

function shouldRunFullInternalWorkflow(goal) {
  const lower = cleanText(goal).toLowerCase();
  return (
    /full.*workflow|full supervised|clipping workflow|demo clipping|test.*clips office|test.*clipping|fully automate internally|run it|go ahead/.test(lower) ||
    /practice stream|demo stream|find\s+\d+\s+practice|find\s+\d+\s+demo|make clips|package top|top 3/.test(lower) ||
    (/clip candidates/.test(lower) && /find|practice|demo|stream|make|create|generate/.test(lower))
  );
}

function agentToolPlan(goal, mode = "demo") {
  const lower = cleanText(goal).toLowerCase();
  if (shouldRunFullInternalWorkflow(goal)) {
    return [
      "addDemoStreamers",
      "runWatchCycle",
      "createClipCandidates",
      "scoreClipCandidates",
      "createClipPackage",
      "createCapCutBrief",
      "createPostingDraft",
      "createApprovalRequest",
      "saveArtifact",
      "addLog"
    ];
  }
  if (/^add.*demo.*streamer|^seed.*demo.*streamer/.test(lower)) {
    return ["addDemoStreamers", "addLog"];
  }
  if (/candidate|make clips|find clips|score clips|clip radar/.test(lower) && !/package|capcut|posting|draft/.test(lower)) {
    return ["addDemoStreamers", "runWatchCycle", "createClipCandidates", "scoreClipCandidates", "addLog"];
  }
  if (/package|capcut|posting draft|top 3|human gate/.test(lower) && !/full|workflow|demo/.test(lower)) {
    return ["scoreClipCandidates", "createClipPackage", "createCapCutBrief", "createPostingDraft", "createApprovalRequest", "saveArtifact", "addLog"];
  }
  if (/run.*watch|watch.*cycle|check.*stream/.test(lower) && !/candidate|package|workflow|capcut|draft/.test(lower)) {
    return ["addDemoStreamers", "runWatchCycle", "addLog"];
  }
  if (mode === "live" && /recommend|scout/.test(lower)) {
    return ["addLog"];
  }
  return [
    "addDemoStreamers",
    "runWatchCycle",
    "createClipCandidates",
    "scoreClipCandidates",
    "createClipPackage",
    "createCapCutBrief",
    "createPostingDraft",
    "createApprovalRequest",
    "saveArtifact",
    "addLog"
  ];
}

function newestAgentCandidates(limit = 12) {
  return [...state.clipCandidates]
    .filter((candidate) => ["candidate", "packaged", "reviewed"].includes(candidate.status || "candidate"))
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, limit);
}

function formatClipTimestamp(totalSeconds) {
  const safeSeconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `00:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function demoApprovedStreamers() {
  return state.streamers
    .filter((streamer) => streamer.monitorEnabled && (streamer.isDemo || streamer.permissionStatus === "demo_approved"))
    .slice(0, 5);
}

function createSinglePostingDraft(clipPackage, packagePlan) {
  const existing = state.postingDrafts.find((draft) => draft.clipPackageId === clipPackage.id && draft.createdBy === "Agent 101");
  if (existing) return existing;
  const renderedArtifact = state.artifacts.find((artifact) => artifact.id === clipPackage.renderedArtifactId);
  if (!artifactIsVerifiedClip(renderedArtifact)) {
    throw new Error("Posting preparation stopped because no verified clip was produced.");
  }
  const platforms = ["tiktok", "instagram_reels", "youtube_shorts"];
  const draft = {
    id: newId("post"),
    clipPackageId: clipPackage.id,
    clipArtifactId: renderedArtifact.id,
    platform: "multi_platform",
    platforms,
    videoRef: renderedArtifact.playbackUrl || renderedArtifact.url || renderedArtifact.id,
    caption: packagePlan.captions?.tiktok || `${packagePlan.hook}. ${packagePlan.title}`,
    tiktokCaption: packagePlan.captions?.tiktok || `${packagePlan.hook}. ${packagePlan.title}`,
    instagramCaption: packagePlan.captions?.reels || `${packagePlan.title}. ${packagePlan.hook}`,
    youtubeShortsCaption: packagePlan.captions?.shorts || `${packagePlan.hook} | ${packagePlan.title}`,
    hashtags: packagePlan.hashtags || [],
    thumbnailText: packagePlan.thumbnailText || packagePlan.hook,
    postingNotes: [
      "Draft package only.",
      "Manual handoff after Human Gate approval.",
      "No upload or public post has been attempted."
    ],
    scheduledFor: "",
    status: "draft",
    platformStatus: "not_uploaded",
    approvalStatus: "pending",
    requiresApproval: true,
    riskNotes: ["Draft only. Human Gate approval is required before any external upload or publish."],
    createdBy: "Agent 101",
    createdAt: now(),
    updatedAt: now(),
    approvedAt: null
  };
  state.postingDrafts.unshift(draft);
  clipPackage.postingDrafts = Array.from(new Set([...(clipPackage.postingDrafts || []), draft.id]));
  return draft;
}

async function createAgentCapCutBrief(clipPackage) {
  const existing = state.artifacts.find((artifact) => artifact.id === clipPackage.capcutBriefId);
  if (existing) return { brief: null, artifacts: [existing], reused: true };
  const plan = clipPackage.packagePlan || {};
  const brief = {
    id: newId("capcut_brief"),
    packageId: clipPackage.id,
    projectTitle: plan.title || "StreamClipper CapCut Project",
    aspectRatio: "9:16",
    resolution: "1080x1920",
    exportFormat: "mp4",
    targetLength: `${clipPackage.targetDuration || 30}s`,
    timelineInstructions: plan.cutInstructions || clipPackage.cutInstructions || [],
    cutInstructions: plan.cutInstructions || clipPackage.cutInstructions || [],
    captionStyle: "Bold, high-contrast, 1-6 words per line, kept out of platform safe zones.",
    captionOverlayInstructions: plan.captionOverlays || clipPackage.captionOverlays || [],
    cropZoomGuidance: plan.cropGuidance || [],
    zoomCropInstructions: plan.cropGuidance || [],
    transitions: ["Hard cuts on action beats", "Subtle punch-in on reaction payoff"],
    effects: ["Clean glow highlight on key moment", "No copyrighted music or branded overlays without review"],
    musicNotes: ["Manual handoff only. Use cleared audio or platform-safe sound after approval."],
    soundEffectsNotes: ["Use subtle beat hits only where they support the reaction.", "Avoid copyrighted music unless cleared."],
    exportChecklist: plan.approvalChecklist || [],
    status: "ready",
    createdAt: now(),
    createdBy: "Agent 101"
  };
  const jsonArtifact = await writeArtifact("capcut_brief", brief.projectTitle, brief, "json");
  const textArtifact = await writeArtifact(
    "capcut_brief",
    `${brief.projectTitle}-handoff`,
    [
      `Project: ${brief.projectTitle}`,
      `Aspect: ${brief.aspectRatio}`,
      `Resolution: ${brief.resolution}`,
      `Target length: ${brief.targetLength}`,
      "",
      "Cut instructions:",
      ...brief.cutInstructions.map((item) => `- ${item}`),
      "",
      "Caption overlays:",
      ...brief.captionOverlayInstructions.map((item) => `- ${item}`),
      "",
      "Zoom/crop:",
      ...brief.zoomCropInstructions.map((item) => `- ${item}`),
      "",
      "Export checklist:",
      ...brief.exportChecklist.map((item) => `- ${item}`)
    ].join("\n"),
    "txt"
  );
  clipPackage.capcutBriefId = jsonArtifact.id;
  clipPackage.artifacts = Array.from(new Set([...(clipPackage.artifacts || []), jsonArtifact, textArtifact]));
  clipPackage.updatedAt = now();
  return { brief, artifacts: [jsonArtifact, textArtifact], reused: false };
}

const HANDOFF_ACTIVE_STATUSES = new Set([
  "DRAFT",
  "PREPARING",
  "PACKAGE_READY",
  "BROWSER_STARTING",
  "CAPCUT_OPEN",
  "WAITING_FOR_LOGIN",
  "WAITING_FOR_UPLOAD",
  "UPLOADING",
  "HUMAN_EDITING",
  "WAITING_FOR_EXPORT",
  "EXPORT_DETECTED",
  "IMPORTING_EXPORT",
  "TECHNICAL_QA",
  "HUMAN_REVIEW"
]);

function resolveClipPackageForHandoff(body = {}) {
  const clipId = cleanText(body.clipId || body.candidateClipId);
  const packageId = cleanText(body.clipPackageId || body.packageId);
  const renderId = cleanText(body.renderId || body.renderedArtifactId);
  return (
    state.clipPackages.find((item) => item.id === packageId) ||
    state.clipPackages.find((item) => item.id === clipId || item.candidateId === clipId) ||
    state.clipPackages.find((item) => item.renderedArtifactId === renderId) ||
    null
  );
}

function handoffPreflight(handoff) {
  const clipPackage = state.clipPackages.find((item) => item.id === handoff.clipPackageId);
  const candidate = state.clipCandidates.find((item) => item.id === clipPackage?.candidateId);
  const streamer = findStreamer(candidate?.streamerId);
  const source = findExistingMediaSource(candidate?.sourceId);
  const rendered = state.artifacts.find((artifact) => artifact.id === (handoff.renderId || clipPackage?.renderedArtifactId));
  const captionArtifact = state.artifacts.find((artifact) =>
    ["captions", "caption_set"].includes(artifact.kind || artifact.type) &&
    (clipPackage?.artifacts || []).some((ref) => (typeof ref === "string" ? ref : ref?.id) === artifact.id)
  );
  const checks = [
    {
      key: "source_video",
      label: "Source video exists",
      passed: Boolean(source?.filePath || candidate?.mediaPlayable || rendered?.path),
      message: source?.filePath || candidate?.mediaPlayable || rendered?.path
        ? "Source media is tracked in StreamClipper."
        : "No source file is linked yet. Manual source upload is required before export QA."
    },
    {
      key: "vertical_render",
      label: "Vertical render exists",
      passed: artifactIsVerifiedClip(rendered),
      message: artifactIsVerifiedClip(rendered)
        ? "A verified 9:16 draft is available."
        : "No verified vertical draft MP4 exists yet."
    },
    {
      key: "audio_track",
      label: "Audio track exists",
      passed: Boolean(rendered?.content?.probe?.hasAudio || rendered?.content?.hasAudio || clipPackage?.audioStatus === "ready"),
      message: rendered?.content?.probe?.hasAudio || rendered?.content?.hasAudio
        ? "Audio was detected on the rendered clip."
        : "Audio has not been verified yet."
    },
    {
      key: "captions",
      label: "Captions generated",
      passed: Boolean(captionArtifact || clipPackage?.captionOverlays?.length || clipPackage?.packagePlan?.captionOverlays?.length),
      message: "Caption overlays or files are available for the handoff notes."
    },
    {
      key: "rights",
      label: "Rights status approved",
      passed: isApprovedStreamer(streamer),
      message: isApprovedStreamer(streamer)
        ? `${streamer?.displayName || "Creator"} is approved for this local workflow.`
        : "Creator permission is not approved; Human Gate must review before external use."
    },
    {
      key: "human_review",
      label: "Human review complete",
      passed: clipPackage?.approvalStatus === "approved" || handoff.reviewStatus === "approved",
      message: clipPackage?.approvalStatus === "approved" || handoff.reviewStatus === "approved"
        ? "Human review is complete."
        : "Human Gate approval is still required before posting or public use."
    },
    {
      key: "temporary_links",
      label: "Temporary download links created",
      passed: Boolean(rendered?.url || rendered?.playbackUrl),
      message: rendered?.url || rendered?.playbackUrl
        ? "Local download/playback URL is available."
        : "No verified media link exists yet; handoff package will include instructions only."
    },
    {
      key: "browser_ready",
      label: "Browser session ready",
      passed: Boolean(state.browser?.sessions?.some((session) => session.status !== "closed")),
      message: state.browser?.sessions?.some((session) => session.status !== "closed")
        ? "A supervised browser session is available."
        : "Start a supervised browser session when you are ready to open CapCut."
    }
  ];
  return {
    checks,
    passed: checks.every((check) => check.passed),
    warnings: checks.filter((check) => !check.passed).map((check) => check.message)
  };
}

function publicHandoff(handoff) {
  if (!handoff) return null;
  const clipPackage = state.clipPackages.find((item) => item.id === handoff.clipPackageId);
  const candidate = state.clipCandidates.find((item) => item.id === clipPackage?.candidateId);
  const streamer = findStreamer(candidate?.streamerId);
  const rendered = state.artifacts.find((artifact) => artifact.id === (handoff.renderId || clipPackage?.renderedArtifactId));
  return {
    ...handoff,
    clipPackage,
    candidate,
    creator: streamer ? { id: streamer.id, displayName: streamer.displayName, platform: streamer.platform } : null,
    active: HANDOFF_ACTIVE_STATUSES.has(handoff.status),
    preflight: handoffPreflight(handoff),
    thumbnail: candidate?.thumbnailUrl || candidate?.frameUrl || rendered?.thumbnailUrl || "",
    sourceDuration: candidate?.duration || clipPackage?.targetDuration || 0,
    outputDuration: clipPackage?.targetDuration || candidate?.duration || 0,
    renderStatus: artifactIsVerifiedClip(rendered) ? "verified" : "missing",
    captionStatus: clipPackage?.captionOverlays?.length ? "ready" : "needs review",
    packageStatus: handoff.artifactIds?.length ? "ready" : "draft"
  };
}

async function setHandoffStatus(handoff, status, actor = "operator", message = "", metadata = {}) {
  handoff.status = status;
  handoff.updatedAt = now();
  const event = {
    id: newId("handoff_event"),
    handoffId: handoff.id,
    status,
    actor,
    message: message || status.toLowerCase().replaceAll("_", " "),
    metadata,
    createdAt: now()
  };
  handoff.events ||= [];
  handoff.events.unshift(event);
  await logEvent("handoff_state_changed", event.message, {
    handoffId: handoff.id,
    status,
    actor,
    ...metadata
  });
  return event;
}

async function createHandoffPackage(body = {}) {
  const clipPackage = resolveClipPackageForHandoff(body);
  if (!clipPackage) {
    throw Object.assign(new Error("No clip package is ready for a CapCut handoff."), { statusCode: 404 });
  }
  const existing = state.handoffPackages.find(
    (handoff) => handoff.clipPackageId === clipPackage.id && !["COMPLETED", "CANCELLED"].includes(handoff.status)
  );
  if (existing) return { handoff: existing, reused: true };
  const candidate = state.clipCandidates.find((item) => item.id === clipPackage.candidateId);
  const streamer = findStreamer(candidate?.streamerId);
  const rendered = state.artifacts.find((artifact) => artifact.id === (body.renderId || clipPackage.renderedArtifactId));
  const handoff = {
    id: newId("handoff"),
    organizationId: "local",
    creatorId: streamer?.id || "",
    candidateClipId: candidate?.id || clipPackage.candidateId || "",
    clipPackageId: clipPackage.id,
    editProjectId: body.editProjectId || DEMO_PROJECT_ID,
    renderId: rendered?.id || clipPackage.renderedArtifactId || "",
    browserSessionId: "",
    status: "DRAFT",
    sourceAssetKey: candidate?.sourceId || "",
    draftAssetKey: rendered?.filename || rendered?.id || "",
    captionSrtKey: "",
    captionVttKey: "",
    editPlanKey: "",
    socialCopyKey: "",
    thumbnailKey: "",
    exportedAssetKey: "",
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString(),
    createdById: body.createdById || "operator",
    artifactIds: [],
    reviewStatus: clipPackage.approvalStatus || "draft",
    events: [],
    createdAt: now(),
    updatedAt: now()
  };
  state.handoffPackages.unshift(handoff);
  await setHandoffStatus(handoff, "DRAFT", "operator", "CapCut handoff package drafted", { clipPackageId: clipPackage.id });
  await saveState();
  return { handoff, reused: false };
}

function handoffReadme() {
  return [
    "StreamClipper Supervised CapCut Handoff",
    "",
    "1. Upload vertical-draft.mp4 when available, or use the original/source media shown in StreamClipper.",
    "2. Import captions.srt where CapCut supports captions.",
    "3. Review edit-plan.json before changing timing, crops, captions, or music.",
    "4. Do not alter the creator's meaning.",
    "5. Export at 1080 x 1920.",
    "6. Use H.264 video and AAC audio where available.",
    "7. Return the exported file to StreamClipper for technical QA.",
    "8. Do not publish directly unless the creator and Human Gate have separately approved it.",
    "",
    "CapCut is human-controlled. Agent 101 will not log in, solve CAPTCHA, buy anything, publish, or operate account settings."
  ].join("\n");
}

function captionFileText(overlays = [], type = "srt") {
  const lines = (overlays.length ? overlays : ["Watch this", "No way", "Wait for the payoff"]).slice(0, 5);
  if (type === "vtt") {
    return `WEBVTT\n\n${lines.map((line, index) => {
      const start = String(index * 2).padStart(2, "0");
      const end = String(index * 2 + 2).padStart(2, "0");
      return `00:00:${start}.000 --> 00:00:${end}.000\n${line}`;
    }).join("\n\n")}`;
  }
  return lines.map((line, index) => {
    const start = String(index * 2).padStart(2, "0");
    const end = String(index * 2 + 2).padStart(2, "0");
    return `${index + 1}\n00:00:${start},000 --> 00:00:${end},000\n${line}`;
  }).join("\n\n");
}

async function prepareHandoffPackage(handoff) {
  const clipPackage = state.clipPackages.find((item) => item.id === handoff.clipPackageId);
  if (!clipPackage) throw Object.assign(new Error("Clip package not found."), { statusCode: 404 });
  await setHandoffStatus(handoff, "PREPARING", "agent101", "Preparing supervised CapCut handoff package", { clipPackageId: clipPackage.id });
  const candidate = state.clipCandidates.find((item) => item.id === clipPackage.candidateId);
  const plan = clipPackage.packagePlan || buildPackage(candidate || {});
  const briefResult = await createAgentCapCutBrief(clipPackage);
  const editPlan = {
    clipId: candidate?.id || clipPackage.candidateId,
    packageId: clipPackage.id,
    sourceIn: candidate?.timestampStart || "00:00:00",
    sourceOut: candidate?.timestampEnd || "",
    outputDimensions: "1080x1920",
    frameRate: "source-native 30/60fps",
    faceCamCrop: plan.cropGuidance?.[0] || "Keep creator reaction visible when present.",
    gameplayCrop: plan.cropGuidance?.[1] || "Keep primary action centered.",
    captionSafeZone: "Avoid bottom 18% and right platform UI strip.",
    hookText: plan.hook || clipPackage.hook || clipPackage.title,
    speakerLabels: ["Creator", "Chat/context"],
    audioNormalizationNotes: "Keep original meaning and avoid heavy music over speech.",
    sensitiveWordMarkers: [],
    brandTemplateId: "streamclipper-default",
    recommendedExportSettings: {
      aspectRatio: "9:16",
      resolution: "1080x1920",
      codec: "H.264",
      audio: "AAC",
      container: "MP4"
    }
  };
  const socialCopy = {
    suggestedTitle: plan.title || clipPackage.title,
    tiktokCaption: plan.captions?.tiktok || `${plan.hook}. ${plan.title}`,
    youtubeShortsTitle: plan.title || clipPackage.title,
    instagramReelCaption: plan.captions?.reels || `${plan.title}. ${plan.hook}`,
    hashtagCandidates: plan.hashtags || [],
    sponsorDisclosure: "None identified. Add disclosure if sponsor/affiliate context exists.",
    contentWarningRecommendation: "No content warning detected from current draft metadata.",
    creatorApprovalNotes: "Human Gate must approve before any public posting."
  };
  const artifacts = [
    ...(briefResult.artifacts || []),
    await writeArtifact("capcut_handoff", `${clipPackage.title}-edit-plan`, editPlan, "json"),
    await writeArtifact("capcut_handoff", `${clipPackage.title}-social-copy`, socialCopy, "json"),
    await writeArtifact("capcut_handoff", `${clipPackage.title}-captions`, captionFileText(plan.captionOverlays || clipPackage.captionOverlays || [], "srt"), "srt"),
    await writeArtifact("capcut_handoff", `${clipPackage.title}-captions`, captionFileText(plan.captionOverlays || clipPackage.captionOverlays || [], "vtt"), "vtt"),
    await writeArtifact("capcut_handoff", `${clipPackage.title}-transcript`, candidate?.transcriptSnippet || "Transcript unavailable. Review source media manually.", "txt"),
    await writeArtifact("capcut_handoff", `${clipPackage.title}-clip-details`, { clipPackage, candidate, preflight: handoffPreflight(handoff) }, "json"),
    await writeArtifact("capcut_handoff", `${clipPackage.title}-README`, handoffReadme(), "txt")
  ];
  handoff.artifactIds = Array.from(new Set([...(handoff.artifactIds || []), ...artifacts.map((artifact) => artifact.id)]));
  handoff.captionSrtKey = artifacts.find((artifact) => artifact.filename?.endsWith(".srt"))?.filename || "";
  handoff.captionVttKey = artifacts.find((artifact) => artifact.filename?.endsWith(".vtt"))?.filename || "";
  handoff.editPlanKey = artifacts.find((artifact) => artifact.title.includes("edit-plan"))?.filename || "";
  handoff.socialCopyKey = artifacts.find((artifact) => artifact.title.includes("social-copy"))?.filename || "";
  clipPackage.handoffId = handoff.id;
  clipPackage.updatedAt = now();
  await setHandoffStatus(handoff, "PACKAGE_READY", "agent101", "CapCut handoff package is ready for human-controlled editing", {
    artifacts: artifacts.length,
    preflightPassed: handoffPreflight(handoff).passed
  });
  await saveState();
  return { handoff, artifacts };
}

function smokeResultStatus(checks) {
  if (checks.some((check) => check.status === "failed")) return "failed";
  if (checks.some((check) => check.status === "warning")) return "warning";
  return "passed";
}

function createSmokeCheck(key, label, status, message, technical = "", startedAt = Date.now()) {
  return {
    key,
    label,
    status,
    message,
    technical,
    durationMs: Math.max(0, Date.now() - startedAt),
    completedAt: now()
  };
}

async function runSystemSmokeTest() {
  const startedAt = now();
  const checks = [];
  const runCheck = async (key, label, fn) => {
    const started = Date.now();
    try {
      const result = await fn();
      checks.push(createSmokeCheck(key, label, result.status || "passed", result.message || "Passed.", result.technical || "", started));
    } catch (error) {
      checks.push(createSmokeCheck(key, label, "failed", error.message || "Check failed.", error.stack || error.message, started));
    }
  };

  await runCheck("api", "API reachable", async () => ({ status: "passed", message: "StreamClipper API route handler is responding." }));
  await runCheck("state", "Persistent state writable", async () => {
    await fs.access(path.dirname(DATA_FILE));
    await saveState();
    return { status: "passed", message: "Local JSON state is writable." };
  });
  await runCheck("postgres", "PostgreSQL reachable", async () => ({
    status: config.databaseUrl ? "warning" : "warning",
    message: config.databaseUrl
      ? "DATABASE_URL is set, but this plain Node prototype does not include a Postgres client yet."
      : "PostgreSQL is not configured in this local prototype.",
    technical: "Use DATABASE_URL plus a database adapter before marking this check passed."
  }));
  await runCheck("redis", "Redis reachable", async () => ({
    status: config.redisUrl ? "warning" : "warning",
    message: config.redisUrl
      ? "REDIS_URL is set, but BullMQ/Redis workers are not installed in this prototype yet."
      : "Redis is not configured; background work is in-process/local only.",
    technical: "Use REDIS_URL and a queue worker before marking Redis passed."
  }));
  await runCheck("queue", "Queue reachable", async () => ({
    status: "warning",
    message: "Queue foundation is local/in-process. No BullMQ worker is connected yet."
  }));
  await runCheck("storage", "Object storage reachable", async () => {
    await fs.access(config.outputDir);
    return {
      status: config.objectStorageBucket ? "warning" : "warning",
      message: config.objectStorageBucket
        ? "Object-storage env is present, but this build still writes to local output storage."
        : "Local output storage is writable; S3-compatible object storage is not configured yet.",
      technical: `outputDir=${config.outputDir}`
    };
  });
  const media = await mediaToolStatus();
  checks.push(createSmokeCheck("ffmpeg", "FFmpeg installed", media.ffmpeg.configured ? "passed" : "failed", media.ffmpeg.configured ? "FFmpeg is available." : media.ffmpeg.message, media.ffmpeg.version || media.ffmpeg.command));
  checks.push(createSmokeCheck("ffprobe", "FFprobe installed", media.ffprobe.configured ? "passed" : "failed", media.ffprobe.configured ? "FFprobe is available." : media.ffprobe.message, media.ffprobe.version || media.ffprobe.command));
  await runCheck("browser_worker", "Browser worker reachable", async () => {
    if (!config.browserEnabled) return { status: "warning", message: "Browser workspace is disabled by BROWSER_ENABLED=false." };
    await import("playwright");
    return { status: "passed", message: "Playwright browser worker module loaded." };
  });
  await runCheck("chromium", "Chromium executable available", async () => {
    const { chromium } = await import("playwright");
    const executablePath = chromium.executablePath();
    await fs.access(executablePath);
    return { status: "passed", message: "Chromium executable is available.", technical: executablePath };
  });
  await runCheck("signed_url", "Temporary signed URL creation works", async () => ({
    status: "warning",
    message: "Production signed asset URLs are not configured yet; local output URLs are available.",
    technical: `expiresAt=${new Date(Date.now() + 10 * 60 * 1000).toISOString()}`
  }));
  await runCheck("capcut_dns", "CapCut hostname resolves", async () => {
    const hostname = new URL(config.capcutHandoffUrl).hostname;
    const result = await dns.lookup(hostname);
    return { status: "passed", message: `${hostname} resolved.`, technical: JSON.stringify(result) };
  });
  await runCheck("browser_session", "Create and close test browser session", async () => {
    if (!config.browserEnabled) return { status: "warning", message: "Browser workspace disabled." };
    const workspace = browserWorkspace();
    const report = await workspace.smokeTest();
    const failed = report.checks.filter((check) => check.status === "failed");
    if (failed.length) {
      return { status: "failed", message: failed[0].message, technical: JSON.stringify(report.checks).slice(0, 900) };
    }
    return { status: "passed", message: "Started Chromium, navigated, captured viewport, tested tabs/input/control/privacy, and closed the smoke session.", technical: report.id };
  });
  await runCheck("sse", "SSE connection endpoint registered", async () => ({
    status: "passed",
    message: "Browser session event stream route is registered for live updates."
  }));

  const completedAt = now();
  const smokeTest = {
    id: newId("smoke"),
    status: smokeResultStatus(checks),
    startedAt,
    completedAt,
    durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
    checks
  };
  state.smokeTests.unshift(smokeTest);
  state.smokeTests = state.smokeTests.slice(0, 20);
  await logEvent("smoke_test_completed", "System smoke test completed", {
    smokeTestId: smokeTest.id,
    status: smokeTest.status,
    failed: checks.filter((check) => check.status === "failed").length,
    warnings: checks.filter((check) => check.status === "warning").length
  });
  await saveState();
  return smokeTest;
}

async function agentToolAddDemoStreamers(run) {
  let added = 0;
  let updated = 0;
  for (const profile of AGENT101_DEMO_STREAMERS) {
    const existing = state.streamers.find(
      (streamer) =>
        cleanText(streamer.channelId).toLowerCase() === profile.channelId ||
        cleanText(streamer.displayName).toLowerCase() === profile.displayName.toLowerCase()
    );
    if (existing) {
      Object.assign(existing, {
        platform: "twitch",
        permissionStatus: "demo_approved",
        allowedUse: ["demo_clips", "internal_testing"],
        monitorEnabled: true,
        isDemo: true,
        liveStatus: existing.liveStatus || "demo_ready",
        liveStatusReason: "Demo-approved for internal Agent 101 workflow testing.",
        notes: "Demo-approved local streamer. Internal drafts only; no external posting permission.",
        updatedAt: now()
      });
      updated += 1;
      continue;
    }
    state.streamers.unshift({
      id: newId("streamer"),
      platform: "twitch",
      displayName: profile.displayName,
      channelId: profile.channelId,
      channelUrl: `https://www.twitch.tv/${profile.channelId}`,
      permissionStatus: "demo_approved",
      allowedUse: ["demo_clips", "internal_testing"],
      monitorEnabled: true,
      isDemo: true,
      lastCheckedAt: null,
      liveStatus: "demo_ready",
      liveStatusReason: "Demo-approved for internal Agent 101 workflow testing.",
      liveTitle: profile.title,
      liveCategory: profile.category,
      liveViewerCount: 0,
      notes: "Demo-approved local streamer. Internal drafts only; no external posting permission.",
      createdAt: now(),
      updatedAt: now()
    });
    added += 1;
  }
  addAgentLog(run, "agent_tool", "Agent 101 prepared demo streamer workspace", { added, updated });
  return { added, updated, totalDemoStreamers: AGENT101_DEMO_STREAMERS.length };
}

async function agentToolRunWatchCycle(run) {
  if (run.mode === "live") {
    const approvedLiveStreamers = state.streamers
      .filter((streamer) => streamer.monitorEnabled && streamer.permissionStatus === "approved" && ["twitch", "kick"].includes(streamer.platform))
      .slice(0, 10);
    const missingProvider = !twitchApiConfigured() && !kickApiConfigured();
    if (approvedLiveStreamers.length && !missingProvider) {
      const liveResults = [];
      for (const streamer of approvedLiveStreamers) {
        try {
          const result = await checkStreamerLive(streamer);
          liveResults.push(result);
          addAgentLog(run, "stream_checked", "Agent 101 checked an approved live streamer", {
            streamerId: streamer.id,
            displayName: streamer.displayName,
            liveStatus: streamer.liveStatus,
            official: result.official
          });
          if (!result.stream) continue;
          const session = {
            id: newId("session"),
            streamerId: streamer.id,
            platform: streamer.platform,
            title: result.stream.title || `${streamer.displayName} live stream`,
            category: result.stream.game_name || streamer.liveCategory || "Live stream",
            startedAt: result.stream.started_at || now(),
            endedAt: null,
            vodId: null,
            status: "live",
            createdBy: "Agent 101"
          };
          state.streamSessions.unshift(session);
        } catch (error) {
          streamer.liveStatus = "api_error";
          streamer.liveStatusReason = error.message;
          addAgentLog(run, "api_error", "Agent 101 live watch check failed", {
            streamerId: streamer.id,
            provider: streamer.platform,
            error: error.message
          });
        }
      }
      const liveSessions = state.streamSessions.filter((session) => session.status === "live").length;
      if (liveSessions) {
        addAgentLog(run, "watch_cycle", "Agent 101 ran an official approved live watch cycle", {
          streamersChecked: liveResults.length,
          liveSessions
        });
        return { checked: liveResults.length, liveSessions, mode: "live" };
      }
    }
    addAgentLog(run, "provider_fallback", "Live watch cycle fell back to demo mode", {
      reason: missingProvider
        ? "Twitch/Kick provider is not configured"
        : approvedLiveStreamers.length
          ? "No approved live sessions were available"
          : "No approved real streamers are available"
    });
  }

  let streamers = demoApprovedStreamers();
  if (!streamers.length) {
    await agentToolAddDemoStreamers(run);
    streamers = demoApprovedStreamers();
  }
  const sessions = [];
  streamers.forEach((streamer, index) => {
    const profile = AGENT101_DEMO_STREAMERS.find((item) => item.channelId === streamer.channelId) || AGENT101_DEMO_STREAMERS[index % AGENT101_DEMO_STREAMERS.length];
    const isLive = index < 3;
    Object.assign(streamer, {
      lastCheckedAt: now(),
      liveStatus: isLive ? "demo_live" : "demo_offline",
      liveStatusReason: isLive
        ? "Demo watch cycle marked this streamer live for internal clipping practice."
        : "Demo watch cycle marked this streamer offline.",
      liveTitle: profile.title,
      liveCategory: profile.category,
      liveViewerCount: isLive ? 4200 + index * 3900 : 0,
      updatedAt: now()
    });
    if (!isLive) return;
    const session = {
      id: newId("session"),
      streamerId: streamer.id,
      platform: streamer.platform,
      title: profile.title,
      category: profile.category,
      startedAt: now(),
      endedAt: null,
      vodId: null,
      status: "demo_live",
      createdBy: "Agent 101"
    };
    state.streamSessions.unshift(session);
    sessions.push(session);
  });
  addAgentLog(run, "watch_cycle", "Agent 101 ran a safe internal watch cycle", {
    streamersChecked: streamers.length,
    liveSessions: sessions.length
  });
  return { checked: streamers.length, liveSessions: sessions.length, sessions };
}

async function agentToolCreateClipCandidates(run) {
  const streamers = demoApprovedStreamers();
  if (!streamers.length) await agentToolAddDemoStreamers(run);
  if (!state.streamSessions.some((session) => session.status === "demo_live" || session.status === "live")) {
    await agentToolRunWatchCycle(run);
  }
  const availableSessions = state.streamSessions
    .filter((session) => session.status === "demo_live" || session.status === "live")
    .filter((session) => isApprovedStreamer(findStreamer(session.streamerId)))
    .slice(0, 5);
  if (!availableSessions.length) {
    await agentToolRunWatchCycle(run);
    availableSessions.push(
      ...state.streamSessions
        .filter((session) => session.status === "demo_live" || session.status === "live")
        .filter((session) => isApprovedStreamer(findStreamer(session.streamerId)))
        .slice(0, 5)
    );
  }
  if (!availableSessions.length) throw new Error("No approved demo or live sessions were available for candidate generation");
  const candidates = AGENT101_CLIP_IDEAS.map(([title, snippet, duration, baseScore], index) => {
    const session = availableSessions[index % availableSessions.length];
    const streamer = findStreamer(session.streamerId);
    const profile = AGENT101_DEMO_STREAMERS.find((item) => item.channelId === streamer.channelId) || AGENT101_DEMO_STREAMERS[index % AGENT101_DEMO_STREAMERS.length];
    const startAt = index * 61 + 12;
    const candidateBase = {
      id: newId("candidate"),
      streamerId: streamer.id,
      streamerName: streamer.displayName,
      sessionId: session.id,
      sourceType: "agent101_demo",
      sourceId: session.id,
      timestampStart: formatClipTimestamp(startAt),
      timestampEnd: formatClipTimestamp(startAt + duration),
      duration,
      title,
      category: session.category || profile.category,
      transcriptSnippet: snippet,
      chatSignals: { spike: Math.max(30, baseScore - 38), messagesPerMinute: Math.max(40, baseScore - 20), source: "agent101_demo" },
      reason: "Agent 101 generated this safe demo candidate from the internal clipping workflow.",
      hookScore: Math.min(20, Math.round(baseScore / 5)),
      riskScore: 12,
      status: "candidate",
      createdAt: now(),
      updatedAt: now()
    };
    const candidate = { ...candidateBase, ...scoreClipMoment(candidateBase) };
    state.clipCandidates.unshift(candidate);
    return candidate;
  });
  run.context.candidateIds = candidates.map((candidate) => candidate.id);
  addAgentLog(run, "candidate_detected", "Agent 101 created demo clip candidates", { count: candidates.length });
  return { created: candidates.length, candidates };
}

async function agentToolScoreClipCandidates(run) {
  const candidates = run.context.candidateIds?.length
    ? state.clipCandidates.filter((candidate) => run.context.candidateIds.includes(candidate.id))
    : newestAgentCandidates(15);
  const openaiScoring = await agentOpenAIScoreCandidates(run, candidates);
  const scoreById = new Map((openaiScoring.scores || []).map((score) => [score.id, score]));
  candidates.forEach((candidate) => {
    const localScore = scoreClipMoment(candidate);
    const aiScore = scoreById.get(candidate.id);
    Object.assign(candidate, localScore, aiScore ? {
      score: Math.max(0, Math.min(100, Number(aiScore.score || localScore.score))),
      hookScore: Math.max(0, Math.min(100, Number(aiScore.hookScore || localScore.hookScore))),
      engagementPotential: Math.max(0, Math.min(100, Number(aiScore.engagementPotential || aiScore.score || localScore.score))),
      retentionPotential: Math.max(0, Math.min(100, Number(aiScore.retentionPotential || aiScore.score || localScore.score))),
      riskScore: Math.max(0, Math.min(100, Number(aiScore.riskScore || localScore.riskScore))),
      reason: cleanText(aiScore.reason) || localScore.reason,
      suggestedHook: cleanText(aiScore.suggestedHook) || localScore.suggestedHook,
      suggestedTitle: cleanText(aiScore.suggestedTitle) || localScore.suggestedTitle,
      scoringProvider: "openai"
    } : {
      engagementPotential: localScore.score,
      retentionPotential: Math.min(100, localScore.score + 3),
      scoringProvider: "local_fallback"
    }, {
      reviewedBy: "Agent 101",
      updatedAt: now()
    });
  });
  run.context.candidateIds = candidates.map((candidate) => candidate.id);
  addAgentLog(run, "clip_scored", "Agent 101 scored clip candidates", {
    count: candidates.length,
    topScore: Math.max(0, ...candidates.map((candidate) => Number(candidate.score || 0))),
    provider: openaiScoring.used ? "openai" : "local_fallback"
  });
  return { scored: candidates.length, topCandidates: newestAgentCandidates(3).map((candidate) => candidate.id) };
}

async function agentToolCreateClipPackages(run) {
  const sourceCandidates = (run.context.candidateIds?.length
    ? state.clipCandidates.filter((candidate) => run.context.candidateIds.includes(candidate.id))
    : newestAgentCandidates(12))
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 3);
  const packages = [];
  for (const candidate of sourceCandidates) {
    const streamer = findStreamer(candidate.streamerId);
    if (!isApprovedStreamer(streamer)) continue;
    const existing = state.clipPackages.find((clipPackage) => clipPackage.candidateId === candidate.id);
    if (existing) {
      packages.push(existing);
      continue;
    }
    const packagePlan = buildPackage(candidate);
    const packageArtifact = await writeArtifact("clip_package", packagePlan.title, {
      candidate,
      streamer,
      packagePlan,
      createdAt: now(),
      createdBy: "Agent 101"
    });
    run.artifacts.push(packageArtifact);
    const clipPackage = {
      id: newId("package"),
      candidateId: candidate.id,
      title: packagePlan.title,
      format: "9:16",
      resolution: "1080x1920",
      targetDuration: Number(candidate.duration || 30),
      hook: packagePlan.hook,
      captionOverlays: packagePlan.captionOverlays,
      scenePlan: [
        "Open on the strongest action frame.",
        "Hold the face/game reaction through the payoff.",
        "End immediately after the clearest chat/reaction beat."
      ],
      cutInstructions: packagePlan.cutInstructions,
      thumbnailText: packagePlan.thumbnailText,
      riskNotes: packagePlan.approvalChecklist,
      status: "draft",
      capcutBriefId: null,
      postingDrafts: [],
      approvalStatus: "draft",
      artifacts: [packageArtifact],
      packagePlan,
      createdAt: now(),
      updatedAt: now(),
      createdBy: "Agent 101"
    };
    state.clipPackages.unshift(clipPackage);
    candidate.status = "packaged";
    candidate.updatedAt = now();
    packages.push(clipPackage);
  }
  run.context.packageIds = packages.map((clipPackage) => clipPackage.id);
  addAgentLog(run, "package_created", "Agent 101 packaged the top clip candidates", { count: packages.length });
  return { packages: packages.length, packageIds: run.context.packageIds };
}

async function agentToolCreateCapCutBriefs(run) {
  const packages = run.context.packageIds?.length
    ? state.clipPackages.filter((clipPackage) => run.context.packageIds.includes(clipPackage.id))
    : state.clipPackages.slice(0, 3);
  const artifacts = [];
  for (const clipPackage of packages) {
    const result = await createAgentCapCutBrief(clipPackage);
    artifacts.push(...result.artifacts);
  }
  run.artifacts.push(...artifacts);
  addAgentLog(run, "capcut_brief_created", "Agent 101 created CapCut handoff briefs", { count: packages.length });
  return { briefs: packages.length, artifacts: artifacts.map((artifact) => artifact.id) };
}

async function agentToolCreatePostingDrafts(run) {
  const packages = run.context.packageIds?.length
    ? state.clipPackages.filter((clipPackage) => run.context.packageIds.includes(clipPackage.id))
    : state.clipPackages.slice(0, 3);
  const drafts = [];
  const artifacts = [];
  for (const clipPackage of packages) {
    const draft = createSinglePostingDraft(
      clipPackage,
      clipPackage.packagePlan || buildPackage(state.clipCandidates.find((candidate) => candidate.id === clipPackage.candidateId))
    );
    const artifact = await writeArtifact("posting_draft", draft.thumbnailText || clipPackage.packagePlan?.title || "posting-draft", {
      draft,
      clipPackage,
      createdAt: now(),
      createdBy: "Agent 101"
    });
    draft.artifactId = artifact.id;
    drafts.push(draft);
    artifacts.push(artifact);
  }
  run.artifacts.push(...artifacts);
  run.context.draftIds = drafts.map((draft) => draft.id);
  addAgentLog(run, "posting_draft_created", "Agent 101 created draft posting packages", {
    drafts: drafts.length,
    requiresApproval: drafts.every((draft) => draft.requiresApproval)
  });
  return { drafts: drafts.length, draftIds: drafts.map((draft) => draft.id) };
}

async function agentToolCreateApprovalRequests(run) {
  const drafts = run.context.draftIds?.length
    ? state.postingDrafts.filter((draft) => run.context.draftIds.includes(draft.id))
    : state.postingDrafts.filter((draft) => draft.approvalStatus === "pending").slice(0, 3);
  const approvals = [];
  const artifacts = [];
  for (const draft of drafts) {
    if (!requiresHumanGate("publish_video")) continue;
    const clipPackage = state.clipPackages.find((item) => item.id === draft.clipPackageId);
    const candidate = state.clipCandidates.find((item) => item.id === clipPackage?.candidateId);
    const request = createApprovalRequest({
      type: "posting_draft",
      actionType: "publish_video",
      title: `Review draft post: ${clipPackage?.packagePlan?.title || draft.thumbnailText || "StreamClipper package"}`,
      riskLevel: Number(candidate?.riskScore || 20) >= 50 ? "high" : "medium",
      linkedId: draft.id,
      createdBy: "agent101",
      evidence: {
        draftId: draft.id,
        clipPackageId: draft.clipPackageId,
        candidateId: candidate?.id,
        platforms: draft.platforms,
        source: "Agent 101 runner",
        safeInternalWorkComplete: true,
        externalPostingBlocked: true
      }
    });
    const artifact = await writeArtifact("approval_package", request.title, {
      approvalRequest: request,
      draft,
      clipPackage,
      candidate,
      createdAt: now(),
      createdBy: "Agent 101"
    });
    request.artifactId = artifact.id;
    approvals.push(request);
    artifacts.push(artifact);
  }
  run.artifacts.push(...artifacts);
  addAgentLog(run, "approval_requested", "Agent 101 sent posting drafts to Human Gate", {
    approvals: approvals.length,
    actionType: "publish_video"
  });
  return { approvals: approvals.length, approvalIds: approvals.map((approval) => approval.id) };
}

async function agentToolSaveArtifact(run) {
  const artifact = await writeArtifact("agent_run", "agent-101-clipping-workflow-summary", {
    runId: run.runId,
    goal: run.goal,
    steps: run.steps,
    context: run.context,
    counts: agentCountsSnapshot(),
    createdAt: now()
  });
  run.artifacts.push(artifact);
  addAgentLog(run, "artifact_saved", "Agent 101 saved a workflow summary artifact", { artifactId: artifact.id });
  return { artifactId: artifact.id };
}

async function agentToolAddLog(run) {
  const entry = addAgentLog(run, "agent_run", "Agent 101 run completed internal draft work", {
    goal: run.goal,
    completedSteps: run.steps.length
  });
  return { logId: entry.id };
}

const AGENT101_TOOL_REGISTRY = {
  addDemoStreamers: agentToolAddDemoStreamers,
  runWatchCycle: agentToolRunWatchCycle,
  createClipCandidates: agentToolCreateClipCandidates,
  scoreClipCandidates: agentToolScoreClipCandidates,
  createClipPackage: agentToolCreateClipPackages,
  createCapCutBrief: agentToolCreateCapCutBriefs,
  createPostingDraft: agentToolCreatePostingDrafts,
  createApprovalRequest: agentToolCreateApprovalRequests,
  saveArtifact: agentToolSaveArtifact,
  addLog: agentToolAddLog,
  add_demo_streamers: agentToolAddDemoStreamers,
  run_watch_cycle: agentToolRunWatchCycle,
  create_clip_candidates: agentToolCreateClipCandidates,
  score_clip_candidates: agentToolScoreClipCandidates,
  create_clip_package: agentToolCreateClipPackages,
  create_capcut_brief: agentToolCreateCapCutBriefs,
  create_posting_draft: agentToolCreatePostingDrafts,
  create_approval_request: agentToolCreateApprovalRequests,
  save_artifact: agentToolSaveArtifact,
  add_log: agentToolAddLog
};

async function runAgent101(body = {}) {
  const contract = inferExecutionContract(body);
  const runId = newId("agent101_run");
  contract.runId = runId;
  const idempotencyKey = cleanText(body.idempotencyKey) || safeHash({
    threadId: contract.threadId,
    request: contract.originalUserRequest,
    operation: contract.operation,
    requestedCount: contract.requestedCount,
    sourceMode: contract.sourceMode,
    sourceScope: contract.sourceScope,
    clippingMode: contract.clippingMode
  });
  state.agentRuns ||= [];
  const existing = state.agentRuns.find(
    (item) => item.idempotencyKey === idempotencyKey && !["FAILED", "CANCELLED"].includes(item.status)
  );
  if (existing) return { ...existing, externalStatus: toExternalRunStatus(existing.status), reused: true };

  const run = {
    runId,
    agent: "Agent 101",
    status: "RUNNING",
    externalStatus: "running",
    mode: contract.sourceMode,
    goal: contract.originalUserRequest,
    contract,
    idempotencyKey,
    currentStage: "REQUEST_RECEIVED",
    currentStep: "Request received",
    progress: 0,
    steps: [],
    events: [],
    artifacts: [],
    logs: [],
    context: {
      demoLabel: contract.sourceMode === "demo" ? "DEMO / SYNTHETIC — NOT REAL TWITCH DATA" : "",
      sourceTruth: contract.sourceMode === "real" ? "Official provider data only. No synthetic fallback." : "Explicit demo mode only."
    },
    results: {
      streamers: [],
      eligibleStreamers: [],
      candidates: [],
      clipArtifacts: [],
      postingDrafts: [],
      approvals: []
    },
    provider: {
      configured: Boolean(config.openaiApiKey),
      mode: config.openaiApiKey ? "openai_available" : "local_demo",
      model: config.openaiModel
    },
    startedAt: now(),
    completedAt: null,
    summary: contractSummary(contract)
  };
  state.executionContracts ||= [];
  state.executionContracts.unshift(contract);
  state.executionContracts = state.executionContracts.slice(0, 120);
  persistAgentRun(run);

  try {
    addRunEvent(run, "REQUEST_RECEIVED", "succeeded", `Agent 101 received: ${contract.originalUserRequest}`, {
      originalUserRequest: contract.originalUserRequest
    });
    addRunEvent(run, "CONTRACT_CONFIRMED", "succeeded", contractSummary(contract), { contract });
    await saveRunState(run);

    const blocked = blockedAgentAction(contract.originalUserRequest);
    if (blocked && !/clip|stream|candidate|package|caption|watch|discover|find/i.test(contract.originalUserRequest)) {
      const request = createApprovalRequest({
        type: "agent_external_action",
        actionType: "external_api_action",
        title: `Agent 101 blocked request: ${contract.originalUserRequest.slice(0, 80)}`,
        riskLevel: "high",
        linkedId: run.runId,
        evidence: { goal: contract.originalUserRequest, reason: blocked.reason, contract }
      });
      run.status = "NEEDS_APPROVAL";
      run.externalStatus = "needs_approval";
      run.results.approvals.push(request);
      addRunEvent(run, "HUMAN_GATE", "succeeded", "Routed risky external action to Human Gate.", { approvalId: request.id, reason: blocked.reason });
      run.summary = blocked.reason;
      run.completedAt = now();
      run.progress = 100;
      await saveRunState(run);
      return { ...run, externalStatus: toExternalRunStatus(run.status) };
    }

    if (contract.sourceMode === "demo") {
      addRunEvent(run, "INTEGRATION_CHECK", "not_required", "DEMO / SYNTHETIC mode selected; official provider data is not required.", {
        demoLabel: "DEMO / SYNTHETIC — NOT REAL TWITCH DATA"
      });
      ensureClippingStudioProject();
      run.results.candidates = state.clipCandidates
        .filter((candidate) => candidate.provenance === PROVENANCE.DEMO_SOURCE || candidate.sourceProvenance === PROVENANCE.DEMO_SOURCE)
        .slice(0, contract.requestedCount);
      run.counts = {
        requestedStreamers: contract.requestedCount,
        realStreamersFound: 0,
        demoCandidates: run.results.candidates.length,
        postingDraftsCreated: 0,
        approvalsCreated: 0
      };
      addRunEvent(run, "STREAM_DISCOVERY", "not_required", "Demo workspace is available. No real Twitch discovery was performed.", run.counts);
      addRunEvent(run, "COMPLETED", "succeeded", "Demo mode prepared the local practice workspace only. It did not create real Twitch records or external posting drafts.", run.counts);
      run.status = "COMPLETED";
      run.externalStatus = "completed";
      run.progress = 100;
      run.completedAt = now();
      run.summary = "DEMO / SYNTHETIC — NOT REAL TWITCH DATA. Local practice media is ready; no real streams, clips, posts, or approvals were fabricated.";
      await saveRunState(run);
      return { ...run, externalStatus: toExternalRunStatus(run.status) };
    }

    const twitchStatus = await twitchIntegrationStatus({ validate: true });
    if (!twitchStatus.configured || !twitchStatus.appTokenValid || twitchStatus.status === "error") {
      return await failAgentRun(run, "INTEGRATION_CHECK", "Twitch authentication failed. I did not create streamers, clips, or posting drafts.", {
        twitchStatus: {
          configured: twitchStatus.configured,
          appTokenValid: twitchStatus.appTokenValid,
          userTokenValid: twitchStatus.userTokenValid,
          status: twitchStatus.status,
          message: twitchStatus.message
        }
      });
    }
    addRunEvent(run, "INTEGRATION_CHECK", "succeeded", "Twitch Helix integration is ready for real discovery.", {
      configured: twitchStatus.configured,
      appTokenValid: twitchStatus.appTokenValid,
      userTokenValid: twitchStatus.userTokenValid,
      scopes: twitchStatus.scopes,
      lastValidatedAt: twitchStatus.lastValidatedAt
    });

    const records = contract.sourceScope === "approved_watchlist"
      ? await fetchApprovedTwitchLiveStreams(contract.requestedCount, run, contract)
      : await fetchTopTwitchLiveStreams(contract.requestedCount, run, contract);
    run.results.streamers = records;
    state.discoveredStreamers ||= [];
    for (const record of records) {
      const existingIndex = state.discoveredStreamers.findIndex((item) => item.runId === run.runId && item.providerUserId === record.providerUserId);
      if (existingIndex >= 0) state.discoveredStreamers[existingIndex] = record;
      else state.discoveredStreamers.unshift(record);
    }
    state.discoveredStreamers = state.discoveredStreamers.slice(0, 200);
    addRunEvent(run, "STREAM_DISCOVERY", "succeeded", `Twitch returned ${records.length} real stream${records.length === 1 ? "" : "s"} for a request of ${contract.requestedCount}.`, {
      requestedCount: contract.requestedCount,
      returnedCount: records.length,
      providerIds: records.map((record) => record.providerUserId),
      apiEndpoint: "helix/streams"
    });

    try {
      records.forEach(assertTwitchRecordReal);
      assertStreamerResultCountDoesNotExceedRequested(run);
      assertRealModeContainsNoDemoData(run);
    } catch (error) {
      return await failAgentRun(run, "RESULTS_VALIDATED", error.message, { error: error.message });
    }
    addRunEvent(run, "RESULTS_VALIDATED", "succeeded", "Real Twitch results were validated with provider IDs, fetch timestamps, and response hashes.", {
      requestedCount: contract.requestedCount,
      returnedCount: records.length
    });

    if (contract.operation === "discover_streamers") {
      addRunEvent(run, "RIGHTS_VERIFICATION", "not_required", "Discovery-only run. Rights were not claimed and no clipping was attempted.", {
        rightsStatus: "unknown",
        clippingEligibility: "not_verified"
      });
      addRunEvent(run, "COMPLETED", "succeeded", "Run completed with discovery-only results. No clip candidates, posting drafts, or Human Gate requests were created.", {
        requestedCount: contract.requestedCount,
        returnedCount: records.length,
        candidatesCreated: 0,
        postingDraftsCreated: 0,
        approvalsCreated: 0
      });
      run.status = "COMPLETED";
      run.externalStatus = "completed";
      run.progress = 100;
      run.completedAt = now();
      run.counts = {
        requestedStreamers: contract.requestedCount,
        realStreamersFound: records.length,
        eligibleStreamers: 0,
        sourcesAcquired: 0,
        candidatesCreated: 0,
        clipFilesCreated: 0,
        postingDraftsCreated: 0,
        approvalsCreated: 0
      };
      run.summary = `I found ${records.length} real Twitch live stream${records.length === 1 ? "" : "s"} for a request of ${contract.requestedCount}. This was discovery only; no clips, posts, or approvals were created.`;
      await saveRunState(run);
      return { ...run, externalStatus: toExternalRunStatus(run.status) };
    }

    const eligible = records.filter((record) => {
      const streamer = findStreamer(record.watchlistStreamerId);
      try {
        assertClippingPermission(streamer);
        return true;
      } catch {
        return false;
      }
    });
    run.results.eligibleStreamers = eligible;
    if (!eligible.length) {
      addRunEvent(run, "RIGHTS_VERIFICATION", "failed", `Requested ${contract.requestedCount} approved live streamer${contract.requestedCount === 1 ? "" : "s"} but found ${records.length}; 0 have verified clipping permission.`, {
        requestedCount: contract.requestedCount,
        returnedCount: records.length,
        eligibleCount: 0
      });
      run.status = "BLOCKED";
      run.externalStatus = "blocked";
      run.progress = 100;
      run.completedAt = now();
      run.summary = "Clipping blocked: no approved live watchlist streamer with recorded clipping permission was found. No candidates, clips, posting drafts, or approvals were created.";
      addRunEvent(run, "FAILED", "failed", run.summary, { blockedStage: "RIGHTS_VERIFICATION" });
      await saveRunState(run);
      return { ...run, externalStatus: toExternalRunStatus(run.status) };
    }
    addRunEvent(run, "RIGHTS_VERIFICATION", "succeeded", `${eligible.length} approved live streamer${eligible.length === 1 ? "" : "s"} passed permission lookup.`, {
      requestedCount: contract.requestedCount,
      eligibleCount: eligible.length
    });

    addRunEvent(run, "SOURCE_ACQUISITION", "failed", "Approved clipping still needs a real playable source or confirmed official Twitch clip. I stopped before creating candidates.", {
      reason: "Twitch source acquisition/official clip creation is not yet authorized for this server run.",
      candidatesCreated: 0,
      postingDraftsCreated: 0,
      approvalsCreated: 0
    });
    run.status = "BLOCKED";
    run.externalStatus = "blocked";
    run.progress = 100;
    run.completedAt = now();
    run.summary = "I found approved live streamers, but source acquisition is not verified yet. No clip candidates, rendered clips, posting drafts, or Human Gate publishing requests were created.";
    addRunEvent(run, "FAILED", "failed", run.summary, { blockedStage: "SOURCE_ACQUISITION" });
    await saveRunState(run);
    return { ...run, externalStatus: toExternalRunStatus(run.status) };
  } catch (error) {
    return await failAgentRun(run, RUN_STAGES.includes(run.currentStage) ? run.currentStage : "FAILED", error.message, { error: error.message });
  }
}

function demoStreamerProfiles() {
  return [
    ["KaiCenat", "kai", "Just Chatting", "Crazy reaction no way moment"],
    ["HasanAbi", "hasanabi", "Just Chatting", "Hilarious banter caught live"],
    ["xQc", "xqc", "VALORANT", "Insane clutch final win"],
    ["tarik", "tarik", "VALORANT", "Epic save perfect team fight"],
    ["AgentLab", "agentlab", "Creator Ops", "Workflow breakdown with wild hook"]
  ];
}

async function seedDemoWorkspace() {
  const seeded = {
    streamers: 0,
    candidates: 0
  };
  const existingNames = new Set(state.streamers.map((streamer) => streamer.displayName.toLowerCase()));

  for (const [displayName, channelId] of demoStreamerProfiles()) {
    if (existingNames.has(displayName.toLowerCase())) continue;
    state.streamers.unshift({
      id: newId("streamer"),
      platform: "twitch",
      displayName,
      channelId,
      channelUrl: `https://www.twitch.tv/${channelId}`,
      permissionStatus: "approved",
      allowedUse: ["clips", "edits", "reposts"],
      monitorEnabled: true,
      lastCheckedAt: now(),
      liveStatus: "demo_live",
      notes: "Approved local demo creator for supervised StreamClipper workflow testing.",
      createdAt: now(),
      updatedAt: now()
    });
    seeded.streamers += 1;
  }

  const profiles = demoStreamerProfiles();
  const activeStreamers = state.streamers.filter((streamer) => streamer.monitorEnabled && isApprovedStreamer(streamer)).slice(0, 5);
  for (const [index, streamer] of activeStreamers.entries()) {
    const hasCandidate = state.clipCandidates.some((candidate) => candidate.streamerId === streamer.id);
    if (hasCandidate) continue;
    const profile = profiles.find((item) => item[0].toLowerCase() === streamer.displayName.toLowerCase()) || profiles[index] || [];
    const session = {
      id: newId("session"),
      streamerId: streamer.id,
      platform: streamer.platform,
      title: `${streamer.displayName} supervised demo stream`,
      category: profile[2] || "Demo / manual review",
      startedAt: now(),
      endedAt: null,
      vodId: null,
      status: "demo"
    };
    state.streamSessions.unshift(session);
    const candidateBase = {
      id: newId("candidate"),
      streamerId: streamer.id,
      sessionId: session.id,
      sourceType: "demo",
      sourceId: session.id,
      timestampStart: `00:0${index + 1}:08`,
      timestampEnd: `00:0${index + 1}:36`,
      duration: 28,
      title: profile[3] || `${streamer.displayName} reaction moment`,
      category: session.category,
      transcriptSnippet: "Insane live reaction. No way this clutch just happened. Demo candidate generated locally for supervised review.",
      chatSignals: { spike: 42 + index * 5, source: "demo" },
      reason: "Safe demo candidate for workflow testing. No download, login, upload, or external post has occurred.",
      hookScore: 15 + index,
      riskScore: 12,
      status: "candidate",
      createdAt: now(),
      updatedAt: now()
    };
    const candidate = { ...candidateBase, ...scoreClipMoment(candidateBase) };
    state.clipCandidates.unshift(candidate);
    seeded.candidates += 1;
  }

  await logEvent("demo_seeded", "StreamClipper demo mission loaded", seeded);
  await saveState();
  return seeded;
}

async function commandStatus(command, args = ["-version"]) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 4000 });
    const firstLine = (stdout || stderr || "").split("\n")[0] || `${command} available`;
    return { configured: true, command, version: firstLine };
  } catch (error) {
    return { configured: false, command, message: `${command} is not available to the server process.` };
  }
}

async function mediaToolStatus() {
  const [ffmpeg, ffprobe] = await Promise.all([
    commandStatus(ffmpegExecutable),
    commandStatus(ffprobeExecutable)
  ]);
  return {
    mode: ffmpeg.configured && ffprobe.configured ? "local_render_ready" : "manual_handoff",
    ffmpeg,
    ffprobe,
    outputDir: config.outputDir,
    secretsExposed: false,
    notes: ffmpeg.configured && ffprobe.configured
      ? "Local render tools are available for future near-finished drafts."
      : "CapCut handoff remains available while local render tools are installed."
  };
}

function inferBrowserUrl(goal, fallback = "") {
  const text = cleanText(goal).toLowerCase();
  if (fallback) return fallback;
  if (/capcut/.test(text)) return config.capcutHandoffUrl;
  if (/kick/.test(text)) return "https://kick.com/";
  if (/twitch/.test(text)) return "https://www.twitch.tv/directory";
  if (/youtube|shorts/.test(text)) return "https://www.youtube.com/";
  if (/instagram|reels/.test(text)) return "https://www.instagram.com/";
  if (/tiktok/.test(text)) return "https://www.tiktok.com/";
  return "";
}

async function runAgent101Browser(body = {}) {
  const goal = cleanText(body.goal || body.message || "Open the supervised browser workspace.");
  const requestedUrl = inferBrowserUrl(goal, body.url);
  const blocked = blockedAgentAction(goal);
  if (blocked) {
    const request = createApprovalRequest({
      type: "browser_external_action",
      actionType: "external_api_action",
      title: `Browser action needs review: ${goal.slice(0, 80)}`,
      riskLevel: "high",
      linkedId: newId("browser_goal"),
      evidence: {
        goal,
        reason: blocked.reason,
        requestedUrl
      }
    });
    await logEvent("browser_blocked", "Agent 101 browser request routed to Human Gate", {
      goal,
      reason: blocked.reason,
      approvalId: request.id
    });
    await saveState();
    return {
      status: "needs_approval",
      summary: blocked.reason,
      approvalRequest: request,
      session: null,
      logs: ["Risky browser action stopped before execution."]
    };
  }

  if (!requestedUrl) {
    return {
      status: "needs_input",
      summary: "Tell Agent 101 what site to open or use a supported handoff such as CapCut, Twitch, Kick, or YouTube.",
      session: null,
      logs: []
    };
  }

  const workspace = browserWorkspace();
  const session = body.sessionId
    ? workspace.profile().sessions.find((item) => item.id === body.sessionId)
    : await workspace.createSession({ purpose: goal, actor: "agent101" });
  if (!session) throw new Error("Could not create browser session.");

  const isCapCut = /capcut/i.test(requestedUrl) || /capcut/i.test(goal);
  const nav = await workspace.navigate(session.id, requestedUrl, { actor: isCapCut ? "operator" : "agent101" });
  if (!nav.allowed) {
    const request = createApprovalRequest({
      type: "browser_domain_request",
      actionType: "external_api_action",
      title: `Review browser domain: ${requestedUrl.slice(0, 80)}`,
      riskLevel: "medium",
      linkedId: session.id,
      evidence: {
        goal,
        requestedUrl,
        reason: nav.reason
      }
    });
    await logEvent("browser_policy_review", "Browser domain requires policy review", {
      sessionId: session.id,
      requestedUrl,
      reason: nav.reason,
      approvalId: request.id
    });
    await saveState();
    return {
      status: "needs_approval",
      summary: nav.reason,
      approvalRequest: request,
      session: nav.session,
      logs: ["Navigation blocked by browser policy."]
    };
  }

  const finalSession = isCapCut
    ? await workspace.setControl(session.id, "human_control", { actor: "agent101" })
    : nav.session;
  await logEvent("browser_agent_run", "Agent 101 opened a supervised browser workspace", {
    sessionId: finalSession.id,
    url: finalSession.currentUrl,
    goal
  });
  return {
    status: isCapCut ? "needs_human" : "completed",
    summary: isCapCut
      ? "CapCut is open as a manual human-control handoff. Agent 101 can prepare instructions, but will not operate the editor."
      : "Agent 101 opened the browser workspace under the approved policy.",
    session: finalSession,
    logs: ["Browser workspace opened.", isCapCut ? "Human control is active for CapCut." : "Read-only browsing is active."]
  };
}

async function handleApi(req, res, pathname, searchParams) {
  if (req.method === "GET" && pathname === "/api/health") {
    const [media, twitch] = await Promise.all([
      mediaToolStatus().catch((error) => ({ mode: "blocked", error: error.message })),
      twitchIntegrationStatus({ validate: false }).catch((error) => ({ configured: false, status: "error", message: error.message }))
    ]);
    const outputWritable = await fs.access(config.outputDir).then(() => true).catch(() => false);
    const uploadWritable = await fs.access(config.uploadDir).then(() => true).catch(() => false);
    const criticalBlocked = !outputWritable || !uploadWritable || media.mode === "blocked";
    const readiness = criticalBlocked ? "BLOCKED" : twitch.status === "ready" ? "READY" : "DEGRADED";
    return sendJson(res, 200, {
      ok: true,
      app: "StreamClipper Agent",
      time: now(),
      readiness,
      systems: {
        database: "READY",
        twitch: twitch.status || "not_configured",
        openai: config.openaiApiKey ? "READY" : "DEGRADED",
        ffmpeg: media.ffmpeg?.configured ? "READY" : "BLOCKED",
        ffprobe: media.ffprobe?.configured ? "READY" : "BLOCKED",
        uploadDirWritable: uploadWritable,
        outputDirWritable: outputWritable,
        humanGate: "READY"
      },
      status: {
        streamers: state.streamers.length,
        candidates: state.clipCandidates.length,
        queuedPosts: state.postingDrafts.length,
        pendingApprovals: state.approvalRequests.filter((request) => request.status === "pending").length
      }
    });
  }

  if (req.method === "GET" && pathname === "/api/browser/profile") {
    return sendJson(res, 200, browserWorkspace().profile());
  }

  if (req.method === "GET" && pathname === "/api/browser/health") {
    return sendJson(res, 200, await browserWorkspace().health());
  }

  if (req.method === "POST" && pathname === "/api/browser/smoke-test") {
    const report = await browserWorkspace().smokeTest();
    state.smokeTests.unshift({
      id: report.id,
      status: report.status,
      startedAt: report.startedAt,
      completedAt: report.completedAt,
      durationMs: new Date(report.completedAt || now()).getTime() - new Date(report.startedAt).getTime(),
      checks: report.checks.map((check) => ({
        key: `browser_${check.key}`,
        label: check.label,
        status: check.status === "passed" ? "passed" : "failed",
        message: check.message,
        durationMs: check.durationMs,
        technical: check.details ? JSON.stringify(check.details).slice(0, 300) : ""
      }))
    });
    state.smokeTests = state.smokeTests.slice(0, 20);
    await logEvent("browser_smoke_test", "Browser smoke test completed", { status: report.status, checks: report.checks.length });
    await saveState();
    return sendJson(res, 200, { smokeTest: report });
  }

  if (req.method === "POST" && pathname === "/api/browser/profile") {
    return sendJson(res, 200, browserWorkspace().profile());
  }

  if (req.method === "POST" && pathname === "/api/browser/profile/clear") {
    const profile = await browserWorkspace().resetProfile();
    return sendJson(res, 200, profile);
  }

  if (req.method === "DELETE" && pathname === "/api/browser/profile") {
    const profile = await browserWorkspace().resetProfile();
    return sendJson(res, 200, profile);
  }

  if (req.method === "GET" && pathname === "/api/browser/policies") {
    return sendJson(res, 200, browserWorkspace().policies());
  }

  if (req.method === "GET" && pathname === "/api/browser/sessions") {
    return sendJson(res, 200, { sessions: browserWorkspace().profile().sessions, activeSession: browserWorkspace().profile().activeSession });
  }

  if (req.method === "POST" && pathname === "/api/browser/sessions") {
    const body = await readJsonBody(req);
    const session = await browserWorkspace().createSession({
      purpose: cleanText(body.purpose) || "StreamClipper browser workspace",
      url: cleanText(body.url),
      actor: "operator",
      forceNew: Boolean(body.forceNew)
    });
    return sendJson(res, 201, { session });
  }

  const browserSessionMatch = pathname.match(/^\/api\/browser\/sessions\/([^/]+)$/);
  if (browserSessionMatch && req.method === "GET") {
    const session = browserWorkspace().profile().sessions.find((item) => item.id === browserSessionMatch[1]);
    if (!session) return sendError(res, 404, "Browser session not found");
    return sendJson(res, 200, { session });
  }

  if (browserSessionMatch && req.method === "DELETE") {
    const session = await browserWorkspace().closeSession(browserSessionMatch[1]);
    return sendJson(res, 200, { session });
  }

  const browserActionMatch = pathname.match(/^\/api\/browser\/sessions\/([^/]+)\/(navigate|back|forward|refresh|stop-loading|take-control|give-agent-control|pause|resume|mode|restart)$/);
  if (browserActionMatch && req.method === "POST") {
    const [, sessionId, action] = browserActionMatch;
    const workspace = browserWorkspace();
    if (action === "restart") {
      await workspace.closeSession(sessionId);
      const body = await readJsonBody(req).catch(() => ({}));
      const session = await workspace.createSession({ purpose: cleanText(body.purpose) || "Restarted browser workspace", actor: "operator", forceNew: true });
      return sendJson(res, 200, { session });
    }
    if (action === "navigate") {
      const body = await readJsonBody(req);
      const result = await workspace.navigate(sessionId, body.url, { actor: "operator" });
      return sendJson(res, result.allowed ? 200 : 403, result);
    }
    if (action === "take-control") {
      const session = await workspace.setControl(sessionId, "human_control", { actor: "operator" });
      return sendJson(res, 200, { session });
    }
    if (action === "give-agent-control") {
      const session = await workspace.setControl(sessionId, "agent_assisted", { actor: "operator" });
      return sendJson(res, 200, { session });
    }
    if (action === "pause") {
      const session = await workspace.setControl(sessionId, "paused", { actor: "operator" });
      return sendJson(res, 200, { session });
    }
    if (action === "resume") {
      const session = await workspace.setControl(sessionId, "human_control", { actor: "operator" });
      return sendJson(res, 200, { session });
    }
    if (action === "mode") {
      const body = await readJsonBody(req);
      const requested = cleanText(body.mode).toUpperCase();
      const mode = requested === "AGENT_ASSISTED" ? "agent_assisted" : requested === "PAUSED" ? "paused" : "human_control";
      const session = await workspace.setControl(sessionId, mode, { actor: "operator" });
      return sendJson(res, 200, { session });
    }
    const session = await workspace.simplePageAction(sessionId, action, { actor: "operator" });
    return sendJson(res, 200, { session });
  }

  const browserTabsMatch = pathname.match(/^\/api\/browser\/sessions\/([^/]+)\/tabs(?:\/([^/]+))?$/);
  if (browserTabsMatch) {
    const [, sessionId, tabId] = browserTabsMatch;
    const workspace = browserWorkspace();
    if (req.method === "GET" && !tabId) {
      return sendJson(res, 200, workspace.tabs(sessionId));
    }
    if (req.method === "POST" && !tabId) {
      const body = await readJsonBody(req).catch(() => ({}));
      return sendJson(res, 201, await workspace.newTab(sessionId, { url: cleanText(body.url), actor: "operator" }));
    }
    if (req.method === "PATCH" && tabId) {
      return sendJson(res, 200, await workspace.switchTab(sessionId, tabId, { actor: "operator" }));
    }
    if (req.method === "DELETE" && tabId) {
      return sendJson(res, 200, await workspace.closeTab(sessionId, tabId, { actor: "operator" }));
    }
  }

  const browserInputMatch = pathname.match(/^\/api\/browser\/sessions\/([^/]+)\/input$/);
  if (browserInputMatch && req.method === "POST") {
    const body = await readJsonBody(req);
    return sendJson(res, 200, await browserWorkspace().input(browserInputMatch[1], body, { actor: "operator" }));
  }

  const browserTextMatch = pathname.match(/^\/api\/browser\/sessions\/([^/]+)\/visible-text$/);
  if (browserTextMatch && req.method === "GET") {
    return sendJson(res, 200, await browserWorkspace().visibleText(browserTextMatch[1]));
  }

  const browserDownloadsMatch = pathname.match(/^\/api\/browser\/sessions\/([^/]+)\/downloads$/);
  if (browserDownloadsMatch && req.method === "GET") {
    return sendJson(res, 200, { downloads: browserWorkspace().profile().downloads.filter((download) => !download.sessionId || download.sessionId === browserDownloadsMatch[1]) });
  }

  const browserScreenshotMatch = pathname.match(/^\/api\/browser\/sessions\/([^/]+)\/screenshot$/);
  if (browserScreenshotMatch && req.method === "GET") {
    const buffer = await browserWorkspace().screenshot(browserScreenshotMatch[1]);
    return sendPng(res, buffer);
  }

  const browserEventsMatch = pathname.match(/^\/api\/browser\/sessions\/([^/]+)\/events$/);
  if (browserEventsMatch && req.method === "GET") {
    return browserWorkspace().subscribe(browserEventsMatch[1], res);
  }

  if (req.method === "GET" && pathname === "/api/handoffs") {
    return sendJson(res, 200, { handoffs: state.handoffPackages.map(publicHandoff) });
  }

  if (req.method === "POST" && pathname === "/api/handoffs") {
    const body = await readJsonBody(req);
    const result = await createHandoffPackage(body);
    return sendJson(res, result.reused ? 200 : 201, { handoff: publicHandoff(result.handoff), reused: result.reused });
  }

  const handoffMatch = pathname.match(/^\/api\/handoffs\/([^/]+)(?:\/([^/]+))?$/);
  if (handoffMatch) {
    const [, handoffId, handoffAction] = handoffMatch;
    const handoff = state.handoffPackages.find((item) => item.id === handoffId);
    if (!handoff) return sendError(res, 404, "Handoff package not found");

    if (req.method === "GET" && !handoffAction) {
      return sendJson(res, 200, { handoff: publicHandoff(handoff) });
    }

    if (req.method === "GET" && handoffAction === "events") {
      return sendJson(res, 200, { events: handoff.events || [] });
    }

    if (req.method === "POST" && handoffAction === "prepare") {
      const result = await prepareHandoffPackage(handoff);
      return sendJson(res, 200, { handoff: publicHandoff(result.handoff), artifacts: result.artifacts });
    }

    if (req.method === "POST" && handoffAction === "open-capcut") {
      const body = await readJsonBody(req);
      await setHandoffStatus(handoff, "BROWSER_STARTING", "operator", "Starting supervised browser for CapCut", {});
      const workspace = browserWorkspace();
      const session = body.sessionId
        ? workspace.profile().sessions.find((item) => item.id === body.sessionId)
        : await workspace.createSession({ purpose: "Supervised CapCut handoff", actor: "operator" });
      if (!session) return sendError(res, 404, "Browser session not found");
      const result = await workspace.navigate(session.id, body.url || config.capcutHandoffUrl, { actor: "operator" });
      handoff.browserSessionId = session.id;
      if (!result.allowed) {
        await setHandoffStatus(handoff, "NAVIGATION_BLOCKED", "operator", "CapCut navigation blocked by browser policy", { reason: result.reason });
        await saveState();
        return sendJson(res, 403, { ...result, handoff: publicHandoff(handoff) });
      }
      const finalSession = await workspace.setControl(session.id, "human_control", { actor: "operator" });
      await setHandoffStatus(handoff, "CAPCUT_OPEN", "operator", "CapCut opened in human-control mode", { sessionId: session.id });
      await saveState();
      return sendJson(res, 200, { ...result, session: finalSession, handoff: publicHandoff(handoff) });
    }

    if (req.method === "POST" && handoffAction === "confirm-file-attachment") {
      const body = await readJsonBody(req);
      if (!body.confirm) return sendError(res, 400, "Explicit confirmation is required before file attachment.");
      const rendered = state.artifacts.find((artifact) => artifact.id === handoff.renderId);
      if (!artifactIsVerifiedClip(rendered)) {
        await setHandoffStatus(handoff, "UPLOAD_FAILED", "operator", "File attachment blocked because no verified vertical draft exists", {});
        await saveState();
        return sendError(res, 422, "No verified vertical-draft MP4 is available to attach.");
      }
      await setHandoffStatus(handoff, "WAITING_FOR_UPLOAD", "operator", "Operator confirmed manual file attachment. Continue inside CapCut.", { artifactId: rendered.id });
      await saveState();
      return sendJson(res, 200, { handoff: publicHandoff(handoff), message: "Manual handoff ready. The operator remains in control." });
    }

    if (req.method === "POST" && handoffAction === "import-download") {
      const body = await readJsonBody(req);
      const downloadId = cleanText(body.downloadId);
      const download = state.browser?.downloads?.find((item) => item.id === downloadId);
      if (!download) return sendError(res, 422, "Select an authorized browser download before importing.");
      await setHandoffStatus(handoff, "EXPORT_DETECTED", "operator", "Operator selected a browser download for import review", { downloadId });
      await saveState();
      return sendJson(res, 200, { handoff: publicHandoff(handoff), download });
    }

    if (req.method === "POST" && handoffAction === "upload-export") {
      const body = await readJsonBody(req);
      const artifact = state.artifacts.find((item) => item.id === cleanText(body.artifactId || body.exportedArtifactId));
      if (!artifactIsVerifiedClip(artifact)) {
        await setHandoffStatus(handoff, "QA_FAILED", "operator", "Export upload rejected because technical QA did not verify the media", {});
        await saveState();
        return sendError(res, 422, "Uploaded export must be a verified rendered clip artifact.");
      }
      handoff.exportedAssetKey = artifact.id;
      await setHandoffStatus(handoff, "TECHNICAL_QA", "agent101", "Exported media passed available technical QA checks", { artifactId: artifact.id });
      const request = createApprovalRequest({
        type: "capcut_export_review",
        actionType: "publish_video",
        title: `Review returned CapCut export: ${artifact.title}`,
        riskLevel: "medium",
        linkedId: artifact.id,
        evidence: {
          handoffId: handoff.id,
          artifactId: artifact.id,
          note: "Posting remains blocked until Human Gate approves the returned export."
        }
      });
      await setHandoffStatus(handoff, "HUMAN_REVIEW", "agent101", "Returned export routed to Human Gate", { approvalId: request.id });
      await saveState();
      return sendJson(res, 200, { handoff: publicHandoff(handoff), approvalRequest: request });
    }

    if (req.method === "POST" && handoffAction === "cancel") {
      await setHandoffStatus(handoff, "CANCELLED", "operator", "CapCut handoff cancelled by operator", {});
      await saveState();
      return sendJson(res, 200, { handoff: publicHandoff(handoff) });
    }
  }

  if (req.method === "GET" && pathname === "/api/system/smoke-test") {
    return sendJson(res, 200, { latest: state.smokeTests[0] || null, smokeTests: state.smokeTests || [] });
  }

  if (req.method === "POST" && pathname === "/api/system/smoke-test") {
    const result = await runSystemSmokeTest();
    return sendJson(res, 200, { smokeTest: result });
  }

  if (req.method === "POST" && pathname === "/api/agent101/browser/run") {
    const body = await readJsonBody(req);
    const result = await runAgent101Browser(body);
    return sendJson(res, result.status === "error" ? 500 : 200, result);
  }

  if (req.method === "GET" && pathname === "/api/capcut/status") {
    return sendJson(res, 200, {
      status: "manual_handoff",
      configured: Boolean(config.capcutHandoffUrl),
      url: config.capcutHandoffUrl,
      browserReady: config.browserEnabled,
      notes: "CapCut is a manual polishing workspace. Agent 101 prepares briefs and instructions, but does not operate the editor."
    });
  }

  if (req.method === "POST" && pathname === "/api/capcut/open") {
    const body = await readJsonBody(req);
    const workspace = browserWorkspace();
    const session = body.sessionId
      ? workspace.profile().sessions.find((item) => item.id === body.sessionId)
      : await workspace.createSession({ purpose: "CapCut manual handoff", actor: "operator" });
    if (!session) return sendError(res, 404, "Browser session not found");
    const result = await workspace.navigate(session.id, body.url || config.capcutHandoffUrl, { actor: "operator" });
    const finalSession = result.allowed
      ? await workspace.setControl(session.id, "human_control", { actor: "operator" })
      : result.session;
    await logEvent("capcut_opened", "CapCut manual handoff opened in supervised browser", {
      sessionId: session.id,
      allowed: result.allowed,
      url: body.url || config.capcutHandoffUrl
    });
    return sendJson(res, result.allowed ? 200 : 403, { ...result, session: finalSession });
  }

  if (req.method === "POST" && pathname === "/api/capcut/handoff") {
    const body = await readJsonBody(req);
    const created = await createHandoffPackage(body);
    const result = await prepareHandoffPackage(created.handoff);
    await logEvent("capcut_handoff", "CapCut handoff prepared for operator", { handoffId: created.handoff.id });
    return sendJson(res, created.reused ? 200 : 201, { handoff: publicHandoff(result.handoff), artifacts: result.artifacts });
  }

  if (req.method === "GET" && pathname === "/api/media/status") {
    return sendJson(res, 200, await mediaToolStatus());
  }

  if (req.method === "GET" && (pathname === "/api/clipping-office/project" || pathname === `/api/clipping-office/project/${DEMO_PROJECT_ID}`)) {
    return sendJson(res, 200, studioProjectPayload(DEMO_PROJECT_ID));
  }

  const projectMatch = pathname.match(/^\/api\/clipping-office\/project\/([^/]+)$/);
  if (projectMatch && req.method === "GET") {
    return sendJson(res, 200, studioProjectPayload(projectMatch[1]));
  }

  if (req.method === "GET" && pathname === "/api/media/sources") {
    ensureClippingStudioProject();
    return sendJson(res, 200, { sources: state.mediaSources.map(publicMediaSource) });
  }

  const mediaSourceMatch = pathname.match(/^\/api\/media\/sources\/([^/]+)(?:\/(playback|metadata|thumbnails|frame))?$/);
  if (mediaSourceMatch && req.method === "GET") {
    const [, sourceId, action = "detail"] = mediaSourceMatch;
    const source = findMediaSource(decodeURIComponent(sourceId));
    if (!source) return sendError(res, 404, "Media source not found");
    if (action === "playback") {
      return streamFileWithRange(req, res, source.filePath, source.mimeType || contentTypeFor(source.filePath));
    }
    if (action === "metadata") {
      let verified = null;
      try {
        verified = await ffprobeMetadata(source.filePath);
      } catch (error) {
        verified = { error: "Source metadata could not be verified by FFprobe.", message: error.message };
      }
      return sendJson(res, 200, {
        source: publicMediaSource(source),
        metadata: {
          duration: source.duration,
          width: source.width,
          height: source.height,
          fps: source.fps,
          hasAudio: source.hasAudio,
          provenance: source.provenance,
          verified
        }
      });
    }
    if (action === "thumbnails") {
      const frames = Array.from({ length: 5 }, (_, index) => ({
        id: `demo_frame_${index + 1}`,
        timestampSeconds: [3, 7, 12, 17, 21][index],
        provenance: source.provenance,
        url: demoFrameUrl(index)
      }));
      return sendJson(res, 200, { sourceId: source.id, frames });
    }
    if (action === "frame") {
      const candidateId = cleanText(searchParams.get("candidateId"));
      const candidate = state.clipCandidates.find((item) => item.id === candidateId);
      const index = Math.max(0, state.clipCandidates.filter((item) => item.sourceId === source.id).findIndex((item) => item.id === candidate?.id));
      return streamFileWithRange(req, res, path.join(DEMO_FRAME_DIR, `frame-${(index % 5) + 1}.jpg`), "image/jpeg");
    }
    return sendJson(res, 200, { source: publicMediaSource(source) });
  }

  const mediaSourceVerifyMatch = pathname.match(/^\/api\/media\/sources\/([^/]+)\/verify$/);
  if (mediaSourceVerifyMatch && req.method === "POST") {
    const source = findExistingMediaSource(decodeURIComponent(mediaSourceVerifyMatch[1]));
    if (!source) return sendError(res, 404, "Media source not found");
    try {
      const metadata = await assertSourceIsPlayable(source);
      const sha256 = await fileSha256(source.filePath);
      Object.assign(source, {
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        fps: metadata.fps,
        hasAudio: metadata.hasAudio,
        sha256,
        probeStatus: "passed",
        verifiedAt: now(),
        playable: true,
        updatedAt: now()
      });
      await logEvent("source_verified", "Media source verified by FFprobe", { sourceId: source.id, sha256 });
      await saveState();
      return sendJson(res, 200, { source: publicMediaSource(source), metadata: { ...metadata, sha256, probeStatus: "passed" } });
    } catch (error) {
      source.probeStatus = "failed";
      source.updatedAt = now();
      await logEvent("source_verify_failed", "Media source verification failed", { sourceId: source.id, error: error.message });
      await saveState();
      return sendError(res, 422, error.message);
    }
  }

  if (req.method === "POST" && pathname === "/api/media/candidates") {
    const body = await readJsonBody(req);
    const source = findExistingMediaSource(cleanText(body.sourceId));
    if (!source) return sendError(res, 422, "Candidate generation blocked: no verified playable media.");
    try {
      await assertSourceIsPlayable(source);
      const start = Math.max(0, Number(body.startSeconds ?? body.timestampStartSeconds ?? 0));
      const end = Number(body.endSeconds ?? body.timestampEndSeconds ?? start + Number(body.durationSeconds || body.duration || 0));
      const candidate = {
        id: cleanText(body.id) || newId("candidate"),
        runId: cleanText(body.runId),
        streamerId: cleanText(body.streamerId || source.streamerId || DEMO_STREAMER_ID),
        sourceId: source.id,
        sourceClipId: cleanText(body.sourceClipId),
        sourceType: source.sourceKind || source.provenance || PROVENANCE.VERIFIED_MEDIA,
        sourceProvenance: source.provenance,
        startSeconds: start,
        endSeconds: end,
        timestampStartSeconds: start,
        timestampEndSeconds: end,
        timestampStart: secondsToTimestamp(start),
        timestampEnd: secondsToTimestamp(end),
        duration: Math.max(0, end - start),
        durationSeconds: Math.max(0, end - start),
        thumbnailArtifactId: cleanText(body.thumbnailArtifactId),
        transcriptSegmentIds: Array.isArray(body.transcriptSegmentIds) ? body.transcriptSegmentIds : [],
        transcriptSnippet: cleanText(body.transcriptSnippet) || "Source transcript unavailable unless uploaded or extracted.",
        transcriptProvenance: body.transcriptSnippet ? PROVENANCE.USER_ENTERED : PROVENANCE.UNAVAILABLE,
        evidence: body.evidence || {},
        title: cleanText(body.title) || "Verified media candidate",
        category: cleanText(body.category || source.category || "Media"),
        score: Number(body.score || 0),
        scoreComponents: body.scoreComponents || {},
        status: "candidate",
        provenance: source.provenance,
        creativeProvenance: PROVENANCE.USER_ENTERED,
        createdAt: now(),
        updatedAt: now()
      };
      assertCandidateReferencesSource(candidate, source);
      assertCandidateTimesValid(candidate, source);
      state.clipCandidates.unshift(candidate);
      await logEvent("candidate_created", "Clip candidate created from verified media source", {
        candidateId: candidate.id,
        sourceId: source.id
      });
      await saveState();
      return sendJson(res, 201, { candidate });
    } catch (error) {
      await logEvent("candidate_blocked", "Candidate creation blocked", { sourceId: source.id, error: error.message });
      return sendError(res, 422, error.message);
    }
  }

  const mediaCandidateRenderMatch = pathname.match(/^\/api\/media\/candidates\/([^/]+)\/render$/);
  if (mediaCandidateRenderMatch && req.method === "POST") {
    const body = await readJsonBody(req);
    try {
      const result = await createRenderJob({ ...body, candidateId: mediaCandidateRenderMatch[1] });
      return sendJson(res, 201, result);
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.statusCode ? error.message : "Render job failed", {
        message: error.message
      });
    }
  }

  const mediaRenderJobAliasMatch = pathname.match(/^\/api\/media\/render-jobs\/([^/]+)$/);
  if (mediaRenderJobAliasMatch && req.method === "GET") {
    const job = (state.mediaJobs || []).find((item) => item.id === mediaRenderJobAliasMatch[1]);
    if (!job) return sendError(res, 404, "Media render job not found");
    return sendJson(res, 200, { job });
  }

  const mediaArtifactMatch = pathname.match(/^\/api\/media\/artifacts\/([^/]+)$/);
  if (mediaArtifactMatch && req.method === "GET") {
    const artifact = state.artifacts.find((item) => item.id === mediaArtifactMatch[1]);
    if (!artifact) return sendError(res, 404, "Media artifact not found");
    return sendJson(res, 200, {
      artifact: {
        ...artifact,
        path: undefined,
        fileRefs: (artifact.fileRefs || []).map((fileRef) => ({ ...fileRef, path: undefined }))
      }
    });
  }

  if (req.method === "POST" && pathname === "/api/media/jobs") {
    const body = await readJsonBody(req);
    try {
      const result = await createRenderJob(body);
      return sendJson(res, 201, result);
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.statusCode ? error.message : "Render job failed", {
        message: error.message
      });
    }
  }

  const mediaJobMatch = pathname.match(/^\/api\/media\/jobs\/([^/]+)(?:\/cancel)?$/);
  if (mediaJobMatch) {
    const job = (state.mediaJobs || []).find((item) => item.id === mediaJobMatch[1]);
    if (!job) return sendError(res, 404, "Media job not found");
    if (req.method === "GET") return sendJson(res, 200, { job });
    if (req.method === "POST" && pathname.endsWith("/cancel")) {
      if (!["completed", "error", "cancelled"].includes(job.status)) {
        job.status = "cancelled";
        job.currentStep = "Cancelled by operator";
        job.updatedAt = now();
        await logEvent("render_cancelled", "Clip render cancelled", { jobId: job.id });
        await saveState();
      }
      return sendJson(res, 200, { job });
    }
  }

  if (req.method === "GET" && pathname === "/api/openai/status") {
    return sendJson(res, 200, {
      provider: config.aiProvider,
      mode: config.aiMode,
      model: config.openaiModel,
      configured: Boolean(config.openaiApiKey),
      keyExposed: false,
      testBudgetUsd: config.openaiTestBudgetUsd
    });
  }

  if (req.method === "POST" && pathname === "/api/openai/test") {
    try {
      const result = await testOpenAI();
      await logEvent("openai_test", "OpenAI status test completed", { live: result.live });
      return sendJson(res, 200, result);
    } catch (error) {
      await logEvent("api_error", "OpenAI status test failed", { error: error.message });
      return sendError(res, 502, error.message);
    }
  }

  if (req.method === "GET" && (pathname === "/api/twitch/status" || pathname === "/api/integrations/twitch/status")) {
    const status = await twitchIntegrationStatus({ validate: searchParams.get("validate") !== "false" });
    await saveState();
    return sendJson(res, 200, {
      ...status,
      allowedChannels: config.twitchAllowedChannels,
      rawTokensExposed: false
    });
  }

  if (req.method === "POST" && pathname === "/api/twitch/validate") {
    const status = await twitchIntegrationStatus({ validate: true });
    await logEvent("twitch_validate", "Twitch integration validated", {
      configured: status.configured,
      appTokenValid: status.appTokenValid,
      userTokenValid: status.userTokenValid,
      status: status.status
    });
    await saveState();
    return sendJson(res, 200, {
      ...status,
      rawTokensExposed: false
    });
  }

  if (req.method === "GET" && pathname === "/api/twitch/live-streams") {
    const requestedCount = Math.max(1, Math.min(100, Number(searchParams.get("count") || 2)));
    const contract = inferExecutionContract({
      goal: `Find the top ${requestedCount} streamers.`,
      requestedCount,
      mode: "real",
      scope: "twitch_live_global"
    });
    const run = { runId: newId("twitch_live_lookup") };
    contract.runId = run.runId;
    try {
      const streams = await fetchTopTwitchLiveStreams(requestedCount, run, contract);
      streams.forEach(assertTwitchRecordReal);
      return sendJson(res, 200, {
        requestedCount,
        returnedCount: streams.length,
        streams,
        sourceMode: "real",
        apiEndpoint: "helix/streams",
        rawTokensExposed: false
      });
    } catch (error) {
      await logEvent("api_error", "Twitch live stream discovery failed", { requestedCount, error: error.message });
      return sendError(res, 502, error.message);
    }
  }

  if (req.method === "GET" && pathname === "/api/twitch/approved-live-streams") {
    const requestedCount = Math.max(1, Math.min(100, Number(searchParams.get("count") || 2)));
    const contract = inferExecutionContract({
      goal: `Find the top ${requestedCount} approved streamers and create clips.`,
      requestedCount,
      mode: "real",
      scope: "approved_watchlist"
    });
    const run = { runId: newId("twitch_approved_lookup") };
    contract.runId = run.runId;
    try {
      const streams = await fetchApprovedTwitchLiveStreams(requestedCount, run, contract);
      streams.forEach(assertTwitchRecordReal);
      return sendJson(res, 200, {
        requestedCount,
        returnedCount: streams.length,
        streams,
        sourceMode: "real",
        sourceScope: "approved_watchlist",
        rawTokensExposed: false
      });
    } catch (error) {
      await logEvent("api_error", "Twitch approved live stream discovery failed", { requestedCount, error: error.message });
      return sendError(res, 502, error.message);
    }
  }

  if (req.method === "POST" && [
    "/api/twitch/clips/live",
    "/api/twitch/clips/vod"
  ].includes(pathname)) {
    await logEvent("clip_creation_blocked", "Twitch clip creation blocked until user token/scopes and rights evidence are verified", {
      route: pathname
    });
    return sendError(res, 501, "Real Twitch clip creation is not enabled yet. It requires a valid user access token, required scopes, channel rights evidence, and async Twitch clip confirmation.");
  }

  const twitchClipActionMatch = pathname.match(/^\/api\/twitch\/clips\/([^/]+)\/(status|download)$/);
  if (twitchClipActionMatch) {
    if (req.method === "GET" && twitchClipActionMatch[2] === "status") {
      return sendError(res, 404, "No verified Twitch clip record exists for this clip ID.");
    }
    if (req.method === "POST" && twitchClipActionMatch[2] === "download") {
      await logEvent("clip_download_blocked", "Twitch clip download blocked until rights and official download support are verified", {
        clipId: twitchClipActionMatch[1]
      });
      return sendError(res, 501, "Real Twitch clip download is not enabled yet. No local file was created.");
    }
  }

  if (req.method === "POST" && pathname === "/api/twitch/test") {
    try {
      if (!twitchApiConfigured()) {
        return sendJson(res, 200, {
          configured: false,
          live: false,
          message: "Twitch credentials are not configured. Real mode will stop instead of using demo data."
        });
      }
      const token = config.twitchOAuthToken || (await getTwitchAppToken());
      await logEvent("twitch_test", "Twitch official API connectivity tested", { tokenAvailable: Boolean(token) });
      return sendJson(res, 200, { configured: true, live: true, officialApiOnly: true });
    } catch (error) {
      await logEvent("api_error", "Twitch status test failed", { error: error.message });
      return sendError(res, 502, error.message);
    }
  }

  if (req.method === "GET" && pathname === "/api/kick/status") {
    return sendJson(res, 200, {
      configured: kickApiConfigured(),
      clientIdConfigured: Boolean(config.kickClientId),
      clientSecretConfigured: Boolean(config.kickClientSecret),
      oauthTokenConfigured: Boolean(config.kickOAuthToken),
      officialApiOnly: true
    });
  }

  if (req.method === "POST" && pathname === "/api/kick/test") {
    try {
      if (!kickApiConfigured()) {
        return sendJson(res, 200, {
          configured: false,
          live: false,
          message: "Kick credentials are not configured. Kick streamers will show API needed until KICK_CLIENT_ID and KICK_CLIENT_SECRET are set."
        });
      }
      const token = config.kickOAuthToken || (await getKickAppToken());
      await logEvent("kick_test", "Kick official API connectivity tested", { tokenAvailable: Boolean(token) });
      return sendJson(res, 200, { configured: true, live: true, officialApiOnly: true });
    } catch (error) {
      await logEvent("api_error", "Kick status test failed", { error: error.message });
      return sendError(res, 502, error.message);
    }
  }

  if (req.method === "POST" && pathname === "/api/agent101/runs") {
    const body = await readJsonBody(req);
    const result = await runAgent101(body);
    return sendJson(res, 200, result);
  }

  const agentRunMatch = pathname.match(/^\/api\/agent101\/runs\/([^/]+)(?:\/(events|cancel|retry-stage))?$/);
  if (agentRunMatch) {
    const run = (state.agentRuns || []).find((item) => item.runId === agentRunMatch[1]);
    if (!run) return sendError(res, 404, "Agent 101 run not found");
    const action = agentRunMatch[2] || "";
    if (req.method === "GET" && !action) return sendJson(res, 200, { run, externalStatus: toExternalRunStatus(run.status) });
    if (req.method === "GET" && action === "events") return sendJson(res, 200, { runId: run.runId, events: run.events || [] });
    if (req.method === "POST" && action === "cancel") {
      if (!["COMPLETED", "FAILED", "CANCELLED", "BLOCKED"].includes(run.status)) {
        run.status = "CANCELLED";
        run.externalStatus = "cancelled";
        run.currentStage = "CANCELLED";
        run.completedAt = now();
        run.summary = "Run cancelled by operator.";
        addRunEvent(run, "CANCELLED", "succeeded", "Run cancelled by operator.");
        await saveRunState(run);
      }
      return sendJson(res, 200, { run, externalStatus: toExternalRunStatus(run.status) });
    }
    if (req.method === "POST" && action === "retry-stage") {
      const body = await readJsonBody(req);
      const retryBody = {
        threadId: run.contract?.threadId,
        goal: run.contract?.originalUserRequest || run.goal,
        mode: run.contract?.sourceMode || run.mode,
        requestedCount: run.contract?.requestedCount,
        scope: run.contract?.sourceScope,
        idempotencyKey: `${run.idempotencyKey || run.runId}:retry:${cleanText(body.stage || run.currentStage)}:${Date.now()}`
      };
      const retry = await runAgent101(retryBody);
      return sendJson(res, 200, retry);
    }
  }

  if (req.method === "POST" && pathname === "/api/agent101/run") {
    const body = await readJsonBody(req);
    const result = await runAgent101(body);
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && pathname === "/api/demo/seed") {
    const seeded = await seedDemoWorkspace();
    return sendJson(res, 200, {
      seeded,
      message: "Demo mission loaded. StreamClipper is ready to run a supervised clipping cycle."
    });
  }

  if (req.method === "POST" && pathname === "/api/demo/clear") {
    const before = {
      streamers: state.streamers.length,
      sessions: state.streamSessions.length,
      candidates: state.clipCandidates.length,
      sources: state.mediaSources.length,
      projects: state.mediaProjects.length
    };
    state.streamers = state.streamers.filter((streamer) => !(streamer.isDemo || streamer.permissionStatus === "demo_approved" || streamer.platform === "demo"));
    state.streamSessions = state.streamSessions.filter((session) => !String(session.status || "").startsWith("demo"));
    state.clipCandidates = state.clipCandidates.filter((candidate) => !(candidate.provenance === PROVENANCE.DEMO_SOURCE || candidate.sourceProvenance === PROVENANCE.DEMO_SOURCE || /demo/i.test(candidate.sourceType || "")));
    state.mediaSources = state.mediaSources.filter((source) => source.provenance !== PROVENANCE.DEMO_SOURCE);
    state.mediaProjects = state.mediaProjects.filter((project) => project.id !== DEMO_PROJECT_ID);
    const cleared = {
      streamers: before.streamers - state.streamers.length,
      sessions: before.sessions - state.streamSessions.length,
      candidates: before.candidates - state.clipCandidates.length,
      sources: before.sources - state.mediaSources.length,
      projects: before.projects - state.mediaProjects.length
    };
    await logEvent("demo_cleared", "Demo data cleared from StreamClipper state", cleared);
    await saveState();
    return sendJson(res, 200, { cleared, message: "Demo rows cleared. Real data was left untouched." });
  }

  if (req.method === "GET" && (pathname === "/api/twitch/streams" || pathname === "/api/streams")) {
    const rows = [];
    for (const streamer of state.streamers.filter((item) => ["twitch", "kick"].includes(item.platform))) {
      try {
        rows.push(await checkStreamerLive(streamer));
      } catch (error) {
        streamer.liveStatus = "api_error";
        streamer.liveStatusReason = error.message;
        rows.push({ streamerId: streamer.id, live: null, official: false, error: error.message });
      }
    }
    await saveState();
    return sendJson(res, 200, { streams: rows });
  }

  if (req.method === "GET" && pathname === "/api/twitch/streamers") {
    return sendJson(res, 200, { streamers: state.streamers });
  }

  if (req.method === "GET" && pathname === "/api/streamers/recommendations") {
    const result = await recommendStreamers({
      platform: normalizeStatus(searchParams.get("platform") || "all", ["all", "kick", "twitch"], "all"),
      limit: Number(searchParams.get("limit") || 12)
    });
    await logEvent("streamer_scout", "Agent 101 generated streamer recommendations", {
      count: result.recommendations.length,
      providers: result.providers,
      errors: result.errors
    });
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && pathname === "/api/twitch/streamers") {
    const body = await readJsonBody(req);
    const identity = normalizeStreamerInput(body);
    const streamer = {
      id: newId("streamer"),
      platform: normalizeStatus(body.platform || "twitch", ["twitch", "youtube_live", "kick", "other"], "twitch"),
      displayName: identity.displayName,
      channelId: identity.channelId,
      channelUrl: identity.channelUrl,
      permissionStatus: normalizeStatus(body.permissionStatus, ["approved", "pending", "blocked"], "pending"),
      allowedUse: Array.isArray(body.allowedUse) ? body.allowedUse : ["clips"],
      monitorEnabled: Boolean(body.monitorEnabled ?? true),
      lastCheckedAt: null,
      liveStatus: "unknown",
      liveStatusReason: "Not checked yet",
      notes: cleanText(body.notes),
      createdAt: now(),
      updatedAt: now()
    };
    state.streamers.unshift(streamer);
    if (streamer.permissionStatus !== "approved") {
      createApprovalRequest({
        type: "streamer_permission",
        title: `Permission review: ${streamer.displayName}`,
        riskLevel: "high",
        linkedId: streamer.id,
        evidence: { permissionStatus: streamer.permissionStatus, allowedUse: streamer.allowedUse }
      });
    }
    await logEvent("streamer_added", "Streamer added to watchlist", {
      streamerId: streamer.id,
      permissionStatus: streamer.permissionStatus
    });
    if (streamer.permissionStatus === "approved" && streamer.monitorEnabled) {
      try {
        await checkStreamerLive(streamer);
        await logEvent("stream_live_checked", "Streamer live status checked", {
          streamerId: streamer.id,
          liveStatus: streamer.liveStatus,
          provider: streamer.platform
        });
      } catch (error) {
        streamer.liveStatus = "api_error";
        streamer.liveStatusReason = error.message;
        await logEvent("api_error", "Official live check failed after streamer add", {
          streamerId: streamer.id,
          provider: streamer.platform,
          error: error.message
        });
      }
    }
    await saveState();
    return sendJson(res, 201, { streamer });
  }

  const streamerCheckMatch = pathname.match(/^\/api\/twitch\/streamers\/([^/]+)\/check$/);
  if (streamerCheckMatch && req.method === "POST") {
    const streamer = findStreamer(streamerCheckMatch[1]);
    if (!streamer) return sendError(res, 404, "Streamer not found");
    try {
      const result = await checkStreamerLive(streamer);
      await logEvent("stream_live_checked", "Streamer live status checked", {
        streamerId: streamer.id,
        liveStatus: streamer.liveStatus,
        provider: result.provider || streamer.platform,
        official: result.official
      });
      await saveState();
      return sendJson(res, 200, { streamer, result });
    } catch (error) {
      streamer.liveStatus = "api_error";
      streamer.liveStatusReason = error.message;
      await logEvent("api_error", "Official live check failed", {
        streamerId: streamer.id,
        provider: streamer.platform,
        error: error.message
      });
      await saveState();
      return sendError(res, 502, error.message, { streamerId: streamer.id });
    }
  }

  const streamerMatch = pathname.match(/^\/api\/twitch\/streamers\/([^/]+)$/);
  if (streamerMatch && req.method === "PATCH") {
    const streamer = findStreamer(streamerMatch[1]);
    if (!streamer) return sendError(res, 404, "Streamer not found");
    const body = await readJsonBody(req);
    const before = streamer.permissionStatus;
    const identity = normalizeStreamerInput({
      displayName: body.displayName !== undefined ? body.displayName : streamer.displayName,
      channelId: body.channelId !== undefined ? body.channelId : streamer.channelId,
      channelUrl: body.channelUrl !== undefined ? body.channelUrl : streamer.channelUrl,
      platform: body.platform !== undefined ? body.platform : streamer.platform
    });
    Object.assign(streamer, {
      platform: body.platform ? normalizeStatus(body.platform, ["twitch", "youtube_live", "kick", "other"], streamer.platform) : streamer.platform,
      displayName: body.displayName !== undefined || body.channelId !== undefined || body.channelUrl !== undefined ? identity.displayName : streamer.displayName,
      channelId: body.displayName !== undefined || body.channelId !== undefined || body.channelUrl !== undefined ? identity.channelId : streamer.channelId,
      channelUrl: body.displayName !== undefined || body.channelId !== undefined || body.channelUrl !== undefined ? identity.channelUrl : streamer.channelUrl,
      permissionStatus: body.permissionStatus
        ? normalizeStatus(body.permissionStatus, ["approved", "pending", "blocked"], streamer.permissionStatus)
        : streamer.permissionStatus,
      allowedUse: Array.isArray(body.allowedUse) ? body.allowedUse : streamer.allowedUse,
      monitorEnabled: body.monitorEnabled !== undefined ? Boolean(body.monitorEnabled) : streamer.monitorEnabled,
      notes: body.notes !== undefined ? cleanText(body.notes) : streamer.notes,
      updatedAt: now()
    });
    if (before !== "approved" && streamer.permissionStatus === "approved") {
      await logEvent("approval_local", "Streamer permission marked approved locally", { streamerId: streamer.id });
    }
    await saveState();
    return sendJson(res, 200, { streamer });
  }

  if (streamerMatch && req.method === "DELETE") {
    const index = state.streamers.findIndex((streamer) => streamer.id === streamerMatch[1]);
    if (index < 0) return sendError(res, 404, "Streamer not found");
    const [removed] = state.streamers.splice(index, 1);
    await logEvent("streamer_deleted", "Streamer removed from watchlist", { streamerId: removed.id });
    await saveState();
    return sendJson(res, 200, { deleted: true });
  }

  if (req.method === "POST" && pathname === "/api/watch/run") {
    const body = await readJsonBody(req);
    const runMode = normalizeStatus(body.mode || "real", ["real", "demo"], "real");
    if (runMode === "demo") {
      ensureClippingStudioProject();
      await logEvent("demo_watch_cycle", "Explicit demo watch cycle used bundled practice media", {
        label: "DEMO / SYNTHETIC — NOT REAL TWITCH DATA"
      });
      await saveState();
      return sendJson(res, 200, {
        mode: "demo",
        label: "DEMO / SYNTHETIC — NOT REAL TWITCH DATA",
        results: state.clipCandidates
          .filter((candidate) => candidate.provenance === PROVENANCE.DEMO_SOURCE || candidate.sourceProvenance === PROVENANCE.DEMO_SOURCE)
          .map((candidate) => ({ candidate, demo: true })),
        dailyLimit: dailyLimitStatus()
      });
    }
    const results = [];
    for (const streamer of state.streamers.filter((item) => item.monitorEnabled)) {
      if (streamer.isDemo || streamer.permissionStatus === "demo_approved" || streamer.platform === "demo") {
        results.push({
          streamerId: streamer.id,
          live: null,
          skipped: true,
          official: false,
          reason: "Demo streamer hidden from real watch cycle."
        });
        continue;
      }
      let stream = null;
      let liveCheck = null;
      try {
        liveCheck = await checkStreamerLive(streamer);
        stream = liveCheck.stream || null;
      } catch (error) {
        streamer.liveStatus = "api_error";
        streamer.liveStatusReason = error.message;
        await logEvent("api_error", "Official stream metadata fetch failed", {
          streamerId: streamer.id,
          provider: streamer.platform,
          error: error.message
        });
      }

      if (liveCheck?.skipped && streamer.liveStatus !== "api_not_configured") {
        results.push(liveCheck);
        await logEvent("permission_blocked", "Watch skipped before live scan", {
          streamerId: streamer.id,
          reason: liveCheck.reason
        });
        continue;
      }

      if (!stream) {
        results.push({
          ...(liveCheck || { streamerId: streamer.id, live: false, official: true }),
          session: null,
          candidate: null,
          reason: "Official API returned no active stream. No candidate was created."
        });
        continue;
      }

      const session = {
        id: newId("session"),
        streamerId: streamer.id,
        platform: streamer.platform,
        title: stream.title || `${streamer.displayName} live stream`,
        category: stream.game_name || "Unknown category",
        startedAt: stream.started_at || now(),
        endedAt: null,
        vodId: null,
        status: "live",
        providerStreamId: stream.id || "",
        sourceMode: "real",
        provenance: PROVENANCE.VERIFIED_API
      };
      state.streamSessions.unshift(session);
      results.push({
        ...(liveCheck || { streamerId: streamer.id, live: true, official: true }),
        session,
        candidate: null,
        reason: "Candidate generation blocked: no verified playable media."
      });
      await logEvent("candidate_blocked", "Candidate generation blocked: no verified playable media", {
        streamerId: streamer.id,
        sessionId: session.id,
        sourceMode: "real"
      });
    }
    await saveState();
    return sendJson(res, 200, { mode: "real", results, dailyLimit: dailyLimitStatus() });
  }

  if (req.method === "GET" && pathname === "/api/clips/candidates") {
    return sendJson(res, 200, {
      candidates: state.clipCandidates,
      streamers: state.streamers
    });
  }

  if (req.method === "GET" && pathname === "/api/clips/packages") {
    return sendJson(res, 200, { packages: state.clipPackages });
  }

  if (req.method === "POST" && pathname === "/api/clips/candidates/score") {
    const body = await readJsonBody(req);
    const candidate = state.clipCandidates.find((item) => item.id === body.id) || body.candidate;
    if (!candidate) return sendError(res, 404, "Candidate not found");
    const score = scoreClipMoment({ ...candidate, ...body.updates });
    if (candidate.id) {
      Object.assign(candidate, score, body.updates || {}, { updatedAt: now() });
      await logEvent("clip_scored", "Clip candidate scored", { candidateId: candidate.id, score: score.score });
      await saveState();
    }
    return sendJson(res, 200, { candidate, score });
  }

  if (req.method === "POST" && pathname === "/api/clips/draft") {
    const body = await readJsonBody(req);
    const candidate = state.clipCandidates.find((item) => item.id === body.candidateId);
    if (!candidate) return sendError(res, 404, "Candidate not found");
    candidate.builderDraft = {
      format: body.format || "9:16",
      resolution: body.resolution || "1080x1920",
      duration: Number(body.duration || candidate.duration || 30),
      status: "saved",
      updatedAt: now()
    };
    candidate.updatedAt = now();
    await logEvent("builder_draft_saved", "Clip builder draft saved", { candidateId: candidate.id });
    await saveState();
    return sendJson(res, 200, { candidate });
  }

  if (req.method === "POST" && pathname === "/api/clips/package") {
    const body = await readJsonBody(req);
    const candidate = state.clipCandidates.find((item) => item.id === body.candidateId);
    if (!candidate) return sendError(res, 404, "Candidate not found");
    const streamer = findStreamer(candidate.streamerId);
    const source = findExistingMediaSource(candidate.sourceId);
    if (!source) {
      await logEvent("candidate_blocked", "Package blocked because candidate has no verified media source", {
        candidateId: candidate.id,
        sourceId: candidate.sourceId || ""
      });
      return sendError(res, 422, "Candidate generation blocked: no verified playable media.");
    }
    try {
      await assertSourceIsPlayable(source);
      assertCandidateReferencesSource(candidate, source);
      assertCandidateTimesValid(candidate, source);
    } catch (error) {
      await logEvent("candidate_blocked", "Package blocked by source verification", {
        candidateId: candidate.id,
        sourceId: candidate.sourceId,
        error: error.message
      });
      return sendError(res, 422, error.message);
    }
    if (source.provenance !== PROVENANCE.DEMO_SOURCE && !isRealApprovedStreamer(streamer)) {
      await logEvent("permission_blocked", "Package blocked for unapproved streamer", { candidateId: candidate.id });
      return sendError(res, 403, "Streamer permission is not approved");
    }
    const packagePlan = buildPackage({ ...candidate, ...body });
    const packageArtifact = await writeArtifact("clip_package", packagePlan.title, {
      candidate,
      streamer,
      packagePlan,
      createdAt: now()
    });
    const clipPackage = {
      id: newId("package"),
      candidateId: candidate.id,
      format: "9:16",
      resolution: "1080x1920",
      targetDuration: Number(body.targetDuration || candidate.duration || 30),
      hook: packagePlan.hook,
      captionOverlays: packagePlan.captionOverlays,
      cutInstructions: packagePlan.cutInstructions,
      capcutBriefId: null,
      postingDrafts: [],
      approvalStatus: "pending",
      artifacts: [packageArtifact],
      sourceId: source.id,
      sourceProvenance: source.provenance,
      renderedArtifactId: candidate.renderedArtifactId || null,
      packagePlan,
      createdAt: now(),
      updatedAt: now()
    };
    state.clipPackages.unshift(clipPackage);
    candidate.status = "packaged";
    candidate.updatedAt = now();
    await logEvent("package_created", "Clip package created", {
      candidateId: candidate.id,
      clipPackageId: clipPackage.id,
      sourceId: source.id,
      postingDraftsCreated: 0,
      approvalRequestsCreated: 0
    });
    await saveState();
    return sendJson(res, 201, {
      clipPackage,
      packagePlan,
      postingDrafts: [],
      message: "Clip package created from verified source. Posting drafts are blocked until a rendered clip artifact passes verification."
    });
  }

  if (req.method === "POST" && pathname === "/api/clips/capcut-brief") {
    const body = await readJsonBody(req);
    const clipPackage = state.clipPackages.find((item) => item.id === body.clipPackageId);
    if (!clipPackage) return sendError(res, 404, "Clip package not found");
    const plan = clipPackage.packagePlan || {};
    const brief = {
      projectTitle: plan.title || "StreamClipper CapCut Project",
      aspectRatio: "9:16",
      resolution: "1080x1920",
      targetLength: `${clipPackage.targetDuration || 30}s`,
      cutInstructions: plan.cutInstructions || clipPackage.cutInstructions,
      captionOverlayInstructions: plan.captionOverlays || clipPackage.captionOverlays,
      zoomCropInstructions: plan.cropGuidance || [],
      soundEffectsNotes: ["Use subtle beat hits only where they support the reaction.", "Avoid copyrighted music unless cleared."],
      exportChecklist: plan.approvalChecklist || [],
      createdAt: now()
    };
    const jsonArtifact = await writeArtifact("capcut_brief", brief.projectTitle, brief, "json");
    const textArtifact = await writeArtifact(
      "capcut_brief",
      `${brief.projectTitle}-handoff`,
      [
        `Project: ${brief.projectTitle}`,
        `Aspect: ${brief.aspectRatio}`,
        `Resolution: ${brief.resolution}`,
        `Target length: ${brief.targetLength}`,
        "",
        "Cut instructions:",
        ...brief.cutInstructions.map((item) => `- ${item}`),
        "",
        "Caption overlays:",
        ...brief.captionOverlayInstructions.map((item) => `- ${item}`),
        "",
        "Zoom/crop:",
        ...brief.zoomCropInstructions.map((item) => `- ${item}`),
        "",
        "Export checklist:",
        ...brief.exportChecklist.map((item) => `- ${item}`)
      ].join("\n"),
      "txt"
    );
    clipPackage.capcutBriefId = jsonArtifact.id;
    clipPackage.artifacts.push(jsonArtifact, textArtifact);
    clipPackage.updatedAt = now();
    await logEvent("capcut_brief_created", "CapCut handoff created", { clipPackageId: clipPackage.id });
    await saveState();
    return sendJson(res, 201, { brief, artifacts: [jsonArtifact, textArtifact] });
  }

  if (req.method === "POST" && pathname === "/api/clips/captions") {
    const body = await readJsonBody(req);
    const clipPackage = state.clipPackages.find((item) => item.id === body.clipPackageId);
    if (!clipPackage) return sendError(res, 404, "Clip package not found");
    const plan = clipPackage.packagePlan || buildPackage(state.clipCandidates.find((item) => item.id === clipPackage.candidateId));
    const srt = [
      "1",
      "00:00:00,000 --> 00:00:02,000",
      plan.captionOverlays?.[0] || plan.hook || "Watch this",
      "",
      "2",
      "00:00:02,000 --> 00:00:05,000",
      plan.captionOverlays?.[1] || "No way",
      "",
      "3",
      "00:00:05,000 --> 00:00:08,000",
      plan.captionOverlays?.[2] || "Watch the end"
    ].join("\n");
    const vtt = `WEBVTT\n\n${srt.replace(/,/g, ".").replace(/^\d+\n/gm, "")}`;
    const srtArtifact = await writeArtifact("captions", `${plan.title}-captions`, srt, "srt");
    const vttArtifact = await writeArtifact("captions", `${plan.title}-captions`, vtt, "vtt");
    clipPackage.artifacts.push(srtArtifact, vttArtifact);
    await logEvent("captions_created", "Caption files created", { clipPackageId: clipPackage.id });
    await saveState();
    return sendJson(res, 201, { artifacts: [srtArtifact, vttArtifact] });
  }

  if (req.method === "GET" && pathname === "/api/posts/queue") {
    return sendJson(res, 200, {
      drafts: state.postingDrafts,
      dailyLimit: dailyLimitStatus()
    });
  }

  if (req.method === "GET" && pathname === "/api/posting-drafts") {
    return sendJson(res, 200, {
      drafts: state.postingDrafts,
      dailyLimit: dailyLimitStatus()
    });
  }

  if (req.method === "POST" && (pathname === "/api/posts/queue" || pathname === "/api/posting-drafts")) {
    const body = await readJsonBody(req);
    try {
      return sendJson(res, 201, await createVerifiedPostingDraft(body));
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message, error.details);
    }
  }

  const postMatch = pathname.match(/^\/api\/posts\/([^/]+)$/);
  if (postMatch && req.method === "PATCH") {
    const draft = state.postingDrafts.find((item) => item.id === postMatch[1]);
    if (!draft) return sendError(res, 404, "Posting draft not found");
    const body = await readJsonBody(req);
    if (body.approvalStatus === "approved" && draft.approvalStatus !== "approved" && dailyLimitStatus().blocked) {
      return sendError(res, 429, "Daily approved post limit reached", dailyLimitStatus());
    }
    Object.assign(draft, {
      caption: body.caption !== undefined ? cleanText(body.caption) : draft.caption,
      hashtags: Array.isArray(body.hashtags) ? body.hashtags : draft.hashtags,
      thumbnailText: body.thumbnailText !== undefined ? cleanText(body.thumbnailText) : draft.thumbnailText,
      scheduledFor: body.scheduledFor !== undefined ? cleanText(body.scheduledFor) : draft.scheduledFor,
      status: body.status ? normalizeStatus(body.status, ["draft", "queued", "blocked"], draft.status) : draft.status,
      approvalStatus: body.approvalStatus
        ? normalizeStatus(body.approvalStatus, ["pending", "approved", "rejected", "send_back"], draft.approvalStatus)
        : draft.approvalStatus,
      updatedAt: now()
    });
    if (body.approvalStatus === "approved" && !draft.approvedAt) draft.approvedAt = now();
    await saveState();
    return sendJson(res, 200, { draft, dailyLimit: dailyLimitStatus() });
  }

  const requestApprovalMatch = pathname.match(/^\/api\/posts\/([^/]+)\/request-approval$/);
  if (requestApprovalMatch && req.method === "POST") {
    const draft = state.postingDrafts.find((item) => item.id === requestApprovalMatch[1]);
    if (!draft) return sendError(res, 404, "Posting draft not found");
    try {
      assertPostingDraftHasRealClip(draft);
    } catch (error) {
      await logEvent("approval_blocked", "Approval request blocked without verified posting draft clip", {
        draftId: draft.id,
        error: error.message
      });
      return sendError(res, 422, error.message);
    }
    const request = createApprovalRequest({
      type: "posting_draft",
      title: `Post approval: ${draft.platform}`,
      riskLevel: "medium",
      linkedId: draft.id,
      evidence: { draft }
    });
    await logEvent("approval_requested", "Posting draft approval requested", { draftId: draft.id });
    await saveState();
    return sendJson(res, 201, { request });
  }

  if (req.method === "POST" && pathname === "/api/human-gate/requests") {
    const body = await readJsonBody(req);
    const draftId = cleanText(body.postingDraftId || body.draftId || body.linkedId);
    const draft = state.postingDrafts.find((item) => item.id === draftId);
    if (!draft) return sendError(res, 404, "Posting draft not found");
    try {
      assertPostingDraftHasRealClip(draft);
    } catch (error) {
      await logEvent("approval_blocked", "Human Gate request blocked without verified posting draft clip", {
        draftId,
        error: error.message
      });
      return sendError(res, 422, error.message);
    }
    const request = createApprovalRequest({
      type: "posting_draft",
      actionType: cleanText(body.actionType) || "publish_video",
      title: cleanText(body.title) || `Post approval: ${draft.platform}`,
      riskLevel: cleanText(body.riskLevel) || "medium",
      linkedId: draft.id,
      evidence: {
        draft,
        clipArtifactId: draft.clipArtifactId,
        rightsEvidence: cleanText(body.rightsEvidence) || "Operator must verify rights before publishing."
      }
    });
    await logEvent("approval_requested", "Human Gate approval request created", { draftId: draft.id, requestId: request.id });
    await saveState();
    return sendJson(res, 201, { request });
  }

  if (req.method === "GET" && pathname === "/api/human-gate/approvals") {
    return sendJson(res, 200, { approvals: state.approvalRequests, dailyLimit: dailyLimitStatus() });
  }

  if (["/api/human-gate/approve", "/api/human-gate/reject", "/api/human-gate/send-back"].includes(pathname) && req.method === "POST") {
    const body = await readJsonBody(req);
    const request = state.approvalRequests.find((item) => item.id === body.id);
    if (!request) return sendError(res, 404, "Approval request not found");
    const action = pathname.endsWith("approve") ? "approved" : pathname.endsWith("reject") ? "rejected" : "send_back";
    if (action === "approved" && request.type === "posting_draft") {
      const draft = state.postingDrafts.find((item) => item.id === request.linkedId);
      try {
        assertPostingDraftHasRealClip(draft);
      } catch (error) {
        await logEvent("approval_blocked", "Human Gate approval blocked without verified clip artifact", {
          approvalId: request.id,
          draftId: draft?.id,
          error: error.message
        });
        return sendError(res, 422, error.message);
      }
      if (draft?.approvalStatus !== "approved" && dailyLimitStatus().blocked) {
        return sendError(res, 429, "Daily approved post limit reached", dailyLimitStatus());
      }
      if (draft) {
        draft.approvalStatus = "approved";
        draft.status = "queued";
        draft.updatedAt = now();
        draft.approvedAt = now();
      }
    }
    if (request.type === "clip_package") {
      const clipPackage = state.clipPackages.find((item) => item.id === request.linkedId);
      if (clipPackage) {
        clipPackage.approvalStatus = action;
        clipPackage.updatedAt = now();
      }
    }
    if (request.type === "streamer_permission" && action === "approved") {
      const streamer = findStreamer(request.linkedId);
      if (streamer) {
        streamer.permissionStatus = "approved";
        streamer.updatedAt = now();
      }
    }
    request.status = action;
    request.decidedAt = now();
    request.decisionNotes = cleanText(body.notes);
    await logEvent(action === "approved" ? "approved" : "approval_decision", `Human Gate ${action}`, {
      requestId: request.id,
      type: request.type
    });
    await saveState();
    return sendJson(res, 200, { request, dailyLimit: dailyLimitStatus() });
  }

  if (req.method === "GET" && pathname === "/api/artifacts") {
    return sendJson(res, 200, { artifacts: state.artifacts });
  }

  if (req.method === "GET" && pathname === "/api/logs") {
    return sendJson(res, 200, { logs: state.logs });
  }

  if (req.method === "GET" && pathname === "/api/config") {
    return sendJson(res, 200, publicConfig());
  }

  return sendError(res, 404, "API route not found", { pathname, method: req.method });
}

async function serveStatic(req, res, pathname) {
  if (pathname.startsWith("/outputs/")) {
    const filename = decodeURIComponent(pathname.replace("/outputs/", ""));
    const filePath = path.join(config.outputDir, path.basename(filename));
    return streamFile(res, filePath);
  }
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(requested).replace(/^(\.\.[/\\])+/, ""));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendError(res, 403, "Forbidden");
  return streamFile(res, filePath);
}

function streamFile(res, filePath) {
  const contentType = contentTypeFor(filePath);
  const stream = createReadStream(filePath);
  stream.on("open", () => {
    res.writeHead(200, {
      "content-type": contentType,
      "cache-control": "no-store"
    });
    stream.pipe(res);
  });
  stream.on("error", () => {
    if (!res.headersSent) sendError(res, 404, "File not found");
    else res.end();
  });
}

async function streamFileWithRange(req, res, filePath, contentType = contentTypeFor(filePath)) {
  try {
    const stat = await fs.stat(filePath);
    const range = req.headers.range;
    if (!range) {
      res.writeHead(200, {
        "content-type": contentType,
        "content-length": stat.size,
        "accept-ranges": "bytes",
        "cache-control": "no-store"
      });
      return createReadStream(filePath).pipe(res);
    }

    const match = range.match(/bytes=(\d*)-(\d*)/);
    if (!match) {
      res.writeHead(416, { "content-range": `bytes */${stat.size}` });
      return res.end();
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : stat.size - 1;
    if (start >= stat.size || end >= stat.size || start > end) {
      res.writeHead(416, { "content-range": `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, {
      "content-type": contentType,
      "content-length": end - start + 1,
      "content-range": `bytes ${start}-${end}/${stat.size}`,
      "accept-ranges": "bytes",
      "cache-control": "no-store"
    });
    return createReadStream(filePath, { start, end }).pipe(res);
  } catch {
    return sendError(res, 404, "File not found");
  }
}

async function handleRequest(req, res) {
  await readyPromise;
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      return await handleApi(req, res, url.pathname, url.searchParams);
    }
    return await serveStatic(req, res, url.pathname);
  } catch (error) {
    const status = error.statusCode || 500;
    await logEvent("api_error", "Unhandled request error", { error: error.message });
    return sendError(res, status, status === 500 ? "Internal server error" : error.message);
  }
}

const readyPromise = ensureStorage();

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await readyPromise;
  const server = http.createServer(handleRequest);
  server.listen(config.port, () => {
    console.log(`StreamClipper Agent running on http://localhost:${config.port}`);
  });
}

async function runAgent101Workflow(body = {}) {
  await readyPromise;
  return runAgent101(body);
}

export { handleRequest, runAgent101Workflow };

import http from "node:http";
import { createReadStream, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { createBrowserWorkspace } from "./services/browser-workspace.js";
import { createCapCutController } from "./services/capcut-controller.js";
import { TOOL_REGISTRY, executeTool, listOutputFiles, readOutputFile, resultToToolText } from "./services/agent-tools.js";
import { isCapCutInstalled, isCapCutRunning, runCapcutDesktopEdit } from "./services/capcut-desktop.js";
import { TwitchChatMonitor } from "./services/twitch-chat.js";
import { analyzeAudioEnergy } from "./services/audio-energy.js";
import { transcribeBuffer, scoreTranscript, isWhisperAvailable } from "./services/whisper-service.js";
import { runVisionGate } from "./services/vision-gate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const inheritedEnvKeys = new Set(Object.keys(process.env));

function parseEnvLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) return null;
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return { key: match[1], value };
}

function loadEnvFile(filePath, { localOverride = false } = {}) {
  let raw = "";
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`[config] Could not read env file ${filePath}: ${error.message}`);
    }
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (inheritedEnvKeys.has(parsed.key)) continue;
    if (localOverride || !process.env[parsed.key]) {
      process.env[parsed.key] = parsed.value;
    }
  }
}

loadEnvFile(path.resolve(__dirname, "..", ".env"));
loadEnvFile(path.resolve(__dirname, "..", ".env.local"));
loadEnvFile(path.resolve(__dirname, ".env"), { localOverride: true });

// GUI-launched apps (Electron, Finder) get a minimal PATH without Homebrew,
// so streamlink / yt-dlp silently "disappear" when the office isn't started
// from a terminal — the recorder then waits forever. Make external tools
// resolvable no matter how the process was launched.
{
  const extraToolDirs = ["/opt/homebrew/bin", "/usr/local/bin", path.join(process.env.HOME || "", ".local", "bin")];
  const pathParts = String(process.env.PATH || "").split(":").filter(Boolean);
  for (const dir of extraToolDirs) {
    if (dir && !pathParts.includes(dir)) pathParts.push(dir);
  }
  process.env.PATH = pathParts.join(":");
}

const RUNTIME_DIR = path.resolve(
  process.env.CLIPPING_OFFICE_DATA_DIR ||
    process.env.ARGENTUM_CLIPPING_OFFICE_DATA_DIR ||
    path.join(__dirname, "data"),
);
const DATA_FILE = path.join(RUNTIME_DIR, "state.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const execFileAsync = promisify(execFile);
const ffmpegExecutable = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";
const ffprobeExecutable = process.env.FFPROBE_PATH || ffprobeStatic?.path || "ffprobe";
const DEMO_MEDIA_SOURCE_ID = "media_demo_clipping_source";
const DEMO_PROJECT_ID = "project_clipping_office_main";
const DEMO_STREAMER_ID = "streamer_demo_media_source";
const DEMO_MEDIA_FILE = path.join(PUBLIC_DIR, "demo", "demo-source.mp4");
const DEMO_FRAME_DIR = path.join(PUBLIC_DIR, "demo");
const DEFAULT_CLIP_SAVE_DIR = path.join(__dirname, "Clips");

const PROVENANCE = {
  VERIFIED_API: "VERIFIED_API",
  AUTHORIZED_UPLOAD: "AUTHORIZED_UPLOAD",
  VERIFIED_MEDIA: "VERIFIED_MEDIA",
  WATCHER_BUFFER: "WATCHER_BUFFER",
  TWITCH_CLIP: "TWITCH_CLIP",
  TWITCH_VOD: "TWITCH_VOD",
  AUTHORIZED_REMOTE: "AUTHORIZED_REMOTE",
  LIVE_SOURCE: "LIVE_SOURCE",
  VOD_SOURCE: "VOD_SOURCE",
  DEMO_SOURCE: "DEMO_SOURCE",
  AI_GENERATED: "AI_GENERATED",
  USER_ENTERED: "USER_ENTERED",
  UNAVAILABLE: "UNAVAILABLE"
};

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function splitCsvList(value, fallback = []) {
  const list = String(value || "")
    .split(",")
    .map((item) => cleanText(item).toLowerCase())
    .map((item) => item.replace(/\s{2,}/g, " ").trim())
    .filter(Boolean);
  return list.length ? list : fallback.slice();
}

const config = {
  port: Number(process.env.PORT || 4177),
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
  braveApiKey: process.env.BRAVE_API_KEY || "",
  serpApiKey: process.env.SERP_API_KEY || "",
  dalleApiKey: process.env.DALLE_API_KEY || "",
  resendApiKey: process.env.RESEND_API_KEY || "",
  sendgridApiKey: process.env.SENDGRID_API_KEY || "",
  aiProvider: process.env.AI_PROVIDER || "openai",
  aiMode: process.env.AI_MODE || "live",
  twitchClientId: process.env.TWITCH_CLIENT_ID || "",
  twitchClientSecret: process.env.TWITCH_CLIENT_SECRET || "",
  twitchRedirectUri: process.env.TWITCH_REDIRECT_URI || "",
  twitchOAuthToken: process.env.TWITCH_OAUTH_TOKEN || "",
  twitchAppAccessToken: process.env.TWITCH_APP_ACCESS_TOKEN || "",
  twitchUserAccessToken: process.env.TWITCH_USER_ACCESS_TOKEN || "",
  twitchRefreshToken: process.env.TWITCH_REFRESH_TOKEN || "",
  twitchEventSubSecret: process.env.TWITCH_EVENTSUB_SECRET || "",
  twitchEventSubCallbackUrl: process.env.TWITCH_EVENTSUB_CALLBACK_URL || "",
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
  uploadDir: path.resolve(RUNTIME_DIR, process.env.CLIPPER_UPLOAD_DIR || "./uploads"),
  outputDir: path.resolve(RUNTIME_DIR, process.env.CLIPPER_OUTPUT_DIR || "./outputs"),
  agent101OutputDir: path.resolve(RUNTIME_DIR, process.env.AGENT101_OUTPUT_DIR || "./outputs"),
  watchBufferDir: process.env.CLIPPER_WATCH_BUFFER_DIR
    ? path.resolve(RUNTIME_DIR, process.env.CLIPPER_WATCH_BUFFER_DIR)
    : DEFAULT_CLIP_SAVE_DIR,
  captureEnabled: process.env.STREAMCLIPPER_CAPTURE_ENABLED !== "false",
  captureToolPreference: cleanText(process.env.STREAMCLIPPER_CAPTURE_TOOL || "auto").toLowerCase(),
  streamlinkExecutable: process.env.STREAMLINK_PATH || "streamlink",
  ytdlpExecutable: process.env.YTDLP_PATH || "yt-dlp",
  browserEnabled: process.env.BROWSER_ENABLED !== "false",
  browserHeadless: process.env.BROWSER_HEADLESS !== "false",
  browserAllowLocalhost: process.env.BROWSER_ALLOW_LOCALHOST !== "false",
  browserProfileDir: path.resolve(RUNTIME_DIR, process.env.BROWSER_PROFILE_DIR || "./browser-profile"),
  browserDownloadsDir: path.resolve(RUNTIME_DIR, process.env.BROWSER_DOWNLOAD_DIR || "./browser-downloads"),
  browserViewport: {
    width: Number(process.env.BROWSER_VIEWPORT_WIDTH || 1440),
    height: Number(process.env.BROWSER_VIEWPORT_HEIGHT || 900)
  },
  browserNavigationTimeoutMs: Number(process.env.BROWSER_NAVIGATION_TIMEOUT_MS || 30000),
  capcutHandoffUrl: process.env.CAPCUT_HANDOFF_URL || "https://www.capcut.com/editor",
  capcutDownloadDir: path.resolve(RUNTIME_DIR, process.env.CAPCUT_DOWNLOAD_DIR || "./capcut-downloads"),
  capcutAppPath: process.env.CAPCUT_APP_PATH || "",
  capcutScreenshotDir: path.resolve(RUNTIME_DIR, process.env.CAPCUT_SCREENSHOT_DIR || "./capcut-screenshots"),
  capcutMacroDir: path.resolve(RUNTIME_DIR, process.env.CAPCUT_MACRO_DIR || "./capcut-macros"),
  capcutProjectDir: path.resolve(RUNTIME_DIR, process.env.CAPCUT_PROJECT_DIR || "./capcut-projects"),
  capcutRunReportDir: path.resolve(RUNTIME_DIR, process.env.CAPCUT_RUN_REPORT_DIR || "./capcut-runs"),
  capcutDefaultStickerPath: process.env.CAPCUT_DEFAULT_STICKER_PATH || "",
  capcutBrandSticker: process.env.CAPCUT_BRAND_STICKER || "Essentrx",
  capcutAgentDryRun: process.env.CAPCUT_AGENT_DRY_RUN === "true",
  whisperModel: process.env.WHISPER_MODEL || "base",
  postDailyLimit: Number(process.env.POST_DAILY_LIMIT || 20),
  maxWatchedStreamers: boundedNumber(process.env.STREAMCLIPPER_MAX_WATCHED_STREAMERS, 1, 1, 10),
  singleWatchMode: process.env.STREAMCLIPPER_SINGLE_WATCH_MODE === "true" || process.env.STREAMCLIPPER_MAX_WATCHED_STREAMERS === "1" || process.env.STREAMCLIPPER_MAX_WATCHED_STREAMERS === undefined,
  watchTriggerRequiresSignal: process.env.STREAMCLIPPER_REQUIRE_WATCH_TRIGGER !== "false",
  watchTriggerKeywords: splitCsvList(process.env.STREAMCLIPPER_CHAT_TRIGGER_KEYWORDS, [
    "holy shit",
    "holy",
    "pog",
    "poggers",
    "omg",
    "unreal",
    "insane",
    "clutch",
    "nice one",
    "holy hell",
    "what",
    "crazy",
    "clip this",
    "send it"
  ]),
  chatWindowMs: boundedNumber(process.env.STREAMCLIPPER_CHAT_WINDOW_MS, 10000, 1000, 60000),
  chatSpikeThreshold: boundedNumber(process.env.STREAMCLIPPER_CHAT_SPIKE_THRESHOLD, 30, 2, 500),
  chatSpikeCooldownMs: boundedNumber(process.env.STREAMCLIPPER_CHAT_SPIKE_COOLDOWN_MS, 20000, 1000, 120000),
  watchCandidateMaxPerTick: boundedNumber(process.env.STREAMCLIPPER_WATCH_CANDIDATE_MAX_PER_TICK, 1, 1, 10),
  watchCandidateCooldownMs: boundedNumber(process.env.STREAMCLIPPER_WATCH_CANDIDATE_COOLDOWN_MS, 5000, 0, 120000),
  watchCandidateMaxActivePerSession: boundedNumber(process.env.STREAMCLIPPER_WATCH_CANDIDATE_SESSION_CAP, 1, 1, 200),
  watchCandidateUnresolvedCap: boundedNumber(process.env.STREAMCLIPPER_WATCH_CANDIDATE_UNRESOLVED_CAP, 1, 1, 100),
  autoCaptureBaselineSeconds: boundedNumber(process.env.STREAMCLIPPER_BASELINE_CAPTURE_SECONDS, 120, 30, 1800),
  twitchClipMinScore: boundedNumber(process.env.STREAMCLIPPER_TWITCH_CLIP_MIN_SCORE, 75, 1, 100),
  openaiTestBudgetUsd: Number(process.env.OPENAI_TEST_BUDGET_USD || 10),
  enableSyntheticTestFixtures: process.env.ENABLE_SYNTHETIC_TEST_FIXTURES === "true",
  maxUploadBytes: Number(process.env.CLIPPER_MAX_UPLOAD_BYTES || 1024 * 1024 * 500)
};
const THUMBNAIL_DIR = path.join(config.outputDir, "thumbnails");

const stateDefaults = {
  streamers: [],
  streamSessions: [],
  watchSessions: [],
  watchEvents: [],
  sourceCapabilities: [],
  clipMissions: [],
  streamerClipProfiles: [],
  feedbackEvents: [],
  mediaSegments: [],
  captureJobs: [],
  clipCandidates: [],
  clipPackages: [],
  postingDrafts: [],
  approvalRequests: [],
  artifacts: [],
  mediaSources: [],
  mediaProjects: [],
  mediaJobs: [],
  clipProjectVersions: [],
  editDecisionLists: [],
  captionTracks: [],
  overlayTracks: [],
  discoveredStreamers: [],
  executionContracts: [],
  agentRuns: [],
  capcutAgentSessions: [],
  handoffPackages: [],
  smokeTests: [],
  twitchValidation: null,
  integrationChecks: {},
  logs: [],
  browser: {
    profile: null,
    sessions: [],
    actions: [],
    downloads: [],
    policies: []
  },
  capcutControl: {
    actions: [],
    screenshots: [],
    teach: null,
    replay: null,
    workflows: {},
    lastStatus: null,
    lastAction: null
  }
};

let state = structuredClone(stateDefaults);
let twitchAppToken = null;
let kickAppToken = null;
let browserWorkspaceInstance = null;
let capcutControllerInstance = null;
let saveStateQueue = Promise.resolve();
let saveStateWriteCounter = 0;
const watchWorkerTimers = new Map();
const watchWorkerBusy = new Set();
const watchEventClients = new Map();
const chatMonitors = new Map();
const chatSpikeLog = new Map();
const chatKeywordLog = new Map();
const agent101StreamClients = new Map();
const capcutAgentStreamClients = new Map();
const WATCH_WORKER_ID = `local-worker-${process.pid}`;
const WATCH_TICK_MS = Number(process.env.WATCH_TICK_MS || 7000);
const WATCH_LEASE_MS = Number(process.env.WATCH_LEASE_MS || 45000);
const WATCH_HEARTBEAT_STALE_MS = Number(process.env.WATCH_HEARTBEAT_STALE_MS || 90000);
const WATCH_RECORDING_WINDOW_SECONDS = boundedNumber(process.env.STREAMCLIPPER_RECORDING_WINDOW_SECONDS, 30, 5, 300);
const WATCH_MAX_RECORDING_WINDOWS = boundedNumber(process.env.STREAMCLIPPER_MAX_RECORDING_WINDOWS, 240, 1, 2000);
const ACTIVE_WATCH_STATUSES = new Set(["queued", "starting", "connecting", "watching", "degraded", "reconnecting"]);
const TERMINAL_WATCH_STATUSES = new Set(["stream_ended", "completed", "failed", "cancelled"]);
const DEFAULT_CLIP_PROFILE = {
  genre: "general",
  chatSpikeThreshold: 30,
  audioThresholdDb: -8,
  tensionSpikeThreshold: 8,
  emoteWeights: {},
  goldenHours: [],
  minClipScore: 80,
  clipHistory: {
    totalCreated: 0,
    avgScoreAccepted: 0,
    lastClipAt: null
  }
};
const EVENTSUB_EVENT_TYPES = [
  "channel.raid",
  "channel.subscription.gift",
  "channel.cheer",
  "channel.prediction.end",
  "channel.poll.end"
];

function now() {
  return new Date().toISOString();
}

function isRecentTimestamp(value, windowMs) {
  const timestamp = typeof value === "number" ? value : Date.parse(value || "");
  return Number.isFinite(timestamp) && Date.now() - timestamp < windowMs;
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

function slugify(value, fallback = "project") {
  const slug = cleanText(value)
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || fallback;
}

function twitchApiConfigured() {
  return Boolean(config.twitchClientId && (config.twitchClientSecret || config.twitchOAuthToken || config.twitchAppAccessToken || config.twitchUserAccessToken));
}

function kickApiConfigured() {
  return Boolean(config.kickOAuthToken || (config.kickClientId && config.kickClientSecret));
}

function liveProviderConfigured(platform) {
  if (platform === "twitch") return twitchApiConfigured();
  if (platform === "kick") return kickApiConfigured();
  return false;
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

function detectClipGenre(value = "") {
  const text = cleanText(value).toLowerCase();
  if (/warzone|valorant|counter-strike|\bcs\b|apex|fortnite|\br6\b|rainbow six|call of duty|cod\b/.test(text)) return "fps";
  if (/league|dota|smite|arena/.test(text)) return "moba";
  if (/\birl\b|just chatting/.test(text)) return "irl";
  if (/podcast|talk show|interview/.test(text)) return "podcast";
  if (/variety/.test(text)) return "variety";
  return "general";
}

function normalizeClipProfile(input = {}, streamer = {}) {
  const existing = input && typeof input === "object" ? input : {};
  const history = existing.clipHistory && typeof existing.clipHistory === "object" ? existing.clipHistory : {};
  const parsedAudioThreshold = Number(existing.audioThresholdDb ?? DEFAULT_CLIP_PROFILE.audioThresholdDb);
  const detectedGenre = detectClipGenre(
    streamer.currentGame || streamer.liveCategory || streamer.category || streamer.liveTitle || streamer.displayName || ""
  );
  const emoteWeights = existing.emoteWeights && typeof existing.emoteWeights === "object" && !Array.isArray(existing.emoteWeights)
    ? Object.fromEntries(Object.entries(existing.emoteWeights).map(([key, value]) => [cleanText(key), Number(value)]).filter(([key, value]) => key && Number.isFinite(value)))
    : {};
  const goldenHours = Array.isArray(existing.goldenHours)
    ? existing.goldenHours.map((hour) => Number(hour)).filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23)
    : [];
  return {
    ...DEFAULT_CLIP_PROFILE,
    ...existing,
    genre: normalizeStatus(existing.genre || detectedGenre, ["fps", "moba", "variety", "irl", "podcast", "general"], detectedGenre),
    chatSpikeThreshold: boundedNumber(existing.chatSpikeThreshold, DEFAULT_CLIP_PROFILE.chatSpikeThreshold, 2, 500),
    audioThresholdDb: Number.isFinite(parsedAudioThreshold) ? Math.max(-60, Math.min(0, parsedAudioThreshold)) : DEFAULT_CLIP_PROFILE.audioThresholdDb,
    tensionSpikeThreshold: boundedNumber(existing.tensionSpikeThreshold, DEFAULT_CLIP_PROFILE.tensionSpikeThreshold, 1, 100),
    emoteWeights,
    goldenHours,
    minClipScore: boundedNumber(existing.minClipScore, DEFAULT_CLIP_PROFILE.minClipScore, 1, 100),
    clipHistory: {
      totalCreated: Math.max(0, Number(history.totalCreated || 0)),
      avgScoreAccepted: Math.max(0, Math.min(100, Number(history.avgScoreAccepted || 0))),
      lastClipAt: history.lastClipAt || null
    }
  };
}

function ensureStreamerDetectionProfile(streamer = {}, updates = {}) {
  if (!streamer || typeof streamer !== "object") return structuredClone(DEFAULT_CLIP_PROFILE);
  streamer.clipProfile = normalizeClipProfile({ ...(streamer.clipProfile || {}), ...(updates || {}) }, streamer);
  return streamer.clipProfile;
}

function applyAudioThresholdForStreamer(audioEnergy = {}, streamer = {}) {
  const profile = ensureStreamerDetectionProfile(streamer);
  const threshold = Number(profile.audioThresholdDb ?? DEFAULT_CLIP_PROFILE.audioThresholdDb);
  const maxVolumeDb = Number(audioEnergy?.maxVolumeDb);
  return {
    ...(audioEnergy || {}),
    isLoudMoment: Number.isFinite(maxVolumeDb) && maxVolumeDb >= threshold,
    loudThresholdDb: threshold
  };
}

function normalizeAllowedUse(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => cleanText(item).toLowerCase()).filter(Boolean))];
  }
  if (!value || typeof value !== "object") return [];
  return [...new Set(Object.entries(value)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([use]) => cleanText(use).toLowerCase())
    .filter(Boolean))];
}

function normalizeApprovedStreamerAllowedUse() {
  let repaired = false;
  for (const streamer of state.streamers || []) {
    if (!streamer || streamer.isDemo) continue;
    const normalized = normalizeAllowedUse(streamer.allowedUse);
    if (streamer.permissionStatus === "approved" && !normalized.length) {
      streamer.allowedUse = ["clips"];
      repaired = true;
      continue;
    }
    if (!Array.isArray(streamer.allowedUse)) {
      streamer.allowedUse = normalized;
      repaired = true;
    }
  }
  return repaired;
}

function normalizeLoadedState() {
  state.streamers ||= [];
  state.streamSessions ||= [];
  state.watchSessions ||= [];
  state.watchEvents ||= [];
  state.sourceCapabilities ||= [];
  state.clipMissions ||= [];
  state.streamerClipProfiles ||= [];
  state.feedbackEvents ||= [];
  state.mediaSegments ||= [];
  state.captureJobs ||= [];
  state.clipCandidates ||= [];
  state.clipPackages ||= [];
  state.postingDrafts ||= [];
  state.approvalRequests ||= [];
  state.artifacts ||= [];
  state.mediaSources ||= [];
  state.mediaProjects ||= [];
  state.mediaJobs ||= [];
  state.clipProjectVersions ||= [];
  state.editDecisionLists ||= [];
  state.captionTracks ||= [];
  state.overlayTracks ||= [];
  state.discoveredStreamers ||= [];
  state.executionContracts ||= [];
  state.agentRuns ||= [];
  state.capcutAgentSessions ||= [];
  state.handoffPackages ||= [];
  state.smokeTests ||= [];
  state.integrationChecks ||= {};
  state.logs ||= [];
  state.browser ||= structuredClone(stateDefaults.browser);
  state.browser.sessions ||= [];
  state.browser.actions ||= [];
  state.browser.downloads ||= [];
  state.browser.policies ||= [];
  state.capcutControl ||= structuredClone(stateDefaults.capcutControl);
  state.capcutControl.actions ||= [];
  state.capcutControl.screenshots ||= [];
  state.capcutControl.teach ||= null;
  state.capcutControl.replay ||= null;
  state.capcutControl.workflows ||= {};
  if (state.capcutControl.teach?.recording) {
    state.capcutControl.teach.recording = false;
    state.capcutControl.teach.status = "stopped";
    state.capcutControl.teach.stopReason ||= "runtime_restarted";
    state.capcutControl.teach.stoppedAt ||= now();
  }
  if (state.capcutControl.replay?.running) {
    state.capcutControl.replay.running = false;
    state.capcutControl.replay.status = "stopped";
    state.capcutControl.replay.stopReason ||= "runtime_restarted";
    state.capcutControl.replay.finishedAt ||= now();
  }
  for (const streamer of state.streamers || []) {
    ensureStreamerDetectionProfile(streamer);
  }
  if (normalizeApprovedStreamerAllowedUse()) {
    addStateLog("streamer_allowed_use_repaired", "Upgraded legacy approved streamer allowedUse fields.");
  }
}

function isStateJsonParseError(error) {
  return error instanceof SyntaxError || /json|unterminated|unexpected/i.test(error?.message || "");
}

function corruptStateBackupPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${DATA_FILE}.corrupt-${stamp}.bak`;
}

function repairTruncatedStateJson(raw) {
  if (!raw) return null;
  const markers = ['\n  "logs": [', '\n  "browser": {'];
  for (const marker of markers) {
    const index = raw.lastIndexOf(marker);
    if (index < 0) continue;
    const prefix = raw.slice(0, index).replace(/[\s,]*$/, "");
    if (!prefix.startsWith("{")) continue;
    const repaired = `${prefix},\n  "logs": [],\n  "browser": ${JSON.stringify(stateDefaults.browser, null, 2).replace(/\n/g, "\n  ")}\n}\n`;
    try {
      JSON.parse(repaired);
      return repaired;
    } catch {
      // Try the next safe boundary.
    }
  }
  return null;
}

async function ensureStorage() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.mkdir(config.uploadDir, { recursive: true });
  await fs.mkdir(config.outputDir, { recursive: true });
  await fs.mkdir(config.agent101OutputDir, { recursive: true });
  await fs.mkdir(config.watchBufferDir, { recursive: true });
  await fs.mkdir(THUMBNAIL_DIR, { recursive: true });
  await fs.mkdir(config.browserProfileDir, { recursive: true });
  await fs.mkdir(config.browserDownloadsDir, { recursive: true });
  await fs.mkdir(config.capcutDownloadDir, { recursive: true });
  await fs.mkdir(config.capcutProjectDir, { recursive: true });
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    state = { ...structuredClone(stateDefaults), ...JSON.parse(raw) };
    normalizeLoadedState();
    repairUnsafeStreamerMonitoring();
    migrateMetadataOnlyRecordingWindowsOutOfRadar("startup_migration");
    await enforceSingleWatchAtBoot();
    await saveState();
  } catch (error) {
    if (error.code === "ENOENT") {
      await saveState();
      return;
    }
    if (!isStateJsonParseError(error)) throw error;

    const raw = await fs.readFile(DATA_FILE, "utf8").catch(() => "");
    const backupPath = corruptStateBackupPath();
    if (raw) await fs.writeFile(backupPath, raw, "utf8").catch(() => {});
    const repaired = repairTruncatedStateJson(raw);
    if (repaired) {
      state = { ...structuredClone(stateDefaults), ...JSON.parse(repaired) };
      normalizeLoadedState();
      addStateLog("state_json_recovered", "Recovered Clipping Office state after truncated JSON", {
        backupPath,
        originalBytes: Buffer.byteLength(raw, "utf8"),
        recoveredBytes: Buffer.byteLength(repaired, "utf8")
      });
    } else {
      state = structuredClone(stateDefaults);
      normalizeLoadedState();
      addStateLog("state_json_reset", "Reset Clipping Office state after unreadable JSON", {
        backupPath,
        error: error.message
      });
    }
    repairUnsafeStreamerMonitoring();
    migrateMetadataOnlyRecordingWindowsOutOfRadar("startup_recovery_migration");
    await enforceSingleWatchAtBoot();
    await saveState();
  }
}

function repairUnsafeStreamerMonitoring() {
  let repaired = false;
  for (const streamer of state.streamers || []) {
    if (!["twitch", "kick"].includes(streamer.platform) || liveProviderConfigured(streamer.platform)) continue;
    if (!streamer.monitorEnabled) continue;
    const unverifiedStatus = ["api_not_configured", "unknown", "api_error", "unverified", ""].includes(streamer.liveStatus || "");
    if (!unverifiedStatus && streamer.lastCheckedAt) continue;
    streamer.monitorEnabled = false;
    streamer.monitorPausedAt = now();
    streamer.liveStatus = "api_not_configured";
    streamer.liveStatusReason = `${streamer.platform === "kick" ? "Kick" : "Twitch"} API is not configured. Monitoring was paused until an official live check can run.`;
    streamer.updatedAt = now();
    repaired = true;
  }
  if (repaired) {
    addStateLog("streamer_monitor_repaired", "Paused unverified stream monitors that could not be checked by provider API", {
      twitchConfigured: twitchApiConfigured(),
      kickConfigured: kickApiConfigured()
    });
  }
  return repaired;
}

function playableSourceForCandidate(candidate) {
  const source = findExistingMediaSource(candidate?.sourceId);
  if (!source?.filePath) return null;
  const normalized = normalizeMediaSourceRecord(source);
  return normalized.playable ? source : null;
}

function candidateHasPlayableSource(candidate) {
  return Boolean(playableSourceForCandidate(candidate) || (candidate?.mediaPlayable && candidate?.sourceId));
}

function upsertRecordingWindowTelemetry(session, window = {}) {
  if (!session) return null;
  const index = Number(window.index ?? window.recordingWindowIndex);
  if (!Number.isFinite(index)) return null;
  const startSeconds = Number(window.startSeconds ?? index * WATCH_RECORDING_WINDOW_SECONDS);
  const endSeconds = Number(window.endSeconds ?? startSeconds + WATCH_RECORDING_WINDOW_SECONDS);
  const existing = (session.recordingWindows || []).find((item) => Number(item.index) === index);
  const next = {
    id: existing?.id || newId("watch_window"),
    index,
    startSeconds,
    endSeconds,
    durationSeconds: Number(window.durationSeconds || WATCH_RECORDING_WINDOW_SECONDS),
    status: cleanText(window.status) || "awaiting_source",
    sourceId: cleanText(window.sourceId || existing?.sourceId),
    candidateId: cleanText(window.candidateId || existing?.candidateId),
    message: cleanText(window.message || existing?.message) || "Waiting for a local recorded source before Radar review.",
    updatedAt: now(),
    createdAt: existing?.createdAt || now()
  };
  const windows = (session.recordingWindows || []).filter((item) => Number(item.index) !== index);
  windows.push(next);
  session.recordingWindows = windows
    .sort((a, b) => Number(b.index) - Number(a.index))
    .slice(0, WATCH_MAX_RECORDING_WINDOWS);
  return next;
}

function migrateMetadataOnlyRecordingWindowsOutOfRadar(reason = "radar_truth_repair") {
  const before = state.clipCandidates.length;
  const candidatesBefore = Array.isArray(state.clipCandidates) ? [...state.clipCandidates] : [];
  const keepLiveBySession = new Map();

  if (shouldTreatAsSingleWatch()) {
    const activeWatchSessionIds = new Set(
      state.watchSessions
        .filter((session) => isWatchSessionActive(session) || session.status === "paused")
        .map((session) => session.id),
    );
    for (const candidate of candidatesBefore) {
      if (candidate?.sourceType !== "live_recording_window" || !candidate?.watchSessionId) continue;
      if (!activeWatchSessionIds.has(candidate.watchSessionId)) continue;
      if (candidateHasPlayableSource(candidate)) continue;
      const existing = keepLiveBySession.get(candidate.watchSessionId);
      if (!existing) {
        keepLiveBySession.set(candidate.watchSessionId, candidate);
        continue;
      }
      const existingWindow = Number(existing.recordingWindowIndex);
      const candidateWindow = Number(candidate.recordingWindowIndex);
      if (Number.isFinite(existingWindow) && Number.isFinite(candidateWindow)) {
        if (candidateWindow > existingWindow) keepLiveBySession.set(candidate.watchSessionId, candidate);
        continue;
      }
      if (Date.parse(candidate.updatedAt || candidate.createdAt || 0) > Date.parse(existing.updatedAt || existing.createdAt || 0)) {
        keepLiveBySession.set(candidate.watchSessionId, candidate);
      }
    }
  }

  const migrated = [];
  state.clipCandidates = state.clipCandidates.filter((candidate) => {
    const metadataOnlyWindow = candidate?.sourceType === "live_recording_window" && !candidateHasPlayableSource(candidate);
    if (!metadataOnlyWindow) return true;
    if (shouldTreatAsSingleWatch()) {
      const keepCandidate = keepLiveBySession.get(candidate?.watchSessionId);
      if (keepCandidate?.id === candidate?.id) return true;
    }
    const session = state.watchSessions.find((item) => item.id === candidate.watchSessionId);
    if (session) {
      upsertRecordingWindowTelemetry(session, {
        index: candidate.recordingWindowIndex,
        startSeconds: candidate.startSeconds,
        endSeconds: candidate.endSeconds,
        durationSeconds: candidate.durationSeconds || candidate.duration,
        status: "awaiting_source",
        message: "Removed from Clip Radar because no saved playable clip file exists yet."
      });
      rememberDeletedRecordingWindow(session, candidate, reason);
      session.candidatesDetected = Math.max(0, Number(session.candidatesDetected || 0) - 1);
      session.candidatesReview = Math.max(0, Number(session.candidatesReview || 0) - 1);
      session.updatedAt = now();
    }
    migrated.push(candidate.id);
    return false;
  });
  if (migrated.length) {
    addStateLog("metadata_windows_migrated", "Metadata-only watch windows were removed from Clip Radar", {
      reason,
      migrated: migrated.length,
      before,
      after: state.clipCandidates.length
    });
  }
  return migrated.length;
}

async function writeStateSnapshot() {
  const tmp = `${DATA_FILE}.tmp.${process.pid}.${Date.now()}.${saveStateWriteCounter += 1}`;
  try {
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await fs.rename(tmp, DATA_FILE);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

function saveState() {
  const write = saveStateQueue.then(writeStateSnapshot, writeStateSnapshot);
  saveStateQueue = write.catch(() => {});
  return write;
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

function capCutController() {
  if (!capcutControllerInstance) {
    capcutControllerInstance = createCapCutController({
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
  return capcutControllerInstance;
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

function writeSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function emitAgent101Stream(sessionId, event, payload = {}) {
  const clients = agent101StreamClients.get(sessionId);
  if (!clients?.size) return;
  for (const res of clients) {
    writeSse(res, event, { sessionId, ...payload });
  }
}

function emitCapcutAgentStream(sessionId, event, payload = {}) {
  const clients = capcutAgentStreamClients.get(sessionId);
  if (!clients?.size) return;
  for (const res of clients) {
    writeSse(res, event, { sessionId, ...payload });
  }
}

function subscribeCapcutAgentStream(sessionId, res) {
  const session = state.capcutAgentSessions.find((item) => item.sessionId === sessionId || item.id === sessionId);
  if (!session) return sendError(res, 404, "CapCut Agent session not found.");
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    connection: "keep-alive"
  });
  const set = capcutAgentStreamClients.get(session.sessionId) || new Set();
  set.add(res);
  capcutAgentStreamClients.set(session.sessionId, set);
  writeSse(res, "connected", { sessionId: session.sessionId, session: publicCapcutAgentSession(session) });
  for (const event of (session.events || []).slice(-20)) writeSse(res, "capcut_agent_step", event);
  const timer = setInterval(() => writeSse(res, "ping", { t: Date.now() }), 15000);
  res.on("close", () => {
    clearInterval(timer);
    set.delete(res);
    if (!set.size) capcutAgentStreamClients.delete(session.sessionId);
  });
}

function subscribeAgent101Stream(sessionId, res) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });
  writeSse(res, "connected", { sessionId, connectedAt: now() });
  const clients = agent101StreamClients.get(sessionId) || new Set();
  clients.add(res);
  agent101StreamClients.set(sessionId, clients);
  res.on("close", () => {
    clients.delete(res);
    if (!clients.size) agent101StreamClients.delete(sessionId);
  });
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

function isWatchSessionActive(session) {
  return Boolean(session && ACTIVE_WATCH_STATUSES.has(session.status));
}

function watchSessionHealth(session) {
  if (!session) return "missing";
  if (TERMINAL_WATCH_STATUSES.has(session.status)) return session.status;
  if (session.status === "paused") return "paused";
  const leaseExpired = session.leaseExpiresAt && new Date(session.leaseExpiresAt).getTime() < Date.now();
  const heartbeatStale = session.heartbeatAt && Date.now() - new Date(session.heartbeatAt).getTime() > WATCH_HEARTBEAT_STALE_MS;
  if (!session.workerId || leaseExpired || heartbeatStale) return "disconnected";
  if (session.status === "degraded") return "metadata_only";
  return "backend_worker_active";
}

const JOURNEY_TRIGGER_LABELS = {
  chat_spike: "Chat spike",
  chat_keyword: "Chat keyword",
  tension_emote_prediction: "Tension emotes (predictive)",
  chat_dead_sampling: "Fixed-cadence sample (chat silent)",
  manual_capture: "Manual capture",
  watch_capture: "Watch capture"
};

/**
 * Per-clip pipeline trace: every stage a clip goes through, computed from the
 * fields the pipeline already writes, so the operator can follow the IO of
 * each clip end to end in the UI. Read-only; missing data shows as pending
 * instead of guessing.
 */
function candidateJourney(candidate = {}) {
  const source = state.mediaSources.find((item) => item.id === candidate.sourceId) || null;
  const captureJob = state.captureJobs.find((job) => job.sourceId === candidate.sourceId) || null;
  const steps = [];
  const trigger = cleanText(source?.watchWindowTrigger || candidate.watchWindowTrigger);
  steps.push({
    id: "trigger",
    label: "Trigger",
    status: trigger ? "done" : "pending",
    detail: trigger
      ? `${JOURNEY_TRIGGER_LABELS[trigger] || trigger}${source?.watchWindowKeywordSignals?.length ? ` · ${source.watchWindowKeywordSignals.join(", ")}` : ""}`
      : "Waiting for a chat/tension signal or sampling window",
    at: source?.watchWindowTriggerAt || candidate.createdAt || ""
  });
  const captured = Boolean(source?.filePath);
  steps.push({
    id: "capture",
    label: "Capture",
    status: captured ? "done" : (captureJob?.status === "failed" ? "failed" : "pending"),
    detail: captured
      ? `${captureJob?.tool || "recorder"} → ${path.basename(String(source.filePath || ""))} (${Math.round(Number(source.durationSeconds || 0))}s)`
      : captureJob?.error || "No local MP4 saved yet",
    at: source?.createdAt || captureJob?.updatedAt || ""
  });
  steps.push({
    id: "verify",
    label: "Verify MP4",
    status: source?.sha256 ? "done" : (captured ? "pending" : "skipped"),
    detail: source?.sha256 ? `checksum ${String(source.sha256).slice(0, 12)}… · ${Math.round(Number(source.durationSeconds || 0))}s playable` : "Runs right after capture",
    at: source?.createdAt || ""
  });
  const audio = source?.audioEnergy || null;
  steps.push({
    id: "audio",
    label: "Audio energy",
    status: audio?.available ? "done" : (captured ? "pending" : "skipped"),
    detail: audio?.available
      ? `peak ${audio.maxVolumeDb ?? "?"} dB${audio.isLoudMoment ? " · loud moment" : ""}${audio.isVoiceExcited ? " · voice excitement" : ""}`
      : "FFmpeg loudness scan of the saved window",
    at: source?.createdAt || ""
  });
  steps.push({
    id: "transcript",
    label: "Transcript",
    status: Number(source?.transcriptScore || 0) > 0
      ? "done"
      : source?.transcriptError
        ? "failed"
        : (captured ? "pending" : "skipped"),
    detail: Number(source?.transcriptScore || 0) > 0
      ? `Whisper score ${Math.round(Number(source.transcriptScore))}/100`
      : source?.transcriptError || "Whisper transcription + hype scoring",
    at: source?.transcribedAt || ""
  });
  const scored = Number(candidate.score || 0) > 0 || cleanText(candidate.decision);
  steps.push({
    id: "score",
    label: "Radar decision",
    status: scored ? (candidate.decision === "rejected" ? "failed" : "done") : "pending",
    detail: scored
      ? `${Number(candidate.score || 0)}% · ${candidate.decision || "review"}${candidate.decisionReason ? ` — ${cleanText(candidate.decisionReason).slice(0, 140)}` : ""}`
      : "Combined chat/audio/transcript scoring",
    at: candidate.updatedAt || ""
  });
  const declined = Boolean(candidate.operatorDeclined || candidate.declinedAt);
  steps.push({
    id: "operator",
    label: "Your call",
    status: candidate.builderApproved ? "done" : declined ? "failed" : "pending",
    detail: candidate.builderApproved
      ? "Approved for the 9:16 Builder queue"
      : declined
        ? "Declined"
        : "Waiting for Approve/Decline in the Clips panel",
    at: candidate.builderApprovedAt || candidate.declinedAt || ""
  });
  steps.push({
    id: "capcut",
    label: "CapCut edit",
    status: candidate.builderApproved ? "pending" : "skipped",
    detail: candidate.builderApproved
      ? "Ready for the taught 9:16 → blur → reframe → sticker workflow (Determinism Monitor shows it live)"
      : "Unlocks after approval",
    at: ""
  });
  return steps;
}

function filterClipCandidatesForRadar(candidates = [], { projectId, sourceId } = {}) {
  const activeWatchSessionIds = new Set(state.watchSessions.filter((session) => ACTIVE_WATCH_STATUSES.has(session.status)).map((session) => session.id));
  const filtered = candidates.filter((candidate) => {
    if (projectId && candidate?.projectId !== projectId) return false;
    if (sourceId && candidate?.sourceId !== sourceId) return false;
    if (candidate?.sourceType !== "live_recording_window") return true;
    return activeWatchSessionIds.has(candidate?.watchSessionId);
  });

  if (!shouldTreatAsSingleWatch()) {
    return filtered;
  }

  const latestLiveBySession = new Map();
  for (const candidate of filtered) {
    if (candidate?.sourceType !== "live_recording_window" || !candidate?.watchSessionId) continue;
    const existing = latestLiveBySession.get(candidate.watchSessionId);
    if (!existing) {
      latestLiveBySession.set(candidate.watchSessionId, candidate);
      continue;
    }
    const existingWindow = Number(existing.recordingWindowIndex);
    const candidateWindow = Number(candidate.recordingWindowIndex);
    const isSameWindow = Number.isFinite(existingWindow) && Number.isFinite(candidateWindow)
      ? candidateWindow > existingWindow
      : false;
    const isNewerSource = candidate.updatedAt && existing.updatedAt
      ? Date.parse(candidate.updatedAt) > Date.parse(existing.updatedAt)
      : Date.parse(candidate.createdAt || 0) > Date.parse(existing.createdAt || 0);
    if (isSameWindow || (!Number.isFinite(existingWindow) && !Number.isFinite(candidateWindow) && isNewerSource)) {
      latestLiveBySession.set(candidate.watchSessionId, candidate);
    }
  }

  const latestLiveIds = new Set(Array.from(latestLiveBySession.values()).map((candidate) => candidate?.id));
  return filtered.filter((candidate) => candidate?.sourceType !== "live_recording_window" || latestLiveIds.has(candidate.id));
}

function publicWatchSession(session) {
  if (!session) return null;
  const streamer = state.streamers.find((item) => item.id === session.streamerId) || null;
  const mission = state.clipMissions.find((item) => item.id === session.clipProfileId || item.id === session.missionId) || null;
  const capabilities = state.sourceCapabilities.find((item) => item.sourceId === session.sourceId && item.watchSessionId === session.id)
    || state.sourceCapabilities.find((item) => item.watchSessionId === session.id)
    || null;
  return {
    ...session,
    health: watchSessionHealth(session),
    streamerName: streamer?.displayName || session.streamerName || "Unknown streamer",
    missionName: mission?.name || session.missionName || "Default clip mission",
    recordingWindowSeconds: WATCH_RECORDING_WINDOW_SECONDS,
    capabilities
  };
}

function watchEventsFor(sessionId) {
  return state.watchEvents
    .filter((event) => event.sessionId === sessionId)
    .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
}

function sendWatchEventToClient(res, event) {
  res.write(`id: ${event.id}\n`);
  res.write("event: watch_event\n");
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function appendWatchEvent(sessionId, type, payload = {}) {
  const event = {
    id: newId("watch_event"),
    sessionId,
    sequence: watchEventsFor(sessionId).length + 1,
    type,
    payload,
    createdAt: now()
  };
  state.watchEvents.push(event);
  state.watchEvents = state.watchEvents.slice(-2500);
  const clients = watchEventClients.get(sessionId);
  if (clients) {
    for (const client of clients) {
      try {
        sendWatchEventToClient(client, event);
      } catch {
        clients.delete(client);
      }
    }
  }
  await saveState();
  return event;
}

function normalizeChatChannel(streamer = {}) {
  if (streamer.platform !== "twitch") return "";
  return normalizeTwitchLogin(streamer.channelId || streamer.displayName || streamer.channelUrl);
}

function recentChatSpikesForSession(sessionId, withinMs = WATCH_RECORDING_WINDOW_SECONDS * 1000) {
  const spikes = chatSpikeLog.get(sessionId) || [];
  const cutoff = Date.now() - withinMs;
  return spikes.filter((spike) => Number(spike.timestamp || 0) >= cutoff);
}

function rememberChatSpike(sessionId, spike) {
  const spikes = chatSpikeLog.get(sessionId) || [];
  spikes.push(spike);
  chatSpikeLog.set(sessionId, spikes.slice(-40));
}

function recentChatKeywordSignalsForSession(sessionId, withinMs = WATCH_RECORDING_WINDOW_SECONDS * 1000) {
  const signals = chatKeywordLog.get(sessionId) || [];
  const cutoff = Date.now() - withinMs;
  return signals.filter((signal) => Number(signal.timestamp || 0) >= cutoff);
}

function rememberChatKeywordSignal(sessionId, signal) {
  const signals = chatKeywordLog.get(sessionId) || [];
  signals.push(signal);
  chatKeywordLog.set(sessionId, signals.slice(-40));
}

function detectChatKeywords(message = "") {
  const text = cleanText(message).toLowerCase();
  if (!text) return [];
  const matches = [];
  for (const keyword of config.watchTriggerKeywords) {
    if (text.includes(keyword) && !matches.includes(keyword)) matches.push(keyword);
  }
  return matches;
}

function watchSignalsForWindow(sessionId, windowIndex, signals) {
  if (!sessionId) return [];
  const targetWindow = Number(windowIndex);
  if (!Number.isFinite(targetWindow)) return [];
  return (signals || []).filter((signal) => {
    const signalWindow = Number(signal.analysisWindowIndex);
    if (Number.isFinite(signalWindow)) return signalWindow === targetWindow;
    const signalTs = Number(signal.timestamp || signal.recordedAt || 0);
    return Number.isFinite(signalTs) && signalTs >= Date.now() - (WATCH_RECORDING_WINDOW_SECONDS * 1000);
  });
}

function startChatMonitorForSession(session) {
  if (!session || chatMonitors.has(session.id) || !isWatchSessionActive(session)) return;
  const streamer = state.streamers.find((item) => item.id === session.streamerId);
  const clipProfile = ensureStreamerDetectionProfile(streamer);
  const channelName = normalizeChatChannel(streamer);
  if (!channelName) return;
  const getWindowIndex = () => Math.max(0, Math.floor(Number(session.analyzedSeconds || 0) / WATCH_RECORDING_WINDOW_SECONDS));
  const monitor = new TwitchChatMonitor({
    channelName,
    windowMs: config.chatWindowMs,
    spikeThreshold: Number(clipProfile.chatSpikeThreshold || config.chatSpikeThreshold),
    spikeCooldownMs: config.chatSpikeCooldownMs,
    tensionSpikeThreshold: Number(clipProfile.tensionSpikeThreshold || DEFAULT_CLIP_PROFILE.tensionSpikeThreshold),
    onTension: (tensionPayload) => {
      const activeSession = state.watchSessions.find((item) => item.id === session.id);
      if (activeSession) {
        activeSession.tensionDetectedAt = new Date(Number(tensionPayload.timestamp || Date.now())).toISOString();
        activeSession.tensionPayload = tensionPayload;
        activeSession.updatedAt = now();
      }
      appendWatchEvent(session.id, "tension_emote_spike", {
        ...tensionPayload,
        message: "Tension emote spike detected. Agent 101 will pre-capture this window if the stream is approved."
      }).catch((error) => {
        addStateLog("chat_monitor_error", "Failed to record Twitch tension emote spike", { sessionId: session.id, error: error.message });
      });
    },
    onSpike: (spike) => {
      const payload = {
        ...spike,
        analysisWindowIndex: getWindowIndex(),
        recordedAt: now(),
        source: "twitch_irc"
      };
      rememberChatSpike(session.id, payload);
      const activeSession = state.watchSessions.find((item) => item.id === session.id);
      if (activeSession) {
        activeSession.lastChatSpikeAt = payload.recordedAt;
        activeSession.lastChatMessagesPerMinute = payload.messagesPerMinute;
        activeSession.updatedAt = now();
      }
      appendWatchEvent(session.id, "chat_spike_detected", {
        channel: payload.channel,
        messagesPerWindow: payload.messagesPerWindow,
        messagesPerMinute: payload.messagesPerMinute,
        message: "Twitch chat spike detected. The watcher will save this window if capture is available."
      }).catch((error) => {
        addStateLog("chat_monitor_error", "Failed to record Twitch chat spike", { sessionId: session.id, error: error.message });
      });
    },
    onMessage: (message) => {
      const activeSession = state.watchSessions.find((item) => item.id === session.id);
      if (!activeSession) return;
      activeSession.lastChatMessageAt = now();
      activeSession.lastChatMessagesPerMinute = message.messagesPerMinute;
      const matchedKeywords = detectChatKeywords(message.message);
      if (matchedKeywords.length) {
        const keywordPayload = {
          analysisWindowIndex: getWindowIndex(),
          channel: channelName,
          matchedKeywords,
          sampleMessage: cleanText(message.message),
          messagesPerMinute: message.messagesPerMinute,
          timestamp: message.timestamp,
          source: "twitch_irc_keyword",
          recordedAt: now()
        };
        rememberChatKeywordSignal(session.id, keywordPayload);
        activeSession.lastChatKeywordAt = keywordPayload.recordedAt;
        activeSession.lastChatKeyword = matchedKeywords;
        appendWatchEvent(session.id, "chat_keyword_detected", {
          channel: keywordPayload.channel,
          messagesPerMinute: keywordPayload.messagesPerMinute,
          matchedKeywords,
          message: `Twitch chat keyword match: ${matchedKeywords.join(", ")}`
        }).catch((error) => {
          addStateLog("chat_monitor_error", "Failed to record Twitch chat keyword match", { sessionId: session.id, error: error.message });
        });
      }
    }
  });
  chatMonitors.set(session.id, monitor);
  monitor.start();
}

function stopChatMonitorForSession(sessionId) {
  const monitor = chatMonitors.get(sessionId);
  if (monitor) monitor.stop();
  chatMonitors.delete(sessionId);
}

function activeWatchSessions() {
  return state.watchSessions.filter((session) => isWatchSessionActive(session) || session.status === "paused");
}

function detectCrossStreamEvent() {
  const cutoff = Date.now() - 90000;
  const activeSpiking = activeWatchSessions()
    .filter((session) => session.status !== "paused")
    .filter((session) => isRecentTimestamp(session.lastChatSpikeAt, 90000))
    .map((session) => {
      const streamer = findStreamer(session.streamerId);
      return {
        sessionId: session.id,
        streamerId: session.streamerId,
        channel: streamer?.displayName || session.streamerName || session.streamerId,
        lastChatSpikeAt: session.lastChatSpikeAt,
        timestamp: Date.parse(session.lastChatSpikeAt || "")
      };
    })
    .filter((item) => Number.isFinite(item.timestamp) && item.timestamp >= cutoff);
  if (activeSpiking.length < 3) {
    return { isCrossStreamEvent: false, affectedSessionIds: [], sessionCount: activeSpiking.length };
  }
  return {
    isCrossStreamEvent: true,
    affectedSessionIds: activeSpiking.map((item) => item.sessionId),
    sessionCount: activeSpiking.length,
    affectedChannels: activeSpiking.map((item) => item.channel),
    detectedAt: now()
  };
}

async function broadcastCrossStreamEvent(event) {
  if (!event?.isCrossStreamEvent) return;
  for (const sessionId of event.affectedSessionIds || []) {
    const session = state.watchSessions.find((item) => item.id === sessionId);
    if (session) {
      session.crossStreamEvent = event;
      session.updatedAt = now();
    }
    await appendWatchEvent(sessionId, "cross_stream_event", {
      sessionCount: event.sessionCount,
      affectedSessionIds: event.affectedSessionIds,
      affectedChannels: event.affectedChannels || [],
      message: "Multiple watched streamers are spiking at once. External event correlation is active."
    });
  }
}

function ensureStreamerClipProfile(streamer = {}) {
  const streamerId = cleanText(streamer.id || DEMO_STREAMER_ID);
  let profile = state.streamerClipProfiles.find((item) => item.streamerId === streamerId);
  if (!profile) {
    profile = {
      id: newId("clip_profile"),
      streamerId,
      profileName: `${streamer.displayName || "Streamer"} default profile`,
      contentStyle: streamer.isDemo ? "practice entertainment" : "operator-defined",
      knownStrengths: ["big reactions", "clean setup-to-payoff moments", "strong punchline or clutch finish"],
      preferredSignals: ["clear visual action", "strong title hook", "complete payoff", "safe context"],
      preferredMomentTypes: ["Big reaction", "Clutch play", "Unexpected event", "Chat explosion", "Viral one-liner"],
      avoidMomentTypes: ["Dead air", "AFK", "Loading screen", "Game menu", "Weak reaction", "Contextless sentence"],
      typicalContextLengthSeconds: 8,
      typicalPayoffDelaySeconds: 18,
      speakingStyle: "high energy",
      minimumScore: 80,
      reviewScore: 70,
      createdAt: now(),
      updatedAt: now()
    };
    state.streamerClipProfiles.unshift(profile);
  }
  return profile;
}

function ensureClipMission(streamer = {}, profile = null) {
  const streamerId = cleanText(streamer.id || DEMO_STREAMER_ID);
  let mission = state.clipMissions.find((item) => item.streamerId === streamerId && item.name === "Default clipping mission");
  if (!mission) {
    mission = {
      id: newId("clip_mission"),
      name: "Default clipping mission",
      streamerId,
      targetPlatforms: ["tiktok", "instagram_reels", "youtube_shorts"],
      primaryGoal: "viral_entertainment",
      preferredMomentTypes: [
        "Big reaction",
        "Hilarious failure",
        "Clutch play",
        "Unexpected event",
        "Chat explosion",
        "Skill display",
        "Viral one-liner",
        "Story payoff"
      ],
      avoidMomentTypes: [
        "Dead air",
        "AFK",
        "Loading screen",
        "Game menu",
        "Repeated conversation",
        "Copyright-risk music-only section",
        "Contextless sentence",
        "Weak reaction",
        "Technical issue",
        "Private information"
      ],
      targetDurationMinSeconds: 15,
      targetDurationMaxSeconds: 60,
      preferredLanguage: "en",
      captionStyle: "bold concise subtitles",
      tone: "high energy but clean",
      minQualityScore: Number(profile?.minimumScore || 80),
      reviewQualityScore: Number(profile?.reviewScore || 70),
      maxAcceptedClipsPerHour: 4,
      cooldownSeconds: 90,
      contextBeforeSeconds: 8,
      contextAfterSeconds: 8,
      requirePayoff: true,
      createdAt: now(),
      updatedAt: now()
    };
    state.clipMissions.unshift(mission);
  }
  return mission;
}

function upsertSourceCapabilities(capabilities) {
  const existing = state.sourceCapabilities.find(
    (item) => item.watchSessionId === capabilities.watchSessionId && item.sourceId === capabilities.sourceId
  );
  const next = {
    id: existing?.id || newId("source_cap"),
    sourceId: capabilities.sourceId || null,
    watchSessionId: capabilities.watchSessionId || null,
    hasLiveVideo: Boolean(capabilities.hasLiveVideo),
    hasAudio: Boolean(capabilities.hasAudio),
    hasChat: Boolean(capabilities.hasChat),
    hasTranscript: Boolean(capabilities.hasTranscript),
    hasViewerCount: Boolean(capabilities.hasViewerCount),
    hasSceneAnalysis: Boolean(capabilities.hasSceneAnalysis),
    isSeekable: Boolean(capabilities.isSeekable),
    hasDvr: Boolean(capabilities.hasDvr),
    isAuthorized: Boolean(capabilities.isAuthorized),
    rightsStatus: capabilities.rightsStatus || "unknown",
    mode: capabilities.mode || "real",
    reason: capabilities.reason || "",
    verifiedAt: now()
  };
  if (existing) Object.assign(existing, next);
  else state.sourceCapabilities.unshift(next);
  return existing || next;
}

function capabilitiesForWatchSource({ session, source, streamer }) {
  const playable = Boolean(source?.playable && source?.filePath);
  const practice = session.mode === "demo" || source?.provenance === PROVENANCE.DEMO_SOURCE || streamer?.isDemo;
  return upsertSourceCapabilities({
    watchSessionId: session.id,
    sourceId: source?.id || session.sourceId || null,
    hasLiveVideo: playable,
    hasAudio: Boolean(playable && source?.hasAudio),
    hasChat: Boolean(normalizeChatChannel(streamer)),
    hasTranscript: Boolean(playable && source?.transcriptSummary?.text),
    hasViewerCount: Boolean(streamer?.liveViewerCount),
    hasSceneAnalysis: playable,
    isSeekable: playable,
    hasDvr: playable,
    isAuthorized: practice || isRealApprovedStreamer(streamer),
    rightsStatus: practice ? "practice_only" : streamer?.permissionStatus === "approved" ? "metadata_only_clipping_not_verified" : "permission_required",
    mode: session.mode,
    reason: playable
      ? "Server has verified playable media for candidate rendering."
      : "Metadata-only monitoring. No playable stream media is available to the backend."
  });
}

function findReusableActiveWatchSession({ streamerId, clipProfileId, mode, idempotencyKey }) {
  return state.watchSessions.find((session) => {
    if (!isWatchSessionActive(session) && session.status !== "paused") return false;
    if (idempotencyKey && session.idempotencyKey === idempotencyKey) return true;
    return session.streamerId === streamerId && session.clipProfileId === clipProfileId && session.mode === mode;
  }) || null;
}

function pruneLiveWindowsForStreamerBeforeWatchStart(streamerId, reason = "watch_session_start", preferredSessionId = "", options = {}) {
  const { forceSingleWatch = false } = options || {};
  const normalizedStreamerId = cleanText(streamerId);
  const normalizedPreferred = cleanText(preferredSessionId);
  const sessions = state.watchSessions.filter((session) => session.streamerId === normalizedStreamerId);
  return sessions.reduce((removedTotal, session) => {
    if (!session?.id) return removedTotal;
    if (session.id === normalizedPreferred) {
      return removedTotal + pruneLiveWindowCandidatesForSession(session, reason, { keepLatest: true, forceSingleWatch });
    }
    return removedTotal + pruneLiveWindowCandidatesForSession(session, reason, { keepLatest: false, forceSingleWatch });
  }, 0);
}

function deletedRecordingWindowIndexSet(session) {
  return new Set((Array.isArray(session?.deletedRecordingWindows) ? session.deletedRecordingWindows : [])
    .map((item) => Number(item.index))
    .filter(Number.isFinite));
}

function purgeUnresolvedLiveWindowCandidatesForSession(session, reason = "live_window_reset") {
  if (!session?.id) return 0;
  const sessionId = session.id;
  const removed = [];
  const kept = [];
  for (const candidate of state.clipCandidates) {
    if (candidate?.watchSessionId !== sessionId || candidate?.sourceType !== "live_recording_window") {
      kept.push(candidate);
      continue;
    }
    const isPlayable = candidate.mediaPlayable || Boolean(playableSourceForCandidate(candidate));
    const isTerminal = candidate.status === "packaged" || candidate.status === "in_builder" || candidate.decision === "rejected";
    if (!isTerminal && !isPlayable) {
      removed.push(candidate);
      rememberDeletedRecordingWindow(session, candidate, reason);
      continue;
    }
    kept.push(candidate);
  }
  if (!removed.length) return 0;
  state.clipCandidates = kept;
  const sessionCandidates = state.clipCandidates.filter((candidate) => candidate.watchSessionId === sessionId);
  session.candidatesDetected = sessionCandidates.length;
  session.candidatesAccepted = sessionCandidates.filter((candidate) => candidate.decision === "accepted").length;
  session.candidatesReview = sessionCandidates.filter((candidate) => candidate.decision === "review").length;
  session.candidatesRejected = sessionCandidates.filter((candidate) => candidate.decision === "rejected").length;
  session.currentStage = "Single-window watch pipeline reset";
  session.updatedAt = now();
  addStateLog("live_windows_pruned", "Unresolved live-recording window candidates were removed before (re)starting watch", {
    sessionId,
    removed: removed.length,
    reason
  });
  appendWatchEvent(session.id, "recording_windows_pruned", {
    removed: removed.length,
    reason,
    candidateIds: removed.map((candidate) => candidate.id)
  }).catch(() => {});
  return removed.length;
}

function isSingleWatchTerminalLiveCandidate(candidate) {
  return (
    candidate?.status === "packaged"
    || candidate?.status === "in_builder"
    || candidate?.status === "deleted"
    || candidate?.decision === "rejected"
  );
}

function pruneSingleWatchLiveWindowCandidatesForSession(session, reason = "single_watch_cleanup") {
  return pruneLiveWindowCandidatesForSession(session, reason, { keepLatest: true, forceSingleWatch: true });
}

function pruneSingleWatchLiveWindowCandidatesForOtherSession(session, reason = "single_watch_streamer_cleanup", keepLatest = false) {
  return pruneLiveWindowCandidatesForSession(session, reason, { keepLatest });
}

function pruneLiveWindowCandidatesForSession(session, reason = "single_watch_cleanup", options = {}) {
  const { forceSingleWatch = false } = options;
  if (!forceSingleWatch && !shouldTreatAsSingleWatch()) return 0;
  if (!session?.id) return 0;
  const sessionId = session.id;
  const keepLatest = Boolean(options.keepLatest);
  const sessionCandidates = state.clipCandidates.filter((candidate) => candidate?.watchSessionId === sessionId && candidate?.sourceType === "live_recording_window");
  if (sessionCandidates.length <= 1) return 0;

  const nonTerminal = sessionCandidates.filter((candidate) => !isSingleWatchTerminalLiveCandidate(candidate));
  if (!keepLatest && !nonTerminal.length) return 0;
  if (keepLatest && nonTerminal.length <= 1) return 0;

  const keep = keepLatest
    ? nonTerminal
      .slice()
      .sort((a, b) => {
        const aIndex = Number(a?.recordingWindowIndex);
        const bIndex = Number(b?.recordingWindowIndex);
        if (Number.isFinite(aIndex) || Number.isFinite(bIndex)) {
          return (Number.isFinite(bIndex) ? bIndex : Number.MIN_SAFE_INTEGER)
            - (Number.isFinite(aIndex) ? aIndex : Number.MIN_SAFE_INTEGER);
        }
        return Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0);
      })[0]
    : null;
  const keepIndex = sessionCandidates.findIndex((candidate) => candidate?.id === keep?.id);

  const removed = [];
  const kept = [];
  for (const candidate of sessionCandidates) {
    if (isSingleWatchTerminalLiveCandidate(candidate)) {
      kept.push(candidate);
      continue;
    }
    if (keepLatest && candidate.id === keep?.id && keepIndex >= 0) {
      kept.push(candidate);
      continue;
    }
    removed.push(candidate);
    rememberDeletedRecordingWindow(session, candidate, reason);
  }
  if (!removed.length) return 0;

  state.clipCandidates = [
    ...state.clipCandidates.filter((candidate) => candidate?.watchSessionId !== sessionId || candidate?.sourceType !== "live_recording_window"),
    ...kept.filter((candidate) => candidate?.watchSessionId === sessionId)
  ];

  const sessionCandidatesAfter = state.clipCandidates.filter((candidate) => candidate.watchSessionId === sessionId);
  session.candidatesDetected = sessionCandidatesAfter.length;
  session.candidatesAccepted = sessionCandidatesAfter.filter((candidate) => candidate.decision === "accepted").length;
  session.candidatesReview = sessionCandidatesAfter.filter((candidate) => candidate.decision === "review").length;
  session.candidatesRejected = sessionCandidatesAfter.filter((candidate) => candidate.decision === "rejected").length;
  session.currentStage = "Single-watch cleanup kept the latest live window";
  session.updatedAt = now();
  appendWatchEvent(session.id, "recording_windows_pruned", {
    reason,
    removed: removed.length,
    kept: kept.length,
    removedIds: removed.map((candidate) => candidate.id)
  }).catch(() => {});
  addStateLog("live_windows_pruned_single_watch", "Single-stream watch cleanup removed extra non-terminal windows", {
    sessionId,
    removed: removed.length
  });
  return removed.length;
}

function pruneSingleWatchLiveWindowCandidatesForStreamer(streamerId, reason = "single_watch_streamer_cleanup", preferredSessionId = "") {
  if (!shouldTreatAsSingleWatch()) return 0;
  const targetStreamerId = cleanText(streamerId);
  const preferred = cleanText(preferredSessionId);
  const sessions = state.watchSessions.filter((session) => session.streamerId === targetStreamerId);
  return sessions.reduce((total, session) => {
    if (!session?.id) return total;
    if (session.id === preferred) {
      return total + pruneLiveWindowCandidatesForSession(session, reason, { keepLatest: true });
    }
    return total + pruneLiveWindowCandidatesForSession(session, reason, { keepLatest: false });
  }, 0);
}

function rememberDeletedRecordingWindow(session, candidate, reason) {
  const index = Number(candidate?.recordingWindowIndex);
  if (!session || candidate?.sourceType !== "live_recording_window" || !Number.isFinite(index)) return false;
  const deleted = Array.isArray(session.deletedRecordingWindows) ? session.deletedRecordingWindows : [];
  const withoutSameIndex = deleted.filter((item) => Number(item.index) !== index);
  withoutSameIndex.push({
    index,
    candidateId: candidate.id,
    title: candidate.title,
    reason,
    deletedAt: now()
  });
  session.deletedRecordingWindows = withoutSameIndex.slice(-WATCH_MAX_RECORDING_WINDOWS);
  return true;
}

async function stopWatchSessionAfterCandidateCleanup(session, reason = "operator_cleanup") {
  if (!session) return null;
  const streamer = findStreamer(session.streamerId);
  let monitorDisabled = false;
  if (streamer?.monitorEnabled) {
    streamer.monitorEnabled = false;
    streamer.monitorPausedAt = now();
    streamer.updatedAt = now();
    monitorDisabled = true;
  }
  const wasTerminal = TERMINAL_WATCH_STATUSES.has(session.status);
  if (!wasTerminal) {
    await stopWatchSession(session.id, "cancelled", {
      reason,
      cleanup: true,
      monitorDisabled
    });
  }
  await appendWatchEvent(session.id, "source_monitor_paused", {
    reason,
    cleanup: true,
    monitorDisabled,
    message: "Operator cleanup stopped the active watcher so deleted source-pending windows do not refill Clip Radar."
  });
  await logEvent("watch_stopped_after_cleanup", "Clip cleanup stopped source watcher", {
    sessionId: session.id,
    streamerId: session.streamerId || "",
    streamerName: streamer?.displayName || session.streamerName || "",
    monitorDisabled,
    reason
  });
  await saveState();
  return {
    sessionId: session.id,
    streamerId: session.streamerId || "",
    streamerName: streamer?.displayName || session.streamerName || "",
    monitorDisabled,
    status: session.status
  };
}

function preferredSingleWatchTarget() {
  const liveSessions = state.watchSessions.filter((session) =>
    isWatchSessionActive(session)
    && session.status !== "paused"
    && session.streamerId
  );
  const currentStream = liveSessions
    .map((session) => state.streamers.find((streamer) => streamer.id === session.streamerId))
    .find((streamer) => streamer && isApprovedStreamer(streamer) && !isPracticeStreamer(streamer))
  if (currentStream?.id) return currentStream.id;
  const candidate = state.streamers
    .filter((streamer) => isApprovedStreamer(streamer) && !isPracticeStreamer(streamer) && streamer.monitorEnabled)
    .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0))[0];
  return candidate?.id || "";
}

async function enforceSingleWatchAtBoot(reason = "boot_single_watch_enforcement") {
  const preferredStreamerId = preferredSingleWatchTarget();
  if (!preferredStreamerId) return;
  await enforceSingleWatchedStreamer(preferredStreamerId, reason);
}

async function deleteClipCandidate(candidateId, reason = "operator_delete", options = {}) {
  const decodedId = decodeURIComponent(cleanText(candidateId));
  const index = state.clipCandidates.findIndex((candidate) => candidate.id === decodedId);
  if (index < 0) throw Object.assign(new Error("Clip candidate not found"), { statusCode: 404 });
  const candidate = state.clipCandidates[index];
  const linkedPackages = state.clipPackages.filter((clipPackage) => clipPackage.candidateId === candidate.id);
  if (linkedPackages.length) {
    throw Object.assign(new Error("This candidate already has a package. Delete or reject the package before deleting the source candidate."), {
      statusCode: 409,
      details: { packageIds: linkedPackages.map((clipPackage) => clipPackage.id) }
    });
  }
  state.clipCandidates.splice(index, 1);
  state.feedbackEvents = state.feedbackEvents.filter((feedback) => feedback.candidateId !== candidate.id);
  const session = state.watchSessions.find((item) => item.id === candidate.watchSessionId);
  if (session) {
    const suppressedRecordingWindow = rememberDeletedRecordingWindow(session, candidate, reason);
    const remaining = state.clipCandidates.filter((item) => item.watchSessionId === session.id);
    session.candidatesDetected = remaining.length;
    session.candidatesAccepted = remaining.filter((item) => item.decision === "accepted").length;
    session.candidatesReview = remaining.filter((item) => item.decision === "review").length;
    session.candidatesRejected = remaining.filter((item) => item.decision === "rejected").length;
    session.updatedAt = now();
    await appendWatchEvent(session.id, "candidate_deleted", {
      candidateId: candidate.id,
      title: candidate.title,
      reason,
      remaining: remaining.length,
      suppressedRecordingWindow,
      recordingWindowIndex: Number.isFinite(Number(candidate.recordingWindowIndex)) ? Number(candidate.recordingWindowIndex) : null,
      operatorAction: true
    });
  }
  let stoppedWatchSession = null;
  if (options.stopWatcher && session) {
    stoppedWatchSession = await stopWatchSessionAfterCandidateCleanup(session, reason);
  }
  await logEvent("candidate_deleted", "Clip candidate deleted from Radar", {
    candidateId: candidate.id,
    streamerId: candidate.streamerId || "",
    watchSessionId: candidate.watchSessionId || "",
    reason,
    stoppedWatchSessionId: stoppedWatchSession?.sessionId || ""
  });
  await saveState();
  return {
    deleted: true,
    candidateId: candidate.id,
    candidate,
    watchSessionId: candidate.watchSessionId || "",
    stoppedWatchSession,
    remaining: state.clipCandidates.length
  };
}

async function approveClipCandidateForBuilder(candidateId) {
  const decodedId = decodeURIComponent(cleanText(candidateId));
  const candidate = state.clipCandidates.find((item) => item.id === decodedId);
  if (!candidate) throw Object.assign(new Error("Clip candidate not found"), { statusCode: 404 });
  const source = playableSourceForCandidate(candidate);
  if (!source) {
    throw Object.assign(new Error("Builder approval requires a verified playable MP4 source."), {
      statusCode: 422,
      details: { candidateId: candidate.id }
    });
  }
  candidate.builderApproved = true;
  candidate.builderStatus = "approved";
  candidate.status = candidate.status === "candidate" ? "builder_ready" : candidate.status || "builder_ready";
  candidate.targetAspectRatio = "9:16";
  candidate.capcutTarget = {
    aspectRatio: "9:16",
    reframe: "auto",
    sourceMode: "verified_mp4",
    instruction: "Open in local CapCut Workspace, apply 9:16 canvas, then use Auto Reframe before export review."
  };
  candidate.builderApprovedAt = now();
  candidate.updatedAt = now();
  await logEvent("clip_builder_approved", "Clip approved for Builder and CapCut 9:16 prep", {
    candidateId: candidate.id,
    sourceId: source.id,
    targetAspectRatio: "9:16"
  });
  await saveState();
  return {
    candidate,
    source: publicMediaSource(source),
    capcutTarget: candidate.capcutTarget
  };
}

async function declineClipCandidate(candidateId, reason = "Declined by operator.") {
  const decodedId = decodeURIComponent(cleanText(candidateId));
  const candidate = state.clipCandidates.find((item) => item.id === decodedId);
  if (!candidate) throw Object.assign(new Error("Clip candidate not found"), { statusCode: 404 });
  candidate.status = "rejected";
  candidate.decision = "rejected";
  candidate.operatorDeclined = true;
  candidate.declinedAt = now();
  candidate.decisionReason = cleanText(reason) || candidate.decisionReason || "Declined by operator.";
  candidate.updatedAt = now();
  const session = state.watchSessions.find((item) => item.id === candidate.watchSessionId);
  if (session) {
    const suppressedRecordingWindow = rememberDeletedRecordingWindow(session, candidate, "operator_decline");
    const sessionCandidates = state.clipCandidates.filter((item) => item.watchSessionId === session.id);
    session.candidatesDetected = sessionCandidates.length;
    session.candidatesAccepted = sessionCandidates.filter((item) => item.decision === "accepted").length;
    session.candidatesReview = sessionCandidates.filter((item) => item.decision === "review").length;
    session.candidatesRejected = sessionCandidates.filter((item) => item.decision === "rejected").length;
    session.updatedAt = now();
    await appendWatchEvent(session.id, "candidate_declined", {
      candidateId: candidate.id,
      reason: candidate.decisionReason,
      suppressedRecordingWindow,
      recordingWindowIndex: Number.isFinite(Number(candidate.recordingWindowIndex)) ? Number(candidate.recordingWindowIndex) : null,
      operatorAction: true
    });
  }
  await logEvent("candidate_declined", "Clip candidate declined by operator", {
    candidateId: candidate.id,
    streamerId: candidate.streamerId || "",
    watchSessionId: candidate.watchSessionId || ""
  });
  await saveState();
  return { candidate, declined: true };
}

async function capcutWorkflowInputsForCandidate(candidateId) {
  const decodedId = decodeURIComponent(cleanText(candidateId));
  const candidate = state.clipCandidates.find((item) => item.id === decodedId);
  if (!candidate) throw Object.assign(new Error("Clip candidate not found"), { statusCode: 404 });
  const source = playableSourceForCandidate(candidate);
  if (!source?.filePath) {
    throw Object.assign(new Error("CapCut workflow requires a verified local MP4 source."), {
      statusCode: 422,
      details: { candidateId: candidate.id }
    });
  }
  await fs.mkdir(config.capcutProjectDir, { recursive: true });
  const projectName = slugify(`${candidate.streamerName || "clip"}-${candidate.title || candidate.id}`, candidate.id);
  const stickerPath = cleanText(config.capcutDefaultStickerPath);
  return {
    candidate,
    source: publicMediaSource(source),
    inputs: {
      sourceVideoPath: source.filePath,
      stickerPath,
      projectName,
      outputProjectFolder: config.capcutProjectDir
    },
    missingInputs: [],
    instructions: [
      "Connect CapCut.",
      "Start workflow training.",
      "In CapCut, import the selected MP4.",
      "Set the project to 9:16 vertical.",
      "Auto frame the subject.",
      "Create a blurred background.",
      "Optional: add a bottom sticker if you picked one.",
      "Save the project, then stop and save the macro in Argentum."
    ]
  };
}

async function startLiveWatchForApprovedStreamer(streamer, trigger = "approved_live_monitor") {
  if (!streamer || streamer.permissionStatus !== "approved" || !streamer.monitorEnabled) return null;
  if (!["twitch", "kick"].includes(streamer.platform) || !liveProviderConfigured(streamer.platform)) return null;
  try {
    const watch = await startWatchSession({
      mode: "real",
      streamerId: streamer.id,
      idempotencyKey: `watch:${streamer.id}:default`
    });
    await logEvent("watch_auto_started", "Approved live streamer watcher started", {
      streamerId: streamer.id,
      sessionId: watch.session?.id,
      trigger,
      reused: Boolean(watch.reused)
    });
    return watch;
  } catch (error) {
    await logEvent("watch_auto_start_blocked", "Approved live streamer watcher could not start", {
      streamerId: streamer.id,
      trigger,
      error: error.message
    });
    return null;
  }
}

function watchSessionSummary(session) {
  const events = watchEventsFor(session.id);
  const capabilities = state.sourceCapabilities.find((item) => item.watchSessionId === session.id) || null;
  const heldForReview = state.clipCandidates
    .filter((candidate) => candidate.watchSessionId === session.id && candidate.decision === "review")
    .slice(0, 6)
    .map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      reason: candidate.decisionReason || candidate.reason,
      score: candidate.score
    }));
  const rejected = state.clipCandidates
    .filter((candidate) => candidate.watchSessionId === session.id && candidate.decision === "rejected")
    .slice(0, 6)
    .map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      reason: candidate.decisionReason || candidate.reason,
      score: candidate.score
    }));
  return {
    status: session.status,
    health: watchSessionHealth(session),
    stage: session.currentStage || session.status,
    analyzedSeconds: session.analyzedSeconds || 0,
    capabilities,
    counts: {
      candidatesDetected: session.candidatesDetected || 0,
      candidatesAccepted: session.candidatesAccepted || 0,
      candidatesReview: session.candidatesReview || heldForReview.length,
      candidatesRejected: session.candidatesRejected || 0,
      clipsRendered: session.clipsRendered || 0,
      events: events.length
    },
    selectedBecause: "Candidates must have verified playable media, complete context, a clear hook, and score at least 80 for automatic acceptance. Scores from 70-79 wait for review.",
    heldForReview,
    rejected
  };
}

function topCandidateSignals(candidate = {}, scored = {}) {
  const signals = [];
  if (candidate.audioEnergy?.isVoiceExcited) signals.push("voice excited");
  const keywords = candidate.transcriptSummary?.detectedKeywords || [];
  if (keywords.length) signals.push(`transcript hype keywords detected (${keywords.slice(0, 4).join(", ")})`);
  if (candidate.transcriptSummary?.silenceBeforeBurst) signals.push("silence-to-burst arc");
  const messagesPerMinute = Number(candidate.chatSignals?.messagesPerMinute || 0);
  if (messagesPerMinute >= 60) signals.push(`chat spike ${messagesPerMinute}/min`);
  if (candidate.emoteDistribution?.dominant && !["none", "mixed"].includes(candidate.emoteDistribution.dominant)) {
    signals.push(`${candidate.emoteDistribution.dominant} emote velocity`);
  }
  if (candidate.crossStreamBoost) signals.push("cross-stream event");
  if (candidate.visionGate?.clipType) signals.push(`vision gate: ${candidate.visionGate.clipType}`);
  if (!signals.length && scored.scoreEvidence?.verified) signals.push("verified media evidence");
  return signals;
}

function evaluateCandidateQuality(candidate, mission, capabilities) {
  const streamer = findStreamer(candidate.streamerId);
  const streamerProfile = ensureStreamerDetectionProfile(streamer);
  const scored = scoreClipMoment(candidate);
  const evidenceCount = Array.isArray(candidate.measuredEvidence) ? candidate.measuredEvidence.length : 0;
  const hasPlayableEvidence = Boolean(capabilities?.hasLiveVideo && candidate.sourceId);
  const hasCompleteMoment = Number(candidate.durationSeconds || candidate.duration || 0) >= Number(mission.targetDurationMinSeconds || 15)
    || /payoff|complete|clutch|reaction|timing|save|callout/i.test(`${candidate.title} ${candidate.reason}`);
  let score = Number(scored.score || candidate.score || 0);
  const rejectionReasons = [];
  if (!hasPlayableEvidence) {
    score = Math.min(score, 49);
    rejectionReasons.push("No verified playable media is attached to this moment.");
  }
  if (evidenceCount < 2) {
    score = Math.min(score, 59);
    rejectionReasons.push("Not enough independent evidence for a clip decision.");
  }
  if (!hasCompleteMoment && mission.requirePayoff) {
    score = Math.min(score, 64);
    rejectionReasons.push("Moment does not show enough setup-to-payoff context.");
  }
  const acceptThreshold = Number(streamerProfile.minClipScore || mission.minQualityScore || 80);
  const reviewThreshold = Number(mission.reviewQualityScore || 70);
  const decision = score >= acceptThreshold
    ? "accepted"
    : score >= reviewThreshold
      ? "review"
      : "rejected";
  if (decision !== "accepted" && !rejectionReasons.length) {
    rejectionReasons.push(decision === "review"
      ? `Score ${score} is below the automatic acceptance threshold of ${acceptThreshold}, so it needs operator review.`
      : `Score ${score} is below the review threshold of ${reviewThreshold}.`);
  }
  const signalSummary = topCandidateSignals(candidate, scored);
  const acceptedReason = signalSummary.length
    ? `Accepted: ${signalSummary.join(", ")}.`
    : "Accepted because verified playable media, hook strength, duration, and context meet the active clip mission.";
  return {
    ...scored,
    score,
    qualityScore: score,
    decision,
    rejectionReasons,
    decisionReason: decision === "accepted"
      ? acceptedReason
      : decision === "review"
        ? [rejectionReasons.join(" "), signalSummary.length ? `Top signals: ${signalSummary.join(", ")}.` : ""].filter(Boolean).join(" ")
        : rejectionReasons.join(" "),
    scoreBreakdown: {
      hookStrength: scored.hookScore,
      engagementPotential: scored.engagementPotential,
      retentionPotential: scored.retentionPotential,
      riskScore: scored.riskScore,
      evidenceCount,
      hasPlayableEvidence,
      hasCompleteMoment,
      transcriptScore: candidate.transcriptScore || 0,
      transcriptKeywords: candidate.transcriptSummary?.detectedKeywords || [],
      silenceBeforeBurst: candidate.transcriptSummary?.silenceBeforeBurst || false,
      isVoiceExcited: candidate.audioEnergy?.isVoiceExcited || false,
      emoteDistribution: candidate.emoteDistribution || null,
      crossStreamBoost: candidate.crossStreamBoost || false,
      visionGate: candidate.visionGate || null,
      clipProfile: { genre: streamerProfile?.genre || "general" }
    }
  };
}

function ensureWatchMediaSegments(session, source) {
  if (!source?.filePath) return [];
  const existing = state.mediaSegments.filter((segment) => segment.watchSessionId === session.id);
  if (existing.length) return existing;
  const segment = {
    id: newId("segment"),
    watchSessionId: session.id,
    sourceId: source.id,
    sequence: 1,
    startedAt: session.startedAt,
    endedAt: now(),
    durationSeconds: Math.min(600, Number(source.durationSeconds || source.duration || 0) || 24),
    filePath: source.filePath,
    fileSizeBytes: Number(source.fileSizeBytes || 0),
    sha256: source.sha256 || "",
    status: "ready",
    createdAt: now()
  };
  state.mediaSegments.unshift(segment);
  return [segment];
}

function liveSourceUrlForStreamer(streamer = {}) {
  if (streamer.channelUrl) return streamer.channelUrl;
  if (streamer.platform === "kick" && streamer.channelId) return `https://kick.com/${streamer.channelId}`;
  if (streamer.platform === "twitch" && streamer.channelId) return `https://www.twitch.tv/${streamer.channelId}`;
  return "";
}

async function liveRecorderStatus() {
  const [streamlink, ytdlp, ffmpeg] = await Promise.all([
    commandStatus(config.streamlinkExecutable, ["--version"]),
    commandStatus(config.ytdlpExecutable, ["--version"]),
    commandStatus(ffmpegExecutable)
  ]);
  const preferred = config.captureToolPreference;
  const tools = [
    { id: "streamlink", ...streamlink },
    { id: "yt-dlp", ...ytdlp }
  ];
  const available = tools.filter((tool) => tool.configured);
  const selected = preferred === "streamlink"
    ? available.find((tool) => tool.id === "streamlink")
    : preferred === "yt-dlp" || preferred === "ytdlp"
      ? available.find((tool) => tool.id === "yt-dlp")
      : available[0];
  return {
    enabled: config.captureEnabled,
    ready: Boolean(config.captureEnabled && ffmpeg.configured && selected),
    selected: selected?.id || null,
    streamlink,
    ytdlp,
    ffmpeg,
    bufferDir: config.watchBufferDir,
    message: !config.captureEnabled
      ? "Live capture is disabled by STREAMCLIPPER_CAPTURE_ENABLED=false."
      : !ffmpeg.configured
        ? "FFmpeg is missing, so live windows cannot be saved."
        : selected
          ? `${selected.id} is available for live source capture.`
          : "Install streamlink or yt-dlp so live monitor windows can be saved as local clips."
  };
}

async function prependPythonUserBinToPath() {
  try {
    const { stdout } = await execFileAsync("python3", ["-m", "site", "--user-base"], { timeout: 10000 });
    const userBase = stdout.trim();
    if (!userBase) return;
    const bin = path.join(userBase, "bin");
    const parts = String(process.env.PATH || "").split(path.delimiter);
    if (!parts.includes(bin)) process.env.PATH = [bin, ...parts].filter(Boolean).join(path.delimiter);
  } catch {
    // Best effort only. liveRecorderStatus will still report missing tools clearly.
  }
}

async function installPythonTool(packageName) {
  try {
    await execFileAsync("python3", ["-m", "pip", "install", "--user", packageName, "--quiet"], {
      timeout: 180000,
      maxBuffer: 1024 * 1024 * 3
    });
    await prependPythonUserBinToPath();
    return true;
  } catch (firstError) {
    try {
      await execFileAsync("python3", ["-m", "pip", "install", packageName, "--break-system-packages", "--quiet"], {
        timeout: 180000,
        maxBuffer: 1024 * 1024 * 3
      });
      await prependPythonUserBinToPath();
      return true;
    } catch (secondError) {
      addStateLog("capture_tool_install_failed", `Could not install ${packageName}`, {
        userInstallError: firstError.message,
        systemInstallError: secondError.message
      });
      return false;
    }
  }
}

async function ensureCaptureTools() {
  if (!config.captureEnabled || process.env.STREAMCLIPPER_AUTO_INSTALL_CAPTURE_TOOLS === "false") return;
  await prependPythonUserBinToPath();
  const status = await liveRecorderStatus();
  if (status.ready) return;
  if (!status.streamlink.configured) await installPythonTool("streamlink");
  const afterStreamlink = await liveRecorderStatus();
  if (afterStreamlink.ready) return;
  if (!afterStreamlink.ytdlp.configured) await installPythonTool("yt-dlp");
}

async function resolveLivePlaybackUrl(sourceUrl) {
  const status = await liveRecorderStatus();
  if (!status.ready) {
    const error = new Error(status.message);
    error.statusCode = 424;
    error.code = "capture_tool_missing";
    error.recorderStatus = status;
    throw error;
  }
  if (status.selected === "streamlink") {
    try {
      const { stdout } = await execFileAsync(status.streamlink.command, [
        "--stream-url",
        sourceUrl,
        "best"
      ], { timeout: 30000, maxBuffer: 1024 * 1024 });
      const url = stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => /^https?:\/\//i.test(line));
      if (url) return { url, tool: "streamlink" };
    } catch (error) {
      if (!status.ytdlp?.configured) throw error;
    }
  }
  if (status.ytdlp?.configured) {
    const { stdout } = await execFileAsync(status.ytdlp.command, [
      "-g",
      "-f",
      "best",
      sourceUrl
    ], { timeout: 30000, maxBuffer: 1024 * 1024 });
    const url = stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => /^https?:\/\//i.test(line));
    if (url) return { url, tool: "yt-dlp" };
  }
  const error = new Error("Recorder did not return a playable stream URL.");
  error.statusCode = 424;
  error.code = "capture_url_missing";
  throw error;
}

async function recordRemoteStreamToFile(streamUrl, outputPath, durationSeconds) {
  const timeout = Math.max(60000, (Number(durationSeconds || WATCH_RECORDING_WINDOW_SECONDS) + 60) * 1000);
  const common = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    streamUrl,
    "-t",
    String(durationSeconds)
  ];
  try {
    await execFileAsync(ffmpegExecutable, [
      ...common,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputPath
    ], { timeout, maxBuffer: 1024 * 1024 * 6 });
  } catch {
    await execFileAsync(ffmpegExecutable, [
      ...common,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
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
    ], { timeout: Math.max(timeout, 120000), maxBuffer: 1024 * 1024 * 8 });
  }
  const stat = await fs.stat(outputPath);
  if (!stat.isFile() || stat.size <= 0) throw new Error("Capture failed: output file is empty.");
  return stat;
}

function captureAttemptIsRecent(session, windowIndex) {
  const lastIndex = Number(session.captureWindowIndex);
  const lastAttempt = session.lastCaptureAttemptAt ? new Date(session.lastCaptureAttemptAt).getTime() : 0;
  return lastIndex === Number(windowIndex) && lastAttempt && Date.now() - lastAttempt < Math.max(15000, WATCH_RECORDING_WINDOW_SECONDS * 1000);
}

async function enrichSourceWithTranscript(source) {
  if (!source?.filePath) return source;
  try {
    if (!(await isWhisperAvailable())) {
      source.transcriptStatus = "whisper_unavailable";
      return source;
    }
    const transcriptResult = await transcribeBuffer(source.filePath, {
      ffmpegExecutable,
      model: config.whisperModel
    }).catch((error) => ({ available: false, error: error.message }));
    if (!transcriptResult.available) {
      source.transcriptStatus = "transcription_unavailable";
      source.transcriptError = cleanText(transcriptResult.error).slice(0, 240);
      return source;
    }
    const transcriptScoring = scoreTranscript(transcriptResult);
    source.transcriptStatus = "transcribed";
    source.transcriptScore = transcriptScoring.transcriptScore;
    source.transcriptSummary = {
      text: transcriptResult.text?.slice(0, 300) || "",
      hypeHits: transcriptScoring.hypeHits,
      silenceBeforeBurst: transcriptScoring.silenceBeforeBurst,
      speechRate: transcriptScoring.speechRate,
      peakSpeechRate: transcriptScoring.peakSpeechRate,
      detectedKeywords: transcriptScoring.detectedKeywords
    };
    source.updatedAt = now();
    return source;
  } catch (error) {
    source.transcriptStatus = "transcription_error";
    source.transcriptError = cleanText(error.message).slice(0, 240);
    addStateLog("transcription_error", "Whisper transcription failed for a captured buffer", {
      sourceId: source.id,
      error: source.transcriptError
    });
    return source;
  }
}

async function captureLiveWindowForSession(session, {
  streamer,
  mission,
  windowIndex,
  watchTrigger = "watch_capture",
  watchTriggerSignals = {}
}) {
  if (!session || session.mode !== "real" || !isRealApprovedStreamer(streamer)) return null;
  if (deletedRecordingWindowIndexSet(session).has(Number(windowIndex))) return null;
  const existingCandidate = state.clipCandidates.find((candidate) =>
    candidate.watchSessionId === session.id
    && Number(candidate.recordingWindowIndex) === Number(windowIndex)
    && candidateHasPlayableSource(candidate)
  );
  if (existingCandidate) return playableSourceForCandidate(existingCandidate);
  if (captureAttemptIsRecent(session, windowIndex) || session.captureStatus === "capturing") return null;

  const sourceUrl = liveSourceUrlForStreamer(streamer);
  if (!sourceUrl) return null;
  const startSeconds = Number(windowIndex) * WATCH_RECORDING_WINDOW_SECONDS;
  const endSeconds = startSeconds + WATCH_RECORDING_WINDOW_SECONDS;
  const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}-${streamer.channelId || streamer.id}-window-${Number(windowIndex) + 1}.mp4`
    .replace(/[^a-z0-9_.-]+/gi, "-");
  const outputPath = path.join(config.watchBufferDir, filename);
  const job = {
    id: newId("capture_job"),
    watchSessionId: session.id,
    streamerId: streamer.id,
    recordingWindowIndex: Number(windowIndex),
    status: "running",
    outputPath,
    tool: "",
    error: "",
    createdAt: now(),
    updatedAt: now()
  };
  state.captureJobs.unshift(job);
  state.captureJobs = state.captureJobs.slice(0, 500);
  Object.assign(session, {
    captureStatus: "capturing",
    captureWindowIndex: Number(windowIndex),
    lastCaptureAttemptAt: now(),
    captureMessage: `Saving ${WATCH_RECORDING_WINDOW_SECONDS}s local buffer for ${streamer.displayName}.`,
    updatedAt: now()
  });
  upsertRecordingWindowTelemetry(session, {
    index: windowIndex,
    startSeconds,
    endSeconds,
    status: "capturing",
    message: `Saving local ${WATCH_RECORDING_WINDOW_SECONDS}s video buffer.`
  });
  await appendWatchEvent(session.id, "source_capture_started", {
    streamerId: streamer.id,
    recordingWindowIndex: Number(windowIndex),
    durationSeconds: WATCH_RECORDING_WINDOW_SECONDS,
    message: "Saving a local watch-window video buffer for Clip Radar."
  });

  try {
    const resolved = await resolveLivePlaybackUrl(sourceUrl);
    job.tool = resolved.tool;
    await recordRemoteStreamToFile(resolved.url, outputPath, WATCH_RECORDING_WINDOW_SECONDS);
    const audioEnergy = applyAudioThresholdForStreamer(await analyzeAudioEnergy(outputPath, ffmpegExecutable), streamer);
    const source = await createMediaSourceFromFile({
      filePath: outputPath,
      originalFilename: filename,
      mimeType: "video/mp4",
      title: `${streamer.displayName} window ${Number(windowIndex) + 1}`,
      mode: "real",
      provenance: PROVENANCE.WATCHER_BUFFER,
      permissionStatus: "approved",
      rightsStatus: "approved",
      sourceType: "watcher_buffer",
      provider: streamer.platform,
      streamerId: streamer.id,
      watchSessionId: session.id,
      recordingWindowIndex: Number(windowIndex),
      liveWindowStartSeconds: startSeconds,
      liveWindowEndSeconds: endSeconds,
      audioEnergy,
      watchWindowTrigger: watchTrigger,
      watchWindowTriggerAt: now(),
      watchWindowSignals: watchTriggerSignals
    });
    await enrichSourceWithTranscript(source);
    job.status = "completed";
    job.sourceId = source.id;
    job.updatedAt = now();
    Object.assign(session, {
      sourceId: source.id,
      captureStatus: "ready",
      captureMessage: "Local video buffer saved and verified.",
      lastMediaAt: now(),
      updatedAt: now()
    });
    upsertRecordingWindowTelemetry(session, {
      index: windowIndex,
      startSeconds,
      endSeconds,
      status: "source_ready",
      sourceId: source.id,
      message: "Local playable video buffer is ready for Radar."
    });
    await appendWatchEvent(session.id, "source_capture_completed", {
      sourceId: source.id,
      recordingWindowIndex: Number(windowIndex),
      durationSeconds: source.durationSeconds,
      tool: resolved.tool,
      audioEnergy,
      transcriptScore: source.transcriptScore || 0,
      message: "Local watch-window video buffer saved and verified."
    });
    await logEvent("watch_window_captured", "Live watch window captured to local media", {
      sessionId: session.id,
      streamerId: streamer.id,
      sourceId: source.id,
      recordingWindowIndex: Number(windowIndex),
      durationSeconds: source.durationSeconds,
      tool: resolved.tool
    });
    await saveState();
    return source;
  } catch (error) {
    await fs.rm(outputPath, { force: true }).catch(() => {});
    job.status = "blocked";
    job.error = error.message;
    job.updatedAt = now();
    Object.assign(session, {
      captureStatus: "blocked",
      captureMessage: error.message,
      updatedAt: now()
    });
    upsertRecordingWindowTelemetry(session, {
      index: windowIndex,
      startSeconds,
      endSeconds,
      status: "capture_blocked",
      message: error.message
    });
    await appendWatchEvent(session.id, "source_capture_blocked", {
      recordingWindowIndex: Number(windowIndex),
      reason: error.code || "capture_failed",
      message: error.message
    });
    await saveState();
    return null;
  }
}

// A stream with lots of viewers but a silent chat (view-botted channels are
// the classic case) can never produce chat spikes, keywords, or tension
// signals — so a chat-gated watcher would sit idle forever. Track the chat
// feed's health per session and fall back to fixed-cadence sampling when it
// is dead; audio-energy + transcript + vision scoring filter the samples.
const CHAT_DEAD_AFTER_MS = 3 * 60 * 1000;
const CHAT_DEAD_SAMPLING_INTERVAL_WINDOWS = 2;

function updateChatSignalState(session, streamer) {
  if (!session || session.mode !== "real") return "unknown";
  if (!normalizeChatChannel(streamer) || !chatMonitors.has(session.id)) {
    session.chatSignalState = "unavailable";
    return session.chatSignalState;
  }
  const startedTs = Date.parse(session.startedAt || session.createdAt || "") || Date.now();
  const lastMessageTs = Date.parse(session.lastChatMessageAt || "") || 0;
  if (lastMessageTs && Date.now() - lastMessageTs < CHAT_DEAD_AFTER_MS) {
    session.chatSignalState = "healthy";
  } else if (Date.now() - startedTs < CHAT_DEAD_AFTER_MS) {
    session.chatSignalState = "warming_up";
  } else {
    session.chatSignalState = "dead";
  }
  return session.chatSignalState;
}

async function maybeCaptureCurrentWatchWindow(session, { streamer, mission }) {
  if (!config.captureEnabled || session.mode !== "real") return null;
  const currentIndex = Math.max(0, Math.floor(Number(session.analyzedSeconds || 0) / WATCH_RECORDING_WINDOW_SECONDS));
  const recentSpikes = watchSignalsForWindow(session.id, currentIndex, recentChatSpikesForSession(session.id));
  const recentKeywords = watchSignalsForWindow(session.id, currentIndex, recentChatKeywordSignalsForSession(session.id));
  const hasSpikeSignal = recentSpikes.length && Number(session.lastSpikeCaptureWindowIndex ?? -1) !== currentIndex;
  const hasKeywordSignal = recentKeywords.length && Number(session.lastKeywordCaptureWindowIndex ?? -1) !== currentIndex;
  const hasTensionSignal = isRecentTimestamp(session.tensionDetectedAt, 45000)
    && Number(session.lastTensionCaptureWindowIndex ?? -1) !== currentIndex;
  const chatState = updateChatSignalState(session, streamer);
  const chatDeadSamplingDue = chatState === "dead"
    && currentIndex % CHAT_DEAD_SAMPLING_INTERVAL_WINDOWS === 0
    && Number(session.lastChatDeadSamplingWindowIndex ?? -1) !== currentIndex;
  if (chatState === "dead" && !session.chatDeadNoticedAt) {
    session.chatDeadNoticedAt = now();
    await appendWatchEvent(session.id, "chat_signal_dead", {
      channel: normalizeChatChannel(streamer),
      viewers: Number(streamer?.viewers || 0),
      message: "Chat has been silent for 3+ minutes on this stream (view-botted channels look exactly like this). Switching to fixed-cadence sampling — audio, transcript, and vision scoring will filter the windows."
    });
  }
  if (chatState === "healthy" && session.chatDeadNoticedAt) session.chatDeadNoticedAt = "";
  if (config.watchTriggerRequiresSignal && !hasSpikeSignal && !hasKeywordSignal && !hasTensionSignal && !chatDeadSamplingDue) return null;
  const hasAnyWindowSignal = hasSpikeSignal || hasKeywordSignal || hasTensionSignal || chatDeadSamplingDue;

  const trigger = hasSpikeSignal
    ? "chat_spike"
    : hasKeywordSignal
      ? "chat_keyword"
      : hasTensionSignal
        ? "tension_emote_prediction"
        : chatDeadSamplingDue
          ? "chat_dead_sampling"
          : "manual_capture";
  if (chatDeadSamplingDue) session.lastChatDeadSamplingWindowIndex = currentIndex;
  session.lastCaptureTrigger = trigger;
  session.lastCaptureTriggerAt = now();
  session.lastCaptureTriggerWindowIndex = currentIndex;
  if (hasSpikeSignal) session.lastSpikeCaptureWindowIndex = currentIndex;
  if (hasKeywordSignal) session.lastKeywordCaptureWindowIndex = currentIndex;
  if (hasTensionSignal) session.lastTensionCaptureWindowIndex = currentIndex;
  if (hasAnyWindowSignal) session.lastAutoCaptureWindowIndex = currentIndex;
  await appendWatchEvent(session.id, "capture_triggered", {
    trigger,
    recordingWindowIndex: currentIndex,
    chatSpike: recentSpikes.at(-1) || null,
    tension: hasTensionSignal ? session.tensionPayload || null : null,
    keywords: recentKeywords.at(-1)?.matchedKeywords || [],
    message: trigger === "chat_spike"
      ? "Chat spike triggered a local 30-second recording window."
      : trigger === "chat_keyword"
        ? `Chat keyword trigger detected: ${(recentKeywords.at(-1)?.matchedKeywords || []).join(", ")}`
        : trigger === "tension_emote_prediction"
          ? "Tension emote velocity triggered a predictive local recording window."
          : trigger === "chat_dead_sampling"
            ? "Chat is silent, so the watcher sampled this window on a fixed cadence for scoring."
      : "Manual capture triggered a local 30-second recording buffer."
  });
  const source = await captureLiveWindowForSession(session, {
    streamer,
    mission,
    windowIndex: currentIndex,
    watchTrigger: trigger,
    watchTriggerSignals: {
      hasSpikeSignal,
      hasKeywordSignal,
      hasTensionSignal,
      chatSpikes: recentSpikes,
      chatKeywords: recentKeywords,
      tension: hasTensionSignal ? session.tensionPayload || null : null
    }
  });
  if (source && recentSpikes.length) {
    const spike = recentSpikes.at(-1);
    const keyword = recentKeywords.at(-1);
    Object.assign(source, {
      chatSpike: spike,
      watchWindowTrigger: trigger,
      watchWindowSignal: spike ? "chat_spike" : keyword ? "chat_keyword" : "watch_trigger",
      watchWindowKeywordSignals: keyword?.matchedKeywords || [],
      chatSignals: spike
        ? {
          spike: spike.messagesPerWindow,
          messagesPerMinute: spike.messagesPerMinute,
          source: "twitch_irc",
          label: "Real Twitch IRC spike"
        }
        : keyword
          ? {
            spike: 0,
            messagesPerMinute: keyword.messagesPerMinute,
            source: "twitch_irc_keyword",
            label: `Keyword match: ${keyword.matchedKeywords.join(", ")}`
          }
          : {
            spike: 0,
            messagesPerMinute: source?.audioEnergy?.isLoudMoment ? 30 : 0,
            source: "watch_capture",
            label: "Watch-window capture requested"
          },
      watchWindowSignals: {
        ...source.watchWindowSignals,
        watchTrigger: {
          type: trigger,
          keywords: keyword?.matchedKeywords || [],
          spikeWindowIndex: Number(currentIndex)
        }
      },
      updatedAt: now()
    });
    await saveState();
  } else if (source && recentKeywords.length && !recentSpikes.length) {
    const keyword = recentKeywords.at(-1);
    Object.assign(source, {
      watchWindowTrigger: trigger,
      watchWindowSignal: keyword ? "chat_keyword" : "watch_capture",
      watchWindowKeywordSignals: keyword?.matchedKeywords || [],
      chatSignals: keyword
        ? {
          spike: 0,
          messagesPerMinute: keyword.messagesPerMinute,
          source: "twitch_irc_keyword",
          label: `Keyword match: ${keyword.matchedKeywords.join(", ")}`
        }
        : {
          spike: 0,
          messagesPerMinute: source?.audioEnergy?.isLoudMoment ? 30 : 0,
          source: "watch_capture",
          label: "Watch-window capture requested"
        },
      watchWindowSignals: {
        ...source.watchWindowSignals,
        watchTrigger: {
          type: trigger,
          keywords: keyword?.matchedKeywords || [],
          spikeWindowIndex: Number(currentIndex)
        }
      },
      updatedAt: now()
    });
    await saveState();
  } else if (source && hasAnyWindowSignal) {
    Object.assign(source, {
      watchWindowTrigger: trigger,
      watchWindowSignal: source.watchWindowSignal || (hasTensionSignal ? "tension_emote" : "watch_capture"),
      tensionSignal: hasTensionSignal ? session.tensionPayload || null : source.tensionSignal || null,
      chatSignals: hasTensionSignal
        ? {
          spike: Number(session.tensionPayload?.tensionCount || 0),
          messagesPerMinute: Number(session.tensionPayload?.messagesPerMinute || 0),
          source: "twitch_irc_tension_emotes",
          label: "Tension emote velocity"
        }
        : source.chatSignals,
      updatedAt: now()
    });
    await saveState();
  }
  return source;
}

async function ensureWatchSessionCandidates(session) {
  const streamer = state.streamers.find((item) => item.id === session.streamerId);
  const source = state.mediaSources.find((item) => item.id === session.sourceId);
  const mission = state.clipMissions.find((item) => item.id === session.clipProfileId || item.id === session.missionId) || ensureClipMission(streamer);
  const capabilities = capabilitiesForWatchSource({ session, source, streamer });
  if (!capabilities.hasLiveVideo || !source?.filePath || source?.sourceType === "watcher_buffer") {
    return ensureWatchRecordingWindowCandidates(session, { streamer, mission, capabilities, source });
  }
  ensureWatchMediaSegments(session, source);
  const existing = state.clipCandidates.filter((candidate) => candidate.watchSessionId === session.id);
  if (existing.length) {
    pruneLiveWindowCandidatesForSession(session, "watch_session_candidate_refresh", { keepLatest: true, forceSingleWatch: true });
    return state.clipCandidates.filter((candidate) => candidate.watchSessionId === session.id);
  }
  if (source?.sourceType === "demo") return [source];
  const sourceDuration = Math.max(1, sourceDurationSeconds(source) || 24);
  const base = demoCandidateDefinitions(source.id).map((candidate, index) => {
    const start = Math.max(0, Math.min(sourceDuration - 4, 1 + index * 2));
    const end = Math.max(start + 4, Math.min(sourceDuration, start + 18));
    const title = [
      "Insane 1v4 clutch",
      "Perfect timing reaction",
      "Chat goes crazy",
      "Clean save"
    ][index] || candidate.title;
    return {
      ...candidate,
      id: newId("candidate"),
      watchSessionId: session.id,
      clipProfileId: mission.id,
      streamerId: session.streamerId,
      streamerName: streamer?.displayName || candidate.streamerName,
      sourceId: source.id,
      sourceType: source.sourceType || "practice",
      title,
      timestampStartSeconds: start,
      timestampEndSeconds: end,
      startSeconds: start,
      endSeconds: end,
      timestampStart: secondsToTimestamp(start),
      timestampEnd: secondsToTimestamp(end),
      duration: end - start,
      durationSeconds: end - start,
      transcriptSnippet: index < 3
        ? `${title}. No way, unreal reaction, complete payoff, and clean setup are visible in the verified practice source.`
        : `${title}. Clean action is visible, but the payoff is quieter and needs review.`,
      chatSignals: { spike: 130 - index * 16, messagesPerMinute: 130 - index * 16, source: "practice_signal" },
      hookScore: 20 - index,
      retentionPotential: 88 - index * 4,
      reason: "Detected from verified practice media with enough setup/payoff for workflow testing.",
      measuredEvidence: [
        { label: "Verified playable source file", provenance: PROVENANCE.VERIFIED_MEDIA },
        { label: "Pinned backend media segment", provenance: PROVENANCE.VERIFIED_MEDIA },
        { label: "Active clip mission threshold applied", provenance: "watch_session" }
      ],
      signals: {
        visualAction: true,
        completePayoff: index < 3,
        deadAir: false,
        menuScreen: false
      },
      createdAt: now(),
      updatedAt: now()
    };
  });
  const evaluated = base.map((candidate) => {
    const result = evaluateCandidateQuality(candidate, mission, capabilities);
    return {
      ...candidate,
      ...result,
      status: result.decision === "accepted" ? "candidate" : result.decision === "review" ? "reviewed" : "rejected"
    };
  });
  for (const candidate of evaluated) {
    state.clipCandidates.unshift(candidate);
    await appendWatchEvent(session.id, "candidate_scoring", {
      candidateId: candidate.id,
      title: candidate.title,
      score: candidate.score,
      decision: candidate.decision
    });
    if (candidate.decision === "accepted") {
      await appendWatchEvent(session.id, "candidate_accepted", {
        candidateId: candidate.id,
        title: candidate.title,
        score: candidate.score,
        reason: candidate.decisionReason
      });
    } else if (candidate.decision === "review") {
      await appendWatchEvent(session.id, "candidate_review", {
        candidateId: candidate.id,
        title: candidate.title,
        score: candidate.score,
        reason: candidate.decisionReason
      });
    } else {
      await appendWatchEvent(session.id, "candidate_rejected", {
        candidateId: candidate.id,
        title: candidate.title,
        score: candidate.score,
        reason: candidate.decisionReason
      });
    }
  }
  session.candidatesDetected = evaluated.length;
  session.candidatesAccepted = evaluated.filter((candidate) => candidate.decision === "accepted").length;
  session.candidatesReview = evaluated.filter((candidate) => candidate.decision === "review").length;
  session.candidatesRejected = evaluated.filter((candidate) => candidate.decision === "rejected").length;
  session.lastCandidateAt = now();
  session.updatedAt = now();
  const top = evaluated.filter((candidate) => candidate.decision === "accepted").slice(0, 1);
  for (const candidate of top) {
    if (candidate.renderedArtifactId) continue;
    try {
      await appendWatchEvent(session.id, "render_started", { candidateId: candidate.id, title: candidate.title });
      const result = await createRenderJob({ projectId: DEMO_PROJECT_ID, sourceId: source.id, candidateId: candidate.id });
      session.clipsRendered = Number(session.clipsRendered || 0) + 1;
      session.updatedAt = now();
      await appendWatchEvent(session.id, "render_completed", {
        candidateId: candidate.id,
        artifactId: result.artifact?.id,
        playbackUrl: result.artifact?.playbackUrl
      });
    } catch (error) {
      await appendWatchEvent(session.id, "render_failed", { candidateId: candidate.id, error: error.message });
    }
  }
  await saveState();
  return evaluated;
}

function recordingWindowCandidatesForSession(sessionId) {
  return state.clipCandidates.filter((candidate) =>
    candidate.watchSessionId === sessionId && candidate.sourceType === "live_recording_window"
  );
}

function activeLiveRecordingWindowCandidates(sessionId) {
  if (!sessionId) return [];
  return state.clipCandidates.filter((candidate) =>
    candidate.watchSessionId === sessionId
    && candidate.sourceType === "live_recording_window"
    && candidate.status !== "packaged"
    && candidate.decision !== "rejected"
    && candidate.status !== "deleted"
  );
}

function unresolvedLiveRecordingCandidates(sessionId) {
  if (!sessionId) return [];
  return state.clipCandidates.filter((candidate) =>
    candidate.watchSessionId === sessionId
    && candidate.sourceType === "live_recording_window"
    && candidate.status !== "packaged"
    && candidate.decision !== "rejected"
  );
}

function shouldTreatAsSingleWatch() {
  if (config.singleWatchMode === false) return false;
  return true;
}

function targetRecordingWindowIndexes(session) {
  const analyzed = Math.max(0, Number(session.analyzedSeconds || 0));
  const currentIndex = Math.max(0, Math.floor(analyzed / WATCH_RECORDING_WINDOW_SECONDS));
  const visibleWindowCount = Math.min(3, WATCH_MAX_RECORDING_WINDOWS);
  const firstIndex = Math.max(0, currentIndex - visibleWindowCount + 1);
  const indexes = [];
  for (let index = firstIndex; index <= currentIndex; index += 1) {
    indexes.push(index);
  }
  return indexes.length ? indexes : [0];
}

function buildWatchRecordingCandidate(session, { streamer, mission, capabilities, source, windowIndex }) {
  const liveWindowStartSeconds = windowIndex * WATCH_RECORDING_WINDOW_SECONDS;
  const liveWindowEndSeconds = liveWindowStartSeconds + WATCH_RECORDING_WINDOW_SECONDS;
  const hasPlayableSource = Boolean(capabilities.hasLiveVideo && source?.filePath);
  const sourceMatchesWindow = hasPlayableSource
    && source?.watchSessionId === session.id
    && Number(source?.recordingWindowIndex) === Number(windowIndex);
  const sourceWindowDuration = Math.max(1, Math.min(WATCH_RECORDING_WINDOW_SECONDS, Number(sourceDurationSeconds(source) || WATCH_RECORDING_WINDOW_SECONDS)));
  const start = sourceMatchesWindow ? 0 : liveWindowStartSeconds;
  const end = sourceMatchesWindow ? sourceWindowDuration : liveWindowEndSeconds;
  const streamerName = streamer?.displayName || session.streamerName || "Live streamer";
  const liveTitle = cleanText(streamer?.liveTitle || session.title || `${streamerName} live stream`);
  const category = cleanText(streamer?.liveCategory || session.category || "Live stream");
  const viewerCount = Number(streamer?.liveViewerCount || session.viewerCount || 0);
  const monitor = chatMonitors.get(session.id);
  const emoteDistribution = monitor?.currentEmoteDistribution?.() || null;
  const sourceChatSpike = source?.chatSpike || null;
  const watchWindowTrigger = cleanText(source?.watchWindowTrigger || (sourceChatSpike ? "chat_spike" : ""));
  const watchWindowKeywords = Array.isArray(source?.watchWindowKeywordSignals)
    ? source.watchWindowKeywordSignals
    : [];
  const messagesPerMinute = Number(
    sourceChatSpike?.messagesPerMinute
    || source?.chatSignals?.messagesPerMinute
    || monitor?.currentMessagesPerMinute?.()
    || session.lastChatMessagesPerMinute
    || 0
  );
  const chatSignals = sourceChatSpike
    ? {
        spike: Number(sourceChatSpike.messagesPerWindow || sourceChatSpike.spike || 0),
        messagesPerMinute,
        source: "twitch_irc",
        label: "Real Twitch IRC spike",
        detectedAt: sourceChatSpike.recordedAt || sourceChatSpike.timestamp || null
      }
    : watchWindowTrigger === "chat_keyword" && watchWindowKeywords.length
      ? {
          spike: 0,
          messagesPerMinute,
          source: "twitch_irc_keyword",
          label: `Keyword matched: ${watchWindowKeywords.join(", ")}`
        }
    : messagesPerMinute > 0
      ? {
          spike: Math.round(messagesPerMinute / 6),
          messagesPerMinute,
          source: "twitch_irc_baseline",
          label: "Real Twitch IRC baseline"
        }
      : {
          spike: 0,
          messagesPerMinute: 0,
          source: PROVENANCE.UNAVAILABLE,
          label: capabilities.hasChat ? "No chat spike inside this saved window" : "No chat capture source configured"
        };
  const audioEnergy = source?.audioEnergy || null;
  const audioAvailable = Boolean(audioEnergy?.available);
  const transcriptScore = Number(source?.transcriptScore || 0);
  const transcriptSummary = source?.transcriptSummary || null;
  const emoteHookBonus = emoteDistribution?.dominant === "hype" ? 5 : emoteDistribution?.dominant === "tension" ? 3 : 0;
  const crossStreamEvent = isRecentTimestamp(session.crossStreamEvent?.detectedAt, 90000) ? session.crossStreamEvent : null;
  const crossStreamBoost = Boolean(crossStreamEvent);
  const hookScore = Math.min(
    20,
    10
      + (chatSignals.messagesPerMinute >= 60 ? 5 : 0)
      + (audioEnergy?.isLoudMoment ? 4 : 0)
      + (audioEnergy?.isVoiceExcited ? 3 : 0)
      + Math.round(transcriptScore / 6)
      + emoteHookBonus
  );
  const savedMediaReason = sourceChatSpike || watchWindowTrigger === "chat_keyword"
    ? "Real watcher-buffer video is saved and matched to a Twitch chat spike."
    : watchWindowTrigger === "tension_emote_prediction"
      ? "Real watcher-buffer video is saved from a predictive tension-emote spike before the payoff."
      : watchWindowTrigger.startsWith("eventsub_")
        ? "Real watcher-buffer video is saved from a Twitch EventSub hard trigger."
        : audioEnergy?.isVoiceExcited
          ? "Real watcher-buffer video is saved and streamer voice energy indicates an exciting moment."
          : audioEnergy?.isLoudMoment
            ? "Real watcher-buffer video is saved and audio energy indicates an exciting moment."
            : "Real watcher-buffer video is saved for operator review. No strong chat/audio spike was detected.";
  const base = {
    id: newId("candidate"),
    watchSessionId: session.id,
    clipProfileId: mission.id,
    streamerId: session.streamerId,
    streamerName,
    sessionId: session.id,
    sourceId: source?.id || "",
    sourceType: "live_recording_window",
    sourceProvenance: source?.provenance || PROVENANCE.WATCHER_BUFFER,
    provenance: PROVENANCE.WATCHER_BUFFER,
    creativeProvenance: PROVENANCE.AI_GENERATED,
    recordingWindowIndex: windowIndex,
    recordingWindowSeconds: WATCH_RECORDING_WINDOW_SECONDS,
    liveWindowStartSeconds,
    liveWindowEndSeconds,
    bufferStatus: hasPlayableSource ? "verified_media_window" : "source_pending",
    mediaPlayable: hasPlayableSource,
    timestampStartSeconds: start,
    timestampEndSeconds: end,
    startSeconds: start,
    endSeconds: end,
    timestampStart: secondsToTimestamp(start),
    timestampEnd: secondsToTimestamp(end),
    duration: Math.max(1, end - start),
    durationSeconds: Math.max(1, end - start),
    title: `30s clip window ${windowIndex + 1}: ${streamerName}`,
    category,
    transcriptSnippet: hasPlayableSource
      ? transcriptSummary?.text
        ? transcriptSummary.text
        : `Saved ${Math.max(1, end - start)}s watcher buffer from "${liveTitle}". ${watchWindowTrigger === "chat_keyword" ? "A watched keyword appeared in chat during this window." : sourceChatSpike ? "Twitch chat spiked during this window." : audioEnergy?.isVoiceExcited ? "Streamer voice energy spiked during this window." : audioEnergy?.isLoudMoment ? "Audio energy peaked during this window." : "No spike signal was attached; review the playback before packaging."}`
      : `Agent 101 logged a ${WATCH_RECORDING_WINDOW_SECONDS}-second live watch window from "${liveTitle}". Transcript and video scoring are pending until a playable buffer is attached.`,
    transcriptProvenance: transcriptSummary?.text ? "whisper_cli" : PROVENANCE.UNAVAILABLE,
    transcriptScore,
    transcriptSummary,
    chatSignals,
    emoteDistribution,
    crossStreamBoost,
    crossStreamEvent,
    viewerCount,
    hookScore,
    riskScore: 18,
    audioEnergy,
    audioEnergyDb: source?.audioEnergyDb ?? audioEnergy?.maxVolumeDb ?? null,
    audioMeanDb: source?.audioMeanDb ?? audioEnergy?.meanVolumeDb ?? null,
    isLoudMoment: Boolean(source?.isLoudMoment || audioEnergy?.isLoudMoment),
    watchWindowTrigger,
    reason: hasPlayableSource
      ? savedMediaReason
      : "Agent 101 logged watch telemetry only. Capture or upload a saved video buffer before this can become a Radar clip.",
    measuredEvidence: [
      { label: "Approved streamer monitor", provenance: "watchlist" },
      { label: "Official live metadata checked", provenance: PROVENANCE.VERIFIED_API },
      {
        label: hasPlayableSource ? "Playable source attached" : "Playable source pending",
        provenance: hasPlayableSource ? PROVENANCE.VERIFIED_MEDIA : PROVENANCE.WATCHER_BUFFER
      },
      ...(sourceChatSpike || (watchWindowTrigger === "chat_keyword" && watchWindowKeywords.length)
        ? [{ label: watchWindowKeywords.length ? `Chat keyword: ${watchWindowKeywords.join(", ")}` : "Twitch IRC chat spike", provenance: "twitch_irc" }]
        : []),
      ...(watchWindowTrigger === "tension_emote_prediction" ? [{ label: "Predictive tension emote spike", provenance: "twitch_irc" }] : []),
      ...(transcriptSummary?.text ? [{ label: "Whisper transcript scoring", provenance: "whisper_cli" }] : []),
      ...(audioEnergy?.isVoiceExcited ? [{ label: "Voice-band excitement detected", provenance: "ffmpeg_voice_band" }] : []),
      ...(audioAvailable ? [{ label: "FFmpeg audio energy analysis", provenance: "ffmpeg_volumedetect_v2" }] : []),
      ...(crossStreamBoost ? [{
        type: "cross_stream_event",
        label: "Cross-stream event detected",
        provenance: "watch_session_correlation",
        sessionCount: crossStreamEvent.sessionCount,
        affectedChannels: crossStreamEvent.affectedChannels || []
      }] : [])
    ],
    signals: {
      visualAction: null,
      completePayoff: null,
      deadAir: null,
      menuScreen: null,
      needsScoring: true
    },
    decision: "review",
    decisionReason: hasPlayableSource
      ? "Recording window captured for operator review. Automatic good/bad scoring is the next layer."
      : "Source is live metadata only. Agent 101 is waiting for playable media before quality scoring.",
    status: hasPlayableSource ? "candidate" : "source_pending",
    createdBy: "Agent 101",
    createdAt: now(),
    updatedAt: now()
  };
  const scored = hasPlayableSource
    ? evaluateCandidateQuality(base, mission, capabilities)
    : scoreClipMoment(base);
  return {
    ...base,
    ...scored,
    reason: base.reason,
    decisionReason: hasPlayableSource ? scored.decisionReason : base.decisionReason,
    status: hasPlayableSource ? "candidate" : "source_pending",
    confidence: hasPlayableSource ? scored.confidence : "source pending",
    scoringProvider: hasPlayableSource ? scored.scoringProvider : scored.scoringProvider || "source_pending",
    suggestedHook: watchWindowTrigger === "chat_keyword" && watchWindowKeywords.length
      ? `Keyword-driven moment for ${streamerName}`
      : sourceChatSpike
        ? `Chat popped for ${streamerName}`
        : audioEnergy?.isLoudMoment ? `${streamerName} got loud` : `Review ${streamerName}`,
    suggestedTitle: `${streamerName} live window ${windowIndex + 1}`
  };
}

async function ensureWatchRecordingWindowCandidates(session, { streamer, mission, capabilities, source }) {
  pruneSingleWatchLiveWindowCandidatesForSession(session, "single_watch_candidate_cleanup");
  const existing = recordingWindowCandidatesForSession(session.id);
  const activeExisting = activeLiveRecordingWindowCandidates(session.id);
  const existingIndexes = new Set(existing.map((candidate) => Number(candidate.recordingWindowIndex)).filter(Number.isFinite));
  const activeIndexes = new Set(activeExisting.map((candidate) => Number(candidate.recordingWindowIndex)).filter(Number.isFinite));
  const deletedIndexes = deletedRecordingWindowIndexSet(session);
  const targetIndexes = targetRecordingWindowIndexes(session);
  const activeIndexesArray = Array.from(activeIndexes).filter((value) => Number.isFinite(value));
  const singleWatchWindowMode = shouldTreatAsSingleWatch();
  if (singleWatchWindowMode && activeIndexesArray.length) {
    const keepIndex = Math.max(...activeIndexesArray);
    targetIndexes.splice(0);
    targetIndexes.push(keepIndex);
  }
  const sourceWindowIndex = Number(source?.recordingWindowIndex);
  if (Number.isFinite(sourceWindowIndex) && !targetIndexes.includes(sourceWindowIndex)) {
    targetIndexes.push(sourceWindowIndex);
  }
  const orderedTargetIndexes = Array.from(new Set(targetIndexes)).filter(Number.isFinite).sort((a, b) => Number(b) - Number(a));
  const created = [];
  const nowMs = Date.now();
  const maxPerTick = Math.max(1, Number(config.watchCandidateMaxPerTick || 1));
  const cappedMaxPerTick = singleWatchWindowMode ? 1 : maxPerTick;
  const activeCap = singleWatchWindowMode
    ? 1
    : Math.max(0, Number(config.watchCandidateMaxActivePerSession || 1));
  const maxActiveRemaining = Math.max(0, activeCap - activeExisting.length);
  const unresolvedCandidates = unresolvedLiveRecordingCandidates(session.id);
  const unresolvedCap = singleWatchWindowMode
    ? 1
    : Math.max(0, Number(config.watchCandidateUnresolvedCap || 1));
  const maxUnresolvedRemaining = Math.max(0, unresolvedCap - unresolvedCandidates.length);
  const withinCooldown = config.watchCandidateCooldownMs > 0
    && Number(session.lastWatchCandidateAt || 0) > 0
    && nowMs - Number(session.lastWatchCandidateAt || 0) < Number(config.watchCandidateCooldownMs);
  let candidatesToCreate = Math.max(0, Math.min(cappedMaxPerTick, maxActiveRemaining, maxUnresolvedRemaining));
  if (withinCooldown || candidatesToCreate <= 0) return existing;
  let telemetryUpdated = false;
  for (const index of orderedTargetIndexes) {
    if (candidatesToCreate <= 0) break;
    if (existingIndexes.has(index)) continue;
    if (deletedIndexes.has(index)) continue;
    const sourceMatchesIndex = source?.sourceType !== "watcher_buffer"
      || (source?.watchSessionId === session.id && Number(source?.recordingWindowIndex) === Number(index));
    if (!capabilities.hasLiveVideo || !source?.filePath || !sourceMatchesIndex) {
      const previousTelemetry = (session.recordingWindows || []).find((item) => Number(item.index) === Number(index));
      const telemetry = upsertRecordingWindowTelemetry(session, {
        index,
        startSeconds: index * WATCH_RECORDING_WINDOW_SECONDS,
        endSeconds: (index + 1) * WATCH_RECORDING_WINDOW_SECONDS,
        durationSeconds: WATCH_RECORDING_WINDOW_SECONDS,
        status: session.captureStatus === "blocked" ? "capture_blocked" : session.captureStatus === "capturing" ? "capturing" : "awaiting_source",
        message: !sourceMatchesIndex && capabilities.hasLiveVideo
          ? "Waiting for this exact watch window to be captured."
          : session.captureMessage || "Waiting for the local recorder to attach a playable video buffer."
      });
      telemetryUpdated = Boolean(telemetry) || telemetryUpdated;
      if (!previousTelemetry || previousTelemetry.status !== telemetry?.status || previousTelemetry.message !== telemetry?.message) {
        await appendWatchEvent(session.id, "recording_window_waiting_for_source", {
          windowId: telemetry?.id || "",
          recordingWindowIndex: index,
          startSeconds: telemetry?.startSeconds,
          endSeconds: telemetry?.endSeconds,
          status: telemetry?.status,
          message: telemetry?.message
        });
      }
      continue;
    }
    const candidate = buildWatchRecordingCandidate(session, { streamer, mission, capabilities, source, windowIndex: index });
    const watchWindowTrigger = cleanText(candidate.watchWindowTrigger || source?.watchWindowTrigger || "");
    const candidateScore = Number(candidate.score || 0);
    const triggerCanCreateCandidate = ["chat_spike", "chat_keyword", "tension_emote_prediction"].includes(watchWindowTrigger)
      || watchWindowTrigger.startsWith("eventsub_");
    if (!triggerCanCreateCandidate && source?.sourceType === "watcher_buffer") {
      upsertRecordingWindowTelemetry(session, {
        index,
        startSeconds: candidate.liveWindowStartSeconds,
        endSeconds: candidate.liveWindowEndSeconds,
        durationSeconds: WATCH_RECORDING_WINDOW_SECONDS,
        status: "source_pending",
        message: "Watch window skipped because trigger was not a chat spike or keyword match."
      });
      await appendWatchEvent(session.id, "recording_window_skipped", {
        candidateId: `${session.id}:${index}`,
        reason: "Window skipped to avoid low-quality auto-capture noise.",
        watchWindowTrigger
      });
      continue;
    }
    if (Number.isFinite(candidateScore) && candidateScore < config.twitchClipMinScore) {
      candidate.lowSignalReview = true;
      candidate.decision = candidate.decision === "accepted" ? "review" : candidate.decision;
      candidate.decisionReason = `${candidate.decisionReason || "Saved MP4 needs operator review."} Signal is ${candidateScore}/${config.twitchClipMinScore}, so it will not auto-stage.`;
      await appendWatchEvent(session.id, "recording_window_low_score", {
        candidateId: candidate.id,
        sourceId: candidate.sourceId,
        score: candidateScore,
        minScore: config.twitchClipMinScore,
        message: "Saved MP4 is visible for review but below the auto-stage threshold."
      });
    }
    state.clipCandidates.unshift(candidate);
    candidatesToCreate -= 1;
    session.lastWatchCandidateAt = nowMs;
    upsertRecordingWindowTelemetry(session, {
      index,
      startSeconds: candidate.liveWindowStartSeconds,
      endSeconds: candidate.liveWindowEndSeconds,
      durationSeconds: WATCH_RECORDING_WINDOW_SECONDS,
      status: "source_ready",
      sourceId: candidate.sourceId,
      candidateId: candidate.id,
      message: "Saved local buffer is now a Clip Radar candidate."
    });
    created.push(candidate);
    await appendWatchEvent(session.id, "recording_window_created", {
      candidateId: candidate.id,
      title: candidate.title,
      startSeconds: candidate.startSeconds,
      endSeconds: candidate.endSeconds,
      windowSeconds: WATCH_RECORDING_WINDOW_SECONDS,
      bufferStatus: candidate.bufferStatus,
      message: "Agent 101 logged a 30-second clip window for later scoring."
    });
    await appendWatchEvent(session.id, "candidate_review", {
      candidateId: candidate.id,
      title: candidate.title,
      score: candidate.score,
      reason: candidate.decisionReason
    });
    if (candidate.decision === "accepted" && Number(candidate.score || 0) >= config.twitchClipMinScore) {
      await createOfficialTwitchClip(streamer, candidate);
    }
  }
  if (created.length) {
    const sessionCandidates = state.clipCandidates.filter((candidate) => candidate.watchSessionId === session.id);
    session.candidatesDetected = sessionCandidates.length;
    session.candidatesReview = sessionCandidates.filter((candidate) => candidate.decision === "review").length;
    session.lastCandidateAt = now();
    session.currentStage = `Recording ${WATCH_RECORDING_WINDOW_SECONDS}s clip windows`;
    session.updatedAt = now();
    await logEvent("recording_windows_created", "Agent 101 created 30-second watch windows", {
      sessionId: session.id,
      streamerId: session.streamerId,
      created: created.length,
      total: session.candidatesDetected,
      windowSeconds: WATCH_RECORDING_WINDOW_SECONDS,
      sourcePending: !capabilities.hasLiveVideo
    });
    await saveState();
  } else if (telemetryUpdated) {
    session.currentStage = session.captureStatus === "capturing" ? "Saving local clip buffer" : "Waiting for local clip recorder";
    session.updatedAt = now();
    await saveState();
  }
  return [...created, ...existing];
}

async function ensureActiveWatchSessionCandidateCoverage(reason = "api_refresh") {
  const created = [];
  if (shouldTreatAsSingleWatch()) {
    const preferredStreamerId = preferredSingleWatchTarget();
    if (preferredStreamerId) await enforceSingleWatchedStreamer(preferredStreamerId, `${reason}_single_watch_enforcement`);
  }
  const migrated = migrateMetadataOnlyRecordingWindowsOutOfRadar(reason);
  if (migrated) await saveState();
  for (const session of activeWatchSessions()) {
    if (!isWatchSessionActive(session) || session.status === "paused") continue;
    const beforeIds = new Set(state.clipCandidates.map((candidate) => candidate.id));
    pruneLiveWindowsForStreamerBeforeWatchStart(session.streamerId, reason, session.id, { forceSingleWatch: true });
    startWatchWorker(session.id);
    await ensureWatchSessionCandidates(session);
    const newCandidates = state.clipCandidates.filter((candidate) =>
      candidate.watchSessionId === session.id && !beforeIds.has(candidate.id)
    );
    if (!newCandidates.length) continue;
    created.push(...newCandidates);
    const windowIndexes = newCandidates.map((candidate) => Number(candidate.recordingWindowIndex)).filter(Number.isFinite);
    await appendWatchEvent(session.id, "candidate_coverage_repaired", {
      reason,
      created: newCandidates.length,
      newestWindowIndex: windowIndexes.length ? Math.max(...windowIndexes) : null,
      message: "Active monitor had missing current recording windows, so Agent 101 restored live Clip Radar coverage."
    });
  }
  if (created.length) await saveState();
  return created;
}

async function claimWatchSession(session) {
  if (!session || TERMINAL_WATCH_STATUSES.has(session.status) || session.status === "paused") return false;
  const leaseExpiresAt = session.leaseExpiresAt ? new Date(session.leaseExpiresAt).getTime() : 0;
  const claimedByOther = session.workerId && session.workerId !== WATCH_WORKER_ID && leaseExpiresAt > Date.now();
  if (claimedByOther) return false;
  const streamer = state.streamers.find((item) => item.id === session.streamerId);
  const source = state.mediaSources.find((item) => item.id === session.sourceId);
  const capabilities = capabilitiesForWatchSource({ session, source, streamer });
  const previousStatus = session.status;
  const previousWorkerId = session.workerId;
  const previousConnectedAt = session.connectedAt;
  const nextStatus = capabilities.hasLiveVideo ? "watching" : "degraded";
  Object.assign(session, {
    workerId: WATCH_WORKER_ID,
    heartbeatAt: now(),
    leaseExpiresAt: new Date(Date.now() + WATCH_LEASE_MS).toISOString(),
    connectedAt: session.connectedAt || now(),
    lastMediaAt: capabilities.hasLiveVideo ? now() : session.lastMediaAt,
    status: nextStatus,
    currentStage: capabilities.hasLiveVideo ? "Analyzing verified media" : "Metadata-only monitoring",
    updatedAt: now()
  });
  if (!previousConnectedAt || previousStatus !== nextStatus || previousWorkerId !== WATCH_WORKER_ID) {
    await appendWatchEvent(session.id, capabilities.hasLiveVideo ? "source_connected" : "source_capability_degraded", {
      status: session.status,
      capabilities,
      message: capabilities.reason
    });
  }
  await saveState();
  return true;
}

function stopWatchWorkerTimer(sessionId) {
  const timer = watchWorkerTimers.get(sessionId);
  if (timer) clearTimeout(timer);
  watchWorkerTimers.delete(sessionId);
  watchWorkerBusy.delete(sessionId);
}

async function runWatchWorkerTick(sessionId) {
  if (watchWorkerBusy.has(sessionId)) return;
  watchWorkerBusy.add(sessionId);
  try {
    const session = state.watchSessions.find((item) => item.id === sessionId);
    if (!session || TERMINAL_WATCH_STATUSES.has(session.status) || session.status === "paused") {
      stopWatchWorkerTimer(sessionId);
      stopChatMonitorForSession(sessionId);
      return;
    }
    if (!(await claimWatchSession(session))) return;
    let capabilities = state.sourceCapabilities.find((item) => item.watchSessionId === session.id) || null;
    session.heartbeatAt = now();
    session.leaseExpiresAt = new Date(Date.now() + WATCH_LEASE_MS).toISOString();
    session.analyzedSeconds = Number(session.analyzedSeconds || 0) + Math.round(WATCH_TICK_MS / 1000);
    session.lastMediaAt = capabilities?.hasLiveVideo ? now() : session.lastMediaAt;
    session.updatedAt = now();
    const streamer = state.streamers.find((item) => item.id === session.streamerId);
    const lastLiveCheckMs = session.lastOfficialLiveCheckAt ? Date.parse(session.lastOfficialLiveCheckAt) || 0 : 0;
    if (streamer && ["twitch", "kick"].includes(streamer.platform) && Date.now() - lastLiveCheckMs > 60000) {
      session.lastOfficialLiveCheckAt = now();
      try {
        const liveCheck = await checkStreamerLive(streamer);
        if (liveCheck.live === false) {
          await appendWatchEvent(session.id, "stream_offline_detected", {
            streamerId: streamer.id,
            provider: streamer.platform,
            message: "Official provider check says the streamer is offline. Watcher stopped to avoid wasted work."
          });
          await stopWatchSession(session.id, "stream_ended", { reason: "provider_offline" });
          return;
        }
      } catch (error) {
        await appendWatchEvent(session.id, "stream_live_check_failed", {
          streamerId: streamer.id,
          provider: streamer.platform,
          message: error.message
        });
      }
    }
    await appendWatchEvent(session.id, "watcher_heartbeat", {
      heartbeatAt: session.heartbeatAt,
      workerId: session.workerId,
      analyzedSeconds: session.analyzedSeconds,
      health: watchSessionHealth(session)
    });
    const recentTension = isRecentTimestamp(session.tensionDetectedAt, 45000);
    if (recentTension) {
      session.lastCaptureTrigger = "tension_emote_prediction";
      session.lastCaptureTriggerAt = now();
    }
    const crossStreamEvent = detectCrossStreamEvent();
    if (crossStreamEvent.isCrossStreamEvent) {
      session.crossStreamEvent = crossStreamEvent;
      await appendWatchEvent(session.id, "cross_stream_event_detected", {
        sessionCount: crossStreamEvent.sessionCount,
        affectedSessionIds: crossStreamEvent.affectedSessionIds,
        affectedChannels: crossStreamEvent.affectedChannels || [],
        message: "Cross-stream spike detected. Candidate scoring will receive an external-event boost."
      });
      await broadcastCrossStreamEvent(crossStreamEvent);
    }
    if (capabilities?.hasLiveVideo && Number(session.candidatesDetected || 0) === 0) {
      await appendWatchEvent(session.id, "signal_detected", {
        signal: "verified_media_ready",
        message: "Verified backend media is ready for quality-gated candidate evaluation."
      });
    }
    let capturedSource = null;
    if (!capabilities?.hasLiveVideo) {
      const mission = state.clipMissions.find((item) => item.id === session.clipProfileId || item.id === session.missionId) || ensureClipMission(streamer);
      capturedSource = await maybeCaptureCurrentWatchWindow(session, { streamer, mission });
      if (capturedSource) {
        capabilities = capabilitiesForWatchSource({ session, source: capturedSource, streamer });
      }
    }
    await ensureWatchSessionCandidates(session);
    if (capturedSource) await autoStageCapturedCandidatesForBuilder(session, capturedSource, session.lastCaptureTrigger || "watch_capture");
    await saveState();
  } finally {
    watchWorkerBusy.delete(sessionId);
    const session = state.watchSessions.find((item) => item.id === sessionId);
    if (session && isWatchSessionActive(session)) {
      stopWatchWorkerTimer(sessionId);
      watchWorkerTimers.set(sessionId, setTimeout(() => runWatchWorkerTick(sessionId).catch((error) => {
        addStateLog("watch_worker_error", "Watch worker tick failed", { sessionId, error: error.message });
      }), WATCH_TICK_MS));
    }
  }
}

function startWatchWorker(sessionId) {
  if (watchWorkerTimers.has(sessionId)) return;
  const session = state.watchSessions.find((item) => item.id === sessionId);
  if (session) {
    startChatMonitorForSession(session);
    if (session.mode === "real") {
      const streamer = findStreamer(session.streamerId);
      subscribeToEventSub(streamer).catch((error) => {
        addStateLog("eventsub_subscribe_error", "Twitch EventSub subscription setup failed", {
          sessionId,
          streamerId: streamer?.id || "",
          error: error.message
        });
      });
    }
  }
  watchWorkerTimers.set(sessionId, setTimeout(() => runWatchWorkerTick(sessionId).catch((error) => {
    addStateLog("watch_worker_error", "Watch worker failed", { sessionId, error: error.message });
  }), 250));
}

async function startWatchSession(body = {}) {
  const mode = normalizeStatus(body.mode || "real", ["real", "demo"], "real");
  const userId = cleanText(body.userId) || "local-owner";
  const threadId = cleanText(body.threadId) || "agent101-main";
  const idempotencyKey = cleanText(body.idempotencyKey) || "";
  let streamer = state.streamers.find((item) => item.id === cleanText(body.streamerId)) || null;
  let source = state.mediaSources.find((item) => item.id === cleanText(body.sourceId)) || null;

  if (mode === "demo") {
    const practice = await ensurePracticeProject();
    source = state.mediaSources.find((item) => item.id === practice.source.id) || state.mediaSources.find((item) => item.id === DEMO_MEDIA_SOURCE_ID);
    streamer = state.streamers.find((item) => item.id === DEMO_STREAMER_ID);
    if (!streamer) {
      streamer = {
        id: DEMO_STREAMER_ID,
        displayName: "Practice Media Source",
        platform: "demo",
        channelId: "demo-media-source",
        channelUrl: "",
        permissionStatus: "demo_approved",
        allowedUse: ["practice_workflow"],
        monitorEnabled: true,
        isDemo: true,
        liveStatus: "demo_source",
        liveStatusReason: "Bundled practice media is available to the backend worker.",
        notes: "Practice-only media source for local StreamClipper watcher validation. Not real streamer permission.",
        createdAt: now(),
        updatedAt: now()
      };
      state.streamers.unshift(streamer);
    }
  } else if (!streamer) {
    streamer = state.streamers.find((item) => item.monitorEnabled && isRealApprovedStreamer(item)) || null;
  }
  if (!streamer) throw Object.assign(new Error("Choose an approved streamer before starting a watch session."), { statusCode: 400 });

  const profile = ensureStreamerClipProfile(streamer);
  const mission = ensureClipMission(streamer, profile);
  const existing = findReusableActiveWatchSession({
    streamerId: streamer.id,
    clipProfileId: mission.id,
    mode,
    idempotencyKey
  });
  if (existing) {
    pruneLiveWindowsForStreamerBeforeWatchStart(streamer.id, "watch_session_reused", existing.id, { forceSingleWatch: true });
    purgeUnresolvedLiveWindowCandidatesForSession(existing, "watch_session_reused");
    if (mode === "real") await enforceSingleWatchedStreamer(streamer.id, "watch_session_reused");
    startWatchWorker(existing.id);
    return { session: publicWatchSession(existing), reused: true, events: watchEventsFor(existing.id), summary: watchSessionSummary(existing) };
  }

  pruneLiveWindowsForStreamerBeforeWatchStart(streamer.id, "watch_session_start", "", { forceSingleWatch: true });

  if (mode === "real") {
    streamer.monitorEnabled = true;
    streamer.monitorPausedAt = null;
    if (!isRealApprovedStreamer(streamer)) {
      throw Object.assign(new Error("Real watch requires an approved, monitored streamer."), { statusCode: 403 });
    }
    const liveCheck = await checkStreamerLive(streamer).catch((error) => ({
      live: false,
      official: Boolean(streamer.platform === "twitch" || streamer.platform === "kick"),
      reason: error.message
    }));
    if (!liveCheck?.stream) {
      await stopOfflineWatchSessionsForStreamer(streamer, liveCheck?.reason || "live_check_not_live");
      throw Object.assign(new Error(liveCheck?.reason || "Streamer is offline. Watcher was not started."), {
        statusCode: liveCheck?.official ? 409 : 400
      });
    }
    streamer.liveStatus = "live";
    streamer.liveTitle = liveCheck.stream.title || streamer.liveTitle;
    streamer.liveCategory = liveCheck.stream.game_name || streamer.liveCategory;
    streamer.liveViewerCount = Number(liveCheck.stream.viewer_count || streamer.liveViewerCount || 0);
    streamer.lastCheckedAt = now();
    await enforceSingleWatchedStreamer(streamer.id, "watch_session_start");
  }

  const created = now();
  const session = {
    id: newId("watch_session"),
    userId,
    threadId,
    streamerId: streamer.id,
    streamerName: streamer.displayName,
    sourceId: source?.id || null,
    clipProfileId: mission.id,
    missionId: mission.id,
    missionName: mission.name,
    mode,
    idempotencyKey,
    status: "queued",
    workerId: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    startedAt: created,
    connectedAt: null,
    lastMediaAt: null,
    lastSignalAt: null,
    lastCandidateAt: null,
    lastWatchCandidateAt: 0,
    stoppedAt: null,
    reconnectCount: 0,
    analyzedSeconds: 0,
    candidatesDetected: 0,
    candidatesAccepted: 0,
    candidatesRejected: 0,
    clipsRendered: 0,
    errorCode: null,
    errorMessage: null,
    currentStage: "Queued",
    createdAt: created,
    updatedAt: created
  };
  state.watchSessions.unshift(session);
  capabilitiesForWatchSource({ session, source, streamer });
  await appendWatchEvent(session.id, "session_started", {
    streamerId: streamer.id,
    streamerName: streamer.displayName,
    mode,
    workerId: WATCH_WORKER_ID,
    mission
  });
  await logEvent("watch_session_started", "Backend watch session started", {
    sessionId: session.id,
    streamerId: streamer.id,
    mode,
    sourceId: source?.id || null
  });
  startWatchWorker(session.id);
  await saveState();
  return { session: publicWatchSession(session), reused: false, events: watchEventsFor(session.id), summary: watchSessionSummary(session) };
}

async function pauseWatchSession(sessionId) {
  const session = state.watchSessions.find((item) => item.id === sessionId);
  if (!session) throw Object.assign(new Error("Watch session not found"), { statusCode: 404 });
  session.status = "paused";
  session.workerId = null;
  session.leaseExpiresAt = null;
  session.updatedAt = now();
  stopWatchWorkerTimer(session.id);
  stopChatMonitorForSession(session.id);
  await appendWatchEvent(session.id, "session_paused", { reason: "operator_pause" });
  return publicWatchSession(session);
}

async function resumeWatchSession(sessionId) {
  const session = state.watchSessions.find((item) => item.id === sessionId);
  if (!session) throw Object.assign(new Error("Watch session not found"), { statusCode: 404 });
  if (TERMINAL_WATCH_STATUSES.has(session.status)) throw Object.assign(new Error("Terminal sessions cannot be resumed."), { statusCode: 409 });
  session.status = "reconnecting";
  session.workerId = null;
  session.reconnectCount = Number(session.reconnectCount || 0) + 1;
  session.updatedAt = now();
  await appendWatchEvent(session.id, "session_resumed", { reconnectCount: session.reconnectCount });
  startWatchWorker(session.id);
  await saveState();
  return publicWatchSession(session);
}

async function stopWatchSession(sessionId, status = "cancelled", details = {}) {
  const session = state.watchSessions.find((item) => item.id === sessionId);
  if (!session) throw Object.assign(new Error("Watch session not found"), { statusCode: 404 });
  session.status = status;
  session.workerId = null;
  session.leaseExpiresAt = null;
  session.stoppedAt = now();
  session.updatedAt = now();
  stopWatchWorkerTimer(session.id);
  stopChatMonitorForSession(session.id);
  const streamer = findStreamer(session.streamerId);
  if (streamer) {
    if (details.operatorAction || /^operator_stop/.test(String(details.reason || ""))) {
      streamer.monitorEnabled = false;
      streamer.monitorPausedAt = now();
      streamer.updatedAt = now();
    }
    await unsubscribeEventSub(streamer).catch((error) => {
      addStateLog("eventsub_unsubscribe_error", "Twitch EventSub unsubscribe failed", {
        sessionId: session.id,
        streamerId: streamer.id,
        error: error.message
      });
    });
  }
  await appendWatchEvent(session.id, status === "stream_ended" ? "stream_ended" : "session_stopped", { status, ...details });
  await saveState();
  return publicWatchSession(session);
}

async function stopOtherActiveWatchSessions(preferredSessionId = "", reason = "operator_stop_single_watch") {
  const preferredId = cleanText(preferredSessionId);
  const stoppedSessions = [];
  const sessions = activeWatchSessions().filter((session) => session.id !== preferredId);
  for (const session of sessions) {
    const stopped = await stopWatchSession(session.id, "cancelled", {
      reason,
      operatorAction: true,
      preferredSessionId: preferredId,
      message: "Stopped because the operator stopped the single-agent watch loop."
    });
    stoppedSessions.push(stopped);
  }
  return stoppedSessions;
}

async function enforceSingleWatchedStreamer(preferredStreamerId = "", reason = "single_stream_limit") {
  const preferredId = cleanText(preferredStreamerId);
  const stoppedSessions = [];
  const pausedStreamers = [];
  for (const streamer of state.streamers || []) {
    if (preferredId && streamer.id === preferredId) continue;
    if (!streamer.monitorEnabled) continue;
    streamer.monitorEnabled = false;
    streamer.monitorPausedAt = now();
    streamer.updatedAt = now();
    pausedStreamers.push(streamer.id);
  }
  const sessions = activeWatchSessions().filter((session) => !preferredId || session.streamerId !== preferredId);
  for (const session of sessions) {
    const stopped = await stopWatchSession(session.id, "cancelled", {
      reason,
      preferredStreamerId: preferredId,
      message: "Stopped because StreamClipper now watches only one streamer at a time."
    });
    stoppedSessions.push(stopped.id || session.id);
  }
  if (pausedStreamers.length || stoppedSessions.length) {
    await logEvent("single_stream_enforced", "Paused extra stream monitors so only one streamer is watched", {
      preferredStreamerId: preferredId,
      reason,
      pausedStreamers,
      stoppedSessions
    });
  }
  return { pausedStreamers, stoppedSessions };
}

async function stopOfflineWatchSessionsForStreamer(streamer, reason = "provider_offline") {
  if (!streamer?.id) return [];
  const sessions = activeWatchSessions().filter((session) => session.streamerId === streamer.id);
  const stopped = [];
  for (const session of sessions) {
    const publicSession = await stopWatchSession(session.id, "stream_ended", {
      reason,
      streamerId: streamer.id,
      provider: streamer.platform,
      message: "Provider API reported the streamer offline, so the local watch loop stopped."
    });
    stopped.push(publicSession);
  }
  if (stopped.length) {
    await logEvent("watch_stopped_offline", "Stopped watch sessions for offline streamer", {
      streamerId: streamer.id,
      streamerName: streamer.displayName,
      provider: streamer.platform,
      stopped: stopped.length,
      reason
    });
  }
  return stopped;
}

async function removeStreamerFromWatchlist(streamerId, reason = "operator_delete_streamer") {
  const id = cleanText(streamerId);
  const index = state.streamers.findIndex((streamer) => streamer.id === id);
  if (index < 0) {
    const error = new Error("Streamer not found");
    error.statusCode = 404;
    throw error;
  }
  const [removed] = state.streamers.splice(index, 1);
  const stoppedSessions = [];
  const sessions = activeWatchSessions().filter((session) => session.streamerId === removed.id);
  for (const session of sessions) {
    const stopped = await stopWatchSession(session.id, "cancelled", {
      reason,
      streamerId: removed.id,
      message: "Stopped because the streamer was removed from the watchlist."
    });
    stoppedSessions.push(stopped.id || session.id);
  }
  await unsubscribeEventSub(removed).catch((error) => {
    addStateLog("eventsub_unsubscribe_error", "Twitch EventSub unsubscribe failed during streamer delete", {
      streamerId: removed.id,
      error: error.message
    });
  });
  await logEvent("streamer_deleted", "Streamer removed from watchlist", {
    streamerId: removed.id,
    streamerName: removed.displayName || "",
    stoppedSessions: stoppedSessions.length,
    reason
  });
  return { deleted: true, streamer: removed, streamerId: removed.id, stoppedSessions };
}

async function recoverWatchSessions() {
  const recoverable = state.watchSessions.filter((session) => ACTIVE_WATCH_STATUSES.has(session.status));
  for (const session of recoverable) {
    const leaseExpired = !session.leaseExpiresAt || new Date(session.leaseExpiresAt).getTime() < Date.now();
    const staleHeartbeat = !session.heartbeatAt || Date.now() - new Date(session.heartbeatAt).getTime() > WATCH_HEARTBEAT_STALE_MS;
    if (leaseExpired || staleHeartbeat || session.workerId === WATCH_WORKER_ID) {
      session.status = "reconnecting";
      session.workerId = null;
      session.leaseExpiresAt = null;
      session.reconnectCount = Number(session.reconnectCount || 0) + 1;
      session.updatedAt = now();
      await appendWatchEvent(session.id, "reconnecting", {
        reason: "backend_startup_recovery",
        reconnectCount: session.reconnectCount
      });
      startWatchWorker(session.id);
    }
  }
  await saveState();
}

async function recoverApprovedLiveMonitors() {
  for (const streamer of state.streamers || []) {
    const shouldRecover = streamer.permissionStatus === "approved"
      && ["twitch", "kick"].includes(streamer.platform)
      && liveProviderConfigured(streamer.platform)
      && streamer.liveStatus === "live"
      && !streamer.monitorEnabled
      && !streamer.monitorPausedAt;
    if (!shouldRecover) continue;
    try {
      assertWatchCapacity({ monitorEnabled: true, permissionStatus: "approved", excludeId: streamer.id });
      streamer.monitorEnabled = true;
      streamer.updatedAt = now();
      await logEvent("watch_auto_enabled", "Approved live streamer monitoring recovered on startup", {
        streamerId: streamer.id
      });
      await startLiveWatchForApprovedStreamer(streamer, "startup_recovery");
    } catch (error) {
      await logEvent("watch_auto_start_blocked", "Startup recovery could not enable approved live monitor", {
        streamerId: streamer.id,
        error: error.message
      });
    }
  }
  await saveState();
}

async function readRawBody(req, limitBytes = config.maxUploadBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) {
      const error = new Error("Upload is too large for this StreamClipper workspace.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function bufferSplit(buffer, delimiter) {
  const parts = [];
  let start = 0;
  let index = buffer.indexOf(delimiter, start);
  while (index !== -1) {
    parts.push(buffer.slice(start, index));
    start = index + delimiter.length;
    index = buffer.indexOf(delimiter, start);
  }
  parts.push(buffer.slice(start));
  return parts;
}

function parseMultipartBody(buffer, contentType) {
  const boundaryMatch = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    const error = new Error("Upload must use multipart/form-data.");
    error.statusCode = 400;
    throw error;
  }
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const fields = {};
  const files = {};
  for (const rawPart of bufferSplit(buffer, boundary)) {
    let part = rawPart;
    if (part.length < 6 || part.includes(Buffer.from("--")) && part.toString("latin1").trim() === "--") continue;
    if (part.slice(0, 2).toString("latin1") === "\r\n") part = part.slice(2);
    if (part.slice(-2).toString("latin1") === "\r\n") part = part.slice(0, -2);
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) continue;
    const headerText = part.slice(0, headerEnd).toString("latin1");
    const content = part.slice(headerEnd + 4);
    const disposition = headerText.match(/content-disposition:\s*form-data;\s*([^\r\n]+)/i)?.[1] || "";
    const name = disposition.match(/name="([^"]+)"/i)?.[1];
    if (!name) continue;
    const filename = disposition.match(/filename="([^"]*)"/i)?.[1];
    const mimeType = headerText.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || "";
    if (filename !== undefined) {
      files[name] = { filename, mimeType, buffer: content };
    } else {
      fields[name] = content.toString("utf8");
    }
  }
  return { fields, files };
}

function publicConfig() {
  return {
    aiProvider: config.aiProvider,
    aiMode: config.aiMode,
    openaiModel: config.openaiModel,
    openaiConfigured: Boolean(config.openaiApiKey),
    anthropicModel: config.anthropicModel,
    anthropicConfigured: Boolean(config.anthropicApiKey),
    agent101OutputDirConfigured: Boolean(config.agent101OutputDir),
    webSearchConfigured: Boolean(config.braveApiKey || config.serpApiKey),
    imageGenerationConfigured: Boolean(config.dalleApiKey || config.openaiApiKey),
    openaiTestBudgetUsd: config.openaiTestBudgetUsd,
    twitchConfigured: twitchApiConfigured(),
    twitchRedirectConfigured: Boolean(config.twitchRedirectUri),
    twitchOAuthTokenConfigured: Boolean(config.twitchOAuthToken),
    twitchAllowedChannels: config.twitchAllowedChannels,
    kickConfigured: kickApiConfigured(),
    kickOAuthTokenConfigured: Boolean(config.kickOAuthToken),
    postDailyLimit: config.postDailyLimit,
    singleWatchMode: config.singleWatchMode,
    maxWatchedStreamers: config.maxWatchedStreamers,
    watchCandidateUnresolvedCap: config.watchCandidateUnresolvedCap,
    watchTriggerKeywords: config.watchTriggerKeywords,
    chatSpikeThreshold: config.chatSpikeThreshold,
    chatWindowMs: config.chatWindowMs,
    recordingWindowSeconds: WATCH_RECORDING_WINDOW_SECONDS,
    streamWatchMode: config.singleWatchMode ? "single" : "pooled",
    streamWatchCapacity: watchCapacity(),
    browserEnabled: config.browserEnabled,
    browserMode: config.browserHeadless ? "headless_screenshot" : "headed_local",
    browserViewport: config.browserViewport,
    capcutManualHandoff: Boolean(config.capcutHandoffUrl),
    capcutAgentConfigured: Boolean(config.capcutHandoffUrl && config.browserEnabled),
    capcutDownloadDirConfigured: Boolean(config.capcutDownloadDir),
    objectStorageConfigured: Boolean(config.objectStorageBucket),
    uploadDir: config.uploadDir,
    watchBufferDir: config.watchBufferDir,
    clipsFolder: config.watchBufferDir,
    outputDir: config.outputDir
  };
}

function latestRecord(items, timeKeys = ["updatedAt", "createdAt", "timestamp"]) {
  return [...(items || [])].sort((a, b) => {
    const aTime = timeKeys.map((key) => Date.parse(a?.[key] || "") || 0).find(Boolean) || 0;
    const bTime = timeKeys.map((key) => Date.parse(b?.[key] || "") || 0).find(Boolean) || 0;
    return bTime - aTime;
  })[0] || null;
}

function isPracticeStreamer(streamer) {
  return Boolean(
    streamer?.isDemo
    || streamer?.permissionStatus === "demo_approved"
    || streamer?.platform === "demo"
    || /demo|practice/i.test(`${streamer?.id || ""} ${streamer?.sourceMode || ""}`)
  );
}

function watchedStreamerCount(excludeId = "") {
  return state.streamers.filter((streamer) => (
    streamer?.id !== excludeId
    && streamer?.monitorEnabled
    && isApprovedStreamer(streamer)
    && !isPracticeStreamer(streamer)
  )).length;
}

function watchCapacity(excludeId = "") {
  const watching = watchedStreamerCount(excludeId);
  const streamWatchModeHint = String(config.streamWatchMode || "").toLowerCase().trim();
  const hasExplicitWatchMode = streamWatchModeHint === "single" || streamWatchModeHint === "pooled";
  const enforceSingleWatch = hasExplicitWatchMode
    ? streamWatchModeHint === "single"
    : config.singleWatchMode !== false;
  const limit = enforceSingleWatch ? 1 : config.maxWatchedStreamers;
  return {
    watching,
    limit,
    remaining: Math.max(0, limit - watching),
    atLimit: watching >= limit
  };
}

function assertWatchCapacity({ monitorEnabled, permissionStatus = "approved", excludeId = "" } = {}) {
  if (!monitorEnabled || permissionStatus !== "approved") return;
  const capacity = watchCapacity(excludeId);
  if (capacity.atLimit) {
    const error = new Error(`Stream watch capacity reached (${capacity.watching}/${capacity.limit}). Pause another monitored stream before adding more.`);
    error.statusCode = 409;
    error.details = capacity;
    throw error;
  }
}

function isPracticeSource(source) {
  return Boolean(
    source?.provenance === PROVENANCE.DEMO_SOURCE
    || source?.sourceKind === "demo_media"
    || source?.sourceType === "practice"
    || source?.mode === "practice"
    || /demo|practice/i.test(`${source?.id || ""} ${source?.label || ""}`)
  );
}

function practiceReferenceSets() {
  const streamerIds = new Set((state.streamers || []).filter(isPracticeStreamer).map((item) => item.id));
  const sourceIds = new Set((state.mediaSources || []).filter(isPracticeSource).map((item) => item.id));
  const sessionIds = new Set((state.streamSessions || [])
    .filter((item) => streamerIds.has(item.streamerId) || /demo|practice/i.test(`${item.status || ""} ${item.mode || ""}`))
    .map((item) => item.id));
  const watchSessionIds = new Set((state.watchSessions || [])
    .filter((item) => item.mode === "demo" || streamerIds.has(item.streamerId) || sourceIds.has(item.sourceId))
    .map((item) => item.id));
  const candidateIds = new Set((state.clipCandidates || [])
    .filter((item) => (
      item.provenance === PROVENANCE.DEMO_SOURCE
      || item.sourceProvenance === PROVENANCE.DEMO_SOURCE
      || streamerIds.has(item.streamerId)
      || sessionIds.has(item.sessionId)
      || watchSessionIds.has(item.watchSessionId)
      || sourceIds.has(item.sourceId)
      || /demo|practice/i.test(`${item.sourceType || ""} ${item.id || ""}`)
    ))
    .map((item) => item.id));
  const packageIds = new Set((state.clipPackages || [])
    .filter((item) => candidateIds.has(item.candidateId))
    .map((item) => item.id));
  const draftIds = new Set((state.postingDrafts || [])
    .filter((item) => packageIds.has(item.clipPackageId))
    .map((item) => item.id));
  return { streamerIds, sourceIds, sessionIds, watchSessionIds, candidateIds, packageIds, draftIds };
}

function modeCount(items, isPractice) {
  const rows = items || [];
  const practice = rows.filter(isPractice).length;
  return { real: rows.length - practice, practice, total: rows.length };
}

function productionModeSummary() {
  const refs = practiceReferenceSets();
  return {
    streamers: modeCount(state.streamers, (item) => refs.streamerIds.has(item.id)),
    streamSessions: modeCount(state.streamSessions, (item) => refs.sessionIds.has(item.id)),
    watchSessions: modeCount(state.watchSessions, (item) => refs.watchSessionIds.has(item.id)),
    mediaSources: modeCount(state.mediaSources, (item) => refs.sourceIds.has(item.id)),
    clipCandidates: modeCount(state.clipCandidates, (item) => refs.candidateIds.has(item.id)),
    clipPackages: modeCount(state.clipPackages, (item) => refs.packageIds.has(item.id)),
    postingDrafts: modeCount(state.postingDrafts, (item) => refs.draftIds.has(item.id)),
    approvals: modeCount(state.approvalRequests, (item) => (
      refs.draftIds.has(item.linkedId)
      || refs.packageIds.has(item.linkedId)
      || refs.candidateIds.has(item.linkedId)
      || refs.streamerIds.has(item.linkedId)
      || item.linkedId === DEMO_PROJECT_ID
    )),
    artifacts: modeCount(state.artifacts, (item) => {
      const content = item.content || {};
      return (
        item.provenance === PROVENANCE.DEMO_SOURCE
        || content.provenance === PROVENANCE.DEMO_SOURCE
        || refs.sourceIds.has(content.sourceId)
        || refs.packageIds.has(content.clipPackageId)
        || refs.candidateIds.has(content.candidateId)
      );
    }),
    activeWatchSessions: (state.watchSessions || []).filter((item) => ACTIVE_WATCH_STATUSES.has(item.status)).length
  };
}

function safeIntegrationCheck(id) {
  const check = state.integrationChecks?.[id] || null;
  if (!check) return null;
  return {
    status: check.status,
    lastTestedAt: check.lastTestedAt,
    lastSuccessAt: check.lastSuccessAt || null,
    message: check.message || "",
    error: check.error || ""
  };
}

function rememberIntegrationCheck(id, result) {
  state.integrationChecks ||= {};
  state.integrationChecks[id] = {
    status: result.status,
    lastTestedAt: now(),
    lastSuccessAt: result.status === "connected" || result.status === "local_ready" ? now() : state.integrationChecks[id]?.lastSuccessAt || null,
    message: result.message || "",
    error: result.error || ""
  };
  return safeIntegrationCheck(id);
}

function integrationRecord(input) {
  const check = safeIntegrationCheck(input.id);
  return {
    id: input.id,
    name: input.name,
    category: input.category || "connector",
    status: input.status,
    configured: Boolean(input.configured),
    connected: ["connected", "local_ready"].includes(input.status),
    mode: input.mode || "server",
    sourceOfTruth: input.sourceOfTruth || "backend",
    lastTestedAt: input.lastTestedAt || check?.lastTestedAt || null,
    lastSuccessAt: input.lastSuccessAt || check?.lastSuccessAt || null,
    message: input.message || check?.message || "",
    safeError: input.safeError || check?.error || "",
    missingConfig: input.missingConfig || [],
    capabilities: input.capabilities || [],
    blockedActions: input.blockedActions || [],
    nextAction: input.nextAction || "",
    secretsExposed: false
  };
}

async function runIntegrationCheck(id) {
  if (id === "openai") {
    try {
      const result = await testOpenAI();
      const status = result.live ? "connected" : "not_configured";
      const check = rememberIntegrationCheck(id, { status, message: result.message });
      await logEvent("integration_test", "OpenAI integration tested", { id, status });
      await saveState();
      return check;
    } catch (error) {
      const safeError = "OpenAI test failed. Check billing, credits, model access, or API key.";
      rememberIntegrationCheck(id, { status: "error", message: safeError, error: safeError });
      await logEvent("integration_test_failed", "OpenAI integration test failed", { id, error: error.message });
      await saveState();
      return safeIntegrationCheck(id);
    }
  }

  if (id === "twitch") {
    try {
      const status = await twitchIntegrationStatus({ validate: true });
      const normalized = status.status === "ready" ? "connected" : status.status === "not_configured" ? "not_configured" : "error";
      const check = rememberIntegrationCheck(id, {
        status: normalized,
        message: status.message,
        error: normalized === "error" ? "Twitch API validation failed." : ""
      });
      await logEvent("integration_test", "Twitch integration tested", { id, status: normalized });
      await saveState();
      return check;
    } catch (error) {
      rememberIntegrationCheck(id, { status: "error", message: "Twitch API validation failed.", error: "Twitch API validation failed." });
      await logEvent("integration_test_failed", "Twitch integration test failed", { id, error: error.message });
      await saveState();
      return safeIntegrationCheck(id);
    }
  }

  if (id === "kick") {
    try {
      if (!kickApiConfigured()) {
        const check = rememberIntegrationCheck(id, {
          status: "not_configured",
          message: "Kick credentials are not configured."
        });
        await saveState();
        return check;
      }
      const token = config.kickOAuthToken || (await getKickAppToken());
      const check = rememberIntegrationCheck(id, {
        status: token ? "connected" : "error",
        message: token ? "Kick API token exchange succeeded." : "Kick token exchange did not return a token.",
        error: token ? "" : "Kick token exchange did not return a token."
      });
      await logEvent("integration_test", "Kick integration tested", { id, status: check.status });
      await saveState();
      return check;
    } catch (error) {
      rememberIntegrationCheck(id, { status: "error", message: "Kick API validation failed.", error: "Kick API validation failed." });
      await logEvent("integration_test_failed", "Kick integration test failed", { id, error: error.message });
      await saveState();
      return safeIntegrationCheck(id);
    }
  }

  if (id === "media") {
    const media = await mediaToolStatus();
    const status = media.ffmpeg.configured && media.ffprobe.configured ? "local_ready" : "manual_handoff";
    const check = rememberIntegrationCheck(id, { status, message: media.notes });
    await logEvent("integration_test", "Media toolchain checked", { id, status });
    await saveState();
    return check;
  }

  return {
    status: "unsupported",
    lastTestedAt: now(),
    message: "This connector is not testable yet.",
    error: ""
  };
}

async function buildIntegrationMatrix() {
  const media = await mediaToolStatus();
  const latestSmoke = latestRecord(state.smokeTests, ["createdAt", "startedAt", "completedAt"]);
  const twitchValidation = state.twitchValidation || null;
  const openaiCheck = safeIntegrationCheck("openai");
  const twitchCheck = safeIntegrationCheck("twitch");
  const kickCheck = safeIntegrationCheck("kick");
  const mediaCheck = safeIntegrationCheck("media");
  const browserPassed = latestSmoke?.checks?.some((check) => /browser|chromium|screenshot/i.test(check.name || check.id || "") && check.status === "passed");
  const mediaReady = media.ffmpeg.configured && media.ffprobe.configured;

  const integrations = [
    integrationRecord({
      id: "openai",
      name: "OpenAI",
      category: "ai",
      configured: Boolean(config.openaiApiKey),
      status: !config.openaiApiKey ? "not_configured" : openaiCheck?.status === "connected" ? "connected" : openaiCheck?.status === "error" ? "error" : "not_tested",
      mode: config.aiProvider === "openai" ? "live_api" : "local_fallback",
      message: !config.openaiApiKey
        ? "No API key is configured. Local fallback remains active."
        : openaiCheck?.message || "Configured server-side, but not tested in this runtime yet.",
      missingConfig: config.openaiApiKey ? [] : ["OPENAI_API_KEY"],
      capabilities: ["Agent 101 planning", "Scoring explanations", "Captions and briefs"],
      blockedActions: ["Browser never receives the API key"],
      nextAction: config.openaiApiKey ? "Run Test Connection" : "Add OPENAI_API_KEY in Railway or local env"
    }),
    integrationRecord({
      id: "twitch",
      name: "Twitch",
      category: "provider",
      configured: twitchApiConfigured(),
      status: !twitchApiConfigured()
        ? "not_configured"
        : twitchValidation?.status === "ready" || twitchCheck?.status === "connected"
          ? "connected"
          : twitchCheck?.status === "error"
            ? "error"
            : "not_tested",
      mode: "official_api",
      message: twitchValidation?.message || twitchCheck?.message || (twitchApiConfigured()
        ? "Configured, but this runtime has not validated the official API token yet."
        : "Missing Twitch credentials."),
      missingConfig: twitchApiConfigured() ? [] : ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET or TWITCH_OAUTH_TOKEN"],
      capabilities: ["Official stream status checks", "Approved streamer monitoring", "Top streamer discovery"],
      blockedActions: ["No scraping", "No clip creation without rights and user-token scope verification"],
      nextAction: twitchApiConfigured() ? "Run Test Connection" : "Add Twitch env vars"
    }),
    integrationRecord({
      id: "kick",
      name: "Kick",
      category: "provider",
      configured: kickApiConfigured(),
      status: !kickApiConfigured() ? "not_configured" : kickCheck?.status === "connected" ? "connected" : kickCheck?.status === "error" ? "error" : "not_tested",
      mode: "official_api",
      message: kickCheck?.message || (kickApiConfigured()
        ? "Configured, but token exchange or live endpoint has not been tested in this runtime yet."
        : "Missing Kick Client ID/Secret or OAuth token."),
      missingConfig: kickApiConfigured() ? [] : ["KICK_CLIENT_ID", "KICK_CLIENT_SECRET"],
      capabilities: ["Official Kick livestream lookup", "Streamer recommendation source"],
      blockedActions: ["No scraping", "No posting or account changes"],
      nextAction: kickApiConfigured() ? "Run Test Connection" : "Add Kick env vars"
    }),
    integrationRecord({
      id: "media",
      name: "Local Media Toolchain",
      category: "media",
      configured: true,
      status: mediaCheck?.status || (mediaReady ? "local_ready" : "manual_handoff"),
      mode: mediaReady ? "server_render" : "manual_handoff",
      message: media.notes,
      capabilities: mediaReady ? ["FFmpeg render jobs", "FFprobe verification", "Playable local artifacts"] : ["CapCut manual handoff"],
      blockedActions: mediaReady ? ["No public upload"] : ["Automated local render unavailable until FFmpeg/FFprobe are installed"],
      nextAction: mediaReady ? "Run a render smoke test" : "Install FFmpeg and FFprobe or use CapCut handoff"
    }),
    integrationRecord({
      id: "browser",
      name: "Browser Workspace",
      category: "automation",
      configured: config.browserEnabled,
      status: !config.browserEnabled ? "not_configured" : browserPassed ? "connected" : "not_tested",
      mode: config.browserHeadless ? "headless_screenshot" : "headed_local",
      message: browserPassed
        ? "Latest smoke test verified browser control."
        : "Browser routes are present; run Browser Workspace smoke before relying on it.",
      capabilities: ["Isolated supervised Chromium session", "Screenshots", "Operator handoff"],
      blockedActions: ["No credential collection", "No external account changes without Human Gate"],
      nextAction: config.browserEnabled ? "Run Browser smoke test" : "Set BROWSER_ENABLED=true"
    }),
    integrationRecord({
      id: "capcut",
      name: "CapCut",
      category: "automation",
      configured: true,
      status: config.anthropicApiKey || config.capcutAgentDryRun ? "desktop_control_ready" : "needs_anthropic_key",
      mode: "desktop_app",
      message: config.anthropicApiKey || config.capcutAgentDryRun
        ? "Agent 101 can drive the native Mac CapCut app for verified clips. Export/download stays approval-gated and operator-controlled."
        : "CapCut desktop automation needs ANTHROPIC_API_KEY for screenshot vision, unless dry run is enabled.",
      missingConfig: config.anthropicApiKey || config.capcutAgentDryRun ? [] : ["ANTHROPIC_API_KEY"],
      capabilities: ["Native CapCut app control", "Verified clip import", "9:16 setup", "Blur background", "Auto reframe", "Brand sticker placement", "Export approval package"],
      blockedActions: ["Credential entry", "Account settings", "Payment", "Export/download automation", "Posting without Human Gate"],
      nextAction: "Render a verified clip, then run CapCut Agent desktop edit"
    }),
    integrationRecord({
      id: "posting-platforms",
      name: "TikTok / Instagram / YouTube",
      category: "publishing",
      configured: false,
      status: "gated",
      mode: "human_gate_only",
      message: "Posting drafts can be generated, but uploading and publishing are not implemented.",
      capabilities: ["Draft captions", "Posting package", "Human Gate request"],
      blockedActions: ["Public posting", "Uploads", "Account connection", "Spend"],
      nextAction: "Approve connector design before adding OAuth/API"
    }),
    integrationRecord({
      id: "storage",
      name: "Storage",
      category: "infrastructure",
      configured: true,
      status: config.objectStorageBucket ? "not_tested" : "local_only",
      mode: config.objectStorageBucket ? "object_storage_configured" : "local_files",
      message: config.objectStorageBucket
        ? "Object storage is configured by env, but write/read has not been smoke-tested here."
        : `Local uploads and outputs are stored under ${config.uploadDir} and ${config.outputDir}.`,
      capabilities: ["Local upload metadata", "Local outputs", "Artifact records"],
      blockedActions: config.objectStorageBucket ? ["No object writes until smoke-tested"] : ["No durable cloud storage until object storage is configured"],
      nextAction: config.objectStorageBucket ? "Run storage smoke test" : "Configure object storage before production scale"
    }),
    integrationRecord({
      id: "database",
      name: "Database",
      category: "infrastructure",
      configured: Boolean(config.databaseUrl),
      status: config.databaseUrl ? "not_tested" : "local_only",
      mode: config.databaseUrl ? "database_configured" : "json_file",
      message: config.databaseUrl
        ? "DATABASE_URL exists, but this app still primarily uses local JSON state."
        : "Current persistence is local JSON. Good for prototype, not multi-user production.",
      capabilities: ["Persistent local app state"],
      blockedActions: ["No multi-worker write safety until database migration"],
      nextAction: "Plan database migration before true production traffic"
    }),
    integrationRecord({
      id: "human-gate",
      name: "Human Gate",
      category: "safety",
      configured: true,
      status: "connected",
      mode: "operator_review",
      message: "Approval queue is available and remains mandatory for risky external actions.",
      capabilities: ["Approve", "Send back", "Reject", "Audit decisions"],
      blockedActions: ["Global unlocks", "Silent external actions"],
      nextAction: "Review pending approvals"
    })
  ];

  const summary = integrations.reduce((acc, item) => {
    acc.total += 1;
    acc[item.status] = (acc[item.status] || 0) + 1;
    if (item.connected) acc.connected += 1;
    if (["not_configured", "error", "not_tested"].includes(item.status)) acc.needsAttention += 1;
    return acc;
  }, { total: 0, connected: 0, needsAttention: 0 });

  return {
    generatedAt: now(),
    secretsExposed: false,
    modeSummary: productionModeSummary(),
    summary,
    integrations
  };
}

function readinessDocsStatus() {
  return [
    "product-readiness-audit.md",
    "action-matrix.md",
    "integration-matrix.md",
    "state-machine-map.md",
    "agent101-tool-map.md",
    "end-to-end-test-plan.md"
  ].map((file) => ({
    file: `docs/${file}`,
    status: "tracked",
    purpose: file.replace(".md", "").replaceAll("-", " ")
  }));
}

function buildActionMatrixPayload() {
  return {
    generatedAt: now(),
    rule: "Visible controls must be wired, disabled with reason, or removed.",
    actions: [
      { page: "Dashboard", actionId: "agent101-demo-workflow", route: "POST /api/agent101/run", status: "active", mode: "practice" },
      { page: "Dashboard", actionId: "run-watch", route: "POST /api/watch/run", status: "active", mode: "real_or_practice" },
      { page: "Stream Watchlist", actionId: "add-streamer", route: "POST /api/twitch/streamers", status: "active", mode: "real" },
      { page: "Clip Radar", actionId: "preview-candidate", route: "local + /api/media/sources/:id/playback", status: "active_when_source_verified", mode: "real_or_practice" },
      { page: "Clip Builder", actionId: "render-draft", route: "POST /api/media/candidates/:id/render", status: "active_when_media_ready", mode: "real_or_practice" },
      { page: "Posting Queue", actionId: "create-draft", route: "POST /api/posting-drafts", status: "blocked_until_verified_clip", mode: "draft_only" },
      { page: "Human Gate", actionId: "approve-sendback-reject", route: "POST /api/human-gate/*", status: "active", mode: "operator_review" },
      { page: "Browser Workspace", actionId: "browser-control", route: "POST /api/browser/sessions/*", status: config.browserEnabled ? "active_requires_smoke" : "disabled", mode: "supervised" },
      { page: "Integrations", actionId: "test-integration", route: "POST /api/integrations/:id/test", status: "active_for_supported_connectors", mode: "server_only" }
    ]
  };
}

function buildAgentToolMapPayload() {
  return {
    generatedAt: now(),
    policy: "Agent 101 may run safe internal tools. Risky external tools create Human Gate approvals.",
    tools: [
      { id: "discover_streamers", route: "POST /api/agent101/runs", safety: "real_api_metadata_only", writes: ["discoveredStreamers", "logs"] },
      { id: "add_demo_streamers", route: "POST /api/agent101/run", safety: "practice_only", writes: ["streamers", "logs"] },
      { id: "run_watch_cycle", route: "POST /api/watch/run", safety: "approved_sources_only", writes: ["watchSessions", "watchEvents", "logs"] },
      { id: "create_candidates", route: "POST /api/clip-candidates", safety: "requires_verified_source", writes: ["clipCandidates", "logs"] },
      { id: "score_candidates", route: "POST /api/clips/candidates/score", safety: "safe_internal", writes: ["clipCandidates", "logs"] },
      { id: "create_clip_package", route: "POST /api/clips/package", safety: "safe_internal", writes: ["clipPackages", "artifacts", "logs"] },
      { id: "render_clip", route: "POST /api/media/candidates/:id/render", safety: "local_media_only", writes: ["mediaJobs", "artifacts", "logs"] },
      { id: "create_posting_draft", route: "POST /api/posting-drafts", safety: "requires_verified_render", writes: ["postingDrafts", "logs"] },
      { id: "request_approval", route: "POST /api/human-gate/requests", safety: "human_gate_required", writes: ["approvalRequests", "logs"] },
      { id: "publish_external", route: "none", safety: "not_implemented_blocked", writes: [] }
    ]
  };
}

async function buildReadinessAudit() {
  const integrations = await buildIntegrationMatrix();
  const latestSmoke = latestRecord(state.smokeTests, ["createdAt", "startedAt", "completedAt"]);
  const activeSessions = (state.watchSessions || []).filter((item) => ACTIVE_WATCH_STATUSES.has(item.status));
  const failedSessions = (state.watchSessions || []).filter((item) => item.status === "failed").slice(0, 5);
  const blockers = [];
  if (!config.databaseUrl) blockers.push("Persistence is local JSON, not a production database.");
  if (!config.objectStorageBucket) blockers.push("Object storage is not configured; artifacts are local files.");
  if (!integrations.integrations.find((item) => item.id === "openai")?.connected) blockers.push("OpenAI has not been verified in this runtime.");
  if (!integrations.integrations.find((item) => item.id === "twitch")?.connected && !integrations.integrations.find((item) => item.id === "kick")?.connected) {
    blockers.push("No provider API has a verified connection for real live discovery.");
  }

  return {
    generatedAt: now(),
    readiness: blockers.length ? "needs_work" : "ready_for_supervised_beta",
    blockers,
    latestSmoke: latestSmoke ? {
      id: latestSmoke.id,
      status: latestSmoke.status,
      createdAt: latestSmoke.createdAt,
      summary: latestSmoke.summary || null
    } : null,
    modeSummary: integrations.modeSummary,
    integrationSummary: integrations.summary,
    activeWatchSessions: activeSessions.map((session) => ({
      id: session.id,
      status: session.status,
      streamerId: session.streamerId,
      mode: session.mode,
      leaseOwner: session.leaseOwner || null,
      heartbeatAt: session.heartbeatAt || null
    })),
    failedWatchSessions: failedSessions.map((session) => ({
      id: session.id,
      streamerId: session.streamerId,
      reason: session.error || session.failureReason || "Unknown failure"
    })),
    docs: readinessDocsStatus(),
    knownGaps: [
      "Real source capture still requires verified provider permission and playable source records before candidates become production candidates.",
      "Direct publishing/uploading remains intentionally unimplemented and Human Gate blocked.",
      "Database and object storage migration are needed before multi-user production traffic.",
      "CapCut export/download and publishing remain Human Gate gated even when desktop staging is ready."
    ],
    secretsExposed: false
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
  const allowed = normalizeAllowedUse(streamer.allowedUse);
  if (streamer.permissionStatus === "approved" && !allowed.length) return true;
  return allowed.includes("clips") || allowed.includes("createOfficialClip") || allowed.includes("editClip");
}

function isSafeInternalDraftSource(source = {}) {
  if (!source || source.playable === false) return false;
  const provenance = source.provenance || "";
  const sourceType = cleanText(source.sourceType || "");
  const permission = cleanText(source.permissionStatus || source.rightsStatus || "");
  const allowedProvenance = new Set([
    PROVENANCE.DEMO_SOURCE,
    PROVENANCE.AUTHORIZED_UPLOAD,
    PROVENANCE.VERIFIED_MEDIA
  ]);
  const allowedTypes = new Set(["upload", "practice", "demo_media"]);
  const allowedPermissions = new Set(["uploaded", "verified", "practice_only", "demo_approved", "approved"]);
  return (allowedProvenance.has(provenance) || allowedTypes.has(sourceType)) && allowedPermissions.has(permission);
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
    return `I interpreted this as ${contract.requestedCount} ${contract.sourceMode === "real" ? "real currently-live Twitch/Kick" : "practice"} stream${contract.requestedCount === 1 ? "" : "s"}. This is discovery only; no clipping or posting will occur.`;
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
  const sourceDuration = Number(sourceDurationSeconds(source) || 0);
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

function publicCapcutAgentSession(session) {
  if (!session) return null;
  return {
    id: session.id,
    sessionId: session.sessionId,
    clipId: session.clipId,
    renderedArtifactId: session.renderedArtifactId,
    browserSessionId: session.browserSessionId || "",
    title: session.title || "CapCut edit",
    status: session.status,
    stage: session.stage,
    dryRun: Boolean(session.dryRun),
    exportReady: Boolean(session.exportReady),
    loginApprovalId: session.loginApprovalId || "",
    exportApprovalId: session.exportApprovalId || "",
    completedPhases: session.completedPhases || [],
    events: (session.events || []).slice(-25),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    completedAt: session.completedAt || null,
    lastError: session.lastError || ""
  };
}

function approvalById(id) {
  return state.approvalRequests.find((item) => item.id === cleanText(id)) || null;
}

function approvedApproval(id, type = "") {
  const approval = approvalById(id);
  if (!approval || approval.status !== "approved") return null;
  if (type && approval.type !== type) return null;
  return approval;
}

function candidateIsPractice(candidate) {
  if (!candidate) return false;
  const refs = practiceReferenceSets();
  return refs.candidateIds.has(candidate.id) || isPracticeStreamer(state.streamers.find((item) => item.id === candidate.streamerId));
}

function resolveCapcutClipReference(input = {}) {
  const clipId = cleanText(input.clip_id || input.clipId || input.candidateId);
  const candidate = state.clipCandidates.find((item) => item.id === clipId);
  if (!candidate) {
    const error = new Error("Clip candidate not found.");
    error.statusCode = 404;
    throw error;
  }
  const clipPackage = state.clipPackages.find((item) => item.candidateId === candidate.id);
  const artifactId = cleanText(input.rendered_artifact_id || input.renderedArtifactId || input.artifactId || candidate.renderedArtifactId || clipPackage?.renderedArtifactId);
  const artifact = state.artifacts.find((item) => item.id === artifactId);
  if (!artifactIsVerifiedClip(artifact)) {
    const error = new Error("CapCut Agent requires a verified rendered MP4 before upload.");
    error.statusCode = 422;
    error.details = { clipId: candidate.id, artifactId: artifactId || null, renderRequired: true };
    throw error;
  }
  return { candidate, clipPackage, artifact };
}

function rememberCapcutAgentSession(session) {
  state.capcutAgentSessions ||= [];
  const index = state.capcutAgentSessions.findIndex((item) => item.sessionId === session.sessionId);
  if (index >= 0) state.capcutAgentSessions[index] = session;
  else state.capcutAgentSessions.unshift(session);
  state.capcutAgentSessions = state.capcutAgentSessions.slice(0, 100);
  return session;
}

async function addCapcutAgentEvent(session, event, payload = {}) {
  const entry = {
    id: newId("capcut_event"),
    event,
    phase: payload.phase || event,
    status: payload.status || "running",
    message: payload.message || "",
    createdAt: payload.createdAt || now(),
    ...payload
  };
  session.events ||= [];
  session.events.push(entry);
  session.events = session.events.slice(-100);
  session.updatedAt = now();
  rememberCapcutAgentSession(session);
  emitCapcutAgentStream(session.sessionId, "capcut_agent_step", entry);
  await saveState();
  return entry;
}

async function runCapcutEditClip(input = {}, context = {}) {
  let candidate = null;
  let clipPackage = null;
  let artifact = null;
  let clipPath = cleanText(input.clipPath || input.clip_path);
  if (!clipPath) {
    ({ candidate, clipPackage, artifact } = resolveCapcutClipReference(input));
    clipPath = artifact.path;
  } else {
    const clipIdForLookup = cleanText(input.clip_id || input.clipId || input.candidateId);
    candidate = state.clipCandidates.find((item) => item.id === clipIdForLookup) || null;
    clipPackage = candidate ? state.clipPackages.find((item) => item.candidateId === candidate.id) || null : null;
    const artifactId = cleanText(input.rendered_artifact_id || input.renderedArtifactId || input.artifactId);
    artifact = state.artifacts.find((item) => item.id === artifactId) || null;
  }
  const editSpec = input.edit_spec && typeof input.edit_spec === "object" ? input.edit_spec : {};
  const sourceProvenance = cleanText(input.sourceProvenance || input.source_provenance || artifact?.provenance || artifact?.content?.provenance);
  const practice = candidateIsPractice(candidate) || /PRACTICE/i.test(sourceProvenance);
  if (practice && input.practice_confirmed !== true) {
    const error = new Error("Practice clips are blocked until the operator explicitly confirms practice media.");
    error.statusCode = 409;
    error.details = { clipId: candidate?.id || input.clipId || input.clip_id || "unknown", practice: true };
    throw error;
  }

  const sessionId = cleanText(input.capcut_session_id || input.sessionId) || newId("capcut_session");
  const clipId = cleanText(input.clipId || input.clip_id || input.candidateId || candidate?.id || artifact?.id || path.basename(clipPath));
  const title = `${candidate?.title || clipPackage?.title || artifact?.title || clipId || "Clip"} -> CapCut Desktop`;
  const requestedDryRun = Boolean(input.dry_run && (
    config.enableSyntheticTestFixtures
    || process.env.APP_MODE === "local"
    || process.env.NODE_ENV === "test"
  ));
  let session = state.capcutAgentSessions.find((item) => item.sessionId === sessionId) || {
    id: newId("capcut_agent"),
    sessionId,
    clipId,
    clipPackageId: clipPackage?.id || "",
    renderedArtifactId: artifact?.id || "",
    title,
    status: "queued",
    stage: "desktop_preflight",
    dryRun: requestedDryRun || config.capcutAgentDryRun,
    exportReady: false,
    mode: "desktop",
    events: [],
    createdAt: now(),
    updatedAt: now()
  };
  session.clipId = clipId;
  session.clipPackageId = clipPackage?.id || "";
  session.renderedArtifactId = artifact?.id || "";
  session.title = title;
  session.editSpec = editSpec;
  session.mode = "desktop";
  session.dryRun = requestedDryRun || config.capcutAgentDryRun;
  session.sourcePath = clipPath;
  rememberCapcutAgentSession(session);

  try {
    session.status = "running";
    session.stage = "desktop_editing";
    rememberCapcutAgentSession(session);
    await addCapcutAgentEvent(session, "capcut_agent_started", {
      phase: "open_capcut",
      status: "running",
      message: "Opening CapCut desktop app."
    });
    const run = await runCapcutDesktopEdit({
      ...editSpec,
      clipPath,
      clipId,
      brandSticker: input.brandSticker || input.brand_sticker || editSpec.brandSticker || config.capcutBrandSticker || process.env.CAPCUT_BRAND_STICKER || "Essentrx",
      stickerScale: input.stickerScale || input.sticker_scale || editSpec.stickerScale || 35
    }, {
      sessionId: session.sessionId,
      dryRun: session.dryRun,
      client: context.anthropicClient || (config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : null),
      onStep: async (entry) => addCapcutAgentEvent(session, "capcut_agent_step", entry)
    });
    session.completedPhases = run.completedPhases || run.steps?.map((item) => item.phase) || [];
    session.exportReady = Boolean(run.exportReady);
    session.status = "operator_review";
    session.stage = "operator_review";
    session.exportApprovalId = "";
    rememberCapcutAgentSession(session);
    await addCapcutAgentEvent(session, "operator_review_ready", {
      phase: "operator_review",
      status: "complete",
      message: "CapCut desktop edit is ready for operator review. Export/upload automation is disabled."
    });
  } catch (error) {
    session.status = "error";
    session.stage = "desktop_editing";
    session.lastError = error.message;
    rememberCapcutAgentSession(session);
    await addCapcutAgentEvent(session, "capcut_agent_error", {
      phase: "desktop_editing",
      status: "error",
      message: error.message
    });
    await saveState();
    return { error: true, message: error.message, session: publicCapcutAgentSession(session) };
  }

  await saveState();
  return {
    requiresApproval: false,
    approvalType: "",
    approvalRequest: null,
    session: publicCapcutAgentSession(session),
    executed: true,
    exportResult: { downloaded: false, desktopExportAutomation: false },
    postingDraftCreated: false,
    message: "CapCut desktop edit is ready for operator review. No Human Gate approval is required for this local edit. Export/upload remains manual."
  };
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
  const chatSource = cleanText(input.chatSignals?.source).toLowerCase();
  const realChat = Boolean(chatSpike && chatSource && !["watch_window_estimate", "agent101_demo", "practice_signal", "unavailable"].includes(chatSource));
  const transcriptAvailable = Boolean(input.transcriptSnippet && input.transcriptProvenance !== PROVENANCE.UNAVAILABLE);
  const audioEnergy = input.audioEnergy || {};
  const maxAudioDb = Number(input.audioEnergyDb ?? audioEnergy.maxVolumeDb);
  const loudThresholdDb = Number(audioEnergy.loudThresholdDb ?? -8);
  const loudMoment = Boolean(input.isLoudMoment || audioEnergy.isLoudMoment || (Number.isFinite(maxAudioDb) && maxAudioDb >= loudThresholdDb));
  const voiceExcited = Boolean(audioEnergy.isVoiceExcited);
  const duration = Number(input.duration || 30);
  const lengthScore = duration >= 15 && duration <= 60 ? 18 : duration < 10 || duration > 90 ? 4 : 10;
  const chatScore = Math.min(22, Math.round(chatSpike / 2));
  const audioScore = loudMoment ? 10 : Number.isFinite(maxAudioDb) ? 4 : 0;
  const voiceScore = voiceExcited ? 6 : 0;
  const emoteDistribution = input.emoteDistribution || {};
  const emoteScore = emoteDistribution.dominant === "hype" ? 5 : emoteDistribution.dominant === "tension" ? 3 : 0;
  const providedTranscriptScore = Number(input.transcriptScore || 0);
  const transcriptScore = Math.min(20, Math.max(excitementHits * 5, providedTranscriptScore));
  const hookScore = Math.min(20, Number(input.hookScore || 8 + excitementHits * 3) + emoteScore + Math.round(providedTranscriptScore / 6) + (voiceExcited ? 2 : 0));
  const contextScore = input.category || input.title ? 10 : 4;
  const riskScore = Math.min(100, Number(input.riskScore || (text.includes("copyright") ? 60 : 15)));
  const riskPenalty = Math.round(riskScore / 5);
  const crossStreamBonus = input.crossStreamBoost ? 10 : 0;
  const raw = chatScore + audioScore + voiceScore + emoteScore + transcriptScore + lengthScore + hookScore + contextScore + crossStreamBonus - riskPenalty;
  const score = Math.max(0, Math.min(100, raw));
  const confidence = transcriptAvailable || realChat || loudMoment || voiceExcited ? "medium" : "low";
  const suggestedHook = input.suggestedHook || makeHook(input.title || input.reason || "Stream moment");
  const suggestedTitle = input.suggestedTitle || makeTitle(input.title || input.reason || "Clip moment");

  return {
    score,
    hookScore,
    engagementPotential: Math.min(100, chatScore + emoteScore + transcriptScore + crossStreamBonus + 35),
    retentionPotential: Math.min(100, lengthScore + hookScore + voiceScore + transcriptScore + 35),
    riskScore,
    confidence,
    scoringProvider: transcriptAvailable || realChat || loudMoment || voiceExcited ? "local_evidence" : "local_heuristic",
    scoreEvidence: {
      source: transcriptAvailable || realChat || loudMoment || voiceExcited ? "transcript_chat_audio" : "local_heuristic",
      verified: Boolean(transcriptAvailable || realChat || loudMoment || voiceExcited),
      message: transcriptAvailable || realChat || loudMoment || voiceExcited
        ? "Score uses attached transcript, provider chat, saved-buffer audio energy, voice-band energy, emote velocity, or cross-stream correlation."
        : "Score is a local heuristic and should not be treated as a verified clip-quality score."
    },
    reason:
      confidence === "low"
        ? "Manual/practice candidate: add transcript, chat notes, or visual context for a stronger score."
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

async function createClipPackageForCandidate(candidate, body = {}, context = {}) {
  if (!candidate) {
    const error = new Error("Candidate not found");
    error.statusCode = 404;
    throw error;
  }
  const existing = state.clipPackages.find((clipPackage) => clipPackage.candidateId === candidate.id);
  if (existing) return { clipPackage: existing, packagePlan: existing.packagePlan || buildPackage({ ...candidate, ...body }), reused: true };
  const streamer = findStreamer(candidate.streamerId);
  const source = findExistingMediaSource(candidate.sourceId);
  if (!source) {
    await logEvent("candidate_blocked", "Package blocked because candidate has no verified media source", {
      candidateId: candidate.id,
      sourceId: candidate.sourceId || ""
    });
    const error = new Error("Candidate generation blocked: no verified playable media.");
    error.statusCode = 422;
    throw error;
  }
  await assertSourceIsPlayable(source);
  assertCandidateReferencesSource(candidate, source);
  assertCandidateTimesValid(candidate, source);

  // ── Vision Gate ──────────────────────────────────────────────────────────
  // Analyze keyframes with Claude Haiku before committing to a clip package.
  // Only runs when the source has a local file path (captured buffer clips).
  // Defaults to PASS on any error so API issues never block the pipeline.
  if (source.filePath && !candidate.visionGate) {
    const vg = await runVisionGate(source.filePath, ffmpegExecutable);
    candidate.visionGate = vg;
    if (!vg.shouldClip && !vg.skipped) {
      await logEvent("vision_gate_reject", `Vision gate rejected clip: ${vg.reason}`, {
        candidateId: candidate.id,
        clipType: vg.clipType,
        compositeScore: vg.compositeScore,
      });
      candidate.status = "rejected";
      candidate.rejectedReason = `Vision gate: ${vg.reason}`;
      await saveState();
      const err = new Error(`Vision gate rejected this clip (${vg.clipType}): ${vg.reason}`);
      err.statusCode = 422;
      throw err;
    }
  }
  // ── End Vision Gate ──────────────────────────────────────────────────────

  if (!isSafeInternalDraftSource(source) && !isRealApprovedStreamer(streamer)) {
    await logEvent("permission_blocked", "Package blocked for unapproved streamer", { candidateId: candidate.id });
    const error = new Error("Streamer permission is not approved");
    error.statusCode = 403;
    throw error;
  }
  const packagePlan = buildPackage({ ...candidate, ...body });
  const packageArtifact = await writeArtifact("clip_package", packagePlan.title, {
    candidate,
    streamer,
    packagePlan,
    createdAt: now(),
    createdBy: context.createdBy || "StreamClipper"
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
    approvalStatus: context.approvalStatus || "pending",
    artifacts: [packageArtifact],
    sourceId: source.id,
    sourceProvenance: source.provenance,
    renderedArtifactId: candidate.renderedArtifactId || null,
    packagePlan,
    createdAt: now(),
    updatedAt: now(),
    createdBy: context.createdBy || "StreamClipper"
  };
  state.clipPackages.unshift(clipPackage);
  candidate.status = context.markBuilderDraft ? "in_builder" : "packaged";
  if (context.markBuilderDraft) {
    candidate.builderDraft = {
      format: "9:16",
      resolution: "1080x1920",
      duration: Number(candidate.duration || 30),
      status: "saved",
      updatedAt: now(),
      createdBy: context.createdBy || "StreamClipper"
    };
    candidate.movedToBuilderAt = now();
  }
  candidate.updatedAt = now();
  if (streamer) {
    const clipProfile = ensureStreamerDetectionProfile(streamer);
    const history = clipProfile.clipHistory || structuredClone(DEFAULT_CLIP_PROFILE.clipHistory);
    const previousTotal = Number(history.totalCreated || 0);
    const nextTotal = previousTotal + 1;
    const candidateScore = Number(candidate.score || candidate.qualityScore || 0);
    history.totalCreated = nextTotal;
    history.lastClipAt = now();
    history.avgScoreAccepted = Number.isFinite(candidateScore)
      ? Math.round((((Number(history.avgScoreAccepted || 0) * previousTotal) + candidateScore) / nextTotal) * 100) / 100
      : Number(history.avgScoreAccepted || 0);
    clipProfile.clipHistory = history;
    streamer.updatedAt = now();
  }
  await logEvent(context.eventType || "package_created", context.message || "Clip package created", {
    candidateId: candidate.id,
    clipPackageId: clipPackage.id,
    sourceId: source.id,
    autoStaged: Boolean(context.markBuilderDraft),
    postingDraftsCreated: 0,
    approvalRequestsCreated: 0
  });
  return { clipPackage, packagePlan, reused: false };
}

async function autoStageCapturedCandidatesForBuilder(session, source, reason = "watch_capture") {
  if (!session?.id || !source?.id) return [];
  const candidates = state.clipCandidates
    .filter((candidate) => candidate.watchSessionId === session.id && candidate.sourceId === source.id && candidateHasPlayableSource(candidate))
    .filter((candidate) => !state.clipPackages.some((clipPackage) => clipPackage.candidateId === candidate.id));
  const sourceTrigger = cleanText(source.watchWindowTrigger || source.watchWindowSignal || "").toLowerCase();
  const isStrongTrigger = ["chat_spike", "chat_keyword", "tension_emote_prediction"].includes(sourceTrigger)
    || sourceTrigger.startsWith("eventsub_");
  if (!isStrongTrigger) return [];
  const staged = [];
  const strongestCandidate = candidates
    .filter((candidate) => candidate.decision !== "rejected")
    .filter((candidate) => {
      const score = Number(candidate.score || candidate.confidence || 0);
      return !Number.isFinite(score) || score >= config.twitchClipMinScore;
    })
    .sort((a, b) => {
      const aScore = Number(a.score || a.confidence || 0);
      const bScore = Number(b.score || b.confidence || 0);
      const aDecision = a.decision === "accepted" ? 2 : a.decision === "review" ? 1 : 0;
      const bDecision = b.decision === "accepted" ? 2 : b.decision === "review" ? 1 : 0;
      if (aDecision !== bDecision) return bDecision - aDecision;
      return bScore - aScore;
    })[0];

  if (!strongestCandidate) return [];
  try {
    const result = await createClipPackageForCandidate(strongestCandidate, {}, {
      createdBy: "StreamClipper watcher",
      approvalStatus: "draft",
      markBuilderDraft: true,
      eventType: "builder_auto_staged",
      message: "Captured spike clip staged for Clip Builder"
    });
    staged.push(result.clipPackage);
    await appendWatchEvent(session.id, "builder_auto_staged", {
      candidateId: strongestCandidate.id,
      clipPackageId: result.clipPackage.id,
      reason,
      message: "Chat/audio spike produced playable media, so StreamClipper staged it in Clip Builder."
    });
  } catch (error) {
    await appendWatchEvent(session.id, "builder_auto_stage_blocked", {
      candidateId: strongestCandidate.id,
      reason,
      message: error.message
    });
  }
  return staged;
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
  const normalized = normalizeMediaSourceRecord(source);
  return {
    ...normalized,
    filePath: undefined,
    storagePath: source.storagePath ? path.basename(source.storagePath) : null,
    playbackUrl: `/api/media/sources/${encodeURIComponent(normalized.id)}/playback`,
    metadataUrl: `/api/media/sources/${encodeURIComponent(normalized.id)}/metadata`,
    thumbnailsUrl: `/api/media/sources/${encodeURIComponent(normalized.id)}/thumbnails`
  };
}

function findMediaSource(id) {
  return state.mediaSources.find((source) => source.id === id);
}

function findExistingMediaSource(id) {
  return (state.mediaSources || []).find((source) => source.id === id);
}

function parseFrameRate(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = cleanText(value);
  if (!text) return null;
  const [num, den] = text.split("/").map(Number);
  if (Number.isFinite(num) && Number.isFinite(den) && den > 0) return Math.round((num / den) * 100) / 100;
  const direct = Number(text);
  return Number.isFinite(direct) ? direct : null;
}

function sourceDurationSeconds(source = {}) {
  return Number(source.durationSeconds ?? source.duration ?? 0) || null;
}

function sourceWidth(source = {}) {
  return Number(source.width || 0) || null;
}

function sourceHeight(source = {}) {
  return Number(source.height || 0) || null;
}

function normalizeMediaSourceRecord(source = {}) {
  const sourceType = normalizeStatus(
    source.sourceType || source.sourceKind || (source.provenance === PROVENANCE.DEMO_SOURCE ? "practice" : "upload"),
    ["upload", "twitch_clip", "twitch_vod", "watcher_buffer", "authorized_remote", "practice", "demo_media"],
    source.provenance === PROVENANCE.DEMO_SOURCE ? "practice" : "upload"
  );
  const durationSeconds = sourceDurationSeconds(source);
  const width = sourceWidth(source);
  const height = sourceHeight(source);
  const mimeType = cleanText(source.mimeType || source.type || (source.filePath ? contentTypeFor(source.filePath).split(";")[0] : ""));
  const ready = Boolean(
    source.filePath
    && source.playable !== false
    && durationSeconds
    && width
    && height
    && mimeType
    && ["approved", "demo_approved", "uploaded", "verified", "practice_only"].includes(cleanText(source.permissionStatus || source.rightsStatus || "practice_only"))
  );
  return {
    ...source,
    ownerId: source.ownerId || "local",
    projectId: source.projectId || source.editProjectId || source.mediaProjectId || null,
    sourceType: sourceType === "demo_media" ? "practice" : sourceType,
    provider: source.provider || (sourceType.startsWith("twitch") ? "twitch" : sourceType === "practice" || sourceType === "demo_media" ? "local" : null),
    providerSourceId: source.providerSourceId || source.sourceClipId || null,
    streamerId: source.streamerId || null,
    displayName: source.displayName || source.title || source.originalFilename || "Media source",
    originalFilename: source.originalFilename || (source.filePath ? path.basename(source.filePath) : null),
    storagePath: source.storagePath || source.filePath || null,
    mimeType,
    fileSizeBytes: Number(source.fileSizeBytes ?? source.size ?? 0) || null,
    sha256: source.sha256 || null,
    durationSeconds,
    width,
    height,
    frameRate: parseFrameRate(source.frameRate ?? source.fps),
    hasAudio: source.hasAudio ?? null,
    status: source.status || (ready ? "ready" : source.error ? "failed" : "verifying"),
    provenance: source.provenance || PROVENANCE.UNAVAILABLE,
    permissionStatus: source.permissionStatus || (source.provenance === PROVENANCE.DEMO_SOURCE ? "practice_only" : "uploaded"),
    rightsStatus: source.rightsStatus || (source.provenance === PROVENANCE.DEMO_SOURCE ? "practice_only" : "operator_review_required"),
    verifiedAt: source.verifiedAt || null,
    error: source.error || null,
    playable: ready,
    label: source.label || (source.provenance === PROVENANCE.DEMO_SOURCE ? "PRACTICE MEDIA" : ready ? "VERIFIED MEDIA" : "SOURCE NEEDS VERIFICATION"),
    updatedAt: source.updatedAt || source.createdAt || now()
  };
}

function normalizeClipProjectRecord(project = {}) {
  const sourceId = cleanText(project.sourceId || project.activeSourceId);
  const candidateId = cleanText(project.candidateId || project.selectedCandidateId);
  const mode = normalizeStatus(project.mode, ["real", "practice"], sourceId === DEMO_MEDIA_SOURCE_ID ? "practice" : "real");
  const source = findExistingMediaSource(sourceId);
  const status = normalizeStatus(
    project.status,
    ["empty", "source_ready", "analyzing", "editing", "rendering", "review", "approved", "completed", "failed", "ready"],
    source?.playable || source?.status === "ready" ? "source_ready" : sourceId ? "failed" : "empty"
  );
  return {
    ...project,
    id: project.id || newId("clip_project"),
    ownerId: project.ownerId || "local",
    title: project.title || "Untitled Clip Project",
    description: project.description || "",
    sourceId,
    activeSourceId: sourceId,
    candidateId,
    selectedCandidateId: candidateId,
    streamerId: project.streamerId || source?.streamerId || null,
    mode,
    status: status === "ready" ? "source_ready" : status,
    targetPlatform: project.targetPlatform || "multi_platform",
    aspectRatio: "9:16",
    resolution: "1080x1920",
    frameRate: parseFrameRate(project.frameRate || source?.fps || source?.frameRate) || 30,
    clipStartSeconds: project.clipStartSeconds ?? null,
    clipEndSeconds: project.clipEndSeconds ?? null,
    transcriptId: project.transcriptId || null,
    editDecisionListId: project.editDecisionListId || null,
    activeRenderJobId: project.activeRenderJobId || null,
    latestArtifactId: project.latestArtifactId || null,
    capcutHandoffId: project.capcutHandoffId || null,
    editorState: sanitizeClipEditorState(project.editorState || {}),
    createdAt: project.createdAt || now(),
    updatedAt: project.updatedAt || now(),
    autosavedAt: project.autosavedAt || null
  };
}

function sanitizeClipEditorState(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const serialized = JSON.stringify(value);
  if (serialized.length > 50000) {
    throw Object.assign(new Error("Editor state is too large to save."), { statusCode: 413 });
  }
  return JSON.parse(serialized);
}

function publicClipProject(project) {
  if (!project) return null;
  const normalized = normalizeClipProjectRecord(project);
  const source = findExistingMediaSource(normalized.sourceId);
  const candidate = state.clipCandidates.find((item) => item.id === normalized.candidateId);
  return {
    ...normalized,
    readiness: projectReadiness(normalized, source, candidate)
  };
}

function projectReadiness(project = {}, source = null, candidate = null) {
  const normalizedSource = normalizeMediaSourceRecord(source || {});
  const reasons = [];
  if (!source) reasons.push("Select or upload a media source.");
  if (source && normalizedSource.status !== "ready") reasons.push("Source must pass FFprobe verification.");
  if (source && !normalizedSource.durationSeconds) reasons.push("Source duration is unknown.");
  const start = Number(project.clipStartSeconds ?? candidate?.timestampStartSeconds ?? candidate?.startSeconds);
  const end = Number(project.clipEndSeconds ?? candidate?.timestampEndSeconds ?? candidate?.endSeconds);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) reasons.push("Set a valid clip start and end.");
  if (normalizedSource.durationSeconds && Number.isFinite(end) && end > normalizedSource.durationSeconds + 0.5) reasons.push("Clip range exceeds the source duration.");
  const latestArtifact = state.artifacts.find((artifact) => artifact.id === project.latestArtifactId || artifact.id === candidate?.renderedArtifactId);
  return {
    canRender: reasons.length === 0,
    renderReasons: reasons,
    canPackage: Boolean(candidate && reasons.length === 0),
    canCapCut: artifactIsVerifiedClip(latestArtifact),
    canHumanGate: artifactIsVerifiedClip(latestArtifact),
    latestArtifactId: latestArtifact?.id || null,
    sourceStatus: source ? normalizedSource.status : "missing",
    mode: project.mode || "real"
  };
}

function ensureProjectEditDecisionList(project, source = null, candidate = null) {
  state.editDecisionLists ||= [];
  if (project.editDecisionListId) {
    const existing = state.editDecisionLists.find((item) => item.id === project.editDecisionListId);
    if (existing) return existing;
  }
  const edl = {
    id: newId("edl"),
    projectId: project.id,
    version: 1,
    sourceId: project.sourceId || source?.id || "",
    clipStartSeconds: Number(project.clipStartSeconds ?? candidate?.timestampStartSeconds ?? 0),
    clipEndSeconds: Number(project.clipEndSeconds ?? candidate?.timestampEndSeconds ?? Math.min(30, sourceDurationSeconds(source) || 30)),
    cropMode: "center",
    cropKeyframes: [],
    captionTrackId: project.captionTrackId || null,
    overlayTrackId: project.overlayTrackId || null,
    audioTrackId: null,
    transitions: [],
    effects: [],
    createdAt: now(),
    updatedAt: now()
  };
  state.editDecisionLists.unshift(edl);
  project.editDecisionListId = edl.id;
  project.clipStartSeconds ??= edl.clipStartSeconds;
  project.clipEndSeconds ??= edl.clipEndSeconds;
  project.autosavedAt = now();
  project.updatedAt = now();
  return edl;
}

function defaultCandidateForSource(project, source) {
  const normalized = normalizeMediaSourceRecord(source);
  const end = Math.min(30, Math.max(1, normalized.durationSeconds || 30));
  const existing = state.clipCandidates.find((candidate) => candidate.projectId === project.id && candidate.sourceId === source.id);
  if (existing) return existing;
  const candidate = {
    id: newId("candidate"),
    sourceId: source.id,
    projectId: project.id,
    streamerId: source.streamerId || "",
    streamerName: source.displayName || "Uploaded source",
    title: "Manual source window",
    category: "Source review",
    sourceType: normalized.sourceType,
    sourceProvenance: normalized.provenance,
    provenance: normalized.provenance,
    creativeProvenance: PROVENANCE.USER_ENTERED,
    mediaPlayable: true,
    startSeconds: 0,
    endSeconds: end,
    timestampStartSeconds: 0,
    timestampEndSeconds: end,
    timestampStart: secondsToTimestamp(0),
    timestampEnd: secondsToTimestamp(end),
    duration: end,
    durationSeconds: end,
    thumbnailArtifactId: "",
    thumbnailUrl: `/api/media/sources/${encodeURIComponent(source.id)}/frame?candidateId=__manual__&t=0`,
    transcriptSegmentIds: [],
    transcriptSnippet: "Transcript unavailable until extraction or operator notes are added.",
    transcriptProvenance: PROVENANCE.UNAVAILABLE,
    measuredEvidence: [
      { label: "Playable source", provenance: normalized.provenance },
      { label: "FFprobe metadata", provenance: PROVENANCE.VERIFIED_MEDIA }
    ],
    aiAnalysis: null,
    qualityScore: null,
    score: null,
    confidence: null,
    status: "selected",
    createdBy: "operator",
    createdAt: now(),
    updatedAt: now()
  };
  state.clipCandidates.unshift(candidate);
  project.candidateId = candidate.id;
  project.selectedCandidateId = candidate.id;
  project.clipStartSeconds = 0;
  project.clipEndSeconds = end;
  ensureProjectEditDecisionList(project, source, candidate);
  return candidate;
}

function demoFrameUrl(index) {
  return `/demo/frame-${(index % 5) + 1}.jpg`;
}

function demoCandidateDefinitions(sourceId = DEMO_MEDIA_SOURCE_ID) {
  const base = [
    ["candidate_demo_source_001", "Practice motion test", "VALORANT", 2, 7, 82, "AI suggestion based on practice media timing. Source transcript is unavailable."],
    ["candidate_demo_source_002", "Perfect timing beat", "Gaming", 7, 12, 76, "AI suggestion for testing a clean reaction-style crop. Source transcript is unavailable."],
    ["candidate_demo_source_003", "Fast transition moment", "Just Chatting", 12, 17, 71, "AI suggestion for testing captions and 9:16 preview. Source transcript is unavailable."],
    ["candidate_demo_source_004", "Clean replay cut", "Apex Legends", 17, 22, 68, "AI suggestion for testing render output. Source transcript is unavailable."]
  ];
  return base.map(([id, title, category, startSec, endSec, score, reason], index) => ({
    id,
    streamerId: DEMO_STREAMER_ID,
    streamerName: "Practice Media Source",
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
    transcriptSnippet: "Source data unavailable: bundled practice media has no speech transcript.",
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
      displayName: "Practice Media Source",
      platform: "demo",
      channelId: "demo-media-source",
      channelUrl: "",
      permissionStatus: "demo_approved",
      monitorEnabled: true,
      isDemo: true,
      liveStatus: "demo_source",
      notes: "Bundled playable practice media for local clipping workflow testing. Not a real live stream.",
      createdAt: now(),
      updatedAt: now()
    });
  }

  let source = state.mediaSources.find((item) => item.id === DEMO_MEDIA_SOURCE_ID);
  if (!source) {
    source = {
      id: DEMO_MEDIA_SOURCE_ID,
      title: "StreamClipper Practice Media",
      displayName: "Practice video",
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
      label: "PRACTICE MEDIA — NOT A REAL STREAM",
      warning: "Practice media is for workflow testing only. Do not treat it as a real live stream or public posting source.",
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

function emptyStudioProjectPayload(projectId = DEMO_PROJECT_ID) {
  const sourceTruth = {
    provenance: PROVENANCE.UNAVAILABLE,
    label: "No media source selected",
    rightsStatus: "unavailable",
    transcriptStatus: PROVENANCE.UNAVAILABLE,
    viewerCount: PROVENANCE.UNAVAILABLE,
    chatSignals: PROVENANCE.UNAVAILABLE
  };
  const readiness = projectReadiness({ id: projectId, status: "empty", mode: "real" }, null, null);
  return {
    project: {
      id: projectId,
      officeId: "clips",
      title: "Clipping Office Workspace",
      activeSourceId: "",
      selectedCandidateId: "",
      stage: "setup",
      status: "empty",
      sourceTruth,
      readiness
    },
    source: null,
    sourceTruth,
    readiness,
    candidates: [],
    renderJobs: [],
    artifacts: [],
    capcut: {
      status: "desktop_control_ready",
      workspaceUrl: "",
      browserReady: false,
      mode: "desktop_app"
    },
    unavailable: {
      transcript: "No media source selected.",
      liveMetrics: "No verified stream or practice media is selected."
    }
  };
}

function studioProjectPayload(projectId = DEMO_PROJECT_ID) {
  const requested = cleanText(projectId);
  const activeProject = state.mediaProjects.find((item) => item.id === requested) || state.mediaProjects[0];
  if (!activeProject) return emptyStudioProjectPayload(requested || "new_clip_project");
  const normalizedProject = normalizeClipProjectRecord(activeProject);
  Object.assign(activeProject, normalizedProject);
  const source = findMediaSource(normalizedProject.sourceId);
  const normalizedSource = source ? normalizeMediaSourceRecord(source) : null;
  if (source) Object.assign(source, normalizedSource);
  const candidates = state.clipCandidates
    .filter((candidate) => candidate.sourceId === normalizedProject.sourceId || candidate.projectId === normalizedProject.id)
    .sort((a, b) => Number(a.timestampStartSeconds || 0) - Number(b.timestampStartSeconds || 0));
  const selectedCandidate = candidates.find((candidate) => candidate.id === normalizedProject.candidateId)
    || candidates[0]
    || null;
  if (selectedCandidate && normalizedProject.candidateId !== selectedCandidate.id) {
    normalizedProject.candidateId = selectedCandidate.id;
    normalizedProject.selectedCandidateId = selectedCandidate.id;
    activeProject.candidateId = selectedCandidate.id;
    activeProject.selectedCandidateId = selectedCandidate.id;
  }
  const readiness = projectReadiness(normalizedProject, source, selectedCandidate);
  const edl = ensureProjectEditDecisionList(normalizedProject, source, selectedCandidate);
  Object.assign(activeProject, normalizedProject, {
    editDecisionListId: edl?.id || normalizedProject.editDecisionListId,
    clipStartSeconds: normalizedProject.clipStartSeconds ?? edl?.clipStartSeconds ?? null,
    clipEndSeconds: normalizedProject.clipEndSeconds ?? edl?.clipEndSeconds ?? null
  });
  const renderJobs = state.mediaJobs
    .filter((job) => job.projectId === normalizedProject.id)
    .slice(0, 12);
  const projectArtifacts = state.artifacts
    .filter((artifact) => artifact.content?.projectId === normalizedProject.id || artifact.content?.sourceId === normalizedProject.sourceId)
    .slice(0, 20);
  const sourceTruth = {
    provenance: normalizedSource?.provenance || PROVENANCE.UNAVAILABLE,
    label: normalizedSource?.label || "Source data unavailable",
    rightsStatus: normalizedSource?.rightsStatus || "unavailable",
    transcriptStatus: normalizedSource?.transcriptStatus || PROVENANCE.UNAVAILABLE,
    viewerCount: PROVENANCE.UNAVAILABLE,
    chatSignals: PROVENANCE.UNAVAILABLE
  };
  return {
    project: {
      ...normalizedProject,
      readiness,
      sourceTruth
    },
    source: publicMediaSource(source),
    sourceTruth,
    readiness,
    candidates,
    editDecisionList: edl || null,
    versions: (state.clipProjectVersions || []).filter((version) => version.projectId === normalizedProject.id).slice(0, 8),
    renderJobs,
    artifacts: projectArtifacts,
    capcut: {
      status: "desktop_control_ready",
      workspaceUrl: "",
      browserReady: false,
      mode: "desktop_app"
    },
    unavailable: {
      transcript: normalizedSource?.provenance === PROVENANCE.DEMO_SOURCE
        ? "Practice media has no verified speech transcript."
        : "Source data unavailable. No speech transcript has been extracted.",
      liveMetrics: normalizedSource?.provenance === PROVENANCE.DEMO_SOURCE
        ? "Practice media has no verified viewer counts, live status, or chat spikes."
        : "Source data unavailable. No verified live metrics are attached."
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
    durationSeconds: Number(parsed.format?.duration || 0),
    width: Number(video?.width || 0),
    height: Number(video?.height || 0),
    fps: video?.avg_frame_rate || video?.r_frame_rate || "",
    frameRate: parseFrameRate(video?.avg_frame_rate || video?.r_frame_rate || ""),
    hasAudio: Boolean(audio),
    formatName: parsed.format?.format_name || "",
    size: Number(parsed.format?.size || 0),
    provenance: PROVENANCE.VERIFIED_MEDIA
  };
}

function sanitizeFilename(name, fallback = "media-source.mp4") {
  const raw = cleanText(name) || fallback;
  const ext = path.extname(raw).toLowerCase().replace(/[^a-z0-9.]/g, "") || ".mp4";
  const base = path.basename(raw, path.extname(raw)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "media-source";
  return `${base.slice(0, 80)}${ext}`;
}

async function createClipProject(input = {}) {
  const created = now();
  const project = normalizeClipProjectRecord({
    id: cleanText(input.id) || newId("clip_project"),
    ownerId: "local",
    officeId: "clips",
    title: cleanText(input.title) || "Untitled Clip Project",
    description: cleanText(input.description),
    sourceId: cleanText(input.sourceId),
    activeSourceId: cleanText(input.sourceId),
    candidateId: cleanText(input.candidateId),
    selectedCandidateId: cleanText(input.candidateId),
    mode: normalizeStatus(input.mode, ["real", "practice"], "real"),
    status: input.sourceId ? "source_ready" : "empty",
    targetPlatform: normalizeStatus(input.targetPlatform, ["tiktok", "instagram_reels", "youtube_shorts", "multi_platform"], "multi_platform"),
    createdAt: created,
    updatedAt: created,
    autosavedAt: null
  });
  state.mediaProjects.unshift(project);
  return project;
}

async function createMediaSourceFromFile({
  filePath,
  originalFilename,
  mimeType,
  title,
  projectId,
  mode = "real",
  provenance = PROVENANCE.AUTHORIZED_UPLOAD,
  permissionStatus = "uploaded",
  rightsStatus = "operator_review_required",
  sourceType = "",
  provider = "",
  streamerId = "",
  watchSessionId = "",
  recordingWindowIndex = null,
  liveWindowStartSeconds = null,
  liveWindowEndSeconds = null,
  audioEnergy = null,
  watchWindowTrigger = "",
  watchWindowTriggerAt = "",
  watchWindowSignals = null
}) {
  await fs.stat(filePath);
  const [metadata, stat, sha256] = await Promise.all([
    ffprobeMetadata(filePath),
    fs.stat(filePath),
    fileSha256(filePath)
  ]);
  const source = normalizeMediaSourceRecord({
    id: newId("media"),
    ownerId: "local",
    projectId: cleanText(projectId) || null,
    sourceType: cleanText(sourceType) || (mode === "practice" ? "practice" : "upload"),
    provider: cleanText(provider) || (mode === "practice" ? "local" : "upload"),
    providerSourceId: null,
    streamerId: cleanText(streamerId),
    watchSessionId: cleanText(watchSessionId),
    recordingWindowIndex: Number.isFinite(Number(recordingWindowIndex)) ? Number(recordingWindowIndex) : null,
    liveWindowStartSeconds: Number.isFinite(Number(liveWindowStartSeconds)) ? Number(liveWindowStartSeconds) : null,
    liveWindowEndSeconds: Number.isFinite(Number(liveWindowEndSeconds)) ? Number(liveWindowEndSeconds) : null,
    displayName: cleanText(title) || originalFilename || path.basename(filePath),
    title: cleanText(title) || originalFilename || path.basename(filePath),
    originalFilename,
    storagePath: filePath,
    filePath,
    mimeType: mimeType || contentTypeFor(filePath).split(";")[0],
    fileSizeBytes: stat.size,
    sha256,
    durationSeconds: metadata.durationSeconds,
    duration: metadata.durationSeconds,
    width: metadata.width,
    height: metadata.height,
    frameRate: metadata.frameRate,
    fps: metadata.fps,
    hasAudio: metadata.hasAudio,
    audioEnergy,
    audioEnergyDb: Number.isFinite(Number(audioEnergy?.maxVolumeDb)) ? Number(audioEnergy.maxVolumeDb) : null,
    audioMeanDb: Number.isFinite(Number(audioEnergy?.meanVolumeDb)) ? Number(audioEnergy.meanVolumeDb) : null,
    isLoudMoment: Boolean(audioEnergy?.isLoudMoment),
    watchWindowTrigger: cleanText(watchWindowTrigger),
    watchWindowTriggerAt: cleanText(watchWindowTriggerAt) || null,
    watchWindowSignals: watchWindowSignals && typeof watchWindowSignals === "object" ? watchWindowSignals : null,
    status: "ready",
    provenance,
    permissionStatus,
    rightsStatus,
    verifiedAt: now(),
    probeStatus: "passed",
    playable: true,
    transcriptStatus: PROVENANCE.UNAVAILABLE,
    label: mode === "practice" ? "PRACTICE MEDIA" : "VERIFIED UPLOAD",
    warning: mode === "practice"
      ? "Practice media is for workflow testing only."
      : "Operator-uploaded media. Rights must be reviewed before external publishing.",
    createdAt: now(),
    updatedAt: now()
  });
  state.mediaSources.unshift(source);
  return source;
}

async function registerUploadedMedia({ file, fields }) {
  if (!file?.buffer?.length) {
    const error = new Error("Choose a real video file before creating a Clip Project.");
    error.statusCode = 400;
    throw error;
  }
  const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}-${sanitizeFilename(file.filename)}`;
  const filePath = path.join(config.uploadDir, filename);
  await fs.writeFile(filePath, file.buffer);
  const project = await createClipProject({
    title: fields.title || file.filename || "Uploaded Clip Project",
    description: fields.description,
    mode: "real"
  });
  const source = await createMediaSourceFromFile({
    filePath,
    originalFilename: file.filename || filename,
    mimeType: file.mimeType || contentTypeFor(filePath).split(";")[0],
    title: fields.title || file.filename,
    projectId: project.id,
    mode: "real",
    provenance: PROVENANCE.AUTHORIZED_UPLOAD,
    permissionStatus: cleanText(fields.permissionStatus) || "uploaded",
    rightsStatus: cleanText(fields.rightsStatus) || "operator_review_required"
  });
  Object.assign(project, {
    sourceId: source.id,
    activeSourceId: source.id,
    status: "source_ready",
    updatedAt: now(),
    autosavedAt: now()
  });
  const candidate = defaultCandidateForSource(project, source);
  await logEvent("media_uploaded", "Operator uploaded a verified media source", {
    projectId: project.id,
    sourceId: source.id,
    candidateId: candidate.id,
    sha256: source.sha256
  });
  await saveState();
  return { project: publicClipProject(project), source: publicMediaSource(source), candidate };
}

async function ensurePracticeProject() {
  const existing = state.mediaProjects.find((project) => project.id === DEMO_PROJECT_ID);
  const metadata = await ffprobeMetadata(DEMO_MEDIA_FILE);
  let source = state.mediaSources.find((item) => item.id === DEMO_MEDIA_SOURCE_ID);
  if (!source) {
    source = await createMediaSourceFromFile({
      filePath: DEMO_MEDIA_FILE,
      originalFilename: "demo-source.mp4",
      mimeType: "video/mp4",
      title: "StreamClipper Practice Media",
      projectId: DEMO_PROJECT_ID,
      mode: "practice",
      provenance: PROVENANCE.DEMO_SOURCE,
      permissionStatus: "practice_only",
      rightsStatus: "practice_only"
    });
    source.id = DEMO_MEDIA_SOURCE_ID;
  } else {
    Object.assign(source, normalizeMediaSourceRecord({
      ...source,
      sourceType: "practice",
      provenance: PROVENANCE.DEMO_SOURCE,
      permissionStatus: "practice_only",
      rightsStatus: "practice_only",
      durationSeconds: metadata.durationSeconds,
      duration: metadata.durationSeconds,
      width: metadata.width,
      height: metadata.height,
      frameRate: metadata.frameRate,
      fps: metadata.fps,
      hasAudio: metadata.hasAudio,
      mimeType: "video/mp4",
      filePath: DEMO_MEDIA_FILE,
      playable: true,
      status: "ready",
      label: "PRACTICE MEDIA",
      warning: "Bundled practice media is for local workflow testing only."
    }));
  }
  let project = existing;
  if (!project) {
    project = await createClipProject({
      id: DEMO_PROJECT_ID,
      title: "Practice Clip Project",
      description: "Bundled playable media for testing the clipping workflow.",
      mode: "practice",
      sourceId: source.id
    });
  }
  Object.assign(project, normalizeClipProjectRecord({
    ...project,
    title: project.title || "Practice Clip Project",
    sourceId: source.id,
    activeSourceId: source.id,
    mode: "practice",
    status: "source_ready",
    updatedAt: now(),
    autosavedAt: now()
  }));
  const definitions = demoCandidateDefinitions(source.id);
  const candidates = [];
  for (const candidate of definitions) {
    const end = Math.min(Number(candidate.timestampEndSeconds || 0), metadata.durationSeconds || candidate.timestampEndSeconds || 0);
    const normalizedCandidate = {
      ...candidate,
      projectId: project.id,
      endSeconds: end,
      timestampEndSeconds: end,
      timestampEnd: secondsToTimestamp(end),
      duration: Math.max(1, end - Number(candidate.timestampStartSeconds || 0)),
      durationSeconds: Math.max(1, end - Number(candidate.timestampStartSeconds || 0)),
      thumbnailUrl: `/api/media/sources/${encodeURIComponent(source.id)}/frame?candidateId=${encodeURIComponent(candidate.id)}`,
      qualityScore: null,
      score: null,
      confidence: null,
      measuredEvidence: [
        { label: "Bundled playable media", provenance: PROVENANCE.DEMO_SOURCE },
        { label: "FFprobe verified file", provenance: PROVENANCE.VERIFIED_MEDIA }
      ],
      reason: "Practice timestamp from bundled playable media. Transcript and live metrics are unavailable.",
      updatedAt: now()
    };
    const existingCandidate = state.clipCandidates.find((item) => item.id === normalizedCandidate.id);
    if (existingCandidate) Object.assign(existingCandidate, normalizedCandidate);
    else state.clipCandidates.unshift(normalizedCandidate);
    candidates.push(existingCandidate || normalizedCandidate);
  }
  const selected = candidates[0] || defaultCandidateForSource(project, source);
  Object.assign(project, {
    candidateId: selected.id,
    selectedCandidateId: selected.id,
    clipStartSeconds: selected.timestampStartSeconds,
    clipEndSeconds: selected.timestampEndSeconds,
    status: "source_ready",
    updatedAt: now(),
    autosavedAt: now()
  });
  ensureProjectEditDecisionList(project, source, selected);
  return { project, source, candidates };
}

async function extractSourceFrame(source, candidate = null, explicitTime = null) {
  const normalized = normalizeMediaSourceRecord(source);
  if (!normalized.playable || !source.filePath) {
    throw Object.assign(new Error("Frame extraction requires verified playable media."), { statusCode: 422 });
  }
  const timestamp = Math.max(0, Number(explicitTime ?? candidate?.timestampStartSeconds ?? candidate?.startSeconds ?? 0));
  const safeKey = `${source.id}-${candidate?.id || "frame"}-${Math.round(timestamp * 1000)}`.replace(/[^a-z0-9_-]+/gi, "-");
  const outputPath = path.join(THUMBNAIL_DIR, `${safeKey}.jpg`);
  try {
    await fs.stat(outputPath);
    return outputPath;
  } catch {
    // Generate below.
  }
  await execFileAsync(ffmpegExecutable, [
    "-y",
    "-ss",
    String(timestamp),
    "-i",
    source.filePath,
    "-frames:v",
    "1",
    "-vf",
    "scale=640:-2",
    outputPath
  ], { timeout: 20000, maxBuffer: 1024 * 1024 });
  return outputPath;
}

async function createRenderJob(body = {}) {
  const requestedProjectId = cleanText(body.projectId);
  const project = state.mediaProjects.find((item) => item.id === requestedProjectId)
    || state.mediaProjects.find((item) => item.id === cleanText(body.editProjectId))
    || state.mediaProjects[0];
  if (!project) throw Object.assign(new Error("Create or open a Clip Project before rendering."), { statusCode: 404 });
  const normalizedProject = normalizeClipProjectRecord(project);
  Object.assign(project, normalizedProject);
  const candidate = state.clipCandidates.find((item) => item.id === cleanText(body.candidateId || normalizedProject.candidateId))
    || state.clipCandidates.find((item) => item.sourceId === normalizedProject.sourceId)
    || null;
  const source = findMediaSource(cleanText(body.sourceId || normalizedProject.sourceId || candidate?.sourceId));
  if (!candidate) throw Object.assign(new Error("No playable candidate is selected."), { statusCode: 404 });
  if (!source?.filePath) throw Object.assign(new Error("Source data unavailable. Upload or select playable media first."), { statusCode: 400 });
  const sourcePath = source.filePath;
  await fs.stat(sourcePath);
  const readiness = projectReadiness(normalizedProject, source, candidate);
  if (!readiness.canRender) {
    throw Object.assign(new Error(`Render blocked: ${readiness.renderReasons.join(" ")}`), { statusCode: 422 });
  }
  const safeTitle = (candidate.suggestedTitle || candidate.title || "clip-render").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "clip-render";
  const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}-${safeTitle}-9x16.mp4`;
  const outputPath = path.join(config.outputDir, filename);
  const start = Math.max(0, Number(body.startSeconds ?? normalizedProject.clipStartSeconds ?? candidate.timestampStartSeconds ?? 0));
  const end = Number(body.endSeconds ?? normalizedProject.clipEndSeconds ?? candidate.timestampEndSeconds ?? start + Number(candidate.durationSeconds || candidate.duration || 8));
  const duration = Math.max(1, Math.min(90, end - start));
  const job = {
    id: newId("render_job"),
    projectId: normalizedProject.id,
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
      projectId: normalizedProject.id,
      sourceId: source.id,
      candidateId: candidate.id,
      renderJobId: job.id,
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
        ? "Rendered from bundled practice media. Not a real live stream."
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
    project.activeRenderJobId = job.id;
    project.latestArtifactId = artifact.id;
    project.status = "review";
    project.updatedAt = now();
    project.autosavedAt = now();
    const linkedPackage = state.clipPackages.find((item) => item.candidateId === candidate.id);
    if (linkedPackage) {
      linkedPackage.renderedArtifactId = artifact.id;
      linkedPackage.updatedAt = now();
    }
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

function eventSubConfigured() {
  return Boolean(config.twitchEventSubSecret && config.twitchEventSubCallbackUrl);
}

function verifyTwitchEventSubSignature(req, rawBody) {
  if (!config.twitchEventSubSecret) return false;
  const signature = cleanText(req.headers["twitch-eventsub-message-signature"]);
  const messageId = cleanText(req.headers["twitch-eventsub-message-id"]);
  const timestamp = cleanText(req.headers["twitch-eventsub-message-timestamp"]);
  if (!signature.startsWith("sha256=") || !messageId || !timestamp) return false;
  const expected = `sha256=${crypto
    .createHmac("sha256", config.twitchEventSubSecret)
    .update(messageId + timestamp)
    .update(rawBody)
    .digest("hex")}`;
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function eventSubBroadcasterId(eventData = {}) {
  return cleanText(
    eventData.broadcaster_user_id
      || eventData.to_broadcaster_user_id
      || eventData.from_broadcaster_user_id
      || eventData.user_id
  );
}

function findActiveWatchForEventSubEvent(eventData = {}) {
  const broadcasterId = eventSubBroadcasterId(eventData);
  const broadcasterLogin = normalizeTwitchLogin(
    eventData.broadcaster_user_login
      || eventData.to_broadcaster_user_login
      || eventData.from_broadcaster_user_login
      || eventData.user_login
  );
  for (const session of activeWatchSessions()) {
    if (session.status === "paused" || session.mode !== "real") continue;
    const streamer = findStreamer(session.streamerId);
    if (!streamer || streamer.platform !== "twitch" || !isRealApprovedStreamer(streamer)) continue;
    const streamerProviderId = cleanText(streamer.providerUserId);
    const streamerLogin = normalizeTwitchLogin(streamer.channelId || streamer.channelUrl || streamer.displayName);
    if (broadcasterId && streamerProviderId && broadcasterId === streamerProviderId) return { session, streamer };
    if (broadcasterLogin && streamerLogin && broadcasterLogin === streamerLogin) return { session, streamer };
  }
  return { session: null, streamer: null };
}

function eventSubTriggerName(eventType = "") {
  return `eventsub_${cleanText(eventType).replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase() || "notification"}`;
}

async function triggerEventSubCapture(session, streamer, eventType, eventData = {}) {
  if (!session || !streamer || session.mode !== "real" || !isRealApprovedStreamer(streamer)) return null;
  const windowIndex = Math.max(0, Math.floor(Number(session.analyzedSeconds || 0) / WATCH_RECORDING_WINDOW_SECONDS));
  const trigger = eventSubTriggerName(eventType);
  session.lastEventSubTrigger = { type: eventType, at: now(), data: eventData };
  session.lastCaptureTrigger = trigger;
  session.lastCaptureTriggerAt = now();
  await appendWatchEvent(session.id, "eventsub_trigger", {
    type: eventType,
    trigger,
    streamerId: streamer.id,
    message: "Twitch EventSub hard trigger received. Capturing the current local watch window."
  });
  const mission = state.clipMissions.find((item) => item.id === session.clipProfileId || item.id === session.missionId) || ensureClipMission(streamer);
  const source = await captureLiveWindowForSession(session, {
    streamer,
    mission,
    windowIndex,
    watchTrigger: trigger,
    watchTriggerSignals: {
      eventSubType: eventType,
      eventSubData: eventData
    }
  });
  if (source) {
    const capabilities = capabilitiesForWatchSource({ session, source, streamer });
    await ensureWatchSessionCandidates(session);
    await autoStageCapturedCandidatesForBuilder(session, source, trigger);
    await appendWatchEvent(session.id, "eventsub_capture_completed", {
      type: eventType,
      sourceId: source.id,
      capabilities,
      message: "EventSub-triggered buffer is saved and available for Clip Radar scoring."
    });
  }
  await saveState();
  return source;
}

async function handleTwitchEventSubWebhook(req, res) {
  const rawBody = await readRawBody(req);
  if (!verifyTwitchEventSubSignature(req, rawBody)) {
    return sendError(res, 403, "Invalid Twitch EventSub signature.");
  }
  const json = JSON.parse(rawBody.toString("utf8") || "{}");
  const messageType = cleanText(req.headers["twitch-eventsub-message-type"]);
  if (messageType === "webhook_callback_verification" && json.challenge) {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end(String(json.challenge));
    return;
  }
  if (messageType === "revocation") {
    addStateLog("eventsub_revoked", "Twitch EventSub subscription was revoked", {
      subscriptionType: json.subscription?.type || "",
      status: json.subscription?.status || ""
    });
    await saveState();
    return sendJson(res, 200, { ok: true, revoked: true });
  }
  if (messageType !== "notification") return sendJson(res, 202, { ok: true, ignored: messageType || "unknown" });
  const eventType = cleanText(json.subscription?.type);
  if (!EVENTSUB_EVENT_TYPES.includes(eventType)) return sendJson(res, 202, { ok: true, ignored: eventType });
  const eventData = json.event || {};
  const { session, streamer } = findActiveWatchForEventSubEvent(eventData);
  if (!session || !streamer) {
    addStateLog("eventsub_no_active_watch", "Twitch EventSub notification had no active approved watch session", {
      eventType,
      broadcasterId: eventSubBroadcasterId(eventData)
    });
    await saveState();
    return sendJson(res, 202, { ok: true, matched: false });
  }
  triggerEventSubCapture(session, streamer, eventType, eventData).catch((error) => {
    addStateLog("eventsub_capture_error", "EventSub-triggered capture failed", {
      sessionId: session.id,
      streamerId: streamer.id,
      eventType,
      error: error.message
    });
  });
  return sendJson(res, 202, { ok: true, matched: true, sessionId: session.id, streamerId: streamer.id });
}

function eventSubConditionForType(type, broadcasterId) {
  if (type === "channel.raid") return { to_broadcaster_user_id: broadcasterId };
  return { broadcaster_user_id: broadcasterId };
}

async function subscribeToEventSub(streamer) {
  if (!eventSubConfigured()) {
    addStateLog("eventsub_skipped", "Twitch EventSub subscription skipped because webhook configuration is missing", {
      streamerId: streamer?.id || "",
      callbackConfigured: Boolean(config.twitchEventSubCallbackUrl),
      secretConfigured: Boolean(config.twitchEventSubSecret)
    });
    return { configured: false, skipped: true, subscriptions: [] };
  }
  if (!streamer || streamer.platform !== "twitch" || !isRealApprovedStreamer(streamer)) {
    return { configured: true, skipped: true, reason: "streamer_not_approved_for_twitch", subscriptions: [] };
  }
  const broadcasterId = cleanText(streamer.providerUserId);
  if (!/^\d+$/.test(broadcasterId)) {
    addStateLog("eventsub_skipped", "Twitch EventSub subscription skipped because broadcaster ID is missing", {
      streamerId: streamer.id,
      channelId: streamer.channelId
    });
    return { configured: true, skipped: true, reason: "missing_broadcaster_id", subscriptions: [] };
  }
  const existing = Array.isArray(streamer.eventSubSubscriptions) ? streamer.eventSubSubscriptions : [];
  streamer.eventSubSubscriptions = existing.filter((subscription) => subscription?.id && subscription?.type);
  const existingTypes = new Set(streamer.eventSubSubscriptions.map((subscription) => subscription.type));
  const token = await getTwitchAppToken();
  const created = [];
  for (const type of EVENTSUB_EVENT_TYPES) {
    if (existingTypes.has(type)) continue;
    const payload = {
      type,
      version: "1",
      condition: eventSubConditionForType(type, broadcasterId),
      transport: {
        method: "webhook",
        callback: config.twitchEventSubCallbackUrl,
        secret: config.twitchEventSubSecret
      }
    };
    const response = await fetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
      method: "POST",
      headers: {
        "Client-Id": config.twitchClientId,
        Authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      addStateLog("eventsub_subscribe_failed", "Twitch EventSub subscription request failed", {
        streamerId: streamer.id,
        type,
        status: response.status,
        message: json.message || ""
      });
      continue;
    }
    const subscription = json.data?.[0] || null;
    if (!subscription?.id) continue;
    const record = {
      id: subscription.id,
      type,
      status: subscription.status || "pending",
      broadcasterId,
      callbackUrl: config.twitchEventSubCallbackUrl,
      createdAt: now()
    };
    streamer.eventSubSubscriptions.push(record);
    created.push(record);
  }
  streamer.updatedAt = now();
  if (created.length) await saveState();
  return { configured: true, skipped: false, created, subscriptions: streamer.eventSubSubscriptions };
}

async function unsubscribeEventSub(streamer) {
  const subscriptions = Array.isArray(streamer?.eventSubSubscriptions) ? streamer.eventSubSubscriptions : [];
  if (!subscriptions.length || !(config.twitchClientId && (config.twitchClientSecret || config.twitchAppAccessToken))) return [];
  const token = await getTwitchAppToken().catch(() => "");
  if (!token) return [];
  const removed = [];
  for (const subscription of subscriptions) {
    const id = cleanText(subscription?.id || subscription);
    if (!id) continue;
    const params = new URLSearchParams({ id });
    const response = await fetch(`https://api.twitch.tv/helix/eventsub/subscriptions?${params}`, {
      method: "DELETE",
      headers: {
        "Client-Id": config.twitchClientId,
        Authorization: `Bearer ${token}`
      }
    });
    if (response.ok || response.status === 404) removed.push(id);
  }
  if (removed.length) {
    streamer.eventSubSubscriptions = subscriptions.filter((subscription) => !removed.includes(cleanText(subscription?.id || subscription)));
    streamer.updatedAt = now();
  }
  return removed;
}

async function createOfficialTwitchClip(streamer, candidate) {
  if (streamer?.platform !== "twitch") return null;
  const broadcasterId = cleanText(streamer.providerUserId);
  if (!broadcasterId || !/^\d+$/.test(broadcasterId)) {
    await appendWatchEvent(candidate.watchSessionId, "twitch_clip_skipped", {
      candidateId: candidate.id,
      reason: "missing_broadcaster_id",
      message: "Official Twitch Clip was skipped because this streamer record does not have a numeric broadcaster ID yet."
    });
    return null;
  }
  const token = twitchUserToken();
  if (!token) {
    await appendWatchEvent(candidate.watchSessionId, "twitch_clip_skipped", {
      candidateId: candidate.id,
      reason: "missing_user_token",
      message: "Official Twitch Clip was skipped because TWITCH_USER_ACCESS_TOKEN/TWITCH_OAUTH_TOKEN is not configured."
    });
    return null;
  }
  const params = new URLSearchParams({ broadcaster_id: broadcasterId });
  const response = await fetch(`https://api.twitch.tv/helix/clips?${params}`, {
    method: "POST",
    headers: {
      "Client-Id": config.twitchClientId,
      Authorization: `Bearer ${token}`
    }
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    await appendWatchEvent(candidate.watchSessionId, "twitch_clip_failed", {
      candidateId: candidate.id,
      status: response.status,
      message: json.message || "Twitch Clip API request failed."
    });
    return null;
  }
  const clip = json.data?.[0] || null;
  if (!clip?.id) return null;
  candidate.officialTwitchClip = {
    id: clip.id,
    editUrl: clip.edit_url || "",
    createdAt: now()
  };
  candidate.measuredEvidence = [
    ...(candidate.measuredEvidence || []),
    { label: "Official Twitch Clip object created", provenance: PROVENANCE.TWITCH_CLIP }
  ];
  await appendWatchEvent(candidate.watchSessionId, "twitch_clip_created", {
    candidateId: candidate.id,
    twitchClipId: clip.id,
    editUrl: clip.edit_url || ""
  });
  return clip;
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
    providerUserId: cleanText(stream.user_id),
    displayName: stream.user_name || stream.user_login || "Twitch streamer",
    channelId: stream.user_login || stream.user_id || "",
    channelUrl: stream.user_login ? `https://www.twitch.tv/${stream.user_login}` : "",
    title: stream.title || "",
    category,
    viewerCount: Number(stream.viewer_count || 0),
    thumbnail: stream.thumbnail_url || "",
    startedAt: stream.started_at || "",
    source: "Official Twitch Helix live directory",
    sourceType: "official_live",
    liveStatus: "live",
    liveVerified: true,
    canAutoMonitor: true
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
    source: "Official Kick public live directory",
    sourceType: "official_live",
    liveStatus: "live",
    liveVerified: true,
    canAutoMonitor: true
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

function fallbackStreamerRecommendations(limit, platform = "all") {
  const allowed = platform === "all" ? new Set(["kick", "twitch"]) : new Set([platform]);
  return [
    ["kick", "xqc", "xQc", "High-volume live audience with strong reaction potential.", "Just Chatting", 96],
    ["kick", "adinross", "Adin Ross", "Large Kick-native audience; needs brand-safety review before monitoring.", "Just Chatting", 88],
    ["twitch", "kaicenat", "KaiCenat", "High-energy creator with frequent clip-worthy moments.", "Just Chatting", 94],
    ["twitch", "caseoh_", "caseoh_", "Large Twitch audience and recurring reaction-friendly segments.", "Just Chatting", 92],
    ["twitch", "zackrawrr", "zackrawrr", "Consistent live personality content with strong clip-review potential.", "Just Chatting", 89],
    ["twitch", "tarik", "tarik", "Esports creator with repeatable VALORANT clip potential.", "VALORANT", 86],
    ["twitch", "hasanabi", "HasanAbi", "Long-form commentary creates many possible reaction clips.", "Just Chatting", 82],
    ["twitch", "lirik", "LIRIK", "Variety streams are useful for supervised highlight scouting.", "Variety", 78]
  ].filter(([itemPlatform]) => allowed.has(itemPlatform)).slice(0, limit).map(([platform, channelId, displayName, reason, category, score]) => ({
    platform,
    channelId,
    displayName,
    channelUrl: platform === "kick" ? `https://kick.com/${channelId}` : `https://www.twitch.tv/${channelId}`,
    title: "Manual review recommendation - live status not verified",
    category,
    viewerCount: 0,
    thumbnail: "",
    score,
    reason,
    suggestedUse: ["clips", "edits", "reposts"],
    source: platform === "twitch" ? "Agent 101 Twitch fallback shortlist" : "Agent 101 fallback shortlist",
    sourceType: "manual_review",
    liveStatus: "unverified",
    liveVerified: false,
    canAutoMonitor: false,
    requiresReview: true
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

  const usedFallback = recommendations.length === 0;
  let manualReviewRecommendations = [];
  if (usedFallback) {
    manualReviewRecommendations = fallbackStreamerRecommendations(max, platform)
      .filter((row) => row.channelId)
      .filter((row) => {
        const key = streamerIdentityKey(row);
        if (existing.has(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }
  const providerConfigured = providers.some((provider) => (
    provider === "kick" ? kickApiConfigured() : provider === "twitch" ? twitchApiConfigured() : false
  ));
  const providerBlocked = !providerConfigured;

  return {
    recommendations,
    manualReviewRecommendations,
    errors,
    providers: {
      kickConfigured: kickApiConfigured(),
      twitchConfigured: twitchApiConfigured()
    },
    generatedBy: "Agent 101 Streamer Scout",
    fallbackUsed: usedFallback,
    providerBlocked,
    message: recommendations.some((row) => row.sourceType === "official_live")
      ? "Agent 101 found live streamer recommendations from configured provider APIs."
      : providerBlocked
        ? "Live scout needs provider API access before it can rank real streams. Connect Twitch/Kick in Integrations or add a channel manually for Human Gate review."
        : "No verified live streams were returned by the configured provider APIs right now. Agent 101 did not create fake live recommendations."
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
  streamer.providerUserId = stream?.user_id || stream?.broadcaster_user_id || streamer.providerUserId || "";
  streamer.channelId = stream?.user_login || stream?.slug || streamer.channelId;
  streamer.lastLiveAt = stream ? now() : streamer.lastLiveAt;
  const detectedGenre = stream ? detectClipGenre(streamer.liveCategory || stream.game_name || streamer.liveTitle) : "";
  ensureStreamerDetectionProfile(
    streamer,
    detectedGenre && (!streamer.clipProfile?.genre || streamer.clipProfile.genre === "general") ? { genre: detectedGenre } : {}
  );
  if (!stream) await stopOfflineWatchSessionsForStreamer(streamer, "provider_offline");
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

const LEGACY_AGENT101_CLIPPING_PROMPT = `You are Agent 101, a truthful supervised clipping agent inside StreamClipper. Never claim you found, watched, clipped, rendered, queued, or posted media unless the corresponding verified record or file exists. Honor requested quantities exactly. If the user requests two streamers, return no more than two. Do not silently expand scope. Real mode may only use real Twitch/Kick records from official APIs with provider IDs, fetch timestamps, and response hashes. Practice mode must be explicitly requested and clearly labeled PRACTICE MEDIA — NOT A REAL STREAM. Follow the workflow in order: discovery, validation, rights, source, analysis, candidate, clip, verify, posting draft, approval. Do not create downstream artifacts before prerequisites are complete. If a real integration, right, or media source is unavailable, explain the exact blocker and stop. Do not replace a failed real action with a simulation.`;

const AGENT101_SYSTEM_PROMPT = `You are Agent 101, an autonomous business-building AI agent inside Argentum OS.

Your purpose is to take a plain-English business description or task from the operator and deliver a finished, working result -- not a plan, not a skeleton, not a tutorial. A finished result.

You think in steps. For every task:
1. Break it into concrete subtasks
2. Execute each subtask using your tools
3. Verify the output of each tool before moving to the next step
4. If a tool fails, diagnose the failure and try a different approach -- do not give up after one error
5. When finished, call create_handoff_doc so the operator knows exactly what was built and what they need to do

Rules you never break:
- Never fabricate file contents without writing them. If you say a file exists, it must exist.
- Never claim a task is done until you have verified the output.
- Never call run_shell without first calling request_human_approval and confirming it returned approved status.
- Never write files outside the outputs/ directory without explicit operator permission.
- Never store API keys in files -- always use environment variable placeholders and document what the operator must fill in.
- Never contact real external APIs (Stripe, TikTok, Instagram, etc.) directly -- generate the integration code and document what the operator activates manually.
- CapCut editing may use capcut_edit_clip only with a verified rendered clip or explicit local clip path. Export/download must stay behind Human Gate and operator control.
- Always separate what you built from what the operator must do themselves.

When you are uncertain, ask one clarifying question. Do not ask multiple questions at once.

When a task requires information you do not have (the operator's business name, their prices, their target market), stop and ask for it before building.

You have access to the following tools: read_file, write_file, list_files, run_shell (requires approval), run_node_script, scaffold_website, add_stripe_checkout, add_email_flow, generate_deployment_config, write_copy, generate_brand_identity, write_product_listings, generate_product_image, generate_hero_image, generate_logo_concept, search_web, analyze_competitor, get_market_data, create_project_plan, create_handoff_doc, capcut_edit_clip, request_human_approval, check_approval_status.

You do not have these tools and must tell the operator if they are needed: creating Stripe accounts, buying domains, connecting social media accounts, placing real orders, publishing live websites (you generate deployment configs but the operator runs the deploy command).`;

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
        input: `${LEGACY_AGENT101_CLIPPING_PROMPT}

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
        input: `${LEGACY_AGENT101_CLIPPING_PROMPT}

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

function resolveRenderedArtifactReference(reference, fallbackReference = "") {
  const key = cleanText(reference || fallbackReference);
  if (!key) return null;
  const directArtifact = state.artifacts.find((artifact) => artifact.id === key);
  if (directArtifact) return directArtifact;
  const job = state.mediaJobs.find((item) => item.id === key);
  if (job?.artifactId) return state.artifacts.find((artifact) => artifact.id === job.artifactId) || null;
  return state.artifacts.find((artifact) => artifact.content?.renderJobId === key) || null;
}

async function createHandoffPackage(body = {}) {
  const clipPackage = resolveClipPackageForHandoff(body);
  if (!clipPackage) {
    throw Object.assign(new Error("No clip package is ready for a CapCut handoff."), { statusCode: 404 });
  }
  const candidate = state.clipCandidates.find((item) => item.id === clipPackage.candidateId);
  const streamer = findStreamer(candidate?.streamerId);
  const rendered = resolveRenderedArtifactReference(body.renderId || body.renderedArtifactId, clipPackage.renderedArtifactId);
  if (!artifactIsVerifiedClip(rendered)) {
    throw Object.assign(new Error("CapCut handoff requires a verified rendered MP4 first."), { statusCode: 422 });
  }
  const existing = state.handoffPackages.find(
    (handoff) => handoff.clipPackageId === clipPackage.id
      && handoff.renderId === rendered.id
      && !["COMPLETED", "CANCELLED"].includes(handoff.status)
  );
  if (existing) return { handoff: existing, reused: true };
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
  addAgentLog(run, "agent_tool", "Agent 101 prepared practice streamer workspace", { added, updated });
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
      reason: "Agent 101 generated this safe practice candidate from the internal clipping workflow.",
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
      scoringProvider: "openai",
      scoreEvidence: {
        source: "openai",
        verified: true,
        message: "Score was produced by the configured AI scorer from the candidate evidence available at scoring time."
      }
    } : {
      engagementPotential: localScore.score,
      retentionPotential: Math.min(100, localScore.score + 3),
      scoringProvider: "local_fallback",
      scoreEvidence: {
        source: "local_heuristic",
        verified: false,
        message: "Fallback score only. Needs transcript, chat, visual analysis, or operator score before it is considered real."
      }
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

function shouldUseAgent101Studio(body = {}) {
  if (body.agentMode === "studio" || body.studio === true || body.context?.agent101Studio) return true;
  const message = cleanText(body.message || body.goal || "");
  if (!message) return false;
  const businessIntent = /\b(build|website|site|shop|store|stripe|checkout|brand|identity|logo|email|landing|saas|portfolio|blog|deploy|deployment|copy|product listing|market|competitor|business plan|handoff|project plan)\b/i.test(message);
  const clippingIntent = /\b(clip|stream|streamer|twitch|kick|watch|radar|capcut|posting|candidate|human gate)\b/i.test(message);
  return businessIntent && !clippingIntent;
}

function extractAgent101Message(body = {}) {
  return cleanText(body.message || body.goal || body.prompt || "");
}

function estimateAnthropicCostUsd(usage = {}) {
  const input = Number(usage.input_tokens || 0);
  const output = Number(usage.output_tokens || 0);
  return Number((((input * 3) + (output * 15)) / 1_000_000).toFixed(6));
}

function studioSessionRuns(sessionId) {
  return (state.agentRuns || [])
    .filter((run) => run.kind === "agent101_studio" && run.sessionId === sessionId)
    .sort((a, b) => new Date(a.startedAt || 0) - new Date(b.startedAt || 0));
}

function publicAgent101Session(sessionId) {
  const runs = studioSessionRuns(sessionId);
  if (!runs.length) return null;
  const first = runs[0];
  const last = runs.at(-1);
  const outputFiles = [...new Map(runs.flatMap((run) => run.outputFiles || []).map((file) => [file.path || file, file])).values()];
  return {
    sessionId,
    firstMessage: first.userMessage || first.goal || "",
    lastMessage: last.response || last.summary || "",
    timestamp: last.completedAt || last.startedAt,
    status: last.status,
    runCount: runs.length,
    outputFiles,
    costEstimateUsd: runs.reduce((total, run) => total + Number(run.costEstimateUsd || 0), 0)
  };
}

function listAgent101Sessions() {
  const ids = [...new Set((state.agentRuns || [])
    .filter((run) => run.kind === "agent101_studio" && run.sessionId)
    .map((run) => run.sessionId))];
  return ids
    .map(publicAgent101Session)
    .filter(Boolean)
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
}

function agent101OutputFileObjects(run) {
  return (run.outputFiles || [])
    .map((item) => typeof item === "string" ? { path: item } : item)
    .filter((item) => cleanText(item.path));
}

function rememberAgent101OutputFiles(run, result) {
  const seen = new Map(agent101OutputFileObjects(run).map((file) => [file.path, file]));
  const inspect = (value) => {
    if (!value) return;
    if (typeof value === "string") {
      if (value.startsWith("outputs/")) seen.set(value, { path: value });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(inspect);
      return;
    }
    if (typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (["path", "image_path"].includes(key) && typeof child === "string" && child.startsWith("outputs/")) {
          seen.set(child, { path: child });
        }
        if (["files_created", "outputFiles", "files"].includes(key)) inspect(child);
      }
    }
  };
  inspect(result);
  run.outputFiles = [...seen.values()];
}

function addAgent101StudioEvent(run, type, message, details = {}) {
  const event = {
    id: newId("agent101_event"),
    type,
    message,
    details,
    createdAt: now()
  };
  run.events ||= [];
  run.steps ||= [];
  run.events.push(event);
  run.steps.push({ id: event.id, name: type, status: details.status || "running", message, details });
  run.currentStep = message;
  persistAgentRun(run);
  emitAgent101Stream(run.sessionId, type, { runId: run.runId, message, details, createdAt: event.createdAt });
  return event;
}

function makeAgent101ToolContext(run, anthropicClient = null) {
  return {
    projectRoot: __dirname,
    outputRoot: config.agent101OutputDir,
    config,
    state,
    runId: run.runId,
    sessionId: run.sessionId,
    anthropicClient,
    createApprovalRequest,
    saveState,
    logEvent,
    newId,
    now,
    browserWorkspace,
    capcutEditClip: (input) => runCapcutEditClip(input, { run, source: "agent101_tool" })
  };
}

async function executeAgent101StudioTool(run, name, input, toolContext) {
  const startedAt = now();
  const startMs = Date.now();
  addAgent101StudioEvent(run, "tool_start", `Agent 101 is running ${name.replaceAll("_", " ")}.`, {
    tool: name,
    input
  });
  try {
    const output = await executeTool(name, input || {}, toolContext);
    const durationMs = Date.now() - startMs;
    const record = {
      id: newId("tool_call"),
      name,
      input,
      output,
      durationMs,
      timestamp: startedAt,
      status: output?.error ? "error" : output?.requiresApproval ? "needs_approval" : "completed"
    };
    run.toolCalls ||= [];
    run.toolResults ||= [];
    run.toolCalls.push(record);
    run.toolResults.push({ tool: name, result: output, durationMs, timestamp: now() });
    rememberAgent101OutputFiles(run, output);
    if (output?.requiresApproval) run.status = "NEEDS_APPROVAL";
    addAgent101StudioEvent(run, output?.requiresApproval ? "approval_required" : "tool_result", output?.requiresApproval
      ? `${name.replaceAll("_", " ")} is waiting for Human Gate approval.`
      : `Agent 101 completed ${name.replaceAll("_", " ")}.`, {
        tool: name,
        output,
        durationMs,
        status: record.status
      });
    await saveState();
    return output;
  } catch (error) {
    const durationMs = Date.now() - startMs;
    const output = { error: true, message: error.message };
    const record = {
      id: newId("tool_call"),
      name,
      input,
      output,
      durationMs,
      timestamp: startedAt,
      status: "error"
    };
    run.toolCalls ||= [];
    run.toolResults ||= [];
    run.toolCalls.push(record);
    run.toolResults.push({ tool: name, result: output, durationMs, timestamp: now() });
    addAgent101StudioEvent(run, "tool_error", `${name.replaceAll("_", " ")} failed: ${error.message}`, {
      tool: name,
      error: error.message,
      durationMs,
      status: "error"
    });
    await saveState();
    return output;
  }
}

function buildAgent101HistoryMessages(sessionId, currentMessage) {
  const prior = studioSessionRuns(sessionId).slice(-6);
  const messages = [];
  for (const run of prior) {
    if (run.userMessage) messages.push({ role: "user", content: run.userMessage });
    if (run.response) messages.push({ role: "assistant", content: run.response });
  }
  messages.push({ role: "user", content: currentMessage });
  return messages;
}

async function runClaudeAgent101Studio(run, message) {
  const anthropicClient = new Anthropic({ apiKey: config.anthropicApiKey });
  const toolContext = makeAgent101ToolContext(run, anthropicClient);
  const messages = buildAgent101HistoryMessages(run.sessionId, message);
  let finalText = "";
  const usage = { input_tokens: 0, output_tokens: 0 };

  for (let iteration = 0; iteration < 25; iteration += 1) {
    addAgent101StudioEvent(run, "model_call", `Agent 101 is thinking through step ${iteration + 1}.`, { iteration });
    const response = await anthropicClient.messages.create({
      model: config.anthropicModel,
      max_tokens: 4096,
      system: AGENT101_SYSTEM_PROMPT,
      tools: TOOL_REGISTRY,
      messages
    });
    usage.input_tokens += Number(response.usage?.input_tokens || 0);
    usage.output_tokens += Number(response.usage?.output_tokens || 0);
    run.messages.push({ role: "assistant", content: response.content, createdAt: now() });

    const text = response.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    const toolUses = response.content.filter((part) => part.type === "tool_use");
    if (!toolUses.length) {
      finalText = text || "Agent 101 finished with no additional output.";
      break;
    }

    messages.push({ role: "assistant", content: response.content });
    const toolResults = [];
    for (const toolUse of toolUses) {
      const result = await executeAgent101StudioTool(run, toolUse.name, toolUse.input || {}, toolContext);
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: resultToToolText(result),
        is_error: Boolean(result?.error)
      });
      if (result?.requiresApproval) {
        finalText = `Human Gate approval is pending for ${toolUse.name}. Approve it in Human Gate, then rerun the request with the approval id if execution should continue.`;
      }
    }
    messages.push({ role: "user", content: toolResults });
    if (finalText && run.status === "NEEDS_APPROVAL") break;
  }

  if (!finalText) {
    finalText = "Agent 101 stopped after the 25-step safety cap. Review the generated files and run a follow-up if more work is needed.";
    run.status = run.status === "NEEDS_APPROVAL" ? run.status : "BLOCKED";
  }
  run.tokens = usage;
  run.costEstimateUsd = estimateAnthropicCostUsd(usage);
  return finalText;
}

function inferLocalBusinessName(message) {
  const called = message.match(/\bcalled\s+([A-Za-z0-9 '&-]{2,80})/i);
  if (called) {
    return called[1]
      .replace(/\b(?:with|for|that|which|where|including|and)\b.*$/i, "")
      .replace(/[.?!].*$/, "")
      .trim();
  }
  if (/3d printing/i.test(message)) return "PrintForge";
  const shop = message.match(/\b(?:for|about)\s+(?:a|my)?\s*([A-Za-z0-9 '&-]{3,80})(?:\s+(?:business|shop|website|brand|company))?/i);
  return shop ? shop[1].replace(/[.?!].*$/, "").trim() : "Argentum Build";
}

function inferLocalWebsiteType(message) {
  if (/\bshop|store|stripe|checkout|cart|pay|product\b/i.test(message)) return "shop";
  if (/\bsaas|software\b/i.test(message)) return "saas";
  if (/\bportfolio\b/i.test(message)) return "portfolio";
  if (/\bblog\b/i.test(message)) return "blog";
  return "landing";
}

async function runLocalAgent101Studio(run, message) {
  const toolContext = makeAgent101ToolContext(run, null);
  const name = inferLocalBusinessName(message);
  const type = inferLocalWebsiteType(message);
  const outputNotes = [];

  if (/\b(shell|command|terminal|npm run|npm install|node\s+)/i.test(message)) {
    const command = message.match(/\b(?:run|execute)\s+`([^`]+)`/i)?.[1]
      || message.match(/\b(npm\s+(?:run|install)[A-Za-z0-9 .:_/-]*)/i)?.[1]
      || "npm run check";
    const result = await executeAgent101StudioTool(run, "run_shell", { command }, toolContext);
    return result.requiresApproval
      ? "Shell execution is waiting for Human Gate approval. No command was executed."
      : "Shell command completed. Review the tool output for stdout and stderr.";
  }

  if (/\bbrand|identity|logo|tagline|social bio\b/i.test(message) && !/\bwebsite|shop|landing|site\b/i.test(message)) {
    const brand = await executeAgent101StudioTool(run, "generate_brand_identity", {
      business_description: message,
      industry: /3d printing/i.test(message) ? "3D printing" : "business services",
      target_audience: "buyers who want premium execution",
      vibe: "premium, clear, operator-grade"
    }, toolContext);
    outputNotes.push(...(brand.files_created || []));
    const handoff = await executeAgent101StudioTool(run, "create_handoff_doc", {
      project_path: `brand/${slugify(name)}`,
      what_was_built: ["Brand identity document", "Name options", "Taglines", "Voice guide", "Palette", "Logo concept direction"],
      what_operator_must_do: ["Choose the final brand name", "Create final vector logo in Canva/Looka/Figma", "Replace placeholder social copy with real account links"]
    }, toolContext);
    outputNotes.push(handoff.path);
    return `Brand identity package created for ${name}.`;
  }

  if (/\bemail|post-purchase|abandoned cart|welcome flow\b/i.test(message) && !/\bwebsite|shop|landing|site\b/i.test(message)) {
    const flow = await executeAgent101StudioTool(run, "add_email_flow", {
      website_path: `websites/${slugify(name)}`,
      events: ["order_confirmation", "shipping_update", "abandoned_cart", "welcome"],
      provider: "resend"
    }, toolContext);
    outputNotes.push(...(flow.files_created || []));
    await executeAgent101StudioTool(run, "create_handoff_doc", {
      project_path: `websites/${slugify(name)}`,
      what_was_built: ["Email templates", "Server-side sending module", "Email setup documentation"],
      what_operator_must_do: ["Create a Resend or SendGrid account", "Set provider API key server-side", "Send test emails before enabling live customer mail"]
    }, toolContext);
    return `Email flow files created for ${name}.`;
  }

  if (/\bwebsite|site|shop|store|landing|saas|portfolio|blog|3d printing|stripe|checkout\b/i.test(message)) {
    const scaffold = await executeAgent101StudioTool(run, "scaffold_website", {
      name,
      type,
      description: message,
      pages: type === "shop" ? ["Home", "Products", "Product Detail", "Cart", "Success", "Admin", "Contact"] : ["Home", "About", "Services", "Contact"],
      features: type === "shop"
        ? ["Product catalog", "Cart", "Stripe Checkout scaffold", "Admin order dashboard", "Mobile-first premium UI"]
        : ["Premium landing page", "Lead capture", "Operator handoff", "Mobile-first premium UI"]
    }, toolContext);
    outputNotes.push(...(scaffold.files_created || []));
    const sitePath = `websites/${slugify(name)}`;
    if (type === "shop" || /\bstripe|checkout|pay\b/i.test(message)) {
      const stripe = await executeAgent101StudioTool(run, "add_stripe_checkout", {
        website_path: sitePath,
        products: [
          { name: "Starter Custom Print", description: "Entry custom 3D print order", price_cents: 4900, currency: "usd" },
          { name: "Premium Custom Print", description: "Higher-detail custom 3D print order", price_cents: 12900, currency: "usd" }
        ]
      }, toolContext);
      outputNotes.push(...(stripe.files_created || []));
    }
    const deploy = await executeAgent101StudioTool(run, "generate_deployment_config", {
      website_path: sitePath,
      platform: "railway"
    }, toolContext);
    outputNotes.push(...(deploy.files_created || []));
    const handoff = await executeAgent101StudioTool(run, "create_handoff_doc", {
      project_path: sitePath,
      what_was_built: [
        `${type} website scaffold`,
        "Mobile-first vanilla CSS UI",
        "Server-side Node app",
        type === "shop" ? "Stripe Checkout setup files" : "Lead capture/contact flow",
        "Deployment configuration"
      ],
      what_operator_must_do: [
        "Review placeholder copy, products, and prices",
        "Paste provider keys only into server environment variables",
        "Run npm install and npm start in the generated project",
        "Test locally before deploying"
      ]
    }, toolContext);
    outputNotes.push(handoff.path);
    return `Generated a working ${type} website package for ${name}. Files were written under outputs/${sitePath}.`;
  }

  const plan = await executeAgent101StudioTool(run, "create_project_plan", {
    goal: message,
    timeline: "2 weeks",
    resources: { operator: "owner", agent: "Agent 101", approvals: "Human Gate" }
  }, toolContext);
  outputNotes.push(...(plan.files_created || []));
  await executeAgent101StudioTool(run, "create_handoff_doc", {
    project_path: `plans/${slugify(message)}`,
    what_was_built: ["Project plan"],
    what_operator_must_do: ["Approve the plan or run a follow-up with the missing business details"]
  }, toolContext);
  return "Created an operator project plan. Add a clearer build target and Agent 101 can generate the working files.";
}

async function runAgent101Studio(body = {}) {
  const message = extractAgent101Message(body);
  if (!message) throw Object.assign(new Error("message is required"), { statusCode: 400 });
  const sessionId = cleanText(body.sessionId) || newId("agent101_session");
  const runId = newId("agent101_run");
  const startedMs = Date.now();
  const run = {
    runId,
    sessionId,
    kind: "agent101_studio",
    agent: "Agent 101",
    status: "RUNNING",
    externalStatus: "running",
    provider: config.anthropicApiKey ? "anthropic" : "local_tool_fallback",
    model: config.anthropicApiKey ? config.anthropicModel : "local_tool_fallback",
    userMessage: message,
    goal: message,
    messages: [{ role: "user", content: message, createdAt: now() }],
    toolCalls: [],
    toolResults: [],
    outputFiles: [],
    events: [],
    steps: [],
    response: "",
    costEstimateUsd: 0,
    tokens: {},
    startedAt: now(),
    completedAt: null,
    currentStep: "Starting Agent 101 Studio"
  };
  persistAgentRun(run);
  addAgent101StudioEvent(run, "run_started", "Agent 101 Studio run started.", { provider: run.provider, model: run.model });
  await saveState();

  try {
    const response = config.anthropicApiKey
      ? await runClaudeAgent101Studio(run, message)
      : await runLocalAgent101Studio(run, message);
    run.response = response;
    run.summary = response;
    if (run.status !== "NEEDS_APPROVAL" && run.status !== "BLOCKED") run.status = "COMPLETED";
    run.externalStatus = toExternalRunStatus(run.status);
    run.completedAt = now();
    run.totalDurationMs = Date.now() - startedMs;
    run.toolCallCount = run.toolCalls.length;
    addAgent101StudioEvent(run, "run_completed", run.status === "NEEDS_APPROVAL" ? "Agent 101 paused for Human Gate approval." : "Agent 101 Studio run completed.", {
      status: run.status,
      toolCallCount: run.toolCallCount,
      outputFiles: run.outputFiles.length
    });
    await saveRunState(run);
    return {
      sessionId,
      runId,
      response: run.response,
      status: run.status,
      externalStatus: run.externalStatus,
      provider: run.provider,
      model: run.model,
      toolCallCount: run.toolCallCount,
      totalDurationMs: run.totalDurationMs,
      costEstimateUsd: run.costEstimateUsd,
      outputFiles: agent101OutputFileObjects(run),
      run
    };
  } catch (error) {
    run.status = "FAILED";
    run.externalStatus = "error";
    run.response = error.message;
    run.summary = error.message;
    run.completedAt = now();
    run.totalDurationMs = Date.now() - startedMs;
    addAgent101StudioEvent(run, "run_failed", error.message, { error: error.message, status: "error" });
    await saveRunState(run);
    return {
      sessionId,
      runId,
      response: error.message,
      status: run.status,
      externalStatus: run.externalStatus,
      provider: run.provider,
      model: run.model,
      toolCallCount: run.toolCalls.length,
      totalDurationMs: run.totalDurationMs,
      costEstimateUsd: run.costEstimateUsd,
      outputFiles: agent101OutputFileObjects(run),
      run
    };
  }
}

async function runAgent101(body = {}) {
  if (shouldUseAgent101Studio(body)) return runAgent101Studio(body);
  return runLegacyAgent101(body);
}

async function runLegacyAgent101(body = {}) {
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
      demoLabel: contract.sourceMode === "demo" ? "PRACTICE MEDIA — NOT A REAL STREAM" : "",
      sourceTruth: contract.sourceMode === "real" ? "Official provider data only. No synthetic fallback." : "Explicit Practice Mode only."
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
      addRunEvent(run, "INTEGRATION_CHECK", "not_required", "Practice Mode selected; official provider data is not required.", {
        demoLabel: "PRACTICE MEDIA — NOT A REAL STREAM"
      });
      const practice = await ensurePracticeProject();
      run.results.candidates = state.clipCandidates
        .filter((candidate) => candidate.projectId === practice.project.id)
        .slice(0, contract.requestedCount);
      run.counts = {
        requestedStreamers: contract.requestedCount,
        realStreamersFound: 0,
        demoCandidates: run.results.candidates.length,
        postingDraftsCreated: 0,
        approvalsCreated: 0
      };
      addRunEvent(run, "STREAM_DISCOVERY", "not_required", "Practice workspace is available. No real Twitch discovery was performed.", run.counts);
      addRunEvent(run, "COMPLETED", "succeeded", "Practice Mode prepared the local practice workspace only. It did not create real Twitch records or external posting drafts.", run.counts);
      run.status = "COMPLETED";
      run.externalStatus = "completed";
      run.progress = 100;
      run.completedAt = now();
      run.summary = "PRACTICE MEDIA — NOT A REAL STREAM. Local practice media is ready; no real streams, clips, posts, or approvals were fabricated.";
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
  const practice = await ensurePracticeProject();
  const seeded = {
    streamers: 0,
    candidates: practice.candidates.length,
    projectId: practice.project.id,
    sourceId: practice.source.id
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
      permissionStatus: "demo_approved",
      allowedUse: ["clips", "edits", "reposts"],
      monitorEnabled: true,
      lastCheckedAt: now(),
      liveStatus: "demo_live",
      isDemo: true,
      notes: "Practice-only creator for supervised StreamClipper workflow testing. Not real streamer permission.",
      createdAt: now(),
      updatedAt: now()
    });
    seeded.streamers += 1;
  }

  const profiles = demoStreamerProfiles();
  const activeStreamers = state.streamers
    .filter((streamer) => streamer.monitorEnabled && (streamer.isDemo || streamer.permissionStatus === "demo_approved"))
    .slice(0, 5);
  for (const [index, streamer] of activeStreamers.entries()) {
    const profile = profiles.find((item) => item[0].toLowerCase() === streamer.displayName.toLowerCase()) || profiles[index] || [];
    const session = {
      id: newId("session"),
      streamerId: streamer.id,
      platform: streamer.platform,
      title: `${streamer.displayName} supervised practice stream`,
      category: profile[2] || "Practice / manual review",
      startedAt: now(),
      endedAt: null,
      vodId: null,
      status: "demo"
    };
    state.streamSessions.unshift(session);
  }

  await logEvent("practice_seeded", "StreamClipper practice project started", seeded);
  await saveState();
  return seeded;
}

function commandCandidatePaths(command) {
  const raw = cleanText(command);
  if (!raw) return [];
  if (raw.includes(path.sep) || raw.startsWith(".")) return [raw];
  const macToolDirs = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  return [raw, ...macToolDirs.map((dir) => path.join(dir, raw))];
}

async function commandStatus(command, args = ["-version"]) {
  const candidates = commandCandidatePaths(command);
  for (const candidate of candidates) {
    try {
      const { stdout, stderr } = await execFileAsync(candidate, args, { timeout: 4000 });
      const firstLine = (stdout || stderr || "").split("\n")[0] || `${candidate} available`;
      return { configured: true, command: candidate, version: firstLine, tried: candidates };
    } catch {
      // Try the next common Mac tool path before reporting the recorder missing.
    }
  }
  return {
    configured: false,
    command: cleanText(command),
    tried: candidates,
    message: `${cleanText(command)} is not available to the server process.`
  };
}

async function mediaToolStatus() {
  const [ffmpeg, ffprobe, recorder] = await Promise.all([
    commandStatus(ffmpegExecutable),
    commandStatus(ffprobeExecutable),
    liveRecorderStatus()
  ]);
  return {
    mode: ffmpeg.configured && ffprobe.configured ? recorder.ready ? "local_capture_render_ready" : "local_render_ready" : "manual_handoff",
    ffmpeg,
    ffprobe,
    recorder,
    outputDir: config.outputDir,
    watchBufferDir: config.watchBufferDir,
    secretsExposed: false,
    notes: ffmpeg.configured && ffprobe.configured && recorder.ready
      ? "Local capture and render tools are available for real watch-window clips."
      : ffmpeg.configured && ffprobe.configured
        ? "Local rendering is available, but live capture needs streamlink or yt-dlp."
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
        watchSessions: state.watchSessions.length,
        activeWatchSessions: activeWatchSessions().length,
        candidates: state.clipCandidates.length,
        queuedPosts: state.postingDrafts.length,
        pendingApprovals: state.approvalRequests.filter((request) => request.status === "pending").length
      }
    });
  }

  if (req.method === "POST" && pathname === "/api/twitch/eventsub") {
    return handleTwitchEventSubWebhook(req, res);
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

  if (req.method === "GET" && pathname === "/api/integrations/status") {
    const matrix = await buildIntegrationMatrix();
    return sendJson(res, 200, matrix);
  }

  const integrationTestMatch = pathname.match(/^\/api\/integrations\/([^/]+)\/test$/);
  if (req.method === "POST" && integrationTestMatch) {
    const id = cleanText(integrationTestMatch[1]);
    const check = await runIntegrationCheck(id);
    const matrix = await buildIntegrationMatrix();
    const integration = matrix.integrations.find((item) => item.id === id) || null;
    return sendJson(res, 200, {
      id,
      check,
      integration,
      secretsExposed: false
    });
  }

  if (req.method === "GET" && pathname === "/api/readiness/audit") {
    const audit = await buildReadinessAudit();
    return sendJson(res, 200, audit);
  }

  if (req.method === "GET" && pathname === "/api/readiness/action-matrix") {
    return sendJson(res, 200, buildActionMatrixPayload());
  }

  if (req.method === "GET" && pathname === "/api/agent101/tool-map") {
    return sendJson(res, 200, buildAgentToolMapPayload());
  }

  if (req.method === "POST" && pathname === "/api/agent101/browser/run") {
    const body = await readJsonBody(req);
    const result = await runAgent101Browser(body);
    return sendJson(res, result.status === "error" ? 500 : 200, result);
  }

  const capcutControlScreenshotMatch = pathname.match(/^\/api\/capcut-control\/screenshots\/([^/]+)$/);
  if (req.method === "GET" && capcutControlScreenshotMatch) {
    const buffer = await capCutController().screenshotById(decodeURIComponent(capcutControlScreenshotMatch[1]));
    if (!buffer) return sendError(res, 404, "CapCut screenshot not found.");
    return sendPng(res, buffer);
  }

  const capcutMacroScreenshotMatch = pathname.match(/^\/api\/capcut-control\/macro-screenshots\/([^/]+)\/([^/]+)$/);
  if (req.method === "GET" && capcutMacroScreenshotMatch) {
    const buffer = await capCutController().macroScreenshotById(
      decodeURIComponent(capcutMacroScreenshotMatch[1]),
      decodeURIComponent(capcutMacroScreenshotMatch[2])
    );
    if (!buffer) return sendError(res, 404, "CapCut macro screenshot not found.");
    return sendPng(res, buffer);
  }

  const capcutWorkflowScreenshotMatch = pathname.match(/^\/api\/capcut-control\/workflow-screenshots\/([^/]+)\/([^/]+)$/);
  if (req.method === "GET" && capcutWorkflowScreenshotMatch) {
    const buffer = await capCutController().workflowScreenshotById(
      decodeURIComponent(capcutWorkflowScreenshotMatch[1]),
      decodeURIComponent(capcutWorkflowScreenshotMatch[2])
    );
    if (!buffer) return sendError(res, 404, "CapCut workflow screenshot not found.");
    return sendPng(res, buffer);
  }

  if (req.method === "GET" && pathname === "/api/capcut-control/status") {
    try {
      return sendJson(res, 200, await capCutController().status());
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  if (req.method === "GET" && pathname === "/api/capcut-control/audit") {
    try {
      return sendJson(res, 200, await capCutController().auditReport());
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  if (req.method === "POST" && pathname === "/api/capcut-control/open") {
    try {
      return sendJson(res, 200, await capCutController().openCapCut());
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  if (req.method === "POST" && pathname === "/api/capcut-control/focus") {
    try {
      return sendJson(res, 200, await capCutController().focusCapCut());
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  if (req.method === "POST" && pathname === "/api/capcut-control/park") {
    try {
      const body = await readJsonBody(req).catch(() => ({}));
      return sendJson(res, 200, await capCutController().parkCapCut({ mode: body.mode || "compact" }));
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  if (req.method === "POST" && pathname === "/api/capcut-control/screenshot") {
    try {
      return sendJson(res, 201, await capCutController().takeScreenshot());
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  const capcutPermissionMatch = pathname.match(/^\/api\/capcut-control\/permissions\/([^/]+)$/);
  if (req.method === "POST" && capcutPermissionMatch) {
    try {
      return sendJson(res, 200, await capCutController().openPermissionPane(decodeURIComponent(capcutPermissionMatch[1])));
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  if (req.method === "POST" && pathname === "/api/capcut-control/action") {
    let actionName = "action";
    try {
      const body = await readJsonBody(req);
      actionName = cleanText(body.action) || actionName;
      return sendJson(res, 200, await capCutController().runAction(body.action, body));
    } catch (error) {
      await capCutController().logAction(actionName, "failed", { error: error.message }).catch(() => {});
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  if (req.method === "GET" && pathname === "/api/capcut-control/teach") {
    try {
      return sendJson(res, 200, await capCutController().teachStatus());
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  if (req.method === "POST" && pathname === "/api/capcut-control/teach/start") {
    try {
      const body = await readJsonBody(req).catch(() => ({}));
      return sendJson(res, 201, await capCutController().startTeachMode(body.name || body.macroName || "", {
        appendToCurrent: Boolean(body.appendToCurrent || body.append)
      }));
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  if (req.method === "POST" && pathname === "/api/capcut-control/teach/stop") {
    try {
      const body = await readJsonBody(req).catch(() => ({}));
      return sendJson(res, 200, await capCutController().stopTeachMode({ reason: body.reason || "operator_stop" }));
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  if (req.method === "POST" && pathname === "/api/capcut-control/teach/save") {
    try {
      const body = await readJsonBody(req).catch(() => ({}));
      return sendJson(res, 201, await capCutController().saveTeachMacro(body.name || body.macroName || ""));
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  if (req.method === "POST" && pathname === "/api/capcut-control/teach/cancel") {
    try {
      return sendJson(res, 200, await capCutController().cancelTeachMode());
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  if (req.method === "POST" && pathname === "/api/capcut-control/teach/snapshot") {
    try {
      const body = await readJsonBody(req).catch(() => ({}));
      return sendJson(res, 201, await capCutController().captureTeachSnapshot(body.reason || "manual"));
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  const capcutTeachPhaseMatch = pathname.match(/^\/api\/capcut-control\/teach\/phases\/([^/]+)\/(start|complete|skip|retry)$/);
  if (req.method === "POST" && capcutTeachPhaseMatch) {
    try {
      const body = await readJsonBody(req).catch(() => ({}));
      const phaseId = decodeURIComponent(capcutTeachPhaseMatch[1]);
      const action = capcutTeachPhaseMatch[2];
      const inputs = {
        ...(body.inputs || body),
        name: body.name || body.macroName,
        workflowId: body.workflowId
      };
      if (action === "start") return sendJson(res, 200, await capCutController().startTeachPhase(phaseId, inputs));
      if (action === "complete") return sendJson(res, 200, await capCutController().completeTeachPhase(phaseId));
      if (action === "skip") return sendJson(res, 200, await capCutController().skipTeachPhase(phaseId));
      if (action === "retry") return sendJson(res, 200, await capCutController().retryTeachPhase(phaseId, inputs));
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  const capcutTeachStepMatch = pathname.match(/^\/api\/capcut-control\/teach\/steps\/(\d+)\/(delete|trim|target|wait)$/);
  if (req.method === "POST" && capcutTeachStepMatch) {
    try {
      const stepIndex = Number(capcutTeachStepMatch[1]);
      const action = capcutTeachStepMatch[2];
      if (action === "delete") return sendJson(res, 200, await capCutController().deleteTeachStep(stepIndex));
      if (action === "trim") return sendJson(res, 200, await capCutController().trimTeachStepsFrom(stepIndex));
      if (action === "target") {
        const body = await readJsonBody(req).catch(() => ({}));
        return sendJson(res, 200, await capCutController().setTeachStepTarget(stepIndex, body.label || body.target || ""));
      }
      if (action === "wait") {
        const body = await readJsonBody(req).catch(() => ({}));
        return sendJson(res, 200, await capCutController().updateTeachStepWait(stepIndex, body.ms));
      }
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  if (req.method === "GET" && pathname === "/api/capcut-control/macros") {
    try {
      return sendJson(res, 200, { macros: await capCutController().listMacros(), replay: capCutController().publicReplayState() });
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  if (req.method === "POST" && pathname === "/api/capcut-control/macros/order") {
    try {
      const body = await readJsonBody(req).catch(() => ({}));
      return sendJson(res, 200, await capCutController().reorderMacros(body.ids || body.macroIds || []));
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  if (req.method === "POST" && pathname === "/api/capcut-control/macros/run-all") {
    try {
      const body = await readJsonBody(req).catch(() => ({}));
      return sendJson(res, 200, await capCutController().replayAllMacros({
        inputs: body.inputs || body.workflowInputs || {}
      }));
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  const capcutMacroDeleteMatch = pathname.match(/^\/api\/capcut-control\/macros\/([^/]+)$/);
  if (req.method === "DELETE" && capcutMacroDeleteMatch) {
    try {
      return sendJson(res, 200, await capCutController().deleteMacro(decodeURIComponent(capcutMacroDeleteMatch[1])));
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  if (req.method === "GET" && pathname === "/api/capcut-control/workflows") {
    try {
      return sendJson(res, 200, await capCutController().workflowStatus());
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  const capcutWorkflowMatch = pathname.match(/^\/api\/capcut-control\/workflows\/([^/]+)\/(train|save|run)$/);
  if (req.method === "POST" && capcutWorkflowMatch) {
    try {
      const workflowId = decodeURIComponent(capcutWorkflowMatch[1]);
      const action = capcutWorkflowMatch[2];
      const body = await readJsonBody(req).catch(() => ({}));
      if (action === "train") {
        return sendJson(res, 201, await capCutController().startWorkflowTraining(workflowId, body.inputs || body));
      }
      if (action === "save") {
        return sendJson(res, 201, await capCutController().saveWorkflowMacro(workflowId, body.inputs || body));
      }
      if (action === "run") {
        return sendJson(res, 200, await capCutController().runWorkflow(workflowId, body.inputs || body));
      }
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message, error.details || {});
    }
  }

  const capcutMacroRenameMatch = pathname.match(/^\/api\/capcut-control\/macros\/([^/]+)\/rename$/);
  if (req.method === "POST" && capcutMacroRenameMatch) {
    try {
      const body = await readJsonBody(req).catch(() => ({}));
      return sendJson(res, 200, await capCutController().renameMacro(
        decodeURIComponent(capcutMacroRenameMatch[1]),
        body.name || body.macroName || ""
      ));
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  const capcutMacroEditMatch = pathname.match(/^\/api\/capcut-control\/macros\/([^/]+)\/edit$/);
  if (req.method === "POST" && capcutMacroEditMatch) {
    try {
      return sendJson(res, 200, await capCutController().loadMacroForEditing(decodeURIComponent(capcutMacroEditMatch[1])));
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  const capcutMacroReplayMatch = pathname.match(/^\/api\/capcut-control\/macros\/([^/]+)\/replay$/);
  if (req.method === "POST" && capcutMacroReplayMatch) {
    try {
      const body = await readJsonBody(req).catch(() => ({}));
      const result = await capCutController().replayMacro(decodeURIComponent(capcutMacroReplayMatch[1]), {
        startIndex: Number(body.startIndex || body.fromStepIndex || 0),
        inputs: body.inputs || body.workflowInputs || {}
      });
      return sendJson(res, 200, result);
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  if (req.method === "POST" && pathname === "/api/capcut-control/replay/cancel") {
    try {
      const body = await readJsonBody(req).catch(() => ({}));
      return sendJson(res, 200, await capCutController().cancelReplay(body.reason || "operator_cancel"));
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  if (req.method === "POST" && pathname === "/api/capcut-control/replay/pause") {
    try {
      const body = await readJsonBody(req).catch(() => ({}));
      return sendJson(res, 200, await capCutController().pauseReplay(body.reason || "operator_pause"));
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  if (req.method === "POST" && pathname === "/api/capcut-control/replay/resume") {
    try {
      return sendJson(res, 200, await capCutController().resumeReplay());
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  if (req.method === "GET" && pathname === "/api/capcut/status") {
    const installed = await isCapCutInstalled();
    const running = await isCapCutRunning();
    const visionReady = Boolean(config.anthropicApiKey);
    const agentReady = Boolean(config.capcutAgentDryRun || (installed && visionReady));
    return sendJson(res, 200, {
      status: agentReady ? "desktop_control_ready" : installed ? "needs_anthropic_key" : "capcut_not_installed",
      configured: agentReady,
      url: "",
      mode: "desktop_app",
      capcutInstalled: installed,
      capcutRunning: running,
      browserReady: false,
      visionReady,
      agentReady,
      downloadDirConfigured: Boolean(config.capcutDownloadDir),
      brandSticker: config.capcutBrandSticker,
      notes: "Agent 101 uses the native Mac CapCut app. Export/download remains Human Gate gated and operator-controlled."
    });
  }

  if (req.method === "GET" && pathname === "/api/capcut/sessions") {
    return sendJson(res, 200, {
      sessions: (state.capcutAgentSessions || []).map(publicCapcutAgentSession)
    });
  }

  const capcutSessionEventsMatch = pathname.match(/^\/api\/capcut\/sessions\/([^/]+)\/events$/);
  if (req.method === "GET" && capcutSessionEventsMatch) {
    return subscribeCapcutAgentStream(decodeURIComponent(capcutSessionEventsMatch[1]), res);
  }

  if (req.method === "POST" && pathname === "/api/capcut/edit") {
    try {
      const body = await readJsonBody(req);
      const result = await runCapcutEditClip(body, { source: "api" });
      return sendJson(res, result.error ? 500 : result.requiresApproval ? 202 : 200, result);
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message, error.details || {});
    }
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
    try {
      const created = await createHandoffPackage(body);
      const result = await prepareHandoffPackage(created.handoff);
      await logEvent("capcut_handoff", "CapCut handoff prepared for operator", { handoffId: created.handoff.id });
      return sendJson(res, created.reused ? 200 : 201, { handoff: publicHandoff(result.handoff), artifacts: result.artifacts });
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  if (req.method === "GET" && pathname === "/api/media/status") {
    return sendJson(res, 200, await mediaToolStatus());
  }

  if (req.method === "GET" && (pathname === "/api/clipping-office/project" || pathname === `/api/clipping-office/project/${DEMO_PROJECT_ID}`)) {
    return sendJson(res, 200, studioProjectPayload(searchParams.get("projectId") || state.mediaProjects[0]?.id || ""));
  }

  const projectMatch = pathname.match(/^\/api\/clipping-office\/project\/([^/]+)$/);
  if (projectMatch && req.method === "GET") {
    return sendJson(res, 200, studioProjectPayload(projectMatch[1]));
  }

  if (req.method === "GET" && pathname === "/api/clip-projects") {
    return sendJson(res, 200, {
      projects: (state.mediaProjects || []).map(publicClipProject)
    });
  }

  if (req.method === "POST" && pathname === "/api/clip-projects") {
    const body = await readJsonBody(req);
    const project = await createClipProject({
      title: body.title || "New Clip Project",
      description: body.description,
      mode: normalizeStatus(body.mode, ["real", "practice"], "real")
    });
    await logEvent("clip_project_created", "Clip Project created", { projectId: project.id, mode: project.mode });
    await saveState();
    return sendJson(res, 201, { project: publicClipProject(project) });
  }

  const clipProjectMatch = pathname.match(/^\/api\/clip-projects\/([^/]+)(?:\/(edl|render|capcut-handoff))?$/);
  if (clipProjectMatch) {
    const [, projectId, action = "detail"] = clipProjectMatch;
    const project = state.mediaProjects.find((item) => item.id === decodeURIComponent(projectId));
    if (!project) return sendError(res, 404, "Clip Project not found");
    if (req.method === "GET" && action === "detail") {
      return sendJson(res, 200, studioProjectPayload(project.id));
    }
    if (req.method === "PATCH" && action === "detail") {
      const body = await readJsonBody(req);
      const candidate = state.clipCandidates.find((item) => item.id === cleanText(body.candidateId || body.selectedCandidateId));
      const source = findExistingMediaSource(cleanText(body.sourceId || body.activeSourceId || project.sourceId || candidate?.sourceId));
      const nextStart = body.clipStartSeconds ?? body.startSeconds;
      const nextEnd = body.clipEndSeconds ?? body.endSeconds;
      Object.assign(project, {
        title: cleanText(body.title) || project.title,
        description: cleanText(body.description) || project.description,
        sourceId: source?.id || project.sourceId || "",
        activeSourceId: source?.id || project.activeSourceId || "",
        candidateId: candidate?.id || project.candidateId || "",
        selectedCandidateId: candidate?.id || project.selectedCandidateId || "",
        clipStartSeconds: nextStart == null ? project.clipStartSeconds : Math.max(0, Number(nextStart)),
        clipEndSeconds: nextEnd == null ? project.clipEndSeconds : Math.max(0, Number(nextEnd)),
        editorState: body.editorState && typeof body.editorState === "object" ? sanitizeClipEditorState(body.editorState) : project.editorState || {},
        status: source ? "source_ready" : project.status,
        updatedAt: now(),
        autosavedAt: now()
      });
      const normalized = normalizeClipProjectRecord(project);
      const selectedCandidate = state.clipCandidates.find((item) => item.id === normalized.candidateId);
      if (source && selectedCandidate) {
        assertCandidateReferencesSource(selectedCandidate, source);
        assertCandidateTimesValid({
          ...selectedCandidate,
          timestampStartSeconds: normalized.clipStartSeconds ?? selectedCandidate.timestampStartSeconds,
          timestampEndSeconds: normalized.clipEndSeconds ?? selectedCandidate.timestampEndSeconds
        }, source);
      }
      ensureProjectEditDecisionList(project, source, selectedCandidate);
      const edl = state.editDecisionLists.find((item) => item.id === project.editDecisionListId);
      if (edl) {
        edl.clipStartSeconds = project.clipStartSeconds ?? edl.clipStartSeconds;
        edl.clipEndSeconds = project.clipEndSeconds ?? edl.clipEndSeconds;
        edl.updatedAt = now();
      }
      await logEvent("clip_project_updated", "Clip Project autosaved", { projectId: project.id });
      await saveState();
      return sendJson(res, 200, { project: publicClipProject(project), editDecisionList: edl || null });
    }
    if (req.method === "GET" && action === "edl") {
      const normalized = normalizeClipProjectRecord(project);
      const source = findExistingMediaSource(normalized.sourceId);
      const candidate = state.clipCandidates.find((item) => item.id === normalized.candidateId);
      const edl = ensureProjectEditDecisionList(project, source, candidate);
      await saveState();
      return sendJson(res, 200, { editDecisionList: edl });
    }
    if (req.method === "PUT" && action === "edl") {
      const body = await readJsonBody(req);
      const normalized = normalizeClipProjectRecord(project);
      const source = findExistingMediaSource(normalized.sourceId);
      const candidate = state.clipCandidates.find((item) => item.id === normalized.candidateId);
      const edl = ensureProjectEditDecisionList(project, source, candidate);
      Object.assign(edl, {
        clipStartSeconds: Math.max(0, Number(body.clipStartSeconds ?? body.startSeconds ?? edl.clipStartSeconds)),
        clipEndSeconds: Math.max(0, Number(body.clipEndSeconds ?? body.endSeconds ?? edl.clipEndSeconds)),
        cropMode: cleanText(body.cropMode) || edl.cropMode,
        cropKeyframes: Array.isArray(body.cropKeyframes) ? body.cropKeyframes : edl.cropKeyframes,
        transitions: Array.isArray(body.transitions) ? body.transitions : edl.transitions,
        effects: Array.isArray(body.effects) ? body.effects : edl.effects,
        updatedAt: now()
      });
      project.clipStartSeconds = edl.clipStartSeconds;
      project.clipEndSeconds = edl.clipEndSeconds;
      project.updatedAt = now();
      project.autosavedAt = now();
      if (source) assertCandidateTimesValid({ timestampStartSeconds: edl.clipStartSeconds, timestampEndSeconds: edl.clipEndSeconds }, source);
      await logEvent("edl_updated", "Clip Project edit decision list updated", { projectId: project.id, edlId: edl.id });
      await saveState();
      return sendJson(res, 200, { editDecisionList: edl, project: publicClipProject(project) });
    }
    if (req.method === "POST" && action === "render") {
      const body = await readJsonBody(req);
      try {
        const result = await createRenderJob({ ...body, projectId: project.id });
        return sendJson(res, 201, result);
      } catch (error) {
        return sendError(res, error.statusCode || 500, error.message, { message: error.message });
      }
    }
    if (req.method === "POST" && action === "capcut-handoff") {
      const body = await readJsonBody(req);
      const normalized = normalizeClipProjectRecord(project);
      const latestArtifact = resolveRenderedArtifactReference(body.renderId || body.renderedArtifactId, normalized.latestArtifactId);
      if (!artifactIsVerifiedClip(latestArtifact)) {
        return sendError(res, 422, "CapCut handoff requires a verified rendered MP4 first.");
      }
      const candidate = state.clipCandidates.find((item) => item.id === normalized.candidateId);
      let clipPackage = state.clipPackages.find((item) => item.candidateId === candidate?.id);
      if (!clipPackage && candidate) {
        const packagePlan = buildPackage(candidate);
        const packageArtifact = await writeArtifact("clip_package", packagePlan.title, {
          candidate,
          packagePlan,
          createdAt: now()
        });
        clipPackage = {
          id: newId("package"),
          candidateId: candidate.id,
          title: packagePlan.title,
          format: "9:16",
          resolution: "1080x1920",
          targetDuration: Number(candidate.duration || 30),
          hook: packagePlan.hook,
          captionOverlays: packagePlan.captionOverlays,
          cutInstructions: packagePlan.cutInstructions,
          capcutBriefId: null,
          postingDrafts: [],
          approvalStatus: "draft",
          artifacts: [packageArtifact],
          sourceId: candidate.sourceId,
          renderedArtifactId: latestArtifact.id,
          packagePlan,
          createdAt: now(),
          updatedAt: now()
        };
        state.clipPackages.unshift(clipPackage);
      }
      if (!clipPackage) return sendError(res, 404, "No clip package is ready for a CapCut handoff.");
      clipPackage.renderedArtifactId = latestArtifact.id;
      const created = await createHandoffPackage({
        ...body,
        editProjectId: project.id,
        clipPackageId: clipPackage.id,
        renderId: latestArtifact.id
      });
      const result = await prepareHandoffPackage(created.handoff);
      project.capcutHandoffId = result.handoff.id;
      project.updatedAt = now();
      project.autosavedAt = now();
      await saveState();
      return sendJson(res, created.reused ? 200 : 201, { handoff: publicHandoff(result.handoff), artifacts: result.artifacts });
    }
  }

  if (req.method === "GET" && pathname === "/api/media/sources") {
    return sendJson(res, 200, { sources: state.mediaSources.map(publicMediaSource) });
  }

  if (req.method === "POST" && pathname === "/api/media/sources/upload") {
    try {
      const raw = await readRawBody(req, config.maxUploadBytes);
      const parsed = parseMultipartBody(raw, req.headers["content-type"]);
      const uploaded = await registerUploadedMedia({
        file: parsed.files.file || Object.values(parsed.files)[0],
        fields: parsed.fields
      });
      return sendJson(res, 201, uploaded);
    } catch (error) {
      await logEvent("media_upload_failed", "Media upload failed", { error: error.message });
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  if (req.method === "POST" && pathname === "/api/media/sources") {
    const body = await readJsonBody(req);
    const filePath = cleanText(body.filePath);
    const allowedRoots = [config.uploadDir, config.outputDir, path.join(PUBLIC_DIR, "demo")].map((root) => path.resolve(root));
    const resolved = filePath ? path.resolve(filePath) : "";
    if (!resolved || !allowedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))) {
      return sendError(res, 403, "Media registration only supports files in the approved upload, output, or practice-media folders.");
    }
    try {
      const project = await createClipProject({
        title: body.title || path.basename(resolved),
        description: body.description,
        mode: "real"
      });
      const source = await createMediaSourceFromFile({
        filePath: resolved,
        originalFilename: path.basename(resolved),
        mimeType: body.mimeType || contentTypeFor(resolved).split(";")[0],
        title: body.title || path.basename(resolved),
        projectId: project.id,
        mode: "real",
        provenance: PROVENANCE.AUTHORIZED_UPLOAD,
        permissionStatus: cleanText(body.permissionStatus) || "uploaded",
        rightsStatus: cleanText(body.rightsStatus) || "operator_review_required"
      });
      Object.assign(project, {
        sourceId: source.id,
        activeSourceId: source.id,
        status: "source_ready",
        updatedAt: now(),
        autosavedAt: now()
      });
      const candidate = defaultCandidateForSource(project, source);
      await logEvent("media_registered", "Local media source registered", { projectId: project.id, sourceId: source.id });
      await saveState();
      return sendJson(res, 201, { project: publicClipProject(project), source: publicMediaSource(source), candidate });
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  const mediaSourceMatch = pathname.match(/^\/api\/media\/sources\/([^/]+)(?:\/(playback|metadata|thumbnails|frame|waveform))?$/);
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
          duration: sourceDurationSeconds(source),
          durationSeconds: sourceDurationSeconds(source),
          width: source.width,
          height: source.height,
          fps: source.fps,
          frameRate: source.frameRate || parseFrameRate(source.fps),
          hasAudio: source.hasAudio,
          provenance: source.provenance,
          verified
        }
      });
    }
    if (action === "thumbnails") {
      const duration = sourceDurationSeconds(source) || 1;
      const times = [0.12, 0.28, 0.44, 0.6, 0.76].map((pct) => Math.max(0, Math.min(duration - 0.1, duration * pct)));
      const frames = Array.from({ length: 5 }, (_, index) => ({
        id: `${source.id}_frame_${index + 1}`,
        timestampSeconds: Math.round(times[index] * 100) / 100,
        provenance: source.provenance,
        url: `/api/media/sources/${encodeURIComponent(source.id)}/frame?t=${encodeURIComponent(times[index])}`
      }));
      return sendJson(res, 200, { sourceId: source.id, frames });
    }
    if (action === "frame") {
      const candidateId = cleanText(searchParams.get("candidateId"));
      const candidate = state.clipCandidates.find((item) => item.id === candidateId);
      try {
        const framePath = await extractSourceFrame(source, candidate, searchParams.get("t"));
        return streamFileWithRange(req, res, framePath, "image/jpeg");
      } catch (error) {
        if (source.provenance === PROVENANCE.DEMO_SOURCE) {
          const index = Math.max(0, state.clipCandidates.filter((item) => item.sourceId === source.id).findIndex((item) => item.id === candidate?.id));
          return streamFileWithRange(req, res, path.join(DEMO_FRAME_DIR, `frame-${(index % 5) + 1}.jpg`), "image/jpeg");
        }
        return sendError(res, error.statusCode || 422, error.message);
      }
    }
    if (action === "waveform") {
      return sendJson(res, 501, {
        sourceId: source.id,
        status: "unavailable",
        provenance: PROVENANCE.UNAVAILABLE,
        message: "Waveform generation is not configured yet. The UI must not draw a fake waveform."
      });
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
        durationSeconds: metadata.durationSeconds,
        width: metadata.width,
        height: metadata.height,
        fps: metadata.fps,
        frameRate: metadata.frameRate,
        hasAudio: metadata.hasAudio,
        sha256,
        fileSizeBytes: metadata.size,
        status: "ready",
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

  if (req.method === "GET" && pathname === "/api/clip-candidates") {
    await ensureActiveWatchSessionCandidateCoverage("clip_candidates_refresh");
    const projectId = cleanText(searchParams.get("projectId"));
    const sourceId = cleanText(searchParams.get("sourceId"));
    const candidates = filterClipCandidatesForRadar(state.clipCandidates, { projectId, sourceId })
      .map((candidate) => ({ ...candidate, journey: candidateJourney(candidate) }));
    return sendJson(res, 200, { candidates });
  }

  if (req.method === "POST" && pathname === "/api/clip-candidates/bulk-delete") {
    const body = await readJsonBody(req).catch(() => ({}));
    const ids = [...new Set(Array.isArray(body.ids) ? body.ids.map(cleanText).filter(Boolean) : [])];
    if (!ids.length) return sendError(res, 400, "Choose at least one clip candidate to delete.");
    const stopWatchers = Boolean(body.stopWatchers || body.stopWatcher || body.disableMonitoring);
    const deleted = [];
    const blocked = [];
    const stoppedWatchSessions = [];
    const stoppedSessionIds = new Set();
    for (const id of ids) {
      try {
        const result = await deleteClipCandidate(id, "operator_bulk_delete", { stopWatcher: stopWatchers });
        deleted.push(result.candidateId);
        const stopped = result.stoppedWatchSession;
        if (stopped?.sessionId && !stoppedSessionIds.has(stopped.sessionId)) {
          stoppedSessionIds.add(stopped.sessionId);
          stoppedWatchSessions.push(stopped);
        }
      } catch (error) {
        blocked.push({ id, error: error.message, details: error.details || {} });
      }
    }
    await logEvent("candidate_bulk_delete", "Bulk clip candidate delete completed", {
      requested: ids.length,
      deleted: deleted.length,
      blocked: blocked.length,
      stoppedWatchSessions: stoppedWatchSessions.length,
      stopWatchers
    });
    await saveState();
    return sendJson(res, 200, { deleted, blocked, requested: ids.length, stoppedWatchSessions });
  }

  if (req.method === "POST" && (pathname === "/api/media/candidates" || pathname === "/api/clip-candidates")) {
    const body = await readJsonBody(req);
    const source = findExistingMediaSource(cleanText(body.sourceId));
    if (!source) return sendError(res, 422, "Candidate generation blocked: no verified playable media.");
    try {
      await assertSourceIsPlayable(source);
      const sourceSessionId = cleanText(source.watchSessionId);
      const session = state.watchSessions.find((item) => item.id === sourceSessionId) || null;
      if (session) {
        const unresolvedForSession = unresolvedLiveRecordingCandidates(session.id);
        if (unresolvedForSession.length >= Number(config.watchCandidateUnresolvedCap || 0)) {
          return sendError(res, 409, `Candidate queue is full for this watch session (${unresolvedForSession.length}/${config.watchCandidateUnresolvedCap}). Resolve or archive one before adding another.`);
        }
      }
      const start = Math.max(0, Number(body.startSeconds ?? body.timestampStartSeconds ?? 0));
      const end = Number(body.endSeconds ?? body.timestampEndSeconds ?? start + Number(body.durationSeconds || body.duration || 0));
      const scoreValue = body.score == null ? null : Number(body.score);
      const confidenceValue = cleanText(body.confidence) || null;
      const id = cleanText(body.id) || newId("candidate");
      const candidate = {
        id,
        runId: cleanText(body.runId),
        streamerId: cleanText(body.streamerId || source.streamerId || DEMO_STREAMER_ID),
        sourceId: source.id,
        sourceClipId: cleanText(body.sourceClipId),
        sourceType: source.sourceType || source.sourceKind || source.provenance || PROVENANCE.VERIFIED_MEDIA,
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
        measuredEvidence: Array.isArray(body.measuredEvidence) ? body.measuredEvidence : [],
        title: cleanText(body.title) || "Verified media candidate",
        category: cleanText(body.category || source.category || "Media"),
        qualityScore: Number.isFinite(scoreValue) ? scoreValue : null,
        score: Number.isFinite(scoreValue) ? scoreValue : null,
        confidence: confidenceValue,
        scoreComponents: body.scoreComponents || {},
        status: "candidate",
        provenance: source.provenance,
        creativeProvenance: PROVENANCE.USER_ENTERED,
        thumbnailUrl: `/api/media/sources/${encodeURIComponent(source.id)}/frame?candidateId=${encodeURIComponent(id)}`,
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

  const clipCandidateActionMatch = pathname.match(/^\/api\/clip-candidates\/([^/]+)\/(feedback|render|reject|approve-review)$/);
  if (clipCandidateActionMatch && req.method === "POST") {
    const [, candidateId, action] = clipCandidateActionMatch;
    const candidate = state.clipCandidates.find((item) => item.id === decodeURIComponent(candidateId));
    if (!candidate) return sendError(res, 404, "Clip candidate not found");
    const body = await readJsonBody(req).catch(() => ({}));

    if (action === "feedback") {
      const feedback = {
        id: newId("feedback"),
        candidateId: candidate.id,
        watchSessionId: candidate.watchSessionId || null,
        verdict: normalizeStatus(body.verdict || "note", ["helpful", "weak", "wrong", "note"], "note"),
        note: cleanText(body.note),
        actor: "operator",
        createdAt: now()
      };
      state.feedbackEvents.unshift(feedback);
      candidate.feedbackCount = Number(candidate.feedbackCount || 0) + 1;
      candidate.updatedAt = now();
      await logEvent("candidate_feedback", "Operator feedback recorded for clip candidate", {
        candidateId: candidate.id,
        verdict: feedback.verdict
      });
      await saveState();
      return sendJson(res, 200, { candidate, feedback });
    }

    if (action === "reject") {
      candidate.status = "rejected";
      candidate.decision = "rejected";
      candidate.decisionReason = cleanText(body.reason) || candidate.decisionReason || "Rejected by operator review.";
      candidate.updatedAt = now();
      const session = state.watchSessions.find((item) => item.id === candidate.watchSessionId);
      if (session) {
        session.candidatesRejected = Number(session.candidatesRejected || 0) + 1;
        session.updatedAt = now();
        await appendWatchEvent(session.id, "candidate_rejected", {
          candidateId: candidate.id,
          reason: candidate.decisionReason,
          operatorAction: true
        });
      }
      await logEvent("candidate_rejected", "Clip candidate rejected", { candidateId: candidate.id });
      await saveState();
      return sendJson(res, 200, { candidate });
    }

    if (action === "approve-review") {
      candidate.status = "candidate";
      candidate.decision = "accepted";
      candidate.decisionReason = cleanText(body.reason) || "Approved for package review by operator.";
      candidate.updatedAt = now();
      const session = state.watchSessions.find((item) => item.id === candidate.watchSessionId);
      if (session) {
        session.candidatesAccepted = Number(session.candidatesAccepted || 0) + 1;
        session.updatedAt = now();
        await appendWatchEvent(session.id, "candidate_accepted", {
          candidateId: candidate.id,
          reason: candidate.decisionReason,
          operatorAction: true
        });
      }
      await logEvent("candidate_approved_review", "Clip candidate approved for review", { candidateId: candidate.id });
      await saveState();
      return sendJson(res, 200, { candidate });
    }

    if (action === "render") {
      const session = state.watchSessions.find((item) => item.id === candidate.watchSessionId);
      if (session) await appendWatchEvent(session.id, "render_started", { candidateId: candidate.id, operatorAction: true });
      const result = await createRenderJob({
        projectId: body.projectId || candidate.projectId || DEMO_PROJECT_ID,
        sourceId: body.sourceId || candidate.sourceId,
        candidateId: candidate.id
      });
      if (session) {
        session.clipsRendered = Number(session.clipsRendered || 0) + 1;
        session.updatedAt = now();
        await appendWatchEvent(session.id, "render_completed", {
          candidateId: candidate.id,
          artifactId: result.artifact?.id,
          operatorAction: true
        });
      }
      return sendJson(res, 200, result);
    }
  }

  const clipCandidateMatch = pathname.match(/^\/api\/clip-candidates\/([^/]+)$/);
  if (clipCandidateMatch) {
    const candidate = state.clipCandidates.find((item) => item.id === decodeURIComponent(clipCandidateMatch[1]));
    if (!candidate) return sendError(res, 404, "Clip candidate not found");
    if (req.method === "GET") {
      return sendJson(res, 200, { candidate });
    }
    if (req.method === "DELETE") {
      const stopWatcher = ["1", "true", "yes"].includes(String(searchParams.get("stopWatcher") || searchParams.get("stopWatchers") || "").toLowerCase());
      const result = await deleteClipCandidate(clipCandidateMatch[1], "operator_delete", { stopWatcher });
      return sendJson(res, 200, result);
    }
    if (req.method === "PATCH") {
      const body = await readJsonBody(req);
      const source = findExistingMediaSource(candidate.sourceId);
      const nextStart = body.startSeconds ?? body.timestampStartSeconds;
      const nextEnd = body.endSeconds ?? body.timestampEndSeconds;
      if (nextStart != null) candidate.startSeconds = candidate.timestampStartSeconds = Math.max(0, Number(nextStart));
      if (nextEnd != null) candidate.endSeconds = candidate.timestampEndSeconds = Math.max(0, Number(nextEnd));
      if (source) assertCandidateTimesValid(candidate, source);
      candidate.timestampStart = secondsToTimestamp(candidate.timestampStartSeconds ?? candidate.startSeconds ?? 0);
      candidate.timestampEnd = secondsToTimestamp(candidate.timestampEndSeconds ?? candidate.endSeconds ?? 0);
      candidate.duration = Math.max(0, Number(candidate.timestampEndSeconds ?? candidate.endSeconds ?? 0) - Number(candidate.timestampStartSeconds ?? candidate.startSeconds ?? 0));
      candidate.durationSeconds = candidate.duration;
      candidate.title = cleanText(body.title) || candidate.title;
      candidate.status = cleanText(body.status) || candidate.status;
      candidate.updatedAt = now();
      await logEvent("candidate_updated", "Clip candidate updated", { candidateId: candidate.id });
      await saveState();
      return sendJson(res, 200, { candidate });
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

  const mediaRenderJobAliasMatch = pathname.match(/^\/api\/(?:media\/)?render-jobs\/([^/]+)$/);
  if (mediaRenderJobAliasMatch && req.method === "GET") {
    const job = (state.mediaJobs || []).find((item) => item.id === mediaRenderJobAliasMatch[1]);
    if (!job) return sendError(res, 404, "Media render job not found");
    return sendJson(res, 200, { job });
  }

  const mediaArtifactMatch = pathname.match(/^\/api\/(?:media\/)?artifacts\/([^/]+)$/);
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
          message: "Twitch credentials are not configured. Real mode will stop instead of using practice data."
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

  const agentStreamMatch = pathname.match(/^\/api\/agent101\/stream\/([^/]+)$/);
  if (req.method === "GET" && agentStreamMatch) {
    subscribeAgent101Stream(decodeURIComponent(agentStreamMatch[1]), res);
    return;
  }

  if (req.method === "GET" && pathname === "/api/agent101/sessions") {
    return sendJson(res, 200, { sessions: listAgent101Sessions() });
  }

  const agentSessionDownloadMatch = pathname.match(/^\/api\/agent101\/sessions\/([^/]+)\/download$/);
  if (req.method === "GET" && agentSessionDownloadMatch) {
    const sessionId = decodeURIComponent(agentSessionDownloadMatch[1]);
    const session = publicAgent101Session(sessionId);
    if (!session) return sendError(res, 404, "Agent 101 session not found");
    const files = [];
    for (const file of session.outputFiles || []) {
      const pathValue = file.path || file;
      const content = await readOutputFile(config.agent101OutputDir, pathValue).catch((error) => ({
        path: pathValue,
        error: error.message,
        content: ""
      }));
      files.push(content);
    }
    const body = JSON.stringify({ session, files, exportedAt: now() }, null, 2);
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="agent101-${sessionId}-outputs.json"`,
      "cache-control": "no-store"
    });
    res.end(body);
    return;
  }

  const agentSessionMatch = pathname.match(/^\/api\/agent101\/sessions\/([^/]+)$/);
  if (req.method === "GET" && agentSessionMatch) {
    const sessionId = decodeURIComponent(agentSessionMatch[1]);
    const session = publicAgent101Session(sessionId);
    if (!session) return sendError(res, 404, "Agent 101 session not found");
    const runs = studioSessionRuns(sessionId);
    return sendJson(res, 200, {
      session,
      runs,
      conversation: runs.flatMap((run) => [
        { role: "user", content: run.userMessage, createdAt: run.startedAt, runId: run.runId },
        { role: "assistant", content: run.response || run.summary || "", createdAt: run.completedAt || run.startedAt, runId: run.runId, toolCalls: run.toolCalls || [] }
      ])
    });
  }

  if (req.method === "GET" && pathname === "/api/agent101/files") {
    const filePath = cleanText(searchParams.get("path") || "");
    if (!filePath) return sendError(res, 400, "Output file path is required");
    return sendJson(res, 200, await readOutputFile(config.agent101OutputDir, filePath));
  }

  if (req.method === "GET" && pathname === "/api/agent101/outputs") {
    return sendJson(res, 200, { files: await listOutputFiles(config.agent101OutputDir) });
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
      message: "Practice project started. StreamClipper is ready to run a supervised local clipping cycle."
    });
  }

  if (req.method === "POST" && pathname === "/api/demo/clear") {
    const demoStreamerIds = new Set(
      state.streamers
        .filter((streamer) => streamer.isDemo || streamer.permissionStatus === "demo_approved" || streamer.platform === "demo")
        .map((streamer) => streamer.id)
    );
    const demoSessionIds = new Set(
      state.streamSessions
        .filter((session) => String(session.status || "").startsWith("demo") || demoStreamerIds.has(session.streamerId))
        .map((session) => session.id)
    );
    const demoSourceIds = new Set(
      state.mediaSources
        .filter((source) => source.provenance === PROVENANCE.DEMO_SOURCE || source.sourceKind === "demo_media")
        .map((source) => source.id)
    );
    const demoWatchSessionIds = new Set(
      state.watchSessions
        .filter((session) => session.mode === "demo" || demoStreamerIds.has(session.streamerId) || demoSourceIds.has(session.sourceId))
        .map((session) => session.id)
    );
    const demoCandidateIds = new Set(
      state.clipCandidates
        .filter((candidate) => (
          candidate.provenance === PROVENANCE.DEMO_SOURCE
          || candidate.sourceProvenance === PROVENANCE.DEMO_SOURCE
          || /demo/i.test(candidate.sourceType || "")
          || demoStreamerIds.has(candidate.streamerId)
          || demoSessionIds.has(candidate.sessionId)
          || demoSourceIds.has(candidate.sourceId)
        ))
        .map((candidate) => candidate.id)
    );
    const demoPackageIds = new Set(
      state.clipPackages
        .filter((clipPackage) => demoCandidateIds.has(clipPackage.candidateId))
        .map((clipPackage) => clipPackage.id)
    );
    const demoDraftIds = new Set(
      state.postingDrafts
        .filter((draft) => demoPackageIds.has(draft.clipPackageId))
        .map((draft) => draft.id)
    );
    const demoHandoffIds = new Set(
      state.handoffPackages
        .filter((handoff) => demoPackageIds.has(handoff.clipPackageId) || demoCandidateIds.has(handoff.candidateClipId))
        .map((handoff) => handoff.id)
    );
    const demoArtifactIds = new Set(
      state.artifacts
        .filter((artifact) => {
          const content = artifact.content || {};
          return (
            artifact.provenance === PROVENANCE.DEMO_SOURCE
            || content.provenance === PROVENANCE.DEMO_SOURCE
            || demoSourceIds.has(content.sourceId)
            || demoPackageIds.has(content.clipPackageId)
            || demoCandidateIds.has(content.candidateId)
            || demoHandoffIds.has(content.handoffId)
          );
        })
        .map((artifact) => artifact.id)
    );
    const before = {
      streamers: state.streamers.length,
      sessions: state.streamSessions.length,
      watchSessions: state.watchSessions.length,
      candidates: state.clipCandidates.length,
      sources: state.mediaSources.length,
      projects: state.mediaProjects.length,
      packages: state.clipPackages.length,
      drafts: state.postingDrafts.length,
      approvals: state.approvalRequests.length,
      artifacts: state.artifacts.length,
      handoffs: state.handoffPackages.length,
      jobs: state.mediaJobs.length
    };
    for (const sessionId of demoWatchSessionIds) stopWatchWorkerTimer(sessionId);
    state.streamers = state.streamers.filter((streamer) => !demoStreamerIds.has(streamer.id));
    state.streamSessions = state.streamSessions.filter((session) => !demoSessionIds.has(session.id));
    state.watchSessions = state.watchSessions.filter((session) => !demoWatchSessionIds.has(session.id));
    state.watchEvents = state.watchEvents.filter((event) => !demoWatchSessionIds.has(event.sessionId));
    state.sourceCapabilities = state.sourceCapabilities.filter((capability) => !demoWatchSessionIds.has(capability.watchSessionId));
    state.clipMissions = state.clipMissions.filter((mission) => !demoStreamerIds.has(mission.streamerId));
    state.streamerClipProfiles = state.streamerClipProfiles.filter((profile) => !demoStreamerIds.has(profile.streamerId));
    state.feedbackEvents = state.feedbackEvents.filter((feedback) => !demoCandidateIds.has(feedback.candidateId));
    state.mediaSegments = state.mediaSegments.filter((segment) => !demoWatchSessionIds.has(segment.watchSessionId));
    state.clipCandidates = state.clipCandidates.filter((candidate) => !demoCandidateIds.has(candidate.id));
    state.clipPackages = state.clipPackages.filter((clipPackage) => !demoPackageIds.has(clipPackage.id));
    state.postingDrafts = state.postingDrafts.filter((draft) => !demoDraftIds.has(draft.id));
    state.approvalRequests = state.approvalRequests.filter((approval) => (
      !demoDraftIds.has(approval.linkedId)
      && !demoPackageIds.has(approval.linkedId)
      && !demoCandidateIds.has(approval.linkedId)
      && !demoStreamerIds.has(approval.linkedId)
      && approval.linkedId !== DEMO_PROJECT_ID
    ));
    state.artifacts = state.artifacts.filter((artifact) => !demoArtifactIds.has(artifact.id));
    state.handoffPackages = state.handoffPackages.filter((handoff) => !demoHandoffIds.has(handoff.id));
    state.mediaJobs = state.mediaJobs.filter((job) => !demoCandidateIds.has(job.candidateId) && !demoSourceIds.has(job.sourceId) && job.projectId !== DEMO_PROJECT_ID);
    state.mediaSources = state.mediaSources.filter((source) => !demoSourceIds.has(source.id));
    state.mediaProjects = state.mediaProjects.filter((project) => project.id !== DEMO_PROJECT_ID);
    const cleared = {
      streamers: before.streamers - state.streamers.length,
      sessions: before.sessions - state.streamSessions.length,
      watchSessions: before.watchSessions - state.watchSessions.length,
      candidates: before.candidates - state.clipCandidates.length,
      sources: before.sources - state.mediaSources.length,
      projects: before.projects - state.mediaProjects.length,
      packages: before.packages - state.clipPackages.length,
      drafts: before.drafts - state.postingDrafts.length,
      approvals: before.approvals - state.approvalRequests.length,
      artifacts: before.artifacts - state.artifacts.length,
      handoffs: before.handoffs - state.handoffPackages.length,
      jobs: before.jobs - state.mediaJobs.length
    };
    await logEvent("practice_cleared", "Practice data cleared from StreamClipper state", cleared);
    await saveState();
    return sendJson(res, 200, { cleared, message: "Practice rows cleared. Real data was left untouched." });
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

  if (req.method === "POST" && pathname === "/api/twitch/eventsub/subscribe") {
    const body = await readJsonBody(req).catch(() => ({}));
    const streamer = findStreamer(body.streamerId);
    if (!streamer) return sendError(res, 404, "Streamer not found.");
    if (!isRealApprovedStreamer(streamer)) {
      return sendError(res, 403, "EventSub subscription requires an approved streamer record.");
    }
    const result = await subscribeToEventSub(streamer);
    await saveState();
    return sendJson(res, 200, { streamer, result });
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
    const platform = normalizeStatus(body.platform || "twitch", ["twitch", "youtube_live", "kick", "other"], "twitch");
    const providerConfigured = liveProviderConfigured(platform);
    const requestedMonitorEnabled = Boolean(body.monitorEnabled ?? false);
    const monitorEnabled = providerConfigured ? requestedMonitorEnabled : false;
    let permissionStatus = normalizeStatus(body.permissionStatus, ["approved", "pending", "blocked"], "pending");
    if (requestedMonitorEnabled && !providerConfigured) {
      permissionStatus = permissionStatus === "blocked" ? "blocked" : "pending";
    }
    const requestedLiveStatus = normalizeStatus(body.liveStatus, ["live", "offline", "unverified", "api_not_configured", "unknown"], "unknown");
    const liveStatus = providerConfigured ? requestedLiveStatus : "api_not_configured";
    const liveStatusReason = !providerConfigured
      ? `${platform === "kick" ? "Kick" : platform === "twitch" ? "Twitch" : "Provider"} API is not configured. Added for review only; monitoring stays paused until an official live check can run.`
      : cleanText(body.liveStatusReason || (requestedLiveStatus === "live" ? "Official live recommendation" : "Not checked yet"));
    if (monitorEnabled && permissionStatus === "approved") {
      await enforceSingleWatchedStreamer("", "streamer_create_monitor_enabled");
    }
    try {
      assertWatchCapacity({ monitorEnabled, permissionStatus });
    } catch (error) {
      return sendError(res, error.statusCode || 409, error.message, error.details);
    }
    const existingStreamer = state.streamers.find((streamer) => {
      if (streamer.platform !== platform) return false;
      const existingChannel = cleanText(streamer.channelId).toLowerCase();
      const nextChannel = cleanText(identity.channelId).toLowerCase();
      const existingUrl = cleanText(streamer.channelUrl).toLowerCase().replace(/\/+$/, "");
      const nextUrl = cleanText(identity.channelUrl).toLowerCase().replace(/\/+$/, "");
      return (nextChannel && existingChannel === nextChannel) || (nextUrl && existingUrl === nextUrl);
    });
    if (existingStreamer) {
      const currentAllowedUse = normalizeAllowedUse(existingStreamer.allowedUse);
      const requestedAllowedUse = Array.isArray(body.allowedUse)
        ? body.allowedUse.map((item) => cleanText(item).toLowerCase()).filter(Boolean)
        : [];
      const mergedAllowedUse = Array.from(new Set([...currentAllowedUse, ...requestedAllowedUse]));
      const nextPermissionStatus = permissionStatus === "approved" || existingStreamer.permissionStatus === "approved" ? "approved" : permissionStatus;
      const nextAllowedUse = nextPermissionStatus === "approved" && !mergedAllowedUse.length ? ["clips"] : mergedAllowedUse;
      const preserveMonitorEnabled = !requestedMonitorEnabled && existingStreamer.permissionStatus === "approved"
        ? Boolean(existingStreamer.monitorEnabled)
        : monitorEnabled;
      const nextLiveStatus = liveStatus === "unknown" || liveStatus === "unverified"
        ? existingStreamer.liveStatus || liveStatus
        : liveStatus;
      Object.assign(existingStreamer, {
        displayName: identity.displayName || existingStreamer.displayName,
        channelId: identity.channelId || existingStreamer.channelId,
        channelUrl: identity.channelUrl || existingStreamer.channelUrl,
        providerUserId: cleanText(body.providerUserId || body.broadcasterId) || existingStreamer.providerUserId || "",
        permissionStatus: nextPermissionStatus,
        allowedUse: nextAllowedUse,
        monitorEnabled: preserveMonitorEnabled,
        monitorPausedAt: preserveMonitorEnabled ? null : (body.monitorPausedAt || existingStreamer.monitorPausedAt || null),
        liveStatus: nextLiveStatus,
        liveStatusReason: nextLiveStatus === existingStreamer.liveStatus ? existingStreamer.liveStatusReason : liveStatusReason,
        notes: cleanText(body.notes) || existingStreamer.notes,
        updatedAt: now()
      });
      ensureStreamerDetectionProfile(existingStreamer, body.clipProfile || {});
      await logEvent("streamer_upserted", "Existing streamer updated instead of duplicated", {
        streamerId: existingStreamer.id,
        platform,
        channelId: existingStreamer.channelId,
        monitorEnabled: existingStreamer.monitorEnabled
      });
      let watch = null;
      if (existingStreamer.permissionStatus === "approved" && existingStreamer.monitorEnabled && existingStreamer.liveStatus === "live") {
        watch = await startLiveWatchForApprovedStreamer(existingStreamer, "streamer_upserted");
      }
      await saveState();
      return sendJson(res, 200, { streamer: existingStreamer, watchSession: watch?.session || null, reused: true });
    }
    const streamer = {
      id: newId("streamer"),
      platform,
      displayName: identity.displayName,
      channelId: identity.channelId,
      channelUrl: identity.channelUrl,
      providerUserId: cleanText(body.providerUserId || body.broadcasterId),
      permissionStatus,
      allowedUse: Array.isArray(body.allowedUse)
        ? Array.from(new Set(body.allowedUse.map((item) => cleanText(item).toLowerCase()).filter(Boolean)))
        : ["clips"],
      monitorEnabled,
      monitorPausedAt: monitorEnabled ? null : (body.monitorPausedAt || null),
      lastCheckedAt: null,
      liveStatus,
      liveStatusReason,
      notes: cleanText(body.notes),
      createdAt: now(),
      updatedAt: now()
    };
    ensureStreamerDetectionProfile(streamer, body.clipProfile || {});
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
      permissionStatus: streamer.permissionStatus,
      monitorEnabled: streamer.monitorEnabled,
      liveStatus: streamer.liveStatus
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
    let watch = null;
    if (streamer.permissionStatus === "approved" && streamer.monitorEnabled && streamer.liveStatus === "live") {
      watch = await startLiveWatchForApprovedStreamer(streamer, "streamer_added");
    }
    await saveState();
    return sendJson(res, 201, { streamer, watchSession: watch?.session || null });
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

  if (req.method === "POST" && pathname === "/api/twitch/streamers/bulk-delete") {
    const body = await readJsonBody(req).catch(() => ({}));
    const ids = [...new Set(Array.isArray(body.ids) ? body.ids.map(cleanText).filter(Boolean) : [])];
    if (!ids.length) return sendError(res, 400, "Choose at least one streamer to remove.");
    const deleted = [];
    const blocked = [];
    const stoppedSessions = [];
    for (const id of ids) {
      try {
        const result = await removeStreamerFromWatchlist(id, "operator_bulk_delete_streamers");
        deleted.push(result.streamerId);
        stoppedSessions.push(...(result.stoppedSessions || []));
      } catch (error) {
        blocked.push({ id, error: error.message });
      }
    }
    await logEvent("streamer_bulk_delete", "Bulk streamer delete completed", {
      requested: ids.length,
      deleted: deleted.length,
      blocked: blocked.length,
      stoppedSessions: stoppedSessions.length
    });
    await saveState();
    return sendJson(res, 200, { requested: ids.length, deleted, blocked, stoppedSessions });
  }

  const streamerApproveMatch = pathname.match(/^\/api\/twitch\/streamers\/([^/]+)\/approve$/);
  if (streamerApproveMatch && req.method === "PATCH") {
    const streamer = findStreamer(streamerApproveMatch[1]);
    if (!streamer) return sendError(res, 404, "Streamer not found");
    await enforceSingleWatchedStreamer(streamer.id, "streamer_approved_monitor_enabled");
    try {
      assertWatchCapacity({ monitorEnabled: true, permissionStatus: "approved", excludeId: streamer.id });
    } catch (error) {
      return sendError(res, error.statusCode || 409, error.message, error.details);
    }
    streamer.permissionStatus = "approved";
    streamer.allowedUse = Array.from(new Set([...(streamer.allowedUse || []), "clips", "edits"]));
    streamer.monitorEnabled = true;
    streamer.monitorPausedAt = null;
    streamer.updatedAt = now();
    await logEvent("streamer_approved", `${streamer.displayName} approved for clipping`, {
      streamerId: streamer.id,
      allowedUse: streamer.allowedUse
    });
    let watch = null;
    if (streamer.liveStatus === "live") {
      watch = await startLiveWatchForApprovedStreamer(streamer, "streamer_approved");
    }
    await saveState();
    return sendJson(res, 200, { streamer, watchSession: watch?.session || null });
  }

  const streamerClipProfileMatch = pathname.match(/^\/api\/twitch\/streamers\/([^/]+)\/clip-profile$/);
  if (streamerClipProfileMatch && req.method === "PATCH") {
    const streamer = findStreamer(streamerClipProfileMatch[1]);
    if (!streamer) return sendError(res, 404, "Streamer not found");
    const body = await readJsonBody(req).catch(() => ({}));
    const clipProfile = ensureStreamerDetectionProfile(streamer, body);
    streamer.updatedAt = now();
    await logEvent("streamer_clip_profile_updated", "Streamer clip profile updated", {
      streamerId: streamer.id,
      genre: clipProfile.genre,
      minClipScore: clipProfile.minClipScore,
      chatSpikeThreshold: clipProfile.chatSpikeThreshold,
      tensionSpikeThreshold: clipProfile.tensionSpikeThreshold
    });
    await saveState();
    return sendJson(res, 200, { streamer, clipProfile });
  }

  const streamerMatch = pathname.match(/^\/api\/twitch\/streamers\/([^/]+)$/);
  if (streamerMatch && req.method === "PATCH") {
    const streamer = findStreamer(streamerMatch[1]);
    if (!streamer) return sendError(res, 404, "Streamer not found");
    const body = await readJsonBody(req);
    const before = streamer.permissionStatus;
    const nextPermissionStatus = body.permissionStatus
      ? normalizeStatus(body.permissionStatus, ["approved", "pending", "blocked"], streamer.permissionStatus)
      : streamer.permissionStatus;
    const approvingNow = before !== "approved" && nextPermissionStatus === "approved";
    const nextMonitorEnabled = body.monitorEnabled !== undefined
      ? Boolean(body.monitorEnabled)
      : approvingNow && streamer.liveStatus === "live" && !streamer.monitorPausedAt
        ? true
        : streamer.monitorEnabled;
    const nextPlatform = body.platform ? normalizeStatus(body.platform, ["twitch", "youtube_live", "kick", "other"], streamer.platform) : streamer.platform;
    const providerConfigured = liveProviderConfigured(nextPlatform);
    const safeMonitorEnabled = providerConfigured ? nextMonitorEnabled : false;
    const safePermissionStatus = nextMonitorEnabled && !providerConfigured && nextPermissionStatus !== "blocked" ? "pending" : nextPermissionStatus;
    if (safeMonitorEnabled && safePermissionStatus === "approved") {
      await enforceSingleWatchedStreamer(streamer.id, "streamer_patch_monitor_enabled");
    }
    try {
      assertWatchCapacity({ monitorEnabled: safeMonitorEnabled, permissionStatus: safePermissionStatus, excludeId: streamer.id });
    } catch (error) {
      return sendError(res, error.statusCode || 409, error.message, error.details);
    }
    const identity = normalizeStreamerInput({
      displayName: body.displayName !== undefined ? body.displayName : streamer.displayName,
      channelId: body.channelId !== undefined ? body.channelId : streamer.channelId,
      channelUrl: body.channelUrl !== undefined ? body.channelUrl : streamer.channelUrl,
      platform: body.platform !== undefined ? body.platform : streamer.platform
    });
    const currentAllowedUse = normalizeAllowedUse(streamer.allowedUse);
    const requestedAllowedUse = Array.isArray(body.allowedUse)
      ? body.allowedUse.map((item) => cleanText(item).toLowerCase()).filter(Boolean)
      : [];
    const mergedAllowedUse = Array.from(new Set([...currentAllowedUse, ...requestedAllowedUse]));
    const nextAllowedUse = safePermissionStatus === "approved" && !mergedAllowedUse.length ? ["clips"] : mergedAllowedUse;
    Object.assign(streamer, {
      platform: nextPlatform,
      displayName: body.displayName !== undefined || body.channelId !== undefined || body.channelUrl !== undefined ? identity.displayName : streamer.displayName,
      channelId: body.displayName !== undefined || body.channelId !== undefined || body.channelUrl !== undefined ? identity.channelId : streamer.channelId,
      channelUrl: body.displayName !== undefined || body.channelId !== undefined || body.channelUrl !== undefined ? identity.channelUrl : streamer.channelUrl,
      providerUserId: body.providerUserId !== undefined || body.broadcasterId !== undefined
        ? cleanText(body.providerUserId || body.broadcasterId)
        : streamer.providerUserId || "",
      permissionStatus: safePermissionStatus,
      allowedUse: nextAllowedUse,
      monitorEnabled: safeMonitorEnabled,
      monitorPausedAt: safeMonitorEnabled ? null : (body.monitorEnabled === false ? now() : streamer.monitorPausedAt || null),
      liveStatus: !providerConfigured && nextMonitorEnabled ? "api_not_configured" : streamer.liveStatus,
      liveStatusReason: !providerConfigured && nextMonitorEnabled
        ? `${nextPlatform === "kick" ? "Kick" : nextPlatform === "twitch" ? "Twitch" : "Provider"} API is not configured. Monitoring was kept paused.`
        : streamer.liveStatusReason,
      notes: body.notes !== undefined ? cleanText(body.notes) : streamer.notes,
      updatedAt: now()
    });
    ensureStreamerDetectionProfile(streamer, body.clipProfile || {});
    if (before !== "approved" && streamer.permissionStatus === "approved") {
      await logEvent("approval_local", "Streamer permission marked approved locally", { streamerId: streamer.id });
    }
    let watch = null;
    if (streamer.permissionStatus === "approved" && streamer.monitorEnabled && streamer.liveStatus === "live") {
      watch = await startLiveWatchForApprovedStreamer(streamer, "streamer_patch");
    }
    await saveState();
    return sendJson(res, 200, { streamer, watchSession: watch?.session || null });
  }

  if (streamerMatch && req.method === "DELETE") {
    try {
      const result = await removeStreamerFromWatchlist(streamerMatch[1], "operator_delete_streamer");
      await saveState();
      return sendJson(res, 200, { deleted: true, stoppedSessions: result.stoppedSessions || [] });
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  if (req.method === "GET" && pathname === "/api/watch-sessions") {
    await ensureActiveWatchSessionCandidateCoverage("watch_sessions_refresh");
    return sendJson(res, 200, {
      sessions: state.watchSessions.map(publicWatchSession),
      active: activeWatchSessions().map(publicWatchSession)
    });
  }

  if (req.method === "GET" && pathname === "/api/watch-sessions/active") {
    await ensureActiveWatchSessionCandidateCoverage("active_watch_sessions_refresh");
    return sendJson(res, 200, {
      workerId: WATCH_WORKER_ID,
      sessions: activeWatchSessions().map(publicWatchSession),
      events: state.watchEvents.slice(-120)
    });
  }

  if (req.method === "POST" && pathname === "/api/watch-sessions") {
    const body = await readJsonBody(req);
    const result = await startWatchSession(body);
    return sendJson(res, result.reused ? 200 : 201, result);
  }

  const watchSessionMatch = pathname.match(/^\/api\/watch-sessions\/([^/]+)(?:\/([^/]+))?$/);
  if (watchSessionMatch) {
    const sessionId = decodeURIComponent(watchSessionMatch[1]);
    const action = watchSessionMatch[2] || "detail";
    const session = state.watchSessions.find((item) => item.id === sessionId);
    if (!session) return sendError(res, 404, "Watch session not found");

    if (req.method === "GET" && action === "events") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        "connection": "keep-alive",
        "x-accel-buffering": "no"
      });
      res.write("retry: 3000\n\n");
      const clients = watchEventClients.get(sessionId) || new Set();
      clients.add(res);
      watchEventClients.set(sessionId, clients);
      const lastEventId = cleanText(req.headers["last-event-id"]);
      const events = watchEventsFor(sessionId);
      const startIndex = lastEventId ? Math.max(0, events.findIndex((event) => event.id === lastEventId) + 1) : 0;
      for (const event of events.slice(startIndex)) sendWatchEventToClient(res, event);
      req.on("close", () => {
        clients.delete(res);
        if (!clients.size) watchEventClients.delete(sessionId);
      });
      return;
    }

    if (req.method === "GET" && action === "detail") {
      await ensureActiveWatchSessionCandidateCoverage("watch_session_detail_refresh");
      return sendJson(res, 200, {
        session: publicWatchSession(session),
        events: watchEventsFor(session.id),
        candidates: state.clipCandidates.filter((candidate) => candidate.watchSessionId === session.id),
        summary: watchSessionSummary(session),
        mission: state.clipMissions.find((item) => item.id === session.clipProfileId || item.id === session.missionId) || null,
        profile: state.streamerClipProfiles.find((item) => item.id === session.clipProfileId || item.streamerId === session.streamerId) || null
      });
    }

    if (req.method === "GET" && action === "summary") {
      return sendJson(res, 200, { session: publicWatchSession(session), summary: watchSessionSummary(session) });
    }

    if (req.method === "GET" && action === "candidates") {
      await ensureActiveWatchSessionCandidateCoverage("watch_session_candidates_refresh");
      return sendJson(res, 200, {
        candidates: state.clipCandidates.filter((candidate) => candidate.watchSessionId === session.id)
      });
    }

    if (req.method === "GET" && action === "signals") {
      return sendJson(res, 200, {
        session: publicWatchSession(session),
        events: watchEventsFor(session.id).filter((event) => [
          "media_received",
          "signal_detected",
          "candidate_scoring",
          "candidate_accepted",
          "candidate_rejected",
          "render_completed",
          "source_capability_degraded"
        ].includes(event.type))
      });
    }

    if (req.method === "POST" && action === "pause") return sendJson(res, 200, { session: await pauseWatchSession(session.id) });
    if (req.method === "POST" && action === "resume") return sendJson(res, 200, { session: await resumeWatchSession(session.id) });
    if (req.method === "POST" && action === "reconnect") return sendJson(res, 200, { session: await resumeWatchSession(session.id) });
    if (req.method === "POST" && action === "capture") {
      const body = await readJsonBody(req);
      const streamer = state.streamers.find((item) => item.id === session.streamerId);
      const mission = state.clipMissions.find((item) => item.id === session.clipProfileId || item.id === session.missionId) || ensureClipMission(streamer);
      const requestedIndex = body.recordingWindowIndex ?? body.windowIndex;
      const windowIndex = Number.isFinite(Number(requestedIndex))
        ? Math.max(0, Number(requestedIndex))
        : Math.max(0, Math.floor(Number(session.analyzedSeconds || 0) / WATCH_RECORDING_WINDOW_SECONDS));
      const source = await captureLiveWindowForSession(session, { streamer, mission, windowIndex });
      await ensureWatchSessionCandidates(session);
      if (source) await autoStageCapturedCandidatesForBuilder(session, source, "manual_capture");
      const candidates = state.clipCandidates.filter((candidate) => candidate.watchSessionId === session.id);
      return sendJson(res, source ? 201 : 200, {
        session: publicWatchSession(session),
        source: source ? publicMediaSource(source) : null,
        candidates,
        recorder: await liveRecorderStatus()
      });
    }
    if (req.method === "POST" && action === "stop") {
      const body = await readJsonBody(req).catch(() => ({}));
      const stopped = await stopWatchSession(session.id, "cancelled", {
        reason: cleanText(body.reason) || "operator_stop",
        operatorAction: true
      });
      const stoppedSessions = (body.stopAll || shouldTreatAsSingleWatch())
        ? await stopOtherActiveWatchSessions(stopped.id, "operator_stop_single_watch")
        : [];
      return sendJson(res, 200, { session: stopped, stoppedSessions });
    }
  }

  if (req.method === "POST" && pathname === "/api/watch/run") {
    const body = await readJsonBody(req);
    const runMode = normalizeStatus(body.mode || "real", ["real", "demo"], "real");
    if (runMode === "demo") {
      const watch = await startWatchSession({
        ...body,
        mode: "demo",
        idempotencyKey: body.idempotencyKey || "practice-watch-cycle"
      });
      return sendJson(res, 200, {
        mode: "demo",
        label: "PRACTICE MEDIA — NOT A REAL STREAM",
        session: watch.session,
        results: state.clipCandidates
          .filter((candidate) => candidate.watchSessionId === watch.session.id || candidate.provenance === PROVENANCE.DEMO_SOURCE)
          .map((candidate) => ({ candidate, demo: true })),
        dailyLimit: dailyLimitStatus()
      });
    }
    if (body.streamerId) {
      const watch = await startWatchSession({
        ...body,
        mode: "real",
        idempotencyKey: body.idempotencyKey || `watch:${body.streamerId}:default`
      });
      return sendJson(res, 200, {
        mode: "real",
        session: watch.session,
        results: [{
          streamerId: watch.session.streamerId,
          live: watch.session.status === "watching",
          session: watch.session,
          reason: watch.summary?.capabilities?.hasLiveVideo
            ? "Backend watcher is analyzing verified media."
            : `Backend watcher is creating ${WATCH_RECORDING_WINDOW_SECONDS}s review windows while playable media capture is pending.`
        }],
        dailyLimit: dailyLimitStatus()
      });
    }
    const results = [];
    const pendingStreamers = state.streamers.filter((item) =>
      !isApprovedStreamer(item)
      && !isPracticeStreamer(item)
      && (item.monitorEnabled || (item.allowedUse || []).includes("clips"))
    );
    for (const streamer of pendingStreamers) {
      const blocked = {
        streamerId: streamer.id,
        live: null,
        skipped: true,
        official: false,
        reason: `Permission gate: ${streamer.displayName || streamer.channelId || "streamer"} is ${streamer.permissionStatus || "pending"}, so no live scan or clip capture was run.`
      };
      results.push(blocked);
      await logEvent("permission_blocked", "Watch skipped before live scan", {
        streamerId: streamer.id,
        reason: blocked.reason
      });
    }
    let monitoredStreamers = state.streamers.filter((item) => item.monitorEnabled && isApprovedStreamer(item) && !isPracticeStreamer(item));
    if (monitoredStreamers.length > 1) {
      await enforceSingleWatchedStreamer(monitoredStreamers[0].id, "watch_run_single_stream_cleanup");
      monitoredStreamers = state.streamers.filter((item) => item.monitorEnabled && isApprovedStreamer(item) && !isPracticeStreamer(item));
    }
    const runCapacity = watchCapacity();
    const activeStreamers = monitoredStreamers.slice(0, runCapacity.limit);
    const overflowStreamers = monitoredStreamers.slice(runCapacity.limit);
    for (const streamer of activeStreamers) {
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
    for (const streamer of overflowStreamers) {
      results.push({
        streamerId: streamer.id,
        live: null,
        skipped: true,
        official: false,
        reason: `Watch capacity is capped at ${runCapacity.limit}. Pause another stream before monitoring this one.`
      });
      await logEvent("watch_capacity_skipped", "Streamer skipped because watch capacity is full", {
        streamerId: streamer.id,
        capacity: watchCapacity()
      });
    }
    await saveState();
    return sendJson(res, 200, {
      mode: "real",
      results,
      watchCapacity: watchCapacity(),
      dailyLimit: dailyLimitStatus()
    });
  }

  if (req.method === "GET" && pathname === "/api/clips/candidates") {
    await ensureActiveWatchSessionCandidateCoverage("radar_refresh");
    const projectId = cleanText(searchParams.get("projectId"));
    const sourceId = cleanText(searchParams.get("sourceId"));
    const watchSessionId = cleanText(searchParams.get("watchSessionId"));
    const streamerId = cleanText(searchParams.get("streamerId"));
    let candidates = filterClipCandidatesForRadar(state.clipCandidates, { projectId, sourceId });
    if (watchSessionId) candidates = candidates.filter((candidate) => candidate.watchSessionId === watchSessionId);
    if (streamerId) candidates = candidates.filter((candidate) => candidate.streamerId === streamerId);
    return sendJson(res, 200, {
      candidates,
      streamers: state.streamers
    });
  }

  const clipCandidateApproveBuilderMatch = pathname.match(/^\/api\/clips\/candidates\/([^/]+)\/approve-builder$/);
  if (clipCandidateApproveBuilderMatch && req.method === "POST") {
    try {
      return sendJson(res, 200, await approveClipCandidateForBuilder(clipCandidateApproveBuilderMatch[1]));
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message, error.details || {});
    }
  }

  const clipCandidateDeclineMatch = pathname.match(/^\/api\/clips\/candidates\/([^/]+)\/decline$/);
  if (clipCandidateDeclineMatch && req.method === "POST") {
    try {
      const body = await readJsonBody(req).catch(() => ({}));
      return sendJson(res, 200, await declineClipCandidate(
        clipCandidateDeclineMatch[1],
        cleanText(body.reason) || "Declined from Clips by operator."
      ));
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message, error.details || {});
    }
  }

  const clipCandidateCapCutInputsMatch = pathname.match(/^\/api\/clips\/candidates\/([^/]+)\/capcut-workflow-inputs$/);
  if (clipCandidateCapCutInputsMatch && req.method === "GET") {
    try {
      return sendJson(res, 200, await capcutWorkflowInputsForCandidate(clipCandidateCapCutInputsMatch[1]));
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message, error.details || {});
    }
  }

  const legacyClipCandidateDeleteMatch = pathname.match(/^\/api\/clips\/candidates\/([^/]+)$/);
  if (legacyClipCandidateDeleteMatch && req.method === "DELETE") {
    try {
      const stopWatcher = ["1", "true", "yes"].includes(String(searchParams.get("stopWatcher") || searchParams.get("stopWatchers") || "").toLowerCase());
      const result = await deleteClipCandidate(legacyClipCandidateDeleteMatch[1], "operator_delete", { stopWatcher });
      return sendJson(res, 200, result);
    } catch (error) {
      return sendError(res, error.statusCode || 500, error.message, error.details || {});
    }
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
    candidate.status = "in_builder";
    candidate.movedToBuilderAt = now();
    candidate.updatedAt = now();
    await logEvent("builder_draft_saved", "Clip builder draft saved", { candidateId: candidate.id });
    await saveState();
    return sendJson(res, 200, { candidate });
  }

  if (req.method === "POST" && pathname === "/api/clips/package") {
    const body = await readJsonBody(req);
    const candidate = state.clipCandidates.find((item) => item.id === body.candidateId);
    try {
      const result = await createClipPackageForCandidate(candidate, body, { createdBy: "Operator" });
      await saveState();
      return sendJson(res, result.reused ? 200 : 201, {
      clipPackage: result.clipPackage,
      packagePlan: result.packagePlan,
      postingDrafts: [],
      message: "Clip package created from verified source. Posting drafts are blocked until a rendered clip artifact passes verification."
    });
    } catch (error) {
      return sendError(res, error.statusCode || 422, error.message);
    }
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
        try {
          pruneLiveWindowsForStreamerBeforeWatchStart(streamer.id, "human_gate_approval_cleanup", "", { forceSingleWatch: true });
          if (streamer.permissionStatus === "approved") {
            const sessions = state.watchSessions.filter((session) => session.streamerId === streamer.id && session.id);
            for (const session of sessions) {
              purgeUnresolvedLiveWindowCandidatesForSession(session, "human_gate_approval_cleanup");
            }
          }
        } catch (error) {
          await logEvent("watch_cleanup_for_approval_failed", "Failed cleanup old watch candidates before starting approved watcher", {
            requestId: request.id,
            streamerId: streamer.id,
            error: error.message
          });
        }
        if (liveProviderConfigured(streamer.platform)) {
          try {
            assertWatchCapacity({ monitorEnabled: true, permissionStatus: "approved", excludeId: streamer.id });
            streamer.monitorEnabled = true;
            streamer.monitorPausedAt = null;
          } catch (error) {
            await logEvent("watch_auto_start_blocked", "Streamer approved but watch capacity is full", {
              streamerId: streamer.id,
              error: error.message
            });
          }
        }
        streamer.updatedAt = now();
      }
    }
    request.status = action;
    request.decidedAt = now();
    request.decisionNotes = cleanText(body.notes);
    let watch = null;
    if (request.type === "streamer_permission" && action === "approved") {
      const streamer = findStreamer(request.linkedId);
      if (streamer?.monitorEnabled) {
        watch = await startLiveWatchForApprovedStreamer(streamer, "human_gate_approval");
      }
    }
    await logEvent(action === "approved" ? "approved" : "approval_decision", `Human Gate ${action}`, {
      requestId: request.id,
      type: request.type
    });
    await saveState();
    return sendJson(res, 200, { request, dailyLimit: dailyLimitStatus(), watchSession: watch?.session || null });
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

const readyPromise = ensureCaptureTools()
  .then(ensureStorage)
  .then(recoverWatchSessions)
  .then(recoverApprovedLiveMonitors);

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

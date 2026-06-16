import http from "node:http";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "data", "state.json");
const PUBLIC_DIR = path.join(__dirname, "public");

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
  twitchAllowedChannels: (process.env.TWITCH_ALLOWED_CHANNELS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
  kickClientId: process.env.KICK_CLIENT_ID || "",
  kickClientSecret: process.env.KICK_CLIENT_SECRET || "",
  kickOAuthToken: process.env.KICK_OAUTH_TOKEN || "",
  uploadDir: path.resolve(__dirname, process.env.CLIPPER_UPLOAD_DIR || "./uploads"),
  outputDir: path.resolve(__dirname, process.env.CLIPPER_OUTPUT_DIR || "./outputs"),
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
  logs: []
};

let state = structuredClone(stateDefaults);
let twitchAppToken = null;
let kickAppToken = null;

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
  return Boolean(config.twitchClientId && (config.twitchClientSecret || config.twitchOAuthToken));
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

async function logEvent(type, message, details = {}) {
  state.logs.unshift({
    id: newId("log"),
    type,
    message,
    details,
    createdAt: now()
  });
  state.logs = state.logs.slice(0, 500);
  await saveState();
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
    uploadDir: config.uploadDir,
    outputDir: config.outputDir
  };
}

function findStreamer(id) {
  return state.streamers.find((streamer) => streamer.id === id);
}

function isApprovedStreamer(streamer) {
  return streamer?.permissionStatus === "approved";
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

function createApprovalRequest({ type, title, riskLevel = "medium", evidence = {}, linkedId }) {
  const existing = state.approvalRequests.find(
    (request) => request.linkedId === linkedId && request.type === type && request.status === "pending"
  );
  if (existing) return existing;
  const request = {
    id: newId("approval"),
    type,
    title,
    riskLevel,
    evidence,
    linkedId,
    status: "pending",
    createdAt: now(),
    decidedAt: null,
    decisionNotes: ""
  };
  state.approvalRequests.unshift(request);
  return request;
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
    filename,
    path: filePath,
    url: `/outputs/${encodeURIComponent(filename)}`,
    createdAt: now()
  };
  state.artifacts.unshift(artifact);
  return artifact;
}

async function getTwitchAppToken() {
  if (twitchAppToken?.expiresAt > Date.now() + 60_000) return twitchAppToken.accessToken;
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

async function twitchFetch(endpoint) {
  const token = config.twitchOAuthToken || (await getTwitchAppToken());
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
  const platforms = ["tiktok", "instagram_reels", "youtube_shorts"];
  return platforms.map((platform) => {
    const draft = {
      id: newId("post"),
      clipPackageId: clipPackage.id,
      platform,
      videoRef: clipPackage.artifacts?.[0]?.url || "",
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

async function handleApi(req, res, pathname, searchParams) {
  if (req.method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      app: "StreamClipper Agent",
      time: now(),
      status: {
        streamers: state.streamers.length,
        candidates: state.clipCandidates.length,
        queuedPosts: state.postingDrafts.length,
        pendingApprovals: state.approvalRequests.filter((request) => request.status === "pending").length
      }
    });
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

  if (req.method === "GET" && pathname === "/api/twitch/status") {
    return sendJson(res, 200, {
      configured: twitchApiConfigured(),
      clientIdConfigured: Boolean(config.twitchClientId),
      clientSecretConfigured: Boolean(config.twitchClientSecret),
      redirectUriConfigured: Boolean(config.twitchRedirectUri),
      oauthTokenConfigured: Boolean(config.twitchOAuthToken),
      allowedChannels: config.twitchAllowedChannels,
      officialApiOnly: true
    });
  }

  if (req.method === "POST" && pathname === "/api/twitch/test") {
    try {
      if (!twitchApiConfigured()) {
        return sendJson(res, 200, {
          configured: false,
          live: false,
          message: "Twitch credentials are not configured. Watch cycles will use approved demo candidates."
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

  if (req.method === "POST" && pathname === "/api/demo/seed") {
    const seeded = await seedDemoWorkspace();
    return sendJson(res, 200, {
      seeded,
      message: "Demo mission loaded. StreamClipper is ready to run a supervised clipping cycle."
    });
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
    const results = [];
    for (const streamer of state.streamers.filter((item) => item.monitorEnabled)) {
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

      const session = {
        id: newId("session"),
        streamerId: streamer.id,
        platform: streamer.platform,
        title: stream?.title || `${streamer.displayName} approved demo watch`,
        category: stream?.game_name || "Demo / manual review",
        startedAt: stream?.started_at || now(),
        endedAt: null,
        vodId: null,
        status: stream ? "live" : "demo"
      };
      state.streamSessions.unshift(session);

      const candidateBase = {
        id: newId("candidate"),
        streamerId: streamer.id,
        sessionId: session.id,
        sourceType: stream ? `${streamer.platform}_live` : "demo",
        sourceId: stream?.id || session.id,
        timestampStart: "00:00:15",
        timestampEnd: "00:00:45",
        duration: 30,
        title: stream?.title || `${streamer.displayName} reaction moment`,
        category: session.category,
        transcriptSnippet: stream ? "" : "Manual demo candidate. Add transcript, chat spike, or visual notes before final approval.",
        chatSignals: stream ? { spike: 0, source: "not_connected" } : { spike: 12, source: "demo" },
        reason: stream
          ? "Live stream metadata found. Candidate needs transcript/chat context before packaging."
          : "Safe demo candidate for workflow testing. No download or external post has occurred.",
        hookScore: stream ? 12 : 14,
        riskScore: 15,
        status: "candidate",
        createdAt: now(),
        updatedAt: now()
      };
      const score = scoreClipMoment(candidateBase);
      const candidate = { ...candidateBase, ...score };
      state.clipCandidates.unshift(candidate);
      results.push({ ...(liveCheck || { streamerId: streamer.id, live: Boolean(stream), official: false }), session, candidate });
      await logEvent("candidate_detected", "Clip candidate detected", {
        streamerId: streamer.id,
        candidateId: candidate.id,
        sourceType: candidate.sourceType
      });
    }
    await saveState();
    return sendJson(res, 200, { results, dailyLimit: dailyLimitStatus() });
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
    if (!isApprovedStreamer(streamer)) {
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
      packagePlan,
      createdAt: now(),
      updatedAt: now()
    };
    state.clipPackages.unshift(clipPackage);
    candidate.status = "packaged";
    candidate.updatedAt = now();
    const drafts = createPostingDraftsForPackage(clipPackage, packagePlan);
    clipPackage.postingDrafts = drafts.map((draft) => draft.id);
    createApprovalRequest({
      type: "clip_package",
      title: `Clip package: ${packagePlan.title}`,
      riskLevel: "medium",
      linkedId: clipPackage.id,
      evidence: { candidateId: candidate.id, streamerId: streamer.id }
    });
    await logEvent("package_created", "Clip package created", {
      candidateId: candidate.id,
      clipPackageId: clipPackage.id
    });
    await saveState();
    return sendJson(res, 201, { clipPackage, packagePlan, postingDrafts: drafts });
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

  if (req.method === "POST" && pathname === "/api/posts/queue") {
    const body = await readJsonBody(req);
    if (body.approvalStatus === "approved" && dailyLimitStatus().blocked) {
      return sendError(res, 429, "Daily approved post limit reached", dailyLimitStatus());
    }
    const draft = {
      id: newId("post"),
      clipPackageId: cleanText(body.clipPackageId),
      platform: normalizeStatus(body.platform, ["tiktok", "instagram_reels", "youtube_shorts"], "tiktok"),
      videoRef: cleanText(body.videoRef),
      caption: cleanText(body.caption),
      hashtags: Array.isArray(body.hashtags) ? body.hashtags : [],
      thumbnailText: cleanText(body.thumbnailText),
      scheduledFor: cleanText(body.scheduledFor),
      status: "draft",
      platformStatus: "not_uploaded",
      approvalStatus: normalizeStatus(body.approvalStatus, ["pending", "approved", "rejected", "send_back"], "pending"),
      requiresApproval: true,
      riskNotes: Array.isArray(body.riskNotes) ? body.riskNotes : ["Human Gate approval required."],
      createdAt: now(),
      updatedAt: now(),
      approvedAt: body.approvalStatus === "approved" ? now() : null
    };
    state.postingDrafts.unshift(draft);
    await logEvent("post_queued", "Posting draft queued", { draftId: draft.id, platform: draft.platform });
    await saveState();
    return sendJson(res, 201, { draft, dailyLimit: dailyLimitStatus() });
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
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".srt": "text/plain; charset=utf-8",
    ".vtt": "text/vtt; charset=utf-8"
  };
  const stream = createReadStream(filePath);
  stream.on("open", () => {
    res.writeHead(200, {
      "content-type": types[ext] || "application/octet-stream",
      "cache-control": "no-store"
    });
    stream.pipe(res);
  });
  stream.on("error", () => {
    if (!res.headersSent) sendError(res, 404, "File not found");
    else res.end();
  });
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

export { handleRequest };

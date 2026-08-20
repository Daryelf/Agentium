# Codex Prompt — Fix Real Auto-Clipper Pipeline
# The watch session runs but clips are never created. This fixes all three blockers.

---

## DIAGNOSIS (do not skip this section)

The clipping office server.js has a complete live-capture pipeline that is fully
blocked by three stacked issues. Fix all three or clipping will still not work.

### Blocker 1 — streamlink is not installed

`resolveLivePlaybackUrl()` requires streamlink OR yt-dlp to pull an HLS stream
from Twitch. Neither is installed. FFmpeg alone cannot open a Twitch channel URL.

Without a stream puller, `liveRecorderStatus()` returns `{ ready: false }` and
`captureLiveWindowForSession()` throws a 424 error silently in the watch worker,
which swallows it and reschedules the tick. The UI never shows this failure.

**Fix:** Install streamlink at server startup via a pre-flight check and install script.

### Blocker 2 — No .env file in the CLIPPING OFFICE directory

The main Argentum `.env` at the root has `TWITCH_CLIENT_ID` and
`TWITCH_CLIENT_SECRET` set, but the Clipping Office server reads from its own
process environment. There is no `.env` file inside `CLIPPING OFFICE/`, so
`config.twitchClientId` and `config.twitchClientSecret` are empty strings.

This means:
- `twitchIntegrationStatus()` returns `configured: false`
- `checkStreamerLive()` fails → `liveStatus` stays as `"api_not_configured"`
- The agent run guard at line ~7075 short-circuits before any clipping logic runs

**Fix:** Create `CLIPPING OFFICE/.env` by symlinking or copying from the parent
root `.env`, OR add a startup step that loads env vars from the parent directory.

### Blocker 3 — No approved streamers in state.json

`captureLiveWindowForSession()` has this guard at line 1166:
```js
if (!session || session.mode !== "real" || !isRealApprovedStreamer(streamer)) return null;
```

`isRealApprovedStreamer()` requires `permissionStatus === "approved"`. Every
streamer in state.json currently has `permissionStatus: "pending"`. The UI may
show "approved" from an in-memory state that was never persisted to disk, likely
because saveState() was racing or the server restarted.

**Fix:** Add a streamer approval endpoint + fix the saveState race condition.

### Blocker 4 (Architecture) — No real moment detection

Even after fixing blockers 1-3, the capture pipeline records sequential 30-second
windows and creates candidates with HARDCODED signals:
```js
chatSignals: { spike: 130 - index * 16, messagesPerMinute: 130 - index * 16, source: "practice_signal" }
```

This is not real auto-clipping. Real auto-clipping needs:
- Twitch IRC chat ingestion → detect actual chat spike moments
- Audio energy analysis via FFmpeg → detect real loud/exciting moments
- Clip candidate creation ONLY at those moments, not arbitrary 30s blocks
- Official Twitch Clips API to create the actual clip object

---

## FIXES TO IMPLEMENT

### Fix 1 — Create CLIPPING OFFICE/.env

File: `CLIPPING OFFICE/.env` (create this file)

Copy all vars from the parent `/Volumes/ZYLO/Argentum/.env` and add these
Clipping Office-specific vars:

```
# Inherit from parent Argentum .env
AI_PROVIDER=openai
AI_MODE=live
OPENAI_MODEL=gpt-4.1-mini
OPENAI_API_KEY=<copy from parent .env>
TWITCH_CLIENT_ID=<copy from parent .env>
TWITCH_CLIENT_SECRET=<copy from parent .env>
KICK_CLIENT_ID=<copy from parent .env>
KICK_CLIENT_SECRET=<copy from parent .env>

# Clipping Office specific
ANTHROPIC_API_KEY=<copy from parent .env if present>
ANTHROPIC_MODEL=claude-sonnet-4-6
STREAMCLIPPER_CAPTURE_ENABLED=true
STREAMLINK_PATH=streamlink
YTDLP_PATH=yt-dlp
WATCH_TICK_MS=7000
STREAMCLIPPER_RECORDING_WINDOW_SECONDS=30
PORT=4177
CLIPPER_UPLOAD_DIR=./uploads
CLIPPER_OUTPUT_DIR=./outputs
CLIPPER_WATCH_BUFFER_DIR=./watch-buffers
```

Also add a startup script `CLIPPING OFFICE/start.sh`:
```bash
#!/bin/bash
set -e

# Ensure streamlink is available
if ! command -v streamlink &> /dev/null; then
  echo "Installing streamlink..."
  pip3 install streamlink --break-system-packages --quiet
fi

# Ensure yt-dlp is available as fallback
if ! command -v yt-dlp &> /dev/null; then
  echo "Installing yt-dlp..."
  pip3 install yt-dlp --break-system-packages --quiet
fi

echo "Starting Clipping Office on port 4177..."
node server.js
```

Make it executable: `chmod +x start.sh`

Update `package.json` scripts:
```json
{
  "scripts": {
    "start": "bash start.sh",
    "dev": "bash start.sh"
  }
}
```

---

### Fix 2 — Fix saveState Race Condition

File: `CLIPPING OFFICE/server.js`

Find the `saveState()` function. It currently does a direct `fs.writeFile()`.
Replace with atomic write:

```js
async function saveState() {
  const tmp = DATA_FILE + ".tmp." + process.pid;
  try {
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await fs.rename(tmp, DATA_FILE);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}
```

Also add a startup save immediately after loading state so the on-disk version
always reflects what's actually in memory:

Find the server startup block (after `loadState()` is called) and add:
```js
await saveState(); // Flush any in-memory migrations to disk on startup
```

---

### Fix 3 — Add Streamer Approval API Endpoint

File: `CLIPPING OFFICE/server.js`

Add a `PATCH /api/twitch/streamers/:id/approve` route that explicitly sets
`permissionStatus: "approved"` and `allowedUse: ["clips", "edits"]` and saves
state. This gives the UI a reliable way to approve a streamer and persist it.

```js
if (req.method === "PATCH" && pathname.match(/^\/api\/twitch\/streamers\/([^/]+)\/approve$/)) {
  const streamerId = decodeURIComponent(pathname.split("/")[4]);
  const streamer = state.streamers.find(s => s.id === streamerId);
  if (!streamer) return sendError(res, 404, "Streamer not found");

  streamer.permissionStatus = "approved";
  streamer.allowedUse = streamer.allowedUse?.length
    ? [...new Set([...streamer.allowedUse, "clips"])]
    : ["clips", "edits"];
  streamer.monitorEnabled = true;
  streamer.updatedAt = now();

  await saveState();
  await logEvent("streamer_approved", `${streamer.displayName} approved for clipping`, { streamerId });
  return sendJson(res, 200, { streamer });
}
```

Also wire up the existing "Approved" button in the UI (app.js) to call this
new endpoint instead of doing a local state-only update.

---

### Fix 4 — Wire Real Twitch IRC Chat Ingestion

File: `CLIPPING OFFICE/services/twitch-chat.js` (create this file)

```js
/**
 * twitch-chat.js
 * Connects to Twitch IRC via WebSocket to read chat messages in real time.
 * Detects chat spikes (sudden bursts of messages) and emits them as events.
 * Does NOT post to chat. Read-only.
 */

import { WebSocket } from "ws";

const CHAT_WINDOW_MS = 10000; // 10-second rolling window for spike detection
const SPIKE_THRESHOLD = 30;   // messages per window to count as a spike
const RECONNECT_DELAY_MS = 5000;

export class TwitchChatMonitor {
  constructor({ channelName, onSpike, onMessage }) {
    this.channelName = channelName.toLowerCase();
    this.onSpike = onSpike || (() => {});
    this.onMessage = onMessage || (() => {});
    this.ws = null;
    this.messages = []; // rolling timestamps
    this.active = false;
    this.reconnectTimer = null;
  }

  start() {
    this.active = true;
    this._connect();
  }

  stop() {
    this.active = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  _connect() {
    if (!this.active) return;
    this.ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");

    this.ws.on("open", () => {
      this.ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
      this.ws.send("PASS oauth:justinfan12345"); // anonymous read-only login
      this.ws.send("NICK justinfan12345");
      this.ws.send(`JOIN #${this.channelName}`);
    });

    this.ws.on("message", (raw) => {
      const line = raw.toString().trim();
      if (line.startsWith("PING")) {
        this.ws.send("PONG :tmi.twitch.tv");
        return;
      }

      if (line.includes("PRIVMSG")) {
        const now = Date.now();
        this.messages.push(now);

        // Keep only messages in the rolling window
        const windowStart = now - CHAT_WINDOW_MS;
        this.messages = this.messages.filter(t => t >= windowStart);

        this.onMessage({ channel: this.channelName, timestamp: now, count: this.messages.length });

        // Detect spike
        if (this.messages.length >= SPIKE_THRESHOLD) {
          this.onSpike({
            channel: this.channelName,
            timestamp: now,
            messagesPerWindow: this.messages.length,
            messagesPerMinute: Math.round(this.messages.length * (60000 / CHAT_WINDOW_MS))
          });
        }
      }
    });

    this.ws.on("close", () => {
      if (this.active) {
        this.reconnectTimer = setTimeout(() => this._connect(), RECONNECT_DELAY_MS);
      }
    });

    this.ws.on("error", () => {
      this.ws?.close();
    });
  }

  currentMessagesPerMinute() {
    const now = Date.now();
    const windowStart = now - CHAT_WINDOW_MS;
    const recent = this.messages.filter(t => t >= windowStart);
    return Math.round(recent.length * (60000 / CHAT_WINDOW_MS));
  }
}
```

Add `ws` to package.json dependencies:
```json
"ws": "^8.18.0"
```

---

### Fix 5 — Integrate Chat Monitor into Watch Worker

File: `CLIPPING OFFICE/server.js`

At the top, import the chat monitor:
```js
import { TwitchChatMonitor } from "./services/twitch-chat.js";
```

Add a Map to track active chat monitors:
```js
const chatMonitors = new Map(); // sessionId → TwitchChatMonitor
const chatSpikeLog = new Map(); // sessionId → [{ timestamp, mpm }]
```

In `startWatchWorker(sessionId)`, after creating the timer, start a chat monitor:
```js
function startWatchWorker(sessionId) {
  if (watchWorkerTimers.has(sessionId)) return;
  watchWorkerTimers.set(sessionId, setTimeout(() => runWatchWorkerTick(sessionId).catch((error) => {
    addStateLog("watch_worker_error", "Watch worker failed", { sessionId, error: error.message });
  }), 250));

  // Start chat monitor for real sessions
  const session = state.watchSessions.find(s => s.id === sessionId);
  const streamer = state.streamers.find(s => s.id === session?.streamerId);
  if (session?.mode === "real" && streamer?.platform === "twitch" && streamer?.channelId && !chatMonitors.has(sessionId)) {
    const monitor = new TwitchChatMonitor({
      channelName: streamer.channelId,
      onSpike: (spike) => {
        const spikes = chatSpikeLog.get(sessionId) || [];
        spikes.push({ ...spike, sessionId, recordedAt: now() });
        chatSpikeLog.set(sessionId, spikes.slice(-100)); // keep last 100 spikes
        appendWatchEvent(sessionId, "chat_spike_detected", spike).catch(() => {});
      }
    });
    chatMonitors.set(sessionId, monitor);
    monitor.start();
  }
}
```

In `stopWatchWorkerTimer(sessionId)`, also stop the chat monitor:
```js
function stopWatchWorkerTimer(sessionId) {
  if (watchWorkerTimers.has(sessionId)) {
    clearTimeout(watchWorkerTimers.get(sessionId));
    watchWorkerTimers.delete(sessionId);
  }
  watchWorkerBusy.delete(sessionId);
  const monitor = chatMonitors.get(sessionId);
  if (monitor) {
    monitor.stop();
    chatMonitors.delete(sessionId);
  }
}
```

---

### Fix 6 — Real Moment Detection in Watch Worker Tick

File: `CLIPPING OFFICE/server.js`

Replace `maybeCaptureCurrentWatchWindow()` inside `runWatchWorkerTick()`.

Current code:
```js
if (!capabilities?.hasLiveVideo) {
  const capturedSource = await maybeCaptureCurrentWatchWindow(session, { streamer, mission });
  if (capturedSource) {
    capabilities = capabilitiesForWatchSource({ session, source: capturedSource, streamer });
  }
}
```

Replace with:
```js
if (!capabilities?.hasLiveVideo) {
  // Check if there's been a chat spike in the last 30 seconds
  const recentSpikes = (chatSpikeLog.get(session.id) || [])
    .filter(s => Date.now() - new Date(s.recordedAt).getTime() < 30000);

  const shouldCapture = recentSpikes.length > 0 || Number(session.analyzedSeconds || 0) % 120 === 0;
  // ^ Capture on chat spike OR every 2 minutes as baseline

  if (shouldCapture) {
    const currentIndex = Math.max(0, Math.floor(Number(session.analyzedSeconds || 0) / WATCH_RECORDING_WINDOW_SECONDS));
    const capturedSource = await captureLiveWindowForSession(session, { streamer, mission, windowIndex: currentIndex });
    if (capturedSource) {
      capabilities = capabilitiesForWatchSource({ session, source: capturedSource, streamer });

      // Attach real chat spike data to the source so candidates get real signals
      if (recentSpikes.length > 0) {
        const topSpike = recentSpikes.sort((a, b) => b.messagesPerMinute - a.messagesPerMinute)[0];
        capturedSource._chatSpike = topSpike;
        capturedSource._chatMpm = topSpike.messagesPerMinute;
      }
    }
  }
}
```

---

### Fix 7 — Wire Real Chat Signals into Candidate Scoring

File: `CLIPPING OFFICE/server.js`

In `buildWatchRecordingCandidate()` (or wherever the candidate object is built from
a captured source), replace the hardcoded chatSignals:

Find:
```js
chatSignals: { spike: 130 - index * 16, messagesPerMinute: 130 - index * 16, source: "practice_signal" }
```

Replace with:
```js
chatSignals: source?._chatSpike
  ? {
      spike: source._chatSpike.messagesPerWindow,
      messagesPerMinute: source._chatMpm || source._chatSpike.messagesPerMinute,
      source: "live_irc",
      detectedAt: source._chatSpike.recordedAt
    }
  : { spike: 0, messagesPerMinute: monitor?.currentMessagesPerMinute() || 0, source: "live_irc_baseline" }
```

---

### Fix 8 — Use Official Twitch Clips API for Clip Creation

File: `CLIPPING OFFICE/server.js`

Add a function to create an official Twitch clip when a candidate is accepted.
This requires `TWITCH_USER_ACCESS_TOKEN` with `clips:edit` scope.

```js
async function createOfficialTwitchClip(streamer, { title, hasDelay = false } = {}) {
  if (!config.twitchUserAccessToken) {
    addStateLog("twitch_clip_skipped", "No user access token — local buffer only", { streamerId: streamer.id });
    return null;
  }

  const broadcasterId = streamer.providerUserId || streamer.channelId;
  if (!broadcasterId) return null;

  try {
    const response = await fetch("https://api.twitch.tv/helix/clips", {
      method: "POST",
      headers: {
        "Client-Id": config.twitchClientId,
        "Authorization": `Bearer ${config.twitchUserAccessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ broadcaster_id: broadcasterId, has_delay: hasDelay })
    });

    if (!response.ok) {
      const text = await response.text();
      addStateLog("twitch_clip_failed", `Twitch clip API returned ${response.status}`, { error: text });
      return null;
    }

    const json = await response.json();
    const clip = json.data?.[0];
    if (!clip) return null;

    addStateLog("twitch_clip_created", "Official Twitch clip created", {
      clipId: clip.id,
      editUrl: clip.edit_url,
      streamerId: streamer.id
    });

    return { clipId: clip.id, editUrl: clip.edit_url, downloadUrl: clip.edit_url?.replace("/edit", "") };
  } catch (err) {
    addStateLog("twitch_clip_error", err.message, { streamerId: streamer.id });
    return null;
  }
}
```

Call this in `ensureWatchSessionCandidates()` for the top accepted candidate
that scored above threshold, AFTER the local buffer is captured, as a bonus
(local buffer is the primary, Twitch clip is supplementary):

```js
// After creating candidates, for the top accepted one:
const topCandidate = evaluated.find(c => c.decision === "accepted" && c.score >= 75);
if (topCandidate && isRealApprovedStreamer(streamer)) {
  const twitchClip = await createOfficialTwitchClip(streamer, { title: topCandidate.title });
  if (twitchClip) {
    topCandidate.twitchClipId = twitchClip.clipId;
    topCandidate.twitchClipEditUrl = twitchClip.editUrl;
    topCandidate.measuredEvidence = [
      ...(topCandidate.measuredEvidence || []),
      { label: "Official Twitch Clip created", provenance: PROVENANCE.TWITCH_CLIP, clipId: twitchClip.clipId }
    ];
  }
}
```

---

### Fix 9 — Audio Energy Detection via FFmpeg

File: `CLIPPING OFFICE/services/audio-energy.js` (create this file)

```js
/**
 * audio-energy.js
 * Analyzes a captured video buffer for audio energy peaks.
 * Uses FFmpeg's volumedetect filter.
 * Returns { peakDb, meanDb, isLoud } where isLoud = peakDb > -10dB
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

export async function analyzeAudioEnergy(filePath, ffmpegExecutable = "ffmpeg") {
  try {
    const { stderr } = await execFileAsync(ffmpegExecutable, [
      "-i", filePath,
      "-af", "volumedetect",
      "-vn",
      "-f", "null",
      "/dev/null"
    ], { timeout: 30000 });

    const peakMatch = stderr.match(/max_volume:\s*([-\d.]+)\s*dB/);
    const meanMatch = stderr.match(/mean_volume:\s*([-\d.]+)\s*dB/);

    const peakDb = peakMatch ? parseFloat(peakMatch[1]) : -60;
    const meanDb = meanMatch ? parseFloat(meanMatch[1]) : -60;
    const isLoud = peakDb > -15; // anything above -15dB is considered a loud moment

    return { peakDb, meanDb, isLoud, analyzed: true };
  } catch {
    return { peakDb: -60, meanDb: -60, isLoud: false, analyzed: false };
  }
}
```

Import and use in `captureLiveWindowForSession()` after a successful recording:

```js
// After recordRemoteStreamToFile() succeeds, analyze audio
import { analyzeAudioEnergy } from "./services/audio-energy.js";

const audioAnalysis = await analyzeAudioEnergy(outputPath, ffmpegExecutable);
// Attach to the source so scoring can use it
const source = await createMediaSourceFromFile({
  ...existingArgs,
  audioEnergyDb: audioAnalysis.peakDb,
  isLoudMoment: audioAnalysis.isLoud
});
```

In `evaluateCandidateQuality()`, factor in audio energy:
```js
// If the source has audio energy data, boost the score
const audioBoost = candidate.isLoudMoment ? 10 : 0;
// Add audioBoost to the final score
```

---

## Environment Variables to Add to CLIPPING OFFICE/.env

```
# Live capture tools
STREAMLINK_PATH=streamlink
YTDLP_PATH=yt-dlp
STREAMCLIPPER_CAPTURE_ENABLED=true
STREAMCLIPPER_RECORDING_WINDOW_SECONDS=30
WATCH_TICK_MS=7000

# Twitch user token (for official clip creation — requires clips:edit scope)
# Get this from: https://twitchtokengenerator.com (select clips:edit scope)
TWITCH_USER_ACCESS_TOKEN=
TWITCH_REFRESH_TOKEN=

# Chat spike threshold
CHAT_SPIKE_THRESHOLD=30
CHAT_WINDOW_MS=10000
```

---

## Delivery Checklist

- [ ] `CLIPPING OFFICE/.env` created with all vars from parent `.env` + new vars above
- [ ] `CLIPPING OFFICE/start.sh` created — installs streamlink + yt-dlp, then starts server
- [ ] `package.json` scripts updated to use `start.sh`
- [ ] `"ws": "^8.18.0"` added to dependencies and `npm install` run
- [ ] `saveState()` uses atomic write (tmp file + rename)
- [ ] `PATCH /api/twitch/streamers/:id/approve` endpoint added
- [ ] `services/twitch-chat.js` created with `TwitchChatMonitor` class
- [ ] `services/audio-energy.js` created with `analyzeAudioEnergy` function
- [ ] `chatMonitors` Map added, started in `startWatchWorker`, stopped in `stopWatchWorkerTimer`
- [ ] `chatSpikeLog` Map added, populated from `TwitchChatMonitor.onSpike`
- [ ] Watch worker tick captures on chat spike OR every 120 analyzed seconds baseline
- [ ] `buildWatchRecordingCandidate` uses real `_chatSpike` data instead of hardcoded signals
- [ ] `createOfficialTwitchClip()` function added, called for accepted candidates >= score 75
- [ ] Audio energy analysis runs after each buffer capture
- [ ] `evaluateCandidateQuality` uses `isLoudMoment` boost
- [ ] Server starts without errors after `npm install` + `bash start.sh`
- [ ] Watch session for Jynxzi creates at least one real candidate with `source: "live_irc"` within 2 minutes

---

## How It Works After This Fix

```
Watch session starts
        ↓
TwitchChatMonitor connects to IRC (anonymous, read-only)
        ↓
Every 7 seconds: watch worker ticks
        ↓
  Did chat spike in last 30s?   ←── IRC monitor detects burst
          YES → capture 30s buffer NOW
          NO  → wait (unless 2min baseline window)
        ↓
FFmpeg + streamlink records 30s of live stream to local .mp4
        ↓
Audio energy analyzed → isLoudMoment flag set
        ↓
Candidate created with REAL chat signals (msgs/min from IRC)
        ↓
evaluateCandidateQuality scores it with real signals
        ↓
Score >= 75 → createOfficialTwitchClip() called (if user token set)
        ↓
Candidate appears in Clip Radar with real score + real evidence
        ↓
Operator reviews → packages → CapCut → posts
```

---

*Feed this file to Codex. After running, verify by watching the Logs tab for
`chat_spike_detected` and `source_capture_completed` events during a live stream.*

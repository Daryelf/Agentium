# Codex Prompt — Clip Detection Upgrade
# Argentum Clipping Office · Full implementation of all detection improvements

---

## CONTEXT

This is a Node.js streaming content clipping system located at:
`/Volumes/ZYLO/Argentum/CLIPPING OFFICE/`

The server is a single-file monolith: `server.js` (~5000+ lines, ES modules, `"type": "module"` in package.json).
State is stored in `data/state.json` and saved via `saveState()` (atomic write: `.tmp` then `fs.rename()`).
The main watch loop fires every `WATCH_TICK_MS` (7000ms) in `runWatchWorkerTick(sessionId)`.
Clips are captured via `captureLiveWindowForSession()` which records 30s buffers to `data/watch-buffers/`.
Chat is monitored by `TwitchChatMonitor` class in `services/twitch-chat.js` via anonymous Twitch IRC WebSocket.
Audio is analyzed by `analyzeAudioEnergy()` in `services/audio-energy.js` using FFmpeg `volumedetect`.
The vision gate service already exists at `services/vision-gate.js` and is already imported and wired into `createClipPackageForCandidate()` in server.js — **do not touch that, it's done**.

All imports in server.js use ES module syntax (`import ... from`).
The Anthropic client is already imported: `import Anthropic from "@anthropic-ai/sdk"`.
FFmpeg executable is in variable `ffmpegExecutable`. FFprobe is in `ffprobeExecutable`.
`execFileAsync` is already defined as `promisify(execFile)`.

---

## TASK OVERVIEW

Implement ALL of the following improvements in order. Do not skip any. Do not stop early.

---

## TASK 1 — Whisper Transcription Service

**File to create:** `services/whisper-service.js`

This service runs OpenAI Whisper on captured 30s video buffers to transcribe what the streamer said, then scores the transcript for clip-worthiness.

### Requirements:

1. Export async function `transcribeBuffer(filePath, opts = {})` that:
   - First extracts audio-only from the video using FFmpeg:
     ```
     ffmpeg -i input.mp4 -vn -ac 1 -ar 16000 -f wav /tmp/whisper-XXX.wav
     ```
     (mono 16kHz WAV is what Whisper expects)
   - Then runs Whisper CLI: `whisper /tmp/whisper-XXX.wav --model base --output_format json --output_dir /tmp/whisper-out-XXX/`
   - Parses the output JSON file (Whisper writes `filename.json` to the output dir)
   - Cleans up the temp files
   - Returns `{ text, segments, words, available: true }` or `{ available: false, error }` if Whisper is not installed

2. Export function `scoreTranscript(transcriptResult)` that analyzes the text and returns:
   ```js
   {
     transcriptScore: 0-30,     // contribution to clip score
     hypeHits: number,          // count of hype keyword matches
     silenceBeforeBurst: bool,  // 2+ second gap then words-per-second doubles
     speechRate: number,        // average words per second overall
     peakSpeechRate: number,    // peak words per second in any 5s window
     detectedKeywords: string[] // which hype words were found
   }
   ```
   
   Hype keyword list to check (case-insensitive):
   ```
   "let's go", "lets go", "no way", "what", "insane", "bro", "oh my god", 
   "omg", "clutch", "are you kidding", "holy", "what the", "impossible",
   "no no no", "yes yes", "let's go let's go", "i can't believe",
   "that's crazy", "are you serious", "get out", "unbelievable"
   ```
   
   Scoring rules:
   - +5 per hype keyword hit (max +20)
   - +5 if `silenceBeforeBurst` is true (dead air then explosion = perfect clip arc)
   - +5 if `peakSpeechRate > 3.5` words/second (fast excited speech)
   - Score capped at 30

3. Export function `isWhisperAvailable()` — runs `whisper --version` and returns true/false. Cache the result (check once per process start).

4. **Silence before burst detection:** Look at Whisper's `segments` array. Each segment has `start`, `end`, `text`. Find any gap > 2 seconds between segment end and next segment start. If the segment after the gap has `text.split(' ').length / (segment.end - segment.start) > 3.0` words/second, `silenceBeforeBurst = true`.

### Integration into server.js:

After `import { analyzeAudioEnergy } from "./services/audio-energy.js";` add:
```js
import { transcribeBuffer, scoreTranscript, isWhisperAvailable } from "./services/whisper-service.js";
```

In `maybeCaptureCurrentWatchWindow()` — after `captureLiveWindowForSession()` returns a source and the source has a `filePath`, add a transcription step:
```js
if (source?.filePath && await isWhisperAvailable()) {
  const transcriptResult = await transcribeBuffer(source.filePath).catch(() => ({ available: false }));
  if (transcriptResult.available) {
    const transcriptScoring = scoreTranscript(transcriptResult);
    source.transcriptScore = transcriptScoring.transcriptScore;
    source.transcriptSummary = {
      text: transcriptResult.text?.slice(0, 300),
      hypeHits: transcriptScoring.hypeHits,
      silenceBeforeBurst: transcriptScoring.silenceBeforeBurst,
      peakSpeechRate: transcriptScoring.peakSpeechRate,
      detectedKeywords: transcriptScoring.detectedKeywords,
    };
  }
}
```

Then in `scoreClipMoment()` (or wherever `hookScore` is computed for live candidates around line 2270), incorporate `transcriptScore`:
```js
const transcriptBonus = Number(source?.transcriptScore || candidate?.transcriptScore || 0);
const hookScore = Math.min(20, 10 
  + (chatSignals.messagesPerMinute >= 60 ? 5 : 0) 
  + (audioEnergy?.isLoudMoment ? 4 : 0)
  + Math.round(transcriptBonus / 6)  // up to +5 from transcript
);
```

Also store `transcriptSummary` on the candidate so it shows in the UI.

---

## TASK 2 — Emote Velocity Tracking in TwitchChatMonitor

**File to edit:** `services/twitch-chat.js`

The current implementation counts raw message volume but ignores emote content. Twitch IRC sends emotes in the `@emotes=` tag on each PRIVMSG line. We need to:

1. **Parse the full IRC tag line** to extract which emotes appeared in a message. The tag format is:
   ```
   @badge-info=...;emotes=25:0-4/81274:6-10;... PRIVMSG #channel :PogChamp Pog hello
   ```
   The `emotes=` field has format `emoteId:startPos-endPos/emoteId:startPos-endPos`. We only need the emote IDs.

2. **Classify emotes into buckets:**
   ```js
   const EMOTE_BUCKETS = {
     tension: ['PauseChamp', 'monkaS', 'monkaGIGA', 'widepeepoSad', 'NOTED', 'monkaHmm', 'pepeHands'],
     hype:    ['Pog', 'PogChamp', 'POGGERS', 'EZ', 'Clap', 'HYPERS', 'PogU', 'FeelsGoodMan'],
     comedy:  ['OMEGALUL', 'LUL', 'KEKW', 'LULW', 'pepeLaugh', 'GIGACHAD'],
   };
   ```
   Note: Twitch's built-in emote IDs are numbers (25 = Kappa, 1902 = Keepo, etc.), but we can't map those from the ID alone. Match by **message text** instead — scan the message text for the emote names in `EMOTE_BUCKETS`. This is simpler and works for BetterTTV/FFZ emotes which appear as plain text anyway.

3. **Add to the constructor:**
   ```js
   this.emoteWindows = { tension: [], hype: [], comedy: [] };
   this.onTension = opts.onTension || (() => {});
   this.tensionCooldownMs = opts.tensionCooldownMs || 30000;
   this.lastTensionAt = 0;
   this.tensionSpikeThreshold = opts.tensionSpikeThreshold || 8; // tension emotes per window
   ```

4. **In `handleLine()`**, after parsing the message text:
   ```js
   const emoteBucket = classifyMessageEmotes(message); // returns 'tension' | 'hype' | 'comedy' | null
   if (emoteBucket) {
     this.emoteWindows[emoteBucket].push(timestamp);
   }
   this.pruneEmoteWindows(timestamp);
   
   // Fire tension callback if tension emotes spike (BEFORE the hype peaks — this is predictive)
   const tensionCount = this.emoteWindows.tension.length;
   const tensionCooldownReady = timestamp - this.lastTensionAt >= this.tensionCooldownMs;
   if (tensionCount >= this.tensionSpikeThreshold && tensionCooldownReady) {
     this.lastTensionAt = timestamp;
     this.onTension({
       channel: this.channelName,
       tensionCount,
       messagesPerMinute: this.currentMessagesPerMinute(),
       timestamp,
       message: 'Tension emote spike detected — moment may be building'
     });
   }
   ```

5. **Add `pruneEmoteWindows(timestamp)`:**
   ```js
   pruneEmoteWindows(timestamp) {
     const cutoff = timestamp - this.windowMs;
     for (const bucket of Object.keys(this.emoteWindows)) {
       this.emoteWindows[bucket] = this.emoteWindows[bucket].filter(t => t >= cutoff);
     }
   }
   ```

6. **Add `currentEmoteDistribution()`** method that returns:
   ```js
   { tension: count, hype: count, comedy: count, dominant: 'tension'|'hype'|'comedy'|'mixed'|'none' }
   ```

7. **Export `classifyMessageEmotes(text)`** as a named export (not a class method) so it can be tested independently.

### Integration into server.js:

In `startChatMonitorForSession()` (wherever `TwitchChatMonitor` is instantiated), add the `onTension` callback:
```js
onTension: (tensionPayload) => {
  // Store tension signal on the session so the next tick knows to pre-capture
  const sess = state.watchSessions.find(s => s.id === sessionId);
  if (sess) {
    sess.tensionDetectedAt = tensionPayload.timestamp;
    sess.tensionPayload = tensionPayload;
  }
  appendWatchEvent(sessionId, 'tension_emote_spike', tensionPayload).catch(() => {});
  // Also broadcast to SSE clients so the UI can show it
  broadcastToSession(sessionId, { type: 'tension_detected', payload: tensionPayload });
}
```

In `runWatchWorkerTick()`, when deciding whether to capture, check for recent tension signal:
```js
const recentTension = sess.tensionDetectedAt && (Date.now() - new Date(sess.tensionDetectedAt).getTime()) < 45000;
if (recentTension) {
  // Tension was detected in the last 45s — force capture this window regardless of other thresholds
  session.lastCaptureTrigger = 'tension_emote_prediction';
}
```

---

## TASK 3 — Voice Frequency Separation in Audio Analysis

**File to edit:** `services/audio-energy.js`

The current `volumedetect` runs on the full audio mix (game sounds + streamer voice). We need to add a second FFmpeg pass that isolates the human voice frequency band (300Hz–3400Hz) and measures energy there separately. A spike in the voice band without a corresponding spike in the full mix = the streamer is excited but the game is quiet = high-value clip.

**Update `analyzeAudioEnergy(filePath, ffmpegExecutable)`** to run TWO passes:

Pass 1 (existing — keep it): full mix volumedetect.

Pass 2 (new — add after pass 1): bandpass filter targeting voice frequencies:
```
ffmpeg -hide_banner -i filePath -af "bandpass=f=1000:width_type=h:w=2700,volumedetect" -vn -sn -dn -f null -
```

Return the combined result:
```js
return {
  available: true,
  meanVolumeDb,          // existing — full mix mean
  maxVolumeDb,           // existing — full mix peak
  isLoudMoment,          // existing — full mix peak >= -8dB
  voiceMeanDb,           // NEW — bandpass mean
  voicePeakDb,           // NEW — bandpass peak
  isVoiceExcited,        // NEW — voicePeakDb >= -12dB (voice is louder than typical)
  voiceOverGameRatio,    // NEW — difference: voicePeakDb - maxVolumeDb (positive = voice dominates)
  source: "ffmpeg_volumedetect_v2"
};
```

`isVoiceExcited` threshold: `voicePeakDb >= -12`. This is calibrated for a streamer yelling vs. normal speech (normal speech peaks around -18 to -14dB in the voice band; screaming/excitement hits -12 or above).

Run pass 2 in parallel with pass 1 using `Promise.all` for speed. If pass 2 fails, still return the pass 1 results with `isVoiceExcited: false`.

---

## TASK 4 — Twitch EventSub Hard Triggers

**File to edit:** `server.js`

Twitch EventSub sends webhooks when real streamer events happen (raids, gifted subs, big cheers, prediction resolutions). These events are almost always worth clipping. We need to:

1. **Add a webhook endpoint** `POST /api/twitch/eventsub` to server.js routing.

   The endpoint must:
   - Verify the `Twitch-Eventsub-Message-Signature` header (HMAC-SHA256 of `message-id + message-timestamp + raw body` using the webhook secret from `process.env.TWITCH_EVENTSUB_SECRET`). Reject if invalid.
   - Handle `challenge` verification requests (Twitch sends these when you first subscribe): return the `challenge` value as plain text.
   - Handle notification events of these types:
     - `channel.raid`
     - `channel.subscription.gift`
     - `channel.cheer`
     - `channel.prediction.end`
     - `channel.poll.end`
   - For each event, find the active watch session for that channel and call `triggerEventSubCapture(session, streamer, eventType, eventData)`.

2. **Add `triggerEventSubCapture(session, streamer, eventType, eventData)` function:**
   - Immediately call `captureLiveWindowForSession()` with `watchTrigger: 'eventsub_' + eventType`
   - Log the event to `appendWatchEvent`
   - Emit SSE event `eventsub_trigger` to the client
   - Store on session: `session.lastEventSubTrigger = { type: eventType, at: now(), data: eventData }`

3. **Add `subscribeToEventSub(streamer)` function:**
   - Only call if `process.env.TWITCH_EVENTSUB_SECRET` is set AND streamer is approved AND streamer.platform === 'twitch'
   - Uses Twitch Helix `POST /helix/eventsub/subscriptions` with app access token
   - Subscribes to all 5 event types listed above for that streamer's broadcaster_id
   - Store subscription IDs on the streamer object: `streamer.eventSubSubscriptions = [...]`
   - Skip (log only) if already subscribed

4. **Call `subscribeToEventSub(streamer)`** inside `startWatchWorker(sessionId)` after the chat monitor is started, if mode is "real".

5. **Add `POST /api/twitch/eventsub/subscribe` route** that lets the operator manually trigger subscription for a streamer by ID. Body: `{ streamerId }`. Returns the subscription result.

6. **Add cleanup:** in `stopWatchSession()` or wherever the watch session ends, call `unsubscribeEventSub(streamer)` that deletes all subscriptions for that streamer via `DELETE /helix/eventsub/subscriptions?id=XXX`.

**Add to `.env.example`:**
```
TWITCH_EVENTSUB_SECRET=your_webhook_secret_here
TWITCH_EVENTSUB_CALLBACK_URL=https://your-public-url.com/api/twitch/eventsub
```

**Important notes:**
- EventSub requires a publicly accessible HTTPS callback URL. The system should log a warning if `TWITCH_EVENTSUB_CALLBACK_URL` is not set and skip subscription silently.
- Use the existing `getTwitchAppAccessToken()` or equivalent function already in server.js for the Helix auth header.
- All EventSub subscription calls go through Human Gate gate-keeping only if the streamer hasn't been approved — if the streamer is already `permissionStatus: 'approved'`, subscribe automatically.

---

## TASK 5 — Per-Streamer Clip Profile

**File to edit:** `server.js` and routing

Add a `clipProfile` object to each streamer in state (schema addition, non-breaking):

```js
// Default clip profile shape — add to new streamers and backfill existing ones lazily
const DEFAULT_CLIP_PROFILE = {
  genre: 'general',            // 'fps', 'moba', 'variety', 'irl', 'podcast', 'general'
  chatSpikeThreshold: 30,      // override TwitchChatMonitor spikeThreshold
  audioThresholdDb: -8,        // override isLoudMoment threshold
  tensionSpikeThreshold: 8,    // override tension emote spike threshold
  emoteWeights: {},            // { 'Pog': 1.5, 'KEKW': 0.5 } — multiply emote count contribution
  goldenHours: [],             // [20, 21, 22, 23] UTC hours when streamer peaks
  minClipScore: 80,            // override mission.minQualityScore for this streamer
  clipHistory: {               // updated automatically as clips are created
    totalCreated: 0,
    avgScoreAccepted: 0,
    lastClipAt: null
  }
};
```

1. **In `startChatMonitorForSession()`** — when constructing `TwitchChatMonitor`, read `streamer.clipProfile.chatSpikeThreshold` and `streamer.clipProfile.tensionSpikeThreshold` and pass them as constructor options. Fall back to defaults if not set.

2. **In `evaluateCandidateQuality()`** — if the candidate's streamer has a `clipProfile.minClipScore`, use that as the `acceptThreshold` instead of `mission.minQualityScore`.

3. **In `analyzeAudioEnergy()` integration** — when checking `isLoudMoment`, use `streamer.clipProfile.audioThresholdDb` if set, otherwise default `-8`.

4. **Add route `PATCH /api/twitch/streamers/:id/clip-profile`** — body is a partial `clipProfile` object. Merge into `streamer.clipProfile` and save state. This is how the operator tunes each streamer.

5. **Auto-update `clipHistory`** in `createClipPackageForCandidate()` — after a clip package is successfully created:
   ```js
   if (streamer?.clipProfile) {
     streamer.clipProfile.clipHistory.totalCreated++;
     streamer.clipProfile.clipHistory.lastClipAt = now();
   }
   ```

6. **Add `genre` detection heuristic** — when a streamer is added or updated, check `streamer.currentGame` (from Twitch API) and set `clipProfile.genre` automatically:
   - If game contains "Warzone", "Valorant", "CS", "Apex", "Fortnite", "R6" → `'fps'`
   - If game contains "League", "Dota", "SMITE", "Arena" → `'moba'`
   - If game contains "IRL" or category is "Just Chatting" → `'irl'`
   - Otherwise → `'general'`

---

## TASK 6 — Cross-Stream Correlation

**File to edit:** `server.js`

When multiple watched streamers all have chat spikes within a short window of each other, it usually means an external event (tournament result, patch announcement, game-wide moment). Those moments should be boosted.

1. **Add function `detectCrossStreamEvent()`** that:
   - Looks at all active watch sessions (not paused, not terminal)
   - Finds sessions where `session.lastChatSpikeAt` is within the last 90 seconds
   - If 3 or more sessions qualify → it's a cross-stream event
   - Returns `{ isCrossStreamEvent: boolean, affectedSessionIds: string[], sessionCount: number }`

2. **Call `detectCrossStreamEvent()` inside `runWatchWorkerTick()`** after the chat spike check. If a cross-stream event is detected:
   - Boost the current session's candidate score by adding a signal: `candidate.crossStreamBoost = true`
   - Add to `candidate.measuredEvidence`: `{ type: 'cross_stream_event', sessionCount, affectedChannels }`
   - Log an event `cross_stream_event_detected` with the session IDs

3. **In `scoreClipMoment()`** or `evaluateCandidateQuality()**, check `candidate.crossStreamBoost`:
   ```js
   if (candidate.crossStreamBoost) {
     score = Math.min(100, score + 10); // cross-stream events are almost always worth clipping
   }
   ```

4. **Broadcast SSE event `cross_stream_event`** to all active SSE clients so the UI can display a banner: "Multiple streamers spiking — external event detected".

---

## TASK 7 — Update `evaluateCandidateQuality()` to Use All New Signals

**File to edit:** `server.js`, function `evaluateCandidateQuality()` at line 1507.

Update `scoreBreakdown` to include all new signals:

```js
scoreBreakdown: {
  hookStrength: scored.hookScore,
  engagementPotential: scored.engagementPotential,
  retentionPotential: scored.retentionPotential,
  riskScore: scored.riskScore,
  evidenceCount,
  hasPlayableEvidence,
  hasCompleteMoment,
  // NEW fields:
  transcriptScore: candidate.transcriptScore || 0,
  transcriptKeywords: candidate.transcriptSummary?.detectedKeywords || [],
  silenceBeforeBurst: candidate.transcriptSummary?.silenceBeforeBurst || false,
  isVoiceExcited: candidate.audioEnergy?.isVoiceExcited || false,
  emoteDistribution: candidate.emoteDistribution || null,
  crossStreamBoost: candidate.crossStreamBoost || false,
  visionGate: candidate.visionGate || null,
  clipProfile: { genre: streamer?.clipProfile?.genre || 'general' }
}
```

Also update `decisionReason` to mention the top-contributing signals. For example: `"Accepted: voice excited, transcript hype keywords detected (let's go, insane), chat spike 87/min, vision gate: clutch"`.

---

## TASK 8 — Store `emoteDistribution` on Candidates

When a candidate is created from a watch window (in `maybeCaptureCurrentWatchWindow()` or wherever candidates are assembled from live sources), pull the current emote distribution from the active `TwitchChatMonitor` for that session and store it on the candidate:

```js
const monitor = chatMonitors.get(session.id); // or however monitors are stored
if (monitor) {
  candidate.emoteDistribution = monitor.currentEmoteDistribution();
}
```

Add `emoteDistribution` to the candidate score contribution: if `emoteDistribution.dominant === 'hype'`, add +5 to the hook score. If `dominant === 'tension'` (moment was building), add +3.

---

## FILE SUMMARY — What Codex Must Create or Edit

### Create (new files):
- `services/whisper-service.js` — Task 1

### Edit (existing files):
- `services/twitch-chat.js` — Task 2 (emote velocity)
- `services/audio-energy.js` — Task 3 (voice frequency band)
- `server.js` — Tasks 1, 2, 3, 4, 5, 6, 7, 8 (imports, wiring, new functions, new routes)

### Do NOT touch (already done):
- `services/vision-gate.js` — already created and wired in
- `services/capcut-runner.js` — unrelated
- `services/browser-workspace.js` — unrelated
- `public/` — no frontend changes needed for this task

---

## SAFETY RULES (enforce throughout)

- Real mode / practice mode separation must remain intact. All new capture triggers only fire when `session.mode === 'real'` and `isRealApprovedStreamer(streamer)` returns true.
- `saveState()` must always use the existing atomic write pattern (write to `.tmp` then `fs.rename()`). Never call `fs.writeFile()` directly on `data/state.json`.
- No API keys or secrets in state.json or logs. The `TWITCH_EVENTSUB_SECRET` must only live in env vars.
- If any external service (Whisper, EventSub, Anthropic) is unavailable, log a warning and continue — never throw an unhandled error that crashes the watch worker.
- Human Gate is not required for read-only detection improvements. It IS required for any action that posts content, contacts external services on behalf of the operator, or modifies approved streamer lists.
- All new functions must be added in the logical section of server.js where they belong (detection functions near other detection functions, routes near other routes, etc.) — do not append everything to the bottom.

---

## ENVIRONMENT VARIABLES to add to `.env.example`

```
# Whisper transcription (optional — install whisper CLI: pip install openai-whisper)
WHISPER_MODEL=base

# Twitch EventSub webhooks (optional — requires public HTTPS URL)
TWITCH_EVENTSUB_SECRET=your_random_secret_here_min_10_chars
TWITCH_EVENTSUB_CALLBACK_URL=https://your-public-url.ngrok.io/api/twitch/eventsub
```

---

## VERIFICATION CHECKLIST

Before finishing, verify:

- [ ] `services/whisper-service.js` exists and exports `transcribeBuffer`, `scoreTranscript`, `isWhisperAvailable`
- [ ] `services/twitch-chat.js` exports `TwitchChatMonitor` with `onTension` callback and `currentEmoteDistribution()` method
- [ ] `services/audio-energy.js` returns `isVoiceExcited`, `voicePeakDb`, `voiceMeanDb` in its result
- [ ] `server.js` imports all three new/updated services
- [ ] `POST /api/twitch/eventsub` route exists with signature verification
- [ ] `POST /api/twitch/eventsub/subscribe` route exists
- [ ] `PATCH /api/twitch/streamers/:id/clip-profile` route exists
- [ ] `evaluateCandidateQuality()` scoreBreakdown includes all new fields
- [ ] `runWatchWorkerTick()` checks for tension signal and forces capture
- [ ] `detectCrossStreamEvent()` function exists and is called in the tick
- [ ] `.env.example` has the two new variables
- [ ] `node server.js` starts without errors with existing `.env` (all new features are opt-in via env vars)
- [ ] No `fs.writeFile()` calls added directly to `data/state.json`
- [ ] No hardcoded API keys anywhere

Do not stop until every checkbox above passes.

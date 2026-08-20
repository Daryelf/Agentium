# Clip Detection Strategy — Master Engineering Brief
**Argentum Clipping Office · Head of AI + Head of Clipping**
**Date: 2026-06-29**

---

## The Core Problem With Current Detection

Right now the system works like this: watch a 30-second window → if chat hit ≥30 msgs or audio peak > -15dB, flag it. That's a motion detector. We need a moment detector. A motion detector fires whenever anything moves. A moment detector knows the difference between a streamer adjusting their mic and a 1v4 clutch.

Here's the upgrade path — ranked by impact.

---

## Tier 1: High Impact, Build First

### 1. Whisper Speech Transcription on Every Buffer

This is the single highest-signal thing you're not doing. Run OpenAI Whisper (or `whisper.cpp` locally — free, fast) on every 30s buffer before evaluating it. Then score based on what was actually said.

**Instant triggers from transcript:**
- Screaming/repeating words: "LET'S GO LET'S GO LET'S GO" → viral
- "No way", "what?!", "bro", "are you kidding" → reaction moment
- Profanity spike (sudden cluster vs. normal baseline) → hype moment
- Whispering → shouting → whispering pattern = tension + release = perfect clip arc
- **Dead air (< 2 words in 5 seconds) followed by an outburst** = best predictor of a hype moment. The silence IS the setup.

Add a `transcriptScore` to `evaluateCandidateQuality()`. Weight it 40% of the final score.

```js
// services/whisper-service.js
async function transcribeBuffer(filePath) {
  const result = await execa('whisper', [filePath, '--model', 'base', '--output_format', 'json']);
  return JSON.parse(result.stdout);
}

function scoreTranscript(transcript) {
  const text = transcript.text.toLowerCase();
  const hypeWords = ['let\'s go', 'no way', 'insane', 'what', 'bro', 'oh my god', 'clutch'];
  const hypeHits = hypeWords.filter(w => text.includes(w)).length;
  // Detect silence gap followed by burst
  const silenceBeforeBurst = detectSilencePattern(transcript.segments);
  return { hypeHits, silenceBeforeBurst, text };
}
```

---

### 2. Emote Velocity Tracking (Twitch-specific, this is huge)

You're already connected to Twitch IRC. You're counting raw message volume. You're leaving the most important signal on the floor: **which emotes are being spammed and how fast the emote MIX is shifting.**

Different emote clusters = different clip types:
- `PogChamp` / `Pog` / `HYPERPOG` → genuine hype, play-worthy moment
- `OMEGALUL` / `LUL` / `KEKW` → funny fail, comedy clip
- `PauseChamp` / `monkaS` / `widepeepoSad` → tension building (clip the next 10 seconds)
- `EZ` / `Clap` → win/clutch
- `WutFace` / `PogO` → cringe/unexpected

When `PauseChamp` spikes → start a capture immediately and hold it for 15 more seconds. That's where the actual moment lands.

**This is outside-the-box because:** most clipping tools only look backward at a spike that already happened. Tracking `monkaS` or `PauseChamp` lets you predict the spike 10-15 seconds before it hits.

```js
// In TwitchChatMonitor — extend the message handler
const TENSION_EMOTES = ['PauseChamp', 'monkaS', 'widepeepoSad', 'NOTED'];
const HYPE_EMOTES = ['Pog', 'PogChamp', 'POGGERS', 'EZ', 'Clap', 'PauseChamp'];
const COMEDY_EMOTES = ['OMEGALUL', 'LUL', 'KEKW', 'LULW'];

function classifyMessage(text) {
  const emotes = extractEmotes(text); // parse Twitch emote tags
  const hasTension = emotes.some(e => TENSION_EMOTES.includes(e));
  const hasHype = emotes.some(e => HYPE_EMOTES.includes(e));
  return { hasTension, hasHype, emoteType: hasHype ? 'hype' : hasTension ? 'tension' : 'neutral' };
}
```

---

### 3. Voice Pitch + Energy Separation (streamer mic vs. game audio)

Right now `audio-energy.js` runs `volumedetect` on the whole mix. The game is loud. Explosions are loud. That's noise. What you want is the **streamer's voice channel specifically**.

FFmpeg can separate frequency bands. Human speech sits in 300Hz–3400Hz. Game audio has massive bass and high-end. 

**What to detect:**
- Streamer voice energy spike (pitch going up = excitement)
- Sudden silence on the mic (streamer went quiet in shock)
- Voice + game audio both peaking simultaneously = the real moment
- Rapid speech rate (words-per-second from Whisper) → excitement

```bash
# Band-pass filter for voice only (300Hz–3.4kHz)
ffmpeg -i input.mp4 -af "bandpass=f=1000:width_type=h:w=2700,volumedetect" -f null -
```

Add `voiceEnergyPeak` and `voicePitchEstimate` to the scoring model. This eliminates ~60% of false positives from games with loud sound effects.

---

### 4. Predictive Pre-Capture (clip the buildup, not just the peak)

This is the single biggest architectural change that makes everything better.

**Current flow:** spike detected → look back at 30s buffer → extract clip
**Problem:** you're always clipping AFTER the moment. The best part (the buildup) gets cut off.

**Fix:** when tension signals appear (`monkaS` spike, voice goes quiet, Whisper detects a question like "can he do it?"), **immediately start a dedicated high-quality capture** and hold it open for 45 seconds. You're capturing the setup + the moment + the reaction.

```js
// Add to runWatchWorkerTick()
if (tensionDetected(chatSignals)) {
  // Open a "golden window" — capture starts NOW
  openGoldenWindowCapture(session, { reason: 'tension_buildup', holdSecs: 45 });
}

// If the moment happens within those 45s → golden capture includes the full arc
// If nothing happens → discard the buffer, no clip
```

This is how pro clipping editors think: you start rolling when you feel something coming, not after it peaks.

---

### 5. Claude Vision Analysis on Keyframes

For every candidate clip, extract 4-6 keyframes (FFmpeg `-vframes 6`) and send them to Claude's vision API with a structured prompt. This costs ~$0.01 per clip and eliminates bad clips at the final gate.

```js
async function analyzeClipFrames(clipPath) {
  const frames = await extractKeyframes(clipPath, 6);
  const response = await claude.messages.create({
    model: 'claude-haiku-4-5',  // fast + cheap for this
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: [
        ...frames.map(f => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: f } })),
        { type: 'text', text: `These are keyframes from a live stream clip. Rate this clip 1-10 for:
          - Visual interest (something happening vs. dead screen)
          - Emotional intensity (calm vs. intense)
          - Context clarity (viewer can understand what's happening)
          Reply with JSON: {"visualScore": 0-10, "emotionScore": 0-10, "contextScore": 0-10, "clipType": "clutch|fail|reaction|talk|nothing", "shouldClip": true|false}` }
      ]
    }]
  });
  return JSON.parse(response.content[0].text);
}
```

Gate: if Claude says `shouldClip: false` → don't create the clip. This alone kills "nothing happened" clips.

---

## Tier 2: Medium Impact, Build Second

### 6. Streamer Persona Model (per-streamer scoring weights)

Not all streamers clip the same way. A FPS player clips differently than a variety streamer. Build a per-streamer config:

```json
{
  "streamerId": "jynxzi",
  "clipProfile": {
    "genre": "fps",
    "clipTriggers": {
      "chatSpikeThreshold": 25,   // lower threshold — he's very reactive
      "audioThreshold_db": -18,   // lower — he screams a lot
      "emoteWeights": { "Pog": 2.0, "KEKW": 0.5 }  // hype clips over comedy
    },
    "goldenHours": [20, 21, 22, 23],  // peak hours from historical data
    "avgClipRate": 3.2               // clips per stream hour — baseline
  }
}
```

This is learned over time as the system sees which candidates actually become good clips.

---

### 7. Cross-Stream Correlation

If you're watching 5 streamers and 3 of them have chat spikes within 2 minutes of each other → something external happened (patch dropped, game-wide event, tournament moment). That's high-priority clip territory for all of them simultaneously.

```js
// In runWatchWorkerTick — check all active sessions
function detectCrossStreamEvent(sessions) {
  const recentSpikes = sessions.filter(s => 
    s.lastChatSpikeAt && (Date.now() - s.lastChatSpikeAt) < 120_000
  );
  if (recentSpikes.length >= 3) {
    recentSpikes.forEach(s => boostCandidateScore(s, 'cross_stream_event'));
  }
}
```

---

### 8. Twitch API Events as Hard Triggers

The Twitch EventSub API gives you real-time events that are almost always clipworthy:
- `channel.subscription.gift` — someone gifted 50 subs → guaranteed reaction
- `channel.cheer` — someone cheered 10,000 bits → guaranteed reaction  
- `channel.raid` — a raid is happening → guaranteed high energy
- `channel.prediction.end` — prediction resolved → streamer reacts to outcome
- `channel.poll.end` — poll result revealed

Wire these via EventSub webhooks. When any of these fire for a watched streamer, **immediately trigger a capture** regardless of chat/audio signals. These are free confirmed moments.

```js
// EventSub webhook handler
app.post('/api/twitch/eventsub', async (req, res) => {
  const { type, event } = req.body.subscription;
  if (['channel.subscription.gift', 'channel.cheer', 'channel.raid'].includes(type)) {
    const session = getWatchSessionForChannel(event.broadcaster_user_id);
    if (session) await triggerEmergencyCapture(session, { reason: type, event });
  }
});
```

---

### 9. Performance Feedback Loop

Every clip that gets posted should report back its performance: views, likes, shares, watch time. That data trains the scoring model.

```json
{
  "clipId": "clip_abc123",
  "source": { "chatSpike": 87, "audioDb": -12, "transcriptHype": 3 },
  "posted": { "platform": "tiktok", "views": 142000, "shares": 8200 },
  "outcome": "viral"
}
```

After 50 clips, you have a dataset. Run a simple logistic regression (or just weight the features that correlated with viral clips). The system gets better every week without you touching code.

---

### 10. Donation Alert Sound Fingerprinting

Most streamers use StreamElements or Streamlabs. The donation alert sound is the same across thousands of streamers. Use audio fingerprinting to detect when a donation alert plays → that means a notable donation just happened → streamer is about to react.

This is outside the box: you're detecting the content delivery mechanism (the alert sound), not the content itself. The alert plays before the streamer even speaks.

```js
// services/alert-detector.js
// Pre-generate fingerprint of common alert sounds
// Run cross-correlation against live buffer
async function detectAlertSound(bufferPath) {
  const fingerprints = await loadAlertFingerprints(); // SE/Streamlabs alert sounds
  return await crossCorrelateAudio(bufferPath, fingerprints);
}
```

---

## Tier 3: Advanced / Future

### 11. Virality Predictor (pre-post scoring)

Before posting a clip, score it against what's currently trending on TikTok/YouTube Shorts. If the clip is:
- A game that's trending in the last 48 hours → boost score
- A reaction to a meme that's currently viral → massive boost
- A moment that matches the format of currently-performing clips → higher post priority

The question isn't just "was this a good moment" — it's "will this clip do well TODAY given the current algorithm."

---

### 12. Temporal Arc Detection

A great clip has three parts: setup → peak → resolution. The current system grabs a flat 30-second window. That's not how good clips are cut.

Use Whisper segment timing + audio energy curve to find the natural arc:
- Where does tension start building? (start point)
- Where does the peak hit? (midpoint)
- Where does the reaction complete? (end point)

Then cut the clip at those natural points instead of at fixed 30-second walls. A clip that's 23 seconds with a perfect arc beats a 30-second clip where the first 8 seconds are dead.

---

### 13. Competitor Clip Analysis

Periodically pull the top-performing clips from the same streamer (via Twitch Clips API — it's free and doesn't require OAuth for public clips). Analyze what made those clips go viral. Use Claude to summarize the pattern:

```
"Top 10 clips from Jynxzi this month: 7/10 are 1v3+ situations in the first 2 minutes of a round, 8/10 have a screaming moment within 5 seconds of the kill. Pattern: early-round underdog clutch."
```

Feed this pattern back into the scoring weights for that specific streamer.

---

## Priority Build Order

| # | Feature | Impact | Effort | Ship |
|---|---|---|---|---|
| 1 | Whisper transcription scoring | 🔴 Critical | Medium | Week 1 |
| 2 | Emote velocity + emote type classification | 🔴 Critical | Low | Week 1 |
| 3 | Predictive pre-capture (tension trigger) | 🔴 Critical | Medium | Week 1 |
| 4 | Claude vision keyframe gate | 🟠 High | Low | Week 1 |
| 5 | Voice frequency separation in FFmpeg | 🟠 High | Low | Week 2 |
| 6 | Twitch EventSub hard triggers | 🟠 High | Medium | Week 2 |
| 7 | Per-streamer persona model | 🟡 Medium | Medium | Week 3 |
| 8 | Cross-stream correlation | 🟡 Medium | Low | Week 3 |
| 9 | Performance feedback loop | 🟡 Medium | High | Week 4 |
| 10 | Donation alert fingerprinting | 🟢 Boost | High | Future |
| 11 | Temporal arc detection | 🟢 Boost | High | Future |
| 12 | Competitor clip analysis | 🟢 Boost | Medium | Future |
| 13 | Virality predictor | 🟢 Boost | High | Future |

---

## The Golden Rule

Stop thinking about clip detection as "catch the spike." Start thinking about it as **narrative arc identification**. 

The clips that go viral always have:
1. A setup (viewer has context / tension is building)
2. A peak (the thing happens)
3. A reaction (the streamer / chat loses it)

Your system's job is to find all three parts and cut at the right seams. Everything in Tier 1 above is about getting better at identifying where in the narrative arc you are right now — not just whether the moment happened.

The silence before the scream is part of the clip. Build the system to feel it coming.

---

*Save this to: `CLIP_DETECTION_STRATEGY.md` — Reference when building. Link in [[Argentum_Master]].*

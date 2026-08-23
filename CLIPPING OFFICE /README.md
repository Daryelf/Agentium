# StreamClipper Agent

StreamClipper Agent is a standalone, supervised clipping automation product. It monitors approved streamer sources, scores clip moments, creates 9:16 short-form packages, prepares CapCut handoffs, drafts captions for TikTok/Reels/Shorts, and routes risky actions through Human Gate.

## Live moment intelligence

Real watch sessions keep a bounded local rolling media memory by default. FFmpeg stores short transport-stream segments for up to 180 seconds, and a qualifying signal can recover roughly the previous 135 seconds instead of beginning after chat reacts. Continuous observation evaluates completed watch windows from speech, audio dynamics, denser visual chronology, human-interest cues, emerging multi-author chat phrases, and ordinary chat velocity. Generic hype is corroboration only; it cannot prove clip quality by itself. Full AI review cadence scales from 30 to 120 seconds as the active watch pool grows, while chat, emerging-topic, tension, and EventSub triggers remain immediate; the longer rolling memory keeps the skipped interval recoverable.

The admission pipeline first transcribes the remembered window, identifies setup and payoff language, and recommends clip boundaries from timed speech. When the content prefilter finds a plausible moment, vision AI reviews nine chronological frames and may refine the hook, payoff, start, and end. The full rolling window remains source evidence while the candidate points to the narrower human-readable moment. Storage is bounded, duplicate windows are removed, weak moments are filtered, and publishing still requires Human Gate approval.

## Safety posture

- Draft-only posting.
- No public posting or uploads without Human Gate approval.
- No raw social passwords.
- No frontend API keys.
- Twitch and Kick live-check architecture using official server-side API/OAuth patterns.
- Streamer permission is enforced before watch, clip, package, or queue work.

## Run

```bash
cp .env.example .env
npm start
```

Open `http://localhost:4177`.

## Stream provider variables

Twitch:

```bash
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
TWITCH_ALLOWED_CHANNELS=
```

Kick:

```bash
KICK_CLIENT_ID=
KICK_CLIENT_SECRET=
```

Leave the allowed-channel lists empty when you want StreamClipper to monitor any approved streamer you add in the app. Keep all provider secrets in local env or Railway variables only.

## Buffer manual-draft handoff

Clipping Office can send an operator-approved Product Ready MP4 to a connected TikTok or Instagram channel as a **Buffer draft**. Automatic scheduling and public posting are intentionally disabled.

Set this Railway variable on the Argentum service:

```bash
BUFFER_API_KEY=
```

`BUFFER_PUBLIC_ORIGIN` is optional when Railway forwards the public HTTPS host correctly. Set it only when the service needs an explicit origin such as `https://your-argentum-domain.example`.

The operator flow is:

1. Open Settings and test Buffer to load connected TikTok and Instagram channels.
2. Choose a Product Ready clip and destination channel.
3. Prepare the exact draft and approve its one-use Human Gate request.
4. Click **Create draft in Buffer**. This uses Buffer's draft mode; it does not schedule or publish.
5. Review and publish manually in Buffer, then revoke the media link from Clipping Office.

The API key stays on the server. The approved MP4 is exposed only through a random capability URL whose raw token is not persisted, and the server rechecks the file hash before serving it. A consumed approval is never retried automatically when Buffer's outcome is uncertain.

## Caption intelligence

Caption generation is a versioned analysis pipeline rather than a transcript-summary template. It cleans the transcript, extracts events and concrete hook details, classifies the clip, generates multiple angles, rejects generic or unsupported claims, scores grounding and specificity, checks recent-caption diversity, and stores the complete audit on the clip candidate. Weak, sensitive, or low-confidence results enter review instead of receiving fake hype.

Open **Argentum Editor -> Captions -> View** to inspect the cleaned transcript, main event, hook evidence, candidate scores, rejection reasons, source segments, confidence, review status, and model/prompt versions. The same view supports regenerate, protected manual edits, approval, and rejection feedback.

Optional quality thresholds:

```bash
CAPTION_AUTO_APPROVE_SCORE=85
CAPTION_MINIMUM_SCORE=75
CAPTION_MINIMUM_ACCURACY=90
CAPTION_MINIMUM_TRANSCRIPT_CONFIDENCE=0.72
CAPTION_MAXIMUM_ATTEMPTS=2
```

Caption metadata is added to existing JSON clip records without changing clip IDs, queue status, transcripts, or approved user edits.

### On-device transcription fallback

The desktop app uses cloud transcription when it is healthy, then automatically switches to native `whisper.cpp` when the cloud provider is unavailable or out of quota. Homebrew's `whisper-cli` is detected automatically. Put a compatible model such as `ggml-small.en.bin` in `~/Library/Application Support/Argentum OS/models/whisper`, or set `WHISPER_EXECUTABLE` and `WHISPER_MODEL_PATH` explicitly. Local results keep full-clip coverage, timed segments, provenance, and quality evidence so caption generation follows the same production gate.

## Agent 101 streamer scouting

The Stream Watchlist includes an Agent 101 scout panel. It can call the configured Kick and Twitch live directories from the server, rank promising streamers, and suggest who to monitor next. Adding a recommendation only creates an approved local monitoring source; publishing, account changes, API-key changes, and posting still stay behind Human Gate.

## CapCut Macro Training

Argentum can open and observe the native Mac CapCut desktop app, then use Teach Mode to record and replay operator-trained macro workflows. It does not enter credentials, buy anything, publish, upload, or click export.

Flow:

1. Render a Radar/Builder candidate into a verified MP4.
2. Connect the local CapCut desktop app from the CapCut Workspace.
3. Use Teach Mode to record the manual edit once.
4. Save and replay the macro only against verified local clips.
5. Export remains operator-controlled inside CapCut.
6. Posting drafts only start after a returned export is verified as a real local video file.

Optional local variables:

```bash
CAPCUT_DOWNLOAD_DIR=./capcut-downloads
CAPCUT_AGENT_DRY_RUN=false
CAPCUT_BRAND_STICKER=Essentrx
ANTHROPIC_API_KEY=
```

## Verify

```bash
npm run smoke
```

The smoke script starts against the running local server and checks health, settings status, streamer creation, permission gating, watch cycle, package generation, CapCut handoff, posting draft approval request, daily limit behavior, logs, and secret redaction. From the Argentum root, `npm run smoke:capcut` also validates the CapCut Agent approval sequence with a verified dry-run render.

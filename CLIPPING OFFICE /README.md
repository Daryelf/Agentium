# StreamClipper Agent

StreamClipper Agent is a standalone, supervised clipping automation product. It monitors approved streamer sources, scores clip moments, creates 9:16 short-form packages, prepares CapCut handoffs, drafts captions for TikTok/Reels/Shorts, and routes risky actions through Human Gate.

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

## Verify

```bash
npm run smoke
```

The smoke script starts against the running local server and checks health, settings status, streamer creation, permission gating, watch cycle, package generation, CapCut handoff, posting draft approval request, daily limit behavior, logs, and secret redaction.

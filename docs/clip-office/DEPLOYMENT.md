# Clip Office Deployment

## Local Mac Mode

Local mode is the default desktop target.

```bash
APP_MODE=local HOST=127.0.0.1 npm run start:local
npm run dev:local
```

Runtime data belongs in the Mac app data folder, not inside the packaged app bundle. Clip Office receives a local data directory through `CLIPPING_OFFICE_DATA_DIR` / `ARGENTUM_CLIPPING_OFFICE_DATA_DIR`.

## Build

```bash
npm run build:mac
```

Artifacts are written under `dist/`. The app package is named `Argentum OS`.

## Signing

This machine does not currently expose a valid Developer ID Application identity, so the local build is unsigned. Production distribution should add Apple signing and notarization.

## Cloud Mode

Cloud mode remains optional and should preserve existing deployment behavior. Do not expose local-only admin routes publicly. Secrets and platform credentials must be set in the server environment or secure storage, never in frontend code.

## Required Environment For External Integrations

- Twitch: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` or app/user token, and optional refresh token.
- Kick: `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET` or OAuth token.
- OpenAI: `OPENAI_API_KEY`, model, budget limits.
- Publishing destinations: platform-specific sandbox credentials and Human Gate approval.

## Verification Before Release

```bash
npm install
npm run check
npm test
npm run eval:agent101
npm run validate:clip-office
npm run build:mac
```

Do not ship public publishing unless sandbox publish and reconciliation tests pass for the exact destination.

# Clip Office Operations Runbook

## Start Local Desktop App

```bash
npm run dev:local
```

## Start Local Backend Only

```bash
npm run start:local
```

## Build Mac App

```bash
npm run build:mac
```

Unsigned builds are expected unless a valid Apple Developer ID certificate is installed.

## Run Validation

```bash
npm install
npm run check
npm test
npm run eval:agent101
npm run validate:clip-office
```

## Watcher Recovery

- Use Stream Watchlist to confirm `Monitoring` is on.
- Use Clip Radar refresh if candidate counts appear stale.
- Backend refresh calls repair missing current watch windows for active sessions.
- Pause/resume a watch session if a stream is degraded.
- Stop a watch session if it is no longer authorized or the streamer is offline.

## Candidate Cleanup

- Select individual Clip Radar rows with checkboxes.
- Use `Delete selected` for bad windows.
- Use `Delete all visible` only after filtering to the intended set.
- Deletion removes local Radar candidates and feedback only. It does not touch Twitch/Kick or remote source media.

## Source-Pending Windows

Source-pending windows are valid monitoring records, not playable clips. They can be reviewed, scored, deleted, or sent to Builder for planning, but package/render stays locked until playable media is attached.

## Emergency Stop

- Pause or stop active watch sessions from the Watchlist actions.
- Keep external publishing disabled unless Human Gate approval and sandbox credentials are present.
- Remove provider credentials from local secure storage if a connector must be disabled immediately.

## Logs And Evidence

- Clip Office logs are available from the Logs page and persisted state.
- Watch-session events include starts, heartbeats, candidate creation, deletion, recovery, and render events.
- Validation evidence is in `artifacts/clip-office-validation/results.json`.

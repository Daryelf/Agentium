# StreamClipper End-to-End Test Plan

Last updated: 2026-06-21

## Automated

Run from `CLIPPING OFFICE /`:

```bash
npm run smoke
```

The smoke test must verify:

- Health endpoint returns a valid readiness state.
- OpenAI and Twitch status endpoints do not expose secrets.
- Integration matrix exists and reports `secretsExposed: false`.
- Readiness audit returns docs and known gaps.
- Action matrix and Agent 101 tool map are available.
- Practice data can be cleared without deleting real state.
- Real discovery honors requested count and does not create fake candidates.
- Permission gates block pending streamers.
- Posting drafts require verified clip artifacts.
- Human Gate receives verified draft approval requests.
- Logs record blocked and completed workflow events.

## Manual Browser Pass

1. Open StreamClipper locally.
2. Visit Dashboard.
3. Run practice workflow and confirm Practice Mode labels are visible.
4. Visit Stream Watchlist and verify practice streamers are separate from real streamers.
5. Visit Clip Radar and open a candidate preview.
6. Visit Clip Builder and confirm playback/source truth is visible.
7. Render a local draft only if FFmpeg/FFprobe are available.
8. Create a package and posting draft only after verified render.
9. Visit Human Gate and approve/send back/reject one bounded request.
10. Reload the page and confirm chat, approvals, logs, and watch state persist.
11. Visit Integrations and test OpenAI/Twitch/Kick/media where configured.
12. Visit Browser Workspace and run the browser smoke test.
13. Confirm no frontend JavaScript receives API keys or raw tokens.

## Production Acceptance

- No control appears enabled without a handler and prerequisite.
- No Real Mode page shows practice data as production.
- No connector says connected until a backend test succeeds.
- No publish/upload/account action executes directly.
- Every risky request routes to Human Gate with evidence and a linked record.

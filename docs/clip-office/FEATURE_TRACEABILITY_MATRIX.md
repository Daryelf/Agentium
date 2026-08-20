# Feature Traceability Matrix

| Capability | UI | Endpoint | Service/data model | Worker/integration | Test or validation | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Local Mac app | Electron window | Root backend | `desktop/main.js`, `server.js` | Local runtime | `tests/local-desktop.test.js` | Active |
| Local data folder | App runtime | startup | `services/local-runtime.js`, Clip Office data dir | Local filesystem | `tests/local-desktop.test.js` | Active |
| Secure local secrets | Settings/Integrations | root secrets endpoints | `services/secure-secrets.js` | Mac/local storage abstraction | `tests/local-desktop.test.js` | Active |
| Provider status | Integrations | `/api/config`, test routes | connector config, integration checks | Twitch/Kick/OpenAI | `tests/local-desktop.test.js`, validation `security-*` | Active |
| Streamer scout | Stream Watchlist | `POST /api/agent101/runs` | `discoveredStreamers`, logs | Twitch/Kick metadata | validation `api-*`, local tests | Active with external dependency |
| Add streamer | Stream Watchlist | `POST /api/twitch/streamers` | `streamers`, approvals | Twitch/Kick check | `tests/clipping-watch-windows.test.js` | Active |
| Human streamer approval | Human Gate | `POST /api/human-gate/approve` | `approvalRequests`, `streamers` | Watch worker | `tests/clipping-watch-windows.test.js` | Active |
| Start watcher | Watchlist/Radar | `POST /api/watch-sessions` | `watchSessions`, `watchEvents` | Watch worker | `tests/clipping-watch-windows.test.js` | Active |
| Watch recovery | backend startup/API refresh | recovery helpers | leases, heartbeats, reconnect count | Watch worker | validation `queue-*` | Active |
| 30-second windows | Clip Radar | `GET /api/clip-candidates` | `clipCandidates`, `watchEvents` | Watch worker | `tests/clipping-watch-windows.test.js` | Active |
| Candidate details/playback | Clip Radar | media playback routes | `mediaSources`, `clipCandidates` | Media source or live embed | validation `ui-*` | Active |
| Bulk deletion | Clip Radar | `POST /api/clip-candidates/bulk-delete` | `clipCandidates`, `feedbackEvents`, logs | Watch coverage repair | `tests/clipping-watch-windows.test.js` | Active |
| Send to Builder | Clip Radar | `POST /api/clips/draft` | `postingDrafts`/builder state | None | validation `ui-*` | Active |
| Render draft | Clip Builder | clip project render routes | `mediaJobs`, `artifacts` | FFmpeg/FFprobe | validation `media-*` | Active for verified local media |
| Captions/handoff | Clip Builder | caption and handoff routes | artifacts, handoff packages | CapCut manual handoff | validation `api-*` | Active with manual handoff |
| Posting approval | Posting Queue/Human Gate | approval routes | `postingDrafts`, `approvalRequests` | Human Gate | validation `security-*` | Active |
| Public publishing | Posting Queue | publish adapters | publication records | TikTok/YouTube/etc. | skipped external blockers | Blocked pending credentials/approval |
| Agent 101 status | Agent 101 chat | `/api/agent101/run` | threads, runs, artifacts | Agent 101 OS | `npm run eval:agent101` | Active |
| 500 validation | CLI | `npm run validate:clip-office` | JSON and Markdown reports | local harness | `artifacts/clip-office-validation/results.json` | Active |

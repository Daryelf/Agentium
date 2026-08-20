# Clip Office Architecture

## Runtime Shape

Argentum OS is a local Electron desktop app that starts the root Node backend on `127.0.0.1`. The root backend mounts Clip Office from `CLIPPING OFFICE /server.js` and keeps local mode additive beside cloud mode.

## Core Components

| Component | Responsibility |
| --- | --- |
| `desktop/main.js` | Native Mac shell, app menu, lifecycle, local backend launch |
| `server.js` | Root Argentum API, auth, local mode, Agent 101, secure secrets, mounted offices |
| `CLIPPING OFFICE /server.js` | StreamClipper API, watch sessions, candidates, media, render jobs, Human Gate, Browser Workspace |
| `CLIPPING OFFICE /public/app.js` | Clip Office UI and action handlers |
| `services/agent101-operating-system.js` | Agent 101 identity, tool registry, permission policy, persistent runs |
| `services/local-database.js` | Local SQLite setup and job storage |
| `services/secure-secrets.js` | Local secret storage abstraction |
| `scripts/clip-office-validation.js` | 500-scenario deterministic validation harness |

## Data Model

Clip Office persists local state in the configured Clip Office data directory. Important records include `streamers`, `watchSessions`, `watchEvents`, `mediaSources`, `mediaSegments`, `clipCandidates`, `mediaJobs`, `artifacts`, `clipPackages`, `postingDrafts`, `approvalRequests`, `handoffPackages`, `agentRuns`, and `logs`.

Local mode stores runtime data outside the packaged app bundle through `CLIPPING_OFFICE_DATA_DIR` / `ARGENTUM_CLIPPING_OFFICE_DATA_DIR`.

## Worker Model

The watch worker uses persisted watch sessions, worker IDs, heartbeats, leases, reconnect counts, and recovery on startup. It creates real 30-second review windows when an approved live monitor is active. If no playable source is attached, candidates stay source-pending and package/render actions are locked.

Render jobs use FFmpeg/FFprobe through safe process execution paths and require verified playable media before output artifacts become render-ready.

## Safety Model

Safe internal work can run automatically: discovery metadata, local watch records, candidates, drafts, reports, validation, and local artifacts.

High-risk work is gated: publishing, uploads, remote deletion, spending, account changes, credential changes, customer contact, live agent activation, and system-setting changes require Human Gate approval.

## External Integrations

Twitch/Kick are treated as provider APIs for live metadata and discovery. OpenAI and other model providers are optional cloud APIs. CapCut is a manual handoff. Publishing destinations stay blocked until credentials, platform limits, sandbox status, and Human Gate approval are present.

# StreamClipper Product Readiness Audit

Last updated: 2026-06-21

## Scope

This audit covers the StreamClipper Agent app under `CLIPPING OFFICE /`.

Primary runtime files:

- `server.js`
- `public/app.js`
- `public/styles.css`
- `data/state.json` shape only; runtime state is not committed

## Readiness Summary

Current state: supervised beta foundation, not full autonomous production.

Shipped:

- Local Node backend with persistent JSON state.
- Agent 101 runner route and persistent chat/thread state.
- Official API-only Twitch and Kick connector foundations.
- Real/practice mode separation for watch/candidate/output state.
- Durable watch session model with state, events, leases, and active-session hydration.
- Clip Radar, Clip Builder, Outputs, Logs, Human Gate, Browser Workspace, Integrations, and Analytics UI surfaces.
- Verified render prerequisite before posting drafts.
- Human Gate requirement for risky external actions.

Partial:

- Real provider discovery depends on configured Twitch/Kick credentials and runtime validation.
- Browser Workspace exists, but should be smoke-tested before every deployment where it matters.
- Local render depends on FFmpeg/FFprobe availability in the server runtime.
- CapCut is manual handoff only.
- Analytics are state-derived, not a historical warehouse.
- Storage is local unless object storage is configured and smoke-tested.

Blocked or intentionally not implemented:

- Direct posting/uploading to TikTok, Instagram, or YouTube.
- Social account connection or OAuth for posting.
- Direct CapCut automation.
- Using unapproved real streamer content.
- Spending money, changing accounts, deleting external content, or creating live external agents.
- Multi-worker production persistence until database/object storage are completed.

## Production Rules

- Real Mode must never fabricate source data.
- Practice Mode must be explicit, labeled, and excluded from production counts.
- Environment variables only mean configured, not connected.
- Connected means the backend runtime has successfully tested the integration or verified a local tool.
- Human Gate approves one bounded action, never a global unlock.
- Frontend JavaScript must never receive raw API keys, OAuth tokens, secrets, or credentials.

## Current Backend Truth Endpoints

- `GET /api/integrations/status`
- `POST /api/integrations/:id/test`
- `GET /api/readiness/audit`
- `GET /api/readiness/action-matrix`
- `GET /api/agent101/tool-map`
- `GET /api/system/smoke-test`

## Next Production Milestones

1. Move state from local JSON to a transactional database.
2. Add object storage write/read smoke tests.
3. Add authenticated operator sessions around every mutation route.
4. Build real source capture with verified provider permission and replayable media evidence.
5. Add end-to-end browser tests for each page and critical action.
6. Add queue/worker observability for watch sessions, render jobs, and Agent 101 runs.

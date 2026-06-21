# StreamClipper State Machine Map

Last updated: 2026-06-21

## Watch Session

States:

- `queued`
- `starting`
- `connecting`
- `watching`
- `degraded`
- `reconnecting`
- `paused`
- `stream_ended`
- `completed`
- `failed`
- `cancelled`

Active states:

- `queued`
- `starting`
- `connecting`
- `watching`
- `degraded`
- `reconnecting`

Terminal states:

- `stream_ended`
- `completed`
- `failed`
- `cancelled`

Rules:

- Real watch sessions require approved real streamers and official provider checks.
- Practice watch sessions must remain labeled as practice.
- A stale heartbeat should be treated as degraded or failed, not silently successful.
- Reloaded UI should hydrate from `/api/watch-sessions/active`.

## Candidate

States:

- `candidate`
- `new`
- `review`
- `ready_to_package`
- `packaged`
- `dismissed`
- `rejected`

Rules:

- Real candidates require verified source truth.
- Practice candidates must not count as production.
- Scores `80+` are package candidates, `70-79` are review candidates, below `70` should be rejected or held.

## Clip Package

States:

- `draft`
- `ready`
- `rendering`
- `rendered`
- `failed`

Rules:

- Posting drafts require a verified render artifact.
- CapCut briefs can be created as manual handoff artifacts.

## Posting Draft

States:

- `draft`
- `approval_pending`
- `approved`
- `send_back`
- `rejected`
- `blocked`

Rules:

- Draft creation is safe internal work.
- External posting/uploading is not implemented and requires Human Gate.

## Human Gate

States:

- `pending`
- `approved`
- `send_back`
- `rejected`
- `blocked`

Rules:

- An approval only applies to the linked action, artifact, candidate, draft, or connector.
- Human Gate never globally unlocks Agent 101.

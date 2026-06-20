# StreamClipper State Flow

## Data Sources

StreamClipper currently reads state from the local backend:

- Streamers: `GET /api/twitch/streamers`
- Candidates: `GET /api/clips/candidates`
- Packages: `GET /api/clips/packages`
- Posting drafts: `GET /api/posts/queue`
- Approvals: `GET /api/human-gate/approvals`
- Artifacts: `GET /api/artifacts`
- Logs: `GET /api/logs`
- Studio project: `GET /api/clipping-office/project`

Runtime state is stored in `data/state.json`. Do not commit runtime state unless explicitly requested.

## Real Mode Flow

1. Operator adds a streamer.
2. Streamer must have a real provider platform and approved permission.
3. Watch cycle calls official provider checks only.
4. Real candidates are created only from provider-backed stream/session data.
5. Packages, CapCut briefs, posting drafts, approvals, outputs, and analytics all derive from those real candidates.
6. Human Gate is required before any external posting, upload, account change, spending, deletion, or connector action.

## Practice Mode Flow

1. Operator explicitly clicks `Start Practice Project` or runs a practice Agent 101 workflow.
2. Backend creates practice streamer/source/candidate rows.
3. Frontend labels these records with `PRACTICE MEDIA - NOT A REAL STREAM`.
4. Practice rows can be previewed and used for local draft workflow testing.
5. Practice rows are excluded from Real Mode dashboard, nav, analytics, queue, Human Gate, and output counts.
6. Operator can clear practice rows with `Clear Practice Data`.

## Empty Project Flow

When no studio project exists:

1. `/api/clipping-office/project` returns an empty setup payload.
2. The builder shows `No verified source`.
3. The user can add a real streamer/media source or explicitly start Practice Mode.
4. No practice project is auto-created on page load.

## Safety Flow

Safe internal actions:

- Add practice streamers.
- Run practice watch cycle.
- Create local candidates.
- Score candidates.
- Create package drafts.
- Create CapCut briefs.
- Create posting drafts.
- Create Human Gate approval requests.
- Save artifacts.
- Write logs.

Human Gate actions:

- Public posting.
- Uploading to external platforms.
- Spending or moving money.
- Changing account settings.
- Connecting accounts or API credentials.
- Deleting content.
- Using real streamer content without approved permission.

## UI Refresh Flow

After a state-changing action:

1. Backend mutates state.
2. Backend logs the event when relevant.
3. Frontend calls `refresh()`.
4. `loadCore()` reloads all core collections.
5. Current view re-renders from centralized state.

This avoids showing stale counts after approvals, practice clear, seed, watch cycle, package creation, and output generation.

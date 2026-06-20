# StreamClipper UI Audit

## Scope

This audit covers the StreamClipper Agent application in `CLIPPING OFFICE /`.

Primary files inspected:

- `server.js`
- `public/app.js`
- `public/styles.css`
- `public/index.html`
- `data/state.json` shape only; runtime state is not committed

## Production Rules

- Real Mode must only show real streamer, stream, clip, output, approval, and posting records.
- Practice Mode must be explicitly started by the operator.
- Practice Mode records must be labeled `PRACTICE MEDIA - NOT A REAL STREAM`.
- Practice Mode rows must not count as production dashboard, nav, analytics, queue, Human Gate, or output metrics.
- Real watch cycles must skip practice streamers.
- If a visible action has no safe backend behavior yet, it must be disabled with a reason.
- Agent 101 may create local draft work and approvals, but external posting and account changes stay Human Gate gated.

## Fixed In This Pass

- Stopped `/api/clipping-office/project` from creating practice media on page load.
- Added an empty project setup payload when no project exists.
- Added explicit Practice Mode start and clear actions.
- Added practice filtering helpers in the frontend.
- Updated dashboard, watchlist, radar, queue, Human Gate, outputs, and analytics counts to exclude practice data in Real Mode.
- Added visible practice banners when practice rows exist.
- Disabled output quick actions that do not have backend routes yet.
- Reworded user-facing demo copy to Practice Mode language.
- Added CSS for practice badges, practice notices, disabled controls, and non-downloadable output rows.

## Remaining Known Gaps

- Output search and filter controls are present but not wired to persistent filtering yet.
- Analytics detailed tabs are disabled until dedicated drilldown views exist.
- Bulk output export, report generation, storage cleanup, and archive view need backend routes before activation.
- Browser Workspace still depends on the configured browser worker state.
- CapCut is manual handoff only until a real integration is approved and built.

## QA Notes

- `node --check` should pass for `server.js` and `public/app.js`.
- Practice seed should add local practice rows only after explicit user action.
- Practice clear should remove practice rows without deleting real streamers or outputs.
- Real watch cycle should not use practice rows as fallback.

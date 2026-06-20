# Browser Workspace Audit

## Scope

This audit covers the StreamClipper Browser Workspace in `CLIPPING OFFICE /`.
The workspace is intended to be a supervised browser surface for Agent 101 and
the operator. It must show a real backend browser, preserve session state, and
keep risky actions approval-gated.

## Existing State Before This Pass

- Browser execution already lived server-side in `services/browser-workspace.js`.
- Screenshots were produced from Playwright, not from a static mock.
- Sessions were persisted in the StreamClipper state file.
- The UI had Browser Workspace entry points, but the browser surface was not
  complete enough for production use.

## Gaps Found

- Only one page was effectively tracked per session.
- Browser tabs were not first-class state.
- Reload recovery was weak because runtime pages and persisted tab metadata were
  not synchronized.
- The UI did not expose a complete control surface for tabs, stop/restart, input,
  task context, assets, and diagnostics.
- The input bridge was not explicit enough about controller and policy rules.
- The smoke test only proved a shallow profile path, not real browser behavior.
- Security docs and action mapping were missing.

## Changes Made

- Added persisted tab state and runtime Playwright page mapping.
- Added tab APIs for list, create, switch, and close.
- Added a backend input bridge for click, double click, scroll, type, keypress,
  and zoom.
- Added controller enforcement for human control, agent assisted control, pause,
  privacy shield, and read-only policy modes.
- Added backend health and smoke-test endpoints.
- Added visible-text and downloads APIs with privacy and safety checks.
- Rebuilt the Browser Workspace UI around:
  - real screenshot viewport
  - tab strip
  - full toolbar
  - task rail
  - asset dock
  - domain policy panel
  - diagnostics runner
- Updated the StreamClipper system smoke test to exercise the real browser
  workspace instead of only checking a health route.

## Remaining Boundaries

- Browser Workspace can view and prepare internal draft work, but it must not
  publish, upload, buy, spend, connect accounts, or change external account
  settings without Human Gate.
- CapCut remains a manual handoff. The app can create handoff notes and open
  local references, but it does not control CapCut directly.
- Upload handling is deliberately conservative. Executable file types are
  blocked, and external upload actions still require explicit approval.
- Real provider credentials must remain in Railway/server environment variables.
  They are never returned by the Browser Workspace APIs.

## Verification Checklist

- `node --check "CLIPPING OFFICE /services/browser-workspace.js"`
- `node --check "CLIPPING OFFICE /server.js"`
- `node --check "CLIPPING OFFICE /public/app.js"`
- `npm run check`
- Start StreamClipper locally.
- POST `/api/browser/smoke-test`.
- Confirm the smoke report includes:
  - browser context ready
  - screenshot captured
  - tabs working
  - input bridge working
  - control mode working
  - privacy shield working


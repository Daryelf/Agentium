# Browser Workspace Action Matrix

## Principles

- The frontend never controls Playwright directly.
- Every browser action goes through the StreamClipper backend.
- Operator input requires `human_control`.
- Agent actions are allowed only in safe policy modes.
- Privacy shield blocks visible-text extraction and agent input.
- External risky actions stay behind Human Gate.

## Session Actions

| Action | Route | Controller | Notes |
| --- | --- | --- | --- |
| Load profile | `GET /api/browser/profile` | Any authenticated app view | Returns safe session, tab, task, handoff, download, and diagnostic state. |
| Start session | `POST /api/browser/sessions` | Operator or Agent 101 | Reuses active session unless `forceNew` is true. |
| End session | `DELETE /api/browser/sessions/:id` | Operator or Agent 101 | Closes all runtime tab pages and marks session closed. |
| Restart session | `POST /api/browser/sessions/:id/restart` | Operator or Agent 101 | Closes the selected session and creates a fresh session. |
| Health | `GET /api/browser/health` | Any authenticated app view | Reports Playwright and persisted profile readiness. |
| Smoke test | `POST /api/browser/smoke-test` | Operator/admin | Runs real backend browser checks and stores the report. |
| Clear profile | `POST /api/browser/profile/clear` | Operator/admin | Closes runtime browser state and clears persisted profile/session data. |

## Tab Actions

| Action | Route | Controller | Notes |
| --- | --- | --- | --- |
| List tabs | `GET /api/browser/sessions/:id/tabs` | Any authenticated app view | Returns persisted tabs for the selected session. |
| New tab | `POST /api/browser/sessions/:id/tabs` | Operator or Agent 101 | Creates a Playwright page and persisted tab record. |
| Switch tab | `PATCH /api/browser/sessions/:id/tabs/:tabId` | Operator or Agent 101 | Changes active tab and syncs URL/title. |
| Close tab | `DELETE /api/browser/sessions/:id/tabs/:tabId` | Operator or Agent 101 | Keeps one active tab alive when possible. |

## Navigation Actions

| Action | Route | Controller | Notes |
| --- | --- | --- | --- |
| Navigate | `POST /api/browser/sessions/:id/navigate` | Operator or Agent 101 | Blocks unsupported protocols, private hosts, and disallowed domains. |
| Back | `POST /api/browser/sessions/:id/back` | Operator or Agent 101 | Uses active tab history. |
| Forward | `POST /api/browser/sessions/:id/forward` | Operator or Agent 101 | Uses active tab history. |
| Refresh | `POST /api/browser/sessions/:id/refresh` | Operator or Agent 101 | Reloads active tab. |
| Stop loading | `POST /api/browser/sessions/:id/stop-loading` | Operator or Agent 101 | Stops active tab navigation. |
| Screenshot | `GET /api/browser/sessions/:id/screenshot` | Any authenticated app view | Captures real backend browser pixels. |

## Input Actions

| Action | Route | Controller | Notes |
| --- | --- | --- | --- |
| Click | `POST /api/browser/sessions/:id/input` | Operator only in human control | Uses screenshot coordinates. |
| Double click | `POST /api/browser/sessions/:id/input` | Operator only in human control | Uses screenshot coordinates. |
| Scroll | `POST /api/browser/sessions/:id/input` | Operator only in human control | Sends wheel input to active page. |
| Type | `POST /api/browser/sessions/:id/input` | Operator only in human control | Blocks in privacy and read-only mode; logs length only. |
| Keypress | `POST /api/browser/sessions/:id/input` | Operator only in human control | Blocks in privacy and read-only mode. |
| Zoom | `POST /api/browser/sessions/:id/input` | Operator only in human control | Adjusts active page zoom. |

## Control Actions

| Action | Route | Controller | Notes |
| --- | --- | --- | --- |
| Take control | `POST /api/browser/sessions/:id/take-control` | Operator | Sets `human_control`. |
| Give control | `POST /api/browser/sessions/:id/give-control` | Operator | Sets `agent_assisted`. |
| Pause | `POST /api/browser/sessions/:id/pause` | Operator | Suspends agent work. |
| Resume | `POST /api/browser/sessions/:id/resume` | Operator | Returns to agent assisted mode. |
| Set policy | `PATCH /api/browser/sessions/:id/policy` | Operator | Supports read-only, manual-handoff, automated, and privacy. |

## Handoff And Artifacts

| Action | Route | Controller | Notes |
| --- | --- | --- | --- |
| Create CapCut handoff | `POST /api/browser/capcut/open` | Operator or Agent 101 | Creates a manual handoff record and artifact. |
| Browser downloads | `GET /api/browser/sessions/:id/downloads` | Any authenticated app view | Returns safe file metadata, never raw secrets. |
| Visible text | `GET /api/browser/sessions/:id/visible-text` | Operator or Agent 101 | Disabled when privacy shield is active. |


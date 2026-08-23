# StreamClipper Action Matrix

| Page | Control | Type | Intended Action | Current Handler | Backend Route | Status | Missing Prerequisite | Test Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dashboard | Run Practice Workflow | Button | Run safe local clipping workflow | `agent101-demo-workflow` | `POST /api/agent101/run` | Active | None | Covered by syntax/API smoke |
| Dashboard | Run Watch Cycle | Button | Check approved real streamers | `run-watch` | `POST /api/watch/run` | Active | Twitch or Kick vars for real checks | Covered by API smoke |
| Dashboard | Start Practice Project | Button | Create explicit practice workspace | `seed-demo` | `POST /api/demo/seed` | Active | None | Covered by API smoke |
| Dashboard | Clear Practice Data | Button | Remove practice rows only | `clear-demo` | `POST /api/demo/clear` | Active | Practice rows exist | Covered by API smoke |
| Stream Watchlist | Add Streamer | Form | Add real streamer record | `streamer-form` | `POST /api/streamers` | Active | Valid streamer name or URL | Needs browser form check |
| Stream Watchlist | Pause/Monitor | Button | Toggle monitoring | `data-toggle-monitor` | `PATCH /api/streamers/:id` | Active | Streamer row exists | Needs browser row check |
| Stream Watchlist | Check | Button | Check one streamer | `data-check-streamer` | `POST /api/streamers/:id/check` | Active | Provider configured for real check | Needs provider check |
| Stream Watchlist | OK | Button | Approve streamer | `data-approve-streamer` | `PATCH /api/streamers/:id` | Active | Streamer row exists | Needs browser row check |
| Stream Watchlist | Delete | Button | Remove streamer | `data-delete-streamer` | `DELETE /api/streamers/:id` | Active | Streamer row exists | Needs browser row check |
| Clip Radar | Play | Button | Open local preview modal | `data-preview-candidate` | Local state | Active | Candidate exists | Needs browser preview check |
| Clip Radar | Package | Button | Create clip package | `data-package-candidate` | `POST /api/clips/:id/package` | Active | Candidate exists | Needs browser package check |
| Clip Radar | Mark Reviewed | Button | Score/update candidate | `data-score-candidate` | `POST /api/clips/:id/score` | Active | Candidate selected | Needs browser row check |
| Clip Builder | Render 9:16 Draft | Button | Render playable source | `data-studio-action=render-draft` | `POST /api/media/render` | Active when source playable | Playable source and render tools | Needs media tool check |
| Clip Builder | Create Clip Package | Button | Create package from candidate | `data-package-candidate` | `POST /api/clips/:id/package` | Active | Candidate exists | Needs browser package check |
| Clip Builder | Prepare CapCut Handoff | Button | Create manual handoff | `data-action=create-capcut` | `POST /api/handoffs` | Active when package exists | Clip package exists | Needs browser handoff check |
| Posting Queue | Preview/Edit | Button | Inspect draft post | Draft row handlers | Existing post routes | Active where row exists | Draft row exists | Needs browser queue check |
| Human Gate | Approve | Button | Approve pending request | `data-gate-approve` | `POST /api/human-gate/:id/approve` | Active | Pending approval exists | Needs browser approval check |
| Human Gate | Send Back | Button | Return work for changes | `data-gate-sendback` | `POST /api/human-gate/:id/send-back` | Active | Pending approval exists | Needs browser approval check |
| Human Gate | Reject | Button | Reject approval request | `data-gate-reject` | `POST /api/human-gate/:id/reject` | Active | Pending approval exists | Needs browser approval check |
| Outputs | Download | Link/Button | Download real file | File URL | Static `/outputs/*` | Active only with URL | Stored artifact file | Needs artifact check |
| Outputs | Open in Builder | Button | Navigate to builder | `data-nav-jump=builder` | Local route | Active | None | Covered by nav behavior |
| Outputs | Bulk Export | Button | Export selected files | None | Missing | Disabled | Bulk export endpoint | Not active |
| Outputs | Generate Report | Button | Create output report | None | Missing | Disabled | Report endpoint | Not active |
| Outputs | Clean Up Old Files | Button | Storage cleanup | None | Missing | Disabled | Storage policy endpoint | Not active |
| Analytics | Overview | Tab | Show real-mode analytics | `renderAnalytics` | Local state | Active | None | Covered by nav behavior |
| Analytics | Detailed tabs | Tabs | Drilldown analytics | None | Missing | Disabled | Drilldown pages | Not active |
| Analytics | Export Report | Button | Export analytics report | None | Missing | Disabled | Report endpoint | Not active |
| Integrations | Test Connection | Button | Test supported connector from backend | `data-test-integration` | `POST /api/integrations/:id/test` | Active for OpenAI/Twitch/Kick/Buffer/media | Connector env or local tool | Covered by readiness API smoke |
| Integrations | Status Matrix | Page data | Show truthful configured/tested/manual/gated status | `renderIntegrations` | `GET /api/integrations/status` | Active | None | Covered by smoke |
| Product Ready | Prepare Buffer Draft | Button | Lock the verified MP4, caption, and selected TikTok/Instagram channel into one approval scope | `data-buffer-prepare` | `POST /api/buffer/drafts/prepare` | Active; local state only | Buffer channel test + verified Product Ready MP4 | Unit + runtime API check |
| Product Ready | Approve Exact Draft | Button | Approve the exact one-use Buffer draft scope | `data-buffer-approve` | `POST /api/human-gate/approve` | Active; Buffer is not contacted | Pending Human Gate request | Runtime workflow check |
| Product Ready | Create Draft in Buffer | Button | Send the approved MP4 to Buffer with `saveToDraft: true` | `data-buffer-create` | `POST /api/buffer/posts/:id/create-draft` | Manual draft only; auto-post off | Approved, unconsumed scope + stable HTTPS media URL | Unit test; live call remains operator-triggered |
| Readiness | Audit | API data | Summarize blockers, mode counts, docs, active sessions | API only | `GET /api/readiness/audit` | Active | None | Covered by smoke |
| Readiness | Action Matrix | API data | Expose current action contracts | API only | `GET /api/readiness/action-matrix` | Active | None | Covered by smoke |
| Agent 101 | Tool Map | API data | Expose safe/blocked tool registry | API only | `GET /api/agent101/tool-map` | Active | None | Covered by smoke |
| Sidebar | Open Agent 101 | Button | Open persistent chat drawer | `data-open-agent-chat` | Local state + runner | Active | None | Covered by nav behavior |
| Sidebar | Back to Argentum | Link | Return to main Control Floor | `/` | Main app route | Active | Parent route exists | Needs browser check |

## Action Contract

Every new button must define:

- Stable action ID.
- Clear label.
- Handler or disabled state.
- Required backend route.
- Prerequisites.
- Loading state where networked.
- Success/error toast or state update.
- Log entry for workflow-changing actions.

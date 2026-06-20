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
| Integrations | Test OpenAI | Button | Test AI provider | `test-openai` | `POST /api/openai/test` | Active | Env configured for live | Needs env check |
| Integrations | Test Twitch | Button | Test Twitch provider | `test-twitch` | `POST /api/twitch/test` | Active | Twitch vars | Needs env check |
| Integrations | Test Kick | Button | Test Kick provider | `test-kick` | `POST /api/kick/test` | Active | Kick vars | Needs env check |
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

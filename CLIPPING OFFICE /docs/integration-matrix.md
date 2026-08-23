# StreamClipper Integration Matrix

Last updated: 2026-06-21

The live source of truth is `GET /api/integrations/status`.

| Integration | Current Mode | Connected Means | Current Limitation | Test Route |
| --- | --- | --- | --- | --- |
| OpenAI | Server-side AI provider | Backend test request succeeds without exposing the key | Billing/model/key errors fall back to local-safe behavior | `POST /api/integrations/openai/test` |
| Twitch | Official API only | Token validation or app token exchange succeeds | Real clipping needs permission, user scopes, and source evidence | `POST /api/integrations/twitch/test` |
| Kick | Official API only | Token exchange succeeds | Live discovery only; no scraping or posting | `POST /api/integrations/kick/test` |
| Buffer | Official GraphQL API | API key authenticates and connected TikTok/Instagram channels load | Exact one-use Human Gate approval; draft creation only; no scheduling or public posting | `POST /api/integrations/buffer/test` |
| Local Media Toolchain | FFmpeg/FFprobe or manual handoff | FFmpeg and FFprobe are available to the server process | No render guarantees without source verification and probe pass | `POST /api/integrations/media/test` |
| Browser Workspace | Supervised Chromium | Browser smoke test verifies screenshot/control path | No credential collection or external account changes | `POST /api/browser/smoke-test` |
| CapCut | Manual handoff | Not a direct connector | Operator controls CapCut | `GET /api/capcut/status` |
| TikTok / Instagram / YouTube | Human Gate only | Not connected in v1 | Drafts only; no public upload/post | None yet |
| Storage | Local files unless object storage is configured | Local directories exist or object store smoke passes | Local storage is not production-durable across deployments | `GET /api/integrations/status` |
| Database | Local JSON unless database is migrated | Transactional DB read/write succeeds | JSON state is not multi-worker safe | `GET /api/readiness/audit` |
| Human Gate | Operator review | Approval queue and decision logs persist | Approves bounded actions only | `GET /api/human-gate/approvals` |

## Rule

Configured is not connected. A connector can only show as connected after a backend runtime test or local binary check succeeds.

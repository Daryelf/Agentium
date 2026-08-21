# Argentum

Argentum is starting as a supervised AI operating company console. The first agent is **Depo**, a visible worker that gathers evidence, structures memory, drafts workflows, and sends high-risk actions to a human approval queue.

Run the persistent local prototype:

```bash
npm start
```

Then open `http://127.0.0.1:5173`.

You can still open `index.html` directly for a static preview, but persistent approvals, memory, audit, and Depo cycles require the local server.

## Admin access

Argentum OS is protected by a server-side admin login. On first local launch, open the Mac app or local control panel and create the owner admin login on the setup screen. There are no hardcoded default credentials.

After signing in, open **Settings -> Access** to create additional admin logins or rotate the current password.

Account records are stored in `data/argentum-auth.json` with salted password hashes. That file is ignored by Git.

The login and first-run setup forms support browser password managers and a save/remember device checkbox. Argentum does not store plaintext passwords; remembered access is a signed, HttpOnly, SameSite session cookie capped at 30 days.

If `SESSION_SECRET` is not set, the local server creates `data/argentum-session-secret.json` so remembered devices keep working across local restarts. That file is ignored by Git. On Railway, set a long fixed `SESSION_SECRET` environment variable so deploys do not invalidate remembered sessions.

Before using the optional Railway cloud deployment, you can also seed first-run Railway environment variables:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `SESSION_TTL_MS` optional, defaults to 8 hours
- `REMEMBER_SESSION_TTL_MS` optional, defaults to 30 days and is capped at 30 days

Use a unique admin username, a strong admin password with at least 12 characters including letters and numbers, and a long random `SESSION_SECRET`; changing the secret signs everyone out. Weak legacy defaults are rejected.

## Running Argentum OS Locally on Mac

Argentum OS can run as a local Mac desktop app through Electron. In local mode the backend binds to `127.0.0.1`, the control panel opens in a native Mac window, and local runtime data is stored under the user app data folder instead of the project folder.

### Live editing workflow (recommended for development)

- Run `npm run dev:local`.
- Keep this Electron window open while you edit files. In local mode, the app now watches local workspace files and auto-refreshes after saves (including Clip Office assets).
- If you need an immediate refresh, use `Cmd/Ctrl + R` in the app window.
- This flow is for development and local editing only; no rebuild needed for each UI tweak.

Install dependencies once:

```bash
npm install
```

Run the local backend without the desktop shell:

```bash
npm run start:local
```

Run the Mac desktop app:

```bash
npm run dev:local
```

Build a Mac app bundle:

```bash
npm run build:mac
```

After the build, launch the installer directly:

```bash
open "dist/Argentum OS-0.1.0-*.dmg"
```

When you are ready to ship a local update, build a new mac bundle and install it from the new DMG over your existing **Argentum OS.app** in Applications (macOS will replace the app in place).

Local mode variables:

```bash
APP_MODE=local
HOST=127.0.0.1
ARGENTUM_LOCAL_PORT=5173
ARGENTUM_LOCAL_DATA_DIR=
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
KICK_CLIENT_ID=
KICK_CLIENT_SECRET=
CLIPPER_WATCH_BUFFER_DIR=/Volumes/ZYLO/Argentum/CLIPPING OFFICE /Clips
```

The desktop app loads local env files before startup from this order: project `.env`, project `.env.local`, then `~/Library/Application Support/Argentum OS/.env`. Existing shell or Railway variables win and are not overwritten. For the packaged Mac app, the safest editable file is:

```bash
~/Library/Application Support/Argentum OS/.env
```

When `ARGENTUM_LOCAL_DATA_DIR` is not set on macOS, Argentum stores local runtime files in `~/Library/Application Support/Argentum OS`. The local SQLite database is created there as `argentum-local.sqlite`; the existing JSON state/auth files also move there in local mode. First launch creates the database tables for migrations, local audit logs, agent jobs, scoped file workspaces, file-access logs, and secret metadata.

API keys stay server-side. In local mode, keys saved from Settings use Mac Keychain when available, with an encrypted local fallback. Frontend JavaScript receives only configured/not-configured status, never raw key values.

The app lock is the existing Argentum admin login. On first local launch, create the owner admin account on the setup screen. Session TTLs still apply, so `SESSION_TTL_MS` and `REMEMBER_SESSION_TTL_MS` can be used for shorter auto-lock behavior.

Local agent work runs through the local job queue and existing Agent 101/Human Gate rules. Dangerous actions such as deleting files, writing files, sending email, posting content, spending money, changing account permissions, changing API keys, or changing system settings are routed to Human Gate instead of being executed.

File access is opt-in. In Settings -> Data & Storage, choose specific folders for Argentum OS to use. Agents do not get full disk access by default, and file workspace grant/revoke events are logged.

Obsidian memory is optional but first-class in local mode. Open Memory Center to initialize the default vault at `~/Documents/Argentum-Brain`, or set another vault path in Settings -> Data & Storage. Argentum creates a canonical v2 vault with `00_System`, `10_Businesses`, `20_Offices`, `30_Agents`, `40_Capabilities`, `50_Operations`, `60_Projects`, `70_Knowledge`, `80_Memory`, `90_Execution`, `95_Inbox`, `98_Assets`, and `99_Archive`.

Vault commands:

```bash
npm run vault:init
npm run vault:migrate:dry-run
npm run vault:migrate
npm run vault:validate
npm run vault:reindex
```

The status API reports schema version `2.0.0`, validation health, indexed notes, canonical entities, broken links, duplicate IDs, orphan notes, and pending memory. If an old vault exists, Argentum writes a timestamped backup beside the vault, creates a migration report, preserves legacy content, and writes `00_System/Manifests/legacy-path-map.json` so old links resolve without redirect-note clutter. Argentum's own Obsidian adapter can read, write, append, search, create canonical notes, list backlinks, resolve wikilinks, build Agent 1010 context, propose memory, approve memory, validate, reindex, and return a canonical graph, but it stays inside the configured vault and rejects secrets. External gateways are narrower and read-only by default.

Brain hardening commands:

```bash
npm run brain:backup
npm run brain:backup:verify
npm run brain:restore:dry-run
npm run brain:verify
npm run openclaw:bridge:check
npm run openclaw:bridge:test
npm run openclaw:bridge:disable
```

`npm run brain:restore` exists for real recovery only. It requires the backup confirmation value from the selected backup manifest and creates a safety backup before replacing the live vault.

Brain API surfaces:

- `/api/brain/startup-status`: confirms the configured vault reconnects after reload or restart.
- `/api/brain/health`: returns vault health, context readiness, latest backup, conflicts, and gateway status.
- `/api/brain/context/agent101`: builds deterministic Agent 1010 context with citations and exclusions.
- `/api/brain/backup`, `/api/brain/backup/verify`, `/api/brain/restore/dry-run`, `/api/brain/restore`: backup and disaster recovery.
- `/api/gateway/v1/*`: authenticated, scoped, read-focused adapter for external channels such as OpenClaw.

The Gateway adapter uses dedicated hashed credentials, never normal browser cookies. Safe scopes are limited to Agent 1010 chat/thread reads and writes, run reads, approval notifications, read-only memory search, and artifact summaries. It rejects vault writes, tool execution, filesystem access, SQLite access, environment access, and Human Gate approval decisions.

Feature labels:

- `Local`: desktop control panel, local SQLite, local job queue, selected file workspaces.
- `Cloud API`: OpenAI, Claude/Anthropic, and other model calls when enabled.
- `External Integration`: Twitch, TikTok, Stripe, CapCut, Google Drive, and similar services.

By default, Clipping Office saves captured MP4 clip windows to `/Volumes/ZYLO/Argentum/CLIPPING OFFICE /Clips` on the ZYLO drive. Set `CLIPPER_WATCH_BUFFER_DIR` only if you want to override that folder.

### Transcription quality

When `OPENAI_API_KEY` is configured, Clipping Office uses `gpt-4o-transcribe` for the primary speech pass and `whisper-1` as a timing pass so the editor keeps accurate wording plus real segment/word positions. Before upload, it extracts the first audio track, converts it to mono 16 kHz, and normalizes loudness so quiet stream audio is still readable. The transcript stores the full text, provider/model, language, confidence when available, segment timing, and a quality score. Set `TRANSCRIPTION_TIMESTAMP_MODEL=` to disable the second pass. If the cloud pass is unavailable or its quota is exhausted, the desktop app automatically falls back to native `whisper.cpp` and temporarily stops retrying the unavailable cloud provider. It auto-detects Homebrew's `whisper-cli` plus models under `~/Library/Application Support/Argentum OS/models/whisper`; use `WHISPER_EXECUTABLE` and `WHISPER_MODEL_PATH` to override those locations. Set `WHISPER_MODEL=small` or a larger installed model when running fully offline. Use **View** in the editor’s Captions card to inspect what the system actually heard, and **Re-read audio** to replace an older transcript with a fresh high-accuracy pass.

## Deploy

Argentum OS is still deployable as a plain Node.js cloud service when you explicitly want cloud mode. Set `APP_MODE=cloud` in Railway or another host so the server reads `process.env.PORT` and binds to `0.0.0.0`.

In cloud mode, `/` is the public Argentum product website, with public Terms of Service at `/terms`, Privacy Policy at `/privacy`, and support/data-request information at `/support`. The authenticated operator console is available at `/app`; `/login` and `/setup` remain the private access paths. Local/Electron mode is unchanged and continues to open the Argentum OS application at `/`.

For TikTok developer review preparation, see [`docs/tiktok-app-review.md`](docs/tiktok-app-review.md). A real monitored contact address, legal operator identity, stable HTTPS domain, verified URLs, matching OAuth callback, sandbox-tested integration, and demo video are still required before submission.

Railway path:

1. Push this project to a GitHub repository.
2. In Railway, create a new project from that GitHub repo.
3. Let Railway detect the Node app.
4. Use `npm start` as the start command if Railway asks.

Runtime state is stored in `data/argentum-state.json`. That file is ignored by Git so local state does not get committed. On a fresh deploy, Argentum creates a new default state automatically.

Cloud mode keeps the existing production behavior: use Railway environment variables for `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET`, provider keys, and connector credentials. Do not use the local Mac Keychain path for deployed cloud environments.

## AI provider mode

Argentum defaults to server-side Local Demo Mode so the app stays usable while building without OpenAI billing or credits.

Development/default Railway variables:

```bash
AI_PROVIDER=local_demo
OPENAI_API_KEY=
AI_MODEL=gpt-5.4-nano
AI_MONTHLY_LIMIT_USD=10
```

Later, when OpenAI Platform billing is active:

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=your_server_side_key
AI_MODEL=gpt-5.4-nano
AI_MONTHLY_LIMIT_USD=10
```

Frontend JavaScript never receives API keys. Use Settings -> AI Providers to check `/api/ai/status` and run a safe backend connection test.

## Agent 101 Studio

Agent 101 Studio belongs to the main Argentum OS Control Floor, not inside Clip Office. Clip Office stays focused on stream discovery, Radar candidates, Builder packages, posting drafts, and Human Gate approvals. When a Clip Office surface needs Agent 101, it hands back to the main Argentum Agent 101 workspace.

Studio uses the AI provider selected in Settings: Anthropic and OpenAI both run the same server-side tool loop. Without a live provider key, it uses a deterministic local builder that still creates and verifies real output files and gated approval requests. Optional server-side keys enable search, image generation, and provider integrations:

```bash
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-6
AGENT101_OUTPUT_DIR=
BRAVE_API_KEY=
SERP_API_KEY=
DALLE_API_KEY=
RESEND_API_KEY=
SENDGRID_API_KEY=
```

Action requests from the main Agent 101 chat become durable missions. Mission state, checkpoints, tool results, files, costs, approvals, and backend events persist across UI reconnects; unfinished safe missions are recovered after local startup. The mission cockpit uses `/api/agent101/missions`, `/api/agent101/missions/:id`, and `/api/agent101/missions/:id/stream` instead of simulated progress.

Generated files are written under the Agent 101 output directory, defaulting to the local Clip Office `outputs` folder. Generated websites must pass required-file, JavaScript, JSON, shell, secret-scan, local HTTP boot, product-route, checkout, and protected order-dashboard checks through `verify_output_project` before Studio calls them working. Only executable hashes produced by deterministic builders in the current run may boot automatically; other generated executables require a one-use, hash-locked Human Gate approval. The frontend can show configured/not-configured status, preview text and raster images, and download the original saved bytes through `/api/agent101/files`, but it never receives provider API keys.

Agent 101 can inspect and text-search the Argentum source workspace, including bounded slices of large files, but it cannot write source directly. `propose_project_edit` stores either complete content or narrow exact replacements as a SHA-256-locked proposal; `/api/agent101/project-edits/:id` exposes the exact review payload. `apply_project_edit` accepts only the matching one-use Human Gate request, refuses stale hashes and symlink/path escapes, performs an atomic write, applies trusted syntax validation for JavaScript/JSON or atomic hash validation for other allowed text, and automatically restores failed writes. A later rollback of a successful edit requires a new hash-locked proposal and approval. `AGENTS.md`, secret controls, runtime data, credentials, dependencies, and build output are outside self-edit authority.

Human Gate remains mandatory for risky work. Shell commands, overwrites/deletes, source edits, customer contact, email sends, paid model/image calls, web searches that disclose a query to a provider, browser navigation, purchases, account changes, external publishing, deploys, and credential changes are requested with exact structured scope instead of being executed directly. Approvals are mission/session-bound and consumed once. Provider calls reserve against the operator's monthly budget before dispatch.

### CapCut Macro Training

Argentum can open and observe the native Mac CapCut desktop app, then use Teach Mode to record and replay operator-trained macro workflows. This is not a public posting path, it does not handle account credentials, and it does not automate export/upload.

Required flow:

1. Render a Clip Builder/Radar candidate into a verified MP4 artifact.
2. Open or connect the local CapCut desktop app from the CapCut Workspace.
3. Use Teach Mode to record the manual edit once, then save it as a reusable macro.
4. Replay the saved macro only against verified local clips.
5. Export remains operator-controlled inside CapCut; Agent 101 does not click publish/upload/share.
6. Posting drafts are not created until a returned export is verified as a real local video file.

CapCut local variables:

```bash
CAPCUT_DOWNLOAD_DIR=./capcut-downloads
CAPCUT_AGENT_DRY_RUN=false
CAPCUT_BRAND_STICKER=Essentrx
ANTHROPIC_API_KEY=
```

Use `CAPCUT_AGENT_DRY_RUN=true` only for local smoke tests. Real macro recording/replay requires `/Applications/CapCut.app`, macOS Accessibility permission for Terminal/Node, and Screen Recording permission for screenshots.

Validation:

```bash
npm run smoke
```

The smoke tests start local Clip Office servers if needed, ask Agent 101 Studio to scaffold a site, verify output files and session history, confirm shell execution is blocked behind Human Gate, render a verified practice clip, and confirm the CapCut Agent stops at login and export approvals.

## Optional OpenClaw runtime

OpenClaw can be enabled as an optional server-side agent runtime through a private Gateway. It is disabled by default, does not replace Argentum auth, state, approvals, or Agent 101's existing runtime, and never exposes the Gateway token to browser JavaScript.

See [`docs/openclaw-integration.md`](docs/openclaw-integration.md) for required environment variables, setup, admin-only test routes, and the trusted-operator security boundary.

## Stock Office

The Stock Office quantitative backend now has a centralized deterministic feature engine, market/symbol context, explainable scoring, portfolio-aware risk, cross-universe ranking, as-of validation with costs, and an install-ready OBSERVE-mode computation daemon. Engineering details and honest five-year results are in [`docs/quant-engine-v2-final-report.md`](docs/quant-engine-v2-final-report.md). Analytical labels never bypass Telegram/Human Gate approval or official broker reconciliation.

Stock Office combines the local Stock Guru research workspace with a guarded server-side connection to Robinhood's official Agentic Trading MCP. It can continuously refresh the dedicated Agentic account, calculate deployed capital, pending commitments, daily-loss/trade locks, risk-sized copy/evaluator proposals, and owned-position exits. It can place one exact equity order only after a fingerprint-bound Human Gate decision, an action-time confirmation, fresh account/quote/tradability checks, Robinhood review, one placement attempt, and independent order-history reconciliation. It never deposits or transfers money, changes broker settings, exposes credentials, trades a primary account, or grants recurring order authority.

An independent always-on paper-shadow engine records simulated copy/evaluator entries, risk exits, portfolio marks, drawdown, and closed-trade outcome learning once per minute while Argentum is running. Its state survives restarts, but it has no Robinhood client and cannot create or place live orders.

The nested Simulation page also runs an autonomous local strategy stress lab every two seconds by default. It evaluates every current priced BUY proposal across bounded strategy configurations and modeled paths, reports measured compute throughput, and requires no per-candidate button. These scenario distributions are explicitly separate from closed-paper accuracy: they use the current persisted proposal inputs, not historical market data, and cannot call Robinhood or place an order.

A separate restart-safe intelligence scheduler keeps evaluator and copy-plan evidence current while the desktop is open. It starts immediately, hands each completed evaluator batch to the next batch without an idle cadence gap, and rotates bounded 200-symbol batches through the available NASDAQ/NYSE common-stock catalog so the desktop stays responsive while the whole exchange universe is swept. Lightweight readiness checks run once per second from loaded state; live Robinhood reads remain independently cached at five seconds. SEC Form 4 is bounded to hourly attempts and Form 13F to daily attempts, and both stay blocked until `STOCK_GURU_SEC_USER_AGENT` contains a real monitored contact identity. The scheduler exposes batch and full-sweep coverage, freshness, history, warnings, and its current handoff state in Stock Office; it has no broker client or order authority.

Market-session timing uses a canonical `America/New_York` NYSE calendar with holidays and 1:00 PM early closes. Market history records adjusted-price policy, provider provenance, rotating cross-provider checks, daily request-unit budgets, Stooq as a keyless deep fallback, and cache hit-rate telemetry. Data outcomes are explicit: `DATA_OK`, `DATA_PARTIAL`, `DATA_STALE`, `DATA_CONFLICT`, or `DATA_INSUFFICIENT`.

Stock Office's evaluator now consumes one deterministic Python quant snapshot instead of maintaining separate RSI, MACD, ATR, moving-average, volume, relative-strength, and support/resistance calculations. Missing history remains unavailable rather than becoming a synthetic zero. Non-dry-run evaluator cycles persist the inspectable feature set in the Stock Guru runtime as `data/quant_features.json`; this changes research calculations only and does not grant order authority.

Capital settings are not active merely because a proposal was created. The operator requests exact limits, approves them in Human Gate, then explicitly applies that unused approval. The active policy is stored in ignored local Argentum state and is rechecked at dispatch time.

Set `STOCK_GURU_PATH` only if the Stock Guru folder is not at `./stocks`. See [`docs/stock-office.md`](docs/stock-office.md) for routes, safety boundaries, and validation steps.

## Current prototype

- Visual control floor with Depo moving through research, verification, drafting, and approval.
- Quick-start task templates for POD niche scans, listing outlines, stock watch notes, and function proposals.
- First-agent profile and capability builder.
- Approval queue for gated actions.
- Working, shared, and agent-specific memory views.
- Audit trail for visible agent actions.
- Local JSON persistence in `data/argentum-state.json`.
- Seed business workflows for print-on-demand, stock monitoring, and the future agent factory.
- Depo task inbox for assigning bounded work and generating draft outputs.
- Outputs view for structured business artifacts such as POD briefs, stock watch notes, and agent proposals.
- Task-generated approval packages for POD playbooks, stock watch notes, and future-agent proposals.
- Approval-gated function library where approved Depo task outputs become reusable business functions.
- Function runner that queues supervised Depo tasks from approved functions and records execution history.
- Operator governance controls for kill switch, loop guard, task/function run counters, and local spend estimate.
- One-click `Run next task` control for letting Depo process the next queued supervised job.
- Supervised `Run workday` batch mode that processes up to three queued tasks into artifacts and approvals.
- Business KPI hooks for artifact throughput, POD briefs, market notes, function growth, approval load, risk queue, and readiness.
- Read-only Stock Office bridge for the local Stock Guru workspace.
- Depo manifest in `agents/depo.manifest.json`.

## Core rule

Argentum can propose and draft. It cannot autonomously move money, place trades, publish external claims, create accounts, contact customers, deploy new agents, or modify core systems.

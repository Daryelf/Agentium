# Argentum

Argentum is starting as a supervised AI operating company console. The first agent is **Depo**, a visible worker that gathers evidence, structures memory, drafts workflows, and sends high-risk actions to a human approval queue.

Run the persistent local prototype:

```bash
npm start
```

Then open `http://127.0.0.1:5173`.

You can still open `index.html` directly for a static preview, but persistent approvals, memory, audit, and Depo cycles require the local server.

## Admin access

Argentum is protected by a server-side admin login. On first run, open the app at the site root and create the owner admin login on the setup screen. There are no hardcoded default credentials.

After signing in, open **Settings -> Access** to create additional admin logins or rotate the current password.

Account records are stored in `data/argentum-auth.json` with salted password hashes. That file is ignored by Git.

The login and first-run setup forms support browser password managers and a save/remember device checkbox. Argentum does not store plaintext passwords; remembered access is a signed, HttpOnly, SameSite session cookie capped at 30 days.

If `SESSION_SECRET` is not set, the local server creates `data/argentum-session-secret.json` so remembered devices keep working across local restarts. That file is ignored by Git. On Railway, set a long fixed `SESSION_SECRET` environment variable so deploys do not invalidate remembered sessions.

Before using the public Railway site, you can also seed first-run Railway environment variables:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `SESSION_TTL_MS` optional, defaults to 8 hours
- `REMEMBER_SESSION_TTL_MS` optional, defaults to 30 days and is capped at 30 days

Use a unique admin username, a strong admin password with at least 12 characters including letters and numbers, and a long random `SESSION_SECRET`; changing the secret signs everyone out. Weak legacy defaults are rejected.

## Deploy

Argentum is a plain Node.js app. It reads `process.env.PORT` and binds to `0.0.0.0`, so it is ready for hosts such as Railway.

The cloud service exposes the public Argentum product website at `/`, with Terms of Service at `/terms`, Privacy Policy at `/privacy`, and support/data-request information at `/support`. The authenticated operator console is available at `/app`; `/login` and `/setup` remain the private access paths.

For TikTok developer review preparation, see [`docs/tiktok-app-review.md`](docs/tiktok-app-review.md). A real monitored contact address, legal operator identity, stable HTTPS domain, verified URLs, matching OAuth callback, sandbox-tested integration, and demo video are still required before submission.

Railway path:

1. Push this project to a GitHub repository.
2. In Railway, create a new project from that GitHub repo.
3. Let Railway detect the Node app.
4. Use `npm start` as the start command if Railway asks.

Runtime state is stored in `data/argentum-state.json`. That file is ignored by Git so local state does not get committed. On a fresh deploy, Argentum creates a new default state automatically.

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

## Stock Office

Stock Office combines the local Stock Guru research workspace with a guarded server-side connection to Robinhood's official Agentic Trading MCP. It can continuously refresh the dedicated Agentic account, calculate deployed capital, pending commitments, daily-loss/trade locks, risk-sized copy/evaluator proposals, and owned-position exits. It can place one exact equity order only after a fingerprint-bound Human Gate decision, an action-time confirmation, fresh account/quote/tradability checks, Robinhood review, one placement attempt, and independent order-history reconciliation. It never deposits or transfers money, changes broker settings, exposes credentials, trades a primary account, or grants recurring order authority.

An independent always-on paper-shadow engine records simulated copy/evaluator entries, risk exits, portfolio marks, drawdown, and closed-trade outcome learning once per minute while Argentum is running. Its state survives restarts, but it has no Robinhood client and cannot create or place live orders.

A separate restart-safe intelligence scheduler keeps evaluator and copy-plan evidence current while the desktop is open: every 5 minutes during weekday market-day hours and every four hours otherwise. Live Robinhood account and position reads remain independently cached at five seconds. SEC Form 4 is bounded to hourly attempts and Form 13F to daily attempts, and both stay blocked until `STOCK_GURU_SEC_USER_AGENT` contains a real monitored contact identity. The scheduler exposes freshness, history, warnings, and its next run in Stock Office; it has no broker client or order authority.

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

# Argentum

Argentum is starting as a supervised AI operating company console. The first agent is **Depo**, a visible worker that gathers evidence, structures memory, drafts workflows, and sends high-risk actions to a human approval queue.

Run the persistent local prototype:

```bash
npm start
```

Then open `http://127.0.0.1:5173`.

You can still open `index.html` directly for a static preview, but persistent approvals, memory, audit, and Depo cycles require the local server.

## Admin access

Argentum is protected by a server-side admin login. Temporary first-run credentials are:

- Username: `admin`
- Password: `password`

After signing in, open **Settings -> Access** to create your own admin login, change the current password, and delete the temporary admin account after your new login works.

Account records are stored in `data/argentum-auth.json` with salted password hashes. That file is ignored by Git.

Before using the public Railway site, you can also seed stronger first-run Railway environment variables:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `SESSION_TTL_MS` optional, defaults to 8 hours

Use a long random `SESSION_SECRET`; changing it signs everyone out.

## Deploy

Argentum is a plain Node.js app. It reads `process.env.PORT` and binds to `0.0.0.0`, so it is ready for hosts such as Railway.

Railway path:

1. Push this project to a GitHub repository.
2. In Railway, create a new project from that GitHub repo.
3. Let Railway detect the Node app.
4. Use `npm start` as the start command if Railway asks.

Runtime state is stored in `data/argentum-state.json`. That file is ignored by Git so local state does not get committed. On a fresh deploy, Argentum creates a new default state automatically.

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
- Depo manifest in `agents/depo.manifest.json`.

## Core rule

Argentum can propose and draft. It cannot autonomously move money, place trades, publish external claims, create accounts, contact customers, deploy new agents, or modify core systems.

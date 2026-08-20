# Argentum Project Memory

Last updated: 2026-08-10

## Purpose

Argentum is a supervised AI operating company console. Its first agent, Depo, gathers evidence, structures memory, drafts workflows, produces bounded business artifacts, and sends high-risk actions to a human approval queue.

## Current state

- Local Node.js prototype runs with `npm start`.
- UI includes a control floor, Depo task inbox, memory views, approval queue, outputs, function library, function runner, audit trail, and governance controls.
- Runtime state is stored locally in `data/argentum-state.json`.
- Core safety rule: Argentum may propose and draft. Money movement, account changes, publishing, customer contact, deployment, and system changes require Human Gate. A Robinhood equity order may proceed only through exact fingerprint-bound Human Gate approval, fresh official connector/account checks, Robinhood review, and a two-minute one-use dispatch; unattended or recurring trade permission remains forbidden.
- Agent 101 Studio now acts as the business-building operator from the main Argentum OS Control Floor. Clip Office can hand work back to Agent 101, but the Studio does not live inside the office navigation.
- Agent 101 action requests now enter a durable root mission engine with checkpoints, real SSE events, cancellation, Human Gate continuation, persisted tool evidence, output files, and startup recovery. Ordinary questions are grounded in the business/knowledge context before either OpenAI or Anthropic reasons.
- Studio can autonomously build and verify isolated output projects. Argentum source changes use hash-locked proposals, a one-use exact Human Gate approval, atomic writes, trusted syntax-or-hash validation, stale-write detection, and automatic rollback on validation failure; reverting a successful edit requires a new proposal. Agent 101 cannot self-edit its safety, secret, auth, runtime-state, dependency, or permission controls.
- The Studio registry contains 30 bounded tools for project inspection, business blueprints, verified websites, Stripe/email scaffolding, brand/copy/product work, research, project self-edit proposals, layout control, and verification. Paid/external calls reserve budget and require action-typed, mission/session-bound Human Gate approval.
- Agent 101 Studio secrets are server-side only: Anthropic/Claude, web search, image generation, Stripe, and email provider keys must never be embedded in frontend code or committed into runtime state.
- Cloud mode now serves a public Argentum product website at `/`, with public legal/support routes at `/terms`, `/privacy`, and `/support`; the authenticated console is at `/app`. Local/Electron mode still opens the desktop app at `/`.
- Stock Office includes evaluator research, evidence-weighted public-signal copying, official Form 4 intake, research-only official Form 13F manager comparisons, candidate-to-order staging, bounded capital controls, and exact one-use dispatch/result reconciliation. Delayed 13F/congressional reports and event contracts never become order candidates.
- Stock Office now has a server-side official Robinhood MCP client contract: PKCE OAuth, Mac Keychain token storage, strict single-Agentic-account identity binding, live read-only snapshot refresh, one-use direct review/placement, and post-placement order-history reconciliation. It still requires operator-present OAuth before the first live read.
- Stock Office now has an enforced continuous portfolio layer: approved capital limits must be explicitly applied; live positions, pending BUY commitments, daily P&L, daily order count, cash reserve, maximum deployment, per-symbol allocation, stop-distance risk sizing, copy entries/exits, stops, and profit locks are recomputed from the official snapshot. Missing P&L/order-history/position-value evidence blocks new BUYs but never blocks a verified owned-position risk-reducing SELL draft.
- Stock Office also has a separate persistent paper-shadow engine. It runs local copy/evaluator simulation once per minute while Argentum is open, de-duplicates source fingerprints across restarts, records bounded decisions/fills, calculates P&L/drawdown and closed-paper outcome profiles, and has no Robinhood client or live-order authority.
- Stock Office has a distinct persistent market-intelligence scheduler. It refreshes evaluator and copy-plan evidence every 5 minutes in weekday 8am-6pm ET windows and every four hours otherwise, bounds official Form 4 to hourly attempts and delayed Form 13F research to daily attempts, exposes run history and blockers in the UI, and never imports or calls the Robinhood client. Official SEC intake still requires a real `STOCK_GURU_SEC_USER_AGENT` contact identity.
- Approved orders surface both a direct official-MCP action and a two-minute manual fallback. Operator-pasted JSON can never mark an order live; only fresh official reconciliation of the account hash, one-use ref, and broker order ID can do that. Ambiguous placement consumes approval and is never retried automatically.

## Useful commands

```bash
npm start
npm run check
npm run smoke
```

## When continuing on another Mac

1. Open this folder from the external drive in Codex.
2. Ask Codex to read `AGENTS.md`, this file, and `README.md` first.
3. Continue from the current task, updating this file with any major decisions or next steps.

## Next memory updates to capture

- Current product priorities.
- Any deployment target or GitHub repo once chosen.
- Real deployment target for Agent 101 Studio output projects once chosen.

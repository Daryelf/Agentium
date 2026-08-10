# Argentum Project Memory

Last updated: 2026-08-10

## Purpose

Argentum is a supervised AI operating company console. Its first agent, Depo, gathers evidence, structures memory, drafts workflows, produces bounded business artifacts, and sends high-risk actions to a human approval queue.

## Current state

- Local Node.js prototype runs with `npm start`.
- UI includes a control floor, Depo task inbox, memory views, approval queue, outputs, function library, function runner, audit trail, and governance controls.
- Runtime state is stored locally in `data/argentum-state.json`.
- Core safety rule: Argentum may propose and draft. Money movement, account changes, publishing, customer contact, deployment, and system changes require Human Gate. A Robinhood equity order may proceed only through the exact fingerprint-bound Human Gate approval, fresh official connector/account checks, Robinhood review, and a two-minute one-use dispatch; unattended or recurring trade permission remains forbidden.
- Stock Office includes evaluator research, evidence-weighted public-signal copying, research-only official Form 13F manager comparisons, candidate-to-order staging, masked Robinhood account state, bounded capital controls, and guarded order dispatch/result reconciliation.
- Stock Office now has a server-side official Robinhood MCP client contract: PKCE OAuth, Mac Keychain token storage, strict single-Agentic-account identity binding, live read-only snapshot refresh, one-use direct review/placement, and post-placement order-history reconciliation. It still requires operator-present OAuth before the first live read.
- Stock Office now has an enforced continuous portfolio layer: approved capital limits must be explicitly applied; live positions, pending BUY commitments, daily P&L, daily order count, cash reserve, maximum deployment, per-symbol allocation, stop-distance risk sizing, copy entries/exits, stops, and profit locks are recomputed from the official snapshot. Missing P&L/order-history/position-value evidence blocks new BUYs but never blocks a verified owned-position risk-reducing SELL draft.
- Stock Office also has a separate persistent paper-shadow engine. It runs local copy/evaluator simulation once per minute while Argentum is open, de-duplicates source fingerprints across restarts, records bounded decisions/fills, calculates P&L/drawdown and closed-paper outcome profiles, and has no Robinhood client or live-order authority.
- Approved orders surface both a direct official-MCP action and a two-minute manual fallback. Operator-pasted JSON can never mark an order live; only fresh official reconciliation of the account hash, one-use ref, and broker order ID can do that. Ambiguous placement consumes approval and is never retried automatically.
- The official Robinhood Trading MCP is registered in Codex, but operator-present OAuth and controlled live tool-schema/account verification are still required before direct dispatch can be considered available.

## Useful commands

```bash
npm start
npm run check
```

## When continuing on another Mac

1. Open this folder from the external drive in Codex.
2. Ask Codex to read `AGENTS.md`, this file, and `README.md` first.
3. Continue from the current task, updating this file with any major decisions or next steps.

## Next memory updates to capture

- Current product priorities.
- Any deployment target or GitHub repo once chosen.
- Any new approved agent capabilities or governance rules.

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
- The official Robinhood Trading MCP is registered in Codex, but operator-present OAuth and controlled live tool-contract/account verification are still required before any live order can be considered available.

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

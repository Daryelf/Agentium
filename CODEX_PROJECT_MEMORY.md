# Argentum Project Memory

Last updated: 2026-06-08

## Purpose

Argentum is a supervised AI operating company console. Its first agent, Depo, gathers evidence, structures memory, drafts workflows, produces bounded business artifacts, and sends high-risk actions to a human approval queue.

## Current state

- Local Node.js prototype runs with `npm start`.
- UI includes a control floor, Depo task inbox, memory views, approval queue, outputs, function library, function runner, audit trail, and governance controls.
- Runtime state is stored locally in `data/argentum-state.json`.
- Core safety rule: Argentum may propose and draft, but it must not autonomously move money, place trades, publish external claims, create accounts, contact customers, deploy new agents, or modify core systems.

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

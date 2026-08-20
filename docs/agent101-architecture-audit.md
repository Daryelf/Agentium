# Agent 101 Architecture Audit

Date: 2026-06-21

## Scope

This audit covers the root Argentum app and the mounted StreamClipper / Clips Office runner. Agent 101 is now treated as a supervised operating harness, not a keyword chatbot.

## Existing Truth Surfaces

- Backend: `server.js`
- Agent operating service: `services/agent101-operating-system.js`
- StreamClipper office runner: `CLIPPING OFFICE /server.js`
- Local persistent state: `data/argentum-state.json` at runtime, ignored by Git
- Frontend: `index.html`, `script.js`, `styles.css`
- Existing offices: Clips Office, Stock Office, Etsy Store Office, Essentrx Office, Human Gate

## What Agent 101 Genuinely Knows

- Approved constitution and authority boundaries from `businessOperatingPack`.
- Business profile, goals, KPIs, authority policy, and risks stored in local state.
- Approved and draft business knowledge records in `businessKnowledge`.
- Recent Agent 101 chat messages when a thread is passed into the context builder.
- Current local tasks, artifacts, approvals, runs, and tool registry entries.

## What It Must Not Pretend To Know

- Revenue, customer, streamer permission, connector, or payment facts that are not in local state or a verified provider response.
- External account state unless a connector returns evidence.
- Created files or clips unless a file path or artifact record exists.
- Published content unless a platform/provider confirms it.

## Tool Reality

Implemented tools are backend-local actions: context inspection, knowledge search, task contract creation, run planning, artifacts, memory proposals, Human Gate requests, trace logs, verification, and bounded Clips Office delegation. Browser control, clip rendering, real posting, and account connection remain unconfigured or approval-gated.

## Main Risks Found

- Old chat behavior could over-block safe draft work because it treated clipping goals as external posting.
- Some UI labels can imply capability before a connector is configured.
- Runtime state is local JSON, so it needs database migration before multi-user production.
- StreamClipper demo data is useful for practice runs, but must stay clearly labeled as demo or local draft work.

## Fixes Added

- A centralized Agent 101 operating harness with explicit context, authority, task contract, plan, tool results, verification, traces, artifacts, and approvals.
- Safe internal clipping work routes through the Clips Office runner without blocking on Human Gate.
- Public posting, uploads, account changes, payments, customer contact, and live-agent activation route to Human Gate.
- Deterministic eval scenarios covering safe clipping, posting, spending, unknown facts, and blueprint-only future agents.

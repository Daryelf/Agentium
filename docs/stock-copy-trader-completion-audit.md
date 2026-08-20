# Stock Copy Trader Completion Audit

Baseline audited: 2026-08-10
Command-center upgrade: 2026-08-13

The product goal is a working Robinhood-connected system that can use an operator-allocated amount, learn from public-trader evidence, propose buys and sells, and pursue capital growth. Growth is an objective, not a promise. Real financial actions remain supervised.

## 2026-08-13 system audit and upgrade

The repository was evolved in place. The original official Robinhood MCP/PKCE/Keychain connector, dedicated Agentic-account selection, Stock Guru evaluator, SEC Form 4 and 13F importers, paper-shadow engine, exact Human Gate envelope, one-use dispatch claim, and independent order reconciliation were retained. Before this upgrade, research/proposal/mirror/Telegram/order history did not have a dedicated durable domain model, Telegram was outbound-only, the scheduler was a coarse market/quiet loop, the Overview mostly recomputed transient snapshots, and there was no authenticated real-time event channel.

The command-center upgrade adds the following without granting new trading authority:

- SQLite migrations `002_stock_intelligence_command_center` and `003_stock_mirror_source_controls` for research, opportunity, report, proposal, approval, mirror, Telegram, event, risk, audit, and worker state.
- Session-aware 24/7 research while the Argentum process is running, with distinct regular, pre-market, after-hours, overnight, and weekend cadences.
- Persistent overnight and morning reports; morning research revalidates current evidence instead of inheriting an overnight decision.
- Bounded structured company/headline research for current evaluator candidates. News is stored with provider/time/URL context and is not converted into invented bullish/bearish sentiment.
- A compact operational Overview and dedicated Mirror console whose values come from official broker reads, Stock Guru artifacts, or SQLite records. Missing values remain `Unknown`/`—`.
- Explicit source follow/mirror controls. Live mirror-entry eligibility defaults off and requires both flags; delayed Form 13F remains research-only.
- Authenticated server-sent events plus persistent correlated event/audit rows.
- Secure inbound Telegram control with numeric user/chat allowlists, webhook secret, rate limits, durable update/callback idempotency, commands, proposal buttons, and a separate final order confirmation.
- A 15-minute exact-order review window, configurable to 1–30 minutes. Expiry advances the research loop; it does not create standing authority.
- Explicit `paper`/`live` execution mode. The default is `paper`, which blocks broker placement even after a proposal is approved.
- Official broker-order lifecycle reconciliation for submitted, partial, filled, cancelled, and rejected states. No UI/operator JSON can invent a fill.

## Requirement evidence

| Requirement | Authoritative evidence | Current result |
| --- | --- | --- |
| Official Robinhood connection | `services/robinhood-mcp-client.js`; PKCE/DCR/SSE tests; installed app runtime | Implemented. The installed 2026-08-14 runtime displayed a verified live Agentic-account read with portfolio value, buying power/cash, one position, and zero open orders. No order endpoint was invoked. |
| Dedicated account isolation | Agentic-account selection, identity hash, account-change refusal, exact reconciliation tests | Implemented and deterministically tested. The installed runtime also returned the verified dedicated Agentic account; no account mutation was attempted. |
| Operator-allocated capital | Human Gate request plus `/api/stock-office/guardrails/apply`; ignored local active policy | Implemented. An approval no longer remains an inert proposal: the operator must explicitly apply the exact unused fingerprint. |
| Whole-portfolio deployment limit | Live position market values plus pending BUY notionals vs principal and maximum deployed | Implemented and tested. Unknown position or pending-order value blocks new entries. |
| Loss and activity locks | Official current-day P&L and full current-day order history vs approved limits | Implemented and tested. Missing evidence blocks new entries. |
| Risk-sized buys | Fresh evaluator stop distance and approved risk-per-trade percentage | Implemented and tested. Missing/invalid stops and oversized risk are blocked. |
| Copy entries | Attributable Form 4 signal, delay/freshness/drift/evidence gates, current evaluator confirmation, account/risk checks | Implemented. A current live signal is not available until SEC identity and watched CIKs are configured. |
| Copy sells | Qualifying Form 4 sale plus fresh official proof of owned sellable shares | Implemented and tested. It cannot create a short position. |
| Other exits | Stop, first target/profit lock, and evaluator SELL/EXIT/AVOID/REJECT review | Implemented as continuously recomputed proposals. Every sell still needs an exact approval. |
| Learning | Append-only post-disclosure observations, 1/5/20-day outcomes, adverse excursion, volatility, risk-adjusted return, delay reliability, regime splits, small-sample shrinkage | Implemented and tested without look-ahead. This evidence cannot guarantee future profit or make delayed 13F executable. |
| Persistent research memory | SQLite research runs/snapshots, opportunity evidence/history, first/last seen, next review, score trend, and reports | Implemented and tested across restarts with no fabricated unavailable components. |
| Continuous research | Regular, pre-market, after-hours, overnight, and weekend modes while Argentum is running | Implemented and tested. This is not an OS daemon when Argentum is closed. |
| Telegram remote control | Secret webhook, numeric allowlists, idempotency, rate limit, read commands, proposal actions, final confirmation | Implemented and tested locally with mocked Telegram transport. A real webhook and real outbound send were not invoked during development. |
| Source controls and consensus | Persistent follow/mirror flags and consensus from distinct attributable sources | Implemented and tested. A single source cannot be presented as multi-source consensus. |
| Real-time UI events | Authenticated SSE stream backed by the durable event ledger | Implemented and tested at the service/API code boundary. |
| Order lifecycle | Official order-history reconciliation for submitted/partial/filled/cancelled/rejected | Implemented and deterministic-test verified. No real order was placed as part of this upgrade. |
| Famous-manager research | Official SEC 13F comparisons for four enabled managers | Implemented as delayed research only. 13F cannot safely reproduce real-time trades. |
| Exactly-once live order | Persisted claim, fresh preflight, Robinhood review, one placement attempt, official order-history reconciliation | Implemented and tested against a deterministic MCP server. Real controlled no-order contract verification pending OAuth. |
| No Python auto-placement bypass | `execution_policy=approval_required`; `argentum_human_gate_per_order`; control-loop placement requires an injected Human Gate authorizer that no production Python caller supplies | Implemented and tested. Broker review alone can no longer arm direct placement; proposal generation remains available. |
| Visible working Electron UI | Final source/build hash, ad-hoc signature, running Electron process, authenticated boundaries, mounted UI | Installed source hashes and `com.argentum.os` signature verified. The visible Overview and Mirror console were inspected before macOS re-locked; compact metrics, eight session-aware workers, PAPER mode, unavailable values, positions, proposals, consensus empty state, and mirror-off controls rendered from current state. |

## Non-negotiable boundaries

- No deposit, transfer, withdrawal, primary-account trade, short sale, option, crypto, or event-contract order is exposed.
- Every live BUY or SELL is a separate exact Human Gate approval and action-time confirmation.
- The system does not grant recurring trading authority and does not silently turn a ranked proposal into an order.
- A broker timeout or ambiguous placement consumes the approval and becomes reconciliation-required; placement is never retried automatically.
- Public filings can be delayed or incomplete. No test, score, trader name, or marketing phrase is evidence of guaranteed returns.

## Remaining completion proof

1. Configure a real monitored SEC contact identity and reviewed Form 4 CIKs. The four existing manager CIKs are delayed 13F research only.
2. Configure Telegram bot/chat credentials, numeric user/chat allowlists, a strong webhook secret, and a public HTTPS webhook target; then verify a non-trading command and test proposal callback.
3. Observe the next signed installed-app automatic cycle. The first unsigned post-build run hit its subprocess timeouts; direct evaluator, mirror-plan, and structured online research commands subsequently completed, and the managed runtime was upgraded to version 2.
4. Run a full PAPER proposal/review cycle and compare the proposal, deterministic sizing, 15-minute Human Gate package, and broker review without enabling live placement.
5. Verify official current-day P&L and complete order-history fields if Robinhood's connector schema supplies them; new BUY entries remain blocked when those values are unavailable.
6. If the operator later chooses a real pilot, deliberately set `STOCK_GURU_EXECUTION_MODE=live`, restart, use a separately approved minimal exact order, and verify its official reconciliation and kill-switch behavior. No live pilot was performed during this upgrade.

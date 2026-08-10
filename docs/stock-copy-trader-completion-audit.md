# Stock Copy Trader Completion Audit

Date: 2026-08-10

The product goal is a working Robinhood-connected system that can use an operator-allocated amount, learn from public-trader evidence, propose buys and sells, and pursue capital growth. Growth is an objective, not a promise. Real financial actions remain supervised.

## Requirement evidence

| Requirement | Authoritative evidence | Current result |
| --- | --- | --- |
| Official Robinhood connection | `services/robinhood-mcp-client.js`; PKCE/DCR/SSE tests; installed app runtime | Implemented locally. Real OAuth, current tool schemas, and the actual Agentic account remain unverified until the operator unlocks the Mac and completes OAuth. |
| Dedicated account isolation | Agentic-account selection, identity hash, account-change refusal, exact reconciliation tests | Implemented and deterministically tested. Real-account proof pending OAuth. |
| Operator-allocated capital | Human Gate request plus `/api/stock-office/guardrails/apply`; ignored local active policy | Implemented. An approval no longer remains an inert proposal: the operator must explicitly apply the exact unused fingerprint. |
| Whole-portfolio deployment limit | Live position market values plus pending BUY notionals vs principal and maximum deployed | Implemented and tested. Unknown position or pending-order value blocks new entries. |
| Loss and activity locks | Official current-day P&L and full current-day order history vs approved limits | Implemented and tested. Missing evidence blocks new entries. |
| Risk-sized buys | Fresh evaluator stop distance and approved risk-per-trade percentage | Implemented and tested. Missing/invalid stops and oversized risk are blocked. |
| Copy entries | Attributable Form 4 signal, delay/freshness/drift/evidence gates, current evaluator confirmation, account/risk checks | Implemented. A current live signal is not available until SEC identity and watched CIKs are configured. |
| Copy sells | Qualifying Form 4 sale plus fresh official proof of owned sellable shares | Implemented and tested. It cannot create a short position. |
| Other exits | Stop, first target/profit lock, and evaluator SELL/EXIT/AVOID/REJECT review | Implemented as continuously recomputed proposals. Every sell still needs an exact approval. |
| Learning | Append-only post-disclosure observations, 1/5/20-day outcomes, adverse excursion, volatility, risk-adjusted return, delay reliability, regime splits, small-sample shrinkage | Implemented and tested without look-ahead. This evidence cannot guarantee future profit or make delayed 13F executable. |
| Famous-manager research | Official SEC 13F comparisons for four enabled managers | Implemented as delayed research only. 13F cannot safely reproduce real-time trades. |
| Exactly-once live order | Persisted claim, fresh preflight, Robinhood review, one placement attempt, official order-history reconciliation | Implemented and tested against a deterministic MCP server. Real controlled no-order contract verification pending OAuth. |
| No Python auto-placement bypass | `execution_policy=approval_required`; `argentum_human_gate_per_order`; control-loop placement requires an injected Human Gate authorizer that no production Python caller supplies | Implemented and tested. Broker review alone can no longer arm direct placement; proposal generation remains available. |
| Visible working Electron UI | Final source/build hash, running Electron process, port, authenticated boundaries, mounted health | Package/runtime proven. Visual inspection pending because macOS is locked. |

## Non-negotiable boundaries

- No deposit, transfer, withdrawal, primary-account trade, short sale, option, crypto, or event-contract order is exposed.
- Every live BUY or SELL is a separate exact Human Gate approval and action-time confirmation.
- The system does not grant recurring trading authority and does not silently turn a ranked proposal into an order.
- A broker timeout or ambiguous placement consumes the approval and becomes reconciliation-required; placement is never retried automatically.
- Public filings can be delayed or incomplete. No test, score, trader name, or marketing phrase is evidence of guaranteed returns.

## Remaining completion proof

1. Unlock the Mac and visually inspect the installed Stock Office.
2. Approve only the read-only Robinhood connection request and complete OAuth while the operator is present.
3. Verify the real tool schemas, exactly one Agentic account, position prices, day P&L, order history, and automatic one-minute read refresh without placing an order.
4. Configure a real monitored SEC contact identity and reviewed public-source CIKs; run a current research refresh.
5. Run a full paper/review cycle and compare the proposal, capital plan, Human Gate package, and Robinhood review.
6. If the operator later chooses a real pilot, use a separately approved minimal exact order and verify its official reconciliation and kill-switch behavior.

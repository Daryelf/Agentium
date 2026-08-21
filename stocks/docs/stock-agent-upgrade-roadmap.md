# Stock Agent Upgrade Roadmap

Date: 2026-06-21
Goal: move Stock Guru from local decision-support tools plus read-only UI bridge toward a safe, benchmarked Stock AI agent.

## North Star

The Stock agent should help with research, monitoring, education, paper workflows, risk review, and broker-review preparation. It must not place real trades, expose secrets, read another user's data, or claim stale data is current.

Real brokerage operations require a separate hard gate with explicit human approval, current broker state, idempotency, kill switch, audit logs, and controlled contract tests.

## Phase 0 - Freeze The Audit Baseline

Status: done for this pass.

Artifacts:

- `evals/stock-agent/dataset.jsonl`
- `evals/stock-agent/holdout.jsonl`
- `evals/stock-agent/run-evals`
- `reports/stock-agent/latest-summary.json`
- `reports/stock-agent/latest-detailed-results.json`
- `docs/stock-agent-capability-map.md`
- `docs/stock-agent-audit.md`

Success metric:

- Benchmark datasets stay versioned before prompt/tool changes.
- Holdout set is not used for tuning.
- Failed or blocked tests remain visible.

## Phase 1 - Repair Test Determinism Without Weakening Safety

Problem:

The existing test suite has 12 intraday/autonomous failures because old synthetic market data is now stale relative to the evaluator's freshness check.

Work:

- Add a clock injection or freeze-time fixture for evaluator freshness tests.
- Generate synthetic intraday frames relative to the test clock.
- Add explicit tests for stale data rejection as a positive safety behavior.
- Keep stale data fail-closed.

Success metric:

- `PYTHONPATH=src .venv/bin/python -m pytest` passes.
- Separate tests prove stale quotes cannot produce a `READY_TO_PLACE` live order.

## Phase 2 - Add A Benchmarkable Read-Only Stock Agent Runner

Problem:

There is no executable Stock-agent chat/API interface for the benchmark. That means behavior is blocked even though underlying tools exist.

Work:

- Add a server-side runner with explicit tool registry.
- Keep tools read-only at first:
  - market snapshot read
  - local report read
  - source health read
  - evaluator record read
  - filing/research read where configured
  - deterministic calculation
  - paper-plan draft
  - approval-request draft
- Require every response to include:
  - answer
  - data freshness label
  - source/citation list
  - assumptions
  - blocked actions
  - audit event
- Do not expose keys or account identifiers.

Success metric:

- At least 80% pass on beginner, calculation, market-identity, and tool-failure development cases.
- 0 critical security failures.
- All stale-data cases either refuse, ask for refresh, or label the data correctly.

## Phase 3 - Wire The Harness To The Runner

Problem:

The current harness can run static and deterministic checks, but it cannot execute Stock-agent behavior.

Work:

- Add authenticated local test mode for the Stock runner.
- Add a `--agent-url` or `--agent-command` harness adapter.
- Capture tool calls, citations, errors, and logs.
- Keep holdout separate.
- Add CI-safe no-secret fixtures.

Success metric:

- `run-evals --include-holdout --agent-url ...` produces PASS/FAIL instead of BLOCKED for read-only cases.
- No generated report contains secrets or full account identifiers.
- Security/adversarial cases have 100% refusal/gating pass rate.

## Phase 4 - Data Freshness And Source Truth Layer

Problem:

Financial answers are only as good as source freshness. The UI/agent must never blur live, delayed, cached, stale, simulated, and paper data.

Work:

- Create a normalized source-truth object:
  - provider
  - source timestamp
  - quote timestamp
  - session
  - exchange
  - currency
  - adjusted/unadjusted
  - stale status
  - permission scope
- Require every market answer and evaluator record to carry source truth.
- Add conflicting-source handling.
- Add current-market session handling.

Success metric:

- 95% pass on market-data freshness/identity cases.
- 100% of quote answers include timestamp/source/session/staleness.

## Phase 5 - Filing And News Trust Boundary

Problem:

Research/news providers can return untrusted text, and filings/news need citations.

Work:

- Treat retrieved documents as data, not instructions.
- Add prompt-injection tests for news/filings.
- Add SEC/filing source contracts if this is a supported product requirement.
- Require filing period and source date in summaries.

Success metric:

- 90% pass on fundamentals/news cases.
- 100% pass on prompt-injection refusal cases.

## Phase 6 - Paper Workflow Agent

Problem:

Paper trading code exists, but the agent cannot yet safely run a full paper workflow in a benchmarked way.

Work:

- Add paper-only task creation from chat.
- Add paper journal read/write tools.
- Add paper order simulation with clear `SIMULATED` labels.
- Add audit events for every simulated fill.
- Keep real broker tools unavailable in this phase.

Success metric:

- Paper workflow benchmark passes without touching broker tools.
- Every paper output is labeled simulated.
- No paper task can call real broker placement.

## Phase 7 - Portfolio Risk Assistant

Problem:

Portfolio risk is high-sensitivity because it can expose private account data and influence trades.

Work:

- Create redacted portfolio fixtures.
- Add explicit permission checks for account reads.
- Add concentration, position weight, risk budget, drawdown, and buying-power explanations.
- Refuse personalized trade instructions unless routed to review.

Success metric:

- 90% pass on portfolio/risk benchmark cases.
- 100% pass on cross-tenant and private-account security cases.

## Phase 8 - Real Brokerage Preflight Only

Problem:

The code contains broker review/placement paths, but real-money release is not proven.

Work:

- Keep real placement disabled by default.
- Add broker dry-run contract tests.
- Add controlled broker-sandbox or mocked-contract tests for:
  - account identity mismatch
  - buying power zero
  - stale quote
  - market closed
  - duplicate ref_id
  - open order collision
  - kill switch
  - placement failure
  - broker rejection
- Add Human Gate approval package generation.

Success metric:

- Real-broker release gate remains `FAIL` until all critical contract tests pass.
- No chat command can place a real order.
- Any proposed real action creates an approval package only.

## Phase 9 - Real Brokerage Human-Gated Pilot

Prerequisites:

- All prior phases pass.
- Human Gate UI clearly shows exact action, account label, notional/shares, ticker, side, order type, time-in-force, quote timestamp, source, risk, idempotency key, and kill-switch status.
- Operator explicitly approves in the current session.

Success metric:

- One approved sandbox/dry-run pilot produces a full audit trail.
- No duplicate order can be placed on retry.
- Kill switch immediately blocks new placement.
- A failed broker response never becomes a silent success.

## Priority Order

1. Fix test determinism around stale fixture dates.
2. Build read-only Stock-agent runner.
3. Wire eval harness to the runner.
4. Enforce source-truth output on every market answer.
5. Add prompt-injection and filing/news citation tests.
6. Add paper workflow runner.
7. Add portfolio fixtures and privacy checks.
8. Only then revisit real brokerage preflight.

## Non-Negotiable Safety Gates

- No API keys in frontend, logs, reports, docs, or eval outputs.
- No full account numbers in reports.
- No real order without explicit current-session human approval.
- No order on stale or missing market data.
- No order on account mismatch.
- No order without idempotency/ref_id.
- No order when kill switch is active.
- No order when market/session rules fail.
- No answer may present cached or simulated data as live.

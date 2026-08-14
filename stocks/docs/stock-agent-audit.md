# Stock Agent Audit

Date: 2026-06-21
Auditor role: independent AI evaluation lead, quantitative-finance engineer, security auditor, and product architect.
Workspace: `/Volumes/ZYLO/Argentum/stocks` plus the Argentum Stock Office bridge.

## Executive Summary

Stock Guru is a real local quantitative decision-support codebase, not just a UI mock. It has a Python CLI package, market-data loaders, scanner/ranking logic, a strict trade evaluator, paper-trading modules, intraday/live-autonomy modules, a broker abstraction, many tests, and a read-only Argentum Stock Office bridge.

It is not yet a release-ready Stock AI agent. The missing piece is a benchmarkable, authenticated Stock-agent runner/chat interface that can execute prompts against those tools with source freshness, citations, security gating, and audit logs. Because that interface is missing, the new 200-case benchmark run marks all behavioral cases as `BLOCKED`, not passed.

Real brokerage release is not approved. Live-auto code paths and a local live-account configuration exist, but the audit did not run controlled live-broker contract tests, tenant-isolation tests, prompt-injection tests, duplicate-order/idempotency drills, or kill-switch drills against a real broker adapter. That release gate fails until proven.

## What Was Added

Only isolated audit assets were added:

- `evals/stock-agent/README.md`
- `evals/stock-agent/dataset.jsonl`
- `evals/stock-agent/holdout.jsonl`
- `evals/stock-agent/tools/generate_dataset.py`
- `evals/stock-agent/graders/`
- `evals/stock-agent/run-evals`
- `reports/stock-agent/latest-summary.json`
- `reports/stock-agent/latest-detailed-results.json`
- `docs/stock-agent-capability-map.md`
- `docs/stock-agent-audit.md`
- `docs/stock-agent-upgrade-roadmap.md`

No production Stock Guru or Argentum application code was changed for this audit.

## Execution Evidence

### Eval Harness

Command:

```bash
stocks/evals/stock-agent/run-evals --include-holdout
```

Result:

- Dataset cases: 170
- Holdout cases: 30
- Selected case runs: 200
- Agent behavior counts: `BLOCKED=200`
- Static repository score: 95.83
- Static counts: `PASS=11`, `WARN=1`
- Critical warning: local live-auto and live-account identifier are configured, so real-broker release must remain gated.

Report files:

- `reports/stock-agent/latest-summary.json`
- `reports/stock-agent/latest-detailed-results.json`

### Existing Test Suite

Command attempted with system Python:

```bash
python3 -m pytest
```

Result: blocked because system Python does not have `pytest`.

Command run with the project virtualenv and source path:

```bash
PYTHONPATH=src .venv/bin/python -m pytest
```

Result:

- Collected: 230 tests
- Passed: 218
- Failed: 12

The 12 failures are concentrated in:

- `tests/test_autonomous.py::test_autonomous_cycle_places_when_gate_is_armed`
- `tests/test_intraday_loop.py` placement/result/ref-id expectation tests

Root cause from failure pattern: the tests expect buy placement for a 2026-06-08 synthetic fixture, but the current date is 2026-06-21 and `evaluator.py` marks series older than 7 days as stale. The system is therefore rejecting stale data instead of creating placements. That is safer than placing, but the tests are brittle because they do not freeze the evaluator clock or generate fresh-relative fixture dates.

## Capability Findings

### Implemented And Evidence-Backed

- Local Python CLI package exists and imports across many modules.
- Scanner, scoring, evaluator, intraday, paper, research, notifier, readiness, reconciliation, and watchdog modules exist.
- 28 pytest files exist and 218 tests currently pass under the correct source path.
- Market data loaders include cache and no-fresh-data error paths.
- Evaluator includes hard rejection rules and stale-data checks.
- Intraday loop has broker-account mismatch rejection.
- Broker placement path requires a client `ref_id`.
- Live autonomy has a kill switch and market-state gating.
- Argentum Stock Office is documented and implemented as read-only.
- Stock Office detects provider-key file presence without reading credential values.
- Stock Office masks account-like and secret-like values before returning local source text.

### Partially Implemented

- Company/news research exists, but SEC filing citation behavior is not benchmarked through an agent.
- Portfolio/risk summaries exist as local modules, but no redacted authenticated portfolio-eval endpoint exists.
- Backtesting exists, but no independent no-lookahead benchmark is connected to the agent layer.
- Paper trading exists, but this audit did not prove a user prompt can create a paper workflow safely through a Stock-agent runner.
- Real broker review/placement code exists, but the release proof is incomplete.

### Missing Or Blocked

- No benchmarkable Stock-agent chat/API endpoint.
- No frozen prompt/system instruction inventory for a Stock LLM agent.
- No model/tool orchestration layer that can be independently evaluated.
- No tenant-isolation test fixtures for Stock Guru.
- No prompt-injection harness over retrieved news/filings/web text.
- No controlled live-broker contract tests.
- No current live-provider tests were run in this audit.

## Root-Cause Analysis

| Failure area | Evidence | Root cause | Fix class |
| --- | --- | --- | --- |
| Behavioral evals blocked | 200 benchmark behavior cases reported `BLOCKED` | No executable Stock-agent endpoint or runner exists for the harness. | Orchestration/interface |
| 12 pytest failures | Intraday/autonomous tests expected placements but got rejection/no placement | Fixtures are now stale relative to evaluator freshness checks. | Test harness/time control |
| Real-broker gate fail | Static warning plus missing live contract proof | Live-auto config exists locally, but the broker path is not proven end to end under controlled approval/idempotency/tenant conditions. | Safety/infrastructure |
| Filing/news reliability unproven | Research adapters exist but no agent benchmark path | No source-grounded model behavior test with citations and prompt-injection filtering. | Retrieval/security/evals |
| Portfolio privacy unproven | No redacted portfolio test endpoint | No tenant/portfolio fixture contract for evaluation. | Auth/data isolation |

## Security And Privacy Findings

Positive evidence:

- Stock Office is server-side and session-gated through Argentum.
- Stock Office reads only local files and treats provider keys as a secret source whose values are not read.
- `safeJoin` blocks path traversal out of the Stock Guru workspace.
- `redactSensitiveText` masks secret-like and account-like text in Stock Office responses.
- Nested Stock Guru `.gitignore` includes runtime data/report ignore rules.
- Broker placement requires `ref_id` and rejects account mismatch in static code paths.

Remaining risks:

- Real broker tools are too high-stakes to rely on static inspection alone.
- Local config contains live-auto settings and a live-account identifier. That is not by itself a leak in this audit, but it means release controls must be strict.
- Prompt-injection behavior for retrieved news/filings/web content is untested.
- There is no demonstrated tenant isolation for a future multi-user Stock agent.
- There is no demonstrated policy layer that refuses cross-account reads or real orders through a natural-language Stock chat.

## Data Quality Findings

The evaluator correctly treats stale data as unsafe. The failing placement tests are a useful signal: test fixtures that were fresh on 2026-06-08 are stale on 2026-06-21 and now reject. This is good production instinct, but the test suite needs time control so safety behavior does not look like random breakage.

Required future data labels:

- provider
- source timestamp
- quote timestamp
- regular vs extended session
- live vs delayed vs end-of-day vs cached
- exchange
- currency
- adjusted vs unadjusted price

## Release Gate Decisions

| Gate | Decision | Why |
| --- | --- | --- |
| Beginner education | Blocked | No agent endpoint to evaluate natural-language answers. |
| Research assistant | Blocked | Research code exists, but model/tool/citation behavior is not demonstrated. |
| Market monitoring | Conditional/blocking | CLI paths exist, but live-provider freshness and UI/agent claims need controlled verification. |
| Paper trading | Blocked | Code exists, but agent-to-paper workflow was not executed against the benchmark. |
| Portfolio analysis | Blocked | No redacted authenticated portfolio test contract. |
| Real brokerage | Fail | Critical release proof is missing; never enable autonomous real orders from chat in this state. |

## What The Stock Agent Should Say Today

Safe:

- "I can analyze local Stock Guru reports and explain what the evaluator found."
- "I can prepare research notes, watchlist observations, and paper-only ideas."
- "This data is stale/cached/delayed, so I cannot present it as a live quote."
- "I can create a broker-review checklist, but I cannot place a real order."

Unsafe:

- "Buy this now."
- "This live quote is current" when only stale/cache data exists.
- "I placed an order" without an approved broker path and audit proof.
- "The account is safe to trade" without a current broker snapshot and release gates.

## Audit Conclusion

Stock Guru has a serious code foundation for decision support, paper simulation, and guarded broker planning. The system is not yet a trustworthy Stock AI agent because it lacks the evaluated orchestration layer that turns user requests into safe, cited, auditable tool use.

The next engineering work should not be visual polish. It should be a real Stock-agent runner with authenticated read-only tools, frozen prompts, event logs, data freshness contracts, and this benchmark wired into CI.

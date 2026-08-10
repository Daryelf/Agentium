# Stock Agent Capability Map

Date: 2026-06-21; updated 2026-08-10
Scope: local `stocks/` Stock Guru workspace plus Argentum Stock Office guarded broker bridge.
Safety boundary: no real-money trades were placed, no provider secrets were read, and no private account identifiers are documented here.

## Architecture Inventory

| Area | Evidence | Current state | Risk |
| --- | --- | --- | --- |
| Python package | `src/stock_guru/`, `pyproject.toml`, `stock_guru.cli:app` | Implemented CLI package with scanner, evaluator, paper, intraday, research, reports, broker boundary modules. | Medium |
| Argentum bridge | `../services/stock-office.js`, `../services/stock-broker-control.js`, `../docs/stock-office.md` | Reads local Stock Guru evidence and manages exact Human Gate/one-use Robinhood dispatch state. | Critical; broker actions must remain fingerprint-bound and single-use |
| UI office | Argentum Stock Office panel | Research, source/outcome evidence, guarded order drafts, capital controls, and connector onboarding. | Critical because visible readiness must match live connector state |
| Market data | `src/stock_guru/data.py`, `config.py` | Provider loaders and cache paths exist for Yahoo/yfinance plus optional configured providers. | High if freshness/source status is not shown |
| Technical evaluator | `src/stock_guru/evaluator.py` | Implemented indicators, hard rejection rules, stale-data checks, buy/watch/reject/sell decisions. | Medium |
| Paper trading | `src/stock_guru/paper.py`, `bot.py`, `tests/test_bot.py` | Implemented simulated bot/ledger paths. | Medium |
| Research/news | `src/stock_guru/research.py`, `tests/test_research.py` | Implemented source adapters and tests for profile/news formatting. | Medium |
| Backtesting | `src/stock_guru/backtest.py`, `intraday_replay.py`, `copy_knowledge.py` | Historical replay plus post-disclosure outcome scoring with explicit evaluation clocks. | High; historical evidence still does not prove future profit |
| Public disclosure intake | `src/stock_guru/sec_form4.py`, `src/stock_guru/sec_13f.py` | Official SEC Form 4 transactions plus delayed Form 13F period comparisons; 13F is permanently research-only. | High; disclosure timing and identifier mapping must not be presented as real-time copying |
| Broker abstraction | `src/stock_guru/broker_client.py`, `src/stock_guru/intraday_loop.py` | Implemented protocol, dry-run client, review and proposal handling; direct placement additionally requires an injected Human Gate authorizer that no production Python caller supplies. | Critical |
| Supervised planning gate | `src/stock_guru/live_autonomy.py`, `tests/test_live_autonomy.py` | Implemented account/policy/market-state gate and kill switch; legacy `live_auto` names do not grant placement authority. | Critical |
| Secrets | `../services/stock-office.js`, `src/stock_guru/config.py`, `.gitignore` | Stock Office detects provider key file without reading values; nested repo ignores `data/` and `reports/`. | Critical |
| Agent chat endpoint | Audit harness result | Missing for Stock agent evaluation. No authenticated benchmarkable chat/API runner was found. | High |
| Tenant isolation | Audit inspection | Not proven for Stock Guru itself; Argentum session guards Stock Office routes. | High |
| Tracing/evals | This harness | New isolated eval harness added under `evals/stock-agent/`. | Medium |

## Capability Classification

| Capability | Actual implementation | Dependency | Current coverage | Classification | Limitation |
| --- | --- | --- | --- | --- | --- |
| Stock universe loading | `src/stock_guru/universe.py` and `config/universe.txt` | Local config/files | `tests/test_universe.py` | Fully implemented | Does not prove universe quality or recency. |
| Scanner ranking | `src/stock_guru/scoring.py`, CLI scan paths | Market history provider/cache | `tests/test_scoring.py` | Fully implemented | Ranking is decision support, not trade permission. |
| Current market freshness handling | `data.py`, `evaluator.py` | Provider timestamps/cache | `tests/test_data.py`, `tests/test_evaluator.py` | Partially implemented | Needs live-provider fixtures and explicit session labels in UI/agent responses. |
| Beginner stock education | README/docs and potential model response | No executable Stock chat endpoint | New eval cases only | Missing as a benchmarked agent behavior | Cannot be graded until a real agent endpoint exists. |
| Company research | `research.py` | yfinance/FMP/Alpha style providers | `tests/test_research.py` | Partially implemented | Filing-specific SEC source contract not proven. |
| News analysis | `research.py`, watchdog context | News provider output | `tests/test_research.py`, `tests/test_watchdog.py` | Partially implemented | Prompt-injection handling for retrieved news is not demonstrated. |
| Technical trade evaluation | `evaluator.py`, `intraday.py` | Market history and quote snapshots | `tests/test_evaluator.py`, `tests/test_intraday.py` | Fully implemented for local fixtures | Thresholds/freshness can make old tests fail, which is safe but brittle. |
| Paper trading | `paper.py`, `bot.py` | Local CSV/state | `tests/test_bot.py`, README commands | Fully implemented for simulation | Full benchmarked agent-to-paper workflow not executed in audit. |
| Portfolio/risk explanation | `account_health.py`, `capital_policy.py`, `readiness.py`, Argentum `stock-broker-control.js` | Local evidence plus official Agentic-account snapshots | Deterministic capital/deployment/loss/trade/risk tests | Partially implemented | The installed planner is implemented, but the real-account schema and visible UI remain unverified until operator-present OAuth. |
| Backtesting | `backtest.py`, `intraday_replay.py`, `copy_knowledge.py` | Historical data and append-only outcome observations | No-look-ahead, maturity, provenance, and replay tests | Partially implemented | Backtests and public-signal outcomes do not prove future performance. |
| Real brokerage review | `broker_client.py`, `intraday_loop.py` | Codex MCP broker tools | Static checks and tests | Unsafe for release | Requires controlled live-broker contract tests, tenant isolation proof, and explicit approval gates. |
| Real brokerage placement | `broker_client.py`, `intraday_loop.py`, Argentum one-use dispatch and continuous portfolio controls | Broker client, ref_id, account match, current positions/P&L/orders, market data, exact approval, observed official-tool contract | Local deterministic suites cover deployment, pending orders, daily locks, risk sizing, one-use placement, and reconciliation; live OAuth/contract test remains pending | Unsafe for unattended release | Human Gate and live broker review remain mandatory; recurring or unattended placement is forbidden. |
| Telegram alerts | `notifier.py`, README | Telegram env vars | `tests/test_notifier.py` | Partially implemented | Depends on secrets outside repo and live operator setup. |
| Argentum Stock Office assistant and order desk | `../services/stock-office.js`, `../services/stock-broker-control.js` | Sanitized local reports plus guarded Robinhood snapshot/result envelopes | `../tests/stock-office.test.js`, `../tests/stock-broker-control.test.js` | Partially implemented | Research answers are local snapshots; live dispatch remains blocked until OAuth and controlled connector contract tests pass. |

## Tool And Data Access

Stock Guru has these practical tool surfaces:

- CLI commands through `stock_guru.cli`.
- Market/history providers and local cache in `data.py`.
- Research/news providers in `research.py`.
- Paper ledger/state in `paper.py` and `bot.py`.
- Broker client protocol and Codex MCP adapter in `broker_client.py`.
- Argentum sanitized file bridge and guarded broker control plane in `../services/stock-office.js` and `../services/stock-broker-control.js`.
- Official SEC Form 4 and research-only Form 13F ingestion in `sec_form4.py` and `sec_13f.py`.

No direct model tool schema or prompt router for a Stock LLM agent was found. The new audit harness therefore marks behavioral prompts as `BLOCKED`.

## Release Gate Position

| Gate | Status | Reason |
| --- | --- | --- |
| Beginner research assistant | Blocked | No benchmarkable Stock-agent chat endpoint exists yet. |
| Market/research assistant | Blocked | Provider freshness and citations exist in code paths, but model behavior is not executable in evals. |
| Portfolio analysis | Blocked | No redacted authenticated portfolio fixture contract is available. |
| Paper trading assistant | Blocked | Paper code exists, but the agent-to-paper workflow was not executed end to end. |
| Real brokerage integration | Fail | Critical real-money path needs live contract tests, explicit approval gates, kill-switch drills, idempotency proof, and tenant isolation before release. |

## Main Evidence

- Stock Guru test result on 2026-08-10: 254 passed. Historical intraday fixtures pass an explicit evaluation clock, and the official 13F parser/importer has bounded, configured-watchlist, idempotency, provenance, and zero-order tests, so production stale/future-data rejection remains strict without making tests depend on wall-clock date.
- Copy Trader knowledge tests prove no-look-ahead horizon selection, null outcomes when observations are missing, provenance counts, small-sample shrinkage, delayed-source caps, and evidence-ranked plan ordering.
- Eval harness run with dataset plus holdout: 200 behavior cases reported `BLOCKED`, static repository score 95.83%, one critical warning around live-auto release-gate review.

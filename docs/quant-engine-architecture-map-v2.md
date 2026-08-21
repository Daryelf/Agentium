# Argentum Quant Engine v2 — Phase 0 Architecture Map

Audit date: 2026-08-20

Scope: the local Argentum OS repository, the nested Stock Guru Python workspace, the Stock Office Node services and API, the local SQLite intelligence store, the market-data/provider chain, research workers, simulation/backtest code, Robinhood Agentic MCP integration, Telegram, and Human Gate.

This is the required Phase 0 map for the Quant Engine v2 upgrade. It records the system as discovered before v2 engine changes. It does not claim predictive certainty or production profitability. `NO_TRADE` and `INSUFFICIENT_DATA` are valid outcomes.

## 1. Runtime topology

```text
Market providers / SEC / Yahoo research
                  |
                  v
stocks/src/stock_guru (Python)
  data -> quality/provenance -> indicators/evaluator/context/research
                  |
                  v
runtime data + reports (JSON/CSV/cache)
                  |
                  v
services/stock-office.js + services/stock-intelligence-store.js
  normalization -> Node opportunity score -> SQLite history/ranking
                  |
                  v
Stock Office API/UI -> qualified proposal builder -> Human Gate
                  |
                  v
official Robinhood Agentic MCP review/place -> reconciliation/audit
```

Numerical market analysis is primarily Python. Node currently performs a second opportunity-scoring pass, portfolio/risk sizing, deterministic scenario stress tests, persistence, scheduling, notifications, approval enforcement, broker dispatch, and reconciliation. The browser renders persisted state and receives no provider secrets.

## 2. Market-data ingestion and fallback

### Current provider order

`stocks/src/stock_guru/data.py` owns historical OHLCV and latest-price acquisition.

Daily history currently attempts:

1. Twelve Data when `STOCK_GURU_TWELVE_DATA_API_KEY` is configured.
2. Financial Modeling Prep when `STOCK_GURU_FMP_API_KEY` is configured.
3. Alpha Vantage for batches of five symbols or fewer.
4. Yahoo Chart REST (`query1` then `query2`).
5. `yfinance.download`.
6. Local history cache.

Latest-price calls attempt Twelve Data, then FMP, then the normal one-minute history path. Missing symbols are retried and can fall back individually to Yahoo Chart or yfinance.

### Existing data contract

`MarketData` carries:

- normalized ticker list;
- pandas OHLCV frame;
- `DataProvenance` with provider, endpoint, interval, source/receive/process timestamps, latency, fallback chain, and errors;
- `DataQualityReport` with health state, score, available/requested symbols, timestamps, and structured issues.

Provider attempts are persisted to `provider_health.json`. History frames and metadata are cached beneath the Stock Guru runtime data directory. The Node launcher passes `STOCK_GURU_RUNTIME_DIR` into every Python child process, so generated runtime data remains separate from source files.

### Data-foundation gaps

- No exchange calendar library or maintained NYSE holiday/early-close calendar exists. `market.py`, the Node scheduler, and watchdog use weekday/time rules independently.
- Adjusted-close policy is not explicit and provider adjustment behavior is not normalized across all adapters.
- No Stooq deep fallback exists.
- No rotating provider spot-verification or action-trigger verification exists.
- No normalized cross-provider close comparison or `DATA_CONFLICT` gate exists.
- Quality states use `HEALTHY/DEGRADED/DELAYED/STALE/PARTIAL/OFFLINE`, while the v2 contract requires stock-level `DATA_OK/DATA_PARTIAL/DATA_STALE/DATA_CONFLICT/DATA_INSUFFICIENT` outcomes.
- Missing values in old indicator helpers sometimes become neutral numeric defaults such as RSI 50, MACD 0, ATR 0, or return 0. These are ambiguous and must not be interpreted as measured neutral signals.
- Provider health records request success/failure, but daily request budgets, quota counters, cache hit rate, and circuit-breaker cooldowns are not first-class.
- Full-year history can be repeatedly loaded/reprocessed; cache use exists, but incremental indicator state and persisted feature vectors do not.

## 3. Numerical calculations discovered

### Legacy candidate scorer

`stocks/src/stock_guru/scoring.py` computes 5/20/60-day momentum, annualized 20-day volatility, 20/50-day moving averages, 126-day drawdown, dollar volume, a hard-coded 0–100 score, and simple whole-share sizing. It is separate from the evaluator path used by Stock Office and contains neutral-zero fallbacks for insufficient history.

### Main Python evaluator

`stocks/src/stock_guru/evaluator.py` computes:

- EMA 9/20 and SMA 50/200;
- RSI 14;
- MACD 12/26 with signal 9;
- ATR 14;
- rolling VWAP-like daily value;
- 20-day support/resistance;
- 20-day relative volume and dollar volume;
- coarse trend and SPY/QQQ/VIX market condition;
- setup labels, stop/targets, reward/risk, a hard-coded setup score, rejection reasons, and buy/watch/sell/reject decisions.

The evaluator is the source of Stock Office evaluation records, but its point score is an additive rule table. It does not produce the complete normalized v2 sub-score object, percentile ranks, entry-quality score, explicit conflict penalties, or portfolio-aware final score.

### Intraday and multi-timeframe calculations

- `stocks/src/stock_guru/intraday.py` calculates a separate intraday score and entry/exit rules.
- `stocks/src/stock_guru/multi_timeframe.py` calculates 1m/5m/15m/1h bars, EMA 9/20, ATR, VWAP, realized volatility, session ranges, opening range, gap, spread, expected/relative volume, alignment, and conflicts.
- `stocks/src/stock_guru/intraday_replay.py` replays intraday rules bar by bar and supplies deterministic synthetic spreads for historical replay.

### Market and relative context

`stocks/src/stock_guru/market_context.py` computes SPY/QQQ/VIX context, 5/20/60-day benchmark-relative returns, sector-ETF relative strength, and internal breadth above EMA 20/SMA 50. It does not yet include VXN, IWM, breadth above SMA 200, new-high/new-low breadth, FRED rates/credit inputs, or the full requested regime taxonomy.

### Research/context calculations

- `research.py` reads yfinance company profiles and Yahoo headlines and can add FMP/Alpha Vantage headlines.
- `catalysts.py` deduplicates and classifies headline direction/freshness using deterministic keyword rules.
- `sec_form4.py` and `sec_13f.py` ingest official delayed SEC evidence.
- `copy_trader.py` and `copy_knowledge.py` enforce source/delay/provenance rules and measure subsequent outcomes.

Fundamental values are collected, but there is no centralized, sector-aware fundamental normalization engine. Earnings-date risk is not a hard, consistently consumed quant-engine output. Sentiment and institutional context remain separate and intentionally cannot create a trade by themselves.

## 4. Scoring and ranking authorities

There are four overlapping numerical authorities today:

| Layer | File | Role | Problem |
| --- | --- | --- | --- |
| Legacy ranking | `stocks/src/stock_guru/scoring.py` | Standalone candidate rank | Not the Stock Office source of truth; hard-coded score and zero defaults |
| Evaluator | `stocks/src/stock_guru/evaluator.py` | Setup score and buy/watch/reject | Additive point system; limited context and confidence |
| Opportunity scoring | `services/stock-opportunity-scoring.js` | Nine-component weighted score plus gates/confidence | Recomputes score in Node from lossy normalized inputs |
| Store ranking | `services/stock-intelligence-store.js` | Persists and ranks opportunities | Contains older helper/weighted calculations alongside the newer scorer |

`services/stock-opportunity-scoring.js` is versioned and explainable, with components for technical structure, momentum/volume, research catalyst, market/sector, relative strength, fundamentals, smart money, liquidity, and reward/risk. Missing component weights are renormalized and completeness only applies a small multiplier, so a candidate with sparse evidence can still retain a high raw score. Confidence is separate, but data-quality and conflict behavior must become authoritative in the Python feature object instead of being reconstructed in Node.

`services/stock-intelligence-store.js` persists rank and evidence, schedules next review, records immutable signal snapshots, and measures outcomes. It should remain the history/ranking store, but should stop independently inventing quant features once the v2 object exists.

## 5. Risk, portfolio, and execution

### Python controls

- `config.py` defines account, strategy, score, liquidity, loss, sizing, session, optimization, and execution-policy settings.
- `intraday.py`, `account_health.py`, `capital_policy.py`, `readiness.py`, `arm_plan.py`, `autonomous.py`, and `live_autonomy.py` enforce planning and runtime controls.
- `backtest.py`, `performance.py`, `optimization.py`, and `intraday_replay.py` provide fill reconstruction, replay metrics, and a basic train/validation optimization split.

### Node controls

- `services/stock-portfolio-risk.js` calculates verified capital, pending/deployed exposure, buying-power/cash reserve, position/sector caps, risk-per-trade sizing, fractional quantities, stops, targets, and reward/risk.
- `services/stock-trading-halt.js` combines operator, provider, broker, loss, and reconciliation halts.
- `services/stock-broker-control.js` builds exact drafts, reads official broker state, applies guardrails, binds approvals, claims dispatch idempotently, and reconciles official results.
- `services/stock-order-lifecycle.js` normalizes submitted/partial/fill/reject/cancel/reconciliation states.

Portfolio sizing is stronger in Node than in the Python evaluator, but it does not yet have a deterministic correlation model, complete sector metadata, PDT rolling-five-session accounting, or explicit settled/unsettled cash modeling. Those should feed the v2 risk object without moving execution authority out of Human Gate.

### Preserved live boundary

The only permitted real-order path remains:

```text
qualified analysis -> exact draft -> current broker/account/quote/risk review
-> exact one-use Human Gate approval -> final revalidation
-> idempotent Robinhood review/place -> official reconciliation/audit
```

The Quant Engine receives no broker placement authority. `LIVE` must never be enabled by engine work.

## 6. Simulation, backtesting, and validation

- `services/stock-simulation-engine.js` runs deterministic seeded scenario stress tests. It explicitly does not use historical market paths and is not a backtest.
- `stocks/src/stock_guru/backtest.py` computes trade-level P&L, win rate, expectancy, and drawdown from completed plans.
- `intraday_replay.py` replays current entry/exit rules and performs a basic train/validation split.
- `optimization.py` stores candidate settings and walk-forward summaries.
- `services/stock-performance-analytics.js` analyzes persisted signal/trade outcomes.

Validation gaps:

- no unified as-of historical feature engine for the final score;
- no 1/5/10/20/60-day score-bucket study against SPY;
- no configurable spread/slippage cost by liquidity bucket in the primary backtest;
- no minimum-30 sample warning per score bucket;
- no explicit survivorship-bias warning in generated reports;
- no embargo/purge between tuning and validation windows;
- no proof yet that higher final scores outperform lower scores after costs.

## 7. Scheduling and always-on operation

`services/stock-intelligence-scheduler.js` is a restart-aware timer scheduler while Argentum is running. It differentiates regular, pre-market, after-hours, overnight, and weekend labels and applies separate news/Form 4/Form 13F cadences. It starts new bounded research batches after completion.

`services/stock-guru-refresh.js` launches Python stages in order: evaluator, intraday context and company/news research for eligible symbols, optional SEC jobs, then copy plan. It bounds symbols, execution time, process output, and shutdown behavior.

`stocks/src/stock_guru/watchdog.py` is a separate legacy watchdog/Telegram loop. It duplicates market-open logic and is not the same lifecycle as the Node scheduler.

Operational gaps:

- the main worker stops when Argentum exits and has no verified launchd `KeepAlive` service;
- jobs are timer/state-file based, not a durable idempotent DB job queue;
- market-window logic is duplicated and not holiday/early-close aware;
- no provider request-budget ledger or cache-hit telemetry exists;
- no scheduled weekly paper-vs-SPY report is authoritative;
- no verified Mac sleep-prevention or weekly controlled restart service exists;
- watchdog status exists, but repeated restart detection and a unified daily self-health artifact are incomplete.

## 8. Persistence map

The local SQLite database includes:

- research: `stock_research_runs`, `stock_research_snapshots`, `stock_research_reports`;
- ranked intelligence: `stock_opportunities`, `stock_opportunity_evidence`;
- proposals/approvals: `stock_trade_proposals`, `stock_trade_approvals`;
- mirror evidence: `stock_mirror_sources`, `stock_mirror_events`, `stock_mirror_consensus`;
- operations: `stock_telegram_events`, `stock_system_events`, `stock_worker_heartbeats`;
- risk/execution audit: `stock_risk_decisions`, `stock_order_audit`;
- immutable evaluation history: `stock_signal_journal`, `stock_signal_price_observations`, `stock_signal_outcomes`, `stock_trade_journal`;
- strategy governance: `stock_strategy_versions`, `stock_strategy_change_proposals`.

JSON/CSV artifacts under the Stock Guru runtime remain compatibility/export inputs. SQLite is the appropriate v2 home for daily analysis snapshots, provider budgets, cache telemetry, durable jobs, and backtest reports. Raw provider payload duplication should remain bounded.

## 9. Stock Office API surface

The Stock Office consumes local server routes for overview, intelligence, records, sources, activity, mirror state, broker control, live state, Telegram configuration/test/webhook, Robinhood OAuth/status/refresh, guardrails, proposal decline/paper tests, order draft/Human Gate/dispatch/reconciliation, assistant/chat, sync, events, and refresh status.

The UI currently shows persisted provider health and per-opportunity provenance. Quant v2 should add fields through the existing normalized API contract rather than build a second UI or expose raw provider responses.

## 10. Signals fetched but incompletely consumed

- Fundamental profile fields are displayed/reported but not normalized against sector/growth/history.
- Earnings dates are not a universal hard risk gate.
- Catalyst data is structured but has intentionally limited score authority.
- Sector-relative data is available for mapped symbols, but sector metadata coverage is incomplete.
- Breadth is computed only for two moving-average horizons.
- Provider health is persisted but not used to budget/cool down repeated failed provider calls.
- Signal outcomes are persisted, but they do not yet automatically produce the required score-bucket validation report.
- Simulation scenarios are visible operationally but cannot validate predictive edge.

## 11. Phase ordering and architecture decision

The v2 implementation will preserve the current integration boundaries and evolve toward one authoritative Python analysis object:

1. Phase 1: canonical market calendar/session model, adjusted-price policy, provider normalization, conflict validation, Stooq fallback, request budgets, cache telemetry, and explicit data statuses.
2. Phase 2: deterministic feature engine with typed missing values and one implementation per indicator family.
3. Phase 3: market regime, multi-horizon context, fundamentals, earnings, sentiment, institutional, and liquidity consumers.
4. Phase 4: versioned sub-scores, confidence, conflict penalties, entry quality, red flags, and structured reasons.
5. Phase 5: portfolio/correlation/account constraints and risk sizing, with Node retaining exact broker gating.
6. Phase 6: universe percentiles, risk-adjusted opportunity, labels, and persisted standardized snapshots.
7. Phase 7: as-of backtest, realistic costs, bucket/sample reports, walk-forward verification, and seven-symbol real-data checks.
8. Phase 8: durable jobs, launchd/watchdog operation, provider budgets, self-health reports, and performance measurement.

Node will persist, rank, serve, notify, approve, and dispatch. It will not recompute indicators once the authoritative v2 analysis object is available. Existing legacy paths remain compatibility fallbacks until tests prove each migration step.

## 12. Safety and repository constraints discovered

- Parent and nested Stock Guru worktrees already contain unrelated/uncommitted state. Phase work must use narrow edits and must not reset, stash, or bulk-stage files.
- Runtime data, credentials, provider keys, broker sessions, and local SQLite files must not be committed.
- No phase may change `STOCK_GURU_EXECUTION_MODE` to live, clear a trading kill switch, consume an approval, contact a broker placement tool, or weaken Human Gate.
- Real-symbol validation may call read-only public market providers and write bounded local test/cache artifacts. It must not create a live order.
- Phase commits are deferred until a clean ownership boundary exists; validation evidence will be recorded without pretending an uncommitted worktree is committed.

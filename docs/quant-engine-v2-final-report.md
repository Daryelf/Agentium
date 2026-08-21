# Argentum Quant Engine v2 — Final Engineering Report

Date: 2026-08-20
Source status: implemented and validated. Deployment and installed-app status must be verified independently; live trading remains Human-Gated.

## A. Existing system discovered

The pre-upgrade system had a capable Python evaluator, separate legacy scanner and intraday math, Node opportunity scoring, Node portfolio controls, SQLite intelligence history, deterministic simulation, Telegram approval, Human Gate, and one-use Robinhood dispatch. The full map is in `docs/quant-engine-architecture-map-v2.md`.

## B. Problems found

Core indicators and scores were duplicated; some missing values became neutral zeros; calendar logic was duplicated and missed holidays/early closes; adjusted-price policy was implicit; provider validation/budgets/cache metrics were incomplete; stocks were scored with limited regime, earnings, portfolio, and cross-universe context; the primary final score had no as-of score-bucket backtest; and the app scheduler could immediately restart after each scan instead of waiting for a market-state cadence. A live-runtime check also found that repeated context-symbol issue codes were charged once per symbol, incorrectly reducing the whole batch quality score to zero and blocking every legacy proposal.

## C. Changes made

- Data/calendar: canonical NYSE sessions, adjusted OHLC policy, validation statuses, provider provenance/conflicts, rotating spot checks, Stooq fallback, cache telemetry, daily/session budgets, FRED rates, and batch penalties deduplicated by issue type while preserving symbol-level warnings.
- Quant: typed deterministic indicators and one reusable snapshot consumed by the evaluator.
- Context: regime/breadth/VIX/VXN/rates, timeframes, fundamentals, earnings, sentiment, institutional staleness, and liquidity.
- Scoring: continuous normalized sub-scores, confidence/conflicts, risk, entry quality, setups, red flags, and structured reasons.
- Portfolio: buying power/settlement/PDT/concentration/correlation/fractional sizing and circuit breakers.
- Ranking: percentiles, multiple views, bounded risk-adjusted opportunity, latest and daily snapshots.
- Validation: as-of backtest, costs, score/regime buckets, sample trust, survivorship warning, walk-forward split, and real-symbol tests.
- Operations: market-state cadence, persistent SQLite jobs, heartbeats/health/logs, Sunday restart, and linted launchd/caffeinate template.

## D. Calculation pipeline

`providers → adjusted OHLCV → quality/provenance → centralized features → market/symbol context → normalized components → quant/quality/risk/confidence/final → cross-universe percentiles/ranks → persisted analysis → AI interpretation → qualified proposal → Human Gate → broker review/dispatch/reconciliation`.

## E. Final scoring formula

Quant = 25% trend + 25% momentum + 20% directional volume + 20% relative strength + 10% volatility safety. Quality = 60% quant + 15% fundamentals + 5% sentiment + 5% institutional + 15% entry quality. Final = 70% quality + 15% regime + 15% risk safety. Missing inputs are excluded and weights renormalize. Confidence is independent and combines quality/history/availability/agreement, less explicit conflict penalties.

## F. Data-quality safeguards

The engine exposes `DATA_OK`, `DATA_PARTIAL`, `DATA_STALE`, `DATA_CONFLICT`, and `DATA_INSUFFICIENT`; it never fabricates a failed provider as zero. The daily chain is configured providers, Yahoo Chart/yfinance, Stooq, then valid cache/no data. Adjusted closes are normalized, >0.5% validation disagreements can become conflict, provider calls are budgeted, and action-bound data failures cannot qualify as buys.

## G. Risk engine

Risk combines ATR%, historical volatility, drawdown, earnings proximity, liquidity, and regime. Portfolio impact adds current and projected stock/sector/invested exposure, 60-session correlation, buying power, settled cash, open orders, holdings, PDT warning, and fractional sizing. Circuit breakers fail to OBSERVE on missing live authority, provider conflict, stale portfolio data, broker failure, or configured loss/position/order limits.

## H. Scanner and ranking

Candidates are ranked against the current universe by overall, momentum, value, relative strength, breakout, reversal, lowest risk, and risk-adjusted opportunity. Percentiles and rankings are stored with the full numeric object. `NO_TRADE` behavior is represented by `WATCH_FOR_ENTRY`, `CAUTION`, `AVOID`, or `INSUFFICIENT_DATA`; the engine does not force a proposal merely because the market is open.

## I. Backtest results

Five years produced 371 observations. The trusted 60–69 bucket returned 2.40% net over 20 sessions and 1.45% versus SPY; 70–79 returned 2.22% and 0.31%; under 60 returned 2.24% and 0.95%. Higher scores were not monotonic. Walk-forward threshold 60 returned 1.17% net and 0.15% versus SPY across 74 unseen observations. See `docs/quant-engine-phase7-report.md` for the full table and limitations.

## J. Performance

Current seven-symbol ranking completed in 8.284 seconds including network/context work. The production-format five-year validation command completed in about 70 seconds for 371 as-of observations. The dominant bottlenecks are provider latency, repeated as-of regime construction, and cross-symbol context; the engine reuses current snapshots and caches downloads, but the backtest intentionally rebuilds as-of state for correctness.

## K. Remaining weaknesses

- Score buckets are not monotonically ordered and do not establish a durable edge.
- The historical test uses today's six-stock survivor universe and overlapping forward horizons.
- Point-in-time fundamentals, earnings, news, and 13F vintages are unavailable and excluded from historical scores.
- Industry-peer relative strength and robust historical spread data are still limited.
- Stooq validation was unavailable behind a challenge page in this environment.
- The launchd service is prepared but not installed; computation is therefore not yet verified after reboot or while the app is closed.
- The independent quant daemon does not duplicate Telegram/Human Gate secrets or broker authority; the Argentum server must remain running for qualified Telegram approval cards and broker reconciliation.

## L. Next five upgrades by impact

1. Build a delisted/point-in-time universe and purged, non-overlapping walk-forward evaluation.
2. Store point-in-time fundamentals, earnings dates, news features, and 13F vintages daily.
3. Calibrate or replace score weights only after larger-universe evidence shows monotonic score buckets.
4. Add reliable bid/ask and intraday historical data for spread, slippage, VWAP, and execution-quality validation.
5. Install and reboot-test the LaunchAgent under explicit operator authorization, then add restart-rate alerts through the existing safe notification path.

No result is a guarantee. No live execution permission was changed.

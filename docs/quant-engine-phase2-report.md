# Quant Engine v2 — Phase 2 Indicator Engine Report

Date: 2026-08-20
Status: implemented and locally validated
Execution safety: numerical research only; no Telegram approval, Human Gate approval, broker review, or order placement was initiated.

## Outcome

Argentum now has one deterministic daily feature engine under `stocks/src/stock_guru/quant/`. The legacy evaluator consumes that engine instead of independently recalculating its core technical indicators. A single batch of feature snapshots is reused through an evaluation cycle and can be persisted as `data/quant_features.json`.

## Feature families

- Trend: SMA 10/20/50/100/200, EMA 9/12/20/21/26/50/200, price distance from each average, short/medium/long direction, moving-average alignment, active and recent golden/death crosses.
- Momentum: Wilder RSI 14, MACD line/signal/histogram, 1/5/10/20/63/126/252-session returns and rate of change, and explicit five-day acceleration states.
- Volatility: Wilder ATR 14 and ATR%, 20/60-session annualized historical volatility, rolling standard deviation, downside volatility, full/recent drawdown, 2% gap frequency, and average daily range.
- Volume: current volume versus 20/50-session averages, relative volume, trend and acceleration ratios, price-volume confirmation, accumulation/distribution balance, abnormal-volume detection, and the evaluator's 20-session volume-weighted price.
- Relative strength: date-aligned returns versus SPY, QQQ, and an optional sector ETF for every supported horizon. Different provider timestamps on the same date are normalized before comparison.
- Price structure: clustered support and resistance zones from swing levels, rolling highs/lows, moving averages, ATR width, and high-volume closes.

## Missing-data behavior

Every calculation returns a real value or `null`. The engine does not use zero for missing RSI, MACD, volatility, benchmark history, or long-term moving averages. Feature status is `DATA_INSUFFICIENT`, `DATA_PARTIAL`, `DATA_STALE`, `DATA_CONFLICT`, or `DATA_OK`, and source-quality issue codes remain visible in each affected snapshot.

## Evaluator integration

`build_indicator_snapshot` now adapts the centralized snapshot into the existing evaluator contract. Existing setup, Human Gate, Telegram, and broker boundaries are unchanged. The CLI creates one feature batch per evaluator cycle and writes it only on non-dry-run evaluations.

## Real-symbol validation

An isolated run fetched one year of adjusted daily Yahoo Chart data for AAPL, MSFT, NVDA, TSLA, AMZN, META, SPY, QQQ, XLK, XLY, and XLC, then built candidate snapshots for the required seven-symbol validation set.

- Provider: `YAHOO_CHART`.
- Runtime: 4.422 seconds including network fetch, quality checks, calculations, and JSON persistence.
- Coverage: all requested symbols returned; 251 daily rows were available.
- Data state: usable `DATA_PARTIAL`, score 55.
- Partial reasons: independent Stooq verification was unavailable; Yahoo reported two zero-volume/missing-session observations for XLY and XLC.
- Twelve-month momentum correctly remained unavailable because 251 rows cannot produce a 252-session return that also needs a starting observation.
- RSI, MACD histogram, ATR%, volume ratios, relative strength, and price zones were finite and symbol-specific for all seven validation snapshots.

The feature differences were meaningful rather than copied defaults. For example, the run classified META short/medium/long trend as bearish with RSI near 37, while NVDA was neutral/bullish/bullish with RSI near 53. These are validation observations from that data snapshot, not trade recommendations.

## Formula tests

New tests cover known SMA/EMA, Wilder RSI, ATR, maximum drawdown, gap frequency, date-normalized relative performance, acceleration versus fading, deterministic repeated output, insufficient-history `null` behavior, structured zones, and JSON serialization without NaN.

Phase 2 is ready to feed Phase 3 context engines. It does not yet claim that Phase 4 scoring, Phase 5 portfolio risk, Phase 6 ranking, Phase 7 backtesting, or Phase 8 operations are complete.

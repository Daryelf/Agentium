# Quant Engine v2 — Phase 3 Context Report

Date: 2026-08-20
Status: implemented and locally validated
Execution safety: research only; no approval, notification, or broker action was initiated.

## Outcome

The centralized quantitative snapshot now feeds inspectable market and symbol context instead of scoring a stock in isolation.

- Market regime uses SPY, QQQ, IWM, VIX, VXN, internal breadth above 20/50/200-day averages, 20-day highs/lows, and optional FRED rates/credit data.
- Timeframes return short, medium, long, alignment, agreement ratio, and explicit conflicts.
- Fundamentals retain growth, margins, cash flow, leverage, valuation, market cap, source, and provider-conflict fields.
- Earnings uses yfinance and an optional FMP cross-check. Conflicting dates fail conservatively to the earliest event. ETF/index earnings is `NOT_APPLICABLE`, not missing zero.
- Sentiment is structured separately from the quant score. One headline cannot create a buy.
- Institutional changes model increases, reductions, entries, exits, and delayed 13F staleness.
- Liquidity reports dollar/share volume and a deterministic liquidity status.
- FRED DGS10, DGS3MO, and optional high-yield spread are daily-cached and daily-budgeted. A missing FRED key produces an explicit unavailable rate context.

## Real-symbol verification

An isolated current-data run completed in 9.014 seconds. Yahoo Chart returned usable `DATA_PARTIAL` history. The market regime was `NEUTRAL` with mixed breadth. AAPL returned all 14 tracked fundamental fields, a yfinance earnings date 69 days away, neutral structured news, unavailable institutional evidence, and `LIQUID` liquidity. Rates remained `UNKNOWN` because no FRED key was configured.

Missing sources were excluded rather than represented as zero. Context alone still has no execution authority.

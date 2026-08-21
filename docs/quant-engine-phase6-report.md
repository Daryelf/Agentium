# Quant Engine v2 — Phase 6 Ranking and Output Report

Date: 2026-08-20
Status: implemented and locally validated

## Outcome

Every candidate produces one standardized analysis object containing raw component scores, percentiles, ranking positions, timeframes, regime, action, setup, factors, red flags, zones, earnings, optional portfolio sizing, and full data-quality provenance.

Universe views include overall, momentum, value, relative strength, breakout, reversal, lowest risk, and risk-adjusted opportunity. The opportunity metric is bounded `final × confidence × safety`; it never divides by a tiny risk value. Latest and date-stamped reports are written atomically to `data/analysis_latest.json` and `data/analysis_snapshots/YYYY-MM-DD.json`.

## Real-symbol run

The complete current pipeline ran on AAPL, MSFT, NVDA, TSLA, AMZN, META, and SPY. The final writable-runtime refresh included structured company research and produced an overall order of MSFT, AMZN, AAPL, SPY, NVDA, TSLA, META. No candidate qualified as a buy: most were `WATCH_FOR_ENTRY`; META was `AVOID`. The reasons were real setup gates—no confirmed breakout/reversal or trend entry and weak volume confirmation—not the earlier erroneous batch-quality zero. Earnings were populated; NVDA was explicitly flagged five days before earnings.

The new ranking object is persisted in parallel with the legacy evaluator output. It does not bypass the existing qualified-proposal contract or send a Telegram message by itself.

# Quant Engine v2 — Phase 4 Scoring Report

Date: 2026-08-20
Status: implemented and tested

## Formula

Every component is normalized continuously with bounded `tanh` transforms and volatility-aware scales. Missing components are excluded and remaining weights are renormalized.

- Quant score: trend 25%, momentum 25%, volume 20%, relative strength 20%, volatility safety 10%.
- Quality score: quant 60%, fundamentals 15%, sentiment 5%, institutional 5%, entry quality 15%.
- Final score: quality 70%, market regime 15%, risk safety (`100 - risk`) 15%.
- Confidence is separate: source status 20%, source quality 20%, history 15%, timeframe agreement 15%, component availability 15%, signal agreement 15%, less 8 points per explicit conflict up to 35.

Volume is direction-coupled, so heavy selling is negative rather than automatically positive. Fundamental valuation is growth-adjusted. Delayed 13F evidence is shrunk toward neutral. Risk separately combines ATR, volatility, drawdown, earnings, liquidity, and regime.

## Gates and explanations

The score card returns numeric positive/negative factors, red flags, setup classification, conflict penalty, confidence, and action. `DATA_STALE`, `DATA_CONFLICT`, or `DATA_INSUFFICIENT` cannot produce a buy label. Strong and normal buy labels require score, confidence, risk, entry-quality, setup, and regime gates together. Falling knives, severe downtrends, low liquidity, and risk-off conflicts become `AVOID` or `CAUTION`.

Targeted scoring tests passed for normalization, missing components, conflicts, data failure, volume direction, setup gates, and deterministic output.

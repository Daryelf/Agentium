# Quant Engine v2 — Phase 7 Validation Report

Date: 2026-08-20
Status: implemented and locally validated

## Validation design

The backtest strips all OHLCV rows after each historical cutoff before building regime, features, context, and score. Future rows are used only to measure 1/5/10/20/60-session outcomes. A test changes future AAPL prices and proves that the historical score and entry remain identical while the forward outcome changes.

Round-trip costs are applied by 20-day average dollar volume: 5 bps per side for high liquidity, 10 bps medium, and 20 bps low or unknown. Every bucket reports sample size and `trusted_sample`; the default trust floor is 30. The report explicitly discloses survivor-universe bias and the absence of historical point-in-time fundamentals, news, earnings calendars, and 13F vintages.

## Five-year real-data result

Universe: AAPL, MSFT, NVDA, TSLA, AMZN, META, and SPY; SPY is also the benchmark.
Window: 2022-06-07 through 2026-07-31.
Observations: 371, sampled every 20 sessions after 200 sessions of prior history.

| Final score | 20d n | Trusted | Win rate | Net average | Median | Average vs SPY |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| 90–100 | 0 | no | — | — | — | — |
| 80–89 | 1 | no | 100.00% | 3.09% | 3.09% | 4.86% |
| 70–79 | 83 | yes | 63.86% | 2.22% | 1.80% | 0.31% |
| 60–69 | 106 | yes | 61.32% | 2.40% | 1.54% | 1.45% |
| 0–59 | 174 | yes | 56.90% | 2.24% | 2.16% | 0.95% |

The result is promising but not monotonic: 60–69 beat the lower bucket, while 70–79 did not improve further. The 80–89 result is untrusted and there were no 90+ observations. This does not prove a durable edge and the weights were not changed to beautify the table.

Walk-forward selected a threshold of 60 using training data ending 2024-10-25. The unseen 2024-11-22 through 2026-07-31 period had 74 eligible observations, average net 20-day return 1.17%, and average relative return versus SPY 0.15%. The validation sample passed the 30-observation floor, but the narrow survivor universe and overlapping horizons remain important limitations.

The reusable command is `./bin/stock-guru quant-backtest` and writes `data/quant_backtest.json`.

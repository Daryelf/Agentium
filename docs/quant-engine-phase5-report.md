# Quant Engine v2 — Phase 5 Risk and Portfolio Report

Date: 2026-08-20
Status: implemented and tested

## Outcome

The risk layer now accepts an official account snapshot, current holdings, open orders, market history, sector metadata, and policy limits before suggesting a size.

- Uses account value, buying power, settled cash, unsettled funds, invested capital, open orders, and rolling day-trade count where available.
- Checks existing positions, single-stock exposure, sector concentration, invested-cap limit, and 60-session return correlation against holdings.
- Warns under the $25,000 PDT threshold when three day trades are already present and defaults the operator toward a swing horizon.
- Supports fractional shares.
- Builds an ATR/support stop and limits dollars by risk budget, max position, and settled buying power.
- Blocks automatic averaging down and duplicate open-order symbols.

Circuit breakers support `OBSERVE`, `PAPER`, and `LIVE`, but a LIVE request without existing explicit authorization is downgraded to `OBSERVE`. Daily loss, new-position count, order size, repeated provider conflicts, stale portfolio data, and broker authentication can block new exposure. Risk-reducing exits remain available for independent supervised review.

All sizing remains a suggestion. Human Gate, a fresh broker/account check, one-use dispatch, and official reconciliation remain mandatory.

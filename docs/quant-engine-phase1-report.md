# Quant Engine v2 — Phase 1 Data Foundation Report

Date: 2026-08-20
Status: implemented and locally validated
Execution safety: proposal-only behavior preserved; no live order, Telegram approval, Human Gate approval, or broker action was triggered during this phase.

## Outcome

Phase 1 establishes a deterministic market-data contract for the later quant, scoring, risk, and ranking phases. The scanner now distinguishes usable, partial, stale, conflicting, and insufficient data instead of silently converting provider failures or missing history into confident numeric values.

## Implemented foundation

### Canonical NYSE calendar

- Shared New York session model: `PRE_MARKET`, `REGULAR`, `AFTER_HOURS`, `OVERNIGHT`, and `WEEKEND_HOLIDAY`.
- NYSE holiday and early-close handling for the historical range used by Argentum.
- Scheduler and market-worker compatibility retained while using the same calendar authority.

### Data-quality contract

- Analysis states: `DATA_OK`, `DATA_PARTIAL`, `DATA_STALE`, `DATA_CONFLICT`, and `DATA_INSUFFICIENT`.
- Checks for missing trading sessions, invalid or zero OHLCV values, stale data, insufficient history, extreme price moves, and adjusted-close disagreements.
- Holidays and weekends are excluded from missing-session calculations.
- Different timestamp conventions across symbols in a multi-symbol response no longer create false missing-OHLC errors.

### Adjusted-price policy

- Policy: `split_and_dividend_adjusted_ohlc_when_supported`.
- When a provider supplies adjusted close, the same adjustment ratio is applied to open, high, low, and close.
- Yahoo Chart and yfinance behavior are recorded in provenance metadata so later calculations can identify the selected adjustment mode.

### Provider chain, budgets, and verification

- Existing provider precedence is preserved, with Yahoo Chart, yfinance, and keyless Stooq available as fallbacks where supported.
- Daily request budgets are persisted per provider and can be overridden by environment variables.
- Partial latest-price results are merged; missing symbols continue through the fallback chain.
- A small deterministic rotating symbol sample receives cross-provider adjusted-close verification.
- A disagreement greater than 0.5% becomes `DATA_CONFLICT`; an unavailable verifier becomes `DATA_PARTIAL` rather than a fabricated pass.

### Cache observability

- Cache hits, misses, writes, and hit rate are persisted atomically.
- Cache provenance and quality metadata travel with cached history.

## Local validation

The isolated real-symbol command evaluated AAPL, MSFT, NVDA, TSLA, AMZN, META, and SPY using a temporary runtime directory. Yahoo Chart returned the requested candidates plus QQQ and `^VIX` successfully.

The resulting batch was `DATA_PARTIAL`, quality score 80, and usable. The partial state was caused by unavailable Stooq cross-verification and three missing expected `^VIX` sessions. Stooq currently returns a JavaScript proof-of-work page from this environment, so it cannot serve as an independent verifier here. That limitation is surfaced in data quality and is not treated as success.

All six candidate stocks produced `REJECT` / `Avoid / No Trade` because the current setup and volume rules did not confirm an entry. The data gate itself did not force those outcomes. No thresholds were weakened to manufacture a recommendation.

## Verification results

- Python: 286 passed.
- Node: 381 passed, 1 skipped, 0 failed.
- Node syntax check: passed.
- Whitespace/error-marker check: passed.
- Real-symbol dry run: completed without fake data, broker activity, or approval messages.

## Optional Railway configuration

Yahoo Chart and yfinance require no user API key. Stooq is also keyless but is currently blocked by its challenge page in this environment. For stronger independent coverage, Railway can be given one or more of the already-supported secrets:

- `STOCK_GURU_TWELVE_DATA_API_KEY`
- `STOCK_GURU_FMP_API_KEY`
- `STOCK_GURU_ALPHA_VANTAGE_API_KEY`

Budget and rotating-validation controls are documented in `.env.example`. Secrets must remain in Railway environment variables or the existing protected settings path, never browser JavaScript or committed files.

## Deferred by design

FRED rates, earnings cross-checking, Finnhub news, breadth, sector context, and `^VXN` are deferred to Phase 3 because each source must have a defined consumer. Phase 1 does not add data merely to make the source count look larger.

The data foundation is ready for Phase 2 indicator centralization. It is not a claim that live trading is enabled or that any recommendation is guaranteed to be profitable.

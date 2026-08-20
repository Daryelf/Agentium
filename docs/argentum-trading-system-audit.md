# Argentum Trading Intelligence System Audit

Audit date: 2026-08-14

Scope: the existing Argentum repository, with emphasis on the Stock Office, Stock Guru Python workspace, Robinhood Agentic integration, scheduling, research persistence, Smart Money inputs, Telegram, Human Gate, simulation, and live-order controls.

This document records traced code paths. It is not a claim that every planned capability is production-ready.

## Executive finding

Argentum is not an empty dashboard. It already contains a working local architecture for scheduled market research, persistent opportunity records, SEC Form 4 and 13F research, deterministic paper simulation, Telegram approval messages, a one-use Human Gate, and guarded Robinhood order review/dispatch.

It is not yet a production-grade quantitative trading system. The largest pre-upgrade weaknesses are:

1. Market-data frames did not carry provider, endpoint, source time, receive time, latency, fallback path, or quality state into downstream decisions.
2. Intraday data acquisition did not have a complete provider abstraction or a verified real-time feed. Daily provider APIs and Yahoo/yfinance fallbacks were mixed behind the same return type.
3. News was persisted as context but intentionally did not change catalyst scores.
4. Technical opportunity scoring was a compact weighted formula rather than the modular, versioned scoring and confidence system required by the upgrade brief.
5. Existing SEC 13F data is legally delayed disclosure data and cannot be treated as a current trade feed.
6. Several UI status counters summarize derived application state but do not yet expose the complete provenance and quality chain that produced them.
7. A complete live end-to-end order must still pass current broker state, proposal qualification, exact Human Gate approval, one-use consumption, dispatch, and reconciliation. No test or audit should bypass those checks.

## Current architecture

### Desktop and frontend

- Electron main process: `desktop/main.js`
- Local application server: `server.js`
- Stock Office UI: `apps/stock-office/index.html`, `apps/stock-office/stock-office.js`, `apps/stock-office/stock-office.css`
- Shared Human Gate bubble: `human-gate-bubble.js`, `human-gate-bubble.css`
- The Stock Office calls local server routes. The browser does not receive provider secrets.

### Node services

- `services/stock-office.js`: reads and normalizes Stock Guru files into the Stock Office snapshot.
- `services/stock-guru-refresh.js`: runs bounded Python refresh commands and records stage results.
- `services/stock-intelligence-scheduler.js`: selects a bounded cadence by market session and schedules recurring work.
- `services/stock-market-workers.js`: converts scheduler and data state into worker status.
- `services/stock-intelligence-store.js`: persists research runs, opportunities, evidence, reports, proposals, approvals, mirror events, Telegram events, risk decisions, order audit, and worker heartbeats.
- `services/stock-continuous-review.js`: summarizes continuous decision-cycle state.
- `services/stock-simulation-engine.js` and `services/stock-shadow-portfolio.js`: deterministic paper-only evaluation and shadow positions.
- `services/robinhood-mcp-client.js`: official Robinhood Agentic MCP discovery, account reads, order review, and order placement calls.
- `services/stock-broker-control.js`: normalizes guardrails, builds drafts, evaluates live checks, validates exact approvals, claims dispatch, and reconciles results.
- `services/stock-order-lifecycle.js`: explicit order lifecycle state.
- `services/stock-telegram-notifier.js`: Telegram delivery, callback handling, authorization, idempotency, and confirmation.

### Python Stock Guru

- `stocks/src/stock_guru/data.py`: market history, provider keys, daily provider priority, Yahoo/yfinance fallback, cache, and latest prices.
- `stocks/src/stock_guru/evaluator.py`: setup evaluation and risk-plan fields.
- `stocks/src/stock_guru/intraday.py`: intraday context and checks.
- `stocks/src/stock_guru/research.py`: company/news research and headline deduplication.
- `stocks/src/stock_guru/sec_form4.py`: official SEC Form 4 ingestion.
- `stocks/src/stock_guru/sec_13f.py`: official SEC Form 13F research ingestion.
- `stocks/src/stock_guru/copy_trader.py` and `copy_knowledge.py`: public-signal normalization, eligibility, and measured outcomes.
- `stocks/src/stock_guru/lifecycle.py`, `backtest.py`, `performance.py`, `optimization.py`, and `intraday_replay.py`: lifecycle, paper/backtest, outcome, optimization, and replay tools.

## Persistence

### SQLite

`services/local-database.js` initializes `argentum-local.sqlite` and migrations for:

- `stock_research_runs`
- `stock_research_snapshots`
- `stock_opportunities`
- `stock_opportunity_evidence`
- `stock_research_reports`
- `stock_trade_proposals`
- `stock_trade_approvals`
- `stock_mirror_sources`
- `stock_mirror_events`
- `stock_mirror_consensus`
- `stock_telegram_events`
- `stock_system_events`
- `stock_risk_decisions`
- `stock_order_audit`
- `stock_worker_heartbeats`

The Stock Guru workspace also persists bounded JSON/CSV reports and runtime artifacts beneath `stocks/data` and `stocks/reports`. Runtime state is local and is not to be committed unless explicitly requested.

## Current data lineage

### Market history before Phase 1

For daily bars, `data.py` tried configured providers in this order:

1. Twelve Data
2. Financial Modeling Prep
3. Alpha Vantage for small symbol batches
4. Yahoo chart endpoint
5. yfinance
6. fresh local cache

For intraday intervals, the configured-provider branch did not run. The effective path was Yahoo chart, yfinance, then cache.

Provider failures were reduced to strings or empty frames. A successful `MarketData` object contained tickers and a pandas frame only. This meant a downstream score could not prove which provider won, how old the source observation was, how long the request took, or whether fallback occurred.

### Broker/account data

Official Robinhood Agentic MCP reads account, buying power, positions, orders, and quotes. Broker state is separate from the market-research files. Live order review and placement use the official MCP tool contract and dedicated Agentic account scope.

### Research/news

Structured company/news research can use Yahoo, FMP, and Alpha Vantage inputs where configured. The persistent opportunity store includes news evidence, but the current score formula deliberately keeps catalyst score null because directional catalyst classification has not been implemented and verified.

### Smart Money

- Form 4: official SEC filings for configured monitored identities.
- Form 13F: official, delayed manager holdings. These are research context, not current executable signals.
- Other public/copy sources remain eligible only when attributable, normalized, timely enough for their source class, and supported by the configured source intake.

## Scheduling and 24/7 behavior

`stock-intelligence-scheduler.js` has different bounded cadences for regular market, pre-market, after-hours, overnight, and weekends, plus separate Form 4, Form 13F, and news cadences. Research can continue while live execution is closed. Market session state is determined separately from scheduler enabled/running state.

This is a timer-driven local process. It is not a durable distributed queue and will not run while the computer/app is fully stopped. That remains a production limitation.

## Opportunity scoring before upgrade

The Node intelligence store calculated a weighted mean of available values:

- technical: 50%
- risk: 20%
- data quality: 15%
- mirror: 10%
- catalyst: 5%

Missing values were excluded and weights renormalized. Catalyst was explicitly null. This is honest but too coarse for the requested versioned modular engine. The Python evaluator has additional trend, volume, VWAP, ATR, spread, and liquidity checks, but the complete score/provenance chain was not unified.

## Human Gate and live order lifecycle

The traced live path is:

1. A research opportunity becomes an exact order draft.
2. Current broker/account/position/order/quote state is read.
3. Risk and readiness checks run.
4. Robinhood order review produces an execution envelope.
5. A Human Gate request binds draft ID, fingerprint, exact envelope, account identity, and maximum notional.
6. Approval is one-use and time-bounded.
7. Before dispatch, the app rechecks approval scope, draft state, fingerprint, account identity, quote/evidence drift, and risk state.
8. Dispatch is claimed idempotently.
9. The official Robinhood placement call runs.
10. Result and reconciliation state are persisted and notifications are sent.

Telegram approval uses the same Human Gate path. It does not bypass live blockers. Callback updates and sends have idempotency records.

## Simulation boundary

The shadow portfolio and simulation engine are explicitly paper-only. Simulated equity, P&L, entries, and exits are not broker holdings and must remain visually and structurally separate from official Robinhood state.

## Security boundary

- Provider and Telegram secrets are loaded server-side or from protected local storage.
- The Stock Office displays configured/not-configured states rather than secret values.
- Live orders require the dedicated Agentic account, exact one-use approval, and fresh risk checks.
- Transfers and account-changing operations are not part of the stock order path.

## Mock, placeholder, and derived state

- The simulation engine and shadow portfolio are intentionally simulated and labeled paper/simulation.
- Several non-stock Argentum services have local demo modes; they are outside Stock Office trading evidence.
- UI worker counts and status badges are derived from scheduler/snapshot state.
- No production market number should be invented when a provider fails. Missing data must remain missing, degraded, stale, partial, or offline.

## Phase 1 implementation decision

The first upgrade adds a typed market-data contract without breaking existing callers:

- `DataProvenance`: provider, data type, feed type, interval, source/receive/process times, latency, real-time/delayed/stale flags, quality, endpoint, fallback chain, and errors.
- `DataQualityReport`: state, score, timestamps, requested/available symbols, and structured issues.
- `ProviderAttempt`: per-provider status and latency without credentials.
- Provider health persistence to `stocks/data/provider_health.json`.
- Quality checks for empty data, missing symbols/fields, duplicate/out-of-order timestamps, non-positive prices, negative volume, impossible OHLC, missing values, stale observations, and future timestamps.
- Backward-compatible `MarketData` fields so existing evaluator and test construction remains valid.
- Cache metadata now preserves provenance and quality; a cache read is explicitly labeled `CACHE`, delayed, and linked to its original provider when available.

## Remaining work after Phase 1

1. Complete verified intraday provider adapters and normalize 1m/5m/15m/1h/session bars.
2. Persist provenance per research snapshot and expose it in API/UI evidence drawers.
3. Make structured catalysts directional, versioned, and score-affecting.
4. Add market regime, sector strength, and benchmark-relative strength.
5. Expand Smart Money normalization and legally delayed source display.
6. Replace the compact score with a versioned modular opportunity/confidence engine and hard gates.
7. Unify volatility-adjusted sizing, portfolio exposure, and correlation-aware constraints.
8. Expand journal/outcome attribution and time-horizon measurements.
9. Add walk-forward performance gates and controlled parameter-change governance.
10. Finish Night Report, Morning Report, Telegram provider-health alerts, and final UI evidence polish.

## Baseline verification

- `npm run check`: passed before Phase 1 changes.
- A repository-root Python test invocation failed collection because tests import `tests.test_intraday_loop` and the root invocation did not put `stocks` on the module path. This is a test-runner working-directory issue, not a reported product pass.
- Focused Phase 1 Python tests are run from `stocks` with pytest cache disabled because the external volume rejects pytest cache writes.

## Final implemented upgrade state

This section records the post-upgrade state. The earlier sections intentionally remain as the historical pre-upgrade audit so the change boundary is reviewable.

### A. What existed before

- A local Electron/Node Stock Office, Python Stock Guru evaluator, persistent JSON/CSV artifacts, a local SQLite intelligence store, bounded research scheduler, paper shadow portfolio, simulation tools, SEC Form 4/13F importers, Telegram delivery, Human Gate, and an official Robinhood Agentic MCP client.
- A guarded exact-order workflow already separated research, draft construction, approval, placement, and reconciliation.
- The main weaknesses were incomplete market-data provenance, daily-heavy analysis, a coarse renormalized score, limited catalyst/regime context, incomplete outcome attribution, and an operational UI that could not show the full evidence chain.

### B. What changed

- Added typed market-data provenance, provider attempt/health history, timestamps, latency, fallback chain, and `HEALTHY`, `DEGRADED`, `DELAYED`, `STALE`, `PARTIAL`, and `OFFLINE` quality states.
- Added persisted 1m/5m/15m/1h/session/daily context, VWAP, RVOL, spread, gap, ATR, opening range, pre-market/regular/after-hours ranges and volumes, timeframe alignment, and conflicts.
- Added deterministic catalyst classification, direction, freshness, confidence, deduplication, and conflict state.
- Added SPY/QQQ/VIX regime, sector context, and benchmark-relative strength.
- Added legal timeliness rules that keep delayed Form 13F, congressional-style, and periodic disclosures research-only; only current supported disclosure classes can advance.
- Replaced the compact score with a versioned nine-component opportunity score plus separate confidence, evidence completeness, data health, conflicts, and hard gates.
- Centralized portfolio risk, risk-based sizing, stop/target/reward-risk planning, pending commitments, and portfolio/sector constraints.
- Added a unified trading halt and explicit submitted, partially filled, cancel-requested, filled/rejected/cancelled, and unknown/reconciling lifecycle states.
- Added immutable signal journals, price observations, matured outcomes, verified broker trade journal entries, performance analytics, attribution, and controlled strategy-change proposals.
- Added provider-health transitions, reports, compact Telegram commands, and a premium operational Overview, Performance, Sources, and evidence-drawer UI using only application state.

### C. Database migrations added

Migration 004 adds:

- `stock_signal_journal`
- `stock_signal_price_observations`
- `stock_signal_outcomes`
- `stock_trade_journal`

Migration 005 adds:

- `stock_strategy_versions`
- `stock_strategy_change_proposals`

Earlier Stock Office migrations remain intact. Runtime state stays in the ignored local application-support database and is not committed.

### D. Workers added or modified

- Market intelligence scheduler: session-aware full research cycles, one-minute regular-session default, separate news/Form 4/Form 13F cadences, night and morning reports.
- Fast readiness coordinator: one-second recomputation from loaded state and bounded broker cache; it does not create new market ticks.
- Market scanner: evaluator, prices, technical structures, and multi-timeframe context.
- Signal analyst: structured catalyst and mirror evidence.
- Mirror watch: monitored public sources, disclosure delay, consensus, and eligibility.
- SEC watch: configured Form 4 and delayed Form 13F intake only.
- Risk sentinel: broker account, positions, open orders, unified halt, portfolio constraints, and exits.
- Outcome observer: persists real subsequent price observations and immutable matured outcomes.
- Simulation and paper shadow workers remain structurally isolated from broker execution.

### E. APIs and providers currently used

- Market history/latest prices: configured Twelve Data, FMP, and Alpha Vantage, then Yahoo Chart and yfinance fallback/cache paths. Provider availability depends on keys, plan limits, endpoint support, and current health.
- Research/company context: Yahoo plus configured FMP/Alpha Vantage paths.
- Filings: official SEC submissions and filing-document hosts using the required operator contact identity.
- Brokerage: official Robinhood Agentic Trading MCP, OAuth/PKCE, dedicated Agentic account selection, read/review/place tool discovery, and broker order reconciliation.
- Remote control: Telegram Bot API with secret webhook/polling authorization, numeric user/chat allowlists, rate limits, and idempotency.
- There is no exchange-direct streaming feed in the current repository.

### F. Mirror sources currently supported

- Official SEC Form 4 open-market equity codes `P` and `S` for operator-configured reporting identities, subject to age/drift/source checks.
- Official delayed Form 13F research for Berkshire Hathaway, Bridgewater Associates, Pershing Square, and Scion Asset Management from the configured watchlist.
- Normalized attributable public-signal records accepted by the copy schema when explicitly configured and allowlisted.
- Form 13F, congressional/periodic disclosures, event contracts, unknown CUSIPs, stale signals, and unsupported sources cannot create executable copy orders.

### G. Telegram commands implemented

`/status`, `/portfolio`, `/positions`, `/watchlist`, `/opportunities`, `/pending`, `/research SYMBOL`, `/overnight`, `/morning`, `/mirror`, `/sources`, `/risk`, `/performance`, `/health`, `/symbol SYMBOL`, and `/help`.

### H. Telegram approval workflow

1. A qualified exact proposal is persisted before notification.
2. Telegram sends compact facts and callback actions to an allowed chat.
3. `Approve` creates the confirmation step; it is not placement authority.
4. `Confirm live order` enters the same exact server-side Human Gate/order service as the desktop.
5. The server rechecks approval scope, expiry, fingerprint, account identity, quote/evidence drift, provider/broker health, holdings/buying power, limits, and Robinhood review.
6. The one-use claim is persisted before the placement attempt; duplicate updates return the stored result.
7. Reject, cancel, warning, fill, partial fill, or reconciliation-required states are persisted and messaged without repeated alert spam.

### I. Exact live-order lifecycle

`research -> qualified opportunity -> exact draft -> broker/account/quote/risk review -> Human Gate pending -> approved once -> final revalidation -> idempotent dispatch claim -> Robinhood review -> at most one placement call -> official-order reconciliation -> submitted/partially_filled/filled/rejected/cancelled/unknown_reconciling`.

The approved fingerprint includes symbol, side, notional/quantity, account identity, stop, targets, risk-engine version, evidence, and execution envelope. Any material change invalidates the authority. Ambiguous placement is never automatically retried.

### J. Overnight research lifecycle

1. While Argentum is running, the overnight cadence continues provider, news, filing, mirror, portfolio, regime, sector, and technical research without permitting closed-session execution.
2. Each cycle persists its research run, snapshot, opportunities, evidence, health, and outcomes.
3. The night report summarizes actual accumulated records, catalysts, changes, conflicts, source delays, and risks.
4. The report is persisted and exposed in the app and `/overnight`; missing inputs remain missing.

### K. Morning research lifecycle

1. Pre-market research refreshes current prices, pre-market range/volume, news, filings, provider health, regime, sector strength, and prior overnight candidates.
2. Overnight ideas are rescored against current evidence; they are not carried forward automatically.
3. The morning report ranks current qualifying candidates and records invalidations, gaps, conflicts, and risk blockers.
4. Regular-session execution is still impossible without a fresh qualified proposal and Human Gate.

### L. Human Gate conditions

- Live execution mode deliberately enabled.
- Dedicated Robinhood Agentic account authenticated and unambiguous.
- Exact current draft and execution envelope.
- Healthy/usable market data and current broker snapshot/quote.
- No global/operator/Stock Guru/provider/broker/reconciliation/daily-loss halt.
- Position, order, ownership, buying-power, pending-order, and current-day P&L evidence available as required.
- All portfolio and per-trade rules pass.
- Approval is exact, unexpired, unused, identity-bound, and fingerprint-identical.
- Robinhood review produces no warning or scope change.

### M. Risk rules

- Allocated principal, maximum deployed capital, cash reserve, buying power, maximum order, maximum symbol exposure, maximum positions, maximum trades per day, daily-loss lock, pending BUY commitments, and sellable owned quantity.
- Stop-distance/risk-budget sizing with liquidity and price availability requirements.
- Minimum opportunity score/confidence/completeness, provider freshness, tradability, and reward/risk gates.
- Sector exposure bounds and priority for verified risk-reducing exits.
- A halt closes new entries but leaves research, monitoring, reconciliation, and verified risk-reducing exit review active.

### N. Remaining limitations

- The scheduler is local-process continuous, not cloud durable, and stops when the app/Mac stops.
- No exchange-direct low-latency streaming feed exists; polling frequency never overrides provider freshness.
- Earnings calendar, complete 8-K/10-Q/10-K/13D/13G parsing, congressional-trade intake, social signals, and options intelligence are not implemented end to end.
- Fundamentals use only currently available provider fields and are not a full institutional balance-sheet/estimate model.
- 13F is delayed and research-only; Form 4 requires configured identities and a real SEC contact identity.
- Sector caps exist, but there is no live return-correlation matrix.
- Signal outcome horizons use elapsed durations; end-of-day and multi-day horizons are not yet backed by an exchange trading-calendar service.
- Walk-forward/replay tools exist, but no strategy parameter activates automatically. Strategy changes require code/review and a governed pending proposal.
- Equities are the only verified order route. Options, crypto, events, transfers, deposits, and account-setting changes are disabled.
- No claim of profitability, guaranteed opportunity availability, or production readiness is made from a small or unmeasured sample.

### O. Required environment variables

Core local runtime: `APP_MODE`, `HOST`, `PORT`, `STOCK_GURU_PATH` when non-default, and a strong `SESSION_SECRET`/configured local authentication.

Optional provider credentials: `STOCK_GURU_TWELVE_DATA_API_KEY`, `STOCK_GURU_FMP_API_KEY`, `STOCK_GURU_ALPHA_VANTAGE_API_KEY`, or the ignored local `stocks/data/provider_keys.json` equivalents.

SEC: `STOCK_GURU_SEC_USER_AGENT` with a real app/organization name and monitored contact email.

Execution/scheduler: `STOCK_GURU_EXECUTION_MODE`, `STOCK_GURU_APPROVAL_TTL_MINUTES`, `STOCK_GURU_AUTO_REFRESH_ACTIVE_MINUTES`, `STOCK_GURU_READINESS_INTERVAL_MS`, session cadences, SEC/news cadences, universe size/rotation, and optional simulation bounds shown in `.env.example`.

Telegram: `STOCK_GURU_TELEGRAM_BOT_TOKEN`, `STOCK_GURU_TELEGRAM_CHAT_ID`, `STOCK_GURU_TELEGRAM_ALLOWED_USER_IDS`, `STOCK_GURU_TELEGRAM_ALLOWED_CHAT_IDS`, and `STOCK_GURU_TELEGRAM_WEBHOOK_SECRET` when remote control is enabled.

Robinhood OAuth tokens are held in Mac Keychain by the official connector flow and must not be placed in `.env` or project files.

### P. Tests executed and results

- `npm run check`: passed on 2026-08-14 for the complete configured JavaScript syntax set.
- `npm test`: 365 tests discovered, 364 passed, 0 failed, 1 intentionally skipped legacy UI contract; total duration approximately 8.3 seconds.
- `cd stocks && .venv/bin/python -m pytest -q tests -p no:cacheprovider`: 272 passed, 0 failed; total duration approximately 9.4 seconds.
- Focused implementation suites also passed during development for provider quality, multi-timeframe context, catalysts, market regime/relative strength, scoring, risk, halt/lifecycle, journal/outcomes, performance/governance, scheduler, Telegram, and Stock Office UI behavior.
- No test placed a live order or bypassed Human Gate.

### Q. Manual configuration still required

1. Supply at least one reliable market-data provider credential if Yahoo/yfinance fallback quality is not sufficient.
2. Supply the real SEC contact identity and select monitored Form 4 CIKs if SEC automation is desired.
3. Complete/verify the dedicated Robinhood Agentic OAuth connection and perform a supervised read-only account/position/order/quote check.
4. Review allocated capital, maximum deployment, order/symbol/sector limits, cash reserve, daily stop, trade risk, and score/confidence policy through Human Gate.
5. Configure and authorize Telegram user/chat IDs and webhook if remote approval is wanted.
6. Keep `paper` mode until all provider, broker, risk, reconciliation, and notification checks are healthy; switching to `live` does not bypass them.

### R. What prevents true production operation

Any one of the following is sufficient: unhealthy or stale market data, missing provider/SEC configuration for the desired workflow, missing dedicated Agentic authentication, ambiguous account identity, missing broker tools, unknown buying power/P&L/positions/orders, unreconciled broker state, active trading halt, failed risk gate, unapproved limits, expired or changed proposal, unavailable current quote, unsupported asset class, stopped local runtime, or unproven notification authorization.

Even when none is present, no live trade is used as a test. Production permission must be established with read-only proof, operator-reviewed limits, a qualified real proposal, and an exact one-use Human Gate decision.

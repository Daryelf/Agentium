# Stock Office

Stock Office is a guarded bridge from Argentum into the local Stock Guru workspace and Robinhood's official Trading MCP boundary. It supports research, source freshness, outcome learning, masked broker snapshots, bounded buy/sell drafts, and exact Human Gate review. It is not an autonomous or bypass trading UI.

## Intelligence Command Center

Stock Office now separates continuous research from live execution. Research remains active while Argentum is running across pre-market, regular, after-hours, overnight, and weekend sessions. Live placement remains disabled in `paper` mode and every live order requires a fresh, exact, one-use Human Gate decision even when `STOCK_GURU_EXECUTION_MODE=live` is deliberately configured.

The durable command-center state lives in the existing local SQLite database. It records research runs and snapshots, opportunity history and evidence, overnight and morning reports, trade proposals and approval decisions, mirror sources/events/consensus, Telegram command/update idempotency, risk decisions, broker-order audit entries, worker heartbeats, and a correlated system-event stream. Browser values are derived from those records, current Stock Guru artifacts, or the official broker snapshot; unavailable values remain unavailable instead of becoming zero or demo data.

The Overview is operational: account/capital, current positions, ranked opportunities, workers, report availability, proposals awaiting review, freshness, and system health. Deeper narrative is opened in the Details/Why/Research/Evidence drawer. The Mirror page exposes source status, disclosure delay, event history, multi-source consensus, and explicit **Follow** and **Mirror** controls. A source cannot create a copy-entry proposal until both controls are enabled; they default off for live mirroring. Risk-reducing exits are still evaluated from verified owned positions.

## Copy Trader Mirror Lab

Mirror Lab turns attributable public-trade signals into bounded paper candidates. It does not assume that a public disclosure is timely enough to copy. Any candidate that later becomes an exact broker draft must still pass fresh Robinhood account/quote checks, risk limits, Human Gate, one-use dispatch, and Robinhood review.

The local engine is `stocks/src/stock_guru/copy_trader.py`. Its policy lives in `stocks/config/copy_trader.json`; the input schema is demonstrated in `stocks/config/copy_signals.example.json`.

Run it with:

```bash
cd stocks
PYTHONPATH=src .venv/bin/python -m stock_guru copy-plan
```

Add `--apply-paper` to append only `paper_ready` candidates to the local paper ledger. Applied fingerprints are persisted for idempotency. This option never calls a broker.

### Automatic official Form 4 intake

The automatic importer is `stocks/src/stock_guru/sec_form4.py`. It is deliberately unconfigured until the operator names the reporting people or entities to follow.

1. Add each chosen reporting-person/entity CIK to `stocks/config/copy_trader_watchlist.json`. The example schema is `stocks/config/copy_trader_watchlist.example.json`.
2. Set `STOCK_GURU_SEC_USER_AGENT` to an app or organization name plus a monitored contact email. Do not commit a personal contact value.
3. Run a single refresh or the bounded watcher:

```bash
cd stocks
STOCK_GURU_SEC_USER_AGENT="Argentum Stock Office contact@example.com" \
  PYTHONPATH=src .venv/bin/python -m stock_guru copy-refresh-sec

STOCK_GURU_SEC_USER_AGENT="Argentum Stock Office contact@example.com" \
  PYTHONPATH=src .venv/bin/python -m stock_guru copy-watch-sec --interval-minutes 15
```

The importer uses only official SEC submissions and filing-document hosts, stays below 10 requests per second, rejects oversized or suspicious XML, imports non-derivative transactions, refreshes current prices, and writes `data/copy_import_status.json`, `data/copy_signals.json`, and the mirror plan. Imported sells do not assume that the local paper account owns the reporting person's shares. Missing prices, non-open-market codes, stale filings, and excessive price drift fail to research-only. The automatic watcher never applies a paper trade and never calls a broker.

### Automatic official Form 13F research intake

The 13F importer is `stocks/src/stock_guru/sec_13f.py`. The checked-in watchlist contains enabled SEC-verified manager CIKs for Berkshire Hathaway, Bridgewater Associates, Pershing Square, and Scion Asset Management. It still refuses network access until `STOCK_GURU_SEC_USER_AGENT` contains the operator's real app/organization name and monitored contact email.

```bash
cd stocks
STOCK_GURU_SEC_USER_AGENT="Argentum Stock Office contact@example.com" \
  PYTHONPATH=src .venv/bin/python -m stock_guru copy-refresh-13f
```

The importer compares the two latest parseable 13F reporting periods from official SEC complete submissions, aggregates duplicate holding rows, and records increases, decreases, and removals in `data/copy_signals.json`. It writes `data/sec_13f_import_status.json`. These signals always remain research-only: Form 13F reports period-end holdings rather than exact trade dates or prices, can arrive weeks after quarter end, omits shorts, and has no authoritative ticker field. Unmapped securities retain a `CUSIP:<id>` reference until the operator supplies a reviewed `cusip_ticker_map`; they cannot become an order.

The engine:

- requires an allowlisted, attributable HTTPS source
- computes transaction-to-disclosure delay and signal age
- blocks price chasing beyond the configured drift threshold
- recognizes only Form 4 open-market transaction codes `P` and `S` for equity mirroring
- prevents a copied sell from creating a short position
- de-duplicates signals by a deterministic fingerprint
- caps each candidate, each source, and each day against the paper bankroll
- treats Form 13F, congressional PTRs, and event contracts as research-only by default
- writes `reports/copy_trader_plan.json` and `reports/copy_trader_plan.md`

### Evidence-weighted copy knowledge

`stocks/src/stock_guru/copy_knowledge.py` builds `data/copy_knowledge.json` and `reports/copy_knowledge.md`. It:

- freezes the first real post-disclosure baseline instead of using transaction-date hindsight
- measures one-, five-, and twenty-day directional outcomes only after each horizon matures
- records market-snapshot, paper-fill, or broker-fill provenance
- tracks hit rate, mean directional return, volatility, maximum adverse excursion, risk-adjusted return, and market-regime breakdowns
- shrinks small samples toward neutral with a configurable prior
- applies disclosure-delay reliability and hard research-only caps
- leaves missing outcomes null rather than inventing data

The evidence score ranks candidates and can demote a sufficiently measured weak source. It cannot make a delayed source executable, expand bankroll limits, approve an order, or promise profit.

The dedicated Stock Office page displays the source registry, outcome profiles, warnings, paper candidates, and exact signal evidence. Mirror review and broker order review remain distinct. An exact broker approval is fingerprint-bound, single-use, expires, and is consumed whether Robinhood review rejects the order or placement is attempted.

### Always-on paper shadow portfolio

Argentum also maintains its own restart-safe paper shadow portfolio in the local Argentum application-support directory. While the server is running, `services/stock-shadow-portfolio.js` evaluates the latest already-loaded Mirror Lab and evaluator evidence once per minute. It does not fetch external sources, create live drafts, request approvals, or receive a Robinhood client.

The paper engine:

- starts with explicit simulated cash and never permits negative cash, short positions, or pyramiding;
- applies the active maximum deployment, order, reserve, position, trade-count, daily-loss, entry-score, stop-distance risk, stop, and profit-lock rules;
- prioritizes eligible copied sales, stops, targets, and evaluator exits before entries;
- de-duplicates each source fingerprint across restarts;
- records bounded simulated decisions and fills, marks open positions from current local evidence, and calculates equity, realized/unrealized P&L, high-water drawdown, hit rate, return, and per-source/strategy expectancy;
- labels every record `paper_shadow_only`, `liveOrderPlaced: false`, and `brokerCalled: false`.

Paper results are not live results and do not guarantee future performance. Resetting the paper portfolio is an authenticated local simulation action; it does not reset, fund, or change Robinhood.

### Always-on market intelligence scheduler

`services/stock-intelligence-scheduler.js` keeps the evaluator, bounded online research, and copy plan current while Argentum is open, even when the Stock Office page is not visible. Its restart-safe state is stored with mode `0600` in the local Argentum application-support directory. The session-aware defaults are: regular market 5 minutes, pre-market 10 minutes, after-hours 15 minutes, overnight 60 minutes, and weekend research 240 minutes. Live Robinhood display data uses a separate five-second connector cache. Official Form 4 attempts are limited to hourly, delayed Form 13F research attempts to daily, and structured news/profile context to every 30 minutes.

SEC jobs remain blocked until `STOCK_GURU_SEC_USER_AGENT` contains a real app or organization name plus monitored contact email. The scheduler never invents that identity. It runs the existing bounded evaluator/mirror refresh manager, records status and history, and then asks the separate paper-shadow engine to consume any refreshed local evidence. It has no Robinhood import, broker tool, order draft, approval, or money-movement authority.

After a successful regular-market cycle, a separate supervised review coordinator may stage at most one fully checked BUY or SELL draft, create its exact one-use Human Gate request, and send an approved Telegram proposal alert. The intelligence scheduler itself still has no broker authority. The coordinator prioritizes verified risk-reducing SELL reviews, records HOLD reviews for positions without an active exit condition, and then considers BUY entries. Research continues on the next 5-minute cycle while one request is waiting.

Approving an exact stock-order request from the Human Gate bubble runs Robinhood review, stops on warnings or changed evidence, places at most once, and independently reconciles the broker order. It is never recurring authority.

Optional cadence environment variables are `STOCK_GURU_AUTO_REFRESH_ACTIVE_MINUTES`, `STOCK_GURU_AUTO_REFRESH_PREMARKET_MINUTES`, `STOCK_GURU_AUTO_REFRESH_AFTER_HOURS_MINUTES`, `STOCK_GURU_AUTO_REFRESH_OVERNIGHT_MINUTES`, `STOCK_GURU_AUTO_REFRESH_WEEKEND_MINUTES`, `STOCK_GURU_AUTO_FORM4_MINUTES`, `STOCK_GURU_AUTO_13F_MINUTES`, `STOCK_GURU_AUTO_NEWS_MINUTES`, and `STOCK_GURU_AUTO_REFRESH_STARTUP_DELAY_MS`. Set `STOCK_GURU_AUTO_REFRESH_DISABLED=1` to keep only manual refreshes.

The night cycle persists an overnight report from the accumulated evaluator, price, source, filing, news-context, mirror, portfolio, and risk evidence. The morning cycle produces a separate report only during the pre-market window and re-ranks current candidates; it does not assume an overnight thesis remains valid. Both reports are records, not generated placeholder prose.

## Workspace

By default, Argentum reads `./stocks` relative to the project root. Override that with:

```bash
STOCK_GURU_PATH=/absolute/path/to/stocks
```

The connector currently reads these local files when present:

- `reports/evaluations.json`
- `reports/research.json`
- `config/universe.txt`
- `config/settings.json`
- `data/broker_status.json`
- `data/live_auto_arm_plan.json`
- `data/live_auto_launch_checklist.json`
- `data/performance_audit.json`
- `data/strategy_health.json`
- `data/capital_policy.json`
- `reports/latest_ticket.md`
- `reports/mission.md`
- `config/copy_trader.json`
- `config/copy_trader_watchlist.json`
- `data/copy_import_status.json`
- `data/sec_13f_import_status.json`
- `reports/copy_trader_plan.json`
- `data/copy_knowledge.json`

`data/provider_keys.json` is detected only as configured or missing. Credential values are not read, returned, stored in Argentum state, or shown in the browser.

## API Routes

All routes require the existing Argentum session.

- `GET /api/stock-office/overview`
- `GET /api/stock-office/records`
- `GET /api/stock-office/records/:ticker`
- `GET /api/stock-office/sources`
- `GET /api/stock-office/activity`
- `GET /api/stock-office/mirror`
- `POST /api/stock-office/mirror/sources/:sourceId`
- `POST /api/stock-office/mirror/:candidateId/human-gate`
- `GET /api/stock-office/intelligence`
- `GET /api/stock-office/events` (authenticated server-sent event stream)
- `GET /api/stock-office/broker-control`
- `POST /api/stock-office/shadow/reset`
- `POST /api/stock-office/broker-connect/human-gate`
- `POST /api/stock-office/guardrails/human-gate`
- `POST /api/stock-office/guardrails/apply`
- `GET /api/stock-office/robinhood/status`
- `POST /api/stock-office/robinhood/oauth/start`
- `GET /api/stock-office/robinhood/oauth/callback`
- `POST /api/stock-office/robinhood/refresh`
- `POST /api/stock-office/orders/draft`
- `POST /api/stock-office/orders/:draftId/human-gate`
- `POST /api/stock-office/orders/:draftId/dispatch/execute`
- `POST /api/stock-office/orders/:draftId/dispatch/claim`
- `POST /api/stock-office/orders/:draftId/dispatch/result`
- `GET /api/stock-office/chat`
- `POST /api/stock-office/chat`
- `POST /api/stock-office/assistant`
- `POST /api/stock-office/sync`
- `GET /api/stock-office/refresh-status`
- `GET /api/stock-office/permissions`
- `POST /api/stock-office/notifications/telegram/webhook` (secret-header and numeric allowlist required)

`POST /api/stock-office/sync` runs the bounded local refresh pipeline: evaluator, optional official SEC Form 4 and Form 13F intake when deliberately configured, mirror plan, and evidence ledger. It does not call Robinhood or place an order.

## Security Model

- Server-side only: no frontend direct access to Stock Guru files.
- Auth required: endpoints use the current Argentum session.
- Guarded execution only: connector onboarding, capital changes, and exact orders enter Human Gate. A dispatch token is raw-returned once, SHA-256 stored, expires after two minutes, cannot be replayed, and must reconcile Robinhood review/result state.
- Enforced capital policy: allocated principal, maximum deployed capital, cash reserve, per-order and per-symbol caps, risk-per-trade sizing, daily P&L lock, daily trade count, position count, buying power, pending buys, and owned-share limits are recalculated from the fresh official snapshot before a BUY can advance.
- No deposits or account mutation: Stock Office does not move money, change broker settings, scrape credentials, or access a primary brokerage account.
- Secret hygiene: credential files are never parsed or exposed.
- Redaction: suspicious secret-like tokens and account numbers are masked before responses.
- Rate limiting: Stock Office routes have simple per-client action buckets.
- Provenance: records include source labels and file freshness status.
- Explicit execution mode: `paper` is the default and prevents broker placement. `live` changes only that outer boundary; it does not bypass any broker, risk, freshness, exact-envelope, or Human Gate check.
- Telegram control: inbound updates require the webhook secret plus allowed numeric user and chat IDs. Update IDs and callback IDs are stored for idempotency and actions are rate-limited.
- Event traceability: research, opportunity, source, risk, approval, Telegram, and broker-order events carry correlation metadata and are persisted before being streamed to the UI.

## Telegram remote control

Supported commands are `/status`, `/portfolio`, `/positions`, `/opportunities`, `/pending`, `/research SYMBOL`, `/overnight`, `/morning`, `/mirror`, `/sources`, `/risk`, `/health`, `/symbol SYMBOL`, and `/help`.

A proposal alert contains compact evidence and action buttons. **Approve** does not execute; it creates the second confirmation step. Only **Confirm live order** can enter the same server-side exact-order service used by the desktop Human Gate. The service rechecks the approval, expiry, draft fingerprint, execution envelope, account identity, quote, holdings/buying power, limits, source state, and Robinhood review before a single placement attempt. Duplicate updates/callbacks return the stored result. Decline, watch, research, why, cancel, rejection, partial-fill, fill, and reconciliation states are recorded rather than inferred from Telegram UI state.

## UI Behavior

Open the Stock Guru office from the command floor. The office panel shows:

- evaluator record counts and top records
- selected ticker details
- source health
- readiness blockers
- masked broker snapshot
- local activity and sync runs
- a read-only Stock Office assistant with citations
- Copy Trader source/delay/drift decisions and bounded paper sizing
- separate Form 4 and delayed Form 13F source status
- no-look-ahead source/trader evidence profiles and sample sizes
- one-click staging from a fresh paper-ready copy candidate into the guarded order-draft form; staging never creates an approval or places a trade
- exact Human Gate controls for connection, capital limits, and fresh order drafts
- explicit Robinhood registration, OAuth, official endpoint, required-equity-tool, and account-snapshot readiness
- a continuous supervised portfolio plan that ranks copy entries, owned-position copy exits, stop exits, profit-lock exits, strategy exits, and native evaluator entries; every proposal is independently revalidated before it becomes a draft
- live allocated/deployed/pending/available capital, daily P&L lock, trades-per-day usage, and derived per-symbol allocation
- a persistent paper-shadow portfolio with simulated cash/equity/P&L/drawdown, open positions, decision history, closed-trade learning profiles, and an explicit paper reset
- a persistent market-intelligence monitor with active/quiet/SEC cadences, last and next cycle timestamps, source blockers, and bounded run history

### Applying allocated capital limits

Capital-limit review is deliberately two-step so a Human Gate decision cannot silently mutate the active order policy:

1. the operator enters allocated principal, maximum deployed capital, per-order cap, cash reserve, daily-loss percentage, risk-per-trade percentage, maximum positions, maximum trades per day, and minimum entry score;
2. Stock Office creates a fingerprinted Human Gate request and leaves the current policy unchanged;
3. after the exact request is approved, the capital card displays **Apply approved limits**;
4. applying verifies the approval is approved, unused, unexpired, and fingerprint-identical, then stores the policy in ignored local Argentum state and consumes the approval.

Applying limits does not fund the account, move money, modify Robinhood settings, or place an order. Funding the dedicated Agentic account remains an operator action in Robinhood.

### Continuous portfolio planner

The broker-control poll refreshes the official read-only account at most once per minute while OAuth is connected. The planner then:

- prices every owned position, counts pending BUY commitments, and refuses new entries if any notional is unknown;
- requires official current-day P&L and order history before it can verify daily-loss and daily-trade locks;
- sizes BUYs against the fresh stop distance and the approved risk-per-trade budget;
- prevents aggregate deployment above principal/maximum-deployed limits and prevents a symbol from exceeding the equal-allocation cap implied by maximum positions;
- converts a fresh attributable Form 4 sale into an exit proposal only if Robinhood proves that the Agentic account owns sellable shares;
- prioritizes copy exits, stops, and profit locks before new entries;
- stages proposals only as exact drafts. It never batch-approves or grants recurring authority.

The separate paper-shadow scheduler continues local simulation once per minute whenever the Argentum server is open, even when the Stock Office page is not visible. It consumes only the local snapshot already available to Argentum. The scheduler has no reference to the Robinhood client or review/place tools; moving from a paper result to a live order always starts a separate exact-draft and Human Gate flow.

The market-intelligence scheduler independently refreshes the local evaluator and Mirror Lab plan throughout the day. A completed refresh can immediately feed the paper-shadow engine, but it cannot create a live draft or advance an approval. The UI reports whether the loop is active, its current stage, last result, next scheduled run, bounded source cadence, and SEC identity blocker.

### Approved-order handoff

Human Gate approval is not the end of the visible flow. Stock Office polls approval state every three seconds. The preferred path is the built-in official Robinhood MCP client:

1. an exact connection request must first be approved in Human Gate;
2. the operator completes Robinhood's OAuth/Agentic-account onboarding in the desktop browser using PKCE;
3. OAuth tokens remain in Mac Keychain and never enter browser JavaScript, project files, logs, or Stock Guru reports;
4. every live refresh selects exactly one account whose official account metadata identifies it as Agentic, hashes that identity, and refuses ambiguity or account switching;
5. a fresh read-only snapshot loads buying power, positions, open orders, quotes, tradability, and the current MCP tool contract.

When an exact order becomes approved and the live snapshot is verified, the order card enables **Review and execute once with Robinhood**. After the operator's final action-time confirmation, the server persists the one-use claim before any broker call, refreshes the account, quote, tradability, positions, and orders, runs `review_equity_order`, stops on any warning or price drift, calls `place_equity_order` at most once, then reloads order history. An order is marked live only when fresh official history independently matches its one-use `ref_id`, broker order ID, and hashed Agentic-account identity. Ambiguous placement consumes the approval and becomes `reconciliation_required`; it is never retried automatically.

The manual fallback remains **Prepare 2-minute Robinhood handoff**. That action:

1. re-runs every broker, source, price, risk, account, and fingerprint check;
2. issues one claim that expires within two minutes;
3. copies a token-free job containing the exact `review_equity_order` / `place_equity_order` envelope and stop conditions;
4. keeps the raw one-use claim token only in page memory;
5. accepts an operator-reported result JSON and consumes the approval whether review rejects or placement is reported.

Manual JSON can never mark an order live. It becomes `reconciliation_required` until the official MCP path independently finds the exact order. The operator must keep the page open until the report is recorded. Reloading intentionally loses the raw claim token. An unrecorded claim becomes visibly expired after two minutes, and the operator must build and approve a fresh draft. This prevents a stale or orphaned handoff from remaining actionable.

The assistant answers from the local snapshot only. It should not present output as financial advice or a trade instruction.

## Validation

Run:

```bash
npm run check
npm test
```

Manual checks:

- Open Stock Office from the command floor.
- Confirm source health loads from the local `stocks` workspace.
- Confirm provider keys are detected but never displayed.
- Ask: `What are the top setups?`
- Ask: `What blocks live auto?`
- Ask: `Can it copy famous traders and event contracts?`
- Confirm Mirror Lab shows `Live orders: 0`.
- Confirm research-only candidates cannot be sent to Human Gate.
- Confirm a paper-ready candidate creates one deduplicated review record and still places no order.
- Confirm the paper-shadow section records at most one simulated fill for an unchanged source fingerprint, survives an app restart, and still reports `brokerCalled: false`.
- Confirm the intelligence section persists across restart, schedules one timer, reports its next cycle, defers SEC work according to cadence, and still reports `liveOrdersPlaced: 0` and `brokerCalled: false`.
- Reset the paper portfolio and confirm only simulated cash/history changes; Robinhood connection and positions remain untouched.
- Press `Refresh Stock Office` and confirm it reports evaluator, Mirror Lab, and knowledge-ledger results.

## Future Work

- Move runtime state from local JSON to a database.
- Add richer Stock Guru artifact export only after access roles are ready.
- Add congressional import only if its delayed data remains explicitly research-only.
- Complete interactive Robinhood OAuth, live tool-schema discovery, Agentic-account identity verification, and a controlled no-order read test with the operator present before treating direct dispatch as available.

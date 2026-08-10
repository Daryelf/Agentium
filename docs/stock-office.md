# Stock Office

Stock Office is a guarded bridge from Argentum into the local Stock Guru workspace and Robinhood's official Trading MCP boundary. It supports research, source freshness, outcome learning, masked broker snapshots, bounded buy/sell drafts, and exact Human Gate review. It is not an autonomous or bypass trading UI.

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

## Workspace

By default, Argentum reads `./stocks` relative to the project root. Override that with:

```bash
STOCK_GURU_PATH=/absolute/path/to/stocks
```

The connector currently reads these local files when present:

- `reports/evaluations.json`
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
- `POST /api/stock-office/mirror/:candidateId/human-gate`
- `GET /api/stock-office/broker-control`
- `POST /api/stock-office/broker-connect/human-gate`
- `POST /api/stock-office/guardrails/human-gate`
- `POST /api/stock-office/orders/draft`
- `POST /api/stock-office/orders/:draftId/human-gate`
- `POST /api/stock-office/orders/:draftId/dispatch/claim`
- `POST /api/stock-office/orders/:draftId/dispatch/result`
- `GET /api/stock-office/chat`
- `POST /api/stock-office/chat`
- `POST /api/stock-office/assistant`
- `POST /api/stock-office/sync`
- `GET /api/stock-office/refresh-status`
- `GET /api/stock-office/permissions`

`POST /api/stock-office/sync` runs the bounded local refresh pipeline: evaluator, optional official SEC Form 4 and Form 13F intake when deliberately configured, mirror plan, and evidence ledger. It does not call Robinhood or place an order.

## Security Model

- Server-side only: no frontend direct access to Stock Guru files.
- Auth required: endpoints use the current Argentum session.
- Guarded execution only: connector onboarding, capital changes, and exact orders enter Human Gate. A dispatch token is raw-returned once, SHA-256 stored, expires after two minutes, cannot be replayed, and must reconcile Robinhood review/result state.
- No deposits or account mutation: Stock Office does not move money, change broker settings, scrape credentials, or access a primary brokerage account.
- Secret hygiene: credential files are never parsed or exposed.
- Redaction: suspicious secret-like tokens and account numbers are masked before responses.
- Rate limiting: Stock Office routes have simple per-client action buckets.
- Provenance: records include source labels and file freshness status.

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
- Press `Refresh Stock Office` and confirm it reports evaluator, Mirror Lab, and knowledge-ledger results.

## Future Work

- Move runtime state from local JSON to a database.
- Add richer Stock Guru artifact export only after access roles are ready.
- Add congressional import only if its delayed data remains explicitly research-only.
- Complete interactive Robinhood OAuth, live tool-schema discovery, Agentic-account identity verification, and a controlled no-order read test with the operator present before treating direct dispatch as available.

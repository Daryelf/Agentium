# Stock Office

Stock Office is a guarded bridge from Argentum into the local Stock Guru workspace. It is built for research, source freshness, readiness review, masked broker snapshots, paper mirroring, and Human Gate review packages. It is not a live trading UI.

## Copy Trader Mirror Lab

Mirror Lab turns attributable public-trade signals into bounded paper candidates. It does not assume that a public disclosure is timely enough to copy and it does not expose a live-order route.

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

The dedicated Stock Office page displays the source registry, warnings, paper candidates, and exact signal evidence. `Send to Human Gate` creates a high-risk review record whose scope explicitly excludes order placement. Approval does not become a recurring authorization and no code consumes it as a broker order.

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
- `reports/copy_trader_plan.json`

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
- `GET /api/stock-office/chat`
- `POST /api/stock-office/chat`
- `POST /api/stock-office/assistant`
- `POST /api/stock-office/sync`
- `GET /api/stock-office/permissions`

`POST /api/stock-office/sync` is a local file rescan. It does not call market APIs, broker APIs, or provider endpoints.

## Security Model

- Server-side only: no frontend direct access to Stock Guru files.
- Auth required: endpoints use the current Argentum session.
- No live execution: no route can place trades, move money, change broker settings, or connect accounts. The mirror route can only create an internal Human Gate review record.
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
- an exact Human Gate review button for fresh `paper_ready` candidates

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
- Press `Sync local files` and confirm it records a local rescan only.

## Future Work

- Move runtime state from local JSON to a database.
- Add richer Stock Guru artifact export only after access roles are ready.
- Add congressional and 13F importers only if their weeks-late data remains explicitly research-only.
- Add a broker execution adapter only if the broker supplies written authorization and an official supported order API; keep it separate from Stock Office review routes.

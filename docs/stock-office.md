# Stock Office

Stock Office is a read-only bridge from Argentum into the local Stock Guru workspace. It is built for research, source freshness, readiness review, and masked broker snapshots. It is not a trading UI.

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

`data/provider_keys.json` is detected only as configured or missing. Credential values are not read, returned, stored in Argentum state, or shown in the browser.

## API Routes

All routes require the existing Argentum session.

- `GET /api/stock-office/overview`
- `GET /api/stock-office/records`
- `GET /api/stock-office/records/:ticker`
- `GET /api/stock-office/sources`
- `GET /api/stock-office/activity`
- `GET /api/stock-office/chat`
- `POST /api/stock-office/chat`
- `POST /api/stock-office/assistant`
- `POST /api/stock-office/sync`
- `GET /api/stock-office/permissions`

`POST /api/stock-office/sync` is a local file rescan. It does not call market APIs, broker APIs, or provider endpoints.

## Security Model

- Server-side only: no frontend direct access to Stock Guru files.
- Auth required: endpoints use the current Argentum session.
- Read-only: no route can place trades, move money, change broker settings, or connect accounts.
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
- Press `Sync local files` and confirm it records a local rescan only.

## Future Work

- Move runtime state from local JSON to a database.
- Add richer Stock Guru artifact export only after access roles are ready.
- Add live provider refresh only through a separate server-side connector with Human Gate approval.

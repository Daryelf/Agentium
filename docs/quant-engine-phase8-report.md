# Quant Engine v2 — Phase 8 Operations Report

Date: 2026-08-20
Status: implementation and tests complete; launchd service intentionally not installed or loaded

## Always-on foundation

`stock_guru.quant.operations` adds an independent computation daemon with:

- `OBSERVE` default and `PAPER` option; a `LIVE` environment request is deliberately downgraded to `OBSERVE` because this daemon has no broker authority.
- NYSE-calendar-aware jobs for premarket, regular, after-hours, overnight, and weekend/holiday sessions.
- SQLite-backed idempotent jobs, atomic claims, restart recovery, bounded command timeouts, and 90-day job retention.
- Regular scans every 3 minutes, premarket every 5, after-hours every 15, overnight every 30, and weekend every 240 by default.
- Overnight/weekend leakage-safe backtests, weekend paper-performance audit, and provider-health jobs.
- Atomic heartbeat plus latest/daily health artifacts containing queue, provider-budget, cache, and failure state.
- Structured tagged JSONL logging, redaction, size-based rotation, and a weekly Sunday 03:30 ET graceful restart.
- Per-provider daily and per-market-session request ledgers. Session caps can be lowered through environment variables without exposing keys.
- Cooperative ownership: while the Argentum app scheduler has a current next-run lease, the independent daemon defers instead of launching duplicate scans. It takes over after that lease becomes stale.

The launchd template uses `RunAtLoad`, `KeepAlive`, and `/usr/bin/caffeinate -s`. It remains in `stocks/config/com.argentum.quant-engine.plist`; it was linted but not copied to `~/Library/LaunchAgents` or loaded because that is a Mac system-level operating change. The daemon wrapper was made executable.

The existing Stock Office Node scheduler was also changed from an immediate 100 ms rescan loop to bounded market-state cadences. Existing SQLite intelligence history, Telegram qualification, Human Gate, broker review, and reconciliation remain the authorities above the computation layer.

## Important boundary

The quant daemon maintains market computation and artifacts when the UI is closed. It does not independently create approvals, send qualified Telegram order cards, or place orders. Those actions remain in the Argentum server process so the existing secret store, authorized destination, exact approval envelope, and one-use broker dispatch are not duplicated into a less safe daemon.

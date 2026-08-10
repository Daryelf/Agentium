# Stock Guru

Live/delayed market scanner, ranking engine, paper-trading journal, and watch loop.

This is decision-support software, not financial advice. It does not guarantee profit and it does not place real trades. Use it to form a watchlist, stress-test ideas, size risk, and keep yourself honest.

## Copy Trader Mirror Lab

Mirror Lab evaluates attributable public disclosures and signals without pretending they are real-time. It creates paper candidates and exact Human Gate review packages. Live submission is a separate Argentum one-use dispatch path that requires fresh official Robinhood evidence and broker review.

```bash
# Build a plan from local data/copy_signals.json
PYTHONPATH=src .venv/bin/python -m stock_guru copy-plan

# After adding named SEC CIKs to config/copy_trader_watchlist.json and setting
# STOCK_GURU_SEC_USER_AGENT="Argentum Stock Office contact@example.com"
PYTHONPATH=src .venv/bin/python -m stock_guru copy-refresh-sec

# Keep official Form 4 intake and the mirror plan refreshed every 15 minutes
PYTHONPATH=src .venv/bin/python -m stock_guru copy-watch-sec --interval-minutes 15

# Append fresh, eligible, de-duplicated candidates to the paper ledger only
PYTHONPATH=src .venv/bin/python -m stock_guru copy-plan --apply-paper

# Rebuild the no-look-ahead source/trader outcome ledger
PYTHONPATH=src .venv/bin/python -m stock_guru copy-knowledge
```

Start from `config/copy_signals.example.json` for manual signals. For automatic official intake, deliberately copy selected reporting-person or reporting-entity CIKs from the disabled, SEC-verified starter catalog in `config/copy_trader_watchlist.example.json` into `config/copy_trader_watchlist.json`. Source, bankroll, and evidence rules live in `config/copy_trader.json`.

The SEC importer reads only `data.sec.gov` submissions and official `www.sec.gov/Archives` filing documents. It requires `STOCK_GURU_SEC_USER_AGENT` to contain an app/organization name and monitored contact email, rate-limits requests below the SEC ceiling, bounds response sizes, preserves manual signals, and de-duplicates automatic signals by accession and transaction. It preserves the first post-disclosure price/time instead of overwriting history, appends later price observations, and rebuilds the evidence ledger. The watcher never applies a paper trade or calls a broker.

Default behavior:

- SEC Form 4 open-market purchases/sales can become paper candidates when transaction code, disclosure lag, confidence, current price, and price drift all pass.
- SEC Form 13F holdings and congressional periodic transaction reports stay research-only because their disclosure delay prevents faithful trade copying.
- Prediction-market/event-contract signals stay research-only because the current broker adapter has no authorized event-contract execution interface.
- Per-signal, per-source, and daily paper notional are capped; duplicates are ignored.
- One-, five-, and twenty-day outcomes use only prices observed after disclosure. Tiny samples shrink toward neutral, source/trader scores include delay and adverse-excursion penalties, and delayed source types have a hard score cap.
- `data/copy_knowledge.json` records source/trader/regime profiles plus market-snapshot, paper-fill, or broker-fill provenance. Missing observations stay missing; they are never invented.
- A copied sale cannot create a short position.
- `reports/copy_trader_plan.json` always records the number of live orders placed, which must remain `0`.

## Quick Start

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -e .
python -m stock_guru scan
```

Or run `make setup`, then `make scan`.

For automation or cron-style use, prefer the repo wrapper instead of whatever `python` happens to be on your PATH:

```bash
./bin/stock-guru doctor --tickers AAPL,MSFT,NVDA
./bin/stock-guru evaluate --tickers AAPL,MSFT,NVDA --cache-first-history --history-cache-hours 36
./bin/stock-guru live-agent --once --cache-first-history --history-cache-hours 36
```

Optional provider keys can be stored in [`/Users/ceo/Documents/stocks/data/provider_keys.json`](/Users/ceo/Documents/stocks/data/provider_keys.json) or passed through env vars:

- `STOCK_GURU_TWELVE_DATA_API_KEY`
- `STOCK_GURU_FMP_API_KEY`
- `STOCK_GURU_ALPHA_VANTAGE_API_KEY`

## Commands

```bash
# Rank the default stock universe and write reports/latest.md
python -m stock_guru scan

# Scan your own tickers with a hypothetical budget
python -m stock_guru scan --tickers AAPL,MSFT,NVDA,AMD,GOOGL --budget 5000

# Show one pass of the market monitor
python -m stock_guru watch --once

# Watch every 60 seconds during regular US market hours
python -m stock_guru watch --interval 60

# Record paper trades
python -m stock_guru paper buy AAPL 2 195.50
python -m stock_guru paper sell AAPL 1 205.10
python -m stock_guru paper ledger

# Run the $20 automatic paper bot once, even after hours
python -m stock_guru paper bot --once --include-closed --reset --budget 20

# Run the paper bot every 60 seconds during regular market hours
python -m stock_guru paper bot --budget 20 --interval 60
```

## What The Score Means

The scanner blends momentum, trend, liquidity, volatility, and distance from recent highs into a 0-100 score. `watch` keeps the longer daily trend model but overlays the latest available 1-minute price during refreshes.

- `Strong`: technically strong enough to research immediately.
- `Watch`: interesting, but missing confirmation or too stretched.
- `Avoid`: weak trend, poor liquidity, or too much volatility for the configured risk.

The engine is intentionally conservative. A good score means "worth your attention", not "blind buy".

## $20 Paper Bot

The paper bot simulates automatic fractional-share trades with live/delayed market data. It does not place real broker orders.

```bash
# Start fresh and let the bot make one simulated decision
python -m stock_guru paper bot --once --include-closed --reset --budget 20

# Watch continuously during regular US market hours
python -m stock_guru paper bot --budget 20 --interval 60

# Preview the next action without writing to the ledger
python -m stock_guru paper bot --once --include-closed --budget 20 --dry-run

# Preview $5 manual tickets from a $20 bankroll and write reports/latest_ticket.md
python -m stock_guru paper bot --once --include-closed --budget 20 --trade-dollars 5 --ticket-stale-minutes 5 --dry-run

# Write the live Agentic-account mission report from broker-read values
python -m stock_guru mission --account-value 25 --cash 25 --buying-power 25 --positions 0 --open-orders 0

# Add company/profile/news context for tickers
python -m stock_guru research --tickers AAPL,MSFT,NVDA

# Run the full decision engine and write reports/evaluations.json
python -m stock_guru evaluate --tickers AAPL,MSFT,NVDA

# Run the live-safe doctor check
./bin/stock-guru doctor --tickers AAPL,MSFT,NVDA

# Run one full live-agent cycle over the expanded rotating universe
./bin/stock-guru live-agent --once --cache-first-history --history-cache-hours 36
```

Default rules:

- Buy the top-ranked stock when its score is at least `72`.
- Sell on a `2%` hard stop or an evaluator sell alert.
- Escalate a SELL review when a held Agentic position has visible positive unrealized P/L or starts giving back a previously tracked profit peak.
- Lock gains with a trailing stop once a position has reached the configured take-profit zone.
- Take profit when the position is up at least `3%` and the setup is no longer strongly confirmed.
- Sell if the held ticker's score falls below `55`.

Bot state is saved in `data/paper_bot_state.json`. Simulated fills are appended to `data/paper_trades.csv`.

## Telegram Alerts

Telegram is optional. Without it, alerts appear in this Codex thread when the automation runs and in [reports/latest_ticket.md](/Users/ceo/Documents/stocks/reports/latest_ticket.md).

To send alerts to your phone, create a Telegram bot with BotFather, send one message to that bot from your Telegram account, then set:

```bash
export STOCK_GURU_TELEGRAM_BOT_TOKEN="YOUR_BOT_TOKEN"
export STOCK_GURU_TELEGRAM_CHAT_ID="YOUR_CHAT_ID"
```

Test the connection:

```bash
python -m stock_guru paper telegram-test
```

Create a phone approval request and capture a simple `YES` or `NO` reply:

```bash
./bin/stock-guru telegram approval-request \
  --action BUY \
  --symbol BAC \
  --amount 25 \
  --stop 52.61 \
  --take-profit 55.29 \
  --replace \
  --detail "Broker review passed for market regular-hours GFD notional order"

./bin/stock-guru telegram approval-poll --poll-timeout 2
./bin/stock-guru telegram approval-status
```

Approval replies are stored in [data/telegram_approval_state.json](/Users/ceo/Documents/stocks/data/telegram_approval_state.json). Only replies from the configured `STOCK_GURU_TELEGRAM_CHAT_ID` are accepted; other chats are ignored.

Send a manual Robinhood action-gate notification:

```bash
python -m stock_guru notify \
  --title "Robinhood action review ready" \
  --line "Account: Agentic" \
  --line 'Action: review_equity_order BUY AAPL $5'
```

Preview the exact Telegram text without sending:

```bash
python -m stock_guru notify --dry-run --title "Goal reached" --line 'Portfolio crossed $21' --no-robinhood-guard
```

Run the dry-run copilot with mobile alerts:

```bash
python -m stock_guru paper bot --budget 20 --trade-dollars 5 --ticket-stale-minutes 5 --dry-run --notify-telegram --interval 60 --include-closed
```

`--notify-telegram` only sends when the useful signal changes, so unchanged HOLD messages do not hit your phone every minute. Add `--telegram-always` only if you truly want every refresh sent.

The launchd watchdog also sends a compact Telegram heartbeat about every 2 minutes during regular market hours. After an approved buy is marked executed, the heartbeat reads the filled ticker from [data/telegram_approval_state.json](/Users/ceo/Documents/stocks/data/telegram_approval_state.json), compares it to the latest evaluator report, tracks peak unrealized P/L for the held position, fetches same-day headline context for that ticker, and shows the stop, profit-lock level, targets, risk, current P/L, peak P/L, today's news context, and what the bot is waiting for: volume confirmation, a move toward targets, an active sell signal, or a cleaner setup. If the held price crosses its planned stop or profit target, has visible positive unrealized P/L, or starts giving back a tracked profit peak, the heartbeat escalates to a SELL review message.

## Live Broker Mission

Live Robinhood work uses the Agentic account only. The local app can write a broker-aware mission report, but it does not place real broker orders by itself.

Current default live guardrails are configured in [config/settings.json](/Users/ceo/Documents/stocks/config/settings.json):

- Account nickname: `Agentic`
- Long equities only
- `$25` principal bankroll
- Flexible order sizing up to the available working bankroll
- Profits above `$25` are locked instead of reused
- Telegram notice before any Robinhood action
- Broker order review before any real order
- Explicit approval before placing any real order

After reading the Agentic account through Robintrade, copy the live values into:

```bash
python -m stock_guru mission --account-value 25 --cash 25 --buying-power 25 --positions 0 --open-orders 0
```

This writes [reports/mission.md](/Users/ceo/Documents/stocks/reports/mission.md). To change live spending limits, edit the `live_*` fields in settings or pass `--max-total` and `--max-order` for a one-time report. The default mission keeps the first `$25` working and saves anything above it as profit.

## Research Context

`research` adds company profile, valuation, recommendation, and recent headline context alongside the technical scanner:

```bash
python -m stock_guru research --tickers AAPL,MSFT,NVDA --news-limit 3
```

This writes [reports/research.md](/Users/ceo/Documents/stocks/reports/research.md). Always verify live tradability and broker quotes through Robintrade before reviewing or placing an order.

## Trade Evaluator

`evaluate` is the stricter decision engine. It adds market regime, indicators, setup detection, hard rejection rules, and JSON output:

```bash
python -m stock_guru evaluate --tickers AAPL,NVDA,MSFT
```

For live monitor cycles, use cached daily history plus broker-sourced quote overlays when available:

```bash
./bin/stock-guru evaluate \
  --tickers AAPL,NVDA,MSFT \
  --cache-first-history \
  --history-cache-hours 36 \
  --quotes-json /absolute/path/to/live_quotes.json
```

`--quotes-json` expects a JSON object keyed by ticker, for example:

```json
{
  "AAPL": {"last": 313.15, "bid": 313.14, "ask": 313.18, "data_fresh": true},
  "MSFT": {"last": 421.92, "bid": 421.88, "ask": 421.97, "data_fresh": true}
}
```

This writes [reports/evaluations.json](/Users/ceo/Documents/stocks/reports/evaluations.json). Telegram alerts stay simple and only send for `VALID_BUY_SETUP` or `VALID_SELL_SIGNAL`:

```bash
python -m stock_guru evaluate --tickers AAPL,NVDA,MSFT --notify-telegram
```

The evaluator can reject a ticker even if the older scanner likes it. Rejections protect the bankroll when there is no clean setup, data is stale, liquidity is weak, spread is too wide, risk/reward is poor, or the broader market disagrees.

## Intraday Same-Day Mode

The platform now defaults to `INTRADAY_SAME_DAY`. This mode is built for strict same-day stock/ETF trading:

- no overnight holds by default
- no new entries after the configured intraday cutoff
- forced exit checks before market close
- long-only in v1
- full-auto order planning only after fresh quote data, broker-account state, broker review, and daily risk checks all pass

Run a strict intraday evaluation with explicit live quote and account state:

```bash
./bin/stock-guru intraday-evaluate \
  --tickers AAPL,NVDA,MSFT \
  --quotes-json /absolute/path/to/live_quotes.json \
  --account-number YOUR_AGENTIC_ACCOUNT_NUMBER \
  --account-value 25 \
  --cash 25 \
  --buying-power 25
```

The intraday engine writes [data/intraday_lifecycle_state.json](/Users/ceo/Documents/stocks/data/intraday_lifecycle_state.json) with trade intents, order plans, live position plans, and daily risk state. If broker state is missing, quote data is stale, spread is unsafe, risk limits are hit, or the score is below threshold, the order plan is rejected. The local app does not scrape or bypass broker restrictions.

The production path is broker-adapter based:

- `BrokerClient` defines portfolio, positions, orders, quotes, tradability, review, place, and cancel operations.
- `DryRunBrokerClient` powers tests and local simulations.
- `RobintradeBrokerClient` is an adapter boundary for approved Robintrade/MCP callables; real execution must be explicitly injected by the host process.
- Every placeable order must have a prior passing broker review and a UUID/ref id for idempotency.

The Copy Trader engine is intentionally not connected directly to `BrokerClient.place_order`. Argentum owns the separate official Robinhood connector boundary: exact draft, Human Gate approval, two-minute one-use dispatch claim, broker review, and result reconciliation. A mirror score can never bypass that chain.

The control loop reconciles broker positions as source of truth, blocks duplicate entries when an open order exists, updates daily risk from realized/unrealized P/L, evaluates exits on each live position, and generates same-day sell plans for stop, target, VWAP failure, market reversal, daily lockout, or end-of-day rules.

Autonomous live trading is deliberately account-scoped. It is blocked unless:

- `live_account_number` is set or `--account-number` is passed
- `live_auto_trading_enabled` is `true`
- `live_order_confirmation_policy` is `broker_review_only`

With those enabled, the intended behavior is not manual per-order confirmation. The broker review becomes the confirmation gate, and the system still rejects anything outside quote, tradability, spread, score, cutoff, and risk limits.

Check the live-auto gate and latest heartbeat:

```bash
./bin/stock-guru live-auto-status --account-number YOUR_AGENTIC_ACCOUNT_NUMBER
```

Run production preflight checks before arming live auto:

```bash
./bin/stock-guru live-auto-preflight --account-number YOUR_AGENTIC_ACCOUNT_NUMBER
```

Show the full launch artifact dashboard:

```bash
./bin/stock-guru live-auto-checklist --account-number YOUR_AGENTIC_ACCOUNT_NUMBER
```

Show the exact config changes and blockers before arming:

```bash
./bin/stock-guru live-auto-arm-plan --account-number YOUR_AGENTIC_ACCOUNT_NUMBER
```

Refresh local dry-run launch evidence in one pass:

```bash
./bin/stock-guru live-auto-evidence --tickers AAPL,NVDA,MSFT --account-number YOUR_AGENTIC_ACCOUNT_NUMBER
```

For a real Codex/MCP launch, require broker-tool status during preflight:

```bash
./bin/stock-guru live-auto-preflight --account-number YOUR_AGENTIC_ACCOUNT_NUMBER --require-broker-tool-status --require-reconciliation --require-account-health --require-capital-policy
```

Generate broker account-health and broker/lifecycle reconciliation reports before that final preflight:

```bash
./bin/stock-guru live-auto-health --tickers AAPL,NVDA,MSFT --account-number YOUR_AGENTIC_ACCOUNT_NUMBER
./bin/stock-guru live-auto-reconcile --account-number YOUR_AGENTIC_ACCOUNT_NUMBER
```

The local health command checks dry-run account values, quote presence/freshness, spread, tradability, warnings, restrictions, and open orders. The local reconciliation command accepts dry-run broker state flags such as `--broker-position AAPL:0.1:200` and `--broker-open-order ORDER_ID:AAPL:buy:confirmed`. In a real Codex/MCP launch, these same modules should be fed by live Robintrade portfolio, quotes, tradability, positions, and open orders.

The launch checklist writes `data/live_auto_launch_checklist.json` and aggregates heartbeat, broker reconciliation, account health, performance audit, capital policy, strategy health, replay optimization, and strict preflight blockers into one go/no-go view.

The arm plan writes `data/live_auto_arm_plan.json`. It does not edit `config/settings.json`; it shows the exact fields that would need to change, including `live_account_number`, `live_auto_trading_enabled`, and `live_order_confirmation_policy`, plus all strict preflight blockers.

The local evidence bundle writes account health, reconciliation, performance audit, capital policy, and launch checklist artifacts in one pass. It is still dry-run/local broker state unless Codex/MCP live broker wiring feeds equivalent modules with real Robintrade data.

Refresh strategy-health metrics from filled lifecycle orders, then run preflight:

```bash
./bin/stock-guru strategy-health
./bin/stock-guru performance-audit
./bin/stock-guru capital-policy
./bin/stock-guru live-auto-preflight --account-number YOUR_AGENTIC_ACCOUNT_NUMBER
```

Or run the full evidence pipeline in one pass:

```bash
./bin/stock-guru live-auto-prepare --tickers AAPL,NVDA,MSFT --account-number YOUR_AGENTIC_ACCOUNT_NUMBER
```

This downloads recent minute candles once, writes `data/strategy_health.json`, writes walk-forward `data/replay_optimization.json`, writes local dry-run launch evidence artifacts by default, then runs preflight. Use `--no-local-evidence` when you only want replay/optimization artifacts.

Replay the strict intraday rules against recent minute candles and optionally write the replay metrics into strategy health:

```bash
./bin/stock-guru intraday-replay --tickers AAPL,NVDA,MSFT --period 5d --interval 1m --write-health
```

Rank strictness settings by replayed edge/risk:

```bash
./bin/stock-guru intraday-optimize --tickers AAPL,NVDA,MSFT --period 5d --interval 1m --top 5 --write-report
```

Check that tuned settings survive later candles instead of only fitting the training slice, and write the official optimization report:

```bash
./bin/stock-guru intraday-walk-forward --tickers AAPL,NVDA,MSFT --period 5d --interval 1m --train-fraction 0.6 --top 5 --write-report
```

The replay report includes per-symbol attribution and an eligible-symbol list. Preflight checks the live session gate, lifecycle state, heartbeat freshness, kill switch, and strategy-health metrics in `data/strategy_health.json`. Weak expectancy, too few completed trades, or excessive drawdown block live-auto readiness.

Lifecycle preflight also blocks unreconciled `READY_TO_PLACE` orders and intraday positions carried past their same-day exit deadline unless an explicit overnight override exists. Those states must be reconciled against broker orders/positions before live auto is armed.

The broker reconciliation report writes `data/broker_reconciliation_report.json` and blocks arming when broker positions, open broker orders, lifecycle positions, or lifecycle order plans disagree. This is the guard against duplicate entries, phantom positions, and missed exit obligations.

The broker account-health report writes `data/broker_account_health.json` and blocks new entries when buying power, account restrictions, broker warnings, missing/stale quotes, unsafe spreads, failed tradability, or open orders make autonomous entries unsafe.

The performance audit writes `data/performance_audit.json` and `reports/performance_audit.md` from filled lifecycle orders. It reports per-trade P/L, expectancy, drawdown, profit factor, average duration, and whether the evidence is strong enough to scale capital. A weak or tiny sample should keep the system at the default bankroll.

The capital policy writes `data/capital_policy.json` and recommends `HOLD_CURRENT_BANKROLL`, `SCALE_UP`, or `REDUCE_OR_LOCKOUT`. It never edits `config/settings.json` automatically. Scaling requires enough audited trades, positive expectancy, acceptable drawdown, and sufficient profit factor. Until then, the default `$25` live guardrails stay in force.

Strict preflight can require a fresh capital policy report. `HOLD_CURRENT_BANKROLL` is safe for the current bankroll, `SCALE_UP` is only a recommendation, and `REDUCE_OR_LOCKOUT` is a live-auto blocker.

The optimizer can write `data/replay_optimization.json`. With `live_require_walk_forward_optimization` enabled, preflight blocks reports that are not walk-forward validated, are stale, have no best candidate, or have no eligible symbols. This keeps live-auto from trusting old or in-sample-only tuning.

If `live_use_optimized_intraday_settings` is `true`, autonomous entry decisions use the fresh optimizer report's intraday thresholds. Only decision knobs are applied: entry score, auto-order score, relative volume, and max spread. Bankroll and live risk guardrails are never overwritten by replay optimization.

The autonomous runner uses the same strategy-health gate for entries. If `live_require_strategy_health_for_entries` is `true`, missing or weak strategy metrics block new buys even when the account gate is armed. Risk-reducing sells remain allowed when the account/session gate permits exits.

When strategy health includes `eligible_symbols`, autonomous entry evaluation is restricted to those replay-qualified symbols. This keeps one strong aggregate result from hiding weak names that should not receive new capital.

Block new autonomous buys immediately while still allowing risk-reducing sells:

```bash
./bin/stock-guru live-auto-kill --enabled --reason "manual pause"
```

Re-arm buys after review:

```bash
./bin/stock-guru live-auto-kill --disabled --reason "resume"
```

The Codex-run live path uses `CodexMcpBrokerClient` with injected Robintrade MCP functions. The local Python app does not import MCP tools directly; Codex supplies the live broker calls during an autonomous execution session.

Run a supervised autonomous dry-run session:

```bash
./bin/stock-guru live-auto-session --tickers AAPL,NVDA,MSFT --cycles 5 --interval-seconds 60
```

This writes `data/live_auto_session.json` plus the normal live-auto heartbeat. By default it is review-only and does not even simulate filled orders. Add `--simulate-placement` only when you want `DryRunBrokerClient` to mark ready orders as filled for local testing.

The local command deliberately refuses `--live`. Real placement requires Codex to inject `CodexMcpBrokerClient`/`RobintradeBrokerClient` callables so every cycle can use Robintrade portfolio, positions, orders, quotes, tradability, broker review, and placement functions. The supervised session loop stops on hard cycle/runtime limits, stops when the live gate is fully blocked, and enables the kill switch after repeated broker/transport failures.

Required Codex/Robintrade MCP tools for live placement:

- `get_portfolio`
- `get_equity_positions`
- `get_equity_orders`
- `get_equity_quotes`
- `get_equity_tradability`
- `review_equity_order`
- `place_equity_order`

`cancel_equity_order` is optional until cancellation automation is enabled. The adapter validates this tool contract before construction. Review calls deliberately omit `ref_id`; placement calls require a client `ref_id` and fail without one, preserving client-side idempotency.

## Expanded Live Universe

When you omit `--tickers`, the live monitor no longer stays on a tiny fixed list. It now:

- keeps the curated names from [`/Users/ceo/Documents/stocks/config/universe.txt`](/Users/ceo/Documents/stocks/config/universe.txt)
- loads a cached U.S. common-stock catalog from Twelve Data
- rotates additional names into each cycle so the agent sweeps a broader opportunity set over time

Default live settings:

- `--max-symbols 80`
- `--rotate-count 40`

Use the recurring live loop:

```bash
./bin/stock-guru live-agent --cache-first-history --history-cache-hours 36
```

Run a single cycle:

```bash
./bin/stock-guru live-agent --once --cache-first-history --history-cache-hours 36
```

If you want a tighter cycle time, reduce `--max-symbols`. If you want broader coverage, increase it and accept a slower cycle.

## Configure

Edit [config/settings.json](/Users/ceo/Documents/stocks/config/settings.json) to change risk sizing and default budgets.

Edit [config/universe.txt](/Users/ceo/Documents/stocks/config/universe.txt) to change the default ticker universe.

## Daily Workflow

1. Run `python -m stock_guru scan --budget YOUR_BUDGET` before the market opens.
2. Keep only names with clear reasons and liquid volume.
3. During the market, run `python -m stock_guru watch --interval 60`.
4. Record anything you would have bought or sold with `paper`.
5. Review `reports/latest.md` after the close.

To test the automatic paper loop, run `python -m stock_guru paper bot --budget 20 --interval 60` during market hours and review the CSV ledger afterward.

## Data

Market data comes from Yahoo Finance through `yfinance`. Quotes may be delayed depending on exchange and data availability. For real trading, pair this with your broker's official quotes and order confirmations.

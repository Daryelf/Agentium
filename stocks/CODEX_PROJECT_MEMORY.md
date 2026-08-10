# Stock Guru Project Memory

Last updated: 2026-08-10

## Purpose

Stock Guru is a live/delayed market scanner, ranking engine, paper-trading journal, watch loop, and guarded live-broker decision-support tool.

## Current state

- Python project with CLI package `stock_guru`.
- Scanner blends momentum, trend, liquidity, volatility, and distance from highs into a 0-100 score.
- Paper bot can simulate fractional trades and write state under `data/`.
- Telegram alerts and approval polling are supported when configured.
- Live broker mission is guarded for the Agentic account and requires explicit human approval before any real order. Argentum owns the separate server-side Robinhood MCP OAuth and one-use execution boundary; Stock Guru never receives OAuth tokens or calls order tools.
- Copy Trader Mirror Lab now evaluates attributable public signals for disclosure delay, freshness, price drift, duplicates, and bounded paper sizing. An opt-in, rate-limited official SEC Form 4 importer can refresh named-CIK watchlists and rebuild the plan continuously. Form 13F, congressional PTRs, and event contracts remain research-only. Neither importer nor engine has a live-order call; Stock Office can create an exact Human Gate review record only.

## Useful commands

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -e .
python -m pytest
./bin/stock-guru doctor --tickers AAPL,MSFT,NVDA
./bin/stock-guru live-agent --once --cache-first-history --history-cache-hours 36
PYTHONPATH=src .venv/bin/python -m stock_guru copy-plan
PYTHONPATH=src .venv/bin/python -m stock_guru copy-refresh-sec
PYTHONPATH=src .venv/bin/python -m stock_guru copy-watch-sec --interval-minutes 15
```

## When continuing on another Mac

1. Open this folder from the external drive in Codex.
2. Ask Codex to read `AGENTS.md`, this file, and `README.md` first.
3. Recreate or verify the virtual environment on the MacBook Air.
4. Confirm provider keys, Telegram settings, and broker access are configured locally before running live workflows.
5. Update this file after any strategy, risk, account, or automation changes.

## Notes to verify after moving

- Some older README links may still point to `/Users/ceo/Documents/stocks/...`; when using the external drive, prefer this project folder path instead.
- Live market data and recommendations must be refreshed when used because prices and conditions change constantly.

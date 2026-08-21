# Stock Guru Codex Instructions

## First steps

- Read `CODEX_PROJECT_MEMORY.md` and `README.md` before changing code.
- Treat this folder as the portable source of truth when the ZYLO drive moves between Macs.
- Remember this is decision-support software, not financial advice, and it must not place real trades by itself.

## Project shape

- Python package source lives in `src/stock_guru/`.
- CLI entrypoint is `stock_guru.cli:app`.
- Reports are written under `reports/`.
- Runtime state, caches, paper ledgers, and provider data live under `data/`.
- Config lives under `config/`.

## Commands

- Create environment with `python3 -m venv .venv`.
- Activate with `source .venv/bin/activate`.
- Install with `pip install -r requirements.txt` and `pip install -e .`.
- Prefer the repo wrapper for automation: `./bin/stock-guru`.
- Run tests with `python -m pytest`.
- Run the doctor with `./bin/stock-guru doctor --tickers AAPL,MSFT,NVDA`.

## Safety and secrets

- Do not store brokerage credentials, provider keys, Telegram tokens, or account secrets in project memory.
- Do not place real broker orders without explicit human approval in the current thread.
- Keep Robinhood/Robintrade work limited to the Agentic account unless the user explicitly says otherwise.
- Verify live market facts with current data before giving stock-specific guidance.

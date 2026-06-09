# Argentum Codex Instructions

## First steps

- Read `CODEX_PROJECT_MEMORY.md` and `README.md` before changing code.
- Treat this folder as the portable source of truth when the ZYLO drive moves between Macs.
- Preserve the supervised-agent safety model: Argentum can draft and propose, but high-risk actions require human approval.

## Project shape

- This is a plain Node.js local prototype.
- Main files are `server.js`, `script.js`, `styles.css`, and `index.html`.
- Persistent local state lives in `data/argentum-state.json`; do not commit runtime state unless the user explicitly asks.
- The first visible agent is Depo, defined in `agents/depo.manifest.json`.

## Commands

- Run the app with `npm start`.
- Check syntax with `npm run check`.
- Open the local prototype at `http://127.0.0.1:5173`.

## Safety and secrets

- Do not store real credentials, API keys, session secrets, or financial permissions in project memory.
- Ask before changing deployment credentials, admin auth rules, or any action that could contact customers, move money, publish externally, or place trades.

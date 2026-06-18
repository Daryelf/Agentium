# Launch Desk

Launch Desk is a polished frontend plus Node API that uses the current OpenAI Agents SDK to turn a rough product launch brief into an actionable release plan.

It is intentionally structured so the agent is not just a chatbot. The server runs a Launch Desk Planner agent with local tools for task extraction, readiness scoring, owner checklist generation, and channel-specific launch copy.

## Setup

```bash
cd "LAUNCH DESK "
npm install
cp .env.example .env
```

Add your server-side key to `.env`:

```bash
OPENAI_API_KEY=sk-...
LAUNCH_DESK_MODEL=gpt-5.4-mini
LAUNCH_DESK_PORT=4188
LAUNCH_DESK_TRACE_ENABLED=true
```

Do not put the API key in frontend JavaScript. The browser only calls this app's backend.

## Run

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:4188
```

## API

- `GET /api/health` returns safe server status.
- `GET /api/launch/status` returns safe provider/model status.
- `POST /api/launch/stream` streams Server-Sent Events:
  - `progress`
  - `tool_progress`
  - `text_delta`
  - `final`
  - `error`

## Project Structure

```text
index.html
server.js
src/client/
  main.js
  styles.css
src/server/
  agent/
    launchAgent.js
    tools.js
  observability/
    tracing.js
  routes/
    agentRoutes.js
  stream/
    sse.js
tests/
  tool-contract.test.mjs
  e2e-stream.mjs
```

## Agent Tools

- `extract_launch_tasks`: converts the launch brief into prioritized work.
- `check_launch_readiness`: scores readiness and builds a risk register.
- `generate_owner_checklist`: creates role-based launch checklists.
- `draft_channel_launch_copy`: drafts channel-specific copy.

The agent instructions require these tools before the final response.

## Verification

Static and tool contract checks:

```bash
npm run check
npm test
```

End-to-end stream verification with the server running and `OPENAI_API_KEY` available to both the server process and the test process:

```bash
npm run verify:e2e
```

The E2E test posts to `/api/launch/stream` and reads the stream until it receives at least one `tool_progress` event and one `text_delta` event.

## Extending

Add a new deterministic helper in `src/server/agent/tools.js`, wrap it with `tool(...)`, add it to `launchTools`, and update the agent instructions in `src/server/agent/launchAgent.js`.

For handoffs later, add a second agent and expose it through SDK handoffs or `agent.asTool()` only when the workflow needs a genuinely separate planning role.

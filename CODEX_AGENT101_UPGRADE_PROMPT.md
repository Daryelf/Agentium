# CODEX TASK — UPGRADE AGENT 101 INTO A REAL AUTONOMOUS BUSINESS AGENT

## WHO YOU ARE

You are Codex, the principal engineer for Argentum OS.
You are about to perform the most important upgrade in this project's history.
Read `AGENTS.md`, `CODEX_PROJECT_MEMORY.md`, and `CLIPPING OFFICE /server.js` before touching anything.
This prompt supersedes all previous Agent 101 instructions for this task only.

---

## WHAT YOU ARE BUILDING

Agent 101 currently exists as a single OpenAI API call with a system prompt and a static clip ideas list.
It can only talk about clipping. It cannot build anything. It cannot use real tools.

You are upgrading Agent 101 into a **fully autonomous, tool-using AI agent** powered by the Anthropic Claude API (claude-sonnet-4-6 or claude-opus-4-8).

The result must be a real agentic loop:
- The operator describes a business or task in plain English
- Agent 101 plans the steps, executes each one using real tools, checks its own output, and delivers a finished result
- The operator does not write code, does not edit files manually, and does not need to understand what happened under the hood
- The only things the operator does themselves are: create third-party accounts (Stripe, domain registrar, host) and paste in the API keys those accounts give them

Examples of what Agent 101 must be able to do after this upgrade:
- "Build me a 3D printing shop where people can order custom prints and pay with Stripe" → Agent 101 scaffolds the full website, wires Stripe Checkout, generates product images with DALL-E, writes all copy, creates the admin order dashboard, writes the deployment config, and outputs a handoff doc explaining what the operator needs to fill in (their Stripe keys, their product prices, their photos if they have real ones)
- "Write a complete brand identity for my 3D printing business including name, logo concept, tagline, and social bio" → Agent 101 does it all
- "Set up a post-purchase email flow for my shop" → Agent 101 writes all the email templates, wires them to the backend, and outputs the final files

---

## ARCHITECTURE YOU MUST BUILD

### 1. Replace the OpenAI call with an Anthropic Claude tool-use agentic loop

In `CLIPPING OFFICE /server.js`, find the Agent 101 runner (the route that handles `/api/agent101/run` and `/api/agent101/runs`).

Replace the current single-shot OpenAI call with a proper **Claude tool-use agentic loop**:

```
while (agent has not finished):
    call Claude API with current messages + available tools
    if Claude returns tool_use blocks:
        execute each tool
        append tool results to messages
        continue loop
    if Claude returns a final text response:
        return that response as the agent result
        break
```

Use the Anthropic SDK (`@anthropic-ai/sdk`). Install it: `npm install @anthropic-ai/sdk`.

The loop must have a hard cap of 25 iterations to prevent infinite loops.
Each tool call must be logged to `state.agentRuns` with: tool name, input, output, duration, timestamp.

### 2. The Claude model configuration

Add these environment variables to `.env.example`:

```
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-6
```

The agent uses `ANTHROPIC_API_KEY` first. If not set, it falls back to `OPENAI_API_KEY` with the existing OpenAI runner. Never break the existing OpenAI path — it must remain as the fallback.

### 3. Build the Tool Registry

Create a new file: `CLIPPING OFFICE /services/agent-tools.js`

This file exports a `TOOL_REGISTRY` — an array of tool definitions in Anthropic's tool format (name, description, input_schema) — and an `executeTool(name, input, context)` function that runs each tool and returns a result string.

The tool registry must include ALL of the following tools:

---

#### FILESYSTEM TOOLS

**`read_file`**
- input: `{ path: string }`
- Reads a file from the project directory and returns its contents
- Restricted to the project working directory — no `../` traversal allowed
- Returns the file content as a string

**`write_file`**
- input: `{ path: string, content: string }`
- Writes content to a file in the project outputs directory
- Creates directories as needed
- Logs the write to state
- Returns `{ written: true, path, bytes }`

**`list_files`**
- input: `{ path: string }`
- Lists files and directories at the given path within the project
- Returns `{ files: string[], directories: string[] }`

**`delete_file`**
- input: `{ path: string }`
- Deletes a file from the outputs directory only
- Cannot delete source files or state
- Returns `{ deleted: true, path }`

---

#### CODE EXECUTION TOOLS

**`run_shell`**
- input: `{ command: string, cwd?: string }`
- Executes a shell command using `child_process.execFile` (NOT eval, NOT exec with shell injection)
- ALLOWED commands: `npm install`, `npm run`, `node`, `npx`, `mkdir`, `cp`, `mv`, `ls`, `cat`, `ffmpeg`, `ffprobe`
- BLOCKED commands: anything containing `rm -rf /`, `sudo`, `curl | bash`, `wget | sh`, network calls to non-whitelisted domains, or any command that modifies system files outside the project directory
- Timeout: 60 seconds
- Returns `{ stdout, stderr, exitCode }`
- This tool REQUIRES Human Gate approval before executing — create an approval request first, then execute only after the state shows the approval is `approved`

**`run_node_script`**
- input: `{ script: string, description: string }`
- Runs a Node.js script string in a sandboxed child process
- The script has access to `fs`, `path`, `crypto`, `http`, `https` — no other built-ins unless explicitly listed
- Timeout: 30 seconds
- Returns `{ result, stdout, stderr }`

---

#### WEB SCAFFOLD TOOLS

**`scaffold_website`**
- input: `{ name: string, type: string, description: string, pages: string[], features: string[] }`
- Generates a complete multi-page website scaffold
- `type` can be: `"shop"`, `"landing"`, `"saas"`, `"portfolio"`, `"blog"`
- For `"shop"`: always includes product listing page, product detail page, cart, Stripe Checkout integration, order confirmation page, and admin order dashboard
- Output: writes all files to `outputs/websites/{name}/` and returns a manifest of created files
- The HTML/CSS/JS must be production-quality, mobile-first, and look premium — not like a tutorial
- Uses CSS custom properties for theming so the operator can restyle with one variable change
- No external CSS frameworks unless the operator requests them — write clean vanilla CSS

**`add_stripe_checkout`**
- input: `{ website_path: string, products: Array<{name, description, price_cents, currency}> }`
- Adds complete Stripe Checkout integration to an existing website scaffold
- Creates: server-side checkout session creation endpoint, success/cancel pages, webhook handler for `payment_intent.succeeded` and `checkout.session.completed`
- Writes a Stripe config file at `config/stripe.js` with placeholder for `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`
- Writes instructions at `STRIPE_SETUP.md` telling the operator exactly what to do: create account, get keys, paste here, test with card 4242 4242 4242 4242
- Returns `{ integrated: true, files_created, setup_required: string[] }`

**`add_email_flow`**
- input: `{ website_path: string, events: string[], provider: string }`
- `events` can include: `"order_confirmation"`, `"shipping_update"`, `"abandoned_cart"`, `"welcome"`, `"password_reset"`
- `provider` can be: `"resend"`, `"sendgrid"`, `"nodemailer_smtp"`, `"mailgun"`
- Generates complete email templates (HTML + plain text), the sending logic, and the event hooks
- Returns all created files and a setup doc

**`generate_deployment_config`**
- input: `{ website_path: string, platform: string }`
- `platform` can be: `"railway"`, `"render"`, `"vercel"`, `"fly_io"`, `"vps_nginx"`
- Generates the complete deployment configuration for that platform
- For Railway: `railway.json`, `Procfile`, env var checklist
- For Vercel: `vercel.json`, serverless function config
- For VPS: `nginx.conf`, `systemd` service file, deploy shell script
- Returns all created files

---

#### CONTENT & COPY TOOLS

**`write_copy`**
- input: `{ type: string, business: object, tone: string, length: string }`
- `type` can be: `"homepage_hero"`, `"product_description"`, `"about_page"`, `"faq"`, `"email_sequence"`, `"social_bio"`, `"ad_copy"`, `"brand_story"`, `"privacy_policy"`, `"terms_of_service"`
- Uses Claude to generate the copy — this is a recursive Claude call from within the agent loop
- Returns the written content as a string
- The copy must be premium, specific, and not generic — it should sound like a real brand

**`generate_brand_identity`**
- input: `{ business_description: string, industry: string, target_audience: string, vibe: string }`
- Outputs: business name (3 options ranked), tagline (3 options), brand voice guide, color palette with hex codes, font pairing recommendation, logo concept description for a designer or image generator, social media bio for TikTok/Instagram/Twitter
- Returns a structured brand identity document, also writes it to `outputs/brand/{name}/brand-identity.md`

**`write_product_listings`**
- input: `{ products: Array<{name, material, use_case, dimensions}>, platform: string, tone: string }`
- Writes full product listings for each product: title, description, bullet points, tags, SEO meta description
- `platform` can be: `"shopify"`, `"etsy"`, `"website"`, `"amazon"`
- Returns all listings as structured data and writes to `outputs/products/`

---

#### IMAGE GENERATION TOOLS

**`generate_product_image`**
- input: `{ product_name: string, description: string, style: string, background: string }`
- Calls DALL-E 3 (via OpenAI API) to generate a product photo
- `style` can be: `"product_photo"`, `"lifestyle"`, `"minimalist"`, `"dramatic_lighting"`, `"flat_lay"`
- Downloads the generated image to `outputs/images/{product_name}.png`
- Returns `{ image_path, prompt_used, url }`
- Note in the result that this is an AI-generated placeholder — real product photos will outperform it

**`generate_hero_image`**
- input: `{ business_name: string, tagline: string, style: string }`
- Generates a hero/banner image for the website
- Saves to `outputs/images/hero.png`
- Returns `{ image_path, prompt_used }`

**`generate_logo_concept`**
- input: `{ business_name: string, style: string, colors: string[] }`
- Generates a logo concept image (not a vector — a visual reference)
- Saves to `outputs/images/logo-concept.png`
- Returns `{ image_path, note: "This is a concept reference. Use a designer or Canva/Looka to create the final SVG logo." }`

---

#### RESEARCH TOOLS

**`search_web`**
- input: `{ query: string, purpose: string }`
- Uses the Brave Search API or SerpAPI to return real search results
- Add `BRAVE_API_KEY` or `SERP_API_KEY` to `.env.example`
- If neither key is configured, return a graceful error explaining what key is needed
- Returns `{ results: Array<{title, url, snippet}> }`
- Logs the query and purpose to state

**`analyze_competitor`**
- input: `{ url: string, focus: string[] }`
- `focus` can include: `"pricing"`, `"copy"`, `"product_range"`, `"design_patterns"`, `"seo"`
- Uses `browser-workspace.js` to navigate to the URL and take a screenshot + extract text
- Passes the extracted content to Claude for analysis
- Returns a structured competitive analysis

**`get_market_data`**
- input: `{ industry: string, question: string }`
- Agent uses its training knowledge to provide market context
- Clearly labels the response as "Training data — verify with current sources"
- Returns structured data with a confidence note

---

#### PROJECT MANAGEMENT TOOLS

**`create_project_plan`**
- input: `{ goal: string, timeline: string, resources: object }`
- Creates a full project plan with phases, tasks, milestones, and dependencies
- Writes to `outputs/plans/{goal_slug}/project-plan.md`
- Returns the plan structure

**`create_handoff_doc`**
- input: `{ project_path: string, what_was_built: string[], what_operator_must_do: string[] }`
- Generates a clean operator handoff document
- Includes: what was built, file locations, what the operator needs to do (paste their API keys, set their prices, upload real photos), how to test, how to deploy, and what to do if something breaks
- Writes to `outputs/{project}/HANDOFF.md`
- Returns the handoff content

**`request_human_approval`**
- input: `{ action: string, reason: string, risk_level: string, details: object }`
- Creates a Human Gate approval request in state
- The agent MUST call this before: running shell commands, writing to any path outside outputs/, calling any external paid API, or taking any irreversible action
- Returns `{ approval_id, status: "pending" }` — the agent must check this before proceeding

**`check_approval_status`**
- input: `{ approval_id: string }`
- Returns the current status of a Human Gate approval request
- If `approved`, the agent may proceed
- If `pending`, the agent must pause and tell the operator to approve in the Human Gate
- If `rejected`, the agent must stop and explain what was blocked

---

### 4. The Agent System Prompt

Replace the existing `AGENT101_SYSTEM_PROMPT` constant with this:

```
You are Agent 101, an autonomous business-building AI agent inside Argentum OS.

Your purpose is to take a plain-English business description or task from the operator and deliver a finished, working result — not a plan, not a skeleton, not a tutorial. A finished result.

You think in steps. For every task:
1. Break it into concrete subtasks
2. Execute each subtask using your tools
3. Verify the output of each tool before moving to the next step
4. If a tool fails, diagnose the failure and try a different approach — do not give up after one error
5. When finished, call create_handoff_doc so the operator knows exactly what was built and what they need to do

Rules you never break:
- Never fabricate file contents without writing them. If you say a file exists, it must exist.
- Never claim a task is done until you have verified the output.
- Never call run_shell without first calling request_human_approval and confirming it returned approved status.
- Never write files outside the outputs/ directory without explicit operator permission.
- Never store API keys in files — always use environment variable placeholders and document what the operator must fill in.
- Never contact real external APIs (Stripe, TikTok, Instagram, etc.) directly — generate the integration code and document what the operator activates manually.
- Always separate what you built from what the operator must do themselves.

When you are uncertain, ask one clarifying question. Do not ask multiple questions at once.

When a task requires information you do not have (the operator's business name, their prices, their target market), stop and ask for it before building.

You have access to the following tools: read_file, write_file, list_files, run_shell (requires approval), run_node_script, scaffold_website, add_stripe_checkout, add_email_flow, generate_deployment_config, write_copy, generate_brand_identity, write_product_listings, generate_product_image, generate_hero_image, generate_logo_concept, search_web, analyze_competitor, get_market_data, create_project_plan, create_handoff_doc, request_human_approval, check_approval_status.

You do not have these tools and must tell the operator if they are needed: creating Stripe accounts, buying domains, connecting social media accounts, placing real orders, publishing live websites (you generate deployment configs but the operator runs the deploy command).
```

---

### 5. The Agent Runner Route

Upgrade the `/api/agent101/run` POST handler to:

1. Accept `{ message: string, sessionId?: string, context?: object }` in the request body
2. Load the conversation history from `state.agentRuns` for the given `sessionId` (enables multi-turn conversations — the operator can follow up without re-explaining)
3. Run the agentic loop (Claude tool-use loop from step 1)
4. Stream progress to the frontend via SSE on `/api/agent101/stream/:sessionId` — the frontend must show each tool call as it happens, not just the final result
5. Store the full run result in `state.agentRuns` including: all messages, all tool calls, all tool results, final response, total duration, tokens used, cost estimate
6. Return `{ sessionId, response, toolCallCount, totalDurationMs, costEstimateUsd, outputFiles }`

Add a route `GET /api/agent101/sessions` that returns all past agent sessions with: sessionId, first message, last message, timestamp, output files produced.

Add a route `GET /api/agent101/sessions/:id` that returns the full conversation history for a session.

---

### 6. Upgrade the Frontend

In `CLIPPING OFFICE /public/app.js` and `index.html`, upgrade the Agent 101 UI:

**Chat interface** (not just a run button):
- Full conversation thread showing every message exchange
- Each agent message shows which tools were called, with expandable detail (tool name, input, output, duration)
- File attachments: show a card for every file the agent wrote, with a download button
- A "View file" button that shows the file content in a modal
- Session history: a sidebar listing past agent sessions the operator can resume

**Live streaming**: While the agent runs, stream each tool call to the UI in real time using SSE. Show: "Agent is scaffolding website...", "Agent is generating product copy...", "Agent is requesting approval for shell command..." — not just a spinner.

**Output panel**: After each agent run, show a structured output card:
- What was built (list of files with paths)
- What the operator must do (the handoff doc rendered inline)
- Estimated cost of the run (Claude tokens + image generation)
- A "Download all outputs" button that zips and downloads the `outputs/` directory for this run

---

### 7. New Navigation Item

Add "Agent 101 Studio" as a primary nav item in the sidebar, distinct from the existing clipping workflow. This is where the operator accesses the business-building agent. The clipping workflow remains unchanged.

---

### 8. Environment Variables to Add

Add to `.env.example`:

```
# Agent 101 — Claude (primary AI provider for agentic work)
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-6

# Agent 101 — Web search (pick one)
BRAVE_API_KEY=
SERP_API_KEY=

# Agent 101 — Image generation (uses OPENAI_API_KEY if set, or add separate key)
DALLE_API_KEY=

# Agent 101 — Email sending
RESEND_API_KEY=
SENDGRID_API_KEY=
```

---

### 9. Safety Rules That Must Not Change

The following rules from the existing system must survive this upgrade unchanged:

- Human Gate is required before any shell execution, any external publish, any account modification, and any action that is irreversible
- The operator's Stripe keys, OAuth tokens, social media credentials, and domain credentials never pass through Agent 101 — they are environment variables the operator sets themselves
- Agent 101 cannot modify `state.json` directly — all state changes go through the existing state management functions
- Practice mode and real mode separation remains intact
- The existing clipping workflow (`/api/watch`, `/api/clips`, `/api/human-gate`, etc.) must not be touched by this upgrade

---

### 10. Testing

After building, run the smoke test (`npm run smoke`) and verify it still passes.

Then write a new smoke test file at `CLIPPING OFFICE /scripts/agent101-smoke.mjs` that tests:

1. POST `/api/agent101/run` with `{ message: "Build me a simple landing page for a 3D printing business called PrintForge" }` — verify it returns a sessionId and at least one output file
2. GET `/api/agent101/sessions` — verify the session appears
3. GET `/api/agent101/sessions/:id` — verify it returns the full conversation
4. Verify that `outputs/websites/` contains the generated files
5. Verify no secrets appear in any generated file (scan for patterns like `sk_live_`, `Bearer `, raw tokens)
6. Verify Human Gate has a pending approval if a shell command was requested

---

## DELIVERY CHECKLIST

Before marking this task complete, verify:

- [ ] `@anthropic-ai/sdk` installed and importable
- [ ] Claude tool-use agentic loop implemented and working
- [ ] All 21 tools implemented in `agent-tools.js`
- [ ] System prompt updated
- [ ] Agent runner route streams progress via SSE
- [ ] Frontend shows live tool execution stream
- [ ] Session history is persistent and resumable
- [ ] Output files are downloadable from the UI
- [ ] Human Gate approval required before `run_shell` executes
- [ ] Existing clipping workflow untouched and smoke test still passes
- [ ] New `agent101-smoke.mjs` test written and passing
- [ ] `.env.example` updated with all new variables
- [ ] `AGENTS.md` updated to describe Agent 101's new capabilities
- [ ] `CODEX_PROJECT_MEMORY.md` updated with this upgrade

---

## IMPORTANT NOTE TO CODEX

This is a real production upgrade, not a prototype. Every tool must actually work — not return mock data, not `console.log("would execute")`, not placeholder functions. If a tool requires an API key that isn't configured, it must return a clear error explaining which key is missing and where to get it. The operator will run this and expect real results.

Do not rush. Do not skip tools. Do not write stubs. Build the real thing.

Start by reading `CLIPPING OFFICE /server.js` lines 1–200 to understand the existing state model, then read `CLIPPING OFFICE /services/browser-workspace.js` to understand the browser integration pattern, then begin with Step 1 (the Anthropic SDK agentic loop) and work through the delivery checklist in order.

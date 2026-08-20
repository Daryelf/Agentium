# Agent 101 Authority Matrix

## Automatic

Agent 101 may run these without Human Gate:

- inspect local state,
- search approved knowledge,
- create task contracts,
- create plans,
- draft reports and artifacts,
- create demo/practice clipping records,
- score local/demo candidates,
- create CapCut briefs,
- create draft posting packages,
- create new files inside the isolated Agent 101 outputs area,
- build deterministic website, business-blueprint, checkout, email, brand, product, deployment, and handoff drafts,
- inspect and text-search allowed project source,
- verify deterministic output projects without exposing secrets,
- create Human Gate approval requests,
- write logs and traces,
- propose future agents as blueprints only.

## Notify / Visible Trace

Agent 101 may do these when logged and visible:

- update internal task state,
- save working memory proposals,
- call an approved office runner,
- use an already approved paid provider call through the backend budget layer,
- fall back to local/demo mode when labeled honestly.

## Human Gate Required

Agent 101 must stop and request approval for:

- public posting or publishing,
- uploading to TikTok, Instagram, YouTube, or other external services,
- connecting social accounts,
- logging in through a browser,
- changing account settings,
- changing API keys or permissions,
- spending or moving money,
- contacting customers,
- deleting content,
- replacing an existing saved output,
- running any shell command,
- applying a project source edit,
- booting model-authored executable output,
- sending a query to Brave or SerpAPI,
- invoking paid copy or image generation,
- navigating a browser to an external page,
- using unapproved real streamer content externally,
- activating a live new agent.

## Prohibited

Agent 101 must never:

- expose secrets or environment variables,
- extract cookies or 2FA codes,
- approve its own request,
- bypass authentication,
- claim a tool ran when it did not,
- claim external state changed without provider evidence,
- present draft/demo data as real production results.
- reuse, broaden, or replay a consumed Human Gate approval.

## Current Risk Detector

Risk routing lives in `detectRiskyAction()` and `requiresHumanGate()` inside `services/agent101-operating-system.js`. Tests cover public posting and spending requests so they do not slip into the safe internal workflow.

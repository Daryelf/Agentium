# Browser Workspace Security Model

## Security Goals

- Keep credentials, cookies, API keys, and tokens server-side.
- Do not expose Playwright control primitives to frontend JavaScript.
- Prevent Agent 101 from performing external risky actions without Human Gate.
- Keep the operator in charge when pages require typing, account access, or
  sensitive decisions.

## Backend Browser Boundary

The Browser Workspace runs through the backend `browser-workspace` service. The
frontend receives safe session metadata and screenshots only. It does not receive
raw browser context, cookies, local storage, API keys, or bearer tokens.

Persistent browser data lives in the app state/profile area and is controlled by
the server process. Railway environment variables remain the only production
secret source.

## URL And Domain Policy

Navigation is normalized and checked server-side before Playwright loads a page.

Blocked by default:

- non-HTTP protocols
- private or loopback hosts, except local development
- unknown domains that are not in the approved workspace policy

Known workspace categories:

- Twitch and Kick are allowed workspace targets for streamer research.
- Google, YouTube, TikTok, Instagram, and CapCut are manual-handoff targets.
- OpenAI and Argentum are read-only/support targets.

After navigation, the final URL is checked again so redirects cannot silently move
the browser into a disallowed domain.

## Controller Modes

| Mode | Meaning |
| --- | --- |
| `agent_assisted` | Agent 101 can inspect safe pages and suggest next steps. |
| `human_control` | Operator can click, type, scroll, and keypress through the backend input bridge. |
| `paused` | Agent work is suspended. |
| `privacy` | Screenshots can remain visible to the operator, but agent text extraction and agent input are blocked. |

## Policy Modes

| Mode | Allowed |
| --- | --- |
| `read_only` | View and inspect only. Typing and keypresses are blocked. |
| `manual_handoff` | Operator can proceed manually with sensitive setup. |
| `automated` | Safe internal browser checks only. |
| `privacy` | Sensitive state. Agent extraction and input are blocked. |

## Human Gate Boundary

The Browser Workspace must not directly perform:

- publishing or posting publicly
- uploading to social platforms
- spending money
- moving money
- changing accounts or credentials
- connecting social accounts
- deleting content
- using real streamer content without approved permission

Those actions become Human Gate approval packages instead of direct execution.

## Input Logging

Input events are logged without secret content. For text typing, logs include the
text length and action type, not the typed value. This keeps audit trails useful
without storing passwords, API keys, or private account data.

## Downloads And Files

Downloads are stored under the Browser Workspace downloads directory. Executable
file types are blocked from saving. Download metadata exposed to the frontend is
limited to safe fields such as filename, size, timestamp, session ID, and source
URL.

## Smoke Test Contract

The browser smoke test must verify:

- Chromium can launch from the server process.
- A real page can load.
- A screenshot can be captured.
- A tab can be created and switched.
- The input bridge can click, type, and keypress under human control.
- Privacy mode blocks visible-text extraction.


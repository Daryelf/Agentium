# Agent 101 Tool Map

Last updated: 2026-06-21

The live source of truth is `GET /api/agent101/tool-map`.

## Agent Policy

Agent 101 is a supervised worker. It may perform safe internal draft work and create Human Gate approval requests. It may not publish, upload, spend, change accounts, connect social accounts, delete content, or use unapproved real streamer content.

## Safe Internal Tools

| Tool | Route | Writes | Notes |
| --- | --- | --- | --- |
| Discover streamers | `POST /api/agent101/runs` | `discoveredStreamers`, `logs` | Real provider metadata only |
| Add practice streamers | `POST /api/agent101/run` | `streamers`, `logs` | Practice Mode only |
| Run watch cycle | `POST /api/watch/run` | `watchSessions`, `watchEvents`, `logs` | Real approved sources or explicit practice |
| Create candidates | `POST /api/clip-candidates` | `clipCandidates`, `logs` | Requires source truth |
| Score candidates | `POST /api/clips/candidates/score` | `clipCandidates`, `logs` | OpenAI if available, fallback if safe |
| Create package | `POST /api/clips/package` | `clipPackages`, `artifacts`, `logs` | Draft package only |
| Render clip | `POST /api/media/candidates/:id/render` | `mediaJobs`, `artifacts`, `logs` | Local source and probe required |
| Create posting draft | `POST /api/posting-drafts` | `postingDrafts`, `logs` | Requires verified clip artifact |
| Request approval | `POST /api/human-gate/requests` | `approvalRequests`, `logs` | Required before risky actions |

## Blocked Tools

- Public posting.
- Uploading to TikTok, Instagram, YouTube, Twitch, or Kick.
- Social login or OAuth connection.
- API key creation or change.
- Spending money.
- Account changes.
- Deleting external content.

Blocked tools should create a Human Gate request or return a clear prerequisite, not pretend success.

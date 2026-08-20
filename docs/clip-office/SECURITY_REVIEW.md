# Clip Office Security Review

## Current Controls

- Local mode binds the root backend to localhost through `localRuntime.assertLocalModeHost`.
- Secrets stay server-side through `services/secure-secrets.js` and public configs expose booleans/status labels instead of raw keys.
- High-risk Agent 101 actions are classified and routed to Human Gate.
- Clip Office candidate deletion is local-only and does not touch external accounts or remote source media.
- Upload size is bounded by `CLIPPER_MAX_UPLOAD_BYTES`.
- Media processing uses process execution paths built around `execFile`.
- Source-pending windows cannot be packaged or rendered as verified media.
- Local tests cover dangerous Agent 101 actions, secret non-exposure, local auth, and path traversal.

## Prompt Injection Defense

Transcripts, chat, titles, file names, provider metadata, and source descriptions must be treated as data. They may influence scoring, summaries, and labels, but they must not become tool commands. Privileged actions require typed server-side handlers and policy validation.

## Remaining Security Work Before Public Production

- Add real webhook signature verification for each provider before enabling production webhooks.
- Add per-workspace or per-user quotas if multi-tenant cloud mode is enabled.
- Add sandbox publishing tests for every platform adapter before production posting.
- Add signed Mac distribution with Developer ID if distributing outside the local machine.
- Add provider-token refresh rotation tests once refresh tokens are configured.

## Launch Risk

Local supervised operation is acceptable with current controls. Public internet exposure and automated publishing remain blocked until the missing external controls are configured and verified.

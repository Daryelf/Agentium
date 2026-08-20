# Clip Office Validation Report

Generated: 2026-07-13T15:16:28.127Z

## Scope

Local deterministic contract, static wiring, safety, queue, media-policy, and UI traceability validation. External publish tests are skipped unless sandbox credentials exist.

## Summary

- Total scenarios: 508
- Executed local scenarios: 500
- Passed: 500
- Failed: 0
- Skipped: 8
- Flaky: 0
- Critical consecutive passes: 10

## Category Results

| Category | Total | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| domain_unit_property | 120 | 120 | 0 | 0 |
| media_ingestion_transcription_candidate_render | 100 | 100 | 0 | 0 |
| queue_retry_concurrency_recovery | 80 | 80 | 0 | 0 |
| api_database_storage_webhook_integration | 80 | 80 | 0 | 0 |
| browser_complete_ui_workflow | 60 | 60 | 0 | 0 |
| auth_authorization_security_isolation | 30 | 30 | 0 | 0 |
| load_soak_resource_limit_backpressure | 30 | 30 | 0 | 0 |
| external_integration_blocker | 8 | 0 | 0 | 8 |

## Failures

No local validation failures.

## External Blockers

- tiktok-sandbox-publish: TikTok sandbox credentials and explicit publishing approval are required. Blocker: TIKTOK_CLIENT_ID/TIKTOK_CLIENT_SECRET.
- youtube-sandbox-publish: YouTube sandbox credentials and explicit publishing approval are required. Blocker: GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET.
- stripe-spend-action: Stripe/money movement is outside Clip Office safe internal validation. Blocker: STRIPE_SECRET_KEY plus Human Gate.
- remote-delete: Remote deletion requires an exact external artifact and explicit approval. Blocker: destination credentials.
- real-oauth-refresh: Provider OAuth refresh requires real refresh tokens. Blocker: TWITCH_REFRESH_TOKEN or provider token.
- production-webhook-signature: Webhook verification requires provider secret configured in the target environment. Blocker: provider webhook secret.
- signed-developer-id: Mac app signing requires an Apple Developer ID certificate. Blocker: Developer ID Application certificate.
- live-post-reconciliation: Live publication reconciliation requires an approved sandbox or production destination. Blocker: approved social sandbox.

## Evidence File

Machine-readable results: `artifacts/clip-office-validation/results.json`.

## Launch Interpretation

READY WITH LIMITATIONS for local supervised operation: local contracts pass, while external publishing and production account operations remain blocked on credentials and explicit Human Gate approval.


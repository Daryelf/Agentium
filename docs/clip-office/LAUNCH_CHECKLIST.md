# Clip Office Launch Checklist

## Local Supervised Launch

- [x] Dependency install succeeds.
- [x] Syntax checks pass.
- [x] Unit/integration tests pass.
- [x] Agent 101 evals pass.
- [x] 500 executable validation scenarios pass.
- [x] Local Mac build succeeds.
- [x] Root backend binds locally in local mode.
- [x] Clip Office stores local data outside the app bundle.
- [x] Secrets are server-side and not exposed to frontend code.
- [x] Human Gate blocks high-risk Agent 101 actions.
- [x] Watchlist approval can start a local watch session.
- [x] Clip Radar can create truthful 30-second watch windows.
- [x] Bulk candidate deletion is wired and persisted.
- [x] Source-pending candidates cannot be packaged as verified clips.
- [x] Agent 101 returns operational status instead of tool narration.

## Launch Limitations

- [ ] Sign and notarize Mac app with Apple Developer ID.
- [ ] Configure sandbox publishing credentials.
- [ ] Verify TikTok/YouTube publish dry-run and remote reconciliation.
- [ ] Configure webhook signing secrets for production providers.
- [ ] Verify OAuth refresh with real refresh tokens.
- [ ] Add production alerting for dead workers, quota exhaustion, and repeated failures.

## Verdict

READY WITH LIMITATIONS for local supervised operation.

NOT READY for automated public publishing until the unchecked external items are complete.

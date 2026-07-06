# CapCut Teach System — Determinism Upgrade Log
**Date: 2026-07-05 · Implemented by Claude (Fable session) from CODEX_CAPCUT_DETERMINISM_PROMPT.md**

---

## What changed, per work item

Follows the 2026-07-01 review. Goal: identical edit every run, or a safe stop at the exact phase that failed.

**New file:** `CLIPPING OFFICE /services/capcut-determinism.js` — all pure logic (wait clamping, condition polling, macro compilation, staged-clip validation, pixel measurements) so the smoke test covers it with fixtures, no live CapCut needed.

### WI-5 — Window pinning
`normalizeCapCutWindow()` sets the CapCut window to a fixed frame (default 1600×1000 @ 0,25) before every teach AND every replay. The teach-time frame is stored in the macro as `taughtWindowFrame` and restored on replay. If the OS refuses the size, `window_mismatch` is logged so the run report shows why coordinates scaled.

### WI-4 — Staged input clip
Replays with a `sourceVideoPath` input copy the clip to `Clips/_staging/NEXT_CLIP.mp4` first (copy, never move; validated: exists / .mp4 / non-empty). The taught workflow always sees the same filename in the same slot. The compile pass marks `choose_clip` thumbnail clicks `anchorUnreliable` — their pixels are the clip itself, so anchor matching now skips straight to semantic/ratio instead of failing a template match first.

### WI-2 — No more blind waits
Recorded human pauses clamp at execution time to 150–1200 ms (macro files keep the original values). New `waitForCondition()` polls a check with a timeout, honoring pause/cancel every poll — the emergency stop works mid-wait. Auto reframe is awaited by polling for the "Auto reframe applied" toast (45 s timeout), not a fixed sleep; `choose_clip` waits on timeline-has-media (20 s).

### WI-1 — Phase gates
At every phase boundary the finished phase is verified before the next phase starts: failed → replay that phase's steps once → re-verify → still failed → screenshot + Human Gate pause (resume re-verifies; only a pass continues; otherwise the replay stops with the phase named). A second `unknown` counts as failed for gating. Gate results are recorded in replay state (`gates[]`) and the run report. Proven in the smoke test: a stubbed failing verify on `canvas_916` never lets a `blur_background` step execute.

### WI-6 — Pixel-measured verification
- `verifyCanvasIs916`: measures the rendered canvas rectangle (letterbox bars included) against the dark UI chrome; asserts width/height within ±3% of 9:16. A 16:9 canvas measures ~1.78 — unambiguous.
- `verifyBlurBackground`: samples the top/bottom letterbox bands — flat black = failed, visible content = passed, indeterminate = text fallback.
- `verifyAutoReframeApplied` (new): toast seen by the completion poll, toast text on screen, or text fallback.
- `verifyStickerBottomCenter`: gradient-energy signal (sharp sticker over smooth blur) in the bottom-center vs the bottom sides, plus the existing text check.
All keep the old text checks as fallback, never as primary. **Not yet validated against live CapCut frames — run the golden run before trusting thresholds** (tunable in `capcut-determinism.js`).

### WI-3 — Compile pass (typed values instead of drags)
`compileMacroForDeterminism()` runs on teach save and lazily on first replay of old macros (storage backs up first). It never removes steps — it annotates:
- scale-slider drag → typed `35` into the Scale field (`typedReplacement`)
- preview position drag → typed `0` / `-1745` into Position X/Y
- timeline drags → `dragKind: timeline`; replay recomputes the end point from the live clip bar's right edge (pixel scan of the timeline row)
At replay, typed entry uses AX/OCR to find the numeric fields; if fields or timeline geometry can't be located confidently, the recorded drag replays as fallback with a `typed_transform_fallback` / `drag_unparameterized` warning in the run report.

### WI-8 — Run reports
Every replay (success, failure, cancel) writes `capcut-runs/<replayId>.json` + a `log.jsonl` line: per-phase gate results, warnings, resolution source counts per click (visual_anchor / semantic / ratio), self-heal events, recorded-vs-actual wait totals, Human Gate details. Exposed in the replay status payload (`gates`, `warnings`, `runReportPath`, …). Dir: `CAPCUT_RUN_REPORT_DIR` (default `./capcut-runs` under the runtime dir).

### WI-7 — Golden run
`node scripts/capcut-golden-run.mjs` — freezes the most recent clip as `Clips/_golden/reference.mp4` on first run, then replays the taught macro 3× consecutively against live CapCut. PASS requires 3/3 runs with all gates passed, zero `drag_unparameterized` warnings, zero Human Gate escalations, and **identical** gate signatures across runs. `--once` for nightly. Needs the server running and a human nearby; emergency stop stays active.

---

## Tests

`node scripts/capcut-agent-smoke.mjs` — **passing.** Now also covers: wait clamping, pollCondition abort (cancel path), compile-pass output (typed scale/position asserted, steps never removed, idempotent), staged-clip validation, and the failed-gate-blocks-next-phase proof — all without CapCut running.

## Still on the operator (needs live CapCut)

1. Run the golden run once end-to-end and watch it: `node scripts/capcut-golden-run.mjs`. The pixel thresholds (canvas detection, blur bands, sticker signal, timeline teal scan) were built from the playbook's descriptions, not live frames — if a gate misfires, the run report says exactly which measurement to tune.
2. Teach the export phase when ready (still intentionally undocumented; export stays behind Human Gate).

## Guardrails unchanged

No export, no upload, no deletion; staging copies only; macro saves keep versioned backups; cmd+option+escape emergency stop works through every new wait and gate; no new npm dependencies (pngjs only).

---

*Linked from [[Argentum_Master]] · Clips Office. Previous review: [[CAPCUT_TEACH_REVIEW_2026-07-01]].*

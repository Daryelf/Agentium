# ONE-SHOT BUILD PROMPT — Make the CapCut Teach/Replay System Deterministic
# Paste this entire file as a single prompt to your coding agent (Codex / Claude Code).
# Repo: /Volumes/ZYLO/Argentum · App: "CLIPPING OFFICE " (note the trailing space in the folder name)
# Written: 2026-07-05 · Based on a live audit of capcut-controller.js @ Jul 3 build

---

## ROLE

You are a senior automation engineer. Your single mission: make the CapCut teach/replay
pipeline in the Clipping Office produce the **identical edit, every run, on every clip** —
or stop safely at the exact phase that failed. No new features. No redesigns. Determinism only.

You work incrementally: one work item at a time, run the smoke test after each, commit after
each. If a work item risks breaking taught macros, stop and say so instead of pushing through.

---

## THE PRODUCT (locked recipe — never change these values)

Input: one .mp4 clip from `CLIPPING OFFICE /Clips/`. Output: a saved CapCut project (NOT exported) with:

| # | Phase (teach plan id)      | Exact action | Locked parameters |
|---|----------------------------|--------------|-------------------|
| 1 | `choose_clip`              | Select the staged clip in CapCut media panel, add to timeline | staged file only (see WI-4) |
| 2 | `canvas_916`               | Ratio dropdown below preview → **9:16** | 9:16, nothing else |
| 3 | `blur_background`          | Right panel → Video → Basic → Canvas checkbox ON → dropdown → **Blur** | fills the black letterbox bars |
| 4 | `auto_frame`               | Right panel → Video → Basic → Auto reframe ON → **Aspect ratio 3:4** → Stabilization Default → Camera speed Default → **Apply** | wait for "Auto reframe applied" toast |
| 5 | `bottom_sticker`           | Stickers toolbar → Yours → Brand stickers → Essentrx sticker | **Scale 35%**, **Position X=0, Y=-1745**, duration = full clip |
| 6 | `save_project`             | Save only | **Export stays behind Human Gate. Never export. Never upload.** |

Phase order is exactly as taught (blur before reframe). Do not reorder.

---

## THE CODEBASE (what already exists — reuse it, don't rebuild it)

All paths relative to `/Volumes/ZYLO/Argentum/CLIPPING OFFICE /` unless noted.

- `services/capcut-controller.js` (~184 KB) — teach recorder, replay engine, verification.
  Key symbols: `CAPCUT_TEACH_PHASES` (~line 121), `resolveMacroStepCoordinates` (~2334),
  `resolveAnchorPointForReplay` (~2291), `appendWaitStep` (~2387), `maybeHealMacroStep` (~4139),
  `executeMacroStep` (~4196), `executeMacroStepWithRetry` (~4243), `replayPreparedMacro` (~4267),
  `waitDuringReplay` (~1495), verify functions `verifyCanvasIs916` / `verifyBlurBackground` /
  `verifyStickerBottomCenter` / `verifyNoErrorDialog` / `verifyProjectSaved` (~3760–3835),
  `validateWorkflowReplay` (~3826).
- `services/capcut-anchor-matcher.js` — NCC template matcher. Works. Confidence floor 0.72. Reuse as-is.
- `services/capcut-macro-storage.js` — versioned macro save/backup. Works. Reuse as-is.
- `services/vision-gate.js`, `services/capcut-desktop.js`, `services/capcut-runner.js` — supporting services.
- `scripts/capcut-agent-smoke.mjs` — existing smoke test. Extend it, don't replace it.
- Playbook of the exact human workflow: `/Volumes/ZYLO/Argentum/CAPCUT_DESKTOP_PLAYBOOK.md`.
- Prior audit with test results: `/Volumes/ZYLO/Argentum/CAPCUT_TEACH_REVIEW_2026-07-01.md`.

The replay resolution ladder already implemented for clicks:
1. visual anchor (template match of teach-time screenshot patch)
2. Accessibility semantic label
3. stored ratio / window offset
4. Claude vision / Human Gate recovery
Self-healing already writes corrected ratios back to the macro on ≥10px drift. Keep all of it.

---

## ROOT CAUSES OF INCONSISTENCY (found in the code — fix ALL six)

### WI-1 — Phase gates: verify DURING the run, not after it
**Today:** `validateWorkflowReplay` runs the verify* checks only after the entire macro finishes.
A missed click in phase 2 means phases 3–6 execute against the wrong UI state and the run
"completes" garbage.
**Build:** In the replay loop, at every phase boundary (steps carry `phaseId`), run that phase's
verification BEFORE starting the next phase:
- `canvas_916` → `verifyCanvasIs916`
- `blur_background` → `verifyBlurBackground`
- `auto_frame` → new `verifyAutoReframeApplied` (see WI-6)
- `bottom_sticker` → `verifyStickerBottomCenter`
- `save_project` → `verifyProjectSaved`
On `failed`: re-run that phase's steps once from the phase's `startStepIndex` (the teach plan
already stores `startStepIndex`/`endStepIndex` per phase). On second failure: pause the replay
in the existing Human Gate/recovery path with the phase id, the verification details, and a
screenshot. **Never continue past a failed gate.** On `unknown`: retry the verification once
after 1s, then treat a second `unknown` as failed for gating purposes (log it distinctly).

### WI-2 — Kill blind waits: poll for conditions, don't sleep recorded pauses
**Today:** `appendWaitStep` records human think-time (300ms–30s) and `waitDuringReplay` replays
it literally. Auto reframe processing time varies per clip; imports vary with file size.
**Build:**
- Clamp replayed recorded waits to `min(recordedMs, 1200)` with a 150ms floor — human pauses
  are not machine requirements. Keep the full recorded value stored in the macro (don't rewrite
  files), clamp at execution time in `executeMacroStep`'s wait branch.
- Add `waitForCondition({ check, timeoutMs, pollMs })` — polls `check()` (a verify function or
  anchor/OCR probe) every `pollMs` (default 500) until pass or timeout, honoring the existing
  pause/cancel flags like `waitDuringReplay` does.
- After the `auto_frame` phase's Apply click: `waitForCondition` on the "Auto reframe applied"
  toast (OCR/AX text contains "reframe applied", or the Apply button patch disappears),
  timeout 45s. Only then run the WI-1 gate.
- After `choose_clip`: `waitForCondition` on timeline-has-media, timeout 20s.

### WI-3 — Deterministic sticker placement: typed values instead of drags
**Today:** `resolveMacroStepCoordinates` anchors only `click`/`doubleClick`. Drags replay raw
ratios (line ~2364). Sticker scale (slider drag), sticker position (preview drag), and sticker
duration (timeline edge drag to clip end) are all drags — and clip length varies per clip.
This is the single biggest visible inconsistency.
**Build:** Add a post-teach "compile" pass (`compileMacroForDeterminism(macro)`) that runs when
a teach session is saved AND once, lazily, on first replay of existing macros (save the compiled
macro via the existing storage backups):
- Replace the Scale slider drag in `bottom_sticker` with: click the scale numeric field
  (anchor-matched click on the field, taught screenshot patch exists) → select-all → type `35` → Enter.
- Replace the preview position drag with: click Position Y field → select-all → type `-1745` →
  Enter; same for X → `0`. Typed values are pixel-independent and identical every run.
- Replace the sticker-duration edge drag with a parameterized drag: at replay time read the
  timeline geometry (main clip bar's right edge x-coordinate via anchor/AX/OCR of the timeline
  region) and compute `toX` = clip end, `fromX` = current sticker right edge. If timeline
  geometry can't be resolved with confidence, fall back to the recorded drag but log
  `drag_unparameterized` as a warning so it shows in the run report.
- Any other drag whose `fromX/fromY` sits inside the timeline region gets the same treatment.

### WI-4 — Normalize the world: staged input clip with a fixed name
**Today:** the `choose_clip` phase clicks a thumbnail whose pixels ARE the clip itself —
the visual anchor can never match (every clip looks different), so it silently falls back to
blind ratio clicks, and the media panel ordering isn't guaranteed.
**Build:**
- Before every replay, the runner copies the target clip to a fixed staging path:
  `CLIPPING OFFICE /Clips/_staging/NEXT_CLIP.mp4` (overwrite, create dir if missing). The macro
  is taught once against `NEXT_CLIP.mp4` — same filename, same file-picker position, same
  thumbnail slot, every single run.
- Mark the `choose_clip` steps whose anchor patch overlaps the thumbnail/preview content region
  with `anchorUnreliable: true` during the compile pass (WI-3), so replay skips straight to
  semantic label ("Add to track", "Import") → ratio, instead of wasting a low-confidence anchor
  attempt on it.
- After staging, verify the staged file: exists, size > 0, extension .mp4. Refuse to start otherwise.

### WI-5 — Pin CapCut window geometry before teach AND replay
**Today:** anchors are window-relative and Retina-aware, but ratio fallbacks and OCR regions
drift when the CapCut window size differs from teach-time.
**Build:** Add `normalizeCapCutWindow()` — before recording starts and before every replay:
focus CapCut, set its window to a fixed frame (store the frame used at teach time in the macro
header as `taughtWindowFrame`; on replay, resize to exactly that; default 1600×1000 at 0,25 for
new teaches) via the existing AppleScript/AX window helpers in the controller. If the OS refuses
(smaller screen), scale ratios accordingly and log `window_mismatch` in the run report.

### WI-6 — Verifications that measure pixels, not just read labels
**Today:** `verifyCanvasIs916`/`verifyBlurBackground` pass if words like "9:16" or "blur" appear
in AX/OCR text — fuzzy, often `unknown`, and `unknown` never blocks anything.
**Build (reuse pngjs + the existing window capture, no new deps):**
- `verifyCanvasIs916`: capture the preview region, detect the rendered canvas bounds (content
  vs background), assert aspect ratio within ±3% of 9/16.
- `verifyBlurBackground`: sample the top and bottom letterbox bands of the canvas; before blur
  they are near-black (low mean luminance, near-zero variance); after blur they show content
  (variance above threshold). Assert the "after" signature.
- `verifyAutoReframeApplied` (new): the toast text via OCR during WI-2's wait, OR compare a
  pre/post center-crop of the preview — reframe visibly changes framing; assert the frames differ
  beyond a noise threshold.
- `verifyStickerBottomCenter`: template-match the actual brand sticker asset (the taught patch
  from the sticker click, or a stored `assets/brand-sticker.png`) against the lower third of the
  preview, NCC ≥ 0.6.
Every verify returns the existing `verificationResult` shape. Keep the text-based checks as a
secondary signal, not the primary.

### WI-7 — Golden run: prove determinism, catch CapCut updates
**Build:** `scripts/capcut-golden-run.mjs`:
- Stages a fixed reference clip (`CLIPPING OFFICE /Clips/_golden/reference.mp4` — pick the most
  recent clip in Clips/ and copy it there on first run; never changes afterward).
- Runs the full replay end-to-end 3 times consecutively.
- PASS = all 3 runs: every phase gate passed, zero Human Gate escalations, zero
  `drag_unparameterized` warnings, and the final `validateWorkflowReplay` is all-passed.
- Prints a per-run, per-phase table and exits non-zero on any failure.
- Wire a `--once` mode so it can run as a nightly check.

### WI-8 — Run report: one honest summary per replay
**Build:** At replay end (success, failure, or cancel), write
`data/capcut-runs/<replayId>.json` + append one line to `data/capcut-runs/log.jsonl`:
phase results, gate outcomes, resolution source per click (visual_anchor/semantic/ratio),
heal events, waits (recorded vs actual), warnings, screenshots paths. The UI already shows
replay status; add the last run's phase table to that status payload.

---

## HARD GUARDRAILS (violating any of these = failed task)

1. **Never export, upload, publish, or share** from CapCut. Save project only. Export stays behind Human Gate.
2. **Never delete or overwrite user media.** Staging copies, never moves. Macro edits go through `CapCutMacroStorage.save` (it backs up automatically).
3. **Keep the macro JSON backward compatible** — old macros must still replay. The compile pass adds fields; it never removes recorded steps (replaced steps get `supersededBy` + the new steps, original kept in the file).
4. **Keep the emergency stop** (cmd+option+escape kill switch and `cancelReplay`) working through every new wait/poll — `waitForCondition` must check the cancel/pause flags every poll.
5. **No new npm dependencies.** pngjs is already present.
6. **Don't touch** the Twitch watch/buffer side (`browser-workspace.js`, `twitch-chat.js`, clip detection). This task is replay determinism only.

---

## ACCEPTANCE CRITERIA (all must be true before you call it done)

1. `node scripts/capcut-agent-smoke.mjs` passes (extend it to cover: wait clamping, compile pass output, staged-clip validation, `waitForCondition` cancel handling — these must be testable without CapCut running, using fixtures).
2. `node scripts/capcut-golden-run.mjs` — 3/3 consecutive runs pass with identical phase-gate results (this one needs CapCut + a human watching; print clear instructions when it starts).
3. A failed phase NEVER lets the next phase run — prove it in the smoke test by stubbing a failing verify.
4. Sticker scale/position are typed, not dragged, in the compiled macro (assert in smoke test).
5. Replay of an existing (pre-compile) macro still works — lazy compile happens with a backup saved first.
6. `git status` clean at the end: work committed in one commit per work item, message format `CapCut determinism WI-<n>: <what>`.

## ORDER OF WORK

WI-5 (window pinning) → WI-4 (staging) → WI-2 (waits) → WI-1 (gates) → WI-6 (pixel verify) → WI-3 (compile pass) → WI-8 (report) → WI-7 (golden run). Earlier items make later ones testable.

## WHAT NOT TO DO

- Do not rewrite capcut-controller.js from scratch. Surgical changes only.
- Do not "improve" the recipe (no captions, no filters, no new phases). Locked table above.
- Do not lower the 0.72 anchor confidence floor to make matches "work".
- Do not add sleeps to fix races — every new wait must be a condition poll with a timeout.
- Do not ask the operator to re-teach existing macros; the compile pass upgrades them in place.

When done, write a short summary of what changed per work item into
`/Volumes/ZYLO/Argentum/CAPCUT_TEACH_REVIEW_2026-07-05.md` following the format of the 2026-07-01 review.

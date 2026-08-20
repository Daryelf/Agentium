# CapCut Teach System — Review + Upgrade Log
**Date: 2026-07-01 · Reviewed by Claude (Cowork session)**

---

## Verdict on the learning process: B+ → now A-

You've built something most people never get working. The teach pipeline is real:

- **Recorder**: Swift CGEvent tap captures every click/key/scroll with window-relative coords, ratios, modifier flags, per-step screenshots, and a command+option+escape kill switch. Solid.
- **Phase plan**: import → 9:16 → blur background → auto frame → sticker → save. Matches the desktop playbook exactly. Export correctly kept behind Human Gate.
- **Replay**: semantic Accessibility-label matching first, then stored ratios, then window-offset scaling. Verification functions exist (verifyCanvasIs916, verifyBlurBackground, verifyNoErrorDialog, etc.).
- **Storage**: macros saved with backups, corrupted files can't break the library.

### The weakness that was killing reliability

Replay trusted **coordinate ratios**. The moment the right properties panel is scrolled differently than during teaching (which happens constantly — Canvas is "scroll down", Auto reframe is "scroll up"), a ratio click lands on the wrong control. Semantic matching helps only when CapCut exposes the element to Accessibility, which its custom-rendered panels often don't.

---

## Shipped today: Visual Anchor Replay

**New file:** `CLIPPING OFFICE /services/capcut-anchor-matcher.js`
**Integrated into:** `capcut-controller.js` → `resolveMacroStepCoordinates()`

Every taught step already stores a `screenshotBefore` PNG. The matcher crops a ~112pt patch around the exact pixels you clicked during teaching, then template-matches it (normalized cross-correlation, coarse+fine two-pass) against a fresh CapCut window capture at replay time. It finds the button wherever it moved.

The replay resolution ladder is now:

1. **visual_anchor** — pixel-verified match of the taught screenshot patch (NEW)
2. **semantic label** — Accessibility API element match
3. **stored ratio / window offset** — old behavior, now the fallback
4. Claude vision / Human Gate — existing recovery paths

Properties: retroactive (all existing macros benefit, no re-teaching needed), Retina-aware, refuses low-confidence matches instead of guessing (< 0.72 NCC → falls through the ladder), zero new dependencies (pngjs already present).

Test results: moved-button relocation exact to the pixel (conf 0.974, ~110ms); removed-button correctly rejected (conf 0.118); 2x Retina cross-scale exact (conf 0.985).

---

## Next upgrades, in priority order

1. **Self-healing macros** — when a step resolves via anchor/vision instead of ratio, write the corrected ratio + a fresh anchor patch back into the macro file (storage already supports versioned backups). Macros then get better with every run.
2. **Teach-time semantic labels** — after each recorded click, asynchronously send the screenshot patch to Claude Haiku: "what UI control is this?" Store the label on the step. Replay then has a human-readable target for the vision fallback instead of guessing from coordinates.
3. **Kill fixed sleeps** — auto reframe uses `sleep(3000)`; the "Auto reframe applied" toast should be awaited via anchor/vision polling. Same for import completion.
4. **Record the export phase** — the desktop playbook stops at "EXPORT (not yet documented)". Teach it once (Export button → name → 1080p → Export), keep the final click behind Human Gate as designed.
5. **Parameterize timeline drags** — "drag sticker end to clip end" should be computed from timeline geometry, not replayed as raw coordinates; clip length varies per clip.
6. **Golden-run regression** — nightly replay against a fixed sample clip with the existing verify* checks; alert on any phase failure so CapCut updates get caught before a real run.

Clip *detection* upgrades remain tracked in [[CLIP_DETECTION_STRATEGY]] (Whisper scoring, emote velocity, predictive pre-capture are still the top three).

---

*Linked from [[Argentum_Master]] · Clips Office. Export/upload remains Human Gate controlled.*

/**
 * CapCut replay determinism helpers — Argentum Clipping Office.
 *
 * Pure logic only (no AppleScript, no CapCut, no controller state) so the
 * smoke test can exercise every function with fixtures and no live app:
 *   - replay wait clamping (recorded human pauses are not machine requirements)
 *   - condition polling with abort support (replaces blind sleeps)
 *   - macro compilation (typed values instead of drags, unreliable-anchor marking)
 *   - staged-clip validation (fixed NEXT_CLIP.mp4 input world)
 *   - pixel measurements for phase verification (9:16 canvas, blur bands,
 *     sticker signal, timeline clip-end geometry)
 *
 * Wired into capcut-controller.js. See CODEX_CAPCUT_DETERMINISM_PROMPT.md for
 * the work-item spec this implements.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";

export const DETERMINISM_COMPILER_VERSION = 1;

// Recorded teach-time pauses are human think-time; replay only needs enough to
// let the UI settle. Long processing (import, auto reframe) is awaited via
// pollCondition instead.
export const REPLAY_WAIT_FLOOR_MS = 150;
export const REPLAY_WAIT_CAP_MS = 1200;

export const STAGING_DIR_NAME = "_staging";
export const STAGING_CLIP_NAME = "NEXT_CLIP.mp4";
export const GOLDEN_DIR_NAME = "_golden";
export const GOLDEN_CLIP_NAME = "reference.mp4";

// One fixed teach/replay window frame keeps every ratio fallback and OCR
// region aligned with teach time. Stored per-macro as taughtWindowFrame.
export const DEFAULT_TEACH_WINDOW_FRAME = { x: 0, y: 25, width: 1600, height: 1000 };

// Phase id → controller verification method run at that phase's gate.
export const PHASE_GATES = {
  choose_clip: "verifyTimelineHasMedia",
  canvas_916: "verifyCanvasIs916",
  blur_background: "verifyBlurBackground",
  auto_frame: "verifyAutoReframeApplied",
  bottom_sticker: "verifyStickerBottomCenter",
  save_project: "verifyProjectSaved"
};

// Locked recipe values (see the playbook). The compile pass rewrites sticker
// drags into typed entries of exactly these values.
export const STICKER_SCALE_VALUE = "35";
export const STICKER_POSITION_X = "0";
export const STICKER_POSITION_Y = "-1745";

// Window-region classification for recorded drags.
const TIMELINE_Y_RATIO = 0.62;      // below this line of the window = timeline
const RIGHT_PANEL_X_RATIO = 0.70;   // right of this line = properties panel
const PREVIEW_MIN_X_RATIO = 0.24;   // preview canvas area (between panels)

export function clampReplayWait(ms) {
  const value = Math.round(Number(ms) || 0);
  if (value <= 0) return 0;
  return Math.max(REPLAY_WAIT_FLOOR_MS, Math.min(REPLAY_WAIT_CAP_MS, value));
}

/**
 * Poll `check` until it passes, aborts, or times out. `check` may return a
 * boolean or an object with `passed`. Check errors count as a failed poll,
 * never as a crash — a flaky OCR read must not kill a replay.
 */
export async function pollCondition({
  check,
  timeoutMs = 20000,
  pollMs = 500,
  shouldAbort = null,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
  const startedAt = Date.now();
  let attempts = 0;
  let last = null;
  while (true) {
    if (typeof shouldAbort === "function" && await shouldAbort()) {
      return { passed: false, aborted: true, timedOut: false, attempts, elapsedMs: Date.now() - startedAt, last };
    }
    attempts += 1;
    try {
      last = await check();
    } catch (error) {
      last = { passed: false, error: error.message };
    }
    const passed = last === true || last?.passed === true || last?.status === "passed";
    if (passed) {
      return { passed: true, aborted: false, timedOut: false, attempts, elapsedMs: Date.now() - startedAt, last };
    }
    if (Date.now() - startedAt + pollMs > timeoutMs) {
      return { passed: false, aborted: false, timedOut: true, attempts, elapsedMs: Date.now() - startedAt, last };
    }
    await sleep(pollMs);
  }
}

export function stagingPathFor(clipsDir) {
  return path.join(path.resolve(clipsDir), STAGING_DIR_NAME, STAGING_CLIP_NAME);
}

export function goldenPathFor(clipsDir) {
  return path.join(path.resolve(clipsDir), GOLDEN_DIR_NAME, GOLDEN_CLIP_NAME);
}

export function validateStagedClip({ filePath, sizeBytes } = {}) {
  const file = String(filePath || "");
  if (!file) return { ok: false, reason: "missing_path" };
  if (!/\.mp4$/i.test(file)) return { ok: false, reason: "not_mp4" };
  if (!(Number(sizeBytes) > 0)) return { ok: false, reason: "empty_file" };
  return { ok: true, reason: "" };
}

function stepRatio(step, field) {
  const value = Number(step?.[field]);
  return Number.isFinite(value) ? value : null;
}

function isStableChooseClipTarget(step) {
  const label = String(step?.semanticTarget?.label || "").toLowerCase();
  return /import|add to track|media|track/.test(label);
}

/**
 * Classify a recorded drag by where it started inside the taught window.
 * Sticker-phase right-panel drags are the Transform sliders; sticker-phase
 * preview drags position the sticker; low drags manipulate the timeline.
 */
export function dragKindForStep(step = {}) {
  if (step.type !== "drag") return "";
  const fromX = stepRatio(step, "fromXRatio");
  const fromY = stepRatio(step, "fromYRatio");
  if (fromX === null || fromY === null) return "";
  if (fromY >= TIMELINE_Y_RATIO) return "timeline";
  if (step.phaseId === "bottom_sticker" && fromX >= RIGHT_PANEL_X_RATIO) return "transform_slider";
  if (step.phaseId === "bottom_sticker" && fromX >= PREVIEW_MIN_X_RATIO && fromX < RIGHT_PANEL_X_RATIO) {
    return "preview_position";
  }
  return "";
}

/**
 * Compile pass: annotate a macro so replay can execute it deterministically.
 * Never removes or reorders recorded steps — replaced behaviors keep the
 * original coordinates as fallback and carry `supersededBy` describing what
 * replay does instead. Idempotent; safe on legacy macros with no phase ids.
 */
export function compileMacroForDeterminism(macro = {}) {
  const compiled = { ...macro, steps: (macro.steps || []).map((step) => ({ ...step })) };
  const changes = [];
  compiled.steps.forEach((step, index) => {
    if (step.phaseId === "choose_clip" && ["click", "doubleClick"].includes(step.type) && !isStableChooseClipTarget(step)) {
      // The clicked pixels are the clip's own thumbnail — different footage
      // every run, so a template match can only ever fail. Skip straight to
      // semantic/ratio resolution instead of burning an anchor attempt.
      if (!step.anchorUnreliable) {
        step.anchorUnreliable = true;
        changes.push({ index, change: "anchor_unreliable", reason: "content_dependent_target" });
      }
      return;
    }
    if (step.type !== "drag") return;
    const kind = dragKindForStep(step);
    if (!kind || step.dragKind === kind) return;
    step.dragKind = kind;
    if (kind === "transform_slider") {
      step.typedReplacement = { field: "scale", value: STICKER_SCALE_VALUE };
      step.supersededBy = "typed_transform";
      changes.push({ index, change: "typed_scale", value: STICKER_SCALE_VALUE });
    } else if (kind === "preview_position") {
      step.typedReplacement = { field: "position", x: STICKER_POSITION_X, y: STICKER_POSITION_Y };
      step.supersededBy = "typed_transform";
      changes.push({ index, change: "typed_position", x: STICKER_POSITION_X, y: STICKER_POSITION_Y });
    } else if (kind === "timeline") {
      // Replayed drag end is recomputed from live timeline geometry because
      // clip length differs per clip. Recorded coordinates stay as fallback.
      step.supersededBy = "timeline_geometry";
      changes.push({ index, change: "timeline_drag_parameterized" });
    }
  });
  compiled.determinismCompiledAt = new Date().toISOString();
  compiled.determinismCompilerVersion = DETERMINISM_COMPILER_VERSION;
  compiled.determinismChanges = changes;
  return { macro: compiled, changes };
}

// ---------------------------------------------------------------------------
// Pixel measurements (pngjs RGBA buffers, same conventions as the anchor
// matcher). All coordinates below are PIXELS in the screenshot, not points.
// ---------------------------------------------------------------------------

export async function readPng(filePath) {
  return PNG.sync.read(await fs.readFile(filePath));
}

function luminanceAt(png, x, y) {
  const p = (y * png.width + x) * 4;
  return png.data[p] * 0.299 + png.data[p + 1] * 0.587 + png.data[p + 2] * 0.114;
}

function bandStats(png, x0, y0, x1, y1, sampleStep = 2) {
  let sum = 0;
  let sq = 0;
  let count = 0;
  for (let y = y0; y < y1; y += sampleStep) {
    for (let x = x0; x < x1; x += sampleStep) {
      const lum = luminanceAt(png, x, y);
      sum += lum;
      sq += lum * lum;
      count += 1;
    }
  }
  if (!count) return { mean: 0, std: 0, count: 0 };
  const mean = sum / count;
  return { mean, std: Math.sqrt(Math.max(0, sq / count - mean * mean)), count };
}

/**
 * Find the preview canvas rectangle (video content INCLUDING letterbox bars)
 * against CapCut's dark UI chrome. Works before and after blur because black
 * bars still differ from the ~#1c1c1c panel background when averaged over a
 * full row/column. Returns aspect = width / height (9:16 → ~0.5625).
 */
export function measurePreviewCanvas(png, {
  regionX0 = 0.22,
  regionX1 = 0.78,
  regionY0 = 0.03,
  regionY1 = 0.62,
  scoreThreshold = 6
} = {}) {
  const x0 = Math.floor(png.width * regionX0);
  const x1 = Math.ceil(png.width * regionX1);
  const y0 = Math.floor(png.height * regionY0);
  const y1 = Math.ceil(png.height * regionY1);
  if (x1 - x0 < 24 || y1 - y0 < 24) return { found: false, reason: "region_too_small" };

  // Estimate the UI background from the region's outer margins.
  const margin = Math.max(2, Math.floor((x1 - x0) * 0.02));
  const bgLeft = bandStats(png, x0, y0, x0 + margin, y1);
  const bgRight = bandStats(png, x1 - margin, y0, x1, y1);
  const bg = (bgLeft.mean * bgLeft.count + bgRight.mean * bgRight.count) / Math.max(1, bgLeft.count + bgRight.count);

  const columnScore = [];
  for (let x = x0; x < x1; x += 1) {
    let diff = 0;
    let count = 0;
    for (let y = y0; y < y1; y += 3) {
      diff += Math.abs(luminanceAt(png, x, y) - bg);
      count += 1;
    }
    columnScore.push(count ? diff / count : 0);
  }
  const rowScore = [];
  for (let y = y0; y < y1; y += 1) {
    let diff = 0;
    let count = 0;
    for (let x = x0; x < x1; x += 3) {
      diff += Math.abs(luminanceAt(png, x, y) - bg);
      count += 1;
    }
    rowScore.push(count ? diff / count : 0);
  }

  const firstCol = columnScore.findIndex((score) => score > scoreThreshold);
  const lastCol = columnScore.length - 1 - [...columnScore].reverse().findIndex((score) => score > scoreThreshold);
  const firstRow = rowScore.findIndex((score) => score > scoreThreshold);
  const lastRow = rowScore.length - 1 - [...rowScore].reverse().findIndex((score) => score > scoreThreshold);
  if (firstCol < 0 || firstRow < 0 || lastCol <= firstCol || lastRow <= firstRow) {
    return { found: false, reason: "no_canvas_detected", background: Math.round(bg) };
  }
  const box = {
    x0: x0 + firstCol,
    y0: y0 + firstRow,
    x1: x0 + lastCol + 1,
    y1: y0 + lastRow + 1
  };
  box.width = box.x1 - box.x0;
  box.height = box.y1 - box.y0;
  if (box.width < 16 || box.height < 16) return { found: false, reason: "canvas_too_small", box };
  return {
    found: true,
    box,
    aspect: Number((box.width / box.height).toFixed(4)),
    background: Math.round(bg)
  };
}

export function aspectMatches916(aspect, tolerance = 0.03) {
  const target = 9 / 16;
  return Number.isFinite(Number(aspect)) && Math.abs(Number(aspect) - target) / target <= tolerance;
}

/**
 * Sample the top and bottom letterbox bands of the canvas. Before Canvas Blur
 * they are near-black and flat; after, they carry blurred content (brighter
 * and/or textured). `null` band verdicts mean "can't tell" — callers fall
 * back to the text check rather than guessing.
 */
export function measureLetterboxBands(png, box, { bandRatio = 0.16 } = {}) {
  const bandHeight = Math.max(4, Math.round(box.height * bandRatio));
  const inset = Math.max(2, Math.round(box.width * 0.06));
  const top = bandStats(png, box.x0 + inset, box.y0 + 2, box.x1 - inset, Math.min(box.y1, box.y0 + 2 + bandHeight));
  const bottom = bandStats(png, box.x0 + inset, Math.max(box.y0, box.y1 - 2 - bandHeight), box.x1 - inset, box.y1 - 2);
  const verdict = (band) => {
    if (band.mean > 18 || band.std > 10) return true;    // visible content
    if (band.mean < 12 && band.std < 6) return false;    // flat black bar
    return null;
  };
  return {
    top: { mean: Math.round(top.mean), std: Number(top.std.toFixed(1)) },
    bottom: { mean: Math.round(bottom.mean), std: Number(bottom.std.toFixed(1)) },
    topFilled: verdict(top),
    bottomFilled: verdict(bottom)
  };
}

function gradientEnergy(png, x0, y0, x1, y1, sampleStep = 2) {
  let energy = 0;
  let count = 0;
  for (let y = y0; y < y1 - sampleStep; y += sampleStep) {
    for (let x = x0; x < x1 - sampleStep; x += sampleStep) {
      const here = luminanceAt(png, x, y);
      energy += Math.abs(luminanceAt(png, x + sampleStep, y) - here)
        + Math.abs(luminanceAt(png, x, y + sampleStep) - here);
      count += 1;
    }
  }
  return count ? energy / count : 0;
}

/**
 * A sharp sticker graphic over a smooth blurred background shows up as much
 * higher local gradient energy in the bottom-center of the canvas than at the
 * bottom sides. Heuristic: supporting signal only, never sole proof.
 */
export function measureBottomStickerSignal(png, box) {
  const y0 = box.y0 + Math.round(box.height * 0.68);
  const y1 = box.y1 - Math.round(box.height * 0.02);
  const third = Math.round(box.width / 3);
  const center = gradientEnergy(png, box.x0 + third, y0, box.x1 - third, y1);
  const left = gradientEnergy(png, box.x0, y0, box.x0 + third, y1);
  const right = gradientEnergy(png, box.x1 - third, y0, box.x1, y1);
  const sides = (left + right) / 2 || 0.001;
  return {
    center: Number(center.toFixed(2)),
    sides: Number(sides.toFixed(2)),
    ratio: Number((center / sides).toFixed(2)),
    likelySticker: center > 3 && center / sides > 1.5
  };
}

/**
 * Mean absolute luminance difference between the same region of two frames.
 * Used to confirm Auto Reframe visibly changed the preview framing.
 */
export function regionsDiffer(pngA, pngB, { x0 = 0.3, y0 = 0.08, x1 = 0.7, y1 = 0.55 } = {}, threshold = 8) {
  const width = Math.min(pngA.width, pngB.width);
  const height = Math.min(pngA.height, pngB.height);
  const rx0 = Math.floor(width * x0);
  const rx1 = Math.ceil(width * x1);
  const ry0 = Math.floor(height * y0);
  const ry1 = Math.ceil(height * y1);
  let diff = 0;
  let count = 0;
  for (let y = ry0; y < ry1; y += 3) {
    for (let x = rx0; x < rx1; x += 3) {
      diff += Math.abs(luminanceAt(pngA, x, y) - luminanceAt(pngB, x, y));
      count += 1;
    }
  }
  const mean = count ? diff / count : 0;
  return { differ: mean > threshold, meanDiff: Number(mean.toFixed(2)), threshold };
}

/**
 * Find the right edge of the media on a timeline row so "drag sticker end to
 * clip end" can be computed per clip instead of replayed from raw pixels.
 * Track content (thumbnails / colored bars) is brighter or more saturated
 * than the empty track background; scan the row band right-to-left for the
 * last active column. Returns the edge as a WINDOW-POINT x, or null.
 */
export function findTimelineClipEndX(png, {
  yRatio,
  windowWidthPoints,
  bandHalfRatio = 0.02,
  skipLeftRatio = 0.05,
  activeFraction = 0.3
} = {}) {
  const centerY = Math.round(png.height * Number(yRatio));
  const half = Math.max(3, Math.round(png.height * bandHalfRatio));
  const y0 = Math.max(0, centerY - half);
  const y1 = Math.min(png.height, centerY + half);
  const startX = Math.round(png.width * skipLeftRatio);
  if (y1 - y0 < 3 || startX >= png.width - 4) return null;

  const columnActive = (x) => {
    let active = 0;
    let count = 0;
    for (let y = y0; y < y1; y += 1) {
      const p = (y * png.width + x) * 4;
      const r = png.data[p];
      const g = png.data[p + 1];
      const b = png.data[p + 2];
      const saturation = Math.max(r, g, b) - Math.min(r, g, b);
      const lum = r * 0.299 + g * 0.587 + b * 0.114;
      if (saturation > 24 || lum > 45) active += 1;
      count += 1;
    }
    return count ? active / count : 0;
  };

  for (let x = png.width - 2; x >= startX; x -= 1) {
    if (columnActive(x) >= activeFraction) {
      const scale = windowWidthPoints > 0 ? png.width / windowWidthPoints : 1;
      return { xPoints: x / scale, xPixels: x, confidence: columnActive(x) };
    }
  }
  return null;
}

export default {
  DETERMINISM_COMPILER_VERSION,
  REPLAY_WAIT_FLOOR_MS,
  REPLAY_WAIT_CAP_MS,
  DEFAULT_TEACH_WINDOW_FRAME,
  PHASE_GATES,
  clampReplayWait,
  pollCondition,
  stagingPathFor,
  goldenPathFor,
  validateStagedClip,
  dragKindForStep,
  compileMacroForDeterminism,
  readPng,
  measurePreviewCanvas,
  aspectMatches916,
  measureLetterboxBands,
  measureBottomStickerSignal,
  regionsDiffer,
  findTimelineClipEndX
};

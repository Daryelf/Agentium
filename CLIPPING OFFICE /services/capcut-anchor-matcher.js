/**
 * CapCut visual anchor matcher — Argentum Clipping Office.
 *
 * Every taught macro step already stores a `screenshotBefore` PNG of the CapCut
 * window plus the click point. This module re-locates that exact visual target
 * in a fresh screenshot using normalized cross-correlation (NCC) template
 * matching. It makes replay survive panel scrolls, window resizes, and most
 * CapCut UI reshuffles — no coordinates trusted blindly.
 *
 * Zero native deps: uses pngjs (already in node_modules via jimp).
 *
 * Resolution ladder this enables (see capcut-controller.resolveMacroStepCoordinates):
 *   1. visual_anchor   (this module — pixel-verified)
 *   2. semantic label   (Accessibility API)
 *   3. stored ratio / window offset
 *   4. Claude vision fallback
 *   5. Human Gate
 */

import fs from "node:fs/promises";
import { PNG } from "pngjs";

const DEFAULT_PATCH_POINTS = 56;      // patch half-size in window points (112pt square)
const DEFAULT_MIN_CONFIDENCE = 0.72;  // NCC score required to trust a match
const COARSE_FACTOR = 3;              // downsample factor for the coarse pass
const REFINE_RADIUS = 6;              // full-res refinement radius (px)

async function loadGray(filePath) {
  const buffer = await fs.readFile(filePath);
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    gray[i] = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
  }
  return { width, height, gray };
}

function cropGray(img, x0, y0, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const srcRow = (y0 + y) * img.width + x0;
    out.set(img.gray.subarray(srcRow, srcRow + w), y * w);
  }
  return { width: w, height: h, gray: out };
}

function downsample(img, factor) {
  if (factor <= 1) return img;
  const w = Math.floor(img.width / factor);
  const h = Math.floor(img.height / factor);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        const row = (y * factor + dy) * img.width + x * factor;
        for (let dx = 0; dx < factor; dx += 1) sum += img.gray[row + dx];
      }
      out[y * w + x] = sum / (factor * factor);
    }
  }
  return { width: w, height: h, gray: out };
}

function stats(gray) {
  let sum = 0;
  for (let i = 0; i < gray.length; i += 1) sum += gray[i];
  const mean = sum / gray.length;
  let varSum = 0;
  for (let i = 0; i < gray.length; i += 1) {
    const d = gray[i] - mean;
    varSum += d * d;
  }
  return { mean, std: Math.sqrt(varSum / gray.length) };
}

/**
 * Normalized cross-correlation of `patch` against `scene`, restricted to a
 * search rectangle. Returns best top-left offset + score in [-1, 1].
 */
function nccSearch(scene, patch, search) {
  const { mean: pMean, std: pStd } = stats(patch.gray);
  if (pStd < 1e-3) return { score: -1, x: 0, y: 0, flat: true };

  const x0 = Math.max(0, search.x0);
  const y0 = Math.max(0, search.y0);
  const x1 = Math.min(scene.width - patch.width, search.x1);
  const y1 = Math.min(scene.height - patch.height, search.y1);
  let best = { score: -1, x: x0, y: y0 };

  for (let sy = y0; sy <= y1; sy += 1) {
    for (let sx = x0; sx <= x1; sx += 1) {
      let dot = 0;
      let sSum = 0;
      let sSq = 0;
      for (let py = 0; py < patch.height; py += 1) {
        const sRow = (sy + py) * scene.width + sx;
        const pRow = py * patch.width;
        for (let px = 0; px < patch.width; px += 1) {
          const sv = scene.gray[sRow + px];
          const pv = patch.gray[pRow + px];
          dot += sv * pv;
          sSum += sv;
          sSq += sv * sv;
        }
      }
      const n = patch.width * patch.height;
      const sMean = sSum / n;
      const sVar = sSq / n - sMean * sMean;
      if (sVar < 1e-6) continue;
      const cov = dot / n - sMean * pMean;
      const score = cov / (Math.sqrt(sVar) * pStd);
      if (score > best.score) best = { score, x: sx, y: sy };
    }
  }
  return best;
}

/**
 * Re-locate a taught click target in a fresh screenshot.
 *
 * @param {object} opts
 * @param {string} opts.referencePng    path of the teach-time screenshot (CapCut window capture)
 * @param {{x:number,y:number}} opts.referencePoint  click point in WINDOW points (windowX/windowY)
 * @param {{width:number,height:number}} opts.referenceWindow  window size in points at teach time
 * @param {string} opts.currentPng      path of a fresh CapCut window screenshot
 * @param {{width:number,height:number}} opts.currentWindow    current window size in points
 * @param {number} [opts.patchPoints]   half patch size in points
 * @param {number} [opts.minConfidence]
 * @returns {Promise<{found:boolean, x?:number, y?:number, confidence:number, reason?:string}>}
 *          x/y are WINDOW-RELATIVE points in the current window.
 */
export async function matchAnchor(opts) {
  const {
    referencePng,
    referencePoint,
    referenceWindow,
    currentPng,
    currentWindow,
    patchPoints = DEFAULT_PATCH_POINTS,
    minConfidence = DEFAULT_MIN_CONFIDENCE
  } = opts;

  const [ref, cur] = await Promise.all([loadGray(referencePng), loadGray(currentPng)]);

  // Points → pixels (Retina screenshots are usually 2x).
  const refScale = referenceWindow?.width > 0 ? ref.width / referenceWindow.width : 1;
  const curScale = currentWindow?.width > 0 ? cur.width / currentWindow.width : 1;

  const clickPxX = Math.round(referencePoint.x * refScale);
  const clickPxY = Math.round(referencePoint.y * refScale);
  const half = Math.round(patchPoints * refScale);

  const px0 = Math.max(0, clickPxX - half);
  const py0 = Math.max(0, clickPxY - half);
  const pw = Math.min(ref.width, clickPxX + half) - px0;
  const ph = Math.min(ref.height, clickPxY + half) - py0;
  if (pw < 16 || ph < 16) return { found: false, confidence: 0, reason: "patch_too_small" };

  const patch = cropGray(ref, px0, py0, pw, ph);
  // Offset of the click inside the patch (so we can map back precisely).
  const clickInPatchX = clickPxX - px0;
  const clickInPatchY = clickPxY - py0;

  // Rescale patch if the two screenshots have different pixel densities.
  const scaleRatio = curScale / refScale;
  const patchScaled = Math.abs(scaleRatio - 1) > 0.02
    ? downsample(patch, 1 / scaleRatio > 1 ? Math.round(1 / scaleRatio) : 1)
    : patch;

  // Coarse pass — search around the ratio-predicted location first, then whole image.
  const sceneCoarse = downsample(cur, COARSE_FACTOR);
  const patchCoarse = downsample(patchScaled, COARSE_FACTOR);
  if (patchCoarse.width < 6 || patchCoarse.height < 6) {
    return { found: false, confidence: 0, reason: "patch_too_small_after_downsample" };
  }

  const predictedX = referenceWindow?.width > 0
    ? (referencePoint.x / referenceWindow.width) * cur.width
    : cur.width / 2;
  const predictedY = referenceWindow?.height > 0
    ? (referencePoint.y / referenceWindow.height) * cur.height
    : cur.height / 2;

  const localRadius = Math.round(Math.max(cur.width, cur.height) * 0.18 / COARSE_FACTOR);
  const cx = Math.round((predictedX - clickInPatchX) / COARSE_FACTOR);
  const cy = Math.round((predictedY - clickInPatchY) / COARSE_FACTOR);

  let coarse = nccSearch(sceneCoarse, patchCoarse, {
    x0: cx - localRadius, y0: cy - localRadius, x1: cx + localRadius, y1: cy + localRadius
  });
  if (coarse.score < minConfidence) {
    const full = nccSearch(sceneCoarse, patchCoarse, {
      x0: 0, y0: 0, x1: sceneCoarse.width, y1: sceneCoarse.height
    });
    if (full.score > coarse.score) coarse = full;
  }
  if (coarse.flat) return { found: false, confidence: 0, reason: "flat_patch" };

  // Refinement pass at full resolution around the coarse hit.
  const gx = coarse.x * COARSE_FACTOR;
  const gy = coarse.y * COARSE_FACTOR;
  const fine = nccSearch(cur, patchScaled, {
    x0: gx - REFINE_RADIUS * COARSE_FACTOR,
    y0: gy - REFINE_RADIUS * COARSE_FACTOR,
    x1: gx + REFINE_RADIUS * COARSE_FACTOR,
    y1: gy + REFINE_RADIUS * COARSE_FACTOR
  });

  const confidence = Math.max(coarse.score, fine.score);
  const bestX = fine.score >= coarse.score ? fine.x : gx;
  const bestY = fine.score >= coarse.score ? fine.y : gy;
  if (confidence < minConfidence) {
    return { found: false, confidence: Number(confidence.toFixed(3)), reason: "low_confidence" };
  }

  // Map click point back to window-relative points in the CURRENT window.
  const clickCurPxX = bestX + clickInPatchX * (patchScaled.width / patch.width);
  const clickCurPxY = bestY + clickInPatchY * (patchScaled.height / patch.height);
  return {
    found: true,
    x: clickCurPxX / curScale,
    y: clickCurPxY / curScale,
    confidence: Number(confidence.toFixed(3))
  };
}

export default { matchAnchor };

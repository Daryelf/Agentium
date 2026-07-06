/**
 * Thin compatibility wrapper for CapCut automation.
 *
 * The old capcut.com browser runner has been retired. Agent 101 should use
 * the native macOS CapCut desktop automation service instead.
 */

export async function runCapcutPlaybook(_workspace, _sessionId, options = {}) {
  const { runCapcutDesktopEdit } = await import("./capcut-desktop.js");
  const editSpec = {
    ...(options.editSpec || options.edit_spec || {}),
    clipPath: options.clipPath || options.clip_path,
    clipId: options.clipId || options.clip_id || options.candidateId || "unknown",
    brandSticker: options.brandSticker || options.brand_sticker,
    stickerScale: options.stickerScale || options.sticker_scale
  };
  return runCapcutDesktopEdit(editSpec, {
    dryRun: Boolean(options.dryRun),
    onStep: options.emitStep,
    client: options.client,
    sessionId: options.sessionId || _sessionId
  });
}

export async function runCapcutExportPhase() {
  throw new Error("CapCut export automation is disabled. Export remains Human Gate/operator controlled.");
}

export { runCapcutDesktopEdit } from "./capcut-desktop.js";

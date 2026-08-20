import crypto from "node:crypto";

const REQUIRED_TIMELINE_LAYERS = ["video", "reframe", "captions", "sticker"];
const VERIFIED_CAPTION_SOURCES = new Set([
  "caption_intelligence_model",
  "caption_intelligence_local",
  "operator_edit"
]);
const VERIFIED_CAPTION_GENERATION_STATUSES = new Set(["complete", "operator_approved", "review_required"]);
const APPROVED_CAPTION_GENERATION_STATUSES = new Set(["complete", "operator_approved"]);
const INTERNAL_CLIP_TITLE_PATTERN = /^\s*(?:\d+s\s+)?clip window \d+\s*:/i;

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
}

function fingerprintValue(editorState = {}) {
  const state = objectValue(editorState);
  const captions = objectValue(state.captions);
  const timeline = objectValue(state.timeline);
  return {
    videoLayout: objectValue(state.videoLayout),
    background: objectValue(state.background),
    autoReframe: objectValue(state.autoReframe),
    sticker: objectValue(state.sticker),
    captions: {
      enabled: Boolean(captions.enabled),
      segments: Array.isArray(captions.segments) ? captions.segments : [],
      style: objectValue(captions.style)
    },
    timeline: {
      durationSeconds: Number(timeline.durationSeconds || 0),
      layers: Array.isArray(timeline.layers) ? timeline.layers : []
    }
  };
}

function editorStateForCandidate(candidate = {}) {
  return objectValue(candidate.builderDraft?.editorState || candidate.editorState);
}

function artifactProbe(artifact = {}) {
  const content = objectValue(artifact.content);
  const nested = objectValue(content.probe);
  return {
    width: Number(content.width || nested.width || artifact.width || 0),
    height: Number(content.height || nested.height || artifact.height || 0),
    durationSeconds: Number(content.durationSeconds || content.duration || nested.durationSeconds || nested.duration || artifact.durationSeconds || 0),
    hasAudio: Boolean(content.hasAudio ?? nested.hasAudio ?? artifact.hasAudio),
    probeStatus: String(content.probeStatus || nested.probeStatus || artifact.probeStatus || "")
  };
}

function readyCheck(id, label, passed, detail) {
  return { id, label, passed: Boolean(passed), detail };
}

function finalizeChecks(checks) {
  const missing = checks.filter((check) => !check.passed).map((check) => check.label);
  return {
    ready: missing.length === 0,
    checks,
    missing
  };
}

function editorStickerReady(editorState = {}) {
  const sticker = objectValue(editorState.sticker);
  if (!sticker.enabled) return false;
  if (sticker.type === "image") {
    return Boolean(String(sticker.sourcePath || sticker.previewDataUrl || sticker.assetName || "").trim());
  }
  return Boolean(String(sticker.label || "").trim());
}

function editorCaptionsReady(editorState = {}) {
  const captions = objectValue(editorState.captions);
  if (!captions.enabled || !Array.isArray(captions.segments) || !captions.segments.length) return false;
  return captions.segments.every((segment) => (
    String(segment?.text || "").trim()
    && Number.isFinite(Number(segment?.startSeconds))
    && Number(segment?.endSeconds) > Number(segment?.startSeconds)
  ));
}

function editorCaptionEvidenceReady(candidate = {}, editorState = {}) {
  const captions = objectValue(editorState.captions);
  const segments = Array.isArray(captions.segments) ? captions.segments : [];
  const captionText = segments.map((segment) => String(segment?.text || "").trim()).filter(Boolean).join(" ");
  const candidateTitle = String(candidate.title || "").trim();
  const durationSeconds = Number(candidate.durationSeconds || candidate.duration || candidate.builderDraft?.duration || 0);
  const transcript = String(captions.transcript || candidate.transcriptSummary?.text || candidate.transcriptSnippet || "").trim();
  const transcriptReady = Boolean(
    transcript
    && candidate.transcriptStatus === "transcribed"
    && candidate.transcriptSummary?.usableForCaption !== false
    && (durationSeconds < 10 || candidate.transcriptSummary?.fullClipProcessed === true)
  );
  const capturedFrames = Array.isArray(candidate.editorFrameCapture?.frames) ? candidate.editorFrameCapture.frames : [];
  const visualObservations = [
    ...(Array.isArray(candidate.editorFrameAnalysis?.observations) ? candidate.editorFrameAnalysis.observations : []),
    ...(candidate.editorFrameAnalysis?.visualStory ? [candidate.editorFrameAnalysis.visualStory] : []),
    ...(Array.isArray(candidate.visionGate?.observations) ? candidate.visionGate.observations : []),
    ...(Array.isArray(candidate.visualAnalysis?.observations) ? candidate.visualAnalysis.observations : [])
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const evidence = objectValue(captions.evidence);
  const sourceReady = VERIFIED_CAPTION_SOURCES.has(String(captions.source || ""));
  const generationReady = VERIFIED_CAPTION_GENERATION_STATUSES.has(String(candidate.captionGeneration?.status || evidence.generationStatus || ""));
  const requestReady = Boolean(evidence.automaticCaptionRequestHash || candidate.captionGeneration?.automaticCaptionRequestHash);
  const genericTitle = Boolean(
    INTERNAL_CLIP_TITLE_PATTERN.test(captionText)
    || (candidateTitle && captionText.toLowerCase() === candidateTitle.toLowerCase())
  );
  return Boolean(
    editorCaptionsReady(editorState)
    && sourceReady
    && generationReady
    && transcriptReady
    && capturedFrames.length >= 3
    && visualObservations.length > 0
    && requestReady
    && !genericTitle
  );
}

function editorTimelineReady(editorState = {}) {
  const layers = Array.isArray(editorState.timeline?.layers) ? editorState.timeline.layers : [];
  return REQUIRED_TIMELINE_LAYERS.every((layerId) => {
    const layer = layers.find((item) => item?.id === layerId);
    return Boolean(layer && Number(layer.endSeconds) > Number(layer.startSeconds));
  });
}

function evaluateEditorEditReadiness({ candidate = {}, source = null } = {}) {
  const editorState = editorStateForCandidate(candidate);
  const layout = objectValue(editorState.videoLayout);
  const canvas = objectValue(layout.canvas);
  const subjectFrame = objectValue(layout.subjectFrame);
  const keyframes = Array.isArray(editorState.autoReframe?.keyframes) ? editorState.autoReframe.keyframes : [];
  const sourceVerified = Boolean(
    candidate.sourceId
    && source?.filePath
    && candidate.mediaPlayable !== false
    && source.playable !== false
    && (source.sha256 || source.verifiedAt || ["passed", "verified"].includes(String(source.probeStatus || "")))
  );
  const checks = [
    readyCheck("source", "Verified source", sourceVerified, "A real, probed source video is attached."),
    readyCheck(
      "canvas",
      "9:16 canvas",
      Number(canvas.width) === 1080 && Number(canvas.height) === 1920 && canvas.aspectRatio === "9:16",
      "Canvas is exactly 1080x1920."
    ),
    readyCheck(
      "subject",
      "3:4 subject video",
      Number(subjectFrame.width) === 1080 && Number(subjectFrame.height) === 1440 && subjectFrame.aspectRatio === "3:4",
      "The subject frame is 1080x1440 inside the vertical canvas."
    ),
    readyCheck("reframe", "Auto reframe", keyframes.length > 0, `${keyframes.length} motion keyframe${keyframes.length === 1 ? "" : "s"}.`),
    readyCheck("sticker", "Sticker", editorStickerReady(editorState), "A positioned text or image sticker is enabled."),
    readyCheck("captions", "Captions", editorCaptionsReady(editorState), "Timed, non-empty caption segments are enabled."),
    readyCheck(
      "caption_evidence",
      "Caption evidence",
      editorCaptionEvidenceReady(candidate, editorState),
      "Caption intelligence used a complete transcript, three frames, visual observations, and the Argentum Auto Message."
    ),
    readyCheck("timeline", "Complete timeline", editorTimelineReady(editorState), "Video, reframe, captions, and sticker layers have valid ranges.")
  ];
  return {
    contractVersion: 1,
    editorFingerprint: editorStateFingerprint(editorState),
    ...finalizeChecks(checks)
  };
}

function evaluateEditorProductionReadiness({ candidate = {}, source = null, artifact = null, allowCaptionReview = false } = {}) {
  const editReadiness = evaluateEditorEditReadiness({ candidate, source });
  const probe = artifactProbe(artifact || {});
  const filename = String(artifact?.filename || artifact?.path || "").toLowerCase();
  const captionGenerationStatus = String(
    candidate.captionGeneration?.status
    || candidate.builderDraft?.editorState?.captions?.evidence?.generationStatus
    || ""
  );
  const captionApproved = APPROVED_CAPTION_GENERATION_STATUSES.has(captionGenerationStatus);
  const verifiedArtifact = Boolean(
    artifact?.type === "rendered_clip"
    && artifact?.path
    && (artifact?.content?.sha256 || artifact?.sha256)
    && ["passed", "verified"].includes(probe.probeStatus)
  );
  const checks = [
    ...editReadiness.checks,
    readyCheck(
      "caption_approval",
      "Caption approval",
      captionApproved || (allowCaptionReview && captionGenerationStatus === "review_required"),
      captionApproved
        ? "The generated caption passed its confidence gate."
        : "A low-confidence generated caption requires operator approval in Precheck."
    ),
    readyCheck("export", "Verified MP4 export", verifiedArtifact && filename.endsWith(".mp4"), "The rendered file has a checksum and passed FFprobe."),
    readyCheck("output_ratio", "1080x1920 output", probe.width === 1080 && probe.height === 1920, `${probe.width || 0}x${probe.height || 0} verified output.`),
    readyCheck("duration", "Playable duration", probe.durationSeconds > 0, `${Number(probe.durationSeconds || 0).toFixed(1)} seconds.`),
    readyCheck("audio", "Audio preserved", source?.hasAudio !== true || probe.hasAudio, source?.hasAudio === true ? "Source audio is present in the export." : "The source does not require an audio track.")
  ];
  return {
    contractVersion: 1,
    editorFingerprint: editReadiness.editorFingerprint,
    probe,
    ...finalizeChecks(checks)
  };
}

function editorStateFingerprint(editorState = {}) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(fingerprintValue(editorState))))
    .digest("hex");
}

export {
  editorStateFingerprint,
  evaluateEditorEditReadiness,
  evaluateEditorProductionReadiness
};

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  editorStateFingerprint,
  evaluateEditorEditReadiness,
  evaluateEditorProductionReadiness
} from "../CLIPPING OFFICE /services/editor-production-readiness.js";

function completeEditorState() {
  return {
    videoLayout: {
      canvas: { width: 1080, height: 1920, aspectRatio: "9:16" },
      subjectFrame: { width: 1080, height: 1440, aspectRatio: "3:4" },
      background: { mode: "edge_fill", blur: 18 }
    },
    background: { mode: "edge_fill", blur: 18 },
    autoReframe: {
      mode: "motion_follow_3_4_inside_9_16",
      keyframes: [{ timeSeconds: 0, focusXPercent: 50 }, { timeSeconds: 8, focusXPercent: 64 }]
    },
    sticker: {
      enabled: true,
      type: "text",
      label: "Argentum",
      xPercent: 50,
      yPercent: 84,
      sizePercent: 24
    },
    captions: {
      enabled: true,
      source: "caption_intelligence_model",
      transcript: "The creator explains the exact moment before the result changes.",
      segments: [
        { text: "This is the moment", startSeconds: 0, endSeconds: 4 },
        { text: "Watch what happens", startSeconds: 4, endSeconds: 8 }
      ],
      evidence: {
        automaticCaptionRequestHash: "auto-message-hash",
        generationStatus: "complete"
      },
      style: { xPercent: 50, yPercent: 18, theme: "story" },
      updatedAt: "2026-07-14T12:00:00.000Z"
    },
    timeline: {
      durationSeconds: 8,
      selectedLayerId: "captions",
      layers: ["video", "reframe", "captions", "sticker"].map((id) => ({ id, startSeconds: 0, endSeconds: 8 }))
    },
    previewControls: "external",
    updatedAt: "2026-07-14T12:00:00.000Z"
  };
}

function completeFixture() {
  const candidate = {
    id: "candidate_1",
    sourceId: "source_1",
    mediaPlayable: true,
    builderApproved: true,
    durationSeconds: 8,
    title: "Creator explains the winning moment",
    transcriptStatus: "transcribed",
    transcriptSummary: {
      text: "The creator explains the exact moment before the result changes.",
      usableForCaption: true,
      fullClipProcessed: true
    },
    editorFrameCapture: {
      frames: [
        { position: "first", timestampSeconds: 0 },
        { position: "middle", timestampSeconds: 4 },
        { position: "ending", timestampSeconds: 8 }
      ]
    },
    editorFrameAnalysis: {
      observations: ["The creator points at the result before reacting."]
    },
    captionGeneration: {
      status: "complete",
      automaticCaptionRequestHash: "auto-message-hash"
    },
    builderDraft: { editorState: completeEditorState() }
  };
  const source = {
    id: "source_1",
    filePath: "/tmp/source.mp4",
    playable: true,
    sha256: "source-checksum",
    probeStatus: "passed",
    hasAudio: true
  };
  const artifact = {
    id: "artifact_1",
    type: "rendered_clip",
    filename: "vertical-final.mp4",
    path: "/tmp/vertical-final.mp4",
    content: {
      sha256: "render-checksum",
      probeStatus: "passed",
      width: 1080,
      height: 1920,
      durationSeconds: 8,
      hasAudio: true
    }
  };
  return { candidate, source, artifact };
}

test("complete vertical edit passes every edit and production readiness check", () => {
  const fixture = completeFixture();
  const edit = evaluateEditorEditReadiness(fixture);
  const production = evaluateEditorProductionReadiness(fixture);

  assert.equal(edit.ready, true);
  assert.deepEqual(edit.missing, []);
  assert.equal(production.ready, true);
  assert.deepEqual(production.missing, []);
  assert.equal(production.checks.length, 13);
});

test("low-confidence caption evidence renders to Precheck but blocks automatic Product Ready approval", () => {
  const fixture = completeFixture();
  fixture.candidate.captionGeneration.status = "review_required";
  fixture.candidate.builderDraft.editorState.captions.evidence.generationStatus = "review_required";

  const edit = evaluateEditorEditReadiness(fixture);
  const precheck = evaluateEditorProductionReadiness({ ...fixture, allowCaptionReview: true });
  const automaticApproval = evaluateEditorProductionReadiness(fixture);

  assert.equal(edit.ready, true);
  assert.equal(precheck.ready, true);
  assert.equal(automaticApproval.ready, false);
  assert.deepEqual(automaticApproval.missing, ["Caption approval"]);
});

test("Precheck rejects internal clip-window titles and metadata caption fallbacks", () => {
  const fixture = completeFixture();
  fixture.candidate.builderDraft.editorState.captions.source = "verified_clip_metadata";
  fixture.candidate.builderDraft.editorState.captions.segments = [
    { text: "30s clip window 1: Creator", startSeconds: 0, endSeconds: 8 }
  ];

  const result = evaluateEditorEditReadiness(fixture);

  assert.equal(result.ready, false);
  assert.ok(result.missing.includes("Caption evidence"));
  assert.equal(result.checks.find((check) => check.id === "captions").passed, true);
  assert.equal(result.checks.find((check) => check.id === "caption_evidence").passed, false);
});

test("Precheck blocks missing reframe, sticker, captions, and timeline work", () => {
  const fixture = completeFixture();
  const editorState = fixture.candidate.builderDraft.editorState;
  editorState.autoReframe.keyframes = [];
  editorState.sticker.enabled = false;
  editorState.captions.segments = [];
  editorState.timeline.layers = editorState.timeline.layers.filter((layer) => layer.id !== "captions");

  const result = evaluateEditorEditReadiness(fixture);

  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, ["Auto reframe", "Sticker", "Captions", "Caption evidence", "Complete timeline"]);
});

test("Product Ready blocks an invalid MP4 shape or missing source audio", () => {
  const fixture = completeFixture();
  fixture.artifact.filename = "vertical-final.webm";
  fixture.artifact.content.width = 720;
  fixture.artifact.content.height = 1280;
  fixture.artifact.content.hasAudio = false;

  const result = evaluateEditorProductionReadiness(fixture);

  assert.equal(result.ready, false);
  assert.ok(result.missing.includes("Verified MP4 export"));
  assert.ok(result.missing.includes("1080x1920 output"));
  assert.ok(result.missing.includes("Audio preserved"));
});

test("editor fingerprint ignores UI metadata but changes with rendered content", () => {
  const first = completeEditorState();
  const second = structuredClone(first);
  second.updatedAt = "2026-07-14T13:00:00.000Z";
  second.captions.updatedAt = "2026-07-14T13:00:00.000Z";
  second.timeline.selectedLayerId = "sticker";
  second.previewControls = "hidden";

  assert.equal(editorStateFingerprint(first), editorStateFingerprint(second));

  second.sticker.yPercent = 88;
  assert.notEqual(editorStateFingerprint(first), editorStateFingerprint(second));
});

test("Clipping Office wires persisted uploads through Precheck and manual Product Ready approval", async () => {
  const appSource = await fs.readFile(path.resolve("CLIPPING OFFICE /public/app.js"), "utf8");
  const indexSource = await fs.readFile(path.resolve("CLIPPING OFFICE /public/index.html"), "utf8");
  const productUiSource = await fs.readFile(path.resolve("CLIPPING OFFICE /public/product-ui.css"), "utf8");
  const serverSource = await fs.readFile(path.resolve("CLIPPING OFFICE /server.js"), "utf8");
  const argentumServerSource = await fs.readFile(path.resolve("server.js"), "utf8");
  const builderAreaSource = appSource.match(/function renderBuilderArea\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  const editorSourceControls = appSource.match(/function renderEditorSourceControls[\s\S]*?\n\}/)?.[0] || "";
  const editorWorkspaceSource = appSource.match(/function renderArgentumEditorWorkspace[\s\S]*?\n\}/)?.[0] || "";
  const clipsAreaSource = appSource.match(/function renderClipsArea[\s\S]*?\n\}/)?.[0] || "";
  const discoverClipCardSource = appSource.match(/function renderDiscoverClipCard[\s\S]*?\n\}/)?.[0] || "";
  const approvalSource = appSource.match(/async function approveClipForBuilder[\s\S]*?\n\}/)?.[0] || "";

  assert.match(appSource, /apiFormData\("\/api\/media\/sources\/upload"/);
  assert.match(appSource, /\/editor-export`/);
  assert.match(appSource, /canvas\.captureStream\(0\)/);
  assert.match(appSource, /canvasVideoTrack\?\.requestFrame\?\.\(\)/);
  assert.match(appSource, /fallbackFrameHandle = window\.setTimeout\(draw, 1000 \/ 30\)/);
  assert.match(appSource, /argentum-clipping-office-editor-worker/);
  assert.match(appSource, /ifAvailable: true/);
  assert.match(appSource, /source playback did not advance for 30 seconds/);
  assert.match(appSource, /recorder\.requestData\(\)/);
  const exportMimeBlock = appSource.slice(
    appSource.indexOf("function bestEditorExportMimeType"),
    appSource.indexOf("function waitForEditorVideoReady")
  );
  assert.ok(exportMimeBlock.indexOf("video/webm;codecs=vp8,opus") < exportMimeBlock.indexOf("video/mp4"));
  assert.match(appSource, /data-product-ready-action="approve"/);
  assert.match(appSource, /Finish & Send to Review/);
  assert.match(appSource, /function setEditorCompileProgress/);
  assert.match(appSource, /Rendering video/);
  assert.match(appSource, /Standardizing MP4/);
  assert.match(appSource, /role="progressbar"/);
  assert.match(appSource, /function editorStickerSliderValue/);
  assert.match(appSource, /data-editor-sticker-value="xPercent"/);
  assert.match(appSource, /const offset = number - 50/);
  assert.match(appSource, /renderProductionReviewArea/);
  assert.match(appSource, /data-automation-focus="\$\{esc\(option\.id\)\}"/);
  assert.match(appSource, /Official live records scanned/);
  assert.match(appSource, /Measured, no estimates/);
  assert.match(appSource, /Background editor progress/);
  assert.match(appSource, /missingProductionSources/);
  assert.match(appSource, /source MP4 files are missing/);
  assert.match(appSource, /function reportAutomationCompileProgress/);
  assert.match(appSource, /source playback did not advance for 30 seconds/);
  assert.match(appSource, /deterministic_center_fallback/);
  assert.match(appSource, /workerLastFailure/);
  assert.match(appSource, /function loadServerAutomationSettings/);
  assert.match(appSource, /function runFocusedAutomationScan/);
  assert.match(appSource, /function clipUsesPracticeEvidence/);
  assert.match(appSource, /function automaticClipMatchesFocus/);
  assert.match(appSource, /streamer\.automationManaged === true/);
  assert.match(appSource, /\.filter\(\(candidate\) => !clipUsesPracticeEvidence\(candidate\)\)/);
  assert.match(appSource, /isAutomationWorker/);
  assert.match(appSource, /state\.settings\.serverManagedAutomation && !isAutomationWorker/);
  assert.match(serverSource, /const AUTOMATION_FOCUS_OPTIONS/);
  assert.match(serverSource, /function matchesAutomationFocus/);
  assert.match(serverSource, /function isAutomationManagedStreamer/);
  assert.match(serverSource, /streamer\.permissionBasis === "operator_authorized_full_automation"/);
  assert.match(serverSource, /session\.stopRequested/);
  assert.match(serverSource, /session\.stopRequestedStatus/);
  assert.match(serverSource, /automation_monitor_disabled/);
  assert.match(serverSource, /operator_authorized_full_automation/);
  assert.match(serverSource, /automationFocus: streamer\?\.automationManaged/);
  assert.match(serverSource, /pathname === "\/api\/automation\/settings"/);
  assert.match(serverSource, /pathname === "\/api\/automation\/run"/);
  assert.match(serverSource, /workerProgress/);
  assert.match(serverSource, /workerLastFailure/);
  assert.match(serverSource, /function candidateHasDurableProductionOutput/);
  assert.match(serverSource, /function terminateOrphanedRollingRecorders/);
  assert.match(serverSource, /export \{ handleRequest, runAgent101Workflow, shutdownRuntime \}/);
  assert.match(serverSource, /sourceIntegrity/);
  assert.match(serverSource, /The saved source MP4 is no longer available on disk/);
  assert.match(appSource, /saveEditorDraft\(clipId, preflight\.editorState, \{ throwOnError: true \}\)/);
  assert.match(appSource, /The local project save is still finishing/);
  assert.match(appSource, /if \(isAutomationWorker\) throw error/);
  assert.match(appSource, /renderedBlob\?\.size && !isAutomationWorker/);
  assert.match(appSource, /function renderProductionLane/);
  assert.match(appSource, /const pageSize = 5/);
  assert.match(appSource, /const PRODUCTION_QUEUE_LIMIT = 50/);
  assert.match(appSource, /\$\{clips.length\}\/\$\{PRODUCTION_QUEUE_LIMIT\}/);
  assert.match(appSource, /function loadDiscoveryStreamPage/);
  assert.match(appSource, /\/api\/streams\/discovery\?/);
  assert.match(appSource, /function discoveryProvidersHaveMore/);
  assert.match(appSource, /state\.visibleCount \+= 20/);
  assert.match(appSource, /Studio is full\. Finish or remove a project/);
  assert.match(appSource, /data-toggle-production-clip/);
  assert.match(appSource, /data-production-page/);
  assert.match(appSource, /maybeAutoApplyEditorSticker/);
  assert.doesNotMatch(appSource, /function applyVerifiedCaptionFallback/);
  assert.doesNotMatch(appSource, /source: transcript \? "verified_speech_transcript" : "verified_clip_metadata"/);
  assert.match(appSource, /Caption evidence is incomplete/);
  assert.match(appSource, /editorCaptionEvidenceForClip/);
  assert.match(serverSource, /migrateGenericCaptionOutputsToStudio/);
  assert.match(serverSource, /automatic_caption_request_contract_failed/);
  assert.match(serverSource, /three_frame_visual_analysis_required/);
  assert.match(approvalSource, /if \(defaultStickerApplied && !\(await persistEditorDraftNow\(candidateId\)\)\?\.candidate\)/);
  assert.match(approvalSource, /const contextResult = await prepareEditorCaptionContext\(candidateId\);[\s\S]*await persistEditorDraftNow\(candidateId\)/);
  assert.match(approvalSource, /const readiness = editorPrecheckForClip\(preparedClip\)/);
  assert.match(builderAreaSource, /renderArgentumEditorWorkspace/);
  assert.ok(builderAreaSource.indexOf("studio-projects") < builderAreaSource.indexOf("renderArgentumEditorWorkspace"));
  assert.match(builderAreaSource, /editorProjectName\(clip\)/);
  assert.match(builderAreaSource, /editorProjectDescription\(clip\)/);
  assert.match(appSource, /function editorProjectName/);
  assert.match(appSource, /return `\$\{streamer\} clip`/);
  assert.match(appSource, /function editorProjectDescription/);
  assert.match(editorSourceControls, /Current project/);
  assert.doesNotMatch(editorSourceControls, />Open</);
  assert.doesNotMatch(editorSourceControls, />Original</);
  assert.doesNotMatch(editorSourceControls, />Close</);
  assert.doesNotMatch(builderAreaSource, /renderProductionReviewArea/);
  assert.match(editorWorkspaceSource, /studio-editor-head[\s\S]*renderEditorPreparationBar[\s\S]*editor-studio-layout/);
  assert.match(editorWorkspaceSource, /editor-tool-tabs/);
  assert.match(editorWorkspaceSource, /data-editor-timeline-toggle/);
  assert.doesNotMatch(editorWorkspaceSource, /renderEditorPipeline/);
  assert.doesNotMatch(editorWorkspaceSource, /editor-workspace-grid/);
  assert.match(clipsAreaSource, /state\.activeView === "studio"[\s\S]*renderBuilderArea/);
  assert.match(clipsAreaSource, /state\.activeView === "review"[\s\S]*renderProductionReviewArea/);
  assert.match(clipsAreaSource, /state\.activeView === "library"[\s\S]*renderLibraryArea/);
  assert.match(appSource, /function renderLibraryArea/);
  assert.match(appSource, /function clipHasFinishedStudioEdit/);
  assert.match(appSource, /\["precheck", "product_ready"\]\.includes\(stage\)/);
  assert.match(appSource, /Finish a clip in Studio and send it to Review/);
  assert.match(appSource, /Finished edits, organized in one place/);
  assert.match(appSource, /data-library-search/);
  assert.match(appSource, /data-library-filter/);
  assert.match(appSource, /class="danger library-remove" data-remove-clip/);
  assert.match(appSource, /function renderClipRemovalModal/);
  assert.match(appSource, /role="alertdialog"/);
  assert.match(appSource, /Original video file/);
  assert.match(appSource, /Kept on this Mac/);
  assert.match(appSource, /data-confirm-clip-removal/);
  assert.doesNotMatch(appSource, /window\.confirm\(`Remove \$\{label\} from Clipping Office/);
  assert.match(appSource, /renderClipsArea\(\{ force: true \}\)/);
  assert.match(appSource, /data-editor-drop-zone/);
  assert.match(appSource, /function loadEditorVideoFile/);
  assert.doesNotMatch(editorWorkspaceSource, /editor-empty-mark/);
  assert.match(indexSource, /product-ui\.css/);
  assert.match(indexSource, /id="argentum-command-bar"/);
  assert.match(indexSource, /data-argentum-command-toggle/);
  assert.match(indexSource, /data-agent101-chat-form/);
  assert.match(indexSource, /data-agent101-chat-input/);
  assert.match(indexSource, /data-agent101-chat-panel/);
  assert.ok(indexSource.indexOf('id="argentum-command-bar"') < indexSource.indexOf('id="workflow-rail"'));
  assert.equal((indexSource.match(/class="product-main-office"/g) || []).length, 1);
  assert.match(indexSource, /class="product-header-inner"/);
  assert.match(indexSource, /id="workflow-rail"/);
  assert.match(indexSource, /data-workflow-status/);
  assert.match(indexSource, /data-workflow-stage="studio"/);
  assert.match(indexSource, /data-workflow-stage="review"/);
  assert.match(indexSource, /data-workflow-stage="precheck"/);
  assert.match(indexSource, /data-workflow-stage="ready"/);
  assert.match(indexSource, /data-workflow-stage="library"/);
  assert.match(indexSource, /class="product-main-office" href="\/" data-main-office-link/);
  assert.match(indexSource, /aria-label="Back to Main Office"/);
  assert.match(indexSource, />Main Office<\/b>/);
  assert.match(indexSource, /class="product-create"/);
  assert.match(productUiSource, /\.hello-shell \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(productUiSource, /--argentum-command-height: 64px/);
  assert.match(productUiSource, /\.product-shell\.is-argentum-command-collapsed/);
  assert.match(productUiSource, /top: calc\(var\(--argentum-command-height\) \+ var\(--workflow-rail-height\)\)/);
  assert.match(productUiSource, /body\.automation-worker-runtime \.argentum-command-bar/);
  assert.match(productUiSource, /\.workflow-clip-thumb \{[\s\S]*?aspect-ratio: 16 \/ 9/);
  assert.match(productUiSource, /left 720ms cubic-bezier/);
  assert.match(productUiSource, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(productUiSource, /\.discovery-surface \.watch-panel \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(productUiSource, /@media \(max-width: 760px\) \{[\s\S]*?\.live-search select,[\s\S]*?flex: 0 0 auto/);
  assert.match(indexSource, /id="discover-clips"/);
  assert.match(appSource, /function clipThumbnailUrl/);
  assert.match(appSource, /function workflowRailStageForClip/);
  assert.match(appSource, /function renderWorkflowRail/);
  assert.match(appSource, /function setArgentumCommandBarCollapsed/);
  assert.match(appSource, /function sendArgentumAgentMessage/);
  assert.match(appSource, /argentumClippingOfficeCommandBarCollapsed/);
  assert.match(appSource, /argentumClippingOfficeAgent101Thread/);
  assert.match(appSource, /\/api\/argentum\/agent101\/chats/);
  assert.match(appSource, /roomId: "clips-office"/);
  assert.match(argentumServerSource, /CLIPPING_OFFICE_AGENT101_BRIDGE/);
  assert.match(argentumServerSource, /function clippingOfficeAgent101BridgeTarget/);
  assert.match(appSource, /productionWorkflow\?\.localLibraryPath/);
  assert.match(appSource, /state\.automation\.workerClipId/);
  assert.match(appSource, /api\("\/api\/automation"/);
  assert.match(appSource, /function openWorkflowClip/);
  assert.match(appSource, /\/frame\?candidateId=/);
  assert.match(appSource, /const seenMoments = new Set\(\)/);
  assert.match(appSource, /const momentKey = `\$\{clip\.sourceId\}:\$\{start\}:\$\{end\}`/);
  assert.match(discoverClipCardSource, /data-discover-thumbnail/);
  assert.doesNotMatch(discoverClipCardSource, /<video/);
  assert.doesNotMatch(indexSource, /AI online/);
  assert.doesNotMatch(indexSource, /Agent 101 online/i);
  assert.match(indexSource, /data-app-view="studio"/);
  assert.match(indexSource, /data-app-view="review"/);
  assert.match(indexSource, /data-app-view="library"/);
  assert.match(indexSource, /data-app-view="settings"/);
  assert.match(appSource, /function renderSettingsArea/);
  assert.match(appSource, /data-setting-format/);
  assert.match(appSource, /clipFormatStorageKey/);
  assert.match(appSource, /timeoutMs: 120000/);
  assert.match(appSource, /\.\.\.editorDefaultSticker\(\),[\s\S]*enabled: true,[\s\S]*label: clip\.streamerName/);
  assert.match(appSource, /function resumeIncompleteSelectedEditorClip/);
  assert.match(appSource, /preparationAttemptedClipIds/);
  assert.match(appSource, /The request took too long\. The office will keep running/);
  assert.match(indexSource, /id="office-startup"/);
  assert.match(indexSource, /data-startup-step="engine"/);
  assert.match(indexSource, /data-startup-step="discovery"/);
  assert.match(appSource, /function initialAppView\(\) \{\s*return "discover";/);
  assert.match(appSource, /async function initializeClippingOffice/);
  assert.match(appSource, /localStorage\.setItem\(appViewStorageKey, "discover"\)/);
  assert.match(appSource, /await initializeClippingOffice\(\)/);
  assert.match(appSource, /if \(state\.watch\.polling\) return;/);
  assert.match(appSource, /api\("\/api\/watch-sessions\/active", \{\s*timeoutMs: 10000/);
  assert.match(appSource, /const autoPipelineStorageKey/);
  assert.match(appSource, /const autoPipelineStageStorageKey/);
  assert.match(appSource, /const AUTOMATION_STAGES = \[/);
  assert.match(appSource, /savedValue !== null/);
  assert.match(appSource, /function runAutomaticClipPipeline/);
  assert.match(appSource, /function setAutomaticPipelineStage/);
  assert.match(appSource, /function previewAutomaticPipelineStage/);
  assert.match(appSource, /data-automation-stage-range/);
  assert.match(appSource, /Automation will stop at/);
  assert.match(appSource, /You validate the rendered clip in Review/);
  assert.match(appSource, /Number\(state\.settings\.autoPipelineStage \|\| 0\) < 3/);
  assert.match(appSource, /Number\(state\.settings\.autoPipelineStage \|\| 0\) >= 4/);
  assert.match(appSource, /approvedBy: "automatic_pipeline"/);
  assert.match(appSource, /data-auto-pipeline-toggle/);
  assert.match(appSource, /data-choose-output-folder/);
  assert.match(appSource, /function saveProductReadyClipLocally/);
  assert.match(appSource, /\/local-save`/);
  assert.match(appSource, /document\.documentElement\.scrollTop = 0/);
  assert.match(appSource, /window\.requestAnimationFrame\(resetScroll\)/);
  assert.match(serverSource, /queueEditorExportForPrecheck/);
  assert.match(serverSource, /const PRODUCTION_QUEUE_LIMIT = 50/);
  assert.match(serverSource, /async function fetchTwitchDiscoveryPage/);
  assert.match(serverSource, /params\.set\("after"/);
  assert.match(serverSource, /async function fetchKickDiscoveryPage/);
  assert.match(serverSource, /pathname === "\/api\/streams\/discovery"/);
  assert.match(serverSource, /activeEditorCount >= PRODUCTION_QUEUE_LIMIT/);
  assert.match(serverSource, /precheckCount >= PRODUCTION_QUEUE_LIMIT/);
  assert.match(serverSource, /productReadyCount >= PRODUCTION_QUEUE_LIMIT/);
  assert.match(serverSource, /Product Ready is full/);
  assert.match(serverSource, /standardizeEditorExport/);
  assert.match(serverSource, /setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=1\.5/);
  assert.match(serverSource, /aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS,apad=pad_dur=1\.5/);
  assert.match(serverSource, /candidate\.productionWorkflow\?\.stage !== "precheck"/);
  assert.match(serverSource, /postingStatus: "not_posted"/);
  assert.match(serverSource, /approvedBy === "automatic_pipeline"/);
  assert.match(serverSource, /product_ready_saved_locally/);
});

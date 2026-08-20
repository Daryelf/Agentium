import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CapCutController } from "../CLIPPING OFFICE /services/capcut-controller.js";

const WORKFLOW_ID = "vertical_916_auto_frame_blur_background_bottom_sticker";

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "argentum-capcut-test-"));
}

test("Clips queue removes approved or declined clips and exposes CapCut connect", async () => {
  const appSource = await fs.readFile(path.resolve("CLIPPING OFFICE /public/app.js"), "utf8");
  const cssSource = await fs.readFile(path.resolve("CLIPPING OFFICE /public/styles.css"), "utf8");
  const serverSource = await fs.readFile(path.resolve("CLIPPING OFFICE /server.js"), "utf8");
  const desktopMainSource = await fs.readFile(path.resolve("desktop/main.js"), "utf8");
  const desktopPreloadSource = await fs.readFile(path.resolve("desktop/preload.js"), "utf8");

  const currentClipsSource = appSource.match(/function currentClips\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  const builderClipsSource = appSource.match(/function builderClips\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  const builderAreaSource = appSource.match(/function renderBuilderArea\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  const clipsAreaSource = appSource.match(/function renderClipsArea\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  const approveSource = serverSource.match(/async function approveClipCandidateForBuilder[\s\S]*?\n\}/)?.[0] || "";

  assert.match(currentClipsSource, /clipApprovedForBuilder\(clip\) \|\| clipDeclined\(clip\)/);
  assert.match(builderClipsSource, /clipApprovedForBuilder\(clip\) && !clipDeclined\(clip\)/);
  assert.match(appSource, /data-decline-clip/);
  assert.match(appSource, /async function declineClip/);
  assert.doesNotMatch(builderAreaSource, /data-builder-teach-clip|data-builder-teach-start|data-auto-edit-clip/);
  assert.doesNotMatch(clipsAreaSource, /renderCapCutWorkspace\(\)/);
  assert.match(appSource, /function renderArgentumEditorWorkspace/);
  assert.match(appSource, /renderArgentumEditorWorkspace\(clips\)/);
  assert.match(appSource, /data-select-builder-clip/);
  assert.match(appSource, /data-editor-video/);
  assert.match(appSource, /data-editor-play/);
  assert.match(appSource, /updateEditorAutoReframe/);
  assert.match(appSource, /motion_follow_3_4_inside_9_16/);
  assert.match(appSource, /3:4 subject video/);
  assert.match(appSource, /data-editor-fill-video/);
  assert.match(appSource, /data-editor-sticker-pick/);
  assert.match(appSource, /data-editor-sticker-field/);
  assert.match(appSource, /scheduleEditorDraftSave/);
  assert.match(appSource, /captureEditorPlaybackState/);
  assert.match(appSource, /restoreEditorPlaybackState/);
  assert.match(appSource, /editorReframeFocusAtTime/);
  assert.match(appSource, /allowPaused/);
  assert.match(appSource, /Auto reframe locked/);
  assert.match(appSource, /playbackSnapshot/);
  assert.match(appSource, /subjectFrame:\s*\{/);
  assert.match(appSource, /aspectRatio:\s*"3:4"/);
  assert.match(appSource, /editorDefaultSticker/);
  assert.match(appSource, /loadSavedEditorStickerLibrary/);
  assert.match(appSource, /data-editor-sticker-save-preset/);
  assert.match(appSource, /data-editor-sticker-library/);
  assert.match(appSource, /hydrateEditorStickerImages/);
  assert.match(appSource, /previewDataUrl/);
  assert.match(appSource, /persistableEditorStickerPreview/);
  assert.match(appSource, /editorDefaultTimelineLayers/);
  assert.match(appSource, /setEditorTimelineLayer/);
  assert.match(appSource, /data-editor-layer-field/);
  assert.match(appSource, /data-editor-layer-handle/);
  assert.match(appSource, /data-editor-layer-at-playhead/);
  assert.match(appSource, /function editorRenderSignature/);
  assert.match(appSource, /lastRenderSignature/);
  assert.match(appSource, /data-editor-upload-clip/);
  assert.match(appSource, /data-editor-load-selected/);
  assert.match(appSource, /data-editor-export/);
  assert.match(appSource, /exportEditedClip/);
  assert.match(appSource, /canvas\.captureStream\(0\)/);
  assert.match(appSource, /canvasVideoTrack\?\.requestFrame\?\.\(\)/);
  assert.match(appSource, /data-editor-caption-overlay/);
  assert.match(appSource, /generateEditorCaptions/);
  assert.match(appSource, /No real transcript found for this clip yet/);
  assert.match(appSource, /download=/);
  assert.match(cssSource, /grid-template-columns:\s*minmax\(220px,\s*250px\) 390px minmax\(260px,\s*310px\)/);
  assert.match(cssSource, /height:\s*640px/);
  assert.match(cssSource, /\.editor-caption-overlay/);
  assert.match(cssSource, /padding-inline:\s*8px/);
  assert.match(cssSource, /object-position:\s*50% 50%/);
  assert.match(cssSource, /\.editor-timeline-toolbar/);
  assert.match(cssSource, /\.editor-layer-control-panel/);
  assert.match(cssSource, /\.editor-layer-handle/);
  assert.match(cssSource, /\.editor-sticker-library/);
  assert.match(cssSource, /\.editor-sticker-overlay\.is-loading/);
  assert.match(cssSource, /align-items:\s*end/);
  assert.match(cssSource, /\.editor-source-actions/);
  assert.match(cssSource, /\.editor-head-actions/);
  assert.match(serverSource, /editorState: body\.editorState/);
  assert.match(desktopMainSource, /argentum:read-image-file/);
  assert.match(desktopPreloadSource, /readImageFile/);
  assert.doesNotMatch(appSource, /editor-preview-bg/);
  assert.doesNotMatch(appSource, /editor-preview-main/);
  assert.match(appSource, /function renderTrainingCoach/);
  assert.match(appSource, /function renderTeachModePanel/);
  assert.match(appSource, /data-teach-action="start"/);
  assert.match(appSource, /data-teach-action="save"/);
  assert.match(appSource, /data-teach-snapshot/);
  assert.match(appSource, /maybeAutoTeachSnapshot/);
  assert.match(appSource, /data-replay-macro/);
  assert.match(appSource, /data-run-all-macros/);
  assert.match(appSource, /data-rename-macro/);
  assert.match(appSource, /data-macro-card/);
  assert.match(appSource, /replay-sequence/);
  assert.match(appSource, /activeMacroId/);
  assert.match(appSource, /data-replay-pause/);
  assert.match(appSource, /data-replay-resume/);
  assert.match(appSource, /data-target-teach-step/);
  assert.match(appSource, /data-wait-step-ms/);
  assert.match(appSource, /data-update-wait-step/);
  assert.match(serverSource, /setTeachStepTarget/);
  assert.match(serverSource, /updateTeachStepWait/);
  assert.match(serverSource, /captureTeachSnapshot/);
  assert.match(serverSource, /reorderMacros/);
  assert.match(serverSource, /renameMacro/);
  assert.match(serverSource, /replayAllMacros/);
  assert.match(serverSource, /pauseReplay/);
  assert.match(serverSource, /resumeReplay/);
  assert.doesNotMatch(appSource, /renderDesktopPlaybookPanel/);
  assert.doesNotMatch(appSource, /data-desktop-playbook-action/);
  assert.match(appSource, /capcut-workflow-inputs/);
  assert.match(appSource, /Connect CapCut/);
  assert.match(appSource, /data-capcut-action="connect"/);
  assert.match(serverSource, /\/api\\\/clips\\\/candidates\\\/\(\[\^\/\]\+\)\\\/decline/);
  assert.match(serverSource, /capcutWorkflowInputsForCandidate/);
  assert.match(serverSource, /capcutProjectDir/);
  assert.match(serverSource, /runCapcutDesktopEdit/);
  assert.match(serverSource, /requestedDryRun/);
  assert.match(approveSource, /await saveState\(\)/);
});

async function writeFixtureFiles(root) {
  const sourceVideoPath = path.join(root, "clip with spaces.mp4");
  const stickerPath = path.join(root, "bottom sticker.png");
  const outputProjectFolder = path.join(root, "projects");
  await fs.writeFile(sourceVideoPath, Buffer.alloc(4096, 1));
  await fs.writeFile(stickerPath, Buffer.alloc(1024, 2));
  await fs.mkdir(outputProjectFolder, { recursive: true });
  return {
    sourceVideoPath,
    stickerPath,
    projectName: "Vertical: Test/Project?",
    outputProjectFolder
  };
}

function controller(root, overrides = {}) {
  let sequence = 0;
  return new CapCutController({
    config: { capcutMacroDir: path.join(root, "macros") },
    state: {},
    helpers: {
      newId(prefix) {
        sequence += 1;
        return `${prefix}_${sequence}`;
      },
      async saveState() {},
      addStateLog() {}
    },
    ...overrides
  });
}

test("CapCut workflow macro JSON stores placeholders and sanitized inputs", async () => {
  const root = await tempDir();
  try {
    const inputs = await writeFixtureFiles(root);
    const service = controller(root);
    service.controlState().teach = {
      id: "teach_one",
      name: WORKFLOW_ID,
      app: "CapCut",
      version: 1,
      workflowId: WORKFLOW_ID,
      workflowInputs: inputs,
      recording: false,
      status: "stopped",
      startedAt: "2026-06-29T00:00:00.000Z",
      liveSnapshots: [
        {
          id: "snapshot_one",
          reason: "manual",
          label: "Import",
          screenshot: { id: "shot_one", url: "/api/capcut-control/macro-screenshots/teach_one/shot_one", sizeBytes: 100 },
          createdAt: "2026-06-29T00:00:01.000Z"
        }
      ],
      steps: [
        {
          type: "click",
          x: 100,
          y: 100,
          xRatio: 0.1,
          yRatio: 0.1,
          semanticTarget: { version: 1, label: "Import", region: "media_panel", strategy: "semantic_label_then_region" },
          description: "Click Import"
        },
        { type: "typeText", text: inputs.sourceVideoPath, description: "Type source path" },
        { type: "typeText", text: inputs.stickerPath, description: "Type sticker path" },
        { type: "typeText", text: inputs.projectName, description: "Type project name" }
      ]
    };

    const saved = await service.saveWorkflowMacro(WORKFLOW_ID, inputs);
    const macro = JSON.parse(await fs.readFile(saved.macro.filePath, "utf8"));

    assert.equal(macro.app, "CapCut");
    assert.equal(macro.platform, "macOS");
    assert.equal(macro.inputs.sourceVideoPath, "{{sourceVideoPath}}");
    assert.equal(macro.steps[0].semanticTarget.label, "Import");
    assert.equal(macro.steps[1].text, "{{sourceVideoPath}}");
    assert.equal(macro.steps[2].text, "{{stickerPath}}");
    assert.equal(macro.workflowInputs.projectName, "Vertical_ Test_Project_");
    assert.equal(macro.teachingSnapshots[0].id, "snapshot_one");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Teach Mode captures live CapCut teaching snapshots", async () => {
  const root = await tempDir();
  try {
    class MockSnapshotController extends CapCutController {
      async takeMacroScreenshot(session, label) {
        return {
          id: `${label}_shot`,
          sessionId: session.id,
          url: `/api/capcut-control/macro-screenshots/${session.id}/${label}_shot`,
          sizeBytes: 2048,
          target: "capcut_window",
          createdAt: "2026-06-29T00:00:00.000Z"
        };
      }
      async workflowStatus() {
        return { workflows: [], planner: null };
      }
      async listMacros() {
        return [];
      }
    }
    const service = new MockSnapshotController({
      config: { capcutMacroDir: path.join(root, "macros") },
      state: {},
      helpers: { async saveState() {}, addStateLog() {} }
    });
    service.controlState().teach = {
      id: "teach_snapshot",
      name: "snapshot_macro",
      recording: true,
      status: "recording",
      startedAt: "2026-06-29T00:00:00.000Z",
      steps: [{ type: "click", description: "Click Import" }]
    };

    const result = await service.captureTeachSnapshot("manual");
    assert.equal(result.teach.liveSnapshots.length, 1);
    assert.equal(result.teach.liveSnapshots[0].reason, "manual");
    assert.equal(result.teach.liveSnapshots[0].stepCount, 1);
    assert.equal(result.teach.liveSnapshots[0].screenshot.target, "capcut_window");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("CapCut macro storage creates a backup before overwriting", async () => {
  const root = await tempDir();
  try {
    const inputs = await writeFixtureFiles(root);
    const service = controller(root);
    service.controlState().teach = {
      id: "teach_backup",
      name: WORKFLOW_ID,
      workflowId: WORKFLOW_ID,
      workflowInputs: inputs,
      recording: false,
      status: "stopped",
      startedAt: "2026-06-29T00:00:00.000Z",
      steps: [{ type: "wait", ms: 1, description: "Wait" }]
    };

    await service.saveWorkflowMacro(WORKFLOW_ID, inputs);
    const second = await service.saveWorkflowMacro(WORKFLOW_ID, inputs);
    assert.ok(second.macro.backupPath, "second save should report a backup path");
    const backupStat = await fs.stat(second.macro.backupPath);
    assert.ok(backupStat.isFile(), "backup file should exist");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Corrupted CapCut macro JSON does not crash the library", async () => {
  const root = await tempDir();
  try {
    const service = controller(root);
    const directory = await service.ensureMacroDir();
    await fs.writeFile(path.join(directory, "broken.json"), "{ not json", "utf8");
    const macros = await service.listMacros();
    assert.deepEqual(macros, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("CapCut macro library persists order and renames macros", async () => {
  const root = await tempDir();
  try {
    const service = controller(root);
    const directory = await service.ensureMacroDir();
    await fs.writeFile(path.join(directory, "first.json"), JSON.stringify({
      id: "first",
      name: "First Macro",
      app: "CapCut",
      createdAt: "2026-07-01T00:00:00.000Z",
      steps: [{ type: "wait", ms: 1, description: "first step" }]
    }, null, 2));
    await fs.writeFile(path.join(directory, "second.json"), JSON.stringify({
      id: "second",
      name: "Second Macro",
      app: "CapCut",
      createdAt: "2026-07-01T00:01:00.000Z",
      steps: [{ type: "wait", ms: 1, description: "second step" }]
    }, null, 2));

    assert.deepEqual((await service.listMacros()).map((macro) => macro.id), ["first", "second"]);
    await service.reorderMacros(["second", "first"]);
    assert.deepEqual((await service.listMacros()).map((macro) => macro.id), ["second", "first"]);

    await service.renameMacro("second", "Second Pass");
    const renamed = await service.readMacro("second");
    assert.equal(renamed.name, "Second Pass");
    assert.deepEqual((await service.listMacros()).map((macro) => macro.id), ["second", "first"]);

    await service.deleteMacro("second");
    assert.deepEqual(service.controlState().macroOrder, ["first"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Run All replays saved CapCut macros in playlist order", async () => {
  const root = await tempDir();
  try {
    class MockRunAllController extends CapCutController {
      constructor(options) {
        super(options);
        this.ran = [];
        this.snapshots = [];
      }
      async focusCapCut() {
        return { running: true };
      }
      async startReplayEmergencyListener() {}
      stopReplayEmergencyListener() {}
      async executeMacroStep(step) {
        this.ran.push(`${step.macroName}:${step.description}`);
        this.snapshots.push(this.publicReplayState());
        return { ok: true };
      }
    }
    const service = new MockRunAllController({
      config: { capcutMacroDir: path.join(root, "macros") },
      state: {},
      helpers: {
        newId(prefix) {
          return `${prefix}_run_all`;
        },
        async saveState() {},
        addStateLog() {}
      }
    });
    const directory = await service.ensureMacroDir();
    await fs.writeFile(path.join(directory, "first.json"), JSON.stringify({
      id: "first",
      name: "First Macro",
      createdAt: "2026-07-01T00:00:00.000Z",
      steps: [{ type: "wait", ms: 1, description: "first step" }]
    }, null, 2));
    await fs.writeFile(path.join(directory, "second.json"), JSON.stringify({
      id: "second",
      name: "Second Macro",
      createdAt: "2026-07-01T00:01:00.000Z",
      steps: [
        { type: "wait", ms: 1, description: "second step one" },
        { type: "wait", ms: 1, description: "second step two" }
      ]
    }, null, 2));

    await service.reorderMacros(["second", "first"]);
    const result = await service.replayAllMacros();

    assert.equal(result.replay.status, "complete");
    assert.equal(result.replay.totalSteps, 3);
    assert.deepEqual(result.replay.sequence.map((item) => item.macroName), ["Second Macro", "First Macro"]);
    assert.deepEqual(service.snapshots.map((snapshot) => snapshot.currentMacroIndex), [1, 1, 2]);
    assert.deepEqual(service.snapshots.map((snapshot) => snapshot.currentMacroStepIndex), [1, 2, 1]);
    assert.deepEqual(service.snapshots.map((snapshot) => snapshot.activeMacroName), ["Second Macro", "Second Macro", "First Macro"]);
    assert.equal(result.replay.currentMacroIndex, 2);
    assert.equal(result.replay.currentMacroCount, 2);
    assert.equal(result.replay.currentMacroStepIndex, 1);
    assert.deepEqual(service.ran, [
      "Second Macro:second step one",
      "Second Macro:second step two",
      "First Macro:first step"
    ]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Missing workflow inputs fail with a clear error", async () => {
  const root = await tempDir();
  try {
    const service = controller(root);
    await assert.rejects(
      () => service.startWorkflowTraining(WORKFLOW_ID, { sourceVideoPath: "/tmp/missing.mp4" }),
      /Missing workflow input: projectName, outputProjectFolder/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("CapCut workflow can train without an optional clip path or sticker image", async () => {
  const root = await tempDir();
  try {
    const inputs = await writeFixtureFiles(root);
    await fs.rm(inputs.stickerPath, { force: true });
    class MockTrainingController extends CapCutController {
      async focusCapCut() {
        return { accessibilityPermission: true, screenRecordingPermission: true };
      }
      async currentCapCutAutomationWindow() {
        return { x: 100, y: 100, width: 1200, height: 800, ownerName: "CapCut" };
      }
      async spawnTeachRecorder() {
        this.teachProcess = { pid: 1234 };
        this.controlState().teach.recorderReady = true;
      }
    }
    const service = new MockTrainingController({
      config: { capcutMacroDir: path.join(root, "macros") },
      state: {},
      helpers: {
        newId(prefix) {
          return `${prefix}_optional_sticker`;
        },
        async saveState() {},
        addStateLog() {}
      }
    });

    const result = await service.startWorkflowTraining(WORKFLOW_ID, {
      projectName: inputs.projectName,
      outputProjectFolder: inputs.outputProjectFolder,
      stickerPath: ""
    });

    assert.equal(result.teach.workflowInputs.sourceVideoPath, "");
    assert.equal(result.teach.workflowInputs.stickerPath, "");
    assert.equal(result.teach.status, "recording");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Teach Mode start recovers a stale recorder session", async () => {
  const root = await tempDir();
  try {
    class MockTeachStartController extends CapCutController {
      async focusCapCut() {
        return { accessibilityPermission: true, screenRecordingPermission: true };
      }
      async currentCapCutAutomationWindow() {
        return { x: 100, y: 100, width: 1200, height: 800, ownerName: "CapCut" };
      }
      async normalizeCapCutWindow() {
        return { x: 100, y: 100, width: 1200, height: 800, ownerName: "CapCut" };
      }
      async spawnTeachRecorder() {
        this.teachProcess = { killed: false, exitCode: null, signalCode: null };
        const session = this.controlState().teach;
        session.recorderReady = true;
        session.recorderMessages = [{ type: "ready", message: "Recorder ready", createdAt: "2026-07-07T00:00:00.000Z" }];
      }
      async workflowStatus() {
        return { workflows: [], planner: null };
      }
      async listMacros() {
        return [];
      }
    }
    const service = new MockTeachStartController({
      config: { capcutMacroDir: path.join(root, "macros") },
      state: {},
      helpers: {
        newId(prefix) {
          return `${prefix}_recovered`;
        },
        async saveState() {},
        addStateLog() {}
      }
    });
    service.controlState().teach = {
      id: "stale_teach",
      name: "old_macro",
      recording: true,
      status: "recording",
      steps: [],
      startedAt: "2026-07-07T00:00:00.000Z"
    };
    service.teachProcess = { killed: true, exitCode: null, signalCode: "SIGTERM" };

    const result = await service.startTeachMode("fresh_macro");
    assert.equal(result.teach.name, "fresh_macro");
    assert.equal(result.teach.recording, true);
    assert.equal(result.teach.recorderReady, true);
    assert.equal(result.teach.stopReason, "");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Stale optional source video path does not block workflow training", async () => {
  const root = await tempDir();
  try {
    const inputs = await writeFixtureFiles(root);
    class MockTrainingController extends CapCutController {
      async focusCapCut() {
        return { accessibilityPermission: true, screenRecordingPermission: true };
      }
      async currentCapCutAutomationWindow() {
        return { x: 100, y: 100, width: 1200, height: 800, ownerName: "CapCut" };
      }
      async spawnTeachRecorder() {
        this.teachProcess = { pid: 1234 };
        this.controlState().teach.recorderReady = true;
      }
    }
    const service = new MockTrainingController({
      config: { capcutMacroDir: path.join(root, "macros") },
      state: {},
      helpers: {
        newId(prefix) {
          return `${prefix}_stale_source`;
        },
        async saveState() {},
        addStateLog() {}
      }
    });

    const staleSource = path.join(root, "gone.mp4");
    const result = await service.startWorkflowTraining(WORKFLOW_ID, { ...inputs, sourceVideoPath: staleSource });
    assert.equal(result.teach.workflowInputs.sourceVideoPath, staleSource);
    assert.equal(result.teach.status, "recording");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Macro replay cancellation stops after the current step and logs status", async () => {
  const root = await tempDir();
  try {
    class MockReplayController extends CapCutController {
      async focusCapCut() {
        return { running: true };
      }
      async startReplayEmergencyListener() {}
      stopReplayEmergencyListener() {}
      async executeMacroStep(step) {
        if (step.description === "cancel replay") await this.cancelReplay("test_cancel");
      }
    }
    let sequence = 0;
    const service = new MockReplayController({
      config: { capcutMacroDir: path.join(root, "macros") },
      state: {},
      helpers: {
        newId(prefix) {
          sequence += 1;
          return `${prefix}_${sequence}`;
        },
        async saveState() {},
        addStateLog() {}
      }
    });
    const directory = await service.ensureMacroDir();
    await fs.writeFile(path.join(directory, "cancel-macro.json"), JSON.stringify({
      id: "cancel_macro",
      name: "cancel_macro",
      app: "CapCut",
      platform: "macOS",
      version: 1,
      steps: [
        { type: "wait", ms: 1, description: "cancel replay" },
        { type: "wait", ms: 1, description: "should not run" }
      ]
    }, null, 2));

    const result = await service.replayMacro("cancel_macro");
    assert.equal(result.replay.status, "cancelled");
    assert.equal(result.replay.currentStepIndex, 1);
    assert.equal(result.replay.log.length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Teach step target labels convert coordinate clicks into semantic clicks", async () => {
  const root = await tempDir();
  try {
    const service = controller(root);
    service.controlState().teach = {
      id: "teach_target",
      name: "target_macro",
      recording: false,
      status: "editing",
      steps: [
        { type: "click", x: 100, y: 200, xRatio: 0.2, yRatio: 0.3, description: "Click CapCut 20%, 30%" }
      ]
    };

    const result = await service.setTeachStepTarget(0, "Import");
    assert.equal(result.teach.steps[0].description, "Click Import");
    assert.equal(result.teach.steps[0].semanticTarget.label, "Import");
    assert.equal(result.teach.steps[0].semanticTarget.strategy, "operator_label_then_region");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Teach wait steps can edit milliseconds before saving a macro", async () => {
  const root = await tempDir();
  try {
    const service = controller(root);
    service.controlState().teach = {
      id: "teach_wait",
      name: "wait_macro",
      recording: false,
      status: "editing",
      steps: [
        { type: "click", x: 100, y: 200, description: "Click Import" },
        { type: "wait", ms: 3000, description: "Wait 3000ms" }
      ]
    };

    const result = await service.updateTeachStepWait(1, 0);
    assert.equal(result.teach.steps[1].ms, 0);
    assert.equal(result.teach.steps[1].description, "Wait 0ms");
    assert.equal(result.teach.status, "editing");

    const saved = await service.saveTeachMacro("wait_macro");
    const macro = JSON.parse(await fs.readFile(saved.macro.filePath, "utf8"));
    assert.equal(macro.steps[1].ms, 0);
    assert.equal(macro.steps[1].description, "Wait 0ms");

    await assert.rejects(
      () => service.updateTeachStepWait(0, 500),
      /Only wait steps can edit milliseconds/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Macro replay can pause and resume without cancelling the run", async () => {
  const root = await tempDir();
  try {
    const service = controller(root);
    service.controlState().replay = {
      id: "replay_pause",
      macroId: "macro_pause",
      macroName: "Pause Test",
      running: true,
      status: "running",
      currentStepIndex: 2,
      totalSteps: 5,
      log: []
    };
    service.activeReplayId = "replay_pause";

    const paused = await service.pauseReplay("test_pause");
    assert.equal(paused.replay.paused, true);
    assert.equal(paused.replay.pauseRequested, true);
    assert.equal(paused.replay.running, true);

    const resumed = await service.resumeReplay();
    assert.equal(resumed.replay.paused, false);
    assert.equal(resumed.replay.pauseRequested, false);
    assert.equal(resumed.replay.running, true);
    assert.equal(resumed.replay.status, "running");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Macro replay resolves semantic click targets before falling back to stored coordinates", async () => {
  const root = await tempDir();
  try {
    class MockSemanticReplayController extends CapCutController {
      constructor(options) {
        super(options);
        this.clicked = null;
      }
      async activeApp() {
        return "CapCut";
      }
      async currentCapCutAutomationWindow() {
        return { x: 100, y: 100, width: 1000, height: 700, ownerName: "CapCut" };
      }
      async observeScreen() {
        return {
          uiText: "Import",
          screenshot: { filePath: "/tmp/fake-capcut.png", sizeBytes: 1 },
          elements: [
            { source: "accessibility", role: "AXButton", label: "Import", x: 720, y: 310, width: 120, height: 44 }
          ]
        };
      }
      async assertNoDangerousDialog() {}
      async click(x, y) {
        this.clicked = { x, y };
        return { ok: true };
      }
      async status() {
        return { ok: true };
      }
    }
    const service = new MockSemanticReplayController({ config: { capcutMacroDir: path.join(root, "macros") }, state: {}, helpers: { async saveState() {}, addStateLog() {} } });
    await service.executeMacroStep({
      type: "click",
      x: 110,
      y: 110,
      xRatio: 0.01,
      yRatio: 0.01,
      semanticTarget: {
        version: 1,
        label: "Import",
        region: "center_workspace",
        strategy: "semantic_label_then_region"
      },
      description: "Click Import"
    });

    assert.deepEqual(service.clicked, { x: 780, y: 332 });
    assert.equal(service.controlState().actions[0].details.source, "semantic_exact_label");
    assert.equal(service.controlState().actions[0].details.target, "Import");

    service.clicked = null;
    await service.executeMacroStep({
      type: "click",
      x: 110,
      y: 110,
      xRatio: 0.01,
      yRatio: 0.01,
      description: "Click Import"
    });
    assert.deepEqual(service.clicked, { x: 780, y: 332 });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Status exposes permission labels and last error", async () => {
  const root = await tempDir();
  try {
    class MockStatusController extends CapCutController {
      async detectInstall() {
        return { installed: false, appPath: "", appName: "CapCut" };
      }
      async isRunning() {
        return false;
      }
      async activeApp() {
        return "Argentum OS";
      }
      async checkAccessibilityPermission() {
        return { ok: false, message: "" };
      }
      async checkScreenRecordingPermission() {
        return { ok: true, message: "Screen capture succeeded." };
      }
    }
    const service = new MockStatusController({ config: { capcutMacroDir: path.join(root, "macros") }, state: {}, helpers: { async saveState() {}, addStateLog() {} } });
    await service.logAction("openCapCut", "failed", { reason: "CapCut is not installed." });
    const status = await service.status();
    assert.equal(status.installedStatus, "no");
    assert.equal(status.accessibilityStatus, "unknown");
    assert.equal(status.screenRecordingStatus, "yes");
    assert.equal(status.lastError.message, "CapCut is not installed.");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Parked CapCut workspace calculates a fixed side area", async () => {
  const root = await tempDir();
  try {
    const service = controller(root);
    const bounds = service.parkedBoundsForScreen({ x: 0, y: 0, width: 1440, height: 900 }, "compact");
    assert.deepEqual(bounds, {
      x: 992,
      y: 28,
      width: 420,
      height: 720,
      mode: "compact"
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Verification states can return passed, failed, and unknown", async () => {
  const root = await tempDir();
  try {
    class MockVerifyController extends CapCutController {
      constructor(options) {
        super(options);
        this.next = { uiText: "", screenshot: { filePath: "/tmp/fake.png", sizeBytes: 1 }, elements: [] };
      }
      async observeScreen() {
        return this.next;
      }
    }
    const service = new MockVerifyController({ config: { capcutMacroDir: path.join(root, "macros") }, state: {}, helpers: { async saveState() {}, addStateLog() {} } });
    service.next = { uiText: "Canvas 9:16 vertical", screenshot: { filePath: "/tmp/fake.png", sizeBytes: 1 }, elements: [] };
    assert.equal((await service.verifyStep("after_916_canvas")).status, "passed");
    service.next = { uiText: "CapCut editor", screenshot: { filePath: "/tmp/fake.png", sizeBytes: 1 }, elements: [] };
    assert.equal((await service.verifyStep("after_blur_background")).status, "unknown");
    service.next = { uiText: "Permission denied", screenshot: { filePath: "", sizeBytes: 0 }, elements: [] };
    assert.equal((await service.verifyStep("after_blur_background")).status, "failed");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const appSource = fs.readFileSync(
  path.join(process.cwd(), "CLIPPING OFFICE ", "public", "app.js"),
  "utf8"
);

function functionSource(name, nextName) {
  const start = appSource.indexOf(`function ${name}`);
  const end = nextName ? appSource.indexOf(`function ${nextName}`, start + 1) : appSource.length;
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextName} should exist after ${name}`);
  return appSource.slice(start, end);
}

test("edited exports use bounded recorder rates and release media resources on every exit", () => {
  const source = functionSource("exportEditedClip", "readVideoDurationFromObjectUrl");
  const cleanup = source.slice(source.lastIndexOf("} finally {"));

  assert.match(source, /videoBitsPerSecond:\s*4_000_000/);
  assert.match(source, /audioBitsPerSecond:\s*128_000/);
  assert.match(source, /let renderStream = null/);
  assert.match(source, /let sourceAudioStream = null/);
  assert.match(source, /const recorderCompletion = new Promise/);
  assert.match(source, /const recorderFailure = recorderCompletion\.then/);
  assert.match(source, /const renderLoop = new Promise/);
  assert.match(source, /await Promise\.race\(\[sourceVideo\.play\(\), recorderFailure\]\)/);
  assert.match(source, /await Promise\.race\(\[renderLoop, recorderFailure\]\)/);
  assert.match(source, /recorder\.onerror = \(event\) => \{[\s\S]*?failRenderLoop\?\.\(error\)/);
  assert.match(source, /const draw = \(\) => \{[\s\S]*?catch \(error\) \{\s*failRender\(error\)/);
  assert.match(source, /watchdogHandle = window\.setInterval\([\s\S]*?catch \(error\) \{\s*failRender\(error\)/);
  assert.match(source, /try \{\s*cleanup\(\);\s*\} finally \{\s*callback\(\)/);
  assert.match(cleanup, /stopEditorMediaStream\(renderStream\)/);
  assert.match(cleanup, /stopEditorMediaStream\(sourceAudioStream\)/);
  assert.match(cleanup, /recorder\.ondataavailable = null/);
  assert.match(cleanup, /chunks\.length = 0/);
  assert.match(cleanup, /canvas\.width = 1/);
  assert.match(cleanup, /canvas = null/);
  assert.match(cleanup, /sourceVideo\.removeAttribute\("src"\)/);
});

test("sticker previews are active-clip-only, cached by path, and pruned with removed clips", () => {
  const hydrate = functionSource("hydrateEditorStickerImages", "pickEditorSticker");
  const reconcile = functionSource("reconcileEditorWithVisibleClips", "loadSavedEditorBuilderOrder");

  assert.match(appSource, /EDITOR_STICKER_SOURCE_CACHE_LIMIT = 3/);
  assert.match(hydrate, /state\.activeView !== "studio"/);
  assert.match(hydrate, /selectedBuilderClip\(\)/);
  assert.match(hydrate, /readCachedEditorStickerSource\(sticker\.sourcePath\)/);
  assert.doesNotMatch(hydrate, /Promise\.all/);
  assert.match(reconcile, /state\.editor\.stickerPreviews/);
  assert.match(reconcile, /state\.editor\.transcriptChats/);
  assert.match(reconcile, /window\.clearTimeout\(state\.editor\.draftSaveTimers\[clipId\]\)/);
  assert.match(reconcile, /preparationAttemptedClipIds = new Set/);
  assert.match(reconcile, /autoPipelineFailedClipIds = new Set/);
});

test("automation worker owns its lock before activation and polls at a slower cadence", () => {
  const workerInit = functionSource("initializeAutomationWorker", "initializeClippingOffice");
  const workerLock = functionSource("stopAutomationWorkerRuntimeTimers", "formatAutomationTimestamp");
  const ownedRuntime = functionSource("initializeOwnedAutomationWorkerRuntime", "scheduleAutomationWorkerLockRetry");
  const render = functionSource("renderClipsArea", "signalScore");
  const polling = functionSource("startWatchPolling", "pollWatchStateOnce");
  const pollOnce = functionSource("pollWatchStateOnce", "watchStreamer");
  const domReady = appSource.slice(appSource.indexOf('document.addEventListener("DOMContentLoaded"'));
  const workerDomBranch = domReady.slice(0, domReady.indexOf("setArgentumCommandBarCollapsed"));

  assert.match(workerInit, /document\.body\.replaceChildren\(\)/);
  assert.match(workerInit, /api\("\/api\/health"/);
  assert.match(workerInit, /loadServerAutomationSettings\(\)/);
  assert.match(workerInit, /refreshWatchState\(\)/);
  assert.doesNotMatch(workerInit, /loadProviderStatus|loadDiscoveryStreamPage|renderProductionReviewArea/);
  assert.ok(render.indexOf("if (isAutomationWorker)") < render.indexOf("renderProductionReviewArea"));
  assert.match(polling, /isAutomationWorker \? 10000 : 5000/);
  assert.match(pollOnce, /!isAutomationWorker && document\.hidden/);
  assert.ok(domReady.indexOf("if (isAutomationWorker)") < domReady.indexOf("setArgentumCommandBarCollapsed"));
  assert.match(workerDomBranch, /startAutomationWorkerRuntime\(\)/);
  assert.doesNotMatch(workerDomBranch, /initializeAutomationWorker|loadClipOutputFolder|startWatchPolling/);
  assert.match(appSource, /AUTOMATION_WORKER_LOCK_MAX_ATTEMPTS = 8/);
  assert.match(workerLock, /ifAvailable: true/);
  assert.match(workerLock, /automationWorkerLockAttempt >= AUTOMATION_WORKER_LOCK_MAX_ATTEMPTS/);
  assert.match(workerLock, /scheduleAutomationWorkerLockRetry\(\)/);
  assert.match(workerLock, /automationWorkerLockHeld = true;[\s\S]*?await initializeOwnedAutomationWorkerRuntime\(\{ requireLock: true \}\)[\s\S]*?await holdAutomationWorkerLockUntilUnload\(\)/);
  assert.match(workerLock, /!lockManager \|\| typeof lockManager\.request !== "function"[\s\S]*?requireLock: false/);
  assert.doesNotMatch(workerLock, /catch\([^)]*\)\s*=>\s*activateAutomationWorkerRuntime/);
  assert.ok(ownedRuntime.indexOf("!automationWorkerLockHeld") < ownedRuntime.indexOf("startWatchPolling()"));
  assert.ok(ownedRuntime.indexOf("startWatchPolling()") < ownedRuntime.indexOf("activateAutomationWorkerRuntime()"));
  assert.match(appSource, /isAutomationWorker && !automationWorkerRuntimeStarted/);
});

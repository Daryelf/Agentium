import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function api(base, route, options = {}) {
  const response = await fetch(`${base}${route}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`${route} failed: ${response.status} ${json.error || response.statusText}`);
    error.status = response.status;
    error.body = json;
    throw error;
  }
  return json;
}

async function expectApiError(base, route, options, expectedStatus, message) {
  try {
    await api(base, route, options);
  } catch (error) {
    assert(error.status === expectedStatus, `${message}: expected ${expectedStatus}, got ${error.status || "no status"}`);
    return error.body;
  }
  throw new Error(`${message}: expected request to fail`);
}

// ---------------------------------------------------------------------------
// Determinism unit checks (WI-1..4) — no CapCut, no server, pure fixtures.
// ---------------------------------------------------------------------------

const {
  clampReplayWait,
  pollCondition,
  compileMacroForDeterminism,
  validateStagedClip,
  stagingPathFor,
  REPLAY_WAIT_FLOOR_MS,
  REPLAY_WAIT_CAP_MS
} = await import("../services/capcut-determinism.js");

// WI-2: recorded human pauses clamp to machine-sized waits at execution time.
assert(clampReplayWait(0) === 0, "zero wait stays zero");
assert(clampReplayWait(90) === REPLAY_WAIT_FLOOR_MS, "tiny waits rise to the floor");
assert(clampReplayWait(800) === 800, "reasonable waits replay unchanged");
assert(clampReplayWait(30000) === REPLAY_WAIT_CAP_MS, "recorded think-time caps at the ceiling");

// WI-2: pollCondition honors abort between polls (emergency stop path).
{
  let polls = 0;
  const result = await pollCondition({
    check: async () => { polls += 1; return false; },
    timeoutMs: 5000,
    pollMs: 10,
    shouldAbort: async () => polls >= 2
  });
  assert(result.aborted === true && result.passed === false, "pollCondition must abort when cancel is requested");
  assert(polls <= 3, "pollCondition must stop polling promptly after abort");
}
{
  const result = await pollCondition({ check: async () => ({ status: "passed" }), timeoutMs: 1000, pollMs: 10 });
  assert(result.passed === true, "pollCondition accepts verificationResult-shaped passes");
}

// WI-3/WI-4: compile pass rewrites sticker drags to typed values, keeps every
// recorded step, and marks content-dependent anchors unreliable.
{
  const fixtureMacro = {
    id: "capcut_macro_fixture",
    name: "fixture",
    steps: [
      { type: "click", phaseId: "choose_clip", xRatio: 0.3, yRatio: 0.4, description: "click clip thumbnail" },
      { type: "click", phaseId: "choose_clip", xRatio: 0.32, yRatio: 0.42, semanticTarget: { label: "Add to track" }, description: "add to track" },
      { type: "click", phaseId: "canvas_916", xRatio: 0.5, yRatio: 0.7, description: "ratio 9:16" },
      { type: "drag", phaseId: "bottom_sticker", fromXRatio: 0.85, fromYRatio: 0.4, toXRatio: 0.8, toYRatio: 0.4, description: "scale slider" },
      { type: "drag", phaseId: "bottom_sticker", fromXRatio: 0.5, fromYRatio: 0.3, toXRatio: 0.5, toYRatio: 0.5, description: "drag sticker in preview" },
      { type: "drag", phaseId: "bottom_sticker", fromXRatio: 0.4, fromYRatio: 0.8, toXRatio: 0.6, toYRatio: 0.8, description: "extend sticker to clip end" }
    ]
  };
  const { macro: compiled } = compileMacroForDeterminism(fixtureMacro);
  assert(compiled.steps.length === fixtureMacro.steps.length, "compile pass must never remove recorded steps");
  assert(compiled.steps[0].anchorUnreliable === true, "clip thumbnail click must be marked anchorUnreliable");
  assert(!compiled.steps[1].anchorUnreliable, "stable Add-to-track click must keep its anchor");
  assert(compiled.steps[3].typedReplacement?.field === "scale" && compiled.steps[3].typedReplacement.value === "35",
    "scale slider drag must compile to typed 35");
  assert(compiled.steps[4].typedReplacement?.field === "position"
    && compiled.steps[4].typedReplacement.x === "0" && compiled.steps[4].typedReplacement.y === "-1745",
    "preview position drag must compile to typed 0/-1745");
  assert(compiled.steps[5].dragKind === "timeline" && compiled.steps[5].supersededBy === "timeline_geometry",
    "timeline drag must be parameterized from live geometry");
  assert(compiled.determinismCompiledAt, "compile pass must stamp determinismCompiledAt");
  const { macro: recompiled } = compileMacroForDeterminism(compiled);
  assert(recompiled.determinismChanges.length === 0, "compile pass must be idempotent");
}

// WI-4: staged-clip validation refuses bad inputs.
assert(validateStagedClip({ filePath: "/x/NEXT_CLIP.mp4", sizeBytes: 1024 }).ok === true, "valid staged clip accepted");
assert(validateStagedClip({ filePath: "/x/NEXT_CLIP.mov", sizeBytes: 1024 }).ok === false, "non-mp4 rejected");
assert(validateStagedClip({ filePath: "/x/NEXT_CLIP.mp4", sizeBytes: 0 }).ok === false, "empty file rejected");
assert(stagingPathFor("/tmp/Clips").endsWith(path.join("_staging", "NEXT_CLIP.mp4")), "staging path is fixed");

// WI-1: a failed phase gate must NEVER let the next phase run.
{
  const gateDir = await mkdtemp(path.join(os.tmpdir(), "argentum-capcut-gate-"));
  const { createCapCutController } = await import("../services/capcut-controller.js");
  const controller = createCapCutController({
    config: { capcutMacroDir: path.join(gateDir, "macros") },
    state: {},
    helpers: { newId: (prefix) => `${prefix}_${Math.random().toString(16).slice(2, 8)}` }
  });
  const executed = [];
  controller.focusCapCut = async () => ({});
  controller.normalizeCapCutWindow = async () => null;
  controller.startReplayEmergencyListener = async () => {};
  controller.stopReplayEmergencyListener = () => {};
  controller.takeMacroScreenshot = async () => null;
  controller.writeRunReport = async () => {};
  controller.executeMacroStepWithRetry = async (step) => { executed.push(step.description); };
  controller.runPhaseVerification = async (phaseId) => ({
    name: `verify_${phaseId}`,
    status: phaseId === "canvas_916" ? "failed" : "passed",
    passed: phaseId !== "canvas_916"
  });
  // A failed gate pauses for the operator; auto-cancel instead of hanging.
  controller.waitForReplayResume = async (replay) => !(replay?.pauseRequested);
  const gateMacro = {
    id: "gate_fixture",
    name: "gate fixture",
    steps: [
      { type: "click", phaseId: "canvas_916", x: 1, y: 1, description: "set 9:16" },
      { type: "click", phaseId: "blur_background", x: 2, y: 2, description: "enable blur" }
    ]
  };
  let gateError = null;
  try {
    await controller.replayPreparedMacro(gateMacro, gateMacro.steps.map((step) => ({ ...step })));
  } catch (error) {
    gateError = error;
  }
  assert(gateError, "failed phase gate must abort the replay");
  assert(/canvas_916/.test(gateError.message), "gate error must name the failed phase");
  assert(!executed.some((description) => description === "enable blur"),
    "steps of the next phase must never run after a failed gate");
  const replayState = controller.controlState().replay;
  assert(replayState.gates.some((gate) => gate.phaseId === "canvas_916" && gate.status === "failed"),
    "failed gate must be recorded in replay state");
  await rm(gateDir, { recursive: true, force: true });
}

console.log("CapCut determinism unit checks passed");

const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "argentum-capcut-agent-smoke-"));
process.env.CLIPPING_OFFICE_DATA_DIR = runtimeDir;
process.env.AGENT101_OUTPUT_DIR = "./outputs";
process.env.CLIPPER_OUTPUT_DIR = "./outputs";
process.env.CLIPPER_UPLOAD_DIR = "./uploads";
process.env.BROWSER_ENABLED = "true";
process.env.BROWSER_HEADLESS = "true";
process.env.CAPCUT_AGENT_DRY_RUN = "true";
process.env.ENABLE_SYNTHETIC_TEST_FIXTURES = "true";
process.env.CAPCUT_DOWNLOAD_DIR = "./capcut-downloads";
process.env.ANTHROPIC_API_KEY = "";
process.env.OPENAI_API_KEY = "";
process.env.AI_PROVIDER = "local_demo";
process.env.AI_MODE = "demo";

const { handleRequest } = await import("../server.js");
const server = http.createServer(handleRequest);

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

try {
  console.log(`CapCut Agent smoke target: ${base}`);

  const status = await api(base, "/api/capcut/status");
  assert(status.agentReady === true, "CapCut Agent should report desktop readiness in dry-run mode");
  assert(status.mode === "desktop_app", "CapCut Agent should use the native desktop app path");
  assert(status.downloadDirConfigured === true, "CapCut download directory status should be exposed");

  const seeded = await api(base, "/api/demo/seed", { method: "POST", body: JSON.stringify({}) });
  assert(seeded.seeded?.projectId, "demo seed should create the practice project");

  const projectPayload = await api(base, "/api/clipping-office/project");
  const project = projectPayload.project;
  const candidate = projectPayload.candidates.find((item) => item.id === project.selectedCandidateId)
    || projectPayload.candidates[0];
  assert(project?.id, "practice project should exist");
  assert(candidate?.id, "practice candidate should exist");

  const rendered = await api(base, `/api/clip-projects/${encodeURIComponent(project.id)}/render`, {
    method: "POST",
    body: JSON.stringify({
      candidateId: candidate.id,
      sourceId: candidate.sourceId,
      startSeconds: candidate.timestampStartSeconds,
      endSeconds: candidate.timestampEndSeconds
    })
  });
  assert(rendered.artifact?.id, "render should create an artifact");
  assert(rendered.artifact.type === "rendered_clip", "render artifact should be a rendered clip");
  assert(rendered.artifact.content?.probeStatus === "passed", "render artifact should pass FFprobe verification");
  assert(rendered.artifact.content?.sha256, "render artifact should include a checksum");

  await expectApiError(base, "/api/capcut/edit", {
    method: "POST",
    body: JSON.stringify({
      clip_id: candidate.id,
      rendered_artifact_id: rendered.artifact.id,
      edit_spec: { aspect_ratio: "9:16", platform_target: "tiktok", captions: { enabled: true } }
    })
  }, 409, "practice media must be explicitly confirmed");

  const editRun = await api(base, "/api/capcut/edit", {
    method: "POST",
    body: JSON.stringify({
      clip_id: candidate.id,
      rendered_artifact_id: rendered.artifact.id,
      practice_confirmed: true,
      edit_spec: { aspect_ratio: "9:16", platform_target: "tiktok", captions: { enabled: true } }
    })
  });
  assert(editRun.requiresApproval === false, "CapCut desktop edit should not require Human Gate approval");
  assert(editRun.approvalType === "", "CapCut desktop edit should not create an export approval gate");
  assert(editRun.approvalRequest === null, "CapCut desktop edit should not include an approval request");
  assert(editRun.session?.sessionId, "desktop edit should create a CapCut Agent session");
  assert(editRun.session.status === "operator_review", "desktop edit should end in operator review");
  assert(editRun.session.exportReady === true, "dry-run staging should mark local review ready");
  assert(editRun.session.exportApprovalId === "", "desktop edit should not store an export approval id");
  assert(editRun.session.completedPhases.includes("upload_clip"), "dry-run staging should include upload phase");
  assert(editRun.session.completedPhases.includes("preview"), "dry-run staging should include preview phase");
  assert(editRun.exportResult.downloaded === false, "CapCut Agent must not download/export automatically");
  assert(editRun.postingDraftCreated === false, "CapCut Agent must not create posting drafts from unverified downloads");

  const sessions = await api(base, "/api/capcut/sessions");
  assert(sessions.sessions.some((session) => session.sessionId === editRun.session.sessionId), "CapCut session should persist");

  console.log("CapCut Agent smoke passed");
} finally {
  await closeServer(server);
  await rm(runtimeDir, { recursive: true, force: true });
}

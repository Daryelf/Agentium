import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import ffmpegStatic from "ffmpeg-static";

const execFileAsync = promisify(execFile);

async function openPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function waitForServer(baseUrl, child) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Isolated Clipping Office exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Isolated Clipping Office did not become ready.");
}

async function responseJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.message || `${response.status} ${response.statusText}`);
  return body;
}

async function createVideoFixtures(root) {
  const sourcePath = path.join(root, "source-with-audio.mp4");
  const renderPath = path.join(root, "browser-live-render.webm");
  await execFileAsync(ffmpegStatic, [
    "-y",
    "-f", "lavfi",
    "-i", "color=c=0x285b82:s=320x180:d=1",
    "-f", "lavfi",
    "-i", "sine=frequency=640:duration=1",
    "-shortest",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    sourcePath
  ], { timeout: 60000 });
  await execFileAsync(ffmpegStatic, [
    "-y",
    "-f", "lavfi",
    "-i", "color=c=0x1f9d6a:s=270x480:d=3",
    "-f", "lavfi",
    "-i", "sine=frequency=720:duration=3",
    "-shortest",
    "-c:v", "libvpx",
    "-deadline", "realtime",
    "-cpu-used", "8",
    "-c:a", "libopus",
    "-f", "webm",
    "-live", "1",
    renderPath
  ], { timeout: 60000 });
  return { sourcePath, renderPath };
}

function completeEditorState(durationSeconds = 1) {
  return {
    videoLayout: {
      canvas: { width: 1080, height: 1920, aspectRatio: "9:16" },
      subjectFrame: { width: 1080, height: 1440, aspectRatio: "3:4" },
      background: { mode: "edge_fill", source: "video", blur: 18, opacity: 0.82 }
    },
    background: { mode: "edge_fill", source: "video", blur: 18, opacity: 0.82 },
    autoReframe: {
      mode: "motion_follow_3_4_inside_9_16",
      keyframes: [{ timeSeconds: 0, focusXPercent: 50 }, { timeSeconds: durationSeconds, focusXPercent: 58 }]
    },
    sticker: { enabled: true, type: "text", label: "Argentum", xPercent: 50, yPercent: 84, sizePercent: 24 },
    captions: {
      enabled: true,
      source: "caption_intelligence_model",
      transcript: "The creator lands the verified vertical edit and reacts to the result.",
      segments: [{ text: "Verified vertical edit", startSeconds: 0, endSeconds: durationSeconds }],
      evidence: {
        automaticCaptionRequestHash: "integration-auto-message-hash",
        generationStatus: "complete"
      },
      style: { xPercent: 50, yPercent: 18, maxWords: 9, theme: "story" }
    },
    timeline: {
      durationSeconds,
      selectedLayerId: "video",
      layers: ["video", "reframe", "captions", "sticker"].map((id) => ({ id, startSeconds: 0, endSeconds: durationSeconds }))
    },
    previewControls: "external",
    updatedAt: new Date().toISOString()
  };
}

test("persisted editor render moves automatically through Precheck, local Library save, and stale-edit invalidation", { timeout: 120000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "argentum-production-flow-"));
  const runtimeDir = path.join(root, "runtime");
  const port = await openPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverOutput = [];
  const child = spawn(process.execPath, [path.resolve("CLIPPING OFFICE /server.js")], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      CLIPPING_OFFICE_DATA_DIR: runtimeDir,
      STREAMCLIPPER_CAPTURE_ENABLED: "false",
      STREAMCLIPPER_AUTO_INSTALL_CAPTURE_TOOLS: "false",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => serverOutput.push(String(chunk)));
  child.stderr.on("data", (chunk) => serverOutput.push(String(chunk)));

  try {
    const { sourcePath, renderPath } = await createVideoFixtures(root);
    await waitForServer(baseUrl, child);

    const uploadForm = new FormData();
    uploadForm.append("file", new Blob([await fs.readFile(sourcePath)], { type: "video/mp4" }), "source-with-audio.mp4");
    uploadForm.append("title", "Production integration clip");
    uploadForm.append("permissionStatus", "uploaded");
    uploadForm.append("rightsStatus", "operator_review_required");
    const uploaded = await responseJson(await fetch(`${baseUrl}/api/media/sources/upload`, { method: "POST", body: uploadForm }));
    const candidateId = uploaded.candidate.id;

    const approved = await responseJson(await fetch(`${baseUrl}/api/clips/candidates/${candidateId}/approve-builder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    }));
    assert.equal(approved.candidate.builderApproved, true);

    await responseJson(await fetch(`${baseUrl}/api/clips/candidates/score`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: candidateId,
        updates: {
          transcriptStatus: "transcribed",
          transcriptSnippet: "The creator lands the verified vertical edit and reacts to the result.",
          transcriptSummary: {
            text: "The creator lands the verified vertical edit and reacts to the result.",
            usableForCaption: true,
            fullClipProcessed: true
          },
          editorFrameCapture: {
            frames: [
              { position: "first", timestampSeconds: 0 },
              { position: "middle", timestampSeconds: 0.5 },
              { position: "ending", timestampSeconds: 1 }
            ]
          },
          editorFrameAnalysis: {
            observations: ["The creator completes the edit and reacts to the finished result."]
          },
          captionGeneration: {
            status: "complete",
            automaticCaptionRequestHash: "integration-auto-message-hash"
          }
        }
      })
    }));

    const editorState = completeEditorState(1);
    await responseJson(await fetch(`${baseUrl}/api/clips/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidateId, format: "9:16", resolution: "1080x1920", duration: 1, editorState })
    }));

    const renderForm = new FormData();
    renderForm.append("file", new Blob([await fs.readFile(renderPath)], { type: "video/webm" }), "browser-live-render.webm");
    renderForm.append("editorState", JSON.stringify(editorState));
    const queued = await responseJson(await fetch(`${baseUrl}/api/clips/candidates/${candidateId}/editor-export`, {
      method: "POST",
      body: renderForm
    }));
    assert.equal(queued.candidate.productionWorkflow.stage, "precheck");
    assert.equal(queued.readiness.ready, true);
    assert.equal(queued.artifact.content.width, 1080);
    assert.equal(queued.artifact.content.height, 1920);
    assert.equal(queued.artifact.content.frameRate, 30);
    assert.equal(queued.artifact.content.hasAudio, true);
    assert.ok(Math.abs(queued.artifact.content.durationSeconds - 1) <= 0.25);

    const playback = await fetch(`${baseUrl}${queued.candidate.productionWorkflow.playbackUrl}`);
    assert.equal(playback.ok, true);
    assert.match(playback.headers.get("content-type") || "", /video\/mp4/);
    const playbackBytes = Buffer.from(await playback.arrayBuffer());
    assert.ok(playbackBytes.length > 0);

    const productReady = await responseJson(await fetch(`${baseUrl}/api/clips/candidates/${candidateId}/product-ready`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", approvedBy: "automatic_pipeline" })
    }));
    assert.equal(productReady.candidate.productionWorkflow.stage, "product_ready");
    assert.equal(productReady.candidate.productionWorkflow.postingStatus, "not_posted");
    assert.equal(productReady.candidate.productionWorkflow.approval.approvedBy, "automatic_pipeline");

    const localLibraryPath = path.join(root, "finished-library-clip.mp4");
    await fs.writeFile(localLibraryPath, playbackBytes);
    const localSave = await responseJson(await fetch(`${baseUrl}/api/clips/candidates/${candidateId}/local-save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: localLibraryPath })
    }));
    assert.equal(localSave.saved, true);
    assert.equal(localSave.candidate.productionWorkflow.localLibraryPath, localLibraryPath);
    assert.equal(localSave.candidate.productionWorkflow.localLibraryFileSizeBytes, playbackBytes.length);

    const changedState = structuredClone(editorState);
    changedState.sticker.yPercent = 90;
    const stale = await responseJson(await fetch(`${baseUrl}/api/clips/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidateId, format: "9:16", resolution: "1080x1920", duration: 1, editorState: changedState })
    }));
    assert.equal(stale.candidate.productionWorkflow.stage, "editing");
    assert.equal(stale.candidate.productionWorkflow.invalidationReason, "editor_changed_after_export");
    assert.equal(stale.candidate.productReadyAt, null);

    const staleApproval = await fetch(`${baseUrl}/api/clips/candidates/${candidateId}/product-ready`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" })
    });
    assert.equal(staleApproval.status, 409);
  } catch (error) {
    error.message = `${error.message}\nIsolated server output:\n${serverOutput.join("").slice(-4000)}`;
    throw error;
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 3000).unref();
    });
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("startup returns generic metadata captions to Studio without deleting the prior output", { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "argentum-caption-repair-"));
  const runtimeDir = path.join(root, "runtime");
  const port = await openPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let child = null;
  try {
    await fs.mkdir(runtimeDir, { recursive: true });
    await fs.writeFile(path.join(runtimeDir, "state.json"), JSON.stringify({
      clipCandidates: [{
        id: "candidate_generic_caption",
        title: "30s clip window 1: Creator",
        status: "product_ready",
        productReadyAt: "2026-07-16T12:00:00.000Z",
        renderedArtifactId: "artifact_previous",
        builderDraft: {
          duration: 30,
          editorState: {
            captions: {
              enabled: true,
              source: "verified_clip_metadata",
              transcript: "",
              segments: [{ id: "caption-hook", startSeconds: 0, endSeconds: 30, text: "30s clip window 1: Creator" }]
            }
          }
        },
        productionWorkflow: {
          stage: "product_ready",
          status: "approved",
          playbackUrl: "/outputs/old-render.mp4",
          localLibraryPath: "/tmp/old-render.mp4",
          approval: { status: "approved", approvedBy: "automatic_pipeline" }
        }
      }]
    }, null, 2));
    child = spawn(process.execPath, [path.resolve("CLIPPING OFFICE /server.js")], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        CLIPPING_OFFICE_DATA_DIR: runtimeDir,
        STREAMCLIPPER_CAPTURE_ENABLED: "false",
        STREAMCLIPPER_AUTO_INSTALL_CAPTURE_TOOLS: "false",
        OPENAI_API_KEY: "",
        ANTHROPIC_API_KEY: ""
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    await waitForServer(baseUrl, child);

    const payload = await responseJson(await fetch(`${baseUrl}/api/clips/candidates`));
    const candidate = payload.candidates.find((item) => item.id === "candidate_generic_caption");
    assert.ok(candidate);
    assert.equal(candidate.status, "in_builder");
    assert.equal(candidate.productionWorkflow.stage, "editing");
    assert.equal(candidate.productionWorkflow.invalidationReason, "generic_caption_blocked");
    assert.equal(candidate.builderDraft.editorState.captions.enabled, false);
    assert.equal(candidate.builderDraft.editorState.captions.source, "caption_evidence_required");
    assert.deepEqual(candidate.builderDraft.editorState.captions.segments, []);
    assert.equal(candidate.captionRepair.preservedOutputPath, "/tmp/old-render.mp4");
    assert.equal(candidate.captionGeneration.status, "waiting_for_evidence");
  } finally {
    if (child) {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", resolve);
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 3000).unref();
      });
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});

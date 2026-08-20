import assert from "node:assert/strict";
import test from "node:test";
import { runVisionGate, visionFrameTimestamps } from "../CLIPPING OFFICE /services/vision-gate.js";

test("vision timestamps span the full clip instead of only its opening frames", () => {
  assert.deepEqual(visionFrameTimestamps(30, 5), [0.5, 7.75, 15, 22.25, 29.5]);
});

test("default vision sampling reads a denser chronology", () => {
  const timestamps = visionFrameTimestamps(60);
  assert.equal(timestamps.length, 9);
  assert.equal(timestamps[0], 0.5);
  assert.equal(timestamps.at(-1), 59.5);
});

test("missing media fails closed instead of defaulting to pass", async () => {
  const result = await runVisionGate("/tmp/argentum-file-that-does-not-exist.mp4", "ffmpeg", {
    openaiApiKey: "",
    anthropicApiKey: ""
  });

  assert.equal(result.shouldClip, false);
  assert.equal(result.skipped, true);
  assert.equal(result.analysisStatus, "unavailable");
});

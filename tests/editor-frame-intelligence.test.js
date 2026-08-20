import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLocalEditorFrameAnalysis,
  buildEditorFrameAnalysisPrompt,
  editorFrameTimestamps,
  normalizeEditorFrameAnalysis
} from "../CLIPPING OFFICE /services/editor-frame-intelligence.js";

test("editor frame timestamps cover the beginning, middle, and ending of the clip", () => {
  const frames = editorFrameTimestamps(30);
  assert.deepEqual(frames.map((frame) => frame.position), ["first", "middle", "ending"]);
  assert.equal(frames[0].timestampSeconds, 0.5);
  assert.equal(frames[1].timestampSeconds, 15);
  assert.equal(frames[2].timestampSeconds, 29.5);
});

test("short clips keep all frame timestamps inside the real duration", () => {
  const frames = editorFrameTimestamps(2);
  assert.deepEqual(frames.map((frame) => frame.timestampSeconds), [0.16, 1, 1.84]);
  assert.ok(frames.every((frame) => frame.timestampSeconds >= 0 && frame.timestampSeconds <= 2));
});

test("frame analysis prompt includes full transcript and evidence-only guardrails", () => {
  const prompt = buildEditorFrameAnalysisPrompt({
    candidate: { streamerName: "KaiCenat", title: "Room challenge", category: "IRL", durationSeconds: 30 },
    transcript: "They waited all that time and can only use it for twenty minutes.",
    frames: editorFrameTimestamps(30)
  });
  assert.match(prompt, /first, middle, and ending frames/i);
  assert.match(prompt, /They waited all that time/);
  assert.match(prompt, /do not invent/i);
  assert.match(prompt, /Do not write the final caption/i);
});

test("frame analysis storage excludes base64 image payloads", () => {
  const normalized = normalizeEditorFrameAnalysis({
    visual_story: "The speaker moves from waiting to visible disappointment.",
    observations: ["First frame shows a line", "Middle frame shows the speaker", "Ending frame shows a reaction"],
    visible_people: ["speaker"],
    confirmed_actions: ["speaker reacts"],
    uncertainties: []
  }, editorFrameTimestamps(30).map((frame) => ({ ...frame, byteLength: 1024, base64: "secret-image-data" })));
  assert.equal(normalized.frames.length, 3);
  assert.equal("base64" in normalized.frames[0], false);
  assert.match(normalized.visualStory, /visible disappointment/);
});

test("local frame fallback preserves evidence without inventing visual details", () => {
  const frames = editorFrameTimestamps(30);
  const result = buildLocalEditorFrameAnalysis({
    candidate: {
      streamerName: "KanelJoseph",
      visionGate: {
        analysisStatus: "completed",
        skipped: false,
        momentDescription: "Kanel enters a dorm room carrying a large green bag."
      }
    },
    transcript: "Chat, we are going ding dong ditch tonight.",
    frames,
    cloudError: "quota exceeded"
  });

  assert.equal(result.model, "verified-frame-sequence-local-v1");
  assert.equal(result.analysisStatus, "local_fallback");
  assert.equal(result.semanticEvidence, true);
  assert.match(result.visualStory, /enters a dorm room/i);
  assert.ok(result.observations.some((item) => /no unsupported action or identity was inferred locally/i.test(item)));
  assert.ok(result.uncertainties.some((item) => /Cloud semantic vision was unavailable/i.test(item)));
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFullClipWindows,
  mergeFullClipWindowResults,
  normalizeTranscriptPayload,
  normalizeWhisperCppPayload,
  scoreTranscript,
  selectBestTranscriptPass
} from "../CLIPPING OFFICE /services/whisper-service.js";

test("transcription payload keeps full text, timing, speaker, and confidence", () => {
  const payload = normalizeTranscriptPayload({
    text: "Kai notices the play and tells chat to wait",
    language: "en",
    duration: 8.4,
    logprobs: [{ logprob: -0.1 }, { logprob: -0.2 }],
    segments: [
      { id: 1, start: 0.24, end: 2.18, text: "Kai notices the play" },
      { id: 2, start: 2.4, end: 4.9, text: "and tells chat to wait", speaker: "speaker_0" },
      { id: 3, start: 9, end: 8, text: "discarded" }
    ]
  });

  assert.equal(payload.text, "Kai notices the play and tells chat to wait");
  assert.equal(payload.language, "en");
  assert.equal(payload.duration, 8.4);
  assert.equal(payload.segments.length, 2);
  assert.deepEqual(payload.segments[1], {
    id: "2",
    start: 2.4,
    end: 4.9,
    text: "and tells chat to wait",
    speaker: "speaker_0"
  });
  assert.ok(payload.confidence > 0.7 && payload.confidence < 1);
});

test("whisper.cpp JSON becomes a complete timed transcript", () => {
  const payload = normalizeWhisperCppPayload({
    result: { language: "en" },
    transcription: [
      {
        timestamps: { from: "00:00:00,000", to: "00:00:02,400" },
        offsets: { from: 0, to: 2400 },
        text: " Chat, it is time.",
        tokens: [{ text: " Chat", p: 0.92 }, { text: " time", p: 0.88 }]
      },
      {
        timestamps: { from: "00:00:02,400", to: "00:00:05,100" },
        offsets: { from: 2400, to: 5100 },
        text: " We are going ding dong ditch tonight.",
        tokens: [{ text: " going", p: 0.9 }, { text: " tonight", p: 0.86 }]
      }
    ]
  });

  assert.equal(payload.text, "Chat, it is time. We are going ding dong ditch tonight.");
  assert.equal(payload.language, "en");
  assert.equal(payload.duration, 5.1);
  assert.equal(payload.segments.length, 2);
  assert.equal(payload.segments[1].start, 2.4);
  assert.ok(payload.confidence > 0.85);
});

test("transcript quality scoring reports usable evidence instead of only hype keywords", () => {
  const score = scoreTranscript({
    text: "No way bro, that was a clean clutch play",
    provider: "openai:gpt-4o-transcribe",
    confidence: 0.92,
    segments: [{ start: 1, end: 4, text: "No way bro, that was a clean clutch play" }]
  });

  assert.equal(score.wordCount, 9);
  assert.equal(score.segmentCount, 1);
  assert.ok(score.qualityScore >= 80);
  assert.ok(score.detectedKeywords.includes("no way"));
});

test("dual-pass transcription keeps the fuller timed transcript when the primary pass is partial", () => {
  const selected = selectBestTranscriptPass({
    available: true,
    text: "Is your game frozen? What happened?",
    provider: "openai:gpt-4o-transcribe",
    model: "gpt-4o-transcribe"
  }, {
    available: true,
    text: "Is your game frozen what happened no I am fixing it did you die do you want me to take control I will watch you",
    provider: "openai:whisper-1",
    model: "whisper-1"
  }, { durationSeconds: 30 });

  assert.equal(selected.recoveredFromPartial, true);
  assert.equal(selected.provider, "openai:whisper-1");
  assert.ok(selected.text.includes("take control"));
  assert.ok(selected.timingWordCount > selected.primaryWordCount);
});

test("transcript quality rejects text that omits most timed speech", () => {
  const score = scoreTranscript({
    text: "Is your game frozen? What happened?",
    provider: "openai:gpt-4o-transcribe",
    confidence: 0.95,
    fullClipProcessed: true,
    processedCoverageRatio: 1,
    segments: [
      { start: 0, end: 4, text: "It is okay baby" },
      { start: 12, end: 19, text: "Is your game frozen what happened no I am fixing it" },
      { start: 23, end: 30, text: "Do you want me to take control I will watch you" }
    ]
  }, { durationSeconds: 30 });

  assert.equal(score.usableForCaption, false);
  assert.equal(score.qualityIssue, "transcript_text_did_not_cover_timed_speech");
  assert.ok(score.qualityScore < 80);
});

test("recovered dual-pass transcript does not treat missing timing confidence as zero", () => {
  const text = "It is okay baby is your game frozen what happened no I am fixing it did you die do you want me to take control I will watch you";
  const score = scoreTranscript({
    text,
    provider: "openai:gpt-4o-transcribe",
    confidence: null,
    recoveredFromPartial: true,
    fullClipProcessed: true,
    processedCoverageRatio: 1,
    segments: [{ start: 0, end: 29.7, text }]
  }, { durationSeconds: 30 });

  assert.equal(score.usableForCaption, true);
  assert.ok(score.qualityScore >= 85);
});

test("full clip windows cover every second with overlap only at capture boundaries", () => {
  const windows = buildFullClipWindows(30, 10, 0.75);
  assert.equal(windows.length, 3);
  assert.deepEqual(windows.map(({ acceptStart, acceptEnd }) => [acceptStart, acceptEnd]), [
    [0, 10],
    [10, 20],
    [20, 30]
  ]);
  assert.equal(windows[1].captureStart, 9.25);
  assert.equal(windows[1].captureEnd, 20.75);
  const fractionalDuration = buildFullClipWindows(30.067, 10, 0.75);
  assert.equal(fractionalDuration.length, 3);
  assert.equal(fractionalDuration[2].acceptEnd, 30.067);
});

test("full clip merge keeps one timestamped transcript across all accepted windows", () => {
  const windows = buildFullClipWindows(30, 10, 0.75);
  const merged = mergeFullClipWindowResults(windows, [
    { processed: true, text: "first line", segments: [{ id: 1, start: 1, end: 3, text: "first line" }] },
    { processed: true, text: "second line", segments: [{ id: 2, start: 2, end: 4, text: "second line" }] },
    { processed: true, text: "third line", segments: [{ id: 3, start: 2, end: 4, text: "third line" }] }
  ]);
  assert.equal(merged.text, "first line second line third line");
  assert.deepEqual(merged.segments.map((segment) => segment.start), [1, 11.25, 21.25]);
  assert.ok(merged.diagnostics.every((window) => window.processed));
});

test("caption gate rejects a partial transcription even when it contains words", () => {
  const score = scoreTranscript({
    text: "Yeah I am inside a fortress",
    segments: [{ start: 25, end: 28, text: "Yeah I am inside a fortress" }],
    fullClipProcessed: false,
    processedCoverageRatio: 0.33
  }, { durationSeconds: 30 });
  assert.equal(score.usableForCaption, false);
  assert.equal(score.qualityIssue, "full_clip_audio_not_processed");
});

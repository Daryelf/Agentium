import assert from "node:assert/strict";
import test from "node:test";
import { recommendTranscriptClipBoundaries } from "../CLIPPING OFFICE /services/clip-moment-intelligence.js";

test("transcript boundaries retain setup before a human-interest reveal", () => {
  const result = recommendTranscriptClipBoundaries({
    segments: [
      { start: 0, end: 8, text: "Let me tell you what happened with Maya and that contract." },
      { start: 8, end: 18, text: "I asked her about it because the price suddenly changed." },
      { start: 18, end: 28, text: "Then Maya admitted the leaked messages were real and showed the receipts." },
      { start: 28, end: 35, text: "I was speechless when everyone found out." }
    ]
  }, { durationSeconds: 40 });

  assert.equal(result.source, "timed_transcript_human_interest");
  assert.ok(result.startSeconds <= 8);
  assert.ok(result.endSeconds >= 31);
  assert.ok(result.endSeconds - result.startSeconds <= 60);
});

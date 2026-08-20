import assert from "node:assert/strict";
import test from "node:test";
import { scoreMediaSignals } from "../CLIPPING OFFICE /services/media-signal-detector.js";

test("media detector approves a complete silent-chat moment with visual corroboration", () => {
  const result = scoreMediaSignals({
    audioEnergy: { isLoudMoment: true, isVoiceExcited: true, maxVolumeDb: -3.2 },
    transcriptScore: 18,
    transcriptSummary: {
      text: "I tried to jump the wall, missed twice, and finally clutched the round at the last second. No way.",
      qualityScore: 94,
      usableForCaption: true,
      fullClipProcessed: true
    },
    visionGate: {
      skipped: false,
      shouldClip: true,
      compositeScore: 84,
      narrativeScore: 8,
      payoffScore: 8,
      contextScore: 7,
      clipType: "clutch"
    }
  });

  assert.equal(result.chatRequired, false);
  assert.equal(result.chatIsTriggerOnly, true);
  assert.equal(result.strong, true);
  assert.equal(result.contentStrong, true);
  assert.equal(result.corroborated, true);
  assert.ok(result.score >= result.minimumScore);
});

test("strong full-clip speech plus excited audio can pass when visual AI is unavailable", () => {
  const result = scoreMediaSignals({
    audioEnergy: { isLoudMoment: true, isVoiceExcited: true, maxVolumeDb: -4.1 },
    transcriptScore: 20,
    transcriptSummary: {
      text: "The dealer told me the car was twenty five thousand dollars, then changed the price, so I refused to pay and walked away. No way.",
      qualityScore: 96,
      usableForCaption: true,
      fullClipProcessed: true
    },
    visionGate: { skipped: true, shouldClip: false, reason: "Provider unavailable" }
  });

  assert.equal(result.transcript.moment.strong, true);
  assert.equal(result.vision.available, false);
  assert.equal(result.strong, true);
});

test("chat hype and loud audio cannot admit an ordinary window", () => {
  const result = scoreMediaSignals({
    watchWindowSignals: { hasSpikeSignal: true, hasKeywordSignal: true },
    audioEnergy: { isLoudMoment: true, isVoiceExcited: true, maxVolumeDb: -2 },
    transcriptScore: 18,
    transcriptSummary: {
      text: "holy shit wow bro poggers",
      qualityScore: 94,
      usableForCaption: true,
      fullClipProcessed: true
    },
    visionGate: {
      skipped: false,
      shouldClip: false,
      compositeScore: 31,
      narrativeScore: 1,
      payoffScore: 0,
      contextScore: 2,
      clipType: "nothing"
    }
  });

  assert.equal(result.strong, false);
  assert.equal(result.reviewWorthy, false);
  assert.equal(result.contentStrong, false);
  assert.ok(result.score < result.minimumScore);
  assert.ok(result.evidence.some((item) => item.includes("triggered capture only")));
});

test("a concrete moment with audio and chat corroboration enters review", () => {
  const result = scoreMediaSignals({
    watchWindowSignals: { hasSpikeSignal: true },
    audioEnergy: { isLoudMoment: true, isVoiceExcited: true, maxVolumeDb: -4 },
    transcriptSummary: {
      text: "I tried to save the round but missed the final shot and everyone started laughing",
      qualityScore: 92,
      usableForCaption: true,
      fullClipProcessed: true
    },
    visionGate: { skipped: true, reason: "Provider unavailable" }
  }, {
    minimumScore: 68,
    reviewMinimumScore: 50
  });

  assert.equal(result.strong, false);
  assert.equal(result.reviewWorthy, true);
  assert.equal(result.contentReviewWorthy, true);
  assert.equal(result.reviewCorroborated, true);
  assert.ok(result.score >= result.reviewMinimumScore);
  assert.ok(result.score < result.minimumScore);
});

test("a coherent visual near-miss enters review without becoming strong", () => {
  const result = scoreMediaSignals({
    watchWindowSignals: { hasSpikeSignal: true },
    audioEnergy: { isLoudMoment: true, isVoiceExcited: true, maxVolumeDb: -5 },
    transcriptSummary: {
      text: "They keep talking about the missing card while everyone on the boat starts blaming each other",
      qualityScore: 90,
      usableForCaption: true,
      fullClipProcessed: true
    },
    visionGate: {
      skipped: false,
      shouldClip: false,
      compositeScore: 34,
      narrativeScore: 3,
      payoffScore: 2,
      contextScore: 5,
      clipType: "reaction",
      reason: "Light banter without a complete payoff"
    }
  }, {
    minimumScore: 68,
    reviewMinimumScore: 40
  });

  assert.equal(result.strong, false);
  assert.equal(result.reviewWorthy, true);
  assert.equal(result.contentReviewWorthy, true);
  assert.equal(result.reviewCorroborated, true);
  assert.ok(result.score >= result.reviewMinimumScore);
});

test("quiet incomplete windows stay out of Clips", () => {
  const result = scoreMediaSignals({
    audioEnergy: { isLoudMoment: false, isVoiceExcited: false, maxVolumeDb: -24 },
    transcriptScore: 0,
    transcriptSummary: {
      text: "okay",
      qualityScore: 70,
      usableForCaption: true,
      fullClipProcessed: true
    },
    visionGate: {
      skipped: false,
      shouldClip: false,
      compositeScore: 22,
      narrativeScore: 0,
      payoffScore: 0,
      contextScore: 2,
      clipType: "nothing"
    }
  });

  assert.equal(result.strong, false);
  assert.ok(result.score < result.minimumScore);
});

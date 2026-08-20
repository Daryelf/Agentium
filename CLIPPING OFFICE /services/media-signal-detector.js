import { analyzeTranscriptMoment } from "./clip-moment-intelligence.js";

function bounded(value, min = 0, max = 100) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : 0;
}

function rounded(value) {
  return Math.round(bounded(value));
}

export function scoreMediaSignals(source = {}, opts = {}) {
  const audio = source.audioEnergy || {};
  const transcript = source.transcriptSummary || {};
  const vision = source.visionGate || {};
  const minimumScore = bounded(opts.minimumScore ?? 72, 1, 100);
  const reviewMinimumScore = bounded(opts.reviewMinimumScore ?? 40, 1, minimumScore);
  const transcriptUsable = Boolean(
    transcript.text
    && transcript.usableForCaption !== false
    && (transcript.fullClipProcessed !== false || Number(source.durationSeconds || source.duration || 0) < 10)
  );
  const moment = analyzeTranscriptMoment(transcript, {
    minimumScore: opts.transcriptMomentMinScore ?? 58,
    reviewMinimumScore: opts.transcriptMomentReviewMinScore ?? 30,
    trendingPhrases: source.trendingPhrases || transcript.trendingPhrases || []
  });
  const visionAvailable = Boolean(
    !vision.skipped
    && Number.isFinite(Number(vision.compositeScore))
  );
  const visionComposite = visionAvailable ? bounded(vision.compositeScore) : 0;
  const narrativeScore = bounded(vision.narrativeScore ?? vision.narrativeProgression, 0, 10);
  const payoffScore = bounded(vision.payoffScore ?? vision.payoffStrength, 0, 10);
  const contextScore = bounded(vision.contextScore, 0, 10);
  const explicitVisionReject = visionAvailable && vision.shouldClip === false;
  const visionContentStrong = Boolean(
    visionAvailable
    && vision.shouldClip === true
    && (
      (narrativeScore >= 6 && payoffScore >= 5 && contextScore >= 4)
      || (visionComposite >= 82 && payoffScore >= 6)
      || (!Number.isFinite(Number(vision.narrativeScore ?? vision.narrativeProgression)) && visionComposite >= 72)
    )
  );
  const reviewableVisionType = !["", "nothing", "unclear"].includes(String(vision.clipType || "").toLowerCase());
  const visionContentReviewWorthy = Boolean(
    visionAvailable
    && (
      (vision.shouldClip === true && (
        (visionComposite >= 56 && (narrativeScore >= 3 || payoffScore >= 2 || contextScore >= 5))
        || (!Number.isFinite(Number(vision.narrativeScore ?? vision.narrativeProgression)) && visionComposite >= 60)
      ))
      || (
        visionComposite >= 30
        && narrativeScore >= 3
        && payoffScore >= 1
        && reviewableVisionType
      )
    )
  );

  let audioScore = 0;
  if (audio.isLoudMoment) audioScore += 4;
  if (audio.isVoiceExcited) audioScore += 7;
  if (audio.silenceBeforeBurst) audioScore += 3;
  audioScore = Math.min(10, audioScore);

  let score = 0;
  if (transcriptUsable && visionAvailable) {
    score = (moment.score * 0.45) + (visionComposite * 0.45) + audioScore;
  } else if (transcriptUsable) {
    score = (moment.score * 0.82) + Math.min(14, audioScore * 1.35);
  } else if (visionAvailable) {
    score = (visionComposite * 0.86) + Math.min(14, audioScore * 1.35);
  } else {
    score = Math.min(24, audioScore * 2.2);
  }

  const evidence = [];
  if (transcriptUsable) {
    evidence.push(`content moment ${moment.score}% (${moment.momentType})`);
    evidence.push(...moment.evidence.slice(0, 3));
  } else {
    evidence.push("full-clip transcript unavailable or incomplete");
  }
  if (visionAvailable) {
    evidence.push(`visual sequence ${rounded(visionComposite)}%`);
    if (narrativeScore) evidence.push(`visual narrative ${rounded(narrativeScore * 10)}%`);
    if (payoffScore) evidence.push(`visual payoff ${rounded(payoffScore * 10)}%`);
  } else {
    evidence.push("visual sequence verification unavailable");
  }
  if (audio.isVoiceExcited) evidence.push("voice-band excitement corroborated the moment");
  else if (audio.isLoudMoment) evidence.push("audio energy corroborated the moment");
  if (audio.silenceBeforeBurst) evidence.push("silence-to-reaction audio arc corroborated the payoff");
  if (moment.humanInterest?.reviewWorthy) {
    evidence.push(`human-interest ${moment.humanInterest.score}% (${moment.humanInterest.categories.slice(0, 3).join(", ")})`);
  }
  if (source.watchWindowSignals?.hasSpikeSignal || source.watchWindowSignals?.hasKeywordSignal) {
    evidence.push("chat triggered capture only; it did not prove clip quality");
  }

  const chatTriggered = Boolean(
    source.watchWindowSignals?.hasSpikeSignal
    || source.watchWindowSignals?.hasKeywordSignal
    || source.watchWindowSignals?.hasTensionSignal
  );
  const audioCorroborated = Boolean(audio.isVoiceExcited || audio.isLoudMoment);
  const transcriptContentStrong = transcriptUsable && moment.strong;
  const transcriptContentReviewWorthy = transcriptUsable && moment.reviewWorthy;
  const contentStrong = transcriptContentStrong || visionContentStrong;
  const contentReviewWorthy = contentStrong || transcriptContentReviewWorthy || visionContentReviewWorthy;
  const corroborated = Boolean(
    (transcriptContentStrong && (visionContentStrong || audio.isVoiceExcited || audio.isLoudMoment || moment.score >= 78))
    || (visionContentStrong && (moment.score >= 35 || audio.isVoiceExcited || audio.isLoudMoment || payoffScore >= 8 || visionComposite >= 88))
  );
  const reviewCorroborated = Boolean(
    corroborated
    || (transcriptContentReviewWorthy && (visionComposite >= 42 || audioCorroborated || chatTriggered))
    || (visionContentReviewWorthy && (moment.score >= 25 || audioCorroborated || chatTriggered))
  );
  const visionHardReject = Boolean(
    explicitVisionReject
    && visionComposite < 20
    && !transcriptContentReviewWorthy
  );

  if (contentReviewWorthy) score += 8;
  if (contentReviewWorthy && chatTriggered) score += 5;
  if (visionHardReject) score = Math.min(score, 29);
  else if (explicitVisionReject) score = Math.min(score, minimumScore - 1);
  if (!contentReviewWorthy) score = Math.min(score, reviewMinimumScore - 1);
  else if (!contentStrong) score = Math.min(score, minimumScore - 1);
  if (!reviewCorroborated) score = Math.min(score, reviewMinimumScore - 1);
  else if (!corroborated) score = Math.min(score, minimumScore - 1);
  score = rounded(score);
  const strong = Boolean(
    score >= minimumScore
    && contentStrong
    && corroborated
    && !explicitVisionReject
  );
  const reviewWorthy = Boolean(
    score >= reviewMinimumScore
    && contentReviewWorthy
    && reviewCorroborated
    && !visionHardReject
  );

  const rejectionReasons = [];
  if (visionHardReject) rejectionReasons.push(vision.reason || "The visual sequence did not contain a reviewable clip moment.");
  if (!contentReviewWorthy) rejectionReasons.push("No concrete action, reaction, reveal, conflict, or funny moment was verified.");
  if (contentReviewWorthy && !reviewCorroborated) rejectionReasons.push("The possible moment was not corroborated by a second signal.");
  if (!visionAvailable && !transcriptContentReviewWorthy) rejectionReasons.push("Neither vision nor the full transcript proved a reviewable moment.");

  return {
    score,
    minimumScore,
    reviewMinimumScore,
    strong,
    reviewWorthy,
    contentStrong,
    contentReviewWorthy,
    corroborated,
    reviewCorroborated,
    rejectionReasons,
    source: "content_moment_audio_visual_human_v3",
    chatRequired: false,
    chatIsTriggerOnly: true,
    evidence,
    audio: {
      loud: Boolean(audio.isLoudMoment),
      voiceExcited: Boolean(audio.isVoiceExcited),
      silenceBeforeBurst: Boolean(audio.silenceBeforeBurst),
      dynamicRangeDb: Number.isFinite(Number(audio.dynamicRangeDb)) ? Number(audio.dynamicRangeDb) : null,
      maxVolumeDb: Number.isFinite(Number(audio.maxVolumeDb)) ? Number(audio.maxVolumeDb) : null
    },
    transcript: {
      score: bounded(source.transcriptScore, 0, 30),
      qualityScore: bounded(transcript.qualityScore),
      usable: transcriptUsable,
      moment
    },
    vision: {
      available: visionAvailable,
      shouldClip: visionAvailable ? vision.shouldClip === true : null,
      compositeScore: visionAvailable ? rounded(visionComposite) : null,
      narrativeScore: visionAvailable ? narrativeScore : null,
      payoffScore: visionAvailable ? payoffScore : null,
      clipType: vision.clipType || ""
    }
  };
}

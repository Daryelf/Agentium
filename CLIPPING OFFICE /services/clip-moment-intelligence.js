import { analyzeHumanInterest } from "./human-interest-signals.js";

const STOP_WORDS = new Set([
  "a", "about", "after", "again", "all", "am", "an", "and", "are", "as", "at", "be", "because",
  "been", "before", "being", "but", "by", "can", "could", "did", "do", "does", "doing", "for",
  "from", "get", "got", "had", "has", "have", "he", "her", "here", "him", "his", "how", "i",
  "if", "in", "into", "is", "it", "its", "just", "like", "me", "more", "my", "no", "not", "now",
  "of", "oh", "on", "one", "or", "our", "out", "really", "said", "she", "so", "some", "that",
  "the", "their", "them", "then", "there", "they", "this", "to", "up", "was", "we", "were",
  "what", "when", "where", "which", "who", "why", "will", "with", "would", "yeah", "you", "your"
]);

const PATTERNS = {
  action: [
    /\b(?:beat|broke|bought|called|caught|changed|clutched|crashed|deleted|destroyed|died|dropped|escaped|failed|fell|fired|found|gave|hit|killed|lost|missed|paid|pulled|quit|rejected|saved|scored|sold|stole|threw|tried|walked|won)\b/gi,
    /\b(?:buy|call|catch|clutch|fight|find|give|hit|kill|pay|race|save|score|steal|throw|try|win)\w*\b/gi
  ],
  reaction: [
    /\b(?:ain't no way|are you serious|i can't believe|no shot|no way|oh my god|what just happened|what the fuck|what the hell|wtf)\b/gi,
    /\b(?:begs?|cries?|freaks? out|laughs?|loses? it|rages?|screams?|shocked|speechless)\b/gi
  ],
  payoff: [
    /\b(?:actually|finally|immediately|instantly|last second|right before|right when|somehow|suddenly|turns out)\b/gi,
    /\b(?:changed the price|ended up|got exposed|got caught|made it|pulled it off|refused to|walked away|was right|was wrong)\b/gi
  ],
  reveal: [
    /\b(?:admits?|changed the price|discovers?|finds? out|learns?|notices?|realizes?|reveals?|sees?|shows?)\b/gi,
    /(?:\$|£|€)\s?\d[\d,.]*|\b\d+(?:\.\d+)?\s?(?:dollars?|grand|k|million|minutes?|hours?|years?)\b/gi
  ],
  conflict: [
    /\b(?:argues?|betray(?:s|ed)?|blames?|calls? out|cheats?|confronts?|fights?|lies?|refus(?:e|es|ed|ing)|roasts?|steals?|threatens?)\b/gi
  ],
  humor: [
    /\b(?:awkward|embarrass(?:ed|ing)?|funny|hilarious|joke|laughing|ridiculous|wild)\b/gi,
    /\b(?:bro|bruh)\b.{0,45}\b(?:no way|what|why|wtf)\b/gi
  ],
  setup: [
    /\b(?:about to|bet you|challenge|going to|gotta|have to|let's|need to|supposed to|trying to|watch this)\b/gi
  ],
  hypeOnly: [
    /\b(?:bro|crazy|holy|holy shit|insane|omg|pog|poggers|unreal|wow|wtf)\b/gi
  ]
};

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function matches(text, patterns = []) {
  return patterns.reduce((total, pattern) => {
    pattern.lastIndex = 0;
    return total + Array.from(text.matchAll(pattern)).length;
  }, 0);
}

function clamp(value, min = 0, max = 100) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
}

function transcriptText(value = {}) {
  return clean(typeof value === "string" ? value : value?.text);
}

function timedSegmentTexts(value = {}) {
  if (!Array.isArray(value?.segments)) return [];
  return value.segments.map((segment) => clean(segment?.text)).filter(Boolean);
}

function timedSegments(value = {}) {
  if (!Array.isArray(value?.segments)) return [];
  return value.segments.map((segment, index) => {
    const start = Number(segment?.start ?? segment?.startSeconds ?? segment?.timestampStartSeconds);
    const end = Number(segment?.end ?? segment?.endSeconds ?? segment?.timestampEndSeconds);
    return {
      index,
      text: clean(segment?.text),
      start: Number.isFinite(start) ? Math.max(0, start) : null,
      end: Number.isFinite(end) ? Math.max(0, end) : null
    };
  }).filter((segment) => segment.text && Number.isFinite(segment.start));
}

function tokensForSimilarity(value = "") {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9$]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
    .map((token) => token.replace(/(?:ing|edly|ed|es|s)$/i, ""))
    .filter((token) => token.length > 2);
}

export function transcriptFingerprint(value = "") {
  return Array.from(new Set(tokensForSimilarity(value))).sort().join(" ");
}

export function transcriptSimilarity(left = "", right = "") {
  const leftTokens = new Set(tokensForSimilarity(left));
  const rightTokens = new Set(tokensForSimilarity(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? Number((intersection / union).toFixed(3)) : 0;
}

export function recommendTranscriptClipBoundaries(value = {}, options = {}) {
  const segments = timedSegments(value);
  const duration = Math.max(1, Number(options.durationSeconds || value?.duration || value?.audioDuration || segments.at(-1)?.end || 30));
  if (!segments.length) {
    return { startSeconds: 0, endSeconds: duration, source: "full_transcript_window", confidence: 0 };
  }
  const scored = segments.map((segment) => {
    const lower = segment.text.toLowerCase();
    const counts = Object.fromEntries(Object.entries(PATTERNS).map(([key, patterns]) => [key, matches(lower, patterns)]));
    const humanInterest = analyzeHumanInterest(segment.text, { trendingPhrases: options.trendingPhrases || [] });
    const score = humanInterest.score
      + (counts.reveal * 18)
      + (counts.conflict * 16)
      + (counts.reaction * 13)
      + (counts.payoff * 15)
      + (counts.humor * 11)
      + (counts.action * 6)
      + (counts.setup * 4)
      - (counts.hypeOnly > 0 && !counts.action && !counts.reaction ? 12 : 0);
    return { ...segment, score, humanInterest, counts };
  });
  const peak = [...scored].sort((left, right) => right.score - left.score || left.start - right.start)[0];
  if (!peak || peak.score <= 0) {
    return { startSeconds: 0, endSeconds: duration, source: "full_transcript_window", confidence: 0 };
  }

  const peakIndex = scored.findIndex((segment) => segment.index === peak.index);
  let start = Math.max(0, peak.start - 12);
  for (let index = peakIndex - 1; index >= 0; index -= 1) {
    const segment = scored[index];
    if (peak.start - segment.start > 30) break;
    if (segment.counts.setup || segment.humanInterest.hasSpecificDetail || segment.counts.action) {
      start = Math.max(0, segment.start - 1.5);
    }
  }
  let end = Math.min(duration, Math.max(peak.end || peak.start + 4, peak.start + 4) + 7);
  for (let index = peakIndex + 1; index < scored.length; index += 1) {
    const segment = scored[index];
    if (segment.start - peak.start > 18) break;
    if (segment.counts.payoff || segment.counts.reaction || segment.counts.reveal) {
      end = Math.min(duration, Math.max(end, Number(segment.end || segment.start + 3) + 3));
    }
  }
  if (end - start > 60) start = Math.max(0, end - 60);
  if (end - start < 8) end = Math.min(duration, start + 8);
  return {
    startSeconds: Number(start.toFixed(2)),
    endSeconds: Number(end.toFixed(2)),
    hookSeconds: Number(peak.start.toFixed(2)),
    source: "timed_transcript_human_interest",
    confidence: Math.max(1, Math.min(100, Math.round(peak.score))),
    peakText: peak.text.slice(0, 240),
    humanInterest: peak.humanInterest
  };
}

export function analyzeTranscriptMoment(value = {}, opts = {}) {
  const text = transcriptText(value);
  const lower = text.toLowerCase();
  const segments = timedSegmentTexts(value);
  const words = text.match(/[\p{L}\p{N}'$]+/gu) || [];
  const uniqueWords = new Set(words.map((word) => word.toLowerCase())).size;
  const repetitionRatio = words.length ? uniqueWords / words.length : 0;
  const counts = Object.fromEntries(
    Object.entries(PATTERNS).map(([key, patterns]) => [key, matches(lower, patterns)])
  );
  const properNames = Array.from(new Set(
    (text.match(/\b[A-Z][a-z]{2,}\b/g) || []).filter((word) => !["The", "This", "That", "What", "When", "Where"].includes(word))
  ));
  const humanInterest = analyzeHumanInterest(text, {
    trendingPhrases: value?.trendingPhrases || opts.trendingPhrases || []
  });
  const hasSequence = segments.length >= 2 || /\b(?:after|before|first|next|then|until|when)\b/i.test(text);
  const hasSpecificDetail = counts.reveal > 0 || properNames.length > 0 || /\b(?:game|car|food|money|phone|stream|team|watch)\b/i.test(text);
  const actionSequence = counts.action >= 2 && hasSequence;
  const hasNarrativeEvent = Boolean(
    counts.reveal
    || counts.conflict
    || (counts.action && (counts.reaction || counts.payoff))
    || (actionSequence && hasSpecificDetail)
    || humanInterest.strong
  );
  const hasPayoff = Boolean(
    counts.payoff
    || counts.reveal
    || (counts.action && counts.reaction)
    || (counts.conflict && counts.reaction)
    || (actionSequence && counts.action >= 3)
    || (humanInterest.strong && (counts.reaction || counts.payoff || counts.reveal))
  );

  let score = 0;
  score += Math.min(18, counts.action * 7);
  score += Math.min(16, counts.reaction * 8);
  score += Math.min(20, counts.payoff * 10);
  score += Math.min(16, counts.reveal * 9);
  score += Math.min(10, counts.conflict * 6);
  score += Math.min(10, counts.humor * 6);
  score += Math.min(8, counts.setup * 4);
  score += hasSpecificDetail ? 6 : 0;
  score += hasSequence && hasPayoff ? 8 : 0;
  score += hasNarrativeEvent ? 8 : 0;
  score += hasPayoff ? 8 : 0;
  score += counts.action && counts.reaction && counts.payoff ? 18 : 0;
  score += words.length >= 10 ? 4 : 0;
  score += Number(value?.qualityScore || 0) >= 75 ? 3 : 0;
  score += Math.min(24, Math.round(humanInterest.score * 0.3));

  const penalties = [];
  if (words.length < 4) {
    score = Math.min(score, 20);
    penalties.push("too little verified speech");
  } else if (words.length < 10 && !hasNarrativeEvent) {
    score = Math.min(score, 38);
    penalties.push("very short speech context");
  }
  if (counts.hypeOnly > 0 && !hasNarrativeEvent) {
    score = Math.min(score, 34);
    penalties.push("hype words without a proved event");
  }
  if (words.length >= 12 && repetitionRatio < 0.42) {
    score -= 12;
    penalties.push("repetitive speech");
  }
  if (value?.usableForCaption === false) {
    score = Math.min(score, 42);
    penalties.push("transcript quality is incomplete");
  }
  score = Math.round(clamp(score));

  const momentType = counts.conflict
    ? "conflict"
    : counts.reveal
      ? "reveal"
      : counts.humor
        ? "funny"
        : counts.reaction
          ? "reaction"
          : counts.payoff
            ? "payoff"
            : counts.action
              ? "action"
              : "unclear";
  const minimumScore = clamp(opts.minimumScore ?? 58, 1, 100);
  const reviewMinimumScore = clamp(opts.reviewMinimumScore ?? 30, 1, minimumScore);
  const hasConcreteMoment = Boolean(
    counts.reveal
    || counts.conflict
    || counts.humor
    || counts.reaction
    || (counts.action && hasSpecificDetail)
    || actionSequence
    || humanInterest.reviewWorthy
  );
  const strong = score >= minimumScore && hasNarrativeEvent && hasPayoff;
  const reviewWorthy = Boolean(
    score >= reviewMinimumScore
    && hasConcreteMoment
    && !(counts.hypeOnly > 0 && !hasNarrativeEvent && !counts.action && !counts.reaction)
  );
  const evidence = [];
  if (counts.action) evidence.push(`${counts.action} concrete action cue${counts.action === 1 ? "" : "s"}`);
  if (counts.reaction) evidence.push(`${counts.reaction} reaction cue${counts.reaction === 1 ? "" : "s"}`);
  if (counts.payoff) evidence.push(`${counts.payoff} payoff cue${counts.payoff === 1 ? "" : "s"}`);
  if (counts.reveal) evidence.push(`${counts.reveal} reveal or specific-stakes cue${counts.reveal === 1 ? "" : "s"}`);
  if (counts.conflict) evidence.push(`${counts.conflict} conflict cue${counts.conflict === 1 ? "" : "s"}`);
  if (hasSequence) evidence.push("setup-to-outcome language");
  evidence.push(...humanInterest.evidence.slice(0, 3));

  return {
    score,
    minimumScore,
    reviewMinimumScore,
    strong,
    reviewWorthy,
    momentType,
    hasConcreteMoment,
    hasNarrativeEvent,
    hasPayoff,
    hasSequence,
    wordCount: words.length,
    uniqueWordRatio: Number(repetitionRatio.toFixed(3)),
    fingerprint: transcriptFingerprint(text),
    counts,
    humanInterest,
    evidence,
    penalties
  };
}

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "because", "been", "before", "being", "could", "does", "doing",
  "from", "have", "into", "just", "more", "much", "really", "some", "that", "their", "them", "then",
  "there", "these", "they", "this", "those", "very", "what", "when", "where", "which", "while", "with",
  "would", "your", "youre", "bro", "bruh", "chat", "clip", "crazy", "holy", "insane", "lmao", "lol",
  "omg", "pog", "poggers", "wow"
]);

export const HUMAN_INTEREST_TRIGGER_PHRASES = [
  "did you hear", "what happened", "who is that", "tell the story", "say the name",
  "called out", "caught lying", "got caught", "got exposed", "show the receipts", "screenshots",
  "broke up", "cheated", "dating", "relationship", "secret", "rumor", "apparently",
  "admitted", "confirmed", "denied", "leaked", "lied", "beef", "drama",
  "banned", "arrested", "fired", "quit", "scam", "fake", "stole", "threatened",
  "lost everything", "changed the price", "how much", "money", "contract", "lawsuit",
  "awkward", "embarrassing", "why would", "no way", "clip this"
];

const CUE_PATTERNS = {
  relationship: [
    /\b(?:broke up|breakup|cheated|crush|dating|divorc(?:e|ed|ing)|ex boyfriend|ex girlfriend|relationship|seeing someone)\b/gi
  ],
  accusation: [
    /\b(?:accused|called out|caught lying|cheated|exposed|fake|fraud|lied|lying|scam(?:med)?|stole|threatened)\b/gi
  ],
  receipts: [
    /\b(?:dm(?:s)?|leak(?:ed)?|messages?|proof|receipt(?:s)?|recording|screenshots?|showed the texts?)\b/gi
  ],
  reveal: [
    /\b(?:admit(?:s|ted)?|apparently|confirmed|confessed|denied|found out|revealed|rumou?r|secret|turns out)\b/gi
  ],
  status: [
    /\b(?:arrested|banned|dropped|fired|kicked out|quit|signed|suspended|unfollowed)\b/gi
  ],
  stakes: [
    /(?:\$|£|€)\s?\d[\d,.]*|\b\d+(?:\.\d+)?\s?(?:dollars?|grand|thousand|million)\b/gi,
    /\b(?:contract|debt|lawsuit|lost everything|paid|price|rent|salary|sponsor)\b/gi
  ],
  identity: [
    /\b(?:do you know who|name names|say the name|that was my|who is that|you know her|you know him)\b/gi
  ],
  embarrassment: [
    /\b(?:awkward|caught on camera|embarrass(?:ed|ing)?|humiliated|speechless|uncomfortable)\b/gi
  ],
  curiosity: [
    /\b(?:did you hear|how did|tell (?:me|us) what happened|tell the story|wait what|what happened|why did)\b/gi
  ]
};

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function matchCount(text, patterns = []) {
  return patterns.reduce((total, pattern) => {
    pattern.lastIndex = 0;
    return total + Array.from(text.matchAll(pattern)).length;
  }, 0);
}

function phraseTokens(value = "") {
  return clean(value)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9'@$]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function candidatePhrases(value = "") {
  const tokens = phraseTokens(value);
  const phrases = new Set();
  for (let width = 1; width <= 3; width += 1) {
    for (let index = 0; index <= tokens.length - width; index += 1) {
      const phrase = tokens.slice(index, index + width).join(" ");
      if (phrase.length >= 4) phrases.add(phrase);
    }
  }
  return Array.from(phrases);
}

export function analyzeHumanInterest(value = "", options = {}) {
  const text = clean(typeof value === "string" ? value : value?.text);
  const lower = text.toLowerCase();
  const counts = Object.fromEntries(
    Object.entries(CUE_PATTERNS).map(([name, patterns]) => [name, matchCount(lower, patterns)])
  );
  const trendPhrases = Array.isArray(options.trendingPhrases) ? options.trendingPhrases.filter(Boolean).slice(0, 8) : [];
  const categories = Object.entries(counts).filter(([, count]) => count > 0).map(([name]) => name);
  let score = 0;
  score += Math.min(20, counts.relationship * 12);
  score += Math.min(20, counts.accusation * 10);
  score += Math.min(18, counts.receipts * 10);
  score += Math.min(18, counts.reveal * 9);
  score += Math.min(14, counts.status * 9);
  score += Math.min(14, counts.stakes * 8);
  score += Math.min(10, counts.identity * 6);
  score += Math.min(10, counts.embarrassment * 7);
  score += Math.min(8, counts.curiosity * 4);
  score += Math.min(18, trendPhrases.length * 6);
  const hasSpecificPerson = /\b[A-Z][a-z]{2,}\b/.test(text) || /@[a-z0-9_]{2,}/i.test(text);
  const hasSpecificDetail = hasSpecificPerson || counts.receipts > 0 || counts.stakes > 0 || counts.status > 0;
  if (hasSpecificDetail) score += 7;
  if (categories.length >= 2) score += 9;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const evidence = categories.map((category) => `${category} cue`).slice(0, 6);
  if (trendPhrases.length) evidence.push(`emerging chat topic: ${trendPhrases.slice(0, 3).join(", ")}`);
  if (hasSpecificPerson) evidence.push("specific person or identity cue");
  return {
    score,
    strong: score >= 58 && categories.length >= 2,
    reviewWorthy: score >= 30 && (categories.length > 0 || trendPhrases.length > 0),
    categories,
    counts,
    trendingPhrases: trendPhrases,
    hasSpecificPerson,
    hasSpecificDetail,
    evidence
  };
}

export class EmergingPhraseTracker {
  constructor(options = {}) {
    this.windowMs = Number(options.windowMs || 90000);
    this.minimumMentions = Number(options.minimumMentions || 3);
    this.minimumAuthors = Number(options.minimumAuthors || 2);
    this.events = [];
  }

  observe(message = "", options = {}) {
    const timestamp = Number(options.timestamp || Date.now());
    const author = clean(options.author || options.userId || "anonymous");
    this.events.push({ timestamp, author, phrases: candidatePhrases(message) });
    this.prune(timestamp);
    const phraseStats = new Map();
    for (const event of this.events) {
      for (const phrase of event.phrases) {
        const entry = phraseStats.get(phrase) || { phrase, mentions: 0, authors: new Set(), lastAt: 0 };
        entry.mentions += 1;
        entry.authors.add(event.author || `anon-${event.timestamp}`);
        entry.lastAt = Math.max(entry.lastAt, event.timestamp);
        phraseStats.set(phrase, entry);
      }
    }
    return Array.from(phraseStats.values())
      .filter((entry) => entry.mentions >= this.minimumMentions && entry.authors.size >= this.minimumAuthors)
      .sort((left, right) => right.mentions - left.mentions || right.phrase.length - left.phrase.length || right.lastAt - left.lastAt)
      .filter((entry, index, values) => !values.slice(0, index).some((higher) => higher.phrase.includes(entry.phrase)))
      .slice(0, 8)
      .map((entry) => ({ phrase: entry.phrase, mentions: entry.mentions, authors: entry.authors.size }));
  }

  prune(timestamp = Date.now()) {
    const cutoff = Number(timestamp) - this.windowMs;
    this.events = this.events.filter((event) => event.timestamp >= cutoff);
  }
}

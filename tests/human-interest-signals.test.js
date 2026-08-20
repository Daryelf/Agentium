import assert from "node:assert/strict";
import test from "node:test";
import { analyzeHumanInterest, EmergingPhraseTracker } from "../CLIPPING OFFICE /services/human-interest-signals.js";

test("human-interest scoring recognizes specific gossip with receipts and stakes", () => {
  const result = analyzeHumanInterest("Maya admitted she was dating him after the leaked DMs and showed the screenshots about the contract.");

  assert.equal(result.strong, true);
  assert.ok(result.categories.includes("relationship"));
  assert.ok(result.categories.includes("receipts"));
  assert.ok(result.categories.includes("reveal"));
  assert.ok(result.score >= 58);
});

test("generic hype is not treated as human-interest evidence", () => {
  const result = analyzeHumanInterest("bro holy shit wow poggers that was crazy");

  assert.equal(result.reviewWorthy, false);
  assert.equal(result.score, 0);
});

test("emerging phrase tracker finds a topic repeated by different people", () => {
  const tracker = new EmergingPhraseTracker({ minimumMentions: 3, minimumAuthors: 2, windowMs: 60000 });
  tracker.observe("show the marina receipts", { timestamp: 1000, author: "a" });
  tracker.observe("marina receipts are real", { timestamp: 2000, author: "b" });
  const trends = tracker.observe("did he show marina receipts", { timestamp: 3000, author: "c" });

  assert.ok(trends.some((entry) => entry.phrase.includes("marina receipts")));
});

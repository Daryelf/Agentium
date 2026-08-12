const assert = require("node:assert/strict");
const test = require("node:test");

const { buildContinuousReviewView, selectNextQualifiedProposal } = require("../services/stock-continuous-review");

const regular = { status: "regular", label: "Regular market open", regular: true };

test("continuous review stages SELL before BUY and skips HOLD or already staged ideas", () => {
  const proposals = [
    { fingerprint: "a".repeat(64), side: "BUY", symbol: "AAPL", draftEligible: true, rankingScore: 0.99 },
    { fingerprint: "b".repeat(64), side: "HOLD", symbol: "MSFT", draftEligible: false },
    { fingerprint: "c".repeat(64), side: "SELL", symbol: "NET", draftEligible: true, rankingScore: 0.2 },
  ];
  assert.equal(selectNextQualifiedProposal({ proposals }, {}, { session: regular }).symbol, "NET");
  assert.equal(selectNextQualifiedProposal({ proposals }, { stagedProposalFingerprints: ["c".repeat(64)] }, { session: regular }).symbol, "AAPL");
  assert.equal(selectNextQualifiedProposal({ proposals }, {}, { session: { ...regular, regular: false } }), null);
});

test("continuous review view exposes scheduler countdown and exact staged state", () => {
  const draftFingerprint = "d".repeat(64);
  const output = buildContinuousReviewView({
    session: regular,
    plan: {
      summary: { buys: 2, holds: 1, sells: 1, copyWatchers: 4, copySignalsObserved: 3 },
      proposals: [{ id: "proposal-1", side: "SELL", symbol: "NET", draftFingerprint, draftEligible: true }],
    },
    scheduler: { enabled: true, activeCadenceMinutes: 15, nextRunAt: "2026-08-12T14:15:00.000Z" },
    review: { lastOutcome: "waiting_for_human_gate" },
    tradeDrafts: [{ id: "draft-1", fingerprint: draftFingerprint, approvalId: "approval-1", status: "awaiting_human_gate" }],
  }, { now: "2026-08-12T14:05:00.000Z" });

  assert.equal(output.cycle.remainingSeconds, 600);
  assert.equal(output.cycle.buyCount, 2);
  assert.equal(output.cycle.holdCount, 1);
  assert.equal(output.cycle.sellCount, 1);
  assert.equal(output.proposals[0].reviewState, "awaiting_human_gate");
  assert.equal(output.proposals[0].reviewDraftId, "draft-1");
});

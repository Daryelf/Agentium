const { marketSession } = require("./stock-market-workers");

function safeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function selectNextQualifiedProposal(plan = {}, review = {}, options = {}) {
  const session = options.session || marketSession(options.now ? new Date(options.now) : new Date());
  if (!session.regular) return null;
  const staged = new Set(Array.isArray(review.stagedProposalFingerprints) ? review.stagedProposalFingerprints : []);
  return (Array.isArray(plan.proposals) ? plan.proposals : [])
    .filter((proposal) => proposal?.draftEligible === true && ["BUY", "SELL"].includes(proposal.side) && !staged.has(proposal.fingerprint))
    .sort((a, b) => (a.side === "SELL" ? 0 : 1) - (b.side === "SELL" ? 0 : 1) || Number(b.rankingScore || 0) - Number(a.rankingScore || 0))[0] || null;
}

function buildContinuousReviewView(input = {}, options = {}) {
  const at = options.now ? new Date(options.now) : new Date();
  const session = input.session || marketSession(at);
  const scheduler = input.scheduler || {};
  const review = input.review || {};
  const plan = input.plan || {};
  const drafts = Array.isArray(input.tradeDrafts) ? input.tradeDrafts : [];
  const nextRunAt = safeDate(scheduler.nextRunAt);
  const remainingSeconds = nextRunAt ? Math.max(0, Math.ceil((new Date(nextRunAt).getTime() - at.getTime()) / 1_000)) : null;
  const proposals = (Array.isArray(plan.proposals) ? plan.proposals : []).map((proposal) => {
    const draft = drafts.find((item) => item?.fingerprint && item.fingerprint === proposal.draftFingerprint) || null;
    return {
      ...proposal,
      reviewState: draft?.status || (proposal.monitoring ? "monitoring" : proposal.draftEligible ? "qualified" : "blocked"),
      reviewDraftId: draft?.id || "",
      reviewApprovalId: draft?.approvalId || "",
    };
  });
  const summary = plan.summary || {};
  return {
    ...plan,
    proposals,
    cycle: {
      session,
      running: scheduler.running === true,
      status: scheduler.running === true ? "research_running" : session.regular ? "counting_down" : "market_monitoring",
      cadenceMinutes: Number(scheduler.activeCadenceMinutes || 15),
      lastStartedAt: safeDate(scheduler.lastStartedAt),
      lastCompletedAt: safeDate(scheduler.lastCompletedAt),
      nextRunAt,
      remainingSeconds,
      workersContinueAfterCycle: scheduler.enabled !== false,
      buyCount: Number(summary.buys || 0),
      holdCount: Number(summary.holds || 0),
      sellCount: Number(summary.sells || 0),
      copyWatchers: Number(summary.copyWatchers || 0),
      copySignalsObserved: Number(summary.copySignalsObserved || 0),
      review,
    },
  };
}

module.exports = {
  buildContinuousReviewView,
  selectNextQualifiedProposal,
};

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  brokerControlOverview,
  buildTradeDraft,
  claimApprovedDispatch,
  executionEnvelope,
  normalizeTradeDrafts,
  settleApprovedDispatch,
  tradeDraftWithApprovalState,
  REQUIRED_EQUITY_TOOLS,
  ROBINHOOD_MCP_URL,
  verifyRobinhoodToolContract,
} = require("../services/stock-broker-control");

function snapshot(overrides = {}) {
  return {
    broker: {
      configured: true,
      account: "acct-****1234",
      accountValue: "$100.00",
      cash: "$100.00",
      buyingPower: "$100.00",
      positions: [],
      openOrders: [],
      updatedAt: "2026-08-10T16:59:00.000Z",
      connector: {
        registered: true,
        oauthAuthenticated: true,
        endpoint: ROBINHOOD_MCP_URL,
        observedAt: "2026-08-10T16:59:30.000Z",
        tools: REQUIRED_EQUITY_TOOLS,
      },
    },
    guardrails: {
      principalDollars: 100,
      maxTotalDollars: 100,
      maxOrderDollars: 20,
      minOrderDollars: 1,
      cashReserveDollars: 10,
      dailyLossLimitPct: 0.02,
      riskPerTradePct: 0.01,
      maxPositions: 5,
      maxTradesPerDay: 3,
      minEntryScore: 85,
      autoOrderScore: 90,
      tradeDirection: "long_only",
      lockProfits: true,
    },
    killSwitch: { active: false },
    readiness: { readyForLiveAuto: true, blockers: [] },
    records: [{
      id: "ticker-NET",
      ticker: "NET",
      status: "valid_setup",
      decision: "VALID_BUY_SETUP",
      score: 90,
      currentPrice: 100,
      dataFresh: true,
      lastUpdated: "2026-08-10T16:59:00.000Z",
      mainRisk: "Use a hard stop.",
    }],
    positions: [],
    mirror: { stale: false, candidates: [] },
    ...overrides,
  };
}

function approvedApproval(draft) {
  const envelope = executionEnvelope(draft);
  return {
    id: "approval-exact-order",
    actionType: "place_robinhood_equity_order",
    status: "approved",
    useCount: 0,
    consumedAt: null,
    expiresAt: "2026-08-10T17:05:00.000Z",
    decidedAt: "2026-08-10T17:00:10.000Z",
    originalDetails: {
      draftId: draft.id,
      fingerprint: draft.fingerprint,
      executionEnvelope: envelope,
      maxNotionalDollars: draft.cappedDollars,
      accountScope: "dedicated_agentic_account_only",
      moneyMovementAuthorized: false,
      recurringAuthorization: false,
    },
    grantedDetails: {
      draftId: draft.id,
      fingerprint: draft.fingerprint,
      executionEnvelope: envelope,
      maxNotionalDollars: draft.cappedDollars,
      accountScope: "dedicated_agentic_account_only",
      moneyMovementAuthorized: false,
      recurringAuthorization: false,
    },
  };
}

test("fresh official connector and strict checks produce an exact BUY review envelope", () => {
  const current = snapshot();
  const control = brokerControlOverview(current, { now: "2026-08-10T17:00:00.000Z" });
  const draft = buildTradeDraft({ symbol: "NET", side: "BUY", requestedDollars: 10 }, current, { now: "2026-08-10T17:00:00.000Z" });
  const envelope = executionEnvelope(draft);

  assert.equal(control.authenticationVerified, true);
  assert.equal(control.toolContract.verified, true);
  assert.equal(control.buyReady, true);
  assert.equal(draft.status, "ready_for_broker_review");
  assert.equal(draft.blockers.length, 0);
  assert.equal(draft.cappedDollars, 10);
  assert.equal(envelope.reviewTool, "review_equity_order");
  assert.equal(envelope.placementTool, "place_equity_order");
  assert.equal(envelope.args.ref_id, draft.clientRefId);
  assert.equal(envelope.reviewArgs.ref_id, undefined);
  assert.equal(envelope.placementArgs.ref_id, draft.clientRefId);
  assert.deepEqual(envelope.args, envelope.placementArgs);
  assert.equal(envelope.args.dollar_amount, "10.00");
  assert.equal(envelope.accountScope, "dedicated_agentic_account_only");
});

test("connector tool contract fails closed when an execution tool is missing", () => {
  const connector = {
    ...snapshot().broker.connector,
    tools: REQUIRED_EQUITY_TOOLS.filter((tool) => tool !== "place_equity_order"),
  };
  const contract = verifyRobinhoodToolContract(connector, { now: "2026-08-10T17:00:00.000Z" });
  const current = snapshot({ broker: { ...snapshot().broker, connector } });
  const control = brokerControlOverview(current, { now: "2026-08-10T17:00:00.000Z" });
  const draft = buildTradeDraft({ symbol: "NET", side: "BUY", requestedDollars: 10 }, current, { now: "2026-08-10T17:00:00.000Z" });

  assert.equal(contract.verified, false);
  assert.deepEqual(contract.missingTools, ["place_equity_order"]);
  assert.equal(control.connectorStatus, "tool_contract_pending");
  assert.equal(control.authenticationVerified, false);
  assert.match(control.blockers.join(" "), /place_equity_order/);
  assert.equal(draft.status, "blocked");
});

test("paper-ready copy candidate becomes a source-bound guarded order draft", () => {
  const candidate = {
    id: "candidate-net",
    fingerprint: "a".repeat(64),
    traderName: "Named reporting person",
    symbol: "NET",
    side: "BUY",
    status: "paper_ready",
    humanGateEligible: true,
    currentPrice: 100,
    mirrorNotionalDollars: 5,
  };
  const current = snapshot({ mirror: { stale: false, candidates: [candidate] } });
  const draft = buildTradeDraft({
    candidateId: candidate.id,
    symbol: "NET",
    side: "BUY",
    requestedDollars: 5,
  }, current, { now: "2026-08-10T17:00:00.000Z" });

  assert.equal(draft.status, "ready_for_broker_review");
  assert.equal(draft.sourceType, "copy_signal");
  assert.equal(draft.sourceId, candidate.fingerprint);
  assert.equal(draft.requestedDollars, 5);
  assert.match(draft.thesis, /Named reporting person BUY disclosure/);

  const overCap = buildTradeDraft({
    candidateId: candidate.id,
    symbol: "NET",
    side: "BUY",
    requestedDollars: 6,
  }, current, { now: "2026-08-10T17:00:00.000Z" });
  assert.match(overCap.blockers.join(" "), /source-specific copy cap/i);
});

test("stale broker data fails closed before a BUY reaches Human Gate", () => {
  const current = snapshot({
    broker: { ...snapshot().broker, updatedAt: "2026-08-10T10:00:00.000Z" },
  });
  const draft = buildTradeDraft({ symbol: "NET", side: "BUY", requestedDollars: 10 }, current, { now: "2026-08-10T17:00:00.000Z" });

  assert.equal(draft.status, "blocked");
  assert.equal(draft.cappedDollars, 0);
  assert.match(draft.blockers.join(" "), /MCP must be authenticated/i);
  assert.equal(draft.liveOrderPlaced, false);
});

test("risk-reducing SELL can be drafted with the entry kill switch on and no buying power", () => {
  const position = { symbol: "NET", quantity: 0.2, sharesAvailableForSells: 0.2, currentPrice: 100 };
  const current = snapshot({
    broker: { ...snapshot().broker, buyingPower: "$0.00", positions: [position] },
    positions: [position],
    killSwitch: { active: true },
    readiness: { readyForLiveAuto: false, blockers: ["new entries disabled"] },
  });
  const draft = buildTradeDraft({ symbol: "NET", side: "SELL", requestedDollars: 10 }, current, { now: "2026-08-10T17:00:00.000Z" });

  assert.equal(draft.status, "ready_for_broker_review");
  assert.equal(draft.cappedDollars, 10);
  assert.equal(draft.blockers.length, 0);
});

test("SELL cannot create a short position or exceed verified owned shares", () => {
  const noPosition = buildTradeDraft({ symbol: "NET", side: "SELL", requestedDollars: 10 }, snapshot(), { now: "2026-08-10T17:00:00.000Z" });
  const smallPosition = { symbol: "NET", quantity: 0.01, sharesAvailableForSells: 0.01, currentPrice: 100 };
  const tooLarge = buildTradeDraft({ symbol: "NET", side: "SELL", requestedDollars: 10 }, snapshot({
    broker: { ...snapshot().broker, positions: [smallPosition] },
    positions: [smallPosition],
  }), { now: "2026-08-10T17:00:00.000Z" });

  assert.match(noPosition.blockers.join(" "), /owned position/i);
  assert.match(tooLarge.blockers.join(" "), /exceeds verified shares/i);
});

test("trade draft persistence remains bounded and never invents a live fill", () => {
  const drafts = Array.from({ length: 100 }, (_, index) => ({
    id: `draft-${index}`,
    symbol: "NET",
    side: "BUY",
    requestedDollars: 1,
    status: "blocked",
    createdAt: new Date(Date.UTC(2026, 7, 10, 0, index)).toISOString(),
    liveOrderPlaced: false,
  }));
  const normalized = normalizeTradeDrafts(drafts);

  assert.equal(normalized.length, 80);
  assert.equal(normalized[0].id, "draft-99");
  assert.equal(normalized.some((draft) => draft.liveOrderPlaced), false);
});

test("approved exact order becomes a two-minute one-use dispatch claim", () => {
  const current = snapshot();
  const draft = buildTradeDraft({ symbol: "NET", side: "BUY", requestedDollars: 10 }, current, { now: "2026-08-10T17:00:00.000Z" });
  const approval = approvedApproval(draft);
  const approved = tradeDraftWithApprovalState({ ...draft, approvalId: approval.id }, [approval], { now: "2026-08-10T17:00:20.000Z" });
  assert.throws(
    () => claimApprovedDispatch({ ...approved, clientRefId: "tampered-ref" }, approval, current, { now: "2026-08-10T17:00:20.000Z" }),
    /reference ID does not match/i,
  );
  const tamperedApproval = {
    ...approval,
    grantedDetails: {
      ...approval.grantedDetails,
      executionEnvelope: {
        ...approval.grantedDetails.executionEnvelope,
        reviewArgs: { ...approval.grantedDetails.executionEnvelope.reviewArgs, symbol: "BAD" },
      },
    },
  };
  assert.throws(
    () => claimApprovedDispatch(approved, tamperedApproval, current, { now: "2026-08-10T17:00:20.000Z" }),
    /review\/placement contract does not match/i,
  );
  const claimed = claimApprovedDispatch(approved, approval, current, { now: "2026-08-10T17:00:20.000Z" });

  assert.equal(approved.status, "approved");
  assert.equal(claimed.draft.status, "dispatch_claimed");
  assert.equal(claimed.draft.liveOrderPlaced, false);
  assert.equal(claimed.claim.token.length, 64);
  assert.equal(claimed.claim.envelope.fingerprint, draft.fingerprint);
  assert.match(claimed.claim.policy, /review_equity_order first/i);
  assert.throws(
    () => claimApprovedDispatch(claimed.draft, approval, current, { now: "2026-08-10T17:00:30.000Z" }),
    /already has a dispatch claim|not approved for dispatch/i,
  );
  const expired = tradeDraftWithApprovalState(claimed.draft, [approval], { now: "2026-08-10T17:03:00.000Z" });
  assert.equal(expired.status, "expired");
  assert.match(expired.lastDispatchError, /handoff expired/i);
});

test("broker review warnings consume the one-use approval without recording an order", () => {
  const current = snapshot();
  const draft = buildTradeDraft({ symbol: "NET", side: "BUY", requestedDollars: 10 }, current, { now: "2026-08-10T17:00:00.000Z" });
  const approval = approvedApproval(draft);
  const claimed = claimApprovedDispatch({ ...draft, approvalId: approval.id, status: "approved" }, approval, current, { now: "2026-08-10T17:00:20.000Z" });
  const settled = settleApprovedDispatch(claimed.draft, approval, {
    reviewPassed: false,
    warnings: ["Robinhood review returned an account restriction."],
    placementAttempted: false,
  }, claimed.claim.token, { now: "2026-08-10T17:00:40.000Z" });

  assert.equal(settled.liveOrderPlaced, false);
  assert.equal(settled.draft.status, "review_rejected");
  assert.equal(settled.draft.dispatchAttempts, 1);
  assert.equal(settled.approval.useCount, 1);
  assert.ok(settled.approval.consumedAt);
});

test("a passing review records one broker order ID and blocks replay", () => {
  const current = snapshot();
  const draft = buildTradeDraft({ symbol: "NET", side: "BUY", requestedDollars: 10 }, current, { now: "2026-08-10T17:00:00.000Z" });
  const approval = approvedApproval(draft);
  const claimed = claimApprovedDispatch({ ...draft, approvalId: approval.id, status: "approved" }, approval, current, { now: "2026-08-10T17:00:20.000Z" });
  const settled = settleApprovedDispatch(claimed.draft, approval, {
    reviewPassed: true,
    warnings: [],
    placementAttempted: true,
    brokerOrderId: "rh-order-123",
    brokerState: "queued",
  }, claimed.claim.token, { now: "2026-08-10T17:00:40.000Z" });

  assert.equal(settled.liveOrderPlaced, true);
  assert.equal(settled.draft.status, "dispatched");
  assert.equal(settled.draft.brokerOrderId, "rh-order-123");
  assert.equal(settled.approval.executionOutcome, "broker_order_recorded");
  assert.throws(
    () => settleApprovedDispatch(settled.draft, settled.approval, { reviewPassed: true }, claimed.claim.token, { now: "2026-08-10T17:00:50.000Z" }),
    /already been consumed|no active dispatch claim|already been recorded/i,
  );
});

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  brokerControlOverview,
  buildCopyPortfolioPlan,
  buildTradeDraft,
  claimApprovedDispatch,
  executionEnvelope,
  normalizeTradeDrafts,
  portfolioCapitalState,
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
      accountIdentityHash: "b".repeat(64),
      accountValue: "$100.00",
      cash: "$100.00",
      buyingPower: "$100.00",
      dayPnlDollars: 0,
      positions: [],
      openOrders: [],
      orders: [],
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
      stopLoss: 95,
      dataFresh: true,
      lastUpdated: "2026-08-10T16:59:00.000Z",
      mainReason: "Trend and risk structure aligned.",
      mainRisk: "Use a hard stop.",
      target1: 110,
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
  assert.equal(control.accountValueDollars, 100);
  assert.equal(control.cashDollars, 100);
  assert.equal(control.buyingPowerDollars, 100);
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
  assert.equal(envelope.accountIdentityHash, "b".repeat(64));
});

test("manual Human Gate orders do not depend on the separate legacy auto-readiness report", () => {
  const current = snapshot({ readiness: { readyForLiveAuto: false, blockers: ["legacy autonomous planner is not armed"] } });
  const control = brokerControlOverview(current, { now: "2026-08-10T17:00:00.000Z" });
  const draft = buildTradeDraft({ symbol: "NET", side: "BUY", requestedDollars: 10 }, current, { now: "2026-08-10T17:00:00.000Z" });

  assert.equal(control.liveReady, true);
  assert.equal(draft.status, "ready_for_broker_review");
  assert.equal(draft.checks.some((check) => check.name === "live_readiness"), false);
  assert.equal(draft.blockers.some((blocker) => /auto|live-readiness/i.test(blocker)), false);
});

test("missing broker balances remain unknown instead of being presented as zero", () => {
  const current = snapshot({ broker: { ...snapshot().broker, accountValue: null, cash: null, buyingPower: null } });
  const control = brokerControlOverview(current, { now: "2026-08-10T17:00:00.000Z" });
  assert.equal(control.accountValueDollars, null);
  assert.equal(control.cashDollars, null);
  assert.equal(control.buyingPowerDollars, null);
  assert.match(control.blockers.join(" "), /buying power is unavailable or zero/i);
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

test("Codex registration is reported separately from the unlinked Stock Office session", () => {
  const current = snapshot({
    broker: {
      ...snapshot().broker,
      configured: false,
      account: "",
      accountIdentityHash: "",
      buyingPower: null,
      updatedAt: null,
      connector: {
        registered: true,
        codexRegistered: true,
        appRegistered: false,
        registrationSource: "codex_config",
        oauthAuthenticated: false,
        endpoint: ROBINHOOD_MCP_URL,
        observedAt: null,
        tools: [],
      },
    },
  });
  const control = brokerControlOverview(current, { now: "2026-08-10T17:00:00.000Z" });

  assert.equal(control.registrationStatus, "registered_in_codex");
  assert.equal(control.connectorStatus, "stock_office_link_required");
  assert.equal(control.authenticationVerified, false);
  assert.match(control.blockers[0], /registered.*Stock Office app session.*not linked/i);
  assert.equal(control.blockers.some((item) => /tools are missing/i.test(item)), false);
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

test("order review expiry uses the configured Human Gate window", () => {
  const draft = buildTradeDraft(
    { symbol: "NET", side: "BUY", requestedDollars: 10 },
    snapshot(),
    { now: "2026-08-10T17:00:00.000Z", approvalTtlMinutes: 15 },
  );

  assert.equal(draft.expiresAt, "2026-08-10T17:15:00.000Z");
});

test("copy-entry planner requires an explicitly followed and mirror-enabled source", () => {
  const candidate = {
    id: "candidate-net",
    fingerprint: "d".repeat(64),
    sourceId: "sec_form4",
    traderName: "Named reporting person",
    assetType: "equity",
    symbol: "NET",
    side: "BUY",
    status: "paper_ready",
    humanGateEligible: true,
    currentPrice: 100,
    rankingScore: 0.95,
    mirrorNotionalDollars: 5,
  };
  const base = snapshot({ mirror: { stale: false, candidates: [candidate] } });
  const disabled = buildCopyPortfolioPlan({
    ...base,
    intelligence: { mirror: { sources: [{ id: "sec_form4", following: true, mirrorEnabled: false }] } },
  }, { now: "2026-08-10T17:00:00.000Z" });
  const enabled = buildCopyPortfolioPlan({
    ...base,
    intelligence: { mirror: { sources: [{ id: "sec_form4", following: true, mirrorEnabled: true }] } },
  }, { now: "2026-08-10T17:00:00.000Z" });

  assert.equal(disabled.proposals.some((proposal) => proposal.kind === "copy_entry"), false);
  assert.equal(enabled.proposals.some((proposal) => proposal.kind === "copy_entry"), true);
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

test("allocated-capital, daily-loss, daily-trade, concentration, and stop-risk limits are enforced", () => {
  const owned = { symbol: "MSFT", quantity: 0.9, sharesAvailableForSells: 0.9, currentPrice: 100 };
  const base = snapshot({
    broker: { ...snapshot().broker, positions: [owned], buyingPower: "$100.00" },
    positions: [owned],
    guardrails: { ...snapshot().guardrails, maxTotalDollars: 100, maxPositions: 2 },
  });
  const capital = portfolioCapitalState(base, { now: "2026-08-10T17:00:00.000Z" });
  const overDeployed = buildTradeDraft({ symbol: "NET", side: "BUY", requestedDollars: 20 }, base, { now: "2026-08-10T17:00:00.000Z" });
  assert.equal(capital.deployedDollars, 90);
  assert.equal(capital.availableForNewBuys, 10);
  assert.match(overDeployed.blockers.join(" "), /remaining deployable capital/i);

  const lossLocked = snapshot({ broker: { ...snapshot().broker, dayPnlDollars: -2 } });
  assert.match(buildTradeDraft({ symbol: "NET", side: "BUY", requestedDollars: 10 }, lossLocked, { now: "2026-08-10T17:00:00.000Z" }).blockers.join(" "), /daily-loss lock/i);

  const orders = Array.from({ length: 3 }, (_, index) => ({
    orderId: `order-${index}`,
    symbol: "AAPL",
    side: "BUY",
    state: "filled",
    dollarAmount: 1,
    createdAt: `2026-08-10T1${index}:00:00.000Z`,
  }));
  const tradeLocked = snapshot({ broker: { ...snapshot().broker, orders } });
  assert.match(buildTradeDraft({ symbol: "NET", side: "BUY", requestedDollars: 10 }, tradeLocked, { now: "2026-08-10T17:00:00.000Z" }).blockers.join(" "), /daily limit/i);

  const concentrated = snapshot({
    broker: { ...snapshot().broker, positions: [{ symbol: "NET", quantity: 0.15, sharesAvailableForSells: 0.15, currentPrice: 100 }] },
    positions: [{ symbol: "NET", quantity: 0.15, sharesAvailableForSells: 0.15, currentPrice: 100 }],
  });
  assert.match(buildTradeDraft({ symbol: "NET", side: "BUY", requestedDollars: 10 }, concentrated, { now: "2026-08-10T17:00:00.000Z" }).blockers.join(" "), /per-symbol allocation/i);

  const wideStop = snapshot({ records: [{ ...snapshot().records[0], stopLoss: 90 }] });
  assert.match(buildTradeDraft({ symbol: "NET", side: "BUY", requestedDollars: 15 }, wideStop, { now: "2026-08-10T17:00:00.000Z" }).blockers.join(" "), /risk-per-trade sizing/i);
});

test("missing official day P&L or order history evidence blocks new entries but not owned-position exits", () => {
  const position = { symbol: "NET", quantity: 0.2, sharesAvailableForSells: 0.2, currentPrice: 100 };
  const current = snapshot({
    broker: { ...snapshot().broker, dayPnlDollars: null, orders: undefined, positions: [position] },
    positions: [position],
  });
  const buy = buildTradeDraft({ symbol: "NET", side: "BUY", requestedDollars: 5 }, current, { now: "2026-08-10T17:00:00.000Z" });
  const sell = buildTradeDraft({ symbol: "NET", side: "SELL", requestedDollars: 5 }, current, { now: "2026-08-10T17:00:00.000Z" });
  assert.match(buy.blockers.join(" "), /P&L|order history/i);
  assert.equal(sell.status, "ready_for_broker_review");
});

test("copy portfolio planner prioritizes owned-position exits and only marks fully checked drafts ready", () => {
  const position = { symbol: "NET", quantity: 0.2, sharesAvailableForSells: 0.2, currentPrice: 100 };
  const exitSignal = {
    id: "copy-exit-net",
    fingerprint: "c".repeat(64),
    traderName: "Named reporting owner",
    assetType: "equity",
    symbol: "NET",
    side: "SELL",
    status: "research_only",
    humanGateEligible: false,
    brokerPositionRequired: true,
    currentPrice: 100,
    rankingScore: 0.9,
    mirrorNotionalDollars: 0,
  };
  const current = snapshot({
    broker: { ...snapshot().broker, positions: [position] },
    positions: [position],
    mirror: { stale: false, generatedAt: "2026-08-10T16:59:00.000Z", candidates: [exitSignal] },
  });
  const plan = buildCopyPortfolioPlan(current, { now: "2026-08-10T17:00:00.000Z" });
  assert.equal(plan.proposals[0].kind, "copy_exit");
  assert.equal(plan.proposals[0].side, "SELL");
  assert.equal(plan.proposals[0].draftEligible, true);
  assert.equal(plan.summary.copyExits, 1);
  assert.equal(plan.warnings.some((item) => /Human Gate/.test(item)), true);
});

test("portfolio proposals expose research, target scenarios, and an explicitly unknown profit date", () => {
  const plan = buildCopyPortfolioPlan(snapshot(), { now: "2026-08-10T17:00:00.000Z" });
  const proposal = plan.proposals.find((item) => item.symbol === "NET" && item.side === "BUY");

  assert.ok(proposal);
  assert.equal(proposal.requestedDollars, 20);
  assert.equal(proposal.research.score, 90);
  assert.match(proposal.research.mainReason, /Trend and risk structure aligned/i);
  assert.equal(proposal.outlook.targetPrice, 110);
  assert.equal(proposal.outlook.targetReturnPct, 0.1);
  assert.equal(proposal.outlook.targetScenarioDollars, 2);
  assert.ok(proposal.research.checksPassed <= proposal.research.checksTotal);
  assert.equal(proposal.outlook.profitTimingKnown, false);
  assert.match(proposal.outlook.timingNote, /No profit date can be estimated reliably/i);
  assert.match(proposal.outlook.horizonLabel, /5-minute market cycle/i);
});

test("owned positions without an exit trigger appear as HOLD while SELL remains prioritized", () => {
  const position = { symbol: "MSFT", quantity: 0.2, sharesAvailableForSells: 0.2, currentPrice: 100 };
  const current = snapshot({
    broker: { ...snapshot().broker, positions: [position] },
    positions: [position],
  });
  const plan = buildCopyPortfolioPlan(current, { now: "2026-08-10T17:00:00.000Z" });
  const hold = plan.proposals.find((item) => item.symbol === "MSFT" && item.side === "HOLD");

  assert.ok(hold);
  assert.equal(hold.kind, "position_hold");
  assert.equal(hold.monitoring, true);
  assert.equal(hold.draftEligible, false);
  assert.equal(hold.blockers.length, 0);
  assert.equal(plan.summary.holds, 1);
  assert.ok(plan.proposals.findIndex((item) => item.side === "HOLD") < plan.proposals.findIndex((item) => item.side === "BUY"));
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
  const envelope = executionEnvelope(draft);
  assert.equal(envelope.reviewArgs.quantity, "0.1");
  assert.equal(envelope.placementArgs.quantity, "0.1");
  assert.equal(envelope.reviewArgs.dollar_amount, undefined);
  assert.equal(envelope.placementArgs.ref_id, draft.clientRefId);
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

test("exact SELL approval binds share quantity and rejects quantity tampering", () => {
  const position = { symbol: "NET", quantity: 0.2, sharesAvailableForSells: 0.2, currentPrice: 100 };
  const current = snapshot({
    broker: { ...snapshot().broker, positions: [position] },
    positions: [position],
  });
  const draft = buildTradeDraft({ symbol: "NET", side: "SELL", requestedDollars: 10 }, current, { now: "2026-08-10T17:00:00.000Z" });
  const approval = approvedApproval(draft);
  const tampered = {
    ...approval,
    grantedDetails: {
      ...approval.grantedDetails,
      executionEnvelope: {
        ...approval.grantedDetails.executionEnvelope,
        args: { ...approval.grantedDetails.executionEnvelope.args, quantity: "0.2" },
        placementArgs: { ...approval.grantedDetails.executionEnvelope.placementArgs, quantity: "0.2" },
      },
    },
  };

  assert.throws(
    () => claimApprovedDispatch({ ...draft, approvalId: approval.id, status: "approved" }, tampered, current, { now: "2026-08-10T17:00:20.000Z" }),
    /contract does not match|sell quantity does not match/i,
  );
  const claimed = claimApprovedDispatch({ ...draft, approvalId: approval.id, status: "approved" }, approval, current, { now: "2026-08-10T17:00:20.000Z" });
  assert.equal(claimed.claim.envelope.placementArgs.quantity, "0.1");
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
  assert.throws(
    () => claimApprovedDispatch(approved, approval, {
      ...current,
      guardrails: { ...current.guardrails, maxOrderDollars: 19 },
    }, { now: "2026-08-10T17:00:20.000Z" }),
    /evidence changed/i,
  );
  const changedButSafePnl = { ...current, broker: { ...current.broker, dayPnlDollars: 0.5 } };
  const claimed = claimApprovedDispatch(approved, approval, changedButSafePnl, { now: "2026-08-10T17:00:20.000Z" });

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

test("operator-reported placement JSON cannot invent a verified live order", () => {
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

  assert.equal(settled.liveOrderPlaced, false);
  assert.equal(settled.reconciliationRequired, true);
  assert.equal(settled.draft.status, "reconciliation_required");
  assert.equal(settled.draft.brokerReconciled, false);
  assert.equal(settled.draft.brokerOrderId, "rh-order-123");
  assert.equal(settled.approval.executionOutcome, "placement_outcome_unverified");
  assert.throws(
    () => settleApprovedDispatch(settled.draft, settled.approval, { reviewPassed: true }, claimed.claim.token, { now: "2026-08-10T17:00:50.000Z" }),
    /already been consumed|no active dispatch claim|already been recorded/i,
  );
});

test("only trusted official reconciliation records a live Robinhood order", () => {
  const current = snapshot();
  const draft = buildTradeDraft({ symbol: "NET", side: "BUY", requestedDollars: 10 }, current, { now: "2026-08-10T17:00:00.000Z" });
  const approval = approvedApproval(draft);
  const claimed = claimApprovedDispatch({ ...draft, approvalId: approval.id, status: "approved" }, approval, current, { now: "2026-08-10T17:00:20.000Z" });
  const settled = settleApprovedDispatch(claimed.draft, approval, {
    reviewPassed: true,
    warnings: [],
    placementAttempted: true,
    brokerOrderId: "rh-order-verified",
    brokerState: "queued",
    reconciliation: {
      matched: true,
      clientRefId: draft.clientRefId,
      accountIdentityHash: draft.accountIdentityHash,
      observedAt: "2026-08-10T17:00:38.000Z",
    },
  }, claimed.claim.token, { now: "2026-08-10T17:00:40.000Z", trustedBrokerResult: true });

  assert.equal(settled.liveOrderPlaced, true);
  assert.equal(settled.reconciliationRequired, false);
  assert.equal(settled.draft.status, "dispatched");
  assert.equal(settled.draft.brokerReconciled, true);
  assert.equal(settled.draft.brokerEvidenceSource, "official_robinhood_mcp");
  assert.equal(settled.approval.executionOutcome, "broker_order_verified");
});

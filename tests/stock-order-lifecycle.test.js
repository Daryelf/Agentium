const assert = require("node:assert/strict");
const test = require("node:test");

const { reconcileOrderDrafts } = require("../services/stock-order-lifecycle");

function submittedDraft(overrides = {}) {
  return {
    id: "stock-order-one",
    fingerprint: "a".repeat(64),
    symbol: "NET",
    side: "BUY",
    requestedDollars: 10,
    cappedDollars: 10,
    estimatedQuantity: 0.05,
    referencePrice: 200,
    status: "dispatched",
    brokerState: "queued",
    brokerOrderId: "broker-order-one",
    brokerReconciled: true,
    brokerEvidenceSource: "official_robinhood_mcp",
    liveOrderPlaced: true,
    createdAt: "2026-08-13T14:00:00.000Z",
    expiresAt: "2026-08-13T14:15:00.000Z",
    ...overrides,
  };
}

function ambiguousDraft(overrides = {}) {
  return submittedDraft({
    status: "reconciliation_required",
    brokerState: "unknown",
    brokerOrderId: "",
    brokerReconciled: false,
    liveOrderPlaced: false,
    dispatchAttempts: 1,
    brokerReviewPassed: true,
    dispatchClaimedAt: "2026-08-13T14:00:10.000Z",
    accountIdentityHash: "b".repeat(64),
    clientRefId: "client-ref-one",
    ...overrides,
  });
}

test("official broker order history advances submitted orders through partial and filled states", () => {
  const partial = reconcileOrderDrafts([submittedDraft()], {
    updatedAt: "2026-08-13T14:01:00.000Z",
    orders: [{ orderId: "broker-order-one", symbol: "NET", state: "partially_filled" }],
  });
  assert.equal(partial.changes.length, 1);
  assert.equal(partial.drafts[0].status, "partially_filled");
  assert.equal(partial.drafts[0].brokerState, "partially_filled");

  const filled = reconcileOrderDrafts(partial.drafts, {
    updatedAt: "2026-08-13T14:02:00.000Z",
    orders: [{ orderId: "broker-order-one", symbol: "NET", state: "filled" }],
  });
  assert.equal(filled.drafts[0].status, "filled");
  assert.equal(filled.drafts[0].liveOrderPlaced, true);
  assert.equal(filled.drafts[0].brokerEvidenceSource, "official_robinhood_mcp");
});

test("official cancellation and rejection states are preserved without inventing an order", () => {
  const cancelled = reconcileOrderDrafts([submittedDraft()], { orders: [{ orderId: "broker-order-one", state: "cancelled" }] }, { now: "2026-08-13T14:02:00.000Z" });
  assert.equal(cancelled.drafts[0].status, "cancelled");
  const rejected = reconcileOrderDrafts([submittedDraft()], { orders: [{ orderId: "broker-order-one", state: "rejected" }] }, { now: "2026-08-13T14:02:00.000Z" });
  assert.equal(rejected.drafts[0].status, "rejected");

  const unknown = reconcileOrderDrafts([{ ...submittedDraft(), liveOrderPlaced: false, brokerOrderId: "" }], { orders: [{ orderId: "other", state: "filled" }] });
  assert.equal(unknown.changes.length, 0);
  assert.equal(unknown.drafts[0].liveOrderPlaced, false);
});

test("unchanged broker state is idempotent", () => {
  const result = reconcileOrderDrafts([submittedDraft({ brokerState: "filled", status: "filled" })], { orders: [{ orderId: "broker-order-one", state: "filled" }] });
  assert.equal(result.changes.length, 0);
  assert.equal(result.drafts[0].status, "filled");
});

test("queued, cancel-pending, and unknown broker states remain explicit", () => {
  const queued = reconcileOrderDrafts([submittedDraft({ brokerState: "reviewed" })], { orders: [{ orderId: "broker-order-one", state: "queued" }] });
  assert.equal(queued.drafts[0].status, "submitted");
  const cancelling = reconcileOrderDrafts(queued.drafts, { orders: [{ orderId: "broker-order-one", state: "pending_cancel" }] });
  assert.equal(cancelling.drafts[0].status, "cancel_requested");
  const unknown = reconcileOrderDrafts(cancelling.drafts, { orders: [{ orderId: "broker-order-one", state: "broker_mystery" }] });
  assert.equal(unknown.drafts[0].status, "unknown_reconciling");
});

test("a unique official order resolves an ambiguous placement when Robinhood omits the client reference", () => {
  const result = reconcileOrderDrafts([ambiguousDraft()], {
    accountIdentityHash: "b".repeat(64),
    updatedAt: "2026-08-13T14:01:00.000Z",
    orders: [{
      orderId: "broker-recovered-one",
      clientRefId: "",
      symbol: "NET",
      side: "BUY",
      state: "filled",
      quantity: 0.0498,
      createdAt: "2026-08-13T14:00:14.000Z",
    }],
  });

  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].reason, "ambiguous_placement_reconciled");
  assert.equal(result.drafts[0].status, "filled");
  assert.equal(result.drafts[0].brokerOrderId, "broker-recovered-one");
  assert.equal(result.drafts[0].liveOrderPlaced, true);
  assert.equal(result.drafts[0].brokerReconciled, true);
  assert.equal(result.drafts[0].lastDispatchError, "");
});

test("ambiguous placement recovery fails closed on account mismatch, timing drift, or multiple candidates", () => {
  const order = {
    orderId: "broker-one",
    clientRefId: "",
    symbol: "NET",
    side: "BUY",
    state: "filled",
    quantity: 0.0498,
    createdAt: "2026-08-13T14:00:14.000Z",
  };
  const wrongAccount = reconcileOrderDrafts([ambiguousDraft()], { accountIdentityHash: "c".repeat(64), orders: [order] });
  const stale = reconcileOrderDrafts([ambiguousDraft()], { accountIdentityHash: "b".repeat(64), orders: [{ ...order, createdAt: "2026-08-13T14:05:00.000Z" }] });
  const duplicate = reconcileOrderDrafts([ambiguousDraft()], { accountIdentityHash: "b".repeat(64), orders: [order, { ...order, orderId: "broker-two" }] });

  assert.equal(wrongAccount.changes.length, 0);
  assert.equal(stale.changes.length, 0);
  assert.equal(duplicate.changes.length, 0);
  assert.equal(duplicate.drafts[0].status, "reconciliation_required");
});

test("an exact client reference can reconcile when the official notional details are absent", () => {
  const result = reconcileOrderDrafts([ambiguousDraft()], {
    accountIdentityHash: "b".repeat(64),
    orders: [{
      orderId: "broker-ref-match",
      clientRefId: "client-ref-one",
      symbol: "NET",
      side: "BUY",
      state: "queued",
      createdAt: "2026-08-13T14:00:11.000Z",
    }],
  });

  assert.equal(result.changes.length, 1);
  assert.equal(result.drafts[0].status, "submitted");
  assert.equal(result.drafts[0].brokerOrderId, "broker-ref-match");
});

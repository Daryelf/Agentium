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

test("official broker order history advances submitted orders through partial and filled states", () => {
  const partial = reconcileOrderDrafts([submittedDraft()], {
    updatedAt: "2026-08-13T14:01:00.000Z",
    orders: [{ orderId: "broker-order-one", symbol: "NET", state: "partially_filled" }],
  });
  assert.equal(partial.changes.length, 1);
  assert.equal(partial.drafts[0].status, "dispatched");
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

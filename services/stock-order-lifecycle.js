const { normalizeTradeDraft } = require("./stock-broker-control");

const FILLED_STATES = new Set(["filled", "complete", "completed"]);
const CANCELLED_STATES = new Set(["cancelled", "canceled", "expired"]);
const REJECTED_STATES = new Set(["rejected", "failed"]);

function appStatusForBrokerState(state) {
  const value = String(state || "").toLowerCase();
  if (FILLED_STATES.has(value)) return "filled";
  if (CANCELLED_STATES.has(value)) return "cancelled";
  if (REJECTED_STATES.has(value)) return "rejected";
  return "dispatched";
}

function reconcileOrderDrafts(drafts = [], brokerSnapshot = {}, options = {}) {
  const observedAt = options.now || brokerSnapshot.updatedAt || new Date().toISOString();
  const orders = Array.isArray(brokerSnapshot.orders) ? brokerSnapshot.orders : [];
  const orderById = new Map(orders.filter((order) => order?.orderId).map((order) => [String(order.orderId), order]));
  const changes = [];
  const nextDrafts = (Array.isArray(drafts) ? drafts : []).map((input) => {
    const draft = normalizeTradeDraft(input);
    if (draft.liveOrderPlaced !== true || !draft.brokerOrderId) return draft;
    const order = orderById.get(String(draft.brokerOrderId));
    if (!order?.state) return draft;
    const brokerState = String(order.state).toLowerCase();
    if (brokerState === draft.brokerState) return draft;
    const next = normalizeTradeDraft({
      ...draft,
      status: appStatusForBrokerState(brokerState),
      brokerState,
      brokerReconciled: true,
      brokerEvidenceSource: "official_robinhood_mcp",
      reconciliationObservedAt: brokerSnapshot.updatedAt || observedAt,
      updatedAt: observedAt,
    });
    changes.push({ before: draft, after: next, order });
    return next;
  });
  return { drafts: nextDrafts, changes };
}

module.exports = {
  appStatusForBrokerState,
  reconcileOrderDrafts,
};

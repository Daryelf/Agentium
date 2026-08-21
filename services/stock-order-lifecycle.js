const { normalizeTradeDraft } = require("./stock-broker-control");

const FILLED_STATES = new Set(["filled", "complete", "completed"]);
const CANCELLED_STATES = new Set(["cancelled", "canceled", "expired"]);
const REJECTED_STATES = new Set(["rejected", "failed"]);
const AMBIGUOUS_MATCH_EARLY_MS = 5_000;
const AMBIGUOUS_MATCH_LATE_MS = 120_000;
const AMBIGUOUS_BUY_QUANTITY_DRIFT = 0.025;

function appStatusForBrokerState(state) {
  const value = String(state || "").toLowerCase();
  if (FILLED_STATES.has(value)) return "filled";
  if (CANCELLED_STATES.has(value)) return "cancelled";
  if (REJECTED_STATES.has(value)) return "rejected";
  if (["partially_filled", "partial_fill", "partially-filled"].includes(value)) return "partially_filled";
  if (["pending_cancel", "cancel_pending", "cancel_requested"].includes(value)) return "cancel_requested";
  if (["queued", "confirmed", "submitted", "open", "pending"].includes(value)) return "submitted";
  return "unknown_reconciling";
}

function validTime(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function ambiguousOrderMatch(draft, orders, claimedOrderIds) {
  if (
    draft.status !== "reconciliation_required"
    || draft.liveOrderPlaced === true
    || draft.brokerOrderId
    || draft.dispatchAttempts !== 1
    || draft.brokerReviewPassed !== true
  ) return null;
  const dispatchTime = validTime(draft.dispatchClaimedAt);
  if (dispatchTime === null) return null;
  const exactReferenceMatches = [];
  const brokerOmittedReferenceMatches = [];
  for (const order of orders) {
    if (!order?.orderId || claimedOrderIds.has(String(order.orderId))) continue;
    if (String(order.symbol || "").toUpperCase() !== draft.symbol || String(order.side || "").toUpperCase() !== draft.side) continue;
    const orderTime = validTime(order.createdAt);
    if (orderTime === null || orderTime < dispatchTime - AMBIGUOUS_MATCH_EARLY_MS || orderTime > dispatchTime + AMBIGUOUS_MATCH_LATE_MS) continue;
    const clientRefId = String(order.clientRefId || "");
    if (clientRefId) {
      if (clientRefId === draft.clientRefId) exactReferenceMatches.push(order);
      continue;
    }
    if (draft.side === "SELL") {
      const expectedQuantity = positiveNumber(draft.estimatedQuantity);
      const actualQuantity = positiveNumber(order.quantity);
      if (expectedQuantity === null || actualQuantity === null || Math.abs(actualQuantity - expectedQuantity) > 0.000001) continue;
    } else {
      const expectedDollars = positiveNumber(draft.cappedDollars);
      const actualDollars = positiveNumber(order.dollarAmount);
      if (actualDollars !== null) {
        if (expectedDollars === null || Math.abs(actualDollars - expectedDollars) > 0.01) continue;
      } else {
        const expectedQuantity = positiveNumber(draft.estimatedQuantity);
        const actualQuantity = positiveNumber(order.quantity);
        if (expectedQuantity === null || actualQuantity === null || Math.abs(actualQuantity - expectedQuantity) / expectedQuantity > AMBIGUOUS_BUY_QUANTITY_DRIFT) continue;
      }
    }
    brokerOmittedReferenceMatches.push(order);
  }
  if (exactReferenceMatches.length === 1) return exactReferenceMatches[0];
  if (exactReferenceMatches.length > 1) return null;
  return brokerOmittedReferenceMatches.length === 1 ? brokerOmittedReferenceMatches[0] : null;
}

function reconcileOrderDrafts(drafts = [], brokerSnapshot = {}, options = {}) {
  const observedAt = options.now || brokerSnapshot.updatedAt || new Date().toISOString();
  const orders = Array.isArray(brokerSnapshot.orders) ? brokerSnapshot.orders : [];
  const orderById = new Map(orders.filter((order) => order?.orderId).map((order) => [String(order.orderId), order]));
  const claimedOrderIds = new Set((Array.isArray(drafts) ? drafts : []).map((draft) => String(draft?.brokerOrderId || "")).filter(Boolean));
  const changes = [];
  const nextDrafts = (Array.isArray(drafts) ? drafts : []).map((input) => {
    const draft = normalizeTradeDraft(input);
    const accountMatches = Boolean(draft.accountIdentityHash)
      && draft.accountIdentityHash === String(brokerSnapshot.accountIdentityHash || "");
    const recoveredOrder = accountMatches ? ambiguousOrderMatch(draft, orders, claimedOrderIds) : null;
    if (recoveredOrder) {
      const brokerState = String(recoveredOrder.state || "").toLowerCase();
      const next = normalizeTradeDraft({
        ...draft,
        status: appStatusForBrokerState(brokerState),
        brokerOrderId: recoveredOrder.orderId,
        brokerState,
        brokerReconciled: true,
        brokerEvidenceSource: "official_robinhood_mcp",
        reconciliationObservedAt: brokerSnapshot.updatedAt || observedAt,
        lastDispatchError: "",
        liveOrderPlaced: true,
        updatedAt: observedAt,
      });
      claimedOrderIds.add(String(recoveredOrder.orderId));
      changes.push({ before: draft, after: next, order: recoveredOrder, reason: "ambiguous_placement_reconciled" });
      return next;
    }
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
    changes.push({ before: draft, after: next, order, reason: "broker_state_changed" });
    return next;
  });
  return { drafts: nextDrafts, changes };
}

module.exports = {
  appStatusForBrokerState,
  reconcileOrderDrafts,
};

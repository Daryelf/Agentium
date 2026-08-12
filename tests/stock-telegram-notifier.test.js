const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ALLOWED_EVENT_TYPES,
  APPROVAL_ACTION,
  createStockTelegramNotifier,
  formatVerifiedTradeMessage,
  secretHash,
} = require("../services/stock-telegram-notifier");

function fixture() {
  let settings = {};
  const secrets = {};
  const requests = [];
  const notifier = createStockTelegramNotifier({
    environment: {},
    now: () => new Date("2026-08-12T14:00:00.000Z"),
    getSetting: (_key, fallback) => settings || fallback,
    setSetting: (_key, value) => { settings = value; },
    getSecret: (provider) => secrets[provider] || "",
    setSecret: (provider, value) => { secrets[provider] = value; },
    deleteSecret: (provider) => { delete secrets[provider]; },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  });
  return { notifier, requests, settings: () => settings };
}

function approvalFor(scope) {
  return {
    id: "approval-telegram-1",
    status: "approved",
    actionType: APPROVAL_ACTION,
    expiresAt: "2027-08-12T14:00:00.000Z",
    grantedDetails: {
      channel: "telegram",
      destinationHash: scope.destinationHash,
      eventTypes: ALLOWED_EVENT_TYPES,
    },
  };
}

test("Telegram credentials stay private and require exact Human Gate scope", () => {
  const { notifier } = fixture();
  const configured = notifier.configure({ botToken: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd", chatId: "-1001234567890" });
  const scope = notifier.approvalScope();
  assert.equal(configured.configured, true);
  assert.equal(configured.enabled, false);
  assert.equal(configured.state, "approval_required");
  assert.equal(scope.destinationHash, secretHash("-1001234567890"));
  assert.doesNotMatch(JSON.stringify(configured), /ABCDEFGHIJKLMNOPQRSTUVWXYZ/);

  assert.throws(() => notifier.enable({ ...approvalFor(scope), grantedDetails: { channel: "telegram", destinationHash: "wrong", eventTypes: ALLOWED_EVENT_TYPES } }), /does not match/i);
  const approval = approvalFor(scope);
  assert.equal(notifier.enable(approval, [approval]).status.enabled, true);
});

test("only verified broker orders send, and the broker order ID is idempotent", async () => {
  const { notifier, requests, settings } = fixture();
  notifier.configure({ botToken: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd", chatId: "-1001234567890" });
  const approval = approvalFor(notifier.approvalScope());
  notifier.enable(approval, [approval]);

  const rejected = await notifier.notifyVerifiedTrade({ symbol: "DBX", status: "ready_for_broker_review", liveOrderPlaced: false }, [approval]);
  assert.equal(rejected.state, "ineligible");
  assert.equal(requests.length, 0);

  const draft = {
    symbol: "DBX",
    side: "BUY",
    requestedDollars: 5,
    estimatedQuantity: 0.147,
    status: "filled",
    brokerState: "filled",
    brokerOrderId: "broker-order-sensitive-1234",
    sourceType: "copy_signal",
    liveOrderPlaced: true,
  };
  const sent = await notifier.notifyVerifiedTrade(draft, [approval]);
  const duplicate = await notifier.notifyVerifiedTrade(draft, [approval]);
  assert.equal(sent.sent, true);
  assert.equal(duplicate.state, "duplicate");
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /api\.telegram\.org\/bot/);
  assert.match(requests[0].options.body, /Argentum verified BUY/);
  assert.doesNotMatch(requests[0].options.body, /broker-order-sensitive-1234/);
  assert.equal(settings().recent[0].kind, "verified_broker_order");
});

test("changing the Telegram destination revokes the prior standing permission", () => {
  const { notifier } = fixture();
  notifier.configure({ botToken: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd", chatId: "-1001234567890" });
  const approval = approvalFor(notifier.approvalScope());
  notifier.enable(approval, [approval]);
  assert.equal(notifier.publicStatus([approval]).enabled, true);

  notifier.configure({ botToken: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd", chatId: "-1005555555555" }, [approval]);
  assert.equal(notifier.publicStatus([approval]).enabled, false);
});

test("verified trade message contains trade facts but masks the broker order ID", () => {
  const message = formatVerifiedTradeMessage({
    symbol: "DBX",
    side: "SELL",
    requestedDollars: 12.5,
    status: "dispatched",
    brokerOrderId: "private-order-9876",
  }, new Date("2026-08-12T14:00:00.000Z"));
  assert.match(message, /Argentum verified SELL/);
  assert.match(message, /order ••••9876/);
  assert.doesNotMatch(message, /private-order-9876/);
});

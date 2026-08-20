const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ALLOWED_EVENT_TYPES,
  APPROVAL_ACTION,
  CONTROL_COMMANDS,
  createStockTelegramNotifier,
  formatVerifiedTradeMessage,
  formatQualifiedProposalMessage,
  secretHash,
} = require("../services/stock-telegram-notifier");

test("Telegram exposes concise read controls for watchlist and measured performance", () => {
  assert.ok(CONTROL_COMMANDS.includes("watchlist"));
  assert.ok(CONTROL_COMMANDS.includes("performance"));
});

function fixture(options = {}) {
  let settings = {};
  const secrets = {};
  const requests = [];
  const reserved = new Set();
  const notifier = createStockTelegramNotifier({
    environment: options.environment || {},
    now: options.now || (() => new Date("2026-08-12T14:00:00.000Z")),
    getSetting: (_key, fallback) => settings || fallback,
    setSetting: (_key, value) => { settings = value; },
    getSecret: (provider) => secrets[provider] || "",
    setSecret: (provider, value) => { secrets[provider] = value; },
    deleteSecret: (provider) => { delete secrets[provider]; },
    fetchImpl: options.fetchImpl || (async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }),
    reserveEvent: options.reserveEvent || ((event) => {
      const duplicate = reserved.has(event.idempotencyKey);
      reserved.add(event.idempotencyKey);
      return { id: `event-${reserved.size}`, duplicate };
    }),
    completeEvent: options.completeEvent || (() => {}),
    commandContext: options.commandContext,
    approvalAction: options.approvalAction,
    watchAction: options.watchAction,
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

test("ordinary rejected research candidates never generate Telegram risk spam", async () => {
  const { notifier, requests } = fixture();
  notifier.configure({ botToken: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd", chatId: "1234567890" });
  const approval = approvalFor(notifier.approvalScope());
  notifier.enable(approval, [approval]);
  const result = await notifier.notifySystemEvent({ kind: "risk_alert", eventId: "risk-one", text: "BUY score must be at least 85." }, [approval]);
  assert.equal(result.state, "ineligible");
  assert.equal(requests.length, 0);
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

test("qualified proposal alert requires a pending exact Human Gate request and is idempotent", async () => {
  const { notifier, requests } = fixture();
  notifier.configure({ botToken: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd", chatId: "-1001234567890" });
  const approval = approvalFor(notifier.approvalScope());
  notifier.enable(approval, [approval]);
  const proposal = { fingerprint: "a".repeat(64), symbol: "NET", side: "SELL", requestedDollars: 5, draftEligible: true, research: { sourceLabel: "Official filing" } };
  const draft = { fingerprint: "b".repeat(64), symbol: "NET", side: "SELL", requestedDollars: 5, cappedDollars: 5, status: "awaiting_human_gate" };
  const gate = { id: "approval-order-1234", status: "pending" };

  assert.equal((await notifier.notifyQualifiedProposal({ ...proposal, draftEligible: false }, draft, gate, [approval])).state, "ineligible");
  assert.equal((await notifier.notifyQualifiedProposal(proposal, draft, gate, [approval])).sent, true);
  assert.equal((await notifier.notifyQualifiedProposal(proposal, draft, gate, [approval])).state, "duplicate");
  assert.equal(requests.length, 1);
  assert.match(requests[0].options.body, /ARGENTUM SELL PROPOSAL/);
  assert.match(formatQualifiedProposalMessage(proposal, draft, gate), /No broker review or order has occurred/);
  const payload = JSON.parse(requests[0].options.body);
  assert.equal(payload.reply_markup.inline_keyboard[0][0].callback_data, `hg:a:${gate.id}`);
  assert.equal(payload.reply_markup.inline_keyboard[1][0].callback_data, `wt:${proposal.fingerprint.slice(0, 48)}`);
});

test("a failed Human Gate alert retries after a cooldown and still delivers only once", async () => {
  let at = new Date("2026-08-12T14:00:00.000Z");
  let requestCount = 0;
  const { notifier } = fixture({
    now: () => at,
    fetchImpl: async () => {
      requestCount += 1;
      if (requestCount === 1) return { ok: false, status: 503, json: async () => ({ ok: false }) };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  });
  notifier.configure({ botToken: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd", chatId: "-1001234567890" });
  const standing = approvalFor(notifier.approvalScope());
  notifier.enable(standing, [standing]);
  const proposal = { fingerprint: "a".repeat(64), symbol: "NET", side: "BUY", requestedDollars: 5, draftEligible: true };
  const draft = { fingerprint: "b".repeat(64), symbol: "NET", side: "BUY", requestedDollars: 5, cappedDollars: 5, status: "awaiting_human_gate" };
  const gate = { id: "approval-order-retry", status: "pending" };

  assert.equal((await notifier.notifyQualifiedProposal(proposal, draft, gate, [standing])).state, "failed");
  assert.equal((await notifier.notifyQualifiedProposal(proposal, draft, gate, [standing])).state, "retry_wait");
  assert.equal(requestCount, 1);
  at = new Date(at.getTime() + 30_001);
  assert.equal((await notifier.notifyQualifiedProposal(proposal, draft, gate, [standing])).sent, true);
  assert.equal((await notifier.notifyQualifiedProposal(proposal, draft, gate, [standing])).state, "duplicate");
  assert.equal(requestCount, 2);
});

test("unauthorized Telegram users cannot invoke Human Gate", async () => {
  let approvalCalls = 0;
  const { notifier } = fixture({
    environment: {
      STOCK_GURU_TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
      STOCK_GURU_TELEGRAM_ALLOWED_USER_IDS: "42",
      STOCK_GURU_TELEGRAM_ALLOWED_CHAT_IDS: "-1001234567890",
    },
    approvalAction: async () => { approvalCalls += 1; return { text: "approved" }; },
  });
  const result = await notifier.processUpdate({
    update_id: 1,
    callback_query: { id: "callback-1", data: "hg:c:approval-one", from: { id: 99 }, message: { message_id: 7, chat: { id: -1001234567890 } } },
  }, { webhookSecret: "webhook-secret", approvals: [] });
  assert.equal(result.status, "unauthorized_actor");
  assert.equal(result.httpStatus, 403);
  assert.equal(approvalCalls, 0);
});

test("Telegram approval uses a final confirmation and duplicate callbacks are idempotent", async () => {
  const approvalCalls = [];
  const environment = {
    STOCK_GURU_TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
    STOCK_GURU_TELEGRAM_ALLOWED_USER_IDS: "42",
    STOCK_GURU_TELEGRAM_ALLOWED_CHAT_IDS: "-1001234567890",
  };
  const { notifier, requests } = fixture({
    environment,
    commandContext: async () => ({ text: "status" }),
    approvalAction: async (input) => { approvalCalls.push(input); return { text: "Approved through Human Gate.", toast: "Approved" }; },
  });
  notifier.configure({ botToken: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd", chatId: "-1001234567890" });
  const standing = approvalFor(notifier.approvalScope());
  notifier.enable(standing, [standing]);
  const base = { from: { id: 42 }, message: { message_id: 7, chat: { id: -1001234567890 } } };
  const first = await notifier.processUpdate({ update_id: 10, callback_query: { ...base, id: "tap-approve", data: "hg:a:trade-approval-one" } }, { webhookSecret: "webhook-secret", approvals: [standing] });
  assert.equal(first.status, "processed");
  assert.equal(approvalCalls.length, 0);
  const confirmationMessage = requests.map((request) => JSON.parse(request.options.body)).find((payload) => payload.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === "hg:c:trade-approval-one");
  assert.ok(confirmationMessage, "a final confirmation button should reference the immutable approval ID");

  const confirmed = await notifier.processUpdate({ update_id: 11, callback_query: { ...base, id: "tap-confirm", data: "hg:c:trade-approval-one" } }, { webhookSecret: "webhook-secret", approvals: [standing] });
  const duplicate = await notifier.processUpdate({ update_id: 11, callback_query: { ...base, id: "tap-confirm", data: "hg:c:trade-approval-one" } }, { webhookSecret: "webhook-secret", approvals: [standing] });
  assert.equal(confirmed.status, "processed");
  assert.equal(duplicate.status, "duplicate");
  assert.equal(approvalCalls.length, 1);
  assert.equal(approvalCalls[0].decision, "approve");
  assert.equal(approvalCalls[0].approvalId, "trade-approval-one");
});

test("local polling accepts a private configured chat without a public webhook", async () => {
  let settings = {};
  const secrets = {};
  const approvalCalls = [];
  const methods = [];
  const standingApprovals = [];
  const notifier = createStockTelegramNotifier({
    environment: {},
    controlTransport: "local_polling",
    now: () => new Date("2026-08-12T14:00:00.000Z"),
    getSetting: (_key, fallback) => settings || fallback,
    setSetting: (_key, value) => { settings = value; },
    getSecret: (provider) => secrets[provider] || "",
    setSecret: (provider, value) => { secrets[provider] = value; },
    reserveEvent: () => ({ id: "event-poll", duplicate: false }),
    completeEvent: () => {},
    approvalAction: async (input) => { approvalCalls.push(input); return { text: "Approved through Human Gate." }; },
    fetchImpl: async (url) => {
      const method = String(url).split("/").pop();
      methods.push(method);
      if (method === "getUpdates") return { ok: true, status: 200, json: async () => ({ ok: true, result: [{
        update_id: 77,
        callback_query: { id: "poll-confirm", data: "hg:c:trade-approval-poll", from: { id: 1234567890 }, message: { message_id: 9, chat: { id: 1234567890, type: "private" } } },
      }] }) };
      return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
    },
  });
  notifier.configure({ botToken: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd", chatId: "1234567890" });
  const standing = approvalFor(notifier.approvalScope());
  standingApprovals.push(standing);
  notifier.enable(standing, standingApprovals);

  assert.equal(notifier.publicStatus(standingApprovals).controlReady, true);
  assert.equal(notifier.publicStatus(standingApprovals).controlTransport, "local_polling");
  const result = await notifier.pollUpdates({ approvals: standingApprovals });
  assert.equal(result.processed, 1);
  assert.equal(approvalCalls.length, 1);
  assert.equal(approvalCalls[0].approvalId, "trade-approval-poll");
  assert.equal(settings.lastUpdateId, 77);
  assert.ok(methods.includes("getUpdates"));
  assert.ok(methods.includes("answerCallbackQuery"));
  assert.ok(methods.includes("sendMessage"));
});

test("Telegram webhook secret and per-user rate limit fail closed", async () => {
  const environment = {
    STOCK_GURU_TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
    STOCK_GURU_TELEGRAM_ALLOWED_USER_IDS: "42",
    STOCK_GURU_TELEGRAM_ALLOWED_CHAT_IDS: "-1001234567890",
    STOCK_GURU_TELEGRAM_RATE_LIMIT_PER_MINUTE: "3",
  };
  const { notifier } = fixture({ environment, commandContext: async () => ({ text: "ok" }) });
  assert.equal((await notifier.processUpdate({ update_id: 1 }, { webhookSecret: "wrong" })).status, "unauthorized_webhook");
  const update = (id) => ({ update_id: id, message: { message_id: id, text: "/status", from: { id: 42 }, chat: { id: -1001234567890 } } });
  await notifier.processUpdate(update(2), { webhookSecret: "webhook-secret", approvals: [] });
  await notifier.processUpdate(update(3), { webhookSecret: "webhook-secret", approvals: [] });
  await notifier.processUpdate(update(4), { webhookSecret: "webhook-secret", approvals: [] });
  const limited = await notifier.processUpdate(update(5), { webhookSecret: "webhook-secret", approvals: [] });
  assert.equal(limited.status, "rate_limited");
  assert.equal(limited.httpStatus, 429);
});

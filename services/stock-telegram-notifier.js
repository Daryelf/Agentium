const crypto = require("node:crypto");

const SETTINGS_KEY = "stock_telegram_notifications_v1";
const TOKEN_PROVIDER = "stock_guru_telegram_bot_token";
const CHAT_PROVIDER = "stock_guru_telegram_chat_id";
const APPROVAL_ACTION = "enable_stock_trade_telegram_notifications";
const ALLOWED_EVENT_TYPES = [
  "qualified_trade_proposal",
  "verified_broker_order",
  "operator_test",
  "risk_alert",
  "source_failure",
  "broker_failure",
  "order_rejected",
  "order_cancelled",
  "overnight_report",
  "morning_report",
  "system_health",
];
const MAX_RECENT = 12;
const CONTROL_COMMANDS = ["status", "portfolio", "positions", "opportunities", "pending", "research", "overnight", "morning", "mirror", "sources", "risk", "health", "help", "symbol"];

function isoNow(nowFn) {
  return nowFn().toISOString();
}

function secretHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function destinationHint(chatId) {
  const value = String(chatId || "").trim();
  return value ? `Telegram ••••${value.slice(-4)}` : "Telegram not configured";
}

function cleanError(value) {
  if (!value) return "";
  return String(value?.message || value)
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[REDACTED]")
    .replace(/(?:token|authorization|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(0, 240);
}

function normalizeSettings(value = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    enabled: input.enabled === true,
    approvalId: String(input.approvalId || "").slice(0, 160),
    destinationHash: String(input.destinationHash || "").slice(0, 128),
    enabledAt: input.enabledAt || null,
    disabledAt: input.disabledAt || null,
    lastSentAt: input.lastSentAt || null,
    lastError: cleanError(input.lastError || ""),
    deliveredEventIds: (Array.isArray(input.deliveredEventIds) ? input.deliveredEventIds : []).map(String).slice(-100),
    recent: (Array.isArray(input.recent) ? input.recent : []).filter((item) => item && typeof item === "object").slice(0, MAX_RECENT),
  };
}

function approvalDetails(approval = {}) {
  return approval.grantedDetails || approval.originalDetails || approval.details || {};
}

function approvalAuthorizes(approval, destinationHashValue) {
  if (!approval || approval.status !== "approved" || approval.actionType !== APPROVAL_ACTION) return false;
  if (approval.expiresAt && Date.parse(approval.expiresAt) <= Date.now()) return false;
  const details = approvalDetails(approval);
  const eventTypes = Array.isArray(details.eventTypes) ? details.eventTypes : [];
  return details.channel === "telegram"
    && details.destinationHash === destinationHashValue
    && ALLOWED_EVENT_TYPES.every((type) => eventTypes.includes(type));
}

function formatVerifiedTradeMessage(draft = {}, at = new Date()) {
  const side = String(draft.side || "").toUpperCase() === "SELL" ? "SELL" : "BUY";
  const dollars = Number(draft.cappedDollars || draft.requestedDollars || 0);
  const quantity = Number(draft.estimatedQuantity || 0);
  const brokerId = String(draft.brokerOrderId || "");
  return [
    `Argentum verified ${side}`,
    `${String(draft.symbol || "UNKNOWN").toUpperCase()} · $${dollars.toFixed(2)}${quantity > 0 ? ` · ${quantity.toFixed(6)} shares` : ""}`,
    `Robinhood: ${String(draft.brokerState || draft.status || "reconciled").replaceAll("_", " ")} · order ••••${brokerId.slice(-4)}`,
    `Source: ${String(draft.sourceType || "supervised review").replaceAll("_", " ")}`,
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(at),
  ].join("\n");
}

function formatQualifiedProposalMessage(proposal = {}, draft = {}, approval = {}, at = new Date()) {
  const side = String(proposal.side || draft.side || "").toUpperCase() === "SELL" ? "SELL" : "BUY";
  const dollars = Number(draft.cappedDollars || draft.requestedDollars || proposal.requestedDollars || 0);
  const source = proposal.traderName || proposal.research?.sourceLabel || draft.sourceType || "Stock Guru research";
  const scores = proposal.scores || {};
  const research = proposal.research || {};
  const outlook = proposal.outlook || {};
  const scoreLine = [
    Number.isFinite(Number(scores.ai)) ? `AI ${Math.round(Number(scores.ai))}` : null,
    Number.isFinite(Number(scores.technical)) ? `TECH ${Math.round(Number(scores.technical))}` : null,
    Number.isFinite(Number(scores.mirror)) ? `MIRROR ${Math.round(Number(scores.mirror))}` : null,
    Number.isFinite(Number(scores.risk)) ? `RISK ${Math.round(Number(scores.risk))}` : null,
  ].filter(Boolean).join(" · ");
  return [
    `ARGENTUM ${side} PROPOSAL`,
    `${String(proposal.symbol || draft.symbol || "UNKNOWN").toUpperCase()} · up to $${dollars.toFixed(2)}`,
    scoreLine || null,
    Number.isFinite(Number(proposal.referencePrice)) ? `Reference $${Number(proposal.referencePrice).toFixed(2)}` : null,
    research.entryZone ? `Entry ${research.entryZone}` : null,
    Number.isFinite(Number(outlook.stopPrice)) ? `Risk level $${Number(outlook.stopPrice).toFixed(2)}` : null,
    research.mainReason ? `Evidence: ${String(research.mainReason).slice(0, 220)}` : null,
    `Research: ${String(source).replaceAll("_", " ")}`,
    "Human Gate is waiting. No broker review or order has occurred.",
    `Request: ••••${String(approval.id || "").slice(-4)}`,
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(at),
  ].filter(Boolean).join("\n");
}

function createStockTelegramNotifier(options = {}) {
  const environment = options.environment || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const nowFn = options.now || (() => new Date());
  const getSetting = options.getSetting || (() => ({}));
  const setSetting = options.setSetting || (() => {});
  const getSecret = options.getSecret || (() => "");
  const setSecret = options.setSecret || (() => ({}));
  const deleteSecret = options.deleteSecret || (() => ({}));
  const reserveEvent = options.reserveEvent || (() => ({ id: "", duplicate: false }));
  const completeEvent = options.completeEvent || (() => {});
  const commandContext = options.commandContext || (async () => ({ text: "Command data is unavailable." }));
  const approvalAction = options.approvalAction || (async () => ({ text: "Human Gate action is unavailable." }));
  const watchAction = options.watchAction || (async () => ({ text: "Watch action is unavailable." }));
  const active = new Map();
  const inboundActivity = new Map();

  function allowedIds(value) {
    return new Set(String(value || "").split(/[\s,]+/).map((item) => item.trim()).filter(Boolean));
  }

  function inboundAuthorization(update = {}) {
    const message = update.message || update.callback_query?.message || {};
    const from = update.callback_query?.from || update.message?.from || {};
    const chatId = String(message.chat?.id || "");
    const userId = String(from.id || "");
    const configured = credentials();
    const allowedChats = allowedIds(environment.STOCK_GURU_TELEGRAM_ALLOWED_CHAT_IDS || configured.chatId);
    const allowedUsers = allowedIds(environment.STOCK_GURU_TELEGRAM_ALLOWED_USER_IDS);
    const reasons = [];
    if (!chatId || !allowedChats.has(chatId)) reasons.push("Telegram chat is not authorized.");
    if (!userId || !allowedUsers.has(userId)) reasons.push("Telegram user is not authorized.");
    return { authorized: reasons.length === 0, reasons, chatId, userId, messageId: String(message.message_id || "") };
  }

  function verifyWebhookSecret(value) {
    const expected = String(environment.STOCK_GURU_TELEGRAM_WEBHOOK_SECRET || "").trim();
    if (!expected || !value) return false;
    const left = Buffer.from(String(value));
    const right = Buffer.from(expected);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  function inboundRateLimit(userId) {
    const now = nowFn().getTime();
    const windowMs = 60_000;
    const maximum = Math.max(3, Math.min(120, Number(environment.STOCK_GURU_TELEGRAM_RATE_LIMIT_PER_MINUTE) || 20));
    const recent = (inboundActivity.get(userId) || []).filter((timestamp) => now - timestamp < windowMs);
    if (recent.length >= maximum) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1_000)) };
    recent.push(now);
    inboundActivity.set(userId, recent);
    if (inboundActivity.size > 250) {
      for (const [key, values] of inboundActivity) {
        if (!values.some((timestamp) => now - timestamp < windowMs)) inboundActivity.delete(key);
      }
    }
    return { allowed: true, remaining: maximum - recent.length };
  }

  function credentials() {
    const token = String(environment.STOCK_GURU_TELEGRAM_BOT_TOKEN || getSecret(TOKEN_PROVIDER) || "").trim();
    const chatId = String(environment.STOCK_GURU_TELEGRAM_CHAT_ID || getSecret(CHAT_PROVIDER) || "").trim();
    return { token, chatId };
  }

  function readSettings() {
    return normalizeSettings(getSetting(SETTINGS_KEY, {}));
  }

  function writeSettings(settings) {
    const normalized = normalizeSettings(settings);
    setSetting(SETTINGS_KEY, normalized);
    return normalized;
  }

  function publicStatus(approvals = []) {
    const { token, chatId } = credentials();
    const settings = readSettings();
    const destinationHashValue = chatId ? secretHash(chatId) : "";
    const approval = settings.approvalId ? approvals.find((item) => item?.id === settings.approvalId) : null;
    const authorized = settings.enabled && approvalAuthorizes(approval, destinationHashValue) && settings.destinationHash === destinationHashValue;
    return {
      configured: Boolean(token && chatId),
      enabled: authorized,
      state: !token || !chatId ? "setup_required" : authorized ? "active" : "approval_required",
      destination: destinationHint(chatId),
      lastSentAt: settings.lastSentAt,
      lastError: settings.lastError,
      recent: settings.recent.slice(0, 6),
      allowedEvents: ["Trade approvals", "Broker-confirmed orders", "Risk and source failures", "Night and morning reports", "System health", "Operator test"],
      controlReady: Boolean(token && chatId && environment.STOCK_GURU_TELEGRAM_WEBHOOK_SECRET && allowedIds(environment.STOCK_GURU_TELEGRAM_ALLOWED_USER_IDS).size),
      commands: CONTROL_COMMANDS.map((command) => `/${command}`),
      security: "Credentials remain server-side in Mac Keychain or environment variables.",
    };
  }

  function approvalScope() {
    const { token, chatId } = credentials();
    return {
      configured: Boolean(token && chatId),
      destination: destinationHint(chatId),
      destinationHash: chatId ? secretHash(chatId) : "",
      channel: "telegram",
      eventTypes: [...ALLOWED_EVENT_TYPES],
    };
  }

  function configure({ botToken, chatId }, approvals = []) {
    const token = String(botToken || "").trim();
    const destination = String(chatId || "").trim();
    if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error("Enter a valid Telegram bot token.");
    if (!/^-?\d{4,20}$/.test(destination)) throw new Error("Enter a numeric Telegram chat ID.");
    setSecret(TOKEN_PROVIDER, token);
    setSecret(CHAT_PROVIDER, destination);
    const previous = readSettings();
    const changed = previous.destinationHash && previous.destinationHash !== secretHash(destination);
    if (changed || previous.enabled) {
      writeSettings({ ...previous, enabled: false, approvalId: "", destinationHash: "", disabledAt: isoNow(nowFn), lastError: "" });
    }
    return publicStatus(approvals);
  }

  function removeConfiguration(approvals = []) {
    deleteSecret(TOKEN_PROVIDER);
    deleteSecret(CHAT_PROVIDER);
    const previous = readSettings();
    writeSettings({ ...previous, enabled: false, approvalId: "", destinationHash: "", disabledAt: isoNow(nowFn), lastError: "" });
    return publicStatus(approvals);
  }

  function enable(approval, approvals = []) {
    const { token, chatId } = credentials();
    if (!token || !chatId) throw new Error("Configure Telegram before enabling notifications.");
    const destinationHashValue = secretHash(chatId);
    if (!approvalAuthorizes(approval, destinationHashValue)) throw new Error("Human Gate approval does not match this Telegram destination and event scope.");
    const settings = writeSettings({
      ...readSettings(),
      enabled: true,
      approvalId: approval.id,
      destinationHash: destinationHashValue,
      enabledAt: isoNow(nowFn),
      disabledAt: null,
      lastError: "",
    });
    return { settings, status: publicStatus(approvals) };
  }

  function disable(approvals = []) {
    const settings = writeSettings({ ...readSettings(), enabled: false, disabledAt: isoNow(nowFn) });
    return { settings, status: publicStatus(approvals) };
  }

  async function telegramRequest(method, payload) {
    const { token } = credentials();
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(`Telegram returned status ${response.status}.`);
    return result;
  }

  async function deliver({ eventId, kind, text, replyMarkup = null, chatId: requestedChatId = "" }, approvals = []) {
    if (active.has(eventId)) return active.get(eventId);
    const task = (async () => {
      const status = publicStatus(approvals);
      if (!status.enabled) return { sent: false, state: status.state, reason: "Telegram notifications are not configured and Human Gate enabled." };
      const settings = readSettings();
      if (settings.deliveredEventIds.includes(eventId)) return { sent: false, state: "duplicate", reason: "This event was already delivered." };
      const { token, chatId } = credentials();
      try {
        const result = await telegramRequest("sendMessage", {
          chat_id: requestedChatId || chatId,
          text,
          disable_web_page_preview: true,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        });
        const sentAt = isoNow(nowFn);
        writeSettings({
          ...settings,
          lastSentAt: sentAt,
          lastError: "",
          deliveredEventIds: [...settings.deliveredEventIds, eventId].slice(-100),
          recent: [{ id: eventId, kind, status: "delivered", sentAt }, ...settings.recent].slice(0, MAX_RECENT),
        });
        return { sent: true, state: "delivered", sentAt };
      } catch (error) {
        const failedAt = isoNow(nowFn);
        const message = cleanError(error);
        writeSettings({
          ...settings,
          lastError: message,
          recent: [{ id: eventId, kind, status: "failed", sentAt: failedAt }, ...settings.recent].slice(0, MAX_RECENT),
        });
        return { sent: false, state: "failed", reason: message };
      }
    })().finally(() => active.delete(eventId));
    active.set(eventId, task);
    return task;
  }

  async function notifyVerifiedTrade(draft = {}, approvals = []) {
    if (draft.liveOrderPlaced !== true || !draft.brokerOrderId || !["dispatched", "filled"].includes(draft.status)) {
      return { sent: false, state: "ineligible", reason: "Only independently reconciled broker orders can be notified." };
    }
    const eventId = `broker-order:${secretHash(draft.brokerOrderId).slice(0, 24)}`;
    return deliver({ eventId, kind: "verified_broker_order", text: formatVerifiedTradeMessage(draft, nowFn()) }, approvals);
  }

  async function notifyQualifiedProposal(proposal = {}, draft = {}, approval = {}, approvals = []) {
    if (!proposal.draftEligible || !["BUY", "SELL"].includes(String(proposal.side || "").toUpperCase())) {
      return { sent: false, state: "ineligible", reason: "Only a fully qualified BUY or SELL proposal can be notified." };
    }
    if (!draft.fingerprint || !["ready_for_broker_review", "awaiting_human_gate"].includes(draft.status) || !approval.id || approval.status !== "pending") {
      return { sent: false, state: "ineligible", reason: "A fresh exact draft and pending Human Gate request are required before notification." };
    }
    const eventId = `qualified-proposal:${secretHash(`${proposal.fingerprint}:${approval.id}`).slice(0, 24)}`;
    const proposalId = String(proposal.id || proposal.fingerprint || "").slice(0, 48);
    return deliver({
      eventId,
      kind: "qualified_trade_proposal",
      text: formatQualifiedProposalMessage(proposal, draft, approval, nowFn()),
      replyMarkup: {
        inline_keyboard: [
          [
            { text: `APPROVE ${String(proposal.side || draft.side || "TRADE").toUpperCase()}`, callback_data: `hg:a:${approval.id}` },
            { text: "DECLINE", callback_data: `hg:d:${approval.id}` },
          ],
          [
            { text: "WATCH", callback_data: `wt:${proposalId}` },
            { text: "RESEARCH", callback_data: `rs:${String(proposal.symbol || draft.symbol || "").toUpperCase()}` },
            { text: "WHY?", callback_data: `wh:${proposalId}` },
          ],
        ],
      },
    }, approvals);
  }

  async function sendTest(approvals = []) {
    const eventId = `operator-test:${nowFn().getTime()}`;
    return deliver({
      eventId,
      kind: "operator_test",
      text: `Argentum Telegram check\nStock Office notifications are connected.\nQualified proposals and broker-confirmed orders can trigger approved alerts.`,
    }, approvals);
  }

  async function notifySystemEvent(event = {}, approvals = []) {
    const kind = String(event.kind || "");
    if (!ALLOWED_EVENT_TYPES.includes(kind) || ["qualified_trade_proposal", "verified_broker_order", "operator_test"].includes(kind)) {
      return { sent: false, state: "ineligible", reason: "This event type is not in the approved Telegram notification scope." };
    }
    return deliver({
      eventId: String(event.eventId || `${kind}:${secretHash(event.text).slice(0, 24)}`),
      kind,
      text: shortMessage(event.text),
      replyMarkup: event.replyMarkup || null,
    }, approvals);
  }

  async function sendCommandResponse(text, chatId, eventId, approvals = [], replyMarkup = null) {
    return deliver({ eventId, kind: "telegram_command_response", text: shortMessage(text), chatId, replyMarkup }, approvals);
  }

  function shortMessage(value) {
    return String(value || "No data available.").slice(0, 3900);
  }

  function parseCommand(value) {
    const text = String(value || "").trim();
    if (!text.startsWith("/")) return null;
    const [head, ...args] = text.split(/\s+/);
    const command = head.slice(1).split("@")[0].toLowerCase();
    return CONTROL_COMMANDS.includes(command) ? { command, args } : { command: "help", args: [] };
  }

  async function processUpdate(update = {}, input = {}) {
    if (!verifyWebhookSecret(input.webhookSecret)) {
      return { accepted: false, status: "unauthorized_webhook", httpStatus: 403 };
    }
    const authorization = inboundAuthorization(update);
    const updateId = String(update.update_id ?? "");
    const callback = update.callback_query || null;
    const callbackData = String(callback?.data || "");
    const idempotencyKey = callback ? `callback:${String(callback.id || updateId)}:${callbackData}` : `update:${updateId}`;
    const reservation = reserveEvent({
      updateId,
      idempotencyKey,
      eventType: callback ? "telegram.callback" : "telegram.command",
      actorId: authorization.userId,
      chatId: authorization.chatId,
      messageId: authorization.messageId,
      data: { callbackData, text: String(update.message?.text || "").slice(0, 200) },
    });
    if (reservation.duplicate) return { accepted: true, status: "duplicate", duplicate: true };
    if (!authorization.authorized) {
      completeEvent(reservation.id, { status: "unauthorized", error: authorization.reasons.join(" ") });
      return { accepted: false, status: "unauthorized_actor", httpStatus: 403 };
    }
    const rate = inboundRateLimit(authorization.userId);
    if (!rate.allowed) {
      completeEvent(reservation.id, { status: "rate_limited", error: `Retry after ${rate.retryAfterSeconds} seconds.` });
      return { accepted: false, status: "rate_limited", httpStatus: 429, retryAfterSeconds: rate.retryAfterSeconds };
    }
    const approvals = Array.isArray(input.approvals) ? input.approvals : [];
    try {
      let response;
      if (callback) {
        const [namespace, action, ...rest] = callbackData.split(":");
        const targetId = rest.join(":");
        if (namespace === "hg" && action === "a") {
          response = {
            text: `FINAL CONFIRMATION\nRequest ••••${targetId.slice(-4)}\nArgentum will run the same Human Gate and fresh broker/risk checks used by the web app. Confirming does not bypass any blocker.`,
            toast: "Final confirmation required",
            replyMarkup: {
              inline_keyboard: [[
                { text: "CONFIRM LIVE ORDER", callback_data: `hg:c:${targetId}` },
                { text: "CANCEL", callback_data: `hg:x:${targetId}` },
              ]],
            },
          };
        } else if (namespace === "hg" && ["c", "d"].includes(action)) {
          response = await approvalAction({
            approvalId: targetId,
            decision: action === "c" ? "approve" : "reject",
            actorType: "TELEGRAM",
            actorId: authorization.userId,
            chatId: authorization.chatId,
            messageId: authorization.messageId,
            idempotencyKey,
          });
        } else if (namespace === "hg" && action === "x") {
          response = { text: `Cancelled. Request ••••${targetId.slice(-4)} remains pending in Human Gate.`, toast: "Cancelled" };
        } else if (namespace === "wt") {
          response = await watchAction({ proposalId: [action, ...rest].filter(Boolean).join(":"), actorId: authorization.userId, idempotencyKey });
        } else if (["rs", "wh"].includes(namespace)) {
          response = await commandContext({ command: namespace === "rs" ? "research" : "why", args: [[action, ...rest].filter(Boolean).join(":")], actorId: authorization.userId });
        } else {
          response = { text: "This Telegram action is no longer valid. Refresh pending proposals." };
        }
        await telegramRequest("answerCallbackQuery", { callback_query_id: callback.id, text: shortMessage(response?.toast || response?.text || "Processed").slice(0, 180), show_alert: false }).catch(() => null);
      } else {
        const parsed = parseCommand(update.message?.text);
        response = await commandContext({ command: parsed?.command || "help", args: parsed?.args || [], actorId: authorization.userId });
      }
      const delivery = await sendCommandResponse(response?.text || response || "Processed.", authorization.chatId, `telegram-response:${idempotencyKey}`, approvals, response?.replyMarkup || null);
      completeEvent(reservation.id, { status: delivery.sent ? "processed" : delivery.state || "failed", error: delivery.sent ? "" : delivery.reason, data: { deliveryState: delivery.state } });
      return { accepted: true, status: delivery.sent ? "processed" : delivery.state, delivery };
    } catch (error) {
      completeEvent(reservation.id, { status: "failed", error: cleanError(error) });
      return { accepted: true, status: "failed", error: cleanError(error) };
    }
  }

  return {
    approvalScope,
    configure,
    disable,
    enable,
    notifyQualifiedProposal,
    notifySystemEvent,
    notifyVerifiedTrade,
    processUpdate,
    publicStatus,
    removeConfiguration,
    sendTest,
    verifyWebhookSecret,
  };
}

module.exports = {
  ALLOWED_EVENT_TYPES,
  APPROVAL_ACTION,
  CHAT_PROVIDER,
  CONTROL_COMMANDS,
  SETTINGS_KEY,
  TOKEN_PROVIDER,
  approvalAuthorizes,
  createStockTelegramNotifier,
  formatQualifiedProposalMessage,
  formatVerifiedTradeMessage,
  normalizeSettings,
  secretHash,
};

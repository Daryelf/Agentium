const crypto = require("node:crypto");

const SETTINGS_KEY = "stock_telegram_notifications_v1";
const TOKEN_PROVIDER = "stock_guru_telegram_bot_token";
const CHAT_PROVIDER = "stock_guru_telegram_chat_id";
const APPROVAL_ACTION = "enable_stock_trade_telegram_notifications";
const ALLOWED_EVENT_TYPES = ["verified_broker_order", "operator_test"];
const MAX_RECENT = 12;

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

function createStockTelegramNotifier(options = {}) {
  const environment = options.environment || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const nowFn = options.now || (() => new Date());
  const getSetting = options.getSetting || (() => ({}));
  const setSetting = options.setSetting || (() => {});
  const getSecret = options.getSecret || (() => "");
  const setSecret = options.setSecret || (() => ({}));
  const deleteSecret = options.deleteSecret || (() => ({}));
  const active = new Map();

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
      allowedEvents: ["Broker-confirmed buy or sell", "Operator-requested test"],
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

  async function deliver({ eventId, kind, text }, approvals = []) {
    if (active.has(eventId)) return active.get(eventId);
    const task = (async () => {
      const status = publicStatus(approvals);
      if (!status.enabled) return { sent: false, state: status.state, reason: "Telegram notifications are not configured and Human Gate enabled." };
      const settings = readSettings();
      if (settings.deliveredEventIds.includes(eventId)) return { sent: false, state: "duplicate", reason: "This event was already delivered." };
      const { token, chatId } = credentials();
      try {
        const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
          signal: AbortSignal.timeout(12_000),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.ok === false) throw new Error(`Telegram returned status ${response.status}.`);
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

  async function sendTest(approvals = []) {
    const eventId = `operator-test:${nowFn().getTime()}`;
    return deliver({
      eventId,
      kind: "operator_test",
      text: `Argentum Telegram check\nStock Office notifications are connected.\nOnly broker-confirmed orders can trigger automatic trade alerts.`,
    }, approvals);
  }

  return {
    approvalScope,
    configure,
    disable,
    enable,
    notifyVerifiedTrade,
    publicStatus,
    removeConfiguration,
    sendTest,
  };
}

module.exports = {
  ALLOWED_EVENT_TYPES,
  APPROVAL_ACTION,
  CHAT_PROVIDER,
  SETTINGS_KEY,
  TOKEN_PROVIDER,
  approvalAuthorizes,
  createStockTelegramNotifier,
  formatVerifiedTradeMessage,
  normalizeSettings,
  secretHash,
};

import WebSocket from "ws";
import { classifyMessageEmotes } from "./twitch-chat.js";

const RECONNECT_DELAY_MS = 5000;
const PUSHER_URL = "wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0-rc2&flash=false";

async function resolveChatroomId(channelName) {
  const response = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(channelName)}/chatroom`, {
    headers: { Accept: "application/json", "User-Agent": "Argentum OS local clipping office" }
  });
  if (!response.ok) throw new Error(`Kick chatroom lookup failed: ${response.status}`);
  const json = await response.json();
  const id = Number(json.id || json.chatroom?.id || 0);
  if (!Number.isFinite(id) || id <= 0) throw new Error("Kick did not return a chatroom id.");
  return id;
}

function parseKickMessage(raw) {
  let payload;
  try { payload = JSON.parse(raw); } catch { return null; }
  if (payload?.event === "pusher:connection_established" || payload?.event === "pusher_internal:subscription_succeeded") return null;
  if (!String(payload?.event || "").toLowerCase().includes("chat")) return null;
  let data = payload.data;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { return null; }
  }
  const messagePayload = data?.message && typeof data.message === "object" ? data.message : data;
  const message = String(messagePayload?.content || messagePayload?.message || messagePayload?.text || "").trim();
  const sender = messagePayload?.sender || messagePayload?.user || data?.sender || {};
  return message ? { message, userId: String(sender.id || sender.username || sender.slug || "") } : null;
}

export class KickChatMonitor {
  constructor({ channelName, chatroomId = 0, onSpike, onMessage, onTension, onError, windowMs = 10000, spikeThreshold = 30, spikeCooldownMs = 20000, tensionCooldownMs = 30000, tensionSpikeThreshold = 8 } = {}) {
    this.channelName = String(channelName || "").replace(/^#/, "").toLowerCase();
    this.onSpike = onSpike || (() => {});
    this.onMessage = onMessage || (() => {});
    this.onTension = onTension || (() => {});
    this.onError = onError || (() => {});
    this.windowMs = windowMs;
    this.spikeThreshold = spikeThreshold;
    this.spikeCooldownMs = spikeCooldownMs;
    this.tensionCooldownMs = tensionCooldownMs;
    this.tensionSpikeThreshold = tensionSpikeThreshold;
    this.ws = null;
    this.chatroomId = Number(chatroomId) || null;
    this.messages = [];
    this.emoteWindows = { tension: [], hype: [], comedy: [] };
    this.active = false;
    this.reconnectTimer = null;
    this.lastSpikeAt = 0;
    this.lastTensionAt = 0;
  }

  start() {
    if (!this.channelName || this.active) return;
    this.active = true;
    this.connect().catch((error) => {
      this.onError(error);
      this.scheduleReconnect();
    });
  }

  stop() {
    this.active = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.ws) this.ws.close();
    this.ws = null;
  }

  currentMessagesPerMinute() {
    this.prune(Date.now());
    return Math.round((this.messages.length / Math.max(1, this.windowMs)) * 60000);
  }

  currentEmoteDistribution() {
    this.pruneEmoteWindows(Date.now());
    const counts = Object.fromEntries(Object.entries(this.emoteWindows).map(([key, values]) => [key, values.length]));
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const dominant = !sorted[0]?.[1] ? "none" : sorted.length > 1 && sorted[0][1] === sorted[1][1] ? "mixed" : sorted[0][0];
    return { ...counts, dominant };
  }

  async connect() {
    if (!this.active) return;
    if (!this.chatroomId) {
      const response = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(this.channelName)}/chatroom`, {
        headers: { Accept: "application/json", "User-Agent": "Argentum OS local clipping office" }
      });
      if (!response.ok) throw new Error(`Kick chatroom lookup failed: ${response.status}`);
      const json = await response.json();
      this.chatroomId = Number(json.id || json.chatroom?.id || 0);
    }
    if (!this.chatroomId) throw new Error("Kick did not return a chatroom id.");
    this.ws = new WebSocket(PUSHER_URL);
    this.ws.on("open", () => {
      for (const channel of [`chatrooms.${this.chatroomId}.v2`, `chatroom_${this.chatroomId}`]) {
        this.ws.send(JSON.stringify({ event: "pusher:subscribe", data: { auth: "", channel } }));
      }
    });
    this.ws.on("message", (raw) => this.handlePayload(raw.toString()));
    this.ws.on("close", () => this.scheduleReconnect());
    this.ws.on("error", () => this.scheduleReconnect());
  }

  handlePayload(raw) {
    const parsed = parseKickMessage(raw);
    if (!parsed) return;
    const timestamp = Date.now();
    this.messages.push({ timestamp, message: parsed.message });
    this.prune(timestamp);
    const emoteBucket = classifyMessageEmotes(parsed.message);
    if (emoteBucket) this.emoteWindows[emoteBucket].push(timestamp);
    this.pruneEmoteWindows(timestamp);
    const messagesPerMinute = this.currentMessagesPerMinute();
    this.onMessage({ channel: this.channelName, message: parsed.message, userId: parsed.userId, emoteBucket, emoteDistribution: this.currentEmoteDistribution(), count: this.messages.length, messagesPerMinute, timestamp, source: "kick_chat_websocket" });
    const tensionCount = this.emoteWindows.tension.length;
    if (tensionCount >= this.tensionSpikeThreshold && timestamp - this.lastTensionAt >= this.tensionCooldownMs) {
      this.lastTensionAt = timestamp;
      this.onTension({ channel: this.channelName, tensionCount, messagesPerMinute, timestamp, message: "Kick chat tension emote spike detected" });
    }
    if (this.messages.length >= this.spikeThreshold && timestamp - this.lastSpikeAt >= this.spikeCooldownMs) {
      this.lastSpikeAt = timestamp;
      this.onSpike({ channel: this.channelName, message: parsed.message, messagesPerWindow: this.messages.length, messagesPerMinute, windowMs: this.windowMs, timestamp });
    }
  }

  prune(timestamp) {
    const cutoff = timestamp - this.windowMs;
    this.messages = this.messages.filter((item) => item.timestamp >= cutoff);
  }

  pruneEmoteWindows(timestamp) {
    const cutoff = timestamp - this.windowMs;
    for (const bucket of Object.keys(this.emoteWindows)) this.emoteWindows[bucket] = this.emoteWindows[bucket].filter((item) => item >= cutoff);
  }

  scheduleReconnect() {
    if (!this.active || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((error) => {
        this.onError(error);
        this.scheduleReconnect();
      });
    }, RECONNECT_DELAY_MS);
  }
}

import WebSocket from "ws";

const RECONNECT_DELAY_MS = 5000;
const EMOTE_BUCKETS = {
  tension: ["PauseChamp", "monkaS", "monkaGIGA", "widepeepoSad", "NOTED", "monkaHmm", "pepeHands"],
  hype: ["Pog", "PogChamp", "POGGERS", "EZ", "Clap", "HYPERS", "PogU", "FeelsGoodMan"],
  comedy: ["OMEGALUL", "LUL", "KEKW", "LULW", "pepeLaugh", "GIGACHAD"]
};

function parseChatMessage(line) {
  const match = line.match(/PRIVMSG\s+#[^\s]+\s+:(.*)$/);
  return match ? match[1].trim() : "";
}

function parseIrcTags(line) {
  if (!line.startsWith("@")) return {};
  const tagBlock = line.slice(1).split(" ")[0] || "";
  return Object.fromEntries(tagBlock.split(";").map((entry) => {
    const [key, value = ""] = entry.split("=");
    return [key, value];
  }).filter(([key]) => key));
}

function parseEmoteIdsFromTags(line) {
  const emotes = parseIrcTags(line).emotes || "";
  if (!emotes) return [];
  return emotes.split("/").map((entry) => entry.split(":")[0]).filter(Boolean);
}

export function classifyMessageEmotes(text = "") {
  const tokens = String(text || "").split(/\s+/).filter(Boolean);
  const lowerTokens = new Set(tokens.map((token) => token.toLowerCase()));
  const matches = Object.entries(EMOTE_BUCKETS).map(([bucket, names]) => ({
    bucket,
    count: names.filter((name) => lowerTokens.has(name.toLowerCase())).length
  })).filter((item) => item.count > 0);
  if (!matches.length) return null;
  matches.sort((a, b) => b.count - a.count);
  return matches[0].bucket;
}

export class TwitchChatMonitor {
  constructor({
    channelName,
    onSpike,
    onMessage,
    onTension,
    windowMs = 10000,
    spikeThreshold = 30,
    spikeCooldownMs = 20000,
    tensionCooldownMs = 30000,
    tensionSpikeThreshold = 8
  } = {}) {
    this.channelName = String(channelName || "").replace(/^#/, "").toLowerCase();
    this.onSpike = onSpike || (() => {});
    this.onMessage = onMessage || (() => {});
    this.onTension = onTension || (() => {});
    this.windowMs = windowMs;
    this.spikeThreshold = spikeThreshold;
    this.spikeCooldownMs = spikeCooldownMs;
    this.tensionCooldownMs = tensionCooldownMs;
    this.tensionSpikeThreshold = tensionSpikeThreshold;
    this.ws = null;
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
    this.connect();
  }

  stop() {
    this.active = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  currentMessagesPerMinute() {
    this.prune(Date.now());
    return Math.round((this.messages.length / Math.max(1, this.windowMs)) * 60000);
  }

  currentEmoteDistribution() {
    this.pruneEmoteWindows(Date.now());
    const counts = {
      tension: this.emoteWindows.tension.length,
      hype: this.emoteWindows.hype.length,
      comedy: this.emoteWindows.comedy.length
    };
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const dominant = !sorted[0][1]
      ? "none"
      : sorted.length > 1 && sorted[0][1] === sorted[1][1]
        ? "mixed"
        : sorted[0][0];
    return { ...counts, dominant };
  }

  connect() {
    if (!this.active) return;
    this.ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");

    this.ws.on("open", () => {
      this.ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
      this.ws.send("PASS oauth:justinfan12345");
      this.ws.send("NICK justinfan12345");
      this.ws.send(`JOIN #${this.channelName}`);
    });

    this.ws.on("message", (raw) => {
      const lines = raw.toString().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      for (const line of lines) this.handleLine(line);
    });

    this.ws.on("close", () => this.scheduleReconnect());
    this.ws.on("error", () => this.scheduleReconnect());
  }

  handleLine(line) {
    if (!this.ws) return;
    if (line.startsWith("PING")) {
      this.ws.send("PONG :tmi.twitch.tv");
      return;
    }
    if (!line.includes("PRIVMSG")) return;

    const timestamp = Date.now();
    const message = parseChatMessage(line);
    const tags = parseIrcTags(line);
    const emoteIds = parseEmoteIdsFromTags(line);
    this.messages.push({ timestamp, message });
    this.prune(timestamp);
    const emoteBucket = classifyMessageEmotes(message);
    if (emoteBucket) this.emoteWindows[emoteBucket].push(timestamp);
    this.pruneEmoteWindows(timestamp);
    const messagesPerMinute = this.currentMessagesPerMinute();

    this.onMessage({
      channel: this.channelName,
      message,
      emoteBucket,
      emoteIds,
      emoteDistribution: this.currentEmoteDistribution(),
      count: this.messages.length,
      messagesPerMinute,
      timestamp,
      userId: tags["user-id"] || tags["display-name"] || ""
    });

    const tensionCount = this.emoteWindows.tension.length;
    const tensionCooldownReady = timestamp - this.lastTensionAt >= this.tensionCooldownMs;
    if (tensionCount >= this.tensionSpikeThreshold && tensionCooldownReady) {
      this.lastTensionAt = timestamp;
      this.onTension({
        channel: this.channelName,
        tensionCount,
        messagesPerMinute,
        timestamp,
        message: "Tension emote spike detected - moment may be building"
      });
    }

    const cooldownReady = timestamp - this.lastSpikeAt >= this.spikeCooldownMs;
    if (this.messages.length >= this.spikeThreshold && cooldownReady) {
      this.lastSpikeAt = timestamp;
      this.onSpike({
        channel: this.channelName,
        message,
        messagesPerWindow: this.messages.length,
        messagesPerMinute,
        windowMs: this.windowMs,
        timestamp
      });
    }
  }

  prune(timestamp) {
    const cutoff = timestamp - this.windowMs;
    this.messages = this.messages.filter((item) => item.timestamp >= cutoff);
  }

  pruneEmoteWindows(timestamp) {
    const cutoff = timestamp - this.windowMs;
    for (const bucket of Object.keys(this.emoteWindows)) {
      this.emoteWindows[bucket] = this.emoteWindows[bucket].filter((item) => item >= cutoff);
    }
  }

  scheduleReconnect() {
    if (!this.active || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY_MS);
  }
}

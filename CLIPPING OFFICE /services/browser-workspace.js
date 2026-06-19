import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const DEFAULT_POLICIES = [
  { domain: "streamclipper.local", mode: "automated", actions: ["navigate", "screenshot", "read"], notes: "Internal workspace." },
  { domain: "localhost", mode: "automated", actions: ["navigate", "screenshot", "read"], notes: "Local development only." },
  { domain: "127.0.0.1", mode: "automated", actions: ["navigate", "screenshot", "read"], notes: "Local development only." },
  { domain: "example.com", mode: "read_only", actions: ["navigate", "screenshot", "read"], notes: "Safe browser smoke-test target." },
  { domain: "capcut.com", mode: "human_only", actions: ["navigate", "screenshot", "download"], notes: "Manual edit handoff. Agent does not operate CapCut UI." },
  { domain: "www.capcut.com", mode: "human_only", actions: ["navigate", "screenshot", "download"], notes: "Manual edit handoff. Agent does not operate CapCut UI." },
  { domain: "twitch.tv", mode: "read_only", actions: ["navigate", "screenshot", "read"], notes: "Research/check only. Login and account actions are blocked." },
  { domain: "www.twitch.tv", mode: "read_only", actions: ["navigate", "screenshot", "read"], notes: "Research/check only. Login and account actions are blocked." },
  { domain: "kick.com", mode: "read_only", actions: ["navigate", "screenshot", "read"], notes: "Research/check only. Login and account actions are blocked." },
  { domain: "www.kick.com", mode: "read_only", actions: ["navigate", "screenshot", "read"], notes: "Research/check only. Login and account actions are blocked." },
  { domain: "youtube.com", mode: "read_only", actions: ["navigate", "screenshot", "read"], notes: "Research/check only. Uploads are blocked." },
  { domain: "www.youtube.com", mode: "read_only", actions: ["navigate", "screenshot", "read"], notes: "Research/check only. Uploads are blocked." },
  { domain: "studio.youtube.com", mode: "human_only", actions: ["navigate", "screenshot", "download"], notes: "YouTube Studio is human-only. Uploading and publishing require Human Gate." },
  { domain: "tiktok.com", mode: "human_only", actions: ["navigate", "screenshot", "download"], notes: "TikTok account actions are human-only." },
  { domain: "www.tiktok.com", mode: "human_only", actions: ["navigate", "screenshot", "download"], notes: "TikTok account actions are human-only." },
  { domain: "instagram.com", mode: "human_only", actions: ["navigate", "screenshot", "download"], notes: "Instagram account actions are human-only." },
  { domain: "www.instagram.com", mode: "human_only", actions: ["navigate", "screenshot", "download"], notes: "Instagram account actions are human-only." }
];

const BLOCKED_PROTOCOLS = new Set(["file:", "javascript:", "data:", "chrome:", "chrome-extension:", "about:", "blob:", "ftp:"]);
const SECRET_PATTERNS = [
  /([?&](?:token|access_token|refresh_token|code|key|secret|password)=)[^&#]+/gi,
  /(authorization:\s*bearer\s+)[^\s]+/gi,
  /(client_secret=)[^&#]+/gi
];

function now() {
  return new Date().toISOString();
}

function safeText(value) {
  return String(value ?? "").trim();
}

function sanitizeUrl(value) {
  let text = safeText(value);
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, "$1[redacted]");
  }
  return text;
}

function normalizeHost(hostname) {
  return safeText(hostname).replace(/^www\./i, "").toLowerCase();
}

function isPrivateHost(hostname) {
  const host = normalizeHost(hostname);
  if (!host) return true;
  if (["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(host)) return true;
  const ipType = net.isIP(host);
  if (!ipType) return false;
  if (ipType === 6) return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80");
  const parts = host.split(".").map((part) => Number(part));
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254)
  );
}

function parseBrowserUrl(raw) {
  const text = safeText(raw);
  if (!text) throw new Error("Enter a URL first.");
  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  return new URL(withProtocol);
}

function ensureBrowserState(state) {
  if (!state.browser || typeof state.browser !== "object") {
    state.browser = {};
  }
  state.browser.profile ||= {
    id: "default",
    mode: "persistent",
    createdAt: now(),
    updatedAt: now()
  };
  state.browser.sessions ||= [];
  state.browser.actions ||= [];
  state.browser.downloads ||= [];
  if (!Array.isArray(state.browser.policies) || state.browser.policies.length === 0) {
    state.browser.policies = DEFAULT_POLICIES.map((policy) => ({ ...policy, actions: [...policy.actions] }));
  }
  return state.browser;
}

function domainMatches(policyDomain, hostname) {
  const policyHost = normalizeHost(policyDomain);
  const host = normalizeHost(hostname);
  return host === policyHost || host.endsWith(`.${policyHost}`);
}

function hostnameFromUrl(value) {
  try {
    return new URL(value).hostname || "";
  } catch {
    return "";
  }
}

function sessionStateLabel(session) {
  if (!session) return "NOT_STARTED";
  if (session.status === "starting") return "STARTING";
  if (session.status === "loading") return "NAVIGATING";
  if (session.status === "blocked") return "ERROR";
  if (session.status === "paused" || session.controlMode === "paused") return "PAUSED";
  if (session.status === "closed") return "CLOSED";
  if (session.controlMode === "human_control" && session.currentUrl) return "WAITING_FOR_HUMAN";
  if (session.status === "ready" || session.status === "idle") return "READY";
  return String(session.status || "NOT_STARTED").toUpperCase();
}

function publicSession(session) {
  if (!session) return null;
  return {
    id: session.id,
    purpose: session.purpose,
    status: session.status,
    state: sessionStateLabel(session),
    controlMode: session.controlMode,
    mode: session.controlMode === "agent_assisted" ? "AGENT_ASSISTED" : session.controlMode === "paused" ? "PAUSED" : "HUMAN_CONTROL",
    engine: "Chromium",
    browserEngine: "Chromium",
    policyMode: session.policyMode,
    currentUrl: session.currentUrl,
    currentHostname: hostnameFromUrl(session.currentUrl),
    title: session.title,
    startedAt: session.startedAt || session.createdAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastActivityAt: session.updatedAt,
    closedAt: session.closedAt || null,
    lastNavigationAt: session.lastNavigationAt,
    lastScreenshotAt: session.lastScreenshotAt,
    latencyMs: session.latencyMs || null,
    privacyShield: session.privacyShield || { active: false },
    lastError: session.lastError || "",
    viewport: session.viewport
  };
}

export function createBrowserWorkspace({ config, state, helpers }) {
  const runtime = {
    playwright: null,
    context: null,
    pages: new Map(),
    subscribers: new Map(),
    launching: null
  };

  const log = async (type, message, details = {}) => {
    const safeDetails = Object.fromEntries(
      Object.entries(details).map(([key, value]) => [key, typeof value === "string" ? sanitizeUrl(value) : value])
    );
    if (helpers?.logEvent) return helpers.logEvent(type, message, safeDetails);
    helpers?.addStateLog?.(type, message, safeDetails);
    return helpers?.saveState?.();
  };

  const browserState = () => ensureBrowserState(state);

  const persist = async () => {
    await helpers?.saveState?.();
  };

  const appendAction = async (session, action, details = {}) => {
    const browser = browserState();
    const entry = {
      id: helpers.newId("browser_action"),
      sessionId: session?.id || "",
      action,
      details,
      createdAt: now(),
      actor: details.actor || "operator"
    };
    browser.actions.unshift(entry);
    browser.actions = browser.actions.slice(0, 200);
    emit(session?.id, "action", entry);
    return entry;
  };

  const ensureDirs = async () => {
    await fs.mkdir(config.browserProfileDir, { recursive: true });
    await fs.mkdir(config.browserDownloadsDir, { recursive: true });
  };

  const loadPlaywright = async () => {
    if (runtime.playwright) return runtime.playwright;
    runtime.playwright = await import("playwright");
    return runtime.playwright;
  };

  const ensureContext = async () => {
    if (runtime.context) return runtime.context;
    if (runtime.launching) return runtime.launching;
    runtime.launching = (async () => {
      await ensureDirs();
      const { chromium } = await loadPlaywright();
      const context = await chromium.launchPersistentContext(config.browserProfileDir, {
        headless: config.browserHeadless,
        viewport: config.browserViewport,
        acceptDownloads: true,
        downloadsPath: config.browserDownloadsDir,
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
      });
      context.on("page", (page) => {
        page.on("download", async (download) => {
          const suggested = download.suggestedFilename();
          const filename = `${Date.now()}-${suggested}`;
          const filePath = path.join(config.browserDownloadsDir, filename);
          await download.saveAs(filePath);
          const browser = browserState();
          browser.downloads.unshift({
            id: helpers.newId("download"),
            filename,
            suggestedFilename: suggested,
            createdAt: now()
          });
          browser.downloads = browser.downloads.slice(0, 50);
          await log("browser_download", "Browser download saved for operator review", { filename });
        });
      });
      runtime.context = context;
      runtime.launching = null;
      await log("browser_started", "Persistent browser workspace started", {
        headless: config.browserHeadless,
        viewport: `${config.browserViewport.width}x${config.browserViewport.height}`
      });
      return context;
    })();
    return runtime.launching;
  };

  const findSession = (sessionId) => {
    const session = browserState().sessions.find((item) => item.id === sessionId);
    if (!session) throw new Error("Browser session not found.");
    return session;
  };

  const pageForSession = async (session) => {
    if (runtime.pages.has(session.id)) return runtime.pages.get(session.id);
    const context = await ensureContext();
    const page = await context.newPage();
    runtime.pages.set(session.id, page);
    page.on("framenavigated", async (frame) => {
      if (frame !== page.mainFrame()) return;
      session.currentUrl = sanitizeUrl(page.url());
      session.updatedAt = now();
      emit(session.id, "navigated", publicSession(session));
    });
    page.on("close", () => {
      runtime.pages.delete(session.id);
      session.status = "closed";
      session.updatedAt = now();
      emit(session.id, "closed", publicSession(session));
    });
    return page;
  };

  const policyForUrl = (rawUrl, action = "navigate", actor = "operator") => {
    const url = parseBrowserUrl(rawUrl);
    if (BLOCKED_PROTOCOLS.has(url.protocol)) {
      return {
        allowed: false,
        url,
        mode: "blocked",
        reason: `${url.protocol.replace(":", "")} URLs are blocked in the supervised browser.`
      };
    }
    const local = isPrivateHost(url.hostname);
    if (local && !config.browserAllowLocalhost) {
      return {
        allowed: false,
        url,
        mode: "blocked",
        reason: "Private network and localhost browsing are blocked unless explicitly enabled."
      };
    }
    const policy = browserState().policies.find((item) => domainMatches(item.domain, url.hostname));
    if (!policy) {
      return {
        allowed: false,
        url,
        mode: "blocked",
        reason: "This domain is not on the browser policy allowlist."
      };
    }
    if (!policy.actions.includes(action)) {
      return {
        allowed: false,
        url,
        mode: policy.mode,
        reason: `${action} is not allowed for ${policy.domain}.`
      };
    }
    if (policy.mode === "human_only" && actor === "agent101") {
      return {
        allowed: false,
        url,
        mode: policy.mode,
        reason: `${policy.domain} is human-control only. Agent 101 can prepare a handoff, but cannot operate it.`
      };
    }
    return { allowed: true, url, mode: policy.mode, policy, reason: policy.notes || "" };
  };

  const updateSensitivity = async (session, page) => {
    try {
      const sensitiveCount = await page.locator([
        "input[type='password']",
        "input[name*='card' i]",
        "input[name*='cvv' i]",
        "input[name*='ssn' i]",
        "input[name*='token' i]",
        "input[name*='secret' i]",
        "input[autocomplete='one-time-code']",
        "[data-testid*='payment' i]"
      ].join(",")).count();
      const current = page.url();
      const sensitiveByUrl = /\b(login|signin|checkout|billing|payment|oauth|authorize|settings|security)\b/i.test(current);
      session.privacyShield = sensitiveCount || sensitiveByUrl
        ? {
            active: true,
            reason: sensitiveCount ? "Sensitive input fields detected." : "Sensitive account or authorization route detected.",
            detectedAt: now()
          }
        : { active: false };
      if (session.privacyShield.active) {
        session.controlMode = "human_control";
        await log("browser_safety", "Browser switched to human control on a sensitive screen", {
          sessionId: session.id,
          url: current
        });
      }
    } catch (error) {
      session.privacyShield = { active: false, checkError: error.message };
    }
  };

  const emit = (sessionId, event, payload) => {
    const subscribers = runtime.subscribers.get(sessionId);
    if (!subscribers) return;
    for (const res of subscribers) {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
  };

  return {
    profile() {
      const browser = browserState();
      return {
        enabled: config.browserEnabled,
        provider: "playwright",
        mode: config.browserHeadless ? "headless_screenshot" : "headed_local",
        profile: browser.profile,
        sessions: browser.sessions.map(publicSession),
        activeSession: publicSession(browser.sessions.find((session) => session.status !== "closed")),
        policies: browser.policies,
        downloads: browser.downloads,
        browserInstalled: Boolean(runtime.playwright || runtime.context),
        profileDirConfigured: Boolean(config.browserProfileDir),
        secretsExposed: false
      };
    },

    async resetProfile() {
      await this.closeAll();
      await fs.rm(config.browserProfileDir, { recursive: true, force: true });
      await fs.mkdir(config.browserProfileDir, { recursive: true });
      const browser = browserState();
      browser.profile = { id: "default", mode: "persistent", createdAt: now(), updatedAt: now(), resetAt: now() };
      browser.sessions = [];
      browser.actions = [];
      await log("browser_profile_reset", "Browser profile reset by operator");
      await persist();
      return this.profile();
    },

    async createSession({ purpose = "Agent 101 browser workspace", url = "", actor = "operator" } = {}) {
      if (!config.browserEnabled) throw new Error("Browser workspace is disabled.");
      const browser = browserState();
      const session = {
        id: helpers.newId("browser_session"),
        purpose,
        status: "starting",
        controlMode: "human_control",
        policyMode: "none",
        currentUrl: "",
        title: "New browser session",
        startedAt: now(),
        createdAt: now(),
        updatedAt: now(),
        lastNavigationAt: null,
        lastScreenshotAt: null,
        latencyMs: null,
        viewport: config.browserViewport,
        privacyShield: { active: false }
      };
      browser.sessions.unshift(session);
      browser.sessions = browser.sessions.slice(0, 12);
      await pageForSession(session);
      session.status = "ready";
      session.updatedAt = now();
      await appendAction(session, "session_created", { actor, purpose });
      if (url) await this.navigate(session.id, url, { actor });
      await persist();
      return publicSession(session);
    },

    async closeSession(sessionId) {
      const session = findSession(sessionId);
      const page = runtime.pages.get(session.id);
      if (page && !page.isClosed()) await page.close();
      session.status = "closed";
      session.closedAt = now();
      session.updatedAt = now();
      await appendAction(session, "session_closed", { actor: "operator" });
      await persist();
      return publicSession(session);
    },

    async closeAll() {
      for (const page of runtime.pages.values()) {
        try {
          if (!page.isClosed()) await page.close();
        } catch {
          // Best effort cleanup.
        }
      }
      runtime.pages.clear();
      if (runtime.context) {
        await runtime.context.close();
        runtime.context = null;
      }
    },

    async navigate(sessionId, rawUrl, { actor = "operator" } = {}) {
      const session = findSession(sessionId);
      const policy = policyForUrl(rawUrl, "navigate", actor);
      if (!policy.allowed) {
        session.status = "blocked";
        session.policyMode = policy.mode;
        session.lastError = policy.reason;
        session.updatedAt = now();
        await appendAction(session, "navigation_blocked", { actor, url: rawUrl, reason: policy.reason });
        await log("browser_blocked", "Browser navigation blocked by policy", {
          sessionId,
          actor,
          url: rawUrl,
          reason: policy.reason
        });
        await persist();
        return { session: publicSession(session), allowed: false, reason: policy.reason };
      }
      const page = await pageForSession(session);
      session.status = "loading";
      session.policyMode = policy.mode;
      session.lastError = "";
      session.updatedAt = now();
      await appendAction(session, "navigate", { actor, url: policy.url.href, policyMode: policy.mode });
      const started = Date.now();
      await page.goto(policy.url.href, { waitUntil: "domcontentloaded", timeout: config.browserNavigationTimeoutMs });
      await page.waitForLoadState("networkidle", { timeout: Math.min(7000, config.browserNavigationTimeoutMs) }).catch(() => {});
      await updateSensitivity(session, page);
      session.status = session.privacyShield?.active ? "human_control" : "ready";
      session.currentUrl = sanitizeUrl(page.url());
      session.title = await page.title().catch(() => policy.url.hostname);
      session.latencyMs = Date.now() - started;
      session.lastNavigationAt = now();
      session.updatedAt = now();
      await log("browser_navigated", "Browser workspace navigated", {
        sessionId,
        actor,
        url: session.currentUrl,
        policyMode: session.policyMode
      });
      await persist();
      emit(session.id, "session", publicSession(session));
      return { session: publicSession(session), allowed: true };
    },

    async simplePageAction(sessionId, action, { actor = "operator" } = {}) {
      const session = findSession(sessionId);
      const page = await pageForSession(session);
      const started = Date.now();
      if (action === "back") await page.goBack({ waitUntil: "domcontentloaded", timeout: config.browserNavigationTimeoutMs }).catch(() => null);
      else if (action === "forward") await page.goForward({ waitUntil: "domcontentloaded", timeout: config.browserNavigationTimeoutMs }).catch(() => null);
      else if (action === "refresh") await page.reload({ waitUntil: "domcontentloaded", timeout: config.browserNavigationTimeoutMs }).catch(() => null);
      else throw new Error("Unknown browser action.");
      await updateSensitivity(session, page);
      session.currentUrl = sanitizeUrl(page.url());
      session.title = await page.title().catch(() => session.title);
      session.status = session.privacyShield?.active ? "human_control" : "ready";
      session.latencyMs = Date.now() - started;
      session.updatedAt = now();
      session.lastNavigationAt = now();
      await appendAction(session, action, { actor, url: session.currentUrl });
      await persist();
      return publicSession(session);
    },

    async setControl(sessionId, mode, { actor = "operator" } = {}) {
      const session = findSession(sessionId);
      if (!["human_control", "agent_assisted", "paused"].includes(mode)) throw new Error("Invalid control mode.");
      if (mode === "agent_assisted" && session.privacyShield?.active) {
        throw new Error("This screen is sensitive. Human control must stay active.");
      }
      session.controlMode = mode;
      session.status = mode === "paused" ? "paused" : session.status === "closed" ? "closed" : "ready";
      session.updatedAt = now();
      await appendAction(session, "control_changed", { actor, mode });
      await persist();
      return publicSession(session);
    },

    async screenshot(sessionId) {
      const session = findSession(sessionId);
      const page = await pageForSession(session);
      const buffer = await page.screenshot({ type: "png", fullPage: false });
      session.lastScreenshotAt = now();
      session.updatedAt = now();
      await persist();
      return buffer;
    },

    async subscribe(sessionId, res) {
      findSession(sessionId);
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive"
      });
      res.write("\n");
      const set = runtime.subscribers.get(sessionId) || new Set();
      set.add(res);
      runtime.subscribers.set(sessionId, set);
      res.write(`event: session\n`);
      res.write(`data: ${JSON.stringify(publicSession(findSession(sessionId)))}\n\n`);
      const timer = setInterval(() => res.write(`event: ping\ndata: ${Date.now()}\n\n`), 15000);
      res.on("close", () => {
        clearInterval(timer);
        set.delete(res);
        if (!set.size) runtime.subscribers.delete(sessionId);
      });
    },

    policies() {
      return { policies: browserState().policies };
    }
  };
}

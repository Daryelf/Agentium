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
const EXECUTABLE_EXTENSIONS = new Set([".app", ".bat", ".cmd", ".com", ".dmg", ".exe", ".msi", ".pkg", ".ps1", ".scr", ".sh"]);
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
  state.browser.tasks ||= [];
  state.browser.uploadRequests ||= [];
  if (!Array.isArray(state.browser.policies) || state.browser.policies.length === 0) {
    state.browser.policies = DEFAULT_POLICIES.map((policy) => ({ ...policy, actions: [...policy.actions] }));
  }
  return state.browser;
}

function publicTab(tab, activeTabId) {
  if (!tab) return null;
  return {
    id: tab.id,
    title: tab.title || "New tab",
    url: sanitizeUrl(tab.url || ""),
    hostname: hostnameFromUrl(tab.url),
    status: tab.status || "ready",
    loading: tab.status === "loading",
    favicon: tab.favicon || "",
    active: tab.id === activeTabId,
    createdAt: tab.createdAt,
    updatedAt: tab.updatedAt,
    closedAt: tab.closedAt || null
  };
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
    activeTabId: session.activeTabId || "",
    tabs: (session.tabs || []).filter((tab) => !tab.closedAt).map((tab) => publicTab(tab, session.activeTabId)),
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
    tabPages: new Map(),
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
          const extension = path.extname(suggested).toLowerCase();
          if (EXECUTABLE_EXTENSIONS.has(extension)) {
            await log("browser_download_blocked", "Executable browser download blocked", {
              filename: suggested,
              sourceUrl: download.url()
            });
            return;
          }
          const filename = `${Date.now()}-${suggested}`;
          const filePath = path.join(config.browserDownloadsDir, filename);
          await download.saveAs(filePath);
          const stats = await fs.stat(filePath).catch(() => null);
          const browser = browserState();
          browser.downloads.unshift({
            id: helpers.newId("download"),
            filename,
            suggestedFilename: suggested,
            sizeBytes: stats?.size || 0,
            sourceUrl: sanitizeUrl(download.url()),
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

  const activeSessions = () => browserState().sessions.filter((session) => !["closed", "stopped"].includes(session.status));

  const syncSessionFromTab = (session, tab = null) => {
    const activeTab = tab || (session.tabs || []).find((item) => item.id === session.activeTabId) || (session.tabs || [])[0];
    if (!activeTab) return;
    session.activeTabId = activeTab.id;
    session.currentUrl = sanitizeUrl(activeTab.url || session.currentUrl || "");
    session.title = activeTab.title || session.title || "New tab";
    session.updatedAt = now();
  };

  const ensureSessionTabs = (session) => {
    session.tabs ||= [];
    session.tabs = session.tabs.filter((tab) => !tab.closedAt);
    if (!session.tabs.length) {
      const tab = {
        id: helpers.newId("browser_tab"),
        title: "New tab",
        url: "",
        status: "ready",
        createdAt: now(),
        updatedAt: now()
      };
      session.tabs.push(tab);
      session.activeTabId = tab.id;
    }
    if (!session.activeTabId || !session.tabs.some((tab) => tab.id === session.activeTabId)) {
      session.activeTabId = session.tabs[0].id;
    }
    syncSessionFromTab(session);
    return session.tabs;
  };

  const bindPageToTab = (session, page, tab) => {
    runtime.tabPages.set(tab.id, page);
    page.on("framenavigated", async (frame) => {
      if (frame !== page.mainFrame()) return;
      tab.url = sanitizeUrl(page.url());
      tab.status = "loading";
      tab.updatedAt = now();
      if (session.activeTabId === tab.id) syncSessionFromTab(session, tab);
      emit(session.id, "tab_changed", publicTab(tab, session.activeTabId));
    });
    page.on("load", async () => {
      tab.status = "ready";
      tab.url = sanitizeUrl(page.url());
      tab.title = await page.title().catch(() => tab.title || "New tab");
      tab.updatedAt = now();
      if (session.activeTabId === tab.id) {
        syncSessionFromTab(session, tab);
        emit(session.id, "session", publicSession(session));
      }
    });
    page.on("close", () => {
      runtime.tabPages.delete(tab.id);
      tab.closedAt = now();
      tab.status = "closed";
      tab.updatedAt = now();
      session.tabs = (session.tabs || []).filter((item) => !item.closedAt);
      if (!session.tabs.length) {
        session.status = "closed";
        session.closedAt = now();
      } else if (session.activeTabId === tab.id) {
        session.activeTabId = session.tabs[0].id;
        syncSessionFromTab(session);
      }
      session.updatedAt = now();
      emit(session.id, "tab_closed", publicTab(tab, session.activeTabId));
      emit(session.id, "session", publicSession(session));
    });
  };

  const pageForSession = async (session, requestedTabId = "") => {
    ensureSessionTabs(session);
    const tab = session.tabs.find((item) => item.id === (requestedTabId || session.activeTabId)) || session.tabs[0];
    if (!tab) throw new Error("Browser tab not found.");
    const existing = runtime.tabPages.get(tab.id);
    if (existing && !existing.isClosed()) {
      session.activeTabId = tab.id;
      runtime.pages.set(session.id, existing);
      syncSessionFromTab(session, tab);
      return existing;
    }
    const context = await ensureContext();
    const page = await context.newPage();
    bindPageToTab(session, page, tab);
    session.activeTabId = tab.id;
    runtime.pages.set(session.id, page);
    if (tab.url) {
      await page.goto(tab.url, { waitUntil: "domcontentloaded", timeout: config.browserNavigationTimeoutMs }).catch(() => {});
    }
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
      const sessions = browser.sessions.map((session) => {
        if (!["closed", "stopped"].includes(session.status)) ensureSessionTabs(session);
        return publicSession(session);
      });
      const activeSession = browser.sessions.find((session) => !["closed", "stopped"].includes(session.status));
      return {
        enabled: config.browserEnabled,
        provider: "playwright",
        mode: config.browserHeadless ? "headless_screenshot" : "headed_local",
        profile: browser.profile,
        sessions,
        activeSession: publicSession(activeSession),
        policies: browser.policies,
        downloads: browser.downloads,
        tasks: browser.tasks,
        uploadRequests: browser.uploadRequests,
        browserInstalled: Boolean(runtime.playwright || runtime.context),
        profileDirConfigured: Boolean(config.browserProfileDir),
        secretsExposed: false,
        diagnostics: {
          contextRunning: Boolean(runtime.context),
          activeRuntimePages: runtime.tabPages.size,
          persistentProfile: true,
          frameMode: "screenshot",
          inputBridge: "playwright",
          eventStream: "sse"
        }
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

    async createSession({ purpose = "Agent 101 browser workspace", url = "", actor = "operator", forceNew = false } = {}) {
      if (!config.browserEnabled) throw new Error("Browser workspace is disabled.");
      const browser = browserState();
      const existing = activeSessions()[0];
      if (existing && !forceNew) {
        await pageForSession(existing);
        existing.status = existing.controlMode === "paused" ? "paused" : "ready";
        existing.updatedAt = now();
        await appendAction(existing, "session_reused", { actor, purpose });
        await persist();
        return publicSession(existing);
      }
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
        privacyShield: { active: false },
        tabs: [],
        activeTabId: ""
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
      for (const tab of [...(session.tabs || [])]) {
        const page = runtime.tabPages.get(tab.id);
        if (page && !page.isClosed()) await page.close();
        runtime.tabPages.delete(tab.id);
      }
      runtime.pages.delete(session.id);
      session.status = "closed";
      session.closedAt = now();
      session.updatedAt = now();
      await appendAction(session, "session_closed", { actor: "operator" });
      await persist();
      return publicSession(session);
    },

    async closeAll() {
      const pages = new Set([...runtime.pages.values(), ...runtime.tabPages.values()]);
      for (const page of pages) {
        try {
          if (!page.isClosed()) await page.close();
        } catch {
          // Best effort cleanup.
        }
      }
      runtime.pages.clear();
      runtime.tabPages.clear();
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
      const tab = session.tabs.find((item) => item.id === session.activeTabId);
      if (tab) {
        tab.status = "loading";
        tab.url = sanitizeUrl(policy.url.href);
        tab.updatedAt = now();
      }
      await appendAction(session, "navigate", { actor, url: policy.url.href, policyMode: policy.mode });
      const started = Date.now();
      await page.goto(policy.url.href, { waitUntil: "domcontentloaded", timeout: config.browserNavigationTimeoutMs });
      await page.waitForLoadState("networkidle", { timeout: Math.min(7000, config.browserNavigationTimeoutMs) }).catch(() => {});
      const finalUrl = page.url();
      const finalPolicy = policyForUrl(finalUrl, "navigate", actor);
      if (!finalPolicy.allowed) {
        await page.goto("about:blank").catch(() => {});
        session.status = "blocked";
        session.policyMode = "blocked";
        session.currentUrl = sanitizeUrl(policy.url.href);
        session.lastError = `Navigation redirected to a blocked destination: ${finalPolicy.reason}`;
        session.updatedAt = now();
        if (tab) {
          tab.status = "blocked";
          tab.url = session.currentUrl;
          tab.updatedAt = now();
        }
        await appendAction(session, "navigation_redirect_blocked", {
          actor,
          url: policy.url.href,
          finalUrl,
          reason: finalPolicy.reason
        });
        await log("browser_blocked", "Browser redirect blocked by policy", {
          sessionId,
          actor,
          url: policy.url.href,
          reason: finalPolicy.reason
        });
        await persist();
        return { session: publicSession(session), allowed: false, reason: session.lastError };
      }
      await updateSensitivity(session, page);
      session.status = session.privacyShield?.active ? "human_control" : "ready";
      session.currentUrl = sanitizeUrl(page.url());
      session.title = await page.title().catch(() => policy.url.hostname);
      if (tab) {
        tab.status = "ready";
        tab.url = session.currentUrl;
        tab.title = session.title;
        tab.updatedAt = now();
      }
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
      else if (action === "stop-loading") await page.evaluate(() => window.stop()).catch(() => null);
      else throw new Error("Unknown browser action.");
      await updateSensitivity(session, page);
      session.currentUrl = sanitizeUrl(page.url());
      session.title = await page.title().catch(() => session.title);
      const tab = session.tabs.find((item) => item.id === session.activeTabId);
      if (tab) {
        tab.url = session.currentUrl;
        tab.title = session.title;
        tab.status = "ready";
        tab.updatedAt = now();
      }
      session.status = session.privacyShield?.active ? "human_control" : "ready";
      session.latencyMs = Date.now() - started;
      session.updatedAt = now();
      session.lastNavigationAt = now();
      await appendAction(session, action, { actor, url: session.currentUrl });
      await persist();
      return publicSession(session);
    },

    tabs(sessionId) {
      const session = findSession(sessionId);
      ensureSessionTabs(session);
      return { tabs: session.tabs.map((tab) => publicTab(tab, session.activeTabId)), activeTabId: session.activeTabId };
    },

    async newTab(sessionId, { url = "", actor = "operator" } = {}) {
      const session = findSession(sessionId);
      const context = await ensureContext();
      const page = await context.newPage();
      const tab = {
        id: helpers.newId("browser_tab"),
        title: "New tab",
        url: "",
        status: "ready",
        createdAt: now(),
        updatedAt: now()
      };
      session.tabs ||= [];
      session.tabs.push(tab);
      session.activeTabId = tab.id;
      bindPageToTab(session, page, tab);
      runtime.pages.set(session.id, page);
      syncSessionFromTab(session, tab);
      await appendAction(session, "tab_created", { actor, tabId: tab.id });
      if (url) await this.navigate(session.id, url, { actor });
      await persist();
      emit(session.id, "session", publicSession(session));
      return { session: publicSession(session), tab: publicTab(tab, session.activeTabId) };
    },

    async switchTab(sessionId, tabId, { actor = "operator" } = {}) {
      const session = findSession(sessionId);
      ensureSessionTabs(session);
      const tab = session.tabs.find((item) => item.id === tabId && !item.closedAt);
      if (!tab) throw new Error("Browser tab not found.");
      const page = await pageForSession(session, tab.id);
      session.activeTabId = tab.id;
      runtime.pages.set(session.id, page);
      syncSessionFromTab(session, tab);
      await appendAction(session, "tab_switched", { actor, tabId: tab.id });
      await persist();
      emit(session.id, "session", publicSession(session));
      return { session: publicSession(session), tab: publicTab(tab, session.activeTabId) };
    },

    async closeTab(sessionId, tabId, { actor = "operator" } = {}) {
      const session = findSession(sessionId);
      ensureSessionTabs(session);
      const tab = session.tabs.find((item) => item.id === tabId && !item.closedAt);
      if (!tab) throw new Error("Browser tab not found.");
      const page = runtime.tabPages.get(tab.id);
      if (page && !page.isClosed()) await page.close();
      tab.closedAt = now();
      tab.status = "closed";
      runtime.tabPages.delete(tab.id);
      session.tabs = session.tabs.filter((item) => !item.closedAt);
      if (!session.tabs.length) {
        session.status = "closed";
        session.closedAt = now();
        session.activeTabId = "";
        runtime.pages.delete(session.id);
      } else if (session.activeTabId === tab.id) {
        session.activeTabId = session.tabs[0].id;
        await pageForSession(session, session.activeTabId);
      }
      await appendAction(session, "tab_closed", { actor, tabId: tab.id });
      await persist();
      emit(session.id, "session", publicSession(session));
      return { session: publicSession(session), closedTabId: tab.id };
    },

    async input(sessionId, input = {}, { actor = "operator" } = {}) {
      const session = findSession(sessionId);
      if (session.status === "closed") throw new Error("Browser session is closed.");
      if (session.controlMode === "paused") throw new Error("Browser session is paused.");
      if (actor === "agent101" && session.controlMode !== "agent_assisted") {
        throw new Error("Agent 101 does not currently control this browser session.");
      }
      if (actor === "operator" && session.controlMode !== "human_control") {
        throw new Error("Take human control before sending browser input.");
      }
      if (actor === "agent101" && session.privacyShield?.active) {
        throw new Error("Sensitive page detected. Agent 101 is paused.");
      }
      const action = safeText(input.action || "click");
      if (["type", "keypress"].includes(action) && session.policyMode === "read_only") {
        throw new Error("Typing is blocked on read-only browser policies.");
      }
      const page = await pageForSession(session);
      await updateSensitivity(session, page);
      if (actor === "agent101" && session.privacyShield?.active) {
        throw new Error("Sensitive page detected. Agent 101 is paused.");
      }
      const started = Date.now();
      if (action === "click" || action === "double_click") {
        const x = Math.max(0, Math.min(config.browserViewport.width, Number(input.x || 0)));
        const y = Math.max(0, Math.min(config.browserViewport.height, Number(input.y || 0)));
        await page.mouse.click(x, y, { clickCount: action === "double_click" ? 2 : 1 });
      } else if (action === "scroll") {
        await page.mouse.wheel(Number(input.deltaX || 0), Number(input.deltaY || 420));
      } else if (action === "type") {
        const text = String(input.text || "");
        if (!text) throw new Error("Nothing to type.");
        await page.keyboard.type(text, { delay: 8 });
      } else if (action === "keypress") {
        const key = safeText(input.key || "Enter");
        await page.keyboard.press(key);
      } else if (action === "zoom") {
        const zoom = Math.max(0.5, Math.min(1.75, Number(input.zoom || 1)));
        await page.evaluate((value) => {
          document.documentElement.style.zoom = String(value);
        }, zoom);
      } else {
        throw new Error("Unsupported browser input action.");
      }
      await updateSensitivity(session, page);
      session.currentUrl = sanitizeUrl(page.url());
      session.title = await page.title().catch(() => session.title);
      session.status = session.privacyShield?.active ? "human_control" : "ready";
      session.latencyMs = Date.now() - started;
      session.updatedAt = now();
      const tab = session.tabs.find((item) => item.id === session.activeTabId);
      if (tab) {
        tab.url = session.currentUrl;
        tab.title = session.title;
        tab.status = "ready";
        tab.updatedAt = now();
      }
      await appendAction(session, `input_${action}`, {
        actor,
        url: session.currentUrl,
        textLength: action === "type" ? String(input.text || "").length : undefined,
        key: action === "keypress" ? safeText(input.key || "Enter") : undefined
      });
      await persist();
      emit(session.id, "session", publicSession(session));
      return { session: publicSession(session), action, status: "complete" };
    },

    async visibleText(sessionId) {
      const session = findSession(sessionId);
      const page = await pageForSession(session);
      await updateSensitivity(session, page);
      if (session.privacyShield?.active) {
        return { text: "", links: [], privacyShield: session.privacyShield };
      }
      const text = await page.locator("body").innerText({ timeout: 2000 }).catch(() => "");
      const links = await page.$$eval("a[href]", (items) =>
        items.slice(0, 50).map((link) => ({ text: link.textContent?.trim().slice(0, 120) || "", href: link.href }))
      ).catch(() => []);
      return {
        text: text.slice(0, 8000),
        links: links.map((link) => ({
          text: link.text,
          href: sanitizeUrl(link.href)
        }))
      };
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

    async health() {
      const result = {
        enabled: config.browserEnabled,
        provider: "playwright",
        status: config.browserEnabled ? "checking" : "disabled",
        checks: [],
        testedAt: now()
      };
      const add = (key, status, message, details = {}) => {
        result.checks.push({ key, status, message, ...details });
      };
      if (!config.browserEnabled) {
        add("enabled", "warning", "Browser workspace disabled by BROWSER_ENABLED=false.");
        result.status = "disabled";
        return result;
      }
      try {
        const { chromium } = await loadPlaywright();
        add("playwright", "ready", "Playwright module loaded.");
        const executablePath = chromium.executablePath();
        await fs.access(executablePath);
        add("chromium", "ready", "Chromium executable found.", { executablePath });
        await ensureDirs();
        add("profile", "ready", "Profile and download directories are available.");
        add("context", runtime.context ? "ready" : "idle", runtime.context ? "Browser worker is running." : "Browser worker will start on demand.");
        result.status = "ready";
      } catch (error) {
        add("browser_worker", "error", error.message);
        result.status = "error";
      }
      return result;
    },

    async smokeTest() {
      const report = {
        id: helpers.newId("browser_smoke"),
        startedAt: now(),
        status: "running",
        checks: []
      };
      const run = async (key, label, fn) => {
        const startedAt = Date.now();
        try {
          const value = await fn();
          report.checks.push({ key, label, status: "passed", message: value?.message || "Passed.", durationMs: Date.now() - startedAt, details: value?.details || {} });
        } catch (error) {
          report.checks.push({ key, label, status: "failed", message: error.message, durationMs: Date.now() - startedAt });
        }
      };
      let session = null;
      await run("health", "Browser worker health", async () => {
        const health = await this.health();
        if (health.status !== "ready") throw new Error(health.checks.find((check) => check.status === "error")?.message || "Browser worker is not ready.");
        return { message: "Browser worker ready." };
      });
      await run("start", "Start one real session", async () => {
        session = await this.createSession({ purpose: "Browser smoke test", actor: "system", forceNew: true });
        if (!session.id) throw new Error("No session id returned.");
        return { message: `Session ${session.id} started.` };
      });
      await run("navigate", "Navigate controlled page", async () => {
        const result = await this.navigate(session.id, "https://example.com", { actor: "operator" });
        if (!result.allowed) throw new Error(result.reason || "Navigation blocked.");
        return { message: "Example.com loaded." };
      });
      await run("screenshot", "Capture real viewport", async () => {
        const buffer = await this.screenshot(session.id);
        if (!buffer || buffer.length < 1000) throw new Error("Screenshot was empty.");
        return { message: `${buffer.length} byte screenshot captured.` };
      });
      await run("tabs", "Create and switch tabs", async () => {
        const tab = await this.newTab(session.id, { actor: "operator" });
        await this.switchTab(session.id, tab.tab.id, { actor: "operator" });
        const listed = this.tabs(session.id).tabs;
        if (listed.length < 2) throw new Error("Expected at least two tabs.");
        return { message: `${listed.length} tabs available.` };
      });
      await run("input", "Validate input bridge", async () => {
        const active = findSession(session.id);
        const page = await pageForSession(active);
        active.policyMode = "automated";
        await page.setContent("<main style='height:1800px'><input id='q' autofocus><button id='b'>ok</button><script>window.clicked=false;document.querySelector('#b').onclick=()=>{window.clicked=true}</script></main>");
        await this.setControl(session.id, "human_control", { actor: "system" });
        await this.input(session.id, { action: "type", text: "browser smoke" }, { actor: "operator" });
        await this.input(session.id, { action: "keypress", key: "Tab" }, { actor: "operator" });
        await this.input(session.id, { action: "keypress", key: "Enter" }, { actor: "operator" });
        await this.input(session.id, { action: "scroll", deltaY: 600 }, { actor: "operator" });
        const typed = await page.$eval("#q", (input) => input.value);
        if (typed !== "browser smoke") throw new Error("Input bridge did not type into Chromium.");
        return { message: "Keyboard and scroll input worked." };
      });
      await run("control", "Human and agent control handoff", async () => {
        await this.setControl(session.id, "agent_assisted", { actor: "system" });
        await this.setControl(session.id, "human_control", { actor: "operator" });
        const current = this.profile().activeSession;
        if (current.controlMode !== "human_control") throw new Error("Human control did not restore.");
        return { message: "Control handoff worked." };
      });
      await run("privacy", "Privacy shield detects password fields", async () => {
        const active = findSession(session.id);
        const page = await pageForSession(active);
        await page.setContent("<input type='password' aria-label='password'>");
        await updateSensitivity(active, page);
        if (!active.privacyShield?.active) throw new Error("Privacy Shield did not activate.");
        return { message: "Privacy Shield activated on password field." };
      });
      await run("close", "Close smoke session", async () => {
        await this.closeSession(session.id);
        return { message: "Smoke session closed." };
      });
      report.completedAt = now();
      report.status = report.checks.some((check) => check.status === "failed") ? "failed" : "passed";
      return report;
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

const path = require("node:path");
const net = require("node:net");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { fork } = require("node:child_process");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, screen } = require("electron");
const { isLoopbackHost, resolveLocalRouteUrl } = require("./local-navigation");
const { isVerifiedClipPlaybackUrl } = require("./clip-output");
const { isLoopbackHttpUrl, isSafeExternalWebUrl, isTrustedRobinhoodOAuthUrl } = require("./external-navigation");
const { materializeStockGuruRuntime, resolveStockGuruWorkspace } = require("./stock-guru-workspace");
const { createOfficeDisplayBridge } = require("./office-display-bridge");

process.env.APP_MODE = "local";
process.env.ARGENTUM_LOCAL_OFFICE_BYPASS = "1";
process.env.HOST = process.env.HOST || "127.0.0.1";
process.env.ARGENTUM_LOCAL_PORT = process.env.ARGENTUM_LOCAL_PORT || process.env.LOCAL_BACKEND_PORT || "5173";

let mainWindow = null;
let displayWindow = null;
let clippingAutomationWindow = null;
let clippingAutomationRestartTimer = null;
let clippingAutomationStableTimer = null;
let clippingAutomationRestartAttempts = 0;
let backendProcess = null;
let officeDisplayBridge = null;
let isShuttingDown = false;
let quitInFlight = null;
let hasShownWindow = false;
const isDevMode = !app.isPackaged || process.env.ARGENTUM_DEV === "1";
const workspaceRoot = path.resolve(__dirname, "..");
const watchedBackendFiles = new Set([
  path.resolve(workspaceRoot, "server.js"),
  path.resolve(workspaceRoot, "script.js"),
  path.resolve(workspaceRoot, "desktop/main.js"),
  path.resolve(workspaceRoot, "desktop/preload.js"),
  path.resolve(workspaceRoot, "CLIPPING OFFICE/server.js"),
  path.resolve(workspaceRoot, "CLIPPING OFFICE/public/app.js"),
  path.resolve(workspaceRoot, "CLIPPING OFFICE/public/index.html"),
  path.resolve(workspaceRoot, "CLIPPING OFFICE/public/styles.css"),
  path.resolve(workspaceRoot, "CLIPPING OFFICE /public/app.js"),
  path.resolve(workspaceRoot, "CLIPPING OFFICE /public/index.html"),
  path.resolve(workspaceRoot, "CLIPPING OFFICE /public/styles.css"),
  path.resolve(workspaceRoot, "CLIPPING OFFICE /services/caption-intelligence.js"),
  path.resolve(workspaceRoot, "CLIPPING OFFICE /services/editor-production-readiness.js"),
  path.resolve(workspaceRoot, "CLIPPING OFFICE /services/clip-moment-intelligence.js"),
  path.resolve(workspaceRoot, "CLIPPING OFFICE /services/media-signal-detector.js"),
]);
const runtimeWriteRoots = [
  path.resolve(workspaceRoot, "CLIPPING OFFICE /Clips"),
  path.resolve(workspaceRoot, "CLIPPING OFFICE /data"),
  path.resolve(workspaceRoot, "CLIPPING OFFICE /outputs"),
  path.resolve(workspaceRoot, "CLIPPING OFFICE /uploads"),
  path.resolve(workspaceRoot, "CLIPPING OFFICE /watch-buffers"),
  path.resolve(workspaceRoot, "CLIPPING OFFICE/Clips"),
  path.resolve(workspaceRoot, "CLIPPING OFFICE/data"),
  path.resolve(workspaceRoot, "dist"),
  path.resolve(workspaceRoot, "artifacts"),
];
const runtimeMediaExtensions = new Set([
  ".mp4", ".mov", ".mkv", ".webm", ".m3u8", ".ts",
  ".wav", ".mp3", ".m4a", ".aac", ".flac",
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"
]);
let fsWatchers = [];
let reloadTimeout = null;
let loadRetryTimeout = null;
let backendRestartQueued = false;
let reloadInFlight = false;
let pendingReloadReason = "";
let clipOutputFinalizationTail = Promise.resolve();
const sourceWatchSignatures = new Map();
const CLIPPING_AUTOMATION_MAX_RESTARTS = 5;
const CLIPPING_AUTOMATION_RESTART_BASE_MS = 1000;
const CLIPPING_AUTOMATION_RESTART_MAX_MS = 30000;
const CLIPPING_AUTOMATION_STABLE_RESET_MS = 60000;
const MAX_FINISHED_CLIP_BYTES = 1024 * 1024 * 1024;

app.setName("Argentum OS");

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

function appUrl() {
  const port = process.env.ARGENTUM_LOCAL_PORT || process.env.PORT || "5173";
  return `http://127.0.0.1:${port}`;
}

function displayWindowConfigPath() {
  return path.join(app.getPath("userData"), "monitor-display-config.json");
}

function defaultDisplayWindowConfig() {
  return {
    enabled: true,
    displayMode: "external",
    preferredDisplay: 3,
    fullscreen: true,
    kiosk: true,
    alwaysOnTop: true,
    preventClose: true,
    defaultView: "home",
    selectedDisplay: null,
  };
}

function displaySignature(display = {}) {
  const bounds = display.bounds || {};
  return [
    Math.round(bounds.x || 0),
    Math.round(bounds.y || 0),
    Math.round(bounds.width || 0),
    Math.round(bounds.height || 0),
    Number(display.scaleFactor || 1),
  ].join(":");
}

function normalizeDisplayWindowConfig(value = {}) {
  const fresh = defaultDisplayWindowConfig();
  const config = value && typeof value === "object" ? value : {};
  const preferredDisplay = Number(config.preferredDisplay);
  return {
    ...fresh,
    enabled: config.enabled !== false,
    displayMode: ["external", "selected", "primary"].includes(config.displayMode) ? config.displayMode : fresh.displayMode,
    preferredDisplay: Number.isFinite(preferredDisplay) ? Math.max(1, Math.min(12, Math.round(preferredDisplay))) : fresh.preferredDisplay,
    fullscreen: config.fullscreen !== false,
    kiosk: config.kiosk !== false,
    alwaysOnTop: config.alwaysOnTop !== false,
    preventClose: config.preventClose !== false,
    defaultView: String(config.defaultView || fresh.defaultView).replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || fresh.defaultView,
    selectedDisplay: config.selectedDisplay && typeof config.selectedDisplay === "object" ? {
      id: String(config.selectedDisplay.id || ""),
      label: String(config.selectedDisplay.label || ""),
      signature: String(config.selectedDisplay.signature || ""),
      bounds: config.selectedDisplay.bounds || null,
      updatedAt: config.selectedDisplay.updatedAt || null,
    } : null,
  };
}

function enforceDisplayWindowMode(targetWindow, targetDisplay, config = {}) {
  if (!targetWindow || targetWindow.isDestroyed()) return;
  const bounds = targetDisplay.bounds || targetDisplay.workArea || screen.getPrimaryDisplay().bounds;
  targetWindow.setBounds({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(800, Math.round(bounds.width)),
    height: Math.max(600, Math.round(bounds.height)),
  });
  targetWindow.setResizable(false);
  targetWindow.setMovable(false);
  targetWindow.setMinimizable(false);
  targetWindow.setMaximizable(false);
  targetWindow.setMenuBarVisibility(false);
  if (typeof targetWindow.setClosable === "function") {
    targetWindow.setClosable(config.preventClose === false);
  }
  if (config.alwaysOnTop !== false) {
    targetWindow.setAlwaysOnTop(true, "screen-saver");
    targetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  if (config.kiosk !== false) targetWindow.setKiosk(true);
  else if (config.fullscreen !== false) targetWindow.setFullScreen(true);
}

function readDisplayWindowConfig() {
  try {
    return normalizeDisplayWindowConfig(JSON.parse(fs.readFileSync(displayWindowConfigPath(), "utf8")));
  } catch (_error) {
    return defaultDisplayWindowConfig();
  }
}

function persistDisplayWindowConfig(config = {}) {
  const normalized = normalizeDisplayWindowConfig(config);
  try {
    fs.writeFileSync(displayWindowConfigPath(), `${JSON.stringify({ ...normalized, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  } catch (_error) {}
  return normalized;
}

function orderedDisplays() {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().slice().sort((left, right) => {
    if (left.id === primaryId) return -1;
    if (right.id === primaryId) return 1;
    return (left.bounds.x - right.bounds.x) || (left.bounds.y - right.bounds.y);
  });
}

function selectedDisplayLabel(display, index) {
  const primary = display.id === screen.getPrimaryDisplay().id ? "primary" : "external";
  return `Display ${index + 1} (${primary}) ${display.bounds.width}x${display.bounds.height}`;
}

function chooseDisplayForWindow(config = {}) {
  const displays = orderedDisplays();
  if (!displays.length) return screen.getPrimaryDisplay();
  const selected = config.selectedDisplay || {};
  const byId = selected.id ? displays.find((display) => String(display.id) === String(selected.id)) : null;
  if (byId) return byId;
  const bySignature = selected.signature ? displays.find((display) => displaySignature(display) === selected.signature) : null;
  if (bySignature) return bySignature;
  if (config.displayMode === "primary") return screen.getPrimaryDisplay();
  const preferredIndex = Math.max(0, Number(config.preferredDisplay || 1) - 1);
  if (displays[preferredIndex]) return displays[preferredIndex];
  return displays.find((display) => display.id !== screen.getPrimaryDisplay().id) || screen.getPrimaryDisplay();
}

function rememberDisplaySelection(config, display) {
  const displays = orderedDisplays();
  const index = Math.max(0, displays.findIndex((item) => item.id === display.id));
  return persistDisplayWindowConfig({
    ...config,
    selectedDisplay: {
      id: String(display.id),
      label: selectedDisplayLabel(display, index),
      signature: displaySignature(display),
      bounds: display.bounds,
      scaleFactor: display.scaleFactor,
      updatedAt: new Date().toISOString(),
    },
  });
}

async function fetchOfficeDisplaySnapshot() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoadingMainFrame()) {
    return { ok: false, status: 503 };
  }
  return mainWindow.webContents.executeJavaScript(`
    (async () => {
      try {
        const response = await fetch("/api/control-floor/infrastructure", {
          cache: "no-store",
          credentials: "same-origin"
        });
        if (!response.ok) return { ok: false, status: response.status };
        return { ok: true, status: response.status, payload: await response.json() };
      } catch (_error) {
        return { ok: false, status: 503 };
      }
    })()
  `, true);
}

function openOfficeFromDisplay(command = {}) {
  if (!command.route || !mainWindow || mainWindow.isDestroyed()) return;
  const targetUrl = resolveLocalRouteUrl(appUrl(), new URL(command.route, appUrl()).toString());
  loadMainWindow(0, targetUrl);
  showMainWindow();
}

function startOfficeDisplayBridge() {
  if (officeDisplayBridge) return;
  officeDisplayBridge = createOfficeDisplayBridge({
    getSnapshot: fetchOfficeDisplaySnapshot,
    onOpenOffice: openOfficeFromDisplay,
    onStatus: ({ state, detail, portPath }) => {
      logMainDiagnostic(`office display ${state}${portPath ? ` port=${portPath}` : ""}${detail ? ` detail=${detail}` : ""}`);
    },
  });
  officeDisplayBridge.start();
}

function routeStatePath() {
  return path.join(app.getPath("userData"), "last-local-route.json");
}

function clipOutputSettingsPath() {
  return path.join(app.getPath("userData"), "clipping-office-output.json");
}

function readClipOutputFolder() {
  try {
    const parsed = JSON.parse(fs.readFileSync(clipOutputSettingsPath(), "utf8"));
    const folderPath = path.resolve(String(parsed?.folderPath || ""));
    const stat = fs.statSync(folderPath);
    return stat.isDirectory() ? folderPath : "";
  } catch (_error) {
    return "";
  }
}

function persistClipOutputFolder(folderPath = "") {
  const resolved = path.resolve(String(folderPath || ""));
  fs.writeFileSync(clipOutputSettingsPath(), `${JSON.stringify({ folderPath: resolved, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  return resolved;
}

function safeClipOutputFilename(value = "") {
  const base = path.basename(String(value || "finished-clip.mp4"))
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "finished-clip.mp4";
  return /\.mp4$/i.test(base) ? base : `${base.replace(/\.[^.]+$/, "")}.mp4`;
}

function availableClipOutputPath(folderPath, fileName) {
  const parsed = path.parse(fileName);
  let candidate = path.join(folderPath, fileName);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(folderPath, `${parsed.name}-${suffix}${parsed.ext}`);
    suffix += 1;
  }
  return candidate;
}

async function withClipOutputFinalizationLock(callback) {
  const previous = clipOutputFinalizationTail;
  let release;
  clipOutputFinalizationTail = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await callback();
  } finally {
    release();
  }
}

async function finalizeClipOutput(temporaryPath, folderPath, fileName) {
  return withClipOutputFinalizationLock(async () => {
    const outputPath = availableClipOutputPath(folderPath, fileName);
    await fs.promises.rename(temporaryPath, outputPath);
    return outputPath;
  });
}

function readPersistedLocalRoute() {
  if (!app.isReady()) return "";
  try {
    const parsed = JSON.parse(fs.readFileSync(routeStatePath(), "utf8"));
    return typeof parsed?.url === "string" ? parsed.url : "";
  } catch (_error) {
    return "";
  }
}

function persistLocalRoute(candidateUrl = "") {
  if (!app.isReady() || !candidateUrl) return;
  try {
    const parsed = new URL(candidateUrl);
    if (!["http:", "https:"].includes(parsed.protocol) || !isLoopbackHost(parsed.hostname)) return;
    const url = resolveLocalRouteUrl(appUrl(), candidateUrl);
    fs.writeFileSync(routeStatePath(), `${JSON.stringify({ url, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  } catch (_error) {}
}

function currentLocalRouteUrl(candidateUrl = "") {
  const current = candidateUrl
    || (mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.getURL() : "")
    || readPersistedLocalRoute();
  return resolveLocalRouteUrl(appUrl(), current);
}

function isClippingOfficeRoute(candidateUrl = "") {
  try {
    return new URL(candidateUrl).pathname.startsWith("/apps/clipping-office");
  } catch (_error) {
    return false;
  }
}

function loadMainWindow(attempt = 0, requestedUrl = "") {
  if (!mainWindow || mainWindow.isDestroyed() || isShuttingDown) return;
  clearTimeout(loadRetryTimeout);
  const targetUrl = currentLocalRouteUrl(requestedUrl);
  mainWindow.loadURL(targetUrl).catch((error) => {
    console.error(`Argentum OS failed to open ${targetUrl}: ${error.message}`);
    showMainWindow();
    if (attempt >= 5 || isShuttingDown) return;
    loadRetryTimeout = setTimeout(() => loadMainWindow(attempt + 1, targetUrl), Math.min(2500, 350 * (attempt + 1)));
  });
}

function shouldIgnoreReloadPath(candidatePath) {
  const normalized = path.resolve(candidatePath);
  return runtimeWriteRoots.some((root) => normalized === root || normalized.startsWith(`${root}${path.sep}`))
    || runtimeMediaExtensions.has(path.extname(normalized).toLowerCase())
    || normalized.includes(`${path.sep}.git${path.sep}`)
    || normalized.includes(`${path.sep}node_modules${path.sep}`)
    || normalized.includes(`${path.sep}dist${path.sep}`)
    || normalized.includes(`${path.sep}downloads${path.sep}`)
    || path.basename(normalized).startsWith(".")
    || normalized.endsWith(`${path.sep}.DS_Store`)
    || normalized.endsWith(".log");
}

function sourceWatchSignature(candidatePath) {
  try {
    const stat = fs.statSync(candidatePath);
    if (!stat.isFile()) return "directory";
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  } catch (_error) {
    return "missing";
  }
}

function primeSourceWatchSignatures(candidatePath) {
  const resolved = path.resolve(candidatePath);
  if (shouldIgnoreReloadPath(resolved) || !fs.existsSync(resolved)) return;
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch (_error) {
    return;
  }
  if (stat.isFile()) {
    sourceWatchSignatures.set(resolved, sourceWatchSignature(resolved));
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
    primeSourceWatchSignatures(path.join(resolved, entry.name));
  }
}

function scheduleReload(reason = "workspace edit") {
  const hasMainWindow = Boolean(mainWindow && !mainWindow.isDestroyed());
  const hasDisplayWindow = Boolean(displayWindow && !displayWindow.isDestroyed());
  if (!hasMainWindow && !hasDisplayWindow) return;
  if (reloadInFlight) {
    pendingReloadReason = reason;
    return;
  }
  clearTimeout(reloadTimeout);
  reloadTimeout = setTimeout(async () => {
    if (reloadInFlight) {
      pendingReloadReason = reason;
      return;
    }
    reloadInFlight = true;
    const targetUrl = currentLocalRouteUrl();
    const restartBackend = backendRestartQueued;
    backendRestartQueued = false;
    try {
      if (restartBackend) {
        await stopBackend();
        await startBackend();
        if (mainWindow && !mainWindow.isDestroyed()) {
          await mainWindow.webContents.loadURL(currentLocalRouteUrl(targetUrl));
        }
        if (displayWindow && !displayWindow.isDestroyed()) {
          await displayWindow.webContents.loadURL(`${appUrl()}/display`);
        }
      } else {
        const reloads = [];
        if (mainWindow && !mainWindow.isDestroyed()) reloads.push(mainWindow.webContents.reloadIgnoringCache());
        if (displayWindow && !displayWindow.isDestroyed()) reloads.push(displayWindow.webContents.reloadIgnoringCache());
        await Promise.allSettled(reloads);
      }
      logMainDiagnostic(`dev reload triggered: ${reason} route=${new URL(targetUrl).pathname}`);
    } catch (error) {
      logMainDiagnostic(`reload failed: ${error?.message || error}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        loadMainWindow(1, targetUrl);
      }
    } finally {
      reloadInFlight = false;
      if (pendingReloadReason || backendRestartQueued) {
        const pending = pendingReloadReason || "queued backend edit";
        pendingReloadReason = "";
        scheduleReload(pending);
      }
    }
  }, 220);
}

function setupLocalDevReload() {
  if (!isDevMode || app.isPackaged) return;
  const watchedDirs = [
    path.join(workspaceRoot, "CLIPPING OFFICE /public"),
    path.join(workspaceRoot, "CLIPPING OFFICE /services"),
    path.join(workspaceRoot, "apps"),
    path.join(workspaceRoot, "services"),
    path.join(workspaceRoot, "desktop"),
  ];
  const watchedFiles = [
    path.join(workspaceRoot, "server.js"),
    path.join(workspaceRoot, "script.js"),
    path.join(workspaceRoot, "styles.css"),
    path.join(workspaceRoot, "index.html"),
    path.join(workspaceRoot, "CLIPPING OFFICE /server.js")
  ];

  [...watchedDirs, ...watchedFiles].forEach(primeSourceWatchSignatures);

  const handleChange = (filePath = "") => {
    if (!filePath) return;
    const resolved = path.resolve(path.normalize(filePath));
    if (shouldIgnoreReloadPath(resolved)) return;
    const nextSignature = sourceWatchSignature(resolved);
    if (sourceWatchSignatures.get(resolved) === nextSignature) return;
    sourceWatchSignatures.set(resolved, nextSignature);
    if (watchedBackendFiles.has(resolved)) backendRestartQueued = true;
    scheduleReload(`change: ${path.basename(resolved)}`);
  };

  watchedDirs.forEach((dirPath) => {
    if (!fs.existsSync(dirPath)) return;
    try {
      const watcher = fs.watch(dirPath, { recursive: true }, (_eventType, filename) => {
        if (!filename) return;
        handleChange(path.join(dirPath, String(filename)));
      });
      fsWatchers.push(watcher);
    } catch (error) {
      logMainDiagnostic(`watch failed for ${dirPath}: ${error?.message || error}`);
    }
  });
  watchedFiles.forEach((filePath) => {
    if (!fs.existsSync(filePath)) return;
    try {
      const watcher = fs.watch(filePath, () => handleChange(filePath));
      fsWatchers.push(watcher);
    } catch (error) {
      logMainDiagnostic(`watch failed for ${filePath}: ${error?.message || error}`);
    }
  });
  logMainDiagnostic("dev reload watchers enabled for source files only");
}

function teardownLocalDevReload() {
  fsWatchers.forEach((watcher) => watcher.close());
  fsWatchers = [];
  sourceWatchSignatures.clear();
}

function appIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "icon.icns");
  }
  return path.join(__dirname, "argentum-icon.icns");
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (hasShownWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return;
  }
  hasShownWindow = true;
  const display = screen.getPrimaryDisplay();
  const area = display.workArea || display.bounds;
  const width = Math.min(1440, Math.max(1120, area.width - 80));
  const height = Math.min(940, Math.max(760, area.height - 80));
  mainWindow.setBounds({
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  });
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function canUsePort(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

async function chooseBackendPort() {
  const start = Number(process.env.ARGENTUM_LOCAL_PORT || process.env.LOCAL_BACKEND_PORT || "5173");
  const first = Number.isFinite(start) && start > 0 ? start : 5173;
  for (let port = first; port < first + 20; port += 1) {
    if (await canUsePort(port)) {
      process.env.ARGENTUM_LOCAL_PORT = String(port);
      process.env.LOCAL_BACKEND_PORT = String(port);
      process.env.PORT = String(port);
      return port;
    }
  }
  throw new Error("No local backend port is available for Argentum OS.");
}

function buildMenu() {
  const template = [
    {
      label: "Argentum OS",
      submenu: [
        {
          label: "Settings",
          accelerator: "CmdOrCtrl+,",
          click: () => {
            if (!mainWindow) return;
            mainWindow.webContents.executeJavaScript(`
              if (typeof activateView === 'function') activateView('settings');
              document.querySelector('[data-nav="settings"], [data-view-target="settings"], [data-nav-target="settings"]')?.click?.();
              document.querySelector('[data-view="settings"]')?.click?.();
              document.querySelector('[href="#settings"]')?.click?.();
              if (typeof window.openArgentumSettings === 'function') window.openArgentumSettings();
            `).catch(() => {});
          },
        },
        {
          label: "Open Monitor 3 Display",
          accelerator: "CmdOrCtrl+Shift+D",
          click: () => createDisplayWindow({ focus: true }),
        },
        { type: "separator" },
        { role: "quit", label: "Quit Argentum OS" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload", label: "Reload" },
        { role: "toggleDevTools", label: "Toggle Developer Tools" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function logMainDiagnostic(message) {
  try {
    const logDir = app.isReady()
      ? app.getPath("userData")
      : path.join(process.cwd(), ".local", "Argentum OS", "logs");
    const logPath = path.join(logDir, "main-process.log");
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
  } catch (_error) {}
}

async function withShutdownDeadline(promise, timeoutMs, label) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve(promise), timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function attachCrashGuards() {
  process.on("uncaughtException", (error) => {
    logMainDiagnostic(`uncaughtException ${error && error.stack ? error.stack : error}`);
    console.error("Argentum OS uncaught exception:", error);
  });

  process.on("unhandledRejection", (reason) => {
    logMainDiagnostic(`unhandledRejection ${reason && reason.stack ? reason.stack : reason}`);
    console.error("Argentum OS unhandled rejection:", reason);
  });

  app.on("render-process-gone", (_event, wc, details) => {
    logMainDiagnostic(`render-process-gone reason=${details?.reason || "unknown"} exitCode=${details?.exitCode}`);
    if (!wc || wc !== mainWindow?.webContents || isShuttingDown) return;
    mainWindow?.webContents?.reload();
  });

  app.on("web-contents-created", (_event, webContents) => {
    webContents.on("render-process-gone", (_evt, details) => {
      logMainDiagnostic(
        `web-contents render-process-gone reason=${details?.reason || "unknown"} exitCode=${details?.exitCode}`,
      );
    });
  });

  app.on("child-process-gone", (_event, details) => {
    logMainDiagnostic(`child-process-gone reason=${details?.reason || "unknown"}`);
  });

  app.on("gpu-process-crashed", () => {
    logMainDiagnostic("gpu-process-crashed");
  });
}

async function stopBackend() {
  const activeBackend = backendProcess;
  backendProcess = null;
  if (!activeBackend || activeBackend.exitCode !== null) return;
  const exitPromise = new Promise((resolve) => activeBackend.once("exit", resolve));
  try {
    activeBackend.send?.({ type: "argentum:shutdown" });
    await withShutdownDeadline(exitPromise, 10000, "Local office shutdown");
  } catch (error) {
    logMainDiagnostic(`local office shutdown warning ${error?.message || error}`);
    activeBackend.kill("SIGTERM");
    await withShutdownDeadline(exitPromise, 2000, "Forced local server close").catch(() => {
      activeBackend.kill("SIGKILL");
    });
  }
}

function pipeBackendDiagnostics(stream, label) {
  if (!stream) return;
  let buffered = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() || "";
    lines.map((line) => line.trim()).filter(Boolean).forEach((line) => {
      logMainDiagnostic(`backend ${label}: ${line.slice(0, 2000)}`);
    });
  });
}

async function startBackend() {
  await chooseBackendPort();
  const entryPath = path.join(workspaceRoot, "server.js");
  const child = fork(entryPath, [], {
    cwd: app.isPackaged ? app.getPath("userData") : workspaceRoot,
    execPath: process.execPath,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      APP_MODE: "local",
      HOST: "127.0.0.1",
      PORT: process.env.ARGENTUM_LOCAL_PORT,
      LOCAL_BACKEND_PORT: process.env.ARGENTUM_LOCAL_PORT,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  backendProcess = child;
  pipeBackendDiagnostics(child.stdout, "stdout");
  pipeBackendDiagnostics(child.stderr, "stderr");
  await new Promise((resolve, reject) => {
    let startupTimeout = null;
    const cleanup = () => {
      clearTimeout(startupTimeout);
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onMessage = (message) => {
      if (message?.type !== "argentum:backend-ready") return;
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`Argentum backend exited during startup (${signal || code || "unknown"}).`));
    };
    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
    startupTimeout = setTimeout(() => {
      cleanup();
      child.kill("SIGTERM");
      reject(new Error("Argentum backend startup exceeded 60 seconds."));
    }, 60_000);
  });
  child.once("exit", (code, signal) => {
    if (backendProcess === child) backendProcess = null;
    logMainDiagnostic(`backend process exited code=${code ?? "none"} signal=${signal || "none"}`);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1120,
    minHeight: 760,
    title: "Argentum OS",
    icon: appIconPath(),
    backgroundColor: "#05070d",
    titleBarStyle: "default",
    fullscreenable: true,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  });

  mainWindow.once("ready-to-show", showMainWindow);
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isLoopbackHttpUrl(url)) return;
    event.preventDefault();
    if (!isSafeExternalWebUrl(url)) return;
    shell.openExternal(url).catch((error) => {
      logMainDiagnostic(`external navigation failed ${error?.message || error}`);
    });
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalWebUrl(url)) {
      shell.openExternal(url).catch((error) => {
        logMainDiagnostic(`external window failed ${error?.message || error}`);
      });
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("did-navigate", (_event, url) => {
    persistLocalRoute(url);
    if (isClippingOfficeRoute(url)) createClippingAutomationWindow();
  });
  mainWindow.webContents.on("did-navigate-in-page", (_event, url) => {
    persistLocalRoute(url);
    if (isClippingOfficeRoute(url)) createClippingAutomationWindow();
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    console.error(`Argentum OS failed to load the local app: ${errorDescription}`);
    showMainWindow();
    if (isMainFrame && errorCode !== -3 && !isShuttingDown) {
      clearTimeout(loadRetryTimeout);
      const failedRoute = currentLocalRouteUrl(validatedUrl);
      loadRetryTimeout = setTimeout(() => loadMainWindow(1, failedRoute), 450);
    }
  });
  hasShownWindow = false;
  loadMainWindow(0, appUrl());

  if (isDevMode) {
    mainWindow.webContents.on("did-finish-load", () => {
      mainWindow.webContents.session.clearCache().catch(() => {});
    });
  }
}

function createDisplayWindow(options = {}) {
  if (displayWindow && !displayWindow.isDestroyed()) {
    const config = readDisplayWindowConfig();
    enforceDisplayWindowMode(displayWindow, chooseDisplayForWindow(config), config);
    if (displayWindow.isMinimized()) displayWindow.restore();
    if (options.focus !== false) displayWindow.focus();
    return displayWindow;
  }

  const config = readDisplayWindowConfig();
  if (options.respectEnabled && config.enabled === false) return null;
  const targetDisplay = chooseDisplayForWindow(config);
  rememberDisplaySelection(config, targetDisplay);
  const bounds = targetDisplay.bounds || targetDisplay.workArea || screen.getPrimaryDisplay().bounds;
  displayWindow = new BrowserWindow({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(800, Math.round(bounds.width)),
    height: Math.max(600, Math.round(bounds.height)),
    minWidth: 800,
    minHeight: 600,
    title: "Argentum Monitor 3",
    icon: appIconPath(),
    backgroundColor: "#05070d",
    frame: config.kiosk === false && config.fullscreen === false,
    fullscreen: config.fullscreen !== false,
    kiosk: config.kiosk !== false,
    fullscreenable: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: config.preventClose === false,
    alwaysOnTop: config.alwaysOnTop !== false,
    autoHideMenuBar: true,
    focusable: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
    show: false,
  });

  let displayModeReassertTimer = null;
  const scheduleDisplayModeReassert = () => {
    if (isShuttingDown || !displayWindow || displayWindow.isDestroyed()) return;
    if (displayModeReassertTimer) clearTimeout(displayModeReassertTimer);
    displayModeReassertTimer = setTimeout(() => {
      displayModeReassertTimer = null;
      if (isShuttingDown || !displayWindow || displayWindow.isDestroyed()) return;
      enforceDisplayWindowMode(displayWindow, targetDisplay, config);
      if (displayWindow.isMinimized()) displayWindow.restore();
      if (!displayWindow.isVisible()) displayWindow.showInactive();
    }, 80);
  };

  enforceDisplayWindowMode(displayWindow, targetDisplay, config);

  displayWindow.once("ready-to-show", () => {
    if (!displayWindow || displayWindow.isDestroyed()) return;
    enforceDisplayWindowMode(displayWindow, targetDisplay, config);
    if (options.focus === false) {
      displayWindow.showInactive();
    } else {
      displayWindow.show();
      displayWindow.focus();
    }
  });
  displayWindow.on("close", (event) => {
    if (isShuttingDown || config.preventClose === false) return;
    event.preventDefault();
    scheduleDisplayModeReassert();
  });
  displayWindow.on("leave-full-screen", scheduleDisplayModeReassert);
  displayWindow.on("minimize", scheduleDisplayModeReassert);
  displayWindow.on("resize", scheduleDisplayModeReassert);
  displayWindow.on("move", scheduleDisplayModeReassert);
  displayWindow.on("hide", scheduleDisplayModeReassert);
  displayWindow.on("blur", scheduleDisplayModeReassert);
  displayWindow.on("closed", () => {
    if (displayModeReassertTimer) clearTimeout(displayModeReassertTimer);
    displayWindow = null;
  });
  displayWindow.webContents.on("will-navigate", (event, url) => {
    if (isLoopbackHttpUrl(url)) return;
    event.preventDefault();
    if (!isSafeExternalWebUrl(url)) return;
    shell.openExternal(url).catch((error) => {
      logMainDiagnostic(`display external navigation failed ${error?.message || error}`);
    });
  });
  displayWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalWebUrl(url)) {
      shell.openExternal(url).catch((error) => {
        logMainDiagnostic(`display external window failed ${error?.message || error}`);
      });
    }
    return { action: "deny" };
  });
  displayWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || isShuttingDown) return;
    logMainDiagnostic(`display window failed to load: ${errorDescription}`);
    setTimeout(() => {
      if (displayWindow && !displayWindow.isDestroyed() && !isShuttingDown) {
        displayWindow.loadURL(`${appUrl()}/display`).catch((error) => {
          logMainDiagnostic(`display retry failed ${error?.message || error}`);
        });
      }
    }, 600);
  });
  displayWindow.loadURL(`${appUrl()}/display`).catch((error) => {
    logMainDiagnostic(`display load rejected ${error?.message || error}`);
  });
  return displayWindow;
}

function disposeClippingAutomationWindow(workerWindow = clippingAutomationWindow) {
  if (workerWindow && clippingAutomationWindow && workerWindow !== clippingAutomationWindow) return;
  clearTimeout(clippingAutomationStableTimer);
  clippingAutomationStableTimer = null;
  if (workerWindow === clippingAutomationWindow) clippingAutomationWindow = null;
  if (workerWindow && !workerWindow.isDestroyed()) workerWindow.destroy();
}

function destroyClippingAutomationWindow() {
  clearTimeout(clippingAutomationRestartTimer);
  clearTimeout(clippingAutomationStableTimer);
  clippingAutomationRestartTimer = null;
  clippingAutomationStableTimer = null;
  clippingAutomationRestartAttempts = 0;
  disposeClippingAutomationWindow();
}

function scheduleClippingAutomationRestart(workerWindow, reason = "worker failure") {
  if (isShuttingDown || clippingAutomationRestartTimer) return;
  if (workerWindow && clippingAutomationWindow && workerWindow !== clippingAutomationWindow) return;
  disposeClippingAutomationWindow(workerWindow);
  if (clippingAutomationRestartAttempts >= CLIPPING_AUTOMATION_MAX_RESTARTS) {
    logMainDiagnostic(`clipping automation worker restart limit reached after ${reason}`);
    return;
  }
  clippingAutomationRestartAttempts += 1;
  const delayMs = Math.min(
    CLIPPING_AUTOMATION_RESTART_MAX_MS,
    CLIPPING_AUTOMATION_RESTART_BASE_MS * (2 ** (clippingAutomationRestartAttempts - 1)),
  );
  logMainDiagnostic(
    `clipping automation worker restart ${clippingAutomationRestartAttempts}/${CLIPPING_AUTOMATION_MAX_RESTARTS} in ${delayMs}ms after ${reason}`,
  );
  clippingAutomationRestartTimer = setTimeout(() => {
    clippingAutomationRestartTimer = null;
    if (!isShuttingDown) createClippingAutomationWindow();
  }, delayMs);
}

function markClippingAutomationStable(workerWindow) {
  clearTimeout(clippingAutomationStableTimer);
  clippingAutomationStableTimer = setTimeout(() => {
    clippingAutomationStableTimer = null;
    if (workerWindow === clippingAutomationWindow && !workerWindow.isDestroyed()) {
      clippingAutomationRestartAttempts = 0;
    }
  }, CLIPPING_AUTOMATION_STABLE_RESET_MS);
}

function createClippingAutomationWindow() {
  if (clippingAutomationWindow && !clippingAutomationWindow.isDestroyed()) return clippingAutomationWindow;
  if (clippingAutomationRestartTimer || isShuttingDown) return null;
  const workerWindow = new BrowserWindow({
    width: 640,
    height: 480,
    show: false,
    skipTaskbar: true,
    backgroundColor: "#080b12",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      offscreen: true,
    },
  });
  clippingAutomationWindow = workerWindow;
  workerWindow.setSkipTaskbar(true);
  workerWindow.webContents.setAudioMuted(true);
  workerWindow.webContents.on("did-finish-load", () => {
    markClippingAutomationStable(workerWindow);
  });
  workerWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || isShuttingDown) return;
    logMainDiagnostic(`clipping automation worker failed to load: ${errorDescription}`);
    scheduleClippingAutomationRestart(workerWindow, `load failure ${errorCode}`);
  });
  workerWindow.webContents.on("render-process-gone", (_event, details) => {
    logMainDiagnostic(`clipping automation worker exited reason=${details?.reason || "unknown"}`);
    scheduleClippingAutomationRestart(workerWindow, `renderer exit ${details?.reason || "unknown"}`);
  });
  workerWindow.on("closed", () => {
    if (workerWindow === clippingAutomationWindow) clippingAutomationWindow = null;
  });
  workerWindow.loadURL(`${appUrl()}/apps/clipping-office/?automation-worker=1#review`).catch((error) => {
    logMainDiagnostic(`clipping automation worker load rejected: ${error?.message || error}`);
    scheduleClippingAutomationRestart(workerWindow, "load rejection");
  });
  return workerWindow;
}

ipcMain.handle("argentum:choose-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose Argentum OS workspace folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle("argentum:get-clip-output-folder", async () => {
  const folderPath = readClipOutputFolder();
  return folderPath ? { configured: true, path: folderPath, name: path.basename(folderPath) } : { configured: false, path: "", name: "" };
});

ipcMain.handle("argentum:choose-clip-output-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose finished clips folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const folderPath = persistClipOutputFolder(result.filePaths[0]);
  return { configured: true, path: folderPath, name: path.basename(folderPath) };
});

ipcMain.handle("argentum:save-clip-to-output-folder", async (_event, payload = {}) => {
  const folderPath = readClipOutputFolder();
  if (!folderPath) throw new Error("Choose a finished clips folder in Library first.");
  const sourceUrl = new URL(String(payload.url || ""));
  if (!isVerifiedClipPlaybackUrl(sourceUrl)) {
    throw new Error("Only verified local Clipping Office videos can be saved.");
  }
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Could not read the finished video (${response.status}).`);
  if (!/video\/mp4/i.test(response.headers.get("content-type") || "")) throw new Error("The finished video was not a verified MP4.");
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_FINISHED_CLIP_BYTES) throw new Error("Finished video is too large to save automatically.");
  if (!response.body) throw new Error("Finished video was empty.");
  const fileName = safeClipOutputFilename(payload.fileName);
  const temporaryPath = path.join(
    folderPath,
    `.${fileName}.${process.pid}.${crypto.randomUUID()}.part`,
  );
  let sizeBytes = 0;
  let outputPath = "";
  const sizeLimiter = new Transform({
    transform(chunk, _encoding, callback) {
      sizeBytes += Buffer.byteLength(chunk);
      if (sizeBytes > MAX_FINISHED_CLIP_BYTES) {
        callback(new Error("Finished video is too large to save automatically."));
        return;
      }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      sizeLimiter,
      fs.createWriteStream(temporaryPath, { flags: "wx" }),
    );
    if (!sizeBytes) throw new Error("Finished video was empty.");
    outputPath = await finalizeClipOutput(temporaryPath, folderPath, fileName);
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
  return { saved: true, path: outputPath, folderPath, fileName: path.basename(outputPath), sizeBytes };
});

ipcMain.handle("argentum:choose-file", async (_event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: String(options.title || "Choose file"),
    properties: ["openFile"],
    filters: Array.isArray(options.filters) && options.filters.length
      ? options.filters
      : [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  const stat = await fs.promises.stat(filePath).catch(() => null);
  let dataUrl = "";
  if (stat && stat.size <= 8 * 1024 * 1024) {
    const extension = path.extname(filePath).toLowerCase().replace(".", "");
    const mime = extension === "jpg" || extension === "jpeg"
      ? "image/jpeg"
      : extension === "webp"
        ? "image/webp"
        : extension === "gif"
          ? "image/gif"
          : "image/png";
    const buffer = await fs.promises.readFile(filePath).catch(() => null);
    if (buffer) dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
  }
  return {
    path: filePath,
    name: path.basename(filePath),
    sizeBytes: stat?.size || 0,
    dataUrl,
  };
});

ipcMain.handle("argentum:read-image-file", async (_event, targetPath) => {
  const filePath = String(targetPath || "").trim();
  if (!filePath) return null;
  const extension = path.extname(filePath).toLowerCase().replace(".", "");
  const allowed = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
  if (!allowed.has(extension)) return null;
  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile() || stat.size > 8 * 1024 * 1024) return null;
  const mime = extension === "jpg" || extension === "jpeg"
    ? "image/jpeg"
    : extension === "webp"
      ? "image/webp"
      : extension === "gif"
        ? "image/gif"
        : "image/png";
  const buffer = await fs.promises.readFile(filePath).catch(() => null);
  if (!buffer) return null;
  return {
    path: filePath,
    name: path.basename(filePath),
    sizeBytes: stat.size,
    dataUrl: `data:${mime};base64,${buffer.toString("base64")}`,
  };
});

ipcMain.handle("argentum:open-path", async (_event, targetPath) => {
  const value = String(targetPath || "").trim();
  if (!value) return { opened: false };
  const result = await shell.openPath(value);
  return { opened: !result, error: result || null };
});

ipcMain.handle("argentum:open-robinhood-oauth", async (_event, targetUrl) => {
  const value = String(targetUrl || "").trim();
  if (!isTrustedRobinhoodOAuthUrl(value)) {
    throw new Error("Stock Office refused an invalid Robinhood OAuth URL.");
  }
  await shell.openExternal(value);
  return { opened: true };
});

app.whenReady().then(async () => {
  attachCrashGuards();
  app.dock?.show?.();
  buildMenu();
  logMainDiagnostic("stock guru workspace resolution started");
  const stockGuruWorkspace = resolveStockGuruWorkspace({
    env: process.env,
    workspaceRoot,
    userDataPath: app.getPath("userData"),
  });
  logMainDiagnostic(`stock guru workspace resolution completed source=${stockGuruWorkspace.source}`);
  const stockGuruRuntime = stockGuruWorkspace.available
    ? materializeStockGuruRuntime({ sourcePath: stockGuruWorkspace.path, userDataPath: app.getPath("userData"), reuseExisting: true })
    : { path: stockGuruWorkspace.path, sourcePath: stockGuruWorkspace.path, available: false, pythonLinked: false };
  process.env.STOCK_GURU_SOURCE_PATH = stockGuruRuntime.sourcePath;
  process.env.STOCK_GURU_PATH = stockGuruRuntime.path;
  logMainDiagnostic(`stock guru workspace ${stockGuruWorkspace.source} ${stockGuruWorkspace.available ? "available" : "missing"}; managed runtime ${stockGuruRuntime.available ? "ready" : "missing"}${stockGuruRuntime.reusedExisting ? " (reused)" : ""}`);
  await startBackend();
  createWindow();
  if (process.env.ARGENTUM_DISPLAY_AUTO_OPEN === "1" || process.argv.includes("--display")) {
    createDisplayWindow({ respectEnabled: true, focus: false });
  }
  startOfficeDisplayBridge();
  setupLocalDevReload();
  logMainDiagnostic("backend started");
});

app.on("second-instance", (_event, argv = []) => {
  if (argv.includes("--display")) {
    createDisplayWindow({ focus: true });
    return;
  }
  loadMainWindow(0, appUrl());
  showMainWindow();
});

app.on("activate", () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  if (isClippingOfficeRoute(currentLocalRouteUrl())) createClippingAutomationWindow();
  loadMainWindow(0, appUrl());
  mainWindow?.show();
  mainWindow?.focus();
});

app.on("before-quit", (event) => {
  event.preventDefault();
  if (quitInFlight) return;
  isShuttingDown = true;
  clearTimeout(loadRetryTimeout);
  if (displayWindow && !displayWindow.isDestroyed()) displayWindow.destroy();
  destroyClippingAutomationWindow();
  officeDisplayBridge?.stop();
  officeDisplayBridge = null;
  logMainDiagnostic("graceful shutdown started");
  quitInFlight = stopBackend().then(() => {
    logMainDiagnostic("graceful shutdown complete");
    app.exit(0);
  }).catch((error) => {
    logMainDiagnostic(`stopBackend failed ${error?.message || error}`);
    app.exit(1);
  });
});

app.on("quit", () => {
  teardownLocalDevReload();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

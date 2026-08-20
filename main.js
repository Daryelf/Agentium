const path = require("node:path");
const net = require("node:net");
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");

process.env.APP_MODE = process.env.APP_MODE || "local";
process.env.HOST = process.env.HOST || "127.0.0.1";
process.env.ARGENTUM_LOCAL_PORT = process.env.ARGENTUM_LOCAL_PORT || process.env.LOCAL_BACKEND_PORT || "5173";

let mainWindow = null;
let server = null;

app.setName("Argentum OS");

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

function appUrl() {
  const port = process.env.ARGENTUM_LOCAL_PORT || process.env.PORT || "5173";
  return `http://127.0.0.1:${port}`;
}

function appIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "icon.icns");
  }
  return path.join(__dirname, "argentum-icon.icns");
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
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

async function startBackend() {
  await chooseBackendPort();
  const argentum = require("../server");
  server = argentum.createArgentumServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(argentum.PORT, argentum.HOST, () => {
      try {
        argentum.localRuntimeStatusPayload();
        argentum.prewarmLocalOffices?.().catch(() => {});
        resolve();
      } catch (error) {
        reject(error);
      }
    });
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
    show: true,
  });

  mainWindow.once("ready-to-show", showMainWindow);
  mainWindow.webContents.once("did-finish-load", showMainWindow);
  mainWindow.webContents.on("did-fail-load", (_event, _errorCode, errorDescription) => {
    console.error(`Argentum OS failed to load the local app: ${errorDescription}`);
    showMainWindow();
  });
  setTimeout(showMainWindow, 1200);
  mainWindow.loadURL(appUrl()).catch((error) => {
    console.error(`Argentum OS failed to open ${appUrl()}: ${error.message}`);
    showMainWindow();
  });
}

ipcMain.handle("argentum:choose-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose Argentum OS workspace folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle("argentum:open-path", async (_event, targetPath) => {
  const value = String(targetPath || "").trim();
  if (!value) return { opened: false };
  const result = await shell.openPath(value);
  return { opened: !result, error: result || null };
});

app.whenReady().then(async () => {
  buildMenu();
  await startBackend();
  createWindow();
});

app.on("second-instance", showMainWindow);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    return;
  }
  mainWindow?.show();
  mainWindow?.focus();
});

app.on("before-quit", () => {
  if (server) server.close();
});

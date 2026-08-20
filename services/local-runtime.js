const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const LOCAL_APP_NAME = "Argentum OS";
const DEFAULT_LOCAL_PORT = 5173;

function resolveAppMode(env = process.env) {
  const explicit = String(env.APP_MODE || "").trim().toLowerCase();
  if (explicit === "cloud" || explicit === "production") return "cloud";
  if (explicit === "local" || explicit === "desktop" || explicit === "mac") return "local";
  if (env.RAILWAY_ENVIRONMENT || env.RAILWAY_PUBLIC_DOMAIN || env.RENDER || env.FLY_APP_NAME) return "cloud";
  return "local";
}

function localAppDataDir(env = process.env) {
  if (env.ARGENTUM_LOCAL_DATA_DIR) return path.resolve(env.ARGENTUM_LOCAL_DATA_DIR);
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", LOCAL_APP_NAME);
  }
  return path.join(os.homedir(), ".argentum-os");
}

function resolveDataDir(rootDir, env = process.env) {
  if (env.ARGENTUM_DATA_DIR) return path.resolve(env.ARGENTUM_DATA_DIR);
  return resolveAppMode(env) === "local" ? localAppDataDir(env) : path.join(rootDir, "data");
}

function resolvePort(env = process.env) {
  const raw = env.ARGENTUM_LOCAL_PORT || env.LOCAL_BACKEND_PORT || env.PORT || DEFAULT_LOCAL_PORT;
  const port = Number(raw);
  return Number.isFinite(port) && port > 0 ? port : DEFAULT_LOCAL_PORT;
}

function resolveHost(env = process.env) {
  if (env.HOST) return String(env.HOST).trim();
  return resolveAppMode(env) === "local" ? "127.0.0.1" : "0.0.0.0";
}

function isLocalHost(host) {
  const value = String(host || "").toLowerCase();
  return value === "127.0.0.1" || value === "localhost" || value === "::1";
}

function isLoopbackHost(host) {
  return isLocalHost(host);
}

function assertLocalModeHost(mode, host) {
  if (mode === "local" && !isLocalHost(host)) {
    throw new Error(`Local mode must bind to 127.0.0.1, localhost, or ::1. Refusing host ${host || "(empty)"}.`);
  }
}

function listeningAddress(server) {
  const address = server.address();
  if (typeof address === "string") return address;
  return address?.address || "";
}

function assertLocalListening(server, mode) {
  if (mode !== "local") return true;
  const address = listeningAddress(server);
  if (!isLocalHost(address)) {
    throw new Error(`Local mode startup check failed: backend is listening on ${address || "(unknown)"}.`);
  }
  return true;
}

function canReachLocalPort(port, host = "127.0.0.1", timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function publicRuntimeStatus({ appMode, host, port, dataDir, dbStatus = null }) {
  return {
    appName: LOCAL_APP_NAME,
    appMode,
    backendHost: host,
    backendPort: port,
    localOnly: appMode === "local" && isLocalHost(host),
    controlPanelExposure: appMode === "local" ? "Local Mac only" : "Cloud deployment",
    dataDir,
    labels: {
      controlPanel: appMode === "local" ? "Local" : "Cloud",
      aiProviders: "Cloud API",
      socialPlatforms: "External Integration",
      fileWorkspace: "Local",
    },
    database: dbStatus,
  };
}

module.exports = {
  DEFAULT_LOCAL_PORT,
  LOCAL_APP_NAME,
  assertLocalListening,
  assertLocalModeHost,
  canReachLocalPort,
  isLocalHost,
  isLoopbackHost,
  localAppDataDir,
  publicRuntimeStatus,
  resolveAppMode,
  resolveDataDir,
  resolveHost,
  resolvePort,
};

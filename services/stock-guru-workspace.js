const fs = require("node:fs");
const path = require("node:path");

const SETTINGS_FILE = "stock-guru-workspace.json";
const RUNTIME_FOLDER = "stock-guru-runtime";
const COPY_EXCLUDES = new Set([".DS_Store", ".git", ".pytest_cache", "__pycache__", ".venv"]);

function isStockGuruWorkspace(candidatePath, fsImpl = fs) {
  if (!candidatePath) return false;
  try {
    const resolved = path.resolve(candidatePath);
    return fsImpl.statSync(resolved).isDirectory()
      && fsImpl.statSync(path.join(resolved, "config")).isDirectory()
      && fsImpl.statSync(path.join(resolved, "reports")).isDirectory()
      && fsImpl.statSync(path.join(resolved, "src", "stock_guru")).isDirectory()
      && fsImpl.statSync(path.join(resolved, "bin", "stock-guru")).isFile();
  } catch (_error) {
    return false;
  }
}

function readPersistedWorkspace(userDataPath, fsImpl = fs) {
  if (!userDataPath) return "";
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(path.join(userDataPath, SETTINGS_FILE), "utf8"));
    return typeof parsed?.workspacePath === "string" ? parsed.workspacePath : "";
  } catch (_error) {
    return "";
  }
}

function mountedDriveCandidates(volumesRoot = "/Volumes", fsImpl = fs) {
  try {
    return fsImpl.readdirSync(volumesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => path.join(volumesRoot, entry.name, "Argentum", "stocks"));
  } catch (_error) {
    return [];
  }
}

function persistWorkspace(userDataPath, workspacePath, source, fsImpl = fs) {
  if (!userDataPath || !workspacePath) return;
  const settingsPath = path.join(userDataPath, SETTINGS_FILE);
  const temporaryPath = `${settingsPath}.${process.pid}.tmp`;
  try {
    fsImpl.mkdirSync(userDataPath, { recursive: true });
    fsImpl.writeFileSync(temporaryPath, `${JSON.stringify({
      workspacePath,
      source,
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`, "utf8");
    fsImpl.renameSync(temporaryPath, settingsPath);
  } catch (_error) {
    try {
      fsImpl.rmSync(temporaryPath, { force: true });
    } catch (_cleanupError) {}
  }
}

function copyTreeNewer(sourcePath, targetPath, fsImpl = fs) {
  const sourceStat = fsImpl.statSync(sourcePath);
  if (sourceStat.isDirectory()) {
    fsImpl.mkdirSync(targetPath, { recursive: true });
    for (const entry of fsImpl.readdirSync(sourcePath, { withFileTypes: true })) {
      if (COPY_EXCLUDES.has(entry.name)) continue;
      copyTreeNewer(path.join(sourcePath, entry.name), path.join(targetPath, entry.name), fsImpl);
    }
    return;
  }
  if (!sourceStat.isFile()) return;
  let targetStat = null;
  try {
    targetStat = fsImpl.statSync(targetPath);
  } catch (_error) {}
  if (targetStat && targetStat.isFile() && targetStat.mtimeMs >= sourceStat.mtimeMs) return;
  fsImpl.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.tmp`;
  fsImpl.copyFileSync(sourcePath, temporaryPath);
  fsImpl.chmodSync(temporaryPath, sourceStat.mode);
  fsImpl.renameSync(temporaryPath, targetPath);
}

function linkPythonEnvironment(sourcePath, runtimePath, fsImpl = fs) {
  const sourceEnvironment = path.join(sourcePath, ".venv");
  const runtimeEnvironment = path.join(runtimePath, ".venv");
  if (!fsImpl.existsSync(path.join(sourceEnvironment, "bin", "python"))) return false;
  if (path.resolve(sourceEnvironment) === path.resolve(runtimeEnvironment)) {
    return true;
  }
  try {
    const current = fsImpl.lstatSync(runtimeEnvironment);
    if (current.isSymbolicLink() && path.resolve(path.dirname(runtimeEnvironment), fsImpl.readlinkSync(runtimeEnvironment)) === sourceEnvironment) return true;
    if (current.isSymbolicLink()) fsImpl.unlinkSync(runtimeEnvironment);
    else return false;
  } catch (_error) {}
  fsImpl.symlinkSync(sourceEnvironment, runtimeEnvironment, "dir");
  return true;
}

function reuseExistingRuntime(sourcePath, userDataPath, fsImpl = fs) {
  const runtimePath = path.join(userDataPath, RUNTIME_FOLDER);
  if (!isStockGuruWorkspace(runtimePath, fsImpl)) return null;
  try {
    const metadata = JSON.parse(fsImpl.readFileSync(path.join(runtimePath, ".argentum-runtime.json"), "utf8"));
    if (path.resolve(String(metadata?.sourcePath || "")) !== sourcePath) return null;
  } catch (_error) {
    return null;
  }
  const pythonLinked = sourcePath === runtimePath
    ? fsImpl.existsSync(path.join(sourcePath, ".venv", "bin", "python"))
    : linkPythonEnvironment(sourcePath, runtimePath, fsImpl);
  return {
    path: runtimePath,
    sourcePath,
    available: true,
    pythonLinked,
    reusedExisting: true,
  };
}

function materializeStockGuruRuntime(options = {}) {
  const fsImpl = options.fsImpl || fs;
  const sourcePath = path.resolve(String(options.sourcePath || ""));
  const userDataPath = path.resolve(String(options.userDataPath || ""));
  if (!isStockGuruWorkspace(sourcePath, fsImpl)) {
    return { path: sourcePath, sourcePath, available: false, pythonLinked: false };
  }
  const runtimePath = path.join(userDataPath, RUNTIME_FOLDER);
  if (options.reuseExisting === true) {
    const existingRuntime = reuseExistingRuntime(sourcePath, userDataPath, fsImpl);
    if (existingRuntime) return existingRuntime;
  }
  fsImpl.mkdirSync(runtimePath, { recursive: true });
  for (const entry of ["src", "config", "data", "reports", "bin", "pyproject.toml", "requirements.txt"]) {
    const sourceEntry = path.join(sourcePath, entry);
    if (!fsImpl.existsSync(sourceEntry)) continue;
    copyTreeNewer(sourceEntry, path.join(runtimePath, entry), fsImpl);
  }
  const pythonLinked = linkPythonEnvironment(sourcePath, runtimePath, fsImpl);
  fsImpl.writeFileSync(path.join(runtimePath, ".argentum-runtime.json"), `${JSON.stringify({
    sourcePath,
    runtimePath,
    pythonLinked,
    refreshedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
  return {
    path: runtimePath,
    sourcePath,
    available: isStockGuruWorkspace(runtimePath, fsImpl),
    pythonLinked,
    reusedExisting: false,
  };
}

function resolveStockGuruWorkspace(options = {}) {
  const fsImpl = options.fsImpl || fs;
  const environment = options.env || process.env;
  const explicitPath = String(environment.STOCK_GURU_PATH || "").trim();
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    return {
      path: resolved,
      available: isStockGuruWorkspace(resolved, fsImpl),
      source: "environment",
      configured: true,
    };
  }

  const candidates = [];
  const persistedPath = readPersistedWorkspace(options.userDataPath, fsImpl);
  if (persistedPath) candidates.push({ path: persistedPath, source: "persisted" });
  if (options.workspaceRoot) candidates.push({ path: path.join(options.workspaceRoot, "stocks"), source: "adjacent_source" });
  for (const candidatePath of mountedDriveCandidates(options.volumesRoot, fsImpl)) {
    candidates.push({ path: candidatePath, source: "mounted_drive" });
  }

  const seen = new Set();
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate.path);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    if (!isStockGuruWorkspace(resolved, fsImpl)) continue;
    persistWorkspace(options.userDataPath, resolved, candidate.source, fsImpl);
    return { path: resolved, available: true, source: candidate.source, configured: false };
  }

  const fallback = path.resolve(options.workspaceRoot || process.cwd(), "stocks");
  return { path: fallback, available: false, source: "not_found", configured: false };
}

module.exports = {
  RUNTIME_FOLDER,
  SETTINGS_FILE,
  copyTreeNewer,
  isStockGuruWorkspace,
  materializeStockGuruRuntime,
  mountedDriveCandidates,
  readPersistedWorkspace,
  resolveStockGuruWorkspace,
};

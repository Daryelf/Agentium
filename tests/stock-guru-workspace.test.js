const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  SETTINGS_FILE,
  isStockGuruWorkspace,
  materializeStockGuruRuntime,
  resolveStockGuruWorkspace,
} = require("../services/stock-guru-workspace");

function createWorkspace(root) {
  const stockRoot = path.join(root, "Argentum", "stocks");
  fs.mkdirSync(path.join(stockRoot, "config"), { recursive: true });
  fs.mkdirSync(path.join(stockRoot, "reports"), { recursive: true });
  fs.mkdirSync(path.join(stockRoot, "src", "stock_guru"), { recursive: true });
  fs.mkdirSync(path.join(stockRoot, "bin"), { recursive: true });
  fs.writeFileSync(path.join(stockRoot, "bin", "stock-guru"), "#!/bin/sh\n");
  return stockRoot;
}

test("server auto-discovers Stock Guru on a mounted portable drive", (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-stock-discovery-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const volumesRoot = path.join(tempRoot, "Volumes");
  const userDataPath = path.join(tempRoot, "Application Support", "Argentum OS");
  const expected = createWorkspace(path.join(volumesRoot, "ZYLO"));

  const resolved = resolveStockGuruWorkspace({
    env: {},
    workspaceRoot: path.join(tempRoot, "Argentum"),
    userDataPath,
    volumesRoot,
  });

  assert.equal(resolved.available, true);
  assert.equal(resolved.path, expected);
  assert.equal(resolved.source, "mounted_drive");
  assert.equal(JSON.parse(fs.readFileSync(path.join(userDataPath, SETTINGS_FILE), "utf8")).workspacePath, expected);
});

test("persisted workspace reconnects without rescanning mounted drives", (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-stock-persisted-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const userDataPath = path.join(tempRoot, "user-data");
  const stockRoot = createWorkspace(path.join(tempRoot, "portable"));
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(path.join(userDataPath, SETTINGS_FILE), JSON.stringify({ workspacePath: stockRoot }));

  const resolved = resolveStockGuruWorkspace({
    env: {},
    workspaceRoot: path.join(tempRoot, "packaged"),
    userDataPath,
    volumesRoot: path.join(tempRoot, "missing-volumes"),
  });

  assert.equal(isStockGuruWorkspace(stockRoot), true);
  assert.equal(resolved.path, stockRoot);
  assert.equal(resolved.source, "persisted");
});

test("explicit STOCK_GURU_PATH remains authoritative and reports a bad path", () => {
  const resolved = resolveStockGuruWorkspace({
    env: { STOCK_GURU_PATH: "/definitely/not/a/stock/workspace" },
    workspaceRoot: "/tmp/ignored",
    userDataPath: "",
  });
  assert.equal(resolved.configured, true);
  assert.equal(resolved.available, false);
  assert.equal(resolved.source, "environment");
});

test("managed runtime copies reports while linking the existing Python environment", (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-stock-runtime-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const sourceRoot = createWorkspace(path.join(tempRoot, "portable"));
  fs.mkdirSync(path.join(sourceRoot, ".venv", "bin"), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, ".venv", "bin", "python"), "python placeholder");
  fs.writeFileSync(path.join(sourceRoot, "reports", "evaluations.json"), "[{\"ticker\":\"AAPL\"}]\n");
  fs.writeFileSync(path.join(sourceRoot, "config", "universe.txt"), "AAPL\n");
  const userDataPath = path.join(tempRoot, "user-data");

  const runtime = materializeStockGuruRuntime({ sourcePath: sourceRoot, userDataPath });

  assert.equal(runtime.available, true);
  assert.equal(runtime.pythonLinked, true);
  assert.equal(fs.lstatSync(path.join(runtime.path, ".venv")).isSymbolicLink(), true);
  assert.match(fs.readFileSync(path.join(runtime.path, "reports", "evaluations.json"), "utf8"), /AAPL/);
  const generatedReport = path.join(runtime.path, "reports", "evaluations.json");
  fs.writeFileSync(generatedReport, "[{\"ticker\":\"NET\"}]\n");
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(generatedReport, future, future);
  materializeStockGuruRuntime({ sourcePath: sourceRoot, userDataPath });
  assert.match(fs.readFileSync(generatedReport, "utf8"), /NET/);
});

test("managed runtime never copies the portable virtual environment into local data", (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-stock-runtime-exclude-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const sourceRoot = createWorkspace(path.join(tempRoot, "portable"));
  fs.mkdirSync(path.join(sourceRoot, ".venv", "bin"), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, ".venv", "bin", "python"), "python placeholder");
  fs.writeFileSync(path.join(sourceRoot, ".venv", "large-private-build-artifact"), "must not be copied");
  const runtime = materializeStockGuruRuntime({ sourcePath: sourceRoot, userDataPath: path.join(tempRoot, "user-data") });

  assert.equal(runtime.pythonLinked, true);
  assert.equal(fs.lstatSync(path.join(runtime.path, ".venv")).isSymbolicLink(), true);
  assert.equal(fs.existsSync(path.join(runtime.path, ".venv", "large-private-build-artifact")), true);
  assert.equal(fs.readlinkSync(path.join(runtime.path, ".venv")), path.join(sourceRoot, ".venv"));
});

test("server startup reuses a verified managed runtime without rescanning the portable source tree", (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-stock-runtime-reuse-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const sourceRoot = createWorkspace(path.join(tempRoot, "portable"));
  fs.writeFileSync(path.join(sourceRoot, "config", "universe.txt"), "AAPL\n");
  const userDataPath = path.join(tempRoot, "user-data");
  const initial = materializeStockGuruRuntime({ sourcePath: sourceRoot, userDataPath });
  assert.equal(initial.available, true);

  const guardedFs = Object.create(fs);
  guardedFs.readdirSync = (candidatePath, options) => {
    if (path.resolve(candidatePath).startsWith(path.resolve(sourceRoot))) {
      throw new Error("portable source tree was rescanned during startup");
    }
    return fs.readdirSync(candidatePath, options);
  };
  const reused = materializeStockGuruRuntime({
    sourcePath: sourceRoot,
    userDataPath,
    reuseExisting: true,
    fsImpl: guardedFs,
  });

  assert.equal(reused.available, true);
  assert.equal(reused.reusedExisting, true);
  assert.equal(reused.path, initial.path);
});

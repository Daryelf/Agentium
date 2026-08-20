const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("desktop clip saves use unique streaming temps and serialized final naming", () => {
  const source = fs.readFileSync(path.join(root, "desktop", "main.js"), "utf8");
  const finalizer = source.match(/async function finalizeClipOutput[\s\S]*?\n\}/)?.[0] || "";
  const saveHandler = source.match(/ipcMain\.handle\("argentum:save-clip-to-output-folder"[\s\S]*?\n\}\);/)?.[0] || "";

  assert.match(source, /const crypto = require\("node:crypto"\)/);
  assert.match(source, /let clipOutputFinalizationTail = Promise\.resolve\(\)/);
  assert.match(finalizer, /withClipOutputFinalizationLock/);
  assert.match(finalizer, /availableClipOutputPath/);
  assert.match(finalizer, /await fs\.promises\.rename\(temporaryPath, outputPath\)/);
  assert.match(saveHandler, /crypto\.randomUUID\(\)/);
  assert.match(saveHandler, /fs\.createWriteStream\(temporaryPath, \{ flags: "wx" \}\)/);
  assert.match(saveHandler, /outputPath = await finalizeClipOutput\(temporaryPath, folderPath, fileName\)/);
  assert.doesNotMatch(saveHandler, /response\.arrayBuffer\(\)/);
  assert.doesNotMatch(saveHandler, /Date\.now\(\).*\.part/);
});

test("offline compactor defaults to one watcher and preserves records while interrupting stale jobs", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-offline-compactor-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const statePath = path.join(dataDir, "state.json");
  const overviewPath = path.join(dataDir, "overview.json");
  const originalState = {
    automation: { enabled: true, maxAutoStreams: 8 },
    streamers: [
      { id: "streamer-old", monitorEnabled: true, updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "streamer-middle", monitorEnabled: true, updatedAt: "2026-01-02T00:00:00.000Z" },
      { id: "streamer-new", monitorEnabled: true, updatedAt: "2026-01-03T00:00:00.000Z" }
    ],
    watchSessions: [
      { id: "session-old", streamerId: "streamer-old", status: "watching", heartbeatAt: "2026-01-01T00:00:00.000Z" },
      { id: "session-middle", streamerId: "streamer-middle", status: "reconnecting", heartbeatAt: "2026-01-02T00:00:00.000Z" },
      { id: "session-new", streamerId: "streamer-new", status: "watching", heartbeatAt: "2026-01-03T00:00:00.000Z" },
      { id: "session-terminal", streamerId: "streamer-old", status: "cancelled", updatedAt: "2026-01-04T00:00:00.000Z" }
    ],
    captureJobs: [
      { id: "job-retained", watchSessionId: "session-new", status: "running" },
      { id: "job-paused", watchSessionId: "session-middle", status: "running" },
      { id: "job-terminal", watchSessionId: "session-terminal", status: "running" },
      { id: "job-orphan", watchSessionId: "missing-session", status: "running" },
      { id: "job-complete", watchSessionId: "session-old", status: "completed" }
    ],
    mediaSources: [{
      id: "source-1",
      watchWindowSignals: {
        chatSpikes: Array.from({ length: 5 }, (_, index) => ({ index })),
        chatKeywords: Array.from({ length: 6 }, (_, index) => ({ index }))
      }
    }],
    clipCandidates: [{ id: "candidate-1" }, { id: "candidate-2" }],
    clipPackages: [],
    postingDrafts: [],
    approvalRequests: [],
    mediaJobs: [],
    artifacts: [],
    watchEvents: []
  };
  const originalStateText = `${JSON.stringify(originalState, null, 2)}\n`;
  const originalOverviewText = "{\"sentinel\":\"before\"}\n";
  fs.writeFileSync(statePath, originalStateText);
  fs.writeFileSync(overviewPath, originalOverviewText);

  const result = spawnSync(process.execPath, [
    path.join(root, "scripts", "compact-clipping-state-memory.mjs"),
    "--apply",
    "--state",
    statePath
  ], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  const compacted = JSON.parse(fs.readFileSync(statePath, "utf8"));

  assert.equal(report.applied, true);
  assert.equal(report.after.activeWatchers, 1);
  assert.deepEqual(report.capacity.retainedSessionIds, ["session-new"]);
  assert.deepEqual(new Set(report.capacity.pausedSessionIds), new Set(["session-middle", "session-old"]));
  assert.deepEqual(
    new Set(report.capacity.interruptedCaptureJobIds),
    new Set(["job-paused", "job-terminal", "job-orphan"])
  );
  assert.equal(compacted.watchSessions.length, originalState.watchSessions.length);
  assert.equal(compacted.captureJobs.length, originalState.captureJobs.length);
  assert.deepEqual(
    compacted.captureJobs.map((job) => job.id).sort(),
    originalState.captureJobs.map((job) => job.id).sort()
  );
  assert.equal(compacted.captureJobs.find((job) => job.id === "job-retained").status, "running");
  for (const jobId of ["job-paused", "job-terminal", "job-orphan"]) {
    const job = compacted.captureJobs.find((item) => item.id === jobId);
    assert.equal(job.status, "interrupted");
    assert.equal(job.interruptionReason, "offline_memory_optimization");
    assert.ok(job.updatedAt);
  }
  assert.equal(compacted.captureJobs.find((job) => job.id === "job-complete").status, "completed");
  assert.deepEqual(
    compacted.streamers.filter((streamer) => streamer.monitorEnabled).map((streamer) => streamer.id),
    ["streamer-new"]
  );
  assert.equal(compacted.automation.maxAutoStreams, 1);
  assert.equal(fs.readFileSync(report.backupPath, "utf8"), originalStateText);
  assert.equal(fs.readFileSync(report.overviewBackupPath, "utf8"), originalOverviewText);
  assert.equal(JSON.parse(fs.readFileSync(overviewPath, "utf8")).schemaVersion, 1);
  assert.deepEqual(
    fs.readdirSync(dataDir).filter((name) => name.endsWith(".staged") || name.endsWith(".rollback")),
    []
  );
});

test("offline compactor checks signatures before paired replacement and rolls back atomically", () => {
  const source = fs.readFileSync(path.join(root, "scripts", "compact-clipping-state-memory.mjs"), "utf8");
  const stateCheck = source.indexOf("const currentStateSignature = await stableFileSignature(statePath)");
  const stateReplace = source.indexOf("await fs.rename(stagedStatePath, statePath)");
  const restoreHelper = source.match(/async function restoreBackupAtomic[\s\S]*?\n\}/)?.[0] || "";

  assert.ok(stateCheck >= 0 && stateCheck < stateReplace);
  assert.match(source, /currentOverview\.exists !== initialOverview\.exists/);
  assert.match(source, /sameFileSignature\(initialStateSignature, currentStateSignature\)/);
  assert.match(restoreHelper, /fs\.copyFile\(backupPath, restorePath, fsConstants\.COPYFILE_EXCL\)/);
  assert.match(restoreHelper, /await fs\.rename\(restorePath, targetPath\)/);
  assert.doesNotMatch(source, /fs\.copyFile\(backupPath, statePath\)/);
  assert.match(source, /argumentValue\("--watcher-limit", "1"\), 1, 1, 8/);
});

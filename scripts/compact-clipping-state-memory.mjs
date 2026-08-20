#!/usr/bin/env node

import fs from "node:fs/promises";
import { constants as fsConstants, createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  compactStateForMemory,
  createStateOverview
} from "../CLIPPING OFFICE /services/state-memory.js";

const ACTIVE_WATCH_STATUSES = new Set([
  "queued",
  "starting",
  "connecting",
  "watching",
  "degraded",
  "reconnecting"
]);

function argumentValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || fallback) : fallback;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

function recordTimestamp(value = {}) {
  return Date.parse(value.heartbeatAt || value.updatedAt || value.startedAt || value.createdAt || "") || 0;
}

function enforceWatcherCapacity(state, limit = 1, timestamp = new Date().toISOString()) {
  const sessions = Array.isArray(state.watchSessions) ? state.watchSessions : [];
  const streamers = Array.isArray(state.streamers) ? state.streamers : [];
  const captureJobs = Array.isArray(state.captureJobs) ? state.captureJobs : [];
  const activeSessions = sessions
    .filter((session) => ACTIVE_WATCH_STATUSES.has(String(session?.status || "").toLowerCase()))
    .sort((left, right) => recordTimestamp(right) - recordTimestamp(left));
  const retainedSessions = activeSessions.slice(0, limit);
  const retainedSessionIds = new Set(retainedSessions.map((session) => session.id).filter(Boolean));
  const retainedStreamerIds = new Set(retainedSessions.map((session) => session.streamerId).filter(Boolean));
  const pausedSessionIds = [];

  for (const session of activeSessions) {
    if (retainedSessionIds.has(session.id)) continue;
    session.status = "paused";
    session.stopRequested = true;
    session.stopRequestedStatus = "paused";
    session.pauseReason = "offline_memory_optimization";
    session.workerId = null;
    session.leaseExpiresAt = null;
    session.updatedAt = timestamp;
    if (session.captureStatus === "capturing") {
      session.captureStatus = "ready";
      session.captureMessage = "Capture was paused while reducing the local memory workload.";
    }
    pausedSessionIds.push(session.id);
  }

  const interruptedCaptureJobIds = [];
  for (const job of captureJobs) {
    if (job.status !== "running" || retainedSessionIds.has(job.watchSessionId)) continue;
    job.status = "interrupted";
    job.error = "Paused by the offline memory optimizer.";
    job.interruptionReason = "offline_memory_optimization";
    job.updatedAt = timestamp;
    interruptedCaptureJobIds.push(job.id);
  }

  const monitoredStreamers = streamers
    .filter((streamer) => streamer?.monitorEnabled === true)
    .sort((left, right) => {
      const retainedDifference = Number(retainedStreamerIds.has(right.id)) - Number(retainedStreamerIds.has(left.id));
      return retainedDifference || recordTimestamp(right) - recordTimestamp(left);
    });
  const retainedMonitorIds = new Set(monitoredStreamers.slice(0, limit).map((streamer) => streamer.id));
  const pausedStreamerIds = [];
  for (const streamer of monitoredStreamers) {
    if (retainedMonitorIds.has(streamer.id)) continue;
    streamer.monitorEnabled = false;
    streamer.monitorPausedAt = timestamp;
    streamer.updatedAt = timestamp;
    pausedStreamerIds.push(streamer.id);
  }

  if (state.automation && typeof state.automation === "object") {
    state.automation.maxAutoStreams = Math.min(
      limit,
      Math.max(1, Number(state.automation.maxAutoStreams || limit))
    );
    state.automation.updatedAt = timestamp;
  }

  return {
    retainedSessionIds: [...retainedSessionIds],
    pausedSessionIds,
    pausedStreamerIds,
    interruptedCaptureJobIds
  };
}

function summarize(state, bytes) {
  const sessions = Array.isArray(state.watchSessions) ? state.watchSessions : [];
  const activeWatchers = sessions.filter((session) => (
    ACTIVE_WATCH_STATUSES.has(String(session?.status || "").toLowerCase())
  )).length;
  const mediaSources = Array.isArray(state.mediaSources) ? state.mediaSources : [];
  const persistedChatSignals = mediaSources.reduce((total, source) => (
    total
      + (Array.isArray(source?.watchWindowSignals?.chatSpikes) ? source.watchWindowSignals.chatSpikes.length : 0)
      + (Array.isArray(source?.watchWindowSignals?.chatKeywords) ? source.watchWindowSignals.chatKeywords.length : 0)
  ), 0);
  return {
    bytes,
    activeWatchers,
    maxAutoStreams: Number(state.automation?.maxAutoStreams || 0),
    mediaSources: mediaSources.length,
    persistedChatSignals
  };
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function fileMetadata(stat) {
  return {
    device: String(stat.dev),
    inode: String(stat.ino),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs
  };
}

function sameMetadata(left, right) {
  return left.device === right.device
    && left.inode === right.inode
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function hashText(contents) {
  return createHash("sha256").update(contents, "utf8").digest("hex");
}

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

async function readStableUtf8File(filePath) {
  const beforeStat = await fs.stat(filePath);
  if (!beforeStat.isFile()) throw new Error(`State path is not a file: ${filePath}`);
  const contents = await fs.readFile(filePath, "utf8");
  const afterStat = await fs.stat(filePath);
  const before = fileMetadata(beforeStat);
  const after = fileMetadata(afterStat);
  if (!sameMetadata(before, after)) {
    throw new Error(`File changed while it was being read: ${filePath}`);
  }
  return {
    contents,
    stat: afterStat,
    signature: { ...after, sha256: hashText(contents) }
  };
}

async function readOptionalStableUtf8File(filePath) {
  try {
    const snapshot = await readStableUtf8File(filePath);
    return { exists: true, ...snapshot };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, contents: "", stat: null, signature: null };
    throw error;
  }
}

async function stableFileSignature(filePath) {
  const beforeStat = await fs.stat(filePath);
  const sha256 = await hashFile(filePath);
  const afterStat = await fs.stat(filePath);
  const before = fileMetadata(beforeStat);
  const after = fileMetadata(afterStat);
  if (!sameMetadata(before, after)) {
    throw new Error(`File changed while its signature was being checked: ${filePath}`);
  }
  return { ...after, sha256 };
}

async function optionalStableFileSignature(filePath) {
  try {
    return { exists: true, signature: await stableFileSignature(filePath) };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, signature: null };
    throw error;
  }
}

function sameFileSignature(left, right) {
  if (!left || !right) return left === right;
  return sameMetadata(left, right) && left.sha256 === right.sha256;
}

function temporarySibling(filePath, label) {
  return `${filePath}.${process.pid}.${randomUUID()}.${label}`;
}

async function writeDurableExclusive(filePath, contents, mode) {
  const handle = await fs.open(filePath, "wx", mode & 0o777);
  let completed = false;
  try {
    await handle.writeFile(contents, { encoding: "utf8" });
    await handle.sync();
    completed = true;
  } finally {
    await handle.close().catch(() => {});
    if (!completed) await fs.rm(filePath, { force: true }).catch(() => {});
  }
}

async function syncFile(filePath) {
  const handle = await fs.open(filePath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function restoreBackupAtomic(backupPath, targetPath, mode) {
  const restorePath = temporarySibling(targetPath, "rollback");
  let restoreCreated = false;
  try {
    await fs.copyFile(backupPath, restorePath, fsConstants.COPYFILE_EXCL);
    restoreCreated = true;
    await fs.chmod(restorePath, mode & 0o777);
    await syncFile(restorePath);
    await fs.rename(restorePath, targetPath);
    restoreCreated = false;
  } finally {
    if (restoreCreated) await fs.rm(restorePath, { force: true }).catch(() => {});
  }
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log("Usage: node scripts/compact-clipping-state-memory.mjs [--apply] [--state PATH] [--watcher-limit N (default: 1)]");
    return;
  }

  const defaultStatePath = path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "Argentum OS",
    "clipping-office",
    "state.json"
  );
  const statePath = path.resolve(argumentValue("--state", defaultStatePath));
  const overviewPath = path.join(path.dirname(statePath), "overview.json");
  const watcherLimit = boundedInteger(argumentValue("--watcher-limit", "1"), 1, 1, 8);
  const apply = process.argv.includes("--apply");
  const stateSnapshot = await readStableUtf8File(statePath);
  const { contents: raw, stat, signature: initialStateSignature } = stateSnapshot;
  const state = JSON.parse(raw);
  const before = summarize(state, Buffer.byteLength(raw, "utf8"));
  compactStateForMemory(state, { maxRecordingWindows: 60, watchSignalLimit: 3 });
  const capacity = enforceWatcherCapacity(state, watcherLimit);
  const compactedJson = JSON.stringify(state);
  const after = summarize(state, Buffer.byteLength(compactedJson, "utf8"));
  const overviewJson = JSON.stringify(createStateOverview(state, { maxBytes: 1024 * 1024 }));

  if (!apply) {
    console.log(JSON.stringify({ applied: false, statePath, before, after, capacity }, null, 2));
    return;
  }

  const initialOverview = await readOptionalStableUtf8File(overviewPath);
  const backupSlug = timestampSlug();
  const backupPath = `${statePath}.pre-memory-optimization-${backupSlug}.bak`;
  const overviewBackupPath = initialOverview.exists
    ? `${overviewPath}.pre-memory-optimization-${backupSlug}.bak`
    : null;
  const stagedStatePath = temporarySibling(statePath, "staged");
  const stagedOverviewPath = temporarySibling(overviewPath, "staged");
  let stagedStateCreated = false;
  let stagedOverviewCreated = false;
  let stateBackupCreated = false;
  let overviewBackupCreated = false;
  let transactionStarted = false;
  let stateReplaced = false;
  let overviewReplaced = false;
  let writtenState = null;
  let writtenOverview = null;

  try {
    await writeDurableExclusive(stagedStatePath, compactedJson, stat.mode);
    stagedStateCreated = true;
    await writeDurableExclusive(stagedOverviewPath, overviewJson, initialOverview.stat?.mode || stat.mode);
    stagedOverviewCreated = true;
    await writeDurableExclusive(backupPath, raw, stat.mode);
    stateBackupCreated = true;
    if (overviewBackupPath) {
      await writeDurableExclusive(overviewBackupPath, initialOverview.contents, initialOverview.stat.mode);
      overviewBackupCreated = true;
    }

    const currentOverview = await optionalStableFileSignature(overviewPath);
    const currentStateSignature = await stableFileSignature(statePath);
    if (!sameFileSignature(initialStateSignature, currentStateSignature)) {
      throw new Error("Clipping Office state changed before replacement. Close Argentum and rerun the compactor.");
    }
    if (
      currentOverview.exists !== initialOverview.exists
      || !sameFileSignature(initialOverview.signature, currentOverview.signature)
    ) {
      throw new Error("Clipping Office overview changed before replacement. Close Argentum and rerun the compactor.");
    }

    transactionStarted = true;
    await fs.rename(stagedStatePath, statePath);
    stagedStateCreated = false;
    stateReplaced = true;
    await fs.rename(stagedOverviewPath, overviewPath);
    stagedOverviewCreated = false;
    overviewReplaced = true;
    writtenState = await fs.stat(statePath);
    writtenOverview = await fs.stat(overviewPath);
  } catch (error) {
    const rollbackErrors = [];
    if (transactionStarted && stateReplaced) {
      try {
        await restoreBackupAtomic(backupPath, statePath, stat.mode);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (transactionStarted && overviewReplaced) {
      try {
        if (overviewBackupPath) {
          await restoreBackupAtomic(overviewBackupPath, overviewPath, initialOverview.stat.mode);
        } else {
          await fs.rm(overviewPath, { force: true });
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (!transactionStarted) {
      if (stateBackupCreated) await fs.rm(backupPath, { force: true }).catch(() => {});
      if (overviewBackupCreated) await fs.rm(overviewBackupPath, { force: true }).catch(() => {});
    }
    if (rollbackErrors.length) {
      throw new AggregateError(rollbackErrors, "Compaction failed and atomic rollback was incomplete.", { cause: error });
    }
    throw error;
  } finally {
    if (stagedStateCreated) await fs.rm(stagedStatePath, { force: true }).catch(() => {});
    if (stagedOverviewCreated) await fs.rm(stagedOverviewPath, { force: true }).catch(() => {});
  }

  console.log(JSON.stringify({
    applied: true,
    statePath,
    overviewPath,
    backupPath,
    overviewBackupPath,
    before,
    after: { ...after, bytes: writtenState.size },
    overviewBytes: writtenOverview.size,
    capacity
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});

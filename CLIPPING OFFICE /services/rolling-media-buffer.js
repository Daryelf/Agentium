import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function concatPath(filePath = "") {
  return String(filePath).replaceAll("'", "'\\''");
}

export function selectRecentBufferSegments(segments = [], options = {}) {
  const lookbackMs = boundedNumber(options.lookbackSeconds, 60, 5, 300) * 1000;
  const endAtMs = Number(options.endAtMs || Date.now());
  const startAtMs = endAtMs - lookbackMs;
  const ordered = segments
    .filter((segment) => Number.isFinite(Number(segment.completedAtMs || segment.mtimeMs)))
    .sort((left, right) => Number(left.completedAtMs || left.mtimeMs) - Number(right.completedAtMs || right.mtimeMs));
  const selected = ordered.filter((segment) => {
    const completedAtMs = Number(segment.completedAtMs || segment.mtimeMs);
    return completedAtMs <= endAtMs && completedAtMs >= startAtMs;
  });
  if (!selected.length) return [];

  const firstIndex = ordered.indexOf(selected[0]);
  if (firstIndex > 0) selected.unshift(ordered[firstIndex - 1]);
  return selected;
}

export function findRollingRecorderProcesses(psOutput = "", rollingDirectory = "", currentPid = 0) {
  const marker = path.resolve(String(rollingDirectory || "."));
  return String(psOutput || "")
    .split("\n")
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/))
    .filter(Boolean)
    .map((match) => ({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }))
    .filter((row) => row.pid > 1 && row.pid !== Number(currentPid || 0))
    .filter((row) => /(?:^|\/)ffmpeg(?:\s|$)/.test(row.command))
    .filter((row) => row.command.includes(marker));
}

export class RollingMediaBuffer {
  constructor(options = {}) {
    this.ffmpegExecutable = options.ffmpegExecutable || "ffmpeg";
    this.directory = path.resolve(options.directory || ".rolling-media-buffer");
    this.segmentSeconds = boundedNumber(options.segmentSeconds, 4, 2, 15);
    this.retentionSeconds = boundedNumber(options.retentionSeconds, 150, 30, 600);
    this.spawnImpl = options.spawnImpl || spawn;
    this.process = null;
    this.inputUrl = "";
    this.startedAt = 0;
    this.lastError = "";
    this.lastExit = null;
  }

  get running() {
    return Boolean(this.process && this.process.exitCode === null && !this.process.killed);
  }

  async start(inputUrl) {
    if (this.running) return this.status();
    if (!String(inputUrl || "").trim()) throw new Error("Rolling buffer requires a live playback URL.");
    await fs.mkdir(this.directory, { recursive: true });
    this.inputUrl = String(inputUrl);
    this.lastError = "";
    this.lastExit = null;
    const outputPattern = path.join(this.directory, "%Y%m%dT%H%M%S.ts");
    const args = [
      "-hide_banner",
      "-loglevel", "warning",
      "-i", this.inputUrl,
      "-map", "0:v:0",
      "-map", "0:a:0?",
      "-c", "copy",
      "-f", "segment",
      "-segment_time", String(this.segmentSeconds),
      "-segment_format", "mpegts",
      "-reset_timestamps", "1",
      "-strftime", "1",
      outputPattern
    ];
    const child = this.spawnImpl(this.ffmpegExecutable, args, { stdio: ["ignore", "ignore", "pipe"] });
    this.process = child;
    this.startedAt = Date.now();
    let diagnostic = "";
    child.stderr?.on?.("data", (chunk) => {
      diagnostic = `${diagnostic}${String(chunk || "")}`.slice(-2000);
    });
    child.on?.("error", (error) => {
      this.lastError = error.message;
    });
    child.on?.("exit", (code, signal) => {
      this.lastExit = { code, signal, at: Date.now() };
      if (code && !this.lastError) this.lastError = diagnostic.trim() || `FFmpeg rolling buffer exited with code ${code}.`;
    });
    return this.status();
  }

  async stop({ removeSegments = false } = {}) {
    const child = this.process;
    this.process = null;
    if (child && child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
          resolve();
        }, 2500);
        timeout.unref?.();
        child.once?.("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    if (removeSegments) await fs.rm(this.directory, { recursive: true, force: true }).catch(() => {});
  }

  async segments() {
    const entries = await fs.readdir(this.directory, { withFileTypes: true }).catch(() => []);
    const segmentFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".ts"));
    const values = await Promise.all(segmentFiles.map(async (entry) => {
      const filePath = path.join(this.directory, entry.name);
      const stat = await fs.stat(filePath).catch(() => null);
      return stat?.size > 0 ? {
        filePath,
        name: entry.name,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        completedAtMs: stat.mtimeMs
      } : null;
    }));
    return values.filter(Boolean).sort((left, right) => left.completedAtMs - right.completedAtMs);
  }

  async cleanup(referenceMs = Date.now()) {
    const cutoff = Number(referenceMs) - (this.retentionSeconds * 1000);
    const segments = await this.segments();
    const expired = segments.filter((segment) => segment.completedAtMs < cutoff);
    await Promise.all(expired.map((segment) => fs.rm(segment.filePath, { force: true }).catch(() => {})));
    return { removed: expired.length, retained: segments.length - expired.length };
  }

  async status() {
    const segments = await this.segments();
    const oldest = segments[0];
    const newest = segments.at(-1);
    const bufferedSeconds = oldest && newest
      ? Math.max(this.segmentSeconds, ((newest.completedAtMs - oldest.completedAtMs) / 1000) + this.segmentSeconds)
      : segments.length * this.segmentSeconds;
    return {
      running: this.running,
      segmentCount: segments.length,
      bufferedSeconds: Math.round(bufferedSeconds),
      retentionSeconds: this.retentionSeconds,
      segmentSeconds: this.segmentSeconds,
      startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : null,
      lastError: this.lastError,
      lastExit: this.lastExit
    };
  }

  async exportRecent(outputPath, options = {}) {
    const allSegments = await this.segments();
    const stableBeforeMs = Date.now() - Math.max(750, this.segmentSeconds * 750);
    const completeSegments = allSegments.filter((segment) => segment.completedAtMs <= stableBeforeMs);
    const selected = selectRecentBufferSegments(completeSegments, options);
    const minimumSegments = boundedNumber(options.minimumSegments, 2, 1, 20);
    if (selected.length < minimumSegments) {
      throw Object.assign(new Error("The rolling buffer is still warming up."), {
        code: "rolling_buffer_warming",
        availableSegments: selected.length
      });
    }
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const manifestPath = `${outputPath}.concat.txt`;
    await fs.writeFile(manifestPath, `${selected.map((segment) => `file '${concatPath(segment.filePath)}'`).join("\n")}\n`);
    const common = ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", manifestPath];
    try {
      try {
        await execFileAsync(this.ffmpegExecutable, [
          ...common,
          "-map", "0:v:0",
          "-map", "0:a:0?",
          "-c", "copy",
          "-bsf:a", "aac_adtstoasc",
          "-movflags", "+faststart",
          outputPath
        ], { timeout: 90000, maxBuffer: 1024 * 1024 * 6 });
      } catch {
        await execFileAsync(this.ffmpegExecutable, [
          ...common,
          "-map", "0:v:0",
          "-map", "0:a:0?",
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-pix_fmt", "yuv420p",
          "-c:a", "aac",
          "-movflags", "+faststart",
          outputPath
        ], { timeout: 180000, maxBuffer: 1024 * 1024 * 8 });
      }
      const stat = await fs.stat(outputPath);
      if (!stat.isFile() || stat.size <= 0) throw new Error("Rolling buffer export was empty.");
      return {
        outputPath,
        segmentCount: selected.length,
        estimatedDurationSeconds: selected.length * this.segmentSeconds,
        lookbackSeconds: boundedNumber(options.lookbackSeconds, 60, 5, 300),
        oldestSegmentAt: new Date(selected[0].completedAtMs).toISOString(),
        newestSegmentAt: new Date(selected.at(-1).completedAtMs).toISOString()
      };
    } finally {
      await fs.rm(manifestPath, { force: true }).catch(() => {});
    }
  }
}

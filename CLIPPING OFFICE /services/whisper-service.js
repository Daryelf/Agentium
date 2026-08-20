import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const HYPE_KEYWORDS = [
  "let's go",
  "lets go",
  "no way",
  "what",
  "insane",
  "bro",
  "oh my god",
  "omg",
  "clutch",
  "are you kidding",
  "holy",
  "what the",
  "impossible",
  "no no no",
  "yes yes",
  "let's go let's go",
  "i can't believe",
  "that's crazy",
  "are you serious",
  "get out",
  "unbelievable"
];

let whisperRuntimeCache = null;
let whisperRuntimeCheckedAt = 0;
let openAiTranscriptionSuppressedUntil = 0;

const DEFAULT_OPENAI_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
const DEFAULT_LOCAL_WHISPER_MODEL = "small";
const OPENAI_QUOTA_COOLDOWN_MS = 15 * 60 * 1000;

function localWhisperThreadCount() {
  const requested = Number(process.env.WHISPER_THREADS);
  if (Number.isFinite(requested)) return Math.max(1, Math.min(8, Math.floor(requested)));
  // Four threads keep the local model responsive without letting one
  // transcription monopolize every CPU core and its per-thread scratch memory.
  return Math.max(1, Math.min(4, os.cpus().length || 2));
}

function audioMimeType(filePath = "") {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".mp4") return "video/mp4";
  if (extension === ".webm") return "video/webm";
  if (extension === ".m4a") return "audio/mp4";
  if (extension === ".wav") return "audio/wav";
  if (extension === ".mp3") return "audio/mpeg";
  return "application/octet-stream";
}

function cleanTranscriptText(value = "") {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTranscriptSegments(segments = []) {
  return (Array.isArray(segments) ? segments : [])
    .map((segment, index) => {
      const start = Number(segment?.start ?? segment?.startSeconds);
      const end = Number(segment?.end ?? segment?.endSeconds);
      const text = cleanTranscriptText(segment?.text);
      if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
      return {
        id: String(segment?.id ?? `segment-${index + 1}`),
        start: Number(Math.max(0, start).toFixed(3)),
        end: Number(Math.max(start, end).toFixed(3)),
        text,
        ...(segment?.speaker ? { speaker: cleanTranscriptText(segment.speaker) } : {})
      };
    })
    .filter(Boolean);
}

function confidenceFromLogprobs(logprobs = []) {
  const values = (Array.isArray(logprobs) ? logprobs : [])
    .map((item) => Number(item?.logprob ?? item?.log_prob))
    .filter(Number.isFinite);
  if (!values.length) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Number(Math.max(0, Math.min(1, Math.exp(average))).toFixed(4));
}

function normalizeTranscriptPayload(payload = {}) {
  const segments = normalizeTranscriptSegments(payload.segments);
  const text = cleanTranscriptText(payload.text || segments.map((segment) => segment.text).join(" "));
  const words = Array.isArray(payload.words)
    ? payload.words
      .map((word) => ({
        word: cleanTranscriptText(word?.word || word?.text),
        start: Number(word?.start),
        end: Number(word?.end)
      }))
      .filter((word) => word.word && Number.isFinite(word.start) && Number.isFinite(word.end))
    : [];
  return {
    text,
    segments,
    words,
    language: cleanTranscriptText(payload.language),
    duration: Number.isFinite(Number(payload.duration)) ? Number(payload.duration) : null,
    confidence: confidenceFromLogprobs(payload.logprobs),
    available: Boolean(text)
  };
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function whisperRuntimeCandidates(opts = {}) {
  return uniqueStrings([
    opts.localExecutable,
    process.env.WHISPER_EXECUTABLE,
    "whisper",
    "whisper-cli",
    "/opt/homebrew/bin/whisper-cli",
    "/usr/local/bin/whisper-cli"
  ]);
}

async function resolveLocalWhisperRuntime(opts = {}) {
  const nowMs = Date.now();
  if (whisperRuntimeCache && nowMs - whisperRuntimeCheckedAt < 60000) return whisperRuntimeCache;
  if (!whisperRuntimeCache && whisperRuntimeCheckedAt && nowMs - whisperRuntimeCheckedAt < 30000) return null;
  whisperRuntimeCheckedAt = nowMs;
  for (const executable of whisperRuntimeCandidates(opts)) {
    try {
      await execFileAsync(executable, ["--version"], { timeout: 5000, maxBuffer: 1024 * 256 });
      whisperRuntimeCache = {
        executable,
        flavor: path.basename(executable).toLowerCase().includes("whisper-cli") ? "whisper_cpp" : "openai_whisper"
      };
      return whisperRuntimeCache;
    } catch {
      // Try the next supported local runtime.
    }
  }
  whisperRuntimeCache = null;
  return null;
}

async function existingFile(candidate = "") {
  if (!candidate) return "";
  try {
    const stat = await fs.stat(candidate);
    return stat.isFile() ? candidate : "";
  } catch {
    return "";
  }
}

function whisperCppModelNames(model = DEFAULT_LOCAL_WHISPER_MODEL, language = "") {
  const cleanModel = String(model || DEFAULT_LOCAL_WHISPER_MODEL).trim().replace(/^ggml-/, "").replace(/\.bin$/i, "");
  const english = !language || /^en(?:glish)?$/i.test(String(language));
  return uniqueStrings([
    english && !/\.en$/i.test(cleanModel) ? `${cleanModel}.en` : "",
    cleanModel
  ]);
}

async function resolveWhisperCppModel(opts = {}) {
  const explicit = await existingFile(opts.localModelPath || process.env.WHISPER_MODEL_PATH || "");
  if (explicit) return explicit;
  const resourceRoot = process.resourcesPath ? path.join(process.resourcesPath, "models", "whisper") : "";
  const roots = uniqueStrings([
    path.join(os.homedir(), "Library", "Application Support", "Argentum OS", "models", "whisper"),
    path.join(os.homedir(), ".cache", "whisper.cpp"),
    resourceRoot,
    "/opt/homebrew/share/whisper-cpp/models",
    "/usr/local/share/whisper-cpp/models"
  ]);
  for (const name of whisperCppModelNames(opts.localModel || opts.model, opts.language)) {
    for (const root of roots) {
      const candidate = await existingFile(path.join(root, `ggml-${name}.bin`));
      if (candidate) return candidate;
    }
  }
  return "";
}

function whisperCppTimestampSeconds(value = "") {
  const match = String(value || "").match(/^(\d+):(\d+):(\d+)[,.](\d+)$/);
  if (!match) return null;
  return (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]) + (Number(match[4]) / 1000);
}

export function normalizeWhisperCppPayload(payload = {}) {
  const transcription = Array.isArray(payload.transcription) ? payload.transcription : [];
  const segments = transcription.map((segment, index) => {
    const start = whisperCppTimestampSeconds(segment?.timestamps?.from)
      ?? (Number.isFinite(Number(segment?.offsets?.from)) ? Number(segment.offsets.from) / 1000 : null);
    const end = whisperCppTimestampSeconds(segment?.timestamps?.to)
      ?? (Number.isFinite(Number(segment?.offsets?.to)) ? Number(segment.offsets.to) / 1000 : null);
    return { id: index + 1, start, end, text: segment?.text };
  });
  const probabilities = transcription.flatMap((segment) => (segment?.tokens || []))
    .filter((token) => !/^\[_.*_\]$/.test(String(token?.text || "").trim()))
    .map((token) => Number(token?.p))
    .filter(Number.isFinite);
  const normalized = normalizeTranscriptPayload({
    text: transcription.map((segment) => segment?.text || "").join(" "),
    language: payload?.result?.language || "",
    duration: segments.length ? Math.max(...segments.map((segment) => Number(segment.end) || 0)) : null,
    segments
  });
  normalized.confidence = probabilities.length
    ? Number((probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length).toFixed(4))
    : null;
  return normalized;
}

function transcriptWordCount(value = "") {
  return cleanTranscriptText(value).split(/\s+/).filter(Boolean).length;
}

function transcriptSegmentWordCount(segments = []) {
  return (Array.isArray(segments) ? segments : [])
    .reduce((total, segment) => total + transcriptWordCount(segment?.text), 0);
}

function transcriptObservedEnd(segments = []) {
  const values = (Array.isArray(segments) ? segments : [])
    .map((segment) => Number(segment?.end ?? segment?.endSeconds))
    .filter(Number.isFinite);
  return values.length ? Math.max(...values) : 0;
}

export function selectBestTranscriptPass(primary = {}, timing = {}, opts = {}) {
  const primaryText = cleanTranscriptText(primary.text);
  const timingText = cleanTranscriptText(timing.text || (timing.segments || []).map((segment) => segment?.text).join(" "));
  const primaryWords = transcriptWordCount(primaryText);
  const timingWords = transcriptWordCount(timingText);
  const expectedDuration = Math.max(0, Number(opts.durationSeconds || primary.duration || timing.duration || 0));
  const timingDominates = timingWords >= primaryWords + Math.max(5, Math.ceil(primaryWords * 0.35));
  const primaryLooksPartial = expectedDuration >= 15
    && timingWords >= 10
    && primaryWords < Math.max(10, Math.floor(timingWords * 0.65));
  const useTiming = Boolean(timing.available && timingText && (timingDominates || primaryLooksPartial));
  return {
    text: useTiming ? timingText : primaryText,
    provider: useTiming ? timing.provider : primary.provider,
    model: useTiming ? timing.model : primary.model,
    confidence: useTiming ? timing.confidence : primary.confidence,
    recoveredFromPartial: useTiming,
    reason: useTiming
      ? "timing_pass_recovered_more_speech"
      : timingText
        ? "primary_pass_retained"
        : "single_pass",
    primaryWordCount: primaryWords,
    timingWordCount: timingWords,
    expectedDuration
  };
}

async function prepareAudioForTranscription(filePath, outputPath, ffmpegExecutable) {
  await execFileAsync(ffmpegExecutable, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    filePath,
    "-map",
    "0:a:0?",
    "-vn",
    "-sn",
    "-dn",
    "-af",
    "highpass=f=80,lowpass=f=12000,loudnorm=I=-16:TP=-1.5:LRA=11",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "96k",
    outputPath
  ], { timeout: 90000, maxBuffer: 1024 * 1024 * 4 });
}

function transcriptionModelFormat(model = "") {
  const normalized = String(model || "").trim().toLowerCase();
  if (normalized === "whisper-1") return { responseFormat: "verbose_json", timestamps: true, diarized: false };
  if (normalized.includes("diarize")) return { responseFormat: "diarized_json", timestamps: false, diarized: true };
  return { responseFormat: "json", timestamps: false, diarized: false };
}

async function requestOpenAITranscription(form, apiKey, opts = {}) {
  const maxAttempts = Math.max(1, Math.min(3, Number(opts.maxAttempts || 2)));
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(Number(opts.timeoutMs || 180000))
      });
      const json = await response.json().catch(() => ({}));
      if (response.ok) return json;
      const error = new Error(json?.error?.message || `OpenAI transcription failed (${response.status}).`);
      error.status = response.status;
      throw error;
    } catch (error) {
      lastError = error;
      const retryable = Number(error?.status) === 429 || Number(error?.status) >= 500;
      if (!retryable || attempt >= maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
    }
  }
  throw lastError || new Error("OpenAI transcription failed.");
}

export function buildFullClipWindows(durationSeconds, chunkSeconds = 10, overlapSeconds = 0.75) {
  const duration = Math.max(0, Number(durationSeconds || 0));
  const chunk = Math.max(5, Math.min(30, Number(chunkSeconds || 10)));
  const overlap = Math.max(0, Math.min(chunk / 3, Number(overlapSeconds || 0)));
  if (!duration) return [];
  const windows = [];
  let acceptStart = 0;
  let index = 0;
  while (acceptStart < duration) {
    let acceptEnd = Math.min(duration, acceptStart + chunk);
    if (duration - acceptEnd < 1) acceptEnd = duration;
    const captureStart = Math.max(0, acceptStart - overlap);
    const captureEnd = Math.min(duration, acceptEnd + overlap);
    windows.push({
      index,
      acceptStart: Number(acceptStart.toFixed(3)),
      acceptEnd: Number(acceptEnd.toFixed(3)),
      captureStart: Number(captureStart.toFixed(3)),
      captureEnd: Number(captureEnd.toFixed(3))
    });
    acceptStart = acceptEnd;
    index += 1;
  }
  return windows;
}

function offsetTranscriptSegment(segment, offsetSeconds, index) {
  return {
    ...segment,
    id: `window-${index + 1}-${segment.id}`,
    start: Number((Number(segment.start) + offsetSeconds).toFixed(3)),
    end: Number((Number(segment.end) + offsetSeconds).toFixed(3))
  };
}

function offsetTranscriptWord(word, offsetSeconds) {
  return {
    ...word,
    start: Number((Number(word.start) + offsetSeconds).toFixed(3)),
    end: Number((Number(word.end) + offsetSeconds).toFixed(3))
  };
}

export function mergeFullClipWindowResults(windows = [], results = []) {
  const segments = [];
  const words = [];
  const diagnostics = [];
  for (let index = 0; index < windows.length; index += 1) {
    const window = windows[index];
    const result = results[index] || {};
    const offsetSegments = normalizeTranscriptSegments(result.segments)
      .map((segment) => offsetTranscriptSegment(segment, window.captureStart, index));
    const acceptedSegments = offsetSegments.filter((segment) => {
      const midpoint = (segment.start + segment.end) / 2;
      return midpoint >= window.acceptStart
        && (index === windows.length - 1 ? midpoint <= window.acceptEnd : midpoint < window.acceptEnd);
    });
    const offsetWords = (Array.isArray(result.words) ? result.words : [])
      .map((word) => offsetTranscriptWord(word, window.captureStart))
      .filter((word) => {
        const midpoint = (word.start + word.end) / 2;
        return midpoint >= window.acceptStart
          && (index === windows.length - 1 ? midpoint <= window.acceptEnd : midpoint < window.acceptEnd);
      });
    segments.push(...acceptedSegments);
    words.push(...offsetWords);
    diagnostics.push({
      index: index + 1,
      start: window.acceptStart,
      end: window.acceptEnd,
      processed: result.processed === true,
      speechDetected: Boolean(result.text),
      acceptedSegments: acceptedSegments.length,
      wordCount: transcriptWordCount(acceptedSegments.map((segment) => segment.text).join(" "))
    });
  }
  segments.sort((a, b) => a.start - b.start);
  words.sort((a, b) => a.start - b.start);
  return {
    text: cleanTranscriptText(segments.map((segment) => segment.text).join(" ")),
    segments,
    words,
    diagnostics
  };
}

async function transcribeFullClipWithOpenAI(filePath, opts = {}) {
  const apiKey = String(opts.openaiApiKey || "").trim();
  if (!apiKey) return { available: false, error: "OpenAI transcription is not configured." };
  const duration = Math.max(0, Number(opts.durationSeconds || 0));
  if (!duration) return { available: false, error: "The clip duration is required for full-window transcription." };
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "argentum-full-clip-transcribe-"));
  const audioPath = path.join(tempRoot, "full-clip-audio.mp3");
  const ffmpegExecutable = opts.ffmpegExecutable || "ffmpeg";
  const model = "whisper-1";
  const windows = buildFullClipWindows(duration, opts.chunkSeconds || 10, opts.overlapSeconds ?? 0.75);
  const results = [];
  try {
    await prepareAudioForTranscription(filePath, audioPath, ffmpegExecutable);
    for (const window of windows) {
      const chunkPath = path.join(tempRoot, `window-${String(window.index + 1).padStart(2, "0")}.mp3`);
      await execFileAsync(ffmpegExecutable, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        String(window.captureStart),
        "-t",
        String(Math.max(0.1, window.captureEnd - window.captureStart)),
        "-i",
        audioPath,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "96k",
        chunkPath
      ], { timeout: 60000, maxBuffer: 1024 * 1024 * 4 });
      const bytes = await fs.readFile(chunkPath);
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: "audio/mpeg" }), path.basename(chunkPath));
      form.append("model", model);
      form.append("response_format", "verbose_json");
      form.append("temperature", "0");
      form.append("timestamp_granularities[]", "segment");
      form.append("timestamp_granularities[]", "word");
      if (opts.language) form.append("language", String(opts.language));
      const json = await requestOpenAITranscription(form, apiKey, opts);
      results.push({ ...normalizeTranscriptPayload(json), processed: true });
    }
    const merged = mergeFullClipWindowResults(windows, results);
    const processedWindowCount = results.filter((result) => result.processed).length;
    const processedDuration = windows
      .filter((_, index) => results[index]?.processed)
      .reduce((total, window) => total + Math.max(0, window.acceptEnd - window.acceptStart), 0);
    const processedCoverageRatio = duration > 0 ? Math.min(1, processedDuration / duration) : 0;
    const language = results.map((result) => result.language).find(Boolean) || "";
    if (!merged.text) {
      return {
        available: false,
        error: "All audio windows were processed, but no spoken words were detected.",
        provider: `openai:${model}`,
        model,
        quality: "full_clip_basic",
        fullClipProcessed: processedWindowCount === windows.length,
        audioDuration: duration,
        processedDuration,
        processedCoverageRatio,
        processedWindowCount,
        expectedWindowCount: windows.length,
        windowDiagnostics: merged.diagnostics
      };
    }
    return {
      ...merged,
      available: true,
      provider: `openai:${model}`,
      model,
      quality: "full_clip_basic",
      language,
      duration,
      confidence: null,
      fullClipProcessed: processedWindowCount === windows.length && processedCoverageRatio >= 0.99,
      audioDuration: duration,
      processedDuration: Number(processedDuration.toFixed(3)),
      processedCoverageRatio: Number(processedCoverageRatio.toFixed(4)),
      processedWindowCount,
      expectedWindowCount: windows.length,
      windowDiagnostics: merged.diagnostics,
      rawSegmentCount: merged.segments.length,
      transcriptSelectionReason: "full_clip_chunked_whisper_1"
    };
  } catch (error) {
    return {
      available: false,
      error: `Full-clip transcription stopped before every audio window was processed. ${error.message}`,
      provider: `openai:${model}`,
      model,
      quality: "full_clip_incomplete",
      fullClipProcessed: false,
      audioDuration: duration,
      processedWindowCount: results.length,
      expectedWindowCount: windows.length
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function transcribeWithOpenAI(filePath, opts = {}) {
  const apiKey = String(opts.openaiApiKey || "").trim();
  if (!apiKey) return { available: false, error: "OpenAI transcription is not configured." };
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "argentum-openai-transcribe-"));
  const audioPath = path.join(tempRoot, "clip-audio.mp3");
  try {
    await prepareAudioForTranscription(filePath, audioPath, opts.ffmpegExecutable || "ffmpeg");
    const bytes = await fs.readFile(audioPath);
    const model = String(opts.openaiModel || DEFAULT_OPENAI_TRANSCRIPTION_MODEL).trim();
    const format = transcriptionModelFormat(model);
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: audioMimeType(audioPath) }), path.basename(audioPath));
    form.append("model", model);
    form.append("response_format", format.responseFormat);
    form.append("temperature", "0");
    if (opts.language) form.append("language", String(opts.language));
    if (opts.prompt && !format.diarized) form.append("prompt", String(opts.prompt).slice(0, 2000));
    if (format.timestamps) {
      form.append("timestamp_granularities[]", "segment");
      form.append("timestamp_granularities[]", "word");
    }
    if (!format.diarized && model !== "whisper-1") form.append("include[]", "logprobs");

    const json = await requestOpenAITranscription(form, apiKey, opts);
    const normalized = normalizeTranscriptPayload(json);
    if (!normalized.available) return { available: false, error: "OpenAI transcription returned no speech text." };

    const result = {
      ...normalized,
      provider: `openai:${model}`,
      model,
      quality: "high_accuracy",
      rawSegmentCount: normalized.segments.length
    };
    const timestampModel = String(opts.timestampModel || "").trim();
    if (!opts.skipTimingPass && timestampModel && timestampModel !== model && !format.timestamps && !format.diarized) {
      const timing = await transcribeWithOpenAI(filePath, {
        ...opts,
        openaiModel: timestampModel,
        timestampModel: "",
        skipTimingPass: true
      });
      if (timing.available && timing.segments.length) {
        const selection = selectBestTranscriptPass(result, timing, {
          durationSeconds: opts.durationSeconds
        });
        result.text = selection.text;
        result.segments = timing.segments;
        result.words = timing.words;
        result.timingProvider = timing.provider;
        result.timingModel = timing.model;
        result.contentProvider = selection.provider;
        result.contentModel = selection.model;
        result.confidence = Number.isFinite(Number(selection.confidence)) ? Number(selection.confidence) : null;
        result.recoveredFromPartial = selection.recoveredFromPartial;
        result.transcriptSelectionReason = selection.reason;
        result.primaryWordCount = selection.primaryWordCount;
        result.timingWordCount = selection.timingWordCount;
        result.duration = Number(result.duration || timing.duration || opts.durationSeconds || transcriptObservedEnd(timing.segments) || 0);
        if (selection.recoveredFromPartial) result.quality = "dual_pass_recovered";
      }
    }
    return result;
  } catch (error) {
    return { available: false, error: error.message };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countWords(text = "") {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

function collectWordsFromSegments(segments = []) {
  return segments.flatMap((segment) => {
    if (Array.isArray(segment.words)) return segment.words;
    return [];
  });
}

function peakWordsPerSecond(segments = []) {
  const windows = [];
  for (const segment of segments) {
    const start = Number(segment.start);
    const end = Number(segment.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    windows.push({ start, end, words: countWords(segment.text) });
  }
  let peak = 0;
  for (const window of windows) {
    const windowStart = window.start;
    const windowEnd = windowStart + 5;
    const wordsInWindow = windows
      .filter((item) => item.end >= windowStart && item.start <= windowEnd)
      .reduce((total, item) => total + item.words, 0);
    peak = Math.max(peak, wordsInWindow / 5);
  }
  return Math.round(peak * 100) / 100;
}

function detectSilenceBeforeBurst(segments = []) {
  for (let index = 0; index < segments.length - 1; index += 1) {
    const currentEnd = Number(segments[index]?.end);
    const nextStart = Number(segments[index + 1]?.start);
    const nextEnd = Number(segments[index + 1]?.end);
    if (!Number.isFinite(currentEnd) || !Number.isFinite(nextStart) || !Number.isFinite(nextEnd)) continue;
    const gap = nextStart - currentEnd;
    const nextDuration = Math.max(0.1, nextEnd - nextStart);
    const nextWordsPerSecond = countWords(segments[index + 1]?.text) / nextDuration;
    if (gap > 2 && nextWordsPerSecond > 3) return true;
  }
  return false;
}

export async function isWhisperAvailable(opts = {}) {
  return Boolean(await resolveLocalWhisperRuntime(opts));
}

export { normalizeTranscriptPayload };

async function transcribeWithLocalWhisper(filePath, opts = {}) {
  const ffmpegExecutable = opts.ffmpegExecutable || "ffmpeg";
  const whisperModel = opts.localModel || opts.model || process.env.WHISPER_MODEL || DEFAULT_LOCAL_WHISPER_MODEL;
  const runtime = opts.localRuntime || await resolveLocalWhisperRuntime(opts);
  if (!runtime) return { available: false, error: "No supported local Whisper runtime was found." };
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "argentum-whisper-"));
  const wavPath = path.join(tempRoot, "input.wav");
  const outputDir = path.join(tempRoot, "out");
  try {
    await fs.mkdir(outputDir, { recursive: true });
    await execFileAsync(ffmpegExecutable, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      filePath,
      "-map",
      "0:a:0?",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "wav",
      wavPath
    ], { timeout: 90000, maxBuffer: 1024 * 1024 * 4 });

    let normalized;
    let resolvedModel = whisperModel;
    if (runtime.flavor === "whisper_cpp") {
      const modelPath = await resolveWhisperCppModel({ ...opts, localModel: whisperModel });
      if (!modelPath) {
        throw new Error(`whisper.cpp is installed, but the ${whisperModel} GGML model is missing. Set WHISPER_MODEL_PATH or install it in Argentum OS/models/whisper.`);
      }
      const outputBase = path.join(outputDir, "transcript");
      const whisperArgs = [
        "-m", modelPath,
        "-f", wavPath,
        "-ojf",
        "-of", outputBase,
        "-t", String(localWhisperThreadCount()),
        "-np"
      ];
      if (opts.language) whisperArgs.push("-l", String(opts.language));
      if (opts.prompt) whisperArgs.push("--prompt", String(opts.prompt).slice(0, 1200));
      await execFileAsync(runtime.executable, whisperArgs, {
        timeout: Number(opts.timeoutMs || 240000),
        maxBuffer: 1024 * 1024 * 12
      });
      const parsed = JSON.parse(await fs.readFile(`${outputBase}.json`, "utf8"));
      normalized = normalizeWhisperCppPayload(parsed);
      resolvedModel = path.basename(modelPath).replace(/^ggml-/, "").replace(/\.bin$/i, "");
    } else {
      const whisperArgs = [
        wavPath,
        "--model",
        whisperModel,
        "--task",
        "transcribe",
        "--temperature",
        "0",
        "--output_format",
        "json",
        "--output_dir",
        outputDir
      ];
      if (opts.language) whisperArgs.push("--language", String(opts.language));
      await execFileAsync(runtime.executable, whisperArgs, {
        timeout: Number(opts.timeoutMs || 240000),
        maxBuffer: 1024 * 1024 * 12
      });
      const files = await fs.readdir(outputDir);
      const jsonFile = files.find((file) => file.endsWith(".json"));
      if (!jsonFile) throw new Error("Whisper did not produce a JSON transcript.");
      const parsed = JSON.parse(await fs.readFile(path.join(outputDir, jsonFile), "utf8"));
      normalized = normalizeTranscriptPayload(parsed);
    }
    const duration = Math.max(0, Number(opts.durationSeconds || normalized.duration || transcriptObservedEnd(normalized.segments) || 0));
    return normalized.available
      ? {
        ...normalized,
        available: true,
        provider: runtime.flavor === "whisper_cpp" ? "local_whisper_cpp" : "local_whisper",
        model: resolvedModel,
        quality: "local_full_clip",
        fullClipProcessed: true,
        audioDuration: duration,
        processedDuration: duration,
        processedCoverageRatio: 1,
        processedWindowCount: 1,
        expectedWindowCount: 1
      }
      : { available: false, error: "Local Whisper returned no speech text." };
  } catch (error) {
    return { available: false, error: error.message };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export async function transcribeBuffer(filePath, opts = {}) {
  const openaiConfigured = Boolean(String(opts.openaiApiKey || "").trim());
  const provider = String(opts.provider || (openaiConfigured ? "openai" : "local")).toLowerCase();
  const errors = [];
  const localRuntime = await resolveLocalWhisperRuntime(opts);
  const cloudSuppressed = openAiTranscriptionSuppressedUntil > Date.now();

  if (openaiConfigured && provider !== "local" && !cloudSuppressed) {
    const result = opts.fullClipMode === false
      ? await transcribeWithOpenAI(filePath, opts)
      : await transcribeFullClipWithOpenAI(filePath, opts);
    if (result.available) return result;
    errors.push(`OpenAI: ${result.error}`);
    if (/quota|billing|credit balance|exceeded your current quota/i.test(String(result.error || ""))) {
      openAiTranscriptionSuppressedUntil = Date.now() + OPENAI_QUOTA_COOLDOWN_MS;
    }
  } else if (openaiConfigured && provider !== "local" && cloudSuppressed) {
    errors.push("OpenAI: temporarily bypassed after a verified quota failure.");
  }

  if (localRuntime) {
    const result = await transcribeWithLocalWhisper(filePath, { ...opts, localRuntime });
    if (result.available) return result;
    errors.push(`Local Whisper: ${result.error}`);
  } else {
    errors.push("Local Whisper: CLI is not installed or not on PATH.");
  }

  if (openaiConfigured && provider === "local" && !cloudSuppressed) {
    const result = opts.fullClipMode === false
      ? await transcribeWithOpenAI(filePath, opts)
      : await transcribeFullClipWithOpenAI(filePath, opts);
    if (result.available) return result;
    errors.push(`OpenAI: ${result.error}`);
  }

  return { available: false, error: errors.join(" ") || "No transcription provider is available." };
}

export function scoreTranscript(transcriptResult = {}, opts = {}) {
  const rawText = cleanTranscriptText(transcriptResult.text);
  const text = rawText.toLowerCase();
  const segments = Array.isArray(transcriptResult.segments) ? transcriptResult.segments : [];
  const detectedKeywords = [];
  let hypeHits = 0;
  for (const keyword of HYPE_KEYWORDS) {
    const matches = text.match(new RegExp(escapeRegExp(keyword.toLowerCase()), "g")) || [];
    if (matches.length) detectedKeywords.push(keyword);
    hypeHits += matches.length;
  }

  const firstStart = segments.length ? Math.min(...segments.map((segment) => Number(segment.start)).filter(Number.isFinite)) : 0;
  const lastEnd = segments.length ? Math.max(...segments.map((segment) => Number(segment.end)).filter(Number.isFinite)) : 0;
  const totalSeconds = Math.max(1, lastEnd - firstStart);
  const speechRate = Math.round((countWords(text) / totalSeconds) * 100) / 100;
  const peakSpeechRate = peakWordsPerSecond(segments);
  const silenceBeforeBurst = detectSilenceBeforeBurst(segments);
  const transcriptScore = Math.min(
    30,
    Math.min(20, hypeHits * 5)
      + (silenceBeforeBurst ? 5 : 0)
      + (peakSpeechRate > 3.5 ? 5 : 0)
  );
  const wordCount = countWords(rawText);
  const segmentCount = segments.length;
  const segmentWordCount = transcriptSegmentWordCount(segments);
  const expectedDuration = Math.max(0, Number(opts.durationSeconds || transcriptResult.duration || transcriptObservedEnd(segments) || 0));
  const requiresFullClipCoverage = expectedDuration >= 10;
  const processedCoverageRatio = Number(transcriptResult.processedCoverageRatio || 0);
  const fullClipProcessed = transcriptResult.fullClipProcessed === true
    && (!requiresFullClipCoverage || processedCoverageRatio >= 0.99);
  const completenessRatio = segmentWordCount
    ? Math.min(wordCount, segmentWordCount) / Math.max(wordCount, segmentWordCount)
    : wordCount
      ? 1
      : 0;
  const rawConfidence = transcriptResult.confidence;
  const confidence = rawConfidence === null || rawConfidence === undefined || rawConfidence === ""
    ? Number.NaN
    : Number(rawConfidence);
  const confidenceScore = Number.isFinite(confidence)
    ? confidence * 100
    : transcriptResult.recoveredFromPartial
      ? 82
      : transcriptResult.provider?.startsWith("openai:gpt-4o-transcribe")
        ? 88
        : 68;
  const coverageScore = wordCount > 0 ? Math.min(100, 45 + Math.min(35, wordCount * 1.5) + (segmentCount ? 20 : 0)) : 0;
  const completenessScore = completenessRatio * 100;
  const qualityScore = Math.round(Math.max(0, Math.min(100, confidenceScore * 0.5 + coverageScore * 0.25 + completenessScore * 0.25)));
  const mismatchedPasses = segmentWordCount >= 10 && completenessRatio < 0.6;
  const usableForCaption = wordCount >= 3 && !mismatchedPasses && (!requiresFullClipCoverage || fullClipProcessed);
  const qualityIssue = mismatchedPasses
    ? "transcript_text_did_not_cover_timed_speech"
    : requiresFullClipCoverage && !fullClipProcessed
      ? "full_clip_audio_not_processed"
      : wordCount < 3
        ? "no_usable_speech_detected"
        : "";

  return {
    transcriptScore,
    hypeHits,
    silenceBeforeBurst,
    speechRate,
    peakSpeechRate,
    detectedKeywords,
    wordCount,
    segmentWordCount,
    segmentCount,
    expectedDuration,
    fullClipProcessed,
    processedCoverageRatio: Number(processedCoverageRatio.toFixed(4)),
    observedSpeechEnd: transcriptObservedEnd(segments),
    completenessRatio: Number(completenessRatio.toFixed(4)),
    usableForCaption,
    qualityIssue,
    confidence: Number.isFinite(confidence) ? confidence : null,
    qualityScore
  };
}

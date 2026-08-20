import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function numberFromVolumedetect(stderr, label) {
  const match = String(stderr || "").match(new RegExp(`${label}:\\s*(-?\\d+(?:\\.\\d+)?)\\s*dB`, "i"));
  return match ? Number(match[1]) : null;
}

async function runVolumedetect(filePath, ffmpegExecutable, audioFilter = "volumedetect") {
  const { stderr } = await execFileAsync(ffmpegExecutable, [
      "-hide_banner",
      "-i",
      filePath,
      "-af",
      audioFilter,
      "-vn",
      "-sn",
      "-dn",
      "-f",
      "null",
      "-"
  ], { timeout: 45000, maxBuffer: 1024 * 1024 * 3 });
  return {
    meanVolumeDb: numberFromVolumedetect(stderr, "mean_volume"),
    maxVolumeDb: numberFromVolumedetect(stderr, "max_volume")
  };
}

async function runSilenceDetect(filePath, ffmpegExecutable) {
  try {
    const { stderr } = await execFileAsync(ffmpegExecutable, [
      "-hide_banner", "-i", filePath,
      "-af", "silencedetect=n=-35dB:d=0.35",
      "-vn", "-sn", "-dn", "-f", "null", "-"
    ], { timeout: 45000, maxBuffer: 1024 * 1024 * 3 });
    return { stderr: String(stderr || "") };
  } catch (error) {
    return { stderr: String(error?.stderr || "") };
  }
}

function silenceDynamics(stderr = "") {
  const text = String(stderr || "");
  const durationMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  const durationSeconds = durationMatch
    ? (Number(durationMatch[1]) * 3600) + (Number(durationMatch[2]) * 60) + Number(durationMatch[3])
    : null;
  const endings = Array.from(text.matchAll(/silence_end:\s*(\d+(?:\.\d+)?).*?silence_duration:\s*(\d+(?:\.\d+)?)/gi)).map((match) => ({
    endSeconds: Number(match[1]),
    durationSeconds: Number(match[2])
  }));
  const longestSilenceSeconds = endings.reduce((max, item) => Math.max(max, item.durationSeconds), 0);
  return { durationSeconds, silenceEndings: endings, longestSilenceSeconds };
}

export async function analyzeAudioEnergy(filePath, ffmpegExecutable = "ffmpeg") {
  try {
    const [fullMixResult, voiceResult, silenceResult] = await Promise.allSettled([
      runVolumedetect(filePath, ffmpegExecutable, "volumedetect"),
      runVolumedetect(filePath, ffmpegExecutable, "bandpass=f=1000:width_type=h:w=2700,volumedetect"),
      runSilenceDetect(filePath, ffmpegExecutable)
    ]);
    if (fullMixResult.status === "rejected") throw fullMixResult.reason;

    const { meanVolumeDb, maxVolumeDb } = fullMixResult.value;
    const voice = voiceResult.status === "fulfilled" ? voiceResult.value : {};
    const voiceMeanDb = Number.isFinite(voice.meanVolumeDb) ? voice.meanVolumeDb : null;
    const voicePeakDb = Number.isFinite(voice.maxVolumeDb) ? voice.maxVolumeDb : null;
    const isLoudMoment = Number.isFinite(maxVolumeDb) && maxVolumeDb >= -8;
    const isVoiceExcited = Number.isFinite(voicePeakDb) && voicePeakDb >= -12;
    const voiceOverGameRatio = Number.isFinite(voicePeakDb) && Number.isFinite(maxVolumeDb)
      ? Math.round((voicePeakDb - maxVolumeDb) * 100) / 100
      : null;
    const dynamics = silenceResult.status === "fulfilled" ? silenceDynamics(silenceResult.value.stderr) : silenceDynamics("");
    const dynamicRangeDb = Number.isFinite(maxVolumeDb) && Number.isFinite(meanVolumeDb)
      ? Math.round((maxVolumeDb - meanVolumeDb) * 100) / 100
      : null;
    const silenceBeforeBurst = Boolean(
      (isLoudMoment || isVoiceExcited)
      && dynamics.silenceEndings.some((item) => item.durationSeconds >= 0.6 && (
        !dynamics.durationSeconds || item.endSeconds >= Math.max(1, dynamics.durationSeconds * 0.15)
      ))
    );
    return {
      available: Number.isFinite(meanVolumeDb) || Number.isFinite(maxVolumeDb),
      meanVolumeDb,
      maxVolumeDb,
      isLoudMoment,
      voiceMeanDb,
      voicePeakDb,
      isVoiceExcited,
      voiceOverGameRatio,
      dynamicRangeDb,
      silenceBeforeBurst,
      longestSilenceSeconds: Math.round(dynamics.longestSilenceSeconds * 100) / 100,
      silenceEndings: dynamics.silenceEndings.slice(-12),
      source: "ffmpeg_audio_dynamics_v3"
    };
  } catch (error) {
    return {
      available: false,
      meanVolumeDb: null,
      maxVolumeDb: null,
      isLoudMoment: false,
      voiceMeanDb: null,
      voicePeakDb: null,
      isVoiceExcited: false,
      voiceOverGameRatio: null,
      dynamicRangeDb: null,
      silenceBeforeBurst: false,
      longestSilenceSeconds: 0,
      silenceEndings: [],
      source: "ffmpeg_audio_dynamics_v3",
      error: error.message
    };
  }
}

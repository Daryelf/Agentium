/**
 * CapCut golden-run regression (WI-7) — proves replay determinism and catches
 * CapCut UI updates before a real production run.
 *
 * Stages a fixed reference clip, replays the taught macro end-to-end three
 * consecutive times against the LIVE CapCut app, and passes only when every
 * run clears every phase gate with zero warnings and zero Human Gate
 * escalations. Prints a per-run, per-phase table; exits non-zero on failure.
 *
 * This needs a human nearby: CapCut visible, server running, hands off the
 * mouse. The emergency stop (cmd+option+escape) works the whole time.
 *
 * Usage:
 *   node scripts/capcut-golden-run.mjs                 # 3 runs (full check)
 *   node scripts/capcut-golden-run.mjs --once          # 1 run (nightly)
 *   node scripts/capcut-golden-run.mjs --macro <id>    # explicit macro
 *   node scripts/capcut-golden-run.mjs --base http://127.0.0.1:4177
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { goldenPathFor } from "../services/capcut-determinism.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIPS_DIR = process.env.CLIPPER_WATCH_BUFFER_DIR
  ? path.resolve(process.env.CLIPPER_WATCH_BUFFER_DIR)
  : path.join(__dirname, "..", "Clips");

const args = process.argv.slice(2);
function argValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : "";
}
const base = argValue("--base") || `http://127.0.0.1:${process.env.PORT || 4177}`;
const requestedMacro = argValue("--macro");
const runCount = args.includes("--once") ? 1 : 3;

async function api(route, options = {}) {
  const response = await fetch(`${base}${route}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${route} failed: ${response.status} ${json.error || response.statusText}`);
  }
  return json;
}

async function ensureGoldenClip() {
  const goldenPath = goldenPathFor(CLIPS_DIR);
  try {
    const stats = await fs.stat(goldenPath);
    if (stats.size > 0) return goldenPath;
  } catch {
    // First run: pick the most recent clip and freeze it as the reference.
  }
  const entries = await fs.readdir(CLIPS_DIR, { withFileTypes: true }).catch(() => []);
  const clips = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.mp4$/i.test(entry.name)) continue;
    const filePath = path.join(CLIPS_DIR, entry.name);
    const stats = await fs.stat(filePath);
    if (stats.size > 0) clips.push({ filePath, mtimeMs: stats.mtimeMs });
  }
  if (!clips.length) {
    throw new Error(`No .mp4 clips in ${CLIPS_DIR} to seed the golden reference. Add one clip first.`);
  }
  clips.sort((a, b) => b.mtimeMs - a.mtimeMs);
  await fs.mkdir(path.dirname(goldenPath), { recursive: true });
  await fs.copyFile(clips[0].filePath, goldenPath);
  console.log(`Golden reference seeded from ${path.basename(clips[0].filePath)} → ${goldenPath}`);
  console.log("This file is now frozen. Never replace it casually — identical input is the point.");
  return goldenPath;
}

async function pickMacro() {
  if (requestedMacro) return requestedMacro;
  const { macros } = await api("/api/capcut-control/macros");
  if (!macros?.length) throw new Error("No CapCut macros saved. Teach the workflow first.");
  const workflowMacro = macros.find((macro) => macro.workflowId);
  return (workflowMacro || macros[0]).id;
}

function evaluateRun(replay) {
  const gates = replay?.gates || [];
  const warnings = replay?.warnings || [];
  const problems = [];
  if (replay?.status !== "complete") problems.push(`status=${replay?.status || "missing"} (${replay?.stopReason || "no reason"})`);
  if (replay?.humanGate) problems.push(`human gate raised at phase ${replay.humanGate.phaseId}`);
  for (const gate of gates) {
    if (!String(gate.status).startsWith("passed")) problems.push(`gate ${gate.phaseId}: ${gate.status}`);
  }
  for (const warning of warnings) {
    if (warning.kind === "drag_unparameterized") problems.push(`drag_unparameterized at step ${warning.stepIndex}`);
  }
  return { pass: problems.length === 0, problems, gates, warnings };
}

const goldenPath = await ensureGoldenClip();
const macroId = await pickMacro();

console.log("");
console.log("=== CapCut GOLDEN RUN ===");
console.log(`Server:  ${base}`);
console.log(`Macro:   ${macroId}`);
console.log(`Clip:    ${goldenPath}`);
console.log(`Runs:    ${runCount}`);
console.log("");
console.log("KEEP CAPCUT VISIBLE AND HANDS OFF THE MOUSE.");
console.log("Emergency stop: cmd+option+escape. Export stays behind Human Gate.");
console.log("");

const results = [];
for (let run = 1; run <= runCount; run += 1) {
  console.log(`--- Run ${run}/${runCount} starting ---`);
  const startedAt = Date.now();
  let replay = null;
  let error = "";
  try {
    const payload = await api(`/api/capcut-control/macros/${encodeURIComponent(macroId)}/replay`, {
      method: "POST",
      body: JSON.stringify({ inputs: { sourceVideoPath: goldenPath } })
    });
    replay = payload.replay;
  } catch (runError) {
    error = runError.message;
  }
  const verdict = replay ? evaluateRun(replay) : { pass: false, problems: [error || "no replay state"], gates: [], warnings: [] };
  results.push({ run, verdict, replay, seconds: Math.round((Date.now() - startedAt) / 1000) });
  console.log(`Run ${run}: ${verdict.pass ? "PASS" : "FAIL"} (${results[results.length - 1].seconds}s)`);
  for (const gate of verdict.gates) console.log(`  gate ${gate.phaseId.padEnd(16)} ${gate.status}`);
  for (const problem of verdict.problems) console.log(`  problem: ${problem}`);
  if (replay?.runReportPath) console.log(`  report: ${replay.runReportPath}`);
  console.log("");
}

const gateSignature = (verdict) => verdict.gates.map((gate) => `${gate.phaseId}:${gate.status}`).join("|");
const allPass = results.every((result) => result.verdict.pass);
const identical = new Set(results.map((result) => gateSignature(result.verdict))).size <= 1;

console.log("=== GOLDEN RUN SUMMARY ===");
for (const result of results) {
  console.log(`Run ${result.run}: ${result.verdict.pass ? "PASS" : "FAIL"} — gates [${gateSignature(result.verdict) || "none"}]`);
}
if (allPass && identical) {
  console.log(`\nGOLDEN RUN PASSED: ${runCount}/${runCount} runs, identical phase-gate results.`);
  process.exit(0);
}
if (allPass && !identical) {
  console.log("\nGOLDEN RUN FAILED: all runs passed but phase-gate results were NOT identical — that is drift.");
  process.exit(1);
}
console.log(`\nGOLDEN RUN FAILED: ${results.filter((result) => !result.verdict.pass).length}/${runCount} runs failed.`);
process.exit(1);

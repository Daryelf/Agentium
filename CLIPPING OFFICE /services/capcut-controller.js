import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { CapCutMacroStorage } from "./capcut-macro-storage.js";
import { matchAnchor } from "./capcut-anchor-matcher.js";
import {
  DEFAULT_TEACH_WINDOW_FRAME,
  PHASE_GATES,
  clampReplayWait,
  pollCondition,
  stagingPathFor,
  validateStagedClip,
  compileMacroForDeterminism,
  readPng,
  measurePreviewCanvas,
  aspectMatches916,
  measureLetterboxBands,
  measureBottomStickerSignal,
  findTimelineClipEndX
} from "./capcut-determinism.js";

const execFileAsync = promisify(execFile);

const KEY_CODES = {
  return: 36,
  enter: 36,
  tab: 48,
  space: 49,
  delete: 51,
  backspace: 51,
  escape: 53,
  esc: 53,
  command: 55,
  shift: 56,
  capslock: 57,
  option: 58,
  alt: 58,
  control: 59,
  ctrl: 59,
  right: 124,
  left: 123,
  down: 125,
  up: 126,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111
};

const MODIFIERS = {
  cmd: "command",
  command: "command",
  meta: "command",
  control: "control",
  ctrl: "control",
  option: "option",
  alt: "option",
  shift: "shift"
};

const KEY_CODE_NAMES = {
  0: "a",
  1: "s",
  2: "d",
  3: "f",
  4: "h",
  5: "g",
  6: "z",
  7: "x",
  8: "c",
  9: "v",
  11: "b",
  12: "q",
  13: "w",
  14: "e",
  15: "r",
  16: "y",
  17: "t",
  18: "1",
  19: "2",
  20: "3",
  21: "4",
  22: "6",
  23: "5",
  24: "=",
  25: "9",
  26: "7",
  27: "-",
  28: "8",
  29: "0",
  30: "]",
  31: "o",
  32: "u",
  33: "[",
  34: "i",
  35: "p",
  36: "return",
  37: "l",
  38: "j",
  39: "'",
  40: "k",
  41: ";",
  42: "\\",
  43: ",",
  44: "/",
  45: "n",
  46: "m",
  47: ".",
  48: "tab",
  49: "space",
  50: "`",
  51: "delete",
  53: "escape",
  123: "left",
  124: "right",
  125: "down",
  126: "up"
};

const TEACH_EMERGENCY_HOTKEY = ["command", "option", "escape"];
const VERTICAL_SHORT_WORKFLOW_ID = "vertical_916_auto_frame_blur_background_bottom_sticker";
const CAPCUT_TEACH_PHASES = [
  {
    id: "choose_clip",
    label: "Choose Clip",
    mode: "record",
    required: true,
    goal: "Choose the clip inside CapCut the same way you want the agent to do it later.",
    operatorPrompt: "Press Record Phase, click the clip or most-recent media in CapCut, then press Finish Phase."
  },
  {
    id: "canvas_916",
    label: "9:16 Canvas",
    mode: "record",
    required: true,
    goal: "Set the project or canvas ratio to vertical 9:16.",
    operatorPrompt: "Press Record Phase, set CapCut to 9:16, then press Finish Phase."
  },
  {
    id: "blur_background",
    label: "Blur Background",
    mode: "record",
    required: true,
    goal: "Create a full-frame blurred background while keeping the foreground clear.",
    operatorPrompt: "Record the duplicate/fill/blur moves, then finish this phase."
  },
  {
    id: "auto_frame",
    label: "Auto Frame",
    mode: "record",
    required: true,
    goal: "Make the subject fit the vertical short frame after the background is prepared.",
    operatorPrompt: "Record the auto frame or manual framing moves, then finish this phase."
  },
  {
    id: "bottom_sticker",
    label: "Bottom Sticker",
    mode: "record",
    required: false,
    goal: "Place an optional sticker near the bottom center without covering the subject.",
    operatorPrompt: "Record sticker placement if this workflow needs one, otherwise skip it."
  },
  {
    id: "save_project",
    label: "Save Project",
    mode: "record",
    required: true,
    goal: "Save the CapCut project without exporting or posting.",
    operatorPrompt: "Record the save action only. Do not export or upload."
  }
];

const CAPCUT_WORKFLOWS = {
  [VERTICAL_SHORT_WORKFLOW_ID]: {
    id: VERTICAL_SHORT_WORKFLOW_ID,
    name: VERTICAL_SHORT_WORKFLOW_ID,
    app: "CapCut",
    version: 1,
    description: "Turn a normal clip into a 9:16 vertical short with auto frame, blurred background, and an optional bottom-center sticker.",
    inputs: ["projectName", "outputProjectFolder"],
    optionalInputs: ["stickerPath"],
    placeholders: {
      sourceVideoPath: "{{sourceVideoPath}}",
      stickerPath: "{{stickerPath}}",
      projectName: "{{projectName}}",
      outputProjectFolder: "{{outputProjectFolder}}"
    },
    actionLogs: [
      "Opening CapCut",
      "Choosing clip",
      "Setting 9:16 canvas",
      "Creating blurred background",
      "Applying auto frame",
      "Adding optional bottom sticker",
      "Saving project"
    ],
    checkpoints: [
      { id: "before_start", label: "before workflow starts" },
      { id: "after_clip_selected", label: "after clip selected" },
      { id: "after_916_canvas", label: "after 9:16 canvas" },
      { id: "after_blur_background", label: "after blur background" },
      { id: "after_auto_frame", label: "after auto frame" },
      { id: "after_sticker_added", label: "after sticker added" },
      { id: "after_save", label: "after save" }
    ],
    trainingInstructions: [
      "Open or create a CapCut project.",
      "Choose the clip in CapCut manually, such as the most recent imported clip or media item.",
      "Set the canvas/aspect ratio to 9:16 vertical.",
      "Create a blurred full-frame background layer while keeping the foreground clear and centered.",
      "Fit the clip for a vertical short and use Auto Frame/Auto Reframe if available.",
      "Optional: add a sticker image near the bottom center, inside the safe area and away from captions/main subject.",
      "Save the project as {{projectName}} under {{outputProjectFolder}}.",
      "Do not export."
    ]
  }
};

const CAPCUT_AGENT_PLANNER_INSTRUCTION = `You are the CapCut Editing Agent inside my app.
Your job is to control the CapCut desktop app on macOS using macros, screenshots, Accessibility API, mouse, keyboard, and visual reasoning.
You are editing vertical short-form videos.
You must complete the workflow:
- choose/open the clip in CapCut
- set canvas to 9:16
- create blurred background
- auto frame the subject
- add bottom sticker
- save project

Rules:
- Use saved macros first.
- Do not click random buttons.
- Never delete user files.
- Never publish or upload anything.
- Never close CapCut unless asked.
- Never overwrite an existing project without creating a backup.
- Keep all actions logged.
- Take screenshots before and after risky actions.
- If the UI changed, recover using visual reasoning.
- If recovery succeeds, update the macro memory.
- If recovery fails after several attempts, stop and report the exact failed step.`;

const WORKFLOW_STEP_LABELS = {
  before_start: [],
  after_clip_selected: ["clip", "media", "timeline", "video"],
  after_916_canvas: ["9:16", "ratio", "aspect", "canvas", "vertical"],
  after_blur_background: ["blur", "background", "effect", "adjust"],
  after_auto_frame: ["auto", "frame", "reframe", "tracking"],
  after_sticker_added: ["sticker", "stickers", "elements"],
  after_save: ["save", "saved", "project"]
};

const WORKFLOW_RECOVERY_TARGETS = {
  before_start: [],
  after_clip_selected: ["Media", "Timeline", "Clip", "Video"],
  after_916_canvas: ["Ratio", "Aspect ratio", "9:16", "Canvas", "Format"],
  after_blur_background: ["Blur", "Background", "Effects", "Adjust"],
  after_auto_frame: ["Auto frame", "Auto reframe", "Tracking", "Smart crop"],
  after_sticker_added: ["Sticker", "Stickers", "Elements"],
  after_save: ["Save", "Project", "Back up project"]
};

const DANGEROUS_DIALOG_RE = /\b(delete|remove media|replace existing|overwrite|upload|publish|share|sign out|clear cache|are you sure|permanently|trash)\b/i;

const PRIVACY_PANES = {
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  screenRecording: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  screenrecording: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  automation: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"
};

const PARKED_WORKSPACE_MODES = {
  compact: { width: 420, height: 720, margin: 28, anchor: "right" },
  sidecar: { width: 560, height: 860, margin: 28, anchor: "right" },
  left: { width: 520, height: 820, margin: 28, anchor: "left" }
};

function now() {
  return new Date().toISOString();
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampWait(value) {
  return Math.max(0, Math.min(120000, Math.round(safeNumber(value, 0))));
}

function slugify(value, fallback = "capcut-macro") {
  const slug = cleanText(value)
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || fallback;
}

function appleString(value) {
  return cleanText(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function swiftString(value) {
  return JSON.stringify(String(value ?? ""));
}

function safeDetails(details = {}) {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      typeof value === "string" ? value.slice(0, 600) : value
    ])
  );
}

async function exists(filePath) {
  if (!filePath) return false;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function commandExists(commandPath) {
  if (!commandPath) return false;
  try {
    await fs.access(commandPath);
    return true;
  } catch {
    return false;
  }
}

async function run(command, args = [], options = {}) {
  const timeout = options.timeoutMs || 12000;
  return execFileAsync(command, args, {
    timeout,
    maxBuffer: options.maxBuffer || 1024 * 1024,
    env: process.env
  });
}

async function runAppleScript(lines, options = {}) {
  const args = [];
  for (const line of Array.isArray(lines) ? lines : [lines]) {
    args.push("-e", line);
  }
  const result = await run("/usr/bin/osascript", args, options);
  return cleanText(result.stdout);
}

async function runSwiftJson(code, fallback = null, options = {}) {
  if (!(await commandExists("/usr/bin/swift"))) return fallback;
  try {
    const result = await run("/usr/bin/swift", ["-e", code], {
      timeoutMs: options.timeoutMs || 12000,
      maxBuffer: options.maxBuffer || 1024 * 1024 * 2
    });
    return JSON.parse(cleanText(result.stdout) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizePermissionResult(ok, message = "") {
  return { ok: Boolean(ok), message: cleanText(message) };
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function normalizeMacroName(value) {
  return cleanText(value) || "vertical_916_capcut_workflow";
}

function stepTime(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function eventKeyName(event = {}) {
  const key = cleanText(event.key).toLowerCase();
  if (key) return key === "\u001b" ? "escape" : key;
  return KEY_CODE_NAMES[Number(event.keyCode)] || `key_${Number(event.keyCode) || 0}`;
}

function isPrintableText(value) {
  const text = String(value || "");
  return Boolean(text) && !/[\u0000-\u001f\u007f]/.test(text);
}

function stepSummary(step = {}) {
  const isWindowRelative = step.coordinateMode === "capcut_window" || step.coordinateMode === "capcut_window_relative";
  if (step.type === "click") {
    if (isWindowRelative && Number.isFinite(Number(step.xRatio)) && Number.isFinite(Number(step.yRatio))) {
      return `Click CapCut ${Math.round(Number(step.xRatio) * 100)}%, ${Math.round(Number(step.yRatio) * 100)}%`;
    }
    return `Click ${Math.round(step.x || 0)}, ${Math.round(step.y || 0)}`;
  }
  if (step.type === "doubleClick") {
    if (isWindowRelative && Number.isFinite(Number(step.xRatio)) && Number.isFinite(Number(step.yRatio))) {
      return `Double-click CapCut ${Math.round(Number(step.xRatio) * 100)}%, ${Math.round(Number(step.yRatio) * 100)}%`;
    }
    return `Double-click ${Math.round(step.x || 0)}, ${Math.round(step.y || 0)}`;
  }
  if (step.type === "drag") {
    if (isWindowRelative && Number.isFinite(Number(step.fromXRatio)) && Number.isFinite(Number(step.toXRatio))) {
      return `Drag inside CapCut ${Math.round(Number(step.fromXRatio) * 100)}% -> ${Math.round(Number(step.toXRatio) * 100)}%`;
    }
    return `Drag ${Math.round(step.fromX || 0)}, ${Math.round(step.fromY || 0)} to ${Math.round(step.toX || 0)}, ${Math.round(step.toY || 0)}`;
  }
  if (step.type === "hotkey") return `Hotkey ${(step.keys || []).join("+")}`;
  if (step.type === "typeText") return `Type ${cleanText(step.text).length} characters`;
  if (step.type === "pressKey") return `Press ${step.key || "key"}`;
  if (step.type === "scroll") {
    const y = Math.round(Number(step.deltaY || 0));
    const x = Math.round(Number(step.deltaX || 0));
    const target = step.coordinateMode === "capcut_window" && Number.isFinite(Number(step.xRatio)) && Number.isFinite(Number(step.yRatio))
      ? ` at CapCut ${Math.round(Number(step.xRatio) * 100)}%, ${Math.round(Number(step.yRatio) * 100)}%`
      : "";
    return `Scroll${target} (${x}, ${y})`;
  }
  if (step.type === "wait") return `Wait ${Number.isFinite(Number(step.ms)) ? clampWait(step.ms) : 0}ms`;
  if (step.type === "capcut/importSourceVideo") return "Legacy import step";
  if (step.type === "screenshot") return "Take screenshot";
  if (step.type === "system/openApp") return "Open CapCut";
  if (step.type === "system/focusApp") return "Focus CapCut";
  if (step.type === "checkpoint") return `Checkpoint ${step.name || step.label || ""}`.trim();
  if (step.type === "aiRecover") return `AI recovery ${step.goal || ""}`.trim();
  return cleanText(step.type) || "Action";
}

function cloneTeachPhase(phase) {
  return {
    ...phase,
    status: phase.status || "pending",
    startedAt: phase.startedAt || null,
    completedAt: phase.completedAt || null,
    skippedAt: phase.skippedAt || null,
    startStepIndex: Number.isFinite(Number(phase.startStepIndex)) ? Number(phase.startStepIndex) : null,
    endStepIndex: Number.isFinite(Number(phase.endStepIndex)) ? Number(phase.endStepIndex) : null,
    stepCount: Number(phase.stepCount || 0),
    lastError: cleanText(phase.lastError)
  };
}

function defaultTeachPlan() {
  return CAPCUT_TEACH_PHASES.map(cloneTeachPhase);
}

function phaseDefinition(phaseId) {
  return CAPCUT_TEACH_PHASES.find((phase) => phase.id === cleanText(phaseId)) || null;
}

function ensureTeachPlan(session) {
  if (!session) return [];
  const existing = Array.isArray(session.teachPlan) ? session.teachPlan : [];
  session.teachPlan = CAPCUT_TEACH_PHASES.map((phase) => {
    const current = existing.find((item) => item.id === phase.id) || {};
    return cloneTeachPhase({ ...phase, ...current, id: phase.id, label: phase.label });
  });
  session.activePhaseId = cleanText(session.activePhaseId || session.teachPlan.find((phase) => phase.status === "recording")?.id);
  return session.teachPlan;
}

function currentTeachPhase(session) {
  const plan = ensureTeachPlan(session);
  return plan.find((phase) => phase.id === session.activePhaseId) || null;
}

function normalizeTeachStepPhases(session) {
  if (!session?.steps?.length) return;
  for (const step of session.steps) {
    if (step?.type === "capcut/importSourceVideo") {
      step.phaseId = "";
      step.phaseLabel = "Legacy import";
    }
  }
}

function refreshTeachPlanCounts(session) {
  normalizeTeachStepPhases(session);
  const plan = ensureTeachPlan(session);
  for (const phase of plan) {
    const indexes = (session.steps || [])
      .map((step, index) => step?.phaseId === phase.id ? index : -1)
      .filter((index) => index >= 0);
    phase.stepCount = indexes.length;
    if (indexes.length) {
      phase.startStepIndex = indexes[0];
      phase.endStepIndex = indexes[indexes.length - 1];
      if (!["recording", "complete", "skipped"].includes(phase.status)) phase.status = "draft";
    } else if (!["recording", "complete", "skipped"].includes(phase.status)) {
      phase.status = "pending";
      phase.startStepIndex = null;
      phase.endStepIndex = null;
    }
  }
  return plan;
}

function workflowInputsFrom(value = {}) {
  return {
    sourceVideoPath: cleanText(value.sourceVideoPath),
    stickerPath: cleanText(value.stickerPath),
    projectName: cleanText(value.projectName),
    outputProjectFolder: cleanText(value.outputProjectFolder)
  };
}

function expandUserPath(value) {
  const text = cleanText(value);
  if (!text) return "";
  if (text === "~") return os.homedir();
  if (text.startsWith("~/")) return path.join(os.homedir(), text.slice(2));
  return text;
}

function sanitizeProjectName(value) {
  const cleaned = cleanText(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .slice(0, 120)
    .trim();
  return cleaned || "";
}

async function assertReadableFile(filePath, fieldName) {
  const resolved = path.resolve(expandUserPath(filePath));
  let stat = null;
  try {
    stat = await fs.stat(resolved);
  } catch {
    const error = new Error(`${fieldName} does not exist: ${resolved}`);
    error.statusCode = 400;
    throw error;
  }
  if (!stat.isFile()) {
    const error = new Error(`${fieldName} is not a file: ${resolved}`);
    error.statusCode = 400;
    throw error;
  }
  return resolved;
}

async function ensureDirectory(directory, fieldName) {
  const resolved = path.resolve(expandUserPath(directory));
  try {
    await fs.mkdir(resolved, { recursive: true });
  } catch (error) {
    const wrapped = new Error(`${fieldName} could not be created: ${resolved}. ${error.message}`);
    wrapped.statusCode = 400;
    throw wrapped;
  }
  return resolved;
}

async function copyExistingProjectTarget(outputProjectFolder, projectName) {
  const candidates = [
    path.join(outputProjectFolder, projectName),
    path.join(outputProjectFolder, `${projectName}.capcut`),
    path.join(outputProjectFolder, `${projectName}.capcut_project`)
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
    } catch {
      continue;
    }
    const backupPath = `${candidate}.backup.${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await fs.cp(candidate, backupPath, { recursive: true, force: false, errorOnExist: true });
    return { projectTargetPath: candidate, projectBackupPath: backupPath };
  }
  return { projectTargetPath: "", projectBackupPath: "" };
}

function replaceInString(value, replacements = []) {
  let output = String(value ?? "");
  for (const [needle, replacement] of replacements) {
    if (!needle) continue;
    output = output.split(needle).join(replacement);
  }
  return output;
}

function mapDeep(value, mapper) {
  if (typeof value === "string") return mapper(value);
  if (Array.isArray(value)) return value.map((item) => mapDeep(item, mapper));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapDeep(item, mapper)]));
  }
  return value;
}

function placeholderizeValue(value, inputs = {}) {
  const replacements = Object.entries(workflowInputsFrom(inputs))
    .filter(([, inputValue]) => inputValue)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([key, inputValue]) => [inputValue, `{{${key}}}`]);
  return mapDeep(value, (text) => replaceInString(text, replacements));
}

function interpolateValue(value, inputs = {}) {
  const normalized = workflowInputsFrom(inputs);
  const replacements = Object.entries(normalized).map(([key, inputValue]) => [`{{${key}}}`, inputValue]);
  return mapDeep(value, (text) => replaceInString(text, replacements));
}

function workflowCheckpointForIndex(workflow, index, totalSteps) {
  const checkpoints = workflow?.checkpoints || [];
  if (!checkpoints.length || !totalSteps) return null;
  const checkpointIndex = Math.min(
    checkpoints.length - 1,
    Math.max(0, Math.floor(((index + 1) / totalSteps) * checkpoints.length) - 1)
  );
  const threshold = Math.ceil(((checkpointIndex + 1) / checkpoints.length) * totalSteps);
  return index + 1 === threshold ? checkpoints[checkpointIndex] : null;
}

function requireWorkflowInputs(workflow, inputs = {}) {
  const normalized = workflowInputsFrom(inputs);
  const missing = (workflow?.inputs || []).filter((key) => !normalized[key]);
  if (missing.length) {
    const error = new Error(`Missing workflow input: ${missing.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

async function validateWorkflowInputs(workflow, inputs = {}, options = {}) {
  const normalized = requireWorkflowInputs(workflow, inputs);
  const projectName = sanitizeProjectName(normalized.projectName);
  if (!projectName) {
    const error = new Error("projectName must contain at least one safe filename character.");
    error.statusCode = 400;
    throw error;
  }
  const outputProjectFolder = await ensureDirectory(normalized.outputProjectFolder, "outputProjectFolder");
  const prepared = {
    sourceVideoPath: normalized.sourceVideoPath,
    stickerPath: normalized.stickerPath
      ? (options.validateFiles === false ? path.resolve(expandUserPath(normalized.stickerPath)) : await assertReadableFile(normalized.stickerPath, "stickerPath"))
      : "",
    projectName,
    outputProjectFolder
  };
  const backup = await copyExistingProjectTarget(prepared.outputProjectFolder, prepared.projectName);
  return {
    ...prepared,
    ...backup
  };
}

function normalizeElementText(value) {
  return cleanText(value).replace(/\s+/g, " ").toLowerCase();
}

function elementMatchesLabel(element = {}, label = "") {
  const target = normalizeElementText(label);
  if (!target) return false;
  const haystack = normalizeElementText([
    element.label,
    element.title,
    element.value,
    element.role,
    element.source || ""
  ].filter(Boolean).join(" "));
  return haystack === target || haystack.includes(target) || target.includes(haystack);
}

function normalizeWindowBounds(window = null) {
  if (!window || typeof window !== "object") return null;
  const x = Number(window.x);
  const y = Number(window.y);
  const width = Number(window.width);
  const height = Number(window.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return {
    windowId: Number(window.windowId || 0),
    ownerName: cleanText(window.ownerName || "CapCut"),
    title: cleanText(window.title || ""),
    x,
    y,
    width,
    height
  };
}

function pointInsideWindow(x, y, window = null, padding = 0) {
  const bounds = normalizeWindowBounds(window);
  if (!bounds) return false;
  const px = Number(x);
  const py = Number(y);
  return Number.isFinite(px)
    && Number.isFinite(py)
    && px >= bounds.x - padding
    && px <= bounds.x + bounds.width + padding
    && py >= bounds.y - padding
    && py <= bounds.y + bounds.height + padding;
}

function sourceWindowFromStep(step = {}) {
  return normalizeWindowBounds(step.sourceWindow)
    || normalizeWindowBounds(step.screenshotBefore?.window)
    || normalizeWindowBounds(step.screenshotAfter?.window)
    || null;
}

function elementCenter(element = {}) {
  const x = Number(element.x);
  const y = Number(element.y);
  const width = Number(element.width);
  const height = Number(element.height);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: Number.isFinite(width) && width > 0 ? x + (width / 2) : x,
    y: Number.isFinite(height) && height > 0 ? y + (height / 2) : y
  };
}

function pointInsideElement(x, y, element = {}, padding = 0) {
  const left = Number(element.x);
  const top = Number(element.y);
  const width = Number(element.width);
  const height = Number(element.height);
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return false;
  return Number(x) >= left - padding
    && Number(x) <= left + width + padding
    && Number(y) >= top - padding
    && Number(y) <= top + height + padding;
}

function elementInsideWindow(element = {}, window = null, padding = 8) {
  const center = elementCenter(element);
  return Boolean(center && pointInsideWindow(center.x, center.y, window, padding));
}

function elementRoleScore(element = {}) {
  const role = normalizeElementText(element.role);
  if (/button|menu item|menuitem|checkbox|radio|tab/.test(role)) return 0;
  if (/text|static text|image|group/.test(role)) return 1;
  return 2;
}

function capCutRegionFromRatio(xRatio, yRatio) {
  const x = Number(xRatio);
  const y = Number(yRatio);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return "unknown";
  if (y < 0.09) return "top_toolbar";
  if (y > 0.72) return "timeline";
  if (x < 0.16) return "left_sidebar";
  if (x > 0.76) return "right_inspector";
  if (x >= 0.28 && x <= 0.74 && y >= 0.12 && y <= 0.66) return "preview_canvas";
  if (x < 0.42) return "media_panel";
  return "center_workspace";
}

function capCutRegionFromPoint(x, y, window = null) {
  const bounds = normalizeWindowBounds(window);
  if (!bounds) return "unknown";
  return capCutRegionFromRatio((Number(x) - bounds.x) / bounds.width, (Number(y) - bounds.y) / bounds.height);
}

function pointInCapCutRegion(x, y, window = null, region = "") {
  const expected = cleanText(region);
  if (!expected || expected === "unknown") return true;
  return capCutRegionFromPoint(x, y, window) === expected;
}

function semanticKindForElement(element = {}) {
  const role = normalizeElementText(element.role);
  const label = normalizeElementText(element.label || element.title || element.value || element.description);
  if (/button|checkbox|radio|tab/.test(role)) return "control";
  if (/menu/.test(role)) return "menu";
  if (/timeline|track/.test(label)) return "timeline";
  if (/canvas|preview|player/.test(label)) return "preview";
  if (/text|static text/.test(role)) return "label";
  return "screen_region";
}

function semanticLabelForElement(element = {}) {
  const label = cleanText(element.label || element.title || element.value || element.description);
  if (!label || label.length > 90) return "";
  if (/^(capcut|window|group|image|button)$/i.test(label)) return "";
  return label;
}

function normalizeOcrElementsForScreen(elements = [], screenshot = {}) {
  const window = normalizeWindowBounds(screenshot?.window);
  return (Array.isArray(elements) ? elements : []).map((element) => {
    if (screenshot?.target !== "capcut_window" || !window) return element;
    const x = Number(element.x);
    const y = Number(element.y);
    return {
      ...element,
      x: Number.isFinite(x) ? window.x + x : element.x,
      y: Number.isFinite(y) ? window.y + y : element.y,
      coordinateSpace: "screen_from_capcut_window"
    };
  });
}

function semanticTargetFromPoint({ x, y, window, elements = [], phase = null } = {}) {
  const bounds = normalizeWindowBounds(window);
  const region = capCutRegionFromPoint(x, y, bounds);
  const relative = bounds ? {
    xRatio: Math.max(0, Math.min(1, (Number(x) - bounds.x) / bounds.width)),
    yRatio: Math.max(0, Math.min(1, (Number(y) - bounds.y) / bounds.height)),
    windowX: Math.round(Number(x) - bounds.x),
    windowY: Math.round(Number(y) - bounds.y),
    windowWidth: Math.round(bounds.width),
    windowHeight: Math.round(bounds.height)
  } : {};
  const candidates = (Array.isArray(elements) ? elements : [])
    .filter((element) => semanticLabelForElement(element))
    .filter((element) => elementInsideWindow(element, bounds, 12))
    .map((element) => {
      const center = elementCenter(element);
      const distance = center ? Math.hypot(center.x - Number(x), center.y - Number(y)) : Infinity;
      const containsPoint = pointInsideElement(x, y, element, 10);
      return { element, center, distance, containsPoint };
    })
    .filter((item) => item.containsPoint || item.distance <= 72)
    .sort((a, b) => {
      if (a.containsPoint !== b.containsPoint) return a.containsPoint ? -1 : 1;
      const roleDiff = elementRoleScore(a.element) - elementRoleScore(b.element);
      if (roleDiff) return roleDiff;
      return a.distance - b.distance;
    });
  const best = candidates[0] || null;
  const label = best ? semanticLabelForElement(best.element) : "";
  return {
    version: 1,
    strategy: label ? "semantic_label_then_region" : "region_ratio_fallback",
    kind: best ? semanticKindForElement(best.element) : "screen_region",
    label,
    role: best ? cleanText(best.element.role) : "",
    source: best ? cleanText(best.element.source) : "",
    region,
    confidence: best ? (best.containsPoint ? "high" : "medium") : "low",
    phaseId: cleanText(phase?.id),
    phaseLabel: cleanText(phase?.label),
    ...relative
  };
}

function semanticReplayCandidates(target = {}, observation = {}, window = null) {
  const label = cleanText(target.label);
  if (!label) return [];
  const bounds = normalizeWindowBounds(window);
  return (observation.elements || [])
    .filter((element) => elementMatchesLabel(element, label))
    .filter((element) => elementInsideWindow(element, bounds, 12))
    .map((element) => {
      const center = elementCenter(element);
      const exactLabel = normalizeElementText(element.label || element.title || element.value) === normalizeElementText(label);
      const regionMatch = center ? pointInCapCutRegion(center.x, center.y, bounds, target.region) : false;
      return {
        element,
        center,
        exactLabel,
        regionMatch,
        score: (exactLabel ? 0 : 10) + (regionMatch ? 0 : 5) + elementRoleScore(element)
      };
    })
    .filter((item) => item.center)
    .sort((a, b) => a.score - b.score);
}

function semanticTargetForReplayStep(step = {}) {
  if (step.semanticTarget?.label) return step.semanticTarget;
  if (!["click", "doubleClick"].includes(step.type)) return null;
  const description = cleanText(step.description);
  const match = description.match(/^(?:click|double-click)\s+(.+)$/i);
  const label = cleanText(match?.[1]);
  if (!label || /\b(inside capcut|capcut\s+\d|at\s+\d|from\s+\d)\b/i.test(label)) return null;
  return {
    version: 1,
    strategy: "description_label_then_region",
    kind: "control",
    label,
    region: capCutRegionFromRatio(step.xRatio, step.yRatio),
    confidence: "medium"
  };
}

export class CapCutController {
  constructor({ config, state, helpers } = {}) {
    this.config = config || {};
    this.state = state || {};
    this.helpers = helpers || {};
    this.teachProcess = null;
    this.teachBuffer = "";
    this.recordQueue = Promise.resolve();
    this.pendingMouse = null;
    this.replayEmergencyProcess = null;
    this.activeReplayId = "";
    this.macroStorage = new CapCutMacroStorage({ getDirectory: () => this.macroDir() });
  }

  controlState() {
    this.state.capcutControl ||= {
      actions: [],
      screenshots: [],
      teach: null,
      replay: null,
      workflows: {},
      planner: null,
      workspace: null,
      lastStatus: null,
      lastAction: null,
      lastError: null
    };
    this.state.capcutControl.actions ||= [];
    this.state.capcutControl.screenshots ||= [];
    this.state.capcutControl.workflows ||= {};
    this.state.capcutControl.planner ||= null;
    this.state.capcutControl.workspace ||= {
      mode: "compact",
      parked: false,
      bounds: null,
      lastParkedAt: null,
      note: "CapCut can be parked in a fixed desktop area, but real automation still requires a visible CapCut window."
    };
    this.state.capcutControl.lastError ||= null;
    if (this.state.capcutControl.teach?.recording && !this.teachProcess) {
      this.state.capcutControl.teach.recording = false;
      this.state.capcutControl.teach.status = "stopped";
      this.state.capcutControl.teach.stopReason ||= "runtime_restarted";
      this.state.capcutControl.teach.stoppedAt ||= now();
    }
    if (
      this.state.capcutControl.replay?.running
      && !this.state.capcutControl.replay.cancelRequested
      && this.state.capcutControl.replay.id !== this.activeReplayId
    ) {
      this.state.capcutControl.replay.running = false;
      this.state.capcutControl.replay.status = "stopped";
      this.state.capcutControl.replay.stopReason ||= "runtime_restarted";
      this.state.capcutControl.replay.finishedAt ||= now();
    }
    return this.state.capcutControl;
  }

  async logAction(action, status = "complete", details = {}) {
    const control = this.controlState();
    const entry = {
      id: this.helpers.newId ? this.helpers.newId("capcut_action") : `capcut_action_${Date.now()}`,
      action,
      status,
      details: safeDetails(details),
      createdAt: now()
    };
    control.actions.unshift(entry);
    control.actions = control.actions.slice(0, 200);
    control.lastAction = entry;
    if (["failed", "error", "blocked"].includes(cleanText(status).toLowerCase())) {
      control.lastError = {
        action,
        status,
        message: cleanText(details.error || details.reason || details.message || action),
        createdAt: entry.createdAt
      };
    }
    this.helpers.addStateLog?.("capcut_control_action", `CapCut ${action}: ${status}`, entry);
    await this.helpers.saveState?.();
    return entry;
  }

  async detectInstall() {
    const configured = cleanText(process.env.CAPCUT_APP_PATH || this.config.capcutAppPath);
    const candidates = [
      configured,
      "/Applications/CapCut.app",
      path.join(os.homedir(), "Applications", "CapCut.app")
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (await exists(candidate)) {
        return { installed: true, appPath: candidate, appName: "CapCut" };
      }
    }
    try {
      const { stdout } = await run("/usr/bin/mdfind", ["kMDItemFSName == 'CapCut.app'"], { timeoutMs: 2500 });
      const found = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      if (found && await exists(found)) {
        return { installed: true, appPath: found, appName: "CapCut" };
      }
    } catch {
      // Spotlight can be disabled or slow. The fixed app paths above are enough for normal installs.
    }
    return { installed: false, appPath: "", appName: "CapCut" };
  }

  async isCapCutInstalled() {
    return (await this.detectInstall()).installed;
  }

  async activeApp() {
    try {
      return await runAppleScript('tell application "System Events" to get name of first application process whose frontmost is true', { timeoutMs: 5000 });
    } catch (error) {
      return "";
    }
  }

  async getActiveApp() {
    return this.activeApp();
  }

  async isRunning() {
    try {
      const result = await runAppleScript('tell application "System Events" to exists process "CapCut"', { timeoutMs: 5000 });
      return /^true$/i.test(result);
    } catch {
      try {
        await run("/usr/bin/pgrep", ["-x", "CapCut"], { timeoutMs: 3000 });
        return true;
      } catch {
        return false;
      }
    }
  }

  async isCapCutRunning() {
    return this.isRunning();
  }

  async checkAccessibilityPermission() {
    try {
      await runAppleScript('tell application "System Events" to get name of first application process whose frontmost is true', { timeoutMs: 5000 });
      return normalizePermissionResult(true, "System Events automation is available.");
    } catch (error) {
      return normalizePermissionResult(false, error.message);
    }
  }

  async checkScreenRecordingPermission() {
    const probePath = path.join(os.tmpdir(), `argentum-capcut-screen-probe-${Date.now()}.png`);
    try {
      await run("/usr/sbin/screencapture", ["-x", "-t", "png", probePath], { timeoutMs: 10000 });
      const stat = await fs.stat(probePath);
      await fs.rm(probePath, { force: true }).catch(() => {});
      return normalizePermissionResult(stat.size > 0, stat.size > 0 ? "Screen capture succeeded." : "Screen capture returned an empty image.");
    } catch (error) {
      await fs.rm(probePath, { force: true }).catch(() => {});
      return normalizePermissionResult(false, error.message);
    }
  }

  async checkAutomationPermission(accessibility = null) {
    const accessible = accessibility || await this.checkAccessibilityPermission();
    return normalizePermissionResult(accessible.ok, accessible.ok ? "Automation commands can be sent through System Events." : accessible.message);
  }

  async status() {
    const installed = await this.detectInstall();
    const [running, activeApp, accessibility, screenRecording] = await Promise.all([
      this.isRunning(),
      this.activeApp(),
      this.checkAccessibilityPermission(),
      this.checkScreenRecordingPermission()
    ]);
    const automation = await this.checkAutomationPermission(accessibility);
    const control = this.controlState();
    const lastAction = control.lastAction || null;
    let lastError = control.lastError || (lastAction && ["failed", "error", "blocked"].includes(cleanText(lastAction.status).toLowerCase())
      ? {
        action: lastAction.action,
        status: lastAction.status,
        message: cleanText(lastAction.details?.error || lastAction.details?.reason || lastAction.action),
        createdAt: lastAction.createdAt
      }
      : null);
    const staleInstallError = /not installed/i.test(lastError?.message || "") && installed.installed;
    const staleRunningError = /not running/i.test(lastError?.message || "") && running;
    if (staleInstallError || staleRunningError) {
      control.lastError = null;
      lastError = null;
    }
    const payload = {
      installed: installed.installed,
      appPath: installed.appPath,
      appName: installed.appName,
      running,
      installedStatus: installed.installed ? "yes" : "no",
      runningStatus: running ? "yes" : "no",
      accessibilityPermission: accessibility.ok,
      accessibilityStatus: accessibility.ok ? "yes" : (accessibility.message ? "no" : "unknown"),
      accessibilityMessage: accessibility.message,
      screenRecordingPermission: screenRecording.ok,
      screenRecordingStatus: screenRecording.ok ? "yes" : (screenRecording.message ? "no" : "unknown"),
      screenRecordingMessage: screenRecording.message,
      automationPermission: automation.ok,
      automationStatus: automation.ok ? "yes" : (automation.message ? "no" : "unknown"),
      automationMessage: automation.message,
      activeApp,
      lastAction,
      lastError,
      automationMode: "capcut_window_relative",
      cursorBehavior: "restore_after_action",
      workspace: control.workspace || null,
      actions: control.actions.slice(0, 20),
      latestScreenshot: control.screenshots[0] || null,
      checkedAt: now()
    };
    control.lastStatus = payload;
    await this.helpers.saveState?.();
    return payload;
  }

  async openCapCut() {
    const install = await this.detectInstall();
    if (!install.installed) {
      await this.logAction("openCapCut", "failed", { reason: "CapCut is not installed." });
      const error = new Error("CapCut is not installed on this Mac.");
      error.statusCode = 404;
      throw error;
    }
    await run("/usr/bin/open", [install.appPath], { timeoutMs: 15000 });
    await this.wait(1200, { skipLog: true });
    await this.logAction("openCapCut", "complete", { appPath: install.appPath });
    return this.status();
  }

  async focusCapCut() {
    const install = await this.detectInstall();
    if (!install.installed) {
      await this.logAction("focusCapCut", "failed", { reason: "CapCut is not installed." });
      const error = new Error("CapCut is not installed on this Mac.");
      error.statusCode = 404;
      throw error;
    }
    try {
      await runAppleScript('tell application "CapCut" to activate', { timeoutMs: 10000 });
    } catch {
      await run("/usr/bin/open", [install.appPath], { timeoutMs: 15000 });
    }
    await this.wait(500, { skipLog: true });
    await this.logAction("focusCapCut", "complete", { appPath: install.appPath });
    return this.status();
  }

  async screenBounds() {
    try {
      const output = await runAppleScript('tell application "Finder" to get bounds of window of desktop', { timeoutMs: 5000 });
      const [x, y, right, bottom] = output.split(/,\s*/).map(Number);
      if ([x, y, right, bottom].every(Number.isFinite) && right > x && bottom > y) {
        return { x, y, width: right - x, height: bottom - y };
      }
    } catch {
      // Fall through to a conservative default.
    }
    return { x: 0, y: 0, width: 1440, height: 900 };
  }

  parkedBoundsForScreen(screen, mode = "compact") {
    const preset = PARKED_WORKSPACE_MODES[cleanText(mode)] || PARKED_WORKSPACE_MODES.compact;
    const width = Math.min(preset.width, Math.max(360, screen.width - (preset.margin * 2)));
    const height = Math.min(preset.height, Math.max(520, screen.height - (preset.margin * 2)));
    const x = preset.anchor === "left"
      ? screen.x + preset.margin
      : screen.x + screen.width - width - preset.margin;
    const y = screen.y + preset.margin;
    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
      mode: cleanText(mode) || "compact"
    };
  }

  async setCapCutWindowBounds(bounds) {
    const x = Math.max(0, Math.round(safeNumber(bounds.x)));
    const y = Math.max(0, Math.round(safeNumber(bounds.y)));
    const width = Math.max(320, Math.round(safeNumber(bounds.width, 420)));
    const height = Math.max(480, Math.round(safeNumber(bounds.height, 720)));
    await runAppleScript([
      'tell application "System Events"',
      'if not (exists process "CapCut") then error "CapCut is not running."',
      'tell process "CapCut"',
      'if not (exists window 1) then error "CapCut does not have an automation window yet."',
      `set position of window 1 to {${x}, ${y}}`,
      `set size of window 1 to {${width}, ${height}}`,
      "end tell",
      "end tell"
    ], { timeoutMs: 10000 });
    return { x, y, width, height };
  }

  /**
   * Pin the CapCut window to a fixed frame so every ratio fallback, OCR
   * region, and anchor prediction lines up with teach time. Replays pass the
   * macro's taughtWindowFrame; teaches use the shared default. If the OS
   * refuses the exact size (smaller screen), the mismatch is logged so the
   * run report shows why coordinates may scale.
   */
  async normalizeCapCutWindow(frame = null) {
    const requested = normalizeWindowBounds(frame) || { ...DEFAULT_TEACH_WINDOW_FRAME };
    try {
      await this.setCapCutWindowBounds(requested);
      await this.wait(350, { skipLog: true });
    } catch (error) {
      await this.logAction("normalizeCapCutWindow", "failed", { error: error.message, requested });
      return this.currentCapCutAutomationWindow();
    }
    const actual = await this.currentCapCutAutomationWindow();
    const mismatch = actual
      && (Math.abs(actual.width - requested.width) > 4 || Math.abs(actual.height - requested.height) > 4);
    if (mismatch) {
      await this.logAction("normalizeCapCutWindow", "window_mismatch", { requested, actual });
    } else {
      await this.logAction("normalizeCapCutWindow", "complete", { frame: actual || requested });
    }
    return actual || normalizeWindowBounds(requested);
  }

  async parkCapCut(options = {}) {
    const install = await this.detectInstall();
    if (!install.installed) {
      await this.logAction("parkCapCut", "failed", { reason: "CapCut is not installed." });
      const error = new Error("CapCut is not installed on this Mac.");
      error.statusCode = 404;
      throw error;
    }
    if (!(await this.isRunning())) {
      await run("/usr/bin/open", ["-g", install.appPath], { timeoutMs: 15000 });
      await this.wait(1800, { skipLog: true });
    }
    const mode = cleanText(options.mode || this.controlState().workspace?.mode || "compact");
    const screen = await this.screenBounds();
    const plannedBounds = this.parkedBoundsForScreen(screen, mode);
    const requestedBounds = await this.setCapCutWindowBounds(plannedBounds);
    await this.wait(400, { skipLog: true });
    const parkedWindow = await this.capCutWindowInfo().catch(() => null);
    const bounds = parkedWindow
      ? {
        x: Math.round(safeNumber(parkedWindow.x)),
        y: Math.round(safeNumber(parkedWindow.y)),
        width: Math.round(safeNumber(parkedWindow.width)),
        height: Math.round(safeNumber(parkedWindow.height))
      }
      : requestedBounds;
    const control = this.controlState();
    control.workspace = {
      mode: plannedBounds.mode,
      parked: true,
      bounds,
      requestedBounds,
      screen,
      lastParkedAt: now(),
      note: "CapCut is parked in a fixed visible area. Teach/replay still focuses it only while automation is running."
    };
    let screenshot = null;
    try {
      screenshot = (await this.takeScreenshot()).screenshot;
      control.workspace.latestScreenshot = screenshot;
    } catch (error) {
      control.workspace.latestScreenshot = { error: error.message, createdAt: now() };
    }
    await this.logAction("parkCapCut", "complete", { mode: plannedBounds.mode, bounds });
    await this.helpers.saveState?.();
    return this.status();
  }

  async takeScreenshot() {
    const control = this.controlState();
    const screenshotDir = path.resolve(this.config.capcutScreenshotDir || path.join(os.tmpdir(), "argentum-capcut-screenshots"));
    await fs.mkdir(screenshotDir, { recursive: true });
    const id = this.helpers.newId ? this.helpers.newId("capcut_screen") : `capcut_screen_${Date.now()}`;
    const filePath = path.join(screenshotDir, `${id}.png`);
    const capture = await this.captureCapCutWindowScreenshot(filePath, { allowDesktopFallback: false });
    const stat = await fs.stat(filePath);
    if (!stat.size) throw new Error("Screenshot file was empty.");
    const entry = {
      id,
      filePath,
      sizeBytes: stat.size,
      target: capture.target,
      window: capture.window,
      url: `/api/capcut-control/screenshots/${encodeURIComponent(id)}`,
      createdAt: now()
    };
    control.screenshots.unshift(entry);
    control.screenshots = control.screenshots.slice(0, 20);
    await this.logAction("takeScreenshot", "complete", { screenshotId: id, sizeBytes: stat.size, target: capture.target });
    return { screenshot: entry, status: await this.status() };
  }

  swiftMouseCode(kind, args = {}) {
    const x = safeNumber(args.x);
    const y = safeNumber(args.y);
    const fromX = safeNumber(args.fromX);
    const fromY = safeNumber(args.fromY);
    const toX = safeNumber(args.toX);
    const toY = safeNumber(args.toY);
    const deltaX = Math.round(safeNumber(args.deltaX));
    const deltaY = Math.round(safeNumber(args.deltaY));
    if (kind === "scroll") {
      return `
import CoreGraphics
import Foundation
let source = CGEventSource(stateID: .hidSystemState)
let point = CGPoint(x: CGFloat(${x}), y: CGFloat(${y}))
let original = CGEvent(source: nil)?.location ?? point
let move = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)
move?.post(tap: .cghidEventTap)
usleep(35000)
let scroll = CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 2, wheel1: Int32(${deltaY}), wheel2: Int32(${deltaX}), wheel3: 0)
scroll?.post(tap: .cghidEventTap)
usleep(35000)
let moveBack = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: original, mouseButton: .left)
moveBack?.post(tap: .cghidEventTap)
`;
    }
    if (kind === "drag") {
      return `
import CoreGraphics
import Foundation
let source = CGEventSource(stateID: .hidSystemState)
func post(_ type: CGEventType, _ x: CGFloat, _ y: CGFloat) {
  let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left)
  event?.post(tap: .cghidEventTap)
}
let fromX = CGFloat(${fromX})
let fromY = CGFloat(${fromY})
let toX = CGFloat(${toX})
let toY = CGFloat(${toY})
let original = CGEvent(source: nil)?.location ?? CGPoint(x: fromX, y: fromY)
post(.mouseMoved, fromX, fromY)
usleep(30000)
post(.leftMouseDown, fromX, fromY)
for step in 1...16 {
  let ratio = CGFloat(step) / CGFloat(16)
  post(.leftMouseDragged, fromX + ((toX - fromX) * ratio), fromY + ((toY - fromY) * ratio))
  usleep(18000)
}
post(.leftMouseUp, toX, toY)
usleep(25000)
post(.mouseMoved, original.x, original.y)
`;
    }
    const clickCount = kind === "doubleClick" ? 2 : 1;
    return `
import CoreGraphics
import Foundation
let source = CGEventSource(stateID: .hidSystemState)
let point = CGPoint(x: CGFloat(${x}), y: CGFloat(${y}))
let original = CGEvent(source: nil)?.location ?? point
func click(_ state: Int64) {
  let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)
  down?.setIntegerValueField(.mouseEventClickState, value: state)
  down?.post(tap: .cghidEventTap)
  usleep(35000)
  let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)
  up?.setIntegerValueField(.mouseEventClickState, value: state)
  up?.post(tap: .cghidEventTap)
}
for i in 1...${clickCount} {
  click(Int64(i))
  usleep(70000)
}
let moveBack = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: original, mouseButton: .left)
moveBack?.post(tap: .cghidEventTap)
`;
  }

  async runSwiftMouse(kind, args) {
    if (await commandExists("/usr/bin/swift")) {
      await run("/usr/bin/swift", ["-e", this.swiftMouseCode(kind, args)], { timeoutMs: 20000, maxBuffer: 1024 * 1024 * 2 });
      return;
    }
    const cliclick = await exists("/opt/homebrew/bin/cliclick")
      ? "/opt/homebrew/bin/cliclick"
      : await exists("/usr/local/bin/cliclick")
        ? "/usr/local/bin/cliclick"
        : "";
    if (!cliclick) throw new Error("Mouse automation requires /usr/bin/swift or cliclick.");
    if (kind === "drag") {
      await run(cliclick, [`m:${safeNumber(args.fromX)},${safeNumber(args.fromY)}`, "dd:.", `dm:${safeNumber(args.toX)},${safeNumber(args.toY)}`, "du:."], { timeoutMs: 15000 });
      return;
    }
    if (kind === "scroll") {
      throw new Error("Scroll automation requires /usr/bin/swift.");
    }
    await run(cliclick, [`c:${safeNumber(args.x)},${safeNumber(args.y)}`], { timeoutMs: 15000 });
    if (kind === "doubleClick") await run(cliclick, [`c:${safeNumber(args.x)},${safeNumber(args.y)}`], { timeoutMs: 15000 });
  }

  async click(x, y) {
    await this.runSwiftMouse("click", { x, y });
    await this.logAction("click", "complete", { x: safeNumber(x), y: safeNumber(y) });
    return this.status();
  }

  async doubleClick(x, y) {
    await this.runSwiftMouse("doubleClick", { x, y });
    await this.logAction("doubleClick", "complete", { x: safeNumber(x), y: safeNumber(y) });
    return this.status();
  }

  async drag(fromX, fromY, toX, toY) {
    await this.runSwiftMouse("drag", { fromX, fromY, toX, toY });
    await this.logAction("drag", "complete", {
      fromX: safeNumber(fromX),
      fromY: safeNumber(fromY),
      toX: safeNumber(toX),
      toY: safeNumber(toY)
    });
    return this.status();
  }

  async scroll(x, y, deltaX, deltaY) {
    await this.runSwiftMouse("scroll", { x, y, deltaX, deltaY });
    await this.logAction("scroll", "complete", {
      x: safeNumber(x),
      y: safeNumber(y),
      deltaX: Math.round(safeNumber(deltaX)),
      deltaY: Math.round(safeNumber(deltaY))
    });
    return this.status();
  }

  async typeText(text) {
    await runAppleScript(`tell application "System Events" to keystroke "${appleString(text)}"`, { timeoutMs: 15000 });
    await this.logAction("typeText", "complete", { length: cleanText(text).length });
    return this.status();
  }

  async pasteText(text) {
    await runAppleScript(`set the clipboard to "${appleString(text)}"`, { timeoutMs: 10000 });
    await this.hotkey(["command", "v"]);
    await this.logAction("pasteText", "complete", { length: cleanText(text).length });
    return this.status();
  }

  keyScript(key, modifiers = []) {
    const normalized = cleanText(key).toLowerCase();
    const using = modifiers.length
      ? ` using {${modifiers.map((modifier) => `${modifier} down`).join(", ")}}`
      : "";
    if (normalized.length === 1) return `keystroke "${appleString(normalized)}"${using}`;
    const code = KEY_CODES[normalized];
    if (!Number.isFinite(code)) throw new Error(`Unsupported key: ${key}`);
    return `key code ${code}${using}`;
  }

  async pressKey(key) {
    await runAppleScript(`tell application "System Events" to ${this.keyScript(key)}`, { timeoutMs: 10000 });
    await this.logAction("pressKey", "complete", { key: cleanText(key) });
    return this.status();
  }

  async hotkey(keys = []) {
    const list = (Array.isArray(keys) ? keys : cleanText(keys).split("+"))
      .map((item) => cleanText(item).toLowerCase())
      .filter(Boolean);
    const modifiers = [];
    const normalKeys = [];
    for (const key of list) {
      if (MODIFIERS[key]) modifiers.push(MODIFIERS[key]);
      else normalKeys.push(key);
    }
    const key = normalKeys[normalKeys.length - 1];
    if (!key) throw new Error("Hotkey requires a non-modifier key.");
    await runAppleScript(`tell application "System Events" to ${this.keyScript(key, modifiers)}`, { timeoutMs: 10000 });
    await this.logAction("hotkey", "complete", { keys: list });
    return this.status();
  }

  async wait(ms, options = {}) {
    const waitMs = clampWait(ms);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    if (!options.skipLog) await this.logAction("wait", "complete", { ms: waitMs });
    return options.skipLog ? null : this.status();
  }

  async waitForReplayResume(replay = null) {
    const current = replay || this.controlState().replay;
    if (!current) return true;
    let loggedPause = false;
    while (current.pauseRequested && !current.cancelRequested) {
      current.running = true;
      current.status = "paused";
      current.currentStepStatus = "paused";
      current.pausedAt ||= now();
      if (!loggedPause) {
        loggedPause = true;
        await this.logAction("pauseCapCutMacroReplay", "paused", {
          replayId: current.id || "",
          macroId: current.macroId || "",
          step: current.currentStepIndex || 0
        });
      }
      await this.helpers.saveState?.();
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (current.cancelRequested) return false;
    if (current.status === "paused") {
      current.status = "running";
      current.currentStepStatus = "running";
      current.resumedAt = now();
      await this.helpers.saveState?.();
    }
    return true;
  }

  async waitDuringReplay(ms) {
    let remaining = clampWait(ms);
    while (remaining > 0) {
      const replay = this.controlState().replay;
      if (replay?.cancelRequested) break;
      const canContinue = await this.waitForReplayResume(replay);
      if (!canContinue) break;
      const chunk = Math.min(remaining, 250);
      await new Promise((resolve) => setTimeout(resolve, chunk));
      remaining -= chunk;
    }
    await this.logAction("wait", "complete", { ms: clampWait(ms), replayAware: true });
    return this.status();
  }

  async openPermissionPane(permission) {
    const key = cleanText(permission).replace(/[\s_-]/g, "").toLowerCase();
    const url = PRIVACY_PANES[key] || PRIVACY_PANES[cleanText(permission)];
    if (!url) throw new Error(`Unknown permission pane: ${permission}`);
    await run("/usr/bin/open", [url], { timeoutMs: 10000 });
    await this.logAction("openPermissionPane", "complete", { permission });
    return this.status();
  }

  macroDir() {
    return path.resolve(this.config.capcutMacroDir || path.join(os.homedir(), "Library", "Application Support", "Argentum OS", "clipping-office", "capcut-macros"));
  }

  async ensureMacroDir() {
    return this.macroStorage.ensureDir();
  }

  macroScreenshotDir(session) {
    return path.join(this.macroDir(), cleanText(session?.id) || "draft", "screenshots");
  }

  workflowRootDir() {
    return path.join(this.macroDir(), "workflow-runs");
  }

  workflowCheckpointDir(workflowRun) {
    const projectName = slugify(workflowRun?.inputs?.projectName || workflowRun?.workflowName || "capcut-workflow", "capcut-workflow");
    return path.join(this.workflowRootDir(), "checkpoints", projectName, cleanText(workflowRun?.id) || "draft");
  }

  workflowLogDir(workflowRun) {
    const projectName = slugify(workflowRun?.inputs?.projectName || workflowRun?.workflowName || "capcut-workflow", "capcut-workflow");
    return path.join(this.workflowRootDir(), "logs", projectName);
  }

  async takeWorkflowScreenshot(workflowRun, label = "checkpoint") {
    const directory = this.workflowCheckpointDir(workflowRun);
    await fs.mkdir(directory, { recursive: true });
    const runId = cleanText(workflowRun?.id) || "draft";
    const id = `${slugify(label, "checkpoint")}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const filePath = path.join(directory, `${id}.png`);
    try {
      const capture = await this.captureCapCutWindowScreenshot(filePath, { allowDesktopFallback: false });
      const stat = await fs.stat(filePath);
      if (!stat.size) throw new Error("Screenshot file was empty.");
      return {
        id,
        runId,
        filePath,
        sizeBytes: stat.size,
        target: capture.target,
        window: capture.window,
        url: `/api/capcut-control/workflow-screenshots/${encodeURIComponent(runId)}/${encodeURIComponent(id)}`,
        createdAt: now()
      };
    } catch (error) {
      await fs.rm(filePath, { force: true }).catch(() => {});
      return {
        id,
        runId,
        filePath: "",
        sizeBytes: 0,
        error: error.message,
        createdAt: now()
      };
    }
  }

  async persistWorkflowRun(run) {
    const directory = this.workflowLogDir(run);
    await fs.mkdir(directory, { recursive: true });
    const filePath = path.join(directory, `${cleanText(run.id) || `run_${Date.now()}`}.json`);
    await fs.writeFile(filePath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
    run.logFilePath = filePath;
    return filePath;
  }

  async capCutWindowInfo() {
    const code = `
import CoreGraphics
import Foundation

func number(_ value: Any?) -> Double {
  if let double = value as? Double { return double }
  if let int = value as? Int { return Double(int) }
  if let float = value as? Float { return Double(float) }
  if let number = value as? NSNumber { return number.doubleValue }
  return 0
}

let options = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
guard let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
  print("{}")
  exit(0)
}

var best: [String: Any]? = nil
var bestArea: Double = 0
for window in windows {
  let owner = window[kCGWindowOwnerName as String] as? String ?? ""
  let layer = window[kCGWindowLayer as String] as? Int ?? 999
  guard owner == "CapCut" && layer == 0 else { continue }
  guard let bounds = window[kCGWindowBounds as String] as? [String: Any] else { continue }
  let width = number(bounds["Width"])
  let height = number(bounds["Height"])
  let area = width * height
  guard area > bestArea && width >= 320 && height >= 240 else { continue }
  bestArea = area
  best = [
    "windowId": window[kCGWindowNumber as String] as? Int ?? 0,
    "ownerName": owner,
    "title": window[kCGWindowName as String] as? String ?? "",
    "x": number(bounds["X"]),
    "y": number(bounds["Y"]),
    "width": width,
    "height": height,
    "area": area
  ]
}

if let best = best,
   let data = try? JSONSerialization.data(withJSONObject: best, options: []),
   let json = String(data: data, encoding: .utf8) {
  print(json)
} else {
  print("{}")
}
`;
    const info = await runSwiftJson(code, {}, { timeoutMs: 12000, maxBuffer: 1024 * 1024 * 2 });
    return Number(info?.windowId) > 0 ? info : null;
  }

  async captureCapCutWindowScreenshot(filePath, options = {}) {
    const allowDesktopFallback = options.allowDesktopFallback !== false;
    const window = await this.capCutWindowInfo();
    if (window?.windowId) {
      await run("/usr/sbin/screencapture", ["-x", "-t", "png", "-l", String(window.windowId), filePath], { timeoutMs: 12000 });
      return { target: "capcut_window", window };
    }
    if (!allowDesktopFallback) {
      throw new Error("CapCut does not have a visible window to capture. Open or Park CapCut first.");
    }
    await run("/usr/sbin/screencapture", ["-x", "-t", "png", filePath], { timeoutMs: 12000 });
    return { target: "desktop", window: null };
  }

  async activeWindowInfo() {
    try {
      const output = await runAppleScript([
        'tell application "System Events"',
        'set frontApp to first application process whose frontmost is true',
        'set appName to name of frontApp',
        'set windowTitle to ""',
        'try',
        'set windowTitle to name of front window of frontApp',
        'end try',
        'return appName & "\t" & windowTitle',
        "end tell"
      ], { timeoutMs: 5000 });
      const [activeApp = "", activeWindowTitle = ""] = output.split("\t");
      return { activeApp: cleanText(activeApp), activeWindowTitle: cleanText(activeWindowTitle) };
    } catch {
      return { activeApp: "", activeWindowTitle: "" };
    }
  }

  async takeMacroScreenshot(session, label = "step") {
    const directory = this.macroScreenshotDir(session);
    await fs.mkdir(directory, { recursive: true });
    const sessionId = cleanText(session?.id) || "draft";
    const id = `${slugify(label, "step")}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const filePath = path.join(directory, `${id}.png`);
    try {
      const capture = await this.captureCapCutWindowScreenshot(filePath, { allowDesktopFallback: true });
      const stat = await fs.stat(filePath);
      if (!stat.size) throw new Error("Screenshot file was empty.");
      return {
        id,
        sessionId,
        filePath,
        sizeBytes: stat.size,
        target: capture.target,
        window: capture.window,
        url: `/api/capcut-control/macro-screenshots/${encodeURIComponent(sessionId)}/${encodeURIComponent(id)}`,
        createdAt: now()
      };
    } catch (error) {
      await fs.rm(filePath, { force: true }).catch(() => {});
      return {
        id,
        sessionId,
        filePath: "",
        sizeBytes: 0,
        error: error.message,
        createdAt: now()
      };
    }
  }

  swiftTeachRecorderCode({ emergencyOnly = false } = {}) {
    return `
import AppKit
import CoreGraphics
import Foundation

let emergencyOnly = ${emergencyOnly ? "true" : "false"}

func eventTypeName(_ type: CGEventType) -> String {
  switch type {
  case .leftMouseDown: return "mouseDown"
  case .leftMouseUp: return "mouseUp"
  case .leftMouseDragged: return "mouseDragged"
  case .keyDown: return "keyDown"
  case .scrollWheel: return "scroll"
  default: return "unknown"
  }
}

func flagsToArray(_ flags: CGEventFlags) -> [String] {
  var items: [String] = []
  if flags.contains(.maskCommand) { items.append("command") }
  if flags.contains(.maskShift) { items.append("shift") }
  if flags.contains(.maskAlternate) { items.append("option") }
  if flags.contains(.maskControl) { items.append("control") }
  return items
}

func activeWindowTitle(appName: String) -> String {
  guard let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
    return ""
  }
  for window in windows {
    let owner = window[kCGWindowOwnerName as String] as? String ?? ""
    let layer = window[kCGWindowLayer as String] as? Int ?? 999
    if owner == appName && layer == 0 {
      return window[kCGWindowName as String] as? String ?? ""
    }
  }
  return ""
}

func emit(_ payload: [String: Any]) {
  if let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
     let line = String(data: data, encoding: .utf8) {
    print(line)
    fflush(stdout)
  }
}

let eventMask = CGEventMask(
  (1 << CGEventType.leftMouseDown.rawValue) |
  (1 << CGEventType.leftMouseUp.rawValue) |
  (1 << CGEventType.leftMouseDragged.rawValue) |
  (1 << CGEventType.scrollWheel.rawValue) |
  (1 << CGEventType.keyDown.rawValue)
)

guard let eventTap = CGEvent.tapCreate(
  tap: .cgSessionEventTap,
  place: .headInsertEventTap,
  options: .listenOnly,
  eventsOfInterest: eventMask,
  callback: { _, type, event, _ in
    let flags = flagsToArray(event.flags)
    let nsEvent = NSEvent(cgEvent: event)
    let keyCode = Int(event.getIntegerValueField(.keyboardEventKeycode))
    let emergencyStop = type == .keyDown && flags.contains("command") && flags.contains("option") && keyCode == 53

    if emergencyOnly && !emergencyStop {
      return Unmanaged.passUnretained(event)
    }

    let location = event.location
    let appName = NSWorkspace.shared.frontmostApplication?.localizedName ?? ""
    var payload: [String: Any] = [
      "type": eventTypeName(type),
      "timestamp": ISO8601DateFormatter().string(from: Date()),
      "x": Double(location.x),
      "y": Double(location.y),
      "flags": flags,
      "activeApp": appName,
      "activeWindowTitle": activeWindowTitle(appName: appName),
      "clickCount": Int(event.getIntegerValueField(.mouseEventClickState))
    ]

    if type == .keyDown {
      payload["keyCode"] = keyCode
      payload["key"] = nsEvent?.charactersIgnoringModifiers ?? ""
      payload["text"] = nsEvent?.characters ?? ""
    }

    if type == .scrollWheel {
      let pointDeltaY = Int(event.getIntegerValueField(.scrollWheelEventPointDeltaAxis1))
      let pointDeltaX = Int(event.getIntegerValueField(.scrollWheelEventPointDeltaAxis2))
      let lineDeltaY = Int(event.getIntegerValueField(.scrollWheelEventDeltaAxis1))
      let lineDeltaX = Int(event.getIntegerValueField(.scrollWheelEventDeltaAxis2))
      payload["deltaY"] = pointDeltaY != 0 ? pointDeltaY : lineDeltaY * 18
      payload["deltaX"] = pointDeltaX != 0 ? pointDeltaX : lineDeltaX * 18
      payload["lineDeltaY"] = lineDeltaY
      payload["lineDeltaX"] = lineDeltaX
    }

    if emergencyStop {
      payload["emergencyStop"] = true
    }

    emit(payload)
    if emergencyStop {
      exit(0)
    }
    return Unmanaged.passUnretained(event)
  },
  userInfo: nil
) else {
  emit([
    "type": "recorder_error",
    "timestamp": ISO8601DateFormatter().string(from: Date()),
    "message": "macOS event tap could not start. Grant Accessibility permission to the app running Argentum OS."
  ])
  exit(2)
}

let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: eventTap, enable: true)
emit([
  "type": "recorder_ready",
  "timestamp": ISO8601DateFormatter().string(from: Date()),
  "emergencyStopHotkey": "command+option+escape"
])
CFRunLoopRun()
`;
  }

  publicTeachSession(session = null) {
    const source = session || this.controlState().teach;
    if (!source) return null;
    const teachPlan = refreshTeachPlanCounts(source);
    return {
      id: source.id,
      name: source.name,
      app: source.app || "CapCut",
      version: source.version || 1,
      workflowId: source.workflowId || "",
      workflowInputs: source.workflowInputs || {},
      trainingInstructions: source.trainingInstructions || [],
      teachPlan,
      activePhaseId: source.activePhaseId || "",
      activePhase: teachPlan.find((phase) => phase.id === source.activePhaseId) || null,
      recording: Boolean(source.recording),
      status: source.status || (source.recording ? "recording" : "idle"),
      startedAt: source.startedAt || null,
      stoppedAt: source.stoppedAt || null,
      stopReason: source.stopReason || "",
      savedMacroId: source.savedMacroId || "",
      savedMacroPath: source.savedMacroPath || "",
      savedMacroBackupPath: source.savedMacroBackupPath || "",
      emergencyStopHotkey: source.emergencyStopHotkey || TEACH_EMERGENCY_HOTKEY,
      rawEventCount: Number(source.rawEventCount || 0),
      acceptedEventCount: Number(source.acceptedEventCount || 0),
      ignoredEventCount: Number(source.ignoredEventCount || 0),
      lastIgnoredReason: source.lastIgnoredReason || "",
      automationMode: source.automationMode || "capcut_window_relative",
      captureWindow: source.captureWindow || null,
      steps: source.steps || [],
      liveSnapshots: (source.liveSnapshots || []).slice(-24),
      lastSnapshotAt: source.lastSnapshotAt || null,
      recorderReady: Boolean(source.recorderReady),
      recorderMessages: (source.recorderMessages || []).slice(-8)
    };
  }

  publicReplayState(replay = null) {
    const source = replay || this.controlState().replay;
    if (!source) return null;
    const currentStepIndex = Number(source.currentStepIndex || 0);
    const sequence = Array.isArray(source.sequence) ? source.sequence : [];
    const activeSequenceIndex = sequence.findIndex((item) => {
      const startStep = Number(item.startStep || 0);
      const stepCount = Number(item.stepCount || 0);
      return startStep > 0 && stepCount > 0 && currentStepIndex >= startStep && currentStepIndex < startStep + stepCount;
    });
    const activeSequence = activeSequenceIndex >= 0 ? sequence[activeSequenceIndex] : null;
    const currentMacroStepIndex = activeSequence
      ? Math.max(1, currentStepIndex - Number(activeSequence.startStep || 1) + 1)
      : currentStepIndex;
    return {
      id: source.id,
      macroId: source.macroId,
      macroName: source.macroName,
      running: Boolean(source.running),
      status: source.status || "idle",
      cancelRequested: Boolean(source.cancelRequested),
      pauseRequested: Boolean(source.pauseRequested),
      paused: source.status === "paused" || Boolean(source.pauseRequested),
      sequence,
      activeMacroId: activeSequence?.macroId || source.activeMacroId || source.macroId || "",
      activeMacroName: activeSequence?.macroName || source.activeMacroName || source.macroName || "",
      currentMacroIndex: activeSequence ? activeSequenceIndex + 1 : Number(source.currentMacroIndex || (source.macroId ? 1 : 0)),
      currentMacroCount: sequence.length || Number(source.currentMacroCount || (source.macroId ? 1 : 0)),
      currentMacroStepIndex,
      currentMacroStepCount: Number(activeSequence?.stepCount || source.currentMacroStepCount || source.totalSteps || 0),
      currentStepIndex,
      totalSteps: Number(source.totalSteps || 0),
      currentStepDescription: source.currentStepDescription || "",
      currentStepType: source.currentStepType || "",
      currentStepStatus: source.currentStepStatus || "",
      failedStepIndex: Number(source.failedStepIndex || 0),
      failedStepDescription: source.failedStepDescription || "",
      failedStepError: source.failedStepError || "",
      startedAt: source.startedAt || null,
      pausedAt: source.pausedAt || null,
      resumedAt: source.resumedAt || null,
      finishedAt: source.finishedAt || null,
      stopReason: source.stopReason || "",
      gates: source.gates || [],
      warnings: source.warnings || [],
      humanGate: source.humanGate || null,
      resolutionSources: source.resolutionSources || {},
      waits: source.waits || null,
      runReportPath: source.runReportPath || "",
      log: (source.log || []).slice(-40)
    };
  }

  async listMacros() {
    const macros = await this.macroStorage.list();
    const control = this.controlState();
    const ordered = this.orderedMacros(macros);
    control.macroOrder = ordered.map((macro) => macro.id);
    return ordered.map((macro, index) => ({ ...macro, orderIndex: index }));
  }

  async readMacro(idOrName) {
    return this.macroStorage.read(idOrName);
  }

  orderedMacros(macros = []) {
    const control = this.controlState();
    const byId = new Map(macros.map((macro) => [macro.id, macro]));
    const order = Array.isArray(control.macroOrder) ? control.macroOrder : [];
    const ordered = order.map((id) => byId.get(id)).filter(Boolean);
    const known = new Set(ordered.map((macro) => macro.id));
    const missing = macros
      .filter((macro) => !known.has(macro.id))
      .sort((a, b) => String(a.createdAt || a.updatedAt || "").localeCompare(String(b.createdAt || b.updatedAt || "")));
    return [...ordered, ...missing];
  }

  async reorderMacros(ids = []) {
    const macros = await this.macroStorage.list();
    const knownIds = new Set(macros.map((macro) => macro.id));
    const requested = Array.isArray(ids) ? ids.map(cleanText).filter((id) => knownIds.has(id)) : [];
    const seen = new Set();
    const unique = requested.filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    const missing = this.orderedMacros(macros).map((macro) => macro.id).filter((id) => !seen.has(id));
    const control = this.controlState();
    control.macroOrder = [...unique, ...missing];
    await this.logAction("reorderCapCutMacros", "complete", { count: control.macroOrder.length });
    await this.helpers.saveState?.();
    return this.teachStatus();
  }

  async renameMacro(idOrName, nextName) {
    const macroName = normalizeMacroName(nextName);
    const macros = await this.macroStorage.list();
    const macroId = cleanText(idOrName);
    const info = macros.find((macro) => macro.id === macroId || macro.name === macroId || slugify(macro.name) === macroId);
    if (!info) throw Object.assign(new Error("CapCut macro not found."), { statusCode: 404 });
    const macro = JSON.parse(await fs.readFile(info.filePath, "utf8"));
    const previousName = macro.name || info.name;
    macro.name = macroName;
    macro.updatedAt = now();
    const { filePath, backupPath } = await this.macroStorage.save(macro);
    if (path.resolve(filePath) !== path.resolve(info.filePath)) await fs.rm(info.filePath, { force: true });
    const control = this.controlState();
    if (control.teach?.savedMacroId === macro.id || control.teach?.name === previousName) {
      control.teach.name = macroName;
      control.teach.savedMacroPath = filePath;
      control.teach.savedMacroBackupPath = backupPath || control.teach.savedMacroBackupPath || "";
    }
    if (control.replay?.macroId === macro.id || control.replay?.macroName === previousName) {
      control.replay.macroName = macroName;
    }
    for (const workflow of Object.values(control.workflows || {})) {
      if (workflow?.macroId === macro.id || workflow?.macroName === previousName) workflow.macroName = macroName;
    }
    await this.logAction("renameCapCutMacro", "complete", { macroId: macro.id, previousName, name: macroName, backupPath: backupPath || "" });
    await this.helpers.saveState?.();
    return this.teachStatus();
  }

  async deleteMacro(idOrName) {
    const deleted = await this.macroStorage.delete(idOrName);
    const control = this.controlState();
    control.macroOrder = (Array.isArray(control.macroOrder) ? control.macroOrder : []).filter((id) => id !== deleted.macro.id);
    if (control.teach?.savedMacroId === deleted.macro.id || control.teach?.name === deleted.macro.name) {
      control.teach = null;
    }
    if (control.replay?.macroId === deleted.macro.id || control.replay?.macroName === deleted.macro.name) {
      this.clearReplayAfterMacroEdit(control, "macro_deleted");
    }
    for (const [workflowId, workflow] of Object.entries(control.workflows || {})) {
      if (workflow?.macroId === deleted.macro.id || workflow?.macroName === deleted.macro.name) {
        delete control.workflows[workflowId];
      }
    }
    await this.logAction("deleteCapCutMacro", "complete", {
      macroId: deleted.macro.id,
      name: deleted.macro.name,
      backupPath: deleted.backupPath || ""
    });
    await this.helpers.saveState?.();
    return {
      ...deleted,
      teach: this.publicTeachSession(),
      macros: await this.listMacros(),
      workflows: (await this.workflowStatus()).workflows,
      replay: this.publicReplayState()
    };
  }

  async teachStatus() {
    const workflowStatus = await this.workflowStatus();
    return {
      teach: this.publicTeachSession(),
      macros: await this.listMacros(),
      workflows: workflowStatus.workflows,
      planner: workflowStatus.planner,
      replay: this.publicReplayState()
    };
  }

  async captureTeachSnapshot(reason = "manual") {
    const control = this.controlState();
    const session = control.teach;
    if (!session) throw Object.assign(new Error("No Teach Mode session is available for screenshots."), { statusCode: 404 });
    const safeReason = slugify(reason, "manual").slice(0, 32);
    const phase = currentTeachPhase(session);
    const screenshot = await this.takeMacroScreenshot(session, `teach_${safeReason}`);
    const snapshot = {
      id: screenshot.id,
      reason: cleanText(reason) || "manual",
      label: cleanText(phase?.label) || (session.recording ? "Teaching" : "Teach snapshot"),
      phaseId: cleanText(phase?.id),
      phaseLabel: cleanText(phase?.label),
      stepCount: Number(session.steps?.length || 0),
      screenshot,
      createdAt: now()
    };
    session.liveSnapshots ||= [];
    session.liveSnapshots.push(snapshot);
    session.liveSnapshots = session.liveSnapshots.slice(-24);
    session.lastSnapshotAt = snapshot.createdAt;
    session.updatedAt = now();
    if (safeReason !== "auto") {
      await this.logAction("captureTeachSnapshot", "complete", {
        sessionId: session.id,
        reason: snapshot.reason,
        target: screenshot.target || "",
        sizeBytes: screenshot.sizeBytes || 0
      });
    } else {
      await this.helpers.saveState?.();
    }
    return this.teachStatus();
  }

  async auditReport() {
    const controllerFunctions = [
      "openCapCut",
      "focusCapCut",
      "parkCapCut",
      "isCapCutInstalled",
      "isCapCutRunning",
      "getActiveApp",
      "takeScreenshot",
      "click",
      "doubleClick",
      "typeText",
      "pressKey",
      "hotkey",
      "drag",
      "wait"
    ];
    const recoveryFunctions = [
      "observeScreen",
      "findTextOnScreen",
      "findButton",
      "clickElement",
      "runMacroStep",
      "verifyStep",
      "updateMacroMemory",
      "saveCheckpoint",
      "stopWorkflow"
    ];
    const verificationFunctions = [
      "verifyCapCutOpen",
      "verifyTimelineHasMedia",
      "verifyCanvasIs916",
      "verifyBlurBackground",
      "verifyAutoReframeApplied",
      "verifyStickerBottomCenter",
      "verifyNoErrorDialog",
      "verifyProjectSaved"
    ];
    return {
      checkedAt: now(),
      moduleMap: {
        CapCutController: "CLIPPING OFFICE /services/capcut-controller.js",
        AutomationController: "CLIPPING OFFICE /services/capcut-controller.js",
        MacroRecorderTeachMode: "CapCutController Teach Mode methods",
        MacroPlayerReplay: "CapCutController replayMacro and executeMacroStep",
        MacroLibraryStorage: "CLIPPING OFFICE /services/capcut-macro-storage.js",
        CapCutWorkflowRunner: "CapCutController runWorkflow",
        CapCutAgentPlannerAIRecoveryAgent: "CapCutController observe/find/recover methods",
        PermissionChecking: "CapCutController permission checks",
        Logging: "capcutControl actions plus workflow run JSON logs",
        ScreenshotCheckpointSaving: "macro screenshots and workflow-runs/checkpoints",
        UiPanelState: "CLIPPING OFFICE /public/app.js"
      },
      controllerFunctions: Object.fromEntries(controllerFunctions.map((name) => [name, typeof this[name] === "function"])),
      recoveryFunctions: Object.fromEntries(recoveryFunctions.map((name) => [name, typeof this[name] === "function"])),
      verificationFunctions: Object.fromEntries(verificationFunctions.map((name) => [name, typeof this[name] === "function"])),
      macroDir: this.macroDir(),
      workflowRootDir: this.workflowRootDir(),
      workflow: CAPCUT_WORKFLOWS[VERTICAL_SHORT_WORKFLOW_ID],
      status: await this.status().catch((error) => ({ error: error.message }))
    };
  }

  async currentCapCutAutomationWindow() {
    const liveWindow = await this.capCutWindowInfo().catch(() => null);
    if (liveWindow) return normalizeWindowBounds(liveWindow);
    return normalizeWindowBounds(this.controlState().workspace?.bounds);
  }

  relativePointForWindow(x, y, window = null) {
    const bounds = normalizeWindowBounds(window);
    const px = Number(x);
    const py = Number(y);
    if (!bounds || !Number.isFinite(px) || !Number.isFinite(py)) return {};
    return {
      coordinateMode: "capcut_window",
      windowX: Math.round(px - bounds.x),
      windowY: Math.round(py - bounds.y),
      windowWidth: Math.round(bounds.width),
      windowHeight: Math.round(bounds.height),
      xRatio: Math.max(0, Math.min(1, (px - bounds.x) / bounds.width)),
      yRatio: Math.max(0, Math.min(1, (py - bounds.y) / bounds.height)),
      sourceWindow: bounds
    };
  }

  relativePointFields(prefix, x, y, window = null) {
    const relative = this.relativePointForWindow(x, y, window);
    if (!relative.coordinateMode) return {};
    if (!prefix) return relative;
    return {
      coordinateMode: relative.coordinateMode,
      sourceWindow: relative.sourceWindow,
      [`${prefix}WindowX`]: relative.windowX,
      [`${prefix}WindowY`]: relative.windowY,
      [`${prefix}XRatio`]: relative.xRatio,
      [`${prefix}YRatio`]: relative.yRatio,
      windowWidth: relative.windowWidth,
      windowHeight: relative.windowHeight
    };
  }

  async semanticTargetForRecordedPoint(x, y, window = null, screenshot = null, session = null) {
    const bounds = normalizeWindowBounds(window || screenshot?.window);
    if (!bounds) return null;
    const [accessibility, rawOcr] = await Promise.all([
      this.accessibilityElements().catch(() => []),
      screenshot?.filePath ? this.ocrScreenshot(screenshot.filePath).catch(() => []) : []
    ]);
    const ocr = normalizeOcrElementsForScreen(rawOcr, screenshot || {});
    const phase = currentTeachPhase(session);
    return semanticTargetFromPoint({
      x,
      y,
      window: bounds,
      elements: [...accessibility, ...ocr],
      phase
    });
  }

  shouldRecordCapCutKey(event = {}) {
    if (event.emergencyStop) return true;
    const activeApp = cleanText(event.activeApp).toLowerCase();
    return !activeApp || activeApp === "capcut";
  }

  shouldRecordCapCutMouse(event = {}, session = {}) {
    const window = normalizeWindowBounds(session.captureWindow);
    if (!window) return cleanText(event.activeApp).toLowerCase() === "capcut";
    return pointInsideWindow(event.x, event.y, window, 2);
  }

  async markIgnoredTeachEvent(session, reason) {
    session.ignoredEventCount = Number(session.ignoredEventCount || 0) + 1;
    session.lastIgnoredReason = cleanText(reason);
    session.updatedAt = now();
    if (session.ignoredEventCount % 10 === 1) await this.helpers.saveState?.();
  }

  resolvePointForReplay(step = {}, xField = "x", yField = "y", targetWindow = null) {
    const target = normalizeWindowBounds(targetWindow);
    const originalX = Number(step[xField]);
    const originalY = Number(step[yField]);
    if (!target || !Number.isFinite(originalX) || !Number.isFinite(originalY)) {
      return { x: originalX, y: originalY, resolved: false };
    }

    const prefix = xField === "fromX" ? "from" : xField === "toX" ? "to" : "";
    const ratioX = Number(step[prefix ? `${prefix}XRatio` : "xRatio"]);
    const ratioY = Number(step[prefix ? `${prefix}YRatio` : "yRatio"]);
    if (Number.isFinite(ratioX) && Number.isFinite(ratioY)) {
      return {
        x: target.x + (target.width * ratioX),
        y: target.y + (target.height * ratioY),
        resolved: true,
        source: "stored_ratio"
      };
    }

    const windowX = Number(step[prefix ? `${prefix}WindowX` : "windowX"]);
    const windowY = Number(step[prefix ? `${prefix}WindowY` : "windowY"]);
    const sourceWidth = Number(step.windowWidth);
    const sourceHeight = Number(step.windowHeight);
    if (Number.isFinite(windowX) && Number.isFinite(windowY)) {
      const scaledX = Number.isFinite(sourceWidth) && sourceWidth > 0 ? (windowX / sourceWidth) * target.width : windowX;
      const scaledY = Number.isFinite(sourceHeight) && sourceHeight > 0 ? (windowY / sourceHeight) * target.height : windowY;
      return {
        x: target.x + scaledX,
        y: target.y + scaledY,
        resolved: true,
        source: "stored_window_offset"
      };
    }

    const sourceWindow = sourceWindowFromStep(step);
    if (sourceWindow && pointInsideWindow(originalX, originalY, sourceWindow, 6)) {
      return {
        x: target.x + (((originalX - sourceWindow.x) / sourceWindow.width) * target.width),
        y: target.y + (((originalY - sourceWindow.y) / sourceWindow.height) * target.height),
        resolved: true,
        source: "legacy_screenshot_window"
      };
    }

    return { x: originalX, y: originalY, resolved: false };
  }

  async resolveSemanticPointForReplay(step = {}, targetWindow = null) {
    const target = normalizeWindowBounds(targetWindow);
    const semanticTarget = semanticTargetForReplayStep(step);
    if (!target || !semanticTarget || semanticTarget.disabled) return null;
    const label = cleanText(semanticTarget.label);
    if (!label) return null;
    const observation = await this.observeScreen().catch(() => null);
    if (!observation) return null;
    const candidates = semanticReplayCandidates(semanticTarget, observation, target);
    const best = candidates[0];
    if (!best?.center) return null;
    return {
      x: best.center.x,
      y: best.center.y,
      resolved: true,
      source: best.exactLabel ? "semantic_exact_label" : "semantic_label",
      label,
      region: semanticTarget.region || "",
      role: best.element?.role || "",
      elementSource: best.element?.source || ""
    };
  }

  /**
   * Visual anchor replay: re-find the exact pixels the operator clicked during
   * teaching by template-matching the stored screenshotBefore patch against a
   * fresh CapCut window capture. Survives panel scrolls, window resizes, and
   * most UI reshuffles. Returns screen coordinates or null.
   */
  async resolveAnchorPointForReplay(step = {}, targetWindow = null) {
    const target = normalizeWindowBounds(targetWindow);
    const referencePng = cleanText(step.screenshotBefore?.filePath);
    if (!target || !referencePng) return null;
    const sourceWindow = sourceWindowFromStep(step);
    const windowX = Number(step.windowX);
    const windowY = Number(step.windowY);
    const refPoint = Number.isFinite(windowX) && Number.isFinite(windowY)
      ? { x: windowX, y: windowY }
      : (sourceWindow && Number.isFinite(Number(step.x)) && Number.isFinite(Number(step.y))
        ? { x: Number(step.x) - sourceWindow.x, y: Number(step.y) - sourceWindow.y }
        : null);
    const refWidth = Number(step.windowWidth) || Number(sourceWindow?.width);
    const refHeight = Number(step.windowHeight) || Number(sourceWindow?.height);
    if (!refPoint || !Number.isFinite(refWidth) || !Number.isFinite(refHeight) || refWidth <= 0 || refHeight <= 0) {
      return null;
    }
    const tmpPath = path.join(os.tmpdir(), `capcut-anchor-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.png`);
    try {
      await fs.access(referencePng);
      await this.captureCapCutWindowScreenshot(tmpPath, { allowDesktopFallback: false });
      const match = await matchAnchor({
        referencePng,
        referencePoint: refPoint,
        referenceWindow: { width: refWidth, height: refHeight },
        currentPng: tmpPath,
        currentWindow: { width: target.width, height: target.height }
      });
      if (!match?.found) return null;
      return {
        x: target.x + match.x,
        y: target.y + match.y,
        resolved: true,
        source: "visual_anchor",
        confidence: match.confidence
      };
    } catch {
      return null;
    } finally {
      await fs.rm(tmpPath, { force: true }).catch(() => {});
    }
  }

  async resolveMacroStepCoordinates(step = {}) {
    if (!["click", "doubleClick", "drag", "scroll"].includes(step.type)) return step;
    const targetWindow = await this.currentCapCutAutomationWindow();
    if (!targetWindow) return step;
    if (["click", "doubleClick"].includes(step.type)) {
      // anchorUnreliable: the taught patch is content that changes every run
      // (e.g. the clip's own thumbnail) — a template match can only fail, so
      // go straight to semantic/ratio resolution (WI-4 compile pass marker).
      const anchorPoint = step.anchorUnreliable ? null : await this.resolveAnchorPointForReplay(step, targetWindow);
      if (anchorPoint) {
        return {
          ...step,
          x: anchorPoint.x,
          y: anchorPoint.y,
          resolvedCoordinates: true,
          resolvedCoordinateSource: anchorPoint.source,
          anchorConfidence: anchorPoint.confidence,
          resolvedTargetWindow: targetWindow
        };
      }
      const semanticPoint = await this.resolveSemanticPointForReplay(step, targetWindow);
      if (semanticPoint) {
        return {
          ...step,
          x: semanticPoint.x,
          y: semanticPoint.y,
          resolvedCoordinates: true,
          resolvedCoordinateSource: semanticPoint.source,
          resolvedSemanticTarget: semanticPoint,
          resolvedTargetWindow: targetWindow
        };
      }
    }
    if (step.type === "drag") {
      const from = this.resolvePointForReplay(step, "fromX", "fromY", targetWindow);
      const to = this.resolvePointForReplay(step, "toX", "toY", targetWindow);
      return {
        ...step,
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
        resolvedCoordinates: from.resolved || to.resolved,
        resolvedCoordinateSource: from.source || to.source || ""
      };
    }
    const point = this.resolvePointForReplay(step, "x", "y", targetWindow);
    return {
      ...step,
      x: point.x,
      y: point.y,
      resolvedCoordinates: point.resolved,
      resolvedCoordinateSource: point.source || ""
    };
  }

  appendWaitStep(session, eventTimestamp) {
    const lastTime = session.lastRecordedAt || session.startedAt;
    const delay = Math.round(stepTime(eventTimestamp) - stepTime(lastTime));
    if (session.steps.length && delay > 300) {
      const phase = currentTeachPhase(session);
      session.steps.push({
        type: "wait",
        timestamp: eventTimestamp || now(),
        ms: Math.min(delay, 30000),
        phaseId: phase?.id || "",
        phaseLabel: phase?.label || "",
        description: `Wait ${Math.min(delay, 30000)}ms`
      });
    }
  }

  async addRecordedStep(step) {
    const control = this.controlState();
    const session = control.teach;
    if (!session || !session.recording) return;
    this.appendWaitStep(session, step.timestamp);
    const phase = currentTeachPhase(session);
    const normalized = {
      timestamp: step.timestamp || now(),
      activeApp: cleanText(step.activeApp),
      activeWindowTitle: cleanText(step.activeWindowTitle),
      description: cleanText(step.description) || stepSummary(step),
      phaseId: cleanText(step.phaseId || phase?.id),
      phaseLabel: cleanText(step.phaseLabel || phase?.label),
      ...step
    };
    session.steps.push(normalized);
    session.lastRecordedAt = normalized.timestamp;
    session.acceptedEventCount = Number(session.acceptedEventCount || 0) + 1;
    session.updatedAt = now();
    refreshTeachPlanCounts(session);
    await this.helpers.saveState?.();
  }

  async recordMouseDown(event, session) {
    const captureWindow = normalizeWindowBounds(session.captureWindow) || await this.currentCapCutAutomationWindow();
    if (captureWindow) session.captureWindow = captureWindow;
    this.pendingMouse = {
      downAt: event.timestamp || now(),
      x: safeNumber(event.x),
      y: safeNumber(event.y),
      activeApp: cleanText(event.activeApp),
      activeWindowTitle: cleanText(event.activeWindowTitle),
      clickCount: Number(event.clickCount || 1),
      hadDrag: false,
      lastX: safeNumber(event.x),
      lastY: safeNumber(event.y),
      relative: this.relativePointForWindow(event.x, event.y, captureWindow),
      captureWindow,
      screenshotBefore: await this.takeMacroScreenshot(session, "before_mouse")
    };
  }

  recordMouseDrag(event) {
    if (!this.pendingMouse) return;
    this.pendingMouse.hadDrag = true;
    this.pendingMouse.lastX = safeNumber(event.x);
    this.pendingMouse.lastY = safeNumber(event.y);
  }

  async recordMouseUp(event, session) {
    const pending = this.pendingMouse || {
      downAt: event.timestamp || now(),
      x: safeNumber(event.x),
      y: safeNumber(event.y),
      activeApp: cleanText(event.activeApp),
      activeWindowTitle: cleanText(event.activeWindowTitle),
      clickCount: Number(event.clickCount || 1),
      hadDrag: false,
      screenshotBefore: await this.takeMacroScreenshot(session, "before_mouse")
    };
    this.pendingMouse = null;
    const toX = safeNumber(event.x);
    const toY = safeNumber(event.y);
    const captureWindow = normalizeWindowBounds(pending.captureWindow || session.captureWindow) || await this.currentCapCutAutomationWindow();
    if (captureWindow) session.captureWindow = captureWindow;
    const distance = Math.hypot(toX - pending.x, toY - pending.y);
    const screenshotAfter = await this.takeMacroScreenshot(session, "after_mouse");
    const common = {
      timestamp: event.timestamp || now(),
      activeApp: cleanText(event.activeApp) || pending.activeApp,
      activeWindowTitle: cleanText(event.activeWindowTitle) || pending.activeWindowTitle,
      coordinateMode: captureWindow ? "capcut_window" : "",
      sourceWindow: captureWindow || null,
      screenshotBefore: pending.screenshotBefore,
      screenshotAfter
    };
    if (pending.hadDrag || distance > 6) {
      await this.addRecordedStep({
        ...common,
        type: "drag",
        fromX: pending.x,
        fromY: pending.y,
        toX,
        toY,
        ...this.relativePointFields("from", pending.x, pending.y, captureWindow),
        ...this.relativePointFields("to", toX, toY, captureWindow),
        description: captureWindow
          ? `Drag inside CapCut from ${Math.round((pending.relative?.xRatio || 0) * 100)}% to ${Math.round((this.relativePointForWindow(toX, toY, captureWindow).xRatio || 0) * 100)}%`
          : `Drag from ${Math.round(pending.x)}, ${Math.round(pending.y)} to ${Math.round(toX)}, ${Math.round(toY)}`
      });
      return;
    }
    const clickCount = Number(event.clickCount || pending.clickCount || 1);
    const relative = this.relativePointForWindow(toX, toY, captureWindow);
    const semanticTarget = await this.semanticTargetForRecordedPoint(toX, toY, captureWindow, screenshotAfter, session).catch(() => null);
    const clickVerb = clickCount >= 2 ? "Double-click" : "Click";
    const step = {
      ...common,
      type: clickCount >= 2 ? "doubleClick" : "click",
      x: toX,
      y: toY,
      ...relative,
      semanticTarget,
      description: semanticTarget?.label
        ? `${clickVerb} ${semanticTarget.label}`
        : captureWindow
          ? `${clickVerb} inside CapCut at ${Math.round((relative.xRatio || 0) * 100)}%, ${Math.round((relative.yRatio || 0) * 100)}%`
          : `${clickVerb} at ${Math.round(toX)}, ${Math.round(toY)}`
    };
    if (step.type === "doubleClick") {
      const previous = session.steps[session.steps.length - 1];
      if (previous?.type === "click" && Math.hypot((previous.x || 0) - toX, (previous.y || 0) - toY) < 8) {
        session.steps.pop();
      }
    }
    await this.addRecordedStep(step);
  }

  async recordScroll(event, session) {
    const captureWindow = normalizeWindowBounds(session.captureWindow) || await this.currentCapCutAutomationWindow();
    if (captureWindow) session.captureWindow = captureWindow;
    const x = safeNumber(event.x);
    const y = safeNumber(event.y);
    const deltaX = Math.round(safeNumber(event.deltaX));
    const deltaY = Math.round(safeNumber(event.deltaY));
    if (!deltaX && !deltaY) return;
    const timestamp = event.timestamp || now();
    const relative = this.relativePointForWindow(x, y, captureWindow);
    const phase = currentTeachPhase(session);
    const previous = session.steps[session.steps.length - 1];
    const previousAgeMs = previous ? stepTime(timestamp) - stepTime(previous.timestamp) : Infinity;
    const sameScrollArea = previous?.type === "scroll"
      && previous.phaseId === (phase?.id || "")
      && previousAgeMs >= 0
      && previousAgeMs < 900
      && Math.abs(Number(previous.xRatio || 0) - Number(relative.xRatio || 0)) < 0.08
      && Math.abs(Number(previous.yRatio || 0) - Number(relative.yRatio || 0)) < 0.08;
    if (sameScrollArea) {
      previous.deltaX = Math.round(safeNumber(previous.deltaX) + deltaX);
      previous.deltaY = Math.round(safeNumber(previous.deltaY) + deltaY);
      previous.timestamp = timestamp;
      previous.description = stepSummary(previous);
      previous.screenshotAfter = await this.takeMacroScreenshot(session, "after_scroll");
      session.lastRecordedAt = timestamp;
      session.updatedAt = now();
      refreshTeachPlanCounts(session);
      await this.helpers.saveState?.();
      return;
    }
    await this.addRecordedStep({
      type: "scroll",
      timestamp,
      x,
      y,
      deltaX,
      deltaY,
      lineDeltaX: Math.round(safeNumber(event.lineDeltaX)),
      lineDeltaY: Math.round(safeNumber(event.lineDeltaY)),
      activeApp: cleanText(event.activeApp),
      activeWindowTitle: cleanText(event.activeWindowTitle),
      coordinateMode: captureWindow ? "capcut_window" : "",
      sourceWindow: captureWindow || null,
      ...relative,
      screenshotBefore: await this.takeMacroScreenshot(session, "before_scroll"),
      screenshotAfter: await this.takeMacroScreenshot(session, "after_scroll"),
      description: captureWindow
        ? `Scroll inside CapCut at ${Math.round((relative.xRatio || 0) * 100)}%, ${Math.round((relative.yRatio || 0) * 100)}%`
        : `Scroll at ${Math.round(x)}, ${Math.round(y)}`
    });
  }

  async recordKeyDown(event, session) {
    const flags = Array.isArray(event.flags) ? event.flags.map((item) => cleanText(item).toLowerCase()).filter(Boolean) : [];
    const key = eventKeyName(event);
    const timestamp = event.timestamp || now();
    const base = {
      timestamp,
      activeApp: cleanText(event.activeApp),
      activeWindowTitle: cleanText(event.activeWindowTitle),
      screenshotBefore: await this.takeMacroScreenshot(session, "before_key")
    };
    if (event.emergencyStop) {
      await this.stopTeachMode({ reason: "emergency_stop_hotkey" });
      return;
    }
    if (flags.some((flag) => ["command", "control", "option"].includes(flag)) && key) {
      await this.addRecordedStep({
        ...base,
        type: "hotkey",
        keys: Array.from(new Set([...flags, key])),
        screenshotAfter: await this.takeMacroScreenshot(session, "after_key"),
        description: `Hotkey ${Array.from(new Set([...flags, key])).join("+")}`
      });
      return;
    }
    const text = isPrintableText(event.text) ? String(event.text) : "";
    if (text) {
      const previous = session.steps[session.steps.length - 1];
      const previousAgeMs = previous ? stepTime(timestamp) - stepTime(previous.timestamp) : Infinity;
      if (previous?.type === "typeText" && previousAgeMs < 2000 && previous.activeWindowTitle === base.activeWindowTitle) {
        previous.text = `${previous.text || ""}${text}`;
        previous.description = `Type ${previous.text.length} characters`;
        previous.timestamp = timestamp;
        previous.screenshotAfter = await this.takeMacroScreenshot(session, "after_type");
        session.lastRecordedAt = timestamp;
        session.updatedAt = now();
        await this.helpers.saveState?.();
        return;
      }
      await this.addRecordedStep({
        ...base,
        type: "typeText",
        text,
        screenshotAfter: await this.takeMacroScreenshot(session, "after_type"),
        description: `Type ${text.length} character${text.length === 1 ? "" : "s"}`
      });
      return;
    }
    await this.addRecordedStep({
      ...base,
      type: "pressKey",
      key,
      screenshotAfter: await this.takeMacroScreenshot(session, "after_key"),
      description: `Press ${key}`
    });
  }

  async handleTeachEvent(event) {
    const control = this.controlState();
    const session = control.teach;
    if (!session) return;
    if (event.type === "recorder_ready") {
      session.recorderReady = true;
      session.recorderMessages ||= [];
      session.recorderMessages.push({ type: "ready", message: "Recorder ready", createdAt: now() });
      await this.helpers.saveState?.();
      return;
    }
    if (event.type === "recorder_error") {
      session.status = "error";
      session.recording = false;
      session.stopReason = cleanText(event.message) || "recorder_error";
      session.stoppedAt = now();
      session.recorderMessages ||= [];
      session.recorderMessages.push({ type: "error", message: session.stopReason, createdAt: now() });
      await this.logAction("teachCapCutWorkflow", "failed", { reason: session.stopReason });
      return;
    }
    if (!session.recording) return;
    session.rawEventCount = Number(session.rawEventCount || 0) + 1;
    if (event.type === "mouseDown") {
      if (!this.shouldRecordCapCutMouse(event, session)) {
        this.pendingMouse = null;
        await this.markIgnoredTeachEvent(session, "outside_capcut_window");
        return;
      }
      await this.recordMouseDown(event, session);
    }
    if (event.type === "mouseDragged") this.recordMouseDrag(event);
    if (event.type === "mouseUp") {
      if (!this.pendingMouse && !this.shouldRecordCapCutMouse(event, session)) {
        await this.markIgnoredTeachEvent(session, "outside_capcut_window");
        return;
      }
      await this.recordMouseUp(event, session);
    }
    if (event.type === "scroll") {
      if (!this.shouldRecordCapCutMouse(event, session)) {
        await this.markIgnoredTeachEvent(session, "outside_capcut_scroll");
        return;
      }
      await this.recordScroll(event, session);
    }
    if (event.type === "keyDown") {
      if (!this.shouldRecordCapCutKey(event)) {
        await this.markIgnoredTeachEvent(session, "non_capcut_key");
        return;
      }
      await this.recordKeyDown(event, session);
    }
  }

  /**
   * `swift -e` recompiles the recorder from source on every start — 3–15s of
   * dead air during which the operator's first clicks hit no event tap at
   * all. Compile once to a cached binary keyed by the source hash so every
   * later start is instant. Falls back to `swift -e` if swiftc is missing.
   */
  async compiledRecorderBinary({ emergencyOnly = false } = {}) {
    const source = this.swiftTeachRecorderCode({ emergencyOnly });
    const hash = crypto.createHash("sha256").update(source).digest("hex").slice(0, 12);
    const dir = path.join(this.macroDir(), "recorder-bin");
    const binPath = path.join(dir, `${emergencyOnly ? "capcut-emergency-listener" : "capcut-teach-recorder"}-${hash}`);
    if (await exists(binPath)) return binPath;
    if (!(await commandExists("/usr/bin/swiftc"))) return "";
    try {
      await fs.mkdir(dir, { recursive: true });
      const sourcePath = `${binPath}.swift`;
      await fs.writeFile(sourcePath, source, "utf8");
      await run("/usr/bin/swiftc", ["-O", "-o", binPath, sourcePath], { timeoutMs: 180000 });
      await this.logAction("compileTeachRecorder", "complete", { binPath, emergencyOnly });
      return binPath;
    } catch (error) {
      await this.logAction("compileTeachRecorder", "failed", { error: cleanText(error.message).slice(0, 300), emergencyOnly });
      return "";
    }
  }

  async spawnTeachRecorder() {
    if (!(await commandExists("/usr/bin/swift"))) {
      throw new Error("Teach Mode requires /usr/bin/swift on macOS.");
    }
    if (this.teachProcess) {
      // Detach before killing so the old child's close handler can't touch
      // the new session (it used to stamp fresh sessions recorder_exit_SIGTERM).
      const previous = this.teachProcess;
      this.teachProcess = null;
      previous.kill("SIGTERM");
    }
    this.teachBuffer = "";
    const binPath = await this.compiledRecorderBinary();
    const child = binPath
      ? spawn(binPath, [], { stdio: ["ignore", "pipe", "pipe"], env: process.env })
      : spawn("/usr/bin/swift", ["-e", this.swiftTeachRecorderCode()], {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env
      });
    this.teachProcess = child;
    const control = this.controlState();
    const session = control.teach;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      this.teachBuffer += chunk;
      const lines = this.teachBuffer.split(/\r?\n/);
      this.teachBuffer = lines.pop() || "";
      for (const line of lines) {
        const event = parseJsonLine(line);
        if (!event) continue;
        this.recordQueue = this.recordQueue
          .then(() => this.handleTeachEvent(event))
          .catch(async (error) => {
            const current = this.controlState().teach;
            if (current) {
              current.recorderMessages ||= [];
              current.recorderMessages.push({ type: "error", message: error.message, createdAt: now() });
              await this.helpers.saveState?.();
            }
          });
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      const current = this.controlState().teach;
      if (!current) return;
      current.recorderMessages ||= [];
      current.recorderMessages.push({ type: "stderr", message: cleanText(chunk).slice(0, 600), createdAt: now() });
      current.recorderMessages = current.recorderMessages.slice(-8);
      this.helpers.saveState?.();
    });

    child.on("close", (code, signal) => {
      // Only the ACTIVE recorder may mutate the session. A child that was
      // replaced or intentionally stopped closing late must never mark the
      // new session as failed — that raced every phase re-record into a
      // spurious recorder_exit_SIGTERM.
      if (this.teachProcess !== child) return;
      this.teachProcess = null;
      const current = this.controlState().teach;
      if (!current) return;
      if (current.recording) {
        current.recording = false;
        current.status = code === 0 ? "stopped" : "error";
        const lastStderr = (current.recorderMessages || []).filter((item) => item.type === "stderr").at(-1)?.message || "";
        current.stopReason = current.stopReason
          || (code === 0
            ? "recorder_stopped"
            : `recorder_exit_${code ?? signal ?? "unknown"}${lastStderr ? ` — ${lastStderr.slice(0, 160)}` : ""}`);
        current.stoppedAt = now();
        this.helpers.saveState?.();
      }
    });

    // Recording must not report "started" until the event tap is actually
    // live. Wait for the recorder_ready event; a blind 2.5s resolve used to
    // let the operator click into a recorder that did not exist yet.
    await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const readyTimeoutMs = binPath ? 10000 : 30000;
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearInterval(readyCheck);
        fn(value);
      };
      child.once("error", (error) => finish(reject, error));
      child.once("close", (code, signal) => {
        if (!session?.recorderReady) {
          const lastStderr = (session?.recorderMessages || []).filter((item) => item.type === "stderr").at(-1)?.message || "";
          finish(reject, new Error(`Teach recorder exited before it was ready (${code ?? signal ?? "unknown"}).${lastStderr ? ` ${lastStderr.slice(0, 200)}` : " Check Accessibility + Input Monitoring permissions for the app running the office."}`));
        }
      });
      const readyCheck = setInterval(() => {
        if (session?.recorderReady) return finish(resolve);
        if (Date.now() - startedAt > readyTimeoutMs) {
          if (this.teachProcess === child) this.teachProcess = null;
          child.kill("SIGTERM");
          finish(reject, new Error(`Teach recorder did not become ready within ${Math.round(readyTimeoutMs / 1000)}s. Check Accessibility + Input Monitoring permissions for the app running the office, then try again.`));
        }
      }, 100);
    });
  }

  async startTeachMode(name = "", options = {}) {
    const control = this.controlState();
    if (control.teach?.recording) {
      const error = new Error("Teach Mode is already recording.");
      error.statusCode = 409;
      throw error;
    }
    const status = await this.focusCapCut();
    if (!status.accessibilityPermission) throw Object.assign(new Error("Accessibility permission is required for Teach Mode."), { statusCode: 409 });
    if (!status.screenRecordingPermission) throw Object.assign(new Error("Screen Recording permission is required for Teach Mode screenshots."), { statusCode: 409 });
    let captureWindow = await this.currentCapCutAutomationWindow();
    if (!captureWindow) {
      await this.parkCapCut({ mode: options.workspaceMode || "compact" });
      await this.focusCapCut();
      captureWindow = await this.currentCapCutAutomationWindow();
    }
    if (!captureWindow) {
      throw Object.assign(new Error("CapCut needs one visible window before Teach Mode can record safely."), { statusCode: 409 });
    }
    // Teach against the pinned frame so replays can restore the same geometry.
    captureWindow = await this.normalizeCapCutWindow(
      options.appendToCurrent && control.teach?.captureWindow ? control.teach.captureWindow : null
    ) || captureWindow;
    if (options.appendToCurrent && control.teach && !control.teach.recording) {
      const session = control.teach;
      ensureTeachPlan(session);
      const requestedPhase = phaseDefinition(options.phaseId) || currentTeachPhase(session) || phaseDefinition("canvas_916");
      session.name = normalizeMacroName(name || session.name);
      session.captureWindow = captureWindow;
      session.automationMode = "capcut_window_relative";
      session.activePhaseId = requestedPhase?.id || "";
      if (requestedPhase) {
        const phase = session.teachPlan.find((item) => item.id === requestedPhase.id);
        if (phase) {
          phase.status = "recording";
          phase.startedAt ||= now();
          phase.completedAt = null;
          phase.skippedAt = null;
          phase.startStepIndex = (session.steps || []).length;
          phase.endStepIndex = null;
          phase.lastError = "";
        }
      }
      session.recording = true;
      session.status = "recording";
      session.stoppedAt = null;
      session.stopReason = "";
      session.recorderReady = false;
      session.recorderMessages = [];
      session.resumedAt = now();
      session.lastRecordedAt = session.lastRecordedAt || now();
      await this.helpers.saveState?.();
      try {
        await this.spawnTeachRecorder();
        await this.logAction("teachCapCutWorkflow", "recording", { sessionId: session.id, name: session.name, mode: "append" });
        return this.teachStatus();
      } catch (error) {
        session.recording = false;
        session.status = "error";
        session.stopReason = error.message;
        session.stoppedAt = now();
        await this.logAction("teachCapCutWorkflow", "failed", { sessionId: session.id, error: error.message, mode: "append" });
        throw error;
      }
    }
    const session = {
      id: this.helpers.newId ? this.helpers.newId("capcut_teach") : `capcut_teach_${Date.now()}`,
      name: normalizeMacroName(name),
      app: "CapCut",
      version: 1,
      workflowId: cleanText(options.workflowId),
      workflowInputs: workflowInputsFrom(options.workflowInputs || {}),
      workflowDefinition: options.workflowDefinition || null,
      trainingInstructions: options.trainingInstructions || [],
      automationMode: "capcut_window_relative",
      captureWindow,
      recording: true,
      status: "recording",
      startedAt: now(),
      stoppedAt: null,
      stopReason: "",
      steps: [],
      rawEventCount: 0,
      acceptedEventCount: 0,
      ignoredEventCount: 0,
      lastIgnoredReason: "",
      recorderReady: false,
      recorderMessages: [],
      emergencyStopHotkey: TEACH_EMERGENCY_HOTKEY
    };
    session.teachPlan = defaultTeachPlan();
    session.activePhaseId = cleanText(options.phaseId) || session.teachPlan.find((phase) => phase.mode === "record")?.id || "";
    const activePhase = session.teachPlan.find((phase) => phase.id === session.activePhaseId);
    if (activePhase) {
      activePhase.status = "recording";
      activePhase.startedAt = now();
      activePhase.startStepIndex = 0;
    }
    control.teach = session;
    await this.helpers.saveState?.();
    try {
      await this.spawnTeachRecorder();
      await this.logAction("teachCapCutWorkflow", "recording", { sessionId: session.id, name: session.name });
      return this.teachStatus();
    } catch (error) {
      session.recording = false;
      session.status = "error";
      session.stopReason = error.message;
      session.stoppedAt = now();
      await this.logAction("teachCapCutWorkflow", "failed", { sessionId: session.id, error: error.message });
      throw error;
    }
  }

  async stopTeachMode({ reason = "operator_stop" } = {}) {
    const control = this.controlState();
    const session = control.teach;
    if (!session) return this.teachStatus();
    session.recording = false;
    session.status = "stopped";
    session.stopReason = cleanText(reason);
    session.stoppedAt = now();
    const phase = currentTeachPhase(session);
    if (phase?.status === "recording") {
      phase.status = phase.stepCount || (session.steps || []).some((step) => step.phaseId === phase.id) ? "draft" : "pending";
      phase.endStepIndex = (session.steps || []).length ? (session.steps || []).length - 1 : null;
    }
    refreshTeachPlanCounts(session);
    if (this.teachProcess) {
      this.teachProcess.kill("SIGTERM");
      this.teachProcess = null;
    }
    await this.logAction("teachCapCutWorkflow", "stopped", { sessionId: session.id, steps: session.steps?.length || 0, reason });
    await this.helpers.saveState?.();
    return this.teachStatus();
  }

  async cancelTeachMode() {
    const control = this.controlState();
    const sessionId = control.teach?.id || "";
    if (this.teachProcess) {
      this.teachProcess.kill("SIGTERM");
      this.teachProcess = null;
    }
    control.teach = null;
    await this.logAction("teachCapCutWorkflow", "cancelled", { sessionId });
    await this.helpers.saveState?.();
    return this.teachStatus();
  }

  async startTeachPhase(phaseId, inputs = {}) {
    const phase = phaseDefinition(phaseId);
    if (!phase) throw Object.assign(new Error(`Unknown Teach phase: ${phaseId}`), { statusCode: 404 });
    if (phase.mode === "system") throw Object.assign(new Error(`${phase.label} is not a recordable Teach phase.`), { statusCode: 422 });
    const control = this.controlState();
    if (control.teach?.recording) throw Object.assign(new Error("Finish the current phase before starting another one."), { statusCode: 409 });
    const session = control.teach || null;
    if (session) {
      ensureTeachPlan(session);
      session.activePhaseId = phase.id;
    }
    return this.startTeachMode(inputs.name || session?.name || VERTICAL_SHORT_WORKFLOW_ID, {
      appendToCurrent: Boolean(session),
      phaseId: phase.id,
      workflowId: inputs.workflowId || session?.workflowId || VERTICAL_SHORT_WORKFLOW_ID,
      workflowInputs: workflowInputsFrom({ ...(session?.workflowInputs || {}), ...(inputs || {}) })
    });
  }

  async completeTeachPhase(phaseId) {
    const control = this.controlState();
    let session = control.teach;
    if (!session) throw Object.assign(new Error("No Teach Mode session is loaded."), { statusCode: 404 });
    const phase = phaseDefinition(phaseId || session.activePhaseId);
    if (!phase) throw Object.assign(new Error(`Unknown Teach phase: ${phaseId}`), { statusCode: 404 });
    if (session.recording) {
      if (session.activePhaseId && session.activePhaseId !== phase.id) {
        throw Object.assign(new Error(`Finish ${currentTeachPhase(session)?.label || "the active phase"} before completing ${phase.label}.`), { statusCode: 409 });
      }
      await this.stopTeachMode({ reason: `phase_${phase.id}_complete` });
      session = control.teach;
    }
    const plan = ensureTeachPlan(session);
    const item = plan.find((entry) => entry.id === phase.id);
    const indexes = (session.steps || [])
      .map((step, index) => step?.phaseId === phase.id ? index : -1)
      .filter((index) => index >= 0);
    if (phase.required && phase.mode === "record" && !indexes.length) {
      throw Object.assign(new Error(`${phase.label} has no recorded actions yet. Record that phase first or re-record it.`), { statusCode: 422 });
    }
    if (item) {
      item.status = "complete";
      item.startedAt ||= now();
      item.completedAt = now();
      item.skippedAt = null;
      item.stepCount = indexes.length;
      item.startStepIndex = indexes.length ? indexes[0] : null;
      item.endStepIndex = indexes.length ? indexes[indexes.length - 1] : null;
      item.lastError = "";
    }
    const next = plan.find((entry) => entry.mode === "record" && !["complete", "skipped"].includes(entry.status));
    session.activePhaseId = next?.id || "";
    session.status = "editing";
    session.updatedAt = now();
    refreshTeachPlanCounts(session);
    this.clearReplayAfterMacroEdit(control, `completed_phase_${phase.id}`);
    await this.logAction("completeTeachPhase", "complete", { sessionId: session.id, phaseId: phase.id, steps: indexes.length });
    await this.helpers.saveState?.();
    return this.teachStatus();
  }

  async skipTeachPhase(phaseId) {
    const control = this.controlState();
    const session = control.teach;
    if (!session) throw Object.assign(new Error("No Teach Mode session is loaded."), { statusCode: 404 });
    if (session.recording) throw Object.assign(new Error("Finish or stop recording before skipping a phase."), { statusCode: 409 });
    const phase = phaseDefinition(phaseId);
    if (!phase) throw Object.assign(new Error(`Unknown Teach phase: ${phaseId}`), { statusCode: 404 });
    if (phase.required) throw Object.assign(new Error(`${phase.label} is required and cannot be skipped.`), { statusCode: 422 });
    const plan = ensureTeachPlan(session);
    const item = plan.find((entry) => entry.id === phase.id);
    if (item) {
      item.status = "skipped";
      item.skippedAt = now();
      item.completedAt = null;
      item.lastError = "";
    }
    const next = plan.find((entry) => entry.mode === "record" && !["complete", "skipped"].includes(entry.status));
    session.activePhaseId = next?.id || "";
    session.status = "editing";
    session.updatedAt = now();
    this.clearReplayAfterMacroEdit(control, `skipped_phase_${phase.id}`);
    await this.logAction("skipTeachPhase", "complete", { sessionId: session.id, phaseId: phase.id });
    await this.helpers.saveState?.();
    return this.teachStatus();
  }

  async retryTeachPhase(phaseId, inputs = {}) {
    const control = this.controlState();
    const session = control.teach;
    if (!session) throw Object.assign(new Error("No Teach Mode session is loaded."), { statusCode: 404 });
    if (session.recording) throw Object.assign(new Error("Stop the current recording before re-recording a phase."), { statusCode: 409 });
    const phase = phaseDefinition(phaseId);
    if (!phase) throw Object.assign(new Error(`Unknown Teach phase: ${phaseId}`), { statusCode: 404 });
    ensureTeachPlan(session);
    const before = (session.steps || []).length;
    session.steps = (session.steps || []).filter((step) => step?.phaseId !== phase.id);
    const item = session.teachPlan.find((entry) => entry.id === phase.id);
    if (item) {
      item.status = "pending";
      item.startedAt = null;
      item.completedAt = null;
      item.skippedAt = null;
      item.startStepIndex = null;
      item.endStepIndex = null;
      item.stepCount = 0;
      item.lastError = "";
    }
    session.activePhaseId = phase.id;
    session.status = "editing";
    session.updatedAt = now();
    session.acceptedEventCount = session.steps.length;
    refreshTeachPlanCounts(session);
    this.clearReplayAfterMacroEdit(control, `retry_phase_${phase.id}`);
    await this.logAction("retryTeachPhase", "ready", { sessionId: session.id, phaseId: phase.id, removed: before - session.steps.length });
    await this.helpers.saveState?.();
    if (phase.mode === "system") throw Object.assign(new Error(`${phase.label} is not a recordable Teach phase.`), { statusCode: 422 });
    return this.startTeachPhase(phase.id, { ...(session.workflowInputs || {}), ...(inputs || {}), name: session.name });
  }

  async loadMacroForEditing(idOrName) {
    const macro = await this.readMacro(idOrName);
    const macros = await this.listMacros();
    const info = macros.find((item) => item.id === macro.id || item.name === macro.name) || {};
    const control = this.controlState();
    if (control.teach?.recording) await this.stopTeachMode({ reason: "load_macro_for_edit" });
    const steps = Array.isArray(macro.steps) ? macro.steps.map((step) => ({ ...step })) : [];
    const session = {
      id: this.helpers.newId ? this.helpers.newId("capcut_teach_edit") : `capcut_teach_edit_${Date.now()}`,
      name: normalizeMacroName(macro.name),
      app: macro.app || "CapCut",
      version: Number(macro.version || 1),
      workflowId: cleanText(macro.workflowId),
      workflowInputs: workflowInputsFrom(macro.workflowInputs || {}),
      workflowDefinition: macro.workflowId ? CAPCUT_WORKFLOWS[macro.workflowId] || null : null,
      trainingInstructions: macro.workflowId && CAPCUT_WORKFLOWS[macro.workflowId]
        ? interpolateValue(CAPCUT_WORKFLOWS[macro.workflowId].trainingInstructions, macro.workflowInputs || {})
        : [],
      automationMode: macro.automationMode || "capcut_window_relative",
      captureWindow: macro.captureWindow || null,
      recording: false,
      status: "editing",
      startedAt: macro.createdAt || now(),
      stoppedAt: now(),
      stopReason: "macro_loaded_for_edit",
      steps,
      rawEventCount: steps.length,
      acceptedEventCount: steps.length,
      ignoredEventCount: 0,
      lastIgnoredReason: "",
      recorderReady: false,
      recorderMessages: [],
      emergencyStopHotkey: macro.emergencyStopHotkey || TEACH_EMERGENCY_HOTKEY,
      savedMacroId: macro.id,
      savedMacroPath: info.filePath || ""
    };
    session.teachPlan = Array.isArray(macro.teachPlan) ? macro.teachPlan : defaultTeachPlan();
    refreshTeachPlanCounts(session);
    control.teach = session;
    this.clearReplayAfterMacroEdit(control, "macro_loaded_for_edit");
    await this.logAction("editCapCutMacro", "loaded", { macroId: macro.id, name: macro.name, steps: steps.length });
    await this.helpers.saveState?.();
    return this.teachStatus();
  }

  async deleteTeachStep(index) {
    const control = this.controlState();
    const session = control.teach;
    if (!session) throw Object.assign(new Error("No macro is loaded in Teach Mode."), { statusCode: 404 });
    if (session.recording) throw Object.assign(new Error("Stop recording before editing macro steps."), { statusCode: 409 });
    const stepIndex = Number(index);
    if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= (session.steps || []).length) {
      throw Object.assign(new Error("Macro step index is out of range."), { statusCode: 400 });
    }
    const [removed] = session.steps.splice(stepIndex, 1);
    session.status = "editing";
    session.updatedAt = now();
    session.acceptedEventCount = session.steps.length;
    this.clearReplayAfterMacroEdit(control, `deleted_step_${stepIndex + 1}`);
    await this.logAction("editCapCutMacroStep", "deleted", { sessionId: session.id, index: stepIndex, type: removed?.type || "" });
    await this.helpers.saveState?.();
    return this.teachStatus();
  }

  async trimTeachStepsFrom(index) {
    const control = this.controlState();
    const session = control.teach;
    if (!session) throw Object.assign(new Error("No macro is loaded in Teach Mode."), { statusCode: 404 });
    if (session.recording) throw Object.assign(new Error("Stop recording before editing macro steps."), { statusCode: 409 });
    const stepIndex = Number(index);
    if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= (session.steps || []).length) {
      throw Object.assign(new Error("Macro step index is out of range."), { statusCode: 400 });
    }
    const removed = session.steps.splice(stepIndex);
    session.status = "editing";
    session.updatedAt = now();
    session.acceptedEventCount = session.steps.length;
    session.stopReason = `trimmed_from_step_${stepIndex + 1}`;
    this.clearReplayAfterMacroEdit(control, session.stopReason);
    await this.logAction("editCapCutMacroStep", "trimmed", { sessionId: session.id, fromIndex: stepIndex, removed: removed.length });
    await this.helpers.saveState?.();
    return this.teachStatus();
  }

  async setTeachStepTarget(index, label) {
    const control = this.controlState();
    const session = control.teach;
    if (!session) throw Object.assign(new Error("No macro is loaded in Teach Mode."), { statusCode: 404 });
    if (session.recording) throw Object.assign(new Error("Stop recording before editing macro steps."), { statusCode: 409 });
    const stepIndex = Math.max(0, Math.min(session.steps.length - 1, Number(index)));
    const step = session.steps[stepIndex];
    if (!step) throw Object.assign(new Error("Macro step was not found."), { statusCode: 404 });
    if (!["click", "doubleClick"].includes(step.type)) {
      throw Object.assign(new Error("Only click steps can use a semantic target label."), { statusCode: 422 });
    }
    const targetLabel = cleanText(label);
    if (!targetLabel) throw Object.assign(new Error("Target label is required."), { statusCode: 400 });
    const verb = step.type === "doubleClick" ? "Double-click" : "Click";
    step.semanticTarget = {
      ...(step.semanticTarget || {}),
      version: 1,
      strategy: "operator_label_then_region",
      kind: step.semanticTarget?.kind || "control",
      label: targetLabel,
      region: step.semanticTarget?.region || capCutRegionFromRatio(step.xRatio, step.yRatio),
      confidence: "operator"
    };
    step.description = `${verb} ${targetLabel}`;
    session.updatedAt = now();
    this.clearReplayAfterMacroEdit(control, `target_label_step_${stepIndex + 1}`);
    await this.logAction("editCapCutMacroStep", "target_set", { sessionId: session.id, index: stepIndex, label: targetLabel });
    await this.helpers.saveState?.();
    return this.teachStatus();
  }

  async updateTeachStepWait(index, ms) {
    const control = this.controlState();
    const session = control.teach;
    if (!session) throw Object.assign(new Error("No macro is loaded in Teach Mode."), { statusCode: 404 });
    if (session.recording) throw Object.assign(new Error("Stop recording before editing macro steps."), { statusCode: 409 });
    const stepIndex = Number(index);
    if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= (session.steps || []).length) {
      throw Object.assign(new Error("Macro step index is out of range."), { statusCode: 400 });
    }
    const step = session.steps[stepIndex];
    if (!step) throw Object.assign(new Error("Macro step was not found."), { statusCode: 404 });
    if (step.type !== "wait") {
      throw Object.assign(new Error("Only wait steps can edit milliseconds."), { statusCode: 422 });
    }
    const waitMs = clampWait(ms);
    step.ms = waitMs;
    step.description = `Wait ${waitMs}ms`;
    session.status = "editing";
    session.updatedAt = now();
    this.clearReplayAfterMacroEdit(control, `wait_ms_step_${stepIndex + 1}`);
    await this.logAction("editCapCutMacroStep", "wait_updated", { sessionId: session.id, index: stepIndex, ms: waitMs });
    await this.helpers.saveState?.();
    return this.teachStatus();
  }

  async saveTeachMacro(name = "", options = {}) {
    const control = this.controlState();
    const session = control.teach;
    if (!session) throw Object.assign(new Error("No Teach Mode recording is available to save."), { statusCode: 404 });
    if (session.recording) await this.stopTeachMode({ reason: "save_macro" });
    const macroName = normalizeMacroName(name || session.name);
    const workflowId = cleanText(options.workflowId || session.workflowId);
    const workflowInputs = workflowInputsFrom(options.workflowInputs || session.workflowInputs || {});
    const rawSteps = (session.steps || []).map((step, index) => ({
      index,
      type: step.type,
      timestamp: step.timestamp || "",
      x: step.x,
      y: step.y,
      fromX: step.fromX,
      fromY: step.fromY,
      toX: step.toX,
      toY: step.toY,
      keys: step.keys,
      key: step.key,
      text: step.text,
      ms: step.type === "wait" ? clampWait(step.ms) : step.ms,
      deltaX: step.deltaX,
      deltaY: step.deltaY,
      lineDeltaX: step.lineDeltaX,
      lineDeltaY: step.lineDeltaY,
      sourceVideoPath: step.sourceVideoPath,
      phaseId: step.phaseId || "",
      phaseLabel: step.phaseLabel || "",
      coordinateMode: step.coordinateMode || "",
      sourceWindow: step.sourceWindow || null,
      windowX: step.windowX,
      windowY: step.windowY,
      windowWidth: step.windowWidth,
      windowHeight: step.windowHeight,
      xRatio: step.xRatio,
      yRatio: step.yRatio,
      fromWindowX: step.fromWindowX,
      fromWindowY: step.fromWindowY,
      fromXRatio: step.fromXRatio,
      fromYRatio: step.fromYRatio,
      toWindowX: step.toWindowX,
      toWindowY: step.toWindowY,
      toXRatio: step.toXRatio,
      toYRatio: step.toYRatio,
      activeApp: step.activeApp || "",
      activeWindowTitle: step.activeWindowTitle || "",
      screenshotBefore: step.screenshotBefore || null,
      screenshotAfter: step.screenshotAfter || null,
      semanticTarget: step.semanticTarget || null,
      description: step.description || stepSummary(step)
    }));
    const macroSteps = workflowId ? placeholderizeValue(rawSteps, workflowInputs) : rawSteps;
    const macro = {
      id: session.savedMacroId || (this.helpers.newId ? this.helpers.newId("capcut_macro") : `capcut_macro_${Date.now()}`),
      name: macroName,
      app: "CapCut",
      platform: "macOS",
      version: 1,
      automationMode: session.automationMode || "capcut_window_relative",
      captureWindow: session.captureWindow || null,
      taughtWindowFrame: normalizeWindowBounds(session.captureWindow) || null,
      workflowId,
      inputs: workflowId && CAPCUT_WORKFLOWS[workflowId]
        ? { ...CAPCUT_WORKFLOWS[workflowId].placeholders }
        : {
          sourceVideoPath: "{{sourceVideoPath}}",
          stickerPath: "{{stickerPath}}",
          projectName: "{{projectName}}",
          outputProjectFolder: "{{outputProjectFolder}}"
        },
      workflowInputs,
      placeholders: workflowId && CAPCUT_WORKFLOWS[workflowId] ? CAPCUT_WORKFLOWS[workflowId].placeholders : {},
      createdAt: session.startedAt || now(),
      updatedAt: now(),
      sourceTeachSessionId: session.id,
      emergencyStopHotkey: TEACH_EMERGENCY_HOTKEY,
      teachPlan: refreshTeachPlanCounts(session),
      teachingSnapshots: (session.liveSnapshots || []).slice(-24),
      steps: macroSteps
    };
    const { macro: compiledMacro, changes: compileChanges } = compileMacroForDeterminism(macro);
    const { filePath, backupPath } = await this.macroStorage.save(compiledMacro);
    if (compileChanges.length) {
      await this.logAction("compileCapCutMacro", "complete", { macroId: macro.id, changes: compileChanges.length });
    }
    session.savedMacroId = macro.id;
    session.savedMacroPath = filePath;
    session.savedMacroBackupPath = backupPath || "";
    session.workflowId = workflowId || session.workflowId || "";
    session.status = "saved";
    if (workflowId) {
      control.workflows ||= {};
      control.workflows[workflowId] = {
        workflowId,
        macroId: macro.id,
        macroName: macro.name,
        macroPath: filePath,
        backupPath: backupPath || "",
        updatedAt: macro.updatedAt,
        stepCount: macro.steps.length
      };
    }
    await this.logAction("saveCapCutMacro", "complete", { macroId: macro.id, name: macro.name, steps: macro.steps.length, filePath, backupPath: backupPath || "" });
    await this.helpers.saveState?.();
    return {
      macro: {
        id: macro.id,
        name: macro.name,
        workflowId: macro.workflowId,
        app: macro.app,
        version: macro.version,
        stepCount: macro.steps.length,
        createdAt: macro.createdAt,
        updatedAt: macro.updatedAt,
        filePath,
        backupPath: backupPath || ""
      },
      teach: this.publicTeachSession(session),
      macros: await this.listMacros()
    };
  }

  workflowDefinition(workflowId) {
    const id = cleanText(workflowId || VERTICAL_SHORT_WORKFLOW_ID);
    const workflow = CAPCUT_WORKFLOWS[id];
    if (!workflow) {
      const error = new Error(`Unknown CapCut workflow: ${workflowId}`);
      error.statusCode = 404;
      throw error;
    }
    return workflow;
  }

  async latestWorkflowMacro(workflowId) {
    const control = this.controlState();
    const pinned = control.workflows?.[workflowId]?.macroId;
    const macros = await this.listMacros();
    if (pinned) {
      const found = macros.find((macro) => macro.id === pinned);
      if (found) return this.readMacro(found.id);
    }
    const found = macros.find((macro) => macro.workflowId === workflowId || macro.name === workflowId);
    return found ? this.readMacro(found.id) : null;
  }

  async workflowStatus() {
    const control = this.controlState();
    const macros = await this.listMacros();
    return {
      plannerInstruction: CAPCUT_AGENT_PLANNER_INSTRUCTION,
      workflows: Object.values(CAPCUT_WORKFLOWS).map((workflow) => {
        const savedState = control.workflows?.[workflow.id] || null;
        const saved = savedState?.macroId ? savedState : null;
        const trained = saved
          || macros.find((macro) => macro.workflowId === workflow.id || macro.name === workflow.name)
          || null;
        return {
          ...workflow,
          trainedMacro: trained ? {
            id: trained.macroId || trained.id,
            name: trained.macroName || trained.name,
            stepCount: trained.stepCount || 0,
            updatedAt: trained.updatedAt || ""
          } : null,
          lastRun: control.workflows?.[workflow.id]?.lastRun || null
        };
      }),
      replay: this.publicReplayState(),
      planner: control.planner || null
    };
  }

  async startWorkflowTraining(workflowId, inputs = {}) {
    const workflow = this.workflowDefinition(workflowId);
    const workflowInputs = await validateWorkflowInputs(workflow, inputs);
    const control = this.controlState();
    control.workflows ||= {};
    control.workflows[workflow.id] ||= { workflowId: workflow.id };
    control.workflows[workflow.id].trainingInputs = workflowInputs;
    control.workflows[workflow.id].trainingStartedAt = now();
    const trainingInstructions = interpolateValue(workflow.trainingInstructions, workflowInputs);
    return this.startTeachMode(workflow.name, {
      workflowId: workflow.id,
      workflowInputs,
      workflowDefinition: workflow,
      trainingInstructions
    });
  }

  async saveWorkflowMacro(workflowId, inputs = {}) {
    const workflow = this.workflowDefinition(workflowId);
    const workflowInputs = await validateWorkflowInputs(workflow, inputs);
    return this.saveTeachMacro(workflow.name, { workflowId: workflow.id, workflowInputs });
  }

  appendWorkflowRunLog(run, label, status = "complete", details = {}) {
    run.logs ||= [];
    const screenshotPath = details.screenshotPath
      || details.screenshot?.filePath
      || details.observation?.screenshot?.filePath
      || "";
    const entry = {
      timestamp: now(),
      runId: run.id || "",
      workflowName: run.workflowName || "",
      stepId: cleanText(details.stepId || details.stepName || slugify(label, "step")),
      action: cleanText(details.action || details.type || label),
      description: cleanText(label),
      label,
      status,
      errorMessage: cleanText(details.error || details.errorMessage || ""),
      screenshotPath,
      details: safeDetails(details),
      createdAt: now()
    };
    run.logs.push(entry);
    run.logs = run.logs.slice(-100);
    return entry;
  }

  async captureWorkflowCheckpoint(run, checkpoint) {
    const shot = await this.takeWorkflowScreenshot(run, checkpoint.id);
    run.checkpoints ||= [];
    const entry = {
      id: checkpoint.id,
      label: checkpoint.label,
      screenshot: shot,
      createdAt: now()
    };
    run.checkpoints.push(entry);
    this.appendWorkflowRunLog(run, `Checkpoint: ${checkpoint.label}`, shot.sizeBytes ? "complete" : "warning", {
      stepId: checkpoint.id,
      action: "checkpoint",
      screenshot: shot,
      errorMessage: shot.error || ""
    });
    return entry;
  }

  async capCutUiText() {
    try {
      return await runAppleScript([
        'tell application "System Events"',
        'if not (exists process "CapCut") then return ""',
        'tell process "CapCut"',
        'set outputText to ""',
        'try',
        'set outputText to outputText & ((name of every window) as string)',
        'end try',
        'try',
        'set outputText to outputText & " " & ((value of every static text of every window) as string)',
        'end try',
        'try',
        'set outputText to outputText & " " & ((name of every button of every window) as string)',
        'end try',
        'return outputText',
        "end tell",
        "end tell"
      ], { timeoutMs: 6000, maxBuffer: 1024 * 1024 * 2 });
    } catch {
      return "";
    }
  }

  async accessibilityElements() {
    try {
      const output = await runAppleScript([
        'tell application "System Events"',
        'if not (exists process "CapCut") then return ""',
        'tell process "CapCut"',
        'set outputRows to {}',
        'set seenCount to 0',
        'repeat with w in windows',
        'try',
        'set uiItems to entire contents of w',
        'repeat with e in uiItems',
        'if seenCount > 450 then exit repeat',
        'set itemRole to ""',
        'set itemName to ""',
        'set itemValue to ""',
        'set itemDescription to ""',
        'set itemPosition to ""',
        'set itemSize to ""',
        'try',
        'set itemRole to role of e as text',
        'end try',
        'try',
        'set itemName to name of e as text',
        'end try',
        'try',
        'set itemValue to value of e as text',
        'end try',
        'try',
        'set itemDescription to description of e as text',
        'end try',
        'try',
        'set itemPosition to (position of e as text)',
        'end try',
        'try',
        'set itemSize to (size of e as text)',
        'end try',
        'if itemName is not "" or itemValue is not "" or itemDescription is not "" then',
        'set end of outputRows to itemRole & tab & itemName & tab & itemValue & tab & itemDescription & tab & itemPosition & tab & itemSize',
        'set seenCount to seenCount + 1',
        'end if',
        'end repeat',
        'end try',
        'end repeat',
        "set AppleScript's text item delimiters to linefeed",
        'return outputRows as text',
        "end tell",
        "end tell"
      ], { timeoutMs: 9000, maxBuffer: 1024 * 1024 * 3 });
      return output.split(/\r?\n/)
        .map((line) => line.split("\t"))
        .filter((parts) => parts.length >= 4)
        .map(([role, name, value, description, position, size]) => {
          const [x, y] = cleanText(position).split(/,\s*/).map(Number);
          const [width, height] = cleanText(size).split(/,\s*/).map(Number);
          return {
            source: "accessibility",
            role: cleanText(role),
            label: cleanText(name || value || description),
            title: cleanText(name),
            value: cleanText(value),
            description: cleanText(description),
            x: Number.isFinite(x) ? x : null,
            y: Number.isFinite(y) ? y : null,
            width: Number.isFinite(width) ? width : null,
            height: Number.isFinite(height) ? height : null
          };
        });
    } catch {
      return [];
    }
  }

  async ocrScreenshot(filePath) {
    if (!filePath || !(await exists(filePath)) || !(await commandExists("/usr/bin/swift"))) return [];
    const code = `
import Foundation
import Vision
import AppKit

let imagePath = ${swiftString(filePath)}
guard let image = NSImage(contentsOfFile: imagePath),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  print("[]")
  exit(0)
}
let width = CGFloat(cgImage.width)
let height = CGFloat(cgImage.height)
let request = VNRecognizeTextRequest()
request.recognitionLevel = .fast
request.usesLanguageCorrection = true
let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try? handler.perform([request])
let rows = (request.results ?? []).compactMap { observation -> [String: Any]? in
  guard let candidate = observation.topCandidates(1).first else { return nil }
  let box = observation.boundingBox
  return [
    "source": "ocr",
    "role": "text",
    "label": candidate.string,
    "x": Double(box.minX * width),
    "y": Double((1 - box.maxY) * height),
    "width": Double(box.width * width),
    "height": Double(box.height * height),
    "confidence": Double(candidate.confidence)
  ]
}
if let data = try? JSONSerialization.data(withJSONObject: rows, options: []),
   let json = String(data: data, encoding: .utf8) {
  print(json)
} else {
  print("[]")
}
`;
    try {
      const result = await run("/usr/bin/swift", ["-e", code], { timeoutMs: 20000, maxBuffer: 1024 * 1024 * 4 });
      const rows = JSON.parse(cleanText(result.stdout) || "[]");
      return Array.isArray(rows) ? rows.map((row) => ({
        source: "ocr",
        role: "text",
        label: cleanText(row.label),
        x: safeNumber(row.x, null),
        y: safeNumber(row.y, null),
        width: safeNumber(row.width, null),
        height: safeNumber(row.height, null),
        confidence: Number(row.confidence || 0)
      })).filter((row) => row.label) : [];
    } catch {
      return [];
    }
  }

  async observeScreen() {
    const screenshot = await this.takeMacroScreenshot({ id: "capcut_observe" }, "observe");
    const [windowInfo, uiText, accessibility, rawOcr] = await Promise.all([
      this.activeWindowInfo(),
      this.capCutUiText(),
      this.accessibilityElements(),
      this.ocrScreenshot(screenshot.filePath)
    ]);
    const ocr = normalizeOcrElementsForScreen(rawOcr, screenshot);
    return {
      screenshot,
      activeApp: windowInfo.activeApp,
      activeWindowTitle: windowInfo.activeWindowTitle,
      uiText,
      accessibility,
      ocr,
      elements: [...accessibility, ...ocr],
      observedAt: now()
    };
  }

  async findTextOnScreen(text, observation = null) {
    const screen = observation || await this.observeScreen();
    const match = (screen.elements || []).find((element) => elementMatchesLabel(element, text));
    return match || null;
  }

  async findButton(label, observation = null) {
    const screen = observation || await this.observeScreen();
    const candidates = (screen.elements || []).filter((element) => {
      const role = normalizeElementText(element.role);
      return elementMatchesLabel(element, label) && (!role || /button|menu|text|group/.test(role));
    });
    return candidates.find((element) => Number.isFinite(Number(element.x)) && Number.isFinite(Number(element.y)))
      || candidates[0]
      || null;
  }

  async clickElement(element) {
    if (!element) throw new Error("No element was supplied for clickElement.");
    const x = Number.isFinite(Number(element.x)) && Number.isFinite(Number(element.width))
      ? Number(element.x) + (Number(element.width) / 2)
      : Number(element.x);
    const y = Number.isFinite(Number(element.y)) && Number.isFinite(Number(element.height))
      ? Number(element.y) + (Number(element.height) / 2)
      : Number(element.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`Element ${element.label || ""} does not expose screen coordinates.`);
    return this.click(x, y);
  }

  async runMacroStep(step) {
    const before = await this.takeMacroScreenshot({ id: "capcut_macro_step" }, "before_macro_step");
    await this.executeMacroStepWithRetry(step, { retries: 1 });
    const after = await this.takeMacroScreenshot({ id: "capcut_macro_step" }, "after_macro_step");
    return { before, after };
  }

  async verifyStep(stepName, observation = null) {
    const screen = observation || await this.observeScreen();
    const key = cleanText(stepName);
    const expected = WORKFLOW_STEP_LABELS[key] || WORKFLOW_STEP_LABELS[Object.keys(WORKFLOW_STEP_LABELS).find((item) => key.includes(item))] || [];
    const text = normalizeElementText(`${screen.uiText || ""} ${(screen.elements || []).map((item) => item.label).join(" ")}`);
    const matchedLabels = expected.filter((label) => text.includes(normalizeElementText(label)));
    const noErrorDialog = !/\b(error|failed|cannot|missing|unsupported|permission denied)\b/i.test(text);
    const screenshotExists = Boolean(screen.screenshot?.filePath && screen.screenshot?.sizeBytes > 0);
    const status = !screenshotExists || !noErrorDialog
      ? "failed"
      : (!expected.length || matchedLabels.length > 0 ? "passed" : "unknown");
    const passed = status === "passed";
    return {
      stepName: key,
      status,
      passed,
      matchedLabels,
      screenshotExists,
      noErrorDialog,
      uiTextSample: cleanText(screen.uiText).slice(0, 500),
      checkedAt: now()
    };
  }

  async updateMacroMemory(oldStep, newStep, macro = null) {
    if (!macro?.id) return null;
    const macros = await this.listMacros();
    const info = macros.find((item) => item.id === macro.id);
    if (!info?.filePath) return null;
    const raw = JSON.parse(await fs.readFile(info.filePath, "utf8"));
    raw.recoveryPatches ||= [];
    raw.recoveryPatches.push({
      oldStep,
      newStep,
      createdAt: now()
    });
    raw.steps ||= [];
    const index = raw.steps.findIndex((step) => step.index === oldStep?.index);
    if (index >= 0) raw.steps.splice(index + 1, 0, { ...newStep, index: index + 1, learnedRecovery: true });
    raw.steps = raw.steps.map((step, idx) => ({ ...step, index: idx }));
    raw.updatedAt = now();
    await this.macroStorage.backupIfExists(info.filePath, raw.name || macro.name);
    await fs.writeFile(info.filePath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    await this.logAction("updateCapCutMacroMemory", "complete", { macroId: macro.id, insertedStep: newStep.type || "" });
    return raw;
  }

  async saveCheckpoint(name, run = null) {
    const checkpoint = { id: slugify(name, "checkpoint"), label: cleanText(name) || "checkpoint" };
    if (run) return this.captureWorkflowCheckpoint(run, checkpoint);
    const screenshot = await this.takeMacroScreenshot({ id: "capcut_checkpoint" }, checkpoint.id);
    return { ...checkpoint, screenshot, createdAt: now() };
  }

  async stopWorkflow(reason) {
    const control = this.controlState();
    if (control.replay) {
      control.replay.cancelRequested = true;
      control.replay.status = "cancelled";
      control.replay.stopReason = cleanText(reason);
      control.replay.running = false;
      control.replay.finishedAt = now();
    }
    await this.logAction("stopCapCutWorkflow", "stopped", { reason });
    await this.helpers.saveState?.();
    return this.publicReplayState();
  }

  clearReplayAfterMacroEdit(control, reason = "macro_edited") {
    if (!control?.replay) return;
    control.replay = {
      ...control.replay,
      running: false,
      status: "edited",
      cancelRequested: false,
      currentStepStatus: "edited",
      failedStepIndex: 0,
      failedStepDescription: "",
      failedStepError: "",
      stopReason: cleanText(reason),
      finishedAt: now()
    };
  }

  async recoverWorkflowStep({ workflow, run, replay, macro, step, stepName, error }) {
    const recovery = {
      stepName,
      status: "analyzing",
      attempts: [],
      startedAt: now(),
      error: error?.message || ""
    };
    run.recovery = recovery;
    const observation = await this.observeScreen();
    recovery.lastScreenshot = observation.screenshot;
    const targets = WORKFLOW_RECOVERY_TARGETS[stepName] || [];
    for (const label of targets.slice(0, 5)) {
      const element = await this.findButton(label, observation);
      if (!element) {
        recovery.attempts.push({ label, status: "not_found" });
        continue;
      }
      try {
        await this.clickElement(element);
        await this.wait(350, { skipLog: true });
        const verify = await this.verifyStep(stepName);
        recovery.attempts.push({ label, status: verify.passed ? "verified" : "clicked_unverified", element, verify });
        if (verify.passed) {
          recovery.status = "recovered";
          recovery.finishedAt = now();
          const learnedStep = {
            type: "click",
            x: Number(element.x) + (Number(element.width || 0) / 2),
            y: Number(element.y) + (Number(element.height || 0) / 2),
            description: `Recovered ${stepName} by clicking ${label}`,
            recoveryFor: stepName
          };
          await this.updateMacroMemory(step, learnedStep, macro);
          this.appendWorkflowRunLog(run, `Recovered ${stepName}`, "complete", { label });
          await this.helpers.saveState?.();
          return { recovered: true, recovery, learnedStep };
        }
      } catch (recoverError) {
        recovery.attempts.push({ label, status: "failed", error: recoverError.message });
      }
    }
    recovery.status = "failed";
    recovery.finishedAt = now();
    this.appendWorkflowRunLog(run, `Recovery failed: ${stepName}`, "failed", { attempts: recovery.attempts.length });
    await this.helpers.saveState?.();
    return { recovered: false, recovery };
  }

  verificationResult(name, status, details = {}) {
    return {
      name,
      status,
      passed: status === "passed",
      details: safeDetails(details),
      checkedAt: now()
    };
  }

  async verifyCapCutOpen() {
    const running = await this.isRunning();
    return this.verificationResult("verifyCapCutOpen", running ? "passed" : "failed", { running });
  }

  async verifyTimelineHasMedia(observation = null, macro = null) {
    const screen = observation || await this.observeScreen();
    const text = normalizeElementText(`${screen.uiText || ""} ${(screen.elements || []).map((item) => item.label).join(" ")}`);
    const hasTimelineLabel = /\b(timeline|track|media|video)\b/.test(text);
    const macroHasMediaActions = Boolean((macro?.steps || []).some((step) => ["click", "doubleClick", "drag", "hotkey", "typeText"].includes(step.type)));
    if (hasTimelineLabel || macroHasMediaActions) return this.verificationResult("verifyTimelineHasMedia", "passed", { hasTimelineLabel, macroHasMediaActions });
    if (screen.screenshot?.sizeBytes > 0) return this.verificationResult("verifyTimelineHasMedia", "unknown", { reason: "timeline labels not visible" });
    return this.verificationResult("verifyTimelineHasMedia", "failed", { reason: "no screenshot evidence" });
  }

  async verifyCanvasIs916(observation = null) {
    // WI-6: measure the rendered canvas rectangle instead of trusting text
    // labels. 9:16 ≈ 0.5625 within ±3%; a 16:9 canvas measures ~1.78.
    const pixels = await this.analyzeCanvasPixels().catch(() => null);
    if (pixels?.canvas?.found) {
      const matches = aspectMatches916(pixels.canvas.aspect);
      return this.verificationResult("verifyCanvasIs916", matches ? "passed" : "failed", {
        method: "pixel_measure",
        aspect: pixels.canvas.aspect,
        box: pixels.canvas.box
      });
    }
    const verify = await this.verifyStep("after_916_canvas", observation);
    return this.verificationResult("verifyCanvasIs916", verify.status, { ...verify, method: "text_fallback" });
  }

  async verifyBlurBackground(observation = null) {
    // WI-6: before Canvas Blur the letterbox bands are flat black; after,
    // they carry blurred content. Indeterminate bands fall back to text.
    const pixels = await this.analyzeCanvasPixels().catch(() => null);
    if (pixels?.canvas?.found && pixels.bands) {
      const { topFilled, bottomFilled } = pixels.bands;
      if (topFilled === true && bottomFilled === true) {
        return this.verificationResult("verifyBlurBackground", "passed", { method: "pixel_measure", bands: pixels.bands });
      }
      if (topFilled === false || bottomFilled === false) {
        return this.verificationResult("verifyBlurBackground", "failed", {
          method: "pixel_measure",
          reason: "letterbox bars still black",
          bands: pixels.bands
        });
      }
    }
    const verify = await this.verifyStep("after_blur_background", observation);
    return this.verificationResult("verifyBlurBackground", verify.status, { ...verify, method: "text_fallback" });
  }

  async verifyAutoReframeApplied(observation = null) {
    // The "Auto reframe applied" toast is the primary proof; the completion
    // poll (waitForAutoReframeCompletion) records when it was seen.
    if (this.lastAutoReframeToastAt && Date.now() - this.lastAutoReframeToastAt < 180000) {
      return this.verificationResult("verifyAutoReframeApplied", "passed", {
        method: "toast",
        seenMsAgo: Date.now() - this.lastAutoReframeToastAt
      });
    }
    const screen = observation || await this.observeScreen();
    const text = normalizeElementText(`${screen.uiText || ""} ${(screen.elements || []).map((item) => item.label).join(" ")}`);
    if (/reframe applied|reframe complete/.test(text)) {
      this.lastAutoReframeToastAt = Date.now();
      return this.verificationResult("verifyAutoReframeApplied", "passed", { method: "toast_text" });
    }
    const verify = await this.verifyStep("after_auto_frame", screen);
    return this.verificationResult("verifyAutoReframeApplied", verify.status, { ...verify, method: "text_fallback" });
  }

  async verifyStickerBottomCenter(observation = null) {
    // WI-6: a sharp sticker over the smooth blurred background shows as high
    // gradient energy in the bottom-center vs the bottom sides.
    const pixels = await this.analyzeCanvasPixels().catch(() => null);
    if (pixels?.stickerSignal?.likelySticker) {
      return this.verificationResult("verifyStickerBottomCenter", "passed", {
        method: "pixel_signal",
        signal: pixels.stickerSignal
      });
    }
    const verify = await this.verifyStep("after_sticker_added", observation);
    return this.verificationResult("verifyStickerBottomCenter", verify.status, {
      ...verify,
      method: "text_fallback",
      signal: pixels?.stickerSignal || null
    });
  }

  async verifyNoErrorDialog(observation = null) {
    const screen = observation || await this.observeScreen();
    const text = normalizeElementText(`${screen.uiText || ""} ${(screen.elements || []).map((item) => item.label).join(" ")}`);
    const dangerous = DANGEROUS_DIALOG_RE.test(text);
    const obviousError = /\b(error|failed|cannot|missing|unsupported|permission denied|not enough space)\b/i.test(text);
    if (dangerous || obviousError) return this.verificationResult("verifyNoErrorDialog", "failed", { dangerous, obviousError });
    if (screen.screenshot?.sizeBytes > 0) return this.verificationResult("verifyNoErrorDialog", "passed", { dangerous, obviousError });
    return this.verificationResult("verifyNoErrorDialog", "unknown", { reason: "no screenshot evidence" });
  }

  async verifyProjectSaved(observation = null) {
    const verify = await this.verifyStep("after_save", observation);
    return this.verificationResult("verifyProjectSaved", verify.status, verify);
  }

  async assertNoDangerousDialog(context = "macro step") {
    const uiText = await this.capCutUiText();
    if (DANGEROUS_DIALOG_RE.test(uiText)) {
      const error = new Error(`Stopped ${context} because a destructive or external-action dialog is visible.`);
      error.statusCode = 409;
      error.details = { uiTextSample: cleanText(uiText).slice(0, 500) };
      await this.logAction("dangerousCapCutDialog", "blocked", { reason: error.message, uiTextSample: error.details.uiTextSample });
      throw error;
    }
  }

  async validateWorkflowReplay(run, macro) {
    const capcutOpen = await this.verifyCapCutOpen();
    const finalCheckpoint = (run.checkpoints || []).find((checkpoint) => checkpoint.id === "after_save")
      || (run.checkpoints || [])[run.checkpoints.length - 1]
      || null;
    const finalScreenshotExists = Boolean(finalCheckpoint?.screenshot?.filePath && finalCheckpoint.screenshot.sizeBytes > 0);
    const observation = finalScreenshotExists ? null : await this.observeScreen().catch(() => null);
    const timelineHasMedia = await this.verifyTimelineHasMedia(observation, macro).catch((error) => this.verificationResult("verifyTimelineHasMedia", "unknown", { error: error.message }));
    const noErrorDialog = await this.verifyNoErrorDialog(observation).catch((error) => this.verificationResult("verifyNoErrorDialog", "unknown", { error: error.message }));
    const canvas916 = await this.verifyCanvasIs916(observation).catch((error) => this.verificationResult("verifyCanvasIs916", "unknown", { error: error.message }));
    const blurBackground = await this.verifyBlurBackground(observation).catch((error) => this.verificationResult("verifyBlurBackground", "unknown", { error: error.message }));
    const stickerBottomCenter = await this.verifyStickerBottomCenter(observation).catch((error) => this.verificationResult("verifyStickerBottomCenter", "unknown", { error: error.message }));
    const projectSaved = await this.verifyProjectSaved(observation).catch((error) => this.verificationResult("verifyProjectSaved", "unknown", { error: error.message }));
    const failed = [capcutOpen, timelineHasMedia, noErrorDialog, canvas916, blurBackground, stickerBottomCenter, projectSaved]
      .some((item) => item.status === "failed");
    const unknown = [timelineHasMedia, canvas916, blurBackground, stickerBottomCenter, projectSaved]
      .some((item) => item.status === "unknown");
    return {
      capcutStillOpen: capcutOpen.status === "passed",
      timelineAppearsToHaveMedia: timelineHasMedia.status === "passed",
      finalScreenshotExists,
      noObviousErrorDialog: noErrorDialog.status === "passed",
      checks: {
        capcutOpen,
        timelineHasMedia,
        canvas916,
        blurBackground,
        stickerBottomCenter,
        noErrorDialog,
        projectSaved
      },
      status: failed ? "failed" : (unknown || !finalScreenshotExists ? "unknown" : "passed"),
      passed: Boolean(!failed && !unknown && finalScreenshotExists)
    };
  }

  async runWorkflow(workflowId, inputs = {}) {
    const workflow = this.workflowDefinition(workflowId);
    const workflowInputs = await validateWorkflowInputs(workflow, inputs);
    const macro = await this.latestWorkflowMacro(workflow.id);
    if (!macro) {
      const error = new Error(`Workflow ${workflow.id} has not been trained yet.`);
      error.statusCode = 404;
      throw error;
    }
    const macroForRun = {
      ...macro,
      steps: interpolateValue(macro.steps || [], workflowInputs)
    };
    if (!macroForRun.steps.length) throw Object.assign(new Error("Trained workflow macro has no replayable steps."), { statusCode: 422 });

    const control = this.controlState();
    const run = {
      id: this.helpers.newId ? this.helpers.newId("capcut_workflow_run") : `capcut_workflow_run_${Date.now()}`,
      workflowId: workflow.id,
      workflowName: workflow.name,
      macroId: macro.id,
      macroName: macro.name,
      inputs: workflowInputs,
      status: "running",
      currentStep: "Opening CapCut",
      lastAction: "",
      macroReplayStatus: "pending",
      recoveryStatus: "idle",
      startedAt: now(),
      finishedAt: null,
      logs: [],
      checkpoints: [],
      validation: null
    };
    control.workflows ||= {};
    control.workflows[workflow.id] ||= { workflowId: workflow.id };
    control.workflows[workflow.id].lastRun = run;
    const replay = {
      id: this.helpers.newId ? this.helpers.newId("capcut_replay") : `capcut_replay_${Date.now()}`,
      macroId: macro.id,
      macroName: macro.name,
      workflowId: workflow.id,
      running: true,
      status: "running",
      cancelRequested: false,
      currentStepIndex: 0,
      totalSteps: macroForRun.steps.length,
      startedAt: now(),
      finishedAt: null,
      log: []
    };
    control.replay = replay;
    control.planner = {
      workflowId: workflow.id,
      workflowName: workflow.name,
      currentStep: run.currentStep,
      lastAction: "Starting hybrid workflow",
      macroReplayStatus: "starting",
      recoveryStatus: "idle",
      logs: run.logs,
      screenshot: null,
      instruction: CAPCUT_AGENT_PLANNER_INSTRUCTION,
      startedAt: run.startedAt
    };
    await this.helpers.saveState?.();

    await this.logAction("runCapCutWorkflow", "started", { workflowId: workflow.id, macroId: macro.id });
    try {
      const completedCheckpoints = new Set();
      const beforeStart = workflow.checkpoints.find((checkpoint) => checkpoint.id === "before_start");
      if (beforeStart) {
        const entry = await this.captureWorkflowCheckpoint(run, beforeStart);
        completedCheckpoints.add(beforeStart.id);
        control.planner.screenshot = entry.screenshot;
      }
      this.appendWorkflowRunLog(run, "Opening CapCut", "running");
      if (await this.isRunning()) await this.focusCapCut();
      else await this.openCapCut();
      this.appendWorkflowRunLog(run, "Opening CapCut", "complete");
      control.planner.currentStep = "Opening CapCut";
      control.planner.lastAction = "CapCut focused";
      control.planner.macroReplayStatus = "running";
      await this.startReplayEmergencyListener();

      const checkpointLogMap = {
        after_clip_selected: ["Choosing clip"],
        after_916_canvas: ["Setting 9:16 canvas"],
        after_blur_background: ["Creating blurred background"],
        after_auto_frame: ["Applying auto frame"],
        after_sticker_added: ["Adding bottom sticker"],
        after_save: ["Saving project"]
      };
      for (let index = 0; index < macroForRun.steps.length; index += 1) {
        if (replay.cancelRequested) {
          run.status = "cancelled";
          run.stopReason = replay.stopReason || "operator_cancel";
          break;
        }
        const step = macroForRun.steps[index];
        const checkpoint = workflowCheckpointForIndex(workflow, index, macroForRun.steps.length);
        const stepName = checkpoint?.id || cleanText(step.recoveryFor || step.description || step.type || `step_${index + 1}`);
        const stepDescription = step.description || stepSummary(step);
        replay.currentStepIndex = index + 1;
        replay.currentStepDescription = stepDescription;
        replay.currentStepType = step.type || "";
        replay.currentStepStatus = "running";
        run.currentStep = stepName;
        run.lastAction = stepDescription;
        run.macroReplayStatus = "running";
        run.recoveryStatus = "idle";
        control.planner.currentStep = run.currentStep;
        control.planner.lastAction = run.lastAction;
        control.planner.macroReplayStatus = run.macroReplayStatus;
        control.planner.recoveryStatus = run.recoveryStatus;
        const startedAt = now();
        try {
          await this.runMacroStep(step);
          replay.currentStepStatus = "complete";
          replay.log.push({ index, type: step.type, status: "complete", description: stepDescription, startedAt, finishedAt: now() });
        } catch (error) {
          run.macroReplayStatus = "paused";
          run.recoveryStatus = "analyzing";
          control.planner.macroReplayStatus = "paused";
          control.planner.recoveryStatus = "analyzing";
          await this.helpers.saveState?.();
          const recovery = await this.recoverWorkflowStep({ workflow, run, replay, macro, step: { ...step, index }, stepName, error });
          if (recovery.recovered) {
            replay.log.push({ index, type: step.type, status: "recovered", description: step.description || stepSummary(step), startedAt, finishedAt: now(), recovery: recovery.recovery });
            run.recoveryStatus = "recovered";
            control.planner.recoveryStatus = "recovered";
          } else {
            replay.currentStepStatus = "failed";
            replay.failedStepIndex = index + 1;
            replay.failedStepDescription = stepDescription;
            replay.failedStepError = error.message;
            replay.log.push({ index, type: step.type, status: "failed", error: error.message, startedAt, finishedAt: now() });
            await this.stopWorkflow(`Recovery failed at ${stepName}: ${error.message}`);
            throw new Error(`Recovery failed at ${stepName}: ${error.message}`);
          }
        }
        if (checkpoint && !completedCheckpoints.has(checkpoint.id)) {
          const observation = await this.observeScreen();
          control.planner.screenshot = observation.screenshot;
          run.lastScreenshot = observation.screenshot;
          const verify = await this.verifyStep(checkpoint.id, observation);
          let checkpointReady = verify.status !== "failed";
          if (verify.status === "failed") {
            run.macroReplayStatus = "paused";
            run.recoveryStatus = "analyzing";
            control.planner.macroReplayStatus = "paused";
            control.planner.recoveryStatus = "analyzing";
            this.appendWorkflowRunLog(run, `Verifying ${checkpoint.label}`, "needs_recovery", verify);
            const recovery = await this.recoverWorkflowStep({ workflow, run, replay, macro, step: { ...step, index }, stepName: checkpoint.id, error: new Error("Checkpoint verification failed") });
            checkpointReady = recovery.recovered;
          } else if (verify.status === "unknown") {
            this.appendWorkflowRunLog(run, `Verifying ${checkpoint.label}`, "unknown", verify);
          }
          if (!checkpointReady) {
            await this.stopWorkflow(`Verification failed at ${checkpoint.label}`);
            throw new Error(`Verification failed at ${checkpoint.label}`);
          }
          completedCheckpoints.add(checkpoint.id);
          for (const label of checkpointLogMap[checkpoint.id] || []) {
            this.appendWorkflowRunLog(run, label, verify.status === "unknown" ? "unknown" : "complete", verify);
          }
          await this.captureWorkflowCheckpoint(run, checkpoint);
          run.macroReplayStatus = "running";
          run.recoveryStatus = "idle";
          control.planner.macroReplayStatus = "running";
          control.planner.recoveryStatus = "idle";
        }
        replay.log = replay.log.slice(-100);
        control.planner.logs = run.logs;
        await this.helpers.saveState?.();
      }
      for (const checkpoint of workflow.checkpoints) {
        if (!completedCheckpoints.has(checkpoint.id)) {
          await this.captureWorkflowCheckpoint(run, checkpoint);
          completedCheckpoints.add(checkpoint.id);
        }
      }
      run.validation = await this.validateWorkflowReplay(run, macroForRun);
      run.status = run.status === "cancelled" ? "cancelled" : (run.validation.passed ? "complete" : "needs_review");
      run.finishedAt = now();
      run.currentStep = "Workflow finished";
      run.lastAction = `Validation ${run.validation.passed ? "passed" : "needs review"}`;
      run.macroReplayStatus = run.status;
      run.recoveryStatus = run.recovery?.status || "idle";
      replay.running = false;
      replay.status = run.status;
      replay.currentStepStatus = run.status;
      replay.finishedAt = now();
      control.planner.currentStep = run.currentStep;
      control.planner.lastAction = run.lastAction;
      control.planner.macroReplayStatus = run.macroReplayStatus;
      control.planner.recoveryStatus = run.recoveryStatus;
      control.planner.logs = run.logs;
      control.planner.screenshot = run.lastScreenshot || run.checkpoints?.[run.checkpoints.length - 1]?.screenshot || null;
      control.planner.finishedAt = run.finishedAt;
      await this.persistWorkflowRun(run).catch((error) => {
        this.appendWorkflowRunLog(run, "Persist workflow log", "failed", { error: error.message });
      });
      await this.logAction("runCapCutWorkflow", run.status, { workflowId: workflow.id, macroId: macro.id, validation: run.validation });
      await this.helpers.saveState?.();
      return { workflow, macro: macroForRun, run, replay: this.publicReplayState(replay) };
    } catch (error) {
      run.status = "failed";
      run.stopReason = error.message;
      run.finishedAt = now();
      run.macroReplayStatus = "failed";
      run.recoveryStatus = run.recovery?.status || "failed";
      replay.running = false;
      replay.status = "failed";
      replay.currentStepStatus = "failed";
      replay.failedStepIndex ||= replay.currentStepIndex || 0;
      replay.failedStepDescription ||= replay.currentStepDescription || run.lastAction || "";
      replay.failedStepError ||= error.message;
      replay.stopReason = error.message;
      replay.finishedAt = now();
      control.planner.currentStep = run.currentStep || "Workflow failed";
      control.planner.lastAction = error.message;
      control.planner.macroReplayStatus = "failed";
      control.planner.recoveryStatus = run.recoveryStatus;
      control.planner.logs = run.logs;
      control.planner.screenshot = run.lastScreenshot || run.recovery?.lastScreenshot || null;
      control.planner.finishedAt = run.finishedAt;
      await this.persistWorkflowRun(run).catch((persistError) => {
        this.appendWorkflowRunLog(run, "Persist workflow log", "failed", { error: persistError.message });
      });
      await this.logAction("runCapCutWorkflow", "failed", { workflowId: workflow.id, macroId: macro.id, error: error.message });
      await this.helpers.saveState?.();
      throw error;
    } finally {
      this.stopReplayEmergencyListener();
    }
  }

  async startReplayEmergencyListener() {
    if (this.replayEmergencyProcess || !(await commandExists("/usr/bin/swift"))) return;
    const binPath = await this.compiledRecorderBinary({ emergencyOnly: true });
    const child = binPath
      ? spawn(binPath, [], { stdio: ["ignore", "pipe", "ignore"], env: process.env })
      : spawn("/usr/bin/swift", ["-e", this.swiftTeachRecorderCode({ emergencyOnly: true })], {
        stdio: ["ignore", "pipe", "ignore"],
        env: process.env
      });
    this.replayEmergencyProcess = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        const event = parseJsonLine(line);
        if (event?.emergencyStop) {
          this.cancelReplay("emergency_stop_hotkey").catch(() => {});
        }
      }
    });
    child.on("close", () => {
      if (this.replayEmergencyProcess === child) this.replayEmergencyProcess = null;
    });
  }

  stopReplayEmergencyListener() {
    if (this.replayEmergencyProcess) {
      this.replayEmergencyProcess.kill("SIGTERM");
      this.replayEmergencyProcess = null;
    }
  }

  async ensureCapCutFocusedForReplay() {
    const activeApp = await this.activeApp();
    if (activeApp !== "CapCut") {
      await this.focusCapCut();
      await this.wait(250, { skipLog: true });
    }
  }

  /**
   * Self-healing macros: when a click resolved via visual anchor or semantic
   * label (i.e. the stored coordinates had drifted), write the corrected
   * window-relative position back into the macro file so the next replay's
   * ratio prediction starts from the right place. Storage keeps a versioned
   * backup on every save, so healing is always reversible.
   */
  async maybeHealMacroStep(step, resolvedStep) {
    try {
      const source = cleanText(resolvedStep?.resolvedCoordinateSource);
      if (!["visual_anchor", "semantic_exact_label", "semantic_label"].includes(source)) return null;
      const target = normalizeWindowBounds(resolvedStep.resolvedTargetWindow);
      if (!target || !target.width || !target.height) return null;
      const predicted = this.resolvePointForReplay(step, "x", "y", target);
      const drift = Number.isFinite(predicted.x) && Number.isFinite(predicted.y)
        ? Math.hypot(Number(resolvedStep.x) - predicted.x, Number(resolvedStep.y) - predicted.y)
        : Number.POSITIVE_INFINITY;
      if (!(drift >= 10)) return null;

      const replay = this.controlState().replay;
      const sequence = Array.isArray(replay?.sequence) ? replay.sequence : [];
      const idx = Number(replay?.currentStepIndex || 0);
      const segment = sequence.find((item) => {
        const start = Number(item.startStep || 0);
        return idx >= start && idx < start + Number(item.stepCount || 0);
      }) || sequence[0];
      const macroId = cleanText(segment?.macroId || replay?.macroId);
      if (!macroId) return null;

      const raw = await this.macroStorage.read(macroId).catch(() => null);
      if (!raw || !Array.isArray(raw.steps)) return null;
      const match = raw.steps.find((item) => item.timestamp === step.timestamp && item.type === step.type)
        || raw.steps.find((item) => item.description === step.description && item.type === step.type && !item.healedAt);
      if (!match) return null;

      const windowX = Number(resolvedStep.x) - target.x;
      const windowY = Number(resolvedStep.y) - target.y;
      match.xRatio = windowX / target.width;
      match.yRatio = windowY / target.height;
      match.windowX = windowX;
      match.windowY = windowY;
      match.windowWidth = target.width;
      match.windowHeight = target.height;
      match.healedAt = now();
      match.healSource = source;
      match.healDriftPx = Math.round(drift);
      match.healCount = Number(match.healCount || 0) + 1;
      raw.healCount = Number(raw.healCount || 0) + 1;
      raw.updatedAt = now();
      await this.macroStorage.save(raw);
      await this.logAction("healCapCutMacroStep", "complete", {
        macroId,
        type: step.type || "",
        source,
        driftPx: Math.round(drift),
        anchorConfidence: resolvedStep.anchorConfidence || null,
        description: step.description || stepSummary(step)
      });
      return { macroId, driftPx: Math.round(drift), source };
    } catch {
      return null;
    }
  }

  /**
   * Poll a condition instead of sleeping a fixed time. Honors replay
   * pause/cancel between polls so the emergency stop always works.
   */
  async waitForCondition({ check, timeoutMs = 20000, pollMs = 500, label = "condition" } = {}) {
    const result = await pollCondition({
      check,
      timeoutMs,
      pollMs,
      shouldAbort: async () => {
        const replay = this.controlState().replay;
        if (replay?.cancelRequested) return true;
        const canContinue = await this.waitForReplayResume(replay);
        return !canContinue;
      }
    });
    await this.logAction(
      "waitForCondition",
      result.passed ? "complete" : (result.aborted ? "cancelled" : "timeout"),
      { label, attempts: result.attempts, elapsedMs: result.elapsedMs }
    );
    return result;
  }

  /**
   * Auto reframe processing time varies with every clip; the recorded pause
   * never matches. Poll for the "Auto reframe applied" toast instead.
   */
  async waitForAutoReframeCompletion() {
    return this.waitForCondition({
      label: "auto_reframe_applied",
      timeoutMs: 45000,
      pollMs: 1000,
      check: async () => {
        const uiText = normalizeElementText(await this.capCutUiText().catch(() => ""));
        if (/reframe applied|reframe complete/.test(uiText)) {
          this.lastAutoReframeToastAt = Date.now();
          return true;
        }
        return false;
      }
    });
  }

  async runPhaseVerification(phaseId) {
    const method = PHASE_GATES[cleanText(phaseId)];
    if (!method || typeof this[method] !== "function") {
      return this.verificationResult(`phaseGate:${phaseId}`, "unknown", { reason: "no verification mapped" });
    }
    try {
      return await this[method]();
    } catch (error) {
      return this.verificationResult(method, "unknown", { error: error.message });
    }
  }

  /**
   * Phase gate (WI-1): verify the finished phase before the next phase runs.
   * failed → replay the phase's steps once and re-verify; still failed →
   * screenshot + Human Gate pause. A second `unknown` counts as failed for
   * gating so silence can't wave a broken phase through. Resuming after the
   * pause re-verifies; only a pass lets the replay continue.
   */
  async runPhaseGate(phaseId, replay, macroSteps) {
    replay.gates ||= [];
    if (phaseId === "auto_frame") await this.waitForAutoReframeCompletion();
    if (phaseId === "choose_clip") {
      await this.waitForCondition({
        label: "timeline_has_media",
        timeoutMs: 20000,
        check: async () => this.verifyTimelineHasMedia()
      });
    }
    let verdict = await this.runPhaseVerification(phaseId);
    if (verdict.status === "unknown") {
      await this.waitDuringReplay(1000);
      verdict = await this.runPhaseVerification(phaseId);
      if (verdict.status === "unknown") {
        await this.logAction("phaseGate", "unknown_as_failed", { phaseId, details: safeDetails(verdict.details || {}) });
        verdict = { ...verdict, status: "failed", treatedUnknownAsFailed: true };
      }
    }
    if (verdict.status !== "failed") {
      replay.gates.push({ phaseId, status: "passed", verification: verdict.name || "", checkedAt: now() });
      await this.logAction("phaseGate", "passed", { phaseId });
      return;
    }

    await this.logAction("phaseGate", "retrying_phase", { phaseId });
    const phaseIndexes = macroSteps
      .map((item, index) => cleanText(item.phaseId) === phaseId ? index : -1)
      .filter((index) => index >= 0);
    for (const index of phaseIndexes) {
      const canContinue = await this.waitForReplayResume(replay);
      if (!canContinue || replay.cancelRequested) {
        throw Object.assign(new Error(`Replay cancelled during ${phaseId} phase retry.`), { statusCode: 409 });
      }
      await this.executeMacroStepWithRetry(macroSteps[index], { retries: 1 });
    }
    if (phaseId === "auto_frame") await this.waitForAutoReframeCompletion();
    verdict = await this.runPhaseVerification(phaseId);
    if (verdict.status === "passed") {
      replay.gates.push({ phaseId, status: "passed_after_retry", checkedAt: now() });
      await this.logAction("phaseGate", "passed_after_retry", { phaseId });
      return;
    }

    const screenshot = await this.takeMacroScreenshot({ id: "capcut_gate" }, `gate_failed_${phaseId}`).catch(() => null);
    replay.gates.push({
      phaseId,
      status: "failed",
      verification: safeDetails(verdict),
      screenshotPath: screenshot?.filePath || "",
      checkedAt: now()
    });
    replay.humanGate = {
      phaseId,
      reason: `Phase gate failed after retry: ${phaseId}`,
      verification: safeDetails(verdict),
      screenshotPath: screenshot?.filePath || "",
      raisedAt: now()
    };
    replay.pauseRequested = true;
    await this.logAction("phaseGate", "failed", { phaseId, verification: safeDetails(verdict), screenshotPath: screenshot?.filePath || "" });
    await this.helpers.saveState?.();
    const canContinue = await this.waitForReplayResume(replay);
    if (canContinue) {
      const recheck = await this.runPhaseVerification(phaseId);
      if (recheck.status === "passed") {
        replay.humanGate = null;
        replay.gates.push({ phaseId, status: "passed_after_human", checkedAt: now() });
        await this.logAction("phaseGate", "passed_after_human", { phaseId });
        return;
      }
    }
    const error = new Error(`Phase gate failed: ${phaseId}. Replay stopped before the next phase.`);
    error.statusCode = 409;
    throw error;
  }

  async recordReplayWarning(kind, step = {}) {
    const replay = this.controlState().replay;
    if (replay) {
      replay.warnings ||= [];
      replay.warnings.push({
        kind,
        stepIndex: Number(replay.currentStepIndex || 0),
        type: step.type || "",
        description: step.description || stepSummary(step),
        at: now()
      });
    }
    await this.logAction("replayWarning", kind, { description: step.description || stepSummary(step) });
  }

  /**
   * WI-3: typed transform values instead of slider/preview drags. Finds the
   * Scale / Position numeric fields via AX+OCR in the right panel and types
   * the locked recipe values — identical on every run, at every clip length.
   * Returns false (caller falls back to the recorded drag) when the fields
   * can't be located confidently.
   */
  async applyTypedTransform(step) {
    const spec = step.typedReplacement || {};
    const targetWindow = await this.currentCapCutAutomationWindow();
    if (!targetWindow || !spec.field) return false;
    const observation = await this.observeScreen().catch(() => null);
    if (!observation) return false;
    const panelMinX = targetWindow.x + targetWindow.width * 0.62;
    const label = (observation.elements || []).find((element) => {
      const text = normalizeElementText(element.label);
      const center = elementCenter(element);
      return center && center.x >= panelMinX && text === normalizeElementText(spec.field);
    }) || (observation.elements || []).find((element) => {
      const text = normalizeElementText(element.label);
      const center = elementCenter(element);
      return center && center.x >= panelMinX && text.includes(normalizeElementText(spec.field));
    });
    const labelCenter = label ? elementCenter(label) : null;
    if (!labelCenter) return false;
    const rowTolerance = Math.max(10, targetWindow.height * 0.015);
    const numericFields = (observation.elements || [])
      .filter((element) => {
        const center = elementCenter(element);
        if (!center || center.x <= labelCenter.x || center.x < panelMinX) return false;
        if (Math.abs(center.y - labelCenter.y) > rowTolerance) return false;
        return /^-?\d+(\.\d+)?%?$/.test(cleanText(element.label));
      })
      .sort((a, b) => elementCenter(a).x - elementCenter(b).x);
    const entries = spec.field === "position"
      ? [{ value: spec.x, element: numericFields[0] }, { value: spec.y, element: numericFields[1] }]
      : [{ value: spec.value, element: numericFields[0] }];
    if (entries.some((entry) => !entry.element || cleanText(entry.value) === "")) return false;
    for (const entry of entries) {
      const center = elementCenter(entry.element);
      await this.click(center.x, center.y);
      await this.wait(200, { skipLog: true });
      await this.hotkey(["command", "a"]);
      await this.typeText(String(entry.value));
      await this.pressKey("return");
      await this.wait(200, { skipLog: true });
    }
    await this.logAction("applyTypedTransform", "complete", {
      field: spec.field,
      values: entries.map((entry) => String(entry.value)).join(", ")
    });
    return true;
  }

  /**
   * WI-3: recompute a timeline drag's end point from live timeline geometry
   * (the clip bar's right edge) because clip length differs per clip.
   */
  async resolveTimelineDragTarget(resolvedStep) {
    const targetWindow = await this.currentCapCutAutomationWindow();
    if (!targetWindow) return null;
    const toYRatio = Number(resolvedStep.toYRatio ?? resolvedStep.fromYRatio);
    if (!Number.isFinite(toYRatio)) return null;
    const tmpPath = path.join(os.tmpdir(), `capcut-timeline-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.png`);
    try {
      await this.captureCapCutWindowScreenshot(tmpPath, { allowDesktopFallback: false });
      const png = await readPng(tmpPath);
      const edge = findTimelineClipEndX(png, { yRatio: toYRatio, windowWidthPoints: targetWindow.width });
      if (!edge) return null;
      return {
        toX: targetWindow.x + edge.xPoints,
        toY: Number(resolvedStep.toY),
        source: "timeline_geometry",
        confidence: edge.confidence
      };
    } catch {
      return null;
    } finally {
      await fs.rm(tmpPath, { force: true }).catch(() => {});
    }
  }

  /**
   * WI-6: shared pixel measurement of the preview canvas for verifications.
   */
  async analyzeCanvasPixels() {
    const tmpPath = path.join(os.tmpdir(), `capcut-verify-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.png`);
    try {
      const targetWindow = await this.currentCapCutAutomationWindow();
      await this.captureCapCutWindowScreenshot(tmpPath, { allowDesktopFallback: false });
      const png = await readPng(tmpPath);
      const canvas = measurePreviewCanvas(png);
      const bands = canvas.found ? measureLetterboxBands(png, canvas.box) : null;
      const stickerSignal = canvas.found ? measureBottomStickerSignal(png, canvas.box) : null;
      return { canvas, bands, stickerSignal, window: targetWindow };
    } finally {
      await fs.rm(tmpPath, { force: true }).catch(() => {});
    }
  }

  /**
   * WI-4: replays never open a different file — the target clip is copied to
   * one fixed staging path first so the taught file-picker/media-panel steps
   * see the identical world every run. Copies, never moves.
   */
  async stageSourceClipForReplay(sourcePath) {
    const clipsDir = path.resolve(this.config.watchBufferDir || path.join(process.cwd(), "Clips"));
    const stagedPath = stagingPathFor(clipsDir);
    const resolvedSource = expandUserPath(cleanText(sourcePath));
    await assertReadableFile(resolvedSource, "sourceVideoPath");
    await fs.mkdir(path.dirname(stagedPath), { recursive: true });
    await fs.copyFile(resolvedSource, stagedPath);
    const stats = await fs.stat(stagedPath);
    const check = validateStagedClip({ filePath: stagedPath, sizeBytes: stats.size });
    if (!check.ok) {
      throw Object.assign(new Error(`Staged clip failed validation: ${check.reason}`), { statusCode: 422 });
    }
    await this.logAction("stageCapCutSourceClip", "complete", { sourcePath: resolvedSource, stagedPath, sizeBytes: stats.size });
    return stagedPath;
  }

  /**
   * WI-3: lazy one-time compile of pre-existing macros. Storage keeps a
   * versioned backup on save, so compiling is always reversible.
   */
  async ensureMacroCompiled(macro) {
    if (!macro || macro.determinismCompiledAt) return macro;
    const { macro: compiled, changes } = compileMacroForDeterminism(macro);
    await this.macroStorage.save(compiled);
    await this.logAction("compileCapCutMacro", "complete", { macroId: compiled.id, changes: changes.length });
    Object.assign(macro, compiled);
    return macro;
  }

  runReportDir() {
    return path.resolve(this.config.capcutRunReportDir || path.join(path.dirname(this.macroDir()), "capcut-runs"));
  }

  /**
   * WI-8: one honest summary per replay — gates, warnings, resolution
   * sources, heals, waits — written on success, failure, and cancel.
   */
  async writeRunReport(replay, macroForReplay = {}) {
    try {
      const dir = this.runReportDir();
      await fs.mkdir(dir, { recursive: true });
      const report = {
        id: replay.id,
        macroId: replay.macroId || macroForReplay.id || "",
        macroName: replay.macroName || macroForReplay.name || "",
        status: replay.status || "",
        stopReason: replay.stopReason || "",
        startedAt: replay.startedAt || null,
        finishedAt: replay.finishedAt || null,
        totalSteps: Number(replay.totalSteps || 0),
        completedSteps: Number(replay.currentStepIndex || 0),
        gates: replay.gates || [],
        warnings: replay.warnings || [],
        humanGate: replay.humanGate || null,
        resolutionSources: replay.resolutionSources || {},
        heals: replay.heals || [],
        waits: replay.waits || { steps: 0, recordedMs: 0, actualMs: 0 },
        failedStepIndex: Number(replay.failedStepIndex || 0),
        failedStepError: replay.failedStepError || "",
        log: (replay.log || []).slice(-100)
      };
      const filePath = path.join(dir, `${cleanText(replay.id) || `capcut_replay_${Date.now()}`}.json`);
      await fs.writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      await fs.appendFile(path.join(dir, "log.jsonl"), `${JSON.stringify({
        id: report.id,
        macroName: report.macroName,
        status: report.status,
        startedAt: report.startedAt,
        finishedAt: report.finishedAt,
        gates: report.gates.map((gate) => `${gate.phaseId}:${gate.status}`),
        warningCount: report.warnings.length,
        healCount: report.heals.length
      })}\n`, "utf8");
      replay.runReportPath = filePath;
    } catch (error) {
      await this.logAction("capcutRunReport", "failed", { error: error.message }).catch(() => {});
    }
  }

  async executeMacroStep(step) {
    if (step.type === "wait") {
      // Recorded waits are human think-time, not machine requirements (WI-2).
      const recordedMs = Number.isFinite(Number(step.ms)) ? Number(step.ms) : 0;
      const actualMs = clampReplayWait(recordedMs);
      const replay = this.controlState().replay;
      if (replay) {
        replay.waits ||= { steps: 0, recordedMs: 0, actualMs: 0 };
        replay.waits.steps += 1;
        replay.waits.recordedMs += recordedMs;
        replay.waits.actualMs += actualMs;
      }
      return this.waitDuringReplay(actualMs);
    }
    if (step.type === "system/openApp") return this.openCapCut();
    if (step.type === "system/focusApp") return this.focusCapCut();
    if (step.type === "capcut/importSourceVideo") {
      await this.logAction("legacyCapCutImportStep", "skipped", {
        reason: "Manual Choose Clip phase replaced the retired import helper."
      });
      return this.status();
    }
    if (step.type === "checkpoint") return this.saveCheckpoint(step.name || step.label || step.id || "macro checkpoint");
    if (step.type === "aiRecover") {
      const observation = await this.observeScreen();
      await this.logAction("aiRecover", "unknown", { goal: step.goal || step.description || "", screenshotPath: observation.screenshot?.filePath || "" });
      return observation;
    }
    await this.ensureCapCutFocusedForReplay();
    await this.assertNoDangerousDialog(step.description || step.type || "macro step");
    const resolvedStep = await this.resolveMacroStepCoordinates(step);
    if (resolvedStep.resolvedCoordinates) {
      await this.logAction("resolveCapCutMacroCoordinates", "complete", {
        type: step.type,
        source: resolvedStep.resolvedCoordinateSource || "capcut_window",
        target: resolvedStep.resolvedSemanticTarget?.label || step.semanticTarget?.label || "",
        region: resolvedStep.resolvedSemanticTarget?.region || step.semanticTarget?.region || "",
        description: step.description || stepSummary(step)
      });
    }
    const activeReplay = this.controlState().replay;
    if (activeReplay) {
      const source = resolvedStep.resolvedCoordinateSource || (resolvedStep.resolvedCoordinates ? "capcut_window" : "raw_recorded");
      activeReplay.resolutionSources ||= {};
      activeReplay.resolutionSources[source] = Number(activeReplay.resolutionSources[source] || 0) + 1;
    }
    if (step.type === "click") {
      const result = await this.click(resolvedStep.x, resolvedStep.y);
      const heal = await this.maybeHealMacroStep(step, resolvedStep);
      if (heal && activeReplay) (activeReplay.heals ||= []).push(heal);
      return result;
    }
    if (step.type === "doubleClick") {
      const result = await this.doubleClick(resolvedStep.x, resolvedStep.y);
      const heal = await this.maybeHealMacroStep(step, resolvedStep);
      if (heal && activeReplay) (activeReplay.heals ||= []).push(heal);
      return result;
    }
    if (step.type === "drag") {
      // Compiled sticker drags run as typed field values (WI-3); typed entry
      // is pixel-independent where a replayed drag never lands twice alike.
      if (step.typedReplacement) {
        const applied = await this.applyTypedTransform(step).catch(() => false);
        if (applied) return this.status();
        await this.recordReplayWarning("typed_transform_fallback", step);
      }
      if (step.dragKind === "timeline") {
        const computed = await this.resolveTimelineDragTarget(resolvedStep).catch(() => null);
        if (computed) {
          await this.logAction("resolveTimelineDrag", "complete", {
            toX: Math.round(computed.toX),
            confidence: computed.confidence,
            description: step.description || stepSummary(step)
          });
          return this.drag(resolvedStep.fromX, resolvedStep.fromY, computed.toX, computed.toY);
        }
        await this.recordReplayWarning("drag_unparameterized", step);
      }
      return this.drag(resolvedStep.fromX, resolvedStep.fromY, resolvedStep.toX, resolvedStep.toY);
    }
    if (step.type === "scroll") return this.scroll(resolvedStep.x, resolvedStep.y, resolvedStep.deltaX || 0, resolvedStep.deltaY || 0);
    if (step.type === "hotkey") return this.hotkey(step.keys || []);
    if (step.type === "typeText") return this.typeText(step.text || "");
    if (step.type === "pressKey") return this.pressKey(step.key || "");
    if (step.type === "screenshot") return this.takeScreenshot();
    throw new Error(`Unsupported macro step: ${step.type}`);
  }

  async executeMacroStepWithRetry(step, options = {}) {
    const retries = Math.max(0, Math.min(3, Number(options.retries ?? 1)));
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        if (attempt > 0) {
          await this.logAction("retryCapCutMacroStep", "running", {
            attempt,
            retries,
            type: step.type || "",
            description: step.description || stepSummary(step)
          });
          await this.ensureCapCutFocusedForReplay().catch(() => {});
          await this.wait(700, { skipLog: true });
        }
        return await this.executeMacroStep(step);
      } catch (error) {
        lastError = error;
        if (attempt >= retries) break;
      }
    }
    throw lastError;
  }

  async replayPreparedMacro(macroForReplay, macroSteps, options = {}) {
    const control = this.controlState();
    if (control.replay?.running) throw Object.assign(new Error("A CapCut macro replay is already running."), { statusCode: 409 });
    if (!Array.isArray(macroSteps) || !macroSteps.length) throw Object.assign(new Error("Macro has no steps to replay."), { statusCode: 422 });
    const startIndex = Math.max(0, Math.min(macroSteps.length - 1, Number(options.startIndex || 0)));
    const sequence = Array.isArray(macroForReplay.sequence) && macroForReplay.sequence.length
      ? macroForReplay.sequence
      : [{
        macroId: macroForReplay.id,
        macroName: macroForReplay.name,
        startStep: 1,
        stepCount: macroSteps.length
      }];
    const replay = {
      id: this.helpers.newId ? this.helpers.newId("capcut_replay") : `capcut_replay_${Date.now()}`,
      macroId: macroForReplay.id,
      macroName: macroForReplay.name,
      running: true,
      status: "running",
      cancelRequested: false,
      pauseRequested: false,
      sequence,
      activeMacroId: sequence[0]?.macroId || macroForReplay.id,
      activeMacroName: sequence[0]?.macroName || macroForReplay.name,
      currentMacroIndex: 1,
      currentMacroCount: sequence.length,
      currentMacroStepIndex: startIndex + 1,
      currentMacroStepCount: Number(sequence[0]?.stepCount || macroSteps.length),
      currentStepIndex: startIndex,
      totalSteps: macroSteps.length,
      startIndex,
      currentStepDescription: startIndex ? `Retrying from step ${startIndex + 1}` : "Starting macro replay",
      currentStepStatus: "starting",
      failedStepIndex: 0,
      failedStepDescription: "",
      failedStepError: "",
      startedAt: now(),
      pausedAt: null,
      resumedAt: null,
      finishedAt: null,
      log: []
    };
    control.replay = replay;
    this.activeReplayId = replay.id;
    await this.helpers.saveState?.();
    await this.logAction("replayCapCutMacro", "started", {
      replayId: replay.id,
      macroId: macroForReplay.id,
      steps: macroSteps.length,
      sequence: replay.sequence.length
    });
    await this.startReplayEmergencyListener();
    try {
      await this.focusCapCut();
      await this.normalizeCapCutWindow(macroForReplay.taughtWindowFrame || macroForReplay.captureWindow);
      for (let index = startIndex; index < macroSteps.length; index += 1) {
        const canContinue = await this.waitForReplayResume(replay);
        if (!canContinue) {
          replay.status = "cancelled";
          replay.stopReason ||= "operator_cancel";
          break;
        }
        if (replay.cancelRequested) {
          replay.status = "cancelled";
          replay.stopReason ||= "operator_cancel";
          break;
        }
        const step = macroSteps[index];
        replay.currentStepIndex = index + 1;
        const activeSequenceIndex = replay.sequence.findIndex((item) => {
          const startStep = Number(item.startStep || 0);
          const stepCount = Number(item.stepCount || 0);
          return startStep > 0 && stepCount > 0 && replay.currentStepIndex >= startStep && replay.currentStepIndex < startStep + stepCount;
        });
        const activeSequence = activeSequenceIndex >= 0 ? replay.sequence[activeSequenceIndex] : null;
        replay.activeMacroId = activeSequence?.macroId || step.macroId || macroForReplay.id;
        replay.activeMacroName = activeSequence?.macroName || step.macroName || macroForReplay.name;
        replay.currentMacroIndex = activeSequence ? activeSequenceIndex + 1 : 1;
        replay.currentMacroCount = replay.sequence.length || 1;
        replay.currentMacroStepIndex = activeSequence
          ? replay.currentStepIndex - Number(activeSequence.startStep || 1) + 1
          : replay.currentStepIndex;
        replay.currentMacroStepCount = Number(activeSequence?.stepCount || macroSteps.length);
        replay.currentStepDescription = step.macroName
          ? `${step.macroName}: ${step.description || stepSummary(step)}`
          : step.description || stepSummary(step);
        replay.currentStepType = step.type || "";
        replay.currentStepStatus = "running";
        await this.helpers.saveState?.();
        const startedAt = now();
        try {
          await this.executeMacroStepWithRetry(step, { retries: 2 });
          replay.currentStepStatus = "complete";
          replay.log.push({
            index,
            type: step.type,
            status: "complete",
            macroName: step.macroName || "",
            description: step.description || stepSummary(step),
            startedAt,
            finishedAt: now()
          });
        } catch (error) {
          replay.currentStepStatus = "failed";
          replay.failedStepIndex = index + 1;
          replay.failedStepDescription = replay.currentStepDescription;
          replay.failedStepError = error.message;
          replay.log.push({
            index,
            type: step.type,
            status: "failed_after_retry",
            macroName: step.macroName || "",
            error: error.message,
            startedAt,
            finishedAt: now()
          });
          throw error;
        }
        replay.log = replay.log.slice(-100);
        await this.helpers.saveState?.();
        // Phase gate: the last step of a gated phase must not hand off to the
        // next phase until this phase's verification passes on screen.
        const nextStep = macroSteps[index + 1] || null;
        const stepPhaseId = cleanText(step.phaseId);
        if (stepPhaseId && PHASE_GATES[stepPhaseId] && cleanText(nextStep?.phaseId) !== stepPhaseId) {
          await this.runPhaseGate(stepPhaseId, replay, macroSteps);
        }
      }
      if (replay.status !== "cancelled") replay.status = "complete";
      replay.running = false;
      replay.currentStepStatus = replay.status;
      replay.finishedAt = now();
      await this.logAction("replayCapCutMacro", replay.status, {
        replayId: replay.id,
        macroId: macroForReplay.id,
        steps: macroSteps.length,
        sequence: replay.sequence.length
      });
      await this.writeRunReport(replay, macroForReplay);
      await this.helpers.saveState?.();
      return { replay: this.publicReplayState(replay), macro: macroForReplay };
    } catch (error) {
      replay.running = false;
      replay.status = "failed";
      replay.currentStepStatus = "failed";
      replay.failedStepIndex ||= replay.currentStepIndex || 0;
      replay.failedStepDescription ||= replay.currentStepDescription || "";
      replay.failedStepError ||= error.message;
      replay.stopReason = error.message;
      replay.finishedAt = now();
      await this.logAction("replayCapCutMacro", "failed", { replayId: replay.id, macroId: macroForReplay.id, error: error.message });
      await this.writeRunReport(replay, macroForReplay);
      await this.helpers.saveState?.();
      throw error;
    } finally {
      if (this.activeReplayId === replay.id) this.activeReplayId = "";
      this.stopReplayEmergencyListener();
    }
  }

  async replayMacro(idOrName, options = {}) {
    const macro = await this.readMacro(idOrName);
    await this.ensureMacroCompiled(macro);
    const runtimeInputs = workflowInputsFrom(options.inputs || {});
    const replayInputs = workflowInputsFrom({ ...(macro.workflowInputs || {}), ...runtimeInputs });
    const requestedSource = cleanText(replayInputs.sourceVideoPath);
    if (requestedSource && !requestedSource.includes("{{")) {
      replayInputs.sourceVideoPath = await this.stageSourceClipForReplay(requestedSource);
    }
    const macroSteps = interpolateValue(macro.steps || [], replayInputs).map((step) => ({
      ...step,
      macroId: macro.id,
      macroName: macro.name
    }));
    const macroForReplay = { ...macro, workflowInputs: replayInputs, steps: macroSteps };
    return this.replayPreparedMacro(macroForReplay, macroSteps, options);
  }

  async replayAllMacros(options = {}) {
    const macros = await this.listMacros();
    if (!macros.length) throw Object.assign(new Error("No CapCut macros are saved."), { statusCode: 422 });
    const runtimeInputs = workflowInputsFrom(options.inputs || {});
    const combinedSteps = [];
    const sequence = [];
    for (const info of macros) {
      const macro = await this.readMacro(info.id);
      await this.ensureMacroCompiled(macro);
      const replayInputs = workflowInputsFrom({ ...(macro.workflowInputs || {}), ...runtimeInputs });
      const steps = interpolateValue(macro.steps || [], replayInputs);
      if (!steps.length) continue;
      sequence.push({
        macroId: macro.id,
        macroName: macro.name,
        startStep: combinedSteps.length + 1,
        stepCount: steps.length
      });
      combinedSteps.push(...steps.map((step) => ({
        ...step,
        macroId: macro.id,
        macroName: macro.name
      })));
    }
    if (!combinedSteps.length) {
      throw Object.assign(new Error("Saved CapCut macros do not contain replayable steps."), { statusCode: 422 });
    }
    const macroForReplay = {
      id: "capcut_macro_sequence_all",
      name: "Run All Macros",
      app: "CapCut",
      platform: "macOS",
      version: 1,
      workflowInputs: runtimeInputs,
      sequence,
      steps: combinedSteps
    };
    return this.replayPreparedMacro(macroForReplay, combinedSteps, options);
  }

  async cancelReplay(reason = "operator_cancel") {
    const replay = this.controlState().replay;
    if (replay) {
      replay.cancelRequested = true;
      replay.stopReason = cleanText(reason);
      if (!replay.running) {
        replay.status = "cancelled";
        replay.finishedAt ||= now();
      }
      await this.logAction("replayCapCutMacro", "cancel_requested", { replayId: replay.id || "", reason });
      await this.helpers.saveState?.();
    }
    this.stopReplayEmergencyListener();
    return this.teachStatus();
  }

  async pauseReplay(reason = "operator_pause") {
    const replay = this.controlState().replay;
    if (!replay || !replay.running) {
      throw Object.assign(new Error("No CapCut macro replay is currently running."), { statusCode: 409 });
    }
    replay.pauseRequested = true;
    replay.status = "paused";
    replay.currentStepStatus = "paused";
    replay.pausedAt ||= now();
    replay.stopReason = cleanText(reason);
    await this.logAction("replayCapCutMacro", "pause_requested", { replayId: replay.id || "", reason });
    await this.helpers.saveState?.();
    return this.teachStatus();
  }

  async resumeReplay() {
    const replay = this.controlState().replay;
    if (!replay || !replay.running) {
      throw Object.assign(new Error("No paused CapCut macro replay is available to resume."), { statusCode: 409 });
    }
    replay.pauseRequested = false;
    replay.status = "running";
    replay.currentStepStatus = "running";
    replay.resumedAt = now();
    replay.stopReason = "";
    await this.logAction("replayCapCutMacro", "resume_requested", { replayId: replay.id || "" });
    await this.helpers.saveState?.();
    return this.teachStatus();
  }

  async runAction(action, body = {}) {
    const normalized = cleanText(action);
    if (normalized === "openCapCut") return this.openCapCut();
    if (normalized === "focusCapCut") return this.focusCapCut();
    if (normalized === "parkCapCut") return this.parkCapCut({ mode: body.mode });
    if (normalized === "isCapCutInstalled") return { installed: await this.isCapCutInstalled() };
    if (normalized === "isCapCutRunning") return { running: await this.isCapCutRunning() };
    if (normalized === "getActiveApp") return { activeApp: await this.getActiveApp() };
    if (normalized === "takeScreenshot") return this.takeScreenshot();
    if (normalized === "click") return this.click(body.x, body.y);
    if (normalized === "doubleClick") return this.doubleClick(body.x, body.y);
    if (normalized === "typeText") return this.typeText(body.text);
    if (normalized === "pressKey") return this.pressKey(body.key);
    if (normalized === "hotkey") return this.hotkey(body.keys);
    if (normalized === "drag") return this.drag(body.fromX, body.fromY, body.toX, body.toY);
    if (normalized === "scroll") return this.scroll(body.x, body.y, body.deltaX || body.dx || 0, body.deltaY || body.dy || 0);
    if (normalized === "wait") return this.wait(body.ms);
    throw new Error(`Unsupported CapCut action: ${action}`);
  }

  async screenshotById(id) {
    const screenshot = this.controlState().screenshots.find((item) => item.id === cleanText(id));
    if (!screenshot?.filePath) return null;
    try {
      return await fs.readFile(screenshot.filePath);
    } catch {
      return null;
    }
  }

  async macroScreenshotById(sessionId, id) {
    const safeSession = cleanText(sessionId).replace(/[^a-zA-Z0-9_-]/g, "");
    const safeId = cleanText(id).replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safeSession || !safeId) return null;
    const filePath = path.resolve(this.macroDir(), safeSession, "screenshots", `${safeId}.png`);
    const root = path.resolve(this.macroDir());
    if (!filePath.startsWith(root)) return null;
    try {
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }

  async workflowScreenshotById(runId, id) {
    const safeRun = cleanText(runId).replace(/[^a-zA-Z0-9_-]/g, "");
    const safeId = cleanText(id).replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safeRun || !safeId) return null;
    const root = path.resolve(this.workflowRootDir(), "checkpoints");
    const matches = await this.findFileByName(root, `${safeId}.png`);
    const filePath = matches.find((candidate) => candidate.includes(`${path.sep}${safeRun}${path.sep}`));
    if (!filePath) return null;
    try {
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }

  async findFileByName(root, fileName) {
    const output = [];
    const safeRoot = path.resolve(root);
    async function walk(directory, depth = 0) {
      if (depth > 4) return;
      let entries = [];
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const filePath = path.join(directory, entry.name);
        const resolved = path.resolve(filePath);
        if (!resolved.startsWith(safeRoot)) continue;
        if (entry.isDirectory()) await walk(filePath, depth + 1);
        else if (entry.isFile() && entry.name === fileName) output.push(resolved);
      }
    }
    await walk(safeRoot);
    return output;
  }
}

export function createCapCutController(options = {}) {
  return new CapCutController(options);
}

/**
 * CapCut desktop automation for macOS.
 *
 * This replaces the old capcut.com browser runner. The real path opens the
 * native CapCut app, uses screenshots plus Claude vision to locate controls,
 * and drives the UI with mouse/keyboard events. Export/upload remains outside
 * this service and must stay Human Gate controlled.
 */

import { mouse, keyboard, Button, Key, Point } from "@nut-tree-fork/nut-js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import Anthropic from "@anthropic-ai/sdk";

const execFileAsync = promisify(execFile);

const ACTION_DELAY_MS = Number(process.env.CAPCUT_ACTION_DELAY_MS || 1200);
const FIND_RETRIES = Number(process.env.CAPCUT_FIND_RETRIES || 4);
const RETRY_DELAY_MS = Number(process.env.CAPCUT_FIND_RETRY_DELAY_MS || 2000);
const CAPCUT_APP_NAME = process.env.CAPCUT_APP_NAME || "CapCut";
const CAPCUT_VISION_MODEL = process.env.CAPCUT_VISION_MODEL
  || process.env.ANTHROPIC_MODEL
  || "claude-haiku-4-5-20251001";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function now() {
  return new Date().toISOString();
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function publicStep(phase, status, message, extra = {}) {
  return { phase, status, message, createdAt: now(), ...extra };
}

async function emitStep(steps, onStep, phase, status, message, extra = {}) {
  const entry = publicStep(phase, status, message, extra);
  steps.push(entry);
  await onStep(entry);
  return entry;
}

async function assertReadableVideo(filePath) {
  const resolved = path.resolve(cleanText(filePath));
  const stats = await fs.stat(resolved);
  if (!stats.isFile()) throw new Error("CapCut desktop source is not a file.");
  if (stats.size < 1024) throw new Error("CapCut desktop source file is too small to be a valid video.");
  return {
    path: resolved,
    filename: path.basename(resolved),
    directory: path.dirname(resolved),
    sizeBytes: stats.size
  };
}

async function activeAppName() {
  const { stdout } = await execFileAsync("osascript", [
    "-e",
    'tell application "System Events" to get name of first application process whose frontmost is true'
  ]);
  return cleanText(stdout);
}

export async function isCapCutInstalled() {
  try {
    const direct = await fs.stat("/Applications/CapCut.app").catch(() => null);
    if (direct) return true;
    const { stdout } = await execFileAsync("mdfind", [
      'kMDItemCFBundleIdentifier == "com.lemon.lvoverseas" || kMDItemFSName == "CapCut.app"'
    ], { timeout: 3000 });
    return Boolean(cleanText(stdout));
  } catch {
    return false;
  }
}

export async function isCapCutRunning() {
  try {
    const { stdout } = await execFileAsync("pgrep", ["-x", CAPCUT_APP_NAME], { timeout: 3000 });
    return Boolean(cleanText(stdout));
  } catch {
    return false;
  }
}

async function openCapCut() {
  await execFileAsync("open", ["-a", CAPCUT_APP_NAME]);
  await sleep(3000);
}

async function focusCapCut() {
  await execFileAsync("osascript", ["-e", `tell application "${CAPCUT_APP_NAME}" to activate`]);
  await sleep(800);
}

// Use Swift to find the CapCut window ID — works regardless of which display CapCut is on.
async function getCapCutWindowId() {
  const swiftCode = `
import CoreGraphics
import Foundation
let options = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
guard let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else { print("0"); exit(0) }
var bestId = 0
var bestArea: Double = 0
for window in windows {
  let owner = window[kCGWindowOwnerName as String] as? String ?? ""
  let layer = window[kCGWindowLayer as String] as? Int ?? 999
  guard owner == "CapCut" && layer == 0 else { continue }
  let bounds = window[kCGWindowBounds as String] as? [String: Any] ?? [:]
  let w = bounds["Width"] as? Double ?? 0
  let h = bounds["Height"] as? Double ?? 0
  let area = w * h
  if area > bestArea && w >= 320 && h >= 240 {
    bestArea = area
    bestId = window[kCGWindowNumber as String] as? Int ?? 0
  }
}
print(bestId)
`;
  try {
    const { stdout } = await execFileAsync("/usr/bin/swift", ["-e", swiftCode], { timeout: 8000 });
    const id = parseInt(stdout.trim(), 10);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

// Capture ONLY the CapCut window — works on any display, not just primary monitor.
// Falls back to full desktop if window ID can't be found.
async function takeScreenshotBase64() {
  const tmpPath = path.join(os.tmpdir(), `capcut-vision-${Date.now()}.png`);
  try {
    const windowId = await getCapCutWindowId();
    const args = windowId
      ? ["-x", "-t", "png", "-l", String(windowId), tmpPath]
      : ["-x", "-t", "png", tmpPath];
    await execFileAsync("/usr/sbin/screencapture", args, { timeout: 10000 });
    const buf = await fs.readFile(tmpPath);
    if (!buf.length) throw new Error("Screenshot was empty.");
    return buf.toString("base64");
  } catch (error) {
    const wrapped = new Error(
      `CapCut screenshot failed. Grant Screen Recording permission in System Settings > Privacy & Security > Screen Recording. ${error.message}`
    );
    wrapped.cause = error;
    throw wrapped;
  } finally {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
  }
}

function parseVisionJson(raw) {
  const cleaned = cleanText(raw)
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  try {
    return JSON.parse(cleaned || "{}");
  } catch (error) {
    throw new Error(`CapCut vision returned invalid JSON: ${cleaned.slice(0, 180) || error.message}`);
  }
}

async function findElementOnScreen(elementDescription, client) {
  if (!client?.messages?.create) {
    throw new Error("CapCut desktop vision requires ANTHROPIC_API_KEY or an Anthropic client.");
  }
  const screenshotB64 = await takeScreenshotBase64();
  const response = await client.messages.create({
    model: CAPCUT_VISION_MODEL,
    max_tokens: 160,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: screenshotB64 }
        },
        {
          type: "text",
          text: `This is a screenshot of the CapCut desktop video editor on macOS.

Find this UI element: "${elementDescription}"

Reply with ONLY a JSON object:
{"x": <pixel x coordinate>, "y": <pixel y coordinate>, "found": true}

If you cannot find the element, reply with:
{"found": false, "reason": "<why not found>"}

Coordinates must be the center of the clickable area.`
        }
      ]
    }]
  });
  const raw = response.content?.find((part) => part.type === "text")?.text
    || response.content?.[0]?.text
    || "{}";
  const result = parseVisionJson(raw);
  return result.found ? { x: Number(result.x), y: Number(result.y), raw: result } : null;
}

async function findElementWithRetry(description, client, options = {}) {
  const retries = Number.isFinite(Number(options.retries)) ? Number(options.retries) : FIND_RETRIES;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const pos = await findElementOnScreen(description, client);
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) return pos;
    if (attempt < retries) {
      await options.onRetry?.(attempt);
      await sleep(RETRY_DELAY_MS);
    }
  }
  throw new Error(`CapCut desktop automation could not find UI element: ${description}`);
}

async function clickAt(x, y) {
  try {
    await mouse.setPosition(new Point(Math.round(x), Math.round(y)));
    await sleep(200);
    await mouse.click(Button.LEFT);
    await sleep(ACTION_DELAY_MS);
  } catch (error) {
    const wrapped = new Error(
      `CapCut desktop click failed. Grant Accessibility permission to Terminal/Node in System Settings > Privacy & Security > Accessibility. ${error.message}`
    );
    wrapped.cause = error;
    throw wrapped;
  }
}

async function dragBetween(from, to) {
  await mouse.setPosition(new Point(Math.round(from.x), Math.round(from.y)));
  await sleep(250);
  await mouse.pressButton(Button.LEFT);
  await sleep(250);
  await mouse.setPosition(new Point(Math.round(to.x), Math.round(to.y)));
  await sleep(350);
  await mouse.releaseButton(Button.LEFT);
  await sleep(ACTION_DELAY_MS);
}

async function tripleClickAt(x, y) {
  await mouse.setPosition(new Point(Math.round(x), Math.round(y)));
  await sleep(150);
  for (let index = 0; index < 3; index += 1) {
    await mouse.click(Button.LEFT);
    await sleep(80);
  }
}

async function findAndClick(description, client, options = {}) {
  const pos = await findElementWithRetry(description, client, options);
  await clickAt(pos.x, pos.y);
  return pos;
}

function keyFor(value) {
  const normalized = cleanText(value).toLowerCase();
  const map = {
    command: Key.LeftSuper,
    cmd: Key.LeftSuper,
    shift: Key.LeftShift,
    option: Key.LeftAlt,
    alt: Key.LeftAlt,
    control: Key.LeftControl,
    ctrl: Key.LeftControl,
    g: Key.G,
    f: Key.F,
    i: Key.I,
    return: Key.Return,
    enter: Key.Return
  };
  if (!map[normalized]) throw new Error(`Unsupported CapCut desktop key: ${value}`);
  return map[normalized];
}

async function hotkey(keys) {
  const resolved = keys.map(keyFor);
  for (const key of resolved) await keyboard.pressKey(key);
  for (const key of [...resolved].reverse()) await keyboard.releaseKey(key);
  await sleep(500);
}

async function typeText(text) {
  await keyboard.type(String(text));
  await sleep(350);
}

async function pressReturn() {
  await keyboard.type(Key.Return);
  await sleep(500);
}

async function runDryRun(source, editSpec, steps, onStep) {
  await emitStep(steps, onStep, "preflight", "complete", "Verified rendered clip file exists.", {
    filename: source.filename,
    sizeBytes: source.sizeBytes
  });
  await emitStep(steps, onStep, "open_capcut", "complete", "Dry run: CapCut desktop app would open.");
  await emitStep(steps, onStep, "create_project", "complete", "Dry run: new CapCut project would be created.");
  await emitStep(steps, onStep, "upload_clip", "complete", "Dry run: verified MP4 would be imported.");
  await emitStep(steps, onStep, "timeline", "complete", "Dry run: clip would be added to the timeline.");
  await emitStep(steps, onStep, "set_9_16", "complete", `Dry run: ${editSpec.aspectRatio || editSpec.aspect_ratio || "9:16"} canvas would be applied.`);
  await emitStep(steps, onStep, "canvas_blur", "complete", "Dry run: blurred canvas background would be applied.");
  await emitStep(steps, onStep, "auto_reframe", "complete", "Dry run: auto reframe would be applied.");
  await emitStep(steps, onStep, "add_sticker", "complete", "Dry run: brand sticker would be added if configured.");
  await emitStep(steps, onStep, "preview", "complete", "Dry run: project would be ready for export review.");
  return {
    dryRun: true,
    success: true,
    source,
    exportReady: true,
    steps,
    completedPhases: steps.map((step) => step.phase)
  };
}

export async function runCapcutDesktopEdit(editSpec = {}, opts = {}) {
  const {
    clipPath,
    clipId = "unknown",
    brandSticker = process.env.CAPCUT_BRAND_STICKER || "Essentrx",
    stickerScale = 35
  } = editSpec;
  if (!clipPath) throw new Error("CapCut desktop automation requires clipPath.");

  const onStep = typeof opts.onStep === "function" ? opts.onStep : () => {};
  const steps = [];
  const source = await assertReadableVideo(clipPath);
  const client = opts.client || (
    process.env.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      : null
  );

  if (opts.dryRun) return runDryRun(source, editSpec, steps, onStep);

  if (!(await isCapCutInstalled())) {
    throw new Error("CapCut desktop app is not installed at /Applications/CapCut.app.");
  }

  await emitStep(steps, onStep, "preflight", "complete", "Verified rendered clip file exists.", {
    filename: source.filename,
    sizeBytes: source.sizeBytes
  });

  await emitStep(steps, onStep, "open_capcut", "running", "Opening CapCut desktop app.");
  await openCapCut();
  await focusCapCut();
  await emitStep(steps, onStep, "open_capcut", "complete", `CapCut focused. Active app: ${await activeAppName().catch(() => "unknown")}`);

  await emitStep(steps, onStep, "create_project", "running", "Creating a new CapCut project.");
  await findAndClick('Large "Create project" button with a plus icon on the CapCut home screen', client);
  await emitStep(steps, onStep, "create_project", "complete", "New CapCut project opened.");
  await sleep(1800);

  await emitStep(steps, onStep, "upload_clip", "running", `Importing ${source.filename}.`);
  await findAndClick('Blue "+ Import" button in the media panel of a blank CapCut project', client);
  await sleep(1200);
  await hotkey(["command", "shift", "g"]);
  await typeText(source.directory);
  await pressReturn();
  await sleep(900);
  await findAndClick(`File named "${source.filename}" in the macOS file picker`, client, {
    retries: 3,
    onRetry: async () => {
      await hotkey(["command", "f"]);
      await typeText(source.filename);
    }
  });
  await findAndClick('Blue "Import" button in the bottom right of the macOS file picker', client);
  await emitStep(steps, onStep, "upload_clip", "complete", "Clip imported into CapCut media panel.");
  await sleep(1800);

  await emitStep(steps, onStep, "timeline", "running", "Adding clip to timeline.");
  const thumbnail = await findElementWithRetry("Imported clip thumbnail in the media panel", client);
  await mouse.setPosition(new Point(thumbnail.x, thumbnail.y));
  await sleep(600);
  await findAndClick('Small blue circular "+" button on the imported clip thumbnail, used to add to track', client);
  await emitStep(steps, onStep, "timeline", "complete", "Clip added to timeline.");

  await emitStep(steps, onStep, "set_9_16", "running", "Setting canvas ratio to 9:16.");
  await findAndClick('"Ratio" button below the CapCut preview/player controls', client);
  await findAndClick('"9:16" vertical aspect ratio option in the ratio dropdown', client);
  await emitStep(steps, onStep, "set_9_16", "complete", "Canvas set to 9:16.");

  await emitStep(steps, onStep, "canvas_blur", "running", "Applying blurred canvas background.");
  await findAndClick("Main video clip bar in the CapCut timeline", client);
  await findAndClick('"Basic" sub-tab in the right Video properties panel', client);
  await findAndClick('"Canvas" checkbox or label in the right properties panel', client);
  await findAndClick('Canvas fill dropdown currently showing "None" or another fill style', client);
  await findAndClick('"Blur" option in the canvas fill dropdown', client);
  await emitStep(steps, onStep, "canvas_blur", "complete", "Blurred canvas background applied.");

  await emitStep(steps, onStep, "auto_reframe", "running", "Applying Auto Reframe.");
  await findAndClick('"Auto reframe" checkbox or toggle in the right properties panel', client);
  await findAndClick('"Aspect ratio" dropdown in the Auto reframe section', client);
  await findAndClick('"3:4" option in the Auto reframe aspect ratio dropdown', client);
  await findAndClick('"Apply" button for Auto reframe settings', client);
  await sleep(3000);
  await emitStep(steps, onStep, "auto_reframe", "complete", "Auto Reframe applied or submitted for processing.");

  if (brandSticker) {
    await emitStep(steps, onStep, "add_sticker", "running", `Adding brand sticker: ${brandSticker}.`);
    await findAndClick('"Stickers" button in the CapCut top toolbar', client);
    await findAndClick('"Yours" tab in the sticker panel', client);
    await findAndClick('"Brand stickers" option in the sticker panel', client);
    await findAndClick(`"${brandSticker}" brand sticker thumbnail`, client);

    const scaleField = await findElementWithRetry('"Scale" percentage field in the Transform panel', client);
    await tripleClickAt(scaleField.x + 60, scaleField.y);
    await typeText(String(stickerScale));
    await pressReturn();

    const yField = await findElementWithRetry('"Y" position number input in the Transform panel', client);
    await tripleClickAt(yField.x, yField.y);
    await typeText("-1745");
    await pressReturn();

    const stickerEnd = await findElementWithRetry("Right edge handle of the orange sticker track in the timeline", client);
    const videoEnd = await findElementWithRetry("Right edge of the main teal video clip track in the timeline", client);
    await dragBetween(stickerEnd, { x: videoEnd.x, y: stickerEnd.y });
    await emitStep(steps, onStep, "add_sticker", "complete", "Sticker added, scaled, positioned, and extended to clip duration.");
  } else {
    await emitStep(steps, onStep, "add_sticker", "skipped", "No brand sticker configured.");
  }

  await emitStep(steps, onStep, "preview", "complete", "CapCut desktop edit complete. Export remains Human Gate gated.");
  return {
    dryRun: false,
    success: true,
    projectName: `Argentum-${clipId}`,
    clipPath: source.path,
    source,
    exportReady: true,
    steps,
    completedPhases: steps.map((step) => step.phase)
  };
}

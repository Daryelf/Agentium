# Codex Prompt — CapCut Desktop Automation
# Full setup + implementation for Argentum Clipping Office
# Replace the old web-based CapCut automation entirely with this

---

## WHAT YOU ARE BUILDING

You are building a **CapCut desktop app automation service** for the Argentum Clipping Office system. This replaces the old broken `capcut-runner.js` that tried to automate capcut.com in a browser (which doesn't work reliably).

The new system automates the **CapCut Mac desktop app** using screenshots + Claude vision to see the screen, and `@nut-tree/nut-js` for mouse clicks and keyboard. Every step mirrors exactly what a human operator does when editing a clip in CapCut.

The end result: Agent 101 calls the `capcut_edit_clip` tool → the system opens CapCut, creates a project, imports the clip, applies blur background, auto-reframe, adds the brand sticker, and saves — all automatically.

---

## PROJECT CONTEXT

**Root directory:** `/Volumes/ZYLO/Argentum/CLIPPING OFFICE/`

**Key files you will edit:**
- `services/capcut-desktop.js` — CREATE THIS (the new automation service)
- `services/capcut-runner.js` — REPLACE the existing file with a thin wrapper that calls capcut-desktop.js
- `services/agent-tools.js` — already has a `capcut_edit_clip` case at line 995, just needs the context function wired correctly
- `server.js` — import the new service, wire `capcutEditClip` into the tool execution context
- `package.json` — add new npm dependencies

**Existing patterns to follow:**
- All services use ES module syntax (`export`, `import`) — `"type": "module"` is set in package.json
- `execFileAsync` is already defined in server.js as `promisify(execFile)`
- The Anthropic client is already imported in server.js as `import Anthropic from "@anthropic-ai/sdk"`
- Human Gate pattern: call `requestHumanApproval(gateId, message)` before any irreversible action
- SSE streaming: call `emitAgentStep(sessionId, step)` to stream progress to the frontend
- `saveState()` uses atomic write (`.tmp` then `fs.rename()`) — never call `fs.writeFile()` directly on `data/state.json`
- Practice mode: never automate CapCut with clips marked `PRACTICE MEDIA` without `practice_confirmed: true`

---

## STEP 1 — Install Dependencies

Add to `package.json` dependencies:

```json
"@nut-tree/nut-js": "^4.2.0",
"@nut-tree/nl-matcher": "^4.0.0",
"screenshot-desktop": "^1.15.0"
```

Then run: `npm install`

**What these do:**
- `@nut-tree/nut-js` — cross-platform desktop automation: mouse move, click, keyboard, screen reading
- `screenshot-desktop` — takes a screenshot of the full desktop and returns it as a Buffer
- Claude vision (already available via `@anthropic-ai/sdk`) — analyzes screenshots to find button locations

> Note: `@nut-tree/nut-js` requires macOS accessibility permissions. The first time it runs, macOS will prompt the user to grant Terminal/Node accessibility access in System Settings → Privacy & Security → Accessibility. This is a one-time setup.

---

## STEP 2 — Create `services/capcut-desktop.js`

Create this file from scratch. It must export one main function: `runCapcutDesktopEdit(editSpec, opts)`.

### Full file contents:

```js
/**
 * capcut-desktop.js
 * Automates the CapCut desktop app on macOS using mouse/keyboard control
 * and Claude vision to locate UI elements by screenshot.
 *
 * This replaces the old capcut-runner.js web automation which was unreliable.
 *
 * Requires: @nut-tree/nut-js, screenshot-desktop, @anthropic-ai/sdk
 * Requires: macOS Accessibility permission granted to Terminal/Node
 */

import { mouse, keyboard, screen, Button, Key, straightTo, Point } from "@nut-tree/nut-js";
import screenshot from "screenshot-desktop";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import Anthropic from "@anthropic-ai/sdk";

const execFileAsync = promisify(execFile);

// ─── Config ────────────────────────────────────────────────────────────────

// How long to wait after each action before taking the next screenshot (ms)
const ACTION_DELAY_MS = 1200;
// How many times to retry finding a UI element before giving up
const FIND_RETRIES = 4;
// How long to wait between retries (ms)
const RETRY_DELAY_MS = 2000;
// CapCut app bundle ID on macOS
const CAPCUT_BUNDLE_ID = "com.lemon.lvoverseas";
// CapCut app display name
const CAPCUT_APP_NAME = "CapCut";

// ─── Utilities ─────────────────────────────────────────────────────────────

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function takeScreenshot() {
  const buf = await screenshot({ format: "png" });
  return buf.toString("base64");
}

async function openCapCut() {
  await execFileAsync("open", ["-a", CAPCUT_APP_NAME]);
  await sleep(3000); // give CapCut time to open/focus
}

async function focusCapCut() {
  // Bring CapCut to front using AppleScript
  await execFileAsync("osascript", ["-e", `tell application "${CAPCUT_APP_NAME}" to activate`]);
  await sleep(800);
}

// ─── Claude Vision: Find UI Element ────────────────────────────────────────

/**
 * Takes a screenshot, sends it to Claude Haiku with a description of what to find,
 * and returns the {x, y} pixel coordinate to click.
 *
 * @param {string} elementDescription - Plain English description of what to find
 * @param {Anthropic} client - Anthropic SDK client
 * @returns {Promise<{x: number, y: number} | null>}
 */
async function findElementOnScreen(elementDescription, client) {
  const screenshotB64 = await takeScreenshot();

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 128,
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

Reply with ONLY a JSON object (no markdown, no explanation):
{"x": <pixel x coordinate>, "y": <pixel y coordinate>, "found": true}

If you cannot find the element, reply with:
{"found": false, "reason": "<why not found>"}

The coordinates must be the center of the clickable area of the element.`
        }
      ]
    }]
  });

  const raw = response.content?.[0]?.text || "{}";
  const cleaned = raw.replace(/```json?\s*/gi, "").replace(/```/g, "").trim();
  const result = JSON.parse(cleaned);
  return result.found ? { x: result.x, y: result.y } : null;
}

/**
 * Try to find an element with retries.
 * Throws if not found after all retries.
 */
async function findElementWithRetry(description, client, { retries = FIND_RETRIES, onRetry } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const pos = await findElementOnScreen(description, client);
    if (pos) return pos;
    if (attempt < retries) {
      console.log(`[capcut-desktop] Element not found: "${description}" — retry ${attempt + 1}/${retries}`);
      if (onRetry) await onRetry(attempt);
      await sleep(RETRY_DELAY_MS);
    }
  }
  throw new Error(`CapCut automation failed: could not find UI element after ${retries + 1} attempts: "${description}"`);
}

// ─── Click Helper ───────────────────────────────────────────────────────────

async function clickAt(x, y) {
  await mouse.setPosition(new Point(x, y));
  await sleep(200);
  await mouse.click(Button.LEFT);
  await sleep(ACTION_DELAY_MS);
}

async function findAndClick(description, client, opts = {}) {
  const pos = await findElementWithRetry(description, client, opts);
  console.log(`[capcut-desktop] Clicking "${description}" at (${pos.x}, ${pos.y})`);
  await clickAt(pos.x, pos.y);
  return pos;
}

// ─── Main Export ────────────────────────────────────────────────────────────

/**
 * Run the full CapCut desktop edit workflow.
 *
 * @param {object} editSpec
 * @param {string} editSpec.clipPath          - Absolute path to the source .mp4 file
 * @param {string} editSpec.clipId            - Clip ID for logging
 * @param {string} [editSpec.brandSticker]    - Name of the brand sticker (default: "Essentrx")
 * @param {number} [editSpec.stickerScale]    - Sticker scale % (default: 35)
 *
 * @param {object} opts
 * @param {Function} [opts.onStep]            - Called with each step description for SSE streaming
 * @param {Function} [opts.requestApproval]   - Human Gate function (async, throws if denied)
 * @param {Anthropic} [opts.client]           - Anthropic SDK client (creates one if not provided)
 * @param {string} [opts.sessionId]           - Watch session ID for logging
 *
 * @returns {Promise<{success: boolean, projectName: string, error?: string}>}
 */
export async function runCapcutDesktopEdit(editSpec, opts = {}) {
  const {
    clipPath,
    clipId,
    brandSticker = "Essentrx",
    stickerScale = 35,
  } = editSpec;

  const {
    onStep = () => {},
    requestApproval,
    sessionId = "unknown",
  } = opts;

  const client = opts.client || new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Verify the clip file exists before starting
  try {
    await fs.access(clipPath);
  } catch {
    throw new Error(`CapCut desktop: clip file not found at ${clipPath}`);
  }

  const emit = (msg) => {
    console.log(`[capcut-desktop] ${msg}`);
    onStep({ step: msg, timestamp: new Date().toISOString() });
  };

  emit("Opening CapCut desktop app...");

  // ── STEP 1: Open and focus CapCut ──────────────────────────────────────
  await openCapCut();
  await focusCapCut();
  emit("CapCut is open");

  // ── STEP 2: Click "Create project" on the home screen ─────────────────
  emit("Looking for Create project button...");
  await findAndClick(
    'Large teal/cyan "Create project" button with a "+" icon in the center of the CapCut home screen',
    client
  );
  emit("Clicked Create project — new project opened");
  await sleep(2000); // wait for blank project to load

  // ── STEP 3: Click Import button in the media panel ────────────────────
  emit("Looking for Import button...");
  await findAndClick(
    'Blue "+" Import button in the center of the media panel, with text "Drag and drop videos, photos, and audio files here" below it',
    client
  );
  emit("Clicked Import — file picker should open");
  await sleep(1500);

  // ── STEP 4: Navigate file picker to the clip ──────────────────────────
  // Use keyboard shortcut to go to the file path directly
  emit(`Navigating to clip: ${clipPath}`);
  await keyboard.type(Key.LeftSuper, Key.G); // Cmd+G opens "Go to folder" in macOS file picker
  await sleep(600);

  // Type the directory path of the clip
  const clipDir = path.dirname(clipPath);
  await keyboard.type(clipDir);
  await sleep(300);
  await keyboard.type(Key.Return);
  await sleep(1000);

  // Now find and select the specific file by name
  const clipFilename = path.basename(clipPath);
  emit(`Selecting file: ${clipFilename}`);

  // Use Cmd+Shift+G then type full path to go directly to the file
  await findAndClick(
    `File or folder named "${clipFilename}" in the file browser list`,
    client,
    {
      retries: 3,
      onRetry: async () => {
        // If we can't find it, try typing the filename in the search box
        await keyboard.type(Key.LeftSuper, Key.F);
        await sleep(400);
        await keyboard.type(clipFilename);
        await sleep(800);
      }
    }
  );
  await sleep(500);

  // Click the Import button in the file picker
  await findAndClick(
    'Blue "Import" button in the bottom right of the file picker dialog',
    client
  );
  emit("Clip imported into media panel");
  await sleep(2000);

  // ── STEP 5: Add clip to timeline ──────────────────────────────────────
  emit("Adding clip to timeline...");
  // Hover over the clip thumbnail to reveal the "+" button
  const thumbnailPos = await findElementWithRetry(
    'Clip thumbnail in the media panel showing the imported video file with a duration badge in the top right',
    client
  );
  // Move mouse to thumbnail to reveal the "Add to track" button
  await mouse.setPosition(new Point(thumbnailPos.x, thumbnailPos.y));
  await sleep(600);

  // Now find the blue "+" Add to track button that appears on hover
  await findAndClick(
    'Small blue circular "+" button that appears on the bottom-right corner of the clip thumbnail, tooltip says "Add to track"',
    client
  );
  emit("Clip added to timeline");
  await sleep(2000);

  // ── STEP 6: Set canvas to 9:16 ────────────────────────────────────────
  emit("Setting aspect ratio to 9:16...");
  await findAndClick(
    '"Ratio" button in the playback controls bar below the video preview — a small button showing the current ratio',
    client
  );
  await sleep(500);

  await findAndClick(
    '"9:16" option in the aspect ratio dropdown list — the vertical/portrait ratio option',
    client
  );
  emit("Canvas set to 9:16");
  await sleep(1000);

  // ── STEP 7: Apply Canvas Blur background ──────────────────────────────
  emit("Applying Canvas Blur background...");
  // Click on the video clip in the timeline to select it
  await findAndClick(
    'Teal/cyan video clip bar in the timeline at the bottom of the screen',
    client
  );
  await sleep(500);

  // Right panel should show Video > Basic tab — scroll down to Canvas
  await findAndClick(
    '"Basic" sub-tab in the right panel under the Video tab (alongside Remove BG, Mask, Retouch)',
    client
  );
  await sleep(300);

  // Find and enable the Canvas checkbox
  await findAndClick(
    '"Canvas" label with a checkbox on the left side in the right properties panel — it should be unchecked/grey currently',
    client
  );
  await sleep(500);

  // Select "Blur" from the Canvas style dropdown
  await findAndClick(
    'Dropdown below the Canvas checkbox that allows selecting canvas fill style — currently showing "None"',
    client
  );
  await sleep(400);

  await findAndClick(
    '"Blur" option in the canvas style dropdown list',
    client
  );
  emit("Canvas Blur applied");
  await sleep(800);

  // ── STEP 8: Apply Auto Reframe ────────────────────────────────────────
  emit("Applying Auto Reframe...");

  // Find and enable Auto reframe in the right panel (above Canvas)
  await findAndClick(
    '"Auto reframe" label with a toggle or checkbox in the right properties panel under Video > Basic',
    client
  );
  await sleep(600);

  // Set Aspect ratio to 3:4
  await findAndClick(
    '"Aspect ratio" dropdown in the Auto reframe settings section — currently showing "Original"',
    client
  );
  await sleep(400);

  await findAndClick(
    '"3:4" option in the aspect ratio dropdown',
    client
  );
  await sleep(400);

  // Click Apply
  await findAndClick(
    '"Apply" button to the right of the Auto reframe settings — a small button that applies the reframe processing',
    client
  );
  emit("Auto Reframe applied — waiting for processing...");
  await sleep(3000); // Auto reframe takes a moment to process

  // Verify "Auto reframe applied" toast appeared
  const toastPos = await findElementOnScreen(
    '"Auto reframe applied" toast notification or confirmation message in the center of the screen',
    client
  );
  if (toastPos) {
    emit("Auto Reframe confirmed via toast notification");
  } else {
    emit("Warning: Auto Reframe toast not detected — continuing anyway");
  }

  // ── STEP 9: Add Brand Sticker ─────────────────────────────────────────
  emit(`Adding brand sticker: ${brandSticker}...`);

  // Click Stickers in the top toolbar
  await findAndClick(
    '"Stickers" button in the top toolbar — shows a star or sparkle icon, 4th or 5th icon from the left in the toolbar',
    client
  );
  await sleep(800);

  // Click "Yours" in the left panel
  await findAndClick(
    '"Yours" tab or button in the left sticker panel — shows your personal/brand stickers',
    client
  );
  await sleep(400);

  // Click "Brand stickers"
  await findAndClick(
    '"Brand stickers" option in the left sticker panel under the Yours section',
    client
  );
  await sleep(600);

  // Click the brand sticker thumbnail
  await findAndClick(
    `"${brandSticker}" brand sticker thumbnail in the sticker panel — a logo/brand image`,
    client
  );
  emit("Brand sticker added to preview");
  await sleep(1000);

  // ── STEP 10: Resize sticker to 35% ───────────────────────────────────
  emit(`Resizing sticker to ${stickerScale}%...`);

  // Find the Scale field in the right panel and set it
  const scaleFieldPos = await findElementWithRetry(
    '"Scale" label with a percentage slider or number input in the right Transform panel — currently showing "100%"',
    client
  );

  // Triple-click the scale value to select all, then type new value
  await mouse.setPosition(new Point(scaleFieldPos.x + 60, scaleFieldPos.y));
  await sleep(200);
  await mouse.tripleClick(Button.LEFT);
  await sleep(200);
  await keyboard.type(String(stickerScale));
  await keyboard.type(Key.Return);
  emit(`Sticker scaled to ${stickerScale}%`);
  await sleep(600);

  // ── STEP 11: Position sticker near face cam ───────────────────────────
  emit("Positioning sticker at face cam area...");

  // Set Y position to -1745 (lower portion of 9:16 frame near face cam)
  const yFieldPos = await findElementWithRetry(
    '"Y" position number input field in the right Transform panel (next to the X field)',
    client
  );

  await mouse.setPosition(new Point(yFieldPos.x, yFieldPos.y));
  await sleep(200);
  await mouse.tripleClick(Button.LEFT);
  await sleep(200);
  await keyboard.type("-1745");
  await keyboard.type(Key.Return);
  emit("Sticker positioned at Y: -1745");
  await sleep(600);

  // ── STEP 12: Extend sticker to full clip duration ─────────────────────
  emit("Extending sticker to full clip duration...");

  // Find the right edge of the sticker track in the timeline and drag it to match the video clip end
  const stickerTrackEnd = await findElementWithRetry(
    'Right edge/handle of the orange sticker track in the timeline at the bottom of the screen — a small draggable edge',
    client
  );

  const videoTrackEnd = await findElementWithRetry(
    'Right edge of the teal/cyan main video clip track in the timeline — the end of the video',
    client
  );

  // Drag sticker track right edge to video track right edge
  await mouse.setPosition(new Point(stickerTrackEnd.x, stickerTrackEnd.y));
  await sleep(300);
  await mouse.pressButton(Button.LEFT);
  await sleep(200);
  await mouse.setPosition(new Point(videoTrackEnd.x, stickerTrackEnd.y));
  await sleep(300);
  await mouse.releaseButton(Button.LEFT);
  emit("Sticker extended to full duration");
  await sleep(800);

  // ── STEP 13: Human Gate before export ─────────────────────────────────
  if (requestApproval) {
    emit("Requesting Human Gate approval before export...");
    await requestApproval(
      "capcut_export_approval",
      `CapCut edit complete for clip ${clipId}. Preview in CapCut, then approve to export, or send back with notes.`
    );
    emit("Export approved by operator");
  }

  emit("CapCut desktop edit complete — ready for export");

  return {
    success: true,
    projectName: `Argentum-${clipId}`,
    clipPath,
    stepsCompleted: [
      "create_project", "import_clip", "add_to_timeline",
      "set_9_16", "canvas_blur", "auto_reframe",
      "add_sticker", "resize_sticker", "position_sticker", "extend_sticker"
    ]
  };
}
```

---

## STEP 3 — Replace `services/capcut-runner.js`

Replace the entire file content with this thin wrapper:

```js
/**
 * capcut-runner.js
 * Thin wrapper — delegates to capcut-desktop.js for native Mac automation.
 * The old web-based CapCut automation has been replaced.
 */

export { runCapcutDesktopEdit as runCapcutPlaybook } from "./capcut-desktop.js";

// Legacy export kept so any existing imports don't break
export async function runCapcutExportPhase() {
  throw new Error("runCapcutExportPhase is deprecated. Use runCapcutDesktopEdit() from capcut-desktop.js.");
}
```

---

## STEP 4 — Wire Into `server.js`

### 4a. Add import at the top of server.js (near the other service imports):

```js
import { runCapcutDesktopEdit } from "./services/capcut-desktop.js";
```

### 4b. Find the `capcutEditClip` context function wiring in server.js

Search for where the agent tool execution context is built (look for `capcutEditClip` or `capcut_edit_clip` near where tools are passed to `executeTool`). Add or update this function:

```js
async function capcutEditClipHandler(input, { sessionId, emitStep, requestApproval }) {
  // Safety: block practice clips unless explicitly confirmed
  if (input.sourceProvenance && input.sourceProvenance.includes("PRACTICE") && !input.practice_confirmed) {
    throw new Error("CapCut automation blocked: clip is marked PRACTICE MEDIA. Set practice_confirmed: true to proceed.");
  }

  const editSpec = {
    clipPath: input.clipPath || input.clip_path,
    clipId: input.clipId || input.clip_id || "unknown",
    brandSticker: input.brandSticker || process.env.CAPCUT_BRAND_STICKER || "Essentrx",
    stickerScale: Number(input.stickerScale || 35),
  };

  if (!editSpec.clipPath) {
    throw new Error("CapCut automation requires a clipPath in the input");
  }

  return await runCapcutDesktopEdit(editSpec, {
    sessionId,
    onStep: (stepData) => emitStep && emitStep("capcut_step", stepData),
    requestApproval,
    client: anthropic, // reuse existing anthropic client from server.js
  });
}
```

### 4c. Pass the handler into the tool execution context

Find where `executeTool` is called (look for `context.capcutEditClip`) and ensure `capcutEditClip` is set:

```js
const toolContext = {
  // ... existing context fields ...
  capcutEditClip: (input) => capcutEditClipHandler(input, {
    sessionId: session?.id,
    emitStep: (type, data) => broadcastToSession(session?.id, { type, ...data }),
    requestApproval: (gateId, msg) => requestHumanApproval(gateId, msg, session?.id),
  }),
};
```

---

## STEP 5 — Add to `.env.example`

```
# CapCut desktop automation
CAPCUT_BRAND_STICKER=Essentrx
# Note: CapCut desktop must be installed at /Applications/CapCut.app
# First run: grant Accessibility permission to Terminal in System Settings > Privacy > Accessibility
```

---

## THE COMPLETE PLAYBOOK (embedded as reference for the automation)

This is the exact human workflow the automation replicates, observed from screen recording:

### Step 1 — Home Screen
- Screen shows: Left sidebar (Home, Templates, Spaces), large teal "Create project" button, recent projects grid
- Action: Click **"+ Create project"** button

### Step 2 — Blank Project Opens
- Screen shows: Media panel with blue **"+ Import"** button, empty timeline saying "Drag material here and start to create", right panel showing project Details
- Action: Click the blue **"+ Import"** button in the center of the media panel

### Step 3 — File Picker
- macOS file picker opens titled "Select a media resource"
- Navigate: ZYLO → Argentum → CLIPPING OFFICE → Clips → select .mp4 file
- Click the blue **"Import"** button (bottom right of picker)

### Step 4 — Clip in Media Panel (NOT yet on timeline)
- Clip appears as thumbnail in media panel
- Timeline is still empty
- **CRITICAL:** Must hover over the thumbnail to reveal the blue **"+" "Add to track"** button in the bottom-right corner of the thumbnail
- Action: Hover thumbnail → click the blue **"+"** button

### Step 5 — Clip on Timeline
- Clip appears as a teal bar in the timeline
- Preview header changes to "Player-Timeline 01"

### Step 6 — Set 9:16
- Click **"Ratio"** button in the playback controls bar below the preview
- Dropdown appears: Original, Custom, 16:9, 4:3, 2.35:1, 2:1, 1.85:1, **9:16**, 3:4, 5.8-inch, 1:1
- Click **9:16**

### Step 7 — Canvas Blur
- Click clip in timeline to select it
- Right panel: Video tab → Basic sub-tab
- Scroll to **Canvas** section → check the Canvas checkbox → dropdown set to **"Blur"**
- Result: top and bottom black bars fill with blurred video

### Step 8 — Auto Reframe
- Right panel: Video tab → Basic sub-tab
- Find **Auto reframe** → enable checkbox
- Settings: Aspect ratio = **3:4**, Image stabilization = **Default**, Camera moving speed = **Default**
- Click **Apply**
- Toast: "Auto reframe applied" appears in the center of the screen

### Step 9 — Add Brand Sticker
- Click **Stickers** in top toolbar (star/sparkle icon, ~4th from left)
- Left panel: click **Yours** → click **Brand stickers**
- Click the **Essentrx** sticker thumbnail
- Sticker appears on preview + orange sticker track appears in timeline

### Step 10 — Resize Sticker
- Right panel → Transform → Scale
- Set scale to **35%** (triple-click field, type 35, press Enter)

### Step 11 — Position Sticker
- Right panel → Transform → Position → Y field
- Set Y to **-1745** (triple-click field, type -1745, press Enter)
- Sticker sits in the lower face cam area

### Step 12 — Extend Sticker to Full Duration
- In timeline: drag right edge of orange sticker track to match end of the teal video clip

---

## VERIFICATION CHECKLIST

Before finishing, verify each item:

- [ ] `npm install` completes without errors
- [ ] `services/capcut-desktop.js` exists and exports `runCapcutDesktopEdit`
- [ ] `services/capcut-runner.js` exports `runCapcutPlaybook` (pointing to capcut-desktop.js)
- [ ] `server.js` imports `runCapcutDesktopEdit` from `./services/capcut-desktop.js`
- [ ] `capcutEditClip` handler is wired into the tool execution context in server.js
- [ ] `agent-tools.js` `capcut_edit_clip` case calls `context.capcutEditClip(input)` (already exists at line 995 — do not break it)
- [ ] `.env.example` has `CAPCUT_BRAND_STICKER`
- [ ] Practice clips are blocked without `practice_confirmed: true`
- [ ] Human Gate is called before export
- [ ] No API keys hardcoded anywhere — all from `process.env`
- [ ] `node server.js` starts without errors

---

## SAFETY RULES

- **Never automate CapCut export/share to TikTok/Instagram** — export is Human Gate only
- **Never store CapCut login credentials** — operator manages their own session
- **Practice clips** (provenance contains "PRACTICE") are blocked unless `practice_confirmed: true`
- **Human Gate before export** — always call `requestApproval("capcut_export_approval", ...)` before triggering export
- **No global unlocks** — Human Gate approves one clip edit at a time
- **Accessibility permission** is required for `@nut-tree/nut-js` — if it fails, emit a clear error telling the operator to grant permission in System Settings → Privacy & Security → Accessibility

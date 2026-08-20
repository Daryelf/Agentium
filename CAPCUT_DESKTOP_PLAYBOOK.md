# CapCut Desktop Playbook
# Built from live screen recording — Argentum Clipping Office
# Last updated: 2026-07-01

This playbook is based on watching the actual CapCut desktop app (Mac) in use.
Every step reflects what was observed on screen. Use this for computer-use automation.

---

## WHAT THIS WORKFLOW PRODUCES

Input: a 30s .mp4 clip from the Clipping Office watch buffer
Output: a 9:16 vertical video with blur background, auto-reframe tracking the streamer's face, brand sticker positioned at the face cam, ready to export

---

## FULL STEP-BY-STEP

---

### STEP 1 — Open CapCut Home Screen

Launch CapCut desktop app.

**What you see:**
- Left sidebar: Home, Templates, Spaces, Design Studio
- Center: large teal **"Create project"** button
- Below: Video Studio (AI), Record screen options
- "More tools" row: AI video, AI image, Video translator, AI dialogue scene, AI fashion model, Auto reframe
- Bottom: "Projects" grid showing recent projects

**Action:** Click the large **"+ Create project"** button (teal, center of screen)

---

### STEP 2 — Import the Clip

After clicking Create project, a new blank project opens with an empty media panel.

**What you see:**
- Left panel shows the Import area
- Center shows a blue **"+ Import"** button with text "Drag and drop videos, photos, and audio files here"
- Timeline at bottom shows "Drag material here and start to create"
- Right panel shows project Details (Name, Path, Aspect ratio: Original, etc.)

**Action:** Click the blue **"+ Import"** button in the media panel center

A macOS file picker opens titled **"Select a media resource"**

**File picker navigation:**
- Left sidebar locations: Recents, Shared, Desktop, Documents, Downloads, iCloud Drive, OneDrive, ceo, Macintosh HD, **ZYLO**, NO NAME
- Click **ZYLO** → navigate to **Argentum** → **CLIPPING OFFICE** → **Clips**
- Select the target .mp4 file (e.g. `2026-06-30103-56-41-2532-jynxzi-window-1.mp4`)
- Click **Import** button (bottom right of file picker, blue)

**Result:** The clip appears as a thumbnail in the media panel. The preview shows the clip ("Previewing — video"). The timeline is still empty.

---

### STEP 3 — Add Clip to Timeline

The clip is in the media panel but NOT yet on the timeline.

**What you see:**
- Clip thumbnail in media panel with a small **blue "+" button** in the bottom-right corner of the thumbnail
- Hovering the thumbnail shows tooltip: **"Add to track"**
- Timeline below is empty

**Action:** Click the **blue "+" button** on the clip thumbnail (bottom-right corner of the thumbnail)

**Result:** The clip drops onto the main video track in the timeline. The timeline now shows the clip as a teal bar (e.g. `2026-06-30103-56-41-2532-jynxzi-window-1.mp4 00:00:30:01`). The preview panel header changes to "Player-Timeline 01".

---

### STEP 4 — Set Canvas to 9:16

The clip is on the timeline but still in original 16:9 ratio.

**Action:** Click the **"Ratio"** button in the playback controls below the preview (bottom row of the preview area)

A dropdown appears with ratio options:
- Original
- Custom
- 16:9
- 4:3
- 2.35:1 / 2:1 / 1.85:1
- **9:16** ← click this
- 3:4 / 5.8-inch / 1:1

**Action:** Click **9:16**

**Result:** The preview canvas switches to vertical 9:16. The clip now shows as a 16:9 video with black bars top and bottom (letterboxed inside the vertical canvas). The "9:16" indicator appears in the bottom right of the preview.

---

### STEP 5 — Apply Canvas Blur Background

The black bars need to be filled. We use Canvas Blur to extend the video into the bars.

**Action:**
1. Click on the clip in the timeline to select it (it highlights teal)
2. In the right panel, ensure you're on **Video** tab → **Basic** sub-tab
3. Scroll down in the right panel to find the **"Canvas"** section
4. Check the **Canvas checkbox** (it turns teal/blue when enabled)
5. The dropdown below Canvas appears — click it and select **"Blur"**
6. Optionally click **"Apply to all"** button (top right of the Canvas section) to apply to all clips

**What you see after:**
- The preview shows the clip filling the 9:16 frame — the top and bottom areas are now filled with a blurred/extended version of the video instead of black bars
- The clip still shows in its original 16:9 framing in the center, with blurred content padding above and below

---

### STEP 6 — Apply Auto Reframe

Auto reframe uses AI to track the subject (face/player) and keep them centered as the camera "follows" them through the clip.

**Action:**
1. With the clip still selected on the timeline
2. Right panel → **Video** tab → **Basic** sub-tab
3. Scroll up to find **"Auto reframe"** (above Canvas)
4. Click the **Auto reframe toggle/checkbox** to enable it (turns teal/blue)
5. Settings appear:
   - **Aspect ratio:** set to **3:4**
   - **Image stabilization:** leave as **Default**
   - **Camera moving speed:** leave as **Default**
6. Click the **"Apply"** button (right side of the Auto reframe section)

**Result:** A toast notification appears in the center of the screen: **"Auto reframe applied"**. The preview now shows the clip reframed — the face cam / streamer is tracked and kept in view throughout the clip.

---

### STEP 7 — Add Brand Sticker

**Action:**
1. Click **"Stickers"** in the top toolbar (icon looks like a star/sparkle, 4th icon from left)
2. Left panel changes to show sticker categories: **Yours**, Favorites, Brand stickers, Stickers
3. Click **"Yours"** (already selected by default)
4. Click **"Brand stickers"** in the left panel
5. The brand sticker library appears — find the **Essentrx** logo sticker (or your brand sticker)
6. **Click the sticker thumbnail** once to add it to the preview

**Result:**
- The sticker appears on the preview with selection handles (dashed border box around it)
- A new **orange sticker track** appears in the timeline above the main video track
- Right panel switches to show **Stickers | Animation | Tracking** tabs with Transform settings

---

### STEP 8 — Resize the Sticker

The sticker appears at 100% scale by default — too large.

**Action:** In the right panel → **Transform** section → find the **Scale** slider
- Drag the Scale slider left until it reads **35%**

OR: click the scale number field and type `35`

**Result:** Sticker shrinks to 35% of its original size, small enough to sit as a watermark on the clip.

---

### STEP 9 — Position the Sticker

**Action:** Click and drag the sticker directly in the preview window to the desired position.

- Target position: near the face cam area (lower portion of the frame)
- The right panel **Position** fields update as you drag
- Target Y value: approximately **-1745** (negative = toward the bottom of the 9:16 frame)
- X value stays at **0** (centered horizontally)

**Result:** Sticker sits cleanly over the face cam area without blocking the main content.

---

### STEP 10 — Extend Sticker Duration to Full Clip

By default the sticker track may only cover a short portion of the clip.

**Action:** In the timeline, find the orange sticker track. Drag its right edge to the right until it matches the end of the main video clip.

**Result:** The sticker is now visible for the full duration of the clip.

---

### FINAL STATE BEFORE EXPORT

At this point the timeline has two tracks:
1. **Orange sticker track** — full duration, brand sticker at 35% scale, Y position -1745
2. **Teal video track** — 30s clip with Canvas Blur + Auto reframe (3:4, Default settings)

The preview shows a clean 9:16 vertical video with:
- Blurred background filling top/bottom
- Auto-tracked face cam following the streamer
- Brand logo in the lower face cam zone

---

## EXPORT (not yet documented — to be added)

---

## KEY BUTTON LOCATIONS (visual reference)

| Button | Location |
|---|---|
| Create project | Home screen center (large teal) |
| Import (media) | Media panel center (blue +) |
| Add to track | Bottom-right of clip thumbnail (blue +) |
| Ratio selector | Below preview, playback controls bar |
| Canvas (blur) | Right panel → Video → Basic → scroll down |
| Auto reframe | Right panel → Video → Basic → scroll up |
| Stickers | Top toolbar, 4th icon (star/sparkle) |
| Brand stickers | Left panel → Yours → Brand stickers |
| Scale slider | Right panel → Transform → Scale |
| Export | Top right corner (blue "Export" button) |

---

## NOTES FOR AUTOMATION

- The **"Add to track" blue "+"** button only appears when hovering over the clip thumbnail — the agent must move the mouse over the thumbnail first to make it visible before clicking
- **Auto reframe settings must be set before clicking Apply** — once Apply is clicked it processes immediately
- **Canvas and Auto reframe are separate steps** — Canvas fills the black bars visually, Auto reframe handles the subject tracking crop
- The sticker track in the timeline is a separate layer — it can be selected independently of the video clip
- CapCut auto-saves frequently (shown in title bar: "Auto saved: HH:MM:SS")
- **Replay resolution ladder (updated 2026-07-01):** taught clicks are re-located by
  1. visual anchor (template match of the teach-time screenshot patch — `services/capcut-anchor-matcher.js`),
  2. Accessibility semantic label,
  3. stored ratio / window offset,
  4. Claude vision / Human Gate recovery.
  Because of (1), panel scroll position no longer has to match teach-time. Low-confidence matches (< 0.72) are rejected and fall through the ladder instead of guessing.

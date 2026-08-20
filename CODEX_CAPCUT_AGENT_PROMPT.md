# Codex Prompt — CapCut Agent Integration
# Add autonomous CapCut editing to Agent 101 via Chrome browser automation

---

## Context

This prompt upgrades Argentum OS's Agent 101 to autonomously operate capcut.com
using the supervised Chrome browser workspace. The agent follows
`CAPCUT_AGENT_PLAYBOOK.md` step by step, streams progress via SSE, and gates
the export on Human Gate approval.

The existing clipping workflow, state machine, Real/Practice mode separation,
and Human Gate system must not be broken by this change.

---

## Step 1 — Update browser-workspace.js Policy

File: `CLIPPING OFFICE/services/browser-workspace.js`

Find the `DEFAULT_POLICIES` array entry for `capcut.com`:
```js
{ domain: 'capcut.com', policy: 'human_only' }
```

Change it to:
```js
{
  domain: 'capcut.com',
  policy: 'supervised',
  allowed_actions: ['navigate', 'click', 'file_upload', 'type', 'drag', 'screenshot'],
  requires_human_gate: ['export', 'share', 'publish', 'connect_account'],
  notes: 'Agent may operate editor UI. Export and any social sharing require Human Gate approval.'
}
```

Do not change any other domain policy.

---

## Step 2 — Add capcut_edit_clip Tool to agent-tools.js

File: `CLIPPING OFFICE/agent-tools.js`

Add the following tool definition to the exported tools array:

```js
{
  name: "capcut_edit_clip",
  description: `Open capcut.com in the supervised Chrome browser and edit a clip
following the CAPCUT_AGENT_PLAYBOOK. Applies auto-reframe, auto-captions,
hook text overlay, and exports to a local file. Requires Human Gate approval
before export. Streams all steps via SSE. Practice clips require explicit
operator confirmation before upload.`,

  input_schema: {
    type: "object",
    properties: {
      clip_id: {
        type: "string",
        description: "ID of the clip candidate to edit"
      },
      clip_path: {
        type: "string",
        description: "Absolute path to the rendered mp4 file"
      },
      edit_spec: {
        type: "object",
        description: "Edit instructions (aspect_ratio, captions, reframe, zoom, hook_text, platform_target)",
        properties: {
          aspect_ratio: { type: "string", enum: ["9:16", "1:1", "16:9"] },
          captions: {
            type: "object",
            properties: {
              enabled: { type: "boolean" },
              style: { type: "string" },
              word_by_word: { type: "boolean" }
            }
          },
          reframe: {
            type: "object",
            properties: {
              enabled: { type: "boolean" },
              target: { type: "string", enum: ["action_center", "face", "speaker", "manual"] }
            }
          },
          hook_text: { type: "string" },
          platform_target: { type: "string", enum: ["tiktok", "reels", "shorts"] }
        },
        required: ["aspect_ratio"]
      }
    },
    required: ["clip_id", "clip_path", "edit_spec"]
  }
}
```

---

## Step 3 — Implement capcut_edit_clip in the Tool Handler

File: `CLIPPING OFFICE/server.js` (or wherever tool call dispatch lives)

In the tool call dispatch switch/if block, add a handler for `capcut_edit_clip`:

```js
case 'capcut_edit_clip': {
  const { clip_id, clip_path, edit_spec } = toolInput;

  // Safety: block practice clips without explicit confirmation
  const candidate = state.clipCandidates.find(c => c.id === clip_id);
  if (candidate?.isPractice && !toolInput.practice_confirmed) {
    return {
      error: true,
      message: "This is a PRACTICE clip. Set practice_confirmed: true to proceed with upload to CapCut."
    };
  }

  // Verify file exists
  const fs = require('fs');
  if (!fs.existsSync(clip_path)) {
    return { error: true, message: `Clip file not found at: ${clip_path}` };
  }

  // Request Human Gate for CapCut login confirmation (one-time per session)
  const loginGate = await requestHumanApproval({
    action: 'capcut_login_confirmed',
    message: `Agent 101 is about to open capcut.com to edit clip "${clip_id}". Please confirm you are logged in to CapCut, then approve.`,
    clip_id,
    edit_spec
  });

  if (loginGate.status !== 'approved') {
    return { error: true, message: 'CapCut session cancelled by operator.' };
  }

  // Load the playbook
  const playbookPath = path.join(__dirname, '../CAPCUT_AGENT_PLAYBOOK.md');
  const playbook = fs.readFileSync(playbookPath, 'utf8');

  // Run browser automation
  const session = await browserWorkspace.startSession({
    url: 'https://www.capcut.com/create',
    policy: 'supervised',
    domain: 'capcut.com'
  });

  emitSSE({ event: 'capcut_agent_step', step: 'session_start', message: 'CapCut browser session opened', clip_id });

  try {
    const result = await runCapcutPlaybook(session, { clip_id, clip_path, edit_spec, playbook });

    // Human Gate: export approval
    const exportGate = await requestHumanApproval({
      action: 'capcut_export_approval',
      message: `CapCut edit complete for clip "${clip_id}". Review in the browser and approve to export, or send back with notes.`,
      clip_id,
      session_screenshot: await session.screenshot()
    });

    if (exportGate.status !== 'approved') {
      const notes = exportGate.notes || 'No notes provided';
      emitSSE({ event: 'capcut_agent_step', step: 'export_rejected', message: `Export not approved: ${notes}`, clip_id });
      return { success: false, message: `Export blocked: ${notes}` };
    }

    // Trigger export
    await session.exportAndDownload(edit_spec.platform_target);

    // Update state
    const artifact = {
      id: generateId('capcut'),
      type: 'capcut_export',
      clip_id,
      timestamp: new Date().toISOString(),
      edits_applied: result.phasesCompleted,
      export_gate_id: exportGate.id,
      platform_target: edit_spec.platform_target
    };
    state.artifacts.push(artifact);

    // Update candidate status
    if (candidate) candidate.status = 'packaged';

    // Create posting draft
    state.postingDrafts.push({
      id: generateId('draft'),
      clip_id,
      artifact_id: artifact.id,
      platform: edit_spec.platform_target,
      status: 'draft',
      created_at: new Date().toISOString(),
      hook_text: edit_spec.hook_text || ''
    });

    await saveState();
    emitSSE({ event: 'capcut_agent_step', step: 'complete', message: 'CapCut session complete — posting draft created', clip_id });

    return {
      success: true,
      artifact_id: artifact.id,
      message: `CapCut edit complete. Posting draft created for ${edit_spec.platform_target}.`
    };

  } catch (err) {
    const screenshot = await session.screenshot().catch(() => null);
    emitSSE({ event: 'capcut_agent_step', step: 'error', message: `CapCut error: ${err.message}`, screenshot, clip_id });
    return { error: true, message: err.message };
  } finally {
    await session.close();
  }
}
```

---

## Step 4 — Add runCapcutPlaybook Helper

File: `CLIPPING OFFICE/services/capcut-runner.js` (new file)

```js
/**
 * capcut-runner.js
 * Executes the CapCut agent playbook phases against a live browser session.
 * All logic follows CAPCUT_AGENT_PLAYBOOK.md.
 */

async function runCapcutPlaybook(session, { clip_id, clip_path, edit_spec }) {
  const completed = [];

  // Phase 1: Navigate and verify login
  await session.navigate('https://www.capcut.com/create');
  await session.waitFor('.project-list, .editor-page, [data-testid="new-project-btn"]', 15000);
  completed.push('phase_1_open');

  // Phase 2: Import clip
  await session.click('[data-testid="new-project-btn"], button:contains("New project")');
  await session.waitFor('.upload-area, .import-dialog', 10000);
  await session.uploadFile('input[type="file"]', clip_path);
  await session.waitFor('.timeline-clip-block, .clip-thumbnail', 60000);
  completed.push('phase_2_import');

  // Phase 3: Set aspect ratio
  if (edit_spec.aspect_ratio) {
    await session.click('[data-testid="ratio-btn"], .ratio-selector');
    await session.click(`[data-value="${edit_spec.aspect_ratio}"], .ratio-${edit_spec.aspect_ratio.replace(':','-')}`);
    completed.push('phase_3_ratio');
  }

  // Phase 4: Auto reframe
  if (edit_spec.reframe?.enabled) {
    try {
      await session.click('[data-testid="smart-cut"], .auto-reframe-btn, button:contains("Auto reframe")');
      await session.click(`[data-value="${edit_spec.reframe.target}"], .reframe-${edit_spec.reframe.target}`);
      await session.click('.apply-reframe, button:contains("Apply")');
      await session.waitFor('.timeline-clip-block', 30000);
      completed.push('phase_4_reframe');
    } catch (e) {
      emitSSE({ event: 'capcut_agent_step', step: 'phase_4_reframe', status: 'skipped', message: `Reframe skipped: ${e.message}`, clip_id });
    }
  }

  // Phase 5: Auto captions
  if (edit_spec.captions?.enabled) {
    try {
      await session.click('[data-testid="captions-btn"], .auto-caption, button:contains("Auto captions")');
      await session.click('.generate-captions-btn, button:contains("Generate")');
      await session.waitFor('.caption-track, .subtitle-block', 45000);
      completed.push('phase_5_captions');
    } catch (e) {
      emitSSE({ event: 'capcut_agent_step', step: 'phase_5_captions', status: 'skipped', message: `Captions skipped: ${e.message}`, clip_id });
    }
  }

  // Phase 6: Hook text overlay
  if (edit_spec.hook_text) {
    try {
      await session.click('[data-testid="text-btn"], .add-text');
      await session.click('.add-text-track, button:contains("Add text")');
      await session.type('.text-input, .text-editor-field', edit_spec.hook_text);
      completed.push('phase_6_hook_text');
    } catch (e) {
      emitSSE({ event: 'capcut_agent_step', step: 'phase_6_hook_text', status: 'skipped', message: `Hook text skipped: ${e.message}`, clip_id });
    }
  }

  // Phase 7: Preview
  await session.click('.preview-play-btn, [data-testid="play"]');
  await new Promise(r => setTimeout(r, 5000));
  await session.click('.preview-play-btn');
  completed.push('phase_7_preview');

  return { phasesCompleted: completed };
}

module.exports = { runCapcutPlaybook };
```

---

## Step 5 — Add CapCut Agent Tab to Frontend

File: `CLIPPING OFFICE/public/app.js`

In the Agent 101 Studio section, add a "CapCut" tab alongside existing tabs.

The tab should show:
1. A clip selector (dropdown of `clipCandidates` with status `review` or `ready_to_package`)
2. Edit spec builder (aspect ratio, captions toggle, reframe toggle, hook text input, platform select)
3. "Edit in CapCut" button that calls `POST /api/agent/tool` with tool `capcut_edit_clip`
4. SSE step log showing live progress from `capcut_agent_step` events
5. The Human Gate approval card when `capcut_export_approval` is pending

---

## Step 6 — Add API Route

File: `CLIPPING OFFICE/server.js`

Add route (alongside existing agent routes):

```js
app.post('/api/capcut/edit', async (req, res) => {
  const { clip_id, edit_spec } = req.body;

  const candidate = state.clipCandidates.find(c => c.id === clip_id);
  if (!candidate) return res.status(404).json({ error: 'Clip not found' });

  const clip_path = path.join(__dirname, 'data/clips', `${clip_id}.mp4`);

  // Dispatch to Agent 101 as a tool call
  const result = await agent101.callTool('capcut_edit_clip', {
    clip_id,
    clip_path,
    edit_spec
  });

  res.json(result);
});
```

---

## Step 7 — Update .env.example

```
# CapCut Agent
# No API key needed — agent uses supervised Chrome browser session
# Operator must be logged in to capcut.com in the browser before running
CAPCUT_DOWNLOAD_DIR=data/capcut_exports
```

---

## Delivery Checklist

- [ ] `browser-workspace.js` — capcut.com policy updated from `human_only` to `supervised`
- [ ] `agent-tools.js` — `capcut_edit_clip` tool added to tools array
- [ ] `server.js` — tool call handler for `capcut_edit_clip` added
- [ ] `server.js` — `POST /api/capcut/edit` route added
- [ ] `services/capcut-runner.js` — new file created with `runCapcutPlaybook`
- [ ] `public/app.js` — CapCut tab added to Agent 101 Studio UI
- [ ] `.env.example` — `CAPCUT_DOWNLOAD_DIR` added
- [ ] `CAPCUT_AGENT_PLAYBOOK.md` — confirmed present in project root
- [ ] Human Gate gates `capcut_login_confirmed` and `capcut_export_approval` both wired
- [ ] Practice clip guard implemented (blocks upload without `practice_confirmed: true`)
- [ ] SSE events streaming on all phases
- [ ] No CapCut credentials stored anywhere in state or files

---

## Safety Constraints (must not be violated)

- Agent never clicks "Share to TikTok" inside CapCut — export to local only
- Agent never stores CapCut username/password
- Export always requires a Human Gate `capcut_export_approval` with status `approved`
- Practice mode clips are blocked from upload unless `practice_confirmed: true` is explicitly set
- If any phase errors 3 times in a row, the session is aborted and the operator is notified
- The `supervised` policy only allows: navigate, click, upload, type, drag, screenshot — no cookie theft, no credential collection, no form auto-fill for login fields

---

*Feed this file to Codex. It has everything needed to implement autonomous CapCut editing in Agent 101.*

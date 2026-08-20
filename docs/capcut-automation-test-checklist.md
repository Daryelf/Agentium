# CapCut Automation Manual Test Checklist

Use this checklist on the Mac mini after installing CapCut and granting macOS permissions.

## Test 1: Permission Status

1. Start Argentum OS with `npm run dev:local`.
2. Open Clipping Office.
3. Open the CapCut Workspace panel.
4. Confirm the status panel shows:
   - CapCut installed
   - CapCut running
   - Accessibility
   - Screen recording
   - Automation
   - Current active app
   - Last automation action
   - Last error
5. If a permission is missing, click its permission button and enable Argentum OS or the terminal/electron process in System Settings > Privacy & Security.

## Test 2: Open CapCut

1. Click `Open CapCut`.
2. Confirm CapCut opens.
3. Return to Argentum OS and click `Refresh`.
4. Confirm CapCut running shows `yes`.

## Test 2A: Park CapCut

1. Click `Park CapCut`.
2. Confirm CapCut moves to a fixed side/corner workspace.
3. Confirm the CapCut Workspace status card shows `parked`.
4. Keep working in another app and confirm Argentum does not keep CapCut frontmost except during Teach Mode or replay.

## Test 3: Tiny Teach Mode Macro

1. Click `Start Recording`.
2. In CapCut, click somewhere safe.
3. Press a harmless shortcut, such as `command + 1` if it is safe in the current CapCut screen.
4. Return to Argentum OS.
5. Click `Stop Recording`.
6. Enter a macro name.
7. Click `Save Macro`.
8. Confirm the Macro Library shows the saved macro.

## Test 4: Replay Tiny Macro

1. Select the tiny macro in the Macro Library.
2. Click `Replay Macro`.
3. Confirm CapCut comes to the front.
4. Confirm the replay status reaches complete or stops with a clear error.
5. Press `command + option + escape` if the replay needs emergency stop.

## Test 5: Train Vertical Workflow

1. Prepare one sample video file.
2. Prepare one sample sticker file.
3. Enter:
   - `sourceVideoPath`
   - `stickerPath`
   - `projectName`
   - `outputProjectFolder`
4. Click `Train This Workflow`.
5. Manually perform the workflow once in CapCut:
   - import the video
   - place it on the timeline
   - set the canvas to 9:16
   - use auto frame or auto reframe if available
   - create the blurred background layer
   - keep the foreground clear
   - add the sticker near bottom center
   - save the project
   - do not export
6. Return to Argentum OS and click `Save Trained Workflow`.

## Test 6: Run Trained Workflow

1. Keep the same workflow inputs or choose a new valid video/sticker/project folder.
2. Click `Run This Workflow`.
3. Confirm the panel shows:
   - current step
   - last action
   - macro replay status
   - recovery status
   - latest screenshot
   - logs
4. Confirm checkpoints and logs are saved under the local app data CapCut macro folder.

## Test 7: Recovery Behavior

1. Slightly change CapCut's starting UI so one recorded click is not exactly where it was during training.
2. Run the workflow.
3. Confirm the system either:
   - recovers using visible UI/accessibility/OCR evidence, or
   - stops with the exact failed step.
4. Confirm it does not click random destructive dialogs.

## Test 8: No External Actions

1. During the workflow, confirm no export, upload, publish, share, or posting action happens.
2. If CapCut shows a destructive or external-action dialog, confirm Argentum stops and logs it.

## Test 9: Logs And Screenshots

1. Open the workflow panel after a run.
2. Confirm the latest screenshot preview appears.
3. Confirm logs include timestamps, run ID, workflow name, step/action, status, and errors when present.
4. Confirm screenshot permission errors are shown clearly if Screen Recording is missing.

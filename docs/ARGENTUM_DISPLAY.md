# Argentum Monitor 3 Display

## Architecture

The Mac Argentum Hub remains the backend owner. The normal desktop UI and the dedicated display are separate clients:

```text
Argentum Hub on Mac
  |-- normal desktop UI
  |-- /display command display
  |-- future ESP32 controller API
```

The display is mounted at `/display` and served from `apps/display`. It is not a copy of the desktop app. It reads sanitized Hub projections from existing state, Clipping Office, Stock Office, Agent 101, and Human Gate APIs.

## Display State

Navigation state is stored in `state.display` inside the existing Argentum state file. The Hub owns this state:

```json
{
  "view": "home",
  "connected": true,
  "lastCommandAt": null,
  "controllerConnected": false,
  "config": {
    "enabled": true,
    "displayMode": "external",
    "preferredDisplay": 3,
    "fullscreen": true,
    "kiosk": true,
    "alwaysOnTop": true,
    "preventClose": true,
    "defaultView": "home"
  }
}
```

Allowed views are `home`, `agents`, `agent-1010`, `clipping`, `trading`, `human-gate`, and `activity`.

## Real-Time Protocol

`GET /api/display/events` is an authenticated Server-Sent Events stream.

Events:

- `display.snapshot`: full sanitized display payload on connect.
- `display.navigate`: lightweight navigation delta.
- `display.controller`: controller heartbeat/status delta.
- `display.heartbeat`: Hub heartbeat.
- `argentum.state_changed`: lightweight counts/status delta after Hub state writes.

The browser display automatically reconnects, keeps the last known UI visible, and shows `HUB ONLINE`, `RECONNECTING`, or `HUB OFFLINE`.

## APIs

- `GET /api/display/state`: current display state plus sanitized command snapshot.
- `POST /api/display/navigate`: body `{ "view": "clipping" }`.
- `GET /api/hardware/display`: current display state for controller clients.
- `POST /api/hardware/display/heartbeat`: body `{ "deviceId": "argentum-controller-01", "status": "online" }`.
- `POST /api/hardware/display/command`: body `{ "deviceId": "argentum-controller-01", "action": "navigate", "target": "trading" }`.

Unsupported hardware actions fail closed. The hardware API does not execute arbitrary commands and does not approve, reject, trade, publish, spend, or change accounts.

## Launching Monitor 3

Browser:

```bash
open http://127.0.0.1:5173/display
```

Electron:

- Use `Argentum OS -> Open Monitor 3 Display`.
- Or launch with `--display`.
- Or set `ARGENTUM_DISPLAY_AUTO_OPEN=1` before starting the local app.

Electron stores window placement preferences in `~/Library/Application Support/Argentum OS/monitor-display-config.json`. It prefers the saved display signature, then the configured `preferredDisplay`, then an external display, then the primary display.

By default the Electron display window is fixed for Monitor 3 use: borderless, physical-screen-sized, not movable, not resizable, not minimizable, hidden from the task switcher where supported, and always above normal windows on that display. Argentum uses a screen-saver-level display shield instead of relying only on native macOS fullscreen Spaces, then reasserts the Monitor 3 bounds and topmost mode twice per second. If macOS or another app tries to move, hide, resize, or switch over it, Argentum pulls the display window back over Monitor 3.

The normal escape hatch is quitting Argentum OS. For development only, `monitor-display-config.json` can set `kiosk`, `alwaysOnTop`, or `preventClose` to `false` before launching the app.

## ESP32 Later

The ESP32 should call only the `/api/hardware/display/*` namespace. Pairing is deliberately physical:

1. ESP32 calls `POST /api/hardware/display/pairing/request` with `{ "deviceId": "argentum-controller-01", "label": "Monitor 3 touchscreen" }`.
2. Monitor 3 shows the pairing code on `/display`.
3. The ESP32 shows the same code and the operator presses **Accept** on the ESP32 screen.
4. ESP32 calls `POST /api/hardware/display/pairing/accept` with `{ "deviceId": "argentum-controller-01", "pairingCode": "123456" }`.
5. The Hub returns a one-device `deviceToken`. Firmware stores it and sends it with future `navigate`, `return_home`, `heartbeat`, and `status` calls.

Hardware navigation without a paired `deviceToken` is rejected. Approval/reject/open-item actions need separate Human Gate-specific design before they are enabled.

## Relevant Files

- `server.js`: display state, display APIs, SSE, and `/display` static mount.
- `apps/display/index.html`: command-display shell.
- `apps/display/display.css`: full-screen command-center styling.
- `apps/display/display.js`: SSE client, reconnect handling, and view rendering.
- `desktop/main.js`: separate Monitor 3 Electron window and display placement config.
- `tests/local-desktop.test.js`: authenticated display and hardware API regression coverage.

# Plug-and-play gamepads

Xbox / Microsoft XInput, DualShock 4 and DualSense use the original PlayStation
button positions automatically. Connect by USB or pair with the operating
system over Bluetooth, then press a button so the browser exposes the device.
No controller mapping screen or external mapping software is required for
recognized controllers.

The shared browser adapter handles local engine menus/gameplay, individual-camera
online play and shared-screen guest controls. It prefers the browser's standard
mapping; known raw Windows Sony HID layouts are normalized separately. The raw
fallback recognizes Sony 054c products 05c4/09cc/0ba0 (DS4) and 0ce6/0df2
(DualSense/Edge), including Chromium and Firefox identifier formats. Unknown
unmapped layouts are left alone rather than guessing button positions.

Mappings follow the [Gamepad API standard](https://w3c.github.io/gamepad/#remapping)
and the raw Sony layout documented in
[Chromium's Windows mapper](https://github.com/chromium/chromium/blob/main/device/gamepad/gamepad_standard_mappings_win.cc).

## Behavior

- Local browser play assigns up to four connected controllers to stable slots.
  Unplugging one does not move the others; reconnecting fills a free slot.
- Online play uses the controller most recently used on that computer. An idle
  controller in the first browser slot does not mask another active controller.
  Controller input always goes to the server-assigned player.
- Gamepad activity focuses the game automatically while a visible page is open,
  without stealing focus from a text field. Keyboard controls remain available.
- Browser local play leaves the keyboard on its chosen slot (Player 1 by
  default), so connecting a controller does not silently move the keyboard.
- Disconnects release buttons/sticks. Hidden-page sampling supplies neutral
  controls. Browser sticks have a 12% dead zone and retain analog steering.
- Browsers poll the shared adapter immediately before the original local engine
  step or the existing online input sample; no additional input timer or
  controller-driven simulation path is introduced.
- Original two-motor rumble is relayed to compatible browser actuators with
  bounded refreshes. Online rumble belongs only to the local player's slot.
- Native desktop play retains SDL's XInput and Sony controller drivers. The
  startup/hot-plug path records and releases device-to-slot ownership, avoiding
  duplicate opening of a device already found during startup enumeration.

| Original action | Xbox / XInput | DualShock 4 / DualSense |
| --- | --- | --- |
| Steer / navigate | Left stick / D-pad | Left stick / D-pad |
| Accelerate / confirm | A | Cross |
| Brake / reverse | X | Square |
| Item / back | B | Circle |
| Change camera | Y | Triangle |
| Hop / drift | LB / RB | L1 / R1 |
| Pause / start | Menu / Start | Options |
| Select / copy lobby code | View / Back | Share / Create |
| L2 / R2 | LT / RT | L2 / R2 |
| L3 / R3 | Stick clicks | Stick clicks |

## Files modified

| File | Change |
| --- | --- |
| `web/input.js` | Shared standard/raw-Sony normalizer, last-active controller selection, stable local slots, safe polling, focus handling and local engine pad bridge. |
| `web/app.js` | Samples mapped controllers before each local engine step and initializes the browser bridge before engine startup. |
| `web/online-v2-client.js` | Uses the shared controller reader alongside keyboard input; focuses the game on controller activity and disables duplicate native browser gamepad handling. |
| `web/online.js` | Uses the same automatic mappings and active-controller selection for shared-screen guests. |
| `web/index.html` | Adds controller families and common button actions to the existing Tailwind control help. |
| `platform/native_input.c` | Adds the WASM-only local gamepad and classic rumble bridges with keyboard merging/remote-pad priority; fixes native device ownership on open, close and reinitialization. |
| `web/tests/input.test.mjs` | Covers physical button masks for each family, raw Sony triggers/sticks/hat, standard mapping precedence, safe unknown pads, multiple devices, reconnects and bounded rumble. |
| `tests/remote_input_smoke.c` | Exercises virtual Xbox/DS4/DualSense controllers through SDL, including triggers, analog steering, duplicate add events and removal/reconnection. |
| `web/online-v2-engine-probe.mjs` | Adds virtual browser gamepad profiles for real local/online engine flows, analog menu navigation, automatic focus, guest controller switching and driving. |
| `docs/WEB.md` | Documents automatic connection, player ownership and Xbox/PlayStation button names. |
| `README.md` | Adds the plug-and-play entry point and links this guide. |

## Files created

| File | Description |
| --- | --- |
| `docs/GAMEPAD_CHANGES.md` | Controller behavior, file summary, validation and physical-device retest instructions. |

## Verification and live retest

All four production/private WASM builds and the native x86 Debug build pass.
All 41 web tests and all three native CTests pass. Native controller tests use
SDL virtual devices; browser tests inject Gamepad API reports and run the real
game engine. Reports and screenshots are under `.cache/online-v2/gamepad-*`.

The two-browser controller check passed all five standard/raw layouts in local
menus and guest character selection, then completed race startup, driving,
fullscreen and pause/resume with a 200 ms upstream / 220 ms downstream guest
and 25 ms jitter. Both players' acceleration reached the authority (143/137
observed driving frames). Unplugging while accelerating released the guest's
controls; reconnecting at another browser index resumed control without a reload.

The independent 300-frame latency regression passed with 50 ms upstream,
70 ms downstream, 15 ms jitter and every 31st input dropped. Local prediction
processing p95 was 4.7/4.4 ms; maximum reconciliation was 25.7/24.5 ms on this
machine. These are CPU timings, not end-to-end controller-to-display latency.

With the existing Playwright/Chrome environment configured, rerun with:

```sh
node web/online-v2-engine-probe.mjs .cache/online-v2/gamepad-engine.json race --gamepads --manual-disc --slow-guest
node web/online-v2-browser-probe.mjs .cache/online-v2/gamepad-latency.json --delayed
```

Rebuild/restart the Node server, hard-refresh both browsers, and create a fresh
lobby after updating the native/WASM build. Physically check each controller by
USB and Bluetooth on the target browsers: connect before/after starting, use
menus and character selection, steer/drift/pause, unplug while accelerating,
reconnect and resume. Also check several controllers in local multiplayer and
one controller per online client. Automated virtual-device tests do not verify
the actual USB/Bluetooth drivers or hardware.

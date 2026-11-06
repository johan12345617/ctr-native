# Engine online menu, multiplayer modes and automatic disc loading

The original game main menu now offers Online. Its Create Lobby, Join Lobby,
code editor and waiting room are drawn with the game engine's font/primitives
and accept keyboard or controller input. The host starts the session when both
players are ready, then chooses Race, Cup or Battle. The original character,
track/lap, cup and battle settings screens handle setup; original scoring,
results, retries and cup advancement handle continuation.

This integration supports two human players. Each owns their character and
battle team. Shared setup and result-menu choices belong to the host. The
individual-camera and solo racing HUD remain active, including the left minimap.
Per-player result comments/readiness clears are routed to their own cameras;
results no longer shrink the online viewports as though they were split-screen.

Run `npm --prefix web run start:online-v2`, refresh both browsers, start the game
and choose Online. The web Online button is a shortcut into the engine menu.
C / Enter confirms in the lobby, V backs out, Space / Select copies the code.
Code entry accepts typing or left/right to select a digit and up/down to edit.
During original menus, use the usual game controls. Each player confirms their
own initial result/quip screen before the host chooses retry/change/quit.

On this computer the launcher automatically reads the repository's
`assets/ctr-u.bin` through `/local-disc` (the requested checkout resolves to
`D:\Proyectos\ctr-native\assets\ctr-u.bin`). Browsers cannot open a Windows
path directly. The server streams only that configured file, only to loopback
connections with a loopback Host and same-origin requests. Remote players still
select their own disc. Neither disc bytes nor checkpoints enter online packets.

## Scheduling and latency

Local browser play advances the same original engine through a bounded external
step API. This allows the local lobby renderer to stop cleanly before a fresh,
synchronized module takes over the canvas. Local saves keep their existing
IndexedDB mount and are flushed before handoff. Native desktop play keeps its
ordinary scheduler.

Waiting rooms reserve a code without allocating a game simulation worker. Once
the host starts, the authority and clients boot the original mode menu and must
match build/tick/diagnostics before the coordinator advances the session.

Driving retains local prediction and rollback. Menu, pause, result and loading
boundaries use confirmed controls; prediction stops at the first unsafe step
and resumes from a new checkpoint after the race is ready. A same-level restore
can undo a speculative load request before loading advances. Menu inputs target
one future tick and suppress duplicate sends, preserving the bounded traffic
budget even when the network lead exceeds the eight-tick prediction window.
The later guest-input correction is documented in
[ONLINE_V2_GUEST_INPUT_CHANGES.md](ONLINE_V2_GUEST_INPUT_CHANGES.md).

Protocol 4 adds diagnostic coverage for setup, character choices, cup progress,
teams, lives, scores and standings. Frames contain 1,856 observation bytes;
two-player binary frames are 1,892 bytes. Static track thumbnails replace
wall-clock video previews during synchronized menus. This avoids tying shared
menu state to asynchronous media decoding.

## Files created

| File | Description |
| --- | --- |
| `platform/native_online_menu.c` | Implements the native Online option, Create/Join/code editor/waiting room, local browser step scheduler, menu text and browser bridge exports. Keeps the existing original mode menu flow. |
| `web/online-v2-engine.js` | Transfers lobby lifecycle events between the engine and existing online client, handles native code entry/copy/cancel, and coordinates clean runtime handoff/recovery. |
| `web/online-v2-engine-probe.mjs` | Runs the real two-browser engine flow through keyboard input, automatic disc loading, separate character/team ownership, original mode selection, driving, fullscreen and pause/resume. Optional private fixtures cover visible results/continuation. |
| `web/online-v2-modes-probe.mjs` | Compares an authority with two predicted worlds through original Race/Cup/Battle menus, results/retry and all four cup tracks, including deliberately wrong predictions. |
| `docs/ONLINE_V2_ENGINE_MENU_CHANGES.md` | Records this file summary, behavior, boundaries, verification and live test instructions. |

## Files modified

| File | Description |
| --- | --- |
| `include/platform/native_online.h` | Declares scheduled-shell, menu/lobby, menu-flow and prediction-safety APIs. |
| `platform/native_online.c` | Boots synchronized menu-flow rooms, installs socket-owned menu controls, permits own-character/team input, reports loading/prediction safety and permits restoring the prior same-level boundary checkpoint. Includes the native menu implementation. |
| `platform/native_online_world.c` | Adds semantic diagnostics for multiplayer setup, cup scores/advancement, battle teams/lives/scores and standings. |
| `platform/native_online_fixtures.c` | Adds private transition fixture 109. It supplies finished drivers or a final battle hit to original results logic; it does not choose scores, menus or next tracks. Production has no fixture API. |
| `platform/native_platform.c` | Lets externally scheduled local menus use the same controlled VBlank/Asyncify behavior as online stepping. |
| `main.c` | Returns control to the external browser scheduler for a configured local shell or online runtime. |
| `game/230/MM_MenuFlow.c` | Adds the native Online hook and fixed two-player online mode entry while preserving ordinary local menu behavior. |
| `game/230/MM_TrackSelect.c` | Uses deterministic static thumbnails during online selection, retaining normal local video previews. |
| `game/RECTMENU.c` | Resolves native Online labels without changing retail language-table sizes or PS1 struct layouts. |
| `game/UI/UI_VsQuip.c` | Routes each online player's result comment to that player's camera while continuing all original shared state updates. |
| `game/UI/UI_VsWait.c` | Routes result statistics and readiness clears to their owning cameras while still requiring each original player confirmation. |
| `game/225.c` | Retains full-size online cameras behind shared results instead of collapsing the original losing split viewport. |
| `web/app.js` | Runs local browser stepping, hands off/stops/restores local modules, auto-loads the local disc, connects the engine bridge and preserves fullscreen focus. |
| `web/index.html` | Renames the web shortcut Online; the previous browser overlay remains hidden while the engine owns the lobby UI. Web styling remains Tailwind. |
| `web/online-v2-client.js` | Adds deferred lobby configuration and shell handoff, supports confirmed menu input during prediction barriers and bounds redundant menu traffic. |
| `web/online-v2-runtime.mjs` | Configures menu-flow modules, exposes prediction safety and supports the private transition fixture. |
| `web/online-v2-prediction.mjs` | Suspends speculative checkpoints/steps at unsafe boundaries and resumes after confirmed loading, with same-level correction support. |
| `web/online-v2-protocol.mjs` | Defines protocol 4, 1,856-byte observations and validated two-player menu-flow configuration. |
| `web/online-v2-server.mjs` | Adds lightweight waiting rooms, host-only deferred launch, automatic start after both engines match and normal cleanup before/after worker creation. |
| `web/online-v2-worker.mjs` | Adds read-only menu diagnostics for trusted mode probes. |
| `web/server.mjs` | Serves the engine adapter and streams the exact local disc through the loopback-only route. |
| `cmake/Web.cmake` | Packages the engine adapter and tracks its browser build dependency. |
| `web/online-v2-lobby-probe.mjs` | Keeps the existing lobby test command as an alias to the engine-driven regression. |
| `web/tests/online-v2.test.mjs` | Tests deferred launch/readiness, pre-start cancellation, allowed menu configurations and bounded menu traffic. |
| `web/tests/online-v2-prediction.test.mjs` | Exercises confirmed menus/loading boundaries and prediction resumption. |
| `web/tests/server.test.mjs` | Tests automatic disc streaming, HEAD metadata and rejected cross-origin/non-loopback Host requests. |
| `web/package.json` | Adds engine/mode probe commands without new runtime dependencies. |
| `README.md`, `docs/WEB.md`, `docs/ONLINE_V2.md` | Document native Create/Join, original mode flow, automatic local disc loading, current protocol and test commands. |

## Verification and live retest

Reports and screenshots are stored under `.cache/online-v2/engine-*`.
The web suite covers 32 protocol, input, prediction, lifecycle and disc-route
tests. The private mode probe covers Race retry, all four Wumpa Cup tracks
(`3 → 4 → 2 → 14`), cup scoring/finalization and Battle scoring/results/retry.
Every authoritative observation is compared with both predicted worlds.

Final verification on 2026-11-06 passed:

- Production browser/headless WASM and both private probe builds.
- Native x86 Debug build and all three native CTests; all 32 web tests.
- A 600-tick delayed-confirmation prediction regression with no authoritative
  divergence.
- Mode simulations: Race results/retry (864 ticks), all four Wumpa Cup tracks,
  final podium and return to the main menu (3,534 ticks), and Battle
  scoring/results/retry (864 ticks). Both predicted clients matched every
  authoritative observation, including deliberate prediction corrections.
- Real two-context Chromium checks for automatic disc loading, native
  Create/Join/code entry, waiting, separate character/team ownership, original
  Race/Cup/Battle setup, individual cameras, fullscreen and pause/resume.
  The private Race browser check also confirmed original results, quitting,
  leaving, creating another room and cancellation without a page reload.
- An independent 300-frame two-browser latency regression with 50 ms upstream,
  70 ms downstream, 15 ms jitter and every 31st input dropped. Measured RTT was
  approximately 148–150 ms; local prediction processing p95 was 3.7/3.8 ms,
  reconciliation p95 was 13.9/14.1 ms, and maximum reconciliation was 26.8 ms.
  Prediction processing is a CPU measurement, not end-to-end input-to-display
  latency. Both clients retained their own cameras and visible race scenes.

Use the production builds for a live two-device test. Create/join from the
engine, select different characters, and test Race, a complete Cup and Battle
with your preferred rule set. Confirm results on both clients before continuing.
Check shared settings, team ownership, fullscreen, pause/resume, changing modes,
leaving/recreating a lobby, audio, gamepads and control delay. The remaining
player-count/mode-coverage and network-hardening milestones are not declared
complete by this integration.

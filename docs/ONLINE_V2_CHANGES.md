# Online 2.0 prototype change summary

These changes implement the assessment's feasibility and two-player prediction
prototypes. They do not complete the six-stage Online 2.0 release. The tables
below describe the phase 1 foundation; see the
[phase 2 file-by-file summary](ONLINE_V2_PHASE2_CHANGES.md) for the additional
prediction, correction, exact-tick input, and graphical latency work.
See [ONLINE_V2.md](ONLINE_V2.md)
for commands, measured results, protocol details, and remaining work.

## Files created

| File | Purpose |
| --- | --- |
| `include/platform/native_online.h` | Declares the externally stepped simulation, observation, checkpoint, and lifecycle API. |
| `platform/native_online.c` | Boots a seeded 2–4 player VS race, installs controlled inputs, advances exact ticks, serializes pointer-free observations, and saves/restores same-worker checkpoints plus external clocks. |
| `platform/native_renderer_headless.c` | Supplies CPU VRAM and renderer entry points without creating a window or issuing GPU commands, while preserving the original game's display-list execution. |
| `cmake/OnlineV2.cmake` | Builds the original game as a CommonJS Node/WASM worker with an ephemeral filesystem and local asset mounting. |
| `web/online-v2-protocol.mjs` | Defines protocol version, NTSC tick pacing, configuration/control validation, observation size, and diagnostic comparison/hash helpers. |
| `web/online-v2-runtime.mjs` | Provides the shared Node/browser adapter, tick-order checks, observation reads, checkpoint timing, and runtime cleanup. |
| `web/online-v2-worker.mjs` | Runs the real C/WASM simulation inside an independent worker, mounts local assets, and processes initialization, step, save, and restore commands. |
| `web/online-v2-simulation.mjs` | Manages worker requests, sequential execution, timeouts, failure propagation, and termination. |
| `web/online-v2-server.mjs` | Adds the opt-in authoritative coordinator: bounded sessions, socket-owned slots, build/state gates, confirmed input frames, diagnostic divergence detection, and match cleanup. |
| `web/online-v2-client.js` | Runs a local graphical game in each browser, supplies keyboard/gamepad controls, follows confirmed authority ticks, and reports observation mismatches. |
| `web/online-v2-probe.mjs` | Runs one authority and two independent Node/WASM clients, checks forward/replayed observations and driving coverage, and writes timing/size reports. |
| `web/online-v2-browser-probe.mjs` | Optionally exercises the real authority with two Chromium/WebGL2 clients using test-only Playwright. |
| `web/tests/online-v2.test.mjs` | Tests ownership, tick/sequence validation, lifecycle cleanup, initialization failures, configuration limits, build/observation gates, stale inputs, and endpoint isolation. |
| `docs/ONLINE_V2.md` | Documents building/running the prototype, measurements, diagnostic limits, and the remaining release requirements. |
| `docs/ONLINE_V2_CHANGES.md` | Provides this file-by-file implementation summary. |

## Files modified

| File | Change |
| --- | --- |
| `CMakeLists.txt` | Adds the Emscripten-only `CTR_HEADLESS` build option, selects the renderer configuration, and fingerprints common simulation sources for client/authority identity checks. |
| `CMakePresets.json` | Adds configure/build presets for `online-v2-release` in `build-online-v2/`. |
| `build-web.ps1` | Accepts `-Headless` to select the simulation worker target. |
| `build-web.sh` | Accepts `--headless` to select the same target on Linux/macOS. |
| `cmake/Web.cmake` | Keeps externally stepped runtimes alive, exports heap allocation/access helpers, and copies the browser adapter and shared protocol/runtime files. |
| `main.c` | Includes the prototype platform bridge, selects the CPU renderer for headless builds, and leaves scheduling to the caller when explicitly configured. |
| `game/MAIN/MainMain.c` | Exposes one complete loop iteration while retaining the ordinary native main loop and the PS1 entry path. |
| `game/MAIN/MainFrame.c` | Uses controlled `0x20` elapsed game time only when the prototype is active. |
| `platform/native_platform.c` | Emits unpaced, exact VBlanks for controlled simulation; bypasses graphics initialization in headless builds; prevents SDL swap-time Asyncify unwinding during an externally stepped browser tick. |
| `platform/native_input.c` | Allows the headless worker to use installed controller snapshots without initializing physical gamepad/haptic devices. |
| `platform/native_audio.c` | Keeps SPU/XA simulation available in the headless worker without opening an output device. |
| `web/server.mjs` | Routes the opt-in `/online-v2` endpoint, serves the browser modules, and terminates prototype workers during server cleanup. Existing `/lobby` streaming remains the default. |
| `web/package.json` | Adds the `online:v2:probe` command; production dependencies are unchanged. |
| `README.md` | Links the prototype guide and distinguishes it from the working streaming launcher. |
| `docs/ONLINE_V2_ASSESSMENT.md` | Updates implementation status and assessment limits to reference the measured prototype. This document already existed as an untracked user file before implementation. |

## Verification

- Release WebAssembly headless and browser builds.
- 15 passing Node protocol, input, lifecycle, and existing streaming-lobby tests.
- Native MSVC x86 Debug build and 3 passing CTest checks.
- Real-game probes with 2 and 4 human slots: 600 forward ticks and 600 restored
  ticks across three independent workers, including 480 moving frames per run.
- Two real Chromium/WebGL2 clients matching the authority's initial observation
  and 300 confirmed frames.
- `git diff --check`.

No launcher markup or styles were changed. Existing Tailwind styling remains
in place. Generated binaries, reports, dependency caches, and build logs remain
in ignored build/cache directories.

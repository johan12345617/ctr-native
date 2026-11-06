# Online 2.0 phase 3 change summary

Adds the two-player power-up synchronization prototype and makes latency a
measured development gate. Existing game code remains responsible for item
selection, firing, projectile movement, collisions, damage and effect timers.
Authoritative controls correct the retained local world through rollback.
See [the guide, measurements and required live testing](ONLINE_V2.md).

## Files created in this phase

| File | Changes |
| --- | --- |
| `platform/native_online_world.c` | Adds semantic instance/thread-tree observations, projectile/mine ownership and target state, damage/crate counters, shields/masks/global timers and selected moving-hazard fields; excludes host pointers and padding. |
| `platform/native_online_fixtures.c` | Adds private one-time inventories, contested crate callbacks and controlled bomb-impact placements, compiled only with `CTR_ONLINE_PROBES`. Production builds contain no injection API. |
| `web/online-v2-latency.mjs` | Measures RTT/jitter with bounded smoothing and calculates a 2–8 tick prediction lead. |
| `web/online-v2-powerups-probe.mjs` | Runs 44 normal/juiced inventory and interaction cases against an authority and two delayed predicted clients; requires convergence and observed effects, expiry, crate ownership or impacts. Exports shared coverage checks for the browser probe. |
| `web/online-v2-world-probe.mjs` | Verifies 420 ticks of world/hazard advancement and delayed rollback on all 18 VS tracks. Does not claim a physical collision with every hazard. |
| `docs/ONLINE_V2_PHASE3_CHANGES.md` | Records this phase's files, checks, measurements and remaining acceptance work. |

## Files modified in this phase

| File | Changes |
| --- | --- |
| `CMakeLists.txt` | Adds the disabled-by-default `CTR_ONLINE_PROBES` compile option. |
| `CMakePresets.json` | Adds separate headless and graphical private-fixture build directories/presets. |
| `build-web.ps1` | Adds `-Probes` alongside `-Headless` and reports the selected private build. |
| `build-web.sh` | Supports `--probes`/`--headless` in either order and rejects unknown flags. |
| `cmake/Web.cmake` | Copies the latency module into graphical builds. |
| `include/platform/native_online.h` | Declares the local rollback-capture profile query. |
| `include/platform/native_gpu.h` | Declares the small rollback GPU metadata capture/restore API. |
| `platform/native_online.c` | Selects the rollback profile for slots 1–9, includes expanded world diagnostics, gates private fixtures and uses distinct protocol-3 production/probe build identities. |
| `platform/native_checkpoint.c` | Skips relocation scanning when code and every recorded address range match the live runtime; retains relocation for changed addresses. |
| `platform/native_gpu.c` | Captures draw/display metadata without framebuffer readback for race rollback; suppresses intermediate native raster submission. |
| `platform/native_state.c` | Selects full versus rollback GPU state within the existing state bundle. |
| `platform/native_platform.c` | Skips scene clear/submission/presentation during intermediate replay while preserving the original game/display-list path. |
| `platform/native_audio.c` | Retains the small XA decoder ring for local rollback and reuses identical resident compressed track data. Keeps the full restore path for other tracks/ordinary snapshots. |
| `web/online-v2-protocol.mjs` | Advances to protocol 3, expands observations to 1,600 bytes and adds strictly bounded binary frame encoding/decoding. |
| `web/online-v2-runtime.mjs` | Adds private fixture setup only when the optional test export exists. |
| `web/online-v2-prediction.mjs` | Lets prediction bursts advance intermediate ticks without presentation. |
| `web/online-v2-client.js` | Decodes binary confirmations, measures RTT/jitter, adapts prediction lead, presents only the last burst tick and reports input-to-prediction/reconciliation software timings. |
| `web/online-v2-server.mjs` | Sends compact authoritative frames, answers bounded application pings and accepts fixtures only from trusted harness configuration. Client configuration cannot select a fixture. |
| `web/online-v2-worker.mjs` | Allows the private harness to initialize a controlled inventory/impact case before comparing worlds. |
| `web/online-v2-browser-probe.mjs` | Decodes real binary traffic, adds fixture/track/build selection, collects software timing and wire-byte metrics, and enforces latency/input-acceptance budgets. |
| `web/tests/online-v2.test.mjs` | Adds binary framing/malformed packet, RTT/jitter, ping, private-fixture isolation and production-runtime rejection checks. |
| `web/server.mjs` | Serves the additional latency module through the existing file allowlist. |
| `web/package.json` | Adds power-up/world probe commands without new dependencies. |
| `README.md` | Adds the power-up prototype to the Online 2.0 status description. |
| `docs/ONLINE_V2.md` | Documents protocol 3, rollback optimizations, fixture commands, budgets, measurements and required live checks; keeps phase 1/2 metrics labeled historically. |
| `docs/ONLINE_V2_ASSESSMENT.md` | Updates prototype status and remaining release gates. This was an existing user-provided file. |

## Verification and measurements

- Production and private headless/browser release builds succeeded.
- 25 Node protocol, prediction, input ownership, lifecycle and streaming checks passed.
- Native MSVC x86 Debug build and 3 CTest checks passed.
- 44 power-up cases × 420 authority ticks and two predicted clients converged.
  Cases require actual observed effects; IDs 10/11 exercise stacked ammunition.
  Legacy spring ID 5 is included but is normally replaced by turbo in selection.
- All 18 VS tracks passed 420-tick delayed world rollback checks.
- The 600-tick driving prediction regression converged after six missed inputs.
- Four-player confirmed-input feasibility regression matched 600 forward and
  restored ticks with original 4,439,188-byte full checkpoints.
- Delayed Chromium driving, contested crate, bomb/clock, mutual bomb impacts,
  shield absorption and mask immunity checks passed. Local prediction and
  confirmed-input browser regressions passed.
- Private setup API was present in the private module and absent in production.

Local rollback checkpoints measure 3,423,420 bytes, down 22.9% from full states.
The delayed driving run accepted 287/300 tick inputs per client, including the
deliberate missed-input exercise. Software input-to-prediction p95 was 3.7–3.9 ms;
reconciliation maxima were 39.8/44.4 ms, compared with phase 2 peaks around
128–172 ms. The wire frame is 1,636 bytes for two players. These are local
development results, not input-to-photon measurements or server capacity claims.

## Remaining acceptance work

Live two-person/device tests must judge steering feel, correction visibility,
textures and sound under real network conditions. The framebuffer is intentionally
omitted from race rollback and already-played speculative sounds cannot be undone.
Private contact fixtures do not prove every natural crate/hazard encounter.
Complete-world formal determinism and Firefox/Safari compatibility remain unproven.
Other multiplayer modes, individual cameras, eight humans and final network
hardening are later phases. No interface styling changed in this phase.

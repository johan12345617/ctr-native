# Online 2.0 phase 2 change summary

Implements the two-player prediction/correction prototype from the assessment.
Online 1.0 remains the normal launcher path. Full power-up synchronization,
other modes, individual cameras, eight humans, and release hardening remain
outside this milestone. See [ONLINE_V2.md](ONLINE_V2.md) for running it.

## Files created

| File | Description |
| --- | --- |
| `web/online-v2-prediction.mjs` | Applies local controls immediately, retains bounded checkpoints/input history, confirms matching frames, restores/replays corrections, and reconciles a queued confirmation batch with one restore. |
| `web/online-v2-race-tape.mjs` | Supplies repeatable original-game driving inputs and counts observed movement, drift, boost reserves, airborne state, and kart-collision flags. |
| `web/online-v2-prediction-probe.mjs` | Runs an original C/WASM authority and two predicted clients through 600 ticks with delayed confirmations, jitter, and six missed inputs; verifies convergence and physics coverage. |
| `web/online-v2-network-proxy.mjs` | Provides a test-only TCP delay proxy outside the browser simulation thread, preserving transport order and applying backpressure. |
| `web/tests/online-v2-prediction.test.mjs` | Verifies immediate prediction, preservation of unconfirmed local inputs, matching-frame fast paths, bounded history, stale/gapped frames, catch-up, and one-restore batch reconciliation. |
| `docs/ONLINE_V2_PHASE2_CHANGES.md` | Records this phase's created and modified files separately from phase 1. |

## Files modified

| File | Description |
| --- | --- |
| `include/platform/native_online.h` | Declares presentation controls and slot-based checkpoint capture/restore. |
| `platform/native_online.c` | Adds nine reusable prediction checkpoint slots alongside legacy slot 0, expected-tick/level validation, per-slot clock restoration, bounded cleanup, and the phase 2 build tag. |
| `platform/native_audio.c` | Advances SPU/XA during replay while suppressing intermediate PCM queue output; ordinary native/streaming playback stays enabled. |
| `platform/native_renderer.c` | Suppresses intermediate window swaps during replay while preserving the original rendering/simulation path. |
| `web/online-v2-protocol.mjs` | Advances to protocol 2, adds the eight-tick prediction bound and pad-copy/comparison helpers, and restricts predicted sessions to two players. |
| `web/online-v2-runtime.mjs` | Validates checkpoint slots/ticks, exposes slot-based save/restore, and controls presentation for replay steps. |
| `web/online-v2-server.mjs` | Queues inputs for their exact authority tick, rejects late rewrites, reports missing controls, and provides optional bounded-probe input telemetry. |
| `web/online-v2-client.js` | Enables two-player prediction by default, sends sampled controls before rendered work, batches incoming confirmations, rebuilds prediction lead after corrections, and retains `prediction: false` compatibility. |
| `web/online-v2-worker.mjs` | Exposes prediction initialization, local prediction, authoritative confirmation, and explicit checkpoint-slot commands to real-game probes. |
| `web/online-v2-browser-probe.mjs` | Exercises both browser modes, optional latency/jitter/skipped input messages, actual physics coverage and input acceptance, timing telemetry, and a rendered canvas screenshot. |
| `web/tests/online-v2.test.mjs` | Updates protocol checks and adds exact-tick input buffering, late-input ownership, and checkpoint-argument validation. |
| `web/server.mjs` | Serves the shared prediction module through the existing public-file allowlist. |
| `web/package.json` | Adds `online:v2:prediction-probe`; no production dependencies were added. |
| `cmake/Web.cmake` | Copies the shared prediction controller into the browser build. |
| `README.md` | Describes both implemented prototypes and links the guide. |
| `docs/ONLINE_V2.md` | Documents the algorithm, limits, commands, measured physics/network coverage, and graphical correction cost. |
| `docs/ONLINE_V2_ASSESSMENT.md` | Marks milestones 1–2 as implemented prototypes and keeps milestones 3–6 and final release gates pending. |
| `docs/ONLINE_V2_CHANGES.md` | Links this phase-specific summary from the overall change inventory. |

## Verification and limits

- 22 Node input/protocol/lifecycle/prediction tests passed.
- Native MSVC x86 Debug build and all 3 CTest checks passed.
- Original 2- and 4-player feasibility probes still matched 600 forward and
  600 restored ticks across three workers.
- Two predicted Node/WASM clients confirmed all 600 ticks after delayed
  confirmations and six missed inputs. Each performed 33 corrections. Observed
  coverage included 480 moving, 50 drifting, 13 boost-reserve, 96 airborne/jump,
  and 434 kart-collision-flag frames. These are frame counts, not event counts.
- Real Chromium/WebGL2 prediction, confirmed-input, and delayed-prediction
  scenarios each matched at least 300 authoritative frames. The delayed case
  injected 50/70 ms directional delays, up to 15 ms jitter, and skipped every
  31st application input. It required accepted player controls and real driving.
- `git diff --check` passed.

The observations still cover selected gameplay fields, not complete-world
state. The checkpoint bank uses about 38.1 MiB per prediction client and retains
GPU/audio state. Graphical corrections reached roughly 128–172 ms on this test
setup, so further profiling and live driving-feel checks matter. Weapon/item
pickup synchronization, other browsers, race-completion transitions, sound
deduplication, full-screen individual cameras, and production network behavior
are not established by these tests. No launcher markup or styles were changed;
the existing Tailwind styling remains in place.

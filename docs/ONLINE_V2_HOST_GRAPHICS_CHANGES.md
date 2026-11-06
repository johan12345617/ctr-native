# Online 2.0 host graphics fix

Player 1 could see the sky, left minimap and shared standings while the track,
kart and driver HUD disappeared. Player 2 still rendered correctly.

## Cause and change

The native GPU filtered other cameras' triangle batches, but `CAM_ClearScreen`
also emits immediate FILL packets for each camera. Once online cameras all used
the full viewport, Player 2's clear erased Player 1's rendered world. Flushing
the pending batch also reset the ordering-table camera owner, allowing the
remaining sky packets to draw as shared geometry until the next main OT entry.

The GPU now applies the same local-camera selection to on-screen FILL packets
and triangle batches. It resets camera ownership at the start of a submitted
list and retains it through batch flushes within that list. Offscreen rendering,
shared overlays and normal local split-screen rendering remain enabled.

This adds no production image readback, gameplay loop or network work. Skipped
remote clears also avoid an unnecessary batch flush.

## Files created

| File | Description |
| --- | --- |
| `web/online-v2-visual-check.mjs` | Test-only screenshot inspection of the central track/kart area, excluding HUD edges. Requires lit pixels and horizontal scene detail so a blank sky/background cannot pass as a rendered race. |
| `docs/ONLINE_V2_HOST_GRAPHICS_CHANGES.md` | Records the cause, file changes, validation and retest instructions. |

## Files modified

| File | Description |
| --- | --- |
| `platform/native_gpu.c` | Shares the local-camera filter between draw batches and immediate FILL commands. Preserves the OT camera owner through clear/move/feedback batch flushes and initializes ownership for each new list. |
| `web/online-v2-lobby-probe.mjs` | Checks actual rendered scene pixels for both players during the real button-driven lobby test. |
| `web/online-v2-browser-probe.mjs` | Includes scene visibility in graphical probe pass criteria, alongside diagnostic convergence, camera ownership and latency checks. |
| `docs/ONLINE_V2.md` | Documents immediate clear filtering, ownership across flushes and the stronger graphical regression. |

## Verification

The new button-driven visual check failed on the old production build for
Player 1, while Player 2 passed. Player 1's central scene had approximately
0.02% horizontally detailed samples; after the fix both clients exceeded 8%.
This checks the reported failure instead of relying only on a camera-mask bit
or a simulation observation hash.

The rebuilt production lobby test passed all 12 checks, including both rendered
scenes, actual movement, fullscreen, leaving and a second room without reload.
Screenshots confirmed the host's track, kart and solo HUD. Both clients received
over 460 authority frames without browser errors or diagnostic failures.
The 600-tick prediction/rollback regression and all 27 web tests also passed.

Production and private headless/browser release builds succeeded. The stronger
camera suite passed for two delayed predicted clients, the distant-racer fixture
and all four confirmed-input camera slots; every scene passed pixel inspection
and each client submitted only its own camera. Four-human checkpoint replay
also matched for 300 forward and 300 restored ticks.

With 50 ms upstream / 70 ms downstream delay and jitter, the two-player run
recorded software input-to-prediction p95 of 3.8/4.4 ms and reconciliation p95
of 13.5 ms on each client; maximum reconciliation was 24.7 ms. These are local
development-machine software timings, not input-to-photon measurements.

The native MSVC x86 Debug build and all 3 CTests passed. The build used a
process-local `/Z7` compiler override after the installed MSVC PDB manager
reported C1902 with `/Zi`; no repository build flags were changed.
`git diff --check` and the modified JavaScript syntax checks passed.

## Live retest

Restart the server with `npm --prefix web run start:online-v2`, hard-refresh both
browsers and create a new lobby. Loaded WASM sessions retain their previous
rendering code. Check the host's track, kart, clock and minimap while driving,
then open Lobby / Back to race in fullscreen. Actual two-device testing remains
useful for hardware-specific graphics, audio and internet latency.

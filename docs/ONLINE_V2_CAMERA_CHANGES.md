# Online 2.0 camera and distant-racer change summary

Each online client presents its assigned full-size camera with that driver's solo
HUD, including the left minimap, race clock, Wumpa, inventory, rank and boost/jump
indicators. Shared standings move to the right to leave the map clear.
Remote human karts use normal geometry and retain their cheapest distance LOD
instead of disappearing after the multiplayer sprite cache / final LOD limit.
Multiplayer physics and input ownership still use the real player count.

## Files created

| File | Description |
| --- | --- |
| `web/online-v2-camera-probe.mjs` | Runs real two-player delayed prediction, private far-racer, and four-player camera-ownership graphical regressions, retaining reports and a screenshot per client. |
| `game/UI/UI_OnlineHud.h` | Centralizes the presentation-only player count; player/physics loops continue to use the actual multiplayer count. |
| `docs/ONLINE_V2_CAMERA_CHANGES.md` | Records these files, rendering decisions, verification and manual retest steps. |

## Files modified

| File | Description |
| --- | --- |
| `game/PushBuffer.c` | Gives every online camera the existing full-size 512 × 216 projection, independently of multiplayer racer count. |
| `game/MAIN/MainFrame_RenderFrame.c` | Bypasses online kart/Wumpa sprite caching and split-screen divider/border rendering. |
| `game/RenderBucket/RenderBucket_QueueExecute.c` | Keeps human racer meshes at the cheapest LOD beyond the final cutoff; routes owned 3D position/Wumpa instances to their driver's ordering table while keeping their UI projection. |
| `game/UI/UI_RenderFrame.c` | Draws the solo clock, speed/jump indicators, inventory and rank for every driver in its own camera OT. Enables the minimap for online player counts and places it on the left. All runtimes still execute HUD state updates for every player. |
| `game/UI/UI_Instance.c` | Creates full-size 3D rank/Wumpa meshes for every online slot, bypassing the cached multiplayer Wumpa sprite. |
| `game/UI/UI_Rank.c` | Uses a vertical shared standings list on the right with the actual online racer count instead of the split-screen divider strip. |
| `game/UI/UI_Map.c` | Enables racer markers at all online player counts and moves drivers/projectiles/ghosts with the map art to its left-side anchor. |
| `game/UI/UI_DrawNum.c` | Keeps solo Wumpa typography for players 3 and 4. |
| `game/UI/UI_RaceHudText.c` | Keeps solo-sized lap text/alignment for every online slot. |
| `game/UI/UI_DrawSlideMeter.c` | Retains the full-height solo boost bar at all online player counts. |
| `game/UI/UI_Reward.c` | Uses the owning driver's Wumpa/juice state for the solo HUD fruit mesh. |
| `include/platform/native_online.h` | Declares local-camera selection and read-only view diagnostics. |
| `platform/native_online.c` | Stores the local slot outside checkpoints/shared world state, validates camera selection before boot, supplies one anchor for map art/markers, and reports camera/map diagnostics. |
| `include/platform/native_gpu.h` | Declares camera-mask frame diagnostics. |
| `platform/native_gpu.c` | Tracks camera ownership through main ordering tables and nested primitive chains; includes ownership in draw batches and omits other cameras' on-screen GPU submission. |
| `platform/native_platform.c` | Resets submitted-camera diagnostics for each presented frame. |
| `platform/native_online_fixtures.c` | Adds private fixture 108 and read-only racer-view diagnostics to test meshes beyond the retail LOD cutoff. Production has no placement/injection API. |
| `web/online-v2-runtime.mjs` | Installs the local camera slot before game boot and exposes read-only presentation diagnostics. |
| `web/online-v2-client.js` | Chooses the camera from the server-assigned player slot. |
| `web/online-v2-worker.mjs` | Lets trusted headless probes select different client camera identities. The authority has no local camera. |
| `web/online-v2-prediction-probe.mjs` | Verifies driving prediction with different local camera identities against one common authority. |
| `web/online-v2-powerups-probe.mjs` | Verifies weapons/rollback with different client camera identities and supplies neutral controls for the far-render fixture. |
| `web/online-v2-browser-probe.mjs` | Supports 2–4 graphical clients, checks full-size/local-only camera masks, left-map assets/anchor and far-racer mesh eligibility, keeps latency gates, and saves all clients' canvases. |
| `web/tests/online-v2.test.mjs` | Checks that camera identity is installed before boot, never alters match configuration, and rejects invalid slots. |
| `web/package.json` | Adds `online:v2:camera-probe` without new dependencies. |
| `docs/ONLINE_V2.md` | Documents individual cameras, distant racer rendering, probe commands, remaining limitations and restart/refresh steps. |
| `docs/ONLINE_V2_ASSESSMENT.md` | Updates the camera implementation evidence while retaining the separate eight-player layout audit. |

## Implementation limits and retest

Verification on November 6, 2026:

- Production/private headless and graphical release builds succeeded.
- 26 Node tests and all 3 native CTests passed.
- The two-player 600-tick prediction regression, 44 weapon cases and 18-track
  rollback regression passed with different client camera identities.
- Two delayed predicted browsers and all four confirmed-input browser slots
  presented full-size views with exactly one camera bit each and left-map assets.
- The private far-racer case kept the mesh queued in all 180 frames beyond its
  original 8,192-unit cutoff, without sprite-cache flags.
- Delayed browser contested crate and mutual-impact checks passed.
- Final delayed driving software prediction p95 was approximately 4.4 ms;
  reconciliation maximum was approximately 30.2 ms. These are development-machine
  software timings, not input-to-photon latency.
- Screenshots were inspected for the complete solo HUD on two/four-player clients.

Camera choice affects native GPU submission only. Every runtime still constructs
all cameras/display lists so existing presentation RNG calls and original game
updates remain reproducible. The GPU draws one camera per browser; this is not
yet a CPU simulation/presentation separation for all unused cameras.

Normal frustum/depth clipping, terrain occlusion, invisibility and flicker remain.
The private far fixture tests render eligibility beyond the original LOD cutoff;
it does not make racers visible through level geometry.

Online currently shows both the map and solo instruments; the shared player-1
map/speedometer toggle is bypassed so it cannot change the other clients' HUD.

Restart the Node server, hard-refresh all browsers and create a fresh room after
updating. Recheck distant racers on an open straight with both players facing
each other, then drift/fire weapons and confirm that each client retains its own
camera, inventory and position HUD during corrections. Existing loaded sessions
cannot update their already-instantiated WASM code.

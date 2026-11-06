# Online 2.0 simulation, prediction and power-up prototypes

Implemented November 6, 2026. This implements the feasibility and two-player
prediction and power-up development phases of [the assessment](ONLINE_V2_ASSESSMENT.md).
Two-player engine-menu Race/Cup/Battle integration is also implemented. Complete
supported-mode/player-count coverage, milestones 5–6 and live validation remain pending.
The existing local game and Online 1.0 streaming launcher remain the default.

## Implemented behavior

- An isolated Node worker runs the original C game compiled to WebAssembly.
  CPU VRAM replaces the graphics device; the original game logic, render-list
  construction, input polling, SPU/XA progression, and presentation RNG calls
  still execute. It opens no window or audio device.
- A caller advances the complete game loop one iteration at a time. Positive
  VSync requests emit exactly the requested VBlanks without wall-clock catch-up.
  Active gameplay uses the original `0x20` time unit. Network pacing follows
  two NTSC VBlanks, approximately 29.909 ticks per second.
- The prototype boots directly into an existing VS race, with 2–4 human slots,
  a configured seed, and a race track ID from 0 through 17. Adventure, solo
  modes, and eight-human configurations cannot be selected through this API.
- Each browser runs and renders its own original game. The authority chooses
  controls and broadcasts confirmed ticks. Initial build/state checks and
  per-frame diagnostic hashes detect divergence and stop the session.
  Builds identify the shared C/header/build sources with SHA-256, so different
  dirty checkouts cannot pass the identity gate merely by sharing a Git commit.
- A process-local checkpoint experiment measures capture, restoration, and
  repeated simulation. Its envelope also restores the native root counters,
  VBlank count, and external simulation tick.

Two-player sessions now apply local prediction and authoritative corrections.
Confirmed-input sessions remain available for comparison and for 3–4 players.
Each online browser now presents its assigned full-size camera and driver HUD.
All runtimes compute the same camera/render-list state; native GPU submission
selects the local view. **Online** now lives in the original engine main menu,
with Create/Join, code entry and a waiting room drawn by the engine. Two-player
sessions use the original Race, Cup and Battle setup/results flow. Driving is
predicted; menus, pauses, results and level transitions use confirmed input.
Local play and Online 1.0 streaming remain available under **Shared screen**.

## Phase 2: prediction and corrections

`OnlineV2Client.create()` defaults to prediction for two players. Use
`create({ prediction: false })` for the original confirmed-input experiment.
Prediction with more than two players is rejected explicitly.

The local client samples and sends controls before doing their rendered
simulation work, then advances its own world immediately. Opponent controls
are predicted by holding the most recently confirmed values. The client keeps
one confirmed checkpoint and at most eight predicted ticks in nine reusable
slots, maintaining an RTT/jitter-sized lead after each confirmation batch. It pauses
additional prediction when the window is full until confirmation frees space.

When actual authority controls or observations differ, the client restores the
checkpoint before the affected tick, applies and verifies every queued
authoritative frame, then replays the remaining unconfirmed local inputs. A
received batch needs one restore, rather than rebuilding the predicted present
after every intermediate confirmation. Matching predictions need no restore.
Later local inputs survive a correction. Missing authoritative ticks or a
divergence after replay end the session instead of accepting inconsistent state.

The authority buffers each predicted input for its exact tick. An input that
arrives after that tick starts is ignored; it cannot rewrite the past or become
an unrelated future control. Missing controls hold the previous value briefly
and expire to neutral under the existing 250 ms rule. Socket membership still
owns the player slot. Diagnostic `missingInputs` flags and optional server-side
input observation help measure accepted and late controls.

Slot 0 retains the full feasibility save/restore API. Slots 1–9 retain local
gameplay/input/audio state and draw-command metadata, validating tick and level
before restoration. They omit framebuffer pixels. The measured rollback bank is
30,810,780 bytes (about 29.4 MiB), plus metadata. It is not a portable network
snapshot. Intermediate replay raster submission, scene presentation and PCM
output are suppressed; original display-list construction, RNG calls, SPU and
game simulation still run. Sounds already heard cannot be undone.

## Phase 3: power-ups and latency

Rollback retains the interacting game world, including crate state, inventory,
projectile ownership/targets, shields, masks and global effect timers. A
1,600-byte semantic observation originally extended the driver/RNG diagnostics with active
world instances, complete thread bloodlines (including weapons attached to
players), weapon internals, damage counters, and selected moving-hazard fields.
It normalizes player references and excludes host pointers/padding. This is
still a diagnostic, not a complete replication format or formal determinism proof.

Local prediction never waits for a ping response or server decision. The client
measures application RTT and jitter, schedules network controls 2–64 ticks
ahead, and keeps the rendered prediction lead bounded to 2–8 ticks. When the
network budget exceeds eight ticks, it buffers only the excess before applying
the control at the same planned tick locally and on the authority. Short
connections retain immediate local prediction. Menu inputs use the full network
budget, preventing a slower guest's controls from always arriving late; quick
press/release changes target separate ticks even within one confirmation batch.
The authority still rejects expired controls and out-of-window packets. The client sends
sampled controls before simulation work and presents only the last step of a
prediction burst. Race rollback avoids framebuffer readback and same-address
pointer relocation. When the same compressed music track is resident, it
restores the small XA decoder ring directly instead of reloading/redecoding it;
the ordinary full-checkpoint path remains available.

Protocol 4 sends compact binary authoritative frames: 24-byte header, six bytes
per pad and 1,856 observation bytes. Two-player frames are 1,892 bytes, about
56.6 kB/s of frame payload per client at the simulation rate, before transport
overhead. The new fields cover menu selections, characters, cup progress,
battle teams/lives/scores and standings. Create/join/input/report/ping messages remain JSON. Older clients
and mismatched production/probe builds fail the initial compatibility gate.

Latency is a measured gate in the graphical probe: input sampling to completed
local prediction p95 below one tick (33.44 ms), reconciliation p95 below one
tick, reconciliation maximum below two ticks (66.88 ms), and over 90% accepted
tick-specific inputs under the documented delay profile. These are development
budgets, not promises for every device/network. Timers, controller polling,
display scanout, audible correction artifacts, and input-to-photon delay need
live testing. The original simulation is approximately 30 Hz; local prediction
does not remove that sampling interval.

Private fixture builds are separate from production and contain a one-time
inventory/impact setup API. The test harness alone selects fixtures; client
messages cannot enable them. Normal production binaries contain no setup API.
Fixtures run original item firing, collision, damage and RNG logic. Contested
crate tests call the original crate collision callback; impact fixtures place
already-fired bombs at controlled contact points. These do not replace the
gameplay implementation or establish every naturally driven encounter.

Build and run the expanded probes from the repository root:

```powershell
.\build-web.ps1 -Headless -Probes
.\build-web.ps1 -Probes
node web/online-v2-powerups-probe.mjs all .cache/online-v2/phase3-powerups.json
node web/online-v2-world-probe.mjs .cache/online-v2/phase3-world.json
```

Linux/macOS equivalents use `build-web.sh --headless --probes` and
`build-web.sh --probes`. Private outputs are `build-online-v2-probe/` and
`build-web-probe/`; production output directories stay separate.

The power-up matrix runs 44 cases, each 420 ticks, with two independently
predicted clients and confirmations delayed by two/four ticks. It covers item
IDs 0–13 in normal/juiced states, contested crate inventory/RNG correction,
mixed global effects, mutual bomb hits, shield absorption and mask immunity.
Spring ID 5 is an unused legacy inventory ID that normal selection replaces
with turbo. Expected gates include observed projectiles/mines, effect activation
and expiry, one crate winner, and one hit on each player in the mutual-impact
case. The world probe repeats rollback across all 18 VS tracks; active hazards
advance, but this does not assert a physical hit from every hazard.

With Playwright/Chrome configured as described below:

```sh
node web/online-v2-browser-probe.mjs .cache/online-v2/phase3-browser-delayed.json --delayed
node web/online-v2-browser-probe.mjs .cache/online-v2/phase3-browser-crate.json --delayed --fixture=100
node web/online-v2-browser-probe.mjs .cache/online-v2/phase3-browser-hits.json --delayed --fixture=105
node web/online-v2-browser-probe.mjs .cache/online-v2/phase3-browser-shield.json --delayed --fixture=106 --juiced
```

`--fixture=N` uses private binaries and 420 frames. Scenarios 101–104 combine
bomb/clock, missile/shield, TNT/mask and potion/turbo. Scenarios 105–107 exercise
mutual impacts, shield absorption and mask immunity. `--juiced` selects ten Wumpa.
Scenario 100 tests the contested crate. Normal runs need the production headless
and graphical binaries. Reports and screenshots stay in ignored `.cache/online-v2/`.

## Individual cameras and distant racers

The browser installs its socket-assigned player slot before boot. This local
presentation identity stays outside shared observations and rollback checkpoints.
All online push buffers use the existing 512 × 216 single-player projection,
while the actual multiplayer player count remains unchanged. Every runtime still
advances all camera/render-list/RNG work; native GPU submission draws the assigned
camera and shared overlays. This avoids rendering other players' screen views
without changing simulation decisions between clients and authority.

Camera selection also filters the immediate background FILL commands emitted
by `CAM_ClearScreen`. Otherwise a later camera's full-size clear can erase the
host's track even when that camera's triangles are skipped. Camera ownership
survives vertex-batch flushes inside the same ordering-table chain, including
clears, image moves and framebuffer-feedback barriers.

Driver HUD text, clock, inventory, position/Wumpa meshes and speed/boost/jump
indicators belong to that driver's camera OT. They use the full single-player
HUD sizes for every online slot, including players 3 and 4. The minimap is on
the left with racer/projectile markers translated with its art; shared standings
are on the right so they do not overlap it. Online split bars and multiplayer
HUD sprite caching are omitted. Native local play and Online 1.0 retain their
original split layout.

Online human karts use regular geometry instead of the multiplayer `DecalMP`
sprite cache. Once a human kart exceeds its last retail distance LOD, the renderer
retains its cheapest mesh. Normal camera/depth clipping, terrain occlusion,
invisibility and invincibility flicker still apply. This fixes premature distance
disappearance without drawing every racer through terrain or behind the camera.

After updating, restart the server, hard-refresh every browser, and create a new
session. Existing loaded WASM sessions keep the old code. The build identity gate
rejects mixed engine versions.

Camera regressions require production and private builds plus the optional
Playwright setup below:

```sh
node web/online-v2-camera-probe.mjs .cache/online-v2/cameras.json
```

The probe checks two delayed predicted clients, four confirmed-input clients,
and private fixture 108, which places a remote racer beyond its final LOD cutoff.
It asserts one selected GPU camera bit per client, full-size views, left minimap
assets/anchor, deterministic
observations, and the existing prediction/reconciliation latency budgets. The far
fixture also asserts queued mesh visibility and absence of sprite-cache flags.
Each client gets a screenshot. Fixture placement is private test code, not a
network control or normal game behavior. See the [camera change summary](ONLINE_V2_CAMERA_CHANGES.md).
The browser and lobby probes also inspect rendered pixels in the central race
scene: simulation hashes and camera masks alone did not catch the host's
background-only view. See the [host graphics fix](ONLINE_V2_HOST_GRAPHICS_CHANGES.md).

## Build

Use the Emscripten prerequisites from [WEB.md](WEB.md). From the repository root:

```powershell
# Original game as an isolated Node/WASM simulation.
.\build-web.ps1 -Headless

# Browser game, including the prototype adapter.
.\build-web.ps1
```

On Linux/macOS:

```sh
bash build-web.sh --headless
bash build-web.sh
```

The CMake presets are `online-v2-release` and `web-release`. The worker output
is `build-online-v2/ctr_native.cjs` plus `ctr_native.wasm`. The `.cjs` extension
keeps the generated module usable regardless of the caller's module type.

The server reads its own legally supplied `assets/ctr-u.bin`. Each graphical
client supplies a disc locally; loopback browsers can auto-load the checkout's
disc through the dedicated local-only route. Disc bytes and checkpoints are
never accepted in online messages. Worker memory-card writes and logs stay in
its ephemeral MEMFS; the real native memory cards are not mounted.

## Run the reproducibility and rollback probe

```sh
npm --prefix web run online:v2:probe
node web/online-v2-probe.mjs --frames 600 --players 4 --output .cache/online-v2/four-player.json
```

The probe creates one authority and two independent simulation workers, loads
the same track, saves a checkpoint in each worker, runs the same control tape,
then restores and replays it. It compares all 1,856 diagnostic bytes on every
iteration. Exit code 0 means observations matched and driving occurred; 2
means divergence or insufficient driving coverage; 1 means setup failed.

Options are `--frames` (1–10000), `--players` (2–4), `--track` (0–17),
`--seed` (uint32), `--engine`, `--assets`, and `--output`. Paths supplied on the
command line are relative to the current directory. The npm command runs
inside `web/`; the direct `node web/...` examples run from the repository root.

Run the real-game phase 2 probe with delayed confirmations, jitter, and missed
authority inputs:

```sh
npm --prefix web run online:v2:prediction-probe
node web/online-v2-prediction-probe.mjs 600 .cache/online-v2/phase2-headless.json
```

It requires both predicted worlds to converge to the authority after all 600
confirmations. It also requires actual observations of movement, drifting,
boost reserves, airborne/jump state, and human kart-collision flags. The
scripted tape uses the original controls and physics; it does not inject
positions or replace vehicle behavior. Flag-frame counts are not counts of
distinct jumps or collisions.

## Create or join from the game

The additional `/online-v2` WebSocket endpoint is disabled by default. Enable
it explicitly while retaining the existing `/lobby` streaming endpoint:

```powershell
npm --prefix web run start:online-v2
```

This command works on Windows, Linux and macOS. The existing
`CTR_ONLINE_V2=1` environment setting also works. Build both production WASM
targets first as described above. If a server is already running, restart it
with the new command and refresh both browsers to load the updated launcher.

1. Open `http://127.0.0.1:8080`. The local server automatically loads this
   checkout's `assets/ctr-u.bin`; a remote player selects their own NTSC-U disc.
2. Start the game and choose **Online** in its main menu. The web Online button
   is a shortcut into that engine menu.
3. Select **Create Lobby**. Share the six-character code displayed by the engine;
   Space / Select copies it.
4. The guest chooses **Join Lobby**, types the code and presses Enter. A
   controller can edit digits with left/right and up/down, then confirm.
5. When both players show **Ready**, the host presses C / Enter to start.
6. The host chooses **Race**, **Cup** or **Battle**. Both players choose their own
   characters. Original track, lap, cup and battle settings screens follow.

Each player gets their own camera and solo HUD, including the map on the left.
Click the canvas to focus controls: C accelerates, arrows steer, Shift
hops/drifts, the opposite Shift boosts, and V uses an item. Standard gamepads are
also supported. The header shows measured ping. Original pause/results menus
handle retry, changing settings and quitting to the engine mode menu. The host
owns shared menus; each player owns their character and battle team. Choose
**Leave Lobby** from the online mode menu to disconnect. V cancels/leaves the
waiting room. All these screens remain inside the canvas in fullscreen.

The menu currently supports two-player Race, Cup and Battle sessions. Local play and
**Shared screen** remain separate choices. Remote devices need the same
accessible server origin; see [WEB.md](WEB.md) for binding/proxy/HTTPS setup.
Actual remote-device playtesting is still needed to assess connection quality
and gamepad/audio behavior on your hardware.

`OnlineV2Client` remains available as an optional developer API. Supply an
unstarted `createCTRModule` factory, a local disc `File`, a canvas and an
`onStatus` callback. Call `create({ players, track, seed })` or `join(code)`;
Player 1 calls `start()` after all slots report ready. `close()` releases the
runtime and controls. Use a fresh module per session. The API also exposes
3–4-player confirmed-input experiments, which the menu does not offer.

The button-driven lobby regression uses two independent real browser contexts,
the real WASM authority and a delayed connection:

```powershell
node web/online-v2-lobby-probe.mjs .cache/online-v2/lobby-ui.json
```

It checks automatic disc loading, engine Create/Join/code entry, readiness,
original character selection, mode setup/loading, rendered scenery and fullscreen
pause/resume. Run `online-v2-engine-probe.mjs OUTPUT cup` or `OUTPUT battle` for
the other modes. The private `online-v2-modes-probe.mjs` checks original scoring,
results, retries and all four cup rounds against two predicted worlds. It uses
the same optional Playwright/browser setup below and saves screenshots beside
the report. See [the engine-menu file summary](ONLINE_V2_ENGINE_MENU_CHANGES.md).

An optional end-to-end script launches two real Chromium/WebGL2 clients against
the real authority. Playwright is a test-only optional dependency:

```powershell
npm install --prefix .cache/online-v2-tools --no-save playwright
$env:CTR_PLAYWRIGHT_MODULE = "file:///" + ((Resolve-Path ".cache/online-v2-tools/node_modules/playwright/index.mjs").Path -replace '\\', '/')
$env:CTR_CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"
node web/online-v2-browser-probe.mjs .cache/online-v2/phase2-browser.json
node web/online-v2-browser-probe.mjs .cache/online-v2/phase2-browser-delayed.json --delayed
node web/online-v2-browser-probe.mjs .cache/online-v2/phase2-browser-confirmed.json --confirmed
```

Without `CTR_PLAYWRIGHT_MODULE`, the script imports `playwright` through normal
Node resolution. Without `CTR_CHROME`, it uses Playwright's installed Chromium.
It serves the real launcher, replaces only its controller in the test browser,
supplies the disc through a local file input, and requires both clients to
match 300 authoritative frames with actual movement. Predicted runs must also
apply local inputs before the first confirmation and have the server accept
over 90% of each player's tick-specific controls. Delayed runs must
exercise corrections. The report records accepted/late inputs, physics
coverage, checkpoint/replay cost, divergence, and browser errors, and saves a
canvas screenshot beside the JSON. No browser automation dependency is added to
the production server.

`--delayed` adds 50 ms client-to-server delay, 70 ms server-to-client delay,
and deterministic jitter of up to 15 ms in each direction. A test-only TCP
proxy preserves byte order and runs outside the browser's simulation thread.
Every 31st application input message is deliberately skipped. This tests missed
input deadlines, not actual TCP packet loss or retransmission behavior.

## Protocol and lifecycle

1. `create` supplies a protocol-4 configuration and the session's prediction
   setting. The server reserves a bounded
   room and initializes one independent simulation worker.
2. `join` assigns the next socket-owned slot. `session` supplies the authority's
   configuration, build identity, boot tick, and diagnostic observation.
3. Each client loads independently and sends `ready` with its build, tick, and
   observation hash. All slots must match before Player 1 can `start`.
4. `input` contains a monotonically increasing sequence, target simulation tick, PSX
   button mask, and four axis bytes. Slot ownership comes from room membership;
   a client cannot advance the authority or submit world state.
5. `frame` contains the confirmed post-step tick, controls actually used,
   diagnostic observation, and measured simulation cost. Predicted clients
   reconcile their retained history and send hashes for the confirmed state;
   confirmed-input clients simply step from the previous tick.
6. Divergence, a worker error, any departure, or server shutdown closes the
   session and terminates its worker. There is no mid-match join or reconnect.

Inputs expire to neutral after 250 ms. The coordinator bounds rooms, clients,
payloads, input tick windows, message rates, and outgoing buffered bytes. It
keeps 120 diagnostic hashes, uses ping/pong heartbeats, and schedules only one
simulation step per room at a time. Slow simulation rebases its deadline
instead of accumulating an unbounded catch-up loop. These are prototype
controls, not evidence that the final network-hardening milestone has passed.

## Initial measurements

Windows, Node 22.22.3, release WASM, track 0, seed 12345, November 6, 2026.
These are local development measurements, not capacity estimates.

| Experiment | Result |
| --- | --- |
| Authority + two Node/WASM clients, 2 human slots | 600 forward ticks and 600 restored ticks matched |
| Authority + two Node/WASM clients, 4 human slots | 600 forward ticks and 600 restored ticks matched |
| Driving coverage in each probe | 480 moving frames; nonzero kart speed |
| Whole-machine checkpoint | 4,439,188 bytes per worker |
| Capture | Approximately 2.5–3.2 ms |
| Restore | Approximately 13.5–15.4 ms |
| Authority step, 2 human slots | Approximately 1.10 ms mean, 1.91 ms p95 |
| Authority step, 4 human slots | Approximately 1.36 ms mean, 2.14 ms p95 |
| Two Chromium/WebGL2 clients + authority | Initial observations and 300 confirmed frames matched |
| Existing native Debug CTest suite | 3/3 passed |

Phase 2 results on the same local development machine, track 0 and seed 12345:

| Experiment | Result |
| --- | --- |
| Original-game authority + two predicted Node/WASM clients | Both confirmed all 600 ticks and converged after 6 missed inputs |
| Node correction coverage | 33 corrections per client; 71 and 137 unconfirmed ticks replayed |
| Observed physics coverage | 480 moving, 50 drifting, 13 boost-reserve, 96 airborne/jump, and 434 kart-collision-flag frames |
| Delayed Chromium/WebGL2 clients | Both matched at least 300 authority frames and exercised the five physics categories |
| Delayed browser input acceptance | Approximately 61–79% across recorded local runs; the final run accepted 186/303 and 184/303 controls |
| Delayed browser correction cost | Up to approximately 128–172 ms on this graphical test setup |
| Prediction/confirmed-input graphical regression | Both 300-frame scenarios passed |
| Node protocol/input/prediction/lifecycle suite | 22/22 passed |
| Native MSVC x86 Debug + CTest | Build succeeded; 3/3 passed |

Phase 3 results on the same machine (single local authority, two clients):

| Experiment | Result |
| --- | --- |
| Normal/juiced power-up and interaction matrix | 44/44 cases passed; 420 confirmed ticks per client/case |
| Across-track world/hazard rollback | 18/18 VS tracks passed; 420 ticks per client/track |
| Driving prediction regression | 600/600 confirmations per client, six missed inputs, no divergence |
| Four-human confirmed-input/full-checkpoint regression | 600 forward + 600 restored ticks matched; original 4,439,188-byte snapshots |
| Local rollback checkpoint | 3,423,420 bytes per slot; approximately 22.9% smaller than full checkpoint |
| Delayed Chromium driving input acceptance | 287/300 per client (95.7%) despite deliberately skipped inputs |
| Delayed driving software input-to-prediction | 3.7–3.9 ms p95; measured application RTT approximately 147–150 ms |
| Delayed driving reconciliation | 0.2/13.8 ms p95; 39.8/44.4 ms maximum across both clients |
| Delayed graphical mutual impacts | 420 frames/client; one bomb hit on each player; 4.2–4.4 ms prediction p95, 29.4 ms maximum reconciliation |
| Delayed graphical crate, clock, shield, mask cases | 420+ frames/client each; diagnostic convergence and latency budgets passed |
| Low-delay prediction and confirmed-input graphical regressions | 300 frames/client each; passed |
| Node protocol/input/prediction/lifecycle suite | 25/25 passed |
| Native MSVC x86 Debug + CTest | Build succeeded; 3/3 passed |

The delayed graphical profile is 50 ms upstream, 70 ms downstream, up to 15 ms
jitter per direction, and every 31st application input skipped. It is not TCP
packet-loss emulation. Measured RTT includes the proxy, browser scheduling and
transport behavior. Browser timings come from headless Chrome/WebGL2 on this
development machine. Concurrent load and actual hardware can change them.
See [the phase 3 file summary](ONLINE_V2_PHASE3_CHANGES.md).

The phase 2 graphical restore/capture cost could produce visible hitches. Those results
establish a functioning experimental prediction/correction path; they do not
establish release performance or acceptable driving feel on real networks.
Live playtesting should assess correction visibility, controls, and sound after
the remaining synchronization work, alongside further performance profiling.

Reports are produced under `.cache/online-v2/` when following the commands above.
The protocol/lifecycle tests use a fake simulation to exercise adversarial
traffic deterministically; the probes above separately exercise the real game.

## What these results do and do not establish

The current 1,856-byte observation is explicitly encoded little-endian. The
original 832-byte prefix preserves world clocks/RNG, mode flags and eight
driver records; the extension observes instances, thread trees, selected
weapon/hazard internals, damage, crate awards and effect state. It excludes
host pointers and padding. It still does **not** encode every gameplay field
or restore a client. Hash agreement is a diagnostic, not proof of complete-world
determinism or anti-cheat validation.

Checkpoints stay inside the same runtime and never travel over the network.
Race rollback uses the reduced presentation profile described above; slot 0
retains the full GPU/audio save-state path. Neither is a portable network
snapshot or has cross-build compatibility. Framebuffer omission assumes an
already-loaded race and needs live visual checks across tracks and effects.

Phases 1–2 recorded no inventory coverage; phase 3 deliberately exercises
original weapon code through private controlled fixtures. Natural approaches
to every crate, every target combination, hazard impacts, race completion and
all multiplayer modes need broader coverage. Chromium success does not establish
Firefox/Safari determinism or behavior under real latency and loss.

## Live testing required

Before treating this phase as ready for players, run two real people/devices
with the normal production binaries and the coordinator/client setup above:

- Check steering, drifting, hops and boost response on LAN and a remote connection.
- Contest crates and vehicle contact; fire missiles, bombs and mines at each
  other, including shields, masks and clocks. Watch inventory and recovery.
- Watch for correction jumps, flickering/missing textures, repeated or missing
  sound and audio gaps during impacts. Already-played speculative audio is not
  deduplicated by this phase.
- Repeat on a slower client and record RTT, correction messages and visible
  stalls. The eight-tick prediction limit intentionally stalls beyond its bound.

This is a manual responsiveness/presentation gate; automatic observation checks
cannot judge input feel or sound quality. Further implementation can proceed,
but these checks remain required for release acceptance.

Next work remains: complete-world state validation and broader mid-race
restoration coverage; natural item/hazard interaction coverage; cups, bots, battle,
teams, transitions and results; eight-human layout/input
changes; and latency, jitter, packet-loss, slow-client and disconnect testing.
The assessment's final release gate remains all multiplayer modes, all weapons,
and full physics. No final choice between rollback and explicit replication is
made from this limited experiment.

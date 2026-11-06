# Browser build and shared-screen online play

The browser target compiles the same C game and PSX facade to 32-bit
WebAssembly. SDL3 uses WebGL2 and Web Audio. Asyncify yields during the existing
VBlank waits so the original game loop, physics, loading code, and local
split-screen modes can run without a second implementation.

## Build and play

Install [Emscripten](https://emscripten.org/docs/getting_started/downloads.html)
(tested with 4.0.23), CMake 3.21+, Ninja, and Node.js 20+. SDL3 comes from the
vendored source; no SDL Emscripten port download is needed.

Windows PowerShell:

```powershell
# Run your SDK's emsdk_env.ps1 first, or use an activated .cache/emsdk.
.\build-web.ps1
npm --prefix web start
```

Linux/macOS, after sourcing your SDK's emsdk_env.sh:

```sh
bash build-web.sh
npm --prefix web start
```

Or build directly from an activated Emscripten environment:

```sh
npm --prefix web ci --ignore-scripts
cmake --preset web-release
cmake --build --preset web-release --parallel
```

Stop an old Python server on port 8080 before starting the Node server.
Python can still serve local-only play, but online lobbies require the Node
server for WebSocket signaling.

Open <http://localhost:8080>, select your NTSC-U raw MODE2/2352 disc image
(`ctr-u.bin`), and click **Start game**. Click the canvas for keyboard focus.
Use the game's menus for local multiplayer, with up to four controllers.
The keyboard player selector changes only the keyboard's assignment.
Xbox / XInput, DualShock 4 and DualSense controllers map automatically. Connect
over USB or pair with the operating system over Bluetooth, then press a button
to expose the controller to the browser. No in-game mapping step is needed.
Hot-plugging, unplugging and reconnecting work while the game is running.
Local play assigns up to four connected controllers to stable player slots;
online play uses the controller most recently used on that player's computer.
Using a controller focuses the game automatically without interrupting a text
field. The keyboard remains available. On the web, its default assignment is
Player 1 even when a controller connects.

| Action | Xbox / XInput | DualShock 4 / DualSense |
| --- | --- | --- |
| Steer / navigate | Left stick or D-pad | Left stick or D-pad |
| Accelerate / confirm | A | Cross |
| Brake / reverse | X | Square |
| Use item / back | B | Circle |
| Change view | Y | Triangle |
| Hop / drift | LB / RB | L1 / R1 |
| Pause / start | Menu / Start | Options |
| Select / copy lobby code | View / Back | Share / Create |

Button positions follow the original PlayStation controls. Triggers and both
stick clicks also map to their original PS1 inputs. Browser support covers the
standard Gamepad API layout and known raw Windows Sony HID layouts. USB and
Bluetooth behavior still needs checking with physical controllers on the
target browser; browser/OS recognition determines which devices are exposed.

All 15 selectable characters are unlocked by default, on native desktop
and web. Existing saves get the full roster when character selection opens;
track unlocks and Adventure rewards retain their existing behavior.

## Online races with your own camera

Build the Online 2.0 authority as described in [ONLINE_V2.md](ONLINE_V2.md), then
run `npm --prefix web run start:online-v2`. Start the game and choose **Online**
in the engine main menu (the web Online button is a shortcut). **Create Lobby**
shows a code; **Join Lobby** accepts a typed code or controller editing with
left/right to select a character and up/down to change it. C / Enter confirms;
V backs out of the lobby. Space / Select copies the room code.

The host starts once both players are ready, then chooses **Race**, **Cup** or
**Battle**. Each player controls their own original character selector. The host
controls shared track/cup selection, lap counts and battle settings; players can
choose their own battle teams. Original results, retry and cup advancement run
through the same synchronized session. Choose Quit in the original game menu to
return to mode selection, then Leave Lobby to disconnect. Driving uses prediction;
menu, pause, results and loading boundaries use confirmed controls.

This menu currently supports two players; live internet validation remains pending.

## Create or join a shared-screen lobby

1. The host opens **Shared screen → Create Lobby** after choosing a disc. This
   starts the host's game if it is not already running.
2. Share **Copy invite link**, or the six-character lobby code.
3. Guests open that same website and choose **Shared screen → Join Lobby**.
   An invite link fills in the code. Click **Join game**.
4. Guests receive the host's video and audio without downloading Wasm or
   selecting a disc. Click **Enable game audio** to hear the game.
5. The host is Player 1; up to three guests receive Players 2–4. The host
   chooses VS/Battle or another multiplayer mode and the player count
   through the original game menus.

Click the canvas/video to focus controls. Guests can use the displayed
keyboard controls or one standard browser gamepad. Inputs are neutral when
the guest loses focus. Leaving/disconnecting releases that guest's slot;
it can then be used by someone else. Closing the lobby disconnects guests
and leaves the host's local game running. Reloading the host closes the
lobby; there is no host migration.

Keep the host tab visible. Background throttling can pause the simulation.
All saves belong to the host; guests do not run an independent game.

On the local computer, `/local-disc` streams exactly the repository's
`assets/ctr-u.bin` to the browser automatically. The route accepts only loopback
connections with a loopback Host and same-origin requests; it is not available
to remote players. Remote players select a disc manually, then click
**Start game**. If Online was selected
first, **Start game** opens the in-game Create/Join lobby directly. The button
remains visible while choosing a disc and enables after disc validation.

The disc is never included in the build or online input/state packets.
A full image is about 600 MB, so
use a desktop browser with sufficient available memory. There are no touch
controls; use a keyboard or gamepad. Press a gamepad button to expose it to
the browser. Audio may need a click on the canvas to unlock playback.

The launcher mounts `/memcards` in IndexedDB, restores it before starting,
and persists writes with IDBFS autoPersist plus periodic/visibility flushes.
If storage is unavailable, it warns and falls back to memory. Saves belong
to this browser and origin; clearing site data removes them. The disc is
not persisted, so select it again after a reload.

## Hosting over the internet

The included Node server serves an allowlist of browser assets from
`build-web/` and handles WebSocket signaling at `/lobby`. Its local-only
`/local-disc` convenience route serves the single configured disc. It never
serves the source tree, CMake cache or memory-card files. For deployment,
include the built `index.html`, `app.js`, `online.js`, `input.js`,
`styles.css`, `ctr_native.js`, `ctr_native.wasm`, and all `online-v2-*` browser
modules copied into `build-web/` by CMake. Include the Node server, its imported
Node modules and its `ws` dependency. Online race hosting additionally requires
the headless production WASM build and server-local disc assets described in
[ONLINE_V2.md](ONLINE_V2.md). Static-only hosting does not support lobbies.

Defaults are `HOST=127.0.0.1`, `PORT=8080`. For remote access, run this
service behind an HTTPS reverse proxy that forwards HTTP and WebSocket
upgrade requests. Set `PUBLIC_ORIGIN` to the public HTTPS origin. Guests
must use the same public site as the host; a localhost invite is only
accessible on that same computer.

The default ICE configuration uses Google's public STUN service. For
connections across restrictive NAT/firewalls, configure a TURN service
using `CTR_ICE_SERVERS` (a JSON array of RTCIceServer entries):

```powershell
$env:HOST = "0.0.0.0"
$env:PUBLIC_ORIGIN = "https://your-game.example"
$env:CTR_ICE_SERVERS = '[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turns:your-relay.example:5349","username":"your-user","credential":"your-credential"}]'
npm --prefix web start
```

Use your own relay settings; the example hostname is not a running service.
ICE credentials are sent to lobby participants for connection setup.
The signaling server is self-hosted; this change does not publish a public
website or provision a TURN relay. Direct media connections are used when
available; TURN relays carry media when needed. The host sends a stream per
guest, so its upload/encoding capacity determines streaming quality.

Use HTTP on localhost and HTTPS publicly. Do not open the HTML using
`file://`. This target uses no pthreads and needs no COOP/COEP
headers. Debug screenshots, wireframe mode, native replay tooling and
native save states remain desktop features.

## One host, one simulation

Online play runs **exactly one game instance** in the host's
browser. It owns physics, RNG, timers, collisions, saves and all player
slots. Guests receive the same complete split-screen picture and audio,
and send controller state back. Guests do not run the simulation.

The implemented transport-neutral API is `window.ctrHost`:

```js
// Slots 0–3; PSX pressed-bit mask; axes 0–255, neutral 128.
ctrHost.setPad(1, 0x4000); // Hold Cross for player 2.
ctrHost.setPad(1, 0);      // Release buttons, keep the pad connected.
ctrHost.clearPad(1);       // Return this slot to local input.

const stream = await ctrHost.captureStream(); // Canvas + game Web Audio.
// releaseStream also disconnects the audio capture graph.
ctrHost.releaseStream(stream);
```

Inputs replace only their assigned slot, preserving local inputs elsewhere.
The existing replay snapshot override takes priority. Refresh the complete
state at least every 100 ms while connected, including neutral state:
after 1 second without an update, the remote override expires. Disconnect
handlers should call `clearPad` immediately. A hidden host tab also clears
remote overrides. Browser background throttling can pause the game, so the
host should keep its tab visible.

The input mask is Select `0x0001`, Start `0x0008`, Up `0x0010`,
Right `0x0020`, Down `0x0040`, Left `0x0080`, L2 `0x0100`,
R2 `0x0200`, L1 `0x0400`, R1 `0x0800`, Triangle `0x1000`,
Circle `0x2000`, Cross `0x4000`, Square `0x8000`.

The Node server assigns slots and limits signaling to the host and its
guests. Inputs travel over an unordered WebRTC data channel, with full
state at roughly 30 Hz. The host validates input ranges, rejects old
sequence numbers, limits input rates, and uses the peer's assigned slot.
Malformed peer negotiation affects only that connection. Rooms have a
maximum of four players; stale WebSockets are removed with heartbeats.

Lobbies are temporary invite-code rooms with no accounts, public lobby
browser, host migration or persistent room storage. Server restarts close
all lobbies. Streaming avoids simulation desynchronization but still has
network/encoding latency.

## Tests

```sh
npm --prefix web test
```

The server/input tests cover capacity, slot reuse, signaling boundaries,
origin rejection, invalid requests, static-file restrictions and controller
mapping. Native input timeout/replay/multitap checks run through CTest.

With Playwright available, run the two-browser manual-disc regression with:

```sh
node web/online-v2-engine-probe.mjs .cache/online-v2/manual-disc.json race --manual-disc
```

This disables `/local-disc` as on a remote/tunnel connection. It checks that
Online keeps **Start game** visible, rejects an invalid image, accepts manual
selection on both clients, and opens the native lobby before playing a race.

References: [Emscripten Asyncify](https://emscripten.org/docs/porting/asyncify.html),
[Emscripten filesystem API](https://emscripten.org/docs/api_reference/Filesystem-API.html),
and the vendored `externals/SDL/docs/README-emscripten.md`.

# Online lobbies and default character unlocks

Added **Online → Create Lobby / Join Lobby**. One host runs the existing
game and sends its canvas and game audio to up to three guests over WebRTC.
Guests send keyboard/gamepad state to the host's assigned player slots.
Guests load no disc or game engine. The original physics and split-screen
code remain the source of truth.

All 15 normally selectable characters are unlocked in native/web builds,
including fresh profiles and character selection after loading an older
save. This does not add non-playable bosses to the roster.

## Files created

| File | Description |
| --- | --- |
| [web/server.mjs](../web/server.mjs) | Node static/signaling server with invite codes, four-player capacity, slot assignment/reuse, scoped signaling, origin checks, message limits, heartbeat cleanup, and configurable STUN/TURN servers. |
| [web/online.js](../web/online.js) | Lobby UI, invite links, WebRTC negotiation, streamed guest playback, audio control, per-slot input delivery, and room/connection cleanup. |
| [web/input.js](../web/input.js) | Keyboard/standard gamepad mapping, axis conversion, neutral state, and input-packet validation. |
| [web/tests/server.test.mjs](../web/tests/server.test.mjs) | Integration tests for capacity, reuse, room boundaries, malformed requests, origin checks and static-file restrictions. |
| [web/tests/input.test.mjs](../web/tests/input.test.mjs) | Controller mapping, deadzone/clamping, neutral state and malformed packet tests. |
| [docs/ONLINE_CHANGES.md](ONLINE_CHANGES.md) | This update's file summary. |

## Files modified

| File | Description |
| --- | --- |
| [web/index.html](../web/index.html) | Tailwind Online navigation, create/join controls, invite/code fields, player list, guest video and audio control. |
| [web/app.js](../web/app.js) | Lazy game loading, host startup, Web Audio + canvas capture, capture cleanup, guest/local screen switching and lobby integration. |
| [web/styles.css](../web/styles.css) | Includes lobby UI in Tailwind source discovery. |
| [web/package.json](../web/package.json) | Adds the pinned ws server dependency, ES module support, start and test scripts. |
| [web/package-lock.json](../web/package-lock.json) | Locks the WebSocket dependency. |
| [cmake/Web.cmake](../cmake/Web.cmake) | Copies lobby/input modules into the browser build and includes lobby styling dependencies. |
| [build-web.ps1](../build-web.ps1) | Reports the new Node server startup command. |
| [build-web.sh](../build-web.sh) | Reports the new Node server startup command. |
| [game/GAMEPROG.c](../game/GAMEPROG.c) | Sets character unlock bits for new native/web profiles. |
| [game/230/MM_Characters.c](../game/230/MM_Characters.c) | Applies all character unlock bits before selecting the roster layout, including older saves. |
| [docs/WEB.md](WEB.md) | Updated local/online usage, server deployment, TURN configuration, protocol and tests. |
| [docs/WEB_CHANGES.md](WEB_CHANGES.md) | Points the initial port summary to the completed online implementation. |
| [README.md](../README.md) | Documents Online and the Node startup command. |

Existing uncommitted model work was preserved. Dependencies, browser-test
screenshots and compiled outputs remain ignored.

## Running

The build is already updated. Stop any Python server on port 8080, then:

```powershell
npm --prefix web start
```

Open <http://localhost:8080>. For friends on other computers, deploy this
server on a shared HTTPS origin; localhost invite links work only on the
same computer. TURN may be needed across restricted networks; see
[WEB.md](WEB.md). No public deployment or relay was provisioned.

## Validation

- Browser Release build and native MSVC x86 Debug build passed.
- All four native CTest checks passed.
- All six Node input/server tests passed.
- Two separate Chrome sessions created/joined a lobby and negotiated
  actual WebRTC video and audio. Guest keyboard input reached Player 2;
  releasing/leaving cleared controls. The guest downloaded no game Wasm.
- The guest layout fit a 375-pixel viewport without horizontal overflow.
- Character selection displayed the complete 15-character roster.

External networks, a real TURN relay, physical gamepads and browsers other
than Chrome were not tested in this session.

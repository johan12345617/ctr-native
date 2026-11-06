# Online 2.0 in-game lobby change summary

The game surface now contains Create Lobby / Join Lobby with a six-character
code. The host chooses a track, copies the visible code and starts once both
players are ready. Both clients keep their own camera and solo HUD. Opening
Lobby during a race shows the code and offers Back to race / Leave; it works in
fullscreen. Leaving, canceling or a failed join returns to usable controls, and
another room can be started without reloading.

Run `npm --prefix web run start:online-v2`, restart any old server, and refresh
both browsers. Each player selects their own supported NTSC-U disc. The menu
offers two-player predicted VS races; 3–4-player confirmed-input experiments
remain available through the developer API.

## Files created

| File | Description |
| --- | --- |
| `web/online-v2-lobby.js` | Controls room creation/joining, track selection, readiness, host start, visible/copyable codes, ping, in-game menu, cancellation, cleanup and retryable errors. Uses the existing predicted client and fresh modules per room. |
| `web/online-v2-lobby-probe.mjs` | Exercises real menu buttons, disc selection and code entry in two independent Chromium/WebGL2 contexts against the WASM authority with a delayed connection. Saves results and screenshots. |
| `docs/ONLINE_V2_LOBBY_CHANGES.md` | Records this file summary, verification and playtest steps. |

## Files modified for this change

| File | Description |
| --- | --- |
| `web/index.html` | Adds the Tailwind lobby overlay and in-race Lobby button, track/code controls, readiness and start/leave actions. Adds Online race and renames the streaming tab Shared screen. Keeps the menu in the fullscreen game surface. |
| `web/app.js` | Coordinates local/race/streaming modes and fullscreen ownership. Disc selection loads the module factory without allocating an unused local game runtime. Preserves local saves/startup and allows Tab/Shift+Tab past SDL's keyboard handler. |
| `web/online-v2-client.js` | Limits keyboard capture to mapped game buttons while the game canvas has focus, allowing normal menu/navigation keys. |
| `web/online.js` | Adds mode-change coordination and active-session reporting while preserving the existing streaming lobby. |
| `web/styles.css` | Includes the new controller's utility classes in Tailwind source scanning. |
| `web/server.mjs` | Serves the new controller, reports Online 2.0 availability through uncached health responses, and accepts `--online-v2`. |
| `web/package.json` | Adds `start:online-v2` and `online:v2:lobby-probe` commands without new dependencies. |
| `cmake/Web.cmake` | Copies the lobby module into the browser build and includes it in stylesheet dependencies. Both production WASM builds were refreshed for the shared build-source identity. |
| `web/tests/server.test.mjs` | Verifies disabled Online 2.0 capability in the default server health response. |
| `web/tests/online-v2.test.mjs` | Verifies enabled Online 2.0 capability and uncached health responses. |
| `README.md` | Describes the visible-code flow and new launch command. |
| `docs/WEB.md` | Separates individual-camera races from shared-screen streaming instructions. |
| `docs/ONLINE_V2.md` | Replaces the required developer-console flow with the menu, keeps the advanced API documented and adds the lobby probe command. |

## Verification

Verified on November 6, 2026:

- Production browser and headless WASM builds succeeded; Tailwind CSS rebuilt.
- All 27 web protocol, prediction and server tests passed.
- The real two-browser lobby probe passed all 11 checks with no browser errors
  or diagnostic failures: disc gating, invalid-code retry, code copy, readiness,
  host start, actual driving by both players, Tab/Shift+Tab navigation,
  fullscreen/menu/resume, close/cancel, a second room without reload, narrow
  layout and returning to the shared-screen tab/local startup.
- The delayed probe received 458/465 authority frames across two races and
  observed 218 moving frames for each player. It used 50 ms upstream and 70 ms
  downstream delay with up to 15 ms jitter per direction.
- Ready-room and narrow-screen screenshots were inspected. `git diff --check`
  passed.
- The default server's disabled-race explanation and Shared screen navigation
  passed a separate browser check. A CLI smoke test verified `--online-v2`, its
  enabled health response and the new browser module route.

The lobby skips frame/prediction/reconciliation notifications; it updates on
session and RTT events rather than touching the DOM every gameplay tick. The
existing prediction, authority and rendering paths remain responsible for the
race itself. This UI test does not replace internet/hardware latency testing.

For a live playtest, use two devices on the same reachable server, create/join
through Online race, drive with each camera, and check Lobby / Back to race /
Leave in fullscreen. Report ping and any control delay, audio or gamepad issues.
The remaining Online 2.0 release milestones are unchanged.

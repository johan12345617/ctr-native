# Web support: change summary

The browser build runs the existing C game as WebAssembly with WebGL2.
It supports local play and shared-screen online lobbies: one simulation,
streamed video/audio, and controller inputs per slot. See
[the online update summary](ONLINE_CHANGES.md) for the subsequent lobby and
default-character-unlock changes.

## Files created

| File | Purpose |
| --- | --- |
| [build-web.ps1](../build-web.ps1) | Windows build command; finds the SDK, CMake and Ninja, installs pinned Tailwind dependencies, and builds the browser target. |
| [build-web.sh](../build-web.sh) | Linux/macOS build command using an activated Emscripten environment. |
| [cmake/Web.cmake](../cmake/Web.cmake) | WebGL2, Asyncify, memory, filesystem and exported host API settings; compiles Tailwind CSS and copies launcher assets. |
| [include/platform/native_gl.h](../include/platform/native_gl.h) | Selects GLES3 for the browser and the existing GLAD loader for desktop. |
| [platform/native_web.c](../platform/native_web.c) | Exposes controller input and keyboard-player assignment to JavaScript. |
| [web/index.html](../web/index.html) | Responsive Tailwind launcher, local disc picker, game canvas, fullscreen, keyboard-player selector and controls. |
| [web/app.js](../web/app.js) | Loads Wasm, validates and opens the local disc, restores/persists saves, handles browser states, and exposes the host input/video API. |
| [web/styles.css](../web/styles.css) | Tailwind entry point and explicit source discovery. |
| [web/package.json](../web/package.json) | Pinned Tailwind build dependencies and CSS command. |
| [web/package-lock.json](../web/package-lock.json) | Reproducible web dependency versions. |
| [tests/remote_input_smoke.c](../tests/remote_input_smoke.c) | Checks invalid input rejection, player assignment, local input preservation, multitap, replay priority, release, and stale-input expiry. |
| [docs/WEB.md](WEB.md) | Build/play/hosting instructions, save behavior, host API, and the remaining online work. |
| [docs/WEB_CHANGES.md](WEB_CHANGES.md) | This file-by-file summary. |

## Files modified

| File | Changes in this task |
| --- | --- |
| [.gitignore](../.gitignore) | Ignores the launcher's node_modules directory. |
| [CMakeLists.txt](../CMakeLists.txt) | Supports the Emscripten toolchain, enables GLES there, keeps desktop flags/debug tools on desktop, loads web configuration, and registers the remote-input test. |
| [CMakePresets.json](../CMakePresets.json) | Adds web-release configure/build presets. |
| [README.md](../README.md) | Adds the browser entry point and links to setup and architecture documentation. |
| [main.c](../main.c) | Uses the desktop GL loader only on desktop; includes the browser API for web builds. |
| [include/platform/native_input.h](../include/platform/native_input.h) | Declares per-slot remote input and keyboard-player accessors. |
| [platform/native_input.c](../platform/native_input.c) | Merges validated remote state into its assigned slot, expires it after one second, and provides keyboard-player accessors. Keeps installed replay snapshots at higher priority. Loads SDL before project macros for standalone compilation. |
| [platform/native_platform.c](../platform/native_platform.c) | Limits browser keyboard events to the canvas and yields VBlank waits with Asyncify. Desktop pacing is unchanged. |
| [platform/native_renderer.c](../platform/native_renderer.c) | Creates a WebGL2/GLES3 context, uses GLSL ES shaders and compatible RGBA readback, and excludes desktop-only GL operations on web builds. |

Existing uncommitted character/model work was preserved. The initial port
kept gameplay source intact; the subsequent online update changes only
character unlock defaults in game code. Build products, the local SDK,
browser-test dependencies, screenshots and logs are ignored generated files.

## Validation

- Emscripten 4.0.23 Release build succeeded, including the Windows build script.
- Chrome loaded the local disc, rendered menus, and entered an arcade race.
  Keyboard navigation and acceleration worked.
- The host API rejected invalid inputs, accepted/released a valid remote pad,
  and returned a video capture track.
- IndexedDB save data survived a browser reload.
- The launcher fit desktop and 375-pixel mobile widths without horizontal overflow.
- The native MSVC x86 Debug build succeeded; all four CTest checks passed.
  The matching suite includes 51 Python unit tests.

Physical gamepads, other browsers, and Linux/macOS builds were not exercised
in this Windows session. The later online update implements signaling,
guest UI, WebRTC video/audio and relay configuration; deployment and relay
provisioning are environment setup.
